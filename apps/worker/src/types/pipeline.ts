export interface PipelineStage {
  name: string;
  handler: string;
  dependencies?: string[];
  parallel?: boolean;
  required: boolean;
}

export interface PipelineConfiguration {
  stages: PipelineStage[];
  errorHandling: 'strict' | 'continue' | 'abort';
  timeoutMs?: number;
}

export interface PipelineResult {
  success: boolean;
  stage?: string;
  duration?: number;
  data?: unknown;
  error?: {
    message: string;
    code?: string;
    details?: unknown;
  };
}

// Base interface for all pipeline services
export interface Pipeline {
  execute(input: unknown): Promise<PipelineResult>;
  validateInput?(input: unknown): boolean;
  cleanup?(): Promise<void>;
}

// Test Run data structure (from actual database schema)
export interface TestRun {
  test_run_id: string;
  system_under_test_id: string;
  workload: string;
  test_environment: string;
  start_time: Date;
  end_time: Date;
  created_at?: Date;
  updated_at?: Date;
  organization_id?: string | null;
}

// Panel Document structure (from actual database schema - ds_panels table)
export interface PanelDocument {
  id?: number; // Auto-generated primary key
  test_run_id: string;
  application_dashboard_id: string;
  dashboard_uid: string;
  panel_id: number;
  panel_title: string;
  dashboard_label: string;
  benchmark_ids?: any[] | null; // JSONB array
  panel: any; // JSONB panel definition from Grafana
  query_variables?: any; // JSONB query variables
  datasource_type?: string | null;
  requests?: GrafanaRequest[]; // JSONB array of requests
  errors?: Array<{
    target_index: number;
    status_code?: number;
    message: string;
    type: string;
    detail?: string;
  }> | null; // JSONB errors
  warnings?: any[] | null; // JSONB warnings
  updated_at?: Date;
  created_at?: Date;
}

// Grafana request structure
export interface GrafanaRequest {
  endpoint: string;
  method: string;
  path_parameters?: Record<string, string>;
  request_body: {
    queries: GrafanaQuery[];
    from_: string;
    to: string;
  };
}

export interface GrafanaQuery {
  refId: string;
  expr?: string;
  datasource?: {
    type: string;
    uid: string;
  };
  [key: string]: unknown;
}

// Metrics data structure
export interface MetricsRecord {
  metric_name: string;
  time: Date;
  timestep?: number | null;
  ramp_up?: boolean;
  value: number;
  unit?: string | null;
}

export interface PanelMetricsDocument {
  test_run_id: string;
  application_dashboard_id: string;
  dashboard_uid: string;
  panel_id: number;
  panel_title: string;
  dashboard_label: string;
  benchmark_ids?: string[] | null;
  errors?: Array<{
    target_index: number;
    status_code?: number;
    message: string;
    type: string;
    detail?: string;
  }> | null;
  data: MetricsRecord[];
  updated_at: Date;
}

// Database row structure (flattened for PostgreSQL)
export interface MetricsRowData {
  test_run_id: string;
  application_dashboard_id: string;
  dashboard_uid: string;
  panel_id: number;
  panel_title: string;
  dashboard_label: string;
  benchmark_ids?: string[] | null;
  errors?: unknown | null;
  metric_name: string;
  time: Date;
  timestep?: number | null;
  ramp_up?: boolean;
  value: number;
  unit?: string | null;
  updated_at: Date;
  created_at?: Date;
}