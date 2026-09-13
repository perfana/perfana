/**
 * Performance Test Metrics Pipeline (REFACTORED)
 *
 * NEW ARCHITECTURE:
 * - One dashboard per scenario (deterministic UUIDs)
 * - One panel per transaction within each dashboard (hash-based panel IDs)
 * - Special "scenario-level" panel for scenario-wide metrics
 * - Simplified metric names (scenario/transaction names removed from metric_name)
 *
 * Extracts aggregated metrics from performance test tables (requests_raw, transactions,
 * requests_error, virtual_users) and stores them as time-series data in ds_metrics format.
 *
 * Key Features:
 * - Time-series bucketing with dynamic bucket sizes based on test duration
 * - Calculates Apdex scores based on configured thresholds
 * - Creates ds_metrics records with scenario-specific dashboard IDs
 * - Auto-creates ds_compare_config records with proper classifications
 *
 * Note: Ramp-up filtering is handled upstream in the data ingestion pipeline
 */

import { BasePipelineTypeORM } from './BasePipelineTypeORM.js';
import { PipelineResult } from '../types/pipeline.js';
import type { Logger } from 'pino';
import {
  PerformanceTestMetricsInput,
  PerformanceTestMetricsOutput,
  TestRunMetadata,
  ApdexThresholdLookup,
  DsMetricsRecord,
  DsCompareConfigRecord,
} from '../types/performance-metrics.js';
import { DEFAULT_APDEX_THRESHOLD_MS, METRIC_TYPE_PANEL_IDS } from '../constants/performance-metrics.js';
import { alignToBucket, perfTestBucketSizes, PERF_TEST_OVERLAP_SECONDS } from '../utils/time-bucketing.js';
import { acquireRedisConnection, releaseRedisConnection } from '../config/redis-pool.js';
import { JobLockService, perfTestTickLockKey, PERF_TEST_TICK_LOCK_TTL_SECONDS } from '../services/JobLockService.js';
import { DashboardManager } from './helpers/dashboard-manager.js';
import { RequestsProcessor } from './helpers/requests-processor.js';
import { upsertPerfTestStatistics } from './helpers/perf-metrics-writer.js';
import { TransactionsProcessor } from './helpers/transactions-processor.js';
import { ErrorsProcessor, VirtualUsersProcessor } from './helpers/scenario-processors.js';

/** Panels written as one point per run rather than one per bucket. */
const SCENARIO_PANEL_IDS = [
  METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT,
  METRIC_TYPE_PANEL_IDS.SCENARIO_AVG_THREADS,
  METRIC_TYPE_PANEL_IDS.SCENARIO_MAX_THREADS,
];

/** How long a full pass waits for an in-flight tick before proceeding without the lock. */
const TICK_LOCK_WAIT_MS = 3 * 60 * 1000;

/**
 * Performance Test Metrics Pipeline
 */
export class PerformanceTestMetricsPipeline extends BasePipelineTypeORM {
  private dashboardManager!: DashboardManager;
  private requestsProcessor!: RequestsProcessor;
  private transactionsProcessor!: TransactionsProcessor;
  private errorsProcessor!: ErrorsProcessor;
  private virtualUsersProcessor!: VirtualUsersProcessor;

  constructor(logger: Logger) {
    super(logger);
  }

  /**
   * Execute the performance test metrics pipeline
   */
  async execute(input: unknown): Promise<PipelineResult> {
    const startTime = Date.now();

    try {
      const validatedInput = this.validateAndParseInput(input);
      const isIncremental = validatedInput.fromTime !== undefined || validatedInput.toTime !== undefined;
      // A full pass finishes or replaces what the ticks wrote, so it must not overlap one.
      // The worker stops ticks that START after completion; one that started before it can
      // still be running, and landing after this pass would overwrite a finished bucket
      // with its partial one and put an interim scenario point back — permanently, since
      // the pass marks the run final. Hold the tick's own key lock for the duration.
      return isIncremental
        ? await this.collect(validatedInput, startTime)
        : await this.withTickLock(validatedInput.testRunId, () => this.collect(validatedInput, startTime));
    } catch (error) {
      const duration = Date.now() - startTime;
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error({ err: error, stack }, '❌ Performance test metrics collection failed');
      return {
        success: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
          code: 'PIPELINE_ERROR',
          details: stack,
        },
        duration,
      };
    }
  }

  /**
   * Best-effort by contract: the lock keeps a straggling tick from landing after the pass,
   * and proceeding without it is what every full pass did before it existed. So a Redis
   * error, or a holder that outlives any real tick, is logged and the pass runs anyway —
   * failing the only writer of a ticked run's final rows over a lock would be the worse trade.
   */
  private async withTickLock<T>(testRunId: string, fn: () => Promise<T>): Promise<T> {
    const key = perfTestTickLockKey(testRunId);
    const token = `analyze:${testRunId}:${Date.now()}`;
    let redis: Awaited<ReturnType<typeof acquireRedisConnection>> | null = null;
    let locks: JobLockService | null = null;
    let held = false;
    try {
      redis = await acquireRedisConnection();
      locks = new JobLockService(redis);
      const deadline = Date.now() + TICK_LOCK_WAIT_MS;
      while (!(held = await locks.acquireKeyLock(key, token, PERF_TEST_TICK_LOCK_TTL_SECONDS))) {
        if (Date.now() >= deadline) {
          this.logger.warn(`⚠️ Perf-test tick lock for ${testRunId} still held after ${TICK_LOCK_WAIT_MS / 1000}s — proceeding without it`);
          break;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`⚠️ Could not take the perf-test tick lock for ${testRunId} (${msg}) — proceeding without it`);
    }
    try {
      return await fn();
    } finally {
      if (held && locks) {await locks.releaseKeyLock(key, token);}
      if (redis) {releaseRedisConnection(redis);}
    }
  }

  private async collect(validatedInput: PerformanceTestMetricsInput, startTime: number): Promise<PipelineResult> {
    const { testRunId } = validatedInput;
    let { fromTime, toTime } = validatedInput;

    const isIncremental = fromTime !== undefined || toTime !== undefined;
    this.logger.info(
      `🎯 Starting performance test metrics collection for test run: ${testRunId}${isIncremental ? ' (incremental)' : ''}`
    );

    // Initialize processors with dataSource
    this.initializeProcessors();

    // Load test run metadata
    const originalTestRun = await this.loadTestRunMetadata(testRunId);

    // One bucket rule for every writer. A live tick sizes from the planned duration (the
    // run's length is not known yet); a completed run — rebuild, force re-fetch, or the
    // final pass below — from its actual length. See perfTestBucketSizes.
    const { tick, final } = perfTestBucketSizes({
      plannedDuration: originalTestRun.planned_duration,
      startTime: originalTestRun.start_time,
      endTime: originalTestRun.end_time,
      completed: originalTestRun.completed,
    });
    const bucketSizeSeconds = final ?? tick;

    // A full collection on a run the ticks already wrote at this bucket size only has to
    // finish their work: aggregate the tail after the last tick and move the scenario-level
    // points to end_time. The delete-and-rebuild is the fallback, not the rule.
    let finalPass = false;
    // Whether the run has a perf-test collection status row, i.e. was ticked at all.
    let ticked = false;
    if (!isIncremental) {
      const plan = await this.planFullCollection(originalTestRun, tick, final);
      ticked = plan.ticked;
      if (plan.kind === 'skip') {
        this.logger.info(`⏭️ Perf-test metrics for ${testRunId} are already final (${bucketSizeSeconds}s buckets, ticks covered the run)`);
        return this.createSuccessResult(
          { testRunId, metricsCreated: 0, compareConfigsCreated: 0, skipped: 'ticks-final' },
          Date.now() - startTime
        );
      }
      if (plan.kind === 'tail') {
        finalPass = true;
        fromTime = plan.from;
        toTime = originalTestRun.end_time!;
        this.logger.info(`🧵 Finishing the ticks' perf-test metrics for ${testRunId}: tail from ${fromTime.toISOString()}`);
      } else {
        this.logger.info(`🔁 Rebuilding perf-test metrics for ${testRunId}: ${plan.reason}`);
      }
    }
    // Upsert whenever the run already holds rows for the window: a tick, a force re-fetch, the tail.
    const upsert = isIncremental || finalPass;

    // A tick re-aggregates a trailing window of the previous one, aligned down to a
    // bucket boundary: the bucket straddling the tick edge is recomputed from all its
    // samples instead of keeping whichever half landed second, and a requests_raw row
    // that arrives after the tick that covered its timestamp (up to ~36 s observed) is
    // still picked up. On a full-range call (force re-fetch) this clamps to start_time.
    if (fromTime) {
      fromTime = alignToBucket(
        new Date(fromTime.getTime() - PERF_TEST_OVERLAP_SECONDS * 1000),
        originalTestRun.start_time,
        bucketSizeSeconds
      );
    }

    if (finalPass) {
      // The tail upserts into, and deletes from, rows the ticks already wrote — both with
      // predicates below test_run_id, which on a compressed chunk is DML decompression up
      // to `tuple decompression limit exceeded`. A run analysed within compress_after (2
      // days) of completing is row store and this finds nothing; a late first analysis
      // (worker outage, retried job) is what it is for. analyze.ts recompresses in its
      // finally. The rebuild path does not need it: its DELETE drops whole segments.
      // ponytail: the interim DELETE at start_time is outside this span on a run crossing a
      // chunk boundary; `time` is the orderby column so that is a few batches, not a segment.
      await this.db.decompressChunksForRange('ds_metrics', fromTime!, toTime!);
    }

    // For incremental collection, set filter times while keeping original start_time for bucket alignment
    const testRun: TestRunMetadata = {
      ...originalTestRun,
      // Keep original start_time for consistent bucket alignment across increments
      // Use filter times for WHERE clause filtering
      filter_from_time: fromTime,
      filter_to_time: toTime,
    };

    if (fromTime && toTime) {
      this.logger.info(
        `📅 Filter time range: ${fromTime.toISOString()} to ${toTime.toISOString()} (bucket origin: ${originalTestRun.start_time.toISOString()})`
      );
    }

    const effectiveEndTime = toTime ?? testRun.end_time ?? new Date();
    const windowSeconds = Math.max(1, (effectiveEndTime.getTime() - (fromTime ?? testRun.start_time).getTime()) / 1000);
    this.logger.info(
      `📊 Using ${bucketSizeSeconds}s buckets for a ${windowSeconds.toFixed(0)}s window (estimated ${Math.ceil(windowSeconds / bucketSizeSeconds)} buckets${upsert ? ', upsert' : ''})`
    );

    // Load Apdex thresholds
    const apdexThresholds = await this.loadApdexThresholds(
      testRun.system_under_test_id,
      testRun.test_environment,
      testRun.workload,
      testRun.organization_id || undefined
    );

    // Initialize counters
    let metricsCreated = 0;
    let compareConfigsCreated = 0;
    const breakdown = {
      responseTimeMetrics: 0,
      transactionMetrics: 0,
      errorMetrics: 0,
      virtualUserMetrics: 0,
      apdexScores: 0,
    };

    // Only the errors and virtual-user processors still build records in JS: they emit
    // a handful of points per scenario. The requests and transactions processors write
    // their millions of (bucket x panel) rows with INSERT ... SELECT and never return
    // them — materialising those is what exhausted the heap.
    const allMetrics: DsMetricsRecord[] = [];
    const allCompareConfigs: DsCompareConfigRecord[] = [];
    const stepTiming: Array<{ step: string; duration: number; count: number }> = [];

    // Full collection replaces the run's perf-test metrics. The DELETE has to happen
    // before the processors, not inside saveDsMetrics, because they now insert as they
    // aggregate — a later DELETE would take their rows with it. It preserves every
    // non-perf-test row: this stage now also runs after a gap-filled incremental
    // collection (v0.2.95.22), where the Grafana/Dynatrace rows beside it are the only
    // copy and nothing re-collects them.
    if (!upsert) {
      // A SUT import without the optional `raw` group ships the perf-test ds_metrics but
      // nothing to rebuild them from. Deleting on the promise of a rebuild that finds no
      // rows would silently strip the run of its metrics and ADAPT results. Same rule as
      // every other delete-then-rewrite here: the probe stays strict because the statement
      // deletes.
      const raw: Array<{ has_rows: boolean }> = await this.db.dataSource.query(
        `SELECT EXISTS (SELECT 1 FROM requests_raw WHERE test_run_id = $1)
             OR EXISTS (SELECT 1 FROM transactions WHERE test_run_id = $1) AS has_rows`,
        [testRunId]
      );
      // Postgres always answers one boolean row; only an explicit false means "nothing here".
      if (raw[0]?.has_rows === false) {
        this.logger.warn(
          `⏭️ No requests_raw/transactions for ${testRunId} — keeping its existing perf-test ds_metrics`
        );
        return this.createSuccessResult(
          { testRunId, metricsCreated: 0, compareConfigsCreated: 0, skipped: 'no-raw-data' },
          Date.now() - startTime
        );
      }

      // A rebuild is not atomic (DELETE, then one INSERT ... SELECT per processor). With
      // the ticks' ranges still recorded, a rebuild that died between the two would be
      // "tailed" on the next analyze — one minute aggregated, the transaction panels of
      // the whole run gone, and the run then marked final. With them cleared it can only
      // rebuild again, or tail from start_time, which is a full-range upsert.
      if (ticked) {
        await this.db.resetCollectionStatus(testRunId, 'performance_test', null);
      }

      const deleteStart = Date.now();
      const { deleted, restored } = await this.db.deletePerfTestMetricsForRun(
        testRunId,
        await this.db.getRunMetricsSourceTypes(testRunId)
      );
      this.logger.info(
        `🧹 Deleted ${deleted} perf-test ds_metrics for ${testRunId} (${restored} other-source rows preserved) in ${Date.now() - deleteStart}ms`
      );
    }

    // Process requests_raw table
    let stepStart = Date.now();
    const requestsResult = await this.requestsProcessor.process(
      testRunId,
      testRun,
      apdexThresholds,
      bucketSizeSeconds,
      upsert
    );
    for (let i = 0; i < requestsResult.compareConfigs.length; i++) {
      allCompareConfigs.push(requestsResult.compareConfigs[i]);
    }
    breakdown.responseTimeMetrics += requestsResult.rowsInserted;
    metricsCreated += requestsResult.rowsInserted;
    stepTiming.push({
      step: 'requests-processor',
      duration: Date.now() - stepStart,
      count: requestsResult.rowsInserted
    });

    // Process transactions table
    stepStart = Date.now();
    const transactionsResult = await this.transactionsProcessor.process(
      testRunId,
      testRun,
      apdexThresholds,
      bucketSizeSeconds,
      upsert
    );
    for (let i = 0; i < transactionsResult.compareConfigs.length; i++) {
      allCompareConfigs.push(transactionsResult.compareConfigs[i]);
    }
    breakdown.transactionMetrics += transactionsResult.rowsInserted;
    metricsCreated += transactionsResult.rowsInserted;
    stepTiming.push({
      step: 'transactions-processor',
      duration: Date.now() - stepStart,
      count: transactionsResult.rowsInserted
    });

    // Process requests_error table
    stepStart = Date.now();
    const errorsResult = await this.errorsProcessor.process(
      testRunId,
      testRun
    );
    for (let i = 0; i < errorsResult.metrics.length; i++) {
      allMetrics.push(errorsResult.metrics[i]);
    }
    for (let i = 0; i < errorsResult.compareConfigs.length; i++) {
      allCompareConfigs.push(errorsResult.compareConfigs[i]);
    }
    breakdown.errorMetrics += errorsResult.metrics.length;
    stepTiming.push({
      step: 'errors-processor',
      duration: Date.now() - stepStart,
      count: errorsResult.metrics.length
    });

    // Process virtual_users table
    stepStart = Date.now();
    const vuResult = await this.virtualUsersProcessor.process(
      testRunId,
      testRun
    );
    for (let i = 0; i < vuResult.metrics.length; i++) {
      allMetrics.push(vuResult.metrics[i]);
    }
    for (let i = 0; i < vuResult.compareConfigs.length; i++) {
      allCompareConfigs.push(vuResult.compareConfigs[i]);
    }
    breakdown.virtualUserMetrics += vuResult.metrics.length;
    stepTiming.push({
      step: 'virtual-users-processor',
      duration: Date.now() - stepStart,
      count: vuResult.metrics.length
    });

    // Save the scenario-level metrics the two small processors built in JS.
    if (allMetrics.length > 0) {
      stepStart = Date.now();
      await this.saveDsMetrics(allMetrics, testRunId, testRun, upsert);
      metricsCreated += allMetrics.length;
      stepTiming.push({
        step: 'save-scenario-metrics',
        duration: Date.now() - stepStart,
        count: allMetrics.length
      });
    }

    if (finalPass) {
      // The ticks wrote the scenario-level points at start_time (the one timestamp known
      // while the run is live); the pass above rewrote them at end_time. Drop the interim.
      // withTickLock keeps a tick that started before completion from landing after this;
      // only a Redis failure or a 3 min give-up (both logged as "proceeding without it")
      // leaves that overlap open, and a second point at start_time is then its residue.
      await this.db.dataSource.query(
        `DELETE FROM ds_metrics
         WHERE test_run_id = $1 AND time = $2 AND panel_id = ANY($3::int[])
           AND metrics_source_id IN (SELECT id FROM metrics_sources WHERE source_type = 'performance_test')`,
        [testRunId, testRun.start_time, SCENARIO_PANEL_IDS]
      );
    }

    // Not on the tail pass: the ticks already ran both on every minute of the run, and
    // the analyze that runs the tail is followed by statistics-calculation, which
    // rewrites the same ds_metric_statistics rows. Re-reading the whole run for a
    // percentile_agg here would be the dominant cost of the path this exists to shorten.
    // The rebuild keeps both: a run with no ticks (SUT import) has had neither.
    if (metricsCreated > 0 && !finalPass) {
      // Statistics are recomputed from the rows just written rather than from a
      // second and third copy of them in the heap. See upsertPerfTestStatistics.
      stepStart = Date.now();
      await upsertPerfTestStatistics(
        this.db.dataSource,
        testRunId,
        this.dashboardManager.getResolvedDashboardIds(),
        testRun,
        this.logger
      );
      stepTiming.push({
        step: 'statistics',
        duration: Date.now() - stepStart,
        count: metricsCreated
      });
      this.logger.info(`💾 Saved ${metricsCreated} ds_metrics records and computed statistics`);

      // Update dashboard panels based on saved metrics
      stepStart = Date.now();
      await this.updateDashboardPanels(testRunId, testRun.start_time, testRun.end_time);
      stepTiming.push({
        step: 'update-panels',
        duration: Date.now() - stepStart,
        count: 0
      });
    }

    // Save all compare configs to database
    if (allCompareConfigs.length > 0) {
      stepStart = Date.now();
      compareConfigsCreated = await this.saveDsCompareConfigs(allCompareConfigs, testRun);
      stepTiming.push({
        step: 'save-compare-configs',
        duration: Date.now() - stepStart,
        count: compareConfigsCreated
      });
      this.logger.info(
        `📊 Created/updated ${compareConfigsCreated} ds_compare_config records`
      );
    }

    // Certify the rows as final so the next analyze skips this stage. `is_complete` is the
    // marker, and only a full pass sets it — the ticks' recorded range is NOT proof: a
    // stale-closed run's end_time is its last heartbeat and the scheduler ticks on for
    // ~30 s after it, so the range routinely reaches past end_time on a run whose scenario
    // points are still interim. Only on a run the ticks registered: creating the status
    // row for one they did not (SUT import, legacy run) would make PipelineOrchestrator
    // treat it as incrementally collected and skip its Grafana/Dynatrace stages next time.
    // And only when something was written: a pass that produced nothing has nothing to
    // certify, and certifying it would skip an empty run forever.
    if (!isIncremental && ticked && metricsCreated > 0) {
      await this.db.updateCollectedRanges(testRunId, 'performance_test', null, {
        from: fromTime ?? testRun.start_time,
        to: testRun.end_time!, // ticked implies planFullCollection saw completed && end_time
      });
      await this.db.markCollectionComplete(testRunId, 'performance_test', null);
    }

    const duration = Date.now() - startTime;
    const output: PerformanceTestMetricsOutput = {
      metricsCreated,
      compareConfigsCreated,
      breakdown,
    };

    // Log detailed timing breakdown
    this.logger.info('⏱️  Performance Test Metrics Pipeline - Step Timing:');
    stepTiming.forEach(({ step, duration: stepDuration, count }) => {
      const percentage = ((stepDuration / duration) * 100).toFixed(1);
      const bar = '█'.repeat(Math.round((stepDuration / duration) * 20));
      this.logger.info(
        `   ${step.padEnd(25)} ${stepDuration.toString().padStart(6)}ms ${percentage.padStart(5)}% ${bar} (${count} records)`
      );
    });

    this.logger.info(
      `✅ Performance test metrics collection completed in ${(duration / 1000).toFixed(2)}s`
    );

    return {
      success: true,
      data: output,
      duration,
    };
  }

  /**
   * Initialize processor instances
   */
  private initializeProcessors(): void {
    this.dashboardManager = new DashboardManager(this.db.dataSource, this.logger);
    this.requestsProcessor = new RequestsProcessor(
      this.db.dataSource,
      this.dashboardManager,
      this.logger
    );
    this.transactionsProcessor = new TransactionsProcessor(
      this.db.dataSource,
      this.dashboardManager,
      this.logger
    );
    this.errorsProcessor = new ErrorsProcessor(
      this.db.dataSource,
      this.dashboardManager,
      this.logger
    );
    this.virtualUsersProcessor = new VirtualUsersProcessor(
      this.db.dataSource,
      this.dashboardManager,
      this.logger
    );
  }

  /**
   * Validate and parse input
   */
  private validateAndParseInput(input: unknown): PerformanceTestMetricsInput {
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected object');
    }

    const { testRunId, fromTime, toTime } = input as Record<string, unknown>;

    if (!testRunId || typeof testRunId !== 'string') {
      throw new Error('Invalid input: testRunId is required and must be a string');
    }

    // Parse optional time range parameters
    const result: PerformanceTestMetricsInput = { testRunId };

    if (fromTime !== undefined) {
      result.fromTime = fromTime instanceof Date ? fromTime : new Date(fromTime as string | number);
      if (isNaN(result.fromTime.getTime())) {
        throw new Error('Invalid input: fromTime is not a valid date');
      }
    }

    if (toTime !== undefined) {
      result.toTime = toTime instanceof Date ? toTime : new Date(toTime as string | number);
      if (isNaN(result.toTime.getTime())) {
        throw new Error('Invalid input: toTime is not a valid date');
      }
    }

    return result;
  }

  /**
   * Load test run metadata from database
   */
  private async loadTestRunMetadata(testRunId: string): Promise<TestRunMetadata> {
    const testRun = await this.db.getTestRunByTestRunId(testRunId);

    if (!testRun) {
      throw new Error(`Test run not found: ${testRunId}`);
    }

    if (!testRun.startTime) {
      throw new Error(`Test run ${testRunId} has no start time`);
    }

    return {
      test_run_id: testRun.testRunId,
      system_under_test_id: testRun.systemUnderTestId,
      test_environment: testRun.testEnvironment,
      workload: testRun.workload,
      start_time: testRun.startTime,
      ramp_up_time: testRun.analysisStartOffset || 0,
      end_time: testRun.endTime || null,
      completed: testRun.completed === true,
      planned_duration: testRun.plannedDuration ?? null,
      organization_id: testRun.organizationId || null,
      team_id: testRun.teamId || null,
    };
  }

  /**
   * What a full collection has to do for this run.
   *
   * - `skip`: a full pass already finalised the run (`is_complete` on the perf-test status
   *   row — set here and by the force re-fetch; never by a tick, and no longer by the
   *   orchestrator's gap check) and its rows sit on the grid its length calls for.
   * - `tail`: the ticks wrote at that size but nothing finalised the run; aggregate from the
   *   last tick on and move the scenario-level points to end_time.
   * - `rebuild`: anything else — no ticks (SUT import, legacy run), the ticks sized from a
   *   planned duration the run did not honour (aborted, no plan), or rows that are not on the
   *   final grid. The delete-and-rebuild is what every baseline was produced by, so it is the
   *   safe answer whenever the cheap checks cannot certify parity.
   *
   * The recorded range is deliberately NOT what decides `skip`: a stale-closed run's end_time
   * is its last heartbeat and the scheduler keeps ticking for ~30 s past it, so the range
   * reaching end_time says nothing about whether the scenario points were ever moved there.
   *
   * The grid probe is what makes the transition safe: ticks from before this rule wrote 1 s
   * buckets, and a planned duration that changes mid-run changes the tick size with it. Both
   * leave rows off the final grid. Its blind spot is a tick size that is a multiple of the
   * final one (60 s ticks on a run that ends up needing 15 s) — the `tick === final` check
   * catches that on every unfinalised run, and a finalised one was written at `final`.
   */
  private async planFullCollection(
    run: TestRunMetadata,
    tick: number,
    final: number | null
  ): Promise<
    | { kind: 'skip'; ticked: true }
    | { kind: 'tail'; ticked: true; from: Date }
    | { kind: 'rebuild'; ticked: boolean; reason: string }
  > {
    if (!run.completed || !run.end_time) {
      return { kind: 'rebuild', ticked: false, reason: 'run not completed' };
    }
    if (final === null) {
      // Used to throw from calculateBucketSize; silently rebuilding would delete the run's
      // rows and write nothing back.
      throw new Error(`Test run ${run.test_run_id} ends at or before it starts`);
    }
    const status = await this.db.getCollectionStatus(run.test_run_id, 'performance_test', null);
    if (!status) {
      return { kind: 'rebuild', ticked: false, reason: 'no incremental collection' };
    }
    if (!status.is_complete && tick !== final) {
      return { kind: 'rebuild', ticked: true, reason: `ticks wrote ${tick}s buckets, run needs ${final}s` };
    }
    if (!(await this.perfTestRowsOnGrid(run, final))) {
      return { kind: 'rebuild', ticked: true, reason: `rows are not on the ${final}s grid` };
    }
    if (status.is_complete) {
      return { kind: 'skip', ticked: true };
    }
    const lastTo = (status.collected_ranges ?? []).reduce<Date | null>((max, r) => {
      const to = new Date(r.to);
      return !max || to > max ? to : max;
    }, null);
    // A range past end_time (the stale-close case) still leaves the scenario points to move.
    const from = lastTo ? new Date(Math.min(lastTo.getTime(), run.end_time.getTime())) : run.start_time;
    return { kind: 'tail', ticked: true, from };
  }

  /**
   * Whether the run HAS perf-test bucket rows and every one sits on `start_time + k * bucket`.
   * Zero rows fail it on purpose — a run the ticks never wrote must rebuild, whatever its
   * status row says. The scenario-level panels are exempt: their single point sits at
   * start_time or end_time.
   * A miss is cheap (first off-grid row); a pass scans the run's perf-test rows, a few
   * hundred thousand on a large run. The arithmetic is timestamptz-only on purpose — the
   * writers' `$5::timestamp` origin drops the session zone (see TODOS.md), and any
   * disagreement here falls to the rebuild, never to a wrong skip.
   */
  private async perfTestRowsOnGrid(run: TestRunMetadata, bucketSizeSeconds: number): Promise<boolean> {
    const rows: Array<{ on_grid: boolean }> = await this.db.dataSource.query(
      `SELECT EXISTS (
         SELECT 1 FROM ds_metrics m
         WHERE m.test_run_id = $1
           AND m.metrics_source_id IN (SELECT id FROM metrics_sources WHERE source_type = 'performance_test')
           AND m.panel_id <> ALL($3::int[])
       ) AND NOT EXISTS (
         SELECT 1 FROM ds_metrics m
         WHERE m.test_run_id = $1
           AND m.metrics_source_id IN (SELECT id FROM metrics_sources WHERE source_type = 'performance_test')
           AND m.panel_id <> ALL($3::int[])
           AND EXTRACT(EPOCH FROM (m.time - $2::timestamptz))::bigint % $4 <> 0
       ) AS on_grid`,
      [run.test_run_id, run.start_time, SCENARIO_PANEL_IDS, bucketSizeSeconds]
    );
    return rows[0]?.on_grid === true;
  }

  /**
   * Load Apdex thresholds for the workload and transactions
   */
  private async loadApdexThresholds(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    organizationId?: string
  ): Promise<ApdexThresholdLookup> {
    const result: ApdexThresholdLookup = {
      workloadThreshold: null,
      benchmarkThreshold: null,
      transactionThresholds: new Map(),
    };

    // Load workload-level threshold
    // RBAC: Filter by organization (backward compatible with NULL)
    let workloadThresholdQuery = `SELECT apdex_threshold
       FROM workload_apdex_thresholds
       WHERE system_under_test_id = $1
         AND test_environment = $2
         AND workload = $3`;
    const workloadThresholdParams: unknown[] = [systemUnderTestId, testEnvironment, workload];

    if (organizationId) {
      workloadThresholdQuery += `\n         AND (organization_id = $4 OR organization_id IS NULL)`;
      workloadThresholdParams.push(organizationId);
    }

    const workloadThreshold = await this.db.dataSource.query(
      workloadThresholdQuery,
      workloadThresholdParams
    );

    if (workloadThreshold && workloadThreshold.length > 0) {
      result.workloadThreshold = workloadThreshold[0].apdex_threshold;
    }

    // Load benchmark-configured threshold (from apdex benchmark)
    // RBAC: Filter by organization (backward compatible with NULL)
    let benchmarkQuery = `
      SELECT apdex_threshold_ms
      FROM benchmarks
      WHERE system_under_test_id = $1
        AND test_environment = $2
        AND workload = $3
        AND benchmark_type = 'apdex'
        AND apdex_threshold_ms IS NOT NULL`;

    const benchmarkParams: unknown[] = [systemUnderTestId, testEnvironment, workload];

    if (organizationId) {
      benchmarkQuery += `\n        AND (organization_id = $4 OR organization_id IS NULL)`;
      benchmarkParams.push(organizationId);
    }

    benchmarkQuery += `\n      LIMIT 1`;

    const benchmarkThreshold = await this.db.dataSource.query(
      benchmarkQuery,
      benchmarkParams
    );

    if (benchmarkThreshold && benchmarkThreshold.length > 0) {
      result.benchmarkThreshold = benchmarkThreshold[0].apdex_threshold_ms;
    }

    // Load transaction-level thresholds
    // RBAC: Filter by organization (backward compatible with NULL)
    let txThresholdQuery = `SELECT transaction_name, apdex_threshold
       FROM workload_transaction_apdex_thresholds
       WHERE system_under_test_id = $1
         AND test_environment = $2
         AND workload = $3`;
    const txThresholdParams: unknown[] = [systemUnderTestId, testEnvironment, workload];

    if (organizationId) {
      txThresholdQuery += `\n         AND (organization_id = $4 OR organization_id IS NULL)`;
      txThresholdParams.push(organizationId);
    }

    const transactionThresholds = await this.db.dataSource.query(
      txThresholdQuery,
      txThresholdParams
    );

    for (const row of transactionThresholds) {
      result.transactionThresholds.set(row.transaction_name, row.apdex_threshold);
    }

    const effectiveThreshold = result.workloadThreshold || result.benchmarkThreshold || DEFAULT_APDEX_THRESHOLD_MS;
    this.logger.info(
      `📐 Loaded Apdex thresholds: workload=${result.workloadThreshold || 'not set'}, ` +
        `benchmark=${result.benchmarkThreshold || 'not set'}, ` +
        `effective=${effectiveThreshold}ms, ` +
        `transaction-specific=${result.transactionThresholds.size}`
    );

    return result;
  }

  /**
   * Save ds_metrics records to database using parallel batch inserts.
   *
   * Two modes:
   * - **Rebuild** (upsert=false): plain INSERT with large batch sizes — the run-wide DELETE
   *   happens in `execute()`, before the requests/transactions processors insert. This is
   *   2-3x faster because PostgreSQL skips unique-index conflict checking and lock
   *   contention is eliminated.
   * - **Upsert** (upsert=true): INSERT...ON CONFLICT with smaller batch sizes, whenever the
   *   run already holds rows for the window — a tick, a force re-fetch, the final tail pass.
   */
  private async saveDsMetrics(
    metrics: DsMetricsRecord[],
    testRunId: string,
    testRunMetadata?: TestRunMetadata,
    upsert: boolean = true
  ): Promise<void> {
    if (metrics.length === 0) {
      return;
    }

    // The run-wide DELETE for full collection happens in execute(), before the
    // requests/transactions processors insert.

    // Rebuild: plain INSERT (no conflict check), larger batches
    // Upsert: INSERT...ON CONFLICT, smaller batches for lock safety
    // PostgreSQL max params: 65535; each record uses 20 params
    // Plain INSERT: 3000 rows × 20 = 60000 params (under limit, no lock contention)
    // ON CONFLICT: 1000 rows × 20 = 20000 params (smaller to reduce lock contention)
    const batchSize = upsert ? 1000 : 3000;
    const maxConcurrentBatches = upsert ? 4 : 6;

    // Create all batch insert operations
    const batchOperations: Array<() => Promise<void>> = [];

    for (let i = 0; i < metrics.length; i += batchSize) {
      const batch = metrics.slice(i, i + batchSize);

      // Create a function for this batch insert
      const batchInsert = async () => {
        // Build VALUES clause for batch insert
        const values: unknown[] = [];
        const placeholders: string[] = [];

        batch.forEach((record, idx) => {
          const base = idx * 20;
          placeholders.push(
            `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17}, $${base + 18}, $${base + 19}, $${base + 20})`
          );
          values.push(
            record.test_run_id,
            record.application_dashboard_id,
            record.metrics_source_id || null,
            record.dashboard_uid?.substring(0, 255),
            record.panel_id,
            record.time,
            record.metric_name?.substring(0, 255),
            record.panel_title?.substring(0, 500),
            record.dashboard_label?.substring(0, 255),
            record.benchmark_ids ? JSON.stringify(record.benchmark_ids) : null,
            record.errors ? JSON.stringify(record.errors) : null,
            record.timestep,
            record.ramp_up,
            record.value,
            record.unit,
            new Date(), // created_at
            testRunMetadata?.organization_id || null,
            testRunMetadata?.team_id || null,
            'worker-pipeline', // created_by
            'worker-pipeline'  // updated_by
          );
        });

        let query: string;
        if (upsert) {
          query = `
            INSERT INTO ds_metrics (
              test_run_id, application_dashboard_id, metrics_source_id, dashboard_uid, panel_id, time,
              metric_name, panel_title, dashboard_label, benchmark_ids, errors,
              timestep, ramp_up, value, unit, created_at,
              organization_id, team_id, created_by, updated_by
            ) VALUES ${placeholders.join(', ')}
            ON CONFLICT (test_run_id, application_dashboard_id, panel_id, metric_name, time)
            DO UPDATE SET
              value = EXCLUDED.value,
              unit = EXCLUDED.unit,
              metrics_source_id = COALESCE(EXCLUDED.metrics_source_id, ds_metrics.metrics_source_id),
              updated_at = CURRENT_TIMESTAMP,
              organization_id = EXCLUDED.organization_id,
              team_id = EXCLUDED.team_id,
              updated_by = EXCLUDED.updated_by
          `;
        } else {
          query = `
            INSERT INTO ds_metrics (
              test_run_id, application_dashboard_id, metrics_source_id, dashboard_uid, panel_id, time,
              metric_name, panel_title, dashboard_label, benchmark_ids, errors,
              timestep, ramp_up, value, unit, created_at,
              organization_id, team_id, created_by, updated_by
            ) VALUES ${placeholders.join(', ')}
          `;
        }

        // Use write pool so inserts are never starved by analytics
        await this.db.writeDataSource.query(query, values);
      };

      batchOperations.push(batchInsert);
    }

    // Execute batch operations with controlled concurrency
    const results: Array<PromiseSettledResult<void>> = [];
    for (let i = 0; i < batchOperations.length; i += maxConcurrentBatches) {
      const chunk = batchOperations.slice(i, i + maxConcurrentBatches);
      const chunkResults = await Promise.allSettled(chunk.map(op => op()));
      results.push(...chunkResults);
    }

    // Check for failures
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      this.logger.error(`❌ ${failures.length} batch inserts failed`);
      throw new Error(`Failed to save ${failures.length} batches of metrics`);
    }
  }

  /**
   * Save ds_compare_config records using batch insert for better performance.
   *
   * Handles two types of configs:
   * - **Panel-level** (metric_name IS NULL): One per (dashboard, panel).
   *   These provide default thresholds/classification for every metric in the panel.
   *   Uses `ON CONFLICT ... DO NOTHING` to preserve user customizations.
   * - **Metric-specific** (metric_name IS NOT NULL): Per-metric overrides (legacy).
   *   Also uses `DO NOTHING` to preserve existing records.
   *
   * Returns the number of records created.
   */
  private async saveDsCompareConfigs(configs: DsCompareConfigRecord[], testRunMetadata?: TestRunMetadata): Promise<number> {
    if (configs.length === 0) {
      return 0;
    }

    // Split configs into panel-level and metric-specific groups
    const panelLevelConfigs = configs.filter((c) => c.metric_name === null);
    const metricSpecificConfigs = configs.filter((c) => c.metric_name !== null);

    let totalInserted = 0;

    // Insert panel-level configs (metric_name IS NULL)
    if (panelLevelConfigs.length > 0) {
      totalInserted += await this.insertCompareConfigBatch(
        panelLevelConfigs,
        testRunMetadata,
        // Must match uniq_ds_compare_config_panel index
        `ON CONFLICT (system_under_test_id, test_environment, workload, application_dashboard_id, panel_id) WHERE metric_name IS NULL DO NOTHING`
      );
    }

    // Insert metric-specific configs (metric_name IS NOT NULL) — legacy path
    if (metricSpecificConfigs.length > 0) {
      totalInserted += await this.insertCompareConfigBatch(
        metricSpecificConfigs,
        testRunMetadata,
        // Must match uniq_ds_compare_config_metric index
        `ON CONFLICT (system_under_test_id, test_environment, workload, application_dashboard_id, panel_id, metric_name) WHERE metric_name IS NOT NULL DO NOTHING`
      );
    }

    return totalInserted;
  }

  /**
   * Batch insert compare config records with a given ON CONFLICT clause.
   */
  private async insertCompareConfigBatch(
    configs: DsCompareConfigRecord[],
    testRunMetadata: TestRunMetadata | undefined,
    onConflictClause: string
  ): Promise<number> {
    const batchSize = 200;
    let totalInserted = 0;

    for (let i = 0; i < configs.length; i += batchSize) {
      const batch = configs.slice(i, i + batchSize);

      const values: unknown[] = [];
      const placeholders: string[] = [];

      batch.forEach((config, idx) => {
        const base = idx * 11;
        placeholders.push(
          // organization_id is NOT NULL on ds_compare_config: when the optional metadata is
          // absent, resolve it from the FK-guaranteed parent SUT instead of inserting NULL.
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, ` +
            `COALESCE($${base + 8}, (SELECT organization_id FROM systems_under_test WHERE id = $${base + 1})), ` +
            `COALESCE($${base + 9}, (SELECT team_id FROM systems_under_test WHERE id = $${base + 1})), ` +
            `$${base + 10}, $${base + 11})`
        );
        values.push(
          config.system_under_test_id,
          config.test_environment,
          config.workload,
          config.application_dashboard_id,
          config.panel_id,
          config.metric_name?.substring(0, 255) ?? null,
          JSON.stringify(config.config_data),
          testRunMetadata?.organization_id ?? null,
          testRunMetadata?.team_id ?? null,
          'worker-pipeline',
          'worker-pipeline'
        );
      });

      const query = `
        INSERT INTO ds_compare_config (
          system_under_test_id, test_environment, workload,
          application_dashboard_id, panel_id, metric_name, config_data,
          organization_id, team_id, created_by, updated_by
        )
        VALUES ${placeholders.join(', ')}
        ${onConflictClause}
        RETURNING id
      `;

      const result = await this.db.dataSource.query(query, values);
      totalInserted += result.length;

      this.logger.debug(
        `📥 Batch ${Math.floor(i / batchSize) + 1}: Inserted ${result.length}/${batch.length} compare configs`
      );
    }

    return totalInserted;
  }

  /**
   * Update dashboard panels based on saved metrics
   * Queries distinct panels from ds_metrics and updates grafana_dashboards.panels JSONB field
   */
  private async updateDashboardPanels(
    testRunId: string,
    startTime: Date,
    endTime: Date | null
  ): Promise<void> {
    this.logger.info('📊 Updating dashboard panels based on saved metrics...');

    try {
      // TimescaleDB optimization: Add generous time window to limit chunk scanning
      // Add 1 hour buffer before start and after end to handle clock skew
      const timeFrom = new Date(startTime.getTime() - 3600000); // 1 hour before
      const timeTo = endTime ? new Date(endTime.getTime() + 3600000) : new Date(); // 1 hour after or now

      // Get all dashboards that have metrics for this test run
      const dashboards = await this.db.dataSource.query<
        Array<{ dashboard_uid: string; grafana_dashboard_id: string }>
      >(
        `SELECT DISTINCT ad.dashboard_uid, gd.id as grafana_dashboard_id
         FROM ds_metrics dm
         JOIN application_dashboards ad ON ad.id = dm.application_dashboard_id
         JOIN grafana_dashboards gd ON gd.uid = ad.dashboard_uid
         WHERE dm.test_run_id = $1
         AND dm.time >= $2
         AND dm.time <= $3`,
        [testRunId, timeFrom, timeTo]
      );

      if (!dashboards || dashboards.length === 0) {
        this.logger.info(`⏭️  No dashboards found for test run: ${testRunId} - skipping panel update`);
        return;
      }

      this.logger.info(`🔄 Updating panels for ${dashboards.length} dashboard(s)`);

      // Single query to update all dashboards at once (eliminates N+1 loop)
      const result = await this.db.dataSource.query<
        Array<{ id: string; uid: string; panels: unknown[] }>
      >(
        `UPDATE grafana_dashboards gd
         SET panels = panel_updates.panels
         FROM (
           SELECT
             gd2.id,
             jsonb_agg(
               jsonb_build_object(
                 'id', panels_deduped.panel_id,
                 'title', panels_deduped.panel_title,
                 'type', 'timeseries',
                 'y_axes_format', panels_deduped.unit
               )
             ) as panels
           FROM (
             SELECT DISTINCT ON (ad.dashboard_uid, dm.panel_id)
               ad.dashboard_uid,
               dm.panel_id,
               dm.panel_title,
               dm.unit
             FROM ds_metrics dm
             JOIN application_dashboards ad ON ad.id = dm.application_dashboard_id
             WHERE dm.test_run_id = $1
               AND dm.time >= $2
               AND dm.time <= $3
               AND dm.unit IS NOT NULL
               AND dm.unit != ''
             ORDER BY ad.dashboard_uid, dm.panel_id, dm.unit
           ) panels_deduped
           JOIN grafana_dashboards gd2 ON gd2.uid = panels_deduped.dashboard_uid
           GROUP BY gd2.id
         ) panel_updates
         WHERE gd.id = panel_updates.id
         RETURNING gd.id, gd.uid, gd.panels`,
        [testRunId, timeFrom, timeTo]
      );

      if (result) {
        for (const row of result) {
          const panelCount = row.panels ? row.panels.length : 0;
          this.logger.info(`✅ Updated ${panelCount} panel(s) for dashboard: ${row.uid}`);
        }
      }

      this.logger.info('✅ Dashboard panels update completed');
    } catch (error) {
      this.logger.error('❌ Failed to update dashboard panels:', error);
      // Don't throw - this is a non-critical operation
      // Metrics are saved, panels can be updated manually if needed
    }
  }
}
