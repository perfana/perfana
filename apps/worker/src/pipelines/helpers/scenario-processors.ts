/**
 * Scenario-Level Processors for Performance Test Metrics Pipeline
 *
 * Handles metrics that apply to the entire scenario (not specific transactions):
 * - Error counts from requests_error table -> Panel 301
 * - Virtual user metrics from virtual_users table -> Panels 302, 303
 */

import { DataSource } from 'typeorm';
import type { Logger } from 'pino';
import type { DashboardManager } from './dashboard-manager.js';
import {
  buildScenarioMetricName,
  createDsMetricsRecord,
  createDsCompareConfigRecordPanelLevel,
} from './metrics-builder.js';
import {
  METRIC_TYPE_PANEL_IDS,
  METRIC_TYPE_PANEL_UNITS,
  METRIC_TYPE_PANEL_CLASSIFICATIONS,
  METRIC_TYPE_PANEL_ADAPT_AGGREGATION,
} from '../../constants/performance-metrics.js';
import type {
  TestRunMetadata,
  DsMetricsRecord,
  DsCompareConfigRecord,
} from '../../types/performance-metrics.js';

export interface ScenarioProcessorResult {
  metrics: DsMetricsRecord[];
  compareConfigs: DsCompareConfigRecord[];
}

/**
 * Errors Processor
 * Processes requests_error table and creates scenario-level error metrics (Panel 301)
 *
 * For incremental collection, uses filter_from_time/filter_to_time for time filtering.
 */
export class ErrorsProcessor {
  constructor(
    private dataSource: DataSource,
    private dashboardManager: DashboardManager,
    private logger: Logger
  ) {}

  async process(
    testRunId: string,
    testRun: TestRunMetadata
  ): Promise<ScenarioProcessorResult> {
    const metrics: DsMetricsRecord[] = [];
    const compareConfigs: DsCompareConfigRecord[] = [];

    // Determine effective filter times (use filter times if set, otherwise use start/end)
    const filterFromTime = testRun.filter_from_time ?? testRun.start_time;
    const filterToTime = testRun.filter_to_time ?? testRun.end_time;
    const hasFilterEndTime = filterToTime !== null;

    // Aggregate error counts per scenario in SQL (avoids loading all error rows into JS)
    let query = `
      SELECT COALESCE(scenario_name, 'default') as scenario_name, COUNT(*) as error_count
      FROM requests_error
      WHERE test_run_id = $1 AND time >= $2`;
    const params: unknown[] = [testRunId, filterFromTime];

    if (hasFilterEndTime) {
      query += ` AND time <= $3`;
      params.push(filterToTime);
    }

    query += ` GROUP BY scenario_name`;

    const errorsData = await this.dataSource.query<Array<{ scenario_name: string; error_count: string }>>(query, params);

    this.logger.debug(
      `🔍 Errors query time range: ${filterFromTime.toISOString()} to ${filterToTime?.toISOString() ?? 'null'} - found ${errorsData?.length ?? 0} scenario groups`
    );

    if (!errorsData || errorsData.length === 0) {
      this.logger.info(`✅ No errors found for test run ${testRunId}`);

      // Look up actual scenario names from requests_raw so zero-error
      // data points are attributed to the real scenarios, not a phantom "default".
      const scenarioRows = await this.dataSource.query<Array<{ scenario_name: string }>>(
        `SELECT DISTINCT scenario_name FROM requests_raw
         WHERE test_run_id = $1 AND scenario_name IS NOT NULL`,
        [testRunId]
      );
      const scenarioNames = scenarioRows.length > 0
        ? scenarioRows.map(r => r.scenario_name)
        : ['default'];

      const panel = this.dashboardManager.getMetricTypePanel(METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT);
      const metricTime = testRun.end_time || new Date();

      for (const scenarioName of scenarioNames) {
        const dashboard = await this.dashboardManager.getOrCreateScenarioDashboard(
          scenarioName,
          testRun.system_under_test_id,
          testRun.test_environment
        );

        metrics.push(
          createDsMetricsRecord(
            testRunId,
            dashboard,
            panel,
            buildScenarioMetricName('error_count'),
            0,
            metricTime,
            METRIC_TYPE_PANEL_UNITS[METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT],
            0, // Single data point
            testRun.start_time,
            testRun.ramp_up_time
          )
        );

        compareConfigs.push(
          createDsCompareConfigRecordPanelLevel(
            testRun,
            dashboard,
            panel,
            METRIC_TYPE_PANEL_ADAPT_AGGREGATION[METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT],
            METRIC_TYPE_PANEL_CLASSIFICATIONS[METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT]
          )
        );
      }

      return { metrics, compareConfigs };
    }

    const totalErrors = errorsData.reduce((sum, row) => sum + parseInt(row.error_count, 10), 0);
    this.logger.info(`📊 Processing ${totalErrors} errors across ${errorsData.length} scenarios`);

    const panelConfigsCreated = new Set<string>();

    // Process each scenario (already grouped by SQL)
    for (const row of errorsData) {
      const scenarioName = row.scenario_name;
      const errorCount = parseInt(row.error_count, 10);

      // Get/create dashboard for this scenario
      const dashboard = await this.dashboardManager.getOrCreateScenarioDashboard(
        scenarioName,
        testRun.system_under_test_id,
        testRun.test_environment
      );

      const panel = this.dashboardManager.getMetricTypePanel(METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT);
      const metricTime = testRun.end_time || new Date();

      // Create error count metric
      metrics.push(
        createDsMetricsRecord(
          testRunId,
          dashboard,
          panel,
          buildScenarioMetricName('error_count'),
          errorCount,
          metricTime,
          METRIC_TYPE_PANEL_UNITS[METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT],
          0, // Single data point
          testRun.start_time,
          testRun.ramp_up_time
        )
      );

      // Create panel-level compare config (once per dashboard)
      const panelKey = `${dashboard.dashboardId}::panel::${METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT}`;
      if (!panelConfigsCreated.has(panelKey)) {
        compareConfigs.push(
          createDsCompareConfigRecordPanelLevel(
            testRun,
            dashboard,
            panel,
            METRIC_TYPE_PANEL_ADAPT_AGGREGATION[METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT],
            METRIC_TYPE_PANEL_CLASSIFICATIONS[METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT]
          )
        );
        panelConfigsCreated.add(panelKey);
      }
    }

    this.logger.info(`✅ Created ${metrics.length} error metrics`);

    return { metrics, compareConfigs };
  }

}

/**
 * Virtual Users Processor
 * Processes virtual_users table and creates scenario-level VU metrics
 * - avg_active_threads -> Panel 302
 * - max_active_threads -> Panel 303
 *
 * For incremental collection, uses filter_from_time/filter_to_time for time filtering.
 */
export class VirtualUsersProcessor {
  constructor(
    private dataSource: DataSource,
    private dashboardManager: DashboardManager,
    private logger: Logger
  ) {}

  async process(
    testRunId: string,
    testRun: TestRunMetadata
  ): Promise<ScenarioProcessorResult> {
    const metrics: DsMetricsRecord[] = [];
    const compareConfigs: DsCompareConfigRecord[] = [];

    // Determine effective filter times (use filter times if set, otherwise use start/end)
    const filterFromTime = testRun.filter_from_time ?? testRun.start_time;
    const filterToTime = testRun.filter_to_time ?? testRun.end_time;
    const hasFilterEndTime = filterToTime !== null;

    // Aggregate VU metrics per scenario in SQL (avoids loading all VU rows into JS)
    let query = `
      SELECT
        COALESCE(scenario_name, 'default') as scenario_name,
        AVG(active_threads) FILTER (WHERE active_threads IS NOT NULL) as avg_active_threads,
        MAX(active_threads) FILTER (WHERE active_threads IS NOT NULL) as max_active_threads,
        COUNT(*) FILTER (WHERE active_threads IS NOT NULL) as active_thread_count
      FROM virtual_users
      WHERE test_run_id = $1 AND time >= $2`;
    const params: unknown[] = [testRunId, filterFromTime];

    if (hasFilterEndTime) {
      query += ` AND time <= $3`;
      params.push(filterToTime);
    }

    query += ` GROUP BY scenario_name`;

    const vuData = await this.dataSource.query<Array<{
      scenario_name: string;
      avg_active_threads: string | null;
      max_active_threads: string | null;
      active_thread_count: string;
    }>>(query, params);

    this.logger.debug(
      `🔍 VirtualUsers query time range: ${filterFromTime.toISOString()} to ${filterToTime?.toISOString() ?? 'null'} - found ${vuData?.length ?? 0} scenario groups`
    );

    if (!vuData || vuData.length === 0) {
      this.logger.warn(`⚠️  No virtual_users data found for test run ${testRunId} in time range`);
      return { metrics, compareConfigs };
    }

    this.logger.info(`📊 Processing virtual user data for ${vuData.length} scenarios`);

    const panelConfigsCreated = new Set<string>();

    // Process each scenario (already grouped by SQL)
    for (const row of vuData) {
      const scenarioName = row.scenario_name;

      // Get/create dashboard for this scenario
      const dashboard = await this.dashboardManager.getOrCreateScenarioDashboard(
        scenarioName,
        testRun.system_under_test_id,
        testRun.test_environment
      );

      const activeThreadCount = parseInt(row.active_thread_count, 10);

      if (activeThreadCount > 0) {
        const avgActiveThreads = row.avg_active_threads ? parseFloat(row.avg_active_threads) : null;
        const maxActiveThreads = row.max_active_threads ? parseFloat(row.max_active_threads) : null;

        const metricTime = testRun.end_time || new Date();

        if (avgActiveThreads !== null) {
          const avgPanel = this.dashboardManager.getMetricTypePanel(METRIC_TYPE_PANEL_IDS.SCENARIO_AVG_THREADS);
          metrics.push(
            createDsMetricsRecord(
              testRunId,
              dashboard,
              avgPanel,
              buildScenarioMetricName('avg_active_threads'),
              avgActiveThreads,
              metricTime,
              METRIC_TYPE_PANEL_UNITS[METRIC_TYPE_PANEL_IDS.SCENARIO_AVG_THREADS],
              0, // Single data point
              testRun.start_time,
              testRun.ramp_up_time
            )
          );

          const avgKey = `${dashboard.dashboardId}::panel::${METRIC_TYPE_PANEL_IDS.SCENARIO_AVG_THREADS}`;
          if (!panelConfigsCreated.has(avgKey)) {
            compareConfigs.push(
              createDsCompareConfigRecordPanelLevel(
                testRun,
                dashboard,
                avgPanel,
                METRIC_TYPE_PANEL_ADAPT_AGGREGATION[METRIC_TYPE_PANEL_IDS.SCENARIO_AVG_THREADS],
                METRIC_TYPE_PANEL_CLASSIFICATIONS[METRIC_TYPE_PANEL_IDS.SCENARIO_AVG_THREADS]
              )
            );
            panelConfigsCreated.add(avgKey);
          }
        }

        if (maxActiveThreads !== null) {
          const maxPanel = this.dashboardManager.getMetricTypePanel(METRIC_TYPE_PANEL_IDS.SCENARIO_MAX_THREADS);
          metrics.push(
            createDsMetricsRecord(
              testRunId,
              dashboard,
              maxPanel,
              buildScenarioMetricName('max_active_threads'),
              maxActiveThreads,
              metricTime,
              METRIC_TYPE_PANEL_UNITS[METRIC_TYPE_PANEL_IDS.SCENARIO_MAX_THREADS],
              0, // Single data point
              testRun.start_time,
              testRun.ramp_up_time
            )
          );

          const maxKey = `${dashboard.dashboardId}::panel::${METRIC_TYPE_PANEL_IDS.SCENARIO_MAX_THREADS}`;
          if (!panelConfigsCreated.has(maxKey)) {
            compareConfigs.push(
              createDsCompareConfigRecordPanelLevel(
                testRun,
                dashboard,
                maxPanel,
                METRIC_TYPE_PANEL_ADAPT_AGGREGATION[METRIC_TYPE_PANEL_IDS.SCENARIO_MAX_THREADS],
                METRIC_TYPE_PANEL_CLASSIFICATIONS[METRIC_TYPE_PANEL_IDS.SCENARIO_MAX_THREADS]
              )
            );
            panelConfigsCreated.add(maxKey);
          }
        }
      }
    }

    this.logger.info(`✅ Created ${metrics.length} virtual user metrics`);

    return { metrics, compareConfigs };
  }

}
