/**
 * TypeScript Types and Interfaces for Incremental Metrics Pipeline
 *
 * The Incremental Metrics Pipeline supports real-time metric collection during
 * test execution by fetching data from multiple sources (Grafana, Dynatrace,
 * performance test tables) for specific time ranges.
 *
 * This module defines the input/output types, collection result structures,
 * and configuration interfaces used throughout the incremental metrics pipeline.
 */

/**
 * Input parameters for incremental metrics collection
 */
export interface IncrementalMetricsInput {
  /**
   * Test run ID to collect metrics for
   */
  testRunId: string;

  /**
   * Start of time range to collect (inclusive)
   */
  fromTime: Date;

  /**
   * End of time range to collect (inclusive)
   */
  toTime: Date;

  /**
   * Grafana instance ID (optional - if provided, only collect from this instance)
   */
  grafanaInstanceId?: string;

  /**
   * Application dashboard IDs to collect (optional - if not provided, collects all)
   */
  applicationDashboardIds?: string[];

  /**
   * Metrics source IDs to collect (optional - preferred over applicationDashboardIds when populated)
   */
  metricsSourceIds?: string[];

  /**
   * Dynatrace config ID (optional - if provided, only collect from this instance)
   */
  dynatraceConfigId?: string;

  /**
   * Whether to collect performance test metrics (default: true)
   */
  collectPerformanceTestMetrics?: boolean;

  /**
   * Whether to collect Grafana metrics (default: true)
   */
  collectGrafanaMetrics?: boolean;

  /**
   * Whether to collect Dynatrace metrics (default: true)
   */
  collectDynatraceMetrics?: boolean;
}

/**
 * Collection result for a single source
 */
export interface CollectionResult {
  /**
   * Whether collection succeeded
   */
  success: boolean;

  /**
   * Number of data points collected
   */
  dataPoints: number;

  /**
   * Errors encountered during collection
   */
  errors: string[];

  /**
   * Collection duration in milliseconds
   */
  duration: number;

  /**
   * Maximum timestamp from actually collected data
   * Used to advance collection range based on actual data, not query time
   */
  maxDataTimestamp?: Date;
}

/**
 * Output result from incremental metrics collection
 */
export interface IncrementalMetricsOutput {
  /**
   * Test run ID processed
   */
  testRunId: string;

  /**
   * Time range processed
   */
  timeRange: {
    from: Date;
    to: Date;
  };

  /**
   * Grafana collection result
   */
  grafana: CollectionResult;

  /**
   * Dynatrace collection result
   */
  dynatrace: CollectionResult;

  /**
   * Performance test collection result
   */
  performanceTest: CollectionResult;

  /**
   * Total data points collected across all sources
   */
  totalDataPoints: number;

  /**
   * Total errors across all sources
   */
  totalErrors: number;
}
