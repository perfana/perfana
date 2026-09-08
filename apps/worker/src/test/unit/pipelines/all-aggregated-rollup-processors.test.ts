/**
 * The "all aggregated" rollup, on the three processors the sibling
 * all-aggregated-dashboard.test.ts does NOT cover:
 *
 * - RequestsProcessor — same NULL-scenario grouping-set contract as
 *   TransactionsProcessor, but its rollup rows also have a NULL sampler_name, so the
 *   metric name must bypass buildNewRequestMetricName entirely.
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

describe('RequestsProcessor rollup rows', () => {
  it('maps a NULL scenario/transaction/sampler row onto the aggregated dashboard under one name', async () => {
    const dataSource = {
      query: vi.fn(async () => [
        requestRow('loadtest', 'checkout', 'GET /cart'),
        requestRow(null, null, null),
      ]),
    };
    const processor = new RequestsProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    const { metrics } = await processor.process('run-1', testRun, {} as ApdexThresholdLookup, 60);

    const aggregated = metrics.filter(isAggregated);
    expect(aggregated.length).toBeGreaterThan(0);
    // buildNewRequestMetricName would have produced "null.null" from these columns.
    expect(new Set(aggregated.map(m => m.metric_name))).toEqual(new Set([ALL_AGGREGATED_METRIC]));
    expect(aggregated.some(m => m.panel_id === METRIC_TYPE_PANEL_IDS.REQ_APDEX)).toBe(true);
  });

  it('does not emit a second "total" throughput series for the rollup', async () => {
    const dataSource = {
      query: vi.fn(async () => [
        requestRow('loadtest', 'checkout', 'GET /cart'),
        requestRow('loadtest', 'checkout', 'GET /item'),
        requestRow(null, null, null),
      ]),
    };
    const processor = new RequestsProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    const { metrics } = await processor.process('run-1', testRun, {} as ApdexThresholdLookup, 60);

    expect(metrics.filter(isAggregated).some(m => m.metric_name === 'total')).toBe(false);
    // The per-scenario dashboard still gets its summed "total" series.
    const total = metrics.find(m => m.metric_name === 'total');
    expect(total?.dashboard_label).toBe('Performance test metrics loadtest');
    expect(total?.value).toBe(20);
  });

  it('leaves per-scenario metric names built from transaction and sampler', async () => {
    const dataSource = {
      query: vi.fn(async () => [requestRow('loadtest', 'checkout', 'GET /cart'), requestRow(null, null, null)]),
    };
    const processor = new RequestsProcessor(dataSource as never, makeDashboardManager(), silentLogger());

    const { metrics } = await processor.process('run-1', testRun, {} as ApdexThresholdLookup, 60);

    expect(metrics.some(m => m.metric_name === 'checkout.GET /cart')).toBe(true);
  });

  it('remembers the rollup scenario by its resolved name when its dashboard fails', async () => {
    // failedScenarios is keyed on the resolved name; keyed on the raw NULL it would
    // retry the dashboard for every rollup row in the run.
    const dashboardManager = makeDashboardManager(async () => {
      throw new Error('boom');
    });
    const dataSource = {
      query: vi.fn(async () => [requestRow(null, null, null), requestRow(null, null, null)]),
    };
    const processor = new RequestsProcessor(dataSource as never, dashboardManager, silentLogger());

    const { metrics } = await processor.process('run-1', testRun, {} as ApdexThresholdLookup, 60);

    expect(metrics).toEqual([]);
    expect(dashboardManager.getOrCreateScenarioDashboard).toHaveBeenCalledTimes(1);
    expect(dashboardManager.getOrCreateScenarioDashboard)
      .toHaveBeenCalledWith(ALL_AGGREGATED_SCENARIO, 'sut-1', 'acc');
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
