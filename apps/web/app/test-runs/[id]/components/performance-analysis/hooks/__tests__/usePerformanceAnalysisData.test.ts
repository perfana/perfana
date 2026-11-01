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

const defaultApi = async (url: string) => {
  if (url.includes('/samples')) return jsonResponse([sample(100)]);
  if (url.includes('/transactions')) return jsonResponse([transaction()]);
  if (url.includes('/apdex-threshold')) return jsonResponse({ apdex_threshold: 500 });
  if (url.includes('/virtual-users')) return jsonResponse({ max: 10 });
  if (url.includes('/throughput')) return jsonResponse({ avg: 5 });
  return jsonResponse({});
};

describe('usePerformanceAnalysisData — expanded row samples on refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockImplementation(defaultApi);
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

describe('usePerformanceAnalysisData — live auto-refresh interval', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    // The picked period is remembered per browser; start every case from the default.
    localStorage.clear();
    mockFetch.mockImplementation(defaultApi);
  });
  afterEach(() => jest.useRealTimers());

  const transactionFetches = () =>
    mockFetch.mock.calls.filter(([url]) => String(url).includes('/transactions?')).length;

  it('refetches every 30 s by default and stops when set to Off', async () => {
    const { result } = renderHook(() =>
      usePerformanceAnalysisData({ testRunId: 'run-1', testRun: runningTestRun })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.refreshIntervalMs).toBe(30_000);
    const initial = transactionFetches();

    await act(async () => { jest.advanceTimersByTime(30_000); });
    expect(transactionFetches()).toBe(initial + 1);

    act(() => result.current.setRefreshIntervalMs(0));
    await act(async () => { jest.advanceTimersByTime(300_000); });
    expect(transactionFetches()).toBe(initial + 1);
  });

  it('does not auto-refresh a completed run', async () => {
    const { result } = renderHook(() =>
      usePerformanceAnalysisData({
        testRunId: 'run-1',
        testRun: { ...runningTestRun, completed: true } as TestRun,
      })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const initial = transactionFetches();

    await act(async () => { jest.advanceTimersByTime(300_000); });
    expect(transactionFetches()).toBe(initial);
  });

  const sampleFetches = () =>
    mockFetch.mock.calls.filter(([url]) => String(url).includes('/samples')).length;

  // Value: protects=a >=5 s transactions fetch pauses the live timer, and a fast manual refresh resumes it; fails_when=autoRefreshDisabled leaves the effect guard or deps, or the pause latches; why_new=the other timer tests only use instant fetches; seam=none; no_claim=does not check the card's paused tooltip
  it('pauses after a slow fetch and resumes after a fast manual refresh', async () => {
    let slow = true;
    mockFetch.mockImplementation(async (url: string) => {
      if (slow && url.includes('/transactions?')) {
        await new Promise((resolve) => setTimeout(resolve, 6_000));
      }
      return defaultApi(url);
    });
    const { result } = renderHook(() =>
      usePerformanceAnalysisData({ testRunId: 'run-1', testRun: runningTestRun })
    );

    await act(async () => { jest.advanceTimersByTime(6_000); });
    await waitFor(() => expect(result.current.autoRefreshDisabled).toBe(true));
    const paused = transactionFetches();

    await act(async () => { jest.advanceTimersByTime(300_000); });
    expect(transactionFetches()).toBe(paused);

    // The manual refresh button calls refreshAll; a fast answer lifts the pause.
    slow = false;
    await act(async () => { result.current.refreshAll(); });
    await waitFor(() => expect(result.current.autoRefreshDisabled).toBe(false));
    const resumed = transactionFetches();

    await act(async () => { jest.advanceTimersByTime(30_000); });
    expect(transactionFetches()).toBe(resumed + 1);
  });

  // Value: protects=a row expand neither restarts the live timer nor is missed by its next tick; fails_when=refreshAll goes into the timer effect's deps, or refreshAllRef stops tracking the latest refreshAll; why_new=other tests call refreshAll by hand, never via the timer; seam=none; no_claim=does not cover window/filter changes, which refetch through the mount effect
  it('keeps its cadence across a row expand and refreshes that row on the next tick', async () => {
    const { result } = renderHook(() =>
      usePerformanceAnalysisData({ testRunId: 'run-1', testRun: runningTestRun })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const initial = transactionFetches();

    await act(async () => { jest.advanceTimersByTime(20_000); });
    await act(async () => { await result.current.handleRowClick('checkout'); });
    expect(result.current.rowSamples['checkout']).toEqual([sample(100)]);
    const samplesAfterExpand = sampleFetches();

    // 30 s after mount, not 30 s after the expand.
    await act(async () => { jest.advanceTimersByTime(10_000); });
    expect(transactionFetches()).toBe(initial + 1);
    expect(sampleFetches()).toBe(samplesAfterExpand + 1);
  });

  // Value: protects=Off means no automatic refetch, including when the run's updated_at changes over the WebSocket; fails_when=the removed updated_at-driven refetch effect comes back, e.g. through a bad merge; why_new=the Off test never changes updated_at; seam=none; no_claim=does not check timer cadence
  it('does not refetch on a test-run update while auto-refresh is Off', async () => {
    const { result, rerender } = renderHook(
      ({ testRun }: { testRun: TestRun }) => usePerformanceAnalysisData({ testRunId: 'run-1', testRun }),
      { initialProps: { testRun: runningTestRun } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setRefreshIntervalMs(0));
    const initial = transactionFetches();

    rerender({ testRun: { ...runningTestRun, updated_at: '2026-07-20T10:06:00Z' } as TestRun });
    rerender({ testRun: { ...runningTestRun, updated_at: '2026-07-20T10:07:00Z' } as TestRun });
    await act(async () => { jest.advanceTimersByTime(60_000); });
    expect(transactionFetches()).toBe(initial);
  });

  // Value: protects=a live run that completes on screen ends on freshly fetched final figures, and the timer stops; fails_when=the completion transition only resets sinceMinutes, or isRunning leaves the timer deps; why_new=no test completes a run while mounted; seam=none; no_claim=does not cover the post-test rollup (202) path
  it('refetches once when the run completes on screen, then stops the timer', async () => {
    const { result, rerender } = renderHook(
      ({ testRun }: { testRun: TestRun }) => usePerformanceAnalysisData({ testRunId: 'run-1', testRun }),
      { initialProps: { testRun: runningTestRun } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const beforeComplete = transactionFetches();

    rerender({ testRun: { ...runningTestRun, completed: true } as TestRun });
    await waitFor(() => expect(transactionFetches()).toBe(beforeComplete + 1));

    await act(async () => { jest.advanceTimersByTime(300_000); });
    expect(transactionFetches()).toBe(beforeComplete + 1);
  });

  // Value: protects=a slow older /transactions answer never overwrites the newer one a window change asked for, nor latches the slow-fetch pause; fails_when=fetchTransactions writes state without checking it is still the latest request; why_new=other tests use one fetch at a time; seam=none; no_claim=timer ticks never supersede (livelock test)
  it('ignores an older slow answer that lands after a newer one', async () => {
    let n = 0;
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/transactions?')) {
        const call = ++n;
        if (call === 1) await new Promise((resolve) => setTimeout(resolve, 12_000));
        return jsonResponse([transaction({ transaction_name: `call-${call}` })]);
      }
      return defaultApi(url);
    });
    const { result } = renderHook(() =>
      usePerformanceAnalysisData({ testRunId: 'run-1', testRun: runningTestRun })
    );
    // A window change while the mount request is out supersedes it (timer ticks wait).
    await act(async () => { await jest.advanceTimersByTimeAsync(2_000); });
    act(() => result.current.setSinceMinutes(5));

    // The async variant settles each answer completely before the next timer, so the
    // older answer's state writes have all run before the assertions.
    await act(async () => { await jest.advanceTimersByTimeAsync(10_000); });
    expect(n).toBe(2);
    expect(result.current.loading).toBe(false);
    expect(result.current.transactions.map((t) => t.transaction_name)).toEqual(['call-2']);
    expect(result.current.autoRefreshDisabled).toBe(false);
  });

  // Value: protects=picking a rate while auto-refresh is paused by a slow fetch resumes it at that rate; fails_when=changing the rate leaves the pause in place, so the dropdown shows a cadence not in effect; why_new=the pause test only resumes through a manual refresh; seam=none; no_claim=does not cover the Off choice
  it('resumes a paused timer when a new rate is picked', async () => {
    let slow = true;
    mockFetch.mockImplementation(async (url: string) => {
      if (slow && url.includes('/transactions?')) await new Promise((resolve) => setTimeout(resolve, 6_000));
      return defaultApi(url);
    });
    const { result } = renderHook(() =>
      usePerformanceAnalysisData({ testRunId: 'run-1', testRun: runningTestRun })
    );
    await act(async () => { jest.advanceTimersByTime(6_000); });
    await waitFor(() => expect(result.current.autoRefreshDisabled).toBe(true));

    slow = false;
    act(() => result.current.setRefreshIntervalMs(10_000));
    const picked = transactionFetches();
    await act(async () => { jest.advanceTimersByTime(10_000); });
    expect(transactionFetches()).toBe(picked + 1);
  });

  // Value: protects=the picked period survives a remount (tab switch, prev/next run) and a stale stored value falls back to 30 s; fails_when=the choice is not persisted, or an unknown stored value reaches the Select and renders it blank; why_new=no test remounts the hook; seam=none; no_claim=does not cover storage that throws
  it('remembers the picked period across remounts and ignores a value the dropdown does not offer', async () => {
    const first = renderHook(() => usePerformanceAnalysisData({ testRunId: 'run-1', testRun: runningTestRun }));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    act(() => first.result.current.setRefreshIntervalMs(300_000));
    first.unmount();

    const second = renderHook(() => usePerformanceAnalysisData({ testRunId: 'run-1', testRun: runningTestRun }));
    expect(second.result.current.refreshIntervalMs).toBe(300_000);
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    second.unmount();

    localStorage.setItem('perfana.performanceAnalysis.refreshIntervalMs', '12345');
    const third = renderHook(() => usePerformanceAnalysisData({ testRunId: 'run-1', testRun: runningTestRun }));
    expect(third.result.current.refreshIntervalMs).toBe(30_000);
    await waitFor(() => expect(third.result.current.loading).toBe(false));
    third.unmount();

    // Number('') is 0, which is Off: a blank stored value must not switch live refresh off.
    for (const blank of ['', '  ']) {
      localStorage.setItem('perfana.performanceAnalysis.refreshIntervalMs', blank);
      const blankMount = renderHook(() => usePerformanceAnalysisData({ testRunId: 'run-1', testRun: runningTestRun }));
      expect(blankMount.result.current.refreshIntervalMs).toBe(30_000);
      await waitFor(() => expect(blankMount.result.current.loading).toBe(false));
      blankMount.unmount();
    }
  });

  // Value: protects=every successful refresh moves the last-updated time, so a refresh is visible even when the figures did not change; fails_when=lastUpdatedAt is set once, or not on timer refreshes; why_new=nothing exposed refresh time before; seam=none; no_claim=does not check the label text (card test)
  it('moves lastUpdatedAt forward on each timer refresh', async () => {
    const { result } = renderHook(() =>
      usePerformanceAnalysisData({ testRunId: 'run-1', testRun: runningTestRun })
    );
    await waitFor(() => expect(result.current.lastUpdatedAt).not.toBeNull());
    const first = result.current.lastUpdatedAt!.getTime();

    await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
    expect(result.current.lastUpdatedAt!.getTime()).toBeGreaterThan(first);
  });

  // Value: protects=a run completing while "Last N minutes" is picked ends on whole-run figures, fetched once; fails_when=completion refetches with the stale window or leaves sinceMinutes set; why_new=the completion test starts from the whole-run default; seam=none; no_claim=does not cover the 202 rollup path
  it('switches to whole-run figures, fetched once, when the run completes with a time window picked', async () => {
    const lastTransactionsUrl = () => {
      const calls = mockFetch.mock.calls.filter(([url]) => String(url).includes('/transactions?'));
      return String(calls[calls.length - 1]?.[0]);
    };
    const { result, rerender } = renderHook(
      ({ testRun }: { testRun: TestRun }) => usePerformanceAnalysisData({ testRunId: 'run-1', testRun }),
      { initialProps: { testRun: runningTestRun } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setSinceMinutes(5));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(lastTransactionsUrl()).toContain('sinceMinutes=5');
    const beforeComplete = transactionFetches();

    rerender({ testRun: { ...runningTestRun, completed: true } as TestRun });
    await act(async () => { await jest.advanceTimersByTimeAsync(0); });
    expect(result.current.sinceMinutes).toBeNull();
    expect(transactionFetches()).toBe(beforeComplete + 1);
    expect(lastTransactionsUrl()).not.toContain('sinceMinutes');
  });

  // Value: protects=an older request failing after a newer one succeeded leaves the newer figures and no error banner; fails_when=the catch block writes error/empty rows without the staleness check; why_new=the stale-answer test covers an older 200 only; seam=none; no_claim=does not cover the 202 path
  it('ignores an older request that fails after a newer one succeeded', async () => {
    let n = 0;
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/transactions?')) {
        const call = ++n;
        if (call === 1) {
          await new Promise((resolve) => setTimeout(resolve, 12_000));
          throw new Error('network down');
        }
        return jsonResponse([transaction({ transaction_name: `call-${call}` })]);
      }
      return defaultApi(url);
    });
    const { result } = renderHook(() =>
      usePerformanceAnalysisData({ testRunId: 'run-1', testRun: runningTestRun })
    );
    // A window change at 2 s answers at once; the mount request fails at 12 s, after it.
    await act(async () => { await jest.advanceTimersByTimeAsync(2_000); });
    act(() => result.current.setSinceMinutes(5));
    await act(async () => { await jest.advanceTimersByTimeAsync(10_000); });
    expect(n).toBe(2);
    expect(result.current.error).toBeNull();
    expect(result.current.transactions.map((t) => t.transaction_name)).toEqual(['call-2']);
  });

  // Value: protects=the hook still mounts and a picked rate still applies when localStorage throws (private window, blocked site data); fails_when=the try/catch around getItem or setItem is dropped; why_new=the remount test uses working storage; seam=none; no_claim=does not claim the choice survives a remount
  it('falls back to 30 s and still applies a picked rate when storage throws', async () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      const { result } = renderHook(() =>
        usePerformanceAnalysisData({ testRunId: 'run-1', testRun: runningTestRun })
      );
      expect(getItem).toHaveBeenCalled();
      expect(result.current.refreshIntervalMs).toBe(30_000);
      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => result.current.setRefreshIntervalMs(10_000));
      expect(setItem).toHaveBeenCalled();
      expect(result.current.refreshIntervalMs).toBe(10_000);
      const picked = transactionFetches();
      await act(async () => { await jest.advanceTimersByTimeAsync(10_000); });
      expect(transactionFetches()).toBe(picked + 1);
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  // Value: protects=a run in post-test rollup leaves the pending state with rows once the 5 s poll gets a 200; fails_when=the 200 path stops clearing rollupPending (this diff moved that line); why_new=no hook test answers 202; seam=none; no_claim=does not cover a stale 202
  it('clears rollup-pending and shows rows once the poll gets a 200', async () => {
    let pending = true;
    mockFetch.mockImplementation(async (url: string) => {
      if (pending && url.includes('/transactions?')) {
        return jsonResponse({ progress: { stageName: 'rollup', stageIndex: 1, totalStages: 2 } }, 202);
      }
      return defaultApi(url);
    });
    const { result } = renderHook(() =>
      usePerformanceAnalysisData({
        testRunId: 'run-1',
        testRun: { ...runningTestRun, completed: true } as TestRun,
      })
    );
    await waitFor(() => expect(result.current.rollupPending).not.toBeNull());
    expect(result.current.transactions).toEqual([]);

    pending = false;
    await act(async () => { await jest.advanceTimersByTimeAsync(5_000); });
    expect(result.current.rollupPending).toBeNull();
    expect(result.current.transactions.map((t) => t.transaction_name)).toEqual(['checkout']);
  });

  // Value: protects=when every /transactions answer is slower than the period, an answer still lands and the slow-fetch pause engages; fails_when=timer ticks supersede the request still out, so every answer is stale (livelock); why_new=other tests answer faster than the period; seam=none; no_claim=does not cover /virtual-users or /throughput
  it('lands an answer and pauses when every answer is slower than the period', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/transactions?')) await new Promise((resolve) => setTimeout(resolve, 12_000));
      return defaultApi(url);
    });
    const { result } = renderHook(() =>
      usePerformanceAnalysisData({ testRunId: 'run-1', testRun: runningTestRun })
    );
    act(() => result.current.setRefreshIntervalMs(10_000));

    // Split at the 12 s answer: React commits the pause between the two acts, as it
    // would in a browser well before the next tick; inside one act it would not.
    await act(async () => { await jest.advanceTimersByTimeAsync(12_000); });
    await act(async () => { await jest.advanceTimersByTimeAsync(48_000); });
    expect(result.current.loading).toBe(false);
    expect(result.current.transactions.map((t) => t.transaction_name)).toEqual(['checkout']);
    expect(result.current.autoRefreshDisabled).toBe(true);
    expect(transactionFetches()).toBe(1);
  });

  // Value: protects=a completed run leaves rollup-pending even when every poll answer takes longer than the 5 s poll; fails_when=the poll supersedes the request still out, so no 200 ever lands (regression vs origin/main); why_new=the rollup test answers at once; seam=none; no_claim=does not cover a rollup that never finishes
  it('leaves rollup-pending even when every poll answer takes longer than 5 s', async () => {
    let pending = true;
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/transactions?')) {
        await new Promise((resolve) => setTimeout(resolve, 6_000));
        if (pending) return jsonResponse({ progress: { stageName: 'rollup', stageIndex: 1, totalStages: 2 } }, 202);
      }
      return defaultApi(url);
    });
    const { result } = renderHook(() =>
      usePerformanceAnalysisData({ testRunId: 'run-1', testRun: { ...runningTestRun, completed: true } as TestRun })
    );
    await act(async () => { await jest.advanceTimersByTimeAsync(6_000); });
    expect(result.current.rollupPending).not.toBeNull();

    pending = false;
    await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
    expect(result.current.rollupPending).toBeNull();
    expect(result.current.transactions.map((t) => t.transaction_name)).toEqual(['checkout']);
  });
});
