/**
 * A Grafana dashboard uid is unique only WITHIN an instance, and
 * `GET /grafana/dashboards?uid=` applies no instance scope — it answers with every copy.
 * This loader used to take `[0]`, so on a system mapped to two Grafanas the metrics
 * picker could offer the OTHER instance's panel ids, and a chart drawn from one of them
 * has no data. An `ApplicationDashboard` knows its instance, so it must be forwarded.
 */
import type { ApplicationDashboard } from '../metric-options';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('@/lib/dynatrace', () => ({ fetchDynatraceMetrics: jest.fn().mockResolvedValue([]) }));

import { authenticatedFetch } from '@/lib/api';
import { fetchPanelsForDashboard } from '../metric-options';

const testRun = {
  test_run_id: 'run-1', system_under_test_id: 'sut-1', test_environment: 'acc', workload: 'load',
  systems_under_test: { name: 'sut' },
} as never;

const dashboard: ApplicationDashboard = {
  id: 'dash-2', dashboard_label: 'JVM', dashboard_name: 'JVM', dashboard_uid: 'jvm-uid',
  source_type: 'grafana', grafana_instance_id: 'gi-prod',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it('scopes the uid lookup to the dashboard’s own Grafana instance', async () => {
  (authenticatedFetch as jest.Mock).mockResolvedValue({
    ok: true,
    statusText: 'OK',
    json: async () => [{ uid: 'jvm-uid', grafana_instance_id: 'gi-prod', panels: [{ id: 1, title: 'Heap', type: 'timeseries' }] }],
  });

  const panels = await fetchPanelsForDashboard(dashboard, testRun);

  const url = (authenticatedFetch as jest.Mock).mock.calls[0]![0] as string;
  expect(url).toContain('uid=jvm-uid');
  expect(url).toContain('grafanaInstanceId=gi-prod');
  expect(panels.map((p) => p.id)).toEqual([1]);
  expect(console.warn).not.toHaveBeenCalled();
});

it('still loads, and reports the ambiguity, for a dashboard with no instance recorded', async () => {
  // Artificial rows and SUT-imported dashboards carry no grafana_instance_id.
  (authenticatedFetch as jest.Mock).mockResolvedValue({
    ok: true,
    statusText: 'OK',
    json: async () => [
      { uid: 'jvm-uid', grafana_instance_id: 'gi-prod', panels: [{ id: 1, title: 'Heap', type: 'timeseries' }] },
      { uid: 'jvm-uid', grafana_instance_id: 'gi-dev', panels: [{ id: 77, title: 'Heap', type: 'timeseries' }] },
    ],
  });

  const { grafana_instance_id: _drop, ...unscoped } = dashboard;
  const panels = await fetchPanelsForDashboard(unscoped, testRun);

  const url = (authenticatedFetch as jest.Mock).mock.calls[0]![0] as string;
  expect(url).not.toContain('grafanaInstanceId');
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Ambiguous'));
  expect(panels.map((p) => p.id)).toEqual([1]);
});
