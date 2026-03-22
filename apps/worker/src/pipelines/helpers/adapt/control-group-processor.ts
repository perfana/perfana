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
  DEFAULT_COMPARE_CONFIG as _DEFAULT_COMPARE_CONFIG,
  type TempConfigCacheResult,
} from './compare-config-cache.js';

// Re-export for backward compatibility
export { DEFAULT_COMPARE_CONFIG, type TempConfigCacheResult } from './compare-config-cache.js';

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
   * Build SQL fragment for joining with control group statistics
   *
   * Creates a CTE that joins test metrics with their corresponding
   * control group statistics, including all statistical measures.
   *
   * @param testMetricsCte - Name of the CTE containing test metrics
   * @returns SQL fragment for the with_control CTE
   */
  buildControlGroupJoinSQL(testMetricsCte: string): string {
    return `
      with_control AS (
          SELECT
              tm.*,
              cgs.mean as control_mean,
              cgs.median as control_median,
              cgs.min_value as control_min,
              cgs.max_value as control_max,
              cgs.std_dev as control_std,
              cgs.last_value as control_last,
              cgs.q10 as control_q10,
              cgs.q25 as control_q25,
              cgs.q75 as control_q75,
              cgs.q90 as control_q90,
              cgs.q95 as control_q95,
              cgs.q99 as control_q99,
              cgs.iqr as control_iqr,
              cgs.count as control_n,
              cgs.is_constant as control_is_constant,
              cgs.all_missing as control_all_missing,
              CASE
                  WHEN cgs.control_group_id IS NOT NULL THEN true
                  ELSE false
              END as control_exists
          FROM ${testMetricsCte} tm
          LEFT JOIN ds_control_group_statistics cgs ON (
              cgs.control_group_id = tm.control_group_id
              AND cgs.metrics_source_id = tm.metrics_source_id
              AND cgs.panel_id::text = tm.panel_id
              AND cgs.metric_name = tm.metric_name
          )
      )
    `;
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
   * Build SQL fragment for dynamic statistics selection based on aggregation config
   *
   * Creates a CTE that selects the appropriate test and control statistics
   * based on the configured aggregation type (mean, median, percentiles, etc.)
   *
   * @param compareConfigCte - Name of the CTE containing compare config
   * @returns SQL fragment for the with_dynamic_statistics CTE
   */
  buildDynamicStatisticsSQL(compareConfigCte: string): string {
    return this.compareConfigCache.buildDynamicStatisticsSQL(compareConfigCte);
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
    return `
      AND (
          ms.application_dashboard_id IN (SELECT id FROM application_dashboards)
          OR ms.application_dashboard_id IN (SELECT DISTINCT application_dashboard_id FROM dynatrace_queries)
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
  ): any[] {
    const params: any[] = [];

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
