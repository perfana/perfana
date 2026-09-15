/**
 * Control Group Processor for ADAPT Pipeline
 *
 * Handles control group processing operations including:
 * - Processing control group statistics
 * - Building SQL for control group joins and comparisons
 * - Metric filtering and dashboard validation
 *
 * This processor is responsible for the comparison of test run metrics
 * against their control group baselines.
 *
 * Note: Compare config caching functionality has been extracted to
 * compare-config-cache.ts for better separation of concerns.
 */

import type { Logger } from 'pino';
import type { EntityManager } from 'typeorm';
import type { CompareConfig } from './types.js';
import {
  CompareConfigCache,
  type TempConfigCacheResult,
} from './compare-config-cache.js';

// Re-export for backward compatibility
export { type TempConfigCacheResult } from './compare-config-cache.js';

/**
 * Control Group Processor
 *
 * Manages control group operations for the ADAPT pipeline including
 * config cache management and control group statistics processing.
 */
export class ControlGroupProcessor {
  private compareConfigCache: CompareConfigCache;

  constructor(private logger: Logger) {
    this.compareConfigCache = new CompareConfigCache(logger);
  }

  /**
   * Get the default compare configuration
   */
  getDefaultCompareConfig(): CompareConfig {
    return this.compareConfigCache.getDefaultCompareConfig();
  }

  /**
   * Create and populate a temporary config cache table for efficient joins
   *
   * This creates a temporary table that holds compare configs at different
   * hierarchy levels (metric, panel, dashboard, global) for efficient lookup
   * during ADAPT processing.
   *
   * @param manager - TypeORM entity manager for transactional operations
   * @param configCache - Map of config keys to config data
   * @param tableName - Name for the temporary table (default: 'temp_config_cache')
   * @returns Result with number of entries inserted
   */
  async createTempConfigCache(
    manager: EntityManager,
    configCache: Map<string, CompareConfig>,
    tableName = 'temp_config_cache'
  ): Promise<TempConfigCacheResult> {
    return this.compareConfigCache.createTempConfigCache(manager, configCache, tableName);
  }

  /**
   * Build SQL fragment for joining compare config from temp cache
   *
   * Creates a CTE that looks up compare config from the temp cache table
   * using a hierarchical fallback: metric -> panel -> dashboard -> global -> default
   *
   * @param controlCte - Name of the CTE containing control group joined data
   * @param tempTableName - Name of the temporary config cache table
   * @param defaultConfigParamIndex - Parameter index for the default config
   * @returns SQL fragment for the with_compare_config CTE
   */
  buildCompareConfigJoinSQL(
    controlCte: string,
    tempTableName: string,
    defaultConfigParamIndex: number
  ): string {
    return this.compareConfigCache.buildCompareConfigJoinSQL(
      controlCte,
      tempTableName,
      defaultConfigParamIndex
    );
  }

  /**
   * Build SQL for valid application dashboard filter
   *
   * Ensures metrics are only processed if they have valid application dashboard IDs
   * from either application_dashboards or dynatrace_queries tables.
   *
   * @returns SQL fragment for WHERE clause filtering
   */
  buildValidDashboardFilterSQL(): string {
    // One IN over a UNION, not an OR of two INs. An OR between two subqueries cannot be
    // pulled up into a semi-join, so the planner emits `(SubPlan 1) OR (SubPlan 2)` and
    // re-evaluates both per candidate row — the same shape fixed in the control-group
    // aggregation in v0.2.93.1. A single IN (subquery) hashes once. Same output: UNION
    // dedupes, and the IS NOT NULL arm only drops rows that could never match anyway.
    return `
      AND ms.application_dashboard_id IN (
          SELECT id FROM application_dashboards
          UNION
          SELECT application_dashboard_id FROM dynatrace_queries
          WHERE application_dashboard_id IS NOT NULL
      )
    `;
  }

  /**
   * Build SQL for optional metric filtering
   *
   * Creates filter conditions for optional applicationDashboardId, panelId, and metricName filters.
   *
   * @param metricFilter - Optional filter conditions
   * @param startParamIndex - Starting parameter index for placeholders
   * @returns Object with SQL fragment and next available parameter index
   */
  buildMetricFilterSQL(
    metricFilter: {
      applicationDashboardId?: string;
      panelId?: number;
      metricName?: string;
    } | undefined,
    startParamIndex: number
  ): { sql: string; nextParamIndex: number } {
    const conditions: string[] = [];
    let nextParamIndex = startParamIndex;

    if (metricFilter?.applicationDashboardId) {
      conditions.push(`AND ms.application_dashboard_id = $${nextParamIndex++}`);
    }
    if (metricFilter?.panelId) {
      conditions.push(`AND ms.panel_id = $${nextParamIndex++}`);
    }
    if (metricFilter?.metricName) {
      conditions.push(`AND ms.metric_name = $${nextParamIndex++}`);
    }

    return {
      sql: conditions.join('\n            '),
      nextParamIndex,
    };
  }

  /**
   * Build query parameters array for metric filtering
   *
   * @param metricFilter - Optional filter conditions
   * @returns Array of parameter values
   */
  buildMetricFilterParams(
    metricFilter: {
      applicationDashboardId?: string;
      panelId?: number;
      metricName?: string;
    } | undefined
  ): unknown[] {
    const params: unknown[] = [];

    if (metricFilter?.applicationDashboardId) {
      params.push(metricFilter.applicationDashboardId);
    }
    if (metricFilter?.panelId) {
      params.push(metricFilter.panelId);
    }
    if (metricFilter?.metricName) {
      params.push(metricFilter.metricName);
    }

    return params;
  }
}
