/**
 * Types for CurrentTestRunChart component
 */

export interface MetricDataPoint {
  metric_name: string;
  time: string;
  timestep: number;
  ramp_up: boolean;
  value: number;
}

export interface TestRunInfo {
  start_time: string;
  end_time?: string;
  ramp_up_seconds?: number;
}

export interface ThresholdBound {
  overall?: number | null;
}

export interface Thresholds {
  lower?: ThresholdBound;
  upper?: ThresholdBound;
}

export interface AggregatedMetricSource {
  metric: 'transaction_response_time' | 'request_response_time' | 'error_percentage';
  stat?: string;
}

export interface CurrentTestRunChartProps {
  testRunId: string;
  applicationDashboardId: string;
  panelId: string;
  metricName: string;
  testRun?: TestRunInfo;
  thresholds?: Thresholds;
  unit?: string | null;
  isDrawerOpen?: boolean;
  showToast?: (message: string) => void;
  aggregatedMetricSource?: AggregatedMetricSource;
}

export interface UnitConversion {
  factor: number;
  yAxisLabel: string;
}

export interface ChartThemeColors {
  textColor: string;
  textSecondary: string;
  bgColor: string;
  plotBgColor: string;
  gridColor: string;
  dividerColor: string;
  rampUpColor: string;
  primaryColor: string;
  thresholdColor: string;
  hoverBgColor: string;
}

export interface TimeRange {
  start: Date;
  end: Date;
}
