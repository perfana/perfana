import { BasePipelineTypeORM } from './BasePipelineTypeORM.js';
import { PipelineResult } from '../types/pipeline.js';
import { EntityManager } from 'typeorm';

export interface StatisticsInput {
  testRunIds: string[];
}

/**
 * StatisticsPipeline — Per-Test-Run Descriptive Statistics
 *
 * Computes descriptive statistics for every (test_run, dashboard, panel, metric)
 * tuple and writes them to `ds_metric_statistics`. These per-run statistics are
 * later aggregated into control group statistics and consumed by the ADAPT
 * regression detection algorithm.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * SQL CTE Chain Overview
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *   metrics_filtered          Raw data points from ds_metrics, filtered:
 *        │                      - ramp_up = false  (exclude warm-up period; see below)
 *        │                      - value IS NOT NULL (ignore gaps)
 *        │                      - dashboard org-scoping via application_dashboards / dynatrace_queries
 *        ▼
 *   statistics_aggregated     GROUP BY (test_run, dashboard, panel, metric):
 *        │                      - Classical: COUNT, AVG (mean), MIN, MAX, STDDEV_POP
 *        │                      - TimescaleDB: percentile_agg(value) — single-pass t-digest sketch
 *        │                      - Auxiliary: n_missing, n_non_zero
 *        │                      - last_value: value at the greatest time, via last()
 *        ▼
 *   final_statistics          Derives remaining columns from the aggregates:
 *        │                      - Percentiles via approx_percentile(p, pct_agg):
 *        │                          median (p50), q10, q25, q75, q90, q95, q99
 *        │                      - IQR = q75 - q25  (interquartile range — robust spread)
 *        │                      - IDR = q90 - q10  (interdecile range — wider robust spread)
 *        │                      - is_constant: true when all values are identical (min = max)
 *        │                      - all_missing: true when every observation is NULL
 *        │                      - pct_missing: percentage of NULL observations
 *        ▼
 *   INSERT INTO ds_metric_statistics  (delete-then-insert for idempotent re-runs)
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * Ramp-Up Filtering
 * ──────────────────────────────────────────────────────────────────────────────
 * Load tests typically begin with a warm-up / ramp-up phase where virtual users
 * gradually increase. Metrics collected during this phase are non-representative
 * of steady-state behavior. The MetricsPipeline marks these data points with
 * ramp_up = true. This pipeline excludes them so statistics reflect only the
 * steady-state portion of the test.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * Percentile Calculation
 * ──────────────────────────────────────────────────────────────────────────────
 * Uses TimescaleDB Toolkit's `percentile_agg()` which builds a t-digest sketch
 * in a single pass over the data, then `approx_percentile(p, sketch)` extracts
 * approximate quantiles. This avoids sorting the full dataset and is O(n) in
 * both time and memory. The t-digest provides high accuracy at the tails (p10,
 * p90, p95, p99) where it matters most for performance analysis.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * Quality Flags
 * ──────────────────────────────────────────────────────────────────────────────
 * - is_constant:  All observed values are identical (min = max).
 *                 Downstream ADAPT treats these specially since std_dev = 0
 *                 makes ratio-based thresholds meaningless.
 * - all_missing:  Every observation in the group is NULL (count = n_missing).
 *                 The metric exists in the dashboard definition but produced no
 *                 usable data — ADAPT labels these "incomparable".
 */
/**
 * Whether a metric sample falls in a run's ramp-up or ramp-down window.
 *
 * Module-level so the read-only pre-check, the UPDATE's SET and the UPDATE's
 * change-guard all interpolate one definition and cannot drift apart. Uses the
 * `m` (ds_metrics) and `tr` (test_runs) aliases every consumer supplies.
 */
const RAMP_UP_EXPR = `(
      -- The offsets have to FIT inside the run. When they do not — a run shorter
      -- than analysisStartOffset + analysisEndOffset — the leading and trailing
      -- windows overlap and every sample matches one of them, so the whole run
      -- is flagged outside the analysis window. Nothing downstream survives that:
      -- ds_metric_statistics comes out empty, the Apdex rollup misses on every
      -- transaction, and ADAPT reports INSUFFICIENT_DATA against a run that has
      -- data. It is also the worst case for the UPDATE below, which then rewrites
      -- every row of a compressed run instead of a boundary band.
      --
      -- Analysing the whole run is the honest fallback: the offsets are a request
      -- to trim, not a request to discard. Mirrored in MetricsPipeline so a newly
      -- ingested run is baked the same way.
      EXTRACT(EPOCH FROM (tr.end_time - tr.start_time))
        > COALESCE(tr.ramp_up, 0) + COALESCE(tr.ramp_down, 0)
      AND (
        EXTRACT(EPOCH FROM (m.time - tr.start_time)) < COALESCE(tr.ramp_up, 0)
        OR (
          COALESCE(tr.ramp_down, 0) > 0
          AND EXTRACT(EPOCH FROM (m.time - tr.start_time))
              > EXTRACT(EPOCH FROM (tr.end_time - tr.start_time)) - COALESCE(tr.ramp_down, 0)
        )
      )
    )`;

export class StatisticsPipeline extends BasePipelineTypeORM {

  validateInput(input: unknown): boolean {
    if (!input || typeof input !== 'object') {return false;}
    const typedInput = input as { testRunIds?: unknown[] };
    return Array.isArray(typedInput.testRunIds) &&
           typedInput.testRunIds.length > 0 &&
           typedInput.testRunIds.every((id: unknown) => typeof id === 'string');
  }

  async execute(input: unknown): Promise<PipelineResult> {
    const startTime = Date.now();

    if (!this.validateInput(input)) {
      return this.createErrorResult('Invalid input: expected { testRunIds: string[] }', 'INVALID_INPUT');
    }

    const { testRunIds } = input as StatisticsInput;

    try {
      this.logger.info(`Starting statistics aggregation for test runs: ${testRunIds.join(', ')}`);

      // Cleanup stale data before processing
      await this.cleanupStaleApplicationDashboards(['ds_metric_statistics']);

      // Refresh the ds_metrics.ramp_up flag from each run's CURRENT analysis
      // offsets before aggregating. The flag is otherwise baked once at
      // ingestion (MetricsPipeline), so editing the analysis time range on a
      // completed run — which skips metric-collection on re-analysis — would
      // leave ADAPT reading the OLD window (#421-followup / analysis-time-range).
      //
      // Ask with a read before writing: on a compressed chunk the UPDATE's own
      // guard is what triggers the decompression, so "only rows that change are
      // written" does not make it free. See findRunsWithStaleRampUpFlags.
      const staleRuns = await this.findRunsWithStaleRampUpFlags(testRunIds);

      // Same shape, and the same fix, as the force-refetch guard in
      // simple-orchestrate-reevaluate-batch.ts: decompress up front, outside the
      // transaction, so the UPDATE never has to do it as DML. The compression
      // policy recompresses on its next pass.
      //
      // Per run, over the span of the DISAGREEING rows — not the run's full
      // window, and not one global min/max across every stale run. decompress_chunk
      // works at chunk granularity and a chunk holds every run in its time range,
      // so widening the range is not free: it converts other runs' data to row
      // store too, and every later query over that window scans row store until the
      // compression policy catches up. A stale trailing flag spans minutes; the old
      // run-wide bounds decompressed hours, and a batch of stale runs weeks.
      for (const run of staleRuns) {
        await this.db.decompressChunksForRange('ds_metrics', run.from, run.to);
      }

      const result = await this.withAnalyticsTransaction(async (manager: EntityManager) => {
        // First statement in the transaction, not next to the INSERT: SET LOCAL is
        // transaction-scoped, and refreshRampUpFlags below rewrites a compressed run
        // — it is the statement most likely to blow the 120s analytics cap, and it
        // runs before the aggregation the cap was raised for.
        await this.setAggregationBudget(manager);

        if (staleRuns.length > 0) {
          await this.refreshRampUpFlags(manager, staleRuns);
        } else {
          this.logger.info(
            `🕒 ramp_up flags already match the current analysis offsets for ${testRunIds.length} run(s) — no update needed`
          );
        }
        return await this.aggregateMetricStatistics(manager, testRunIds);
      });

      const duration = Date.now() - startTime;
      this.logPerformance('statistics-aggregation', startTime, {
        testRunIds: testRunIds.length,
        processedRecords: result.rowCount
      });

      return this.createSuccessResult({
        processedRecords: result.rowCount,
        testRunIds: testRunIds.length
      }, duration);

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logError(error as Error, { testRunIds });
      return this.createErrorResult(
        error as Error,
        'STATISTICS_AGGREGATION_FAILED',
        { testRunIds },
        duration
      );
    }
  }

  /**
   * Recompute `ds_metrics.ramp_up` for the given runs from their current analysis
   * offsets (test_runs.ramp_up = analysisStartOffset, test_runs.ramp_down =
   * analysisEndOffset). A point is outside the analysis window — flagged
   * ramp_up=true — when it falls in the leading start-offset window OR the trailing
   * end-offset window: the canonical `[start + startOffset, end - endOffset]` range
   * that the SLO charts, TransactionStatsRollupPipeline, and the incremental
   * collector all use.
   *
   * The `IS DISTINCT FROM` guard writes only rows whose flag actually changes.
   * For incrementally-ingested runs this is a true no-op when offsets are
   * unchanged. Runs originally ingested by the non-incremental MetricsPipeline get
   * their trailing flags corrected once here: that path double-subtracts the end
   * offset (bakes `end - 2*endOffset`; see MetricsPipeline.effectiveEndTime +
   * flattenSingleDocument) — a pre-existing bug this refresh supersedes before ADAPT
   * reads the flag, since statistics-calculation always follows metrics-collection.
   *
   * Runs with a NULL start_time or end_time are skipped (window undefined) — the
   * flag stays as ingested, matching MetricsPipeline's `Infinity` duration branch.
   */
  /**
   * Which of these runs actually have a ramp_up flag that disagrees with the
   * run's current analysis offsets — and over what time range those rows lie.
   *
   * This is a SELECT on purpose. `ramp_up` is neither `compress_segmentby`
   * (test_run_id) nor `compress_orderby` (time), so the UPDATE's guard predicate
   * cannot be pushed into a compressed batch: TimescaleDB decompresses the run's
   * whole segment as DML just to discover nothing needs writing. Measured on a
   * 2.6M-row run whose flags were already correct: 53s, 2,620,348 tuples
   * decompressed, then `tuple decompression limit exceeded by operation`
   * (max_tuples_decompressed_per_dml_transaction defaults to 100k). A read pays
   * none of that — the executor decompresses transiently and rewrites nothing.
   *
   * Every run the ADAPT sketch backfill repairs is older than the 7-day
   * compression policy by construction, so this is the normal path there, not
   * an edge case.
   */
  private async findRunsWithStaleRampUpFlags(
    testRunIds: string[]
  ): Promise<Array<{ testRunId: string; from: Date; to: Date }>> {
    const placeholders = testRunIds.map((_, i) => `$${i + 1}`).join(', ');

    // MIN/MAX over the disagreeing rows, not the run's own start/end. Those bounds
    // are what the decompression and the UPDATE below are scoped to, and a stale
    // trailing flag typically spans minutes out of a multi-hour run.
    //
    // This costs one full read of the run where the old EXISTS short-circuited on
    // the first disagreeing row. That trade is worth making: a read decompresses
    // transiently and rewrites nothing, while the run-wide bounds it replaces put
    // every chunk of the run into row store for good. The 939ms in CLAUDE.md is the
    // 2.6M-row figure and scales roughly linearly — budget ~8s on a 20M-row run.
    const sql = `
      SELECT tr.test_run_id, MIN(m.time) AS from_time, MAX(m.time) AS to_time
      FROM test_runs tr
      JOIN ds_metrics m ON m.test_run_id = tr.test_run_id
      WHERE tr.test_run_id IN (${placeholders})
        AND tr.start_time IS NOT NULL
        AND tr.end_time IS NOT NULL
        AND m.ramp_up IS DISTINCT FROM ${RAMP_UP_EXPR}
      GROUP BY tr.test_run_id
    `;

    const rows: Array<{ test_run_id: string; from_time: Date; to_time: Date }> =
      await this.db.query(sql, testRunIds);

    // A run with nothing to fix produces no group, so it never reaches the UPDATE.
    //
    // The isFinite filter belongs HERE rather than at the decompression loop: both
    // the decompression and the UPDATE bind these bounds, so skipping only the
    // former would still hand Postgres an Invalid Date as $2/$3 — and with the
    // chunks left compressed. MIN/MAX carry no NOT NULL guarantee of their own
    // (the run's start_time/end_time do, but these are ds_metrics.time), so a
    // malformed row drops the whole run rather than half-processing it.
    return (rows ?? [])
      .map((r) => ({ testRunId: r.test_run_id, from: r.from_time, to: r.to_time }))
      .filter(
        (r) =>
          Number.isFinite(new Date(r.from).getTime()) && Number.isFinite(new Date(r.to).getTime())
      );
  }

  private async refreshRampUpFlags(
    manager: EntityManager,
    staleRuns: Array<{ testRunId: string; from: Date; to: Date }>
  ): Promise<void> {
    // One statement per run, bounded by the disagreeing rows' time span. Both
    // predicates earn their place in the compressed layout: test_run_id is
    // compress_segmentby and time is compress_orderby, so TimescaleDB can skip
    // whole batches by their min/max time metadata instead of decompressing the
    // run's entire segment to evaluate the ramp_up guard.
    //
    // Splitting per run narrows the tuples each statement touches; it does NOT give
    // each run its own decompression budget —
    // max_tuples_decompressed_per_dml_transaction (100k) is charged per TRANSACTION
    // and all N statements share one. What keeps the loop under it is the up-front
    // decompressChunksForRange; if that silently no-ops the limit is still reachable.
    const sql = `
      UPDATE ds_metrics m
      SET ramp_up = ${RAMP_UP_EXPR}
      FROM test_runs tr
      WHERE m.test_run_id = tr.test_run_id
        AND m.test_run_id = $1
        AND m.time >= $2
        AND m.time <= $3
        AND tr.start_time IS NOT NULL
        AND tr.end_time IS NOT NULL
        AND m.ramp_up IS DISTINCT FROM ${RAMP_UP_EXPR}
    `;

    let affected = 0;
    for (const run of staleRuns) {
      const result = await manager.query(sql, [run.testRunId, run.from, run.to]);
      // pg returns [rows, rowCount] for UPDATE via node-postgres; TypeORM's raw
      // query surfaces an array whose affected count we log best-effort.
      affected += (Array.isArray(result) ? (result[1] ?? 0) : 0) as number;
    }

    this.logger.info(
      `🕒 Refreshed ramp_up flags against current analysis offsets for ${staleRuns.length} run(s) (${affected} rows changed)`
    );
  }

  private async aggregateMetricStatistics(
    manager: EntityManager,
    testRunIds: string[]
  ): Promise<{ success: boolean; rowCount: number }> {

    this.logger.info(`📊 Aggregating statistics for ${testRunIds.length} test run(s): ${testRunIds.join(', ')}`);

    // Is there anything to aggregate? EXISTS, not COUNT(*): this only guards the
    // DELETE below (a run whose ds_metrics have aged out must keep its statistics
    // rather than have them wiped and replaced with nothing). COUNT(*) answered the
    // same yes/no by scanning every row — 16s over 20.6M rows on a compressed
    // hypertable, to produce a log line the INSERT's own row count already gives.
    //
    // PER RUN, not once for the batch. The probe guards a DELETE that is itself
    // scoped by `test_run_id IN (...)`, so a single batch-wide answer let ONE run
    // with live metrics authorise deleting the statistics of every other run in the
    // same job — and the re-INSERT below only rewrites the runs that still have raw
    // metrics, so the aged-out ones were left with nothing. That is unrecoverable:
    // ds_metrics is gone, so the statistics cannot be rebuilt, and ADAPT then has no
    // baseline for those runs.
    //
    // Harmless while batches were hand-picked and small; a workload-wide re-evaluate
    // (an "apply analysis window to all test runs" edit) mixes live and aged-out runs
    // in one job by construction, which is what makes this reachable.
    //
    // N probes instead of 1 is the right trade: test_run_id is the ds_metrics
    // `compress_segmentby` key and leads the index, so each probe is an index descent
    // that stops at the first row — the batch-wide form was not measurably cheaper.
    const runsWithMetrics: string[] = [];
    for (const testRunId of testRunIds) {
      const probe = await manager.query(
        `SELECT EXISTS (
           SELECT 1 FROM ds_metrics
           WHERE test_run_id = $1
             AND ramp_up = false
             AND value IS NOT NULL
         ) AS has_metrics`,
        [testRunId]
      );
      if (probe[0]?.has_metrics) {
        runsWithMetrics.push(testRunId);
      }
    }

    const runsWithoutMetrics = testRunIds.filter((id) => !runsWithMetrics.includes(id));
    if (runsWithoutMetrics.length > 0) {
      this.logger.warn(`⚠️ No metrics found for test runs: ${runsWithoutMetrics.join(', ')}`);
      this.logger.warn('💡 This could mean:');
      this.logger.warn('   1. MetricsPipeline hasn\'t run yet for these test runs');
      this.logger.warn('   2. All metrics have ramp_up=true (no steady-state data)');
      this.logger.warn('   3. All metric values are NULL');
      this.logger.warn('   Their existing statistics are left untouched.');
    }

    if (runsWithMetrics.length === 0) {
      return { success: true, rowCount: 0 };
    }

    // Everything below operates on the runs that passed the probe, never the caller's
    // full list — that binding is the whole point of the change above. Shadowing the
    // parameter deliberately: a later edit that reaches for `testRunIds` inside the
    // aggregation would otherwise silently reintroduce the batch-wide DELETE.
    const targetRunIds = runsWithMetrics;

    // Build parameterized query placeholders
    const placeholders = targetRunIds.map((_, i) => `$${i + 1}`).join(', ');

    const aggregationSQL = `
      -- The runs being aggregated, read once. Everything below joins this
      -- instead of test_runs, so the table is scanned a single time.
      WITH run_orgs AS MATERIALIZED (
          SELECT test_run_id, organization_id, team_id, start_time
          FROM test_runs
          WHERE test_run_id IN (${placeholders})
      ),

      -- Dashboards whose metrics belong in this run's statistics, resolved ONCE.
      -- This used to be two correlated IN (...) subqueries on tr.organization_id
      -- inside the ds_metrics filter below, so Postgres re-ran them across the
      -- metric scan — millions of rows against a few hundred dashboards. Both
      -- MATERIALIZED keywords are load-bearing: without them the planner is free
      -- to inline these back into the scan and the correlation returns.
      -- (The organization_id IS NULL arms look dead under Phase 4, but a
      -- deployment mid-backfill still has null-org rows and dropping them here
      -- would silently drop their metrics from every statistic.)
      allowed_dashboards AS MATERIALIZED (
          SELECT ad.id
          FROM application_dashboards ad
          WHERE ad.organization_id IN (SELECT organization_id FROM run_orgs)
             OR ad.organization_id IS NULL
          UNION
          SELECT dq.application_dashboard_id
          FROM dynatrace_queries dq
          WHERE dq.organization_id IN (SELECT organization_id FROM run_orgs)
             OR dq.organization_id IS NULL
      ),

      metrics_filtered AS (
          SELECT
              m.test_run_id,
              m.application_dashboard_id,
              m.panel_id,
              m.metric_name,
              m.value,
              m.time,
              m.dashboard_uid,
              m.panel_title,
              m.dashboard_label,
              m.benchmark_ids[1] as first_benchmark_id,
              m.unit,
              tr.organization_id,
              tr.team_id,
              m.metrics_source_id
          FROM ds_metrics m
          INNER JOIN run_orgs tr ON m.test_run_id = tr.test_run_id
          WHERE m.test_run_id IN (${placeholders})
            AND m.ramp_up = false
            AND m.value IS NOT NULL
            AND m.application_dashboard_id IN (SELECT id FROM allowed_dashboards)
      ),

      statistics_aggregated AS (
          SELECT
              test_run_id,
              application_dashboard_id,
              panel_id,
              metric_name,

              COUNT(*) as count,
              AVG(value) as mean,
              MIN(value) as min_value,
              MAX(value) as max_value,
              STDDEV_POP(value) as std_dev,

              -- Persisted alongside pct_agg so ControlGroupStatisticsPipeline can
              -- recombine pooled population mean and std_dev exactly across
              -- per-run rows without rescanning ds_metrics (issue #289).
              -- Sketches don't preserve enough info to recover STDDEV_POP across
              -- the pooled distribution, so we keep the two raw moments.
              SUM(value::double precision) as sum_value,
              SUM((value::double precision) * (value::double precision)) as sum_sq_value,

              -- TimescaleDB percentile_agg builds a uddsketch sketch in O(n).
              -- Stored on ds_metric_statistics so ControlGroupStatisticsPipeline
              -- can pool across control runs via rollup(pct_agg) (issue #289)
              -- instead of re-scanning ds_metrics for every re-evaluate.
              percentile_agg(value) as pct_agg,

              -- TimescaleDB last(): value at the greatest time, in the pass that is
              -- already running. This used to be a LEFT JOIN LATERAL on ds_metrics in
              -- final_statistics, one probe per output group. ds_metrics is compressed
              -- with segmentby=test_run_id, so a compressed chunk cannot narrow a probe
              -- by application_dashboard_id/panel_id/metric_name. TimescaleDB does push
              -- ORDER BY time DESC LIMIT 1 into the columnar scan, so a metric still
              -- reporting at the end of the run was found in the first batch (~0.04ms);
              -- the cost is metrics that STOP reporting early, which force a deep
              -- backward walk (~0.97ms, 24x worse). Enough of those and the aggregation
              -- exceeds ANALYTICS_STATEMENT_TIMEOUT_MS: 60.1s measured over 12,370
              -- groups, against 1.19s for the aggregate below.
              --
              -- The FILTER is not decoration: every other aggregate here skips NULLs by
              -- definition, but last() returns the value AT the greatest time even when
              -- that value is NULL. The lateral carried its own "value IS NOT NULL", so
              -- this keeps the predicate local instead of leaning on metrics_filtered
              -- forty lines above.
              last(value, time) FILTER (WHERE value IS NOT NULL) as last_value,

              -- n_missing: always 0 here because WHERE filters out NULLs, but kept
              -- for schema compatibility. Downstream code may re-count from raw data.
              COUNT(CASE WHEN value IS NULL THEN 1 END) as n_missing,
              COUNT(CASE WHEN value > 0 THEN 1 END) as n_non_zero,

              -- These columns are identical within each group; MIN() is just a
              -- deterministic way to pick one value without a window function.
              MIN(unit) as unit,
              MIN(organization_id::text)::uuid as organization_id,
              MIN(team_id::text)::uuid as team_id,
              MIN(dashboard_uid) as dashboard_uid,
              MIN(panel_title) as panel_title,
              MIN(dashboard_label) as dashboard_label,
              MIN(first_benchmark_id::text)::uuid as first_benchmark_id,
              MIN(metrics_source_id::text)::uuid as metrics_source_id

          FROM metrics_filtered
          GROUP BY
              test_run_id,
              application_dashboard_id,
              panel_id,
              metric_name
      ),

      final_statistics AS (
          SELECT
              sa.test_run_id,
              sa.application_dashboard_id,
              sa.panel_id,
              sa.metric_name,

              CASE
                  WHEN sa.first_benchmark_id IS NOT NULL
                  THEN sa.first_benchmark_id::uuid
                  ELSE NULL
              END as benchmark_id,

              sa.dashboard_uid,
              COALESCE(sa.dashboard_label, 'missing') as dashboard_label,
              COALESCE(sa.panel_title, 'missing') as panel_title,
              sa.unit,

              sa.count,
              sa.mean,
              sa.sum_value,
              sa.sum_sq_value,
              sa.pct_agg,
              -- Extract percentiles from single-pass aggregation
              approx_percentile(0.50, sa.pct_agg) as median,
              sa.min_value,
              sa.max_value,
              sa.std_dev,
              sa.last_value,

              sa.n_missing,
              sa.n_non_zero,

              approx_percentile(0.10, sa.pct_agg) as q10,
              approx_percentile(0.25, sa.pct_agg) as q25,
              approx_percentile(0.75, sa.pct_agg) as q75,
              approx_percentile(0.90, sa.pct_agg) as q90,
              approx_percentile(0.95, sa.pct_agg) as q95,
              approx_percentile(0.99, sa.pct_agg) as q99,

              -- Build JSON from same single-pass aggregation (no duplicate computation)
              jsonb_build_object(
                  'p10', approx_percentile(0.10, sa.pct_agg),
                  'p25', approx_percentile(0.25, sa.pct_agg),
                  'p50', approx_percentile(0.50, sa.pct_agg),
                  'p75', approx_percentile(0.75, sa.pct_agg),
                  'p90', approx_percentile(0.90, sa.pct_agg),
                  'p95', approx_percentile(0.95, sa.pct_agg),
                  'p99', approx_percentile(0.99, sa.pct_agg)
              ) as percentiles,

              -- IQR (Interquartile Range): robust measure of spread, less sensitive
              -- to outliers than std_dev. Used by ADAPT's IQR threshold check.
              (approx_percentile(0.75, sa.pct_agg) - approx_percentile(0.25, sa.pct_agg)) as iqr,
              -- IDR (Interdecile Range): captures 80% of the distribution (p10..p90),
              -- useful for understanding tail behavior in response time metrics.
              (approx_percentile(0.90, sa.pct_agg) - approx_percentile(0.10, sa.pct_agg)) as idr,

              -- Constant ⇔ min = max. Derived here from the aggregates already
              -- projected above rather than as a fourth aggregate expression, which
              -- is what COUNT(DISTINCT value) used to be — that needed its own
              -- per-group sort; this needs nothing.
              (sa.min_value = sa.max_value) as is_constant,
              (sa.min_value = sa.max_value) as constant_value,  -- alias kept for backward compat
              (sa.count = sa.n_missing) as all_missing,

              CASE
                  WHEN sa.count > 0 THEN (sa.n_missing::float / sa.count::float) * 100.0
                  ELSE 0.0
              END as pct_missing,

              CASE
                  WHEN sa.count > 0 THEN (sa.n_missing::float / sa.count::float) * 100.0
                  ELSE 0.0
              END as missing_percentage,

              NOW() as updated_at,
              tr.start_time as test_run_start,
              sa.organization_id,
              sa.team_id,
              'worker-pipeline' as created_by,
              'worker-pipeline' as updated_by,
              sa.metrics_source_id

          FROM statistics_aggregated sa
          LEFT JOIN run_orgs tr ON tr.test_run_id = sa.test_run_id
      )

      INSERT INTO ds_metric_statistics (
          test_run_id,
          application_dashboard_id,
          panel_id,
          metric_name,
          benchmark_id,
          dashboard_uid,
          dashboard_label,
          panel_title,
          unit,
          count,
          mean,
          median,
          min_value,
          max_value,
          std_dev,
          last_value,
          n_missing,
          n_non_zero,
          q10,
          q25,
          q75,
          q90,
          q95,
          q99,
          percentiles,
          iqr,
          idr,
          is_constant,
          constant_value,
          all_missing,
          pct_missing,
          missing_percentage,
          updated_at,
          test_run_start,
          organization_id,
          team_id,
          created_by,
          updated_by,
          metrics_source_id,
          pct_agg,
          sum_value,
          sum_sq_value
      )
      SELECT
          test_run_id,
          application_dashboard_id,
          panel_id,
          metric_name,
          benchmark_id,
          dashboard_uid,
          dashboard_label,
          panel_title,
          unit,
          count,
          mean,
          median,
          min_value,
          max_value,
          std_dev,
          last_value,
          n_missing,
          n_non_zero,
          q10,
          q25,
          q75,
          q90,
          q95,
          q99,
          percentiles,
          iqr,
          idr,
          is_constant,
          constant_value,
          all_missing,
          pct_missing,
          missing_percentage,
          updated_at,
          test_run_start,
          organization_id,
          team_id,
          created_by,
          updated_by,
          metrics_source_id,
          pct_agg,
          sum_value,
          sum_sq_value
      FROM final_statistics
    `;

    // Step 1: DELETE existing statistics for these test runs INSIDE the transaction
    // This prevents duplicate key constraint violations when re-analyzing test runs
    this.logger.info(`🧹 Deleting existing statistics for re-analysis...`);

    const deleteSQL = `
      DELETE FROM ds_metric_statistics
      WHERE test_run_id IN (${placeholders})
    `;

    const deleteResult = await manager.query(deleteSQL, targetRunIds);
    // TypeORM surfaces a DELETE as [rows, rowCount]; `.rowCount` on that array is
    // always undefined, so the old log claimed 0 even when rows were removed.
    const deletedRows = Array.isArray(deleteResult) ? (deleteResult[1] ?? undefined) : undefined;

    this.logger.info(
      `✅ Deleted ${deletedRows ?? 'an unknown number of'} existing statistic records for test runs: ${targetRunIds.join(', ')}`
    );

    // Step 2: INSERT new statistics (no ON CONFLICT needed since we deleted existing records)
    this.logger.info(`🚀 Executing statistics aggregation INSERT...`);

    await manager.query(aggregationSQL, targetRunIds);

    // For CTE-based INSERT...SELECT, TypeORM doesn't return rowCount reliably
    // Verify the actual count from the database
    const actualCountQuery = `
      SELECT COUNT(*)::integer as count
      FROM ds_metric_statistics
      WHERE test_run_id IN (${placeholders})
    `;
    const actualCountResult = await manager.query(actualCountQuery, targetRunIds);
    const actualCount = actualCountResult[0]?.count || 0;

    this.logger.info(
      `✅ Statistics aggregation completed: deleted ${deletedRows ?? 'an unknown number of'}, wrote ${actualCount} statistic records`
    );

    if (actualCount === 0) {
      // The EXISTS probe above said there was data, so an empty result is a real
      // problem (org-scoping dropped every dashboard, most likely) — not "nothing
      // to do", which returned earlier.
      this.logger.warn('⚠️  Metrics exist for these test runs but no statistics were written - possible data issue');
    }

    return { success: true, rowCount: actualCount };
  }
}