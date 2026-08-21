/**
 * Regression tests for how the dashboard list reports a failed fetch.
 *
 * The hook used to catch every failure with `setDashboards([])` and nothing else. The section
 * renders an empty list as "No application dashboards found for X in Y environment", so a
 * server error was presented to the user as a statement of fact about their data.
 *
 * That is exactly what happened in production on 2026-08-21: an upgrade left the API asking for
 * a column the database did not have, every dashboard read returned 500, and the page reported
 * that 443 existing dashboards did not exist. It was reported as "deploying deleted all
 * application dashboards" and cost a day of looking for deleted rows.
 *
 * So these assert the distinction the UI depends on: an empty list means empty, an error means
 * error, and the two are never the same state.
 */

import { renderHook, act } from '@testing-library/react';
import { useDashboardManagement } from '../useDashboardManagement';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

import { authenticatedFetch } from '@/lib/api';

const mockAuthFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

function makeResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Internal Server Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

describe('useDashboardManagement — dashboard list fetch failures', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports a server error instead of an empty list', async () => {
    mockAuthFetch.mockResolvedValueOnce(makeResponse({ message: 'boom' }, false, 500));

    const { result } = renderHook(() => useDashboardManagement());
    await act(async () => {
      await result.current.fetchApplicationDashboards('sut-1', 'acc');
    });

    expect(result.current.dashboards).toEqual([]);
    expect(result.current.dashboardsError).not.toBeNull();
    // The status is the diagnosis: a 500 here is a server fault, not an absent dashboard.
    expect(result.current.dashboardsError).toContain('500');
  });

  it('reports a network failure the same way', async () => {
    mockAuthFetch.mockRejectedValueOnce(new Error('Failed to fetch'));

    const { result } = renderHook(() => useDashboardManagement());
    await act(async () => {
      await result.current.fetchApplicationDashboards('sut-1', 'acc');
    });

    expect(result.current.dashboards).toEqual([]);
    expect(result.current.dashboardsError).toContain('Failed to fetch');
  });

  it('leaves no error when the system genuinely has no dashboards', async () => {
    mockAuthFetch.mockResolvedValueOnce(makeResponse([]));

    const { result } = renderHook(() => useDashboardManagement());
    await act(async () => {
      await result.current.fetchApplicationDashboards('sut-1', 'acc');
    });

    // Empty and fine. This is the state the section may report as "none found".
    expect(result.current.dashboards).toEqual([]);
    expect(result.current.dashboardsError).toBeNull();
  });

  it('clears a previous error once a retry succeeds', async () => {
    mockAuthFetch.mockResolvedValueOnce(makeResponse({}, false, 500));

    const { result } = renderHook(() => useDashboardManagement());
    await act(async () => {
      await result.current.fetchApplicationDashboards('sut-1', 'acc');
    });
    expect(result.current.dashboardsError).not.toBeNull();

    mockAuthFetch.mockResolvedValueOnce(makeResponse([{ id: 'd1', dashboard_name: 'One' }]));
    await act(async () => {
      await result.current.fetchApplicationDashboards('sut-1', 'acc');
    });

    expect(result.current.dashboardsError).toBeNull();
    expect(result.current.dashboards).toHaveLength(1);
  });
});
