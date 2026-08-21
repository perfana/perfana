/**
 * Tests for useCompareHandlers.handleAddSeries.
 *
 * Covers what the multi-select cascade made possible and what it must not break:
 * - one click adds series from several panels across several dashboards, each row
 *   keeping its own dashboard id, panel and metrics source
 * - a series already in the comparison is not added twice
 * - "All aggregated" is stored under its aggregated metric name, flagged as such
 */

import { renderHook } from '@testing-library/react';
import { useCompareHandlers } from './useCompareHandlers';
import { ApplicationDashboard, CompareSeries } from '../types';
import type { PanelOption } from '../utils/metric-options';
import { ALL_AGGREGATED_OPTION } from '@/lib/aggregated-perf-series';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));

const testRun = { test_run_id: 'run-1' } as never;

const perfDashboard: ApplicationDashboard = {
  id: 'dash-1', dashboard_label: 'Perf', dashboard_name: 'Perf',
  dashboard_uid: 'perf-uid', source_type: 'performance_test', metrics_source_id: 'ms-1',
};
const jvmDashboard: ApplicationDashboard = {
  id: 'dash-2', dashboard_label: 'JVM', dashboard_name: 'JVM',
  dashboard_uid: 'jvm-uid', source_type: 'grafana', metrics_source_id: 'ms-2',
};

const panelOf = (dashboard: ApplicationDashboard, id: number, title: string): PanelOption => ({
  id, title, type: 'timeseries',
  applicationDashboardId: dashboard.id,
  metricsSourceId: dashboard.metrics_source_id,
  dashboard,
  dashboardLabel: dashboard.dashboard_label,
  source: dashboard.source_type === 'performance_test' ? 'performance-metrics' : 'grafana',
});

function setup(addedSeries: CompareSeries[] = []) {
  const setAddedSeries = jest.fn();
  const showToast = jest.fn();
  const { result } = renderHook(() => useCompareHandlers({
    testRun,
    testRunId: 'run-1',
    showToast,
    addedSeries,
    selectedTestRun: null,
    showGraphs: {},
    setAddedSeries,
    setMetricComparisons: jest.fn(),
    setCurrentMetrics: jest.fn(),
    setSelectedMetrics: jest.fn(),
    setShowGraphs: jest.fn(),
    setGraphData: jest.fn(),
    setGraphLoading: jest.fn(),
  }));
  return { result, setAddedSeries, showToast };
}

/** The array handleAddSeries hands to setAddedSeries, which is called with an updater. */
const added = (setAddedSeries: jest.Mock): CompareSeries[] =>
  setAddedSeries.mock.calls[0]![0]([]);

beforeEach(() => jest.clearAllMocks());

it('adds series from several panels across several dashboards in one go', () => {
  const { result, setAddedSeries, showToast } = setup();

  result.current.handleAddSeries([
    { dashboard: perfDashboard, panel: panelOf(perfDashboard, 201, 'Request RT'), metricName: 'login' },
    { dashboard: jvmDashboard, panel: panelOf(jvmDashboard, 5, 'Heap'), metricName: 'used' },
  ]);

  const series = added(setAddedSeries);
  expect(series).toHaveLength(2);
  expect(series[0]).toMatchObject({
    dashboardId: 'dash-1', dashboardLabel: 'Perf', panelId: 201, panelTitle: 'Request RT',
    metricName: 'login', source: 'performance-metrics', metricsSourceId: 'ms-1',
  });
  expect(series[1]).toMatchObject({
    dashboardId: 'dash-2', dashboardLabel: 'JVM', panelId: 5, panelTitle: 'Heap',
    metricName: 'used', source: 'grafana', metricsSourceId: 'ms-2',
  });
  expect(showToast).toHaveBeenCalledWith('Added 2 series to comparison');
});

it('does not add a series that is already in the comparison', () => {
  const { result, setAddedSeries, showToast } = setup([
    { id: 'x', dashboardId: 'dash-2', dashboardLabel: 'JVM', panelId: 5,
      panelTitle: 'Heap', metricName: 'used', source: 'grafana' } as CompareSeries,
  ]);

  result.current.handleAddSeries([
    { dashboard: jvmDashboard, panel: panelOf(jvmDashboard, 5, 'Heap'), metricName: 'used' },
  ]);

  expect(setAddedSeries).not.toHaveBeenCalled();
  expect(showToast).toHaveBeenCalledWith('Selected series already added');
});

it('stores "All aggregated" under its aggregated name and flags it', () => {
  const { result, setAddedSeries } = setup();

  result.current.handleAddSeries([
    { dashboard: perfDashboard, panel: panelOf(perfDashboard, 201, 'Request RT'), metricName: ALL_AGGREGATED_OPTION },
  ]);

  const series = added(setAddedSeries);
  expect(series[0]!.isAggregated).toBe(true);
  expect(series[0]!.metricName).toContain('Request RT');
  expect(series[0]!.metricName).not.toBe(ALL_AGGREGATED_OPTION);
});
