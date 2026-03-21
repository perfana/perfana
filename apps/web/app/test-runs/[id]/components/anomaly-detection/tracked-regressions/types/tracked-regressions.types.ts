import { TestRun } from '@/types/test-runs';

/**
 * Represents a tracked performance regression that persists across test runs
 */
export interface TrackedRegression {
  id: string;
  metricName: string;
  dashboardLabel: string;
  panelTitle: string;
  firstDetected: string;
  testRunsAffected: number;
  currentValue: number;
  baselineValue: number;
  percentageChange: number;
  status: 'unresolved' | 'accepted' | 'denied';
  trackedTestRuns: string[];
  unit: string;
  conclusion?: {
    label: string;
    confidence: number;
  };
  queuePosition?: number;
}

/**
 * Props for the TrackedRegressionsTab component
 */
export interface TrackedRegressionsTabProps {
  testRunId: string;
  testRun?: TestRun | null;
  system?: string;
  environment?: string;
  workload?: string;
  onNotification?: (message: string, type: 'success' | 'error') => void;
  showToast?: (message: string) => void;
}

/**
 * Props for the TrackedRegressionCard component
 */
export interface TrackedRegressionCardProps {
  regression: TrackedRegression;
  expanded: boolean;
  onToggle: () => void;
  onResolve: (resolution: 'accepted' | 'denied', id: string) => void;
  isOldest: boolean;
  position: number;
  totalCount: number;
  correlatedRegressions: TrackedRegression[];
  selectedMetric: string;
  onMetricChange: (metricName: string) => void;
  chartData?: PlotData[];
  resolving: boolean;
}

/**
 * Chart data point for a single test run
 */
export interface ChartDataPoint {
  testRunId: string;
  value: number;
  date: string;
  unit?: string;
  percentageChange?: number;
  isControlGroup?: boolean;
  isSourceTestRun?: boolean;
  hasRegression?: boolean;
  thresholds?: {
    upper: number;
    lower: number;
  };
}

/**
 * Raw chart data from API
 */
export interface RawChartData {
  testRuns: ChartDataPoint[];
}

/**
 * Plotly trace data structure
 */
export interface PlotData {
  name: string;
  x: number[];
  y: number[];
  type: string;
  mode: string;
  marker: {
    symbol: string;
    size: number;
    color: string | string[];
    line?: { color: string; width: number };
  };
  hovertemplate: string;
  text: string[];
}
