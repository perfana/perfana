import { BasePipelineTypeORM } from './BasePipelineTypeORM.js';
import { PipelineResult } from '../types/pipeline.js';
import { EntityManager } from 'typeorm';

export interface StatisticsInput {
  testRunIds: string[];
}

export interface MetricStatisticsResult {
  test_run_id: string;
  application_dashboard_id: string;
  panel_id: number;
  metric_name: string;
  count: number;
  mean: number;
  median: number;
  min_value: number;
  max_value: number;
  std_dev: number;
  last_value: number;
  n_missing: number;
  n_non_zero: number;
  q10: number;
  q25: number;
  q75: number;
  q90: number;
  q95: number;
  q99: number;
  percentiles: Record<string, number>;
  iqr: number;
  idr: number;
  is_constant: boolean;
  all_missing: boolean;
  pct_missing: number;
  dashboard_uid: string;
  dashboard_label: string;
  panel_title: string;
  unit?: string;
  benchmark_ids?: string[];
  updated_at: Date;
  test_run_start?: Date;
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
 *        │                      - Auxiliary: n_missing, n_non_zero, distinct_count
 *        ▼
 *   final_statistics          Derives remaining columns from the aggregates:
 *        │                      - Percentiles via approx_percentile(p, pct_agg):
 *        │                          median (p50), q10, q25, q75, q90, q95, q99
 *        │                      - IQR = q75 - q25  (interquartile range — robust spread)
 *        │                      - IDR = q90 - q10  (interdecile range — wider robust spread)
 *        │                      - is_constant: true when all values are identical (distinct_count=1)
 *        │                      - all_missing: true when every observation is NULL
 *        │                      - pct_missing: percentage of NULL observations
 *        │                      - last_value: value at the latest timestamp (via LATERAL subquery)
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
 * - is_constant:  All observed values are identical (distinct_count = 1).
 *                 Downstream ADAPT treats these specially since std_dev = 0
 *                 makes ratio-based thresholds meaningless.
 * - all_missing:  Every observation in the group is NULL (count = n_missing).
 *                 The metric exists in the dashboard definition but produced no
 *                 usable data — ADAPT labels these "incomparable".
 */
export class StatisticsPipeline extends BasePipelineTypeORM {

  validateInput(input: any): boolean {
    if (!input || typeof input !== 'object') {return false;}
    const typedInput = input as any;
    return Array.isArray(typedInput.testRunIds) &&
           typedInput.testRunIds.length > 0 &&
           typedInput.testRunIds.every((id: any) => typeof id === 'string');
  }

  async execute(input: any): Promise<PipelineResult> {
    const startTime = Date.now();

    if (!this.validateInput(input)) {
      return this.createErrorResult('Invalid input: expected { testRunIds: string[] }', 'INVALID_INPUT');
    }

    const { testRunIds } = input as StatisticsInput;

    try {
      this.logger.info(`Starting statistics aggregation for test runs: ${testRunIds.join(', ')}`);

      // Cleanup stale data before processing
      await this.cleanupStaleApplicationDashboards(['ds_metric_statistics']);

      const result = await this.withAnalyticsTransaction(async (manager: EntityManager) => {
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
      WITH metrics_filtered AS (
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
          INNER JOIN test_runs tr ON m.test_run_id = tr.test_run_id
          WHERE m.test_run_id IN (${placeholders})
            AND m.ramp_up = false
            AND m.value IS NOT NULL
            AND (
                m.application_dashboard_id IN (
                  SELECT id FROM application_dashboards ad
                  WHERE ad.organization_id = tr.organization_id OR ad.organization_id IS NULL
                )
                OR m.application_dashboard_id IN (
                  SELECT DISTINCT application_dashboard_id FROM dynatrace_queries dq
                  WHERE dq.organization_id = tr.organization_id OR dq.organization_id IS NULL
                )
            )
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

              -- TimescaleDB percentile_agg builds a t-digest sketch in O(n).
              -- All percentile extractions in final_statistics share this single sketch.
              percentile_agg(value) as pct_agg,

              -- Track max timestamp so the LATERAL join in final_statistics can
              -- efficiently fetch last_value without ARRAY_AGG + sort.
              MAX(time) as max_time,

              -- n_missing: always 0 here because WHERE filters out NULLs, but kept
              -- for schema compatibility. Downstream code may re-count from raw data.
              COUNT(CASE WHEN value IS NULL THEN 1 END) as n_missing,
              COUNT(CASE WHEN value > 0 THEN 1 END) as n_non_zero,

              -- distinct_count = 1 → metric is constant (used for is_constant flag)
              COUNT(DISTINCT value) as distinct_count,
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
              -- Extract percentiles from single-pass aggregation
              approx_percentile(0.50, sa.pct_agg) as median,
              sa.min_value,
              sa.max_value,
              sa.std_dev,
              -- last_value via LATERAL subquery (avoids ARRAY_AGG of entire column)
              lv.value as last_value,

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

              (sa.distinct_count = 1) as is_constant,
              (sa.distinct_count = 1) as constant_value,  -- alias kept for backward compat
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
          LEFT JOIN test_runs tr ON tr.test_run_id = sa.test_run_id
          LEFT JOIN LATERAL (
              SELECT mf2.value
              FROM ds_metrics mf2
              WHERE mf2.test_run_id = sa.test_run_id
                AND mf2.application_dashboard_id = sa.application_dashboard_id
                AND mf2.panel_id = sa.panel_id
                AND mf2.metric_name = sa.metric_name
                AND mf2.ramp_up = false
                AND mf2.value IS NOT NULL
              ORDER BY mf2.time DESC
              LIMIT 1
          ) lv ON true
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
          metrics_source_id
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
          metrics_source_id
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
    const deletedRows = (deleteResult).rowCount || 0;

    this.logger.info(`✅ Deleted ${deletedRows} existing statistic records for test runs: ${testRunIds.join(', ')}`);

    // Step 2: INSERT new statistics (no ON CONFLICT needed since we deleted existing records)
    this.logger.info(`🚀 Executing statistics aggregation INSERT...`);

    // First, count how many unique metrics we'll aggregate
    const uniqueMetricsQuery = `
      SELECT COUNT(DISTINCT (test_run_id, application_dashboard_id, panel_id, metric_name))::integer as expected_rows
      FROM ds_metrics
      WHERE test_run_id IN (${placeholders})
        AND ramp_up = false
        AND value IS NOT NULL
    `;

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
    this.logger.info(`   🧹 Deleted: ${deletedRows} existing records (allowing re-analysis)`);
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