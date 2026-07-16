import { ProxyServer } from '@perfana/shared/entities';
import { buildProxyAgent, envProxyDispatcher } from '@perfana/shared/services/proxy';
import { getDatabaseService } from '../common/database-accessor.js';

/** axios `proxy` config shape (host/port/protocol + optional basic auth). */
export interface AxiosProxyConfig {
  host: string;
  port: number;
  protocol: string;
  auth?: { username: string; password: string };
}

/**
 * Resolve axios proxy options for the Dynatrace client, mirroring the API's
 * DynatraceService.proxyOpts exactly (apps/api ProxyResolverService.resolve):
 *
 *   - `useProxy` false  → return `{}`. axios then reads HTTP(S)_PROXY/NO_PROXY
 *     from the environment itself and honors NO_PROXY (lenient matching), so
 *     internal hosts bypass the corporate proxy. This is the path the API takes
 *     for both current Dynatrace instances (use_proxy = false) and the reason
 *     it reaches internal + external hosts where the undici path failed.
 *   - `useProxy` true + DB ProxyServer row → return `{ proxy }` so axios tunnels
 *     through the configured proxy. (Like the API, this explicit-proxy path has
 *     no NO_PROXY bypass — same limitation, kept for parity.)
 *
 * Spread the result into every axios request config.
 */
export async function resolveDynatraceAxiosProxy(
  organizationId: string | null | undefined,
  useProxy: boolean,
): Promise<{ proxy: AxiosProxyConfig } | Record<string, never>> {
  if (!useProxy || !organizationId) { return {}; }
  const db = getDatabaseService();
  const proxyRow = await db.dataSource
    .getRepository(ProxyServer)
    .findOne({ where: { organizationId } });
  const agents = buildProxyAgent(proxyRow ?? null);
  return agents ? { proxy: agents.axiosProxy } : {};
}

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
  // (shared undici, matching the Grafana request() path).
  return envProxyDispatcher();
}
