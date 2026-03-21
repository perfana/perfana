/**
 * Simplified Worker Factory - Based on test-blocking.cjs Success Pattern
 *
 * This factory creates workers that achieve <10ms job pickup by:
 * 1. Separate blocking connection (CRITICAL for BRPOPLPUSH)
 * 2. NO limiter configuration
 * 3. NO priority values
 * 4. drainDelay > 50ms
 *
 * Proven to work: test-blocking.cjs achieved 8ms pickup time
 */

import { Worker, Job, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { getConfig } from '../config/environment.js';
import { getLogger } from '../lib/utils/logger.js';
import { getDatabaseService } from '../common/database-accessor.js';
import {
  SimpleQueueName,
  SimpleWorkerConfig as _SimpleWorkerConfig,
  getWorkerConfig,
  getJobOptions,
} from '../config/simple-queues.js';

const logger = getLogger('simple-worker-factory');

/**
 * Create a Redis connection for BullMQ
 */
function createRedisConnection(): IORedis {
  const config = getConfig();
  return new IORedis({
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD || undefined,
    db: config.REDIS_DB,
    maxRetriesPerRequest: null,   // Required for BullMQ
    enableReadyCheck: false,        // Recommended for BullMQ
  });
}

/**
 * Create a simple Queue instance with NO priority, NO rate limiting
 */
export function createSimpleQueue(queueName: SimpleQueueName): Queue {
  const connection = createRedisConnection();

  const queue = new Queue(queueName, {
    connection,
    prefix: 'bull',
    // NO defaultJobOptions with priority!
    // Job options are set per-job using getJobOptions()
  });

  queue.on('error', (error) => {
    logger.error(`Queue ${queueName} error:`, error);
  });

  return queue;
}

/**
 * Create a simple Worker instance with blocking connection
 * This matches the test-blocking.cjs pattern that achieved 8ms pickup
 */
export function createSimpleWorker(
  queueName: SimpleQueueName,
  processor: (job: Job) => Promise<any>
): Worker {
  // Get worker configuration
  const workerConfig = getWorkerConfig(queueName);

  // Create TWO separate Redis connections
  const connection = createRedisConnection();
  const blockingConnection = createRedisConnection();

  logger.info(`Creating simple worker for queue: ${queueName}`, {
    concurrency: workerConfig.concurrency,
    drainDelay: workerConfig.drainDelay,
  });

  // Wrap processor to ensure DB connection is alive before each job
  const wrappedProcessor = async (job: Job) => {
    try {
      const db = getDatabaseService();
      await db.ensureConnection();
    } catch (error) {
      logger.warn(`Pre-job DB connection check failed for ${job.name}, proceeding anyway:`, error);
    }
    return processor(job);
  };

  // Create worker with EXACT pattern from test-blocking.cjs
  const worker = new Worker(
    queueName,
    wrappedProcessor,
    {
      connection: connection as any,              // Regular connection for commands
      blockingConnection: blockingConnection as any,      // CRITICAL: Separate connection for BRPOPLPUSH
      concurrency: workerConfig.concurrency,
      // NO limiter configuration!
      settings: {
        drainDelay: workerConfig.drainDelay, // MUST be > 50ms for blocking mode
      } as any,
    }
  );

  // Setup event listeners
  worker.on('ready', () => {
    logger.info(`Worker ready: ${queueName}`);
  });

  worker.on('error', (error) => {
    logger.error(`Worker ${queueName} error:`, error);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} failed in ${queueName}:`, err);
  });

  worker.on('completed', (job: any) => {
    logger.info(`Job ${job.id} completed in ${queueName}`);
  });

  worker.on('stalled', (job: any) => {
    logger.warn(`Job ${job.id} stalled in ${queueName}`);
  });

  logger.info(`Simple worker created for ${queueName} with blocking connection`);

  return worker;
}

/**
 * Add a job to a queue with NO priority
 */
export async function addSimpleJob(
  queue: Queue,
  jobName: string,
  data: any
): Promise<void> {
  const options = getJobOptions(jobName);

  // CRITICAL: Do not add priority field!
  await queue.add(jobName, data, options);

  logger.info(`Job added: ${jobName}`, {
    queue: queue.name,
    data,
  });
}
