import {
  TestRunStatus,
  ConsolidatedResult,
  AdaptConfig,
  TestRunVariables,
  DeepLinksCollection
} from '../../../types';

/**
 * Test Run API response interface
 * Maps from TypeORM entity to API-friendly format with snake_case
 */
export interface TestRun {
  id: string;
  test_run_id: string;
  system_under_test_id: string;
  test_environment: string;
  workload: string;
  start_time?: string;
  end_time?: string;
  duration?: number;
  planned_duration?: number;
  ramp_up?: number;
  completed: boolean;
  abort?: boolean;
  is_stale?: boolean;
  stale_detected_at?: string;
  completion_percentage?: number;
  status?: TestRunStatus;
  consolidated_result?: ConsolidatedResult;
  annotations?: string[];
  tags?: string[];
  application_release?: string;
  ci_build_results_url?: string;
  expires?: string;
  expired?: boolean;
  valid?: boolean;
  reasons_not_valid?: string[];
  data_warnings?: string[];
  adapt_config?: AdaptConfig;
  variables?: TestRunVariables;
  deep_links?: DeepLinksCollection;
  deletion_status?: string;
  // Ownership tracking (multi-tenant RBAC)
  organization_id?: string;
  team_id?: string;
  created_by?: string;
  updated_by?: string;
  created_at: string;
  updated_at: string;
  systems_under_test?: {
    name: string;
    pyroscope_instance_id?: string;
    pyroscope_configurations?: Array<{ application: string; profiler: string }>;
    pyroscopeInstance?: {
      id: string;
      label: string;
      pyroscope_url: string;
      backend_url?: string;
      pyroscope_stand_alone: boolean;
    };
  };
  is_changepoint?: boolean;
  is_control_group?: boolean;
  system_name?: string;
}

/**
 * Time period options for filtering queries
 */
export type TimePeriod = '24h' | '7d' | '30d' | 'all' | 'custom';

/**
 * Date bounds calculated from time period
 */
export interface DateBounds {
  dateThreshold: Date | null;
  dateUpperBound: Date | null;
}

/**
 * Dashboard statistics response
 */
export interface DashboardStatistics {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  activeTests: number;
  sloComplianceRate: number;
  mostTestedSystem: { name: string; count: number } | null;
  timePeriod: string;
}

/**
 * Recent failure item
 */
export interface RecentFailure {
  id: string;
  test_run_id: string;
  system_name: string;
  test_environment: string;
  workload: string;
  start_time: string | null;
  end_time: string | null;
  consolidated_result: ConsolidatedResult | null;
  created_at: string;
}

/**
 * System summary for dashboard
 */
export interface SystemSummary {
  id: string;
  name: string;
  testRunCount: number;
  lastTestRun: string | null;
  passFailRatio: { passed: number; failed: number };
}

/**
 * Transaction statistics with Apdex score
 */
export interface TransactionStats {
  transaction_name: string;
  scenario_name?: string;
  avg_response_time: number;
  p95_response_time: number;
  p99_response_time: number;
  passed_count: number;
  failed_count: number;
  total_count: number;
  ranking: number;
  apdex_score: number;
  active_threshold: number;
}

/**
 * Sampler/request statistics
 */
export interface SamplerStats {
  sampler_name: string;
  scenario_name?: string;
  avg_response_time: number;
  min_response_time: number;
  max_response_time: number;
  p95_response_time: number;
  p99_response_time: number;
  passed_count: number;
  failed_count: number;
  total_count: number;
  avg_latency: number;
  avg_connect_time: number;
  total_request_size: number;
  total_response_size: number;
  apdex_score: number;
  active_threshold: number;
  url_hash: string | null;
  url_pattern: string | null;
}

/**
 * Grouped error statistics
 */
export interface ErrorStats {
  error_type: string;
  response_code: string;
  response_message: string;
  sampler_name: string;
  url: string;
  url_hash: string | null;
  url_pattern: string | null;
  count: number;
  first_occurrence: string;
  last_occurrence: string;
  sample_response_data: string;
  total_requests: number;
  apdex_score: number;
}

/**
 * Time series data point
 */
export interface TimeSeriesDataPoint {
  time_bucket: string;
  avg_response_time: number;
  median_response_time: number;
  min_response_time: number;
  max_response_time: number;
  p90_response_time: number;
  p95_response_time: number;
  p99_response_time: number;
  total_count: number;
  passed_count: number;
  failed_count: number;
}

/**
 * Transaction time series response
 */
export interface TransactionTimeSeriesData {
  transaction_data: TimeSeriesDataPoint[];
  sampler_data: Record<string, TimeSeriesDataPoint[]>;
}

/**
 * Virtual user statistics
 */
export interface VirtualUserStats {
  overall: {
    peak_active_threads: number;
    avg_active_threads: number;
    peak_started_threads: number;
    avg_started_threads: number;
    peak_finished_threads: number;
    avg_finished_threads: number;
    total_data_points: number;
  };
  by_scenario: Array<{
    scenario_name: string;
    peak_active_threads: number;
    avg_active_threads: number;
    peak_started_threads: number;
    avg_started_threads: number;
    peak_finished_threads: number;
    avg_finished_threads: number;
    total_data_points: number;
  }>;
}

/**
 * Throughput statistics
 */
export interface ThroughputStats {
  overall: {
    peak_transactions_per_second: number;
    peak_requests_per_second: number;
  };
  by_scenario: Array<{
    scenario_name: string;
    peak_transactions_per_second: number;
    peak_requests_per_second: number;
  }>;
}

/**
 * Related test run summary
 */
export interface RelatedTestRun {
  test_run_id: string;
  created_at: string;
  start_time?: string;
  end_time?: string;
  application_release?: string;
  annotations?: string[];
  completed: boolean;
}

/**
 * Systems summary with environments and workloads
 */
export interface SystemsSummary {
  id: string;
  name: string;
  environments: Array<{
    environment: string;
    workloads: string[];
  }>;
  created_at: string;
}

/**
 * System Under Test for mutation operations
 */
export interface SystemUnderTest {
  id: string;
  name: string;
  description?: string;
  team_id?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Test Environment for mutation operations
 */
export interface TestEnvironment {
  id: string;
  name: string;
  system_under_test_id: string;
  created_at: string;
}

/**
 * Workload configuration for mutation operations
 */
export interface Workload {
  id: string;
  name: string;
  system_under_test_test_environment_id: string;
  config?: {
    baseline_test_run_id?: string;
    auto_compare_test_runs?: boolean;
    auto_create_snapshots?: boolean;
    difference_score_threshold?: number;
    adaptMode?: string;
    baselineTestRunId?: string;
  };
  created_at: string;
}
