import { Queue, Worker, QueueOptions, WorkerOptions, JobsOptions } from 'bullmq';
import Redis from 'ioredis';
import { getConfig } from './environment.js';
import { getRedisConnectionString as _getRedisConnectionString } from './redis.js';
import { acquireRedisConnection, releaseRedisConnection } from './redis-pool.js';
import { getLogger } from '../lib/utils/logger.js';

const logger = getLogger('queue-config');

export interface QueueConfiguration {
  defaultJobOptions: JobsOptions;
  workerOptions: Omit<WorkerOptions, 'connection'>;
}

export function createQueueConfig(): QueueConfiguration {
  const config = getConfig();

  return {
    defaultJobOptions: {
      removeOnComplete: 10,    // Keep 10 completed jobs
      removeOnFail: 5,         // Keep 5 failed jobs
      attempts: config.QUEUE_RETRY_LIMIT,
      delay: config.QUEUE_RETRY_DELAY * 1000, // Convert to milliseconds
      backoff: {
        type: 'exponential',
        delay: config.QUEUE_RETRY_DELAY * 1000,
      },
      // Job expiration (24 hours)
      jobId: undefined, // Auto-generate job IDs
      timestamp: Date.now(),
    },
    workerOptions: {
      concurrency: config.QUEUE_CONCURRENCY,
      limiter: {
        max: 100,
        duration: 60000, // 100 jobs per minute
      },
      settings: {
        drainDelay: 1,             // Check for jobs every 1ms when idle (prevents 30s polling delay)
      } as any,
    },
  };
}

export async function createQueue(name: string): Promise<Queue> {
  const config = createQueueConfig();
  const env = getConfig();

  // CRITICAL: Use direct IORedis connection with minimal BullMQ config
  // DO NOT use pooled connections - they interfere with BullMQ's blocking mode
  const connection = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
    maxRetriesPerRequest: null,   // Required for BullMQ
    enableReadyCheck: false        // Recommended for BullMQ
  });

  const queueOptions: QueueOptions = {
    connection,
    prefix: 'bull',  // CRITICAL: Must match worker prefix for proper communication
    defaultJobOptions: config.defaultJobOptions,
  };

  const queue = new Queue(name, queueOptions);

  // Handle queue events
  (queue as any).on('error', (error: any) => {
    logger.error(`❌ Queue ${name} error:`, error);
  });

  (queue as any).on('waiting', (job: any) => {
    logger.debug(`⏳ Job ${job.id} waiting in queue ${name}`);
  });

  (queue as any).on('active', (job: any) => {
    logger.debug(`🔄 Job ${job.id} started in queue ${name}`);
  });

  (queue as any).on('completed', (job: any) => {
    logger.debug(`✅ Job ${job.id} completed in queue ${name}`);
  });

  (queue as any).on('failed', (job: any, err: any) => {
    logger.error(`❌ Job ${job?.id} failed in queue ${name}:`, err);
  });

  (queue as any).on('stalled', (job: any) => {
    logger.warn(`⚠️ Job ${job.id} stalled in queue ${name}`);
  });

  return queue;
}

export async function createWorker<T = any>(
  name: string,
  processor: (job: any) => Promise<any>
): Promise<Worker<T>> {
  const config = createQueueConfig();

  // FIXED: Acquire Redis connection from pool
  const connection = await acquireRedisConnection();

  const workerOptions: WorkerOptions = {
    ...config.workerOptions,
    connection,
  };

  const worker = new Worker<T>(name, processor, workerOptions);

  // Handle worker events
  worker.on('error', (error) => {
    logger.error(`❌ Worker ${name} error:`, error);
  });

  worker.on('ready', () => {
    logger.info(`✅ Worker ${name} ready`);
  });

  worker.on('active', (job) => {
    logger.debug(`🔄 Worker ${name} processing job ${job.id}`);
  });

  worker.on('completed', (job, _result) => {
    logger.debug(`✅ Worker ${name} completed job ${job.id}`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`❌ Worker ${name} failed job ${job?.id}:`, err);
  });

  worker.on('stalled', (job: any) => {
    logger.warn(`⚠️ Worker ${name} job ${job.id} stalled`);
  });

  worker.on('drained', () => {
    logger.debug(`🏁 Worker ${name} drained - no more jobs`);
  });

  return worker;
}

export async function testQueueConnection(): Promise<boolean> {
  // FIXED: Acquire Redis connection from pool
  const redis = await acquireRedisConnection();

  try {
    // Test Redis connectivity
    const pong = await redis.ping();
    if (pong !== 'PONG') {
      throw new Error('Redis ping failed');
    }

    // Test queue creation (now async)
    const testQueue = await createQueue('test-connection');

    // Add a test job
    const job = await testQueue.add('test-job', {
      timestamp: new Date().toISOString()
    });

    logger.info(`✅ Test job queued with ID: ${job.id}`);

    // Clean up
    await testQueue.clean(0, 100, 'completed');
    await testQueue.clean(0, 100, 'failed');
    await testQueue.close();

    logger.info('✅ BullMQ queue connection test successful');
    return true;
  } catch (error) {
    logger.error('❌ BullMQ queue connection test failed:', error);
    return false;
  } finally {
    // FIXED: Release Redis connection back to pool instead of disconnecting
    releaseRedisConnection(redis);
  }
}