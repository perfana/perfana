import type { TestRun } from '@/types/test-runs';
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

// These used to be redeclared here as a narrower, subtly different shape than
// what the check-results endpoint actually returns. One canonical definition
// now lives in lib/types.ts, derived from the check_results table; re-exported
// so existing imports from this module keep working.
import type { CheckResult } from '@/lib/types';

export type { CheckResult, CheckResultRequirement, CheckResultTarget } from '@/lib/types';

/**
 * The window fields the SLO charts read off a test run. Derived from TestRun so
 * the optionality cannot drift from the source type.
 */
export type TestRunInfo = Pick<
  TestRun,
  'start_time' | 'end_time' | 'analysis_start_offset' | 'analysis_end_offset'
> & {
  /** @deprecated Use analysis_start_offset instead. Kept for API compatibility. */
  ramp_up_seconds?: number;
};

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
  excludedRegionColor: string;
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
