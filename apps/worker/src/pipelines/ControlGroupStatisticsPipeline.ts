import { BasePipelineTypeORM } from './BasePipelineTypeORM.js';
import { PipelineResult } from '../types/pipeline.js';
import { EntityManager } from 'typeorm';

export interface ControlGroupStatisticsInput {
  controlGroupIds?: string[];  // Optional: specific control groups to process
  testRunIds?: string[];        // Optional: process control groups for these test runs
}

/**
 * ControlGroupStatisticsPipeline — Baseline Statistics for ADAPT Comparison
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * What is a Control Group?
 * ──────────────────────────────────────────────────────────────────────────────
 * A control group is a set of recent, passing test runs that share the same
 * (system_under_test, workload, test_environment) tuple. It represents the
 * "known-good baseline" that ADAPT compares a new test run against to detect
 * performance regressions.
 *
 * The ControlGroupsPipeline (separate) selects which test runs form the control
 * group. This pipeline then aggregates their raw metric data into a single set
 * of baseline statistics per metric, stored in `ds_control_group_statistics`.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * Aggregation Methodology
 * ──────────────────────────────────────────────────────────────────────────────
 * Unlike StatisticsPipeline (which computes stats per individual test run), this
 * pipeline pools ALL data points from ALL control runs into a single
 * distribution per metric. This means:
 *
 *   - mean, std_dev, percentiles are computed over the union of all data points
 *     across control runs (not averaged across per-run statistics)
 *   - This yields more robust estimates because the sample size is larger
 *   - The IQR used by ADAPT thresholds reflects the true variability across runs,
 *     not just within-run noise
 *
 * Metadata fields (last_value, count, n_missing, etc.) ARE averaged across
 * per-run statistics since they describe per-run characteristics.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * Fast path vs. legacy raw-scan path (issue #289)
 * ──────────────────────────────────────────────────────────────────────────────
 * Until #289, this pipeline pooled `percentile_agg(value)` directly from
 * `ds_metrics` raw across every control run. On a populated lab DB that's
 * 100+ s of cold reads per re-evaluate, contending with autovacuum on the
 * same hypertable chunk.
 *
 * `StatisticsPipeline` (Step 6, runs before this Step 9) already builds a
 * per-run `percentile_agg(value)` sketch for every (test_run, dashboard,
 * panel, metric) tuple to derive the scalar quantiles in `ds_metric_statistics`.
 * Since #289 we persist that sketch in the new `pct_agg` column alongside
 * `sum_value` and `sum_sq_value`, which means the pooled distribution can be
 * reconstructed via `rollup(pct_agg)` over ~N pre-aggregated rows instead of
 * ~N × ~70K raw `ds_metrics` rows.
 *
 * The fast path is taken whenever every control run already has the sketch
 * persisted. If any control run was statisticed before #289, `pct_agg` will
 * be NULL on its rows and we fall back to the legacy raw-scan query.
 * Re-running `StatisticsPipeline` on those runs backfills the sketch and
 * graduates them onto the fast path.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * SQL CTE Chain Overview (fast path)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *   per_run_pooled             SUM(sum_value), SUM(sum_sq_value), SUM(count),
 *        │                     MIN(min_value), MAX(max_value),
 *        │                     rollup(pct_agg) over the per-run rows.
 *        │                     One row per (dashboard, panel, metric).
 *        │
 *   raw_metrics_aggregated     Derive the pooled mean / std_dev exactly from
 *        │                     the recombined moments (sketches don't preserve
 *        │                     enough info for STDDEV_POP) and expose the
 *        │                     pooled sketch as pct_agg. Naming preserved so
 *        │                     the downstream final_stats CTE is unchanged.
 *        │
 *   control_metrics_metadata   DISTINCT ON per-metric metadata (dashboard_uid,
 *        │                     panel_title, unit, benchmark_id, etc.) from
 *        │                     ds_metric_statistics.
 *        │
 *   metadata_aggregated        AVG of per-run counters (last_value, count,
 *        │                     n_missing, n_non_zero, pct_missing) across the
 *        │                     control runs. Collects distinct benchmark_ids.
 *        │
 *   final_stats                JOIN the three CTEs (small: ~N metrics each),
 *        │                     extract approximate percentiles from the pooled
 *        │                     sketch, compute IQR and IDR.
 *        ▼
 *   INSERT INTO ds_control_group_statistics  (UPSERT on conflict)
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * DISTINCT ON Logic
 * ──────────────────────────────────────────────────────────────────────────────
 * `control_metrics_metadata` uses DISTINCT ON (dashboard_id, panel_id, metric_name)
 * with ORDER BY ... dashboard_uid NULLS LAST, metrics_source_id NULLS LAST.
 * This deterministically picks the metadata row that has the most complete
 * information (non-null dashboard_uid and metrics_source_id preferred).
 */
export class ControlGroupStatisticsPipeline extends BasePipelineTypeORM {
  validateInput(input: any): boolean {
    if (!input || typeof input !== 'object') {return false;}
    const typedInput = input as any;

    // Must have either controlGroupIds or testRunIds
    const hasControlGroupIds = Array.isArray(typedInput.controlGroupIds) &&
                              typedInput.controlGroupIds.length > 0;
    const hasTestRunIds = Array.isArray(typedInput.testRunIds) &&
                         typedInput.testRunIds.length > 0;

    return hasControlGroupIds || hasTestRunIds;
  }

  async execute(input: any): Promise<PipelineResult> {
    const startTime = Date.now();

    if (!this.validateInput(input)) {
      return this.createErrorResult(
        'Invalid input: expected { controlGroupIds?: string[], testRunIds?: string[] }',
        'INVALID_INPUT'
      );
    }

    const { controlGroupIds, testRunIds } = input as ControlGroupStatisticsInput;

    try {
      // If testRunIds provided, use them as controlGroupIds (they're the same in Python pattern)
      const groupIds = controlGroupIds || testRunIds || [];

      this.logger.info(`Starting control group statistics calculation for ${groupIds.length} groups`);

      // Cleanup stale data before processing
      await this.cleanupStaleApplicationDashboards(['ds_control_group_statistics']);

      const result = await this.withAnalyticsTransaction(async (manager: EntityManager) => {
        // Process statistics for each control group
        let totalStatisticsCreated = 0;

        for (const controlGroupId of groupIds) {
          const statsCount = await this.calculateStatisticsForControlGroup(manager, controlGroupId);
          totalStatisticsCreated += statsCount;
        }

        return { totalStatisticsCreated };
      });

      const duration = Date.now() - startTime;
      this.logPerformance('control-group-statistics', startTime, {
        controlGroups: groupIds.length,
        statisticsCreated: result.totalStatisticsCreated
      });

      this.logger.info(`✅ Control group statistics completed: ${result.totalStatisticsCreated} statistics created for ${groupIds.length} control groups in ${duration}ms`);

      return this.createSuccessResult({
        statisticsCreated: result.totalStatisticsCreated,
        controlGroups: groupIds.length
      }, duration);

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logError(error as Error, { controlGroupIds, testRunIds });
      return this.createErrorResult(
        error as Error,
        'CONTROL_GROUP_STATISTICS_FAILED',
        { controlGroupIds, testRunIds },
        duration
      );
    }
  }

  /**
   * Calculate statistics for a single control group
   * This aggregates metrics from all control test runs for each unique metric
   */
  private async calculateStatisticsForControlGroup(
    manager: EntityManager,
    controlGroupId: string
  ): Promise<number> {

    this.logger.info(`📊 Processing control group: ${controlGroupId}`);

    // First get the control group information
    const controlGroupQuery = `
      SELECT
        control_group_id,
        system_under_test_id,
        workload,
        test_environment,
        test_runs,
        n_test_runs,
        organization_id,
        team_id
      FROM ds_control_groups
      WHERE control_group_id = $1
    `;

    const cgResult = await manager.query(controlGroupQuery, [controlGroupId]);
    if (cgResult.length === 0) {
      this.logger.warn(`⚠️ Control group not found: ${controlGroupId}`);
      this.logger.warn('💡 This could mean:');
      this.logger.warn('   1. ControlGroupsPipeline hasn\'t run yet for this test run');
      this.logger.warn('   2. Control group was deleted');
      this.logger.warn('   3. Incorrect control_group_id provided');
      return 0;
    }

    const controlGroup = cgResult[0];
    this.logger.info(`✅ Found control group: ${controlGroupId}`);
    this.logger.info(`   📝 System: ${controlGroup.system_under_test_id}`);
    this.logger.info(`   📝 Environment: ${controlGroup.test_environment}`);
    this.logger.info(`   📝 Workload: ${controlGroup.workload}`);
    this.logger.info(`   📝 Control runs: ${controlGroup.n_test_runs}`);

    // If no control runs, skip statistics calculation
    if (!controlGroup.test_runs || controlGroup.test_runs.length === 0) {
      this.logger.warn(`⚠️ Control group ${controlGroupId} has no control runs`);
      this.logger.warn('💡 This could mean:');
      this.logger.warn('   1. No previous test runs exist for this configuration');
      this.logger.warn('   2. Control group was just created (first test run)');
      return 0;
    }

    this.logger.info(`🔍 Control runs to aggregate: ${controlGroup.test_runs.join(', ')}`);

    // Check if there are metric statistics for the control runs
    const metricStatsCheckQuery = `
      SELECT COUNT(*) as count
      FROM ds_metric_statistics
      WHERE test_run_id = ANY($1::varchar[])
    `;
    const metricStatsCount = await manager.query(metricStatsCheckQuery, [controlGroup.test_runs]);
    const totalMetricStats = parseInt(metricStatsCount[0]?.count || '0', 10);

    this.logger.info(`🔍 Found ${totalMetricStats} metric statistics across control runs`);

    if (totalMetricStats === 0) {
      this.logger.warn(`⚠️ No metric statistics found for control runs`);
      this.logger.warn('💡 This could mean:');
      this.logger.warn('   1. StatisticsPipeline hasn\'t run for the control test runs');
      this.logger.warn('   2. Control test runs have no metrics data');
      return 0;
    }


    // Decide which path to use: the fast `rollup(pct_agg)` path requires every
    // control run's `ds_metric_statistics` rows to carry the sketch persisted
    // by migration 1778900000000. Any NULL `pct_agg` means the row was written
    // before #289 — fall back to the legacy raw-scan query so we still produce
    // correct baseline stats. Re-running StatisticsPipeline on those runs
    // backfills the sketch and graduates them onto the fast path.
    const sketchAvailabilityQuery = `
      SELECT COUNT(*) FILTER (WHERE pct_agg IS NULL)::int AS missing_sketches
      FROM ds_metric_statistics
      WHERE test_run_id = ANY($1::varchar[])
    `;
    const sketchAvailability = await manager.query(sketchAvailabilityQuery, [controlGroup.test_runs]);
    const missingSketches = parseInt(sketchAvailability[0]?.missing_sketches ?? '0', 10);
    const useFastPath = missingSketches === 0;

    if (useFastPath) {
      this.logger.info(`⚡ Fast path: pooling ${totalMetricStats} per-run sketches via rollup(pct_agg)`);
    } else {
      this.logger.warn(`🐢 Legacy path: ${missingSketches} ds_metric_statistics rows missing pct_agg — re-run StatisticsPipeline on the control runs to enable the fast path (#289)`);
    }

    // Fast path — pool persisted per-run sketches with `rollup(pct_agg)` and
    // recombine population mean / std_dev exactly from sum / sum_sq / count.
    // ~10 control runs × ~795 metric rows ≈ 8 K rows scanned, vs. ~10 × ~70 K
    // raw `ds_metrics` rows × ~50 metrics on the legacy path.
    const fastPathLeadingCtes = `
      WITH per_run_pooled AS (
        SELECT
          ms.application_dashboard_id,
          ms.panel_id,
          ms.metric_name,
          SUM(ms.sum_value)                        AS pooled_sum,
          SUM(ms.sum_sq_value)                     AS pooled_sum_sq,
          SUM(ms.count)                            AS pooled_count,
          MIN(ms.min_value)                        AS pooled_min,
          MAX(ms.max_value)                        AS pooled_max,
          rollup(ms.pct_agg)                       AS pct_agg
        FROM ds_metric_statistics ms
        INNER JOIN test_runs tr ON ms.test_run_id = tr.test_run_id
        WHERE ms.test_run_id = ANY($2::varchar[])
          AND ms.pct_agg IS NOT NULL
          AND (
            ms.application_dashboard_id IN (
              SELECT id FROM application_dashboards ad
              WHERE ad.organization_id = tr.organization_id OR ad.organization_id IS NULL
            )
            OR ms.application_dashboard_id IN (
              SELECT DISTINCT application_dashboard_id FROM dynatrace_queries dq
              WHERE dq.organization_id = tr.organization_id OR dq.organization_id IS NULL
            )
          )
        GROUP BY ms.application_dashboard_id, ms.panel_id, ms.metric_name
      ),

      raw_metrics_aggregated AS (
        SELECT
          application_dashboard_id,
          panel_id,
          metric_name,
          CASE WHEN pooled_count > 0
               THEN pooled_sum / pooled_count
          END AS mean,
          pooled_min AS min_value,
          pooled_max AS max_value,
          CASE WHEN pooled_count > 0
               THEN sqrt(GREATEST(
                 pooled_sum_sq / pooled_count - power(pooled_sum / pooled_count, 2),
                 0
               ))
               ELSE 0
          END AS std_dev,
          pct_agg,
          (
            pooled_count > 0
            AND sqrt(GREATEST(
              pooled_sum_sq / pooled_count - power(pooled_sum / pooled_count, 2),
              0
            )) < 0.0001
          ) AS is_constant,
          (pooled_count = 0) AS all_missing
        FROM per_run_pooled
      )
    `;

    // Legacy path — kept verbatim for backfill correctness when any control
    // run is missing the persisted per-run sketch.
    const legacyLeadingCtes = `
      WITH raw_metrics_aggregated AS (
        -- Pool ALL raw data points from ALL control runs into a single
        -- distribution per metric. This is fundamentally different from
        -- averaging per-run statistics — it preserves the true shape of
        -- the distribution across runs.
        SELECT
          m.application_dashboard_id,
          m.panel_id,
          m.metric_name,
          AVG(m.value) as mean,
          MIN(m.value) as min_value,
          MAX(m.value) as max_value,
          STDDEV_POP(m.value) as std_dev,         -- Population std dev (not sample)
          percentile_agg(m.value) as pct_agg,     -- uddsketch for percentile extraction
          (STDDEV_POP(m.value) < 0.0001) as is_constant,  -- Near-zero variance → constant metric
          (COUNT(m.value) = 0) as all_missing
        FROM ds_metrics m
        INNER JOIN test_runs tr ON m.test_run_id = tr.test_run_id
        WHERE m.test_run_id = ANY($2::varchar[])
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
        GROUP BY m.application_dashboard_id, m.panel_id, m.metric_name
      )
    `;

    const sharedTailCtes = `
      , control_metrics_metadata AS (
        -- Pick ONE metadata row per metric across all control runs.
        -- DISTINCT ON with ORDER BY ... NULLS LAST ensures we prefer the row
        -- with the most complete metadata (non-null dashboard_uid, metrics_source_id).
        SELECT DISTINCT ON (ms.application_dashboard_id, ms.panel_id, ms.metric_name)
          ms.application_dashboard_id,
          ms.panel_id,
          ms.metric_name,
          ms.dashboard_uid,
          ms.dashboard_label,
          ms.panel_title,
          ms.unit,
          ms.benchmark_id,
          ms.metrics_source_id
        FROM ds_metric_statistics ms
        INNER JOIN test_runs tr ON ms.test_run_id = tr.test_run_id
        WHERE ms.test_run_id = ANY($2::varchar[])
          AND (
            ms.application_dashboard_id IN (
              SELECT id FROM application_dashboards ad
              WHERE ad.organization_id = tr.organization_id OR ad.organization_id IS NULL
            )
            OR ms.application_dashboard_id IN (
              SELECT DISTINCT application_dashboard_id FROM dynatrace_queries dq
              WHERE dq.organization_id = tr.organization_id OR dq.organization_id IS NULL
            )
          )
        ORDER BY ms.application_dashboard_id, ms.panel_id, ms.metric_name, ms.dashboard_uid NULLS LAST, ms.metrics_source_id NULLS LAST
      ),

      metadata_aggregated AS (
        -- Average per-run counters across control runs. Unlike raw_metrics_aggregated
        -- (which pools raw data points), this averages the per-run STATISTICS to get
        -- "typical" values for count, n_missing, last_value, etc.
        SELECT
          ms.application_dashboard_id,
          ms.panel_id,
          ms.metric_name,
          AVG(ms.last_value) as last_value,
          AVG(ms.count) as count,
          AVG(ms.n_missing) as n_missing,
          AVG(ms.n_non_zero) as n_non_zero,
          AVG(ms.n_missing::float / NULLIF(ms.count, 0) * 100) as pct_missing,
          array_agg(DISTINCT ms.benchmark_id) FILTER (WHERE ms.benchmark_id IS NOT NULL) as benchmark_ids
        FROM ds_metric_statistics ms
        INNER JOIN test_runs tr ON ms.test_run_id = tr.test_run_id
        WHERE ms.test_run_id = ANY($2::varchar[])
          AND (
            ms.application_dashboard_id IN (
              SELECT id FROM application_dashboards ad
              WHERE ad.organization_id = tr.organization_id OR ad.organization_id IS NULL
            )
            OR ms.application_dashboard_id IN (
              SELECT DISTINCT application_dashboard_id FROM dynatrace_queries dq
              WHERE dq.organization_id = tr.organization_id OR dq.organization_id IS NULL
            )
          )
        GROUP BY ms.application_dashboard_id, ms.panel_id, ms.metric_name
      ),

      final_stats AS (
        -- Combine the three CTEs. All three are grouped by the same key
        -- (dashboard, panel, metric), so this is a 1:1:1 join — no explosion.
        SELECT
          r.application_dashboard_id,
          r.panel_id,
          r.metric_name,
          m.dashboard_uid,
          m.dashboard_label,
          m.panel_title,
          m.unit,
          m.metrics_source_id,
          ma.benchmark_ids,
          r.mean,
          r.min_value,
          r.max_value,
          r.std_dev,
          ma.last_value,
          ma.count,
          ma.n_missing,
          ma.n_non_zero,
          r.is_constant,
          r.all_missing,
          ma.pct_missing,
          -- Approximate percentiles using TimescaleDB toolkit (O(n) single pass)
          approx_percentile(0.50, r.pct_agg) as median,
          approx_percentile(0.10, r.pct_agg) as q10,
          approx_percentile(0.25, r.pct_agg) as q25,
          approx_percentile(0.75, r.pct_agg) as q75,
          approx_percentile(0.90, r.pct_agg) as q90,
          approx_percentile(0.95, r.pct_agg) as q95,
          approx_percentile(0.99, r.pct_agg) as q99,
          -- IQR and IDR from approximate percentiles
          approx_percentile(0.75, r.pct_agg) - approx_percentile(0.25, r.pct_agg) as iqr,
          approx_percentile(0.90, r.pct_agg) - approx_percentile(0.10, r.pct_agg) as idr
        FROM raw_metrics_aggregated r
        JOIN control_metrics_metadata m ON
          m.application_dashboard_id = r.application_dashboard_id AND
          m.panel_id = r.panel_id AND
          m.metric_name = r.metric_name
        JOIN metadata_aggregated ma ON
          ma.application_dashboard_id = r.application_dashboard_id AND
          ma.panel_id = r.panel_id AND
          ma.metric_name = r.metric_name
        WHERE r.pct_agg IS NOT NULL
      )

      -- Insert or update the control group statistics
      INSERT INTO ds_control_group_statistics (
        control_group_id,
        application_dashboard_id,
        metrics_source_id,
        panel_id,
        metric_name,
        test_run_id,
        dashboard_uid,
        dashboard_label,
        panel_title,
        unit,
        benchmark_ids,
        mean,
        median,
        min_value,
        max_value,
        std_dev,
        last_value,
        count,
        n_missing,
        n_non_zero,
        q10,
        q25,
        q75,
        q90,
        q95,
        q99,
        iqr,
        idr,
        is_constant,
        all_missing,
        pct_missing,
        updated_at,
        organization_id,
        team_id,
        created_by,
        updated_by
      )
      SELECT
        $1 as control_group_id,
        application_dashboard_id,
        metrics_source_id,
        panel_id,
        metric_name,
        $1 as test_run_id,  -- Use control_group_id as test_run_id
        COALESCE(dashboard_uid, ''),
        COALESCE(dashboard_label, ''),
        COALESCE(panel_title, ''),
        COALESCE(unit, ''),
        COALESCE(benchmark_ids, ARRAY[]::uuid[]),
        COALESCE(mean, 0),
        COALESCE(median, 0),
        COALESCE(min_value, 0),
        COALESCE(max_value, 0),
        COALESCE(std_dev, 0),
        last_value,
        COALESCE(count, 0),
        COALESCE(n_missing, 0),
        COALESCE(n_non_zero, 0),
        COALESCE(q10, 0),
        COALESCE(q25, 0),
        COALESCE(q75, 0),
        COALESCE(q90, 0),
        COALESCE(q95, 0),
        COALESCE(q99, 0),
        COALESCE(iqr, 0),
        COALESCE(idr, 0),
        COALESCE(is_constant, false),
        COALESCE(all_missing, false),
        COALESCE(pct_missing, 0),
        NOW(),
        $3 as organization_id,
        $4 as team_id,
        'worker-pipeline' as created_by,
        'worker-pipeline' as updated_by
      FROM final_stats
      ON CONFLICT (control_group_id, application_dashboard_id, panel_id, metric_name)
      DO UPDATE SET
        test_run_id = EXCLUDED.test_run_id,
        metrics_source_id = COALESCE(EXCLUDED.metrics_source_id, ds_control_group_statistics.metrics_source_id),
        dashboard_uid = EXCLUDED.dashboard_uid,
        dashboard_label = EXCLUDED.dashboard_label,
        panel_title = EXCLUDED.panel_title,
        unit = EXCLUDED.unit,
        benchmark_ids = EXCLUDED.benchmark_ids,
        mean = EXCLUDED.mean,
        median = EXCLUDED.median,
        min_value = EXCLUDED.min_value,
        max_value = EXCLUDED.max_value,
        std_dev = EXCLUDED.std_dev,
        last_value = EXCLUDED.last_value,
        count = EXCLUDED.count,
        n_missing = EXCLUDED.n_missing,
        n_non_zero = EXCLUDED.n_non_zero,
        q10 = EXCLUDED.q10,
        q25 = EXCLUDED.q25,
        q75 = EXCLUDED.q75,
        q90 = EXCLUDED.q90,
        q95 = EXCLUDED.q95,
        q99 = EXCLUDED.q99,
        iqr = EXCLUDED.iqr,
        idr = EXCLUDED.idr,
        is_constant = EXCLUDED.is_constant,
        all_missing = EXCLUDED.all_missing,
        pct_missing = EXCLUDED.pct_missing,
        updated_at = NOW(),
        organization_id = EXCLUDED.organization_id,
        team_id = EXCLUDED.team_id,
        updated_by = EXCLUDED.updated_by
    `;

    const statisticsQuery = (useFastPath ? fastPathLeadingCtes : legacyLeadingCtes) + sharedTailCtes;

    this.logger.info(`🚀 Executing control group statistics aggregation INSERT...`);

    // First, count how many rows the aggregation would produce
    const countQuery = `
      WITH control_metrics_metadata AS (
        SELECT
          ms.application_dashboard_id,
          ms.panel_id,
          ms.metric_name
        FROM ds_metric_statistics ms
        WHERE ms.test_run_id = ANY($1::varchar[])
      ),
      raw_metrics AS (
        SELECT
          application_dashboard_id,
          panel_id,
          metric_name
        FROM ds_metrics
        WHERE test_run_id = ANY($1::varchar[])
          AND value IS NOT NULL
      )
      SELECT COUNT(DISTINCT (m.application_dashboard_id, m.panel_id, m.metric_name))::integer as expected_rows
      FROM control_metrics_metadata m
      WHERE EXISTS (
        SELECT 1 FROM raw_metrics r
        WHERE r.application_dashboard_id = m.application_dashboard_id
        AND r.panel_id = m.panel_id
        AND r.metric_name = m.metric_name
      )
    `;

    const expectedCount = await manager.query(countQuery, [controlGroup.test_runs]);
    const expectedRows = expectedCount[0]?.expected_rows || 0;

    this.logger.info(`📊 Aggregation will process ${expectedRows} unique metrics`);

    const result = await manager.query(statisticsQuery, [controlGroupId, controlGroup.test_runs, controlGroup.organization_id || null, controlGroup.team_id || null]);

    // For INSERT with ON CONFLICT, TypeORM returns the pg driver result with rowCount
    const rowCount = (result).rowCount || 0;

    this.logger.info(`✅ Control group statistics aggregation completed`);
    this.logger.info(`   📝 Processed: ${expectedRows} unique metrics`);
    this.logger.info(`   📝 Inserted: ${rowCount} new statistic records`);
    this.logger.info(`   📊 Source: ${totalMetricStats} metric statistics from ${controlGroup.n_test_runs} control runs`);

    if (rowCount === 0 && expectedRows > 0) {
      this.logger.info(`ℹ️  All ${expectedRows} statistics already exist (ON CONFLICT updated existing records)`);
    } else if (rowCount === 0 && expectedRows === 0) {
      this.logger.warn(`⚠️ No metrics were available to aggregate`);
    } else if (rowCount < expectedRows) {
      this.logger.info(`ℹ️  Inserted ${rowCount} new records, updated ${expectedRows - rowCount} existing records`);
    } else {
      this.logger.info(`✅ All ${rowCount} records are new`);
    }

    return rowCount;
  }
}