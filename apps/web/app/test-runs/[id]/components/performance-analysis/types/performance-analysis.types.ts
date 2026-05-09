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
