/**
 * The Request Impact panel is a REAL perf-test panel with ds_metrics rows, so its series
 * must come from the statistics endpoint, not from the run's normalized URLs.
 *
 * It was first shipped as 210, which is the virtual "URL RT" panel's id (URL_PANEL_ID_MIN):
 * `isUrlPanel(210)` claimed it, the series dropdown listed URLs instead of
 * `transaction.sampler` names, and the compare card grouped it with URL RT under the same
 * `${dashboardId}-${panelId}` key. Both failures were silent. A request-level panel id must
 * stay out of the URL_PANELS id set.
 */
import type { ApplicationDashboard, PanelOption } from '../metric-options';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('@/lib/dynatrace', () => ({ fetchDynatraceMetrics: jest.fn().mockResolvedValue([]) }));
jest.mock('@/lib/url-perf-panels', () => ({
  ...jest.requireActual('@/lib/url-perf-panels'),
  fetchUrlDistinctNames: jest.fn().mockResolvedValue(['/api/user/{id}']),
}));

import { authenticatedFetch } from '@/lib/api';
import { fetchUrlDistinctNames } from '@/lib/url-perf-panels';
import { fetchPanelsForDashboard, fetchSeriesForPanel } from '../metric-options';

const testRun = {
  test_run_id: 'run-1', system_under_test_id: 'sut-1', test_environment: 'acc', workload: 'load',
  systems_under_test: { name: 'sut' },
} as never;

const perfDashboard: ApplicationDashboard = {
  id: 'dash-1', dashboard_label: 'Perf', dashboard_name: 'Perf',
  dashboard_uid: 'perf-uid', source_type: 'performance_test', metrics_source_id: 'ms-1',
};

beforeEach(() => jest.clearAllMocks());

it('reads the Request Impact series from the statistics, not from the run URLs', async () => {
  (authenticatedFetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ['T01.GET /home'] });
  const panel = {
    id: 219, title: 'Request Impact', type: 'timeseries', applicationDashboardId: 'dash-1',
    dashboard: perfDashboard, dashboardLabel: 'Perf', source: 'performance-metrics',
  } as PanelOption;

  const series = await fetchSeriesForPanel(panel, testRun);

  expect(fetchUrlDistinctNames).not.toHaveBeenCalled();
  expect(series.map((s) => s.metricName)).toEqual(['T01.GET /home']);
});

it('offers the Request Impact panel and the URL RT panel as two distinct entries', async () => {
  (authenticatedFetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => [{ dashboard_label: 'Perf', panel_title: 'Request Impact', panel_id: 219 }],
  });

  const panels = await fetchPanelsForDashboard(perfDashboard, testRun);
  const ids = panels.map((p) => p.id);

  expect(new Set(ids).size).toBe(ids.length);
});
