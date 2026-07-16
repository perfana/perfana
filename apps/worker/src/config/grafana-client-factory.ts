/**
 * Per-instance Grafana client resolution.
 *
 * The worker supports multiple Grafana instances (grafana-sync syncs dashboards
 * from every row in `grafana_instances`). A dashboard/panel carries its own
 * `grafana_instance_id`, so metrics and panel builds MUST query the instance the
 * dashboard actually lives on — not a process-wide "first row" singleton.
 *
 * This module builds a `GrafanaClient` for a given instance id (falling back to the
 * default singleton for legacy rows with a null instance id) and groups a batch of
 * panels by their owning instance so each group is queried against the right host.
 */
import type { Logger } from 'pino';
import { GrafanaClient } from '@perfana/shared/services/grafana';
import {
  getGrafanaConfigById,
  getDefaultResolvedGrafana,
} from './grafana-config-cache.js';
import { resolveGrafanaAxiosProxy } from './proxy-resolver.js';
import type { WorkerDatabaseService } from '../common/database.service.js';

/**
 * Build a Grafana client for a specific instance id, or the default singleton when
 * `instanceId` is null/undefined (legacy dashboards without an instance id).
 * Returns null when the instance can't be resolved — caller should skip its panels.
 */
export async function createGrafanaClient(
  instanceId: string | null | undefined,
  logger: Logger,
): Promise<GrafanaClient | null> {
  const resolved = instanceId
    ? await getGrafanaConfigById(instanceId)
    : await getDefaultResolvedGrafana();
  if (!resolved) {
    return null;
  }
  // Only pass an explicit proxy when use_proxy is set (+ a DB ProxyServer row);
  // otherwise `{}` so axios reads env HTTP(S)_PROXY/NO_PROXY and honors NO_PROXY.
  const proxyOpts = await resolveGrafanaAxiosProxy(resolved.meta.organizationId, resolved.meta.useProxy);
  const config = { ...resolved.config, ...proxyOpts };
  if ('proxy' in proxyOpts) {
    logger.info(`🔗 Grafana client (instance ${instanceId ?? 'default'}) will use proxy (org: ${resolved.meta.organizationId ?? 'env'})`);
  }
  logger.info(`🔗 Initialized Grafana client for instance ${instanceId ?? 'default'} with URL: ${config.url}`);
  return new GrafanaClient(config, logger);
}

/** A batch of panels sharing one Grafana instance, with a ready client. */
export interface GrafanaPanelGroup<T> {
  instanceId: string | null;
  client: GrafanaClient;
  panels: T[];
}

/**
 * Group panels by the Grafana instance their application dashboard belongs to, and
 * build a client per group. Panels whose instance can't be resolved are skipped
 * (logged), so one dead instance can't fail the whole run.
 */
export async function groupPanelsByGrafanaInstance<T extends { application_dashboard_id?: string | null }>(
  db: WorkerDatabaseService,
  panels: T[],
  logger: Logger,
): Promise<GrafanaPanelGroup<T>[]> {
  const appDashboardIds = [
    ...new Set(panels.map(p => p.application_dashboard_id).filter((id): id is string => !!id)),
  ];

  // application_dashboard_id -> grafana_instance_id (null for legacy rows)
  const instanceByDashboard = new Map<string, string | null>();
  if (appDashboardIds.length > 0) {
    const rows = await db.query<{ id: string; grafana_instance_id: string | null }>(
      `SELECT id, grafana_instance_id FROM application_dashboards WHERE id = ANY($1)`,
      [appDashboardIds],
    );
    for (const row of rows) {
      instanceByDashboard.set(row.id, row.grafana_instance_id);
    }
  }

  // Group panels by resolved instance id (null = default singleton).
  const grouped = new Map<string | null, T[]>();
  for (const panel of panels) {
    const instanceId = panel.application_dashboard_id
      ? instanceByDashboard.get(panel.application_dashboard_id) ?? null
      : null;
    const bucket = grouped.get(instanceId);
    if (bucket) {
      bucket.push(panel);
    } else {
      grouped.set(instanceId, [panel]);
    }
  }

  const groups: GrafanaPanelGroup<T>[] = [];
  for (const [instanceId, groupPanels] of grouped) {
    const client = await createGrafanaClient(instanceId, logger);
    if (!client) {
      logger.warn(`⚠️ Skipping ${groupPanels.length} panels — no Grafana client for instance ${instanceId ?? 'default'}`);
      continue;
    }
    groups.push({ instanceId, client, panels: groupPanels });
  }
  return groups;
}
