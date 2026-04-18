// Re-export types from their primary locations for convenience
export type { SystemUnderTest, PyroscopeInstance } from '../types/test-runs';

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
  variables: Array<{
    name: string;
    values: string[];
  }>;
  tags?: string[];
  metrics_source_id?: string;
  created_at: string;
  updated_at: string;
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
