/**
 * Series groups in the option loaders: a grouped panel's names arrive as group names, and the
 * picker needs to know which of them are groups and what they stand for, from whichever
 * response carried the names. The per-pod view asks for the raw names instead.
 */
import type { ApplicationDashboard, PanelOption } from '../metric-options';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('@/lib/dynatrace', () => ({ fetchDynatraceMetrics: jest.fn().mockResolvedValue([]) }));
jest.mock('@/lib/grafana-dashboards', () => ({
  fetchGrafanaDashboardByUid: jest.fn().mockResolvedValue({ panels: [{ id: 7, title: 'CPU per pod', type: 'timeseries' }] }),
}));

import { authenticatedFetch } from '@/lib/api';
import { fetchPanelsForDashboards, fetchSeriesForPanel, fetchSeriesForPanels, panelKey } from '../metric-options';

const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

const testRun = {
  test_run_id: 'run-1', system_under_test_id: 'sut-1', test_environment: 'acc', workload: 'load',
  systems_under_test: { name: 'sut' },
} as never;

const k8s: ApplicationDashboard = {
  id: 'dash-k8s', dashboard_label: 'Kubernetes', dashboard_name: 'Kubernetes', dashboard_uid: 'k8s', source_type: 'grafana',
};
const perf: ApplicationDashboard = {
  id: 'dash-perf', dashboard_label: 'Perf', dashboard_name: 'Perf', dashboard_uid: 'perf-uid', source_type: 'performance_test',
};

const POD_A = 'api-7d9f8c6b5-x2k4p';
const POD_B = 'api-7d9f8c6b5-z9w2t';

const panel: PanelOption = {
  id: 7, title: 'CPU per pod', type: 'timeseries', applicationDashboardId: k8s.id,
  dashboard: k8s, dashboardLabel: 'Kubernetes', source: 'grafana',
};

const json = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

beforeEach(() => mockFetch.mockReset());

it('marks a group name with its members from /distinct-series', async () => {
  mockFetch.mockResolvedValue(
    json({
      metric_names: ['api', 'api (pod count)', 'heap'],
      series_groups: [{ group: 'api', members: [POD_A, POD_B], aggregation: 'avg', member_count_name: 'api (pod count)' }],
    }),
  );

  const options = await fetchSeriesForPanel(panel, testRun);

  expect(mockFetch.mock.calls[0]![0]).toContain('/metrics/ds-metrics/distinct-series?');
  expect(mockFetch.mock.calls[0]![0]).not.toContain('members=');
  expect(options.map((o) => [o.metricName, o.members])).toEqual([
    ['api', [POD_A, POD_B]],
    ['api (pod count)', undefined],
    ['heap', undefined],
  ]);
});

it('asks for the raw names in the per-pod view, and marks nothing', async () => {
  mockFetch.mockResolvedValue(json({ metric_names: [POD_A, POD_B, 'heap'] }));

  const options = await fetchSeriesForPanel(panel, testRun, { members: true });

  expect(mockFetch.mock.calls[0]![0]).toContain('members=true');
  expect(options.map((o) => o.metricName)).toEqual([POD_A, POD_B, 'heap']);
  expect(options.every((o) => o.members === undefined)).toBe(true);
});

it('falls back to /distinct-names on an API that has no /distinct-series', async () => {
  mockFetch.mockImplementation(async (url: string) =>
    url.includes('/distinct-series') ? json({ message: 'Not Found' }, 404) : json(['api', 'heap']),
  );

  const options = await fetchSeriesForPanel(panel, testRun);

  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(mockFetch.mock.calls[1]![0]).toContain('/metrics/ds-metrics/distinct-names?');
  expect(options.map((o) => o.metricName)).toEqual(['api', 'heap']);
});

it('carries series_groups from the run-wide rows onto the panel, and answers from them', async () => {
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/ds-metrics/available/')) {
      return json([
        { dashboard_label: 'Perf', panel_title: 'RT', panel_id: 101, metric_names: ['T01'] },
        {
          dashboard_label: 'Kubernetes', panel_title: 'CPU per pod', panel_id: 7, metric_names: ['api', 'heap'],
          series_groups: [{ group: 'api', members: [POD_A, POD_B], aggregation: 'avg' }],
        },
      ]);
    }
    return json({ metric_names: ['from-the-network'] });
  });

  const lists = await fetchPanelsForDashboards([perf, k8s], testRun, { includeUrlPanels: false });
  const cpu = lists[1]!.find((p) => p.id === 7)!;
  expect(cpu.seriesMembers).toEqual({ api: [POD_A, POD_B] });
  expect(lists[0]!.find((p) => p.id === 101)!).not.toHaveProperty('seriesMembers');

  mockFetch.mockClear();
  const options = await fetchSeriesForPanel(cpu, testRun);
  expect(mockFetch).not.toHaveBeenCalled();
  expect(options.map((o) => [o.metricName, o.members])).toEqual([
    ['api', [POD_A, POD_B]],
    ['heap', undefined],
  ]);

  // The per-pod view cannot answer from grouped names, so it asks.
  mockFetch.mockResolvedValue(json({ metric_names: [POD_A, POD_B, 'heap'] }));
  const raw = await fetchSeriesForPanel(cpu, testRun, { members: true });
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(raw.map((o) => o.metricName)).toEqual([POD_A, POD_B, 'heap']);
});

it('switches only the panels named to the per-pod view', async () => {
  mockFetch.mockResolvedValue(json({ metric_names: ['x'] }));
  const other: PanelOption = { ...panel, id: 8, title: 'Memory per pod' };

  await fetchSeriesForPanels([panel, other], testRun, new Set([panelKey(other)]));

  const urls = mockFetch.mock.calls.map(([u]) => String(u));
  expect(urls.find((u) => u.includes('panelId=7'))).not.toContain('members=true');
  expect(urls.find((u) => u.includes('panelId=8'))).toContain('members=true');
});
