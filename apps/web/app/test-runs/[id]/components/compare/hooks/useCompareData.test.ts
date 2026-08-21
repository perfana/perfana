/**
 * Tests for useCompareData — the aggregated-series fan-out.
 *
 * Covers:
 * - an aggregated series becomes one comparison cell per stat column, each
 *   carrying the panel metadata that decides which table row it lands in
 *
 * The panel/series option loading these used to cover now lives in
 * utils/__tests__/metric-options.test.ts.
 */

import { renderHook, act } from '@testing-library/react';
import { useCompareData } from './useCompareData';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('@/lib/url-perf-panels', () => ({
  ...jest.requireActual('@/lib/url-perf-panels'),
  fetchUrlDistinctNames: jest.fn().mockResolvedValue(['/api/user/{id}']),
  fetchUrlMetricStatistics: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/lib/aggregated-perf-series', () => ({
  ...jest.requireActual('@/lib/aggregated-perf-series'),
  fetchAggregatedStatistics: jest.fn(),
}));

import { authenticatedFetch } from '@/lib/api';
import { fetchAggregatedStatistics } from '@/lib/aggregated-perf-series';

const testRun = {
  test_run_id: 'run-1',
  system_under_test_id: 'sut-1',
  test_environment: 'acc',
  workload: 'load',
  systems_under_test: { name: 'sut' },
} as any;

beforeEach(() => {
  jest.clearAllMocks();
});

it('fans an aggregated series out into one cell per stat, keeping panel metadata', async () => {
  // Regression guard for the empty-percentile-column bug: the hook must read
  // the whole `values` object off each run, not just `value`, and must stamp
  // every emitted cell with the panel metadata that groups it into a row.
  (fetchAggregatedStatistics as jest.Mock).mockResolvedValue([
    { testRunId: 'run-1', value: 100, values: { avg: 100, p50: 90, p90: 200, p95: 300, p99: 400, max: 900 } },
    { testRunId: 'run-0', value: 80, values: { avg: 80, p50: 70, p90: 160, p95: 240, p99: 320, max: 800 } },
  ]);

  const { result } = renderHook(() => useCompareData({ testRun, testRunId: 'run-1', compareExpanded: true }));

  await act(async () => {
    result.current.setSelectedTestRun({ test_run_id: 'run-0' } as any);
    result.current.setAddedSeries([{
      id: 's1',
      dashboardId: 'd1',
      dashboardLabel: 'Performance',
      panelId: 201,
      panelTitle: 'Request RT',
      metricName: 'All aggregated — Request RT',
      source: 'performance-metrics',
      isAggregated: true,
    } as any]);
  });
  await act(async () => { await result.current.fetchMetricsComparison(); });

  const agg = result.current.metricComparisons.filter(c => c.metric_name.startsWith('All aggregated'));
  expect(agg.map(c => c.evaluate_type)).toEqual(['avg', 'q90', 'q95', 'q99']);
  expect(agg.map(c => c.current_value)).toEqual([100, 200, 300, 400]);
  expect(agg.map(c => c.selected_value)).toEqual([80, 160, 240, 320]);
  expect(agg.every(c => c.panelId === 201 && c.dashboardId === 'd1' && c.panel_title === 'Request RT')).toBe(true);
});
