import { buildAggregatedTrendsStatistics, resolveTimeRange } from '../trends-utils';
import { TIME_RANGE_OPTIONS, type TrendsSeries } from '../../types';

const series = {
  id: 's1', dashboardId: 'd1', dashboardLabel: 'Perf', panelId: 202,
  panelTitle: 'Request RT P90', metricName: 'All aggregated — Request RT P90',
  source: 'performance-metrics', isAggregated: true,
} as TrendsSeries;

describe('buildAggregatedTrendsStatistics', () => {
  it('emits one MetricStatistic per run with a non-null value', () => {
    const runs = [
      { test_run_id: 'a', created_at: '2026-07-01T00:00:00Z', version: 'v1' },
      { test_run_id: 'b', created_at: '2026-07-02T00:00:00Z' },
    ];
    const values = [
      { testRunId: 'a', value: 1800 },
      { testRunId: 'b', value: null },
    ];
    const result = buildAggregatedTrendsStatistics(series, values, runs);
    expect(result).toEqual([
      {
        test_run_id: 'a', series_id: 's1', panel_title: 'Request RT P90',
        metric_name: 'All aggregated — Request RT P90', value: 1800,
        created_at: '2026-07-01T00:00:00Z', version: 'v1',
      },
    ]);
  });

  it('returns [] when no run has data', () => {
    const runs = [{ test_run_id: 'a', created_at: '2026-07-01T00:00:00Z' }];
    expect(buildAggregatedTrendsStatistics(series, [{ testRunId: 'a', value: null }], runs)).toEqual([]);
  });
});

// Value: protects=the absolute window a Trends range covers, which both the fetch and a comment's
// recorded view read: day options subtract exact days, month options subtract calendar months, and
// Custom returns the picked dates untouched; fails_when=a month option is treated as days ('Last 3
// months' becomes 3 days and the chart silently loses most runs), the day arithmetic is off by a
// factor, or Custom is recomputed from now; why_new=useTrendsCommentView.test only checks a 7-day
// span through the hook, no test reaches the months branch; seam=none; no_claim=the API's range filter.
describe('resolveTimeRange', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  const option = (label: string) => TIME_RANGE_OPTIONS.find((o) => o.label === label)!;

  it('subtracts calendar months for a month option', () => {
    const { from, to } = resolveTimeRange(option('Last 3 months'), { from: new Date(0), to: new Date(0) }, now);
    expect(to).toBe(now);
    const expected = new Date(now);
    expected.setMonth(expected.getMonth() - 3);
    expect(from.toISOString()).toBe(expected.toISOString());
    expect(from.toISOString().slice(0, 10)).toBe('2026-08-20');
  });

  it('subtracts exact days for a day option and does not move now', () => {
    const { from, to } = resolveTimeRange(option('Last 2 days'), { from: new Date(0), to: new Date(0) }, now);
    expect(to.getTime() - from.getTime()).toBe(2 * 86_400_000);
    expect(now.toISOString()).toBe('2026-11-20T12:00:00.000Z');
  });

  it('returns the custom window as picked', () => {
    const custom = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-02-01T00:00:00Z') };
    expect(resolveTimeRange(option('Custom'), custom, now)).toBe(custom);
  });
});
