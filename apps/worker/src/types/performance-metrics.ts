/**
 * TypeScript Interfaces for Performance Test Metrics Pipeline
 *
 * Defines types for pipeline input/output, aggregated metrics,
 * Apdex threshold lookups, and ds_metrics record creation.
 */

/**
 * Input configuration for Performance Test Metrics Pipeline
 */
export interface PerformanceTestMetricsInput {
  /**
   * Test run ID to process
   */
  testRunId: string;

  /**
   * Optional start time for incremental collection (filters data >= fromTime)
   * If not provided, uses test run start time
   */
  fromTime?: Date;

  /**
   * Optional end time for incremental collection (filters data <= toTime)
   * If not provided, uses test run end time or current time
   */
  toTime?: Date;
}

/**
 * Output result from Performance Test Metrics Pipeline
 */
export interface PerformanceTestMetricsOutput {
  /**
   * Number of ds_metrics records created
   */
  metricsCreated: number;

  /**
   * Number of ds_compare_config records created
   */
  compareConfigsCreated: number;

  /**
   * Breakdown of metrics by category
   */
  breakdown: {
    responseTimeMetrics: number;
    transactionMetrics: number;
    errorMetrics: number;
    virtualUserMetrics: number;
    apdexScores: number;
  };
}

/**
 * Apdex threshold lookup result
 */
export interface ApdexThresholdLookup {
  /**
   * Workload-level default threshold (applies to all transactions)
   */
  workloadThreshold: number | null;

  /**
   * Benchmark-configured threshold from the apdex benchmark
   * Used as fallback when workloadThreshold is not set
   */
  benchmarkThreshold: number | null;

  /**
   * Transaction-specific thresholds (overrides workload threshold)
   * Map of transaction_name -> threshold_ms
   */
  transactionThresholds: Map<string, number>;
}

/**
 * ds_metrics record to be inserted
 */
export interface DsMetricsRecord {
  test_run_id: string;
  application_dashboard_id: string;
  metrics_source_id?: string | null;
  dashboard_uid: string;
  panel_id: number;
  time: Date;
  metric_name: string;
  panel_title: string | null;
  dashboard_label: string | null;
  benchmark_ids: string[] | null;
  errors: Record<string, unknown> | null;
  timestep: number | null;
  ramp_up: boolean;
  value: number;
  unit: string | null;
}

/**
 * ds_compare_config record to be inserted/updated
 */
export interface DsCompareConfigRecord {
  system_under_test_id: string;
  test_environment: string;
  workload: string;
  application_dashboard_id: string;
  panel_id: number;
  metric_name: string | null;
  config_data: {
    metricClassification: {
      classification: string;
      higherIsBetter: boolean | null;
    };
    thresholds: {
      aggregation: string;
      percentageThreshold: number;
      iqrThreshold: number;
      absoluteThreshold: number | null;
    };
    defaultValueIfControlGroupMissing: number;
  };
}

/**
 * Test run metadata needed for processing
 */
export interface TestRunMetadata {
  test_run_id: string;
  system_under_test_id: string;
  test_environment: string;
  workload: string;
  start_time: Date;
  ramp_up_time: number; // in seconds
  end_time: Date | null;

  /** Organization ID for RBAC ownership tracking (nullable for backward compat) */
  organization_id?: string | null;

  /** Team ID for RBAC ownership tracking (nullable) */
  team_id?: string | null;

  /**
   * Optional filter start time for incremental collection.
   * If set, the WHERE clause will filter data >= filter_from_time.
   * Bucket alignment still uses start_time for consistency.
   */
  filter_from_time?: Date;

  /**
   * Optional filter end time for incremental collection.
   * If set, the WHERE clause will filter data <= filter_to_time.
   */
  filter_to_time?: Date;
}
