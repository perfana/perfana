import { GrafanaConfig } from '@perfana/shared/services/grafana';
import { getLogger } from '../lib/utils/logger.js';
import { getDatabaseService } from '../common/database-accessor.js';

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
let loadPromise: Promise<boolean> | null = null;

/**
 * Load Grafana config from database.
 * Returns true if config was loaded, false if no valid instance exists.
 */
async function loadFromDatabase(): Promise<boolean> {
  try {
    const db = getDatabaseService();

    const grafanaInstances = await db.grafanaInstanceRepo.find({
      order: { createdAt: 'ASC' },
      take: 1,
    });

    const grafanaInstance = grafanaInstances[0];

    if (!grafanaInstance) {
      return false;
    }

    if (!grafanaInstance.server_url || !grafanaInstance.apiKey) {
      logger.warn('Grafana instance missing server_url or apiKey — Grafana-dependent jobs will fail');
      return false;
    }

    cachedConfig = {
      url: grafanaInstance.server_url,
      apiKey: grafanaInstance.apiKey,
      orgId: grafanaInstance.orgId,
    };
    cachedInstanceId = grafanaInstance.id;

    logger.info(`Grafana config cached: ${cachedConfig.url} (instance: ${cachedInstanceId})`);
    return true;
  } catch (error) {
    logger.warn('Failed to load Grafana config:', error);
    return false;
  }
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

  const loaded = await loadFromDatabase();
  if (!loaded) {
    logger.warn('No Grafana instance configured — Grafana-dependent jobs will fail until one is added');
  }
}

/**
 * Get Grafana config, retrying from database if not yet cached.
 * This ensures instances added after worker startup are picked up.
 */
export async function getGrafanaConfig(): Promise<GrafanaConfig> {
  if (!cachedConfig) {
    if (!loadPromise) {
      loadPromise = loadFromDatabase().finally(() => { loadPromise = null; });
    }
    await loadPromise;
  }
  if (!cachedConfig) {
    throw new Error('Grafana config not available. No valid Grafana instance found in database.');
  }
  return cachedConfig;
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
}
