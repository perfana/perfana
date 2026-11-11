/**
 * Picking the synthetic "Dynatrace — all hosts" entry must post a `dynatrace-hosts` benchmark
 * with no profile dashboard and the host uid regex in `dashboardUid`, and must list the fixed
 * host panels without asking Grafana for them.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useBenchmarkForm } from '../useBenchmarkForm';
import {
  DYNATRACE_HOSTS_PROFILE_DASHBOARD,
  isDynatraceHostsProfileDashboard,
  isPatternProfileDashboard,
  PERF_TEST_PROFILE_DASHBOARD,
} from '@/lib/profile-benchmarks';
import { DYNATRACE_HOST_PROFILE_PANELS } from '@perfana/shared/constants';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
import { authenticatedFetch } from '@/lib/api';

beforeEach(() => jest.clearAllMocks());

it('submits a dynatrace-hosts profile benchmark without a profile dashboard', async () => {
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  const props = { mode: 'create' as const, profileDashboards: [], open: true, onSubmit, onClose: jest.fn() };
  const { result } = renderHook(() => useBenchmarkForm(props));

  act(() => result.current.handleDashboardSelect(DYNATRACE_HOSTS_PROFILE_DASHBOARD));
  await waitFor(() => expect(result.current.availablePanels.length).toBe(DYNATRACE_HOST_PROFILE_PANELS.length));
  expect(authenticatedFetch).not.toHaveBeenCalled();

  const cpu = result.current.availablePanels.find((p) => p.title === 'CPU Usage')!;
  act(() => result.current.handlePanelSelect(cpu));
  act(() => result.current.updateFormField('requirementValue', '80'));
  await act(() => result.current.handleSubmit());

  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
    profileDashboardId: undefined,
    source: 'dynatrace-hosts',
    grafanaInstance: undefined,
    dashboardUid: '^dynatrace-dynatrace-host-metrics-',
    panelId: 1,
    panelTitle: 'CPU Usage',
    panelType: 'dynatrace',
    metricUnit: 'percent',
    requirementValue: 80,
  }));
});

it('restores the synthetic entry when editing, keeping the stored uid regex', async () => {
  const benchmark: any = {
    id: 'pb-dt',
    profileId: 'profile-1',
    profileDashboardId: null,
    workloadPattern: '.*',
    source: 'dynatrace-hosts',
    dashboardUid: '^dynatrace-dynatrace-host-metrics-web-',
    panelId: 2,
    panelTitle: 'Memory Usage',
    panelType: 'dynatrace',
    requirementOperator: 'lt',
    requirementValue: 90,
    excludeRampUpTime: true,
    averageAll: false,
    tags: [],
    metadata: {},
    createdAt: '',
    updatedAt: '',
  };
  const props = { mode: 'edit' as const, benchmark, profileDashboards: [], open: true, onSubmit: jest.fn(), onClose: jest.fn() };
  const { result } = renderHook(() => useBenchmarkForm(props));

  await waitFor(() => expect(result.current.formData.selectedDashboard?.id).toBe(DYNATRACE_HOSTS_PROFILE_DASHBOARD.id));
  expect(result.current.formData.selectedDashboard?.dashboardUid).toBe('^dynatrace-dynatrace-host-metrics-web-');
  expect(result.current.formData.selectedPanel).toEqual(expect.objectContaining({ id: 2 }));
  await waitFor(() => expect(result.current.availablePanels.length).toBe(DYNATRACE_HOST_PROFILE_PANELS.length));
  expect(authenticatedFetch).not.toHaveBeenCalled();
});

it('tells the two pseudo-dashboards apart', () => {
  expect(isDynatraceHostsProfileDashboard(DYNATRACE_HOSTS_PROFILE_DASHBOARD)).toBe(true);
  expect(isDynatraceHostsProfileDashboard(PERF_TEST_PROFILE_DASHBOARD)).toBe(false);
  expect(isPatternProfileDashboard(PERF_TEST_PROFILE_DASHBOARD)).toBe(true);
  expect(isPatternProfileDashboard(DYNATRACE_HOSTS_PROFILE_DASHBOARD)).toBe(true);
  expect(isPatternProfileDashboard(null)).toBe(false);
});
