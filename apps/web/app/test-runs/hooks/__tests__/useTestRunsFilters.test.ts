/**
 * Tests for useTestRunsFilters — cascading filter option loading.
 *
 * Bug: the system / environment / workload dropdowns were populated with ALL
 * distinct values instead of only values that exist in combination with the
 * currently selected filters.
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { useTestRunsFilters } from '../useTestRunsFilters';
import { authenticatedFetch } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as Response;

describe('useTestRunsFilters — cascading filter options', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue(
      jsonResponse({ systems: ['sysA', 'sysB'], environments: ['test', 'prod'], workloads: ['load', 'stress'] })
    );
  });

  it('passes the current selections to the filter-options endpoint and refetches on change', async () => {
    const { result } = renderHook(() => useTestRunsFilters({ organizationId: null }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(mockFetch.mock.calls[0][0]).toBe('/test-runs/filter-options');

    mockFetch.mockResolvedValue(
      jsonResponse({ systems: ['sysA'], environments: ['test', 'prod'], workloads: ['load'] })
    );

    await act(async () => {
      result.current.setEnvironmentFilter('prod');
    });

    await waitFor(() => {
      const urls = mockFetch.mock.calls.map(c => String(c[0]));
      expect(urls.some(u => u.includes('filter-options?') && u.includes('environment=prod'))).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.filterOptions.systems).toEqual(['sysA']);
      expect(result.current.filterOptions.workloads).toEqual(['load']);
    });
  });

  it('drops an out-of-order (stale) response so it cannot clobber newer options', async () => {
    let resolveStale!: (r: Response) => void;
    // First call (initial load) hangs — it will resolve last, as the stale response
    mockFetch.mockImplementationOnce(
      () => new Promise<Response>(res => { resolveStale = res; })
    );

    const { result } = renderHook(() => useTestRunsFilters({ organizationId: null }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    // Second call (triggered by a filter change) resolves immediately with fresh options
    mockFetch.mockResolvedValue(
      jsonResponse({ systems: ['fresh'], environments: ['fresh-env'], workloads: ['fresh-wl'] })
    );
    await act(async () => {
      result.current.setEnvironmentFilter('prod');
    });
    await waitFor(() => {
      expect(result.current.filterOptions.systems).toEqual(['fresh']);
    });

    // Stale response finally arrives — it must be ignored
    await act(async () => {
      resolveStale(jsonResponse({ systems: ['stale'], environments: ['stale-env'], workloads: ['stale-wl'] }));
    });
    expect(result.current.filterOptions.systems).toEqual(['fresh']);
    expect(result.current.filterOptions.workloads).toEqual(['fresh-wl']);
  });

  it('keeps the currently selected value in its own option list even if the API omits it', async () => {
    const { result } = renderHook(() => useTestRunsFilters({ organizationId: null }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    // API no longer returns 'prod' for environments (e.g. after switching system)
    mockFetch.mockResolvedValue(
      jsonResponse({ systems: ['sysA'], environments: ['test'], workloads: ['load'] })
    );

    await act(async () => {
      result.current.setEnvironmentFilter('prod');
    });

    await waitFor(() => {
      expect(result.current.filterOptions.environments).toContain('prod');
      expect(result.current.filterOptions.environments).toContain('test');
    });
  });
});
