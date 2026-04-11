/**
 * Simplified Orchestrate Reevaluate Batch Worker
 *
 * Uses the new simplified queue system (perfana-analyze, perfana-batch)
 * NO priority, NO rate limiting, BRPOPLPUSH blocking mode
 */

import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { getLogger } from '../lib/utils/logger.js';
import { OrchestrateReevaluateBatchJobSchema, type JobResult, type GapFillAction, type TestRunGapAnalysis, JOB_NAMES } from '../types/jobs.js';
import { SIMPLE_QUEUES, getJobOptions } from '../config/simple-queues.js';
import { getConfig } from '../config/environment.js';
import { getDatabaseService } from '../common/database-accessor.js';
import { getRedisPool } from '../config/redis-pool.js';
import { JobLockService } from '../services/JobLockService.js';
import { ProgressReporter } from '../services/ProgressReporter.js';
import { MetricCollectionGapService } from '../services/MetricCollectionGapService.js';
import { IncrementalMetricsPipeline } from '../pipelines/IncrementalMetricsPipeline.js';
import { DynatracePipeline } from '../pipelines/DynatracePipeline.js';
import { PanelsPipeline } from '../pipelines/PanelsPipeline.js';
import { DataSanityCheckPipeline } from '../pipelines/DataSanityCheckPipeline.js';
import { JobType } from '@perfana/shared/types';

const logger = getLogger('simple-orchestrate-reevaluate-batch');

/** Maximum time (ms) to wait for a child job to complete before timing out (10 minutes) */
const JOB_WAIT_TIMEOUT_MS = 600_000;

/**
 * Create a simple queue instance (NO priority, NO rate limiting)
 */
function createSimpleQueue(queueName: string): Queue {
  const env = getConfig();
  const connection = new IORedis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  return new Queue(queueName, {
    connection,
    prefix: 'bull',
  });
}

/**
 * Create QueueEvents for job completion tracking
 */
function createQueueEvents(queueName: string): QueueEvents {
  const env = getConfig();
  const connection = new IORedis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  return new QueueEvents(queueName, { connection, prefix: 'bull' });
}

/**
 * Wait for multiple jobs to complete
 * Handles race condition where jobs may complete before listeners are set up
 *
 * CRITICAL FIX: Event listeners must be set up BEFORE checking job states
 * to prevent missing events for jobs that complete during the state check.
 */
async function waitForJobs(
  queueEvents: QueueEvents,
  jobIds: string[],
  timeoutMs: number = JOB_WAIT_TIMEOUT_MS,
  queue?: Queue
): Promise<void> {
  // Ensure QueueEvents is connected before we start listening
  await queueEvents.waitUntilReady();

  const completedJobs = new Set<string>();
  const failedJobs = new Set<string>();
  let resolved = false;

  return new Promise((resolve, reject) => {
    const checkCompletion = () => {
      if (resolved) {
        return;
      }
      if (completedJobs.size + failedJobs.size === jobIds.length) {
        resolved = true;
        // Remove listeners to prevent memory leaks
        queueEvents.off('completed', onCompleted);
        queueEvents.off('failed', onFailed);
        clearTimeout(timeoutHandle);

        if (failedJobs.size > 0) {
          reject(new Error(`${failedJobs.size} jobs failed: ${Array.from(failedJobs).join(', ')}`));
        } else {
          resolve();
        }
      }
    };

    const timeoutHandle = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        queueEvents.off('completed', onCompleted);
        queueEvents.off('failed', onFailed);
        reject(new Error(`Timeout waiting for jobs after ${timeoutMs}ms. Completed: ${completedJobs.size}, Failed: ${failedJobs.size}, Total: ${jobIds.length}`));
      }
    }, timeoutMs);

    // Event handlers
    const onCompleted = ({ jobId }: { jobId: string }) => {
      if (jobIds.includes(jobId) && !completedJobs.has(jobId)) {
        logger.info(`Job ${jobId} completed (via event)`);
        completedJobs.add(jobId);
        checkCompletion();
      }
    };

    const onFailed = ({ jobId, failedReason }: { jobId: string; failedReason: string }) => {
      if (jobIds.includes(jobId) && !failedJobs.has(jobId)) {
        logger.error(`Job ${jobId} failed: ${failedReason}`);
        failedJobs.add(jobId);
        checkCompletion();
      }
    };

    // CRITICAL: Set up event listeners FIRST before checking job states
    // This ensures no events are missed during the state check
    queueEvents.on('completed', onCompleted);
    queueEvents.on('failed', onFailed);

    // THEN check if any jobs already completed
    // Any jobs that complete during this check will be caught by the event listeners above
    if (queue) {
      (async () => {
        for (const jobId of jobIds) {
          if (resolved) {
            break; // Stop if already resolved
          }
          try {
            const job = await queue.getJob(jobId);
            if (job) {
              const state = await job.getState();
              if (state === 'completed' && !completedJobs.has(jobId)) {
                logger.info(`Job ${jobId} already completed (checked state)`);
                completedJobs.add(jobId);
                checkCompletion();
              } else if (state === 'failed' && !failedJobs.has(jobId)) {
                logger.error(`Job ${jobId} already failed (checked state)`);
                failedJobs.add(jobId);
                checkCompletion();
              }
            }
          } catch (err) {
            // Ignore errors checking job state - we'll rely on events
            logger.warn(`Could not check state for job ${jobId}: ${err}`);
          }
        }
      })();
    }
  });
}

/**
 * Simplified orchestrate-reevaluate-batch worker
 */
export function simpleOrchestrateReevaluateBatchWorker() {
  logger.info('Creating simple orchestrate-reevaluate-batch worker');

  return async (job: { data: unknown; id?: string }): Promise<JobResult> => {
    const startTime = Date.now();
    let redis: any = null;
    let lockService: JobLockService | null = null;
    let progressReporter: ProgressReporter | null = null;
    let lockAcquired = false;
    let testRunInfo: { testRunId: string; systemUnderTestId: string; testEnvironment: string; workload: string } | null = null;

    try {
      logger.info(`🚀 Orchestrate-reevaluate-batch job started (ID: ${job.id})`);

      const validatedData = OrchestrateReevaluateBatchJobSchema.parse(job.data);
      const { testRunIds, batchId, checks, adapt, refreshMode, sources, applicationDashboardId, panelId, metricName } = validatedData;

      logger.info(`Processing batch ${batchId} with ${testRunIds.length} test runs`);
      logger.info(`Config: checks=${checks}, adapt=${adapt}, refreshMode=${refreshMode || 'reevaluate'}`);
      if (sources) {
        logger.info(`Source filter: grafana=${sources.grafana ?? true}, dynatrace=${sources.dynatrace ?? true}, performanceMetrics=${sources.performanceMetrics ?? true}`);
      }
      if (applicationDashboardId || panelId || metricName) {
        logger.info(`Metric filter: dashboard=${applicationDashboardId}, panel=${panelId}, metric=${metricName}`);
      }

      // Get test run info from the first test run for lock scope
      const db = getDatabaseService();
      const firstTestRun = await db.testRunRepo.findOne({
        where: { testRunId: testRunIds[0] },
        select: ['testRunId', 'systemUnderTestId', 'testEnvironment', 'workload']
      });

      if (!firstTestRun) {
        throw new Error(`Test run not found: ${testRunIds[0]}`);
      }

      testRunInfo = {
        testRunId: firstTestRun.testRunId,
        systemUnderTestId: firstTestRun.systemUnderTestId,
        testEnvironment: firstTestRun.testEnvironment,
        workload: firstTestRun.workload,
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
        testRunInfo.testRunId,
        'reevaluate' as JobType
      );

      if (!lockResult.acquired) {
        logger.warn(`Job ${job.id} blocked by existing job`, {
          testRunId: testRunInfo.testRunId,
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
        testRunId: testRunInfo.testRunId,
        scope: `${testRunInfo.systemUnderTestId}:${testRunInfo.testEnvironment}:${testRunInfo.workload}`,
      });

      // Define stages for progress tracking
      const stages: string[] = [];
      if (refreshMode === 'missing-data') {
        stages.push('gap-analysis');
        stages.push('gap-filling');
        stages.push('statistics-recalculation');
      } else if (refreshMode === 'force') {
        stages.push('force-refetch');
        stages.push('statistics-recalculation');
      }
      if (checks) {
        stages.push('checks-evaluation');
      }
      if (adapt) {
        if (checks) {
          stages.push('control-groups-creation');
          stages.push('control-group-statistics');
        }
        stages.push('adapt-analysis');
      }
      stages.push('data-sanity-check');

      // Initialize progress reporter
      progressReporter = new ProgressReporter(
        redis,
        job as any,
        testRunInfo,
        'reevaluate' as JobType,
        stages
      );

      const results: { [key: string]: any } = {};
      const stageTiming: Array<{ stage: string; duration: number }> = [];

      // Create queues (all jobs go to perfana-analyze queue)
      const analyzeQueue = createSimpleQueue(SIMPLE_QUEUES.ANALYZE);
      const analyzeEvents = createQueueEvents(SIMPLE_QUEUES.ANALYZE);

      // Stage 1: Data collection (when refreshMode === 'missing-data' or 'force')
      if (refreshMode === 'force') {
        // ── Force re-fetch: re-collect ALL metrics for the full test run time range ──
        const incrementalPipeline = new IncrementalMetricsPipeline(logger);
        const gapService = new MetricCollectionGapService(db);
        let testRunsWithNewData = 0;

        // Determine which source types are enabled
        const enabledSourceTypes = new Set<string>();
        if (!sources || sources.grafana !== false) { enabledSourceTypes.add('grafana'); }
        if (!sources || sources.dynatrace !== false) { enabledSourceTypes.add('dynatrace'); }
        if (!sources || sources.performanceMetrics !== false) { enabledSourceTypes.add('performance_test'); }

        const forceRefetchStart = Date.now();
        logger.info('🔷 STAGE 1: Force re-fetch all data');
        logger.info(`  Enabled sources: ${Array.from(enabledSourceTypes).join(', ')}`);
        await progressReporter?.startStage('force-refetch');

        for (let i = 0; i < testRunIds.length; i++) {
          const testRunId = testRunIds[i];
          let testRunReceivedData = false;

          try {
            // Load test run to get start/end time
            const testRun = await db.testRunRepo.findOne({
              where: { testRunId },
              select: ['testRunId', 'startTime', 'endTime'],
            });

            if (!testRun || !testRun.startTime || !testRun.endTime) {
              logger.warn(`  ${testRunId}: missing startTime/endTime, skipping`);
              continue;
            }

            const fromTime = testRun.startTime;
            const toTime = testRun.endTime;

            // Get all existing collection statuses to know which sources exist
            const statuses = await db.getAllCollectionStatuses(testRunId);

            // Filter to selected source types
            let sourcesToRefetch = statuses.filter(s => enabledSourceTypes.has(s.source_type));

            // Force mode: discover sources that have no collection status yet
            // This handles cases where Dynatrace/Grafana configs were added after initial collection
            if (sourcesToRefetch.length === 0 || !sourcesToRefetch.some(s => enabledSourceTypes.has(s.source_type))) {
              const testRunFull = await db.testRunRepo.findOne({
                where: { testRunId },
                select: ['testRunId', 'systemUnderTestId', 'testEnvironment', 'workload'],
              });

              if (testRunFull) {
                const discoveredSources: Array<{ source_type: string; source_id?: string; is_complete: boolean; collected_ranges: any[] }> = [];

                // Discover Grafana instances
                if (enabledSourceTypes.has('grafana') && !sourcesToRefetch.some(s => s.source_type === 'grafana')) {
                  const grafanaInstances = await db.query<{ id: string }>(
                    'SELECT id FROM grafana_instances LIMIT 10'
                  );
                  for (const gi of grafanaInstances) {
                    discoveredSources.push({ source_type: 'grafana', source_id: gi.id, is_complete: false, collected_ranges: [] });
                  }
                }

                // Discover Dynatrace configs that have queries matching this test run
                if (enabledSourceTypes.has('dynatrace') && !sourcesToRefetch.some(s => s.source_type === 'dynatrace')) {
                  const dtConfigs = await db.query<{ id: string }>(
                    `SELECT DISTINCT dq.dynatrace_config_id as id
                     FROM dynatrace_queries dq
                     WHERE dq.system_under_test_id = $1
                       AND dq.test_environment = $2
                       AND dq.workload = $3`,
                    [testRunFull.systemUnderTestId, testRunFull.testEnvironment, testRunFull.workload]
                  );
                  for (const dc of dtConfigs) {
                    discoveredSources.push({ source_type: 'dynatrace', source_id: dc.id, is_complete: false, collected_ranges: [] });
                  }
                }

                // Discover performance test metrics (no source_id needed)
                if (enabledSourceTypes.has('performance_test') && !sourcesToRefetch.some(s => s.source_type === 'performance_test')) {
                  discoveredSources.push({ source_type: 'performance_test', is_complete: false, collected_ranges: [] });
                }

                if (discoveredSources.length > 0) {
                  logger.info(`  ${testRunId}: discovered ${discoveredSources.length} new sources: ${discoveredSources.map(s => `${s.source_type}/${s.source_id ?? 'null'}`).join(', ')}`);
                  sourcesToRefetch = [...sourcesToRefetch, ...discoveredSources] as any;
                }
              }
            }

            if (sourcesToRefetch.length === 0) {
              logger.info(`  ${testRunId}: no collection statuses or discoverable sources for selected types, skipping`);
              continue;
            }

            logger.info(`  ${testRunId}: force re-fetching ${sourcesToRefetch.length} sources over [${fromTime.toISOString()} - ${toTime.toISOString()}]`);

            // Refresh panel documents BEFORE metric collection so newly-added dashboards
            // (e.g. a dashboard linked to a SUT after the original collection ran) are included
            try {
              const panelsPipeline = new PanelsPipeline(logger);
              await panelsPipeline.execute({ testRunId });
              logger.info(`    Panels refreshed for ${testRunId}`);
            } catch (panelsErr) {
              logger.warn(`    Panels refresh failed for ${testRunId}: ${panelsErr instanceof Error ? panelsErr.message : panelsErr}`);
            }

            // Reset collected_ranges and is_complete for selected sources
            for (const status of sourcesToRefetch) {
              await db.resetCollectionStatus(testRunId, status.source_type, status.source_id ?? null);
            }

            // Re-collect each source for the full time range
            // Use full pipelines (not incremental) for force-refetch of completed test runs
            for (const status of sourcesToRefetch) {
              try {
                let dataPoints = 0;

                // Delete old performance_test metrics before re-collection to avoid
                // mixed-resolution data from incremental collection (1s early, 5s later)
                if (status.source_type === 'performance_test') {
                  const deleteResult = await db.dataSource.query(
                    `DELETE FROM ds_metrics WHERE test_run_id = $1 AND metrics_source_id IS NOT NULL
                     AND metrics_source_id IN (SELECT id FROM metrics_sources WHERE source_type = 'performance_test')`,
                    [testRunId]
                  );
                  logger.info(`    🧹 Deleted ${deleteResult?.[1] ?? '?'} old performance_test ds_metrics for ${testRunId}`);
                }

                if (status.source_type === 'dynatrace') {
                  // Use the full DynatracePipeline — same as the analyze worker's dynatrace-collection stage
                  const dynatracePipeline = new DynatracePipeline(logger);
                  const result = await dynatracePipeline.execute({ testRunIds: [testRunId] });
                  dataPoints = (result.data as any)?.totalMetrics ?? (result.data as any)?.totalDataPoints ?? (result.data as any)?.metricsCollected ?? 0;
                } else {
                  // Grafana and performance_test use incremental pipeline with full time range
                  const result = await incrementalPipeline.execute({
                    testRunId,
                    fromTime,
                    toTime,
                    collectGrafanaMetrics: status.source_type === 'grafana',
                    collectDynatraceMetrics: false,
                    collectPerformanceTestMetrics: status.source_type === 'performance_test',
                    ...(status.source_type === 'grafana' && status.source_id ? { grafanaInstanceId: status.source_id } : {}),
                  });
                  dataPoints = (result.data as any)?.totalDataPoints as number || 0;
                }

                logger.info(`    ${status.source_type}/${status.source_id ?? 'null'}: ${dataPoints} data points collected`);
                if (dataPoints > 0) { testRunReceivedData = true; }

                // Mark source complete after successful full-range collection
                try {
                  await gapService.markSourceComplete(testRunId, status.source_type, status.source_id ?? null);
                } catch (markErr) {
                  logger.warn(`Non-fatal: failed to mark source complete for ${testRunId} ${status.source_type}/${status.source_id ?? 'null'}: ${markErr}`);
                }
              } catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                logger.error(`    ❌ Force re-fetch failed for ${status.source_type}/${status.source_id ?? 'null'}: ${errorMsg}`);
              }
            }

            if (testRunReceivedData) { testRunsWithNewData++; }
          } catch (err) {
            logger.error(`  ❌ Force re-fetch failed for ${testRunId}: ${err}`);
          }

          await progressReporter?.updateStageProgress(Math.round(((i + 1) / testRunIds.length) * 100));
        }

        const forceRefetchDuration = Date.now() - forceRefetchStart;
        stageTiming.push({ stage: 'force-refetch', duration: forceRefetchDuration });
        await progressReporter?.completeStage();
        logger.info(`✅ Force re-fetch completed: ${testRunsWithNewData}/${testRunIds.length} test runs received new data in ${forceRefetchDuration}ms`);

        // Statistics recalculation (always run after force re-fetch)
        const statsStart = Date.now();
        logger.info('🔷 STAGE: Statistics recalculation');
        await progressReporter?.startStage('statistics-recalculation');

        if (testRunsWithNewData > 0) {
          const statsJob = await analyzeQueue.add(
            JOB_NAMES.STATISTICS_PIPELINE,
            { testRunIds },
            getJobOptions(JOB_NAMES.STATISTICS_PIPELINE)
          );

          logger.info(`Waiting for statistics job ${statsJob.id}...`);
          await waitForJobs(analyzeEvents, [statsJob.id!], JOB_WAIT_TIMEOUT_MS, analyzeQueue);
          logger.info(`✅ Statistics recalculation completed`);
        } else {
          logger.info('⏭️  Skipping statistics recalculation (no new data collected)');
        }

        const statsDuration = Date.now() - statsStart;
        stageTiming.push({ stage: 'statistics-recalculation', duration: statsDuration });
        await progressReporter?.completeStage();

        results.forceRefetch = {
          testRunsProcessed: testRunIds.length,
          testRunsWithNewData,
          sourcesRefetched: Array.from(enabledSourceTypes),
        };

      } else if (refreshMode === 'missing-data') {
        // ── Gap-based data collection: detect gaps and fill only missing ranges ──
        const gapService = new MetricCollectionGapService(db);
        const incrementalPipeline = new IncrementalMetricsPipeline(logger);
        const gapAnalysisDetails: TestRunGapAnalysis[] = [];
        let testRunsWithNewData = 0;

        // Stage 1a: Gap Analysis
        const gapAnalysisStart = Date.now();
        logger.info('🔷 STAGE 1a: Gap analysis');
        await progressReporter?.startStage('gap-analysis');

        let totalGaps = 0;
        const testRunGaps = new Map<string, { gaps: any[]; coverageBefore: number }>();

        for (let i = 0; i < testRunIds.length; i++) {
          const testRunId = testRunIds[i];
          try {
            const gaps = await gapService.detectGaps(testRunId);
            const coverageBefore = await gapService.calculateCoverage(testRunId);
            testRunGaps.set(testRunId, { gaps, coverageBefore });
            totalGaps += gaps.length;
            logger.info(`  ${testRunId}: ${gaps.length} sources with gaps, ${coverageBefore.toFixed(1)}% coverage`);
          } catch (err) {
            logger.warn(`  ${testRunId}: gap detection failed: ${err}`);
            testRunGaps.set(testRunId, { gaps: [], coverageBefore: 0 });
          }
          await progressReporter?.updateStageProgress(Math.round(((i + 1) / testRunIds.length) * 100));
        }

        const gapAnalysisDuration = Date.now() - gapAnalysisStart;
        stageTiming.push({ stage: 'gap-analysis', duration: gapAnalysisDuration });
        await progressReporter?.completeStage();
        logger.info(`✅ Gap analysis completed: ${totalGaps} sources with gaps across ${testRunIds.length} test runs in ${gapAnalysisDuration}ms`);

        // Filter gaps by selected sources (when sources param is provided)
        if (sources) {
          const enabledSourceTypes = new Set<string>();
          if (sources.grafana !== false) {
            enabledSourceTypes.add('grafana');
          }
          if (sources.dynatrace !== false) {
            enabledSourceTypes.add('dynatrace');
          }
          if (sources.performanceMetrics !== false) {
            enabledSourceTypes.add('performance_test');
          }

          let filteredCount = 0;
          for (const [_trId, gapInfo] of testRunGaps) {
            const before = gapInfo.gaps.length;
            gapInfo.gaps = gapInfo.gaps.filter((g: any) => enabledSourceTypes.has(g.sourceType));
            filteredCount += before - gapInfo.gaps.length;
          }

          if (filteredCount > 0) {
            totalGaps -= filteredCount;
            logger.info(`Filtered out ${filteredCount} sources not in selected set, ${totalGaps} remaining`);
          }
        }

        // Stage 1b: Gap Filling
        const gapFillingStart = Date.now();
        logger.info('🔷 STAGE 1b: Gap filling');
        await progressReporter?.startStage('gap-filling');

        if (totalGaps === 0) {
          logger.info('⏭️  No gaps found — all data complete, skipping gap filling');
        } else {
          let processedGaps = 0;
          for (const testRunId of testRunIds) {
            const gapInfo = testRunGaps.get(testRunId);
            if (!gapInfo || gapInfo.gaps.length === 0) { continue; }

            const actions: GapFillAction[] = [];
            let testRunReceivedData = false;

            for (const gap of gapInfo.gaps) {
              const allRanges = [
                ...gap.missingRanges.map((r: any) => ({ from: r.from, to: r.to, type: 'missing' as const })),
                ...gap.failedRanges.map((r: any) => ({ from: r.from, to: r.to, type: 'retry' as const })),
              ];

              for (const range of allRanges) {
                const fromDate = range.from instanceof Date ? range.from : new Date(range.from);
                const toDate = range.to instanceof Date ? range.to : new Date(range.to);

                try {
                  const result = await incrementalPipeline.execute({
                    testRunId,
                    fromTime: fromDate,
                    toTime: toDate,
                    collectGrafanaMetrics: gap.sourceType === 'grafana',
                    collectDynatraceMetrics: gap.sourceType === 'dynatrace',
                    collectPerformanceTestMetrics: gap.sourceType === 'performance_test',
                    ...(gap.sourceType === 'grafana' && gap.sourceId ? { grafanaInstanceId: gap.sourceId } : {}),
                    ...(gap.sourceType === 'dynatrace' && gap.sourceId ? { dynatraceConfigId: gap.sourceId } : {}),
                  });

                  const dataPoints = (result.data as any)?.totalDataPoints as number || 0;
                  if (dataPoints > 0) { testRunReceivedData = true; }

                  actions.push({
                    sourceType: gap.sourceType,
                    sourceId: gap.sourceId,
                    rangeFrom: fromDate.toISOString(),
                    rangeTo: toDate.toISOString(),
                    status: dataPoints > 0 ? 'collected' : 'no-data',
                    dataPoints,
                  });
                } catch (err) {
                  const errorMsg = err instanceof Error ? err.message : String(err);
                  logger.error(`  ❌ Gap fill failed for ${gap.sourceType}/${gap.sourceId ?? 'null'}: ${errorMsg}`);
                  actions.push({
                    sourceType: gap.sourceType,
                    sourceId: gap.sourceId,
                    rangeFrom: fromDate.toISOString(),
                    rangeTo: toDate.toISOString(),
                    status: 'failed',
                    dataPoints: 0,
                    error: errorMsg,
                  });
                }
              }

              // Mark source complete if all ranges succeeded
              const sourceActions = actions.filter(a => a.sourceType === gap.sourceType && a.sourceId === gap.sourceId);
              const allSucceeded = sourceActions.every(a => a.status !== 'failed');
              if (allSucceeded) {
                try {
                  await gapService.markSourceComplete(testRunId, gap.sourceType, gap.sourceId);
                } catch (markErr) {
                  logger.warn(`Non-fatal: failed to mark source complete for ${testRunId} ${gap.sourceType}/${gap.sourceId ?? 'null'}: ${markErr}`);
                }
              }

              processedGaps++;
              await progressReporter?.updateStageProgress(Math.round((processedGaps / totalGaps) * 100));
            }

            if (testRunReceivedData) { testRunsWithNewData++; }

            const coverageAfter = await gapService.calculateCoverage(testRunId).catch((err) => {
              logger.warn(`Non-fatal: failed to calculate coverage after gap fill for ${testRunId}: ${err}`);
              return 0;
            });
            gapAnalysisDetails.push({
              testRunId,
              sourcesAnalyzed: gapInfo.gaps.length,
              gapsFound: gapInfo.gaps.reduce((sum: number, g: any) => sum + g.missingRanges.length + g.failedRanges.length, 0),
              coverageBefore: gapInfo.coverageBefore,
              coverageAfter,
              actions,
            });
          }
        }

        const gapFillingDuration = Date.now() - gapFillingStart;
        stageTiming.push({ stage: 'gap-filling', duration: gapFillingDuration });
        await progressReporter?.completeStage();
        logger.info(`✅ Gap filling completed: ${testRunsWithNewData} test runs received new data in ${gapFillingDuration}ms`);

        // Stage 1c: Statistics recalculation (only for test runs with new data)
        const statsStart = Date.now();
        logger.info('🔷 STAGE 1c: Statistics recalculation');
        await progressReporter?.startStage('statistics-recalculation');

        if (testRunsWithNewData > 0) {
          const statsJob = await analyzeQueue.add(
            JOB_NAMES.STATISTICS_PIPELINE,
            { testRunIds },
            getJobOptions(JOB_NAMES.STATISTICS_PIPELINE)
          );

          logger.info(`Waiting for statistics job ${statsJob.id}...`);
          await waitForJobs(analyzeEvents, [statsJob.id!], JOB_WAIT_TIMEOUT_MS, analyzeQueue);
          logger.info(`✅ Statistics recalculation completed`);
        } else {
          logger.info('⏭️  Skipping statistics recalculation (no new data collected)');
        }

        const statsDuration = Date.now() - statsStart;
        stageTiming.push({ stage: 'statistics-recalculation', duration: statsDuration });
        await progressReporter?.completeStage();

        results.gapAnalysis = {
          testRunsAnalyzed: testRunIds.length,
          testRunsWithGaps: gapAnalysisDetails.filter(d => d.gapsFound > 0).length,
          testRunsWithNewData,
          details: gapAnalysisDetails,
        };
      } else {
        logger.info('⏭️  Skipping data collection (reevaluate mode)');
      }

      // Stage 2: Checks Evaluation (if enabled)
      if (checks) {
        const stage2Start = Date.now();
        logger.info('🔷 STAGE 2: Checks evaluation');
        await progressReporter?.startStage('checks-evaluation');

        const checksJob = await analyzeQueue.add(
          JOB_NAMES.CHECKS_EVALUATION,
          {
            testRunIds,
            batchId,
            applicationDashboardId,
            panelId,
            metricName
          },
          getJobOptions(JOB_NAMES.CHECKS_EVALUATION)
        );

        logger.info(`Waiting for checks job ${checksJob.id}...`);
        await waitForJobs(analyzeEvents, [checksJob.id!], JOB_WAIT_TIMEOUT_MS, analyzeQueue);

        const stage2Duration = Date.now() - stage2Start;
        logger.info(`✅ Checks evaluation completed`);
        stageTiming.push({ stage: 'checks-evaluation', duration: stage2Duration });
        await progressReporter?.completeStage();

        results.checks = { status: 'completed', testRunIds };
      } else {
        logger.info('⏭️  Skipping checks evaluation (checks=false)');
      }

      // Stage 3: ADAPT Analysis (if enabled)
      if (adapt) {
        const _stage3Start = Date.now();
        logger.info('🔷 STAGE 3: ADAPT analysis');

        // Control groups are only needed when checks are enabled
        // When checks=false, skip control group creation and statistics
        if (checks) {
          // Substage 3a: Control groups creation
          await progressReporter?.startStage('control-groups-creation');
          const controlGroupsStart = Date.now();
          const controlGroupsJob = await analyzeQueue.add(
            JOB_NAMES.CONTROL_GROUPS_PIPELINE,
            { testRunIds },
            getJobOptions(JOB_NAMES.CONTROL_GROUPS_PIPELINE)
          );

          logger.info(`Waiting for control groups job ${controlGroupsJob.id}...`);
          await waitForJobs(analyzeEvents, [controlGroupsJob.id!], JOB_WAIT_TIMEOUT_MS, analyzeQueue);
          const controlGroupsDuration = Date.now() - controlGroupsStart;
          logger.info('✅ Control groups completed');
          stageTiming.push({ stage: 'control-groups-creation', duration: controlGroupsDuration });
          await progressReporter?.completeStage();

          // Substage 3b: Control group statistics
          await progressReporter?.startStage('control-group-statistics');
          const controlStatsStart = Date.now();
          const controlStatsJob = await analyzeQueue.add(
            JOB_NAMES.CONTROL_GROUP_STATISTICS,
            { testRunIds },
            getJobOptions(JOB_NAMES.CONTROL_GROUP_STATISTICS)
          );

          logger.info(`Waiting for control group statistics job ${controlStatsJob.id}...`);
          await waitForJobs(analyzeEvents, [controlStatsJob.id!], JOB_WAIT_TIMEOUT_MS, analyzeQueue);
          const controlStatsDuration = Date.now() - controlStatsStart;
          logger.info('✅ Control group statistics completed');
          stageTiming.push({ stage: 'control-group-statistics', duration: controlStatsDuration });
          await progressReporter?.completeStage();
        } else {
          logger.info('⏭️  Skipping control groups (not needed when checks=false)');
        }

        // Substage 3c: ADAPT difference detection
        await progressReporter?.startStage('adapt-analysis');
        const adaptStart = Date.now();
        const adaptJob = await analyzeQueue.add(
          JOB_NAMES.ADAPT_PIPELINE,
          {
            testRunIds,
            updateControlGroup: false,
            updateControlStatistics: false,
            applicationDashboardId,
            panelId,
            metricName
          },
          getJobOptions(JOB_NAMES.ADAPT_PIPELINE)
        );

        logger.info(`Waiting for ADAPT job ${adaptJob.id}...`);
        await waitForJobs(analyzeEvents, [adaptJob.id!], JOB_WAIT_TIMEOUT_MS, analyzeQueue);
        const adaptDuration = Date.now() - adaptStart;
        logger.info(`✅ ADAPT analysis completed`);
        stageTiming.push({ stage: 'adapt-difference-detection', duration: adaptDuration });
        await progressReporter?.completeStage();

        results.adapt = { status: 'completed', testRunIds };
      } else {
        logger.info('⏭️  Skipping ADAPT analysis (adapt=false)');
      }

      // Stage: Data Sanity Check
      await progressReporter?.startStage('data-sanity-check');
      for (const testRunId of testRunIds) {
        const sanityPipeline = new DataSanityCheckPipeline(logger);
        await sanityPipeline.execute({ testRunId });
      }
      await progressReporter?.completeStage();

      // Cleanup queues
      await analyzeEvents.close();
      await analyzeQueue.close();

      // Signal completion
      await progressReporter?.complete();

      const duration = Date.now() - startTime;

      // Log stage timing breakdown
      if (stageTiming.length > 0) {
        const totalDuration = Date.now() - startTime;
        const breakdown = stageTiming.map(({ stage, duration: stageDuration }) => {
          const percentage = ((stageDuration / totalDuration) * 100).toFixed(1);
          const barLength = Math.round((stageDuration / totalDuration) * 40);
          const bar = '█'.repeat(barLength);
          return `✅ ${stage.padEnd(30)} ${stageDuration.toString().padStart(7)}ms ${percentage.padStart(5)}% ${bar}`;
        }).join('\n');

        logger.info(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 STAGE TIMING BREAKDOWN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${breakdown}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 Total Pipeline Duration: ${duration}ms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
      }

      logger.info(`🎉 Orchestration completed in ${duration}ms`);

      return {
        status: 'success',
        message: `Batch ${batchId} processed successfully`,
        data: {
          batchId,
          testRunCount: testRunIds.length,
          duration,
          results,
        },
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Orchestration failed after ${duration}ms:`, error);

      // Report failure to progress tracker
      if (progressReporter) {
        await progressReporter.fail(errorMessage);
      }

      return {
        status: 'failed',
        message: errorMessage,
        errors: [{
          message: errorMessage,
          code: 'ORCHESTRATION_ERROR',
        }],
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
            testRunId: testRunInfo.testRunId,
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
