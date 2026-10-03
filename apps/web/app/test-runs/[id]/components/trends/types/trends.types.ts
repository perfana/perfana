import { TestRun } from '@/types/test-runs';

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
  /**
   * The TrendsSeries this row belongs to. Rows are grouped into traces by this, not by
   * metric_name: two panels of one dashboard can both carry a series named
   * "All aggregated", and keyed on the name they collapsed into one zigzag line.
   * Required so a producer that forgets it fails to compile rather than reviving that.
   */
  series_id: string;
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
 * What the cursor readout adds to a run id when the run has it. Both fields are the
 * per-run columns `MetricStatistic` already carries, so they cannot drift apart.
 */
export type RunMeta = Pick<MetricStatistic, 'version' | 'annotations'>;

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
  /** The panel's own unit, so the series table can show that `yAxisFormat` overrides it. */
  panelYAxisFormat?: string;
  /** Which colour slot this series holds; see `nextFreeSlot`. */
  colorSlot?: number;
  /** Hidden from the chart but kept in the table (and in the preset). */
  hidden?: boolean;
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
