/**
 * Tests for the compare card's panel/series option loaders.
 *
 * Covers what the single-selection handlers used to guarantee, now that the cascade
 * asks for several dashboards at once:
 * - a performance-metrics dashboard gets the virtual URL panels, collapsed RT panels
 * - a Grafana dashboard does not
 * - a URL panel's series come from the run's normalized URLs, not ds_metric_statistics
 * - every option carries the dashboard it came from, so a mixed selection stays addressable
 */

import { ApplicationDashboard } from '../../types';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('@/lib/dynatrace', () => ({
  fetchDynatraceMetrics: jest.fn().mockResolvedValue([
    { panelId: 7, panelTitle: 'Host CPU', applicationDashboardId: 'dt-dash-1' },
  ]),
}));
jest.mock('@/lib/url-perf-panels', () => ({
  ...jest.requireActual('@/lib/url-perf-panels'),
  fetchUrlDistinctNames: jest.fn().mockResolvedValue(['/api/user/{id}']),
}));

import { authenticatedFetch } from '@/lib/api';
import { fetchDynatraceMetrics } from '@/lib/dynatrace';
import { fetchUrlDistinctNames } from '@/lib/url-perf-panels';
import {
  OPTION_FETCH_CONCURRENCY,
  fetchPanelsForDashboard,
  fetchPanelsForDashboards,
  fetchSeriesForPanel,
  PanelOption,
} from '../metric-options';

const testRun = {
  test_run_id: 'run-1',
  system_under_test_id: 'sut-1',
  test_environment: 'acc',
  workload: 'load',
  systems_under_test: { name: 'sut' },
} as never;

const perfDashboard: ApplicationDashboard = {
  id: 'dash-1', dashboard_label: 'Perf', dashboard_name: 'Perf',
  dashboard_uid: 'perf-uid', source_type: 'performance_test',
};

const grafanaDashboard: ApplicationDashboard = {
  id: 'dash-2', dashboard_label: 'JVM', dashboard_name: 'JVM',
  dashboard_uid: 'jvm-uid', source_type: 'grafana',
};

beforeEach(() => jest.clearAllMocks());

it('gives a performance-metrics dashboard its URL panels and collapses the RT percentiles', async () => {
  (authenticatedFetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => [
      { dashboard_label: 'Perf', panel_title: 'Request RT Avg', panel_id: 201 },
      { dashboard_label: 'Perf', panel_title: 'Request RT P90', panel_id: 202 },
      { dashboard_label: 'Other', panel_title: 'Elsewhere', panel_id: 301 },
    ],
  });

  const panels = await fetchPanelsForDashboard(perfDashboard, testRun);

  expect(panels.some((p) => p.id === 210)).toBe(true);   // URL panel injected
  expect(panels.some((p) => p.id === 201)).toBe(true);   // Avg kept as "Request RT"
  expect(panels.some((p) => p.id === 202)).toBe(false);  // P90 collapsed away
  expect(panels.some((p) => p.id === 301)).toBe(false);  // another dashboard's panel
  // Every option knows where it came from — a selection can span dashboards.
  expect(panels.every((p) => p.dashboard.id === 'dash-1' && p.source === 'performance-metrics')).toBe(true);
});

it('does NOT give a Grafana dashboard URL panels', async () => {
  (authenticatedFetch as jest.Mock).mockResolvedValue({
    ok: true, json: async () => [{ panels: [{ id: 5, title: 'CPU', type: 'timeseries' }] }],
  });

  const panels = await fetchPanelsForDashboard(grafanaDashboard, testRun);

  expect(panels.map((p) => p.id)).toEqual([5]);
  expect(panels[0]!.source).toBe('grafana');
  expect(panels[0]!.applicationDashboardId).toBe('dash-2');
});

it('reads a URL panel series list from the run URLs instead of the statistics', async () => {
  const panel = {
    id: 210, title: 'URL RT', type: 'timeseries', applicationDashboardId: 'dash-1',
    dashboard: perfDashboard, dashboardLabel: 'Perf', source: 'performance-metrics',
  } as PanelOption;

  const series = await fetchSeriesForPanel(panel, testRun);

  expect(fetchUrlDistinctNames).toHaveBeenCalledWith('run-1');
  expect(authenticatedFetch).not.toHaveBeenCalled();
  expect(series.map((s) => s.metricName)).toEqual(['/api/user/{id}']);
  expect(series[0]!.panel.id).toBe(210);
});

it('treats every per-request panel as URL-bearing, not just response time', () => {
  // 205-209 (error rate, throughput, apdex, latency, connect time) name their series
  // `transaction.sampler` exactly like 201-204, so they carry a URL too.
  const { isRequestPanel } = jest.requireActual('@/lib/url-perf-panels');
  expect([201, 204, 205, 206, 207, 208, 209].every(isRequestPanel)).toBe(true);
  expect([101, 104, 107, 210, 218, undefined].some(isRequestPanel)).toBe(false);
});

it('asks only for the series this run recorded', async () => {
  // The panel's series list used to span every run the dashboard ever had, so runs with
  // older naming put names in the picker that no comparison could match — rows with no
  // values and no URL.
  (authenticatedFetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ['T01.login'] });
  const panel = {
    id: 201, title: 'Request RT', type: 'timeseries', applicationDashboardId: 'dash-1',
    metricsSourceId: 'ms-1', dashboard: perfDashboard, dashboardLabel: 'Perf',
    source: 'performance-metrics',
  } as PanelOption;

  await fetchSeriesForPanel(panel, testRun);

  const url = (authenticatedFetch as jest.Mock).mock.calls[0]![0] as string;
  expect(url).toContain('testRunId=run-1');
  expect(url).toContain('panelId=201');
});

it('reads a Dynatrace dashboard through the Dynatrace metrics API, not ds-metrics', async () => {
  const dtDashboard: ApplicationDashboard = {
    id: 'dash-3', dashboard_label: 'Hosts', dashboard_name: 'Hosts',
    dashboard_uid: '', source_type: 'dynatrace',
  };

  const panels = await fetchPanelsForDashboard(dtDashboard, testRun);

  expect(fetchDynatraceMetrics).toHaveBeenCalledWith('sut-1', 'acc', 'load', 'Hosts');
  expect(authenticatedFetch).not.toHaveBeenCalled();
  expect(panels).toEqual([expect.objectContaining({
    id: 7, title: 'Host CPU', source: 'dynatrace', applicationDashboardId: 'dt-dash-1',
  })]);
});

it('returns no panels when the dashboard fetch fails, instead of throwing', async () => {
  // A dashboard that 500s must not take the whole picker down with it.
  (authenticatedFetch as jest.Mock).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

  expect(await fetchPanelsForDashboard(grafanaDashboard, testRun)).toEqual([]);
  expect(await fetchSeriesForPanel({
    id: 5, title: 'CPU', type: 'timeseries', applicationDashboardId: 'dash-2',
    dashboard: grafanaDashboard, dashboardLabel: 'JVM', source: 'grafana',
  } as PanelOption, testRun)).toEqual([]);
});

it('bounds how many dashboards it loads at once', async () => {
  // "Select all" on a system with hundreds of dashboards used to fire every request at
  // once and bury the API behind the browser's connection queue.
  let inFlight = 0;
  let peak = 0;
  (authenticatedFetch as jest.Mock).mockImplementation(async () => {
    peak = Math.max(peak, ++inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    return { ok: true, json: async () => [{ panels: [{ id: 5, title: 'CPU', type: 'timeseries' }] }] };
  });
  const many = Array.from({ length: 25 }, (_, i) => ({
    ...grafanaDashboard, id: `dash-${i}`, dashboard_label: `JVM ${i}`,
  }));

  const lists = await fetchPanelsForDashboards(many, testRun);

  expect(lists).toHaveLength(25);
  expect(lists.flat()).toHaveLength(25);
  expect(peak).toBeLessThanOrEqual(OPTION_FETCH_CONCURRENCY);
});
