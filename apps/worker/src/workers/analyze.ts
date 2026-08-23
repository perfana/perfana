import type { Job } from 'bullmq';
import type Redis from 'ioredis';
import { getLogger, logPipelineStart, logPipelineSuccess as _logPipelineSuccess, logPipelineError } from '../lib/utils/logger.js';
import { AnalyzeTestJobSchema, type AnalyzeTestJob, type JobResult } from '../types/jobs.js';
import { PipelineOrchestrator, type OrchestratedStage } from '../services/PipelineOrchestrator.js';
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
    let redis: Redis | null = null;
    let lockService: JobLockService | null = null;
    let progressReporter: ProgressReporter | null = null;
    let lockAcquired = false;
    let stopLockRenewal: (() => void) | null = null;
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

      // The lock TTL (5 min) is far shorter than this pipeline runs; renew it until
      // we release, or a second job for the same scope starts mid-run.
      stopLockRenewal = lockService.startLockRenewal(
        testRunInfo.systemUnderTestId,
        testRunInfo.testEnvironment,
        testRunInfo.workload,
        job.id!,
        testRunId,
        'analyze' as JobType
      );

      // Stages the orchestrator knows how to run. Typed as OrchestratedStage[] so a name with no
      // case in PipelineOrchestrator.executeStage is a compile error rather than a run that
      // reports 'partial' — which is exactly how data-sanity-check hid here.
      const orchestratedStages: OrchestratedStage[] = [
        'dynatrace-collection',       // External data collection (DQL metrics)
        'panels-processing',          // Panel document creation
        'performance-test-metrics',   // Performance test metrics extraction (raw test data)
        'transaction-stats-rollup',   // Per-test-run transaction/sampler stats rollup (#150, #151)
        'metrics-collection',         // CORE metrics from Grafana
        'statistics-calculation',     // Statistical aggregations
        'checks-evaluation',          // Performance evaluation (prerequisite for control groups)
        'control-groups-creation',    // Control groups creation (after checks)
        'control-group-statistics',   // Control group statistics calculation
        ...(adapt ? (['adapt-analysis'] as const) : []),  // ADAPT (if enabled)
      ];

      // What the UI shows. data-sanity-check belongs here but NOT above: it runs after the
      // orchestrator returns (see below), and the orchestrator has no case for it. Passing it
      // as an execution stage made every run report "Unknown stage: data-sanity-check" and
      // finish as 'partial' even when all ten real stages succeeded.
      const stages: string[] = [
        ...orchestratedStages,
        'data-sanity-check',          // Data sanity validation, run below
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
          stages: orchestratedStages,
          errorHandling: 'abort', // Stop pipeline if a critical stage fails
          timeoutMs: 600000, // 10 minute total timeout
          // We run the sanity check after this returns, so we publish the terminal progress
          // event ourselves once that is done. Otherwise job:completed lands first and the web
          // client discards the sanity stage entirely — it renders "Stage 10 of 11 / 91%" as the
          // final frame, and the late publish also resets the progress key's post-mortem TTL
          // from an hour back to five minutes.
          finalizeProgress: false,
        },
        progressReporter // Pass progress reporter for real-time updates
      );

      // Data sanity check — runs after the main pipeline, never fails the job. The try/catch is
      // what makes that true: without it a throw here lands in the outer catch and reports
      // 'failed' for a run whose every real stage succeeded. DataSanityCheckPipeline currently
      // swallows its own errors, but that is its invariant, not ours.
      let dataSanity: { valid?: boolean; reasons?: string[] } | undefined;
      try {
        await progressReporter?.startStage('data-sanity-check');
        const sanityPipeline = new DataSanityCheckPipeline(logger);
        const sanityResult = await sanityPipeline.execute({ testRunId });
        dataSanity = sanityResult?.data as { valid?: boolean; reasons?: string[] } | undefined;
        await progressReporter?.completeStage();
      } catch (sanityError) {
        const msg = sanityError instanceof Error ? sanityError.message : String(sanityError);
        logger.warn(`Data sanity check failed for ${testRunId}, analysis result stands: ${msg}`);
      }

      // The pipeline may have just marked this run invalid ("no metrics data collected"). Say so
      // in the result rather than returning an unqualified green: the JobResult is all a CI
      // caller sees, and the sanity verdict used to be invisible there.
      if (dataSanity?.valid === false) {
        logger.warn(
          `Data sanity check marked ${testRunId} invalid: ${(dataSanity.reasons ?? []).join('; ') || 'no reason given'}`,
        );
      }

      // Terminal progress event, after every stage the UI lists has been reported.
      if (result.success) {
        await progressReporter?.complete();
      } else {
        await progressReporter?.fail(`Analysis completed with failures for ${testRunId}`);
      }

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
          dataSanity,
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
      // Stop the heartbeat before releasing, so a renewal cannot resurrect the TTL
      // of a lock we just handed back.
      stopLockRenewal?.();

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

