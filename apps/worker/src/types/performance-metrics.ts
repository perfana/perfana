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
 * Apdex threshold configuration for a transaction or workload
 */
export interface ApdexThresholdConfig {
  /**
   * Transaction name (null for workload-level threshold)
   */
  transactionName: string | null;

  /**
   * Apdex threshold in milliseconds
   */
  thresholdMs: number;
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
 * Aggregated metrics for a specific transaction or overall
 */
export interface AggregatedMetrics {
  /**
   * Transaction or sampler name (null for overall metrics)
   */
  name: string | null;

  /**
   * Response time statistics (in milliseconds)
   */
  responseTime?: {
    avg: number | null;
    p50: number | null;
    p95: number | null;
    p99: number | null;
    min: number | null;
    max: number | null;
  };

  /**
   * Response latency average (in milliseconds)
   */
  responseLatency?: {
    avg: number | null;
  };

  /**
   * Response connect time average (in milliseconds)
   */
  responseConnectTime?: {
    avg: number | null;
  };

  /**
   * Success rate (0-100%)
   */
  successRate?: number | null;

  /**
   * Throughput (requests per second)
   */
  throughput?: number | null;

  /**
   * Error count
   */
  errorCount?: number | null;

  /**
   * Error rate (errors per second)
   */
  errorRate?: number | null;

  /**
   * Virtual user statistics
   */
  virtualUsers?: {
    avg: number | null;
    max: number | null;
  };

  /**
   * Apdex score (0.0-1.0)
   */
  apdexScore?: number | null;
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
  errors: Record<string, any> | null;
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
 * Request raw data row (from requests_raw table)
 */
export interface RequestsRawRow {
  time: Date;
  test_run_id: string;
  system_under_test: string | null;
  test_environment: string | null;
  location: string | null;
  scenario_name: string | null;
  transaction_name: string | null;
  sampler_name: string;
  success: boolean;
  request_size: number | null;
  response_size: number | null;
  response_code: string | null;
  response_connect_time: number | null;
  response_latency: number | null;
  response_time: number | null;
  url_hash: string | null;
}

/**
 * Transaction data row (from transactions table)
 */
export interface TransactionRow {
  time: Date;
  test_run_id: string;
  system_under_test: string | null;
  test_environment: string | null;
  location: string | null;
  scenario_name: string | null;
  transaction_name: string;
  success: boolean;
  request_size: number | null;
  response_size: number | null;
  response_time: number | null;
}

/**
 * Requests error data row (from requests_error table)
 */
export interface RequestsErrorRow {
  time: Date;
  test_run_id: string;
  system_under_test: string | null;
  test_environment: string | null;
  location: string | null;
  node_name: string;
  scenario_name?: string | null;
  transaction_name: string;
  sampler_name: string;
  response_code: string | null;
  response_time: number | null;
  connection_time: number | null;
  url: string | null;
  assertions: string | null;
  response_message: string | null;
  request_headers: string | null;
  response_headers: string | null;
  response_data: string | null;
  random_id: number | null;
  url_hash: string | null;
}

/**
 * Virtual users data row (from virtual_users table)
 */
export interface VirtualUsersRow {
  time: Date;
  test_run_id: string;
  system_under_test: string | null;
  test_environment: string | null;
  location: string | null;
  node_name: string;
  scenario_name?: string | null;
  active_threads: number | null;
  started_threads: number | null;
  finished_threads: number | null;
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
