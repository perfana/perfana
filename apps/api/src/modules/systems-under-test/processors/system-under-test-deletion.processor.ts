import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { DataSource } from 'typeorm';
import { DeleteSystemUnderTestHandler } from '../handlers/delete-system-under-test.handler';

export interface SystemUnderTestDeletionJobData {
  id: string;
  userId: string;
}

const QUEUE_NAME = 'perfana-system-under-test-deletion';

/**
 * BullMQ System Under Test Deletion Processor
 *
 * The SUT cascade used to run inline in `DELETE /api/systems-under-test/:id`, bounded only by
 * node-postgres' client-side `query_timeout` of 300 s. On 2026-10-23 that fired in production:
 * the client destroyed the connection while Postgres kept executing, the user got a 500 after
 * five minutes, and nothing was deleted. Migrations 1816 and 1817 removed the pathological
 * foreign-key probes behind that particular timeout, but a system with hundreds of test runs
 * still issues five hypertable DELETEs per run plus every other phase, and no index makes that
 * fit in a request.
 *
 * Same shape as `ApplicationDashboardDeletionProcessor` and `TestRunDeletionProcessor`:
 * concurrency 1, return 202, and carry the state on the row so the list can show a badge.
 */
@Injectable()
export class SystemUnderTestDeletionProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SystemUnderTestDeletionProcessor.name);
  private redis: IORedis | null = null;
  private workerRedis: IORedis | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private isRedisAvailable = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly deleteHandler: DeleteSystemUnderTestHandler,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.configService.get('REDIS_URL', 'redis://localhost:6379');
    const isDevelopment = this.configService.get('NODE_ENV') === 'development';

    const options = {
      maxRetriesPerRequest: null, // required by BullMQ
      enableReadyCheck: false,
      lazyConnect: true,
      connectTimeout: 10000,
    } as const;

    try {
      this.redis = new IORedis(redisUrl, options);
      // BullMQ requires a separate connection for the Worker (blocking commands).
      this.workerRedis = new IORedis(redisUrl, options);

      for (const conn of [this.redis, this.workerRedis]) {
        conn.on('error', (error) => {
          this.logger.error(`Redis connection error: ${error.message}`);
          this.isRedisAvailable = false;
        });
      }

      // Recovery signal on the queue's own connection — without it a transient blip would pin
      // every later delete to the synchronous fallback, i.e. the very 300 s hang this queue
      // exists to avoid.
      this.redis.on('ready', () => {
        this.isRedisAvailable = true;
      });

      await this.redis.connect();
      await this.workerRedis.connect();
      this.isRedisAvailable = true;
      this.initializeQueueAndWorker();
    } catch (error) {
      this.isRedisAvailable = false;
      const message =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';
      if (!isDevelopment) {
        throw error;
      }
      this.logger.warn(
        `Redis unavailable (${message}) — system under test deletion falls back to synchronous processing`,
      );
    }
  }

  private initializeQueueAndWorker(): void {
    this.queue = new Queue(QUEUE_NAME, {
      connection: this.redis!,
      defaultJobOptions: {
        removeOnComplete: 100,
        // Must be true, not a retention count. Jobs are keyed by `delete-sut-{id}` for
        // deduplication and BullMQ's add script no-ops while that key exists, so a
        // permanently failed job left in the failed set would swallow every later retry of
        // the same system while the API still answered "queued". The failure is logged and
        // stamped on the row below instead.
        removeOnFail: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
      },
    });

    // Concurrency 1 — the cascade touches the same hypertable chunks as every other delete.
    // ponytail: per-process, so N API replicas give effective concurrency N. Same caveat as
    // the other two deletion processors; a horizontally scaled API needs a distributed lock.
    this.worker = new Worker<SystemUnderTestDeletionJobData, void>(
      QUEUE_NAME,
      async (job) => this.processJob(job),
      { connection: this.workerRedis!, concurrency: 1 },
    );

    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `Deletion job ${job?.id} for system under test ${job?.data?.id} failed: ${error.message}`,
      );
      if (job?.data?.id) {
        this.setDeletionStatus(job.data.id, 'failed').catch((err) => {
          this.logger.error(`Failed to set deletion_status to 'failed': ${err.message}`);
        });
      }
    });

    this.worker.on('error', (error) => {
      this.logger.error(`System under test deletion worker error: ${error.message}`);
    });

    this.logger.log('System under test deletion queue and worker initialized (concurrency: 1)');
  }

  /**
   * Set (or clear, with null) the background-deletion state on a system row.
   *
   * Deliberately on the pooled connection: this runs in a BullMQ worker, outside any HTTP
   * request, so there is no RLS context to inherit.
   */
  private async setDeletionStatus(id: string, status: string | null): Promise<void> {
    await this.dataSource.query(
      'UPDATE systems_under_test SET deletion_status = $1 WHERE id = $2',
      [status, id],
    );
  }

  private async processJob(job: Job<SystemUnderTestDeletionJobData, void>): Promise<void> {
    const { id, userId } = job.data;
    await this.setDeletionStatus(id, 'deleting');
    const { systemName } = await this.deleteHandler.execute(id);
    this.logger.log(`Deleted system under test "${systemName}" (${id}, queued by ${userId})`);
  }

  isAvailable(): boolean {
    return this.isRedisAvailable && this.queue !== null && this.worker !== null;
  }

  /**
   * Queue a system under test for deletion. Re-submitting an already-queued system is a no-op,
   * collapsed by jobId.
   */
  async addJob(id: string, userId: string): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('System under test deletion processor is not available (Redis unavailable)');
    }

    // Marked before enqueuing, so the list shows "queued" from the moment the request returns
    // rather than from whenever the worker picks the job up.
    await this.setDeletionStatus(id, 'queued');

    await this.queue!.add(
      'delete-system-under-test',
      { id, userId },
      { jobId: `delete-sut-${id}` },
    );

    this.logger.log(`Queued system under test ${id} for deletion by ${userId}`);
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.worker?.close();
      await this.queue?.close();
      this.workerRedis?.disconnect();
      this.redis?.disconnect();
    } catch (error) {
      const message =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';
      this.logger.warn(`Error during deletion processor cleanup: ${message}`);
    }
  }
}
