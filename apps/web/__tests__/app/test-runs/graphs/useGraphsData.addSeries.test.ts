/**
 * useGraphsData.handleAddSeries after the cascade: one click adds series from several
 * panels across several dashboards, fetches each one's points, and tells the user what
 * happened — including when nothing was new or the data could not be loaded.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useGraphsData } from '@/app/test-runs/[id]/components/graphs/hooks/useGraphsData';
import type { ApplicationDashboard } from '@/app/test-runs/[id]/components/graphs/types';
import type { PanelOption } from '@/app/test-runs/[id]/components/shared/metric-options';
import { ALL_AGGREGATED_OPTION } from '@/lib/aggregated-perf-series';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('@/lib/dynatrace', () => ({
  ...jest.requireActual('@/lib/dynatrace'),
  fetchDynatraceDashboards: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/app/test-runs/[id]/components/graphs/utils/aggregated-series', () => ({
  ...jest.requireActual('@/app/test-runs/[id]/components/graphs/utils/aggregated-series'),
  fetchAggregatedSeriesData: jest.fn().mockResolvedValue([{ time: '2026-09-14T05:00:00Z', metric_name: 'x', value: 1 }]),
}));

import { authenticatedFetch } from '@/lib/api';
import { fetchAggregatedSeriesData } from '@/app/test-runs/[id]/components/graphs/utils/aggregated-series';

const testRun = {
  test_run_id: 'run-3', system_under_test_id: 'sut-1', test_environment: 'acc', workload: 'load',
} as never;

const perfDashboard: ApplicationDashboard = {
  id: 'dash-1', dashboard_label: 'Perf', dashboard_name: 'Perf',
  dashboard_uid: 'perf-uid', source_type: 'performance_test', metrics_source_id: 'ms-1',
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

const point = (metric_name: string, value: number) => ({ time: '2026-09-14T05:00:00Z', metric_name, value });

/** Route the hook's requests: dashboards list and per-panel metric points. */
function routeFetch(pointsByPanel: Record<string, unknown[]>) {
  (authenticatedFetch as jest.Mock).mockImplementation(async (url: string) => {
    if (url.includes('/application-dashboards')) return { ok: true, json: async () => [] };
    const panelId = url.match(/\/ds-metrics\/[^/]+\/(\d+)/)?.[1] ?? '';
    return { ok: true, json: async () => pointsByPanel[panelId] ?? [] };
  });
}

function setup() {
  const showToast = jest.fn();
  const { result } = renderHook(() => useGraphsData({ testRun, testRunId: 'run-3', graphsExpanded: true }));
  return { result, showToast };
}

beforeEach(() => {
  jest.clearAllMocks();
  routeFetch({});
});

it('adds series from several panels across several dashboards and loads only their points', async () => {
  routeFetch({
    '101': [point('T01', 280), point('T02', 300)],
    '5': [point('used', 1)],
  });
  const { result, showToast } = setup();

  let count = 0;
  await act(async () => {
    count = await result.current.handleAddSeries([
      { dashboard: perfDashboard, panel: panelOf(perfDashboard, 101, 'Transaction RT Avg', 'ms'), metricName: 'T01' },
      { dashboard: jvmDashboard, panel: panelOf(jvmDashboard, 5, 'Heap', 'bytes'), metricName: 'used' },
    ], showToast);
  });

  expect(count).toBe(2);
  expect(result.current.addedSeries).toHaveLength(2);
  expect(result.current.addedSeries[0]).toMatchObject({
    dashboardId: 'dash-1', panelId: 101, metricName: 'T01', source: 'performance-metrics', yAxisFormat: 'ms', metricsSourceId: 'ms-1',
  });
  expect(result.current.addedSeries[1]).toMatchObject({ dashboardId: 'dash-2', panelId: 5, metricName: 'used', source: 'grafana' });
  // The other series on the same panel (T02) is filtered out of T01's points
  const [rt, heap] = result.current.addedSeries;
  expect(result.current.seriesData.get(rt!.id)).toEqual([point('T01', 280)]);
  expect(result.current.seriesData.get(heap!.id)).toEqual([point('used', 1)]);
  expect(showToast).toHaveBeenCalledWith('Added 2 metric(s) with data');
  expect(result.current.chartDataLoading).toBe(false);
  // The chart name follows the added series
  await waitFor(() => expect(result.current.chartName).not.toBe(''));
});

it('tells the user when every pick was already on the chart, and adds nothing', async () => {
  const { result, showToast } = setup();
  const pick = { dashboard: jvmDashboard, panel: panelOf(jvmDashboard, 5, 'Heap'), metricName: 'used' };

  await act(async () => { await result.current.handleAddSeries([pick], showToast); });
  showToast.mockClear();
  let count = -1;
  await act(async () => { count = await result.current.handleAddSeries([pick], showToast); });

  expect(count).toBe(0);
  expect(result.current.addedSeries).toHaveLength(1);
  expect(showToast).toHaveBeenCalledWith('All selected metrics are already added');
});

it('routes the synthetic "All aggregated" to the aggregate endpoint with its own unit', async () => {
  const { result, showToast } = setup();

  await act(async () => {
    await result.current.handleAddSeries([
      { dashboard: perfDashboard, panel: panelOf(perfDashboard, 105, 'Transaction Error Rate'), metricName: ALL_AGGREGATED_OPTION },
    ], showToast);
  });

  expect(result.current.addedSeries[0]).toMatchObject({
    metricName: 'All aggregated — Transaction Error Rate', yAxisFormat: 'percent',
  });
  expect(fetchAggregatedSeriesData).toHaveBeenCalledWith('run-3', expect.objectContaining({ panelId: 105 }));
  expect(result.current.seriesData.get(result.current.addedSeries[0]!.id)).toHaveLength(1);
});

it('keeps the series, with no points, when its response body is malformed', async () => {
  // fetchSeriesData swallows per-series errors (a null body throws on `.filter`), so the
  // batch itself never rejects and the "failed to load data" toast is unreachable from here.
  (authenticatedFetch as jest.Mock).mockImplementation(async (url: string) => {
    if (url.includes('/application-dashboards')) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => null }; // `.filter` on null throws inside the batch
  });
  const { result, showToast } = setup();

  let count = 0;
  await act(async () => {
    count = await result.current.handleAddSeries([
      { dashboard: jvmDashboard, panel: panelOf(jvmDashboard, 5, 'Heap'), metricName: 'used' },
    ], showToast);
  });

  expect(count).toBe(1);
  expect(result.current.addedSeries).toHaveLength(1);
  expect(result.current.seriesData.get(result.current.addedSeries[0]!.id)).toEqual([]);
  expect(result.current.chartDataLoading).toBe(false);
});

it('answers an empty series when the panel request fails, without dropping the series', async () => {
  (authenticatedFetch as jest.Mock).mockImplementation(async (url: string) => {
    if (url.includes('/application-dashboards')) return { ok: true, json: async () => [] };
    return { ok: false, statusText: 'Internal Server Error' };
  });
  const { result, showToast } = setup();

  await act(async () => {
    await result.current.handleAddSeries([
      { dashboard: jvmDashboard, panel: panelOf(jvmDashboard, 5, 'Heap'), metricName: 'used' },
    ], showToast);
  });

  expect(result.current.addedSeries).toHaveLength(1);
  expect(result.current.seriesData.get(result.current.addedSeries[0]!.id)).toEqual([]);
  expect(showToast).toHaveBeenCalledWith('Added 1 metric(s) with data');
});

/**
 * Clear all. The part worth pinning is that it empties the fetched-points map as well as
 * the series list: leaving the map behind would keep every cleared series' data in memory
 * for the life of the card, and re-adding one would plot the stale points instead of
 * refetching.
 */
describe('handleClearAllSeries', () => {
  it('empties both the series list and the points behind them, and says how many went', async () => {
    routeFetch({ '101': [point('T01', 280), point('T02', 300)], '5': [point('used', 1)] });
    const { result, showToast } = setup();

    await act(async () => {
      await result.current.handleAddSeries([
        { dashboard: perfDashboard, panel: panelOf(perfDashboard, 101, 'Transaction RT Avg', 'ms'), metricName: 'T01' },
        { dashboard: jvmDashboard, panel: panelOf(jvmDashboard, 5, 'Heap', 'bytes'), metricName: 'used' },
      ], showToast);
    });
    await waitFor(() => expect(result.current.addedSeries).toHaveLength(2));
    await waitFor(() => expect(result.current.seriesData.size).toBeGreaterThan(0));

    act(() => { result.current.handleClearAllSeries(showToast); });

    expect(result.current.addedSeries).toEqual([]);
    expect(result.current.seriesData.size).toBe(0);
    expect(showToast).toHaveBeenLastCalledWith('2 series removed');
  });

  // Pins the real behaviour, which is not the behaviour you would want: the auto-naming
  // effect regenerates chartName from addedSeries, so clearing empties it — and a title
  // the user typed is overwritten on any add or remove. See TODOS.md.
  it('resets the auto-generated chart name, since the name is derived from the series', async () => {
    routeFetch({ '5': [point('used', 1)] });
    const { result, showToast } = setup();

    await act(async () => {
      await result.current.handleAddSeries(
        [{ dashboard: jvmDashboard, panel: panelOf(jvmDashboard, 5, 'Heap'), metricName: 'used' }],
        showToast,
      );
    });
    await waitFor(() => expect(result.current.chartName).not.toBe(''));

    act(() => { result.current.handleClearAllSeries(showToast); });

    await waitFor(() => expect(result.current.chartName).toBe(''));
    expect(showToast).toHaveBeenLastCalledWith('Series removed');
  });
});

/**
 * Hide and show. The swatch is a toggle, not a delete, and that distinction is the whole
 * point: `SeriesTable` deliberately keeps hidden rows so a hidden series stays
 * recoverable. A regression that removed the row instead would strand a series the user
 * can neither see nor restore — and it is persisted, so the next load would be missing it
 * with nothing to say so.
 */
describe('handleToggleSeriesVisibility', () => {
  it('flips the flag both ways and leaves the series in the list', async () => {
    routeFetch({ '5': [point('used', 1)] });
    const { result, showToast } = setup();

    await act(async () => {
      await result.current.handleAddSeries([
        { dashboard: jvmDashboard, panel: panelOf(jvmDashboard, 5, 'Heap', 'bytes'), metricName: 'used' },
      ], showToast);
    });
    await waitFor(() => expect(result.current.addedSeries).toHaveLength(1));
    const id = result.current.addedSeries[0]!.id;
    // Not hidden until something hides it — `undefined`, not `false`, is what a newly
    // added series carries, and the preset round trip keeps that distinction.
    expect(result.current.addedSeries[0]!.hidden).toBeFalsy();

    act(() => { result.current.handleToggleSeriesVisibility(id); });
    expect(result.current.addedSeries[0]!.hidden).toBe(true);
    expect(result.current.addedSeries).toHaveLength(1);
    // The points stay fetched: hiding is a chart-side decision, not a reason to refetch.
    expect(result.current.seriesData.has(id)).toBe(true);

    act(() => { result.current.handleToggleSeriesVisibility(id); });
    expect(result.current.addedSeries[0]!.hidden).toBe(false);
    expect(result.current.addedSeries).toHaveLength(1);
  });

  it('touches only the series named, and ignores an id it does not hold', async () => {
    routeFetch({ '5': [point('used', 1)], '101': [point('T01', 280)] });
    const { result, showToast } = setup();

    await act(async () => {
      await result.current.handleAddSeries([
        { dashboard: jvmDashboard, panel: panelOf(jvmDashboard, 5, 'Heap', 'bytes'), metricName: 'used' },
        { dashboard: perfDashboard, panel: panelOf(perfDashboard, 101, 'Transaction RT Avg', 'ms'), metricName: 'T01' },
      ], showToast);
    });
    await waitFor(() => expect(result.current.addedSeries).toHaveLength(2));

    act(() => { result.current.handleToggleSeriesVisibility(result.current.addedSeries[0]!.id); });
    expect(result.current.addedSeries.map((s) => Boolean(s.hidden))).toEqual([true, false]);

    act(() => { result.current.handleToggleSeriesVisibility('not-a-series'); });
    expect(result.current.addedSeries.map((s) => Boolean(s.hidden))).toEqual([true, false]);
  });
});
