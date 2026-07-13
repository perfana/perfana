import { GRAFANA_UNITS, TrendsSeries, TimeRangeOption, TimeRange, MetricStatistic } from '../types';

/**
 * Get color for a series based on its index
 * Cycles through colors for different series
 */
export function getSeriesColor(index: number): string {
  const colors = ['#2E86AB', '#FF6B35', '#4CAF50', '#9C27B0', '#FF9800'];
  return colors[index % colors.length];
}

/**
 * Get y-axis title and suffix based on the unit format
 * Uses the first series with a unit set
 */
export function getYAxisConfig(addedSeries: TrendsSeries[]): { title: string; ticksuffix: string } {
  const seriesWithUnit = addedSeries.find(s => s.yAxisFormat);
  if (!seriesWithUnit?.yAxisFormat) {
    return { title: 'Value', ticksuffix: '' };
  }

  const unit = seriesWithUnit.yAxisFormat;
  const unitConfig = GRAFANA_UNITS.find(u => u.value === unit);

  const suffixMap: Record<string, string> = {
    'ms': ' ms',
    's': ' s',
    'µs': ' µs',
    'ns': ' ns',
    'percent': '%',
    'percentunit': '',
    'bytes': ' B',
    'kbytes': ' KB',
    'mbytes': ' MB',
    'gbytes': ' GB',
    'reqps': ' req/s',
    'ops': ' ops/s',
    'wps': ' w/s',
    'rps': ' r/s',
    'short': '',
    'none': ''
  };

  return {
    title: unitConfig?.label || 'Value',
    ticksuffix: suffixMap[unit] || ''
  };
}

/**
 * Calculate time range dates based on the selected option
 */
export function calculateTimeRangeDates(
  timeRange: TimeRangeOption,
  customTimeRange: TimeRange
): { fromDate: Date; toDate: Date } {
  let fromDate: Date;
  let toDate: Date;

  if (timeRange.value === 'custom') {
    fromDate = customTimeRange.from;
    toDate = customTimeRange.to;
  } else {
    toDate = new Date();

    if (timeRange.type === 'months') {
      fromDate = new Date(toDate);
      fromDate.setMonth(fromDate.getMonth() - (timeRange.value as number));
    } else {
      const days = timeRange.value as number;
      fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    }
  }

  return { fromDate, toDate };
}

/**
 * Format unit label for display
 */
export function getUnitLabel(unitValue: string | undefined): string {
  if (!unitValue) return 'No unit set';
  const unit = GRAFANA_UNITS.find(u => u.value === unitValue);
  return unit?.label || unitValue;
}

/**
 * Shape the batch aggregate endpoint's per-run values into the MetricStatistic
 * rows the trends plot consumes. Runs without data (null value) are dropped so
 * the line simply skips them. created_at/version come from the related-run list
 * so the point sorts and hovers like a normal series point.
 */
export function buildAggregatedTrendsStatistics(
  series: TrendsSeries,
  values: Array<{ testRunId: string; value: number | null }>,
  runs: Array<{ test_run_id: string; created_at: string; version?: string | null }>,
): MetricStatistic[] {
  const runById = new Map(runs.map(r => [r.test_run_id, r]));
  const out: MetricStatistic[] = [];
  for (const { testRunId, value } of values) {
    const run = runById.get(testRunId);
    if (value == null || !run) continue;
    out.push({
      test_run_id: testRunId,
      panel_title: series.panelTitle,
      metric_name: series.metricName,
      value,
      created_at: run.created_at,
      version: run.version ?? null,
    });
  }
  return out;
}
