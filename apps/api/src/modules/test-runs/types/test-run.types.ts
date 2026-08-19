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
  analysis_start_offset?: number;
  analysis_end_offset?: number;
  completed: boolean;
  abort?: boolean;
  abort_message?: string;
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
/**
 * How long a parallel group itself took, measured per pass as last finish minus first start.
 * Distinct from its members' response times: those describe individual requests, this describes
 * the concurrent pass they belong to.
 */
/**
 * One enclosing controller on the path from the test plan's root down to a request.
 *
 * Deliberately only what is stable for a sampler aggregated over a whole run. The retired
 * runtime shape also carried `iteration` and `execution`, which changed per request; the current
 * plan-path shape carries neither, and no longer describes what the plan was doing at the time.
 */
export interface ControllerRef {
  name: string;
  /** Fully-qualified class, e.g. `org.apache.jmeter.control.ParallelController`. */
  class: string;
  /**
   * Which of several identically-named siblings this is, 0-based. Absent on chains from the
   * retired runtime shape, which could not tell them apart.
   */
  occurrence?: number;
}

/**
 * Which metadata shape a request's chain was read from.
 *
 * `runtime` chains come from the retired per-request tagging and can carry parallel-group
 * timings. `plan` chains are a fixed address in the test plan: they never can, so an absent
 * timing is permanent rather than pending.
 */
export type ChainSource = 'plan' | 'runtime';

export interface ParallelGroupStats {
  parallel_group: string;
  /** Number of times the group ran — the sample size behind the percentiles. */
  executions: number;
  passed_count: number;
  failed_count: number;
  avg_elapsed: number;
  min_elapsed: number;
  max_elapsed: number;
  p95_elapsed: number;
  p99_elapsed: number;
}

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
  /**
   * Statistics for the parallel group this request belongs to, repeated on each of the group's
   * members so the client can read them off whichever member it renders first. Null when the
   * request ran sequentially, or when the run predates the rollup that computes them.
   */
  parallel_group_stats?: ParallelGroupStats | null;
  /**
   * Name of the Parallel Controller this request ran under, or null when it ran sequentially.
   * Also null for runs recorded before the load test tool reported it, so consumers must treat
   * an absent value as "not parallel" rather than "unknown". Derived from `parent_controllers`.
   */
  parallel_group?: string | null;
  /**
   * The controllers this request ran under, outermost first, ending at its nearest parent.
   * Null when the run predates the tag, when the tool does not report it, or when the sampler
   * ran under more than one chain — in which case no single chain describes it.
   */
  parent_controllers?: ControllerRef[] | null;
  /**
   * Where this sampler first fired within the scanned slice of the run. A proxy for its
   * position in the test plan — within one pass a thread walks the plan top to bottom —
   * used to order the request table. Absent when the run carries no controller data.
   */
  first_seen?: number;
  /**
   * Which metadata shape `parent_controllers` above was built from. Absent when the run carries
   * no controller data at all.
   */
  chain_source?: ChainSource;
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
