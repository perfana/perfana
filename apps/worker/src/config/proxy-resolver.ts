import { ProxyServer } from '@perfana/shared/entities';
import { buildProxyAgent } from '@perfana/shared/services/proxy';
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
 * Resolve axios proxy options for the Grafana client. Identical policy to the
 * Dynatrace client (see resolveDynatraceAxiosProxy): `{ proxy }` only when
 * use_proxy is set AND a DB ProxyServer row exists; otherwise `{}` so axios
 * reads HTTP(S)_PROXY/NO_PROXY from the env and honors NO_PROXY, letting
 * internal hosts bypass the corporate proxy. Spread into GrafanaConfig.proxy.
 */
export async function resolveGrafanaAxiosProxy(
  organizationId: string | null | undefined,
  useProxy: boolean,
): Promise<{ proxy: AxiosProxyConfig } | Record<string, never>> {
  return resolveDynatraceAxiosProxy(organizationId, useProxy);
}
