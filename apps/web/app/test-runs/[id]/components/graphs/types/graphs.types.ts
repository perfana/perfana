import { TestRun } from '@/types/test-runs';
import type { PerfanaEvent } from '@/lib/events';

/**
 * Common Grafana unit formats for Y-axis
 */
export const GRAFANA_UNITS = [
  { value: 'ms', label: 'Milliseconds (ms)' },
  { value: 's', label: 'Seconds (s)' },
  { value: 'µs', label: 'Microseconds (µs)' },
  { value: 'ns', label: 'Nanoseconds (ns)' },
  { value: 'short', label: 'Short (auto-scaled)' },
  { value: 'percent', label: 'Percent (0-100)' },
  { value: 'percentunit', label: 'Percent (0.0-1.0)' },
  { value: 'bytes', label: 'Bytes' },
  { value: 'kbytes', label: 'Kilobytes' },
  { value: 'mbytes', label: 'Megabytes' },
  { value: 'gbytes', label: 'Gigabytes' },
  { value: 'reqps', label: 'Requests per second' },
  { value: 'ops', label: 'Operations per second' },
  { value: 'wps', label: 'Writes per second' },
  { value: 'rps', label: 'Reads per second' },
  { value: 'none', label: 'None' },
] as const;

export type GrafanaUnit = typeof GRAFANA_UNITS[number];

/**
 * Supported panel types for graphs
 */
export const SUPPORTED_PANEL_TYPES = ['graph', 'timeseries', 'stat', 'singlestat'] as const;

export type DataSource = 'grafana' | 'dynatrace' | 'performance-metrics';

export interface GraphsCardProps {
  testRun: TestRun | null;
  testRunId: string;
  graphsExpanded: boolean;
  onGraphsExpand: () => void;
  showToast: (message: string) => void;
  events?: PerfanaEvent[];
}

export interface ApplicationDashboard {
  id: string;
  dashboard_label: string;
  dashboard_name: string;
  dashboard_uid: string;
  metrics_source_id?: string;
  grafanaInstance?: {
    label: string;
  };
}

export interface Panel {
  id: number;
  title: string;
  type: string;
  yAxesFormat?: string;
  applicationDashboardId?: string;
  metricsSourceId?: string;
}

export interface SeriesConfig {
  id: string; // unique ID for React keys
  dashboardId: string;
  dashboardLabel: string;
  panelId: number;
  panelTitle: string;
  metricName: string;
  source: DataSource;
  yAxisFormat?: string;
  metricsSourceId?: string;
}

export interface MetricDataPoint {
  time: string;
  metric_name: string;
  value: number;
  timestep: number;
  ramp_up?: boolean;
}

/**
 * Series color palette for chart visualization
 */
export const SERIES_COLORS = ['#2E86AB', '#FF6B35', '#4CAF50', '#9C27B0', '#FF9800'] as const;

/**
 * Get color for a series based on its index
 */
export function getSeriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}
