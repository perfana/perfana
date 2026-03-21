/**
 * Types for SLOMetricsChart component
 */

export interface MetricDataPoint {
  metric_name: string;
  time: string;
  timestep: number;
  ramp_up: boolean;
  value: number;
}

export interface DSMetric {
  test_run_id: string;
  panel_id: number;
  panel_title: string;
  dashboard_label: string;
  data: MetricDataPoint[];
}

export interface CheckResultRequirement {
  operator: string;
  value: number;
}

export interface CheckResultTarget {
  target: string;
  value: number;
  meets_requirement: boolean;
}

export interface CheckResult {
  panel_id: number;
  panel_title?: string;
  dashboard_label?: string;
  metric_name?: string;
  benchmark_id?: string;
  application_dashboard_id?: string;
  requirement?: CheckResultRequirement;
  evaluate_type?: string;
  metric_unit?: string;
  targets?: CheckResultTarget[];
}

export interface TestRunInfo {
  start_time: string;
  end_time?: string;
  ramp_up_seconds?: number;
}

export interface SLOMetricsChartProps {
  testRunId: string;
  checkResult: CheckResult;
  testRun?: TestRunInfo;
  targetName?: string;
  isVisible?: boolean;
}

export interface UnitConversion {
  factor: number;
  adjustedRequirement: number;
  adjustedFormat: string;
  yAxisLabel: string;
}

export interface ChartThemeColors {
  sloColor: string;
  rampUpColor: string;
  textColor: string;
  textSecondary: string;
  bgColor: string;
  plotBgColor: string;
  gridColor: string;
  dividerColor: string;
  hoverBgColor: string;
}

export interface MetricTraceConfig {
  metricName: string;
  x: Date[];
  y: number[];
  color: string;
  meetsRequirement: boolean;
}
