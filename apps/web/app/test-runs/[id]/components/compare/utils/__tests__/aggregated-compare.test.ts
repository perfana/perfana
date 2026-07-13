import { buildAggregatedComparison } from '../compare-utils';
import type { CompareSeries } from '../../types';

const series = {
  id: 's1', dashboardId: 'd1', dashboardLabel: 'Perf', panelId: 202,
  panelTitle: 'Request RT P90', metricName: 'All aggregated — Request RT P90',
  source: 'performance-metrics', isAggregated: true,
} as CompareSeries;

describe('buildAggregatedComparison', () => {
  it('builds a single comparison row with the mapped stat as evaluate_type', () => {
    const row = buildAggregatedComparison(series, 2000, 1600, 'p90');
    expect(row.metric_name).toBe('All aggregated — Request RT P90');
    expect(row.evaluate_type).toBe('q90');
    expect(row.current_value).toBe(2000);
    expect(row.selected_value).toBe(1600);
    expect(row.percentage_difference).toBeCloseTo(25); // (2000-1600)/1600*100
  });

  it('maps a percentile stat to the table column key', () => {
    expect(buildAggregatedComparison(series, 2000, 1600, 'p90').evaluate_type).toBe('q90');
    expect(buildAggregatedComparison(series, 2000, 1600, 'p95').evaluate_type).toBe('q95');
  });

  it('leaves avg as the avg column key', () => {
    expect(buildAggregatedComparison(series, 10, 8, 'avg').evaluate_type).toBe('avg');
  });

  it('passes nulls through', () => {
    const row = buildAggregatedComparison(series, null, null, 'avg');
    expect(row.current_value).toBeNull();
    expect(row.selected_value).toBeNull();
    expect(row.percentage_difference).toBeNull();
  });
});
