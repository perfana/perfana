/**
 * The SLO dialog's "Grafana Dashboards" group holds real Grafana dashboards only.
 *
 * /grafana/application-dashboards also returns the artificial performance-test rows, and
 * unfiltered they were listed twice: once under "Performance Test Metrics" and once under
 * "Grafana Dashboards". On a system with no Grafana dashboard at all (SONAR) the Grafana copy
 * was the one a search landed on, and its panels were fetched by Grafana uid — which a
 * placeholder has none of — so the Metric dropdown stayed empty.
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

const dashboards = [
  { id: 'perf-1', dashboard_uid: 'performance-test-metrics-t-agenda', dashboard_label: 'Performance test metrics T_Agenda', dashboard_name: 'Performance test metrics T_Agenda' },
  { id: 'jvm', dashboard_uid: 'jvm-uid', dashboard_label: 'JVM', dashboard_name: 'JVM' },
];

it('keeps performance-test placeholders out of the Grafana list', async () => {
  (authenticatedFetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => dashboards });

  const { result } = renderHook(() => useAddSLOForm({
    open: true, systemId: 'sut-1', systemName: 'SONAR', environment: 'acc', workload: 'load',
  }));

  await waitFor(() => expect(result.current.availableOptions.availablePerfMetricsDashboards).toHaveLength(1));
  expect(result.current.availableOptions.availableDashboards.map((d) => d.id)).toEqual(['jvm']);
});

it('keeps every source group after a pick and clears only the panel lists', async () => {
  // handleSourceChange used to wipe the other two dashboard lists, so after the first pick the
  // dropdown held one group and switching source meant reopening the dialog.
  (authenticatedFetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => dashboards });
  const { result } = renderHook(() => useAddSLOForm({
    open: true, systemId: 'sut-1', systemName: 'SONAR', environment: 'acc', workload: 'load',
  }));
  await waitFor(() => expect(result.current.availableOptions.availableDashboards).toHaveLength(1));

  act(() => result.current.handleSourceChange('performance-metrics'));

  expect(result.current.sloFormData.source).toBe('performance-metrics');
  expect(result.current.availableOptions.availableDashboards.map((d) => d.id)).toEqual(['jvm']);
  expect(result.current.availableOptions.availablePerfMetricsDashboards).toHaveLength(1);
  expect(result.current.availableOptions.availablePanels).toEqual([]);
  expect(result.current.availableOptions.availablePerfMetricsPanels).toEqual([]);
});

// Value: protects=the perf-test panel's unit reaching the Add SLO form as yAxesFormat (so the
// threshold is converted and metric_unit is saved); fails_when=fetchPerfMetricsPanels drops
// row.unit or stops mapping it through perfPanelUnitCode; why_new=only the helper was tested,
// the hook's mapping was not; seam=none; no_claim=does not cover the save payload or the
// SLO list rendering of the unit.
it('carries the perf-test panel unit onto the panel as a unit code', async () => {
  (authenticatedFetch as jest.Mock).mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => (url.includes('/metrics/ds-metrics/panels-by-dashboard')
      ? [
        { panel_id: 1, panel_title: 'Error rate', unit: '%' },
        { panel_id: 2, panel_title: 'Throughput', unit: 'req/s' },
        { panel_id: 3, panel_title: 'Response time', unit: 'ms' },
        { panel_id: 4, panel_title: 'No unit', unit: '' },
      ]
      : dashboards),
  }));
  const { result } = renderHook(() => useAddSLOForm({
    open: true, systemId: 'sut-1', systemName: 'SONAR', environment: 'acc', workload: 'load',
  }));
  await waitFor(() => expect(result.current.availableOptions.availablePerfMetricsDashboards).toHaveLength(1));

  await act(async () => { await result.current.fetchPerfMetricsPanels('perf-1'); });

  expect(result.current.availableOptions.availablePerfMetricsPanels.map((p) => [p.id, p.yAxesFormat]))
    .toEqual([[1, 'percent'], [2, 'reqps'], [3, 'ms'], [4, undefined]]);
});
