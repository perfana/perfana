import { GrafanaInstance } from '@/lib/grafana-instances';
import { DynatraceConfig } from '@/lib/dynatrace';
import { PyroscopeInstance } from '@/lib/pyroscope';
import { TracingInstance } from '@/lib/distributed-tracing';
import { SplunkConfig } from '@/lib/splunk';
import { ConfluenceConfig } from '@/lib/confluence';

/**
 * Integration type identifiers
 */
export type IntegrationType = 'grafana' | 'dynatrace' | 'pyroscope' | 'tracing' | 'splunk' | 'confluence';

/**
 * Connection status for integration cards
 */
export type ConnectionStatus = 'connected' | 'disconnected';

/**
 * Represents a flattened integration card that can be either:
 * - An integration instance with data (connected)
 * - A placeholder to add a new instance (disconnected)
 */
export interface IntegrationCard {
  /** Unique identifier for the card */
  id: string;
  /** Integration type identifier */
  integrationType: IntegrationType;
  /** Display name for the card */
  name: string;
  /** Short TLDR description */
  tldr: string;
  /** Category label */
  category: string;
  /** Connection status */
  status: ConnectionStatus;
  /** Icon component */
  icon: React.ReactNode;
  /** Brand color */
  color: string;
  /** Instance data (if connected) */
  instanceData?: GrafanaInstance | DynatraceConfig | PyroscopeInstance | TracingInstance | SplunkConfig | ConfluenceConfig;
}

/**
 * Snackbar notification state
 */
export interface SnackbarState {
  open: boolean;
  message: string;
  severity: 'success' | 'error';
}

/**
 * Integration type definition for Add Integration dialog
 */
export interface IntegrationTypeDefinition {
  id: IntegrationType;
  name: string;
  description: string;
  category: string;
  icon: React.ReactNode;
  color: string;
  features: string[];
}

/**
 * Brand colors for each integration type
 */
export const INTEGRATION_COLORS = {
  grafana: '#F46800',
  dynatrace: '#1496FF',
  pyroscope: '#FF6B35',
  tracing: '#9C27B0',
  splunk: '#65A637',
  confluence: '#1868DB',
} as const;

/**
 * Category labels for each integration type
 */
export const INTEGRATION_CATEGORIES = {
  grafana: 'Visualization',
  dynatrace: 'APM',
  pyroscope: 'Profiling',
  tracing: 'Distributed Tracing',
  splunk: 'Logs',
  confluence: 'Reporting',
} as const;
