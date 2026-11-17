/**
 * A Splunk placeholder dashboard has no Grafana JSON: its panels and series are what the run
 * recorded in ds_metrics. These pin that it is classified as Splunk (so the picker files it under
 * its own header), that its panels come from /ds-metrics/available and never from Grafana, and
 * that it gets none of the perf-test extras (URL panels, folded RT panels, "All aggregated").
 */
import type { ApplicationDashboard } from '../metric-options';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('@/lib/dynatrace', () => ({ fetchDynatraceMetrics: jest.fn().mockResolvedValue([]) }));
jest.mock('@/lib/grafana-dashboards', () => ({ fetchGrafanaDashboardByUid: jest.fn() }));

import { authenticatedFetch } from '@/lib/api';
import { fetchGrafanaDashboardByUid } from '@/lib/grafana-dashboards';
import { getSourceDisplayInfo, isArtificialDashboard } from '@/lib/metrics-source-utils';
import { fetchPanelsForDashboards, fetchSeriesForPanel, sourceOf } from '../metric-options';

const testRun = {
  test_run_id: 'run-1', system_under_test_id: 'sut-1', test_environment: 'acc', workload: 'load',
  systems_under_test: { name: 'sut' },
} as never;

// As GET /grafana/application-dashboards returns it today: no source_type, uid prefix only.
const splunkDashboard: ApplicationDashboard = {
  id: 'dash-s', dashboard_label: 'Splunk logs', dashboard_name: 'Splunk logs', dashboard_uid: 'splunk-splunk-logs',
};

const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/ds-metrics/available/')) {
      return {
        ok: true,
        json: async () => [
          { dashboard_label: 'Splunk logs', panel_title: 'Log events by level', panel_id: 1, unit: 'short', metric_names: ['ERROR', 'INFO'] },
          { dashboard_label: 'Splunk logs', panel_title: 'Errors by host', panel_id: 2, unit: 'short', metric_names: ['afterburner-be-0'] },
        ],
      } as unknown as Response;
    }
    return { ok: true, json: async () => [] } as unknown as Response;
  });
});

it('is classified as Splunk and grouped under its own header', () => {
  expect(sourceOf(splunkDashboard)).toBe('splunk');
  expect(getSourceDisplayInfo(splunkDashboard).groupLabel).toBe('Splunk Logs');
  expect(isArtificialDashboard(splunkDashboard)).toBe(true);
});

it('lists the recorded panels, with their series, and never asks Grafana', async () => {
  const [panels] = await fetchPanelsForDashboards([splunkDashboard], testRun);
  expect(panels!.map((p) => [p.id, p.title, p.source])).toEqual([
    [1, 'Log events by level', 'splunk'],
    [2, 'Errors by host', 'splunk'],
  ]);
  expect(fetchGrafanaDashboardByUid).not.toHaveBeenCalled();
  const series = await fetchSeriesForPanel(panels![0]!, testRun);
  expect(series.map((s) => s.metricName)).toEqual(['ERROR', 'INFO']);
});
