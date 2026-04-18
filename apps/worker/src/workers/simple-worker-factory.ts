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
  processor: (job: Job) => Promise<unknown>
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

  // Wrap processor to ensure DB connection is alive and not overloaded before each job
  const wrappedProcessor = async (job: Job) => {
    try {
      const db = getDatabaseService();
      await db.ensureConnection();

      // Backpressure check: if PostgreSQL has too many active connections,
      // delay this job to let the database recover. This prevents the
      // post-test cascade where queued jobs re-saturate the database.
      // See: 2026-03-26 write starvation post-mortem
      const BACKPRESSURE_THRESHOLD = 20;
      const BACKPRESSURE_DELAY_MS = 30_000; // 30 seconds
      const MAX_BACKPRESSURE_CHECKS = 5;

      for (let check = 0; check < MAX_BACKPRESSURE_CHECKS; check++) {
        const [{ active_count }] = await db.query<{ active_count: string }>(
          `SELECT count(*) as active_count FROM pg_stat_activity WHERE state = 'active' AND pid != pg_backend_pid()`
        );
        const activeConnections = parseInt(active_count, 10);

        if (activeConnections < BACKPRESSURE_THRESHOLD) {
          break;
        }

        logger.warn(`Backpressure: ${activeConnections} active DB connections (threshold: ${BACKPRESSURE_THRESHOLD}). Delaying job ${job.name} by ${BACKPRESSURE_DELAY_MS}ms (check ${check + 1}/${MAX_BACKPRESSURE_CHECKS})`);

        if (check < MAX_BACKPRESSURE_CHECKS - 1) {
          await new Promise(resolve => setTimeout(resolve, BACKPRESSURE_DELAY_MS));
        } else {
          logger.warn(`Backpressure: max checks reached, proceeding with job ${job.name} despite high connection count`);
        }
      }
    } catch (error) {
      logger.warn(`Pre-job health check failed for ${job.name}, proceeding anyway:`, error);
    }
    return processor(job);
  };

  // Create worker with EXACT pattern from test-blocking.cjs
  const worker = new Worker(
    queueName,
    wrappedProcessor,
    {
      connection: connection as unknown,              // Regular connection for commands
      blockingConnection: blockingConnection as unknown,      // CRITICAL: Separate connection for BRPOPLPUSH
      concurrency: workerConfig.concurrency,
      // NO limiter configuration!
      settings: {
        drainDelay: workerConfig.drainDelay, // MUST be > 50ms for blocking mode
      } as unknown,
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

  worker.on('completed', (job: unknown) => {
    logger.info(`Job ${job.id} completed in ${queueName}`);
  });

  worker.on('stalled', (job: unknown) => {
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
  data: unknown
): Promise<void> {
  const options = getJobOptions(jobName);

  // CRITICAL: Do not add priority field!
  await queue.add(jobName, data, options);

  logger.info(`Job added: ${jobName}`, {
    queue: queue.name,
    data,
  });
}
