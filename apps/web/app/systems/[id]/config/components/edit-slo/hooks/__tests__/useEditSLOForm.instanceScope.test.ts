/**
 * A Grafana dashboard uid is unique only WITHIN an instance, and
 * `GET /grafana/dashboards?uid=` applies no instance scope. This hook used to take `[0]`
 * of the answer, so editing an SLO on a dashboard whose uid also exists on a second
 * Grafana listed THAT instance's panels — and saving bound the SLO to its panel ids.
 *
 * Two paths reach the fetcher and both must carry the instance: the manual call
 * SLOFormFields makes on a dashboard pick, and the "upgrade the synthetic dashboard"
 * effect that runs when the real application-dashboard list lands. Only `@/lib/api` is
 * mocked, so the real `fetchGrafanaDashboardByUid` builds the URL under assertion.
 */
import { renderHook, waitFor, act } from '@testing-library/react';
import { useEditSLOForm } from '../useEditSLOForm';
import { Benchmark } from '../../../types';
import { UseEditSLOFormProps } from '../../types';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('@/lib/dynatrace', () => ({
  fetchDynatraceDashboards: jest.fn().mockResolvedValue([]),
  fetchDynatraceMetrics: jest.fn().mockResolvedValue([]),
}));

import { authenticatedFetch } from '@/lib/api';

const mockFetch = authenticatedFetch as jest.Mock;

const response = (data: unknown) =>
  ({ ok: true, status: 200, statusText: 'OK', json: async () => data }) as unknown as Response;

// Stable module-scope fixtures: the init effect keys on the benchmark REFERENCE.
const BENCHMARK: Benchmark = {
  id: 'bench-1',
  system_under_test_id: 'sys-1',
  test_environment: 'production',
  workload: 'normal',
  source: 'grafana',
  grafana_instance: 'prod-grafana',
  dashboard_label: 'JVM Overview',
  dashboard_uid: 'jvm-uid',
  application_dashboard_id: 'app-dash-id',
  configuration: { panelId: 42 },
  config_title: 'JVM Overview - Response Time',
  evaluate_type: 'avg',
  requirement_operator: 'lt',
  requirement_value: 500,
  enabled: true,
  valid: true,
  tags: [],
  panel_title: 'Response Time',
  exclude_ramp_up_time: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};
const PROPS: UseEditSLOFormProps = {
  open: true,
  benchmark: BENCHMARK,
  systemId: 'sys-1',
  systemName: 'My System',
  environment: 'production',
  workload: 'normal',
};

/** The application dashboard the SLO hangs off — it knows which Grafana it came from. */
const APP_DASHBOARDS = [
  {
    id: 'app-dash-id',
    dashboard_uid: 'jvm-uid',
    dashboard_label: 'JVM Overview',
    dashboard_name: 'JVM Overview',
    grafana_instance_id: 'gi-prod',
  },
];

beforeEach(() => {
  mockFetch.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it('scopes the manual panel fetch to the instance it was handed', async () => {
  mockFetch.mockResolvedValue(response([]));
  const { result, unmount } = renderHook(() => useEditSLOForm(PROPS));
  await waitFor(() => expect(result.current.loadingStates.dashboardsLoading).toBe(false));
  mockFetch.mockClear();
  mockFetch.mockResolvedValue(
    response([{ uid: 'jvm-uid', grafana_instance_id: 'gi-dev', panels: [{ id: 99, title: 'Heap', type: 'timeseries' }] }]),
  );

  await act(async () => { await result.current.fetchDashboardPanels('jvm-uid', 'gi-dev'); });

  const url = mockFetch.mock.calls[0]![0] as string;
  expect(url).toContain('uid=jvm-uid');
  expect(url).toContain('grafanaInstanceId=gi-dev');
  unmount();
});

it('carries the matched application dashboard’s instance into the upgrade fetch', async () => {
  // The list endpoint answers first, then the uid lookup the upgrade effect fires.
  mockFetch
    .mockResolvedValueOnce(response(APP_DASHBOARDS))
    .mockResolvedValue(
      response([{ uid: 'jvm-uid', grafana_instance_id: 'gi-prod', panels: [{ id: 42, title: 'Response Time', type: 'timeseries' }] }]),
    );

  const { result, unmount } = renderHook(() => useEditSLOForm(PROPS));

  await waitFor(() => expect(result.current.availableOptions.availablePanels.length).toBe(1));

  const uidCall = mockFetch.mock.calls
    .map((c) => c[0] as string)
    .find((u) => u.includes('/grafana/dashboards?'));
  expect(uidCall).toContain('grafanaInstanceId=gi-prod');
  // No guess was made, so nothing was reported as ambiguous.
  expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('Ambiguous'));
  unmount();
});
