/**
 * Regression tests for the batch-delete path of useDashboardManagement.
 *
 * The hook used to fire one DELETE per selected dashboard in parallel. Each of
 * those cascades into the metrics hypertables, so a large batch froze the page
 * and the concurrent cascades fought each other in the database. It now posts
 * the whole batch once and lets a background queue do the work — which is why
 * these tests assert on the *number* of requests, not just the outcome.
 */

import { renderHook, act } from '@testing-library/react';
import { useDashboardManagement } from '../useDashboardManagement';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

import { authenticatedFetch } from '@/lib/api';

const mockAuthFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

function makeResponse(data: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 202 : 500,
    statusText: ok ? 'Accepted' : 'Internal Server Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

const DASHBOARDS = [
  { id: 'd1', dashboard_name: 'One' },
  { id: 'd2', dashboard_name: 'Two' },
  { id: 'd3', dashboard_name: 'Three' },
];

/** Load the hook's dashboard list through its own fetch path. */
async function renderWithDashboards() {
  mockAuthFetch.mockResolvedValueOnce(makeResponse(DASHBOARDS));
  const { result } = renderHook(() => useDashboardManagement());
  await act(async () => {
    await result.current.fetchApplicationDashboards('sut1', 'acc');
  });
  mockAuthFetch.mockClear();
  return result;
}

describe('useDashboardManagement — handleBatchDeleteDashboards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('posts the whole batch in one request instead of one DELETE per dashboard', async () => {
    const result = await renderWithDashboards();
    mockAuthFetch.mockResolvedValue(makeResponse({ queued: 2, deleted: 0 }));

    await act(async () => {
      await result.current.handleBatchDeleteDashboards(['d1', 'd2'], false, 'sut1', 'acc');
    });

    expect(mockAuthFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockAuthFetch.mock.calls[0];
    expect(url).toBe('/grafana/application-dashboards/batch-delete');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      ids: ['d1', 'd2'],
      deleteFromGrafana: false,
    });
  });

  it('passes the delete-from-Grafana flag through', async () => {
    const result = await renderWithDashboards();
    mockAuthFetch.mockResolvedValue(makeResponse({ queued: 1, deleted: 0 }));

    await act(async () => {
      await result.current.handleBatchDeleteDashboards(['d1'], true, 'sut1', 'acc');
    });

    expect(JSON.parse(mockAuthFetch.mock.calls[0][1]?.body as string).deleteFromGrafana).toBe(true);
  });

  // Deletion finishes in the background, so refetching would pull the rows
  // straight back into the table. The hook drops them locally instead.
  it('marks the queued dashboards without dropping them or refetching', async () => {
    // The rows used to be removed locally, which told the user "queued for deletion"
    // and then never contradicted it: a permanently failed job only surfaced as the
    // dashboard reappearing after a reload. They stay, wearing a badge.
    const result = await renderWithDashboards();
    mockAuthFetch.mockResolvedValue(makeResponse({ queued: 2, deleted: 0 }));

    await act(async () => {
      await result.current.handleBatchDeleteDashboards(['d1', 'd3'], false, 'sut1', 'acc');
    });

    expect(result.current.dashboards.map(d => d.id)).toEqual(['d1', 'd2', 'd3']);
    expect(result.current.dashboards.map(d => d.deletion_status)).toEqual([
      'queued',
      undefined,
      'queued',
    ]);
    expect(mockAuthFetch).toHaveBeenCalledTimes(1); // the POST only — no refetch
  });

  it('throws and keeps the list intact when the queue request fails', async () => {
    const result = await renderWithDashboards();
    mockAuthFetch.mockResolvedValue(makeResponse({ message: 'nope' }, false));

    await expect(
      act(async () => {
        await result.current.handleBatchDeleteDashboards(['d1'], false, 'sut1', 'acc');
      }),
    ).rejects.toThrow('Failed to queue dashboards for deletion');

    expect(result.current.dashboards.map(d => d.id)).toEqual(['d1', 'd2', 'd3']);
  });
});
