import { RelatedTestRun, CompareSeries, MetricComparison } from '../types/compare.types';
import { DiffThresholds } from './compare-bands';

/**
 * Calculate percentage difference between current and baseline values
 */
export const calculatePercentageDifference = (
  current: number | null,
  selected: number | null
): number | null => {
  if (current === null || selected === null || selected === 0) {
    return null;
  }
  return ((current - selected) / selected) * 100;
};

/**
 * Apply unit conversion based on panel format
 */
export const applyUnitConversion = (
  value: number | null | undefined,
  panelYAxesFormat?: string
): number | null => {
  if (value === null || value === undefined) return null;

  // If unit is 'percentunit' convert to percentage
  if (panelYAxesFormat === 'percentunit') {
    return value * 100;
  }

  return value;
};

/**
 * Format number for display
 */
export const formatCompareNumber = (
  value: number | null | undefined,
  panelYAxesFormat?: string
): string => {
  if (value === null || value === undefined) return 'N/A';
  const convertedValue = applyUnitConversion(value, panelYAxesFormat);
  if (convertedValue === null) return 'N/A';
  return convertedValue.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

/**
 * Get color for percentage difference
 */
export const getDiffColor = (diff: number | null): string => {
  if (diff === null) return 'text.secondary';
  if (Math.abs(diff) < 1) return 'text.secondary'; // Less than 1% difference
  if (diff > 0) return 'error.main'; // Increase (worse performance)
  return 'success.main'; // Decrease (better performance)
};

/**
 * Format test run display text
 */
export const getTestRunDisplayText = (testRun: RelatedTestRun): string => {
  const startTime = testRun.start_time || testRun.created_at;
  const formattedTime = new Date(startTime).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  return `${testRun.test_run_id} - ${formattedTime}`;
};

/**
 * Get test run secondary info string
 */
export const getTestRunSecondaryInfo = (testRun: RelatedTestRun): string => {
  const parts = [];

  if (testRun.application_release) {
    parts.push(`Version: ${testRun.application_release}`);
  }

  if (testRun.annotations && testRun.annotations.length > 0) {
    parts.push(`Annotations: ${testRun.annotations.join(', ')}`);
  }

  return parts.join(' • ');
};

/**
 * Get visible columns based on percentiles toggle
 */
export const getVisibleColumns = (showPercentiles: boolean, forceInclude: string[] = []): string[] => {
  const baseColumns = ['avg', 'max', 'min', 'last', 'count'];
  const percentileColumns = ['q50', 'q90', 'q95', 'q99'];
  const visiblePercentiles = showPercentiles
    ? percentileColumns
    : percentileColumns.filter(c => forceInclude.includes(c));
  return [...baseColumns, ...visiblePercentiles];
};

/**
 * Get grid template columns CSS value
 */
export const getGridTemplateColumns = (showPercentiles: boolean, forceInclude: string[] = []): string => {
  const totalDataColumns = getVisibleColumns(showPercentiles, forceInclude).length;
  return `2fr repeat(${totalDataColumns}, 1fr)`; // 2fr for label column, 1fr for each data column
};

/**
 * Column labels for the comparison table
 */
export const COLUMN_LABELS: Record<string, string> = {
  avg: 'Mean',
  max: 'Max',
  min: 'Min',
  last: 'Last',
  count: 'Count',
  q50: 'Q50',
  q90: 'Q90',
  q95: 'Q95',
  q99: 'Q99'
};

/**
 * Get status icon and color based on comparison status
 */
export const getStatusIcon = (
  status: 'success' | 'warning' | 'info'
): { icon: string; color: string } => {
  switch (status) {
    case 'success':
      return { icon: '✓', color: '#4caf50' };
    case 'warning':
      return { icon: '⚠', color: '#ff9800' };
    default:
      return { icon: 'ℹ', color: '#2196f3' };
  }
};

/**
 * Compare card accent color
 */
export const COMPARE_ACCENT_COLOR = '#1976d2';

/**
 * One comparison row for an "All aggregated" series. Unlike a normal metric
 * (which yields a row per evaluate type), the aggregate only exposes the
 * panel's own stat, so it produces a single row keyed by that stat.
 */
const AGG_STAT_TO_COLUMN: Record<string, string> = { p50: 'q50', p90: 'q90', p95: 'q95', p99: 'q99' };

export function buildAggregatedComparison(
  series: CompareSeries,
  currentValue: number | null,
  baselineValue: number | null,
  stat: string,
): MetricComparison {
  return {
    metric_name: series.metricName,
    evaluate_type: AGG_STAT_TO_COLUMN[stat] ?? stat,
    current_value: currentValue,
    selected_value: baselineValue,
    percentage_difference: calculatePercentageDifference(currentValue, baselineValue),
  };
}

/** Per-view display config for the baseline-style compare table. Persisted in presets. */
export interface DisplayConfig {
  /** Good→warn band ceiling %, shown as "Warning threshold" in the UI. */
  warningThreshold: number;
  /** Warn→bad band ceiling %, shown as "Regression threshold" in the UI. */
  regressionThreshold: number;
  /** Min absolute change gate; 0 = off. */
  minAbsolute: number;
  percentiles: { p90: boolean; p95: boolean; p99: boolean };
}

export const DEFAULT_DISPLAY_CONFIG: DisplayConfig = {
  warningThreshold: 10,
  regressionThreshold: 50,
  minAbsolute: 0,
  percentiles: { p90: false, p95: true, p99: true },
};

/** Map the UI's warning/regression labels onto the band-logic good/warning fields. */
export function toDiffThresholds(cfg: DisplayConfig): DiffThresholds {
  return {
    good: cfg.warningThreshold,
    warning: cfg.regressionThreshold,
    minAbsolute: cfg.minAbsolute > 0 ? cfg.minAbsolute : undefined,
  };
}

/** Ordered evaluate-type columns: avg always, then the enabled percentiles. */
export function getMetricColumns(cfg: DisplayConfig): string[] {
  const cols = ['avg'];
  if (cfg.percentiles.p90) cols.push('q90');
  if (cfg.percentiles.p95) cols.push('q95');
  if (cfg.percentiles.p99) cols.push('q99');
  return cols;
}

/** Report-style column headers. */
export const METRIC_COLUMN_LABELS: Record<string, string> = {
  avg: 'AVG',
  q90: 'P90',
  q95: 'P95',
  q99: 'P99',
};

/** Stable per-row key for graph state maps (rows are unique by dashboard+panel+metric). */
export const graphKeyOf = (dashboardId: string, panelId: number, metricName: string): string =>
  `${dashboardId}::${panelId}::${metricName}`;
