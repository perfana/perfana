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
 * Scenario-level panels (Error Count, Avg/Max Active Threads) hold ONE point per run by
 * construction, so the deployment-wide ADAPT_MIN_SAMPLE_COUNT floor would make them
 * permanently incomparable. Their compare configs opt out.
 */
const SCENARIO_PANEL_MIN_SAMPLE_COUNT = 1;

/**
 * How much of a response code may reach a metric name, derived rather than written down:
 * `ds_metrics.metric_name` is `varchar(255)` **and part of the primary key**, and the writer
 * truncates with `.substring(0, 255)` (`PerformanceTestMetricsPipeline.saveDsMetrics`). Two
 * codes agreeing on their first `MAX_RESPONSE_CODE_LENGTH` characters would otherwise collapse
 * to one `metric_name` AFTER the
 * dedupe that is supposed to prevent it, and two rows sharing
 * `(dashboard, panel, metric_name, time)` are rejected by the batch outright — a unique
 * violation on a rebuild, a `cardinality_violation` on a tick — which fails the
 * `performance-test-metrics` stage for that run on every analysis, with nothing to repair it.
 * `requests_error.response_code` is unbounded `text` written straight through by the JTL
 * importer, so the length is reachable from an uploaded file.
 *
 * Applying it in SQL rather than in JS is what makes it safe: the truncated value becomes the
 * GROUP BY key, so Postgres sums the collapsed codes into one row instead of handing us two
 * rows that only collide later.
 *
 * **The budget is HALVED because the two ends count in different units.** Postgres `left()`
 * and `varchar(255)` count CHARACTERS; the last writer is `.substring(0, 255)`, which counts
 * UTF-16 CODE UNITS, and a non-BMP character (emoji, astral-plane CJK) is two of those. At the
 * full 240 the arithmetic looked right and was wrong: measured 2026-10-13, two codes of 239
 * astral characters plus a distinguishing suffix survive `left()` as 240 distinct characters,
 * compose to a name of 255 characters but **494 code units**, and are then cut by the writer to
 * the SAME 135-character value — reintroducing the exact primary-key collision this constant
 * exists to prevent, and cutting mid-surrogate so the stored name is mangled too. UTF-16 is at
 * most 2 units per code point, so bounding characters at half the budget bounds code units at
 * all of it: worst case 120 astral characters = 240 units, plus the longest base name and its
 * dot = 255 units exactly, and the writer's `substring` becomes a no-op. Derived from
 * `ALL_AGGREGATED_METRIC` so a longer base name cannot silently reintroduce the overflow.
 */
const MAX_RESPONSE_CODE_LENGTH = Math.floor(
  (255 - 1 - Math.max('error_count'.length, ALL_AGGREGATED_METRIC.length)) / 2
);

/**
 * Where a run's single scenario-level point is written. A live run does not know its end_time
 * yet (the keep-alive update moves it to "now" on every post), so the ticks upsert the
 * cumulative value at start_time — one fixed timestamp, so a run never carries more than one
 * interim point — and the final pass in PerformanceTestMetricsPipeline moves it to the end of
 * the analysis window. The interim point is flagged ramp_up when the run has an analysis start
 * offset, so the live statistics leave it out; the final one must not be.
 *
 * **The final point is written at `end_time - ramp_down`, not at `end_time`.** `RAMP_UP_EXPR`
 * (StatisticsPipeline) flags anything strictly later than that boundary as outside the analysis
 * window, and `ds_metric_statistics` holds `ramp_up = false` rows only — so on any workload with
 * a ramp-down offset the point at `end_time` was flagged, panels 301/302/303 got no statistics
 * row at all, and every SLO and ADAPT comparison on Error Count / Avg / Max Active Threads
 * silently evaluated nothing. Measured on the dev database: every run with `ramp_down = 30`
 * since v0.2.95.23 had 100% of its scenario points flagged and zero statistics rows, while the
 * one run with `ramp_down = 0` had both. The boundary is inclusive (`>` in RAMP_UP_EXPR), so
 * landing exactly on it is in-window.
 *
 * The shift applies only when the offsets FIT the run — the same guard RAMP_UP_EXPR opens with.
 * When they do not, the whole run is the analysis window, `end_time` is already in it, and
 * subtracting a ramp-down longer than the run would put the point before `start_time`.
 */
export function scenarioMetricTime(testRun: TestRunMetadata): Date {
  if (!testRun.completed || !testRun.end_time) {
    return testRun.start_time;
  }

  const rampDown = testRun.ramp_down_time ?? 0;
  const durationSeconds = (testRun.end_time.getTime() - testRun.start_time.getTime()) / 1000;
  if (rampDown <= 0 || durationSeconds <= (testRun.ramp_up_time ?? 0) + rampDown) {
    return testRun.end_time;
  }
  return new Date(testRun.end_time.getTime() - rampDown * 1000);
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

    // Cumulative from start_time, whatever window the caller is aggregating: these panels
    // hold one point per run, so a tick must count what the rebuild counts — the whole run
    // so far — not the minute it covers. See scenarioMetricTime for where it is written.
    const filterFromTime = testRun.start_time;
    const filterToTime = testRun.filter_to_time ?? testRun.end_time;
    const hasFilterEndTime = filterToTime !== null;
    const metricTime = scenarioMetricTime(testRun);

    // Aggregate error counts per scenario AND response code in SQL (avoids loading all
    // error rows into JS). GROUP BY on the output expressions, not the raw columns: a run
    // with both a NULL and a literal 'default' scenario (or a NULL and an empty response
    // code) would otherwise yield two rows that coalesce to one metric name, and two rows
    // with the same (dashboard, panel, metric_name, time) are rejected by the upsert batch.
    let query = `
      SELECT COALESCE(scenario_name, 'default') as scenario_name,
             left(COALESCE(NULLIF(response_code, ''), 'unknown'), ${MAX_RESPONSE_CODE_LENGTH}) as response_code,
             COUNT(*) as error_count
      FROM requests_error
      WHERE test_run_id = $1 AND time >= $2`;
    const params: unknown[] = [testRunId, filterFromTime];

    if (hasFilterEndTime) {
      query += ` AND time <= $3`;
      params.push(filterToTime);
    }

    query += ` GROUP BY 1, 2`;

    const errorsData = await this.dataSource.query<Array<{
      scenario_name: string;
      response_code: string;
      error_count: string;
    }>>(query, params);

    this.logger.debug(
      `🔍 Errors query time range: ${filterFromTime.toISOString()} to ${filterToTime?.toISOString() ?? 'null'} - found ${errorsData?.length ?? 0} scenario/response-code groups`
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
              METRIC_TYPE_PANEL_CLASSIFICATIONS[METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT],
              SCENARIO_PANEL_MIN_SAMPLE_COUNT
            )
          );
        }
      }

      return { metrics, compareConfigs };
    }

    const totalErrors = errorsData.reduce((sum, row) => sum + parseInt(row.error_count, 10), 0);
    const scenarioCount = new Set(errorsData.map(r => r.scenario_name)).size;
    this.logger.info(`📊 Processing ${totalErrors} errors across ${scenarioCount} scenarios`);

    // scenario -> response code -> count, plus the run-wide roll-up onto the "all
    // aggregated" dashboard. A real scenario of the roll-up's name is folded into it rather
    // than emitted twice — its count is already in the roll-up, and two rows would collide
    // inside one upsert batch.
    const byScenario = new Map<string, Map<string, number>>();
    const rollup = new Map<string, number>();
    for (const row of errorsData) {
      const count = parseInt(row.error_count, 10);
      rollup.set(row.response_code, (rollup.get(row.response_code) ?? 0) + count);
      if (row.scenario_name === ALL_AGGREGATED_SCENARIO) { continue; }
      const codes = byScenario.get(row.scenario_name) ?? new Map<string, number>();
      // Additive on both sides. `GROUP BY 1, 2` already makes (scenario, code) unique, so an
      // overwrite is correct today — but then the two halves of this loop would disagree about
      // the same input, and the day anything hands it pre-grouped rows the per-scenario total
      // would silently lose a count while the roll-up kept it, leaving `error_count` and
      // `All aggregated` no longer summing to each other with nothing logged.
      codes.set(row.response_code, (codes.get(row.response_code) ?? 0) + count);
      byScenario.set(row.scenario_name, codes);
    }
    const rows: Array<[string, Map<string, number>]> = [
      ...byScenario,
      [ALL_AGGREGATED_SCENARIO, rollup],
    ];

    const panelConfigsCreated = new Set<string>();

    // One entry per scenario plus the synthesized roll-up; codeCounts is code -> count.
    for (const [scenarioName, codeCounts] of rows) {
      // Get/create dashboard for this scenario
      const dashboard = await this.dashboardManager.getOrCreateScenarioDashboard(
        scenarioName,
        testRun.system_under_test_id,
        testRun.test_environment
      );

      const panel = this.dashboardManager.getMetricTypePanel(METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT);
      const baseName = scenarioName === ALL_AGGREGATED_SCENARIO
        ? ALL_AGGREGATED_METRIC
        : buildScenarioMetricName('error_count');

      // The unchanged total series first, then one series per response code beside it.
      // On a REAL scenario's dashboard all of them sit on panel 301 and inherit its
      // panel-level compare config — RED_errors, minSampleCount 1 — with no per-metric
      // config to keep in step. On the roll-up dashboard the config below is gated on the
      // scenario not being the roll-up, so those series carry none — but that does NOT mean
      // ADAPT skips them: `buildCompareConfigCache` seeds a `'default'` entry
      // unconditionally, so they resolve to DEFAULT_COMPARE_CONFIG and ARE evaluated. What
      // makes them read `incomparable` is the sample floor: with no `minSampleCount` in that
      // default, the floor falls back to `ADAPT_MIN_SAMPLE_COUNT` (default 2) and these
      // panels hold exactly one point per run. A deployment that sets it to 1 — the value
      // this very file passes as SCENARIO_PANEL_MIN_SAMPLE_COUNT — makes the whole roll-up
      // dashboard comparable, totals and per-code series alike.
      const series: Array<[string, number]> = [
        [baseName, [...codeCounts.values()].reduce((a, b) => a + b, 0)],
        ...[...codeCounts].map(([code, count]): [string, number] => [`${baseName}.${code}`, count]),
      ];

      for (const [metricName, value] of series) {
        metrics.push(
          createDsMetricsRecord(
            testRunId,
            dashboard,
            panel,
            metricName,
            value,
            metricTime,
            METRIC_TYPE_PANEL_UNITS[METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT],
            0, // Single data point
            testRun.start_time,
            testRun.ramp_up_time
          )
        );
      }

      // Create panel-level compare config (once per dashboard)
      const panelKey = `${dashboard.dashboardId}::panel::${METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT}`;
      if (!panelConfigsCreated.has(panelKey) && scenarioName !== ALL_AGGREGATED_SCENARIO) {
        compareConfigs.push(
          createDsCompareConfigRecordPanelLevel(
            testRun,
            dashboard,
            panel,
            METRIC_TYPE_PANEL_ADAPT_AGGREGATION[METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT],
            METRIC_TYPE_PANEL_CLASSIFICATIONS[METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT],
            SCENARIO_PANEL_MIN_SAMPLE_COUNT
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

    // Cumulative from start_time, whatever window the caller is aggregating: these panels
    // hold one point per run, so a tick must count what the rebuild counts — the whole run
    // so far — not the minute it covers. See scenarioMetricTime for where it is written.
    const filterFromTime = testRun.start_time;
    const filterToTime = testRun.filter_to_time ?? testRun.end_time;
    const hasFilterEndTime = filterToTime !== null;
    const metricTime = scenarioMetricTime(testRun);

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

    // On the coalesced output expression, not the raw column — same reason as ErrorsProcessor
    // above: `GROUP BY scenario_name` resolves to the input column, so a run holding both a
    // NULL and a literal 'default' scenario yields two rows that coalesce to one metric name,
    // and two rows sharing (dashboard, panel, metric_name, time) fail the upsert batch. Panels
    // 302/303 carried that exposure until v0.2.97.16.
    query += ` GROUP BY 1`;

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
                METRIC_TYPE_PANEL_CLASSIFICATIONS[METRIC_TYPE_PANEL_IDS.SCENARIO_AVG_THREADS],
                SCENARIO_PANEL_MIN_SAMPLE_COUNT
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
                METRIC_TYPE_PANEL_CLASSIFICATIONS[METRIC_TYPE_PANEL_IDS.SCENARIO_MAX_THREADS],
                SCENARIO_PANEL_MIN_SAMPLE_COUNT
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
