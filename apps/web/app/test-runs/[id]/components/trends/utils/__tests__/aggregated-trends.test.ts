import { buildAggregatedTrendsStatistics } from '../trends-utils';
import type { TrendsSeries } from '../../types';

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
        test_run_id: 'a', panel_title: 'Request RT P90',
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
