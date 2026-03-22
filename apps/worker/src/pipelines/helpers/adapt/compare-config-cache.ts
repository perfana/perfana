/**
 * Compare Config Cache for ADAPT Pipeline
 *
 * Manages compare configuration caching operations including:
 * - Creating and managing temporary config cache tables
 * - Building SQL for config cache joins with hierarchical fallback
 * - Dynamic statistics selection based on aggregation config
 *
 * This processor is responsible for efficiently looking up compare configurations
 * at different hierarchy levels (metric, panel, dashboard, global, default).
 */

import type { Logger } from 'pino';
import type { EntityManager } from 'typeorm';
import type { CompareConfig } from './types.js';

/**
 * Result of creating a temporary config cache
 */
export interface TempConfigCacheResult {
  /** Number of config entries inserted into temp table */
  entriesInserted: number;
  /** Name of the temporary table created */
  tableName: string;
}

/**
 * Default compare configuration for metrics without specific config
 */
export const DEFAULT_COMPARE_CONFIG: CompareConfig = {
  thresholds: {
    aggregation: 'median',
    iqrThreshold: 2,
    absoluteThreshold: undefined,
    percentageThreshold: 0.15,
  },
  metricClassification: {
    classification: 'unclassified',
    higherIsBetter: null,
  },
  defaultValueIfControlGroupMissing: null,
  ignore: false,
  source: 'default',
};

/**
 * Compare Config Cache
 *
 * Handles creation and management of temporary config cache tables for efficient
 * hierarchical configuration lookup during ADAPT pipeline processing.
 */
export class CompareConfigCache {
  constructor(private logger: Logger) {}

  /**
   * Get the default compare configuration
   */
  getDefaultCompareConfig(): CompareConfig {
    return { ...DEFAULT_COMPARE_CONFIG };
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
    // Create temporary table
    await manager.query(`
      CREATE TEMPORARY TABLE IF NOT EXISTS ${tableName} (
        application_dashboard_id uuid,
        panel_id int,
        metric_name text,
        config_data jsonb
      ) ON COMMIT DROP
    `);

    // Build insert values from cache
    const configInsertValues: string[] = [];
    const configInsertParams: any[] = [];
    let paramIndex = 1;

    for (const [key, config] of configCache.entries()) {
      // Skip default and global entries - they're handled separately
      if (key === 'default' || key === 'global') {
        continue;
      }

      const parts = key.split(':');
      const dashId = parts[0] || null;
      const panelId = parts[1] || null;
      const metricName = parts[2] || null;

      configInsertValues.push(
        `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
      );
      configInsertParams.push(dashId, panelId, metricName, JSON.stringify(config));
    }

    // Insert configs into temporary table
    if (configInsertValues.length > 0) {
      await manager.query(
        `
        INSERT INTO ${tableName} (application_dashboard_id, panel_id, metric_name, config_data)
        VALUES ${configInsertValues.join(', ')}
        ON CONFLICT DO NOTHING
      `,
        configInsertParams
      );
    }

    this.logger.debug(
      `Created temp config cache table '${tableName}' with ${configInsertValues.length} entries`
    );

    return {
      entriesInserted: configInsertValues.length,
      tableName,
    };
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
    return `
      with_compare_config AS (
          SELECT
              wc.*,
              COALESCE(
                  cfg_metric.config_data,
                  cfg_panel.config_data,
                  cfg_dashboard.config_data,
                  cfg_global.config_data,
                  $${defaultConfigParamIndex}::jsonb
              ) as compare_config
          FROM ${controlCte} wc
          LEFT JOIN ${tempTableName} cfg_metric ON (
              cfg_metric.application_dashboard_id = COALESCE(wc.metrics_source_id, wc.application_dashboard_id)
              AND cfg_metric.panel_id = wc.panel_id::int
              AND cfg_metric.metric_name = wc.metric_name
          )
          LEFT JOIN ${tempTableName} cfg_panel ON (
              cfg_panel.application_dashboard_id = COALESCE(wc.metrics_source_id, wc.application_dashboard_id)
              AND cfg_panel.panel_id = wc.panel_id::int
              AND cfg_panel.metric_name IS NULL
          )
          LEFT JOIN ${tempTableName} cfg_dashboard ON (
              cfg_dashboard.application_dashboard_id = COALESCE(wc.metrics_source_id, wc.application_dashboard_id)
              AND cfg_dashboard.panel_id IS NULL
              AND cfg_dashboard.metric_name IS NULL
          )
          LEFT JOIN ${tempTableName} cfg_global ON (
              cfg_global.application_dashboard_id IS NULL
              AND cfg_global.panel_id IS NULL
              AND cfg_global.metric_name IS NULL
          )
      )
    `;
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
    return `
      with_dynamic_statistics AS (
          SELECT
              wcc.*,
              -- Dynamically select test and control values based on configured statistic
              CASE (wcc.compare_config->'thresholds'->>'aggregation')
                  WHEN 'mean' THEN wcc.test_mean
                  WHEN 'median' THEN wcc.test_median
                  WHEN 'min' THEN wcc.test_min
                  WHEN 'max' THEN wcc.test_max
                  WHEN 'last' THEN wcc.test_last
                  WHEN 'q10' THEN wcc.test_q10
                  WHEN 'p10' THEN wcc.test_q10  -- Support both notations
                  WHEN 'q25' THEN wcc.test_q25
                  WHEN 'p25' THEN wcc.test_q25
                  WHEN 'q75' THEN wcc.test_q75
                  WHEN 'p75' THEN wcc.test_q75
                  WHEN 'q90' THEN wcc.test_q90
                  WHEN 'p90' THEN wcc.test_q90
                  WHEN 'q95' THEN wcc.test_q95
                  WHEN 'p95' THEN wcc.test_q95
                  WHEN 'q99' THEN wcc.test_q99
                  WHEN 'p99' THEN wcc.test_q99
                  ELSE wcc.test_median  -- Default to median
              END as test_stat_value,

              CASE (wcc.compare_config->'thresholds'->>'aggregation')
                  WHEN 'mean' THEN wcc.control_mean
                  WHEN 'median' THEN wcc.control_median
                  WHEN 'min' THEN wcc.control_min
                  WHEN 'max' THEN wcc.control_max
                  WHEN 'last' THEN wcc.control_last
                  WHEN 'q10' THEN wcc.control_q10
                  WHEN 'p10' THEN wcc.control_q10
                  WHEN 'q25' THEN wcc.control_q25
                  WHEN 'p25' THEN wcc.control_q25
                  WHEN 'q75' THEN wcc.control_q75
                  WHEN 'p75' THEN wcc.control_q75
                  WHEN 'q90' THEN wcc.control_q90
                  WHEN 'p90' THEN wcc.control_q90
                  WHEN 'q95' THEN wcc.control_q95
                  WHEN 'p95' THEN wcc.control_q95
                  WHEN 'q99' THEN wcc.control_q99
                  WHEN 'p99' THEN wcc.control_q99
                  ELSE wcc.control_median  -- Default to median
              END as control_stat_value
          FROM ${compareConfigCte} wcc
      )
    `;
  }

  /**
   * Fetch all compare configs and create a hierarchical lookup map
   *
   * This eliminates the need for 6 correlated subqueries per metric by
   * pre-loading all relevant configs into memory.
   *
   * @param manager - TypeORM entity manager for transactional operations
   * @param systemUnderTestId - System under test ID for config lookup
   * @param testEnvironment - Test environment for config lookup
   * @param workload - Workload for config lookup
   * @returns Map of config keys to config data
   */
  async fetchCompareConfigCache(
    manager: EntityManager,
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string
  ): Promise<Map<string, CompareConfig>> {
    const result = await manager.query(
      `
      SELECT
        application_dashboard_id,
        panel_id,
        metric_name,
        config_data,
        -- Specificity level (lower = more specific)
        CASE
          WHEN metric_name IS NOT NULL THEN 1  -- metric-level
          WHEN panel_id IS NOT NULL THEN 2     -- panel-level
          WHEN application_dashboard_id IS NOT NULL THEN 3  -- dashboard-level
          WHEN test_environment IS NOT NULL THEN 4  -- environment-level
          ELSE 5  -- global-level
        END as specificity
      FROM ds_compare_config
      WHERE system_under_test_id = $1
        AND (test_environment = $2 OR test_environment IS NULL OR test_environment = '')
        AND workload = $3
      ORDER BY specificity ASC
    `,
      [systemUnderTestId, testEnvironment, workload]
    );

    const cache = new Map<string, CompareConfig>();

    // Store configs by specificity - most specific wins
    for (const row of result) {
      const keys: string[] = [];

      // Generate all possible lookup keys for this config
      if (row.application_dashboard_id && row.panel_id && row.metric_name) {
        keys.push(`${row.application_dashboard_id}:${row.panel_id}:${row.metric_name}`);
      }
      if (row.application_dashboard_id && row.panel_id && !row.metric_name) {
        keys.push(`${row.application_dashboard_id}:${row.panel_id}:`);
      }
      if (row.application_dashboard_id && !row.panel_id) {
        keys.push(`${row.application_dashboard_id}::`);
      }
      if (!row.application_dashboard_id && !row.panel_id) {
        keys.push(`global`);
      }

      // Store in cache (first one wins due to ORDER BY specificity)
      for (const key of keys) {
        if (!cache.has(key)) {
          cache.set(key, row.config_data);
        }
      }
    }

    // Add default config
    cache.set('default', { ...DEFAULT_COMPARE_CONFIG });

    return cache;
  }
}
