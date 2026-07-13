import { TestRun } from '@/types/test-runs';

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
 * Time range options for trends chart
 */
export const TIME_RANGE_OPTIONS = [
  { label: 'Last day', value: 1, type: 'days' },
  { label: 'Last 2 days', value: 2, type: 'days' },
  { label: 'Last 3 days', value: 3, type: 'days' },
  { label: 'Last week', value: 7, type: 'days' },
  { label: 'Last 2 weeks', value: 14, type: 'days' },
  { label: 'Last month', value: 1, type: 'months' },
  { label: 'Last 3 months', value: 3, type: 'months' },
  { label: 'Custom', value: 'custom', type: 'custom' },
] as const;

export type TimeRangeOption = typeof TIME_RANGE_OPTIONS[number];

/**
 * Evaluate type options for metric aggregation
 */
export const EVALUATE_TYPE_OPTIONS = [
  { value: 'avg', label: 'Average', description: 'Calculate the average value across all data points' },
  { value: 'max', label: 'Maximum', description: 'Use the maximum value observed' },
  { value: 'min', label: 'Minimum', description: 'Use the minimum value observed' },
  { value: 'last', label: 'Last Value', description: 'Use the most recent value recorded' },
  { value: 'q50', label: '50th Percentile', description: 'Median value - 50% of values are below this' },
  { value: 'q90', label: '90th Percentile', description: '90% of values are below this threshold' },
  { value: 'q95', label: '95th Percentile', description: '95% of values are below this threshold' },
  { value: 'q99', label: '99th Percentile', description: '99% of values are below this threshold' },
] as const;

export type EvaluateTypeOption = typeof EVALUATE_TYPE_OPTIONS[number];

/**
 * Supported panel types for trends
 */
export const SUPPORTED_PANEL_TYPES = ['graph', 'timeseries', 'stat', 'singlestat', 'flamegraph'] as const;

export type DataSource = 'grafana' | 'dynatrace' | 'performance-metrics';

export interface TrendsCardProps {
  testRun: TestRun | null;
  testRunId: string;
  trendsExpanded: boolean;
  onTrendsExpand: () => void;
  showToast: (message: string) => void;
}

export interface ApplicationDashboard {
  id: string;
  dashboard_label: string;
  dashboard_name: string;
  dashboard_uid: string;
  metrics_source_id?: string;
  source_type?: string;
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

export interface TimeRange {
  from: Date;
  to: Date;
}

export interface MetricStatistic {
  test_run_id: string;
  panel_title: string;
  metric_name: string;
  value: number;
  created_at: string;
  version?: string | null;
  annotations?: string | null;
  is_changepoint?: boolean;
  consolidated_result?: {
    overall?: boolean;
    passed?: boolean;
  } | null;
}

/**
 * Represents a series added to the trends chart
 */
export interface TrendsSeries {
  id: string;
  dashboardId: string;
  dashboardLabel: string;
  panelId: number;
  panelTitle: string;
  metricName: string;
  source: DataSource;
  yAxisFormat?: string;
  metricsSourceId?: string;
  /** True when this series is the run-wide "All aggregated" pseudo-metric. */
  isAggregated?: boolean;
}

/**
 * Filter state for saving/applying presets
 */
export interface TrendsFilterState {
  selectedDashboard: ApplicationDashboard | null;
  selectedMetric: Panel | null;
  evaluateType: string;
  source: DataSource;
}
