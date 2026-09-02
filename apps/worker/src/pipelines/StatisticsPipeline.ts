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
      EXTRACT(EPOCH FROM (m.time - tr.start_time)) < COALESCE(tr.ramp_up, 0)
      OR (
        COALESCE(tr.ramp_down, 0) > 0
        AND EXTRACT(EPOCH FROM (m.time - tr.start_time))
            > EXTRACT(EPOCH FROM (tr.end_time - tr.start_time)) - COALESCE(tr.ramp_down, 0)
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

      if (staleRuns.length > 0) {
        // Same shape, and the same fix, as the force-refetch guard in
        // simple-orchestrate-reevaluate-batch.ts: decompress the affected chunks
        // up front, outside the transaction, so the UPDATE never has to do it as
        // DML. The compression policy recompresses them on its next pass.
        // Number.isFinite guard: an unparseable bound would become NaN here and
        // reach decompressChunksForRange as an Invalid Date, which Postgres would
        // reject mid-flight. The SQL above already requires both to be NOT NULL,
        // so this only ever drops a genuinely malformed row.
        const bounds = staleRuns
          .flatMap((r) => [new Date(r.from).getTime(), new Date(r.to).getTime()])
          .filter((t) => Number.isFinite(t));
        if (bounds.length > 0) {
          await this.db.decompressChunksForRange(
            'ds_metrics',
            new Date(Math.min(...bounds)),
            new Date(Math.max(...bounds))
          );
        }
      }

      const result = await this.withAnalyticsTransaction(async (manager: EntityManager) => {
        if (staleRuns.length > 0) {
          await this.refreshRampUpFlags(manager, staleRuns.map((r) => r.testRunId));
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
   * run's current analysis offsets — and over what time range.
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

    // EXISTS short-circuits on the first disagreeing row, so a run that DOES
    // need the update is cheap to detect; a run that does not costs one scan.
    const sql = `
      SELECT tr.test_run_id, tr.start_time, tr.end_time
      FROM test_runs tr
      WHERE tr.test_run_id IN (${placeholders})
        AND tr.start_time IS NOT NULL
        AND tr.end_time IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM ds_metrics m
          WHERE m.test_run_id = tr.test_run_id
            AND m.ramp_up IS DISTINCT FROM ${RAMP_UP_EXPR}
        )
    `;

    const rows: Array<{ test_run_id: string; start_time: Date; end_time: Date }> =
      await this.db.query(sql, testRunIds);

    return (rows ?? []).map((r) => ({
      testRunId: r.test_run_id,
      from: r.start_time,
      to: r.end_time,
    }));
  }

  private async refreshRampUpFlags(
    manager: EntityManager,
    testRunIds: string[]
  ): Promise<void> {
    const placeholders = testRunIds.map((_, i) => `$${i + 1}`).join(', ');

    const sql = `
      UPDATE ds_metrics m
      SET ramp_up = ${RAMP_UP_EXPR}
      FROM test_runs tr
      WHERE m.test_run_id = tr.test_run_id
        AND m.test_run_id IN (${placeholders})
        AND tr.start_time IS NOT NULL
        AND tr.end_time IS NOT NULL
        AND m.ramp_up IS DISTINCT FROM ${RAMP_UP_EXPR}
    `;

    const result = await manager.query(sql, testRunIds);
    // pg returns [rows, rowCount] for UPDATE via node-postgres; TypeORM's raw
    // query surfaces an array whose affected count we log best-effort.
    const affected = Array.isArray(result) ? (result[1] ?? undefined) : undefined;
    this.logger.info(
      `🕒 Refreshed ramp_up flags against current analysis offsets for ${testRunIds.length} run(s)${
        affected !== undefined ? ` (${affected} rows changed)` : ''
      }`
    );
  }

  private async aggregateMetricStatistics(
    manager: EntityManager,
    testRunIds: string[]
  ): Promise<{ success: boolean; rowCount: number }> {

    this.logger.info(`📊 Aggregating statistics for ${testRunIds.length} test run(s): ${testRunIds.join(', ')}`);

    // Build parameterized query placeholders
    const placeholders = testRunIds.map((_, i) => `$${i + 1}`).join(', ');

    // First, check if there are any metrics to aggregate
    const metricsCountQuery = `
      SELECT COUNT(*) as count
      FROM ds_metrics
      WHERE test_run_id IN (${placeholders})
        AND ramp_up = false
        AND value IS NOT NULL
    `;

    const metricsCount = await manager.query(metricsCountQuery, testRunIds);
    const totalMetrics = parseInt(metricsCount[0]?.count || '0', 10);

    this.logger.info(`🔍 Found ${totalMetrics} metrics to aggregate (ramp_up=false, value IS NOT NULL)`);

    if (totalMetrics === 0) {
      this.logger.warn(`⚠️ No metrics found for test runs: ${testRunIds.join(', ')}`);
      this.logger.warn('💡 This could mean:');
      this.logger.warn('   1. MetricsPipeline hasn\'t run yet for these test runs');
      this.logger.warn('   2. All metrics have ramp_up=true (no steady-state data)');
      this.logger.warn('   3. All metric values are NULL');
      return { success: true, rowCount: 0 };
    }

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

    const deleteResult = await manager.query(deleteSQL, testRunIds);
    // TypeORM surfaces a DELETE as [rows, rowCount]; `.rowCount` on that array is
    // always undefined, so the old log claimed 0 even when rows were removed.
    const deletedRows = Array.isArray(deleteResult) ? (deleteResult[1] ?? undefined) : undefined;

    this.logger.info(
      `✅ Deleted ${deletedRows ?? 'an unknown number of'} existing statistic records for test runs: ${testRunIds.join(', ')}`
    );

    // Step 2: INSERT new statistics (no ON CONFLICT needed since we deleted existing records)
    this.logger.info(`🚀 Executing statistics aggregation INSERT...`);

    // First, count how many unique metrics we'll aggregate
    const uniqueMetricsQuery = `
      SELECT COUNT(*)::integer as expected_rows
      FROM (
        SELECT DISTINCT test_run_id, application_dashboard_id, panel_id, metric_name
        FROM ds_metrics
        WHERE test_run_id IN (${placeholders})
          AND ramp_up = false
          AND value IS NOT NULL
      ) d
    `;
    // Same number, reached without a sort. COUNT(DISTINCT (composite)) cannot be
    // parallelised and spills an external sort of anonymous ROW() values — 4.7s
    // and ~370MB of temp I/O on a 1.58M-row run, against 1.6s for this form —
    // and it exists only to produce the log line and the mismatch warning below.

    const expectedCount = await manager.query(uniqueMetricsQuery, testRunIds);
    const expectedRows = expectedCount[0]?.expected_rows || 0;

    this.logger.info(`📊 Aggregation will process ${expectedRows} unique metrics`);

    await manager.query(aggregationSQL, testRunIds);

    // For CTE-based INSERT...SELECT, TypeORM doesn't return rowCount reliably
    // Verify the actual count from the database
    const actualCountQuery = `
      SELECT COUNT(*)::integer as count
      FROM ds_metric_statistics
      WHERE test_run_id IN (${placeholders})
    `;
    const actualCountResult = await manager.query(actualCountQuery, testRunIds);
    const actualCount = actualCountResult[0]?.count || 0;

    this.logger.info(`✅ Statistics aggregation completed`);
    this.logger.info(`   🧹 Deleted: ${deletedRows ?? 'an unknown number of'} existing records (allowing re-analysis)`);
    this.logger.info(`   📝 Expected: ${expectedRows} unique metrics`);
    this.logger.info(`   📝 Actual: ${actualCount} statistic records in database`);
    this.logger.info(`   📊 Source: ${totalMetrics} total data points`);

    if (actualCount === 0 && expectedRows > 0) {
      this.logger.warn(`⚠️  Expected ${expectedRows} statistics but found 0 in database - possible data issue`);
    } else if (actualCount !== expectedRows) {
      this.logger.warn(`⚠️  Count mismatch: expected ${expectedRows}, found ${actualCount} in database`);
    } else {
      this.logger.info(`✅ Successfully processed all ${actualCount} statistics`);
    }

    return { success: true, rowCount: actualCount };
  }
}