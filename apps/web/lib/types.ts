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
  created_at: string;
  updated_at: string;
}
