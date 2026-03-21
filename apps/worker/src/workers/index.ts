import { getLogger } from '../lib/utils/logger.js';
import { JOB_NAMES } from '../types/jobs.js';
import { getQueueForJob } from '../config/queues.js';
import { getWorkerFactory, EnhancedWorker } from './worker-factory.js';
import { analyzeTestWorker } from './analyze.js';
import { metricsCollectionWorker } from './metrics.js';
import { statisticsWorker } from './statistics.js';
import { controlGroupsWorker } from './control-groups.js';
import { adaptWorker } from './adapt.js';
import { checksWorker } from './checks.js';
import { panelsWorker } from './panels.js';
import { reevaluateWorker } from './reevaluate.js';
import { orchestrateReevaluateBatchWorker } from './orchestrate-reevaluate-batch.js';
import { initializeGrafanaConfig } from '../config/grafana-config-cache.js';

const logger = getLogger('worker-registration');

// Keep track of all enhanced workers for shutdown
const enhancedWorkers: EnhancedWorker[] = [];

/**
 * DEPRECATED: This is the old complex worker registration system
 * Use simple-workers.ts instead for the new simplified system
 *
 * Register all job handlers with BullMQ
 * Each handler is configured with appropriate concurrency and retry settings
 */
export async function registerAllWorkers(): Promise<void> {
  logger.info('🔧 Starting enhanced BullMQ worker registration...');

  try {
    // Initialize Grafana config cache ONCE at startup (reduces DB connection usage)
    await initializeGrafanaConfig();

    const workerFactory = getWorkerFactory();

    // Single test analysis (critical priority queue)
    logger.info('🔧 Registering analyze-test worker...');
    const analyzeWorker = await workerFactory.createWorker({
      workerName: 'analyze-test-worker',
      queueName: getQueueForJob(JOB_NAMES.ANALYZE_TEST),
      jobNames: [JOB_NAMES.ANALYZE_TEST],
      jobHandler: analyzeTestWorker(),
      concurrency: 3,
      enableMetrics: true,
      resourceMonitoring: true
    });
    enhancedWorkers.push(analyzeWorker);
    logger.info(`✅ Registered ${JOB_NAMES.ANALYZE_TEST} enhanced worker`);

    // Metrics collection (high concurrency for Grafana API calls)
    logger.info('🔧 Registering metrics-collection worker...');
    const metricsWorker = await workerFactory.createWorker({
      workerName: 'metrics-collection-worker',
      queueName: getQueueForJob(JOB_NAMES.METRICS_COLLECTION),
      jobNames: [JOB_NAMES.METRICS_COLLECTION], // ADDED: Only process metrics jobs
      jobHandler: metricsCollectionWorker(), // Migrated to TypeORM
      concurrency: 5,
      enableMetrics: true,
      resourceMonitoring: true
    });
    enhancedWorkers.push(metricsWorker);
    logger.info(`✅ Registered ${JOB_NAMES.METRICS_COLLECTION} enhanced worker`);

    // Statistics pipeline
    logger.info('🔧 Registering statistics worker...');
    const statsWorker = await workerFactory.createWorker({
      workerName: 'statistics-worker',
      queueName: getQueueForJob(JOB_NAMES.STATISTICS_PIPELINE),
      jobNames: [JOB_NAMES.STATISTICS_PIPELINE],
      jobHandler: statisticsWorker(), // Migrated to TypeORM
      concurrency: 3,
      enableMetrics: true,
      resourceMonitoring: true
    });
    enhancedWorkers.push(statsWorker);
    logger.info(`✅ Registered ${JOB_NAMES.STATISTICS_PIPELINE} enhanced worker`);

    // Control groups pipeline
    logger.info('🔧 Registering control-groups worker...');
    const controlGroupsEnhancedWorker = await workerFactory.createWorker({
      workerName: 'control-groups-worker',
      queueName: getQueueForJob(JOB_NAMES.CONTROL_GROUPS_PIPELINE),
      jobNames: [JOB_NAMES.CONTROL_GROUPS_PIPELINE],
      jobHandler: controlGroupsWorker(), // Migrated to TypeORM
      concurrency: 2,
      enableMetrics: true,
      resourceMonitoring: true
    });
    enhancedWorkers.push(controlGroupsEnhancedWorker);
    logger.info(`✅ Registered ${JOB_NAMES.CONTROL_GROUPS_PIPELINE} enhanced worker`);

    // ADAPT analysis pipeline (resource intensive)
    logger.info('🔧 Registering adapt worker...');
    const adaptAnalysisWorker = await workerFactory.createWorker({
      workerName: 'adapt-worker',
      queueName: getQueueForJob(JOB_NAMES.ADAPT_PIPELINE),
      jobNames: [JOB_NAMES.ADAPT_PIPELINE],
      jobHandler: adaptWorker(), // Migrated to TypeORM
      concurrency: 2, // Lower concurrency due to resource requirements
      enableMetrics: true,
      resourceMonitoring: true
    });
    enhancedWorkers.push(adaptAnalysisWorker);
    logger.info(`✅ Registered ${JOB_NAMES.ADAPT_PIPELINE} enhanced worker`);

    // Checks evaluation pipeline
    logger.info('🔧 Registering checks worker...');
    const checksEvaluationWorker = await workerFactory.createWorker({
      workerName: 'checks-worker',
      queueName: getQueueForJob(JOB_NAMES.CHECKS_EVALUATION),
      jobNames: [JOB_NAMES.CHECKS_EVALUATION],
      jobHandler: checksWorker(), // Migrated to TypeORM
      concurrency: 4,
      enableMetrics: true,
      resourceMonitoring: true
    });
    enhancedWorkers.push(checksEvaluationWorker);
    logger.info(`✅ Registered ${JOB_NAMES.CHECKS_EVALUATION} enhanced worker`);

    // Panels processing pipeline
    logger.info('🔧 Registering panels worker...');
    const panelsProcessingWorker = await workerFactory.createWorker({
      workerName: 'panels-worker',
      queueName: getQueueForJob(JOB_NAMES.PANELS_PROCESSING),
      jobNames: [JOB_NAMES.PANELS_PROCESSING],
      jobHandler: panelsWorker(), // Migrated to TypeORM
      concurrency: 3,
      enableMetrics: true,
      resourceMonitoring: true
    });
    enhancedWorkers.push(panelsProcessingWorker);
    logger.info(`✅ Registered ${JOB_NAMES.PANELS_PROCESSING} enhanced worker`);

    // NOTE: Dynatrace collection is now handled by the PipelineOrchestrator
    // as part of the analyze-test workflow (see analyze.ts)

    // Re-evaluate checks pipeline
    logger.info('🔧 Registering reevaluate worker...');
    const reevaluateChecksWorker = await workerFactory.createWorker({
      workerName: 'reevaluate-worker',
      queueName: getQueueForJob(JOB_NAMES.REEVALUATE_CHECKS),
      jobNames: [JOB_NAMES.REEVALUATE_CHECKS],
      jobHandler: reevaluateWorker(),
      concurrency: 4,
      enableMetrics: true,
      resourceMonitoring: true
    });
    enhancedWorkers.push(reevaluateChecksWorker);
    logger.info(`✅ Registered ${JOB_NAMES.REEVALUATE_CHECKS} enhanced worker`);

    // Orchestrate reevaluate batch pipeline
    logger.info('🔧 Registering orchestrate-reevaluate-batch worker...');
    const orchestrateReevaluateBatchEnhancedWorker = await workerFactory.createWorker({
      workerName: 'orchestrate-reevaluate-batch-worker',
      queueName: getQueueForJob(JOB_NAMES.ORCHESTRATE_REEVALUATE_BATCH),
      jobNames: [JOB_NAMES.ORCHESTRATE_REEVALUATE_BATCH],
      jobHandler: orchestrateReevaluateBatchWorker(),
      concurrency: 2,
      enableMetrics: true,
      resourceMonitoring: true
    });
    enhancedWorkers.push(orchestrateReevaluateBatchEnhancedWorker);
    logger.info(`✅ Registered ${JOB_NAMES.ORCHESTRATE_REEVALUATE_BATCH} enhanced worker`);

    // TEMPORARILY DISABLED: Setup global event listeners for monitoring
    // TODO: Fix event listener structure to match BullMQ Worker events
    // enhancedWorkers.forEach(worker => {
    //   worker.on('jobCompleted', (event) => {
    //     logger.debug(`Job completed: ${event.jobName}`, {
    //       jobId: event.jobId,
    //       processingTime: event.processingTime
    //     });
    //   });

    //   worker.on('jobFailed', (event) => {
    //     logger.warn(`Job failed: ${event.jobName}`, {
    //       jobId: event.jobId,
    //       error: event.error,
    //       attempts: event.attempts
    //     });
    //   });
    // });

    logger.info('📋 All enhanced job handlers registered successfully');
    logger.info(`📊 Total active enhanced workers: ${enhancedWorkers.length}`);
    logger.info('🎯 Enhanced workers ready with monitoring and resource management');

  } catch (error) {
    logger.error('❌ Failed to register enhanced workers:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      type: error instanceof Error ? error.constructor.name : typeof error
    });
    throw error;
  }
}

/**
 * Gracefully stop all workers
 * This is called during application shutdown
 */
export async function stopAllWorkers(): Promise<void> {
  logger.info('🛑 Stopping all enhanced workers...');

  try {
    // Close all enhanced workers
    const closePromises = enhancedWorkers.map(async (worker) => {
      try {
        await worker.close();
      } catch (error) {
        logger.error('❌ Error closing enhanced worker:', error);
      }
    });

    await Promise.allSettled(closePromises);

    // Clear workers array
    enhancedWorkers.length = 0;

    logger.info('✅ All enhanced workers stopped successfully');
  } catch (error) {
    logger.error('❌ Error stopping enhanced workers:', error);
    throw error;
  }
}