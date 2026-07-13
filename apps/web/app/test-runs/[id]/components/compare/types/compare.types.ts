import { TestRun } from '@/types/test-runs';

export interface CompareCardProps {
  testRun: TestRun | null;
  testRunId: string;
  compareExpanded: boolean;
  onCompareExpand: () => void;
  showToast: (message: string) => void;
}

export interface RelatedTestRun {
  test_run_id: string;
  created_at: string;
  completed: boolean;
  application_release?: string;
  start_time?: string;
  annotations?: string[];
}

export interface ComparisonStatus {
  hasBaseline: boolean;
  totalComparisons: number;
  differences: number;
  status: 'success' | 'warning' | 'info';
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

export interface MetricStatistic {
  test_run_id: string;
  panel_title: string;
  metric_name: string;
  created_at: string;
  version: string | null;
  annotations: string | null;
  statistics: {
    avg?: number;
    max?: number;
    min?: number;
    last?: number;
    count?: number;
    q50?: number;
    q90?: number;
    q95?: number;
    q99?: number;
  };
}

export interface MetricComparison {
  metric_name: string;
  evaluate_type: string;
  current_value: number | null;
  selected_value: number | null;
  percentage_difference: number | null;
  // Grouping + display context (attached in fetchMetricsComparison).
  dashboard_label?: string;
  panel_title?: string;
  dashboardId?: string;
  panelId?: number;
  yAxesFormat?: string;
}

export interface MetricDataPoint {
  time: string;
  metric_name: string;
  value: number;
  timestep: number;
  ramp_up?: boolean;
}

export interface GraphData {
  currentMetrics: MetricDataPoint[];
  baselineMetrics: MetricDataPoint[];
  currentTestRunId: string;
  baselineTestRunId: string;
  applicationDashboardId: string;
  panelId: number;
  metricName: string | null;
}

export type DataSource = 'grafana' | 'dynatrace' | 'performance-metrics';

/**
 * Represents a series added for comparison (matching TrendsCard pattern)
 */
export interface CompareSeries {
  id: string;
  dashboardId: string;
  dashboardLabel: string;
  panelId: number;
  panelTitle: string;
  metricName: string;
  source: DataSource;
  metricsSourceId?: string;
  /** Panel value format (e.g. 'percentunit', 's', 'ms') for unit-correct display. */
  yAxesFormat?: string;
  /** True when this series is the run-wide "All aggregated" pseudo-metric. */
  isAggregated?: boolean;
}

/**
 * Props for generating comparison plot
 */
export interface ComparisonPlotProps {
  metricName: string;
  graphData: GraphData;
  selectedMetric: Panel | null;
  testRun: TestRun | null;
  relatedTestRuns: RelatedTestRun[];
  showToast: (message: string) => void;
}

/**
 * Props for the metrics comparison table
 */
export interface MetricsComparisonTableProps {
  metricComparisons: MetricComparison[];
  selectedTestRun: RelatedTestRun;
  testRunId: string;
  showPercentiles: boolean;
  seriesSearchText: string;
  selectedMetric: Panel | null;
  selectedDashboard: ApplicationDashboard | null;
  showGraphs: Record<string, boolean>;
  graphData: Record<string, GraphData>;
  graphLoading: Record<string, boolean>;
  onToggleGraph: (metricName: string) => void;
  onShowGraphsChange: (update: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  onGraphDataChange: (update: (prev: Record<string, GraphData>) => Record<string, GraphData>) => void;
  onGraphLoadingChange: (update: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  testRun: TestRun | null;
  relatedTestRuns: RelatedTestRun[];
  showToast: (message: string) => void;
  addedSeries: CompareSeries[];
}

/**
 * Props for added series display component
 */
export interface AddedSeriesDisplayProps {
  addedSeries: CompareSeries[];
  onRemoveSeries: (seriesId: string) => void;
  onClearAll: () => void;
}
