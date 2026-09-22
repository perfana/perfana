/**
 * Picking the synthetic "Performance test metrics" entry must post a `performance-metrics`
 * benchmark with no profile dashboard and the uid regex in `dashboardUid`, and must list the
 * fixed perf-test panels without asking Grafana for them.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useBenchmarkForm } from '../useBenchmarkForm';
import { PERF_TEST_PROFILE_DASHBOARD, isPerfTestProfileDashboard } from '@/lib/profile-benchmarks';
import { PERF_TEST_PROFILE_PANELS } from '@perfana/shared/constants';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
import { authenticatedFetch } from '@/lib/api';

it('submits a perf-test profile benchmark without a profile dashboard', async () => {
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  // Stable references: the hook's init effect depends on them (the page passes hook state).
  const props = { mode: 'create' as const, profileDashboards: [], open: true, onSubmit, onClose: jest.fn() };
  const { result } = renderHook(() => useBenchmarkForm(props));

  act(() => result.current.handleDashboardSelect(PERF_TEST_PROFILE_DASHBOARD));
  await waitFor(() => expect(result.current.availablePanels.length).toBe(PERF_TEST_PROFILE_PANELS.length));
  expect(authenticatedFetch).not.toHaveBeenCalled();

  const errorRate = result.current.availablePanels.find((p) => p.id === 105)!;
  act(() => result.current.handlePanelSelect(errorRate));
  act(() => result.current.updateFormField('requirementValue', '2'));
  await act(() => result.current.handleSubmit());

  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
    profileDashboardId: undefined,
    source: 'performance-metrics',
    grafanaInstance: undefined,
    dashboardUid: '^performance-test-metrics-(?!all-aggregated$|default$)',
    panelId: 105,
    panelTitle: 'Transaction Error Rate',
    panelType: 'performance-metrics',
    requirementValue: 2,
  }));
});

describe('editing an existing perf-test benchmark', () => {
  const perfTestBenchmark: any = {
    id: 'pb-1',
    profileId: 'profile-1',
    profileDashboardId: null,
    workloadPattern: '.*',
    source: 'performance-metrics',
    dashboardUid: '^performance-test-metrics-t-wm-',
    panelId: 105,
    panelTitle: 'Transaction Error Rate',
    panelType: 'performance-metrics',
    evaluateType: 'avg',
    requirementOperator: 'lt',
    requirementValue: 2,
    excludeRampUpTime: true,
    averageAll: false,
    tags: [],
    metadata: {},
    createdAt: '',
    updatedAt: '',
  };

  beforeEach(() => jest.clearAllMocks());

  it('restores the synthetic entry, lists the static panels and keeps the stored uid regex', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const props = {
      mode: 'edit' as const,
      benchmark: perfTestBenchmark,
      profileDashboards: [],
      open: true,
      onSubmit,
      onClose: jest.fn(),
    };
    const { result } = renderHook(() => useBenchmarkForm(props));

    // The benchmark has no profile dashboard row to find; the source picks the synthetic entry.
    await waitFor(() => expect(result.current.formData.selectedDashboard?.id).toBe(PERF_TEST_PROFILE_DASHBOARD.id));
    expect(result.current.formData.selectedDashboard?.dashboardUid).toBe('^performance-test-metrics-t-wm-');
    expect(result.current.formData.selectedPanel).toEqual(expect.objectContaining({ id: 105 }));

    // Panels come from the static list even though the stored uid is not the default one.
    await waitFor(() => expect(result.current.availablePanels.length).toBe(PERF_TEST_PROFILE_PANELS.length));
    expect(authenticatedFetch).not.toHaveBeenCalled();

    await act(() => result.current.handleSubmit());

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      profileDashboardId: undefined,
      source: 'performance-metrics',
      grafanaInstance: undefined,
      dashboardUid: '^performance-test-metrics-t-wm-',
      panelId: 105,
    }));
  });

  it('falls back to the default uid regex when the stored one is empty', async () => {
    const props = {
      mode: 'edit' as const,
      benchmark: { ...perfTestBenchmark, dashboardUid: '' },
      profileDashboards: [],
      open: true,
      onSubmit: jest.fn().mockResolvedValue(undefined),
      onClose: jest.fn(),
    };
    const { result } = renderHook(() => useBenchmarkForm(props));

    await waitFor(() => expect(result.current.formData.selectedDashboard?.id).toBe(PERF_TEST_PROFILE_DASHBOARD.id));
    expect(result.current.formData.selectedDashboard?.dashboardUid).toBe(PERF_TEST_PROFILE_DASHBOARD.dashboardUid);
  });
});

describe('a Grafana profile dashboard is unchanged by the perf-test branch', () => {
  const grafanaDashboard = {
    id: 'dashboard-1',
    profile: 'profile-1',
    dashboardName: 'JMeter Overview',
    dashboardUid: 'jmeter-uid',
    grafanaLabel: 'grafana-prod',
    tags: ['jmeter'],
    createdAt: '',
    updatedAt: '',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (authenticatedFetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [{ panels: [{ id: 7, title: 'Heap', type: 'timeseries', yAxesFormat: 'bytes' }] }],
    });
  });

  it('still fetches panels from Grafana and posts the profile dashboard id and instance', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const props = { mode: 'create' as const, profileDashboards: [grafanaDashboard], open: true, onSubmit, onClose: jest.fn() };
    const { result } = renderHook(() => useBenchmarkForm(props));

    act(() => result.current.handleDashboardSelect(grafanaDashboard));
    await waitFor(() => expect(result.current.availablePanels).toHaveLength(1));
    expect(authenticatedFetch).toHaveBeenCalledWith(
      expect.stringContaining('/grafana/dashboards?uid=jmeter-uid'),
      expect.anything(),
    );

    act(() => result.current.handlePanelSelect(result.current.availablePanels[0]));
    act(() => result.current.updateFormField('requirementValue', '100'));
    await act(() => result.current.handleSubmit());

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      profileDashboardId: 'dashboard-1',
      source: 'grafana',
      grafanaInstance: 'grafana-prod',
      dashboardUid: 'jmeter-uid',
      panelId: 7,
    }));
  });

  it('isPerfTestProfileDashboard answers false for null and for a Grafana dashboard', () => {
    expect(isPerfTestProfileDashboard(null)).toBe(false);
    expect(isPerfTestProfileDashboard(grafanaDashboard)).toBe(false);
    expect(isPerfTestProfileDashboard(PERF_TEST_PROFILE_DASHBOARD)).toBe(true);
  });
});
