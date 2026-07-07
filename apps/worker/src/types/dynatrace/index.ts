/**
 * Dynatrace Pipeline Type Definitions
 */

import { PanelDocument } from '../pipeline.js';

// Re-export for convenience
export { PanelDocument };

// Database model - raw config from dynatrace_queries table
export interface DynatraceQueryConfigFromDb {
  id: string;
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
  dashboardLabel: string;
  panelTitle: string;
  query: string;  // renamed from dqlQuery - contains DQL or Metrics API v2 selector
  matchMetricPattern?: string | null;
  omitGroupByVariableFromMetricName?: string[];
  templateVariables?: Record<string, unknown>;
  applicationDashboardId: string;
  metricsSourceId?: string;
  panelId?: number | null;
  metricUnit?: string | null;
  metricName?: string | null;  // Explicit metric name for storage (e.g., "CPU Usage")
  dynatraceConfigId: string;  // FK to dynatrace_configs
}

// Dynatrace instance configuration from dynatrace_configs table
export interface DynatraceConfig {
  id: string;
  host: string;
  perfanaTestRunIdAttribute?: string;
  perfanaRequestNameAttribute?: string;
  apiToken: string;
  platformApiToken?: string;  // For SaaS/DQL queries
  dynatraceType: 'saas' | 'managed';
  label: string;
  useProxy: boolean;
  organizationId: string;
}

// Execution-ready query config (after time range replacement)
export interface DynatraceQueryConfig {
  tileId: string;
  tileTitle: string;
  query: string;
  visualization: string;
  dashboardLabel: string;
  applicationDashboardId: string;
  metricsSourceId?: string;
  querySettings: Record<string, unknown>;
  matchMetricPattern?: string | null;
  omitGroupByVariableFromMetricName?: string[];
  panelId?: number | null;
  metricName?: string | null;  // Explicit metric name for storage (e.g., "CPU Usage")
  dynatraceConfigId: string;  // FK to load Dynatrace instance config
}

// Query execution result
export interface DynatraceQueryResult {
  tileId: string;
  tileTitle: string;
  visualization: string;
  query: string;
  matchMetricPattern?: string | null;
  omitGroupByVariableFromMetricName?: string[];
  dashboardLabel: string;
  applicationDashboardId: string;
  metricsSourceId?: string;
  panelId?: number | null;
  metricName?: string | null;  // Explicit metric name for storage (e.g., "CPU Usage")
  result: unknown;
  error: string | null;
}

// Metric data point
export interface MetricRecord {
  metricName: string;
  time: Date;
  timestep: number;
  rampUp: boolean;
  value: number;
  unit?: string;
}

// Panel metrics document for database storage
export interface PanelMetricsDocument {
  testRunId: string;
  applicationDashboardId: string;
  metricsSourceId?: string;
  dashboardUid: string;
  panelId: number;
  panelTitle: string;
  dashboardLabel: string;
  data: MetricRecord[];
  errors: unknown[];
  benchmarkIds: string[];
}

