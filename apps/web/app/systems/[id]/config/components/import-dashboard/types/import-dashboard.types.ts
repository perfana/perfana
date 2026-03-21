/**
 * Types for ImportDashboardDialog component
 */

export interface DashboardTile {
  id: string;
  title: string;
  query: string;
  visualization: string;
  variables: string[];
  selected?: boolean;
}

export interface ImportDashboardDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (
    tiles: DashboardTile[],
    variableValues: Record<string, string>,
    dashboardName: string,
    metricUnit: string,
    dynatraceConfigId: string
  ) => void;
  systemName: string;
  environment: string;
  loading?: boolean;
}

export interface ParseResult {
  tiles: DashboardTile[];
  variables: string[];
  error?: string;
}

/**
 * Supported visualization types for Dynatrace DATA_EXPLORER tiles
 */
export const SUPPORTED_VISUALIZATION_TYPES = [
  'GRAPH_CHART',
  'STACKED_AREA',
  'STACKED_COLUMN',
  'LINE',
] as const;

export type VisualizationType = typeof SUPPORTED_VISUALIZATION_TYPES[number];

/**
 * Metric unit options for the import dialog
 */
export interface MetricUnitOption {
  value: string;
  label: string;
}

export const METRIC_UNIT_OPTIONS: MetricUnitOption[] = [
  { value: 'ms', label: 'milliseconds (ms)' },
  { value: 's', label: 'seconds (s)' },
  { value: 'ns', label: 'nanoseconds (ns)' },
  { value: 'µs', label: 'microseconds (µs)' },
  { value: 'm', label: 'minutes (m)' },
  { value: 'h', label: 'hours (h)' },
  { value: 'percent', label: 'Percent (%)' },
  { value: 'percentunit', label: 'Percent (0.0-1.0)' },
  { value: 'bytes', label: 'bytes (B)' },
  { value: 'kbytes', label: 'kibibytes (KiB)' },
  { value: 'mbytes', label: 'mebibytes (MiB)' },
  { value: 'gbytes', label: 'gibibytes (GiB)' },
  { value: 'Bps', label: 'bytes/sec (B/s)' },
  { value: 'binbps', label: 'bits/sec (b/s)' },
  { value: 'cps', label: 'counts/sec (c/s)' },
  { value: 'ops', label: 'ops/sec (ops/s)' },
  { value: 'reqps', label: 'requests/sec (req/s)' },
  { value: 'rps', label: 'reads/sec (rd/s)' },
  { value: 'wps', label: 'writes/sec (wr/s)' },
  { value: 'iops', label: 'I/O ops/sec (io/s)' },
  { value: 'none', label: 'None' },
  { value: 'short', label: 'Short' },
];

/**
 * Variable helper text mappings
 */
export const VARIABLE_HELPER_TEXT: Record<string, string> = {
  Cluster: 'e.g., production-cluster',
  Node: 'e.g., worker-node-01',
  NodeID: 'e.g., KUBERNETES_NODE-1234567890',
};

export const getVariableHelperText = (variable: string): string => {
  return VARIABLE_HELPER_TEXT[variable] || `Value for ${variable} variable`;
};
