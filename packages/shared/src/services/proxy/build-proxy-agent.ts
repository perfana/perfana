import { ProxyAgent, EnvHttpProxyAgent } from 'undici';
import { ProxyServer } from '../../entities/proxy-server.entity';

export interface ProxyAgents {
  dispatcher: ProxyAgent;
  axiosProxy: { host: string; port: number; protocol: string; auth?: { username: string; password: string } };
}

/**
 * Module-level cache keyed by `${uri}|${token ?? ''}`.
 * Naturally bounded by the small number of distinct proxy configurations.
 * A credential change produces a new key → a new agent; no stale-cred reuse.
 * Exposed for tests only — do not modify from production code.
 */
export const _agentCacheForTests: Map<string, ProxyAgent> = new Map();
const agentCache = _agentCacheForTests;

/**
 * Pure helper — extracts the proxy uri and optional Basic-auth token from a
 * ProxyServer row without constructing any undici object.  Callers that need
 * to build a ProxyAgent from a *different* undici copy (e.g. the worker's
 * undici 7 rather than shared's undici 6) should use this instead of
 * `buildProxyAgent` so there is no cross-version dispatcher skew.
 */
export function proxyConnection(
  proxy: ProxyServer | null | undefined,
): { uri: string; token?: string } | null {
  if (!proxy || !proxy.proxyUrl) return null;
  const url = new URL(proxy.proxyUrl);
  const hasAuth = !!proxy.username && !!proxy.password;
  const token = hasAuth
    ? `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}`
    : undefined;
  return { uri: url.origin, token };
}

export function buildProxyAgent(proxy: ProxyServer | null | undefined): ProxyAgents | null {
  if (!proxy || !proxy.proxyUrl) return null;
  const conn = proxyConnection(proxy)!;
  const url = new URL(proxy.proxyUrl);
  const hasAuth = !!proxy.username && !!proxy.password;

  const key = `${conn.uri}|${conn.token ?? ''}`;
  let dispatcher = agentCache.get(key);
  if (!dispatcher) {
    dispatcher = new ProxyAgent(conn.token ? { uri: conn.uri, token: conn.token } : { uri: conn.uri });
    agentCache.set(key, dispatcher);
  }
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;

  return {
    dispatcher,
    axiosProxy: {
      host: url.hostname,
      port,
      protocol: url.protocol,
      ...(hasAuth ? { auth: { username: proxy.username!, password: proxy.password! } } : {}),
    },
  };
}
// ponytail: axios native proxy uses CONNECT tunneling for https targets — swap in
// https-proxy-agent only if a proxied HTTPS target proves flaky in the field.

/**
 * Fallback dispatcher honoring HTTP_PROXY/HTTPS_PROXY/NO_PROXY env vars, built
 * from shared's undici so it matches the Grafana request() path. Returns
 * undefined when no proxy env vars are set (direct-connection path unchanged).
 * undici does not honor these env vars on its own the way axios does.
 */
let _envProxyAgent: EnvHttpProxyAgent | undefined;
export function envProxyDispatcher(): ProxyAgents['dispatcher'] | undefined {
  const hasEnvProxy =
    process.env.HTTP_PROXY || process.env.http_proxy ||
    process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!hasEnvProxy) return undefined;
  if (!_envProxyAgent) _envProxyAgent = new EnvHttpProxyAgent();
  return _envProxyAgent as unknown as ProxyAgents['dispatcher'];
}
