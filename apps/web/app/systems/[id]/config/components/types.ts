import { SystemUnderTest, ApplicationDashboard } from '@/lib/types';

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
  configuration: any;
  config_title?: string;
  config_id?: string;
  evaluate_type?: string;
  requirement_operator?: string;
  requirement_value?: number;
  enabled: boolean;
  valid: boolean;
  description?: string;
  tags: string[];
  panel_title?: string;
  metric_unit?: string;
  exclude_ramp_up_time: boolean;
  metric_name?: string;
  created_at: string;
  updated_at: string;
  // Apdex SLO fields
  benchmark_type?: 'metric' | 'apdex';
  transaction_name?: string;
  apdex_threshold_ms?: number;
  min_apdex_score?: number;
  include_failed_requests?: boolean;
}

export interface System {
  id: string;
  name: string;
  environments: Array<{
    environment: string;
    workloads: string[];
  }>;
}

export interface GrafanaDashboard {
  id: string;
  grafana_instance_id: string;
  grafana_id: number;
  uid: string;
  name: string;
  uri: string;
  datasource_type: string;
  tags: string[];
  panels?: any[];
  templating_variables?: Array<{
    name: string;
    type: string;
    query?: string | { query: string };
  }>;
}

export interface VariableValue {
  name: string;
  values: string[];
}