import type { Job } from 'bullmq';
import { getLogger, logPipelineStart, logPipelineSuccess as _logPipelineSuccess, logPipelineError } from '../lib/utils/logger.js';
import { AnalyzeTestJobSchema, type AnalyzeTestJob, type JobResult } from '../types/jobs.js';
import { PipelineOrchestrator } from '../services/PipelineOrchestrator.js';
import { getDatabaseService } from '../common/database-accessor.js';
import { DataSanityCheckPipeline } from '../pipelines/DataSanityCheckPipeline.js';
import { getRedisPool } from '../config/redis-pool.js';
import { JobLockService } from '../services/JobLockService.js';
import { ProgressReporter } from '../services/ProgressReporter.js';
import { JobType } from '@perfana/shared/types';

const logger = getLogger('analyze-test-worker');

/**
 * Analyze Test Worker - Main entry point for complete test analysis
 * Equivalent to Python's analyze_test_task in perfana_ds_api/routes/data.py:300-332
 *
 * Executes the full 9-stage pipeline:
 * 1. Dynatrace Collection (optional)
 * 2. Panels Processing (creates panel documents)
 * 3. Performance Test Metrics (raw test data extraction from requests_raw, transactions, etc.)
 * 4. Metrics Collection (CORE - Grafana data extraction)
 * 5. Statistics Calculation (aggregations)
 * 6. Checks Evaluation (performance requirements - prerequisite for control groups)
 * 7. Control Groups Creation (after checks completed)
 * 8. Control Group Statistics (calculate averages from control test runs)
 * 9. ADAPT Analysis (difference detection, if enabled)
 */
export function analyzeTestWorker() {
  return async (job: Job): Promise<JobResult> => {
    const startTime = Date.now();
    let validatedData: AnalyzeTestJob | undefined;
    let redis: any = null;
    let lockService: JobLockService | null = null;
    let progressReporter: ProgressReporter | null = null;
    let lockAcquired = false;
    let testRunInfo: { testRunId: string; systemUnderTestId: string; testEnvironment: string; workload: string } | null = null;

    try {
      // Validate job data
      validatedData = AnalyzeTestJobSchema.parse(job.data);
      const { testRunId, adapt, benchmarksOnly } = validatedData;

      logPipelineStart(logger, 'analyze-test', { testRunId, adapt, benchmarksOnly });

      // Get database service to fetch test run info
      const db = getDatabaseService();
      const testRun = await db.testRunRepo.findOne({
        where: { testRunId },
        select: ['testRunId', 'systemUnderTestId', 'testEnvironment', 'workload']
      });

      if (!testRun) {
        throw new Error(`Test run not found: ${testRunId}`);
      }

      testRunInfo = {
        testRunId: testRun.testRunId,
        systemUnderTestId: testRun.systemUnderTestId,
        testEnvironment: testRun.testEnvironment,
        workload: testRun.workload,
      };

      // Acquire Redis connection from pool
      const redisPool = getRedisPool();
      redis = await redisPool.acquire();

      // Initialize lock service
      lockService = new JobLockService(redis);

      // Try to acquire lock for this scope
      const lockResult = await lockService.acquireLock(
        testRunInfo.systemUnderTestId,
        testRunInfo.testEnvironment,
        testRunInfo.workload,
        job.id!,
        testRunId,
        'analyze' as JobType
      );

      if (!lockResult.acquired) {
        // Job is blocked by another running job
        logger.warn(`Job ${job.id} blocked by existing job`, {
          testRunId,
          blockingJobId: lockResult.blockingInfo?.existingJobId,
        });

        return {
          status: 'failed',
          message: `Job blocked: ${lockResult.blockingInfo?.reason || 'Another job is processing this scope'}`,
          data: {
            blocked: true,
            blockingJobId: lockResult.blockingInfo?.existingJobId,
            blockingJobProgress: lockResult.blockingInfo?.existingJobProgress,
          },
        };
      }

      lockAcquired = true;
      logger.info(`🔒 Lock acquired for job ${job.id}`, {
        testRunId,
        scope: `${testRunInfo.systemUnderTestId}:${testRunInfo.testEnvironment}:${testRunInfo.workload}`,
      });

      // Define the complete 10-stage pipeline for analyze-test
      const stages = [
        'dynatrace-collection',       // Step 1: External data collection (DQL metrics)
        'panels-processing',          // Step 2: Panel document creation
        'performance-test-metrics',   // Step 3: Performance test metrics extraction (raw test data)
        'transaction-stats-rollup',   // Step 4: Per-test-run transaction/sampler stats rollup (#150, #151)
        'metrics-collection',         // Step 5: CORE metrics from Grafana
        'statistics-calculation',     // Step 6: Statistical aggregations
        'checks-evaluation',          // Step 7: Performance evaluation (prerequisite for control groups)
        'control-groups-creation',    // Step 8: Control groups creation (after checks)
        'control-group-statistics',   // Step 9: Control group statistics calculation
        ...(adapt ? ['adapt-analysis'] : []),  // Step 10: ADAPT (if enabled)
        'data-sanity-check',          // Step 11: Data sanity validation
      ];

      // Initialize progress reporter
      progressReporter = new ProgressReporter(
        redis,
        job,
        testRunInfo,
        'analyze' as JobType,
        stages
      );

      // Create orchestrator and execute the sequential pipeline with progress tracking
      const orchestrator = new PipelineOrchestrator(logger, db);
      const result = await orchestrator.executeSequentialPipeline(
        testRunId,
        {
          stages,
          errorHandling: 'abort', // Stop pipeline if a critical stage fails
          timeoutMs: 600000 // 10 minute total timeout
        },
        progressReporter // Pass progress reporter for real-time updates
      );

      // Data sanity check — runs after the main pipeline, never fails the job
      await progressReporter?.startStage('data-sanity-check');
      const sanityPipeline = new DataSanityCheckPipeline(logger);
      await sanityPipeline.execute({ testRunId });
      await progressReporter?.completeStage();

      const duration = Date.now() - startTime;

      logger.info(`✅ Analysis ${result.success ? 'completed' : 'completed with failures'} for ${testRunId} in ${duration}ms`);

      return {
        status: result.success ? 'success' : 'partial',
        message: `Analysis ${result.success ? 'completed' : 'completed with some failures'} for test run ${testRunId}`,
        data: {
          testRunId,
          stages: stages.length,
          duration: `${duration}ms`,
          adapt,
          benchmarksOnly,
          pipeline: result.data
        }
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logPipelineError(logger, 'analyze-test', error as Error, {
        testRunId: validatedData?.testRunId,
        duration: `${duration}ms`
      });

      // Report failure to progress tracker
      if (progressReporter) {
        await progressReporter.fail(errorMessage);
      }

      return {
        status: 'failed',
        message: `Analysis failed for test run: ${errorMessage}`,
        errors: [{
          message: errorMessage,
          code: 'ANALYZE_TEST_ERROR',
          details: {
            testRunId: validatedData?.testRunId,
            duration: `${duration}ms`
          }
        }]
      };
    } finally {
      // Always release lock and Redis connection in finally block
      if (lockAcquired && lockService && testRunInfo) {
        try {
          await lockService.releaseLock(
            testRunInfo.systemUnderTestId,
            testRunInfo.testEnvironment,
            testRunInfo.workload,
            job.id!
          );
          logger.info(`🔓 Lock released for job ${job.id}`, {
            testRunId: validatedData?.testRunId,
          });
        } catch (lockError) {
          logger.error(`Failed to release lock for job ${job.id}:`, lockError);
        }
      }

      // Clean up progress reporter
      if (progressReporter) {
        await progressReporter.cleanup();
      }

      // Release Redis connection back to pool
      if (redis) {
        try {
          const redisPool = getRedisPool();
          redisPool.release(redis);
        } catch (releaseError) {
          logger.error(`Failed to release Redis connection for job ${job.id}:`, releaseError);
        }
      }
    }
  };
}

