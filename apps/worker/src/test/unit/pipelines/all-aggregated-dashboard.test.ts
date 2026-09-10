/**
 * The rollup grouping set (scenario_name/transaction_name NULL) must land on the
 * "all aggregated" dashboard under the single fixed metric name, and must not also
 * emit the per-scenario "total" throughput series.
 */
import { describe, it, expect, vi } from 'vitest';
import { TransactionsProcessor } from '../../../pipelines/helpers/transactions-processor.js';
import type { DashboardManager } from '../../../pipelines/helpers/dashboard-manager.js';
import {
  ALL_AGGREGATED_SCENARIO,
  ALL_AGGREGATED_METRIC,
  METRIC_TYPE_PANEL_IDS,
  METRIC_TYPE_PANEL_NAMES,
} from '../../../constants/performance-metrics.js';
import type { TestRunMetadata, ApdexThresholdLookup } from '../../../types/performance-metrics.js';
import {
  generateScenarioDashboardUid,
  generateScenarioDashboardLabel,
} from '../../../utils/uuid-generator.js';

const bucketTime = new Date('2026-01-01T00:01:00Z');

const row = (scenario: string | null, transaction: string | null) => ({
  scenario_name: scenario,
  transaction_name: transaction,
  bucket_time: bucketTime,
  timestep: 1,
  avg_response_time: 100,
  p90_response_time: 150,
  p95_response_time: 180,
  p99_response_time: 200,
  error_rate: 1,
  throughput: 10,
  apdex_satisfied: '8',
  apdex_tolerating: '2',
  apdex_total: '10',
});

const dashboardManager = {
  getOrCreateScenarioDashboard: vi.fn(async (scenarioName: string) => ({
    dashboardId: `dash-${scenarioName}`,
    dashboardUid: `uid-${scenarioName}`,
    dashboardLabel: `Performance test metrics ${scenarioName}`,
  })),
  getMetricTypePanel: (panelId: number) => ({ panelId, panelName: METRIC_TYPE_PANEL_NAMES[panelId]! }),
} as unknown as DashboardManager;

const testRun = {
  system_under_test_id: 'sut-1',
  test_environment: 'acc',
  workload: 'load',
  start_time: new Date('2026-01-01T00:00:00Z'),
  end_time: new Date('2026-01-01T01:00:00Z'),
  ramp_up_time: 0,
  organization_id: 'org-1',
} as unknown as TestRunMetadata;

/**
 * The processors no longer return ds_metrics records — they write them with one
 * INSERT ... SELECT — so the roll-up contract is asserted against the SQL and its
 * parameters. `mockDataSource` answers the scenario lookup first, then the insert.
 */
const mockDataSource = (scenarios: string[] = ['loadtest']) => ({
  query: vi
    .fn()
    .mockResolvedValueOnce(scenarios.map((scenario_name) => ({ scenario_name })))
    .mockResolvedValue([[], 42]),
});

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as never;

/** The INSERT is the second statement; the scenario lookup is the first. */
const insertSql = (dataSource: { query: { mock: { calls: unknown[][] } } }) =>
  (dataSource.query.mock.calls[1]![0] as string).replace(/\s+/g, ' ');

const insertParams = (dataSource: { query: { mock: { calls: unknown[][] } } }) =>
  dataSource.query.mock.calls[1]![1] as unknown[];

describe('all-aggregated rollup rows', () => {
  it('routes the roll-up grouping set to the aggregated dashboard under one metric name', async () => {
    const dataSource = mockDataSource();
    const processor = new TransactionsProcessor(dataSource as never, dashboardManager, silentLogger());

    await processor.process('run-1', testRun, {} as ApdexThresholdLookup, 60, false);

    const sql = insertSql(dataSource);
    const params = insertParams(dataSource);

    // g_scenario = 1 is the run-wide set: it carries the roll-up scenario and the one
    // fixed metric name, both passed as parameters rather than inlined.
    const rollupScenarioParam = `$${params.indexOf(ALL_AGGREGATED_SCENARIO) + 1}`;
    const rollupMetricParam = `$${params.indexOf(ALL_AGGREGATED_METRIC) + 1}`;
    expect(params).toContain(ALL_AGGREGATED_SCENARIO);
    expect(params).toContain(ALL_AGGREGATED_METRIC);
    expect(sql).toContain(`CASE WHEN c.g_scenario = 1 THEN ${rollupScenarioParam} ELSE c.scenario_name END`);
    expect(sql).toContain(`WHEN c.g_scenario = 1 THEN ${rollupMetricParam}`);

    // The aggregated dashboard is in the VALUES table, so the join finds it.
    expect(params).toContain(`dash-${ALL_AGGREGATED_SCENARIO}`);
  });

  it('does not emit a second "total" throughput series for the roll-up', async () => {
    const dataSource = mockDataSource();
    const processor = new TransactionsProcessor(dataSource as never, dashboardManager, silentLogger());

    await processor.process('run-1', testRun, {} as ApdexThresholdLookup, 60, false);

    // The "total" arm is the per-scenario grouping set only (g_scenario = 0, g_txn = 1);
    // the roll-up row's own throughput already covers every transaction.
    expect(insertSql(dataSource)).toContain(
      `SELECT c.scenario_name, 'total', ${METRIC_TYPE_PANEL_IDS.TXN_THROUGHPUT},` +
      ' c.throughput::double precision, c.bucket_time, c.timestep FROM computed c' +
      ' WHERE c.g_scenario = 0 AND c.g_txn = 1'
    );
  });
});

// The web client recognises this dashboard by these two literals
// (ALL_AGGREGATED_DASHBOARD_LABEL / _UID in apps/web/lib/aggregated-perf-series.ts) to
// suppress its own synthetic "All aggregated" option. Renaming the scenario breaks that.
describe('the aggregated dashboard is display-only', () => {
  it('creates no compare configs, so ADAPT does not evaluate the roll-up', async () => {
    const dataSource = mockDataSource();
    const processor = new TransactionsProcessor(dataSource as never, dashboardManager, silentLogger());

    const { compareConfigs } = await processor.process('run-1', testRun, {} as ApdexThresholdLookup, 60, false);

    expect(compareConfigs.length).toBeGreaterThan(0);
    expect(compareConfigs.map(c => c.application_dashboard_id))
      .not.toContain(`dash-${ALL_AGGREGATED_SCENARIO}`);
  });
});

describe('the rollup grouping set', () => {
  it('is in the SQL the processor issues', async () => {
    // Tripwire: deleting the GROUPING SETS clause — the substance of this feature —
    // would leave the parameter assertions above green.
    const dataSource = mockDataSource();
    const processor = new TransactionsProcessor(dataSource as never, dashboardManager, silentLogger());

    await processor.process('run-1', testRun, {} as ApdexThresholdLookup, 60, false);

    const sql = insertSql(dataSource);
    expect(sql).toContain('GROUPING SETS');
    // The rollup groups by bucket alone — that is what makes it run-wide.
    expect(sql).toContain('(bd.bucket_time)');
    // ...and the per-scenario total groups by scenario and bucket.
    expect(sql).toContain('(bd.scenario_name, bd.bucket_time)');
  });
});

describe('all-aggregated dashboard identifiers', () => {
  it('matches the literals the web client keys on', () => {
    expect(generateScenarioDashboardLabel(ALL_AGGREGATED_SCENARIO))
      .toBe('Performance test metrics all aggregated');
    expect(generateScenarioDashboardUid(ALL_AGGREGATED_SCENARIO))
      .toBe('performance-test-metrics-all-aggregated');
  });
});
