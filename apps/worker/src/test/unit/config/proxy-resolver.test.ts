/**
 * Unit tests for proxy-resolver.ts
 *
 * Covers:
 * - resolveProxyDispatcher (Grafana, undici): null org → undefined without DB call;
 *   returns a dispatcher when a ProxyServer row exists.
 * - resolveDynatraceAxiosProxy (Dynatrace, axios): mirrors the API's proxyOpts —
 *   `{}` unless use_proxy is set AND a ProxyServer row exists, in which case
 *   `{ proxy }`. `{}` is the path that lets axios honor env NO_PROXY.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../common/database-accessor.js');

import * as databaseAccessor from '../../../common/database-accessor.js';
import {
  resolveProxyDispatcher,
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

describe('resolveProxyDispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns undefined and skips DB when organizationId is null', async () => {
    const result = await resolveProxyDispatcher(null);
    expect(result).toBeUndefined();
    expect(databaseAccessor.getDatabaseService).not.toHaveBeenCalled();
  });

  test('returns undefined and skips DB when organizationId is undefined', async () => {
    const result = await resolveProxyDispatcher(undefined);
    expect(result).toBeUndefined();
    expect(databaseAccessor.getDatabaseService).not.toHaveBeenCalled();
  });

  test('returns undefined when no ProxyServer row exists for the org', async () => {
    makeFindOneMock(null);
    const result = await resolveProxyDispatcher('org-1');
    expect(result).toBeUndefined();
  });

  test('returns a dispatcher when a ProxyServer row with proxyUrl exists', async () => {
    makeFindOneMock({ proxyUrl: 'http://proxy.corp:3128', organizationId: 'org-1' });
    const result = await resolveProxyDispatcher('org-1');
    expect(result).toBeDefined();
  });
});

describe('resolveDynatraceAxiosProxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns {} and skips DB when useProxy is false (env NO_PROXY path)', async () => {
    const result = await resolveDynatraceAxiosProxy('org-1', false);
    expect(result).toEqual({});
    expect(databaseAccessor.getDatabaseService).not.toHaveBeenCalled();
  });

  test('returns {} and skips DB when organizationId is null', async () => {
    const result = await resolveDynatraceAxiosProxy(null, true);
    expect(result).toEqual({});
    expect(databaseAccessor.getDatabaseService).not.toHaveBeenCalled();
  });

  test('returns {} when useProxy is true but no ProxyServer row exists', async () => {
    makeFindOneMock(null);
    const result = await resolveDynatraceAxiosProxy('org-1', true);
    expect(result).toEqual({});
  });

  test('returns { proxy } when useProxy is true and a ProxyServer row exists', async () => {
    makeFindOneMock({ proxyUrl: 'http://proxy.corp:3128', organizationId: 'org-1' });
    const result = await resolveDynatraceAxiosProxy('org-1', true);
    expect(result).toHaveProperty('proxy');
    const { proxy } = result as { proxy: { host: string; port: number; protocol: string } };
    expect(proxy.host).toBe('proxy.corp');
    expect(proxy.port).toBe(3128);
    expect(proxy.protocol).toBe('http:');
  });
});
