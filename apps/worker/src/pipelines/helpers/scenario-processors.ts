/**
 * Scenario-Level Processors for Performance Test Metrics Pipeline
 *
 * Handles metrics that apply to the entire scenario (not specific transactions):
 * - Error counts from requests_error table -> Panel 301
 * - Virtual user metrics from virtual_users table -> Panels 302, 303
 */

import { DataSource } from 'typeorm';
import { analysisBoundsFromRow, snapBoundsToChunks, timeBoundsSql } from '@perfana/shared/database/run-window';
import type { Logger } from 'pino';
import type { DashboardManager } from './dashboard-manager.js';
import {
  buildScenarioMetricName,
  createDsMetricsRecord,
  createDsCompareConfigRecordPanelLevel,
  createDsCompareConfigRecordPanelLevelNoClassification,
} from './metrics-builder.js';
import { resolveScenarioDashboards } from './scenario-dashboards.js';
import { insertDsMetricsFromAggregate } from './perf-metrics-writer.js';
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
/**
 * The base name every scenario error series is composed from. One constant, because panel
 * 301 composes it through `buildScenarioMetricName` while panel 304 has to interpolate it
 * into SQL, and the two have to stay identical — 304 is documented as the same breakdown
 * over time, so a rename on one side would silently stop matching the other. It also feeds
 * the length budget below.
 */
const ERROR_COUNT_METRIC = 'error_count';

export const MAX_RESPONSE_CODE_LENGTH = Math.floor(
  (255 - 1 - Math.max(ERROR_COUNT_METRIC.length, ALL_AGGREGATED_METRIC.length)) / 2
);

/**
 * How many response-code series the over-time breakdown keeps per scenario, busiest first.
 *
 * Unlike panel 301 — one cumulative point per code, so every code is one row — this panel
 * writes one point per code PER BUCKET, zero-filled, so its row count is
 * codes x buckets x (scenarios + 1) whether the run had three errors or three million.
 * `response_code` is unbounded `text` straight from the JTL importer and JMeter writes
 * exception messages into it, so the distinct count is not bounded by HTTP.
 *
 * **It is a per-RUN cap, which only holds because the analysis is the panel's only writer.**
 * Ranked over a tick's window instead, each tick would keep its own busiest 20 and a run
 * whose error text rotates could end up storing 20 x ticks series — ~3,600 on a 3 h run —
 * with neither the `tail` nor the `skip` plan removing them. See `processOverTime`.
 *
 * ponytail: the tail is dropped, not folded into an "other" series — a 20-line legend is
 * already unreadable and panel 301 still carries every code. Add the fold if someone asks.
 */
const MAX_CODE_SERIES = 20;

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
      // Bounded by the run's padded window; unbounded this locks every chunk of
      // `requests_raw` (#674, see @perfana/shared/database/run-window).
      // Whole-run aggregate: widen to the chunk boundary so the planner can drop the qual
      // on a fully covered chunk (8,513 buffers vs 16,186 on a 2.5 M-row run) for one
      // ~3 ms catalog lookup, cached per table. Selective reads must NOT do this.
      const time = timeBoundsSql(
        await snapBoundsToChunks(
          (sql, p) => this.dataSource.query(sql, p) as Promise<unknown[]>, 'requests_raw',
          analysisBoundsFromRow(
            { start_time: testRun.start_time, end_time: testRun.end_time ?? null },
            false,
          )),
        'time',
        2,
      );
      const scenarioRows = await this.dataSource.query<Array<{ scenario_name: string }>>(
        `SELECT DISTINCT scenario_name FROM requests_raw
         WHERE test_run_id = $1 AND scenario_name IS NOT NULL ${time.clause}`,
        [testRunId, ...time.params]
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
              : buildScenarioMetricName(ERROR_COUNT_METRIC),
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
        : buildScenarioMetricName(ERROR_COUNT_METRIC);

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

  /**
   * Panel 304: the same per-response-code breakdown as panel 301, but one point per bucket
   * instead of one cumulative point per run — "which codes, and when".
   *
   * **The analysis is its only writer: a live tick returns early.** That is what bounds the
   * panel, and it was a deliberate choice over a live chart (reviewed 2026-10-14). Written
   * per tick instead, with the code set and the grid scoped to each tick's ~60 s window,
   * two things went wrong that nothing downstream repaired: each tick kept its OWN busiest
   * `MAX_CODE_SERIES` codes, so a run whose error text rotates — `response_code` is free
   * text and JMeter writes exception messages into it — could store 20 x ticks series
   * (~3,600 on a 3 h run), and neither the `tail` nor the `skip` plan deletes what the
   * ticks wrote. A live run still shows errors/sec over time on panels 109/220 and the
   * cumulative per-code totals on 301; only this breakdown waits for the analysis.
   *
   * Three more things differ from `process()` above:
   *
   * 1. **It reads the whole run**, like `process()` and for a related reason: one writer
   *    over one window is what makes the top-N a per-run cap rather than a per-tick one.
   * 2. **It writes from SQL** through `insertDsMetricsFromAggregate`. codes x buckets x
   *    scenarios is thousands of rows where the other two scenario panels are a handful,
   *    and the zero-fill below is natural in SQL and fiddly in JS.
   * 3. **It zero-fills over the RUN's span.** A bucket with no errors produces no
   *    `requests_error` row, and without an explicit 0 the chart draws a straight line over
   *    the quiet stretch and the mean ADAPT compares is "errors per bucket THAT HAD ERRORS" —
   *    a run with one bad minute would read the same as one that failed throughout. Two
   *    earlier versions of the grid were worse in opposite directions. Ending it at the clock
   *    (`filter_to_time ?? new Date()`) was unbounded: a run that never reported an `end_time`
   *    takes `planFullCollection`'s rebuild arm, so one analysed a week later zero-filled a
   *    week of buckets it never existed for. Taking it from MIN/MAX of the data made the span
   *    the noisiest property of an error series — one scenario's late error stretched every
   *    other scenario's grid, moving its mean by orders of magnitude with no change in its own
   *    data, and two runs with identical errors but a different last error stopped being
   *    comparable at all. `start_time` is the bucket origin, so a grid starting there is
   *    aligned by construction, and run length / bucket bounds it at ~250 points.
   *
   * Values are errors/sec, like panels 109/220 and for the same reason: bucket size is a
   * step function of run length, so a raw per-bucket count is not comparable across runs.
   */
  async processOverTime(
    testRunId: string,
    testRun: TestRunMetadata,
    bucketSizeSeconds: number,
    isIncremental: boolean
  ): Promise<{ rowsInserted: number; compareConfigs: DsCompareConfigRecord[] }> {
    const compareConfigs: DsCompareConfigRecord[] = [];
    const panelId = METRIC_TYPE_PANEL_IDS.SCENARIO_ERRORS_OVER_TIME;

    // Analysis-only — see the note on the top-N cap in the docstring. `completed` rather
    // than `!isIncremental`, because the `tail` plan is an incremental-looking full pass and
    // it IS the writer on a ticked run; a force re-fetch of a completed run is one too.
    //
    // `end_time` is required for the same reason `planFullCollection` refuses to size a run
    // without one: it IS the grid's end. Without it the bucket size falls back to the tick's,
    // which is derived from `planned_duration` rather than from the run — so a run that
    // posted a 2-minute plan, actually ran two hours and never reported an end would get 1 s
    // buckets over a 2 h span, ~7200 of them against a panel whose cost is buckets x codes x
    // scenarios. The ~250-bucket ceiling that bounds every other shape comes from sizing the
    // bucket off the real length, and that is exactly what is missing here.
    if (!testRun.completed || !testRun.end_time) {
      return { rowsInserted: 0, compareConfigs };
    }

    // **Whole-run bounds, not the caller's window.** `resolveScenarioDashboards` reads
    // `filter_from_time`, and the pipeline hands this method the run stamped with the pass's
    // window — so on the `tail` plan the lookup would only see the last tick's minutes. A run
    // whose errors did not land there returned `scenarioNames = []` and wrote nothing, and
    // because the pass then calls `markCollectionComplete` every later analyze takes the
    // `skip` arm: panel 304 empty forever, nothing logged, only a force re-fetch recovering
    // it. `tail` is the WELL-BEHAVED plan (tick === final), so good runs got the broken panel.
    // `process()` above overrides the same field by hand for the same reason.
    const runWide = {
      ...testRun,
      filter_from_time: testRun.start_time,
      filter_to_time: testRun.end_time,
    } as TestRunMetadata;

    const { dashboards, scenarioNames } = await resolveScenarioDashboards({
      dataSource: this.dataSource,
      dashboardManager: this.dashboardManager,
      logger: this.logger,
      table: 'requests_error',
      testRunId,
      testRun: runWide,
    });

    if (scenarioNames.length === 0) {
      // No errors in the window is the normal case, not a warning: nothing to break down.
      return { rowsInserted: 0, compareConfigs };
    }

    const panel = this.dashboardManager.getMetricTypePanel(panelId);
    // **The roll-up gets a config too, unlike every other processor — but an UNCLASSIFIED
    // one, and the difference is the run verdict.** Elsewhere the roll-up is left configless,
    // and the thing that actually keeps it harmless is not the missing row:
    // `buildCompareConfigCache` seeds a `'default'` entry unconditionally, so a configless
    // series resolves to DEFAULT_COMPARE_CONFIG and IS evaluated. What makes that benign is
    // `higherIsBetter: null` — `buildConclusionLogic` only emits `'regression'` under
    // `= true` or `= false`, and `buildConclusionSQL` flips a run on `regression_count > 0`
    // while `increase`/`decrease` land in `difference_count`. 301-303's roll-up is doubly
    // safe (one point, so the sample floor reads `incomparable`); 304's dense series clear
    // that floor, so the ONLY thing standing between it and the verdict is the
    // classification. Giving it `RED_errors` was tried and is wrong: on a single-scenario run
    // `All aggregated.<code>` is numerically identical to `error_count.<code>`, so every
    // regression would be counted twice and the roll-up would flip runs on its own. So: the
    // panel's chosen aggregation (`mean`, not the default's `median`, which reads 0 on a
    // zero-filled sparse series), and no classification.
    for (const scenarioName of scenarioNames) {
      const dashboard = dashboards.get(scenarioName);
      if (dashboard && scenarioName !== ALL_AGGREGATED_SCENARIO) {
        compareConfigs.push(
          createDsCompareConfigRecordPanelLevel(
            testRun,
            dashboard,
            panel,
            METRIC_TYPE_PANEL_ADAPT_AGGREGATION[panelId],
            METRIC_TYPE_PANEL_CLASSIFICATIONS[panelId]
          )
        );
      }
    }
    const rollup = dashboards.get(ALL_AGGREGATED_SCENARIO);
    if (rollup) {
      compareConfigs.push(
        createDsCompareConfigRecordPanelLevelNoClassification(
          testRun,
          rollup,
          panel,
          METRIC_TYPE_PANEL_ADAPT_AGGREGATION[panelId]
        )
      );
    }

    // Bounded by the RUN, never by the caller's window and never by the clock: the same
    // bounds `process()` uses, so the two panels count the same errors, and the same bounds
    // the dashboard lookup above now uses, so a scenario cannot be gated out of a series it
    // has data for.
    const params: unknown[] = [
      testRunId,                                 // $1
      bucketSizeSeconds,                         // $2
      testRun.start_time,                        // $3 bucket origin, lower bound, grid start
      testRun.end_time,                          // $4 upper bound + grid end (may be null)
      ALL_AGGREGATED_SCENARIO,                   // $5
      ALL_AGGREGATED_METRIC,                     // $6
      MAX_CODE_SERIES,                           // $7
      ERROR_COUNT_METRIC,                        // $8 — bound, not interpolated
    ];

    const aggregateCte = `
      err AS (
        SELECT
          COALESCE(scenario_name, 'default') AS scenario_name,
          left(COALESCE(NULLIF(response_code, ''), 'unknown'), ${MAX_RESPONSE_CODE_LENGTH}) AS response_code,
          CASE
            WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb')
            THEN time_bucket(INTERVAL '1 second' * $2, time, $3::timestamptz)
            -- Origin PLUS the offset, not the row's own timestamp plus the offset. Adding it
            -- to \`time\` returns a value a whole bucket past the boundary and keeps 1 s
            -- resolution inside it, so of N rows in one bucket only one could ever satisfy
            -- the grid equality below and the rest would be dropped as zeros.
            ELSE $3::timestamptz + INTERVAL '1 second'
                 * (FLOOR(EXTRACT(EPOCH FROM (time - $3::timestamptz)) / $2) * $2)
          END AS bucket_time
        FROM requests_error
        WHERE test_run_id = $1
          AND time >= $3::timestamptz
          AND ($4::timestamptz IS NULL OR time <= $4::timestamptz)
      ),
      -- Grouped ONCE, before the roll-up, so \`err\` has a single reference and Postgres
      -- inlines it. Referenced twice it is materialised into a tuplestore and the roll-up
      -- then pushes 2x the run's raw error rows — each carrying a 120-char text column —
      -- through the HashAggregate below, which is how a 3 M-error run spills under the
      -- 128MB work_mem the aggregation budget sets.
      base AS (
        SELECT scenario_name, response_code, bucket_time, COUNT(*) AS errors
        FROM err
        GROUP BY 1, 2, 3
      ),
      -- The roll-up aggregates the GROUPED set (codes x buckets x scenarios, thousands)
      -- rather than the raw rows. A real scenario whose name IS the roll-up's is folded into
      -- it instead of being emitted twice: both halves land on one dashboard, so two rows
      -- would share (dashboard, panel, metric_name, time) in one statement and be rejected.
      counted AS (
        SELECT scenario_name, response_code, bucket_time, errors
        FROM base WHERE scenario_name <> $5
        UNION ALL
        SELECT $5, response_code, bucket_time, SUM(errors)
        FROM base GROUP BY 2, 3
      ),
      codes AS (
        SELECT scenario_name, response_code FROM (
          SELECT scenario_name, response_code,
                 ROW_NUMBER() OVER (
                   PARTITION BY scenario_name ORDER BY SUM(errors) DESC, response_code
                 ) AS rn
          FROM counted GROUP BY 1, 2
        ) ranked WHERE rn <= $7
      ),
      -- **The grid is the RUN, one span for every scenario and every run of the workload.**
      -- Two earlier versions were worse in opposite directions. Ending it at the clock
      -- (\`filter_to_time ?? now()\`) was unbounded on a run with no end_time. Taking it from
      -- MIN/MAX of the data made the span the noisiest property of an error series: one
      -- scenario's late error stretched every other scenario's grid, so its mean — the
      -- configured ADAPT aggregation — moved by orders of magnitude with no change in its own
      -- data, and two runs with identical error behaviour but a different last error were not
      -- comparable. \`$3\` is the bucket origin, so a series starting there is aligned by
      -- construction. MAX(bucket_time) is the fallback only for a completed run with no
      -- end_time; generate_series over a NULL bound yields no rows rather than erroring.
      bounds AS (
        SELECT COALESCE($4::timestamptz, MAX(bucket_time)) AS hi FROM counted
      ),
      buckets AS (
        SELECT generate_series(
          $3::timestamptz,
          (SELECT hi FROM bounds),
          INTERVAL '1 second' * $2
        ) AS bucket_time
      ),
      filled AS (
        SELECT
          c.scenario_name,
          c.response_code,
          b.bucket_time,
          COALESCE(n.errors, 0)::double precision / $2 AS value
        FROM codes c
        CROSS JOIN buckets b
        LEFT JOIN counted n
          ON n.scenario_name = c.scenario_name
         AND n.response_code = c.response_code
         AND n.bucket_time = b.bucket_time
      )`;

    const rowsSelect = `
      SELECT
        f.scenario_name,
        (CASE WHEN f.scenario_name = $5 THEN $6 ELSE $8 END)
          || '.' || f.response_code AS metric_name,
        ${panelId} AS panel_id,
        f.value,
        f.bucket_time,
        FLOOR(EXTRACT(EPOCH FROM (f.bucket_time - $3::timestamptz)) / $2)::integer AS timestep
      FROM filled f`;

    const rowsInserted = await insertDsMetricsFromAggregate({
      dataSource: this.dataSource,
      aggregateCte,
      rowsSelect,
      params,
      dashboards,
      panelIds: [panelId],
      testRunId,
      testRun,
      isIncremental,
    });

    this.logger.info(`✅ Created ${rowsInserted} error-code series points`);

    return { rowsInserted, compareConfigs };
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
