/**
 * useGraphsData's zoom-aware refetch. A chart zoom narrows every added series to the
 * dragged window so the API's per-panel downsample budget is spent on it — see
 * `applyZoomRange` in `hooks/useGraphsData.ts`. Three things are worth pinning: the
 * `from`/`to` query params reach the normal fetch path, the synthetic "All aggregated"
 * series (whose endpoint has no window param) is filtered client-side instead, and a reset
 * (`null`) widens every series back without those params.
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
  fetchAggregatedSeriesData: jest.fn().mockResolvedValue([
    { time: '2026-09-14T04:00:00Z', metric_name: 'x', value: 1 },  // before the window
    { time: '2026-09-14T05:00:00Z', metric_name: 'x', value: 2 },  // inside
    { time: '2026-09-14T06:00:00Z', metric_name: 'x', value: 3 },  // after
  ]),
}));

import { authenticatedFetch } from '@/lib/api';
import { fetchAggregatedSeriesData } from '@/app/test-runs/[id]/components/graphs/utils/aggregated-series';

const testRun = {
  test_run_id: 'run-3', system_under_test_id: 'sut-1', test_environment: 'acc', workload: 'load',
} as never;

const jvmDashboard: ApplicationDashboard = {
  id: 'dash-2', dashboard_label: 'JVM', dashboard_name: 'JVM',
  dashboard_uid: 'jvm-uid', source_type: 'grafana', metrics_source_id: 'ms-2',
};
const perfDashboard: ApplicationDashboard = {
  id: 'dash-1', dashboard_label: 'Perf', dashboard_name: 'Perf',
  dashboard_uid: 'perf-uid', source_type: 'performance_test', metrics_source_id: 'ms-1',
};

const panelOf = (dashboard: ApplicationDashboard, id: number, title: string): PanelOption => ({
  id, title, type: 'timeseries',
  applicationDashboardId: dashboard.id, metricsSourceId: dashboard.metrics_source_id,
  dashboard, dashboardLabel: dashboard.dashboard_label,
  source: dashboard.source_type === 'performance_test' ? 'performance-metrics' : 'grafana',
});

const point = (metric_name: string, value: number) => ({ time: '2026-09-14T05:00:00Z', metric_name, value });
const ZOOM = { from: '2026-09-14T04:30:00.000Z', to: '2026-09-14T05:30:00.000Z' };

function routeFetch(pointsByPanel: Record<string, unknown[]>, capturedUrls: string[]) {
  (authenticatedFetch as jest.Mock).mockImplementation(async (url: string) => {
    capturedUrls.push(url);
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
});

it('refetches every added series with from/to query params on a zoom', async () => {
  const urls: string[] = [];
  routeFetch({ '5': [point('used', 1)] }, urls);
  const { result, showToast } = setup();

  await act(async () => {
    await result.current.handleAddSeries(
      [{ dashboard: jvmDashboard, panel: panelOf(jvmDashboard, 5, 'Heap'), metricName: 'used' }],
      showToast,
    );
  });
  urls.length = 0; // only care about the refetch triggered by the zoom

  await act(async () => { await result.current.applyZoomRange(ZOOM); });

  expect(result.current.zoomRange).toEqual(ZOOM);
  const refetchUrl = urls.find((u) => u.includes('/ds-metrics/'));
  expect(refetchUrl).toBeDefined();
  expect(refetchUrl).toContain(`from=${encodeURIComponent(ZOOM.from)}`);
  expect(refetchUrl).toContain(`to=${encodeURIComponent(ZOOM.to)}`);
  expect(result.current.chartDataLoading).toBe(false);
});

it('filters the synthetic "All aggregated" series to the zoom window client-side, since its endpoint takes no range', async () => {
  const urls: string[] = [];
  routeFetch({}, urls);
  const { result, showToast } = setup();

  await act(async () => {
    await result.current.handleAddSeries([
      { dashboard: perfDashboard, panel: panelOf(perfDashboard, 105, 'Transaction Error Rate'), metricName: ALL_AGGREGATED_OPTION },
    ], showToast);
  });
  const seriesId = result.current.addedSeries[0]!.id;

  await act(async () => { await result.current.applyZoomRange(ZOOM); });

  // fetchAggregatedSeriesData itself takes no range — the endpoint is called the same way
  // either way — but the hook narrows the three stub points down to the one inside [04:30, 05:30].
  expect(fetchAggregatedSeriesData).toHaveBeenCalled();
  expect(result.current.seriesData.get(seriesId)).toEqual([
    { time: '2026-09-14T05:00:00Z', metric_name: 'x', value: 2 },
  ]);
});

it('widens back to the whole run on a reset, with no from/to on the refetch', async () => {
  const urls: string[] = [];
  routeFetch({ '5': [point('used', 1)] }, urls);
  const { result, showToast } = setup();

  await act(async () => {
    await result.current.handleAddSeries(
      [{ dashboard: jvmDashboard, panel: panelOf(jvmDashboard, 5, 'Heap'), metricName: 'used' }],
      showToast,
    );
  });
  await act(async () => { await result.current.applyZoomRange(ZOOM); });
  expect(result.current.zoomRange).toEqual(ZOOM);
  urls.length = 0;

  await act(async () => { await result.current.applyZoomRange(null); });

  expect(result.current.zoomRange).toBeNull();
  const refetchUrl = urls.find((u) => u.includes('/ds-metrics/'));
  expect(refetchUrl).toBeDefined();
  expect(refetchUrl).not.toContain('from=');
  expect(refetchUrl).not.toContain('to=');
});

it('records the zoom window but fetches nothing when no series are on the chart yet', async () => {
  const urls: string[] = [];
  routeFetch({}, urls);
  const { result } = setup();

  await act(async () => { await result.current.applyZoomRange(ZOOM); });

  expect(result.current.zoomRange).toEqual(ZOOM);
  expect(urls.some((u) => u.includes('/ds-metrics/'))).toBe(false);
  expect(result.current.chartDataLoading).toBe(false);
});

it('scopes a series added while already zoomed to the current window, with no explicit override', async () => {
  const urls: string[] = [];
  routeFetch({ '5': [point('used', 1)] }, urls);
  const { result, showToast } = setup();

  // Zoom first, with nothing on the chart yet (no refetch to wait on).
  await act(async () => { await result.current.applyZoomRange(ZOOM); });
  urls.length = 0;

  await act(async () => {
    await result.current.handleAddSeries(
      [{ dashboard: jvmDashboard, panel: panelOf(jvmDashboard, 5, 'Heap'), metricName: 'used' }],
      showToast,
    );
  });

  const addUrl = urls.find((u) => u.includes('/ds-metrics/'));
  expect(addUrl).toContain(`from=${encodeURIComponent(ZOOM.from)}`);
  expect(addUrl).toContain(`to=${encodeURIComponent(ZOOM.to)}`);
});

it('clears chartDataLoading even when the refetch batch itself throws', async () => {
  const { result, showToast } = setup();
  (authenticatedFetch as jest.Mock).mockImplementation(async (url: string) => {
    if (url.includes('/application-dashboards')) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => [point('used', 1)] };
  });

  await act(async () => {
    await result.current.handleAddSeries(
      [{ dashboard: jvmDashboard, panel: panelOf(jvmDashboard, 5, 'Heap'), metricName: 'used' }],
      showToast,
    );
  });

  // Make the zoom's own refetch reject for every series.
  (authenticatedFetch as jest.Mock).mockImplementation(async (url: string) => {
    if (url.includes('/application-dashboards')) return { ok: true, json: async () => [] };
    throw new Error('network down');
  });

  await act(async () => { await result.current.applyZoomRange(ZOOM); });

  expect(result.current.chartDataLoading).toBe(false);
  // fetchSeriesData itself swallows the per-series error, so the series survives with
  // whatever the (rejected) fetch produced — an empty array, not a removed series.
  expect(result.current.addedSeries).toHaveLength(1);
});

it('asks the panel endpoint ONCE for every series sharing a panel, on an add and on a zoom', async () => {
  // The endpoint answers with the whole panel whatever is asked for, so a per-series
  // fan-out fetches the same payload once per line — hundreds of requests on a perf-test
  // panel, repeated on every drag. Both call sites go through `fetchSeriesBatch`.
  const urls: string[] = [];
  routeFetch({ '5': [point('used', 1), point('committed', 2), point('max', 3)] }, urls);
  const { result, showToast } = setup();

  const heap = panelOf(jvmDashboard, 5, 'Heap');
  await act(async () => {
    await result.current.handleAddSeries(
      [
        { dashboard: jvmDashboard, panel: heap, metricName: 'used' },
        { dashboard: jvmDashboard, panel: heap, metricName: 'committed' },
        { dashboard: jvmDashboard, panel: heap, metricName: 'max' },
      ],
      showToast,
    );
  });

  expect(urls.filter((u) => u.includes('/ds-metrics/'))).toHaveLength(1);
  // Each series still gets only its own metric out of the shared answer.
  const ids = result.current.addedSeries.map((s) => s.id);
  expect(result.current.seriesData.get(ids[0]!)).toEqual([point('used', 1)]);
  expect(result.current.seriesData.get(ids[2]!)).toEqual([point('max', 3)]);

  urls.length = 0;
  await act(async () => { await result.current.applyZoomRange(ZOOM); });
  expect(urls.filter((u) => u.includes('/ds-metrics/'))).toHaveLength(1);
});

it('keeps two panels apart, and a metrics source apart within one panel id', async () => {
  const urls: string[] = [];
  routeFetch({ '5': [point('used', 1)], '6': [point('threads', 9)] }, urls);
  const { result, showToast } = setup();

  await act(async () => {
    await result.current.handleAddSeries(
      [
        { dashboard: jvmDashboard, panel: panelOf(jvmDashboard, 5, 'Heap'), metricName: 'used' },
        { dashboard: jvmDashboard, panel: panelOf(jvmDashboard, 6, 'Threads'), metricName: 'threads' },
        // Same panel id on a different dashboard and source: a different request.
        { dashboard: perfDashboard, panel: panelOf(perfDashboard, 5, 'Heap'), metricName: 'used' },
      ],
      showToast,
    );
  });

  expect(urls.filter((u) => u.includes('/ds-metrics/'))).toHaveLength(3);
});
