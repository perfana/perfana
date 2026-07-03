/**
 * Tracked Results SQL Builder — Historical Regression Re-Evaluation
 *
 * ════════════════════════════════════════════════════════════════════════════════
 * Concept: Why Re-Evaluate Historical Regressions?
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * When ADAPT detects a regression in test run B, that regression may persist
 * in subsequent runs C, D, E even though their direct comparison to the
 * (now-shifted) control group shows "no difference". This is because the
 * control group eventually absorbs the regressed performance as the new normal.
 *
 * Tracked results solve this by re-evaluating historical regressions:
 *   1. Find all past test runs in the control group that had regressions
 *   2. For each regressed metric, take the CURRENT test run's metric value
 *   3. Compare it against the HISTORICAL control group (the baseline from
 *      when the regression was first detected — NOT the current control group)
 *   4. If the regression still persists, it becomes a "tracked regression"
 *
 * This ensures regressions are not silently forgotten when the control group
 * shifts. A tracked regression keeps the test run verdict as REGRESSION until
 * the issue is explicitly accepted or the performance returns to the original
 * baseline.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 * Why the HISTORICAL control group, not the current one?
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * The historical control group represents the "pre-regression" baseline.
 * Using the current control group would compare against an already-degraded
 * baseline (since the regressed runs are now part of it), making the
 * regression invisible. By using the historical control group, we ask:
 * "Has performance returned to where it was BEFORE the regression?"
 *
 * ════════════════════════════════════════════════════════════════════════════════
 * CTE Pipeline
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *   control_group_test_runs       Unnest the control group's test_runs array
 *        │                        to get individual tracked test run IDs.
 *        ▼
 *   filtered_tracked_test_runs    Exclude runs with differencesAccepted=ACCEPTED
 *        │                        (user acknowledged the regression) or mode=DEBUG.
 *        ▼
 *   historical_regressions        Find ADAPT results from tracked runs that had
 *        │                        differences (increase/decrease/regression/improvement).
 *        │                        Critically: preserves historical_control_group_id.
 *        ▼
 *   current_metrics               Join with CURRENT test run's ds_metric_statistics
 *        │                        for the same metrics. Uses historical_control_group_id
 *        │                        as the control_group_id for the re-evaluation.
 *        ▼
 *   with_control                  Join with ds_control_group_statistics using the
 *        │                        HISTORICAL control group (not current!) to get
 *        │                        the pre-regression baseline values.
 *        ▼
 *   with_compare_config           Same 4-level config hierarchy as main ADAPT.
 *        ▼
 *   with_dynamic_statistics       Select configured aggregation statistic.
 *        ▼
 *   with_threshold_calculations   Same threshold logic as main ADAPT pipeline.
 *        ▼
 *   final_tracked_results         Re-evaluate conclusion with same label logic.
 *        ▼
 *   INSERT INTO ds_adapt_tracked_results  (UPSERT on conflict)
 */

/**
 * SQL Builder for tracked results re-evaluation
 *
 * Handles the complex SQL generation for re-evaluating historical
 * regressions against current baseline and control group.
 */
export class TrackedResultsSQLBuilder {
  /**
   * Build the tracked results SQL query
   *
   * MongoDB re-evaluation logic:
   * 1. Find historical regressions from tracked test runs
   * 2. Get current test run's metric statistics for those same metrics
   * 3. Re-run full ADAPT analysis with current control group
   *
   * @param placeholders - SQL placeholders for test run IDs
   * @param testRunIdsCount - Number of test run IDs for parameter indexing
   * @returns Complete SQL query string for storing tracked results
   */
  buildTrackedResultsSQL(placeholders: string, testRunIdsCount: number): string {
    return `
      WITH control_group_test_runs AS (
          -- Expand the control group's test_runs[] array into individual rows.
          -- Each of these past test runs will be checked for historical regressions.
          SELECT DISTINCT
              cg.control_group_id,
              unnest(cg.test_runs) as tracked_test_run_id
          FROM ds_control_groups cg
          WHERE cg.control_group_id IN (${placeholders})
      ),
      filtered_tracked_test_runs AS (
          -- Skip runs where the user explicitly accepted the differences
          -- (differencesAccepted=ACCEPTED) or where the run was in DEBUG mode.
          -- These should not propagate as tracked regressions.
          SELECT
              cgtr.control_group_id,
              cgtr.tracked_test_run_id
          FROM control_group_test_runs cgtr
          JOIN test_runs tr ON tr.test_run_id = cgtr.tracked_test_run_id
          WHERE COALESCE((tr.adapt_config->>'differencesAccepted'), '') != 'ACCEPTED'
          AND COALESCE((tr.adapt_config->>'mode'), '') != 'DEBUG'
      ),
      historical_regressions AS (
          -- Find ADAPT results from tracked test runs that showed any kind of
          -- difference (increase, decrease, regression, improvement). These are
          -- candidates for re-evaluation against the current test run's data.
          SELECT
              fttr.control_group_id as current_test_run_id,
              fttr.tracked_test_run_id,
              ar.id as tracked_difference_id,
              ar.application_dashboard_id,
              ar.metrics_source_id,
              ar.panel_id,
              ar.metric_name,
              ar.conclusion as tracked_conclusion,
              -- CRITICAL: Preserve the control group that was active when the
              -- regression was first detected. This is the "pre-regression"
              -- baseline we compare against — NOT the current control group.
              ar.control_group_id as historical_control_group_id
          FROM filtered_tracked_test_runs fttr
          JOIN ds_adapt_results ar ON ar.test_run_id = fttr.tracked_test_run_id
          -- TODO: Find out what the impact can be of leaving this join out. This join fails with dynatrace data because those application_dashboard_id's are in dynatrace_dql table
          -- JOIN application_dashboards ad ON ad.id = ar.application_dashboard_id  -- Ensure dashboard still exists
          WHERE ar.conclusion IS NOT NULL
          AND ar.conclusion->>'label' IN ('increase', 'decrease', 'regression', 'improvement')
          AND NOT COALESCE((ar.conclusion->>'ignore')::boolean, false)
      ),
      current_metrics AS (
          -- For each historical regression, get the CURRENT test run's value of
          -- that same metric. The control_group_id is set to the HISTORICAL one
          -- so the subsequent with_control CTE joins against the pre-regression baseline.
          SELECT
              ms.test_run_id,
              hr.historical_control_group_id as control_group_id,  -- Historical, not current!
              ms.application_dashboard_id,
              ms.panel_id::varchar as panel_id,
              ms.metric_name,
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
              ms.dashboard_uid,
              ms.dashboard_label,
              ms.panel_title,
              ms.unit,
              ms.test_run_start,
              ms.updated_at,
              ms.organization_id,
              ms.team_id,
              ms.metrics_source_id,
              hr.tracked_test_run_id,
              hr.tracked_difference_id,
              hr.tracked_conclusion
          FROM historical_regressions hr
          JOIN ds_metric_statistics ms ON (
              ms.test_run_id = hr.current_test_run_id
              AND ms.metrics_source_id = hr.metrics_source_id
              AND ms.panel_id = hr.panel_id
              AND ms.metric_name = hr.metric_name
          )
      ),
      ${this.buildWithControlCTE()},
      ${this.buildWithCompareConfigCTE(testRunIdsCount)},
      ${this.buildWithDynamicStatisticsCTE()},
      ${this.buildWithThresholdCalculationsCTE()},
      ${this.buildFinalTrackedResultsCTE()}

      ${this.buildInsertStatement()}
    `;
  }

  /**
   * Build WITH control CTE (join with current control group statistics)
   */
  private buildWithControlCTE(): string {
    return `with_control AS (
          -- Join with the HISTORICAL control group statistics (the baseline
          -- from when the regression was first detected). Despite the comment
          -- saying "current", cm.control_group_id was set to historical_control_group_id
          -- in current_metrics, so this actually joins against the pre-regression baseline.
          SELECT
              cm.*,
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
              CASE WHEN cgs.control_group_id IS NOT NULL THEN true ELSE false END as control_exists
          FROM current_metrics cm
          LEFT JOIN ds_control_group_statistics cgs ON (
              cgs.control_group_id = cm.control_group_id
              AND cgs.metrics_source_id = cm.metrics_source_id
              AND cgs.panel_id::text = cm.panel_id
              AND cgs.metric_name = cm.metric_name
          )
      )`;
  }

  /**
   * Build WITH compare_config CTE (apply compare config hierarchy)
   */
  private buildWithCompareConfigCTE(testRunIdsCount: number): string {
    return `with_compare_config AS (
          -- Apply compare config (same hierarchy as processAdaptResults)
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
          LEFT JOIN temp_tracked_config_cache cfg_metric ON (
              cfg_metric.application_dashboard_id = wc.application_dashboard_id
              AND cfg_metric.panel_id = wc.panel_id::int
              AND cfg_metric.metric_name = wc.metric_name
          )
          LEFT JOIN temp_tracked_config_cache cfg_panel ON (
              cfg_panel.application_dashboard_id = wc.application_dashboard_id
              AND cfg_panel.panel_id = wc.panel_id::int
              AND cfg_panel.metric_name IS NULL
          )
          LEFT JOIN temp_tracked_config_cache cfg_dashboard ON (
              cfg_dashboard.application_dashboard_id = wc.application_dashboard_id
              AND cfg_dashboard.panel_id IS NULL
              AND cfg_dashboard.metric_name IS NULL
          )
          LEFT JOIN temp_tracked_config_cache cfg_global ON (
              cfg_global.application_dashboard_id IS NULL
              AND cfg_global.panel_id IS NULL
              AND cfg_global.metric_name IS NULL
          )
      )`;
  }

  /**
   * Build WITH dynamic_statistics CTE
   */
  private buildWithDynamicStatisticsCTE(): string {
    return `-- Re-run full ADAPT analysis (same as processAdaptResults CTEs)
      with_dynamic_statistics AS (
          SELECT
              wcc.*,
              CASE (wcc.compare_config->'thresholds'->>'aggregation')
                  WHEN 'mean' THEN wcc.test_mean
                  WHEN 'median' THEN wcc.test_median
                  WHEN 'min' THEN wcc.test_min
                  WHEN 'max' THEN wcc.test_max
                  WHEN 'last' THEN wcc.test_last
                  WHEN 'q10' THEN wcc.test_q10 WHEN 'p10' THEN wcc.test_q10
                  WHEN 'q25' THEN wcc.test_q25 WHEN 'p25' THEN wcc.test_q25
                  WHEN 'q75' THEN wcc.test_q75 WHEN 'p75' THEN wcc.test_q75
                  WHEN 'q90' THEN wcc.test_q90 WHEN 'p90' THEN wcc.test_q90
                  WHEN 'q95' THEN wcc.test_q95 WHEN 'p95' THEN wcc.test_q95
                  WHEN 'q99' THEN wcc.test_q99 WHEN 'p99' THEN wcc.test_q99
                  ELSE wcc.test_median
              END as test_stat_value,
              CASE (wcc.compare_config->'thresholds'->>'aggregation')
                  WHEN 'mean' THEN wcc.control_mean
                  WHEN 'median' THEN wcc.control_median
                  WHEN 'min' THEN wcc.control_min
                  WHEN 'max' THEN wcc.control_max
                  WHEN 'last' THEN wcc.control_last
                  WHEN 'q10' THEN wcc.control_q10 WHEN 'p10' THEN wcc.control_q10
                  WHEN 'q25' THEN wcc.control_q25 WHEN 'p25' THEN wcc.control_q25
                  WHEN 'q75' THEN wcc.control_q75 WHEN 'p75' THEN wcc.control_q75
                  WHEN 'q90' THEN wcc.control_q90 WHEN 'p90' THEN wcc.control_q90
                  WHEN 'q95' THEN wcc.control_q95 WHEN 'p95' THEN wcc.control_q95
                  WHEN 'q99' THEN wcc.control_q99 WHEN 'p99' THEN wcc.control_q99
                  ELSE wcc.control_median
              END as control_stat_value
          FROM with_compare_config wcc
      )`;
  }

  /**
   * Build WITH threshold_calculations CTE
   */
  private buildWithThresholdCalculationsCTE(): string {
    return `with_threshold_calculations AS (
          SELECT
              wds.*,
              (wds.compare_config->'thresholds'->>'percentageThreshold')::float as percentage_threshold,
              (wds.compare_config->'thresholds'->>'iqrThreshold')::float as iqr_threshold,
              (wds.compare_config->'thresholds'->>'absoluteThreshold')::float as absolute_threshold,
              jsonb_build_object(
                  'name', wds.compare_config->'thresholds'->>'aggregation',
                  'test', CASE WHEN wds.test_stat_value IS NOT NULL THEN wds.test_stat_value::text ELSE NULL END,
                  'control', CASE WHEN wds.control_stat_value IS NOT NULL THEN wds.control_stat_value::text ELSE NULL END,
                  'diff', CASE WHEN wds.test_stat_value IS NOT NULL AND wds.control_stat_value IS NOT NULL THEN (wds.test_stat_value - wds.control_stat_value)::text ELSE NULL END,
                  'absDiff', CASE WHEN wds.test_stat_value IS NOT NULL AND wds.control_stat_value IS NOT NULL THEN ABS(wds.test_stat_value - wds.control_stat_value)::text ELSE NULL END,
                  'pctDiff', CASE WHEN wds.test_stat_value IS NOT NULL AND wds.control_stat_value IS NOT NULL AND wds.control_stat_value != 0 THEN ((wds.test_stat_value - wds.control_stat_value) / wds.control_stat_value)::text ELSE NULL END
              ) as statistic,
              (CASE WHEN wds.control_stat_value IS NOT NULL THEN jsonb_build_object(
                  'upper', jsonb_build_object(
                      'pct', CASE WHEN (wds.compare_config->'thresholds'->>'percentageThreshold') IS NOT NULL THEN wds.control_stat_value * (1 + (wds.compare_config->'thresholds'->>'percentageThreshold')::float) ELSE NULL END,
                      'iqr', CASE WHEN wds.control_iqr IS NOT NULL AND (wds.compare_config->'thresholds'->>'iqrThreshold') IS NOT NULL THEN wds.control_stat_value + (wds.control_iqr * (wds.compare_config->'thresholds'->>'iqrThreshold')::float) ELSE NULL END,
                      'abs', CASE WHEN (wds.compare_config->'thresholds'->>'absoluteThreshold') IS NOT NULL THEN wds.control_stat_value + (wds.compare_config->'thresholds'->>'absoluteThreshold')::float ELSE NULL END,
                      'constant', COALESCE(wds.control_stat_value, 0),
                      'overall', GREATEST(
                          CASE WHEN (wds.compare_config->'thresholds'->>'percentageThreshold') IS NOT NULL THEN wds.control_stat_value * (1 + (wds.compare_config->'thresholds'->>'percentageThreshold')::float) ELSE NULL END,
                          CASE WHEN wds.control_iqr IS NOT NULL AND (wds.compare_config->'thresholds'->>'iqrThreshold') IS NOT NULL THEN wds.control_stat_value + (wds.control_iqr * (wds.compare_config->'thresholds'->>'iqrThreshold')::float) ELSE NULL END,
                          CASE WHEN (wds.compare_config->'thresholds'->>'absoluteThreshold') IS NOT NULL THEN wds.control_stat_value + (wds.compare_config->'thresholds'->>'absoluteThreshold')::float ELSE NULL END
                      )
                  ),
                  'lower', jsonb_build_object(
                      'pct', CASE WHEN (wds.compare_config->'thresholds'->>'percentageThreshold') IS NOT NULL THEN wds.control_stat_value * (1 - (wds.compare_config->'thresholds'->>'percentageThreshold')::float) ELSE NULL END,
                      'iqr', CASE WHEN wds.control_iqr IS NOT NULL AND (wds.compare_config->'thresholds'->>'iqrThreshold') IS NOT NULL THEN wds.control_stat_value - (wds.control_iqr * (wds.compare_config->'thresholds'->>'iqrThreshold')::float) ELSE NULL END,
                      'abs', CASE WHEN (wds.compare_config->'thresholds'->>'absoluteThreshold') IS NOT NULL THEN wds.control_stat_value - (wds.compare_config->'thresholds'->>'absoluteThreshold')::float ELSE NULL END,
                      'constant', COALESCE(wds.control_stat_value, 0),
                      'overall', LEAST(
                          CASE WHEN (wds.compare_config->'thresholds'->>'percentageThreshold') IS NOT NULL THEN wds.control_stat_value * (1 - (wds.compare_config->'thresholds'->>'percentageThreshold')::float) ELSE NULL END,
                          CASE WHEN wds.control_iqr IS NOT NULL AND (wds.compare_config->'thresholds'->>'iqrThreshold') IS NOT NULL THEN wds.control_stat_value - (wds.control_iqr * (wds.compare_config->'thresholds'->>'iqrThreshold')::float) ELSE NULL END,
                          CASE WHEN (wds.compare_config->'thresholds'->>'absoluteThreshold') IS NOT NULL THEN wds.control_stat_value - (wds.compare_config->'thresholds'->>'absoluteThreshold')::float ELSE NULL END
                      )
                  )
              ) ELSE jsonb_build_object('upper', jsonb_build_object(), 'lower', jsonb_build_object()) END) as thresholds,
              jsonb_build_object(
                  'pct', jsonb_build_object(
                      'valid', wds.control_exists AND wds.test_stat_value IS NOT NULL AND wds.control_stat_value IS NOT NULL,
                      'isDifference', CASE WHEN wds.control_exists AND wds.test_stat_value IS NOT NULL AND wds.control_stat_value IS NOT NULL AND (wds.compare_config->'thresholds'->>'percentageThreshold') IS NOT NULL THEN (wds.test_stat_value > wds.control_stat_value * (1 + (wds.compare_config->'thresholds'->>'percentageThreshold')::float) OR wds.test_stat_value < wds.control_stat_value * (1 - (wds.compare_config->'thresholds'->>'percentageThreshold')::float)) ELSE false END
                  ),
                  'iqr', jsonb_build_object(
                      -- control_iqr <> 0 guards saturated / zero-variance baselines (#417).
                      'valid', wds.control_exists AND wds.test_stat_value IS NOT NULL AND wds.control_stat_value IS NOT NULL AND wds.control_iqr IS NOT NULL AND wds.control_iqr <> 0,
                      'isDifference', CASE WHEN wds.control_exists AND wds.test_stat_value IS NOT NULL AND wds.control_stat_value IS NOT NULL AND wds.control_iqr IS NOT NULL AND wds.control_iqr <> 0 AND (wds.compare_config->'thresholds'->>'iqrThreshold') IS NOT NULL THEN (wds.test_stat_value > wds.control_stat_value + (wds.control_iqr * (wds.compare_config->'thresholds'->>'iqrThreshold')::float) OR wds.test_stat_value < wds.control_stat_value - (wds.control_iqr * (wds.compare_config->'thresholds'->>'iqrThreshold')::float)) ELSE false END
                  ),
                  'abs', jsonb_build_object(
                      'valid', wds.control_exists AND wds.test_stat_value IS NOT NULL AND wds.control_stat_value IS NOT NULL AND (wds.compare_config->'thresholds'->>'absoluteThreshold') IS NOT NULL,
                      'isDifference', CASE WHEN wds.control_exists AND wds.test_stat_value IS NOT NULL AND wds.control_stat_value IS NOT NULL AND (wds.compare_config->'thresholds'->>'absoluteThreshold') IS NOT NULL THEN ABS(wds.test_stat_value - wds.control_stat_value) > (wds.compare_config->'thresholds'->>'absoluteThreshold')::float ELSE false END
                  )
              ) as checks
          FROM with_dynamic_statistics wds
      )`;
  }

  /**
   * Build final tracked results CTE with re-evaluated conclusion
   */
  private buildFinalTrackedResultsCTE(): string {
    return `final_tracked_results AS (
          SELECT
              wtc.*,
              -- Build re-evaluated conclusion
              jsonb_build_object(
                  'valid', wtc.control_exists AND wtc.test_stat_value IS NOT NULL,
                  'increase', CASE WHEN wtc.test_stat_value IS NOT NULL AND wtc.control_stat_value IS NOT NULL THEN wtc.test_stat_value > wtc.control_stat_value ELSE false END,
                  'decrease', CASE WHEN wtc.test_stat_value IS NOT NULL AND wtc.control_stat_value IS NOT NULL THEN wtc.test_stat_value < wtc.control_stat_value ELSE false END,
                  'partialDifference', CASE WHEN (wtc.checks->'pct'->>'isDifference')::boolean = true OR (wtc.checks->'iqr'->>'isDifference')::boolean = true OR (wtc.checks->'abs'->>'isDifference')::boolean = true THEN true ELSE false END,
                  'allDifference', CASE WHEN (wtc.checks->'pct'->>'isDifference')::boolean = true AND (CASE WHEN (wtc.checks->'iqr'->>'valid')::boolean = true THEN (wtc.checks->'iqr'->>'isDifference')::boolean ELSE true END) AND (CASE WHEN (wtc.checks->'abs'->>'valid')::boolean = true THEN (wtc.checks->'abs'->>'isDifference')::boolean ELSE true END) THEN true ELSE false END,
                  'ignore', COALESCE((wtc.compare_config->>'ignore')::boolean, false),
                  'label', CASE
                      WHEN NOT (wtc.control_exists AND wtc.test_stat_value IS NOT NULL) THEN 'incomparable'
                      WHEN COALESCE((wtc.compare_config->>'ignore')::boolean, false) = true THEN 'ignored'
                      WHEN ((wtc.checks->'pct'->>'isDifference')::boolean = true AND (CASE WHEN (wtc.checks->'iqr'->>'valid')::boolean = true THEN (wtc.checks->'iqr'->>'isDifference')::boolean ELSE true END) AND (CASE WHEN (wtc.checks->'abs'->>'valid')::boolean = true THEN (wtc.checks->'abs'->>'isDifference')::boolean ELSE true END)) THEN
                          CASE
                              WHEN (wtc.compare_config->'metricClassification'->>'higherIsBetter') IS NULL THEN CASE WHEN wtc.test_stat_value > wtc.control_stat_value THEN 'increase' ELSE 'decrease' END
                              WHEN (wtc.compare_config->'metricClassification'->>'higherIsBetter')::boolean = true THEN CASE WHEN wtc.test_stat_value > wtc.control_stat_value THEN 'improvement' ELSE 'regression' END
                              WHEN (wtc.compare_config->'metricClassification'->>'higherIsBetter')::boolean = false THEN CASE WHEN wtc.test_stat_value < wtc.control_stat_value THEN 'improvement' ELSE 'regression' END
                          END
                      WHEN ((wtc.checks->'pct'->>'isDifference')::boolean = true OR (wtc.checks->'iqr'->>'isDifference')::boolean = true OR (wtc.checks->'abs'->>'isDifference')::boolean = true) THEN
                          CASE
                              WHEN (wtc.compare_config->'metricClassification'->>'higherIsBetter') IS NULL THEN CASE WHEN wtc.test_stat_value > wtc.control_stat_value THEN 'partial increase' ELSE 'partial decrease' END
                              WHEN (wtc.compare_config->'metricClassification'->>'higherIsBetter')::boolean = true THEN CASE WHEN wtc.test_stat_value > wtc.control_stat_value THEN 'partial improvement' ELSE 'partial regression' END
                              WHEN (wtc.compare_config->'metricClassification'->>'higherIsBetter')::boolean = false THEN CASE WHEN wtc.test_stat_value < wtc.control_stat_value THEN 'partial improvement' ELSE 'partial regression' END
                          END
                      ELSE 'no difference'
                  END
              ) as conclusion
          FROM with_threshold_calculations wtc
      )`;
  }

  /**
   * Build INSERT statement for tracked results
   */
  private buildInsertStatement(): string {
    return `INSERT INTO ds_adapt_tracked_results (
          test_run_id, control_group_id, application_dashboard_id, panel_id, metric_name,
          dashboard_uid, dashboard_label, panel_title, unit, test_run_start, updated_at,
          tracked_test_run_id, tracked_difference_id, tracked_conclusion,
          mean, median, min_value, max_value, std_dev, q10, q25, q75, q90, q95, q99,
          iqr, idr, count, n_missing, n_non_zero, pct_missing, is_constant, all_missing,
          last_value, exists_flags, uses_default_value, default_value,
          compare_config, metric_classification, statistic, conditions, thresholds, checks, conclusion,
          metrics_source_id,
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
          updated_at,
          tracked_test_run_id,
          tracked_difference_id,
          tracked_conclusion,
          -- Store all re-evaluated statistics as JSONB
          jsonb_build_object('test', test_mean, 'control', control_mean, 'diff', CASE WHEN test_mean IS NOT NULL AND control_mean IS NOT NULL THEN test_mean - control_mean ELSE NULL END, 'absDiff', CASE WHEN test_mean IS NOT NULL AND control_mean IS NOT NULL THEN ABS(test_mean - control_mean) ELSE NULL END, 'pctDiff', CASE WHEN test_mean IS NOT NULL AND control_mean IS NOT NULL AND control_mean != 0 THEN (test_mean - control_mean) / control_mean ELSE NULL END, 'iqrDiff', CASE WHEN test_mean IS NOT NULL AND control_mean IS NOT NULL AND control_iqr IS NOT NULL AND control_iqr != 0 THEN (test_mean - control_mean) / control_iqr ELSE NULL END) as mean,
          jsonb_build_object('test', test_median, 'control', control_median, 'diff', CASE WHEN test_median IS NOT NULL AND control_median IS NOT NULL THEN test_median - control_median ELSE NULL END, 'absDiff', CASE WHEN test_median IS NOT NULL AND control_median IS NOT NULL THEN ABS(test_median - control_median) ELSE NULL END, 'pctDiff', CASE WHEN test_median IS NOT NULL AND control_median IS NOT NULL AND control_median != 0 THEN (test_median - control_median) / control_median ELSE NULL END, 'iqrDiff', CASE WHEN test_median IS NOT NULL AND control_median IS NOT NULL AND control_iqr IS NOT NULL AND control_iqr != 0 THEN (test_median - control_median) / control_iqr ELSE NULL END) as median,
          jsonb_build_object('test', test_min, 'control', control_min) as min_value,
          jsonb_build_object('test', test_max, 'control', control_max) as max_value,
          jsonb_build_object('test', test_std, 'control', control_std) as std_dev,
          jsonb_build_object('test', test_q10, 'control', control_q10) as q10,
          jsonb_build_object('test', test_q25, 'control', control_q25) as q25,
          jsonb_build_object('test', test_q75, 'control', control_q75) as q75,
          jsonb_build_object('test', test_q90, 'control', control_q90) as q90,
          jsonb_build_object('test', test_q95, 'control', control_q95) as q95,
          jsonb_build_object('test', test_q99, 'control', control_q99) as q99,
          jsonb_build_object('test', test_iqr, 'control', control_iqr) as iqr,
          NULL as idr,
          jsonb_build_object('test', test_n, 'control', control_n) as count,
          NULL as n_missing,
          NULL as n_non_zero,
          NULL as pct_missing,
          jsonb_build_object('test', test_is_constant, 'control', control_is_constant) as is_constant,
          jsonb_build_object('test', test_all_missing, 'control', control_all_missing) as all_missing,
          jsonb_build_object('test', test_last, 'control', control_last) as last_value,
          jsonb_build_object('test', NOT COALESCE(test_all_missing, true), 'control', NOT COALESCE(control_all_missing, true)) as exists_flags,
          false as uses_default_value,
          NULL as default_value,
          compare_config,
          compare_config->'metricClassification' as metric_classification,
          statistic,
          jsonb_build_object('controlExists', control_exists, 'testStatValue', test_stat_value, 'controlStatValue', control_stat_value, 'configuredAggregation', compare_config->'thresholds'->>'aggregation') as conditions,
          thresholds,
          checks,
          conclusion,
          metrics_source_id,
          organization_id,
          team_id,
          'worker-pipeline' as created_by,
          'worker-pipeline' as updated_by
      FROM final_tracked_results
      ON CONFLICT (test_run_id, application_dashboard_id, panel_id, metric_name, tracked_test_run_id)
      DO UPDATE SET
          dashboard_uid = EXCLUDED.dashboard_uid,
          dashboard_label = EXCLUDED.dashboard_label,
          panel_title = EXCLUDED.panel_title,
          unit = EXCLUDED.unit,
          test_run_start = EXCLUDED.test_run_start,
          updated_at = EXCLUDED.updated_at,
          tracked_conclusion = EXCLUDED.tracked_conclusion,
          mean = EXCLUDED.mean,
          median = EXCLUDED.median,
          min_value = EXCLUDED.min_value,
          max_value = EXCLUDED.max_value,
          std_dev = EXCLUDED.std_dev,
          q10 = EXCLUDED.q10,
          q25 = EXCLUDED.q25,
          q75 = EXCLUDED.q75,
          q90 = EXCLUDED.q90,
          q95 = EXCLUDED.q95,
          q99 = EXCLUDED.q99,
          iqr = EXCLUDED.iqr,
          idr = EXCLUDED.idr,
          count = EXCLUDED.count,
          n_missing = EXCLUDED.n_missing,
          n_non_zero = EXCLUDED.n_non_zero,
          pct_missing = EXCLUDED.pct_missing,
          is_constant = EXCLUDED.is_constant,
          all_missing = EXCLUDED.all_missing,
          last_value = EXCLUDED.last_value,
          exists_flags = EXCLUDED.exists_flags,
          uses_default_value = EXCLUDED.uses_default_value,
          default_value = EXCLUDED.default_value,
          compare_config = EXCLUDED.compare_config,
          metric_classification = EXCLUDED.metric_classification,
          statistic = EXCLUDED.statistic,
          conditions = EXCLUDED.conditions,
          thresholds = EXCLUDED.thresholds,
          checks = EXCLUDED.checks,
          conclusion = EXCLUDED.conclusion,
          metrics_source_id = COALESCE(EXCLUDED.metrics_source_id, ds_adapt_tracked_results.metrics_source_id),
          organization_id = EXCLUDED.organization_id,
          team_id = EXCLUDED.team_id,
          updated_by = EXCLUDED.updated_by
    `;
  }
}
