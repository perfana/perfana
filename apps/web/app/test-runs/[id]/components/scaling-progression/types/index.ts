export interface LinkedBenchmark {
  id: string;
  benchmark_type: 'metric' | 'apdex';
  label: string;
  requirement_operator?: string;
  requirement_value?: number;
  metric_unit?: string;
  transaction_name?: string;
  min_apdex_score?: number;
  apdex_threshold_ms?: number;
  enabled: boolean;
}

export interface ScalingSession {
  id: string;
  name: string;
  description?: string;
  baseline_test_run_id?: string;
  target_load?: string;
  status: string;
  linked_benchmarks: LinkedBenchmark[];
}

export interface SloResult {
  benchmark_id: string;
  benchmark_type: 'metric' | 'apdex';
  label: string;
  status: string;
  meets_requirement: boolean | null;
  actual_value: number | null;
  requirement_operator?: string;
  requirement_value?: number;
  metric_unit?: string;
  transaction_name?: string;
  min_apdex_score?: number;
  apdex_threshold_ms?: number;
}

export interface ProgressionRun {
  test_run_id: string;
  start_time: string;
  end_time?: string;
  completed: boolean;
  meets_requirement: boolean | null;
  load_config: Record<string, string>;
  slo_results: SloResult[];
}

export interface ProgressionData {
  session: ScalingSession;
  runs: ProgressionRun[];
}
