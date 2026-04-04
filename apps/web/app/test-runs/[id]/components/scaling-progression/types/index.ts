export interface ScalingSession {
  id: string;
  name: string;
  description?: string;
  baseline_test_run_id?: string;
  target_load?: string;
  status: string;
}

export interface ProgressionRunMetric {
  panel: string;
  metric: string;
  median: number | null;
  p95: number | null;
  mean: number | null;
}

export interface ProgressionRun {
  test_run_id: string;
  start_time: string;
  end_time?: string;
  completed: boolean;
  adapt_conclusion: string | null;
  meets_requirement: boolean | null;
  adapt_ok: boolean | null;
  load_config: Record<string, string>;
  metrics: ProgressionRunMetric[];
}

export interface ProgressionData {
  session: ScalingSession;
  runs: ProgressionRun[];
}
