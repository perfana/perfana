export interface TransactionStat {
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
 * How long a parallel group itself took, measured per pass as last finish minus first start.
 * Distinct from its members' response times: those describe individual requests.
 */
/**
 * One enclosing controller on the path from the test plan's root down to a request. Only what is
 * stable for a sampler aggregated over a whole run: the engine's current metadata describes where
 * a request sits in the plan, not which loop pass or concurrent execution produced it.
 */
export interface ControllerRef {
  name: string;
  /** Fully-qualified class, e.g. `org.apache.jmeter.control.ParallelController`. */
  class: string;
  /**
   * Which of several identically-named siblings this is, 0-based. Absent on runs recorded by the
   * retired runtime shape, which could not tell them apart.
   */
  occurrence?: number;
}

/**
 * Which metadata shape a request's chain came from. `runtime` runs can have parallel-group
 * timings; `plan` runs never can, so a band with no timings there is finished, not pending.
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

export interface SamplerStat {
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
   * Parallel Controller this request ran under, or null/undefined when it ran sequentially or
   * the run predates the tag. Absent means "not parallel", never "unknown".
   */
  parallel_group?: string | null;
  /** Repeated on every member of a group; absent for runs analysed before the rollup existed. */
  parallel_group_stats?: ParallelGroupStats | null;
  /**
   * The controllers this request ran under, outermost first. Null when the run predates the
   * tag, when the tool does not report it, or when the request ran under more than one chain.
   */
  parent_controllers?: ControllerRef[] | null;
  /**
   * Where this sampler first fired in the run — a proxy for its position in the test plan,
   * used to order the table. Absent when the run carries no controller data.
   */
  first_seen?: number;
  /** Which metadata shape the chain came from. Absent when the run has no controller data. */
  chain_source?: ChainSource;
}

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

export type SortField = 'transaction_name' | 'avg_response_time' | 'p95_response_time' | 'p99_response_time' | 'passed_count' | 'failed_count' | 'error_rate' | 'apdex_score';
export type SortOrder = 'asc' | 'desc';

export interface DrillDownFilters {
  scenario?: string;
  transaction?: string;
  sampler?: string;
}

export interface RollupPendingState {
  status: 'rollup-pending';
  stage: 'transaction-stats-rollup';
  progress?: {
    stageName: string;
    stageIndex: number;
    totalStages: number;
  };
}
