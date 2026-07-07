import { ProxyAgent } from 'undici'; // worker-local undici 7 — matches DynatraceAPIClient's request()
import { ProxyServer } from '@perfana/shared/entities';
import { buildProxyAgent, proxyConnection } from '@perfana/shared/services/proxy';
import { getDatabaseService } from '../common/database-accessor.js';

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
  if (!organizationId) { return undefined; }

  const db = getDatabaseService();
  const proxyRow = await db.dataSource
    .getRepository(ProxyServer)
    .findOne({ where: { organizationId } });

  const agents = buildProxyAgent(proxyRow ?? null);
  return agents?.dispatcher;
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
  if (!organizationId) { return undefined; }

  const db = getDatabaseService();
  const proxyRow = await db.dataSource
    .getRepository(ProxyServer)
    .findOne({ where: { organizationId } });

  const conn = proxyConnection(proxyRow ?? null);
  return conn ? new ProxyAgent({ uri: conn.uri, token: conn.token }) : undefined;
}
