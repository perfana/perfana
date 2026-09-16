/**
 * Applying a trends preset restores its series from series_config. The dashboard/panel it
 * names are only context for the next save — a preset whose dashboard is gone from this
 * run's list used to be refused with a toast; it now still plots its series, because they
 * carry their own dashboard ids.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTrendsPresets } from '@/app/test-runs/[id]/components/trends/hooks/useTrendsPresets';
import type { TrendsPreset } from '@/lib/trends-presets';
import type { ApplicationDashboard, TrendsSeries } from '@/app/test-runs/[id]/components/trends/types';

jest.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));
jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('@/lib/trends-presets', () => ({
  TrendsPresetsAPI: { getAll: jest.fn().mockResolvedValue([]), create: jest.fn(), delete: jest.fn() },
  PresetType: { GENERIC: 'generic', SPECIFIC: 'specific' },
}));

const testRun = { test_run_id: 'run-3' } as never;

const jvm: ApplicationDashboard = {
  id: 'dash-2', dashboard_label: 'JVM', dashboard_name: 'JVM', dashboard_uid: 'jvm-uid', source_type: 'grafana',
};

const preset = (overrides: Partial<TrendsPreset>): TrendsPreset => ({
  id: 'p1', name: 'Heap trend', preset_type: 'generic' as never, created_for_test_run_id: 'run-1',
  is_global: false, created_at: '', updated_at: '',
  application_dashboard_id: 'dash-2', dashboard_label: 'JVM', panel_id: 5, panel_title: 'Heap',
  evaluate_type: 'q95', source: 'grafana',
  series_config: [
    { dashboardId: 'dash-2', dashboardLabel: 'JVM', panelId: 5, panelTitle: 'Heap', metricName: 'used', source: 'grafana', yAxisFormat: 'bytes', metricsSourceId: 'ms-2' },
    // A corrupt entry that must be skipped, not crash the apply
    [] as never,
    { dashboardId: '', dashboardLabel: 'JVM', panelId: 5, panelTitle: 'Heap', metricName: 'nope' } as never,
  ],
  ...overrides,
});

function setup(dashboards: ApplicationDashboard[], fetchApplicationDashboards = jest.fn().mockResolvedValue(dashboards)) {
  const setters = {
    setSelectedSource: jest.fn(),
    setSelectedDashboard: jest.fn(),
    setSelectedMetric: jest.fn(),
    setEvaluateType: jest.fn(),
    setAddedSeries: jest.fn(),
  };
  const showToast = jest.fn();
  const { result } = renderHook(() => useTrendsPresets({
    testRun, testRunId: 'run-3', showToast,
    selectedSource: 'grafana', addedSeries: [], dashboards, fetchApplicationDashboards,
    ...setters,
  }));
  return { result, showToast, fetchApplicationDashboards, ...setters };
}

beforeEach(() => jest.clearAllMocks());

it('restores the valid series and the evaluate type, and points the save context at the found dashboard', async () => {
  const s = setup([jvm]);

  await act(async () => { await s.result.current.applyPreset(preset({})); });

  expect(s.setSelectedSource).toHaveBeenCalledWith('grafana');
  expect(s.setSelectedDashboard).toHaveBeenCalledWith(jvm);
  expect(s.setSelectedMetric).toHaveBeenCalledWith(expect.objectContaining({ id: 5, title: 'Heap', type: 'graph', applicationDashboardId: 'dash-2' }));
  expect(s.setEvaluateType).toHaveBeenCalledWith('q95');
  const restored: TrendsSeries[] = s.setAddedSeries.mock.calls[0]![0];
  expect(restored).toHaveLength(1);
  expect(restored[0]).toMatchObject({ dashboardId: 'dash-2', panelId: 5, metricName: 'used', yAxisFormat: 'bytes', metricsSourceId: 'ms-2' });
  expect(s.showToast).toHaveBeenCalledWith('Applied preset: Heap trend');
  expect(s.fetchApplicationDashboards).not.toHaveBeenCalled();
});

it('still plots a preset whose dashboard is no longer in the list, with a placeholder as save context', async () => {
  // Regression: this used to toast "Dashboard ... not found" and restore nothing.
  const s = setup([], jest.fn().mockResolvedValue([]));

  await act(async () => { await s.result.current.applyPreset(preset({})); });

  expect(s.fetchApplicationDashboards).toHaveBeenCalledTimes(1);  // list was empty, so it asked
  expect(s.setSelectedDashboard).toHaveBeenCalledWith({
    id: 'dash-2', dashboard_label: 'JVM', dashboard_name: 'JVM', dashboard_uid: '',
  });
  expect(s.setAddedSeries).toHaveBeenCalledTimes(1);
  expect(s.showToast).toHaveBeenCalledWith('Applied preset: Heap trend');
  expect(s.showToast).not.toHaveBeenCalledWith(expect.stringContaining('not found'));
});

it('finds the dashboard by label when the preset carries a stale id', async () => {
  const s = setup([jvm]);

  await act(async () => { await s.result.current.applyPreset(preset({ application_dashboard_id: 'old-uuid' })); });

  expect(s.setSelectedDashboard).toHaveBeenCalledWith(jvm);
});

it('leaves the series alone when a preset has no series config, and marks a Dynatrace panel as such', async () => {
  const s = setup([jvm]);

  await act(async () => {
    await s.result.current.applyPreset(preset({ series_config: [], source: 'dynatrace', evaluate_type: undefined }));
  });

  expect(s.setAddedSeries).not.toHaveBeenCalled();
  expect(s.setEvaluateType).not.toHaveBeenCalled();
  expect(s.setSelectedSource).toHaveBeenCalledWith('dynatrace');
  expect(s.setSelectedMetric).toHaveBeenCalledWith(expect.objectContaining({ type: 'dynatrace' }));
  expect(s.result.current.applyingPreset).toBe(false);
});

it('reports a failed apply instead of throwing', async () => {
  const s = setup([], jest.fn().mockRejectedValue(new Error('offline')));

  await act(async () => { await s.result.current.applyPreset(preset({})); });

  expect(s.showToast).toHaveBeenCalledWith('Failed to apply preset - please try again');
  await waitFor(() => expect(s.result.current.applyingPreset).toBe(false));
});
