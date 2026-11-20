import { TrendsSeries, MetricStatistic, TIME_RANGE_OPTIONS, type TimeRange } from '../types';

/**
 * `getSeriesColor`, `UNIT_SUFFIXES` and `getYAxisConfigs` used to live here. Colours come
 * from `@/lib/charts` by slot now, and axes from `resolveAxes` — the old splitter put the
 * first unit on the left and every other unit, however many, on one right axis labelled
 * for whichever of them came first.
 */

/**
 * Legend/hover name for a series. The metric name alone, unless another added series
 * shares it (every panel of the "all aggregated" dashboard has a series called
 * "All aggregated"), in which case the panel title is appended.
 */
export function trendsSeriesLabel(series: TrendsSeries, all: TrendsSeries[]): string {
  const others = all.filter(s => s.id !== series.id && s.metricName === series.metricName);
  if (others.length === 0) return series.metricName;
  // Two dashboards (two hosts, two scenarios) can share a panel title too.
  return others.some(s => s.panelTitle === series.panelTitle)
    ? `${series.metricName} — ${series.dashboardLabel} / ${series.panelTitle}`
    : `${series.metricName} — ${series.panelTitle}`;
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
      series_id: series.id,
      panel_title: series.panelTitle,
      metric_name: series.metricName,
      value,
      created_at: run.created_at,
      version: run.version ?? null,
    });
  }
  return out;
}

/**
 * The absolute window a Trends time range covers right now: the custom dates, or `now` minus the
 * option's days or months. One definition for the fetch and for a comment's recorded view.
 */
export function resolveTimeRange(
  timeRange: (typeof TIME_RANGE_OPTIONS)[number],
  custom: TimeRange,
  now: Date = new Date(),
): TimeRange {
  if (timeRange.value === 'custom') return custom;
  const from = new Date(now);
  if (timeRange.type === 'months') from.setMonth(from.getMonth() - timeRange.value);
  else from.setTime(now.getTime() - timeRange.value * 24 * 60 * 60 * 1000);
  return { from, to: now };
}
