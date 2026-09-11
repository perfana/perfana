/**
 * Simplified Orchestrate Reevaluate Batch Worker
 *
 * Uses the new simplified queue system (perfana-analyze, perfana-batch)
 * NO priority, NO rate limiting, BRPOPLPUSH blocking mode
 */

import { Queue, QueueEvents } from 'bullmq';
import type { Job as BullJob } from 'bullmq';
import IORedis from 'ioredis';
import type Redis from 'ioredis';
import { getLogger } from '../lib/utils/logger.js';
import { OrchestrateReevaluateBatchJobSchema, type JobResult, type GapFillAction, type TestRunGapAnalysis, JOB_NAMES } from '../types/jobs.js';
import { SIMPLE_QUEUES, getJobOptions } from '../config/simple-queues.js';
import { getConfig } from '../config/environment.js';
import { getDatabaseService } from '../common/database-accessor.js';
import { getRedisPool } from '../config/redis-pool.js';
import { JobLockService } from '../services/JobLockService.js';
import { ProgressReporter } from '../services/ProgressReporter.js';
import { HEAVY_STAGE_MAX_WAIT_MS } from '../services/HeavyStageMutex.js';
import { MetricCollectionGapService } from '../services/MetricCollectionGapService.js';
import { IncrementalMetricsPipeline } from '../pipelines/IncrementalMetricsPipeline.js';
import { DynatracePipeline } from '../pipelines/DynatracePipeline.js';
import { PanelsPipeline } from '../pipelines/PanelsPipeline.js';
import { DataSanityCheckPipeline } from '../pipelines/DataSanityCheckPipeline.js';
import { JobType } from '@perfana/shared/types';
import { chunkTestRunIds, REEVALUATE_CHUNK_SIZE } from '../lib/utils/chunking.js';

const logger = getLogger('simple-orchestrate-reevaluate-batch');

/**
 * Maximum time (ms) a child job may spend RUNNING before we give up on it (30 minutes).
 *
 * Time the child spends parked does not count: in BullMQ's waiting list behind two
 * analyze-test jobs, or active but queued behind the HeavyStageMutex (its progress is
 * `{ queuedBehind }`, set by the registry). Counting that time turned a busy database
 * into a failed re-evaluate. Parked time has its own, longer ceiling below.
 *
 * 30 min, not the 10 it was: that budget was sized against one 540 s aggregation, when
 * `decompressChunksForRange` inside the statistics job was a silent no-op. Since
 * migration 1804 it is real — up to 540 s PER compressed chunk the batch's runs touch,
 * a legacy 7-day chunk being ~10 GB of row store — then the ramp-up UPDATE, then the
 * aggregation. Each of those steps is bounded by its own statement_timeout; this only
 * has to be their sum, or the parent gives up on a child that is working correctly and
 * (an active child cannot be removed) leaves it running unobserved.
 */
const JOB_WAIT_TIMEOUT_MS = 30 * 60_000;
/** Same policy as the mutex's own give-up, and must not be shorter (see HEAVY_STAGE_MAX_WAIT_MS). */
const JOB_PARKED_CEILING_MS = HEAVY_STAGE_MAX_WAIT_MS;
/** How often waitForJobs re-reads the child's state to decide whose clock is running. */
const JOB_WAIT_POLL_MS = 10_000;

const FREE_WORKER = 'a free analysis worker';

const RETRY_BACKOFF = 'its retry backoff';

/**
 * What a child is doing right now: parked behind a holder (string), running (null), or
 * already finished (`completed` / `failed`) — the last so a QueueEvents reconnect that
 * dropped the completion event does not charge a finished child to the running clock.
 */
async function parkedBehind(queue: Queue, jobId: string): Promise<string | null | 'completed' | 'failed'> {
  const job = await queue.getJob(jobId);
  if (!job) {return null;} // gone; let the running clock decide
  const state = await job.getState();
  if (state === 'completed' || state === 'failed') {return state;}
  if (state === 'delayed') {return RETRY_BACKOFF;}
  if (state === 'waiting' || state === 'prioritized' || state === 'waiting-children') {
    return FREE_WORKER;
  }
  const progress = job.progress as { queuedBehind?: string } | number | undefined;
  return typeof progress === 'object' && progress?.queuedBehind ? `job ${progress.queuedBehind}` : null;
}

/**
 * Enqueue StatisticsPipeline for `testRunIds`, chunked and sequential, waiting on each.
 *
 * Chunked for a different ceiling than ADAPT: `refreshRampUpFlags` issues one UPDATE per
 * run but they all share a single transaction's
 * `max_tuples_decompressed_per_dml_transaction` budget, and an analysis-window edit
 * invalidates every run's ramp_up flags at once — the documented recipe for
 * `tuple decompression limit exceeded`.
 *
 * Shared by all three call sites (force refetch, gap fill, analysis-window recalculation)
 * so the chunking cannot drift between them.
 */
async function runStatisticsChunks(
  analyzeQueue: Queue,
  analyzeEvents: QueueEvents,
  testRunIds: string[],
  progressReporter: ProgressReporter | null,
): Promise<void> {
  const chunks = chunkTestRunIds(testRunIds);
  if (chunks.length > 1) {
    logger.info(
      `Statistics recalculation split into ${chunks.length} chunks of up to ` +
        `${REEVALUATE_CHUNK_SIZE} run(s) to stay inside one transaction's decompression budget`
    );
  }

  let done = 0;
  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c]!;
    const statsJob = await analyzeQueue.add(
      JOB_NAMES.STATISTICS_PIPELINE,
      { testRunIds: chunk },
      getJobOptions(JOB_NAMES.STATISTICS_PIPELINE)
    );

    logger.info(`Waiting for statistics job ${statsJob.id} (chunk ${c + 1}/${chunks.length})...`);
    await waitForJobs(analyzeEvents, [statsJob.id!], JOB_WAIT_TIMEOUT_MS, analyzeQueue, progressReporter);
    // Report RUNS done, not chunks: the UI renders this as "run X of N", and the chunk
    // size is an internal budget detail nobody watching a progress bar cares about.
    done += chunk.length;
    await progressReporter?.updateStageProgress(
      Math.round((done / testRunIds.length) * 100),
      { testRunId: chunk[chunk.length - 1]!, index: done, total: testRunIds.length }
    );
  }
}


/**
 * Throw when a soft-failing child pipeline reported failure (#552).
 *
 * Pipelines registered with `softFail` return `{ status: 'failed' }` instead of
 * throwing, so BullMQ marks the job completed. Without this check the orchestrator
 * logs a green tick and walks into the next stage on empty data.
 */
export function assertStageSucceeded(stage: string, returnValue: unknown): void {
  const result = returnValue as { status?: string; errors?: { message?: string }[] } | undefined;
  if (result?.status === 'failed') {
    throw new Error(`${stage} failed: ${result.errors?.[0]?.message ?? 'unknown error'}`);
  }
}

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
export async function waitForJobs(
  queueEvents: QueueEvents,
  jobIds: string[],
  timeoutMs: number = JOB_WAIT_TIMEOUT_MS,
  queue?: Queue,
  progressReporter?: ProgressReporter | null
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
        teardown();

        if (failedJobs.size > 0) {
          reject(new Error(`${failedJobs.size} jobs failed: ${Array.from(failedJobs).join(', ')}`));
        } else {
          resolve();
        }
      }
    };

    // Two clocks: running time (timeoutMs) and parked time (JOB_PARKED_CEILING_MS). Each
    // poll charges the elapsed slice to whichever applies to the pending children now.
    let runningMs = 0;
    let parkedMs = 0;
    let lastTick = Date.now();
    let parkedBehindHolder: string | null = null;
    // Shared exit path: stop listening, stop the clock, clear a lingering "Queued" record.
    const teardown = () => {
      resolved = true;
      queueEvents.off('completed', onCompleted);
      queueEvents.off('failed', onFailed);
      clearInterval(clock);
      if (parkedBehindHolder) {void progressReporter?.setWaiting(null);}
    };

    const abort = (why: string) => {
      if (!resolved) {
        teardown();

        // Give up waiting AND stop the work. Timing out only abandoned the wait, leaving
        // the child job running unobserved — which was survivable while the orchestrator
        // returned a failure BullMQ recorded as completed and never retried. Now that it
        // throws, BullMQ retries and re-enqueues the SAME stage for the same ids while the
        // orphan is still running. For the unchunked stages (checks-evaluation,
        // control-groups-creation) that overlap is total, and ChecksPipeline writes per run
        // in its own transactions, so two concurrent passes can interleave or deadlock.
        //
        // Best-effort: a job that already moved on cannot be removed, and that is fine —
        // the point is not to leave a duplicate running.
        const pending = jobIds.filter((id) => !completedJobs.has(id) && !failedJobs.has(id));
        void Promise.all(
          pending.map(async (id) => {
            try {
              await (await queue?.getJob(id))?.remove();
            } catch (removeError) {
              logger.warn(`Could not remove orphaned job ${id} after timeout:`, removeError);
            }
          })
        ).finally(() => {
          reject(new Error(`Timeout waiting for jobs (${why}). Completed: ${completedJobs.size}, Failed: ${failedJobs.size}, Total: ${jobIds.length}`));
        });
      }
    };

    let ticking = false;
    const tick = async () => {
      // A Redis stall longer than the poll must not stack overlapping state reads.
      if (resolved || ticking) {return;}
      ticking = true;
      try {
        await tickBody();
      } finally {
        ticking = false;
      }
    };
    const tickBody = async () => {
      const now = Date.now();
      const slice = now - lastTick;
      lastTick = now;

      let holder: string | null = null;
      if (queue) {
        const pending = jobIds.filter((id) => !completedJobs.has(id) && !failedJobs.has(id));
        try {
          const states = await Promise.all(pending.map((id) => parkedBehind(queue, id)));
          // Terminal states the event stream missed: settle them here.
          states.forEach((st, i) => {
            if (st === 'completed') {completedJobs.add(pending[i]!);}
            if (st === 'failed') {failedJobs.add(pending[i]!);}
          });
          if (completedJobs.size + failedJobs.size === jobIds.length) {checkCompletion(); return;}
          const holders = states.filter((st) => st !== 'completed' && st !== 'failed');
          // All pending children parked → nobody's running clock should advance.
          holder = holders.length > 0 && holders.every(Boolean) ? holders[0]! : null;
        } catch (err) {
          logger.warn(`Could not read child job state, charging the running clock: ${err}`);
        }
      }
      // Re-publish on every parked tick, not only on change: the record expires after 5 min
      // and the API evicts the job once it is gone.
      // The awaits above can outlast the child's completed/failed event; a publish now would
      // leave the reporter parked on "Queued" for every later stage.
      if (resolved) {return;}
      if (holder) {
        if (holder !== parkedBehindHolder) {logger.info(`Child job(s) ${jobIds.join(',')} queued behind ${holder}`);}
        await progressReporter?.setWaiting(
          holder === FREE_WORKER
            ? 'Queued: waiting for a free analysis worker before this stage can start'
            : holder === RETRY_BACKOFF
              ? 'Queued: a step failed and is waiting for its retry'
              : 'Queued: waiting for another analysis to finish its database-heavy stage before this stage can start',
        );
      } else if (parkedBehindHolder) {
        await progressReporter?.setWaiting(null);
      }
      parkedBehindHolder = holder;
      if (holder) {parkedMs += slice;} else {runningMs += slice;}

      if (runningMs > timeoutMs) {abort(`ran for ${Math.round(runningMs / 1000)}s`);}
      else if (parkedMs > JOB_PARKED_CEILING_MS) {abort(`stayed queued behind ${holder} for ${Math.round(parkedMs / 1000)}s`);}
    };

    const clock = setInterval(() => void tick(), JOB_WAIT_POLL_MS);

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
    let redis: Redis | null = null;
    let lockService: JobLockService | null = null;
    let progressReporter: ProgressReporter | null = null;
    let lockAcquired = false;
    let stopLockRenewal: (() => void) | null = null;
    // Hoisted so the finally can close them: each constructs its own IORedis, and they
    // were previously closed only where the happy path happened to reach.
    let analyzeQueueRef: Queue | null = null;
    let analyzeEventsRef: QueueEvents | null = null;
    let testRunInfo: { testRunId: string; systemUnderTestId: string; testEnvironment: string; workload: string } | null = null;

    try {
      logger.info(`🚀 Orchestrate-reevaluate-batch job started (ID: ${job.id})`);

      const validatedData = OrchestrateReevaluateBatchJobSchema.parse(job.data);
      const { testRunIds, batchId, checks, adapt, refreshMode, sources, recalculateStatistics, applicationDashboardId, panelId, metricName } = validatedData;

      logger.info(`Processing batch ${batchId} with ${testRunIds.length} test runs`);
      logger.info(`Config: checks=${checks}, adapt=${adapt}, refreshMode=${refreshMode || 'reevaluate'}, recalculateStatistics=${recalculateStatistics ?? false}`);
      // Zod strips unknown keys, so a worker predating this field drops it silently and the
      // user's analysis-window edit has no effect with nothing logged. Printing it means a
      // rolling-deploy skew shows up as `recalculateStatistics=false` on a job the API sent
      // with true, instead of as an unexplained no-op.
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

        // THROW, do not return. simple-workers.ts does `return await processor(job)`, so a
        // returned {status:'failed'} RESOLVES the promise and BullMQ records the job as
        // completed — `attempts` never fires and nothing surfaces the refusal.
        //
        // That is not a rare path. `analyze.ts` takes this same sut:env:workload lock after
        // every run of the workload finishes, so a bulk analysis-window edit landing in that
        // window is refused routinely. Resolving here left test_runs.ramp_up written while
        // ds_metric_statistics was never recalculated and ADAPT never re-ran — permanently,
        // with a green job and a UI reporting success. Throwing lets BullMQ retry (attempts:
        // it), which is usually enough for the blocking job to finish. Note the retry policy
        // that applies is the one reevaluateBatch sets when it enqueues
        // (bullmq-client.service.ts: attempts 2, fixed 10s), NOT the queue-level default in
        // simple-queues.ts — a reader chasing this will find the wrong one first.
        const blockedError = new Error(
          `Job blocked: ${lockResult.blockingInfo?.reason || 'Another job is processing this scope'}` +
            ` (blocking job ${lockResult.blockingInfo?.existingJobId ?? 'unknown'})`
        );
        (blockedError as Error & { blocked?: boolean }).blocked = true;
        throw blockedError;
      }

      lockAcquired = true;
      logger.info(`🔒 Lock acquired for job ${job.id}`, {
        testRunId: testRunInfo.testRunId,
        scope: `${testRunInfo.systemUnderTestId}:${testRunInfo.testEnvironment}:${testRunInfo.workload}`,
      });

      // The lock TTL (5 min) is far shorter than this pipeline runs; renew it until
      // we release, or a second job for the same scope starts mid-run.
      stopLockRenewal = lockService.startLockRenewal(
        testRunInfo.systemUnderTestId,
        testRunInfo.testEnvironment,
        testRunInfo.workload,
        job.id!,
        testRunInfo.testRunId,
        'reevaluate' as JobType
      );

      // Define stages for progress tracking
      const stages: string[] = [];
      if (refreshMode === 'missing-data') {
        stages.push('gap-analysis');
        stages.push('gap-filling');
        stages.push('statistics-recalculation');
      } else if (refreshMode === 'force') {
        stages.push('force-refetch');
        stages.push('statistics-recalculation');
      } else if (recalculateStatistics) {
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
        job as unknown as BullJob,
        testRunInfo,
        'reevaluate' as JobType,
        stages
      );

      const results: Record<string, unknown> = {};
      const stageTiming: Array<{ stage: string; duration: number }> = [];

      // Create queues (all jobs go to perfana-analyze queue)
      const analyzeQueue = createSimpleQueue(SIMPLE_QUEUES.ANALYZE);
      const analyzeEvents = createQueueEvents(SIMPLE_QUEUES.ANALYZE);
      analyzeQueueRef = analyzeQueue;
      analyzeEventsRef = analyzeEvents;

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
            let sourcesToRefetch: Array<{ source_type: string; source_id?: string }> = statuses.filter(s => enabledSourceTypes.has(s.source_type));

            // Force mode: discover sources that have no collection status yet
            // This handles cases where Dynatrace/Grafana configs were added after initial collection
            if (sourcesToRefetch.length === 0 || !sourcesToRefetch.some(s => enabledSourceTypes.has(s.source_type))) {
              const testRunFull = await db.testRunRepo.findOne({
                where: { testRunId },
                select: ['testRunId', 'systemUnderTestId', 'testEnvironment', 'workload'],
              });

              if (testRunFull) {
                const discoveredSources: Array<{ source_type: string; source_id?: string; is_complete: boolean; collected_ranges: unknown[] }> = [];

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
                  sourcesToRefetch = [...sourcesToRefetch, ...discoveredSources];
                }
              }
            }

            if (sourcesToRefetch.length === 0) {
              logger.info(`  ${testRunId}: no collection statuses or discoverable sources for selected types, skipping`);
              continue;
            }

            logger.info(`  ${testRunId}: force re-fetching ${sourcesToRefetch.length} sources over [${fromTime.toISOString()} - ${toTime.toISOString()}]`);

            // What actually has rows for this run, and what is about to be re-collected.
            // `getRunMetricsSourceTypes` reports a NULL metrics_source_id as 'unknown'.
            const presentSourceTypes = await db.getRunMetricsSourceTypes(testRunId);
            const refetchedSourceTypes = sourcesToRefetch.map((sr) => sr.source_type);

            // `test_run_id` is ds_metrics' compress_segmentby column, so a DELETE filtered on
            // it ALONE is segment-targeted and needs no decompression at all. Adding one
            // non-segmentby predicate — `metrics_source_id IN (...)`, which is what the delete
            // here used to carry — defeats that and forces TimescaleDB to decompress the run's
            // segments as DML. Measured on one 2,453,285-row run in a compressed chunk (#563):
            //
            //   decompress_chunk + filtered delete   162,743 ms    11 GB WAL
            //   filtered delete alone                 54,233 ms  4,023 MB WAL, then ERROR
            //                                                    (tuple decompression limit)
            //   DELETE WHERE test_run_id = $1            181 ms     41 MB WAL
            //
            // deletePerfTestMetricsForRun takes the third form and preserves the non-perf-test
            // rows around it, so no decompression is needed here at all. It runs only when
            // perf-test is actually being re-collected, matching the delete it replaces.
            if (refetchedSourceTypes.includes('performance_test')) {
              const deleteStart = Date.now();
              const { deleted, restored } = await db.deletePerfTestMetricsForRun(
                testRunId,
                presentSourceTypes
              );
              logger.info(
                `    🧹 Deleted ${deleted} performance_test ds_metrics for ${testRunId} ` +
                  `(segment-targeted, no decompression` +
                  `${restored > 0 ? `, ${restored} row(s) from other sources preserved` : ''}) ` +
                  `in ${Date.now() - deleteStart}ms`
              );
            } else {
              // No delete ran, so the run's segments are still compressed — and the Grafana
              // and Dynatrace re-collection below is an `INSERT ... ON CONFLICT DO UPDATE`
              // (metric-processor.ts, DynatracePipeline.ts), which decompresses the matching
              // segments as DML and can hit max_tuples_decompressed_per_dml_transaction.
              // The delete branch does not need this: it leaves the run's rows in row store.
              await db.decompressChunksForRange('ds_metrics', fromTime, toTime);
            }

            // Refresh panel documents BEFORE metric collection so newly-added dashboards
            // (e.g. a dashboard linked to a SUT after the original collection ran) are included
            const panelsPipeline = new PanelsPipeline(logger);
            const panelsResult = await panelsPipeline.execute({ testRunId });
            if (panelsResult.success) {
              logger.info(`    Panels refreshed for ${testRunId}`);
            } else {
              logger.warn(`    Panels refresh failed for ${testRunId}: ${panelsResult.error?.message ?? 'unknown error'}`);
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

                if (status.source_type === 'dynatrace') {
                  // Use the full DynatracePipeline — same as the analyze worker's dynatrace-collection stage
                  const dynatracePipeline = new DynatracePipeline(logger);
                  const result = await dynatracePipeline.execute({ testRunIds: [testRunId] });
                  const dtData = result.data as Record<string, unknown>;
                  dataPoints = (dtData?.totalMetrics ?? dtData?.totalDataPoints ?? dtData?.metricsCollected ?? 0) as number;
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
                  dataPoints = ((result.data as Record<string, unknown>)?.totalDataPoints as number) || 0;
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

          await progressReporter?.updateStageProgress(
            Math.round(((i + 1) / testRunIds.length) * 100),
            { testRunId, index: i + 1, total: testRunIds.length }
          );
        }

        const forceRefetchDuration = Date.now() - forceRefetchStart;
        stageTiming.push({ stage: 'force-refetch', duration: forceRefetchDuration });
        await progressReporter?.completeStage();
        logger.info(`✅ Force re-fetch completed: ${testRunsWithNewData}/${testRunIds.length} test runs received new data in ${forceRefetchDuration}ms`);

        // Statistics recalculation (always run after force re-fetch)
        const statsStart = Date.now();
        logger.info('🔷 STAGE: Statistics recalculation');
        await progressReporter?.startStage('statistics-recalculation');

        // `|| recalculateStatistics`: the caller may be asking for a recalculation
        // because the ANALYSIS WINDOW moved, which no fetch can detect. Without this
        // arm, refreshMode + recalculateStatistics ran no statistics at all while the
        // stage list still advertised the stage and the progress reporter marked it
        // complete — a silent no-op on the one input the user actually changed.
        if (testRunsWithNewData > 0 || recalculateStatistics) {
          await runStatisticsChunks(analyzeQueue, analyzeEvents, testRunIds, progressReporter);
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
        const testRunGaps = new Map<string, { gaps: unknown[]; coverageBefore: number }>();

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
          await progressReporter?.updateStageProgress(
            Math.round(((i + 1) / testRunIds.length) * 100),
            { testRunId, index: i + 1, total: testRunIds.length }
          );
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
            gapInfo.gaps = gapInfo.gaps.filter((g: unknown) => enabledSourceTypes.has((g as { sourceType: string }).sourceType));
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
              const g = gap as { sourceType: string; sourceId?: string; missingRanges: Array<{ from: Date | string; to: Date | string }>; failedRanges: Array<{ from: Date | string; to: Date | string }> };
              const allRanges = [
                ...g.missingRanges.map((r) => ({ from: r.from, to: r.to, type: 'missing' as const })),
                ...g.failedRanges.map((r) => ({ from: r.from, to: r.to, type: 'retry' as const })),
              ];

              for (const range of allRanges) {
                const fromDate = range.from instanceof Date ? range.from : new Date(range.from);
                const toDate = range.to instanceof Date ? range.to : new Date(range.to);

                // Same reason as the force branch above: the gap fill is an
                // `INSERT ... ON CONFLICT DO UPDATE` (metric-processor.ts), which decompresses
                // the matching segments as DML on a compressed chunk and trips
                // max_tuples_decompressed_per_dml_transaction. With compress_after at 2 days
                // (migration 1805) that is any gap on a run more than ~3 days old.
                await db.decompressChunksForRange('ds_metrics', fromDate, toDate);

                try {
                  const result = await incrementalPipeline.execute({
                    testRunId,
                    fromTime: fromDate,
                    toTime: toDate,
                    collectGrafanaMetrics: g.sourceType === 'grafana',
                    collectDynatraceMetrics: g.sourceType === 'dynatrace',
                    collectPerformanceTestMetrics: g.sourceType === 'performance_test',
                    ...(g.sourceType === 'grafana' && g.sourceId ? { grafanaInstanceId: g.sourceId } : {}),
                    ...(g.sourceType === 'dynatrace' && g.sourceId ? { dynatraceConfigId: g.sourceId } : {}),
                  });

                  const dataPoints = ((result.data as Record<string, unknown>)?.totalDataPoints as number) || 0;
                  if (dataPoints > 0) { testRunReceivedData = true; }

                  actions.push({
                    sourceType: g.sourceType,
                    sourceId: g.sourceId ?? null,
                    rangeFrom: fromDate.toISOString(),
                    rangeTo: toDate.toISOString(),
                    status: dataPoints > 0 ? 'collected' : 'no-data',
                    dataPoints,
                  });
                } catch (err) {
                  const errorMsg = err instanceof Error ? err.message : String(err);
                  logger.error(`  ❌ Gap fill failed for ${g.sourceType}/${g.sourceId ?? 'null'}: ${errorMsg}`);
                  actions.push({
                    sourceType: g.sourceType,
                    sourceId: g.sourceId ?? null,
                    rangeFrom: fromDate.toISOString(),
                    rangeTo: toDate.toISOString(),
                    status: 'failed',
                    dataPoints: 0,
                    error: errorMsg,
                  });
                }
              }

              // Mark source complete if all ranges succeeded
              const sourceActions = actions.filter(a => a.sourceType === g.sourceType && a.sourceId === g.sourceId);
              const allSucceeded = sourceActions.every(a => a.status !== 'failed');
              if (allSucceeded) {
                try {
                  await gapService.markSourceComplete(testRunId, g.sourceType, g.sourceId ?? null);
                } catch (markErr) {
                  logger.warn(`Non-fatal: failed to mark source complete for ${testRunId} ${g.sourceType}/${g.sourceId ?? 'null'}: ${markErr}`);
                }
              }

              processedGaps++;
              await progressReporter?.updateStageProgress(
                Math.round((processedGaps / totalGaps) * 100),
                // Gap-based percentage, run-based label: a run can hold several gaps,
                // so the two do not advance together.
                { testRunId, index: testRunIds.indexOf(testRunId) + 1, total: testRunIds.length }
              );
            }

            if (testRunReceivedData) { testRunsWithNewData++; }

            const coverageAfter = await gapService.calculateCoverage(testRunId).catch((err) => {
              logger.warn(`Non-fatal: failed to calculate coverage after gap fill for ${testRunId}: ${err}`);
              return 0;
            });
            gapAnalysisDetails.push({
              testRunId,
              sourcesAnalyzed: gapInfo.gaps.length,
              gapsFound: gapInfo.gaps.reduce((sum: number, gi: unknown) => {
                const g = gi as { missingRanges: unknown[]; failedRanges: unknown[] };
                return sum + g.missingRanges.length + g.failedRanges.length;
              }, 0),
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

        // `|| recalculateStatistics`: the caller may be asking for a recalculation
        // because the ANALYSIS WINDOW moved, which no fetch can detect. Without this
        // arm, refreshMode + recalculateStatistics ran no statistics at all while the
        // stage list still advertised the stage and the progress reporter marked it
        // complete — a silent no-op on the one input the user actually changed.
        if (testRunsWithNewData > 0 || recalculateStatistics) {
          await runStatisticsChunks(analyzeQueue, analyzeEvents, testRunIds, progressReporter);
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
      } else if (recalculateStatistics) {
        // No data collection, but the analysis window moved: rebake ds_metrics.ramp_up
        // from each run's current offsets and rewrite ds_metric_statistics. Without
        // this, checks and ADAPT below run against the PREVIOUS window's statistics
        // and the edit the user made in the UI has no visible effect.
        //
        // Deliberately not gated on testRunsWithNewData the way the two refreshMode
        // branches are — nothing was fetched here, and there is still work to do.
        const statsStart = Date.now();
        logger.info('🔷 STAGE: Statistics recalculation (analysis window changed, no data collection)');
        await progressReporter?.startStage('statistics-recalculation');

        await runStatisticsChunks(analyzeQueue, analyzeEvents, testRunIds, progressReporter);
        logger.info('✅ Statistics recalculation completed');

        stageTiming.push({ stage: 'statistics-recalculation', duration: Date.now() - statsStart });
        await progressReporter?.completeStage();
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
        await waitForJobs(analyzeEvents, [checksJob.id!], JOB_WAIT_TIMEOUT_MS, analyzeQueue, progressReporter);

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
          await waitForJobs(analyzeEvents, [controlGroupsJob.id!], JOB_WAIT_TIMEOUT_MS, analyzeQueue, progressReporter);
          const controlGroupsDuration = Date.now() - controlGroupsStart;
          logger.info('✅ Control groups completed');
          stageTiming.push({ stage: 'control-groups-creation', duration: controlGroupsDuration });
          await progressReporter?.completeStage();

          // Substage 3b: Control group statistics
          await progressReporter?.startStage('control-group-statistics');
          const controlStatsStart = Date.now();
          // Chunked for the same reason as ADAPT and statistics: this pipeline also does
          // its work for every id in one withAnalyticsTransaction, and the orchestrator
          // waits JOB_WAIT_TIMEOUT_MS (600s) for the whole job against a 540s aggregation
          // budget — only 60s of headroom for a workload-sized list. It additionally
          // re-enters StatisticsPipeline via backfillMissingSketches, so an unchunked list
          // here reintroduces the very decompression-budget problem runStatisticsChunks
          // exists to respect.
          const controlStatsChunks = chunkTestRunIds(testRunIds);
          let controlStatsDone = 0;
          for (const chunk of controlStatsChunks) {
            const controlStatsJob = await analyzeQueue.add(
              JOB_NAMES.CONTROL_GROUP_STATISTICS,
              { testRunIds: chunk },
              getJobOptions(JOB_NAMES.CONTROL_GROUP_STATISTICS)
            );

            logger.info(`Waiting for control group statistics job ${controlStatsJob.id}...`);
            await waitForJobs(analyzeEvents, [controlStatsJob.id!], JOB_WAIT_TIMEOUT_MS, analyzeQueue, progressReporter);

            // control-group-statistics is registered with softFail, so a failed
            // aggregation still completes the BullMQ job. Read the return value or we
            // walk into ADAPT with an empty baseline and blame the baseline (#552).
            assertStageSucceeded(
              'Control group statistics',
              (await analyzeQueue.getJob(controlStatsJob.id!))?.returnvalue
            );

            controlStatsDone += chunk.length;
            await progressReporter?.updateStageProgress(
              Math.round((controlStatsDone / testRunIds.length) * 100),
              { testRunId: chunk[chunk.length - 1]!, index: controlStatsDone, total: testRunIds.length }
            );
          }

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
        // Chunked and SEQUENTIAL. AdaptPipeline puts every id it is handed into one
        // transaction on the 120 s cap, so a workload-wide list is a guaranteed
        // cancellation that rolls back ADAPT for the whole batch — including the run
        // the user actually edited. Sequential rather than parallel because the
        // chunks contend for the same analytics pool and the same compressed chunks.
        //
        // Chunk N's storeTrackedResults reads the ds_adapt_results of runs in other
        // chunks, so an earlier chunk sees its later siblings' pre-refresh rows. That
        // is the same staleness a two-batch re-evaluate has always had, and it is
        // strictly better than the timeout it replaces.
        const adaptChunks = chunkTestRunIds(testRunIds);
        if (adaptChunks.length > 1) {
          logger.info(
            `ADAPT split into ${adaptChunks.length} chunks of up to ${REEVALUATE_CHUNK_SIZE} run(s) ` +
              `to stay inside the 120s ANALYTICS_STATEMENT_TIMEOUT_MS cap`
          );
        }

        let adaptDone = 0;
        for (let c = 0; c < adaptChunks.length; c++) {
          const chunk = adaptChunks[c]!;
          const adaptJob = await analyzeQueue.add(
            JOB_NAMES.ADAPT_PIPELINE,
            {
              testRunIds: chunk,
              updateControlGroup: false,
              updateControlStatistics: false,
              applicationDashboardId,
              panelId,
              metricName
            },
            getJobOptions(JOB_NAMES.ADAPT_PIPELINE)
          );

          logger.info(`Waiting for ADAPT job ${adaptJob.id} (chunk ${c + 1}/${adaptChunks.length})...`);
          await waitForJobs(analyzeEvents, [adaptJob.id!], JOB_WAIT_TIMEOUT_MS, analyzeQueue, progressReporter);
          adaptDone += chunk.length;
          await progressReporter?.updateStageProgress(
            Math.round((adaptDone / testRunIds.length) * 100),
            { testRunId: chunk[chunk.length - 1]!, index: adaptDone, total: testRunIds.length }
          );
        }

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
      for (let i = 0; i < testRunIds.length; i++) {
        const testRunId = testRunIds[i]!;
        // Reported nothing per run before, and it is the slowest per-run stage in
        // the batch — 42s for one run in the 13:09 log — so the UI sat on "80%,
        // data sanity check" with no sign of which run or how many were left.
        await progressReporter?.updateStageProgress(
          Math.round((i / testRunIds.length) * 100),
          { testRunId, index: i + 1, total: testRunIds.length }
        );
        const sanityPipeline = new DataSanityCheckPipeline(logger);
        await sanityPipeline.execute({ testRunId });
      }
      await progressReporter?.completeStage();

      // Queues are closed in the finally, on every path.

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

      // Rethrow rather than returning a 'failed' result: the worker resolves whatever this
      // returns, so returning marked a failed orchestration as a COMPLETED BullMQ job —
      // no retry, no failed-set entry, nothing for an operator to find. With chunking, a
      // mid-chunk failure leaves the earlier chunks' statistics rewritten and the rest on
      // the old window, so a silent success here is a half-applied batch nobody learns about.
      throw error;
    } finally {
      // Put back whatever this process decompressed, ONCE, after every stage is done.
      //
      // Not at the end of the force-refetch stage, and not inside StatisticsPipeline: the
      // statistics stage runs next in this same job and refreshRampUpFlags needs the very
      // same chunks uncompressed. Recompressing between them would make it decompress them a
      // second time — and with REEVALUATE_CHUNK_SIZE splitting a batch into several statistics
      // jobs, once per chunk of runs. On the 153 s-per-decompression this issue measured, that
      // turns a saving into a regression. The `is_compressed` predicate makes the repeated
      // decompress calls free only while nothing recompresses in between.
      //
      // WorkerDatabaseService is a process singleton, so the statistics jobs this orchestrator
      // awaits share its tracking set. A statistics job that lands on another worker process
      // leaves its chunks to the columnstore policy, exactly as before.
      try {
        await getDatabaseService().recompressTouchedChunks();
      } catch (recompressError) {
        logger.error(`Failed to recompress chunks for job ${job.id}:`, recompressError);
      }

      // Stop the heartbeat before releasing, so a renewal cannot resurrect the TTL
      // of a lock we just handed back.
      stopLockRenewal?.();

      // createSimpleQueue / createQueueEvents each construct their own IORedis. They were
      // closed only on the success path, so every failed orchestration leaked two
      // connections — and failures are both more visible and longer-running now that this
      // throws and chunks.
      for (const closeable of [analyzeQueueRef, analyzeEventsRef]) {
        if (!closeable) { continue; }
        try {
          await closeable.close();
        } catch (closeError) {
          logger.error(`Failed to close queue resource for job ${job.id}:`, closeError);
        }
      }

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
