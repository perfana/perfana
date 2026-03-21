/**
 * SQL Fragment Builders for ADAPT Results
 *
 * Contains reusable SQL fragment builders for threshold calculations,
 * conclusion logic, and statistics columns.
 */

/**
 * SQL Fragment Builders
 *
 * Extracts common SQL fragments to reduce complexity in main SQL builder.
 */
export class AdaptSQLFragments {
  /**
   * Build threshold calculations CTE fragment
   */
  buildThresholdCalculationsCTE(): string {
    return `with_threshold_calculations AS (
          SELECT
              wds.*,
              -- Extract threshold values
              (wds.compare_config->'thresholds'->>'percentageThreshold')::float as percentage_threshold,
              (wds.compare_config->'thresholds'->>'iqrThreshold')::float as iqr_threshold,
              (wds.compare_config->'thresholds'->>'absoluteThreshold')::float as absolute_threshold,

              -- Calculate statistical differences (matching legacy Python format)
              jsonb_build_object(
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
              ) as statistic,

              ${this.buildThresholdsJSONB()},

              ${this.buildChecksJSONB()}
          FROM with_dynamic_statistics wds
      )`;
  }

  /**
   * Build thresholds JSONB calculation
   */
  buildThresholdsJSONB(): string {
    return `-- Calculate upper and lower thresholds (legacy format with overall)
              (CASE
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
   * Build threshold checks JSONB
   */
  buildChecksJSONB(): string {
    return `-- Individual threshold checks
              jsonb_build_object(
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
   * Build conclusion logic for labeling results
   */
  buildConclusionLogic(): string {
    return `-- Build conclusion
              jsonb_build_object(
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
                  'label', CASE
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
                  END
              ) as conclusion`;
  }

  /**
   * Build all statistics columns as JSONB with complete calculations
   */
  buildStatisticsColumns(): string {
    const stats = ['mean', 'median', 'min', 'max', 'std', 'last', 'q10', 'q25', 'q75', 'q90', 'q95', 'q99', 'iqr'];
    const columns: string[] = [];

    for (const stat of stats) {
      const testCol = `test_${stat}`;
      const controlCol = `control_${stat}`;
      const outputName = stat === 'last' ? 'last_value' : stat;

      if (stat === 'iqr') {
        // IQR doesn't need all calculations, just test and control
        columns.push(`jsonb_build_object(
              'test', ${testCol},
              'control', ${controlCol}
          ) as ${outputName}`);
      } else {
        columns.push(`jsonb_build_object(
              'test', ${testCol},
              'control', ${controlCol},
              'diff', CASE WHEN ${testCol} IS NOT NULL AND ${controlCol} IS NOT NULL THEN ${testCol} - ${controlCol} ELSE NULL END,
              'absDiff', CASE WHEN ${testCol} IS NOT NULL AND ${controlCol} IS NOT NULL THEN ABS(${testCol} - ${controlCol}) ELSE NULL END,
              'pctDiff', CASE WHEN ${testCol} IS NOT NULL AND ${controlCol} IS NOT NULL AND ${controlCol} != 0 THEN (${testCol} - ${controlCol}) / ${controlCol} ELSE NULL END,
              'iqrDiff', CASE WHEN ${testCol} IS NOT NULL AND ${controlCol} IS NOT NULL AND control_iqr IS NOT NULL AND control_iqr != 0 THEN (${testCol} - ${controlCol}) / control_iqr ELSE NULL END
          ) as ${outputName}`);
      }
    }

    // Add the remaining columns
    columns.push(`jsonb_build_object('test', test_n, 'control', control_n) as n`);
    columns.push(`jsonb_build_object('test', test_is_constant, 'control', control_is_constant) as is_constant`);
    columns.push(`jsonb_build_object('test', test_all_missing, 'control', control_all_missing) as all_missing`);
    columns.push(`jsonb_build_object('test', NOT COALESCE(test_all_missing, true), 'control', NOT COALESCE(control_all_missing, true)) as exists_data`);
    columns.push(`compare_config, compare_config->'metricClassification' as metric_classification`);
    columns.push(`statistic, thresholds`);
    columns.push(`jsonb_build_object('controlExists', control_exists, 'testStatValue', test_stat_value, 'controlStatValue', control_stat_value, 'configuredAggregation', compare_config->'thresholds'->>'aggregation') as conditions`);
    columns.push(`checks, conclusion`);
    columns.push(`false as uses_default_value, NULL as default_value`);

    return columns.join(',\n          ');
  }
}
