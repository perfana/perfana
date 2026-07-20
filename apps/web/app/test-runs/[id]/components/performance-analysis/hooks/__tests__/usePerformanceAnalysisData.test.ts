/**
 * Tests for usePerformanceAnalysisData — live refresh of expanded request rows.
 *
 * Bug: during a running test, refreshAll() updated the transaction figures but
 * the sampler (request) figures of expanded rows stayed frozen at their
 * expand-time values because rowSamples was cached and never refetched.
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { usePerformanceAnalysisData } from '../usePerformanceAnalysisData';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status < 300, status, json: async () => body }) as Response;

const transaction = (overrides: Record<string, unknown> = {}) => ({
  transaction_name: 'checkout',
  scenario_name: 'main',
  total_count: 100,
  failed_count: 0,
  apdex_score: 0.9,
  ...overrides,
});

const sample = (avg: number) => ({
  sampler_name: 'POST /checkout',
  transaction_name: 'checkout',
  total_count: 50,
  failed_count: 0,
  avg_response_time: avg,
});

const runningTestRun = {
  id: 'run-1',
  completed: false,
  start_time: '2026-07-20T10:00:00Z',
  updated_at: '2026-07-20T10:05:00Z',
} as unknown as TestRun;

describe('usePerformanceAnalysisData — expanded row samples on refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/samples')) return jsonResponse([sample(100)]);
      if (url.includes('/transactions')) return jsonResponse([transaction()]);
      if (url.includes('/apdex-threshold')) return jsonResponse({ apdex_threshold: 500 });
      if (url.includes('/virtual-users')) return jsonResponse({ max: 10 });
      if (url.includes('/throughput')) return jsonResponse({ avg: 5 });
      return jsonResponse({});
    });
  });

  it('refetches samples for expanded rows when refreshAll is called', async () => {
    const { result } = renderHook(() =>
      usePerformanceAnalysisData({ testRunId: 'run-1', testRun: runningTestRun })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Expand a row — samples fetched once
    await act(async () => {
      await result.current.handleRowClick('checkout');
    });
    expect(result.current.rowSamples['checkout']).toEqual([sample(100)]);

    // Backend now has newer figures
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/samples')) return jsonResponse([sample(250)]);
      if (url.includes('/transactions')) return jsonResponse([transaction({ total_count: 200 })]);
      return jsonResponse({});
    });

    await act(async () => {
      result.current.refreshAll();
    });

    await waitFor(() => {
      expect(result.current.rowSamples['checkout']).toEqual([sample(250)]);
    });
  });

  it('sets samplesError and clears the spinner when the expand-time fetch fails', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/samples')) return jsonResponse({ message: 'boom' }, 500);
      if (url.includes('/transactions')) return jsonResponse([transaction()]);
      return jsonResponse({});
    });

    const { result } = renderHook(() =>
      usePerformanceAnalysisData({ testRunId: 'run-1', testRun: runningTestRun })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleRowClick('checkout');
    });

    expect(result.current.samplesError['checkout']).toBeTruthy();
    expect(result.current.loadingSamples['checkout']).toBe(false);
    expect(result.current.rowSamples['checkout']).toBeUndefined();
  });

  it('keeps existing sample data when a background refresh fails', async () => {
    const { result } = renderHook(() =>
      usePerformanceAnalysisData({ testRunId: 'run-1', testRun: runningTestRun })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleRowClick('checkout');
    });
    expect(result.current.rowSamples['checkout']).toEqual([sample(100)]);

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/samples')) return jsonResponse({ message: 'boom' }, 500);
      return jsonResponse([]);
    });

    await act(async () => {
      result.current.refreshAll();
    });

    // Old figures remain on screen — no error banner over valid data, no spinner
    expect(result.current.rowSamples['checkout']).toEqual([sample(100)]);
    expect(result.current.samplesError['checkout']).toBeFalsy();
    expect(result.current.loadingSamples['checkout']).toBeFalsy();
  });

  it('dedupes in-flight sampler fetches so refreshes cannot pile up', async () => {
    const { result } = renderHook(() =>
      usePerformanceAnalysisData({ testRunId: 'run-1', testRun: runningTestRun })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleRowClick('checkout');
    });
    const samplesCallsBefore = mockFetch.mock.calls.filter(c => String(c[0]).includes('/samples')).length;

    // Keep the next samples request hanging, then fire two refreshes
    let resolveHanging!: (r: Response) => void;
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/samples')) return new Promise<Response>(res => { resolveHanging = res; });
      return jsonResponse([]);
    });

    await act(async () => {
      result.current.refreshAll();
      result.current.refreshAll();
    });

    const samplesCallsAfter = mockFetch.mock.calls.filter(c => String(c[0]).includes('/samples')).length;
    expect(samplesCallsAfter - samplesCallsBefore).toBe(1);

    await act(async () => {
      resolveHanging(jsonResponse([sample(999)]));
    });
    await waitFor(() => {
      expect(result.current.rowSamples['checkout']).toEqual([sample(999)]);
    });
  });

  it('does not show the loading spinner when refreshing already-loaded samples', async () => {
    const { result } = renderHook(() =>
      usePerformanceAnalysisData({ testRunId: 'run-1', testRun: runningTestRun })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleRowClick('checkout');
    });

    let resolveSamples!: (r: Response) => void;
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/samples')) return new Promise<Response>(res => { resolveSamples = res; });
      return jsonResponse([]);
    });

    await act(async () => {
      result.current.refreshAll();
    });

    // Refresh in flight — existing data still shown, no spinner
    expect(result.current.loadingSamples['checkout']).toBeFalsy();
    expect(result.current.rowSamples['checkout']).toEqual([sample(100)]);

    await act(async () => {
      resolveSamples(jsonResponse([sample(300)]));
    });
    await waitFor(() => {
      expect(result.current.rowSamples['checkout']).toEqual([sample(300)]);
    });
  });
});
