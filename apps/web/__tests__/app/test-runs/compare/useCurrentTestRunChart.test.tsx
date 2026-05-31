/**
 * Tests for useCurrentTestRunChart — aggregated metric timeseries fetch branch.
 * Covers the code path added when aggregatedMetricSource is provided.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { useCurrentTestRunChart } from '@/app/test-runs/[id]/components/compare/current-test-run-chart/hooks/useCurrentTestRunChart';
import { authenticatedFetch } from '@/lib/api';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));

jest.mock('@mui/material', () => ({
  alpha: (color: string) => color,
  useTheme: () => ({
    palette: { mode: 'light', primary: { main: '#1976d2' } },
    typography: { fontFamily: 'Roboto, sans-serif' },
  }),
}));

jest.mock(
  '@/app/test-runs/[id]/components/compare/current-test-run-chart/utils',
  () => ({
    DEFAULT_CHART_HEIGHT: 300,
    findDataRange: () => ({ min: 0, max: 100 }),
    calculateUnitConversion: () => ({ factor: 1, yAxisLabel: '' }),
    getChartThemeColors: () => ({}),
    calculateTimeRange: () => ({ start: new Date('2024-01-01T00:00:00Z'), end: new Date('2024-01-01T01:00:00Z') }),
    buildMetricTrace: () => ({}),
    buildThresholdTraces: () => [],
    buildChartLayout: () => ({}),
    buildChartConfig: () => ({}),
  })
);

const baseProps = {
  testRunId: 'tr-1',
  applicationDashboardId: 'app-dash-1',
  panelId: 'panel-1',
  metricName: 'transactions.login.response_time.p95',
  isDrawerOpen: true,
};

const aggregatedMetricSource = { metric: 'transaction_response_time', stat: 'p95' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useCurrentTestRunChart — aggregated fetch branch', () => {
  it('fetches from /aggregated-metric-timeseries when aggregatedMetricSource is set', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        buckets: [
          { time: '2024-01-01T00:00:00Z', value: 120 },
          { time: '2024-01-01T00:01:00Z', value: 135 },
        ],
        bucketSizeSeconds: 60,
      }),
    });

    const { result } = renderHook(() =>
      useCurrentTestRunChart({ ...baseProps, aggregatedMetricSource })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const calledUrl = (authenticatedFetch as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).toContain('/aggregated-metric-timeseries');
    expect(calledUrl).toContain('metric=transaction_response_time');
    expect(calledUrl).toContain('stat=p95');
    expect(result.current.metricsData).toHaveLength(2);
    expect(result.current.metricsData[0]).toMatchObject({
      metric_name: 'transactions.login.response_time.p95',
      time: '2024-01-01T00:00:00Z',
      timestep: 60,
      ramp_up: false,
      value: 120,
    });
    expect(result.current.error).toBeNull();
  });

  it('returns empty metricsData and no error on 404', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });

    const { result } = renderHook(() =>
      useCurrentTestRunChart({ ...baseProps, aggregatedMetricSource })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.metricsData).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('sets error state on non-404 server error', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });

    const { result } = renderHook(() =>
      useCurrentTestRunChart({ ...baseProps, aggregatedMetricSource })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toContain('500');
    expect(result.current.metricsData).toEqual([]);
  });

  it('uses bucketSizeSeconds=60 as fallback when not in response', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ buckets: [{ time: '2024-01-01T00:00:00Z', value: 50 }] }),
    });

    const { result } = renderHook(() =>
      useCurrentTestRunChart({ ...baseProps, aggregatedMetricSource })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.metricsData[0].timestep).toBe(60);
  });

  it('uses Grafana endpoint when aggregatedMetricSource is not set', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [{ metric_name: 'transactions.login.response_time.p95', time: 't', timestep: 30, ramp_up: false, value: 10 }],
    });

    const { result } = renderHook(() => useCurrentTestRunChart(baseProps));

    await waitFor(() => expect(result.current.loading).toBe(false));

    const calledUrl = (authenticatedFetch as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).toContain('/metrics/ds-metrics/');
    expect(calledUrl).not.toContain('aggregated-metric-timeseries');
  });
});
