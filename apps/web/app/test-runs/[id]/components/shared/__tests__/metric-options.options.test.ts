/**
 * What the shared cascade loaders added when Trends and Graphs moved onto them:
 * - `PanelListOptions` lets a card decline the compare-only extras (URL panels, collapsed
 *   RT percentiles) — Trends and Graphs plot every percentile panel on its own
 * - every panel carries a y-axis unit: a perf-test panel from its row or the known panel
 *   table, a Dynatrace panel from the query's unit, a Grafana panel from its JSON
 */
import type { ApplicationDashboard, PanelOption } from '../metric-options';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('@/lib/dynatrace', () => ({
  fetchDynatraceMetrics: jest.fn().mockResolvedValue([
    { panelId: 7, panelTitle: 'Host CPU', applicationDashboardId: 'dt-dash-1', metricUnit: 'percent' },
  ]),
}));

import { authenticatedFetch } from '@/lib/api';
import {
  PERFORMANCE_METRICS_PANEL_UNITS,
  extractYAxisFormat,
  fetchPanelsForDashboard,
  fetchPanelsForDashboards,
  fetchSeriesForPanel,
} from '../metric-options';

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

const perfRows = [
  { dashboard_label: 'Perf', panel_title: 'Request RT Avg', panel_id: 201 },
  { dashboard_label: 'Perf', panel_title: 'Request RT P90', panel_id: 202 },
  { dashboard_label: 'Perf', panel_title: 'Request Error Rate', panel_id: 205, unit: 'percentunit' },
];

beforeEach(() => jest.clearAllMocks());

it('keeps every RT percentile panel and adds no URL panels when a card asks for neither', async () => {
  (authenticatedFetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => perfRows });

  const panels = await fetchPanelsForDashboard(perfDashboard, testRun, { collapseRtPanels: false, includeUrlPanels: false });

  expect(panels.map((p) => p.id)).toEqual([201, 202, 205]);
});

it('threads the options through the bounded multi-dashboard loader', async () => {
  (authenticatedFetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => perfRows });

  const [panels] = await fetchPanelsForDashboards([perfDashboard], testRun, { collapseRtPanels: false, includeUrlPanels: false });

  expect(panels!.map((p) => p.id)).toEqual([201, 202, 205]);
});

it('retries the perf-test rows per dashboard when the shared prefetch fails', async () => {
  // A non-OK prefetch used to resolve to [] and every perf-test dashboard came back empty.
  (authenticatedFetch as jest.Mock)
    .mockResolvedValueOnce({ ok: false, status: 503 })
    .mockResolvedValue({ ok: true, json: async () => perfRows });

  const [panels] = await fetchPanelsForDashboards([perfDashboard], testRun, { collapseRtPanels: false, includeUrlPanels: false });

  expect(panels!.map((p) => p.id)).toEqual([201, 202, 205]);
});

it('can decline only one of the extras', async () => {
  (authenticatedFetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => perfRows });

  const noUrls = await fetchPanelsForDashboard(perfDashboard, testRun, { includeUrlPanels: false });
  expect(noUrls.some((p) => p.id === 210)).toBe(false);   // no URL panel
  expect(noUrls.some((p) => p.id === 202)).toBe(false);   // still collapsed

  const noCollapse = await fetchPanelsForDashboard(perfDashboard, testRun, { collapseRtPanels: false });
  expect(noCollapse.some((p) => p.id === 210)).toBe(true);
  expect(noCollapse.some((p) => p.id === 202)).toBe(true);
});

it('gives a perf-test panel the unit its row carries, else the known unit for its id', async () => {
  (authenticatedFetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => perfRows });

  const panels = await fetchPanelsForDashboard(perfDashboard, testRun, { collapseRtPanels: false, includeUrlPanels: false });
  const unitOf = (id: number) => panels.find((p) => p.id === id)!.yAxesFormat;

  expect(unitOf(205)).toBe('percentunit');                       // row wins
  expect(unitOf(201)).toBe(PERFORMANCE_METRICS_PANEL_UNITS[201]); // 'ms' from the table
  expect(unitOf(201)).toBe('ms');
});

it('gives a Dynatrace panel the unit of its query', async () => {
  const dt: ApplicationDashboard = { id: 'dt', dashboard_label: 'Hosts', dashboard_name: 'Hosts', dashboard_uid: '', source_type: 'dynatrace' };

  const panels = await fetchPanelsForDashboard(dt, testRun);

  expect(panels[0]).toMatchObject({ id: 7, yAxesFormat: 'percent', source: 'dynatrace' });
});

it('gives a Grafana panel the unit from its panel JSON, and leaves unsupported panel types out', async () => {
  (authenticatedFetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => [{
      panels: [
        { id: 1, title: 'Heap', type: 'timeseries', fieldConfig: { defaults: { unit: 'bytes' } } },
        { id: 2, title: 'Old', type: 'graph', yaxes: [{ format: 'ms' }] },
        { id: 3, title: 'Text', type: 'text' },
        { id: 4, title: 'Preset', type: 'stat', yAxesFormat: 'reqps', fieldConfig: { defaults: { unit: 'short' } } },
      ],
    }],
  });

  const panels = await fetchPanelsForDashboard(grafanaDashboard, testRun);

  expect(panels.map((p) => [p.id, p.yAxesFormat])).toEqual([[1, 'bytes'], [2, 'ms'], [4, 'reqps']]);
});

it('returns no panels for a Grafana dashboard without a uid, or a Dynatrace one on a run without a workload', async () => {
  expect(await fetchPanelsForDashboard({ ...grafanaDashboard, dashboard_uid: '' }, testRun)).toEqual([]);
  expect(authenticatedFetch).not.toHaveBeenCalled();

  const dt: ApplicationDashboard = { id: 'dt', dashboard_label: 'Hosts', dashboard_name: 'Hosts', dashboard_uid: '', source_type: 'dynatrace' };
  expect(await fetchPanelsForDashboard(dt, { ...(testRun as object), workload: '' } as never)).toEqual([]);
  // A perf-test dashboard needs the run to know what it recorded
  expect(await fetchPanelsForDashboard(perfDashboard, null)).toEqual([]);
});

it('answers no series without a run, and none when the series request rejects', async () => {
  const panel = {
    id: 201, title: 'Request RT', type: 'timeseries', applicationDashboardId: 'dash-1',
    dashboard: perfDashboard, dashboardLabel: 'Perf', source: 'performance-metrics',
  } as PanelOption;

  expect(await fetchSeriesForPanel(panel, null)).toEqual([]);

  (authenticatedFetch as jest.Mock).mockRejectedValue(new Error('network'));
  expect(await fetchSeriesForPanel(panel, testRun)).toEqual([]);
});

describe('extractYAxisFormat', () => {
  it('reads the axis format of an old graph panel and fieldConfig of everything else', () => {
    expect(extractYAxisFormat({ type: 'graph', yaxes: [{ format: 'ms' }] })).toBe('ms');
    expect(extractYAxisFormat({ type: 'timeseries', fieldConfig: { defaults: { unit: 'bytes' } } })).toBe('bytes');
    expect(extractYAxisFormat({ type: 'stat', fieldConfig: { defaults: { unit: 'percent' } } })).toBe('percent');
    // A graph panel migrated to fieldConfig without axes still yields its unit
    expect(extractYAxisFormat({ type: 'graph', fieldConfig: { defaults: { unit: 'short' } } })).toBe('short');
  });

  it('yields undefined when no unit is declared anywhere', () => {
    expect(extractYAxisFormat({ type: 'timeseries' })).toBeUndefined();
    expect(extractYAxisFormat({ type: 'graph', yaxes: [{}] })).toBeUndefined();
    expect(extractYAxisFormat({ type: 'timeseries', fieldConfig: { defaults: { unit: '' } } })).toBeUndefined();
  });
});
