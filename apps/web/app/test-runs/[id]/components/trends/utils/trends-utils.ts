import { GRAFANA_UNITS, TrendsSeries, TimeRangeOption, TimeRange, MetricStatistic } from '../types';

/**
 * Get color for a series based on its index
 * Cycles through colors for different series
 */
export function getSeriesColor(index: number): string {
  const colors = ['#2E86AB', '#FF6B35', '#4CAF50', '#9C27B0', '#FF9800'];
  return colors[index % colors.length];
}

const UNIT_SUFFIXES: Record<string, string> = {
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

export interface AxisConfig {
  title: string;
  ticksuffix: string;
}

function axisConfigForUnit(unit: string | undefined): AxisConfig {
  if (!unit) {
    return { title: 'Value', ticksuffix: '' };
  }
  return {
    title: GRAFANA_UNITS.find(u => u.value === unit)?.label || 'Value',
    ticksuffix: UNIT_SUFFIXES[unit] || ''
  };
}

/**
 * Split the added series across a left and a right y-axis by unit, mirroring the
 * Graphs card: the first unit keeps the left axis and every other unit shares the
 * right one. Without this a percent series and a req/s series land on one axis and
 * the second one is drawn under the first one's label and tick suffix.
 *
 * `rightMetrics` holds the metric names that belong on the right axis, which is what
 * the traces are keyed by.
 *
 * ponytail: three or more distinct units still share a single right axis, labelled
 * for the first of them. Give each unit its own axis if that combination shows up.
 */
export function getYAxisConfigs(addedSeries: TrendsSeries[]): {
  left: AxisConfig;
  right: AxisConfig | null;
  rightMetrics: Set<string>;
} {
  const groups = new Map<string, string[]>();
  for (const series of addedSeries) {
    const key = series.yAxisFormat || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(series.metricName);
  }

  const entries = Array.from(groups.entries());
  const left = axisConfigForUnit(entries[0]?.[0] || undefined);

  if (entries.length < 2) {
    return { left, right: null, rightMetrics: new Set() };
  }

  const rightEntries = entries.slice(1);
  return {
    left,
    right: axisConfigForUnit(rightEntries[0]![0] || undefined),
    rightMetrics: new Set(rightEntries.flatMap(([, names]) => names))
  };
}

/**
 * Left-axis config only. Kept for callers that do not deal with a second axis.
 */
export function getYAxisConfig(addedSeries: TrendsSeries[]): AxisConfig {
  return getYAxisConfigs(addedSeries).left;
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
