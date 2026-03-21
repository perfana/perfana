/**
 * TypeScript Types and Interfaces for ADAPT Pipeline
 *
 * ADAPT (Automated Detection of Anomalies in Performance Tests) is the core
 * performance analysis algorithm that compares test runs against control groups
 * to detect performance regressions and improvements.
 *
 * This module defines the input/output types, configuration interfaces, and
 * result structures used throughout the ADAPT pipeline processing.
 */

/**
 * Input configuration for ADAPT pipeline execution
 */
export interface AdaptInput {
  /**
   * Array of test run IDs to analyze
   */
  testRunIds: string[];

  /**
   * Whether to update control group (default: true)
   */
  updateControlGroup?: boolean;

  /**
   * Whether to update control statistics (default: true)
   */
  updateControlStatistics?: boolean;

  /**
   * Whether to update ADAPT results (default: true)
   */
  updateResults?: boolean;

  /**
   * Whether to update conclusions (default: true)
   */
  updateConclusion?: boolean;

  /**
   * Whether to update tracked results (default: true)
   */
  updateTrackedResults?: boolean;

  /**
   * Optional: Filter to specific application dashboard for re-evaluation
   */
  applicationDashboardId?: string;

  /**
   * Optional: Filter to specific panel for re-evaluation
   */
  panelId?: number;

  /**
   * Optional: Filter to specific metric for re-evaluation
   */
  metricName?: string;
}

/**
 * Threshold configuration for ADAPT comparison
 */
export interface ThresholdConfig {
  /**
   * Percentage threshold for determining difference
   */
  percentageThreshold: number;

  /**
   * IQR (Interquartile Range) threshold for determining difference
   */
  iqrThreshold?: number;

  /**
   * Absolute threshold for determining difference
   */
  absoluteThreshold?: number;

  /**
   * Aggregation method used (e.g., 'mean', 'p90', 'p95', 'p99')
   */
  aggregation: string;
}

/**
 * Metric classification for determining comparison direction
 */
export interface MetricClassification {
  /**
   * Classification type (e.g., 'RED_duration', 'RED_errors', 'RED_rate', 'load', 'none')
   */
  classification: string;

  /**
   * Whether higher values are better for this metric
   * - true: higher is better (e.g., throughput)
   * - false: lower is better (e.g., response time, errors)
   * - null: no preference (e.g., load metrics)
   */
  higherIsBetter: boolean | null;
}

/**
 * Compare configuration combining thresholds and classification
 */
export interface CompareConfig {
  /**
   * Threshold configuration for this metric
   */
  thresholds: ThresholdConfig;

  /**
   * Classification for determining comparison direction
   */
  metricClassification: MetricClassification;

  /**
   * Default value to use if control group is missing
   */
  defaultValueIfControlGroupMissing?: number | null;

  /**
   * Whether to ignore this metric in comparisons
   */
  ignore: boolean;

  /**
   * Source of this configuration (e.g., 'default', 'user', 'auto')
   */
  source: string;
}

/**
 * Statistical result for a single metric comparison
 */
export interface StatisticResult {
  /**
   * Test value (current test run)
   */
  test: number | null;

  /**
   * Control value (baseline from control group)
   */
  control: number | null;

  /**
   * Raw difference (test - control)
   */
  diff: number | null;

  /**
   * Percentage difference ((test - control) / control * 100)
   */
  pctDiff: number | null;

  /**
   * Absolute difference (|test - control|)
   */
  absDiff: number | null;

  /**
   * IQR-based difference for robust comparison
   */
  iqrDiff: number | null;
}

/**
 * Individual threshold check result
 */
export interface ThresholdCheckResult {
  /**
   * Whether the threshold is valid/applicable
   */
  valid: boolean;

  /**
   * Whether a significant difference was detected
   */
  isDifference: boolean;
}

/**
 * Combined threshold checks for all threshold types
 */
export interface ThresholdChecks {
  /**
   * Percentage threshold check result
   */
  pct: ThresholdCheckResult;

  /**
   * IQR threshold check result
   */
  iqr: ThresholdCheckResult;

  /**
   * Absolute threshold check result
   */
  abs: ThresholdCheckResult;
}

/**
 * Final ADAPT conclusion for a metric comparison
 */
export interface AdaptConclusion {
  /**
   * Whether the comparison is valid
   */
  valid: boolean;

  /**
   * Whether the metric increased (degraded for lower-is-better metrics)
   */
  increase: boolean;

  /**
   * Whether the metric decreased (improved for lower-is-better metrics)
   */
  decrease: boolean;

  /**
   * Whether only some threshold checks showed a difference
   */
  partialDifference: boolean;

  /**
   * Whether all threshold checks showed a difference
   */
  allDifference: boolean;

  /**
   * Whether this metric was ignored in the comparison
   */
  ignore: boolean;

  /**
   * Human-readable label for the conclusion
   * (e.g., 'REGRESSION', 'IMPROVEMENT', 'STABLE', 'IGNORED')
   */
  label: string;
}
