/**
 * Unit tests for proxy-resolver.ts
 *
 * Covers resolveDynatraceAxiosProxy and resolveGrafanaAxiosProxy (both axios):
 * mirror the API's proxyOpts — `{}` unless use_proxy is set AND a ProxyServer
 * row exists, in which case `{ proxy }`. `{}` is the path that lets axios honor
 * env NO_PROXY so internal hosts bypass the corporate proxy.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../common/database-accessor.js');

import * as databaseAccessor from '../../../common/database-accessor.js';
import {
  resolveGrafanaAxiosProxy,
  resolveDynatraceAxiosProxy,
} from '../../../config/proxy-resolver.js';

// ── helpers ─────────────────────────────────────────────────────────────────

function makeFindOneMock(row: object | null) {
  const findOne = vi.fn().mockResolvedValue(row);
  const getRepository = vi.fn().mockReturnValue({ findOne });
  vi.mocked(databaseAccessor.getDatabaseService).mockReturnValue({
    dataSource: { getRepository },
  } as any);
  return { findOne, getRepository };
}

// ── tests ────────────────────────────────────────────────────────────────────

// Both resolvers share one policy; run the same matrix against each.
describe.each([
  ['resolveDynatraceAxiosProxy', resolveDynatraceAxiosProxy],
  ['resolveGrafanaAxiosProxy', resolveGrafanaAxiosProxy],
] as const)('%s', (_name, resolve) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns {} and skips DB when useProxy is false (env NO_PROXY path)', async () => {
    const result = await resolve('org-1', false);
    expect(result).toEqual({});
    expect(databaseAccessor.getDatabaseService).not.toHaveBeenCalled();
  });

  test('returns {} and skips DB when organizationId is null', async () => {
    const result = await resolve(null, true);
    expect(result).toEqual({});
    expect(databaseAccessor.getDatabaseService).not.toHaveBeenCalled();
  });

  test('returns {} when useProxy is true but no ProxyServer row exists', async () => {
    makeFindOneMock(null);
    const result = await resolve('org-1', true);
    expect(result).toEqual({});
  });

  test('returns { proxy } when useProxy is true and a ProxyServer row exists', async () => {
    makeFindOneMock({ proxyUrl: 'http://proxy.corp:3128', organizationId: 'org-1' });
    const result = await resolve('org-1', true);
    expect(result).toHaveProperty('proxy');
    const { proxy } = result as { proxy: { host: string; port: number; protocol: string } };
    expect(proxy.host).toBe('proxy.corp');
    expect(proxy.port).toBe(3128);
    expect(proxy.protocol).toBe('http:');
  });
});
