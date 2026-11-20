// Value: protects=the test-run list's comment badge surviving a realtime update of that run;
// fails_when=onTestRunUpdated replaces the row with the gateway payload again, which carries no counts;
// why_new=no test covered onTestRunUpdated; seam=none; no_claim=the socket itself (useTestRunRealtime mocked)
import { act, renderHook, waitFor } from '@testing-library/react';
import type { TestRun } from '@/types/test-runs';
import { useTestRunsData } from '../useTestRunsData';

let handlers: { onTestRunUpdated?: (run: TestRun) => void } = {};
jest.mock('@/hooks/useTestRunRealtime', () => ({
  useTestRunRealtime: (opts: typeof handlers) => {
    handlers = opts;
    return { connectionStatus: { state: 'connected' }, isLive: true };
  },
}));

const run = { id: 'u1', test_run_id: 'checkout-00001', status: 'RUNNING', comment_count: 3, unread_comments: 2 } as unknown as TestRun;
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(async () => ({ ok: true, json: async () => ({ data: [run], total: 1 }) })),
}));

it('keeps comment_count and unread_comments when a realtime update replaces the row', async () => {
  const { result } = renderHook(() => useTestRunsData({ onSnackbar: jest.fn() }));
  await waitFor(() => expect(result.current.testRuns).toHaveLength(1));

  // The gateway payload: same run, new status, no comment counts.
  act(() => handlers.onTestRunUpdated?.({ id: 'u1', test_run_id: 'checkout-00001', status: 'COMPLETED' } as unknown as TestRun));

  expect(result.current.testRuns[0]).toMatchObject({ status: 'COMPLETED', comment_count: 3, unread_comments: 2 });
});
