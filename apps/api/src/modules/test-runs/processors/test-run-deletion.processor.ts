import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { DeleteTestRunHandler } from '../handlers/delete-test-run.handler';
import { DeleteTestRunCommand } from '../commands/delete-test-run.command';
import { CommandContext } from '../commands/types';

/**
 * Job data for test run deletion
 */
export interface TestRunDeletionJobData {
  id: string;
  userId: string;
  roles: string[];
  organizationId?: string;
  teamId?: string;
  timestamp?: string;
}

/**
 * Result from a deletion job
 */
export interface TestRunDeletionJobResult {
  success: boolean;
  id: string;
  testRunId?: string;
  errorMessage?: string;
}

export const TEST_RUN_DELETION_QUEUE_NAME = 'perfana-test-run-deletion';

/**
 * BullMQ Test Run Deletion Processor
 *
 * Serializes test run deletions through a queue with concurrency 1 to prevent
 * database deadlocks when deleting multiple test runs with millions of rows
 * in TimescaleDB hypertables (ds_metrics, requests_raw, etc.).
 */
@Injectable()
export class TestRunDeletionProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TestRunDeletionProcessor.name);
  private redis: IORedis | null = null;
  private workerRedis: IORedis | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private isRedisAvailable = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly deleteTestRunHandler: DeleteTestRunHandler,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    await this.initializeConnections();
  }

  private async initializeConnections(): Promise<void> {
    try {
      const redisUrl = this.configService.get('REDIS_URL', 'redis://localhost:6379');
      const isDevelopment = this.configService.get('NODE_ENV') === 'development';

      this.logger.log(`Connecting to Redis at: ${redisUrl} for test run deletion processor`);

      this.redis = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: true,
        connectTimeout: 10000,
      });

      this.redis.on('connect', () => {
        this.logger.log('Redis connected for test run deletion processor');
        this.isRedisAvailable = true;
      });

      this.redis.on('error', (error) => {
        this.logger.error(`Redis connection error: ${error.message}`);
        this.isRedisAvailable = false;
      });

      this.redis.on('close', () => {
        this.logger.warn('Redis connection closed for test run deletion processor');
        this.isRedisAvailable = false;
      });

      // Separate connection for BullMQ Worker (required by BullMQ docs)
      this.workerRedis = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: true,
        connectTimeout: 10000,
      });

      this.workerRedis.on('error', (error) => {
        this.logger.error(`Worker Redis connection error: ${error.message}`);
      });

      try {
        await this.redis.connect();
        await this.workerRedis.connect();
        this.initializeQueueAndWorker();
      } catch (error) {
        if (!isDevelopment) {
          throw error;
        }
        this.logger.warn(
          'Redis connection failed - test run deletion processor will be unavailable in development mode',
        );
      }
    } catch (error) {
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';
      const isDevelopment = this.configService.get('NODE_ENV') === 'development';

      if (isDevelopment) {
        this.logger.warn(`Failed to initialize Redis in development mode: ${errorMessage}`);
        this.logger.warn('Test run deletion will fall back to synchronous processing.');
      } else {
        this.logger.error(`Failed to initialize test run deletion processor: ${errorMessage}`);
        throw error;
      }
    }
  }

  private initializeQueueAndWorker(): void {
    if (!this.redis || !this.isRedisAvailable) {
      return;
    }

    try {
      this.queue = new Queue(TEST_RUN_DELETION_QUEUE_NAME, {
        connection: this.redis,
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 50,
          attempts: 3,
          backoff: { type: 'exponential', delay: 10000 },
        },
      });

      // Concurrency: 1 — the critical serialization point that prevents deadlocks
      // Uses separate Redis connection (BullMQ requires it for blocking commands)
      this.worker = new Worker<TestRunDeletionJobData, TestRunDeletionJobResult>(
        TEST_RUN_DELETION_QUEUE_NAME,
        async (job) => this.processJob(job),
        {
          connection: this.workerRedis!,
          concurrency: 1,
        },
      );

      this.worker.on('ready', () => {
        this.logger.log('Test run deletion worker ready (concurrency: 1)');
      });

      this.worker.on('active', (job) => {
        this.logger.log(`Processing deletion job ${job.id} for test run ${job.data.id}`);
      });

      this.worker.on('completed', (job, result) => {
        if (result.success) {
          this.logger.log(`Deletion completed for test run ${job.data.id}`);
        } else {
          this.logger.warn(`Deletion failed for test run ${job.data.id}: ${result.errorMessage}`);
        }
      });

      this.worker.on('failed', (job, error) => {
        this.logger.error(`Deletion job ${job?.id} failed permanently: ${error.message}`);
        // Mark as failed in DB so it reappears in the UI
        if (job?.data?.id) {
          this.setDeletionStatus(job.data.id, 'failed').catch((err) => {
            this.logger.error(`Failed to set deletion_status to 'failed': ${err.message}`);
          });
        }
      });

      this.worker.on('error', (error) => {
        this.logger.error(`Test run deletion worker error: ${error.message}`);
      });

      this.logger.log('Test run deletion queue and worker initialized (concurrency: 1)');
    } catch (error) {
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';
      this.logger.error(`Failed to initialize queue and worker: ${errorMessage}`);
      this.isRedisAvailable = false;
    }
  }

  private async processJob(
    job: Job<TestRunDeletionJobData, TestRunDeletionJobResult>,
  ): Promise<TestRunDeletionJobResult> {
    const { id, userId, organizationId, teamId } = job.data;

    try {
      await this.setDeletionStatus(id, 'deleting');

      const command = DeleteTestRunCommand.fromId(id);
      const context: CommandContext = { userId, organizationId, teamId, timestamp: new Date() };
      const result = await this.deleteTestRunHandler.execute(command, context);

      return {
        success: true,
        id,
        testRunId: result.testRunId,
      };
    } catch (error) {
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';

      this.logger.error(`Deletion failed for test run ${id}: ${errorMessage}`);

      // Re-throw so BullMQ treats this as a failed job and retries (attempts: 3).
      // The 'failed' event handler sets deletion_status='failed' after all retries exhausted.
      throw error;
    }
  }

  /**
   * Check if the queue is available
   */
  isAvailable(): boolean {
    return this.isRedisAvailable && this.queue !== null && this.worker !== null;
  }

  /**
   * Queue a single test run for deletion
   */
  async addJob(
    id: string,
    ctx: { userId: string; roles: string[]; organizationId?: string; teamId?: string },
  ): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('Test run deletion processor is not available (Redis unavailable)');
    }

    const jobData: TestRunDeletionJobData = {
      id,
      userId: ctx.userId,
      roles: ctx.roles,
      organizationId: ctx.organizationId,
      teamId: ctx.teamId,
      timestamp: new Date().toISOString(),
    };

    const job = await this.queue!.add('delete-test-run', jobData, {
      jobId: `delete-tr-${id}`,
    });

    this.logger.log(`Queued deletion job ${job.id} for test run ${id}`);
    return job.id!;
  }

  /**
   * Queue multiple test runs for deletion
   */
  async addBulkJobs(
    ids: string[],
    ctx: { userId: string; roles: string[]; organizationId?: string; teamId?: string },
  ): Promise<string[]> {
    const jobIds: string[] = [];
    for (const id of ids) {
      const jobId = await this.addJob(id, ctx);
      jobIds.push(jobId);
    }
    return jobIds;
  }

  /**
   * Synchronous fallback when Redis is unavailable
   */
  async processSync(
    id: string,
    ctx: { userId: string; organizationId?: string; teamId?: string },
  ): Promise<TestRunDeletionJobResult> {
    try {
      await this.setDeletionStatus(id, 'deleting');

      const command = DeleteTestRunCommand.fromId(id);
      const context: CommandContext = { userId: ctx.userId, organizationId: ctx.organizationId, teamId: ctx.teamId, timestamp: new Date() };
      const result = await this.deleteTestRunHandler.execute(command, context);

      return {
        success: true,
        id,
        testRunId: result.testRunId,
      };
    } catch (error) {
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';

      await this.setDeletionStatus(id, 'failed').catch(() => { /* best-effort status update */ });

      return {
        success: false,
        id,
        errorMessage,
      };
    }
  }

  /**
   * Update deletion_status on the test_runs row
   */
  private async setDeletionStatus(id: string, status: string | null): Promise<void> {
    await this.dataSource.query(
      'UPDATE test_runs SET deletion_status = $1 WHERE id = $2',
      [status, id],
    );
  }

  /**
   * Set deletion_status = 'queued' for multiple test runs in one query
   */
  async markQueued(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.dataSource.query(
      `UPDATE test_runs SET deletion_status = 'queued' WHERE id = ANY($1)`,
      [ids],
    );
  }

  async onModuleDestroy() {
    this.logger.log('Closing test run deletion processor connections...');

    try {
      if (this.worker) {
        await this.worker.close();
      }
      if (this.queue) {
        await this.queue.close();
      }
      if (this.workerRedis) {
        this.workerRedis.disconnect();
      }
      if (this.redis) {
        this.redis.disconnect();
      }
      this.logger.log('Test run deletion processor connections closed');
    } catch (error) {
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';
      this.logger.warn(`Error during deletion processor cleanup: ${errorMessage}`);
    }
  }
}
