/**
 * Simplified Worker Registration - Based on test-blocking.cjs Success Pattern
 *
 * This file creates and registers workers for the 2-queue architecture:
 * - perfana-analyze: Single test run analysis pipeline
 * - perfana-batch: Batch reevaluation pipeline
 *
 * All workers use BRPOPLPUSH blocking mode for instant (<10ms) job pickup.
 */

import { Worker } from 'bullmq';
import { getLogger } from '../lib/utils/logger.js';
import { SIMPLE_QUEUES, SimpleQueueName as _SimpleQueueName } from '../config/simple-queues.js';
import { JOB_NAMES } from '../types/jobs.js';
import { createSimpleWorker } from './simple-worker-factory.js';
import { initializeGrafanaConfig } from '../config/grafana-config-cache.js';

// Self-registering: populates the pipeline registry on import
import './pipeline-registrations.js';
import { createProcessorFromRegistry } from './pipeline-registry.js';

// Complex workers that are NOT in the registry (custom logic beyond the standard pattern)
import { analyzeTestWorker } from './analyze.js';
import { incrementalMetricsWorker } from './incremental-metrics.js';
// Use simplified orchestrator (NO priority, NO rate limiting)
import { simpleOrchestrateReevaluateBatchWorker } from './simple-orchestrate-reevaluate-batch.js';

const logger = getLogger('simple-workers');

// Track all workers for shutdown
const workers: Worker[] = [];

/**
 * Create a unified processor for the analyze queue
 * Routes jobs to appropriate pipeline handlers based on job name
 */
function createAnalyzeQueueProcessor() {
  // Pipeline registry handles the 10 standard workers; add complex ones manually
  const registryProcessors = createProcessorFromRegistry();
  const processors = {
    ...registryProcessors,
    [JOB_NAMES.ANALYZE_TEST]: analyzeTestWorker(),
    [JOB_NAMES.INCREMENTAL_COLLECTION]: incrementalMetricsWorker(),
  };

  return async (job: any) => {
    const processor = processors[job.name as keyof typeof processors];

    if (!processor) {
      logger.error(`No processor found for job: ${job.name}`);
      throw new Error(`Unknown job type: ${job.name}`);
    }

    logger.info(`Processing job: ${job.name} (ID: ${job.id})`);
    return await processor(job);
  };
}

/**
 * Create a unified processor for the batch queue
 * Routes jobs to appropriate batch pipeline handlers
 */
function createBatchQueueProcessor() {
  const registryProcessors = createProcessorFromRegistry();
  const processors = {
    [JOB_NAMES.BATCH_ANALYSIS]: analyzeTestWorker(), // Reuse single test processor
    [JOB_NAMES.BATCH_FLOW]: analyzeTestWorker(), // Reuse single test processor
    [JOB_NAMES.REEVALUATION_BATCH]: registryProcessors[JOB_NAMES.REEVALUATE_CHECKS], // From registry
    [JOB_NAMES.ORCHESTRATE_REEVALUATE_BATCH]: simpleOrchestrateReevaluateBatchWorker(), // Simplified orchestrator
  };

  return async (job: any) => {
    const processor = processors[job.name as keyof typeof processors];

    if (!processor) {
      logger.error(`No processor found for batch job: ${job.name}`);
      throw new Error(`Unknown batch job type: ${job.name}`);
    }

    logger.info(`Processing batch job: ${job.name} (ID: ${job.id})`);
    return await processor(job);
  };
}

/**
 * Register all simplified workers with blocking connections
 * All workers use TypeORM for database access via NestJS dependency injection
 */
export async function registerSimpleWorkers(): Promise<void> {
  logger.info('🔧 Starting simplified BullMQ worker registration...');
  logger.info('📋 Architecture: 2 queues with NO priority, NO rate limiting');
  logger.info('💎 All pipelines use TypeORM for database operations');

  try {
    // Initialize Grafana config cache ONCE at startup (reduces DB connection usage)
    await initializeGrafanaConfig();

    // Create perfana-analyze worker
    logger.info(`🔧 Creating worker for ${SIMPLE_QUEUES.ANALYZE} queue...`);
    const analyzeWorker = createSimpleWorker(
      SIMPLE_QUEUES.ANALYZE,
      createAnalyzeQueueProcessor()
    );
    workers.push(analyzeWorker);
    logger.info(`✅ ${SIMPLE_QUEUES.ANALYZE} worker created with blocking connection`);

    // Create perfana-batch worker
    logger.info(`🔧 Creating worker for ${SIMPLE_QUEUES.BATCH} queue...`);
    const batchWorker = createSimpleWorker(
      SIMPLE_QUEUES.BATCH,
      createBatchQueueProcessor()
    );
    workers.push(batchWorker);
    logger.info(`✅ ${SIMPLE_QUEUES.BATCH} worker created with blocking connection`);

    logger.info('📋 All simplified workers registered successfully');
    logger.info(`📊 Total active workers: ${workers.length}`);
    logger.info('🎯 Workers ready with BRPOPLPUSH blocking mode for <10ms pickup');

  } catch (error) {
    logger.error('❌ Failed to register simplified workers:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

/**
 * Gracefully stop all workers
 */
export async function stopSimpleWorkers(): Promise<void> {
  logger.info('🛑 Stopping all simplified workers...');

  try {
    const closePromises = workers.map(async (worker) => {
      try {
        await worker.close();
      } catch (error) {
        logger.error('❌ Error closing worker:', error);
      }
    });

    await Promise.allSettled(closePromises);
    workers.length = 0;

    logger.info('✅ All simplified workers stopped successfully');
  } catch (error) {
    logger.error('❌ Error stopping simplified workers:', error);
    throw error;
  }
}
