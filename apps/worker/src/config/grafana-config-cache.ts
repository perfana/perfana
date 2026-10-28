import { GrafanaConfig } from '@perfana/shared/services/grafana';
import { getLogger } from '../lib/utils/logger.js';
import { getDatabaseService } from '../common/database-accessor.js';

/** Extra fields cached alongside GrafanaConfig to support proxy resolution. */
interface CachedGrafanaMeta {
  organizationId: string | null;
  useProxy: boolean;
}

const logger = getLogger('grafana-config-cache');

/**
 * Singleton Grafana Configuration Cache
 *
 * Caches Grafana instance config to avoid per-job database queries.
 * If no instance exists at startup, retries on demand when a job needs it,
 * so instances added after worker boot are picked up automatically.
 */
let cachedConfig: GrafanaConfig | null = null;
let cachedInstanceId: string | null = null;
let cachedMeta: CachedGrafanaMeta | null = null;
let loadPromise: Promise<LoadResult> | null = null;

/** Resolved config + meta for a specific grafana_instances row, keyed by instance id. */
export interface ResolvedGrafanaInstance {
  config: GrafanaConfig;
  meta: CachedGrafanaMeta;
}
const byInstanceId = new Map<string, ResolvedGrafanaInstance | null>();

type LoadResult = 'loaded' | 'not-configured' | 'invalid';

/**
 * Load Grafana config from database.
 *
 * - 'loaded': a valid instance row was found and cached
 * - 'not-configured': zero rows in `grafana_instances` (Grafana is documented as
 *   optional — callers that can survive without Grafana should treat this as a
 *   soft skip rather than a failure)
 * - 'invalid': a row exists but is missing required fields, OR the DB query
 *   failed. Callers should treat this as a real error since the operator
 *   clearly intended Grafana to be wired up.
 */
async function loadFromDatabase(): Promise<LoadResult> {
  try {
    const db = getDatabaseService();

    const grafanaInstances = await db.grafanaInstanceRepo.find({
      order: { createdAt: 'ASC' },
      take: 1,
    });

    const grafanaInstance = grafanaInstances[0];

    if (!grafanaInstance) {
      return 'not-configured';
    }

    if (!grafanaInstance.server_url || !grafanaInstance.apiKey) {
      logger.warn('Grafana instance row found but missing server_url or apiKey — Grafana-dependent jobs will fail');
      return 'invalid';
    }

    cachedConfig = {
      url: grafanaInstance.server_url,
      apiKey: grafanaInstance.apiKey,
      orgId: grafanaInstance.orgId,
    };
    cachedInstanceId = grafanaInstance.id;
    cachedMeta = {
      organizationId: grafanaInstance.organizationId ?? null,
      useProxy: grafanaInstance.useProxy ?? false,
    };

    logger.info(`Grafana config cached: ${cachedConfig.url} (instance: ${cachedInstanceId})`);
    return 'loaded';
  } catch (error) {
    logger.warn('Failed to load Grafana config:', error);
    return 'invalid';
  }
}

async function ensureLoaded(): Promise<LoadResult> {
  if (cachedConfig) {
    return 'loaded';
  }
  if (!loadPromise) {
    loadPromise = loadFromDatabase().finally(() => { loadPromise = null; });
  }
  return loadPromise;
}

/**
 * Initialize Grafana config cache from database.
 * Non-fatal: if no Grafana instance is configured, the worker still starts.
 * The cache will retry on demand when getGrafanaConfig() is called.
 */
export async function initializeGrafanaConfig(): Promise<void> {
  if (cachedConfig) {
    return;
  }

  const result = await loadFromDatabase();
  if (result === 'not-configured') {
    logger.info('No Grafana instance configured — Grafana-dependent stages will be skipped');
  } else if (result === 'invalid') {
    logger.warn('Grafana instance is misconfigured — Grafana-dependent jobs will fail until fixed');
  }
}

/**
 * Get Grafana config, throwing if no valid instance is available.
 *
 * Use this when the caller cannot proceed without Grafana (e.g. on-demand
 * incremental refresh that is only triggered for Grafana-backed sources).
 * For analyze pipeline stages where Grafana is optional, use
 * {@link tryGetGrafanaConfig} instead.
 */
export async function getGrafanaConfig(): Promise<GrafanaConfig> {
  const result = await ensureLoaded();
  if (result === 'loaded' && cachedConfig) {
    return cachedConfig;
  }
  throw new Error('Grafana config not available. No valid Grafana instance found in database.');
}

/**
 * Get Grafana config if a valid instance is configured, or `null` if no
 * instance row exists at all. Throws if a row exists but is invalid (missing
 * required fields or DB error) — that's a real misconfiguration that should
 * fail loudly, not a documented "Grafana is optional" scenario.
 *
 * Used by analyze pipeline stages (panels-processing, metrics-collection)
 * that can soft-skip when Grafana is not wired up — see issue #282.
 */
export async function tryGetGrafanaConfig(): Promise<GrafanaConfig | null> {
  const result = await ensureLoaded();
  if (result === 'loaded' && cachedConfig) {
    return cachedConfig;
  }
  if (result === 'not-configured') {
    return null;
  }
  throw new Error('Grafana config not available. A grafana_instances row exists but is invalid (check server_url and apiKey).');
}

/**
 * Resolve config + meta for a SPECIFIC Grafana instance by id, caching per id.
 *
 * Returns null if the row is missing or invalid (bad server_url/apiKey) — callers
 * should skip that instance's panels rather than silently hitting the wrong Grafana.
 * Use this (not the singleton {@link getGrafanaConfig}) whenever a dashboard/panel
 * carries its own grafana_instance_id, so multi-instance setups query the right host.
 */
export async function getGrafanaConfigById(instanceId: string): Promise<ResolvedGrafanaInstance | null> {
  if (byInstanceId.has(instanceId)) {
    return byInstanceId.get(instanceId) ?? null;
  }
  try {
    const db = getDatabaseService();
    const instance = await db.grafanaInstanceRepo.findOne({ where: { id: instanceId } });
    if (!instance) {
      logger.warn(`Grafana instance ${instanceId} not found — panels on it will be skipped`);
      byInstanceId.set(instanceId, null);
      return null;
    }
    if (!instance.server_url || !instance.apiKey) {
      logger.warn(`Grafana instance ${instanceId} missing server_url or apiKey — panels on it will be skipped`);
      byInstanceId.set(instanceId, null);
      return null;
    }
    const resolved: ResolvedGrafanaInstance = {
      config: { url: instance.server_url, apiKey: instance.apiKey, orgId: instance.orgId },
      meta: { organizationId: instance.organizationId ?? null, useProxy: instance.useProxy ?? false },
    };
    byInstanceId.set(instanceId, resolved);
    return resolved;
  } catch (error) {
    logger.warn(`Failed to load Grafana instance ${instanceId}:`, error);
    return null; // transient DB error — don't poison the cache
  }
}

/**
 * Resolved config + meta for the default (singleton) instance, or null if none is
 * configured. Fallback for dashboards/panels whose grafana_instance_id is null
 * (legacy single-instance rows).
 */
export async function getDefaultResolvedGrafana(): Promise<ResolvedGrafanaInstance | null> {
  const config = await tryGetGrafanaConfig();
  if (!config || !cachedMeta) {
    return null;
  }
  return { config, meta: cachedMeta };
}

/**
 * Get cached Grafana instance ID.
 * Returns null if no instance is configured.
 */
export function getGrafanaInstanceId(): string | null {
  return cachedInstanceId;
}

/**
 * Clear cache (useful for testing or when Grafana instance config changes)
 */
export function clearGrafanaConfigCache(): void {
  cachedConfig = null;
  cachedInstanceId = null;
  cachedMeta = null;
  byInstanceId.clear();
}

/**
 * Whether THIS RUN has any Grafana-backed dashboard whose instance is usable.
 *
 * This is the gate `PanelsPipeline` and `MetricsPipeline` use, and it replaces
 * `tryGetGrafanaConfig()` for that purpose. The difference matters on any deploy with
 * more than one Grafana instance:
 *
 * `tryGetGrafanaConfig()` resolves the **oldest row in the whole table** and throws
 * `'invalid'` when that row is missing `server_url` or `apiKey`. Since those two stages
 * were gated on it, **one misconfigured legacy row failed panels-processing and
 * metrics-collection for every run in the deployment** — including runs whose
 * dashboards live on a perfectly healthy second instance. The singleton's identity was
 * also org-blind, though that half was not reachable: the NULL-instance bucket measured
 * on dev was 76 perf-test and 3 Dynatrace artificial rows and zero real Grafana
 * dashboards.
 *
 * So the question is asked per run instead: do any of this run's application dashboards
 * name a Grafana instance we can actually reach? Each candidate is resolved through
 * `getGrafanaConfigById`, which is per-instance, cached per id, and returns null for a
 * row that is missing or invalid rather than poisoning every other instance.
 *
 * Three rules:
 *
 * - **A run with no Grafana-backed dashboards is a soft skip**, exactly as before. That
 *   is the documented "Grafana is optional" case (issue #282) — a JMeter-only run still
 *   needs rollup, statistics and checks to run.
 * - **A run whose dashboards all point at broken instances is also a soft skip**, and
 *   says which. Failing the stage would stop the load-test data being analysed over a
 *   metrics source the operator may not even use any more.
 * - **An error resolving the dashboards returns true**, not false. A transient database
 *   problem must not silently convert into "this run has no Grafana", which would
 *   record the run as analysed with no panels. Letting the stage proceed surfaces the
 *   failure where the retry machinery can see it.
 */
export async function hasUsableGrafanaForRun(
  testRun: { systemUnderTestId: string; testEnvironment: string; organizationId?: string | null },
): Promise<boolean> {
  let instanceIds: string[];
  try {
    const db = getDatabaseService();
    const dashboards = await db.getApplicationDashboards({
      systemUnderTestId: testRun.systemUnderTestId,
      testEnvironment: testRun.testEnvironment,
      ...(testRun.organizationId ? { organizationId: testRun.organizationId } : {}),
    });
    instanceIds = [
      ...new Set(
        dashboards
          .map((d) => d.grafanaInstanceId)
          .filter((id): id is string => !!id),
      ),
    ];
  } catch (error) {
    logger.warn(
      `Could not determine this run's Grafana instances, letting the stage proceed: ${error}`,
    );
    return true;
  }

  if (instanceIds.length === 0) {
    return false;
  }

  const resolved = await Promise.all(instanceIds.map((id) => getGrafanaConfigById(id)));
  const usable = resolved.filter((r) => r !== null).length;

  if (usable === 0) {
    logger.warn(
      `This run names ${instanceIds.length} Grafana instance(s) and none is usable (missing server_url or apiKey) — skipping the Grafana stages for it`,
    );
    return false;
  }

  if (usable < instanceIds.length) {
    // Not a skip: the usable instances still have panels worth collecting. Said once,
    // loudly, because the unusable one's panels will silently produce no data.
    logger.warn(
      `${instanceIds.length - usable} of this run's ${instanceIds.length} Grafana instances are unusable; proceeding with the rest`,
    );
  }

  return true;
}
