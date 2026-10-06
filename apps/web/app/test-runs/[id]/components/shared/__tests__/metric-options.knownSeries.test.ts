/**
 * `/ds-metrics/available/:run` has always returned `metric_names` per panel and the cascade
 * used to discard it, then ask `/ds-metrics/distinct-names` for the same names once per
 * panel — 625 requests on one production run (62 dashboards), three database round trips
 * each. These pin the three things that have to hold for the panel list to answer instead:
 * the names arrive, no request is made, and a panel the rows do not mention still asks.
 */
import type { ApplicationDashboard } from '../metric-options';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('@/lib/dynatrace', () => ({ fetchDynatraceMetrics: jest.fn().mockResolvedValue([]) }));
jest.mock('@/lib/grafana-dashboards', () => ({
  fetchGrafanaDashboardByUid: jest.fn().mockResolvedValue({
    panels: [{ id: 40, title: 'Heap', type: 'timeseries' }, { id: 41, title: 'GC', type: 'timeseries' }],
  }),
}));

import { authenticatedFetch } from '@/lib/api';
import { fetchGrafanaDashboardByUid } from '@/lib/grafana-dashboards';
import { fetchPanelsForDashboards, fetchSeriesForPanel } from '../metric-options';

const testRun = {
  test_run_id: 'run-1', system_under_test_id: 'sut-1', test_environment: 'acc', workload: 'load',
  systems_under_test: { name: 'sut' },
} as never;

const perfDashboard: ApplicationDashboard = {
  id: 'dash-1', dashboard_label: 'Perf', dashboard_name: 'Perf',
  dashboard_uid: 'perf-uid', source_type: 'performance_test', metrics_source_id: 'ms-1',
};
const grafanaDashboard: ApplicationDashboard = {
  id: 'dash-2', dashboard_label: 'JVM', dashboard_name: 'JVM', dashboard_uid: 'jvm-uid', source_type: 'grafana',
};

/** One panel split over two rows by `unit`, as ds_metrics can produce. */
const availableRows = [
  { dashboard_label: 'Perf', panel_title: 'Transaction RT Avg', panel_id: 101, unit: 'ms',
    metric_names: ['T01_Login', 'T02_Browse'] },
  { dashboard_label: 'Perf', panel_title: 'Transaction RT Avg', panel_id: 101, unit: 's',
    metric_names: ['T02_Browse', 'T03_Checkout'] },
  { dashboard_label: 'JVM', panel_title: 'Heap', panel_id: 40, unit: 'bytes',
    metric_names: ['heap.used', 'heap.max'] },
];

const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

const available = () =>
  ({ ok: true, json: async () => availableRows }) as unknown as Response;

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/ds-metrics/available/')) return available();
    return { ok: true, json: async () => ['from-the-network'] } as unknown as Response;
  });
});

it('unions the names of a panel split across rows, and asks for nothing', async () => {
  const [perfPanels] = await fetchPanelsForDashboards([perfDashboard], testRun, { includeUrlPanels: false });
  const rtPanel = perfPanels!.find((p) => p.id === 101)!;
  expect(rtPanel.metricNames).toEqual(['T01_Login', 'T02_Browse', 'T03_Checkout']);

  mockFetch.mockClear();
  const series = await fetchSeriesForPanel(rtPanel, testRun);
  expect(mockFetch).not.toHaveBeenCalled();
  // 101 is aggregatable, so the synthetic run-wide option leads the real series.
  expect(series.map((s) => s.metricName)).toEqual([
    'All aggregated', 'T01_Login', 'T02_Browse', 'T03_Checkout',
  ]);
});

it('serves a Grafana panel from the same rows, when a perf-test dashboard paid for them', async () => {
  // The rows are fetched because the batch contains a perf-test dashboard; every other
  // source in that batch reads its series out of them for free.
  const [, jvmPanels] = await fetchPanelsForDashboards([perfDashboard, grafanaDashboard], testRun);
  const heap = jvmPanels!.find((p) => p.id === 40)!;

  mockFetch.mockClear();
  expect((await fetchSeriesForPanel(heap, testRun)).map((s) => s.metricName))
    .toEqual(['heap.used', 'heap.max']);
  expect(mockFetch).not.toHaveBeenCalled();
});

it('still asks for a panel the rows do not mention', async () => {
  const [, jvmPanels] = await fetchPanelsForDashboards([perfDashboard, grafanaDashboard], testRun);
  const gc = jvmPanels!.find((p) => p.id === 41)!;
  expect(gc.metricNames).toBeUndefined();

  mockFetch.mockClear();
  expect((await fetchSeriesForPanel(gc, testRun)).map((s) => s.metricName)).toEqual(['from-the-network']);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(mockFetch.mock.calls[0]![0]).toContain('/ds-metrics/distinct-names');
});

it('falls back to a request per panel when the run-wide fetch fails', async () => {
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/ds-metrics/available/')) throw new Error('boom');
    return { ok: true, json: async () => ['from-the-network'] } as unknown as Response;
  });

  const [, jvmPanels] = await fetchPanelsForDashboards([perfDashboard, grafanaDashboard], testRun);
  const heap = jvmPanels!.find((p) => p.id === 40)!;
  expect(heap.metricNames).toBeUndefined();
  expect((await fetchSeriesForPanel(heap, testRun)).map((s) => s.metricName)).toEqual(['from-the-network']);
});

it('takes the URL path for a URL panel even when the run-wide rows name it', async () => {
  // `isUrlPanel` is tested BEFORE the known-series short-circuit, and has to stay there:
  // a URL panel's series are the run's normalized URLs, which no ds_metrics row carries.
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/ds-metrics/available/')) {
      return { ok: true, json: async () => [
        { dashboard_label: 'Perf', panel_title: 'URL RT', panel_id: 210, metric_names: ['not-a-url'] },
      ] } as unknown as Response;
    }
    return { ok: true, json: async () => ['/api/user/{id}'] } as unknown as Response;
  });

  const [perfPanels] = await fetchPanelsForDashboards([perfDashboard], testRun);
  const urlPanel = perfPanels!.find((p) => p.id === 210)!;
  expect(urlPanel.metricNames).toEqual(['not-a-url']);   // attached, and deliberately unused

  mockFetch.mockClear();
  expect((await fetchSeriesForPanel(urlPanel, testRun)).map((s) => s.metricName)).toEqual(['/api/user/{id}']);
  expect(mockFetch.mock.calls[0]![0]).toContain('/url-distinct-names');
});

it('still asks when a row carries no metric_names at all — an API older than this client', async () => {
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/ds-metrics/available/')) {
      return { ok: true, json: async () => [
        { dashboard_label: 'Perf', panel_title: 'Transaction RT Avg', panel_id: 101, metric_names: ['T01_Login'] },
        { dashboard_label: 'JVM', panel_title: 'Heap', panel_id: 40, unit: 'bytes' },
      ] } as unknown as Response;
    }
    return { ok: true, json: async () => ['from-the-network'] } as unknown as Response;
  });

  const [, jvmPanels] = await fetchPanelsForDashboards([perfDashboard, grafanaDashboard], testRun);
  const heap = jvmPanels!.find((p) => p.id === 40)!;
  expect(heap.metricNames).toBeUndefined();
  expect((await fetchSeriesForPanel(heap, testRun)).map((s) => s.metricName)).toEqual(['from-the-network']);
});

it('still asks when a row carries an empty metric_names, rather than answering with no series', async () => {
  // `[]` is truthy, so an empty array reaching `panel.metricNames` would short-circuit to
  // an empty dropdown with no request and nothing logged. The map builder is what stops it.
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/ds-metrics/available/')) {
      return { ok: true, json: async () => [
        { dashboard_label: 'Perf', panel_title: 'Transaction RT Avg', panel_id: 101, metric_names: ['T01_Login'] },
        { dashboard_label: 'JVM', panel_title: 'Heap', panel_id: 40, metric_names: [] },
      ] } as unknown as Response;
    }
    return { ok: true, json: async () => ['from-the-network'] } as unknown as Response;
  });

  const [, jvmPanels] = await fetchPanelsForDashboards([perfDashboard, grafanaDashboard], testRun);
  const heap = jvmPanels!.find((p) => p.id === 40)!;
  expect(heap.metricNames).toBeUndefined();
  expect((await fetchSeriesForPanel(heap, testRun)).map((s) => s.metricName)).toEqual(['from-the-network']);
});

it('does not offer the synthetic aggregate twice on the all-aggregated dashboard', async () => {
  // On `Performance test metrics all aggregated` the exact name is a REAL stored series,
  // so `shouldOfferAllAggregated` must see the names it is guarding against — which it
  // only does if the known-series branch passes them through the same helper.
  const allAgg: ApplicationDashboard = {
    id: 'dash-3', dashboard_label: 'Performance test metrics all aggregated',
    dashboard_name: 'All aggregated', dashboard_uid: 'performance-test-metrics-all-aggregated',
    source_type: 'performance_test',
  };
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/ds-metrics/available/')) {
      return { ok: true, json: async () => [
        { dashboard_label: allAgg.dashboard_label, panel_title: 'Transaction RT Avg', panel_id: 101,
          metric_names: ['All aggregated'] },
      ] } as unknown as Response;
    }
    return { ok: true, json: async () => [] } as unknown as Response;
  });

  const [panels] = await fetchPanelsForDashboards([allAgg], testRun, { includeUrlPanels: false });
  const rt = panels!.find((p) => p.id === 101)!;

  expect((await fetchSeriesForPanel(rt, testRun)).map((s) => s.metricName)).toEqual(['All aggregated']);
});

it('offers no synthetic aggregate for a perf panel that has no run-wide aggregate', async () => {
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/ds-metrics/available/')) {
      return { ok: true, json: async () => [
        { dashboard_label: 'Perf', panel_title: 'Error Count', panel_id: 301, metric_names: ['Scenario A'] },
      ] } as unknown as Response;
    }
    return { ok: true, json: async () => [] } as unknown as Response;
  });

  const [panels] = await fetchPanelsForDashboards([perfDashboard], testRun, { includeUrlPanels: false });
  const errorCount = panels!.find((p) => p.id === 301)!;

  expect((await fetchSeriesForPanel(errorCount, testRun)).map((s) => s.metricName)).toEqual(['Scenario A']);
});

it('offers no synthetic aggregate for a Grafana panel whose id happens to be aggregatable', async () => {
  // Panel ids are not disjoint across sources: 101 is Transaction RT Avg on a perf-test
  // dashboard and an arbitrary panel on a Grafana one. The source guard carries the weight.
  (fetchGrafanaDashboardByUid as jest.Mock).mockResolvedValueOnce({
    panels: [{ id: 101, title: 'Requests', type: 'timeseries' }],
  });
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/ds-metrics/available/')) {
      return { ok: true, json: async () => [
        { dashboard_label: 'JVM', panel_title: 'Requests', panel_id: 101, metric_names: ['rps'] },
      ] } as unknown as Response;
    }
    return { ok: true, json: async () => [] } as unknown as Response;
  });

  const [, panels] = await fetchPanelsForDashboards([perfDashboard, grafanaDashboard], testRun);
  const requests = panels!.find((p) => p.id === 101)!;

  expect((await fetchSeriesForPanel(requests, testRun)).map((s) => s.metricName)).toEqual(['rps']);
});

it('asks for no run-wide rows at all for a Grafana-only batch', async () => {
  // Widening the trigger to every selection reads as "one call replaces N" and is a net
  // loss: the series step is lazy, so /distinct-names only ever fires for panels the user
  // ticks. At 895 ms for this call against ~10 ms for a scoped one, breakeven is ~90 ticked
  // panels, and the effect re-runs on every dashboard toggle with nothing cached.
  const [jvmPanels] = await fetchPanelsForDashboards([grafanaDashboard], testRun);

  const runWide = mockFetch.mock.calls.filter((c) => String(c[0]).includes('/ds-metrics/available/'));
  expect(runWide).toHaveLength(0);
  expect(jvmPanels!.find((p) => p.id === 40)!.metricNames).toBeUndefined();
});

it('declines the map for a label two selected dashboards share, rather than merging them', async () => {
  // `uq_application_dashboards_unique` includes grafana_instance_id, so one label can belong
  // to two application dashboards — same uid, same panel ids, different instance. Merging
  // their series offers one instance's names on the other's panel and the chart draws
  // nothing. 20 of 152 uids are duplicated across instances on the dev database.
  const twin: ApplicationDashboard = { ...grafanaDashboard, id: 'dash-2b', grafana_instance_id: 'gi-2' };

  const [, jvm, jvmTwin] = await fetchPanelsForDashboards([perfDashboard, grafanaDashboard, twin], testRun);
  expect(jvm!.find((p) => p.id === 40)!.metricNames).toBeUndefined();
  expect(jvmTwin!.find((p) => p.id === 40)!.metricNames).toBeUndefined();

  // The unambiguous perf-test dashboard in the same batch is unaffected.
  const [perf] = await fetchPanelsForDashboards([perfDashboard, grafanaDashboard, twin], testRun, {
    includeUrlPanels: false,
  });
  expect(perf!.find((p) => p.id === 101)!.metricNames).toEqual(['T01_Login', 'T02_Browse', 'T03_Checkout']);

  // And the ambiguous panel still answers, by asking per panel as it did before.
  mockFetch.mockClear();
  expect((await fetchSeriesForPanel(jvm!.find((p) => p.id === 40)!, testRun)).map((s) => s.metricName))
    .toEqual(['from-the-network']);
  expect(mockFetch.mock.calls[0]![0]).toContain('/ds-metrics/distinct-names');
});

it('declines it for a twin that is NOT selected, judged over the whole dashboard list', async () => {
  // The quiet half of the same bug, and the one a selection-scoped guard misses. The server
  // merges the two dashboards' series in its `GROUP BY dashboard_label, ...` before anything
  // reaches the client, so selecting only ONE twin still yields a row carrying both their
  // names — the selection looks unambiguous while the data is not.
  const twin: ApplicationDashboard = { ...grafanaDashboard, id: 'dash-2b', grafana_instance_id: 'gi-2' };

  const [, jvm] = await fetchPanelsForDashboards(
    [perfDashboard, grafanaDashboard],   // only one twin picked
    testRun,
    undefined,
    [perfDashboard, grafanaDashboard, twin],   // but both exist on the system
  );
  expect(jvm!.find((p) => p.id === 40)!.metricNames).toBeUndefined();
});

it('asks for nothing at all when the selection is empty', async () => {
  expect(await fetchPanelsForDashboards([], testRun)).toEqual([]);
  expect(mockFetch).not.toHaveBeenCalled();
});
