// Value: protects=switching the comparison run back to one already loaded shows THAT run's configs
// (a comment's Restore view and its Undo depend on it), and a slower answer for a run picked
// earlier never overwrites the run on screen; fails_when=the per-run cache is dropped (the attempt
// guard then skips the fetch and leaves the last run's configs under the new name) or the
// stale-answer check goes; why_new=Restore view + Undo made switching back routine; seam=the fetch
// is mocked at @/lib/api; no_claim=the comparison rules (comparison-formatters).
import { act, renderHook, waitFor } from '@testing-library/react';
import { useConfigComparison } from '../useConfigComparison';
import { authenticatedFetch } from '@/lib/api';

jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('system=s&environment=e&workload=w') }));
jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));

const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
const cfg = (value: string) => [{ key: 'heap.max', value, tags: [] }];

const answers: Record<string, () => Promise<Response>> = {};
beforeEach(() => {
  for (const k of Object.keys(answers)) delete answers[k];
  answers['/test-runs/run/configs'] = () => ok(cfg('512m'));
  answers['/test-runs/run/related'] = () => ok([
    { test_run_id: 'A', created_at: '2026-01-02T00:00:00Z', completed: true },
    { test_run_id: 'B', created_at: '2026-01-01T00:00:00Z', completed: true },
  ]);
  answers['/test-runs/A/configs'] = () => ok(cfg('2g'));
  answers['/test-runs/B/configs'] = () => ok(cfg('1g'));
  answers['/test-runs/expected-config-changes'] = () => ok([]);
  (authenticatedFetch as jest.Mock).mockImplementation((url: string) => answers[url.split('?')[0]!]!());
});

const testRun = { id: 'r', created_at: '2026-02-01T00:00:00Z' } as never;
const previous = (r: { current: ReturnType<typeof useConfigComparison> }) => r.current.configComparisons[0]?.previousValue;

it('shows each run’s own configs when switching back and forth', async () => {
  const { result } = renderHook(() => useConfigComparison({ testRun, testRunId: 'run', configExpanded: true, showToast: jest.fn() }));
  await waitFor(() => expect(result.current.comparisonReady).toBe(true));
  expect(result.current.selectedRelatedTestRun).toBe('A');
  expect(previous(result)).toBe('2g');
  act(() => result.current.handleRelatedTestRunChange('B'));
  await waitFor(() => expect(previous(result)).toBe('1g'));
  act(() => result.current.handleRelatedTestRunChange('A'));
  await waitFor(() => expect(previous(result)).toBe('2g'));
  expect(result.current.comparisonReady).toBe(true);
});

it('drops a slower answer for a run that is no longer picked', async () => {
  let releaseB: () => void = () => undefined;
  answers['/test-runs/B/configs'] = () => new Promise((resolve) => { releaseB = () => resolve({ ok: true, status: 200, json: async () => cfg('1g') } as Response); });
  const { result } = renderHook(() => useConfigComparison({ testRun, testRunId: 'run', configExpanded: true, showToast: jest.fn() }));
  await waitFor(() => expect(result.current.comparisonReady).toBe(true));
  act(() => result.current.handleRelatedTestRunChange('B'));
  act(() => result.current.handleRelatedTestRunChange('A'));
  await act(async () => releaseB());
  expect(result.current.selectedRelatedTestRun).toBe('A');
  expect(previous(result)).toBe('2g');
  expect(result.current.comparisonReady).toBe(true);
});
