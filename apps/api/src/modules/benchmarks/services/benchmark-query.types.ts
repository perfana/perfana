/**
 * Type definitions for benchmark query operations
 */

/**
 * Benchmark requirement configuration
 */
export interface BenchmarkRequirement {
  operator: string;
  value: number;
}

/**
 * Benchmark configuration structure
 */
export interface BenchmarkConfiguration {
  title?: string;
  id?: string;
  type?: string;
  evaluateType?: string;
  requirement?: BenchmarkRequirement;
  yAxesFormat?: string;
  [key: string]: unknown;
}

/**
 * Status of tag synchronization between benchmarks and application dashboards
 */
export interface BenchmarkTagSyncStatus {
  benchmark_id: string;
  system_name: string;
  dashboard_label: string;
  config_title: string;
  benchmark_tags: string[];
  dashboard_tags: string[];
  tags_match: boolean;
}

/**
 * Benchmark type discriminator
 */
export type BenchmarkType = 'metric' | 'apdex';

/**
 * Benchmark DTO representing the response format
 */
export interface Benchmark {
  id: string;
  system_under_test_id: string;
  test_environment: string;
  workload: string;
  source: string;
  grafana_instance?: string;
  dashboard_label?: string;
  dashboard_id?: number;
  dashboard_uid?: string;
  application_dashboard_id?: string;
  generic_check_id?: string;
  configuration: Record<string, unknown>;
  config_title?: string;
  config_id?: string;
  panel_title?: string;
  metric_unit?: string;
  evaluate_type?: string;
  requirement_operator?: string;
  requirement_value?: number;
  enabled: boolean;
  valid: boolean;
  tags?: string[];
  created_at: string;
  updated_at: string;
  // Apdex SLO fields
  benchmark_type: BenchmarkType;
  transaction_name?: string;
  apdex_threshold_ms?: number;
  min_apdex_score?: number;
  include_failed_requests: boolean;
  exclude_ramp_up_time: boolean;
  // Joined data
  systems_under_test?: {
    id: string;
    name: string;
  };
}

/**
 * Query parameters for filtering benchmarks
 */
export interface BenchmarkQuery {
  systemUnderTestId?: string;
  testEnvironment?: string;
  workload?: string;
  enabled?: string;
  valid?: string;
  benchmarkType?: 'metric' | 'apdex';
}
