/**
 * Picking the synthetic "Splunk — all panels" entry must list the Splunk panel titles in use,
 * and post a `splunk-panels` benchmark keyed on the panel TITLE: no profile dashboard, no panel
 * id (Splunk panel ids are assigned per workload), and the Splunk uid regex in `dashboardUid`.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useBenchmarkForm } from '../useBenchmarkForm';
import {
  SPLUNK_PROFILE_DASHBOARD,
  isSplunkProfileDashboard,
  isPatternProfileDashboard,
  availablePseudoDashboards,
  DYNATRACE_HOSTS_PROFILE_DASHBOARD,
  PERF_TEST_PROFILE_DASHBOARD,
} from '@/lib/profile-benchmarks';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
import { authenticatedFetch } from '@/lib/api';

const TITLES = [
  { panelTitle: 'Errors by host', metricUnit: 'none' },
  { panelTitle: 'Log events by level', metricUnit: 'short' },
];

beforeEach(() => {
  jest.clearAllMocks();
  (authenticatedFetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, json: async () => TITLES });
});

it('lists the Splunk panel titles and submits a splunk-panels benchmark keyed on the title', async () => {
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  const props = { mode: 'create' as const, profileDashboards: [], open: true, onSubmit, onClose: jest.fn() };
  const { result } = renderHook(() => useBenchmarkForm(props));

  act(() => result.current.handleDashboardSelect(SPLUNK_PROFILE_DASHBOARD));
  await waitFor(() => expect(result.current.availablePanels.map((p) => p.title)).toEqual(['Errors by host', 'Log events by level']));
  expect((authenticatedFetch as jest.Mock).mock.calls[0][0]).toBe('/splunk/queries/panel-titles');

  act(() => result.current.handlePanelSelect(result.current.availablePanels[0]));
  act(() => result.current.updateFormField('requirementValue', '10'));
  await act(() => result.current.handleSubmit());

  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
    profileDashboardId: undefined,
    source: 'splunk-panels',
    grafanaInstance: undefined,
    dashboardUid: '^splunk-',
    panelId: undefined,
    panelTitle: 'Errors by host',
    panelType: 'splunk',
    metricUnit: 'none',
    requirementValue: 10,
  }));
});

it('restores the synthetic entry and the panel by its title when editing', async () => {
  const benchmark: any = {
    id: 'pb-splunk',
    profileId: 'profile-1',
    profileDashboardId: null,
    workloadPattern: '.*',
    source: 'splunk-panels',
    dashboardUid: '^splunk-logs',
    panelId: null,
    panelTitle: 'Errors by host',
    panelType: 'splunk',
    metricUnit: 'none',
    requirementOperator: 'lt',
    requirementValue: 10,
    excludeRampUpTime: true,
    averageAll: false,
    tags: [],
    metadata: {},
    createdAt: '',
    updatedAt: '',
  };
  const props = { mode: 'edit' as const, benchmark, profileDashboards: [], open: true, onSubmit: jest.fn(), onClose: jest.fn() };
  const { result } = renderHook(() => useBenchmarkForm(props));

  await waitFor(() => expect(result.current.formData.selectedDashboard?.id).toBe(SPLUNK_PROFILE_DASHBOARD.id));
  expect(result.current.formData.selectedDashboard?.dashboardUid).toBe('^splunk-logs');
  expect(result.current.formData.selectedPanel).toEqual(expect.objectContaining({ title: 'Errors by host', yAxesFormat: 'none' }));
  await waitFor(() => expect(result.current.availablePanels).toHaveLength(2));
});

it('tells the Splunk pseudo-dashboard apart and gates the integration entries', () => {
  expect(isSplunkProfileDashboard(SPLUNK_PROFILE_DASHBOARD)).toBe(true);
  expect(isSplunkProfileDashboard(DYNATRACE_HOSTS_PROFILE_DASHBOARD)).toBe(false);
  expect(isPatternProfileDashboard(SPLUNK_PROFILE_DASHBOARD)).toBe(true);

  expect(availablePseudoDashboards({ dynatrace: false, splunk: false })).toEqual([PERF_TEST_PROFILE_DASHBOARD]);
  expect(availablePseudoDashboards({ dynatrace: true, splunk: true })).toEqual([
    PERF_TEST_PROFILE_DASHBOARD, DYNATRACE_HOSTS_PROFILE_DASHBOARD, SPLUNK_PROFILE_DASHBOARD,
  ]);
  // The entry being edited stays, even when its integration was removed.
  expect(availablePseudoDashboards({ dynatrace: false, splunk: false }, SPLUNK_PROFILE_DASHBOARD)).toEqual([
    PERF_TEST_PROFILE_DASHBOARD, SPLUNK_PROFILE_DASHBOARD,
  ]);
});
