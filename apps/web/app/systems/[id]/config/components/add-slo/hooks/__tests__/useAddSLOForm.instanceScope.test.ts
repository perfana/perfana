/**
 * A Grafana dashboard uid is unique only WITHIN an instance, and
 * `GET /grafana/dashboards?uid=` applies no instance scope — it answers with every copy,
 * ordered by name. This hook used to take `[0]`, so an SLO added against a dashboard that
 * also exists on a second Grafana could be bound to THAT instance's panel ids.
 *
 * What matters here is not that the hook calls the shared fetcher, but that the instance
 * SLOFormFields hands it actually reaches the request. The real
 * `fetchGrafanaDashboardByUid` runs — only `@/lib/api` is mocked — so the assertion is on
 * the URL that goes out.
 */
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAddSLOForm } from '../useAddSLOForm';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('@/lib/dynatrace', () => ({
  fetchDynatraceDashboards: jest.fn().mockResolvedValue([]),
  fetchDynatraceMetrics: jest.fn().mockResolvedValue([]),
  fetchDynatraceQueries: jest.fn().mockResolvedValue([]),
}));

import { authenticatedFetch } from '@/lib/api';

const mockFetch = authenticatedFetch as jest.Mock;

const PROPS = { open: true, systemId: 'sut-1', systemName: 'SONAR', environment: 'acc', workload: 'load' };

/** Two instances hold the same uid with different panel ids — the bug this guards. */
const bothInstances = [
  { uid: 'jvm-uid', grafana_instance_id: 'gi-prod', panels: [{ id: 11, title: 'Heap', type: 'timeseries' }] },
  { uid: 'jvm-uid', grafana_instance_id: 'gi-dev', panels: [{ id: 99, title: 'Heap', type: 'timeseries' }] },
];

const renderReady = async () => {
  mockFetch.mockResolvedValue({ ok: true, statusText: 'OK', json: async () => [] });
  const hook = renderHook(() => useAddSLOForm(PROPS));
  await waitFor(() => expect(hook.result.current.loadingStates.dashboardsLoading).toBe(false));
  mockFetch.mockClear();
  return hook;
};

beforeEach(() => {
  mockFetch.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it('sends the grafanaInstanceId it was given, so the server picks the instance', async () => {
  const { result, unmount } = await renderReady();
  mockFetch.mockResolvedValue({
    ok: true,
    statusText: 'OK',
    json: async () => [bothInstances[1]],
  });

  await act(async () => { await result.current.fetchDashboardPanels('jvm-uid', 'gi-dev'); });

  const url = mockFetch.mock.calls[0]![0] as string;
  expect(url).toContain('uid=jvm-uid');
  expect(url).toContain('grafanaInstanceId=gi-dev');
  expect(result.current.availableOptions.availablePanels.map((p) => p.id)).toEqual([99]);
  unmount();
});

it('omits the scope — and says so — when the caller has no instance to give', async () => {
  const { result, unmount } = await renderReady();
  mockFetch.mockResolvedValue({ ok: true, statusText: 'OK', json: async () => bothInstances });

  await act(async () => { await result.current.fetchDashboardPanels('jvm-uid'); });

  const url = mockFetch.mock.calls[0]![0] as string;
  expect(url).not.toContain('grafanaInstanceId');
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Ambiguous'));
  unmount();
});
