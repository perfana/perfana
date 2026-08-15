/**
 * Regression test for the degraded path of handleEditSlo.
 *
 * Opening the SLO edit dialog fetches the benchmark by id. When that fetch
 * fails the hook rebuilds a benchmark from the check result so the dialog can
 * still open. That fallback used to drop the scope fields — system, test
 * environment, workload — even though all three sit on the check result it is
 * rebuilding from, so a save from the degraded path would have written a
 * benchmark with no scope.
 */

import { renderHook, act } from '@testing-library/react';
import { useSLOSection } from './useSLOSection';
import type { CheckResult } from '@/lib/types';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

import { authenticatedFetch } from '@/lib/api';
const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

const CHECK_RESULT = {
  id: 'cr-1',
  system_under_test_id: 'sut-42',
  test_environment: 'acc',
  workload: 'load',
  test_run_id: 'run-1',
  source: 'grafana',
  benchmark_id: 'bm-7',
  status: 'ok',
  average_all: false,
  evaluate_type: 'mean',
  exclude_ramp_up_time: true,
  created_at: '2026-08-01T00:00:00Z',
  application_dashboard_id: 'ad-9',
  dashboard_uid: 'uid-3',
  metric_name: 'cpu',
  requirement: { operator: 'lt', value: 80 },
  tags: ['a'],
} as CheckResult;

function renderSloHook() {
  return renderHook(() =>
    useSLOSection({
      testRun: null,
      testRunId: 'run-1',
      sloExpanded: false,
      setSloExpanded: jest.fn(),
    }),
  );
}

describe('useSLOSection — handleEditSlo fallback', () => {
  beforeEach(() => jest.clearAllMocks());

  it('carries the scope fields onto the rebuilt benchmark when the fetch fails', async () => {
    // Benchmark fetch fails, so the hook falls back to rebuilding from the result.
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'boom' } as Response);

    const { result } = renderSloHook();
    await act(async () => {
      await result.current.handleEditSlo(CHECK_RESULT);
    });

    const rebuilt = result.current.selectedSloForEdit;
    expect(rebuilt).not.toBeNull();
    // The three fields the fallback used to drop.
    expect(rebuilt?.system_under_test_id).toBe('sut-42');
    expect(rebuilt?.test_environment).toBe('acc');
    expect(rebuilt?.workload).toBe('load');
    // And the identifiers it always carried.
    expect(rebuilt?.id).toBe('bm-7');
    expect(rebuilt?.requirement_operator).toBe('lt');
    expect(rebuilt?.requirement_value).toBe(80);
  });

  it('uses the fetched benchmark unchanged when the fetch succeeds', async () => {
    const fetched = { id: 'bm-7', system_under_test_id: 'sut-42', workload: 'load' };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(fetched),
    } as Response);

    const { result } = renderSloHook();
    await act(async () => {
      await result.current.handleEditSlo(CHECK_RESULT);
    });

    expect(result.current.selectedSloForEdit).toEqual(fetched);
  });
});
