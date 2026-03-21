export interface TrackedRegressionEntity {
  id: string;
  test_run_id: string;
  control_group_id: string;
  tracked_test_run_id: string;
  tracked_difference_id?: string;
  application_dashboard_id: string;
  panel_id: string;
  metric_name: string;
  dashboard_uid?: string;
  dashboard_label?: string;
  panel_title?: string;
  unit?: string;
  benchmark_ids?: string[];
  test_run_start: Date;
  updated_at: Date;

  // Statistical data (existing columns in JSONB format)
  mean?: number;
  median?: number;
  min_value?: number;
  max_value?: number;
  std_dev?: number;
  q10?: number;
  q25?: number;
  q75?: number;
  q90?: number;
  q95?: number;
  q99?: number;
  iqr?: number;
  idr?: number;
  count?: number;
  n_missing?: number;
  n_non_zero?: number;
  pct_missing?: number;
  is_constant?: boolean;
  all_missing?: boolean;
  last_value?: number;
  exists_flags?: Record<string, boolean>;
  uses_default_value?: boolean;
  default_value?: number;
  compare_config?: Record<string, unknown>;
  metric_classification?: string;
  statistic?: string;
  conditions?: Record<string, unknown>;
  thresholds?: Record<string, number>;
  checks?: Record<string, unknown>;
  conclusion?: string;
  tracked_conclusion?: string;
}

export interface TrackedRegressionWithMetadata extends TrackedRegressionEntity {
  // Computed fields for frontend
  firstDetected: Date;
  testRunsAffected: number;
  currentValue?: number;
  baselineValue?: number;
  percentageChange?: number;
  status: 'unresolved' | 'accepted' | 'denied';
  queuePosition?: number;
  trackedTestRuns: string[];
  resolutionComment?: string;
  resolvedBy?: string;
  resolvedAt?: Date;
  createdAt?: Date;
}