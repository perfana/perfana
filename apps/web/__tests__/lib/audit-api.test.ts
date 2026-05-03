/**
 * Unit tests for audit-api client (Phase 5a viewer MVP).
 *
 * Verifies the client correctly passes through filter params, decodes results,
 * and silently fails the capabilities probe (so the sidebar hides instead of
 * crashing on auth/network errors).
 */

import {
  fetchAuditCapabilities,
  fetchAuditLogs,
  fetchResourceAuditHistory,
} from '@/lib/audit-api';

const mockAuthenticatedFetch = jest.fn();

jest.mock('@/lib/api', () => ({
  authenticatedFetch: (...args: unknown[]) => mockAuthenticatedFetch(...args),
}));

const okResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  json: jest.fn().mockResolvedValue(body),
});

const failResponse = (status: number, body: unknown = { message: 'boom' }) => ({
  ok: false,
  status,
  json: jest.fn().mockResolvedValue(body),
});

beforeEach(() => {
  mockAuthenticatedFetch.mockReset();
});

describe('fetchAuditCapabilities', () => {
  it('returns the parsed body on 200', async () => {
    const body = {
      canView: true,
      scope: 'cross-org',
      accessibleOrganizationIds: [],
      knownResourceTypes: ['api-keys', 'benchmarks'],
    };
    mockAuthenticatedFetch.mockResolvedValue(okResponse(body));

    await expect(fetchAuditCapabilities()).resolves.toEqual(body);

    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      '/audit-logs/capabilities',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('returns canView=false on non-OK responses (so the sidebar hides)', async () => {
    mockAuthenticatedFetch.mockResolvedValue(failResponse(403));

    await expect(fetchAuditCapabilities()).resolves.toEqual({
      canView: false,
      scope: 'none',
      accessibleOrganizationIds: [],
      knownResourceTypes: [],
    });
  });
});

describe('fetchAuditLogs', () => {
  it('builds a query string from defined filter fields', async () => {
    mockAuthenticatedFetch.mockResolvedValue(okResponse({ rows: [], total: 0 }));

    await fetchAuditLogs({
      resourceType: 'api-keys',
      action: 'UPDATE',
      organizationId: 'org-1',
      limit: 25,
      offset: 50,
      // empty/undefined values must be dropped from the query string
      userId: '',
      resourceId: undefined,
    });

    const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
    expect(url).toMatch(/^\/audit-logs\?/);
    expect(url).toContain('resourceType=api-keys');
    expect(url).toContain('action=UPDATE');
    expect(url).toContain('organizationId=org-1');
    expect(url).toContain('limit=25');
    expect(url).toContain('offset=50');
    expect(url).not.toContain('userId=');
    expect(url).not.toContain('resourceId=');
  });

  it('throws with the server-provided message on failure', async () => {
    mockAuthenticatedFetch.mockResolvedValue(failResponse(500, { message: 'kaboom' }));

    await expect(fetchAuditLogs({})).rejects.toThrow('kaboom');
  });
});

describe('fetchResourceAuditHistory', () => {
  it('encodes path components and returns the parsed body', async () => {
    mockAuthenticatedFetch.mockResolvedValue(okResponse([{ id: 'a-1' }]));

    const out = await fetchResourceAuditHistory('grafana-instances', 'gi/with slash');

    expect(out).toEqual([{ id: 'a-1' }]);
    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      '/audit-logs/resource/grafana-instances/gi%2Fwith%20slash',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });
});
