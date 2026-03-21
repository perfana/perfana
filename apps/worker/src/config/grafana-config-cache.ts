import { GrafanaConfig } from '@perfana/shared/services/grafana';
import { getLogger } from '../lib/utils/logger.js';
import { getDatabaseService } from '../common/database-accessor.js';

const logger = getLogger('grafana-config-cache');

/**
 * Singleton Grafana Configuration Cache
 *
 * Eliminates per-job database queries by caching Grafana instance config at startup.
 * This reduces DB connection usage from N queries (one per job) to 1 query (at startup).
 *
 * Connection optimization:
 * - Before: Each metrics job held a connection to query grafana_instances table
 * - After: Single query at startup, no connection held during job execution
 */
let cachedConfig: GrafanaConfig | null = null;
let cachedInstanceId: string | null = null;
let initialized = false;

/**
 * Initialize Grafana config cache from database using TypeORM.
 * Non-fatal: if no Grafana instance is configured, the worker still starts.
 * Jobs that need Grafana will fail individually via getGrafanaConfig().
 */
export async function initializeGrafanaConfig(): Promise<void> {
  if (initialized) {
    return;
  }
  initialized = true;

  try {
    const db = getDatabaseService();

    const grafanaInstances = await db.grafanaInstanceRepo.find({
      order: { createdAt: 'ASC' },
      take: 1,
    });

    const grafanaInstance = grafanaInstances[0];

    if (!grafanaInstance) {
      logger.warn('No Grafana instance configured — Grafana-dependent jobs will fail until one is added');
      return;
    }

    if (!grafanaInstance.server_url || !grafanaInstance.apiKey) {
      logger.warn('Grafana instance missing server_url or apiKey — Grafana-dependent jobs will fail');
      return;
    }

    cachedConfig = {
      url: grafanaInstance.server_url,
      apiKey: grafanaInstance.apiKey,
      orgId: grafanaInstance.orgId,
    };
    cachedInstanceId = grafanaInstance.id;

    logger.info(`Grafana config cached: ${cachedConfig.url} (instance: ${cachedInstanceId})`);
  } catch (error) {
    logger.warn('Failed to load Grafana config — Grafana-dependent jobs will fail:', error);
  }
}

/**
 * Get cached Grafana config (must call initializeGrafanaConfig first)
 * Throws error if config not initialized - this is intentional to catch bugs
 */
export function getGrafanaConfig(): GrafanaConfig {
  if (!cachedConfig) {
    throw new Error('Grafana config not initialized. Call initializeGrafanaConfig() first.');
  }
  return cachedConfig;
}

/**
 * Get cached Grafana instance ID (must call initializeGrafanaConfig first)
 * Returns null if no instance is configured
 */
export function getGrafanaInstanceId(): string | null {
  return cachedInstanceId;
}

/**
 * Clear cache (useful for testing or config reload)
 */
export function clearGrafanaConfigCache(): void {
  cachedConfig = null;
  cachedInstanceId = null;
  initialized = false;
}
