/**
 * Proxy Agent Integration Tests
 *
 * Verifies that:
 * 1. buildProxyAgent(null) returns null (no-proxy path, default Pool used)
 * 2. buildProxyAgent with a proxyUrl returns an object with a truthy dispatcher
 * 3. GrafanaClient accepts a dispatcher from buildProxyAgent without throwing
 * 4. GrafanaClient without a dispatcher also constructs without throwing
 *
 * No real network calls are made — construction-time behaviour only.
 */

import { describe, test, expect } from 'vitest';
import { GrafanaClient } from '@perfana/shared/services/grafana';
import type { GrafanaConfig } from '@perfana/shared/services/grafana';
import { buildProxyAgent } from '@perfana/shared/services/proxy';

// Use a clearly-public hostname so the SSRF validator accepts it.
// grafana.example resolves to no private/reserved IP range.
const PUBLIC_GRAFANA_URL = 'http://grafana.example:3000';
const PROXY_URL = 'http://proxy.corp:3128';

describe('buildProxyAgent', () => {
  test('returns null when proxy is null (no-proxy path)', () => {
    const result = buildProxyAgent(null);
    expect(result).toBeNull();
  });

  test('returns null when proxy is undefined (no-proxy path)', () => {
    const result = buildProxyAgent(undefined);
    expect(result).toBeNull();
  });

  test('returns an object with a truthy dispatcher when proxyUrl is set', () => {
    const result = buildProxyAgent({ proxyUrl: PROXY_URL, organizationId: 'o1' } as any);
    expect(result).not.toBeNull();
    expect(result!.dispatcher).toBeTruthy();
  });

  test('returned object also carries axiosProxy metadata', () => {
    const result = buildProxyAgent({ proxyUrl: PROXY_URL, organizationId: 'o1' } as any);
    expect(result!.axiosProxy).toMatchObject({
      host: 'proxy.corp',
      port: 3128,
      protocol: 'http:',
    });
  });
});

describe('GrafanaClient construction', () => {
  test('constructs without throwing when a proxy dispatcher is provided', () => {
    const agents = buildProxyAgent({ proxyUrl: PROXY_URL, organizationId: 'o1' } as any)!;
    expect(agents).not.toBeNull();

    const config: GrafanaConfig = {
      url: PUBLIC_GRAFANA_URL,
      apiKey: 'test-key',
      dispatcher: agents.dispatcher,
    };

    expect(() => new GrafanaClient(config)).not.toThrow();
  });

  test('constructs without throwing when no dispatcher is provided (falls back to internal Pool)', () => {
    const config: GrafanaConfig = {
      url: PUBLIC_GRAFANA_URL,
      apiKey: 'test-key',
    };

    expect(() => new GrafanaClient(config)).not.toThrow();
  });
});
