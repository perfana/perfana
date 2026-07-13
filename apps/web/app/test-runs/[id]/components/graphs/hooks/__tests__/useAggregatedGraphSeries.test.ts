import { renderHook, act, waitFor } from '@testing-library/react';
import { useAggregatedGraphSeries } from '../useAggregatedGraphSeries';
import { authenticatedFetch } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

function okJson(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

const testRun = { test_run_id: 'run-1' } as never;

describe('useAggregatedGraphSeries', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(
      okJson({ bucketSizeSeconds: 60, buckets: [{ time: '2026-07-13T10:00:00.000Z', value: 100 }] }),
    );
  });

  it('does not fetch or expose the toggle when source is not performance-metrics', async () => {
    const { result } = renderHook(() =>
      useAggregatedGraphSeries({ testRun, testRunId: 'run-1', selectedSource: 'grafana' }),
    );
    expect(result.current.showAggregatedToggle).toBe(false);
    act(() => result.current.setIncludeAggregated(true));
    await waitFor(() => expect(result.current.aggregatedSeries).toHaveLength(0));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fetches the three aggregated metrics when toggled on for a perf-test source', async () => {
    const { result } = renderHook(() =>
      useAggregatedGraphSeries({ testRun, testRunId: 'run-1', selectedSource: 'performance-metrics' }),
    );
    expect(result.current.showAggregatedToggle).toBe(true);

    act(() => result.current.setIncludeAggregated(true));

    await waitFor(() => expect(result.current.aggregatedSeries).toHaveLength(3));
    expect(mockFetch).toHaveBeenCalledTimes(3);
    // Hits the aggregated endpoint with the test_run_id string.
    expect(mockFetch.mock.calls[0][0]).toContain(
      '/test-runs/run-1/aggregated-metric-timeseries?metric=',
    );
    expect(result.current.aggregatedData.get('aggregated-transaction_response_time')).toHaveLength(1);
  });

  it('clears series when toggled back off', async () => {
    const { result } = renderHook(() =>
      useAggregatedGraphSeries({ testRun, testRunId: 'run-1', selectedSource: 'performance-metrics' }),
    );
    act(() => result.current.setIncludeAggregated(true));
    await waitFor(() => expect(result.current.aggregatedSeries).toHaveLength(3));

    act(() => result.current.setIncludeAggregated(false));
    await waitFor(() => expect(result.current.aggregatedSeries).toHaveLength(0));
    expect(result.current.aggregatedData.size).toBe(0);
  });
});
