/**
 * Tests for useCompareData — URL panel injection + routing (Task 4).
 *
 * Covers:
 * - `fetchDashboardPanels` appends virtual URL panels for performance-metrics dashboards
 * - `fetchDashboardPanels` does NOT append URL panels for non-perf dashboards
 * - `fetchPanelMetrics` routes URL-panel distinct-names lookups to `fetchUrlDistinctNames`
 */

import { renderHook, act } from '@testing-library/react';
import { useCompareData } from './useCompareData';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('@/lib/url-perf-panels', () => ({
  ...jest.requireActual('@/lib/url-perf-panels'),
  fetchUrlDistinctNames: jest.fn().mockResolvedValue(['/api/user/{id}']),
  fetchUrlMetricStatistics: jest.fn().mockResolvedValue([]),
}));

import { authenticatedFetch } from '@/lib/api';
import { fetchUrlDistinctNames } from '@/lib/url-perf-panels';

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

it('appends URL panels for a performance-metrics dashboard', async () => {
  (authenticatedFetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => [{ panels: [{ id: 202, title: 'Request RT P90', type: 'timeseries' }] }],
  });
  const { result } = renderHook(() => useCompareData({ testRun, testRunId: 'run-1', compareExpanded: true }));
  let panels: any[] = [];
  await act(async () => { panels = await result.current.fetchDashboardPanels('perf-uid', true); });
  expect(panels.some(p => p.id === 210)).toBe(true);   // URL panel injected
  expect(panels.some(p => p.id === 202)).toBe(true);   // request panel preserved
});

it('does NOT append URL panels for a non-perf dashboard', async () => {
  (authenticatedFetch as jest.Mock).mockResolvedValue({
    ok: true, json: async () => [{ panels: [{ id: 5, title: 'CPU', type: 'timeseries' }] }],
  });
  const { result } = renderHook(() => useCompareData({ testRun, testRunId: 'run-1', compareExpanded: true }));
  let panels: any[] = [];
  await act(async () => { panels = await result.current.fetchDashboardPanels('grafana-uid', false); });
  expect(panels.some(p => p.id >= 210 && p.id <= 218)).toBe(false);
});

it('routes URL panel distinct-names to the URL endpoint', async () => {
  const { result } = renderHook(() => useCompareData({ testRun, testRunId: 'run-1', compareExpanded: true }));
  let names: string[] = [];
  await act(async () => { names = await result.current.fetchPanelMetrics('dash-1', 210); });
  expect(fetchUrlDistinctNames).toHaveBeenCalledWith('run-1');
  expect(names).toEqual(['/api/user/{id}']);
});
