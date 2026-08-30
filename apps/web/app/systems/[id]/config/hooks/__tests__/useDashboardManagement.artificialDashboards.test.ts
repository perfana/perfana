/**
 * The "add Grafana dashboard" picker offers only dashboards that exist in Grafana.
 *
 * `grafana_dashboards` also holds synthetic rows that Perfana writes itself — Dynatrace host
 * metrics and performance-test metrics — so its own metrics have a dashboard to hang off. They
 * carry a real grafana_instance_id and a real-looking grafana_id, so nothing about the row says
 * "not a dashboard"; the only honest signal is the source type. Offered in this picker, they
 * invite adding a dashboard that resolves to nothing in Grafana.
 *
 * The filter is deliberately in this hook and NOT in the API's findAll, because two other
 * callers need those same rows: the SLO dialog lists /grafana/application-dashboards (an SLO on
 * a Dynatrace host metric is the whole point), and useAddSLOForm looks one up by uid through
 * /grafana/dashboards. A server-side filter would break both, which is what these tests guard.
 */

import { renderHook, act } from '@testing-library/react';
import { useDashboardManagement } from '../useDashboardManagement';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

import { authenticatedFetch } from '@/lib/api';

const mockAuthFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

function makeResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Internal Server Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

const dashboard = (uid: string, name: string) => ({
  id: uid,
  uid,
  name,
  grafana_instance_id: 'gi-1',
  grafana_id: 1,
  slug: name,
  uri: `/d/${uid}`,
});

describe('useDashboardManagement — the add-dashboard picker excludes synthetic dashboards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const primePicker = async (dashboards: unknown[]) => {
    // Driven through handleAddDashboard — the real entry point, and what the Add button calls.
    // First request fetches the instances, second the dashboards for that instance.
    mockAuthFetch
      .mockResolvedValueOnce(makeResponse([{ id: 'gi-1', label: 'Grafana' }]))
      .mockResolvedValueOnce(makeResponse(dashboards));

    const { result } = renderHook(() => useDashboardManagement());
    await act(async () => {
      await result.current.handleAddDashboard();
    });
    return result;
  };

  it('drops Dynatrace host-metric entries from the picker', async () => {
    const result = await primePicker([
      dashboard('dynatrace-dynatrace-host-metrics-app0069', 'Dynatrace host metrics app0069'),
      dashboard('spring-boot-kubernetes-jvm-g1gc-mimir', 'JVM memory management G1GC'),
    ]);

    const offered = result.current.availableGrafanaDashboards.map((d) => d.uid);
    expect(offered).toEqual(['spring-boot-kubernetes-jvm-g1gc-mimir']);
  });

  it('drops performance-test metric entries too — same synthetic class', async () => {
    const result = await primePicker([
      dashboard('performance-test-metrics-abc', 'Performance test metrics'),
      dashboard('jmeter-overview-influxdb', 'JMeter'),
    ]);

    const offered = result.current.availableGrafanaDashboards.map((d) => d.uid);
    expect(offered).toEqual(['jmeter-overview-influxdb']);
  });

  it('keeps every real dashboard, including ones whose name merely mentions Dynatrace', async () => {
    // The uid is the signal, not the name — a genuine Grafana dashboard is allowed to be
    // called "Dynatrace overview" and must still be addable.
    const result = await primePicker([
      dashboard('my-dynatrace-overview', 'Dynatrace overview'),
      dashboard('loki', 'Loki'),
    ]);

    const offered = result.current.availableGrafanaDashboards.map((d) => d.uid);
    expect(offered).toEqual(['my-dynatrace-overview', 'loki']);
  });

  it('leaves the picker empty rather than throwing when every dashboard is synthetic', async () => {
    const result = await primePicker([
      dashboard('dynatrace-host-a', 'Dynatrace host metrics a'),
    ]);

    expect(result.current.availableGrafanaDashboards).toEqual([]);
  });
});
