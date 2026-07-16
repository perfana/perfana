import { ProxyAgent, EnvHttpProxyAgent } from 'undici'; // worker-local undici 7 — matches DynatraceAPIClient's request()
import { ProxyServer } from '@perfana/shared/entities';
import { buildProxyAgent, proxyConnection, envProxyDispatcher, normalizeNoProxy } from '@perfana/shared/services/proxy';
import { getDatabaseService } from '../common/database-accessor.js';

/**
 * Module-level cache for worker-local undici 7 ProxyAgents (Dynatrace path only).
 * Keyed by `${uri}|${token ?? ''}` — same strategy as the shared cache.
 * Exposed for tests only; do not modify from production code.
 */
export const _dynatraceAgentCacheForTests: Map<string, ProxyAgent> = new Map();
const dynatraceAgentCache = _dynatraceAgentCacheForTests;

/**
 * Resolve the undici Dispatcher for outbound requests for a given organization.
 *
 * Returns a ProxyAgent dispatcher when the organization has a proxy configured,
 * or `undefined` when no proxy is needed (caller should use its own default
 * dispatcher/pool unchanged).
 *
 * Typed as `unknown` to avoid cross-package undici version-skew errors.
 * Callers assign the value to `GrafanaConfig.dispatcher` (also `unknown`) or
 * cast to `Dispatcher` from their own undici copy before passing to undici APIs.
 *
 * The lookup is intentionally per-call (not cached) because the proxy config
 * can change at runtime and these are long-running background jobs.
 */
export async function resolveProxyDispatcher(
  organizationId: string | null | undefined
): Promise<unknown | undefined> {
  if (organizationId) {
    const db = getDatabaseService();
    const proxyRow = await db.dataSource
      .getRepository(ProxyServer)
      .findOne({ where: { organizationId } });

    const agents = buildProxyAgent(proxyRow ?? null);
    if (agents) { return agents.dispatcher; }
  }

  // No DB ProxyServer row → honor HTTP_PROXY/HTTPS_PROXY/NO_PROXY env vars
  // (shared undici, matching the Grafana request() path). See resolveDynatraceProxyDispatcher.
  return envProxyDispatcher();
}

/**
 * Like resolveProxyDispatcher, but builds the ProxyAgent from the worker's
 * own undici 7 rather than shared's undici 6.  Use this for Dynatrace call
 * sites where DynatraceAPIClient.request() is also undici 7 — passing an
 * undici-6 ProxyAgent to undici-7's request() throws at runtime.
 *
 * The Grafana path (GrafanaClient in shared) must keep using resolveProxyDispatcher
 * because it calls shared's undici 6 request(), so it needs a shared undici 6 ProxyAgent.
 *
 * Return type is `unknown` for consistency with resolveProxyDispatcher; callers
 * cast to `Dispatcher` from their own undici import.
 */
export async function resolveDynatraceProxyDispatcher(
  organizationId: string | null | undefined
): Promise<unknown | undefined> {
  if (organizationId) {
    const db = getDatabaseService();
    const proxyRow = await db.dataSource
      .getRepository(ProxyServer)
      .findOne({ where: { organizationId } });

    const conn = proxyConnection(proxyRow ?? null);
    if (conn) {
      const key = `${conn.uri}|${conn.token ?? ''}`;
      let agent = dynatraceAgentCache.get(key);
      if (!agent) {
        agent = new ProxyAgent(conn.token ? { uri: conn.uri, token: conn.token } : { uri: conn.uri });
        dynatraceAgentCache.set(key, agent);
      }
      return agent;
    }
  }

  // No DB ProxyServer row → fall back to HTTP_PROXY/HTTPS_PROXY/NO_PROXY env vars.
  // undici (unlike axios, which the API uses) does not honor these on its own, so
  // the worker would otherwise connect directly and fail in proxy-only environments.
  // Built from the worker's undici 7 (matches DynatraceAPIClient.request()); the
  // Grafana path uses shared's undici 6 envProxyDispatcher instead — no version skew.
  return dynatraceEnvProxyDispatcher();
}

/**
 * Lazily-built EnvHttpProxyAgent honoring HTTP_PROXY/HTTPS_PROXY/NO_PROXY.
 * Returns undefined when no proxy env vars are set, so the direct-connection
 * path stays byte-identical to before. Cached because env is read at construction.
 */
let _envProxyAgent: EnvHttpProxyAgent | undefined;
function dynatraceEnvProxyDispatcher(): unknown | undefined {
  const hasEnvProxy =
    process.env.HTTP_PROXY || process.env.http_proxy ||
    process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!hasEnvProxy) { return undefined; }
  if (!_envProxyAgent) {
    // Normalize NO_PROXY so glob entries (`*ba.uwv.nl`) match, matching axios/API behavior.
    const noProxy = normalizeNoProxy(process.env.NO_PROXY ?? process.env.no_proxy);
    _envProxyAgent = new EnvHttpProxyAgent(noProxy ? { noProxy } : {});
  }
  return _envProxyAgent;
}
