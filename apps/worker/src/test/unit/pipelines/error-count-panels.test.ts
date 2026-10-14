/**
 * Errors per second, the absolute behind the error-RATE panels:
 *
 * - Transaction Errors/sec (109) and Request Errors/sec (220) come free out of the
 *   `SUM(is_error)` the rate already computes, divided by the bucket size so two runs with
 *   different bucket sizes stay comparable, and classified so ADAPT evaluates them.
 * - Errors/sec by Response Code (304) is the per-code breakdown of panel 301 over time.
 *
 * Fails if a panel drops out of its VALUES list or its classified set, if the division by
 * `$4` is lost (a per-bucket count doubles when a run crosses a bucket-size boundary), or if
 * 304 stops zero-filling / stops folding the roll-up.
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { RequestsProcessor } from '../../../pipelines/helpers/requests-processor.js';
import { TransactionsProcessor } from '../../../pipelines/helpers/transactions-processor.js';
import { ErrorsProcessor, MAX_RESPONSE_CODE_LENGTH } from '../../../pipelines/helpers/scenario-processors.js';
import { buildScenarioMetricName } from '../../../pipelines/helpers/metrics-builder.js';
import type { DashboardManager } from '../../../pipelines/helpers/dashboard-manager.js';
import {
  ALL_AGGREGATED_METRIC,
  ALL_AGGREGATED_SCENARIO,
  METRIC_TYPE_PANEL_IDS,
  METRIC_TYPE_PANEL_NAMES,
  METRIC_TYPE_PANEL_UNITS,
} from '../../../constants/performance-metrics.js';
import type { TestRunMetadata, ApdexThresholdLookup } from '../../../types/performance-metrics.js';

const dashboardManager = {
  getOrCreateScenarioDashboard: vi.fn(async (scenarioName: string) => ({
    dashboardId: `dash-${scenarioName}`,
    dashboardUid: `uid-${scenarioName}`,
    dashboardLabel: `Performance test metrics ${scenarioName}`,
  })),
  getMetricTypePanel: (panelId: number) => ({ panelId, panelName: METRIC_TYPE_PANEL_NAMES[panelId]! }),
} as unknown as DashboardManager;

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

const testRun = {
  system_under_test_id: 'sut-1',
  test_environment: 'acc',
  workload: 'load',
  start_time: new Date('2026-01-01T00:00:00Z'),
  end_time: new Date('2026-01-01T01:00:00Z'),
  ramp_up_time: 0,
  organization_id: 'org-1',
  // 304 is written by the analysis only, so every fixture for it is a completed run.
  completed: true,
} as unknown as TestRunMetadata;

/** First query answers the scenario DISTINCT; the second is the INSERT ... SELECT. */
const mockDataSource = () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce([{ scenario_name: 'loadtest' }])
    .mockResolvedValue([[], 1]);
  const transaction = (fn: (em: { query: typeof query }) => Promise<unknown>) =>
    fn({
      query: ((sql: string, params?: unknown[]) =>
        sql.includes('set_config') ? Promise.resolve([]) : query(sql, params)) as typeof query,
    });
  return { query, transaction };
};

beforeEach(() => {
  // dashboardManager and logger are module-scoped vi.fn()s shared by every test here, so
  // without this the first assertion on a call history is order-dependent.
  vi.clearAllMocks();
});

/** The `{ ds }` half of a run(), so an assertion can stay one expression. */
const ds0 = (r: { ds: ReturnType<typeof mockDataSource> }) => r.ds;

const insertSql = (ds: ReturnType<typeof mockDataSource>) =>
  (ds.query.mock.calls[1]![0] as string).replace(/\s+/g, ' ');

describe.each([
  ['TransactionsProcessor', TransactionsProcessor, METRIC_TYPE_PANEL_IDS.TXN_ERROR_COUNT, 'transaction_count'],
  ['RequestsProcessor', RequestsProcessor, METRIC_TYPE_PANEL_IDS.REQ_ERROR_COUNT, 'request_count'],
] as const)('%s errors/sec panel', (_name, Processor, panelId, countColumn) => {
  it('emits the rate SUM per bucket second on a classified panel', async () => {
    const ds = mockDataSource();
    const { compareConfigs } = await new Processor(ds as never, dashboardManager, logger)
      .process('run-1', testRun, {} as ApdexThresholdLookup, 60, false);

    const sql = insertSql(ds);
    // Same SUM the error rate divides, kept absolute and normalised per second.
    expect(sql).toContain('error_count::double precision / $4 as error_count_per_second');
    expect(sql).toContain(`(${panelId}, c.error_count_per_second::double precision)`);
    // The rate it sits beside is untouched.
    expect(sql).toContain(`NULLIF(${countColumn}, 0) * 100`);

    const config = compareConfigs.find(
      (c) => c.panel_id === panelId && c.application_dashboard_id === 'dash-loadtest'
    );
    expect(config?.config_data.metricClassification).toEqual({
      classification: 'RED_errors',
      higherIsBetter: false,
    });
    expect(config?.config_data.thresholds.aggregation).toBe('mean');
  });

  it('joins the panel title and unit onto every row', async () => {
    const ds = mockDataSource();
    await new Processor(ds as never, dashboardManager, logger)
      .process('run-1', testRun, {} as ApdexThresholdLookup, 60, false);

    const params = ds.query.mock.calls[1]![1] as unknown[];
    const at = params.indexOf(panelId);
    expect(at).toBeGreaterThan(-1);
    expect(METRIC_TYPE_PANEL_UNITS[panelId]).toBe('err/s');
    expect(params.slice(at, at + 3)).toEqual([panelId, METRIC_TYPE_PANEL_NAMES[panelId], 'err/s']);
  });

  it('writes the roll-up row but gives it no compare config', async () => {
    // The grouping set emits the run-wide row for every panel in the VALUES list, errors/sec
    // included, so the roll-up dashboard has to be in the VALUES table — but ADAPT must not
    // trend a run-wide error count that moves with the traffic mix.
    const ds = mockDataSource();
    const { compareConfigs } = await new Processor(ds as never, dashboardManager, logger)
      .process('run-1', testRun, {} as ApdexThresholdLookup, 60, false);

    expect(ds.query.mock.calls[1]![1] as unknown[]).toContain(`dash-${ALL_AGGREGATED_SCENARIO}`);
    expect(
      compareConfigs.some(
        (c) => c.panel_id === panelId && c.application_dashboard_id === `dash-${ALL_AGGREGATED_SCENARIO}`
      )
    ).toBe(false);
  });
});

describe('ErrorsProcessor.processOverTime (panel 304)', () => {
  const run = async (bucketSizeSeconds = 60, isIncremental = false, overrides = {}) => {
    const ds = mockDataSource();
    const result = await new ErrorsProcessor(ds as never, dashboardManager, logger)
      .processOverTime('run-1', { ...testRun, ...overrides } as unknown as TestRunMetadata,
        bucketSizeSeconds, isIncremental);
    return { ds, result };
  };

  it('buckets requests_error per response code and zero-fills the quiet buckets', async () => {
    const { ds } = await run();
    const sql = insertSql(ds);

    expect(sql).toContain('FROM requests_error');
    expect(sql).toContain("time_bucket(INTERVAL '1 second' * $2, time, $3::timestamptz)");
    expect(sql).toContain('GROUP BY 1, 2, 3');
    // Zero-fill: the grid is a CROSS JOIN of the code set with every bucket, LEFT JOINed to
    // the counts. Without it a quiet stretch has no row and the chart draws a straight line
    // over it, while the mean ADAPT compares is "errors per bucket that had errors".
    expect(sql).toContain('CROSS JOIN buckets b');
    expect(sql).toContain('LEFT JOIN counted n');
    expect(sql).toContain('COALESCE(n.errors, 0)::double precision / $2 AS value');
    // One series per code, named off panel 301's convention, and only panel 304 is emitted.
    // The ORIENTATION is asserted, not just the pieces: with the arms swapped, real scenarios
    // would be named `All aggregated.<code>` and the roll-up `error_count.<code>` — every
    // other assertion in this file still passes, because $6 and $8 are both bound either way.
    expect(sql).toContain(
      "(CASE WHEN f.scenario_name = $5 THEN $6 ELSE $8 END) || '.' || f.response_code AS metric_name"
    );
    expect(sql).toContain(`${METRIC_TYPE_PANEL_IDS.SCENARIO_ERRORS_OVER_TIME} AS panel_id`);
  });

  it('writes nothing at all while the run is live', async () => {
    // The analysis is the only writer. Per tick, the top-N would be ranked over that minute,
    // so each tick keeps its own busiest codes and a run whose error text rotates stores
    // 20 x ticks series that neither the tail nor the skip plan ever deletes.
    const ds = mockDataSource();
    const result = await new ErrorsProcessor(ds as never, dashboardManager, logger)
      .processOverTime('run-1', { ...testRun, completed: false } as unknown as TestRunMetadata, 60, true);

    expect(result).toEqual({ rowsInserted: 0, compareConfigs: [] });
    expect(ds.query).not.toHaveBeenCalled();
  });

  it('reads the whole run, ignoring the window the caller is aggregating', async () => {
    // Both queries have to ignore it. The GATING lookup is the one that bit: it reads
    // `filter_from_time`, so on the tail plan it saw only the last tick's minutes, returned no
    // scenarios, and the pass then marked collection complete — panel 304 empty forever on any
    // run whose errors missed that window, which is most of them. Assert the lookup's bound
    // parameters, not just the aggregate's: the mock answers call 0 whatever window it is
    // given, so an assertion on the INSERT alone cannot see this.
    const tick = {
      filter_from_time: new Date('2026-01-01T00:30:00Z'),
      filter_to_time: new Date('2026-01-01T00:31:00Z'),
    };
    const { ds } = await run(60, true, tick);

    expect(ds.query.mock.calls[0]![1]).toEqual(['run-1', testRun.start_time, testRun.end_time]);
    const params = ds.query.mock.calls[1]![1] as unknown[];
    expect(params).not.toContain(tick.filter_from_time);
    expect(params.slice(0, 4)).toEqual(['run-1', 60, testRun.start_time, testRun.end_time]);
  });

  it('binds the run bounds and never the wall clock', async () => {
    // The grid used to end at `filter_to_time ?? new Date()`: on the rebuild arm for a run
    // with no end_time that is NOW, so a run analysed a week later zero-filled a week. Every
    // timestamp it binds must come off the run.
    const { ds } = await run();
    const params = ds.query.mock.calls[1]![1] as unknown[];
    expect(params.slice(0, 8)).toEqual([
      'run-1',
      60,
      testRun.start_time,
      testRun.end_time,
      ALL_AGGREGATED_SCENARIO,
      ALL_AGGREGATED_METRIC,
      20,
      'error_count',
    ]);
    const runTimes = [testRun.start_time, testRun.end_time];
    expect(params.slice(0, 8).filter((v) => v instanceof Date).every((v) => runTimes.includes(v as Date))).toBe(true);
  });

  it('spans the grid over the run, the same span for every scenario and every run', async () => {
    // A data-bounded grid made the span the noisiest property of an error series: one
    // scenario's late error stretched every other scenario's grid, so its mean — the
    // configured ADAPT aggregation — moved with data that was not its own, and two runs with
    // identical errors but a different last error stopped being comparable. $3 is the bucket
    // origin, so starting there is aligned by construction with no arithmetic to get wrong.
    const sql = insertSql(ds0(await run()));
    expect(sql).toContain('bounds AS ( SELECT COALESCE($4::timestamptz, MAX(bucket_time)) AS hi FROM counted )');
    expect(sql).toContain(
      "generate_series( $3::timestamptz, (SELECT hi FROM bounds), INTERVAL '1 second' * $2 )"
    );
  });

  it('groups once and rolls the counts up, not the raw rows', async () => {
    // `err` referenced twice is materialised into a tuplestore and the roll-up then pushes
    // 2x the run's raw error rows through the HashAggregate, which spills under the budget's
    // 128MB work_mem on an error-heavy run. Grouped first, the roll-up sums thousands.
    const sql = insertSql(ds0(await run()));
    expect(sql).toContain('base AS ( SELECT scenario_name, response_code, bucket_time, COUNT(*) AS errors FROM err GROUP BY 1, 2, 3 )');
    expect(sql).toContain('SELECT $5, response_code, bucket_time, SUM(errors) FROM base GROUP BY 2, 3');
    // One reference, or Postgres materialises it.
    expect((sql.match(/FROM err\b/g) ?? []).length).toBe(1);
  });

  it('folds a real scenario named like the roll-up into the roll-up', async () => {
    // Both halves land on one dashboard, so emitting the scenario twice would put two rows
    // with the same (dashboard, panel, metric_name, time) in one statement — rejected.
    const sql = insertSql(ds0(await run()));
    expect(sql).toContain('FROM base WHERE scenario_name <> $5');
  });

  it('classifies both the per-scenario dashboard and the roll-up', async () => {
    const { result } = await run();
    const panelId = METRIC_TYPE_PANEL_IDS.SCENARIO_ERRORS_OVER_TIME;

    // The roll-up gets one too, unlike every other processor: configless means
    // DEFAULT_COMPARE_CONFIG (median, unclassified), and 304's dense series clear the sample
    // floor that keeps ADAPT off 301-303's single point.
    expect(result.compareConfigs.map((c) => c.application_dashboard_id).sort()).toEqual(
      [`dash-${ALL_AGGREGATED_SCENARIO}`, 'dash-loadtest'].sort()
    );
    const config = result.compareConfigs.find((c) => c.application_dashboard_id === 'dash-loadtest')!;
    expect(config.panel_id).toBe(panelId);
    expect(config.metric_name).toBeNull();
    expect(config.config_data.metricClassification).toEqual({
      classification: 'RED_errors',
      higherIsBetter: false,
    });

    // The roll-up's row is the point of this test: `higherIsBetter: null` is the ONLY thing
    // keeping it out of the run verdict. `buildConclusionLogic` emits 'regression' solely
    // under true/false, and `buildConclusionSQL` flips a run on regression_count > 0 — so
    // RED_errors here would make `All aggregated.<code>`, which on a single-scenario run is
    // numerically identical to `error_count.<code>`, count every regression twice. The
    // aggregation must still be the panel's own: the default's `median` reads 0 on a
    // zero-filled sparse error series.
    const rollup = result.compareConfigs.find(
      (c) => c.application_dashboard_id === `dash-${ALL_AGGREGATED_SCENARIO}`
    )!;
    expect(rollup.panel_id).toBe(panelId);
    expect(rollup.metric_name).toBeNull();
    expect(rollup.config_data.metricClassification.higherIsBetter).toBeNull();
    expect(rollup.config_data.metricClassification.classification).not.toBe('RED_errors');
    expect(rollup.config_data.thresholds.aggregation).toBe('mean');
  });

  it('writes nothing when the run holds no errors, and creates no dashboard either', async () => {
    // The row count alone does not pin the early return: with it deleted, the empty dashboard
    // map short-circuits `insertDsMetricsFromAggregate` and the result is identical. What only
    // the early return prevents is TOUCHING the dashboards — so assert that. It matters
    // because the roll-up dashboard is created in the loop below it: if the resolver ever
    // seeded the roll-up unconditionally, a run with zero errors would emit a full zero-filled
    // roll-up grid and nothing else here would notice.
    const ds = { query: vi.fn().mockResolvedValue([]), transaction: vi.fn() };
    const result = await new ErrorsProcessor(ds as never, dashboardManager, logger)
      .processOverTime('run-1', testRun, 60, false);

    expect(result).toEqual({ rowsInserted: 0, compareConfigs: [] });
    expect(ds.query).toHaveBeenCalledOnce();
    expect(dashboardManager.getOrCreateScenarioDashboard).not.toHaveBeenCalled();
  });

  it('writes nothing for a completed run that never reported an end_time', async () => {
    // end_time is the grid's end. Without it the bucket size falls back to the tick's, which
    // is sized from planned_duration rather than from the run, so the ~250-bucket ceiling that
    // bounds every other shape does not apply — a 2-minute plan that ran two hours would write
    // ~7200 buckets x 20 codes x scenarios.
    const ds = mockDataSource();
    const result = await new ErrorsProcessor(ds as never, dashboardManager, logger)
      .processOverTime('run-1', { ...testRun, end_time: null } as unknown as TestRunMetadata, 1, false);

    expect(result).toEqual({ rowsInserted: 0, compareConfigs: [] });
    expect(ds.query).not.toHaveBeenCalled();
  });

  it('upserts on the tail pass and plain-inserts on a rebuild', async () => {
    expect(insertSql((await run(60, true)).ds)).toContain('ON CONFLICT');
    expect(insertSql((await run(60, false)).ds)).not.toContain('ON CONFLICT');
  });

  it('reads its scenarios from requests_error, not from requests_raw', async () => {
    // The scenario DISTINCT is the first query and decides which dashboards exist in the
    // VALUES table. Pointed at requests_raw it would create a dashboard for every scenario
    // that ran, so a run with no errors would still emit a full zero-filled grid.
    const { ds } = await run();
    const lookup = (ds.query.mock.calls[0]![0] as string).replace(/\s+/g, ' ');
    expect(lookup).toContain('FROM requests_error');
    expect(lookup).toContain('SELECT DISTINCT');
  });

  it('caps the series per scenario at the busiest codes, with a deterministic tie-break', async () => {
    // Row count is codes x buckets x (scenarios + 1), and `response_code` is unbounded text
    // straight from the JTL importer — without the cap one run of exception messages writes
    // millions of rows. `response_code` as the second ORDER BY key keeps the kept set stable
    // between a rebuild and a re-analysis when two codes have the same count.
    const sql = insertSql((await run()).ds);
    expect(sql).toContain('ROW_NUMBER() OVER ( PARTITION BY scenario_name ORDER BY SUM(errors) DESC, response_code )');
    expect(sql).toContain('ranked WHERE rn <= $7');
  });

  it('bounds the response code the same way the cumulative panel does, and names a blank one', async () => {
    // Truncating in SQL makes the bounded value the GROUP BY key, so two codes sharing a
    // prefix sum into one row instead of colliding later on the primary key.
    const sql = insertSql((await run()).ds);
    expect(sql).toContain(`left(COALESCE(NULLIF(response_code, ''), 'unknown'), ${MAX_RESPONSE_CODE_LENGTH})`);
  });

  it('bounds a code so two of them cannot collide after the writer truncates', () => {
    // The budget is HALVED because Postgres left()/varchar(255) count CHARACTERS while
    // PerformanceTestMetricsPipeline.saveDsMetrics truncates with .substring(0, 255), which
    // counts UTF-16 CODE UNITS — and a non-BMP character is two of those. At the full 240 the
    // arithmetic looked right and two 239-char astral codes were cut to the SAME value: a
    // 23505 on the rebuild path, a cardinality_violation on a tick, and the stored name
    // mangled mid-surrogate. An ASCII-only fixture cannot catch it.
    const astral = '\u{1F600}'.repeat(MAX_RESPONSE_CODE_LENGTH);
    expect([...astral].length).toBe(MAX_RESPONSE_CODE_LENGTH);

    for (const base of [ALL_AGGREGATED_METRIC, 'error_count']) {
      const name = `${base}.${astral}`;
      expect([...name].length).toBeLessThanOrEqual(255);  // varchar(255) counts characters
      expect(name.length).toBeLessThanOrEqual(255);       // .substring(0, 255) is a no-op
      expect(name.substring(0, 255)).toBe(name);          // and cannot cut mid-surrogate
    }
  });

  it('composes the same base name the cumulative panel does', async () => {
    // 304 binds the base where 301 composes it through buildScenarioMetricName; they are
    // documented as the same breakdown, so a rename on one side must not silently stop
    // matching the other. Assert the two PRODUCERS agree — pinning the literal 'error_count'
    // passes even if one side is renamed and the other hard-codes the old value back.
    const { ds, result } = await run();
    const bound = (ds.query.mock.calls[1]![1] as unknown[])[7];
    const cumulative = await new ErrorsProcessor(mockDataSource() as never, dashboardManager, logger)
      .process('run-1', testRun);
    const cumulativeName = cumulative.metrics.find((m) => m.metric_name !== ALL_AGGREGATED_METRIC)?.metric_name;

    expect(bound).toBe(buildScenarioMetricName(bound as string));
    expect(cumulativeName?.split('.')[0]).toBe(bound);
    expect(result.rowsInserted).toBe(0); // the mock writer reports no rows; shape only
  });

  it('buckets without TimescaleDB too, so a plain Postgres still lands on the grid', async () => {
    // The fallback arm has to produce the same boundaries as time_bucket's origin form, or
    // the equality join against the zero-fill grid matches nothing and every bucket reads 0.
    // It adds the offset to the ORIGIN. Added to `time` instead — which is what this
    // asserted while claiming the opposite — a row 100s into a 10s-bucket run lands at 200s
    // and keeps 1s resolution inside the bucket, so of ten rows in one bucket only one could
    // satisfy the grid equality and the other nine would be silently dropped as zeros.
    const sql = insertSql((await run()).ds);
    expect(sql).toContain("WHERE extname = 'timescaledb'");
    expect(sql).toContain("ELSE $3::timestamptz + INTERVAL '1 second' * (FLOOR(EXTRACT(EPOCH FROM (time - $3::timestamptz)) / $2) * $2)");
    expect(sql).not.toContain("date_trunc('second', time) + INTERVAL");
  });

  it('issues no insert at all when every scenario dashboard fails', async () => {
    // A scenario missing from the map is missing from the VALUES table, so its rows cannot
    // join; with none left there is nothing to write and the statement must not be sent.
    const ds = mockDataSource();
    const failing = {
      getOrCreateScenarioDashboard: vi.fn(async () => { throw new Error('grafana down'); }),
      getMetricTypePanel: (panelId: number) => ({ panelId, panelName: METRIC_TYPE_PANEL_NAMES[panelId]! }),
    } as unknown as DashboardManager;

    const result = await new ErrorsProcessor(ds as never, failing, logger)
      .processOverTime('run-1', testRun, 60, false);

    expect(result).toEqual({ rowsInserted: 0, compareConfigs: [] });
    expect(ds.query).toHaveBeenCalledOnce();
  });

  it('compares the series with the mean, like the two errors/sec panels beside it', async () => {
    const { result } = await run();
    expect(result.compareConfigs[0]!.config_data.thresholds.aggregation).toBe('mean');
    expect(METRIC_TYPE_PANEL_UNITS[METRIC_TYPE_PANEL_IDS.SCENARIO_ERRORS_OVER_TIME]).toBe('err/s');
  });
});
