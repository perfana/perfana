/**
 * Unit tests for proxy-resolver.ts
 *
 * Covers:
 * - resolveProxyDispatcher: null org → undefined without DB call
 * - resolveProxyDispatcher: returns a dispatcher when a ProxyServer row exists
 * - resolveDynatraceProxyDispatcher: null org → undefined without DB call
 * - resolveDynatraceProxyDispatcher: returns a cached dispatcher; repeated calls reuse the same agent
 * - Cache isolation: different proxy URIs produce different agents
 *
 * Note: The Grafana path (resolveProxyDispatcher) delegates caching to shared's
 * buildProxyAgent — that cache is exercised thoroughly in the shared spec.
 * Here we focus on the Dynatrace path which owns its own worker-local cache.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../common/database-accessor.js');

import * as databaseAccessor from '../../../common/database-accessor.js';
import {
  resolveProxyDispatcher,
  resolveDynatraceProxyDispatcher,
  _dynatraceAgentCacheForTests,
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

describe('resolveDynatraceProxyDispatcher', () => {
  beforeEach(() => {
    _dynatraceAgentCacheForTests.clear();
    vi.clearAllMocks();
  });

  test('returns undefined and skips DB when organizationId is null', async () => {
    const result = await resolveDynatraceProxyDispatcher(null);
    expect(result).toBeUndefined();
    expect(databaseAccessor.getDatabaseService).not.toHaveBeenCalled();
  });

  test('returns undefined and skips DB when organizationId is undefined', async () => {
    const result = await resolveDynatraceProxyDispatcher(undefined);
    expect(result).toBeUndefined();
    expect(databaseAccessor.getDatabaseService).not.toHaveBeenCalled();
  });

  test('returns undefined when no ProxyServer row exists', async () => {
    makeFindOneMock(null);
    const result = await resolveDynatraceProxyDispatcher('org-1');
    expect(result).toBeUndefined();
  });

  test('returns a dispatcher when a ProxyServer row exists', async () => {
    makeFindOneMock({ proxyUrl: 'http://proxy.corp:3128', organizationId: 'org-1' });
    const result = await resolveDynatraceProxyDispatcher('org-1');
    expect(result).toBeDefined();
  });

  test('repeated calls with the same proxy return the SAME agent (cache hit)', async () => {
    const { findOne } = makeFindOneMock({
      proxyUrl: 'http://proxy.corp:3128',
      organizationId: 'org-1',
    });

    const a1 = await resolveDynatraceProxyDispatcher('org-1');
    // Re-use the same mock for the second call
    const a2 = await resolveDynatraceProxyDispatcher('org-1');

    expect(a1).toBe(a2);
    // DB was called twice (no org-level DB caching here; caching is at the agent level)
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  test('different proxy URIs produce different agents', async () => {
    const { getRepository } = makeFindOneMock(null);

    const findOneA = vi.fn().mockResolvedValue({
      proxyUrl: 'http://proxy-a.corp:3128',
      organizationId: 'org-a',
    });
    const findOneB = vi.fn().mockResolvedValue({
      proxyUrl: 'http://proxy-b.corp:3128',
      organizationId: 'org-b',
    });

    // First org uses proxy-a
    getRepository.mockReturnValueOnce({ findOne: findOneA });
    const agentA = await resolveDynatraceProxyDispatcher('org-a');

    // Second org uses proxy-b
    getRepository.mockReturnValueOnce({ findOne: findOneB });
    const agentB = await resolveDynatraceProxyDispatcher('org-b');

    expect(agentA).toBeDefined();
    expect(agentB).toBeDefined();
    expect(agentA).not.toBe(agentB);
  });

  test('same proxy URI reused across different orgs hits the cache', async () => {
    const { getRepository } = makeFindOneMock(null);

    // Both orgs resolve to the identical proxy URI
    const sharedProxy = { proxyUrl: 'http://shared-proxy.corp:3128' };
    getRepository.mockReturnValue({ findOne: vi.fn().mockResolvedValue(sharedProxy) });

    const a1 = await resolveDynatraceProxyDispatcher('org-1');
    const a2 = await resolveDynatraceProxyDispatcher('org-2');

    expect(a1).toBe(a2);
  });
});
