/**
 * Tests for useCompareHandlers — URL panel injection on interactive dashboard select (Fix wave 1).
 *
 * Covers:
 * - `handleDashboardSelect` injects virtual URL panels (210-218) alongside the
 *   ds-metrics/available panels when a performance-metrics dashboard is selected.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { useCompareHandlers } from './useCompareHandlers';
import { ApplicationDashboard } from '../types';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));

import { authenticatedFetch } from '@/lib/api';

const testRun = {
  test_run_id: 'run-1',
  system_under_test_id: 'sut-1',
  test_environment: 'acc',
  workload: 'load',
  systems_under_test: { name: 'sut' },
} as any;

const perfDashboard: ApplicationDashboard = {
  id: 'dash-1',
  dashboard_label: 'Perf',
  dashboard_name: 'Perf',
  dashboard_uid: 'perf-uid',
  source_type: 'performance_test',
};

function setup() {
  const setPanels = jest.fn();
  const props = {
    testRun,
    testRunId: 'run-1',
    showToast: jest.fn(),
    selectedSource: 'grafana' as any,
    selectedDashboard: null,
    selectedMetric: null,
    selectedMetricNames: [],
    addedSeries: [],
    selectedTestRun: null,
    showGraphs: {},
    setSelectedSource: jest.fn(),
    setSelectedDashboard: jest.fn(),
    setSelectedMetric: jest.fn(),
    setPanels,
    setDynatraceMetrics: jest.fn(),
    setAvailableMetrics: jest.fn(),
    setSelectedMetricNames: jest.fn(),
    setAddedSeries: jest.fn(),
    setMetricComparisons: jest.fn(),
    setCurrentMetrics: jest.fn(),
    setSelectedMetrics: jest.fn(),
    setShowGraphs: jest.fn(),
    setGraphData: jest.fn(),
    setGraphLoading: jest.fn(),
    fetchDashboardPanels: jest.fn().mockResolvedValue([]),
    fetchDynatraceMetricsList: jest.fn().mockResolvedValue(undefined),
    fetchPanelMetrics: jest.fn().mockResolvedValue([]),
  };
  const { result } = renderHook(() => useCompareHandlers(props));
  return { result, setPanels };
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('injects URL panels alongside ds-metrics panels for a performance-metrics dashboard', async () => {
  (authenticatedFetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => [
      { dashboard_label: 'Perf', panel_title: 'Request RT Avg', panel_id: 201, unit: 'ms' },
      { dashboard_label: 'Perf', panel_title: 'Request RT P90', panel_id: 202, unit: 'ms' },
    ],
  });

  const { result, setPanels } = setup();

  result.current.handleDashboardSelect(perfDashboard);

  await waitFor(() => expect(setPanels).toHaveBeenCalled());
  await waitFor(() => {
    const lastCallPanels = setPanels.mock.calls[setPanels.mock.calls.length - 1][0];
    expect(lastCallPanels.some((p: any) => p.id === 210)).toBe(true);   // URL panel injected
    expect(lastCallPanels.some((p: any) => p.id === 201)).toBe(true);   // Avg request panel kept ("Request RT")
    expect(lastCallPanels.some((p: any) => p.id === 202)).toBe(false);  // P90 collapsed away
  });
});
