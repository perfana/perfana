/**
 * DEPRECATED: Old complex orchestrator
 * Use simple-orchestrate-reevaluate-batch.ts instead
 */

import { QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { getLogger } from '../lib/utils/logger.js';
import { OrchestrateReevaluateBatchJobSchema, type JobResult, JOB_NAMES } from '../types/jobs.js';
import { getQueueForJob } from '../config/queues.js';
import { createQueue } from '../config/queue.js';
import { getConfig } from '../config/environment.js';

const logger = getLogger('orchestrate-reevaluate-batch-worker');

/**
 * Helper to create QueueEvents with minimal BullMQ config
 * CRITICAL: Use direct connections, not pooled connections
 */
function createQueueEvents(queueName: string): QueueEvents {
  const env = getConfig();
  const connection = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });

  return new QueueEvents(queueName, { connection });
}

export function orchestrateReevaluateBatchWorker() {
  logger.info('orchestrateReevaluateBatchWorker function called during registration');
  logger.info('🔧 CREATING ORCHESTRATOR WORKER FUNCTION 🔧');

  return async (job: { data: unknown }): Promise<JobResult> => {
    // CRITICAL DEBUG: This should appear in logs when job is processed
    logger.info('🚨 ORCHESTRATOR HANDLER ENTRY POINT 🚨');
    logger.info(`Job received: ${JSON.stringify(job, null, 2)}`);

    // Add some delay to ensure logs appear
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      logger.info('🚀 ORCHESTRATOR FUNCTION CALLED 🚀');
      logger.info('=== ORCHESTRATOR HANDLER START ===');
      logger.info(`Function arguments count: ${arguments.length}`);
      logger.info(`Job object keys: ${Object.keys(job || {}).join(', ')}`);
      logger.info(`Job type: ${typeof job}`);
      // Database now accessed via TypeORM through NestJS

      // Early check for empty or invalid job
      if (!job || !job.data) {
        logger.error('No job or job.data provided!');
        return {
          status: 'failed',
          message: 'Invalid job: no data provided',
          errors: [{ message: 'Job data is missing' }]
        };
      }
    } catch (debugError) {
      logger.error('Error in orchestrator debug logging:', debugError);
      return {
        status: 'failed',
        message: `Debug error: ${String(debugError)}`,
        errors: [{ message: String(debugError) }]
      };
    }

    try {
      // Log the raw job data when picked from queue
      logger.info(`Job picked from queue - Job ID: ${(job as any).id}, Job Name: ${(job as any).name}`);
      logger.info(`Raw job data: ${JSON.stringify(job.data, null, 2)}`);

      const validatedData = OrchestrateReevaluateBatchJobSchema.parse(job.data);
      const { testRunIds, batchId, checks, adapt, refreshMode, applicationDashboardId, panelId, metricName } = validatedData;
      const skipDataCollection = !refreshMode; // No refreshMode = reevaluate only (skip collection)

      // Log validated data for debugging
      logger.info('📋 Validated orchestrate-reevaluate-batch job data:');
      logger.info(`  Job ID: ${(job as any).id}`);
      logger.info(`  Batch ID: ${batchId}`);
      logger.info(`  Test Run IDs: [${testRunIds.join(', ')}]`);
      logger.info(`  Checks enabled: ${checks}`);
      logger.info(`  ADAPT enabled: ${adapt}`);
      logger.info(`  Skip data collection: ${skipDataCollection}`);
      if (applicationDashboardId || panelId || metricName) {
        logger.info(`  Metric filter:`);
        logger.info(`    - Dashboard ID: ${applicationDashboardId || 'not set'}`);
        logger.info(`    - Panel ID: ${panelId || 'not set'}`);
        logger.info(`    - Metric name: ${metricName || 'not set'}`);
      } else {
        logger.info(`  Metric filter: not set (processing all metrics)`);
      }

      const pipelineStartTime = Date.now();
      logger.info(`🚀 Starting orchestrate-reevaluate-batch for batch ${batchId}`);
      logger.info(`⏱️  Pipeline start time: ${new Date(pipelineStartTime).toISOString()}`);

      const results: { [key: string]: any } = {};
      const errors: Array<{ stage: string; error: string }> = [];
      let hasFailures = false;

      // Stage 1: Data Collection (if not skipped)
      if (!skipDataCollection) {
        const stage1StartTime = Date.now();
        logger.info('🔷 STAGE 1: Running data collection pipeline (panels, metrics, statistics)');
        logger.info(`⏱️  Stage 1 start time: ${new Date(stage1StartTime).toISOString()}`);

        // FIXED: Await createQueue() and use pooled Redis connections
        const panelsQueue = await createQueue(getQueueForJob(JOB_NAMES.PANELS_PROCESSING));
        const metricsQueue = await createQueue(getQueueForJob(JOB_NAMES.METRICS_COLLECTION));
        const statisticsQueue = await createQueue(getQueueForJob(JOB_NAMES.STATISTICS_PIPELINE));

        // FIXED: Use direct Redis connection (not pooled)
        const statisticsQueueEvents = createQueueEvents(getQueueForJob(JOB_NAMES.STATISTICS_PIPELINE));

        try {
          // Run data collection pipeline for all test runs
          const dataCollectionPromises = [];
          const testRunTimings: Record<string, { start: number; panels?: number; metrics?: number; stats?: number }> = {};

          for (const testRunId of testRunIds) {
            const testRunStartTime = Date.now();
            testRunTimings[testRunId] = { start: testRunStartTime };
            logger.info(`🔹 Running data collection for ${testRunId} (started at ${new Date(testRunStartTime).toISOString()})`);

            // Sequential pipeline: Panels -> Metrics -> Statistics
            const panelsStartTime = Date.now();
            logger.info(`  📄 Starting panels processing for ${testRunId}`);
            const panelsJob = await panelsQueue.add(
              JOB_NAMES.PANELS_PROCESSING,
              { testRunId, batchId },
              { attempts: 3 }
            );
            testRunTimings[testRunId].panels = Date.now();
            logger.info(`  📄 Panels job created for ${testRunId} in ${Date.now() - panelsStartTime}ms (jobId: ${panelsJob.id})`);

            const metricsStartTime = Date.now();
            logger.info(`  📊 Starting metrics collection for ${testRunId}`);
            const metricsJob = await metricsQueue.add(
              JOB_NAMES.METRICS_COLLECTION,
              { testRunId, batchId },
              {
                attempts: 3,
                parent: { id: panelsJob.id!, queue: panelsQueue.name }
              }
            );
            testRunTimings[testRunId].metrics = Date.now();
            logger.info(`  📊 Metrics job created for ${testRunId} in ${Date.now() - metricsStartTime}ms (jobId: ${metricsJob.id})`);

            const statsStartTime = Date.now();
            logger.info(`  📈 Starting statistics pipeline for ${testRunId}`);
            const statsJob = await statisticsQueue.add(
              JOB_NAMES.STATISTICS_PIPELINE,
              { testRunIds: [testRunId], batchId },
              {
                attempts: 3,
                parent: { id: metricsJob.id!, queue: metricsQueue.name }
              }
            );
            testRunTimings[testRunId].stats = Date.now();
            logger.info(`  📈 Statistics job created for ${testRunId} in ${Date.now() - statsStartTime}ms (jobId: ${statsJob.id})`);
            logger.info(`  ✅ All jobs created for ${testRunId} in ${Date.now() - testRunTimings[testRunId].start}ms`);

            dataCollectionPromises.push(statsJob.waitUntilFinished(statisticsQueueEvents));
          }

          // Wait for all data collection to complete
          const waitStartTime = Date.now();
          logger.info(`⏳ Waiting for ${dataCollectionPromises.length} data collection pipelines to complete...`);
          const dataCollectionResults = await Promise.allSettled(dataCollectionPromises);
          const waitDuration = Date.now() - waitStartTime;
          logger.info(`⏳ Data collection wait completed in ${waitDuration}ms`);
          const failedDataCollection = dataCollectionResults.filter(r => r.status === 'rejected').length;

          if (failedDataCollection > 0) {
            hasFailures = true;
            errors.push({
              stage: 'data-collection',
              error: `${failedDataCollection} test runs failed data collection`
            });
          }

          const stage1Duration = Date.now() - stage1StartTime;
          results.dataCollection = {
            successful: dataCollectionResults.filter(r => r.status === 'fulfilled').length,
            failed: failedDataCollection,
            duration: stage1Duration,
            testRunTimings
          };
          logger.info(`🔷 STAGE 1 COMPLETED in ${stage1Duration}ms (${(stage1Duration/1000).toFixed(1)}s)`);
          logger.info(`📊 Stage 1 Results: ${results.dataCollection.successful} successful, ${failedDataCollection} failed`);

          // Queue cleanup - temporarily commented for TS build issues
          // await panelsQueue.close();
          // await metricsQueue.close();
          // await statisticsQueue.close();
          await statisticsQueueEvents.close();

        } catch (error) {
          hasFailures = true;
          errors.push({ stage: 'data-collection', error: String(error) });
        }
      } else {
        logger.info('🔷 STAGE 1: Skipping data collection - using existing data');
        results.dataCollection = { skipped: true, duration: 0 };
      }

      // Stage 2: Checks Pipeline
      if (checks) {
        const stage2StartTime = Date.now();
        logger.info('🔸 STAGE 2: Running checks pipeline');

        const checksQueue = await createQueue(getQueueForJob(JOB_NAMES.CHECKS_EVALUATION));
        const checksQueueEvents = createQueueEvents(getQueueForJob(JOB_NAMES.CHECKS_EVALUATION));

        try {
          const checksJob = await checksQueue.add(
            JOB_NAMES.CHECKS_EVALUATION,
            {
              testRunIds,
              applicationDashboardId,
              panelId,
              metricName
            },
            { attempts: 3 }
          );

          await checksJob.waitUntilFinished(checksQueueEvents);
          const stage2Duration = Date.now() - stage2StartTime;
          results.checks = { successful: 1, failed: 0, duration: stage2Duration };
          logger.info(`🔸 STAGE 2 COMPLETED in ${stage2Duration}ms`);

          await checksQueueEvents.close();
        } catch (error) {
          hasFailures = true;
          errors.push({ stage: 'checks', error: String(error) });
          results.checks = { successful: 0, failed: 1, duration: Date.now() - stage2StartTime };
        }
      } else {
        logger.info('🔸 STAGE 2: Skipping checks pipeline (disabled)');
        results.checks = { skipped: true, reason: 'disabled', duration: 0 };
      }

      // Stage 3: ADAPT Pipeline
      if (adapt) {
        const stage3StartTime = Date.now();
        logger.info('🔷 STAGE 3: Running ADAPT pipeline');

        const adaptQueue = await createQueue(getQueueForJob(JOB_NAMES.ADAPT_PIPELINE));
        const adaptQueueEvents = createQueueEvents(getQueueForJob(JOB_NAMES.ADAPT_PIPELINE));

        try {
          const adaptJob = await adaptQueue.add(
            JOB_NAMES.ADAPT_PIPELINE,
            {
              testRunIds,
              // Skip control group updates when checks are disabled
              // Control groups are only needed for the Checks pipeline
              updateControlGroup: checks,
              updateControlStatistics: checks,
              applicationDashboardId,
              panelId,
              metricName
            },
            { attempts: 3 }
          );

          await adaptJob.waitUntilFinished(adaptQueueEvents);
          const stage3Duration = Date.now() - stage3StartTime;
          results.adapt = { successful: 1, failed: 0, duration: stage3Duration };
          logger.info(`🔷 STAGE 3 COMPLETED in ${stage3Duration}ms`);

          await adaptQueueEvents.close();
        } catch (error) {
          hasFailures = true;
          errors.push({ stage: 'adapt', error: String(error) });
          results.adapt = { successful: 0, failed: 1, duration: Date.now() - stage3StartTime };
        }
      } else {
        logger.info('🔷 STAGE 3: Skipping ADAPT pipeline (disabled)');
        results.adapt = { skipped: true, reason: 'disabled', duration: 0 };
      }

      // Final result compilation
      const totalStages = (skipDataCollection ? 0 : 1) + (checks ? 1 : 0) + (adapt ? 1 : 0);
      const completedStages = Object.values(results).filter(r =>
        r && typeof r === 'object' && (r.successful || r.successful > 0 || r.skipped)
      ).length;

      logger.info(`Orchestration complete: ${completedStages}/${totalStages} stages completed`);

      if (hasFailures) {
        return {
          status: 'partial',
          message: `Batch orchestration completed with failures in ${errors.length} stage(s)`,
          data: {
            batchId,
            totalRuns: testRunIds.length,
            stages: results,
            completedStages,
            totalStages,
            configuration: { checks, adapt, skipDataCollection }
          },
          errors: errors.map(e => ({
            message: `${e.stage}: ${e.error}`,
            details: { stage: e.stage }
          }))
        };
      }

      return {
        status: 'success',
        message: `Successfully orchestrated re-evaluation for ${testRunIds.length} test runs`,
        data: {
          batchId,
          totalRuns: testRunIds.length,
          stages: results,
          completedStages,
          totalStages,
          configuration: { checks, adapt, skipDataCollection }
        }
      };

    } catch (error) {
      logger.error('Error in orchestrate-reevaluate-batch worker:', error);
      return {
        status: 'failed',
        message: `Batch orchestration failed: ${String(error)}`,
        errors: [{ message: String(error) }]
      };
    }
  };
}