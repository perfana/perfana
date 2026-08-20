// Re-export types from their primary locations for convenience
export type { SystemUnderTest, PyroscopeInstance } from '../types/test-runs';

/**
 * A Grafana templating variable attached to an application dashboard. The API
 * enriches the stored `{ name, values }` pair with metadata read back off the
 * dashboard JSON (`enrichVariablesWithTemplateMetadata`), so everything past
 * `values` is present only when the source dashboard still declares it.
 */
export interface DashboardVariable {
  name: string;
  values: string[];
  label?: string;
  type?: string;
  query?: string | { query?: string; [key: string]: unknown };
  includeAll?: boolean;
  multi?: boolean;
  allValue?: string;
}

/**
 * One selectable value from POST /grafana/dashboards/variable-values, which
 * returns Array<{ label, value }> — both always present.
 */
export interface DashboardVariableOption {
  label: string;
  value: string;
}

// Application Dashboard types
export interface ApplicationDashboard {
  id: string;
  system_under_test_id: string;
  test_environment: string;
  grafana_instance_id: string;
  grafana_dashboard_id: string;
  dashboard_name: string;
  dashboard_uid: string;
  dashboard_label: string;
  variables: DashboardVariable[];
  tags?: string[];
  metrics_source_id?: string;
  /**
   * Background-deletion state. null = not being deleted; 'queued' | 'deleting' while
   * the job is in flight; 'failed' once its retries are exhausted. Mirrors
   * `test_runs.deletion_status` — the row stays in the list wearing a badge instead
   * of vanishing and quietly reappearing on the next reload.
   */
  deletion_status?: 'queued' | 'deleting' | 'failed' | null;
  created_at: string;
  updated_at: string;
}

/**
 * A row from `check_results` as the API returns it.
 *
 * `GET /test-runs/:id/check-results` does `SELECT * FROM check_results`, so the
 * payload is the raw snake_case table shape rather than a mapped DTO. Fields are
 * optional here exactly where the column is nullable. `requirement` and `targets`
 * arrive parsed (the API resolves the JSONB), and `requirement.value` is
 * normalised to a number on the way out.
 */
export interface CheckResult {
  id: string;
  system_under_test_id: string;
  test_environment: string;
  workload: string;
  test_run_id: string;
  source: 'grafana' | 'dynatrace' | 'timescaledb' | 'influxdb' | 'prometheus' | 'custom';
  grafana_instance?: string;
  dashboard_label?: string;
  dashboard_uid?: string;
  panel_title?: string;
  panel_id?: number;
  panel_type?: string;
  panel_description?: string;
  panel_y_axes_format?: string;
  dynatrace_entity_id?: string;
  dynatrace_metric_key?: string;
  dynatrace_dimension_filters?: Record<string, unknown>;
  metric_name?: string;
  metric_unit?: string;
  generic_check_id?: string;
  benchmark_id: string;
  status: string;
  message?: string;
  average_all: boolean;
  evaluate_type: string;
  exclude_ramp_up_time: boolean;
  ramp_up?: number;
  match_pattern?: string;
  requirement?: CheckResultRequirement;
  benchmark?: Record<string, unknown>;
  panel_average?: number;
  meets_requirement?: boolean;
  is_artificial?: boolean;
  targets?: CheckResultTarget[];
  validate_with_default_if_no_data?: boolean;
  validate_with_default_if_no_data_value?: number;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
  created_by?: string;
  updated_by?: string;
  tags?: string[];
  application_dashboard_id?: string;
  organization_id?: string;
  team_id?: string;
  /** Joined/derived by some callers; not a check_results column. */
  config_title?: string;
}

/**
 * The `requirement` JSONB on a check result. The column defaults to `{}`, but
 * every evaluated result carries both fields, so they are required once
 * `requirement` itself is present. `value` is normalised to a number by the API
 * (node-postgres returns NUMERIC as a string).
 */
export interface CheckResultRequirement {
  /** Metric SLOs: the comparison. Absent on apdex results. */
  operator?: string;
  value?: number;
  /** Apdex SLOs: the minimum acceptable score and the satisfied threshold. */
  min_score?: number;
  threshold_ms?: number;
  type?: string;
  aggregate_metric?: string;
  aggregate_stat?: string;
}

/**
 * One entry of the `targets` JSONB array on a check result. The array holds
 * metric targets (target/value/status) or apdex targets (per-transaction
 * counts and scores) depending on the SLO kind, so this is the union of both
 * and everything is optional. The per-table views alias this type.
 */
export interface CheckResultTarget {
  target?: string;
  value?: number | string | null;
  meets_requirement?: boolean;
  status?: string;
  message?: string;
  // Apdex targets
  transaction_name?: string;
  scenario_name?: string;
  threshold_ms?: number;
  avg_response_time_ms?: number;
  apdex_score?: number;
  satisfied_count?: number;
  tolerating_count?: number;
  frustrated_count?: number;
  total_count?: number;
}

/**
 * The `configuration` JSONB on a benchmark. It mirrors the panel the SLO points
 * at plus the evaluation settings, in camelCase (unlike the columns around it).
 * The index signature stays because the blob is written by several producers.
 */
export interface BenchmarkConfiguration {
  id?: number | string;
  panelId?: number | string;
  title?: string;
  type?: string;
  dashboardUid?: string;
  yAxesFormat?: string;
  metricUnit?: string;
  evaluateType?: string;
  requirement?: { operator?: string; value?: number | string };
  excludeRampUpTime?: boolean;
  averageAll?: boolean;
  matchPattern?: string;
  validateWithDefaultIfNoData?: boolean;
  validateWithDefaultIfNoDataValue?: number | string | null;
  [key: string]: unknown;
}

/**
 * A row from `benchmarks` as the API returns it (snake_case, like CheckResult).
 * `benchmark_type` selects which of the metric / apdex field groups applies.
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
  metrics_source_id?: string;
  generic_check_id?: string;
  configuration: BenchmarkConfiguration;
  config_title?: string;
  config_id?: string;
  config_type?: string;
  evaluate_type?: string;
  requirement_operator?: string;
  requirement_value?: number;
  enabled: boolean;
  valid: boolean;
  description?: string;
  tags: string[];
  average_all?: boolean;
  match_pattern?: string;
  validate_with_default_if_no_data?: boolean;
  validate_with_default_if_no_data_value?: number;
  exclude_ramp_up_time: boolean;
  panel_title?: string;
  panel_id?: number;
  metric_name?: string;
  metric_unit?: string;
  baseline_test_run_id?: string;
  alert_on_breach?: boolean;
  alert_channels?: string[];
  /** NOT NULL in the DB (defaults to 'metric'), but optional here because the
   *  UI builds partial benchmarks before saving. */
  benchmark_type?: 'metric' | 'apdex' | 'aggregated';
  aggregate_metric?: string;
  aggregate_stat?: string;
  transaction_name?: string;
  apdex_threshold_ms?: number;
  min_apdex_score?: number;
  include_failed_requests?: boolean;
  metadata?: Record<string, unknown>;
  created_by?: string;
  updated_by?: string;
  created_at: string;
  updated_at: string;
}

/**
 * A panel as the SLO forms consume it. Grafana panel JSON carries far more than
 * this, but these are the fields the pickers read; the performance-metrics path
 * synthesises the same three from `ds_metric_statistics` rows.
 */
export interface GrafanaPanel {
  id: number;
  title: string;
  type: string;
  description?: string;
  /** Unit format. The API maps the stored `y_axes_format` onto this field. */
  yAxesFormat?: string;
  fieldConfig?: { defaults?: { unit?: string; [key: string]: unknown }; [key: string]: unknown };
}

// Metrics Source types
export interface MetricsSource {
  id: string;
  system_under_test_id: string;
  test_environment: string;
  source_type: 'grafana' | 'dynatrace' | 'prometheus' | 'influxdb' | 'performance_test';
  source_config_id?: string;
  external_ref?: string;
  display_name: string;
  display_label?: string;
  workload?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}
