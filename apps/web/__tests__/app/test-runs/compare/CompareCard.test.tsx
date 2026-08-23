/**
 * Tests for the Compare card's dashboard-option identity.
 *
 * Original bug (Dec 4, 2025): Dynatrace dashboards share labels, so keying the
 * Autocomplete options by label produced duplicate React keys. The fix gives each
 * one a synthetic index-based id.
 *
 * This file used to assert against its own inline re-implementation of that
 * mapping and so passed no matter what the component did. It now drives the real
 * hooks — `useCompareData.getAllDashboardsMerged` builds the options and
 * `useCompareHandlers.handleAddSeries` resolves the dashboard id a series is
 * fetched with — so a regression in either fails here.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useCompareData } from '@/app/test-runs/[id]/components/compare/hooks/useCompareData';
import { useCompareHandlers } from '@/app/test-runs/[id]/components/compare/hooks/useCompareHandlers';
import type { ApplicationDashboard, CompareSeries } from '@/app/test-runs/[id]/components/compare/types';
import type { PanelOption } from '@/app/test-runs/[id]/components/compare/utils/metric-options';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('@/lib/dynatrace', () => ({
  ...jest.requireActual('@/lib/dynatrace'),
  fetchDynatraceDashboards: jest.fn(),
}));

import { authenticatedFetch } from '@/lib/api';
import { fetchDynatraceDashboards } from '@/lib/dynatrace';

const testRun = {
  test_run_id: 'run-1',
  system_under_test_id: 'sut-1',
  test_environment: 'acc',
  workload: 'load',
} as never;

const grafanaDashboard = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  dashboard_label: 'Gatling Overview',
  dashboard_name: 'Gatling Overview',
  dashboard_uid: 'gatling-overview',
  source_type: 'grafana',
} as ApplicationDashboard;

/** Renders useCompareData with the given Dynatrace dashboards already loaded. */
async function mergedDashboards(
  dynatraceLabels: string[],
  grafana: ApplicationDashboard[] = [],
): Promise<ApplicationDashboard[]> {
  (authenticatedFetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => grafana,
  });
  (fetchDynatraceDashboards as jest.Mock).mockResolvedValue(
    dynatraceLabels.map(dashboardLabel => ({ dashboardLabel, metrics: [] })),
  );

  const { result } = renderHook(() =>
    useCompareData({ testRun, testRunId: 'run-1', compareExpanded: true }),
  );

  await waitFor(() =>
    expect(result.current.getAllDashboardsMerged().length).toBe(
      dynatraceLabels.length + grafana.length,
    ),
  );
  return result.current.getAllDashboardsMerged();
}

beforeEach(() => jest.clearAllMocks());

describe('Dynatrace dashboard options', () => {
  it('gives every dashboard a unique id even when the labels repeat', async () => {
    const merged = await mergedDashboards([
      'HTTP connection pool afterburner-be',
      'HTTP connection pool afterburner-be',
      'JVM Memory',
      'HTTP connection pool afterburner-be',
    ]);

    const ids = merged.map(d => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['dynatrace-0', 'dynatrace-1', 'dynatrace-2', 'dynatrace-3']);
  });

  it('never uses the label as the id — that is what produced duplicate React keys', async () => {
    const merged = await mergedDashboards(['Same Label', 'Same Label']);

    expect(merged[0].id).not.toBe(merged[0].dashboard_label);
    expect(merged[0].id).not.toBe(merged[1].id);
    expect(merged[0].dashboard_label).toBe(merged[1].dashboard_label);
  });

  it('keeps the label for display while the id stays unique', async () => {
    const merged = await mergedDashboards(['Dashboard A', 'Dashboard B', 'Dashboard A']);

    expect(merged.map(d => d.dashboard_label)).toEqual(['Dashboard A', 'Dashboard B', 'Dashboard A']);
    expect(new Set(merged.map(d => d.id)).size).toBe(3);
  });

  it('holds up across many repeats of one label', async () => {
    const merged = await mergedDashboards(Array(10).fill('Repeated Label'));

    expect(new Set(merged.map(d => d.id)).size).toBe(10);
  });

  it('produces nothing when there are no dashboards at all', async () => {
    expect(await mergedDashboards([])).toEqual([]);
  });

  it('leaves Grafana dashboards on their real database ids', async () => {
    const merged = await mergedDashboards(['Dynatrace One'], [grafanaDashboard]);

    expect(merged.find(d => d.source_type === 'grafana')!.id).toBe(grafanaDashboard.id);
    expect(merged.find(d => d.source_type === 'dynatrace')!.id).toBe('dynatrace-0');
  });
});

describe('applicationDashboardId resolution when a series is added', () => {
  /**
   * Bug fix (Jan 2, 2026): a Dynatrace dashboard's id is synthetic
   * ('dynatrace-0'), so the series must be fetched with the real
   * applicationDashboardId carried on the panel instead.
   */
  const addSeries = (dashboard: ApplicationDashboard, panel: PanelOption): CompareSeries[] => {
    const setAddedSeries = jest.fn();
    const { result } = renderHook(() =>
      useCompareHandlers({
        testRun,
        testRunId: 'run-1',
        showToast: jest.fn(),
        addedSeries: [],
        selectedTestRun: null,
        showGraphs: {},
        setAddedSeries,
        setMetricComparisons: jest.fn(),
        setCurrentMetrics: jest.fn(),
        setSelectedMetrics: jest.fn(),
        setShowGraphs: jest.fn(),
        setGraphData: jest.fn(),
        setGraphLoading: jest.fn(),
      }),
    );

    act(() => {
      result.current.handleAddSeries([{ dashboard, panel, metricName: 'Response Time' }]);
    });
    return setAddedSeries.mock.calls[0]![0]([]);
  };

  const dynatraceDashboard = {
    id: 'dynatrace-0',
    dashboard_label: 'HTTP Connection Pool',
    dashboard_name: 'HTTP Connection Pool',
    dashboard_uid: 'dynatrace-HTTP Connection Pool',
    source_type: 'dynatrace',
  } as ApplicationDashboard;

  const panelOf = (dashboard: ApplicationDashboard, applicationDashboardId?: string): PanelOption => ({
    id: 100001,
    title: 'Response Time',
    type: 'dynatrace',
    applicationDashboardId,
    metricsSourceId: 'ms-1',
    dashboard,
    dashboardLabel: dashboard.dashboard_label,
    source: 'dynatrace',
  } as PanelOption);

  it('uses the panel applicationDashboardId, not the synthetic dashboard id', () => {
    const [series] = addSeries(dynatraceDashboard, panelOf(dynatraceDashboard, 'real-uuid-from-database'));

    expect(series.dashboardId).toBe('real-uuid-from-database');
    expect(series.dashboardId).not.toBe('dynatrace-0');
  });

  it('falls back to the dashboard id when the panel carries none', () => {
    const [series] = addSeries(grafanaDashboard, panelOf(grafanaDashboard, undefined));

    expect(series.dashboardId).toBe(grafanaDashboard.id);
  });

  it('treats an empty applicationDashboardId as absent', () => {
    const [series] = addSeries(grafanaDashboard, panelOf(grafanaDashboard, ''));

    expect(series.dashboardId).toBe(grafanaDashboard.id);
  });
});
