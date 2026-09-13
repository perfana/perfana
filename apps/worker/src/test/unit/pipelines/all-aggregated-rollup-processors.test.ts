/**
 * The "all aggregated" rollup, on the three processors the sibling
 * all-aggregated-dashboard.test.ts does NOT cover:
 *
 * - RequestsProcessor — same NULL-scenario grouping-set contract as
 *   TransactionsProcessor, but its rollup rows also have a NULL sampler_name, so the
 *   metric name must not be built from those columns.
 * - ErrorsProcessor — appends the rollup in BOTH the has-errors and the zero-errors
 *   branch; only the second one reaches the requests_raw scenario lookup.
 * - VirtualUsersProcessor — the rollup is computed in JS (sum of per-scenario avg and
 *   max), so the arithmetic and its zero/null guards are the whole risk.
 */
import { describe, it, expect, vi } from 'vitest';
import { RequestsProcessor } from '../../../pipelines/helpers/requests-processor.js';
import { ErrorsProcessor, VirtualUsersProcessor } from '../../../pipelines/helpers/scenario-processors.js';
import type { DashboardManager } from '../../../pipelines/helpers/dashboard-manager.js';
import {
  ALL_AGGREGATED_SCENARIO,
  ALL_AGGREGATED_METRIC,
  METRIC_TYPE_PANEL_IDS,
  METRIC_TYPE_PANEL_NAMES,
} from '../../../constants/performance-metrics.js';
import type { TestRunMetadata, ApdexThresholdLookup } from '../../../types/performance-metrics.js';

const bucketTime = new Date('2026-01-01T00:01:00Z');

const requestRow = (
  scenario: string | null,
  transaction: string | null,
  sampler: string | null,
) => ({
  scenario_name: scenario,
  transaction_name: transaction,
  sampler_name: sampler,
  bucket_time: bucketTime,
  timestep: 1,
  request_count: '10',
  error_count: '1',
  avg_response_time: 100,
  p90_response_time: 150,
  p95_response_time: 180,
  p99_response_time: 200,
  avg_latency: 20,
  avg_connect_time: 5,
  error_rate: 10,
  throughput: '10',
  apdex_score: 0.9,
});

const makeDashboardManager = (
  getOrCreate: (scenarioName: string) => Promise<unknown> = async (scenarioName: string) => ({
    dashboardId: `dash-${scenarioName}`,
    dashboardUid: `uid-${scenarioName}`,
    dashboardLabel: `Performance test metrics ${scenarioName}`,
  }),
) =>
  ({
    getOrCreateScenarioDashboard: vi.fn(getOrCreate),
    getMetricTypePanel: (panelId: number) => ({ panelId, panelName: METRIC_TYPE_PANEL_NAMES[panelId]! }),
  }) as unknown as DashboardManager;

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as never;

const testRun = {
  system_under_test_id: 'sut-1',
  test_environment: 'acc',
  workload: 'load',
  start_time: new Date('2026-01-01T00:00:00Z'),
  end_time: new Date('2026-01-01T01:00:00Z'),
  ramp_up_time: 0,
  organization_id: 'org-1',
} as unknown as TestRunMetadata;

const isAggregated = (m: { dashboard_label: string | null }) =>
  m.dashboard_label === `Performance test metrics ${ALL_AGGREGATED_SCENARIO}`;

/**
 * RequestsProcessor writes ds_metrics with one INSERT ... SELECT rather than returning
 * records, so its roll-up contract is asserted against the SQL and its parameters.
 * `mockDataSource` answers the scenario lookup first, then the insert.
 */
const mockDataSource = (scenarios: string[] = ['loadtest']) => ({
  query: vi
    .fn()
    .mockResolvedValueOnce(scenarios.map((scenario_name) => ({ scenario_name })))
    .mockResolvedValue([[], 42]),
});

const insertSql = (dataSource: { query: { mock: { calls: unknown[][] } } }) =>
  (dataSource.query.mock.calls[1]![0] as string).replace(/\s+/g, ' ');

const insertParams = (dataSource: { query: { mock: { calls: unknown[][] } } }) =>
  dataSource.query.mock.calls[1]![1] as unknown[];

describe('RequestsProcessor rollup rows', () => {
  it('gives the roll-up grouping set one fixed name instead of "null.null"', async () => {
    const dataSource = mockDataSource();
    const processor = new RequestsProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    await processor.process('run-1', testRun, {} as ApdexThresholdLookup, 60, false);

    const sql = insertSql(dataSource);
    const params = insertParams(dataSource);
    const rollupMetricParam = `$${params.indexOf(ALL_AGGREGATED_METRIC) + 1}`;

    // The roll-up's sampler_name/transaction_name are NULL; without this arm the
    // concatenation below would produce "null.null".
    expect(sql).toContain(`WHEN c.g_scenario = 1 THEN ${rollupMetricParam}`);
    expect(params).toContain(`dash-${ALL_AGGREGATED_SCENARIO}`);
    // Apdex is one of the emitted panels.
    expect(sql).toContain(`(${METRIC_TYPE_PANEL_IDS.REQ_APDEX}, c.apdex_score::double precision)`);
  });

  it('does not emit a second "total" throughput series for the roll-up', async () => {
    const dataSource = mockDataSource();
    const processor = new RequestsProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    await processor.process('run-1', testRun, {} as ApdexThresholdLookup, 60, false);

    expect(insertSql(dataSource)).toContain(
      `SELECT c.scenario_name, 'total', ${METRIC_TYPE_PANEL_IDS.REQ_THROUGHPUT},` +
      ' c.throughput::double precision, c.bucket_time, c.timestep FROM computed c' +
      ' WHERE c.g_scenario = 0 AND c.g_txn = 1'
    );
  });

  it('builds per-scenario metric names from transaction and sampler', async () => {
    const dataSource = mockDataSource();
    const processor = new RequestsProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    await processor.process('run-1', testRun, {} as ApdexThresholdLookup, 60, false);

    const sql = insertSql(dataSource);
    // "{transaction}.{sampler}", collapsed when the prefix adds nothing.
    expect(sql).toContain("ELSE c.transaction_name || '.' || c.sampler_name");
    expect(sql).toContain("OR c.transaction_name = 'overall'");
    expect(sql).toContain('OR c.transaction_name = c.sampler_name THEN c.sampler_name');
  });

  it('issues no insert at all when every scenario dashboard fails', async () => {
    const dashboardManager = makeDashboardManager(async () => {
      throw new Error('boom');
    });
    const dataSource = mockDataSource();
    const processor = new RequestsProcessor(dataSource as never, dashboardManager, silentLogger());

    const { rowsInserted } = await processor.process('run-1', testRun, {} as ApdexThresholdLookup, 60, false);

    expect(rowsInserted).toBe(0);
    // Only the scenario lookup ran — with no dashboards there is nothing to join to.
    expect(dataSource.query).toHaveBeenCalledTimes(1);
    // Both the real scenario and the roll-up were attempted, once each.
    expect(dashboardManager.getOrCreateScenarioDashboard).toHaveBeenCalledTimes(2);
    expect(dashboardManager.getOrCreateScenarioDashboard)
      .toHaveBeenCalledWith(ALL_AGGREGATED_SCENARIO, 'sut-1', 'acc');
  });

  it('binds only the parameters the scenario lookup references when the run has no end_time', async () => {
    // This query's highest placeholder is $3, so a spare parameter is a hard bind
    // failure rather than the harmless unused one the aggregates tolerate.
    const dataSource = mockDataSource();
    const processor = new RequestsProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    await processor.process(
      'run-1',
      { ...testRun, end_time: null } as never,
      {} as ApdexThresholdLookup, 60, false
    );

    const [sql, params] = dataSource.query.mock.calls[0]! as [string, unknown[]];
    expect(sql).not.toContain('$3');
    expect(params).toHaveLength(2);
  });

  it('bakes ramp_up from the run start and offset, defaulting to false when unset', async () => {
    const dataSource = mockDataSource();
    const processor = new RequestsProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    await processor.process('run-1', { ...testRun, ramp_up_time: 300 } as never, {} as ApdexThresholdLookup, 60, false);

    const sql = insertSql(dataSource);
    const params = insertParams(dataSource);
    const rampParam = `$${params.indexOf(300) + 1}`;
    expect(params).toContain(300);
    expect(params).toContain(testRun.start_time);
    // createDsMetricsRecord treated a missing offset as "no ramp-up"; keep that arm.
    expect(sql).toContain(`WHEN ${rampParam}::double precision IS NULL THEN false`);
    expect(sql).toContain(`< ${rampParam}::double precision`);
  });

  it('upserts instead of plain-inserting on an incremental tick', async () => {
    const dataSource = mockDataSource();
    const processor = new RequestsProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    await processor.process('run-1', testRun, {} as ApdexThresholdLookup, 60, true);

    const sql = insertSql(dataSource);
    expect(sql).toContain(
      'ON CONFLICT (test_run_id, application_dashboard_id, panel_id, metric_name, time) DO UPDATE SET'
    );
    expect(sql).toContain('value = EXCLUDED.value');
  });

  it('lists only the scenarios that resolved in the dashboard VALUES table', async () => {
    const dashboardManager = makeDashboardManager(async (scenarioName: string) => {
      if (scenarioName === 'broken') { throw new Error('boom'); }
      return {
        dashboardId: `dash-${scenarioName}`,
        dashboardUid: `uid-${scenarioName}`,
        dashboardLabel: `Performance test metrics ${scenarioName}`,
      };
    });
    const dataSource = mockDataSource(['loadtest', 'broken']);
    const processor = new RequestsProcessor(dataSource as never, dashboardManager, silentLogger());

    await processor.process('run-1', testRun, {} as ApdexThresholdLookup, 60, false);

    const params = insertParams(dataSource);
    expect(params).toContain('dash-loadtest');
    expect(params).not.toContain('dash-broken');
  });
});

describe('ErrorsProcessor on a live tick', () => {
  const liveRun = {
    ...testRun,
    completed: false,
    filter_from_time: new Date('2026-01-01T00:10:00Z'),
    filter_to_time: new Date('2026-01-01T00:11:00Z'),
  } as unknown as TestRunMetadata;

  it('counts from start_time, not from the tick window, and writes the point at start_time', async () => {
    const dataSource = { query: vi.fn(async () => [{ scenario_name: 'loadtest', error_count: '3' }]) };
    const processor = new ErrorsProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    const { metrics } = await processor.process('run-1', liveRun);

    // [start_time, filter_to_time]: cumulative, so every tick agrees with the rebuild's run total.
    expect(dataSource.query.mock.calls[0]![1]).toEqual(['run-1', testRun.start_time, liveRun.filter_to_time]);
    // One fixed timestamp while the run is live; the final pass moves it to end_time.
    expect(metrics.every(m => m.time.getTime() === testRun.start_time.getTime())).toBe(true);
  });

  it('flags the interim point ramp_up under an analysis start offset, and the final one not', async () => {
    const dataSource = { query: vi.fn(async () => [{ scenario_name: 'loadtest', error_count: '3' }]) };
    const processor = new ErrorsProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    const live = await processor.process('run-1', { ...liveRun, ramp_up_time: 60 } as TestRunMetadata);
    const done = await processor.process('run-1', { ...liveRun, ramp_up_time: 60, completed: true } as TestRunMetadata);

    expect(live.metrics.every(m => m.ramp_up)).toBe(true);
    expect(done.metrics.every(m => !m.ramp_up)).toBe(true);
  });

  it('writes the point at end_time once the run is completed', async () => {
    const dataSource = { query: vi.fn(async () => [{ scenario_name: 'loadtest', error_count: '3' }]) };
    const processor = new ErrorsProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    const { metrics } = await processor.process('run-1', { ...liveRun, completed: true } as TestRunMetadata);

    expect(metrics.every(m => m.time.getTime() === testRun.end_time!.getTime())).toBe(true);
  });

  it('writes the zero-error points at start_time too while the run is live', async () => {
    // The zero-errors branch builds its own rows from the requests_raw scenario lookup;
    // it has to land on the same interim timestamp or the final pass cannot drop it.
    const dataSource = {
      query: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ scenario_name: 'loadtest' }]),
    };
    const processor = new ErrorsProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    const { metrics } = await processor.process('run-1', liveRun);

    expect(metrics.length).toBeGreaterThan(0);
    expect(metrics.every(m => m.time.getTime() === testRun.start_time.getTime())).toBe(true);
  });

  it('falls back to start_time when a completed run carries no end_time', async () => {
    const dataSource = { query: vi.fn(async () => [{ scenario_name: 'loadtest', error_count: '3' }]) };
    const processor = new ErrorsProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    const { metrics } = await processor.process('run-1', {
      ...liveRun,
      completed: true,
      end_time: null,
    } as unknown as TestRunMetadata);

    expect(metrics.every(m => m.time.getTime() === testRun.start_time.getTime())).toBe(true);
  });
});

describe('VirtualUsersProcessor on a live tick', () => {
  const liveRun = {
    ...testRun,
    completed: false,
    filter_from_time: new Date('2026-01-01T00:10:00Z'),
    filter_to_time: new Date('2026-01-01T00:11:00Z'),
  } as unknown as TestRunMetadata;
  const vuRows = async () => [
    { scenario_name: 'loadtest', avg_active_threads: '10', max_active_threads: '20', active_thread_count: '100' },
  ];

  it('averages from start_time, not from the tick window, and writes the point at start_time', async () => {
    const dataSource = { query: vi.fn(vuRows) };
    const processor = new VirtualUsersProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    const { metrics } = await processor.process('run-1', liveRun);

    // [start_time, filter_to_time]: cumulative, so the tick's average and max are the
    // rebuild's run-wide figures so far, not the minute's.
    expect(dataSource.query.mock.calls[0]![1]).toEqual(['run-1', testRun.start_time, liveRun.filter_to_time]);
    expect(metrics.length).toBeGreaterThan(0);
    expect(metrics.every(m => m.time.getTime() === testRun.start_time.getTime())).toBe(true);
  });

  it('writes the points at end_time on a force re-fetch of a completed run', async () => {
    // Same filter window as a tick, but the run is completed: the rows must land where
    // every baseline holds them, and where the final pass expects them.
    const dataSource = { query: vi.fn(vuRows) };
    const processor = new VirtualUsersProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    const { metrics } = await processor.process('run-1', { ...liveRun, completed: true } as TestRunMetadata);

    expect(dataSource.query.mock.calls[0]![1]).toEqual(['run-1', testRun.start_time, liveRun.filter_to_time]);
    expect(metrics.every(m => m.time.getTime() === testRun.end_time!.getTime())).toBe(true);
  });

  it('bounds the query by end_time on a full rebuild with no filter window', async () => {
    const dataSource = { query: vi.fn(vuRows) };
    const processor = new VirtualUsersProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    await processor.process('run-1', { ...testRun, completed: true } as TestRunMetadata);

    expect(dataSource.query.mock.calls[0]![1]).toEqual(['run-1', testRun.start_time, testRun.end_time]);
  });

  it('leaves the upper bound open on a live run without a filter window or end_time', async () => {
    const dataSource = { query: vi.fn(vuRows) };
    const processor = new VirtualUsersProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    await processor.process('run-1', { ...testRun, end_time: null } as unknown as TestRunMetadata);

    expect(dataSource.query.mock.calls[0]![1]).toEqual(['run-1', testRun.start_time]);
    expect(String(dataSource.query.mock.calls[0]![0])).not.toContain('time <= $3');
  });
});

describe('ErrorsProcessor rollup row', () => {
  it('adds a rollup series carrying the total across scenarios', async () => {
    const dataSource = {
      query: vi.fn(async () => [
        { scenario_name: 'loadtest', error_count: '3' },
        { scenario_name: 'soak', error_count: '4' },
      ]),
    };
    const processor = new ErrorsProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    const { metrics } = await processor.process('run-1', testRun);

    const aggregated = metrics.filter(isAggregated);
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]!.metric_name).toBe(ALL_AGGREGATED_METRIC);
    expect(aggregated[0]!.value).toBe(7);
    expect(aggregated[0]!.panel_id).toBe(METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT);
    // Per-scenario rows keep the scenario-level metric name.
    expect(metrics.filter(m => m.metric_name === 'error_count')).toHaveLength(2);
  });

  it('adds a zero rollup series when the run had no errors at all', async () => {
    const dataSource = {
      query: vi
        .fn()
        .mockResolvedValueOnce([]) // requests_error aggregation
        .mockResolvedValueOnce([{ scenario_name: 'loadtest' }, { scenario_name: 'soak' }]),
    };
    const processor = new ErrorsProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    const { metrics } = await processor.process('run-1', testRun);

    expect(metrics).toHaveLength(3);
    const aggregated = metrics.filter(isAggregated);
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]!.metric_name).toBe(ALL_AGGREGATED_METRIC);
    expect(aggregated[0]!.value).toBe(0);
  });

  it('still adds the rollup when no scenario name could be found either', async () => {
    const dataSource = {
      query: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]),
    };
    const processor = new ErrorsProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    const { metrics } = await processor.process('run-1', testRun);

    expect(metrics.map(m => m.dashboard_label)).toEqual([
      'Performance test metrics default',
      `Performance test metrics ${ALL_AGGREGATED_SCENARIO}`,
    ]);
    expect(metrics[1]!.metric_name).toBe(ALL_AGGREGATED_METRIC);
  });
});

describe('VirtualUsersProcessor rollup row', () => {
  const vuRow = (scenario: string, avg: string | null, max: string | null, count: string) => ({
    scenario_name: scenario,
    avg_active_threads: avg,
    max_active_threads: max,
    active_thread_count: count,
  });

  it('weights each scenario average by its share of the longest run', async () => {
    // Both scenarios sampled the whole run, so the weights are 1 and the rollup is the
    // plain sum: concurrent threads add across scenarios.
    const dataSource = {
      query: vi.fn(async () => [vuRow('loadtest', '10.5', '20', '100'), vuRow('soak', '4.5', '8', '100')]),
    };
    const processor = new VirtualUsersProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    const { metrics } = await processor.process('run-1', testRun);

    const aggregated = metrics.filter(isAggregated);
    expect(aggregated).toHaveLength(2);
    expect(new Set(aggregated.map(m => m.metric_name))).toEqual(new Set([ALL_AGGREGATED_METRIC]));
    expect(aggregated.find(m => m.panel_id === METRIC_TYPE_PANEL_IDS.SCENARIO_AVG_THREADS)?.value).toBe(15);
    expect(aggregated.find(m => m.panel_id === METRIC_TYPE_PANEL_IDS.SCENARIO_MAX_THREADS)?.value).toBe(28);
  });

  it('does not let a short scenario contribute its full average to the whole run', async () => {
    // 'burst' ran for a tenth of the run, so it adds a tenth of its average — not all of
    // it. This is the whole reason the rollup is weighted rather than a plain sum.
    const dataSource = {
      query: vi.fn(async () => [vuRow('loadtest', '10', '20', '100'), vuRow('burst', '50', '60', '10')]),
    };
    const processor = new VirtualUsersProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    const { metrics } = await processor.process('run-1', testRun);

    const aggregated = metrics.filter(isAggregated);
    expect(aggregated.find(m => m.panel_id === METRIC_TYPE_PANEL_IDS.SCENARIO_AVG_THREADS)?.value).toBe(15);
  });

  it('treats a scenario with no thread samples as zero rather than NaN', async () => {
    const dataSource = {
      query: vi.fn(async () => [vuRow('loadtest', '10', '20', '100'), vuRow('idle', null, null, '0')]),
    };
    const processor = new VirtualUsersProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    const { metrics } = await processor.process('run-1', testRun);

    const aggregated = metrics.filter(isAggregated);
    expect(aggregated.map(m => m.value)).toEqual([10, 20]);
    expect(aggregated.every(m => Number.isFinite(m.value))).toBe(true);
  });

  it('replaces a real scenario that shares the rollup name instead of emitting both', async () => {
    // Two rows of the same name would collide inside one ON CONFLICT batch.
    const dataSource = {
      query: vi.fn(async () => [vuRow(ALL_AGGREGATED_SCENARIO, '10', '20', '100')]),
    };
    const processor = new VirtualUsersProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    const { metrics } = await processor.process('run-1', testRun);

    expect(metrics.filter(m => m.panel_id === METRIC_TYPE_PANEL_IDS.SCENARIO_AVG_THREADS)).toHaveLength(1);
  });

  it('adds no rollup series when the whole run recorded no threads', async () => {
    const dataSource = { query: vi.fn(async () => [vuRow('loadtest', null, null, '0')]) };
    const processor = new VirtualUsersProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    const { metrics } = await processor.process('run-1', testRun);

    expect(metrics).toEqual([]);
  });

  it('emits nothing at all when the run has no virtual_users rows', async () => {
    const dataSource = { query: vi.fn(async () => []) };
    const processor = new VirtualUsersProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    const { metrics, compareConfigs } = await processor.process('run-1', testRun);

    expect(metrics).toEqual([]);
    expect(compareConfigs).toEqual([]);
  });
});
