/**
 * Results Processor for ADAPT Pipeline (Orchestrator)
 *
 * Thin orchestrator that delegates to specialized helpers for:
 * - SQL query building (AdaptResultsSQLBuilder, TrackedResultsSQLBuilder)
 * - Status updates (AdaptStatusUpdater)
 * - Realtime publishing (AdaptRealtimePublisher)
 * - Config cache fetching (CompareConfigCache)
 * - Control group processing (ControlGroupProcessor)
 *
 * This processor coordinates the final stages of ADAPT analysis:
 * computing results, tracking historical regressions, and determining
 * overall test run conclusions.
 */

import type { Logger } from 'pino';
import type { EntityManager } from 'typeorm';
import type { CompareConfig } from './types.js';
import { ControlGroupProcessor } from './control-group-processor.js';
import { CompareConfigCache } from './compare-config-cache.js';
import {
  AdaptResultsSQLBuilder,
  TrackedResultsSQLBuilder,
  AdaptStatusUpdater,
  AdaptRealtimePublisher,
} from './results/index.js';

/**
 * Optional metric filter for ADAPT processing
 */
interface MetricFilter {
  /** Filter to specific application dashboard */
  applicationDashboardId?: string;
  /** Filter to specific panel */
  panelId?: number;
  /** Filter to specific metric */
  metricName?: string;
}

/**
 * Results Processor (Orchestrator)
 *
 * Delegates results processing operations to specialized helpers:
 * - SQL builders for complex query generation
 * - Status updater for final test run status
 * - Realtime publisher for frontend updates
 * - Config cache for efficient config lookups
 */
export class ResultsProcessor {
  private controlGroupProcessor: ControlGroupProcessor;
  private configCache: CompareConfigCache;
  private resultsSQLBuilder: AdaptResultsSQLBuilder;
  private trackedResultsSQLBuilder: TrackedResultsSQLBuilder;
  private statusUpdater: AdaptStatusUpdater;
  private realtimePublisher: AdaptRealtimePublisher;

  constructor(private logger: Logger) {
    this.controlGroupProcessor = new ControlGroupProcessor(logger);
    this.configCache = new CompareConfigCache(logger);
    this.resultsSQLBuilder = new AdaptResultsSQLBuilder();
    this.trackedResultsSQLBuilder = new TrackedResultsSQLBuilder();
    this.statusUpdater = new AdaptStatusUpdater(logger);
    this.realtimePublisher = new AdaptRealtimePublisher(logger);
  }

  /**
   * Process ADAPT results by comparing test metrics against control group statistics
   *
   * This method:
   * 1. Fetches test run metadata (system_under_test_id, test_environment, workload)
   * 2. Pre-fetches compare configs for efficient lookups
   * 3. Creates temporary config cache table
   * 4. Executes large SQL query that:
   *    - Joins test metrics with control group statistics
   *    - Applies compare configs with hierarchical fallback
   *    - Calculates thresholds and statistical differences
   *    - Builds conclusion labels based on threshold checks
   * 5. Inserts/updates results in ds_adapt_results table
   *
   * @param manager - TypeORM entity manager for transactional operations
   * @param testRunIds - Test run IDs to process
   * @param metricFilter - Optional filter for specific metrics
   * @returns Number of rows processed
   */
  async processAdaptResults(
    manager: EntityManager,
    testRunIds: string[],
    metricFilter?: MetricFilter
  ): Promise<number> {
    const placeholders = testRunIds.map((_: unknown, i: number) => `$${i + 1}`).join(', ');

    // Get system_under_test_id, test_environment, and workload for config lookup
    const testRunInfo = await manager.query(
      `
      SELECT DISTINCT system_under_test_id, test_environment, workload
      FROM test_runs
      WHERE test_run_id IN (${placeholders})
    `,
      testRunIds
    );

    if (testRunInfo.length === 0) {
      throw new Error('No test run information found');
    }

    const { system_under_test_id, test_environment, workload } = testRunInfo[0];

    // Pre-fetch all compare configs to avoid correlated subqueries
    const configCacheMap = await this.configCache.fetchCompareConfigCache(
      manager,
      system_under_test_id,
      test_environment,
      workload
    );

    // Create and populate temporary config cache table
    await this.controlGroupProcessor.createTempConfigCache(manager, configCacheMap, 'temp_config_cache');

    // Get default config from cache or use the standard default
    const defaultConfig =
      configCacheMap.get('default') || this.controlGroupProcessor.getDefaultCompareConfig();

    // Build filter conditions for metric filtering
    const metricFilterResult = this.controlGroupProcessor.buildMetricFilterSQL(
      metricFilter,
      testRunIds.length + 2 // +1 for testRunIds, +1 for defaultConfig
    );

    // Build final filter SQL with valid dashboard filter
    const filterConditions: string[] = [];
    if (metricFilterResult.sql) {
      filterConditions.push(metricFilterResult.sql);
    }
    // Always filter out stale records with invalid application_dashboard_id
    filterConditions.push(this.controlGroupProcessor.buildValidDashboardFilterSQL());

    const filterSQL = filterConditions.join('\n            ');

    // Build and execute SQL query
    const adaptSQL = this.resultsSQLBuilder.buildAdaptResultsSQL(
      placeholders,
      filterSQL,
      testRunIds.length
    );

    // Build query parameters array: testRunIds, defaultConfig, then optional filter params
    const queryParams: unknown[] = [...testRunIds, JSON.stringify(defaultConfig)];

    if (metricFilter?.applicationDashboardId) {
      queryParams.push(metricFilter.applicationDashboardId);
    }
    if (metricFilter?.panelId) {
      queryParams.push(metricFilter.panelId);
    }
    if (metricFilter?.metricName) {
      queryParams.push(metricFilter.metricName);
    }

    const result = await manager.query(adaptSQL, queryParams);
    return result.length || 0;
  }

  /**
   * Generate conclusions for test runs based on ADAPT results
   *
   * This method:
   * 1. Aggregates ADAPT results by label (regressions, improvements, differences, etc.)
   * 2. Joins with tracked results for historical regression detection
   * 3. Computes overall conclusion (SKIPPED, REGRESSION, or PASSED)
   * 4. Stores conclusion in ds_adapt_conclusion table
   *
   * @param manager - TypeORM entity manager for transactional operations
   * @param testRunIds - Test run IDs to generate conclusions for
   * @returns Number of conclusions generated
   */
  async generateConclusions(manager: EntityManager, testRunIds: string[]): Promise<number> {
    const placeholders = testRunIds.map((_: unknown, i: number) => `$${i + 1}`).join(', ');

    const conclusionSQL = this.resultsSQLBuilder.buildConclusionSQL(placeholders);

    const result = await manager.query(conclusionSQL, testRunIds);
    this.logger.info(
      `Generated conclusions for ${testRunIds.length} test runs, affected ${result.length} rows`
    );

    // Log tracked regression processing results
    await this.statusUpdater.logTrackedRegressionResults(manager, testRunIds);

    return result.length || 0;
  }

  /**
   * Store tracked results from historical control group test runs
   *
   * Implements MongoDB's re-evaluation logic:
   * - Finds historical regressions from tracked test runs
   * - Re-evaluates those metrics using current test run's statistics and control group
   * - Stores fresh ADAPT analysis showing if historical regressions still appear
   *
   * This differs from the PostgreSQL approach which simply copies current ADAPT results.
   * MongoDB re-evaluation provides more accurate tracking of persistent regressions.
   *
   * @param manager - TypeORM entity manager for transactional operations
   * @param testRunIds - Test run IDs to store tracked results for
   * @returns Number of tracked results stored
   */
  async storeTrackedResults(manager: EntityManager, testRunIds: string[]): Promise<number> {
    this.logger.info(
      `Re-evaluating tracked results for ${testRunIds.length} test run(s) (MongoDB-style re-evaluation)`
    );

    const placeholders = testRunIds.map((_: unknown, i: number) => `$${i + 1}`).join(', ');

    // Get system info for config lookup
    const testRunInfo = await manager.query(
      `
      SELECT DISTINCT system_under_test_id, test_environment, workload
      FROM test_runs
      WHERE test_run_id IN (${placeholders})
    `,
      testRunIds
    );

    if (testRunInfo.length === 0) {
      this.logger.warn('No test run info found for tracked results');
      return 0;
    }

    const { system_under_test_id, test_environment, workload } = testRunInfo[0];

    // Pre-fetch config cache (same as processAdaptResults)
    const configCacheMap = await this.configCache.fetchCompareConfigCache(
      manager,
      system_under_test_id,
      test_environment,
      workload
    );

    // Create and populate temporary config cache table
    await this.controlGroupProcessor.createTempConfigCache(
      manager,
      configCacheMap,
      'temp_tracked_config_cache'
    );

    // Get default config from cache or use the standard default
    const defaultConfig =
      configCacheMap.get('default') || this.controlGroupProcessor.getDefaultCompareConfig();

    const trackedResultsSQL = this.trackedResultsSQLBuilder.buildTrackedResultsSQL(
      placeholders,
      testRunIds.length
    );

    const result = await manager.query(trackedResultsSQL, [
      ...testRunIds,
      JSON.stringify(defaultConfig),
    ]);
    const rowCount = result.length || 0;

    this.logger.info(`Re-evaluated ${rowCount} tracked result(s) against current baseline`);

    return rowCount;
  }

  /**
   * Update final test run status after ADAPT processing
   *
   * Delegates to AdaptStatusUpdater for final status updates including:
   * - evaluatingAdapt status to 'COMPLETED'
   * - adaptTestRunOK based on conclusion
   * - overall result consolidation
   *
   * @param manager - TypeORM entity manager for transactional operations
   * @param testRunIds - Test run IDs to update status for
   */
  async updateFinalStatus(manager: EntityManager, testRunIds: string[]): Promise<void> {
    await this.statusUpdater.updateFinalStatus(manager, testRunIds);
  }

  /**
   * Fetch all compare configs and create a hierarchical lookup map
   *
   * Delegates to CompareConfigCache for efficient config lookups.
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
    return this.configCache.fetchCompareConfigCache(
      manager,
      systemUnderTestId,
      testEnvironment,
      workload
    );
  }

  /**
   * Publish realtime updates for modified test runs
   *
   * Delegates to AdaptRealtimePublisher for non-blocking Redis publishing.
   * Failures will not affect pipeline execution.
   *
   * @param testRunIds - Test run IDs to publish updates for
   */
  async publishRealtimeUpdates(testRunIds: string[]): Promise<void> {
    await this.realtimePublisher.publishRealtimeUpdates(testRunIds);
  }
}
