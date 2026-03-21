/**
 * SQL Builder for ADAPT Results
 *
 * Responsible for building complex SQL queries for:
 * - ADAPT results processing
 * - Conclusion generation
 * - Tracked results re-evaluation
 */

import { AdaptSQLFragments } from './sql-fragments.js';

/**
 * SQL Builder for ADAPT pipeline result processing
 *
 * Handles generation of large SQL queries for results, conclusions,
 * and tracked results with proper parameter binding.
 */
export class AdaptResultsSQLBuilder {
  private fragments: AdaptSQLFragments;

  constructor() {
    this.fragments = new AdaptSQLFragments();
  }
  /**
   * Build the main ADAPT results SQL query
   *
   * This is a large query that:
   * 1. Selects test metrics from ds_metric_statistics
   * 2. Joins with control group statistics
   * 3. Applies compare configs with hierarchical fallback
   * 4. Dynamically selects statistics based on aggregation config
   * 5. Calculates thresholds and statistical differences
   * 6. Performs threshold checks (pct, iqr, abs)
   * 7. Builds conclusion with appropriate labels
   * 8. Inserts/updates into ds_adapt_results
   *
   * @param placeholders - SQL placeholders for test run IDs
   * @param filterSQL - Additional filter SQL for metric filtering
   * @param testRunIdsCount - Number of test run IDs for parameter indexing
   * @returns Complete SQL query string
   */
  buildAdaptResultsSQL(
    placeholders: string,
    filterSQL: string,
    testRunIdsCount: number
  ): string {
    return `
      WITH test_metrics AS (
          SELECT
              ms.test_run_id,
              ms.test_run_id as control_group_id,  -- assumes testRunId equals controlGroupId per spec
              ms.application_dashboard_id,
              ms.panel_id::varchar as panel_id,
              ms.metric_name,
              -- All statistics from ds_metric_statistics
              ms.mean as test_mean,
              ms.median as test_median,
              ms.min_value as test_min,
              ms.max_value as test_max,
              ms.std_dev as test_std,
              ms.last_value as test_last,
              ms.q10 as test_q10,
              ms.q25 as test_q25,
              ms.q75 as test_q75,
              ms.q90 as test_q90,
              ms.q95 as test_q95,
              ms.q99 as test_q99,
              ms.iqr as test_iqr,
              ms.count as test_n,
              ms.is_constant as test_is_constant,
              ms.all_missing as test_all_missing,
              -- Additional metadata
              ms.dashboard_uid,
              ms.dashboard_label,
              ms.panel_title,
              ms.unit,
              ms.test_run_start,
              ms.benchmark_id,
              ms.updated_at,
              ms.organization_id,
              ms.team_id
          FROM ds_metric_statistics ms
          WHERE ms.test_run_id IN (${placeholders})
            ${filterSQL}
      ),

      with_control AS (
          SELECT
              tm.*,
              cgs.mean as control_mean,
              cgs.median as control_median,
              cgs.min_value as control_min,
              cgs.max_value as control_max,
              cgs.std_dev as control_std,
              cgs.last_value as control_last,
              cgs.q10 as control_q10,
              cgs.q25 as control_q25,
              cgs.q75 as control_q75,
              cgs.q90 as control_q90,
              cgs.q95 as control_q95,
              cgs.q99 as control_q99,
              cgs.iqr as control_iqr,
              cgs.count as control_n,
              cgs.is_constant as control_is_constant,
              cgs.all_missing as control_all_missing,
              CASE
                  WHEN cgs.control_group_id IS NOT NULL THEN true
                  ELSE false
              END as control_exists
          FROM test_metrics tm
          LEFT JOIN ds_control_group_statistics cgs ON (
              cgs.control_group_id = tm.control_group_id
              AND cgs.application_dashboard_id = tm.application_dashboard_id
              AND cgs.panel_id::text = tm.panel_id
              AND cgs.metric_name = tm.metric_name
          )
      ),

      with_compare_config AS (
          SELECT
              wc.*,
              COALESCE(
                  cfg_metric.config_data,
                  cfg_panel.config_data,
                  cfg_dashboard.config_data,
                  cfg_global.config_data,
                  $${testRunIdsCount + 1}::jsonb
              ) as compare_config
          FROM with_control wc
          LEFT JOIN temp_config_cache cfg_metric ON (
              cfg_metric.application_dashboard_id = wc.application_dashboard_id
              AND cfg_metric.panel_id = wc.panel_id::int
              AND cfg_metric.metric_name = wc.metric_name
          )
          LEFT JOIN temp_config_cache cfg_panel ON (
              cfg_panel.application_dashboard_id = wc.application_dashboard_id
              AND cfg_panel.panel_id = wc.panel_id::int
              AND cfg_panel.metric_name IS NULL
          )
          LEFT JOIN temp_config_cache cfg_dashboard ON (
              cfg_dashboard.application_dashboard_id = wc.application_dashboard_id
              AND cfg_dashboard.panel_id IS NULL
              AND cfg_dashboard.metric_name IS NULL
          )
          LEFT JOIN temp_config_cache cfg_global ON (
              cfg_global.application_dashboard_id IS NULL
              AND cfg_global.panel_id IS NULL
              AND cfg_global.metric_name IS NULL
          )
      ),

      with_dynamic_statistics AS (
          SELECT
              wcc.*,
              -- Dynamically select test and control values based on configured statistic
              CASE (wcc.compare_config->'thresholds'->>'aggregation')
                  WHEN 'mean' THEN wcc.test_mean
                  WHEN 'median' THEN wcc.test_median
                  WHEN 'min' THEN wcc.test_min
                  WHEN 'max' THEN wcc.test_max
                  WHEN 'last' THEN wcc.test_last
                  WHEN 'q10' THEN wcc.test_q10
                  WHEN 'p10' THEN wcc.test_q10  -- Support both notations
                  WHEN 'q25' THEN wcc.test_q25
                  WHEN 'p25' THEN wcc.test_q25
                  WHEN 'q75' THEN wcc.test_q75
                  WHEN 'p75' THEN wcc.test_q75
                  WHEN 'q90' THEN wcc.test_q90
                  WHEN 'p90' THEN wcc.test_q90
                  WHEN 'q95' THEN wcc.test_q95
                  WHEN 'p95' THEN wcc.test_q95
                  WHEN 'q99' THEN wcc.test_q99
                  WHEN 'p99' THEN wcc.test_q99
                  ELSE wcc.test_median  -- Default to median
              END as test_stat_value,

              CASE (wcc.compare_config->'thresholds'->>'aggregation')
                  WHEN 'mean' THEN wcc.control_mean
                  WHEN 'median' THEN wcc.control_median
                  WHEN 'min' THEN wcc.control_min
                  WHEN 'max' THEN wcc.control_max
                  WHEN 'last' THEN wcc.control_last
                  WHEN 'q10' THEN wcc.control_q10
                  WHEN 'p10' THEN wcc.control_q10
                  WHEN 'q25' THEN wcc.control_q25
                  WHEN 'p25' THEN wcc.control_q25
                  WHEN 'q75' THEN wcc.control_q75
                  WHEN 'p75' THEN wcc.control_q75
                  WHEN 'q90' THEN wcc.control_q90
                  WHEN 'p90' THEN wcc.control_q90
                  WHEN 'q95' THEN wcc.control_q95
                  WHEN 'p95' THEN wcc.control_q95
                  WHEN 'q99' THEN wcc.control_q99
                  WHEN 'p99' THEN wcc.control_q99
                  ELSE wcc.control_median  -- Default to median
              END as control_stat_value
          FROM with_compare_config wcc
      ),

      ${this.fragments.buildThresholdCalculationsCTE()},

      final_results AS (
          SELECT
              wtc.*,
              -- Calculate partialDifference (OR logic - ANY threshold exceeded)
              CASE
                  WHEN (wtc.checks->'pct'->>'isDifference')::boolean = true OR
                       (wtc.checks->'iqr'->>'isDifference')::boolean = true OR
                       (wtc.checks->'abs'->>'isDifference')::boolean = true
                  THEN true
                  ELSE false
              END as partial_difference,

              -- Calculate allDifference (AND logic - ALL configured thresholds exceeded)
              CASE
                  WHEN (wtc.checks->'pct'->>'isDifference')::boolean = true AND
                       (CASE WHEN (wtc.checks->'iqr'->>'valid')::boolean = true
                        THEN (wtc.checks->'iqr'->>'isDifference')::boolean
                        ELSE true END) AND
                       (CASE WHEN (wtc.checks->'abs'->>'valid')::boolean = true
                        THEN (wtc.checks->'abs'->>'isDifference')::boolean
                        ELSE true END)
                  THEN true
                  ELSE false
              END as all_difference,

              ${this.fragments.buildConclusionLogic()}
          FROM with_threshold_calculations wtc
      )


      ${this.buildInsertStatement()}
    `;
  }

  /**
   * Build INSERT statement with all statistics as JSONB
   */
  private buildInsertStatement(): string {
    // This is intentionally split to keep method size reasonable
    // The full INSERT is built by combining sections
    return `INSERT INTO ds_adapt_results (
          test_run_id, control_group_id, application_dashboard_id, panel_id, metric_name,
          dashboard_uid, dashboard_label, panel_title, unit, test_run_start,
          benchmark_ids, updated_at,
          mean, median, min, max, std, last_value, q10, q25, q75, q90, q95, q99, iqr, n,
          is_constant, all_missing, exists_data,
          compare_config, metric_classification, statistic, thresholds, conditions, checks, conclusion,
          uses_default_value, default_value,
          organization_id, team_id, created_by, updated_by
      )
      SELECT
          test_run_id,
          control_group_id,
          application_dashboard_id,
          panel_id::int,
          metric_name,
          dashboard_uid,
          dashboard_label,
          panel_title,
          unit,
          test_run_start,
          CASE WHEN benchmark_id IS NOT NULL THEN ARRAY[benchmark_id::text] ELSE NULL END as benchmark_ids,
          updated_at,
          ${this.fragments.buildStatisticsColumns()},
          organization_id,
          team_id,
          'worker-pipeline' as created_by,
          'worker-pipeline' as updated_by
      FROM final_results

      ON CONFLICT (test_run_id, control_group_id, application_dashboard_id, panel_id, metric_name)
      DO UPDATE SET
          dashboard_uid = EXCLUDED.dashboard_uid,
          dashboard_label = EXCLUDED.dashboard_label,
          panel_title = EXCLUDED.panel_title,
          unit = EXCLUDED.unit,
          test_run_start = EXCLUDED.test_run_start,
          benchmark_ids = EXCLUDED.benchmark_ids,
          updated_at = EXCLUDED.updated_at,
          mean = EXCLUDED.mean,
          median = EXCLUDED.median,
          min = EXCLUDED.min,
          max = EXCLUDED.max,
          std = EXCLUDED.std,
          last_value = EXCLUDED.last_value,
          q10 = EXCLUDED.q10,
          q25 = EXCLUDED.q25,
          q75 = EXCLUDED.q75,
          q90 = EXCLUDED.q90,
          q95 = EXCLUDED.q95,
          q99 = EXCLUDED.q99,
          iqr = EXCLUDED.iqr,
          n = EXCLUDED.n,
          is_constant = EXCLUDED.is_constant,
          all_missing = EXCLUDED.all_missing,
          exists_data = EXCLUDED.exists_data,
          compare_config = EXCLUDED.compare_config,
          metric_classification = EXCLUDED.metric_classification,
          statistic = EXCLUDED.statistic,
          thresholds = EXCLUDED.thresholds,
          conditions = EXCLUDED.conditions,
          checks = EXCLUDED.checks,
          conclusion = EXCLUDED.conclusion,
          uses_default_value = EXCLUDED.uses_default_value,
          default_value = EXCLUDED.default_value,
          organization_id = EXCLUDED.organization_id,
          team_id = EXCLUDED.team_id,
          updated_by = EXCLUDED.updated_by
    `;
  }


  /**
   * Build the conclusion generation SQL query
   *
   * @param placeholders - SQL placeholders for test run IDs
   * @returns Complete SQL query string for generating conclusions
   */
  buildConclusionSQL(placeholders: string): string {
    return `
      WITH adapt_results_categorized AS (
          SELECT
              test_run_id,
              control_group_id,
              (array_agg(organization_id))[1] as organization_id,
              (array_agg(team_id))[1] as team_id,

              -- Collect by label (exclude ignored results) - only full labels count as regressions/improvements
              array_agg(id) FILTER (WHERE conclusion->>'label' = 'regression' AND NOT COALESCE((conclusion->>'ignore')::boolean, false)) as regressions,
              array_agg(id) FILTER (WHERE conclusion->>'label' = 'improvement' AND NOT COALESCE((conclusion->>'ignore')::boolean, false)) as improvements,
              array_agg(id) FILTER (WHERE conclusion->>'label' IN ('increase', 'decrease', 'partial increase', 'partial decrease', 'partial improvement', 'partial regression') AND NOT COALESCE((conclusion->>'ignore')::boolean, false)) as differences,
              array_agg(id) FILTER (WHERE conclusion->>'label' = 'no difference' AND NOT COALESCE((conclusion->>'ignore')::boolean, false)) as no_differences,
              array_agg(id) FILTER (WHERE conclusion->>'label' = 'incomparable' AND NOT COALESCE((conclusion->>'ignore')::boolean, false)) as incomparable,

              -- Count totals for details - only full labels count as regressions/improvements
              count(*) FILTER (WHERE NOT COALESCE((conclusion->>'ignore')::boolean, false)) as total_comparable_results,
              count(*) FILTER (WHERE conclusion->>'label' = 'regression' AND NOT COALESCE((conclusion->>'ignore')::boolean, false)) as regression_count,
              count(*) FILTER (WHERE conclusion->>'label' = 'improvement' AND NOT COALESCE((conclusion->>'ignore')::boolean, false)) as improvement_count,
              count(*) FILTER (WHERE conclusion->>'label' IN ('increase', 'decrease', 'partial increase', 'partial decrease', 'partial improvement', 'partial regression') AND NOT COALESCE((conclusion->>'ignore')::boolean, false)) as difference_count,
              count(*) FILTER (WHERE conclusion->>'label' = 'no difference' AND NOT COALESCE((conclusion->>'ignore')::boolean, false)) as no_difference_count,
              count(*) FILTER (WHERE conclusion->>'label' = 'incomparable' AND NOT COALESCE((conclusion->>'ignore')::boolean, false)) as incomparable_count
          FROM ds_adapt_results
          WHERE test_run_id IN (${placeholders})
          GROUP BY test_run_id, control_group_id
      ),

      with_tracked_results AS (
          SELECT
              arc.*,
              -- Join with tracked results for historical regressions
              array_agg(atr.id) FILTER (WHERE atr.conclusion->>'label' = 'regression' AND NOT COALESCE((atr.conclusion->>'ignore')::boolean, false)) as tracked_regressions,
              count(*) FILTER (WHERE atr.conclusion->>'label' = 'regression' AND NOT COALESCE((atr.conclusion->>'ignore')::boolean, false)) as tracked_regression_count
          FROM adapt_results_categorized arc
          LEFT JOIN ds_adapt_tracked_results atr ON (atr.test_run_id = arc.test_run_id)
          GROUP BY arc.test_run_id, arc.control_group_id, arc.organization_id, arc.team_id, arc.regressions, arc.improvements, arc.differences, arc.no_differences, arc.incomparable,
                   arc.total_comparable_results, arc.regression_count, arc.improvement_count, arc.difference_count, arc.no_difference_count, arc.incomparable_count
      )

      INSERT INTO ds_adapt_conclusion (
          test_run_id, control_group_id, regressions, improvements, differences, tracked_regressions,
          conclusion, details, updated_at,
          organization_id, team_id, created_by, updated_by
      )
      SELECT
          test_run_id,
          control_group_id,
          COALESCE(regressions, '{}') as regressions,
          COALESCE(improvements, '{}') as improvements,
          COALESCE(differences, '{}') as differences,
          COALESCE(tracked_regressions, '{}') as tracked_regressions,

          -- Overall conclusion logic per specification
          CASE
              -- SKIPPED if no results in any category
              WHEN total_comparable_results = 0 OR total_comparable_results IS NULL THEN 'SKIPPED'

              -- REGRESSION if any regressions or tracked regressions exist
              WHEN COALESCE(regression_count, 0) > 0 OR COALESCE(tracked_regression_count, 0) > 0 THEN 'REGRESSION'

              -- PASSED otherwise
              ELSE 'PASSED'
          END as conclusion,

          -- Details for analysis
          jsonb_build_object(
              'totalResults', COALESCE(total_comparable_results, 0),
              'regressionCount', COALESCE(regression_count, 0),
              'improvementCount', COALESCE(improvement_count, 0),
              'differenceCount', COALESCE(difference_count, 0),
              'noDifferenceCount', COALESCE(no_difference_count, 0),
              'incomparableCount', COALESCE(incomparable_count, 0),
              'trackedRegressionCount', COALESCE(tracked_regression_count, 0)
          ) as details,

          NOW() as updated_at,
          organization_id,
          team_id,
          'worker-pipeline' as created_by,
          'worker-pipeline' as updated_by
      FROM with_tracked_results

      ON CONFLICT (test_run_id)
      DO UPDATE SET
          control_group_id = EXCLUDED.control_group_id,
          regressions = EXCLUDED.regressions,
          improvements = EXCLUDED.improvements,
          differences = EXCLUDED.differences,
          tracked_regressions = EXCLUDED.tracked_regressions,
          conclusion = EXCLUDED.conclusion,
          details = EXCLUDED.details,
          updated_at = EXCLUDED.updated_at,
          organization_id = EXCLUDED.organization_id,
          team_id = EXCLUDED.team_id,
          updated_by = EXCLUDED.updated_by
    `;
  }
}
