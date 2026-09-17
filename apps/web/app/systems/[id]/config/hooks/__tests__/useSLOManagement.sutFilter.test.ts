/**
 * Regression test for the SLO list query in the SUT config page.
 *
 * `GET /benchmarks` filters on `systemUnderTestId`. The hook sent `systemId`, which the API
 * ignores, so the list was filtered on environment + workload only and every SUT sharing those
 * names (e.g. three systems all on `acceptatie` / `loadtest_perfana`) showed each other's SLOs.
 */

import { renderHook, act } from '@testing-library/react';
import { useSLOManagement } from '../useSLOManagement';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

import { authenticatedFetch } from '@/lib/api';

const mockAuthFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

describe('useSLOManagement — list is scoped to the system under test', () => {
  it('sends systemUnderTestId, the name the API reads', async () => {
    mockAuthFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) } as unknown as Response);

    const { result } = renderHook(() => useSLOManagement());
    await act(async () => {
      await result.current.fetchBenchmarks('sut-1', 'acc', 'load test');
    });

    const url = new URL(String(mockAuthFetch.mock.calls[0]?.[0]), 'http://x');
    expect(url.pathname).toBe('/benchmarks');
    expect(url.searchParams.get('systemUnderTestId')).toBe('sut-1');
    expect(url.searchParams.get('systemId')).toBeNull();
    expect(url.searchParams.get('testEnvironment')).toBe('acc');
    expect(url.searchParams.get('workload')).toBe('load test');
  });
});
