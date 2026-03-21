// Types for Grafana client operations

export interface GrafanaQuery {
  refId: string;
  datasource?: {
    uid: string;
    type: string;
  };
  [key: string]: any;
}

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

export interface PanelDocument {
  id?: number;
  test_run_id: string;
  application_dashboard_id: string;
  dashboard_uid: string;
  panel_id: number;
  panel_title: string;
  dashboard_label: string;
  benchmark_ids?: any[] | null;
  panel: any;
  query_variables?: any;
  datasource_type?: string | null;
  requests?: GrafanaRequest[];
  errors?: Array<{
    target_index: number;
    status_code?: number;
    message: string;
    type: string;
    detail?: string;
  }> | null;
  warnings?: any[] | null;
}

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

// Logger interface for dependency injection
export interface Logger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

// Default console logger implementation
export class ConsoleLogger implements Logger {
  constructor(private module?: string) {}

  debug(message: string, ...args: any[]): void {
    const prefix = this.module ? `[${this.module}]` : '';
    console.debug(prefix, message, ...args);
  }

  info(message: string, ...args: any[]): void {
    const prefix = this.module ? `[${this.module}]` : '';
    console.info(prefix, message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    const prefix = this.module ? `[${this.module}]` : '';
    console.warn(prefix, message, ...args);
  }

  error(message: string, ...args: any[]): void {
    const prefix = this.module ? `[${this.module}]` : '';
    console.error(prefix, message, ...args);
  }
}
