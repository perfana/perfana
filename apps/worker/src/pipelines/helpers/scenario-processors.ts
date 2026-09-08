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
  ALL_AGGREGATED_SCENARIO,
  ALL_AGGREGATED_METRIC,
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
      // Set, not push: a real scenario named "all aggregated" would otherwise be emitted
      // twice on the same dashboard/panel/time and break the upsert batch.
      const allScenarioNames = [...new Set([...scenarioNames, ALL_AGGREGATED_SCENARIO])];

      const panel = this.dashboardManager.getMetricTypePanel(METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT);
      const metricTime = testRun.end_time || new Date();

      for (const scenarioName of allScenarioNames) {
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
            scenarioName === ALL_AGGREGATED_SCENARIO
              ? ALL_AGGREGATED_METRIC
              : buildScenarioMetricName('error_count'),
            0,
            metricTime,
            METRIC_TYPE_PANEL_UNITS[METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT],
            0, // Single data point
            testRun.start_time,
            testRun.ramp_up_time
          )
        );

        // Display-only — see the note on the roll-up in transactions-processor.ts.
        if (scenarioName !== ALL_AGGREGATED_SCENARIO) {
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
      }

      return { metrics, compareConfigs };
    }

    const totalErrors = errorsData.reduce((sum, row) => sum + parseInt(row.error_count, 10), 0);
    this.logger.info(`📊 Processing ${totalErrors} errors across ${errorsData.length} scenarios`);

    // Roll the scenarios up into the "all aggregated" dashboard's single series. A real
    // scenario of that name is dropped in favour of the roll-up — its count is already in
    // totalErrors, and two rows would collide inside one upsert batch.
    const rows = errorsData
      .filter(r => r.scenario_name !== ALL_AGGREGATED_SCENARIO)
      .concat({ scenario_name: ALL_AGGREGATED_SCENARIO, error_count: String(totalErrors) });

    const panelConfigsCreated = new Set<string>();

    // Process each scenario (already grouped by SQL)
    for (const row of rows) {
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
          scenarioName === ALL_AGGREGATED_SCENARIO
            ? ALL_AGGREGATED_METRIC
            : buildScenarioMetricName('error_count'),
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
      if (!panelConfigsCreated.has(panelKey) && scenarioName !== ALL_AGGREGATED_SCENARIO) {
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

    let vuData = await this.dataSource.query<Array<{
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

    // Roll the scenarios up into the "all aggregated" dashboard's single series.
    //
    // Concurrent threads ADD across scenarios, so the run-wide figure is a sum, not a mean
    // of means — but each scenario's average covers only its own samples, so a scenario
    // active for a fraction of the run would otherwise contribute its full average to the
    // whole run. Weighting by sample count against the longest-running scenario is that
    // fraction, and costs one pass over at most a few dozen rows.
    //
    // Not done by grouping the raw rows on `time` and summing: the samples are sub-second
    // and independent per scenario, so on real data almost every timestamp carries exactly
    // one scenario (measured: 128,919 distinct timestamps, 6,662 with more than one) and
    // that sum degenerates to the individual sample values — 65.7 against an actual 1249.
    // Doing it properly needs `time_bucket_gapfill` + `locf` per scenario, which needs both
    // window bounds and `end_time` is null on a running test.
    //
    // ponytail: the max is the sum of per-scenario maxima, an upper bound when scenarios
    // peak at different moments — a true peak needs the same gapfilled grid.
    const parse = (v: string | null) => (v ? parseFloat(v) : 0);
    const counts = vuData.map(r => parseInt(r.active_thread_count, 10));
    const longestRun = Math.max(...counts, 0);
    const totalSamples = counts.reduce((a, b) => a + b, 0);
    if (longestRun > 0) {
      const weightedAvg = vuData.reduce(
        (acc, r, i) => acc + parse(r.avg_active_threads) * (counts[i]! / longestRun), 0);
      // A real scenario of the rollup's name is dropped in favour of the rollup — its
      // samples are already counted, and two rows would collide inside one upsert batch.
      vuData = vuData
        .filter(r => r.scenario_name !== ALL_AGGREGATED_SCENARIO)
        .concat({
          scenario_name: ALL_AGGREGATED_SCENARIO,
          avg_active_threads: String(weightedAvg),
          max_active_threads: String(vuData.reduce((a, r) => a + parse(r.max_active_threads), 0)),
          active_thread_count: String(totalSamples),
        });
    }

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
              scenarioName === ALL_AGGREGATED_SCENARIO
                ? ALL_AGGREGATED_METRIC
                : buildScenarioMetricName('avg_active_threads'),
              avgActiveThreads,
              metricTime,
              METRIC_TYPE_PANEL_UNITS[METRIC_TYPE_PANEL_IDS.SCENARIO_AVG_THREADS],
              0, // Single data point
              testRun.start_time,
              testRun.ramp_up_time
            )
          );

          const avgKey = `${dashboard.dashboardId}::panel::${METRIC_TYPE_PANEL_IDS.SCENARIO_AVG_THREADS}`;
          if (!panelConfigsCreated.has(avgKey) && scenarioName !== ALL_AGGREGATED_SCENARIO) {
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
              scenarioName === ALL_AGGREGATED_SCENARIO
                ? ALL_AGGREGATED_METRIC
                : buildScenarioMetricName('max_active_threads'),
              maxActiveThreads,
              metricTime,
              METRIC_TYPE_PANEL_UNITS[METRIC_TYPE_PANEL_IDS.SCENARIO_MAX_THREADS],
              0, // Single data point
              testRun.start_time,
              testRun.ramp_up_time
            )
          );

          const maxKey = `${dashboard.dashboardId}::panel::${METRIC_TYPE_PANEL_IDS.SCENARIO_MAX_THREADS}`;
          if (!panelConfigsCreated.has(maxKey) && scenarioName !== ALL_AGGREGATED_SCENARIO) {
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
