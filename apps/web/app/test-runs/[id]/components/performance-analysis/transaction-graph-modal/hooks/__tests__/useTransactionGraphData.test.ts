/**
 * Tests for useTransactionGraphData — server-picked aggregation bucket.
 *
 * A 3 h run at the 5 s floor returned 2180 points per series and an 11.8 MB
 * response. The hook now omits aggregationSeconds so the API picks one from the
 * run duration, and reports the server's choice back to the chart — which
 * divides counts by it to get throughput, so a stale 5 would be 12x wrong.
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { useTransactionGraphData } from '../useTransactionGraphData';
import { authenticatedFetch } from '@/lib/api';
import { AGGREGATION_OPTIONS } from '../../utils';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

const response = (aggregationSeconds: number) =>
  ({
    ok: true,
    status: 200,
    json: async () => ({
      transaction_data: [
        {
          time_bucket: '2026-08-28T03:00:00.000Z',
          avg_response_time: 12,
          median_response_time: 12,
          min_response_time: 12,
          max_response_time: 12,
          p90_response_time: 12,
          p95_response_time: 12,
          p99_response_time: 12,
          total_count: 3,
          passed_count: 3,
          failed_count: 0,
        },
      ],
      sampler_data: {},
      aggregation_seconds: aggregationSeconds,
    }),
  }) as Response;

const render = () =>
  renderHook(() =>
    useTransactionGraphData({
      open: true,
      testRunId: 'run-1',
      transactionName: 'VacWijzig_03_Vacatures',
      onClose: jest.fn(),
    }),
  );

const urlOf = (call: number) => mockFetch.mock.calls[call]![0] as string;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('useTransactionGraphData', () => {
  it('omits aggregationSeconds on the first fetch so the server picks one', async () => {
    mockFetch.mockResolvedValue(response(60));
    const { result } = render();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(urlOf(0)).not.toContain('aggregationSeconds');
  });

  it("reports the server's choice, not the 5s floor", async () => {
    mockFetch.mockResolvedValue(response(60));
    const { result } = render();

    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.aggregationSeconds).toBe(60);
  });

  it('does not refetch after adopting the server value', async () => {
    // Regression: storing the adopted value in the state that drives the fetch
    // triggered a second full round trip for the same chart.
    mockFetch.mockResolvedValue(response(60));
    const { result } = render();

    await waitFor(() => expect(result.current.data).not.toBeNull());
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('sends the explicit value once the user picks one, and it wins', async () => {
    mockFetch.mockResolvedValue(response(60));
    const { result } = render();
    await waitFor(() => expect(result.current.data).not.toBeNull());

    mockFetch.mockResolvedValue(response(5));
    act(() => {
      result.current.handleAggregationChange({
        target: { value: 5 },
      } as unknown as Parameters<typeof result.current.handleAggregationChange>[0]);
    });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(urlOf(1)).toContain('aggregationSeconds=5');
    await waitFor(() => expect(result.current.aggregationSeconds).toBe(5));
  });

  it('falls back to 5 when the fetch fails, instead of reporting undefined', async () => {
    // No data means nothing to derive the bucket from; the returned value is
    // typed number and feeds a division, so it must not go undefined/NaN.
    mockFetch.mockResolvedValue({ ok: false, status: 500 } as Response);
    const { result } = render();

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.data).toBeNull();
    expect(result.current.aggregationSeconds).toBe(5);
  });

  it('falls back to 5 when the response omits aggregation_seconds', async () => {
    // A web build talking to an API that predates the echoed field (rolling
    // deploy) must still divide by something.
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ transaction_data: [], sampler_data: {} }),
    } as Response);
    const { result } = render();

    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.aggregationSeconds).toBe(5);
  });

  it('ignores a stale response that lands after a newer one', async () => {
    // Regression: the bucket choices span 5s..300s, so the 300s response (tiny)
    // routinely lands before a 5s one (60x larger) issued first. Last-write-wins
    // on arrival paired the 5s data with a 300s divisor — throughput 60x low,
    // and stuck that way.
    let releaseSlow: (r: Response) => void = () => {};
    const slow = new Promise<Response>((res) => {
      releaseSlow = res;
    });
    mockFetch.mockReturnValueOnce(slow as unknown as Promise<Response>);
    const { result } = render();

    // Second request issued while the first is still in flight, and it wins.
    mockFetch.mockResolvedValueOnce(response(300));
    act(() => {
      result.current.handleAggregationChange({
        target: { value: 300 },
      } as unknown as Parameters<typeof result.current.handleAggregationChange>[0]);
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    const fresh = result.current.data;

    // Now the stale 5s response finally arrives. It must be dropped.
    // Release inside an async act so the fetch -> json -> setState chain fully
    // flushes; a bare setTimeout outside act does not, and the test then passes
    // with the guard removed (verified).
    await act(async () => {
      releaseSlow(response(5));
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(result.current.data).toBe(fresh);
    expect(result.current.data?.aggregation_seconds).toBe(300);
    expect(result.current.aggregationSeconds).toBe(300);
  });

  it('offers every bucket the server can pick, or the Select renders blank', async () => {
    const offered = AGGREGATION_OPTIONS.map((o) => o.value);
    // Mirrors AGGREGATION_LADDER in test-runs-timeseries-query.service.ts.
    expect(offered).toEqual(
      expect.arrayContaining([5, 10, 15, 20, 30, 60, 120, 180, 300]),
    );
  });
});
