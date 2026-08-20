import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { DataSource } from 'typeorm';
import { ApplicationDashboardsService } from '../application-dashboards.service';

export interface ApplicationDashboardDeletionJobData {
  id: string;
  deleteFromGrafana: boolean;
  userId: string;
  roles: string[];
}

const QUEUE_NAME = 'perfana-application-dashboard-deletion';

/**
 * BullMQ Application Dashboard Deletion Processor
 *
 * Deleting one application dashboard cascades into the TimescaleDB hypertables
 * (ds_metrics, ds_metric_statistics, ...), so a batch fired in parallel from the
 * browser both blocks the UI and deadlocks the database. Same problem — and same
 * fix — as test run deletion: serialize through a queue with concurrency 1 and
 * return 202 immediately.
 */
@Injectable()
export class ApplicationDashboardDeletionProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ApplicationDashboardDeletionProcessor.name);
  private redis: IORedis | null = null;
  private workerRedis: IORedis | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private isRedisAvailable = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly applicationDashboardsService: ApplicationDashboardsService,
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

      // Recovery signal on the queue's own connection — without it a transient
      // blip would pin every later batch to the synchronous fallback, i.e. the
      // very freeze this queue exists to avoid.
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
        `Redis unavailable (${message}) — application dashboard deletion falls back to synchronous processing`,
      );
    }
  }

  private initializeQueueAndWorker(): void {
    this.queue = new Queue(QUEUE_NAME, {
      connection: this.redis!,
      defaultJobOptions: {
        removeOnComplete: 100,
        // Must be true, not a retention count. Jobs are keyed by
        // `delete-appdash-{id}` for deduplication, and BullMQ's add script
        // no-ops when that key still exists (addStandardJob-9.lua:90). A
        // permanently failed job left in the failed set would therefore
        // swallow every later retry of the same dashboard while the API
        // still answered "queued". The failure is logged below instead.
        removeOnFail: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
      },
    });

    // Concurrency 1 — the serialization point that keeps the cascades from
    // deadlocking. ponytail: per-process, so N API replicas give effective
    // concurrency N. Same shape as TestRunDeletionProcessor; if the API is ever
    // scaled horizontally, both need a distributed lock instead.
    this.worker = new Worker<ApplicationDashboardDeletionJobData, void>(
      QUEUE_NAME,
      async (job) => this.processJob(job),
      { connection: this.workerRedis!, concurrency: 1 },
    );

    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `Deletion job ${job?.id} for application dashboard ${job?.data?.id} failed: ${error.message}`,
      );
      // Mark it failed so the row stays in the list wearing a badge. Without this
      // the UI has dropped the row optimistically and the only sign of a
      // permanently failed deletion is the dashboard reappearing on reload, with
      // the reason buried in the API log. Mirrors TestRunDeletionProcessor.
      if (job?.data?.id) {
        this.setDeletionStatus(job.data.id, 'failed').catch((err) => {
          this.logger.error(`Failed to set deletion_status to 'failed': ${err.message}`);
        });
      }
    });

    this.worker.on('error', (error) => {
      this.logger.error(`Application dashboard deletion worker error: ${error.message}`);
    });

    this.logger.log('Application dashboard deletion queue and worker initialized (concurrency: 1)');
  }

  /**
   * Set (or clear, with null) the background-deletion state on a dashboard row.
   *
   * Deliberately on the pooled connection: this runs in a BullMQ worker, outside
   * any HTTP request, so there is no RLS context to inherit — the same reason
   * processJob forwards an explicit audit actor.
   */
  private async setDeletionStatus(id: string, status: string | null): Promise<void> {
    await this.dataSource.query(
      'UPDATE application_dashboards SET deletion_status = $1 WHERE id = $2',
      [status, id],
    );
  }

  private async processJob(job: Job<ApplicationDashboardDeletionJobData, void>): Promise<void> {
    const { id, deleteFromGrafana, userId, roles } = job.data;
    await this.setDeletionStatus(id, 'deleting');
    // Jobs run outside the HTTP request, so there is no CLS context for the
    // audit actor — forward the queuing user (mirrors DeleteTestRunHandler).
    await this.applicationDashboardsService.delete(id, deleteFromGrafana, userId, roles, {
      auditActorOverride: { userId },
    });
    this.logger.log(`Deleted application dashboard ${id} (queued by ${userId})`);
  }

  isAvailable(): boolean {
    return this.isRedisAvailable && this.queue !== null && this.worker !== null;
  }

  /**
   * Queue application dashboards for deletion. Duplicate ids are collapsed by
   * jobId, so re-submitting an already-queued dashboard is a no-op.
   */
  async addBulkJobs(
    ids: string[],
    deleteFromGrafana: boolean,
    ctx: { userId: string; roles: string[] },
  ): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('Application dashboard deletion processor is not available (Redis unavailable)');
    }

    // Marked before enqueuing, so the list shows "queued" from the moment the
    // request returns rather than from whenever the worker picks the job up.
    await this.dataSource.query(
      `UPDATE application_dashboards SET deletion_status = 'queued' WHERE id = ANY($1)`,
      [ids],
    );

    for (const id of ids) {
      await this.queue!.add(
        'delete-application-dashboard',
        { id, deleteFromGrafana, userId: ctx.userId, roles: ctx.roles },
        { jobId: `delete-appdash-${id}` },
      );
    }

    this.logger.log(`Queued ${ids.length} application dashboard(s) for deletion by ${ctx.userId}`);
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
