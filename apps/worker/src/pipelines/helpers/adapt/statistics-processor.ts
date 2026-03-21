/**
 * Statistics Processor for ADAPT Pipeline
 *
 * Handles statistics calculation operations including:
 * - Building threshold calculations SQL
 * - Building threshold checks SQL
 * - Building statistic comparison JSONB
 * - Building conclusion JSONB
 *
 * This processor is responsible for calculating statistical differences
 * and determining whether metrics exceed configured thresholds.
 */

import type { Logger } from 'pino';

/**
 * Statistics Processor
 *
 * Manages statistics calculation operations for the ADAPT pipeline including
 * threshold calculations, checks, and conclusion building.
 */
export class StatisticsProcessor {
  constructor(private logger: Logger) {}

  /**
   * Build SQL fragment for threshold calculations
   *
   * Creates a CTE that calculates thresholds and statistical differences
   * from dynamic statistics values. This includes building the statistic
   * comparison object and threshold bounds.
   *
   * @param dynamicStatsCte - Name of the CTE containing dynamic statistics
   * @returns SQL fragment for the with_threshold_calculations CTE
   */
  buildThresholdCalculationsSQL(dynamicStatsCte: string): string {
    return `
      with_threshold_calculations AS (
          SELECT
              wds.*,
              -- Extract threshold values
              (wds.compare_config->'thresholds'->>'percentageThreshold')::float as percentage_threshold,
              (wds.compare_config->'thresholds'->>'iqrThreshold')::float as iqr_threshold,
              (wds.compare_config->'thresholds'->>'absoluteThreshold')::float as absolute_threshold,

              -- Calculate statistical differences (matching legacy Python format)
              ${this.buildStatisticJsonbSQL()},

              -- Calculate upper and lower thresholds (legacy format with overall)
              ${this.buildThresholdsJsonbSQL()},

              -- Individual threshold checks
              ${this.buildChecksJsonbSQL()}
          FROM ${dynamicStatsCte} wds
      )
    `;
  }

  /**
   * Build SQL fragment for the statistic comparison JSONB
   *
   * @returns SQL fragment for building the statistic JSONB column
   */
  buildStatisticJsonbSQL(): string {
    return `jsonb_build_object(
                  'name', wds.compare_config->'thresholds'->>'aggregation',
                  'test', CASE
                      WHEN wds.test_stat_value IS NOT NULL
                      THEN wds.test_stat_value::text
                      ELSE NULL
                  END,
                  'control', CASE
                      WHEN wds.control_stat_value IS NOT NULL
                      THEN wds.control_stat_value::text
                      ELSE NULL
                  END,
                  'diff', CASE
                      WHEN wds.test_stat_value IS NOT NULL AND wds.control_stat_value IS NOT NULL
                      THEN (wds.test_stat_value - wds.control_stat_value)::text
                      ELSE NULL
                  END,
                  'absDiff', CASE
                      WHEN wds.test_stat_value IS NOT NULL AND wds.control_stat_value IS NOT NULL
                      THEN ABS(wds.test_stat_value - wds.control_stat_value)::text
                      ELSE NULL
                  END,
                  'pctDiff', CASE
                      WHEN wds.test_stat_value IS NOT NULL AND wds.control_stat_value IS NOT NULL AND wds.control_stat_value != 0
                      THEN ((wds.test_stat_value - wds.control_stat_value) / wds.control_stat_value)::text
                      ELSE NULL
                  END
              ) as statistic`;
  }

  /**
   * Build SQL fragment for the thresholds bounds JSONB
   *
   * @returns SQL fragment for building the thresholds JSONB column
   */
  buildThresholdsJsonbSQL(): string {
    return `(CASE
                  WHEN wds.control_stat_value IS NOT NULL THEN
                      jsonb_build_object(
                          'upper', jsonb_build_object(
                              'pct', CASE
                                  WHEN (wds.compare_config->'thresholds'->>'percentageThreshold') IS NOT NULL
                                  THEN wds.control_stat_value * (1 + (wds.compare_config->'thresholds'->>'percentageThreshold')::float)
                                  ELSE NULL
                              END,
                              'iqr', CASE
                                  WHEN wds.control_iqr IS NOT NULL AND (wds.compare_config->'thresholds'->>'iqrThreshold') IS NOT NULL
                                  THEN wds.control_stat_value + (wds.control_iqr * (wds.compare_config->'thresholds'->>'iqrThreshold')::float)
                                  ELSE NULL
                              END,
                              'abs', CASE
                                  WHEN (wds.compare_config->'thresholds'->>'absoluteThreshold') IS NOT NULL
                                  THEN wds.control_stat_value + (wds.compare_config->'thresholds'->>'absoluteThreshold')::float
                                  ELSE NULL
                              END,
                              'constant', COALESCE(wds.control_stat_value, 0),
                              'overall', GREATEST(
                                  CASE
                                      WHEN (wds.compare_config->'thresholds'->>'percentageThreshold') IS NOT NULL
                                      THEN wds.control_stat_value * (1 + (wds.compare_config->'thresholds'->>'percentageThreshold')::float)
                                      ELSE NULL
                                  END,
                                  CASE
                                      WHEN wds.control_iqr IS NOT NULL AND (wds.compare_config->'thresholds'->>'iqrThreshold') IS NOT NULL
                                      THEN wds.control_stat_value + (wds.control_iqr * (wds.compare_config->'thresholds'->>'iqrThreshold')::float)
                                      ELSE NULL
                                  END,
                                  CASE
                                      WHEN (wds.compare_config->'thresholds'->>'absoluteThreshold') IS NOT NULL
                                      THEN wds.control_stat_value + (wds.compare_config->'thresholds'->>'absoluteThreshold')::float
                                      ELSE NULL
                                  END
                              )
                          ),
                          'lower', jsonb_build_object(
                              'pct', CASE
                                  WHEN (wds.compare_config->'thresholds'->>'percentageThreshold') IS NOT NULL
                                  THEN wds.control_stat_value * (1 - (wds.compare_config->'thresholds'->>'percentageThreshold')::float)
                                  ELSE NULL
                              END,
                              'iqr', CASE
                                  WHEN wds.control_iqr IS NOT NULL AND (wds.compare_config->'thresholds'->>'iqrThreshold') IS NOT NULL
                                  THEN wds.control_stat_value - (wds.control_iqr * (wds.compare_config->'thresholds'->>'iqrThreshold')::float)
                                  ELSE NULL
                              END,
                              'abs', CASE
                                  WHEN (wds.compare_config->'thresholds'->>'absoluteThreshold') IS NOT NULL
                                  THEN wds.control_stat_value - (wds.compare_config->'thresholds'->>'absoluteThreshold')::float
                                  ELSE NULL
                              END,
                              'constant', COALESCE(wds.control_stat_value, 0),
                              'overall', LEAST(
                                  CASE
                                      WHEN (wds.compare_config->'thresholds'->>'percentageThreshold') IS NOT NULL
                                      THEN wds.control_stat_value * (1 - (wds.compare_config->'thresholds'->>'percentageThreshold')::float)
                                      ELSE NULL
                                  END,
                                  CASE
                                      WHEN wds.control_iqr IS NOT NULL AND (wds.compare_config->'thresholds'->>'iqrThreshold') IS NOT NULL
                                      THEN wds.control_stat_value - (wds.control_iqr * (wds.compare_config->'thresholds'->>'iqrThreshold')::float)
                                      ELSE NULL
                                  END,
                                  CASE
                                      WHEN (wds.compare_config->'thresholds'->>'absoluteThreshold') IS NOT NULL
                                      THEN wds.control_stat_value - (wds.compare_config->'thresholds'->>'absoluteThreshold')::float
                                      ELSE NULL
                                  END
                              )
                          )
                      )
                  ELSE
                      -- Return empty JSONB object when control_stat_value is NULL to satisfy NOT NULL constraint
                      jsonb_build_object(
                          'upper', jsonb_build_object(),
                          'lower', jsonb_build_object()
                      )
              END) as thresholds`;
  }

  /**
   * Build SQL fragment for the threshold checks JSONB
   *
   * @returns SQL fragment for building the checks JSONB column
   */
  buildChecksJsonbSQL(): string {
    return `jsonb_build_object(
                  'pct', jsonb_build_object(
                      'valid', wds.control_exists AND wds.test_stat_value IS NOT NULL AND wds.control_stat_value IS NOT NULL,
                      'isDifference', CASE
                          WHEN wds.control_exists AND wds.test_stat_value IS NOT NULL AND wds.control_stat_value IS NOT NULL AND (wds.compare_config->'thresholds'->>'percentageThreshold') IS NOT NULL
                          THEN (wds.test_stat_value > wds.control_stat_value * (1 + (wds.compare_config->'thresholds'->>'percentageThreshold')::float) OR
                                wds.test_stat_value < wds.control_stat_value * (1 - (wds.compare_config->'thresholds'->>'percentageThreshold')::float))
                          ELSE false
                      END
                  ),
                  'iqr', jsonb_build_object(
                      'valid', wds.control_exists AND wds.test_stat_value IS NOT NULL AND wds.control_stat_value IS NOT NULL AND wds.control_iqr IS NOT NULL,
                      'isDifference', CASE
                          WHEN wds.control_exists AND wds.test_stat_value IS NOT NULL AND wds.control_stat_value IS NOT NULL AND wds.control_iqr IS NOT NULL AND (wds.compare_config->'thresholds'->>'iqrThreshold') IS NOT NULL
                          THEN (wds.test_stat_value > wds.control_stat_value + (wds.control_iqr * (wds.compare_config->'thresholds'->>'iqrThreshold')::float) OR
                                wds.test_stat_value < wds.control_stat_value - (wds.control_iqr * (wds.compare_config->'thresholds'->>'iqrThreshold')::float))
                          ELSE false
                      END
                  ),
                  'abs', jsonb_build_object(
                      'valid', wds.control_exists AND wds.test_stat_value IS NOT NULL AND wds.control_stat_value IS NOT NULL AND (wds.compare_config->'thresholds'->>'absoluteThreshold') IS NOT NULL,
                      'isDifference', CASE
                          WHEN wds.control_exists AND wds.test_stat_value IS NOT NULL AND wds.control_stat_value IS NOT NULL AND (wds.compare_config->'thresholds'->>'absoluteThreshold') IS NOT NULL
                          THEN ABS(wds.test_stat_value - wds.control_stat_value) > (wds.compare_config->'thresholds'->>'absoluteThreshold')::float
                          ELSE false
                      END
                  )
              ) as checks`;
  }

  /**
   * Build SQL fragment for final results with conclusion
   *
   * Creates a CTE that calculates partial/all difference flags and builds
   * the conclusion JSONB with appropriate labels based on threshold checks
   * and metric classification.
   *
   * @param thresholdCalcsCte - Name of the CTE containing threshold calculations
   * @returns SQL fragment for the final_results CTE
   */
  buildFinalResultsSQL(thresholdCalcsCte: string): string {
    return `
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

              -- Build conclusion
              ${this.buildConclusionJsonbSQL()}
          FROM ${thresholdCalcsCte} wtc
      )
    `;
  }

  /**
   * Build SQL fragment for the conclusion JSONB
   *
   * @returns SQL fragment for building the conclusion JSONB column
   */
  buildConclusionJsonbSQL(): string {
    return `jsonb_build_object(
                  'valid', wtc.control_exists AND wtc.test_stat_value IS NOT NULL,
                  'increase', CASE
                      WHEN wtc.test_stat_value IS NOT NULL AND wtc.control_stat_value IS NOT NULL
                      THEN wtc.test_stat_value > wtc.control_stat_value
                      ELSE false
                  END,
                  'decrease', CASE
                      WHEN wtc.test_stat_value IS NOT NULL AND wtc.control_stat_value IS NOT NULL
                      THEN wtc.test_stat_value < wtc.control_stat_value
                      ELSE false
                  END,
                  'partialDifference', CASE
                      WHEN (wtc.checks->'pct'->>'isDifference')::boolean = true OR
                           (wtc.checks->'iqr'->>'isDifference')::boolean = true OR
                           (wtc.checks->'abs'->>'isDifference')::boolean = true
                      THEN true
                      ELSE false
                  END,
                  'allDifference', CASE
                      WHEN (wtc.checks->'pct'->>'isDifference')::boolean = true AND
                           (CASE WHEN (wtc.checks->'iqr'->>'valid')::boolean = true
                            THEN (wtc.checks->'iqr'->>'isDifference')::boolean
                            ELSE true END) AND
                           (CASE WHEN (wtc.checks->'abs'->>'valid')::boolean = true
                            THEN (wtc.checks->'abs'->>'isDifference')::boolean
                            ELSE true END)
                      THEN true
                      ELSE false
                  END,
                  'ignore', COALESCE((wtc.compare_config->>'ignore')::boolean, false),
                  'label', ${this.buildConclusionLabelSQL()}
              ) as conclusion`;
  }

  /**
   * Build SQL fragment for the conclusion label logic
   *
   * @returns SQL fragment for determining the conclusion label
   */
  buildConclusionLabelSQL(): string {
    return `CASE
                      -- Basic validity checks
                      WHEN NOT (wtc.control_exists AND wtc.test_stat_value IS NOT NULL) THEN 'incomparable'
                      WHEN COALESCE((wtc.compare_config->>'ignore')::boolean, false) = true THEN 'ignored'

                      -- Check for allDifference (ALL applicable thresholds show difference) - for full labels
                      WHEN ((wtc.checks->'pct'->>'isDifference')::boolean = true AND
                            (CASE WHEN (wtc.checks->'iqr'->>'valid')::boolean = true
                             THEN (wtc.checks->'iqr'->>'isDifference')::boolean
                             ELSE true END) AND
                            (CASE WHEN (wtc.checks->'abs'->>'valid')::boolean = true
                             THEN (wtc.checks->'abs'->>'isDifference')::boolean
                             ELSE true END)) THEN
                          -- Full labels when allDifference is true
                          CASE
                              WHEN (wtc.compare_config->'metricClassification'->>'higherIsBetter') IS NULL THEN
                                  CASE
                                      WHEN wtc.test_stat_value > wtc.control_stat_value THEN 'increase'
                                      ELSE 'decrease'
                                  END

                              -- For metrics where higher is better (explicitly true)
                              WHEN (wtc.compare_config->'metricClassification'->>'higherIsBetter')::boolean = true THEN
                                  CASE
                                      WHEN wtc.test_stat_value > wtc.control_stat_value THEN 'improvement'
                                      ELSE 'regression'
                                  END

                              -- For metrics where lower is better (explicitly false)
                              WHEN (wtc.compare_config->'metricClassification'->>'higherIsBetter')::boolean = false THEN
                                  CASE
                                      WHEN wtc.test_stat_value < wtc.control_stat_value THEN 'improvement'
                                      ELSE 'regression'
                                  END
                          END

                      -- Check for partialDifference (ANY threshold shows difference) - for partial labels
                      WHEN ((wtc.checks->'pct'->>'isDifference')::boolean = true OR
                            (wtc.checks->'iqr'->>'isDifference')::boolean = true OR
                            (wtc.checks->'abs'->>'isDifference')::boolean = true) THEN
                          -- Partial labels when partialDifference is true but allDifference is false
                          CASE
                              WHEN (wtc.compare_config->'metricClassification'->>'higherIsBetter') IS NULL THEN
                                  CASE
                                      WHEN wtc.test_stat_value > wtc.control_stat_value THEN 'partial increase'
                                      ELSE 'partial decrease'
                                  END
                              WHEN (wtc.compare_config->'metricClassification'->>'higherIsBetter')::boolean = true THEN
                                  CASE
                                      WHEN wtc.test_stat_value > wtc.control_stat_value THEN 'partial improvement'
                                      ELSE 'partial regression'
                                  END
                              WHEN (wtc.compare_config->'metricClassification'->>'higherIsBetter')::boolean = false THEN
                                  CASE
                                      WHEN wtc.test_stat_value < wtc.control_stat_value THEN 'partial improvement'
                                      ELSE 'partial regression'
                                  END
                          END

                      ELSE 'no difference'
                  END`;
  }

  /**
   * Build SQL fragment for metric statistics JSONB with full calculations
   *
   * Creates JSONB objects for each statistic type (mean, median, etc.) with
   * test value, control value, diff, absDiff, pctDiff, and iqrDiff.
   *
   * @param testPrefix - Prefix for test columns (e.g., 'test_')
   * @param controlPrefix - Prefix for control columns (e.g., 'control_')
   * @param iqrColumn - Name of the control IQR column for iqrDiff calculation
   * @returns Array of SQL fragments for each statistic JSONB column
   */
  buildMetricStatsJsonbSQL(
    testPrefix = 'test_',
    controlPrefix = 'control_',
    iqrColumn = 'control_iqr'
  ): Record<string, string> {
    const stats = ['mean', 'median', 'min', 'max', 'std', 'last', 'q10', 'q25', 'q75', 'q90', 'q95', 'q99', 'iqr', 'n'];

    const result: Record<string, string> = {};

    for (const stat of stats) {
      const testCol = `${testPrefix}${stat}`;
      const controlCol = `${controlPrefix}${stat}`;

      // Special case for 'n' (count) - no iqrDiff
      if (stat === 'n') {
        result[stat] = `jsonb_build_object(
              'test', ${testCol},
              'control', ${controlCol},
              'diff', CASE WHEN ${testCol} IS NOT NULL AND ${controlCol} IS NOT NULL THEN ${testCol} - ${controlCol} ELSE NULL END,
              'absDiff', CASE WHEN ${testCol} IS NOT NULL AND ${controlCol} IS NOT NULL THEN ABS(${testCol} - ${controlCol}) ELSE NULL END,
              'pctDiff', CASE WHEN ${testCol} IS NOT NULL AND ${controlCol} IS NOT NULL AND ${controlCol} != 0 THEN (${testCol} - ${controlCol}) / ${controlCol} ELSE NULL END,
              'iqrDiff', NULL  -- Not applicable for count statistics
          )`;
      } else {
        result[stat] = `jsonb_build_object(
              'test', ${testCol},
              'control', ${controlCol},
              'diff', CASE WHEN ${testCol} IS NOT NULL AND ${controlCol} IS NOT NULL THEN ${testCol} - ${controlCol} ELSE NULL END,
              'absDiff', CASE WHEN ${testCol} IS NOT NULL AND ${controlCol} IS NOT NULL THEN ABS(${testCol} - ${controlCol}) ELSE NULL END,
              'pctDiff', CASE WHEN ${testCol} IS NOT NULL AND ${controlCol} IS NOT NULL AND ${controlCol} != 0 THEN (${testCol} - ${controlCol}) / ${controlCol} ELSE NULL END,
              'iqrDiff', CASE WHEN ${testCol} IS NOT NULL AND ${controlCol} IS NOT NULL AND ${iqrColumn} IS NOT NULL AND ${iqrColumn} != 0 THEN (${testCol} - ${controlCol}) / ${iqrColumn} ELSE NULL END
          )`;
      }
    }

    return result;
  }

  /**
   * Build SQL fragment for conditions JSONB
   *
   * @returns SQL fragment for building the conditions JSONB column
   */
  buildConditionsJsonbSQL(): string {
    return `jsonb_build_object(
              'controlExists', control_exists,
              'testStatValue', test_stat_value,
              'controlStatValue', control_stat_value,
              'configuredAggregation', compare_config->'thresholds'->>'aggregation'
          ) as conditions`;
  }

  /**
   * Build SQL fragment for is_constant JSONB
   *
   * @param testCol - Name of test is_constant column
   * @param controlCol - Name of control is_constant column
   * @returns SQL fragment for building the is_constant JSONB
   */
  buildIsConstantJsonbSQL(testCol = 'test_is_constant', controlCol = 'control_is_constant'): string {
    return `jsonb_build_object('test', ${testCol}, 'control', ${controlCol}) as is_constant`;
  }

  /**
   * Build SQL fragment for all_missing JSONB
   *
   * @param testCol - Name of test all_missing column
   * @param controlCol - Name of control all_missing column
   * @returns SQL fragment for building the all_missing JSONB
   */
  buildAllMissingJsonbSQL(testCol = 'test_all_missing', controlCol = 'control_all_missing'): string {
    return `jsonb_build_object('test', ${testCol}, 'control', ${controlCol}) as all_missing`;
  }

  /**
   * Build SQL fragment for exists_data JSONB
   *
   * @param testAllMissingCol - Name of test all_missing column
   * @param controlAllMissingCol - Name of control all_missing column
   * @returns SQL fragment for building the exists_data JSONB
   */
  buildExistsDataJsonbSQL(testAllMissingCol = 'test_all_missing', controlAllMissingCol = 'control_all_missing'): string {
    return `jsonb_build_object('test', NOT COALESCE(${testAllMissingCol}, true), 'control', NOT COALESCE(${controlAllMissingCol}, true)) as exists_data`;
  }

  /**
   * Build compact threshold calculations SQL for tracked results
   *
   * Creates a more compact version of threshold calculations suitable for
   * the tracked results re-evaluation query. This version uses inline SQL
   * without separate CTEs for each step.
   *
   * @param compareConfigCte - Name of the CTE containing compare config
   * @returns SQL fragment for compact threshold calculations CTE
   */
  buildCompactThresholdCalculationsSQL(compareConfigCte: string): string {
    return `
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
          FROM ${compareConfigCte} wcc
      ),
      with_threshold_calculations AS (
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
                      'valid', wds.control_exists AND wds.test_stat_value IS NOT NULL AND wds.control_stat_value IS NOT NULL AND wds.control_iqr IS NOT NULL,
                      'isDifference', CASE WHEN wds.control_exists AND wds.test_stat_value IS NOT NULL AND wds.control_stat_value IS NOT NULL AND wds.control_iqr IS NOT NULL AND (wds.compare_config->'thresholds'->>'iqrThreshold') IS NOT NULL THEN (wds.test_stat_value > wds.control_stat_value + (wds.control_iqr * (wds.compare_config->'thresholds'->>'iqrThreshold')::float) OR wds.test_stat_value < wds.control_stat_value - (wds.control_iqr * (wds.compare_config->'thresholds'->>'iqrThreshold')::float)) ELSE false END
                  ),
                  'abs', jsonb_build_object(
                      'valid', wds.control_exists AND wds.test_stat_value IS NOT NULL AND wds.control_stat_value IS NOT NULL AND (wds.compare_config->'thresholds'->>'absoluteThreshold') IS NOT NULL,
                      'isDifference', CASE WHEN wds.control_exists AND wds.test_stat_value IS NOT NULL AND wds.control_stat_value IS NOT NULL AND (wds.compare_config->'thresholds'->>'absoluteThreshold') IS NOT NULL THEN ABS(wds.test_stat_value - wds.control_stat_value) > (wds.compare_config->'thresholds'->>'absoluteThreshold')::float ELSE false END
                  )
              ) as checks
          FROM with_dynamic_statistics wds
      )
    `;
  }

  /**
   * Build compact final tracked results SQL
   *
   * Creates a more compact version of final results with conclusion,
   * suitable for the tracked results re-evaluation query.
   *
   * @param thresholdCalcsCte - Name of the CTE containing threshold calculations
   * @returns SQL fragment for final tracked results CTE
   */
  buildCompactFinalTrackedResultsSQL(thresholdCalcsCte: string): string {
    return `
      final_tracked_results AS (
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
          FROM ${thresholdCalcsCte} wtc
      )
    `;
  }
}
