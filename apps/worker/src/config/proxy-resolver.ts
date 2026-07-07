import { ProxyServer } from '@perfana/shared/entities';
import { buildProxyAgent } from '@perfana/shared/services/proxy';
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
  if (!organizationId) return undefined;

  const db = getDatabaseService();
  const proxyRow = await db.dataSource
    .getRepository(ProxyServer)
    .findOne({ where: { organizationId } });

  const agents = buildProxyAgent(proxyRow ?? null);
  return agents?.dispatcher;
}
