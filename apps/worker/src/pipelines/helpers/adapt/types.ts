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
interface ThresholdConfig {
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
interface MetricClassification {
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

