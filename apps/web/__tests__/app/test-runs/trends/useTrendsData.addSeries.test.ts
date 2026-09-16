/**
 * useTrendsData after the cascade: one click adds series from several panels across
 * several dashboards, each row keyed by its own id, and the statistics fetched for them
 * are tagged with that id so two panels sharing a metric name stay two trends.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTrendsData } from '@/app/test-runs/[id]/components/trends/hooks/useTrendsData';
import type { ApplicationDashboard } from '@/app/test-runs/[id]/components/trends/types';
import type { PanelOption } from '@/app/test-runs/[id]/components/shared/metric-options';
import { ALL_AGGREGATED_OPTION } from '@/lib/aggregated-perf-series';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('@/lib/dynatrace', () => ({
  ...jest.requireActual('@/lib/dynatrace'),
  fetchDynatraceDashboards: jest.fn().mockResolvedValue([]),
}));

import { authenticatedFetch } from '@/lib/api';

const testRun = {
  test_run_id: 'run-3', created_at: '2026-09-14T05:00:00Z', system_under_test_id: 'sut-1',
  test_environment: 'acc', workload: 'load', systems_under_test: { name: 'sut' },
} as never;

const perfDashboard: ApplicationDashboard = {
  id: 'dash-1', dashboard_label: 'Perf', dashboard_name: 'Perf',
  dashboard_uid: 'perf-uid', source_type: 'performance_test', metrics_source_id: 'ms-1',
};
const allAggDashboard: ApplicationDashboard = {
  id: 'dash-agg', dashboard_label: 'Performance test metrics all aggregated',
  dashboard_name: 'Performance test metrics all aggregated',
  dashboard_uid: 'performance-test-metrics-all-aggregated', source_type: 'performance_test', metrics_source_id: 'ms-1',
};
const jvmDashboard: ApplicationDashboard = {
  id: 'dash-2', dashboard_label: 'JVM', dashboard_name: 'JVM',
  dashboard_uid: 'jvm-uid', source_type: 'grafana', metrics_source_id: 'ms-2',
};

const panelOf = (dashboard: ApplicationDashboard, id: number, title: string, unit?: string): PanelOption => ({
  id, title, type: 'timeseries', yAxesFormat: unit,
  applicationDashboardId: dashboard.id, metricsSourceId: dashboard.metrics_source_id,
  dashboard, dashboardLabel: dashboard.dashboard_label,
  source: dashboard.source_type === 'performance_test' ? 'performance-metrics' : 'grafana',
});

/** Route the hook's own requests: related runs (oldest-run lookup) and the statistics. */
function routeFetch(statsByPanel: Record<string, unknown[]>) {
  (authenticatedFetch as jest.Mock).mockImplementation(async (url: string) => {
    if (url.includes('/related')) return { ok: true, json: async () => [] };
    if (url.includes('/application-dashboards')) return { ok: true, json: async () => [] };
    const panelId = new URL(`http://x${url}`).searchParams.get('panelId') ?? '';
    return { ok: true, json: async () => statsByPanel[panelId] ?? [] };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  routeFetch({});
});

function setup() {
  return renderHook(() => useTrendsData({ testRun, testRunId: 'run-3', trendsExpanded: false }));
}

it('adds series from several panels across several dashboards in one click', () => {
  const { result } = setup();

  let count = 0;
  act(() => {
    count = result.current.handleAddSeries([
      { dashboard: perfDashboard, panel: panelOf(perfDashboard, 101, 'Transaction RT Avg', 'ms'), metricName: 'T01' },
      { dashboard: jvmDashboard, panel: panelOf(jvmDashboard, 5, 'Heap', 'bytes'), metricName: 'used' },
    ]);
  });

  expect(count).toBe(2);
  expect(result.current.addedSeries).toHaveLength(2);
  expect(result.current.addedSeries[0]).toMatchObject({
    dashboardId: 'dash-1', dashboardLabel: 'Perf', panelId: 101, panelTitle: 'Transaction RT Avg',
    metricName: 'T01', source: 'performance-metrics', yAxisFormat: 'ms', metricsSourceId: 'ms-1', isAggregated: false,
  });
  expect(result.current.addedSeries[1]).toMatchObject({
    dashboardId: 'dash-2', panelId: 5, metricName: 'used', source: 'grafana', yAxisFormat: 'bytes', metricsSourceId: 'ms-2',
  });
  // Distinct ids even for rows added in the same tick
  expect(result.current.addedSeries[0]!.id).not.toBe(result.current.addedSeries[1]!.id);
  // The first pick becomes the preset-save context and the chart title
  expect(result.current.selectedSource).toBe('performance-metrics');
  expect(result.current.selectedDashboard).toBe(perfDashboard);
  expect(result.current.selectedMetric?.id).toBe(101);
});

it('skips series already on the chart and reports how many were new', () => {
  const { result } = setup();
  const pick = { dashboard: jvmDashboard, panel: panelOf(jvmDashboard, 5, 'Heap'), metricName: 'used' };

  act(() => { result.current.handleAddSeries([pick]); });
  let count = -1;
  act(() => {
    count = result.current.handleAddSeries([
      pick,
      { dashboard: jvmDashboard, panel: panelOf(jvmDashboard, 5, 'Heap'), metricName: 'committed' },
    ]);
  });

  expect(count).toBe(1);
  expect(result.current.addedSeries.map((s) => s.metricName)).toEqual(['used', 'committed']);

  act(() => { count = result.current.handleAddSeries([pick]); });
  expect(count).toBe(0);
  expect(result.current.addedSeries).toHaveLength(2);
});

it('stores the synthetic "All aggregated" under its composed name, but not on the all-aggregated dashboard', () => {
  const { result } = setup();

  act(() => {
    result.current.handleAddSeries([
      { dashboard: perfDashboard, panel: panelOf(perfDashboard, 101, 'Transaction RT Avg'), metricName: ALL_AGGREGATED_OPTION },
      { dashboard: allAggDashboard, panel: panelOf(allAggDashboard, 101, 'Transaction RT Avg'), metricName: ALL_AGGREGATED_OPTION },
    ]);
  });

  expect(result.current.addedSeries[0]).toMatchObject({
    metricName: 'All aggregated — Transaction RT Avg', isAggregated: true,
  });
  // On that dashboard the name is a real stored series
  expect(result.current.addedSeries[1]).toMatchObject({ metricName: 'All aggregated', isAggregated: false });
});

it('keeps the preset-save context from the first add when the cascade has been cleared since', () => {
  const { result } = setup();

  act(() => { result.current.handlePrimaryChange(jvmDashboard, panelOf(jvmDashboard, 5, 'Heap')); });
  expect(result.current.selectedDashboard).toBe(jvmDashboard);

  // The user cleared the pickers, then added from another dashboard
  act(() => { result.current.handlePrimaryChange(null, null); });
  act(() => {
    result.current.handleAddSeries([
      { dashboard: perfDashboard, panel: panelOf(perfDashboard, 101, 'Transaction RT Avg'), metricName: 'T01' },
    ]);
  });

  expect(result.current.selectedDashboard).toBe(perfDashboard);
  expect(result.current.selectedMetric?.id).toBe(101);
});

it('tags every fetched statistic with the id of the series it belongs to, and drops the rest', async () => {
  // Two panels of one dashboard each answer with a row named "All aggregated": without the
  // tag the plot merged them into one zigzag trace. A row for a metric nobody added is noise.
  routeFetch({
    '101': [
      { test_run_id: 'run-1', panel_title: 'Transaction RT Avg', metric_name: 'All aggregated', value: 280, created_at: '2026-09-10T05:00:00Z' },
      { test_run_id: 'run-1', panel_title: 'Transaction RT Avg', metric_name: 'not-added', value: 1, created_at: '2026-09-10T05:00:00Z' },
    ],
    '105': [
      { test_run_id: 'run-1', panel_title: 'Transaction Error Rate', metric_name: 'All aggregated', value: 0.01, created_at: '2026-09-10T05:00:00Z' },
    ],
  });
  const { result } = setup();

  act(() => {
    result.current.handleAddSeries([
      { dashboard: allAggDashboard, panel: panelOf(allAggDashboard, 101, 'Transaction RT Avg', 'ms'), metricName: 'All aggregated' },
      { dashboard: allAggDashboard, panel: panelOf(allAggDashboard, 105, 'Transaction Error Rate', 'percentunit'), metricName: 'All aggregated' },
    ]);
  });

  await waitFor(() => expect(result.current.metricsData).toHaveLength(2));
  const [rt, err] = result.current.addedSeries;
  expect(result.current.metricsData.map((m) => [m.series_id, m.value])).toEqual([
    [rt!.id, 280],
    [err!.id, 0.01],
  ]);
  // One statistics request per dashboard/panel, scoped to the run's system
  const statsUrls = (authenticatedFetch as jest.Mock).mock.calls
    .map(([u]) => u as string).filter((u) => u.includes('/ds-metric-statistics'));
  expect(statsUrls).toHaveLength(2);
  expect(statsUrls[0]).toContain('metricsSourceId=ms-1');
  expect(statsUrls[0]).toContain('system=sut');
});

it('empties the chart data and selection when a statistics request throws', async () => {
  (authenticatedFetch as jest.Mock).mockImplementation(async (url: string) => {
    if (url.includes('/ds-metric-statistics')) throw new Error('network');
    return { ok: true, json: async () => [] };
  });
  const { result } = setup();

  act(() => {
    result.current.handleAddSeries([
      { dashboard: jvmDashboard, panel: panelOf(jvmDashboard, 5, 'Heap'), metricName: 'used' },
    ]);
  });

  await waitFor(() => expect(result.current.metricsLoading).toBe(false));
  expect(result.current.metricsData).toEqual([]);
  expect(result.current.addedSeries).toHaveLength(1);
});
