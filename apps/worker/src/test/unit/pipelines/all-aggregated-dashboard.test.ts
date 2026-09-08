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

describe('all-aggregated rollup rows', () => {
  it('maps NULL-scenario rows to the aggregated dashboard and one metric name', async () => {
    const dataSource = { query: vi.fn(async () => [row('loadtest', 'checkout'), row(null, null)]) };
    const processor = new TransactionsProcessor(
      dataSource as never,
      dashboardManager,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never
    );

    const { metrics } = await processor.process('run-1', testRun, {} as ApdexThresholdLookup, 60);

    const aggregated = metrics.filter(m => m.dashboard_label.endsWith(ALL_AGGREGATED_SCENARIO));
    expect(aggregated.length).toBeGreaterThan(0);
    expect(new Set(aggregated.map(m => m.metric_name))).toEqual(new Set([ALL_AGGREGATED_METRIC]));

    // The rollup's own throughput already covers every transaction — no second "total".
    expect(aggregated.some(m => m.panel_id === METRIC_TYPE_PANEL_IDS.TXN_THROUGHPUT)).toBe(true);
    expect(aggregated.some(m => m.metric_name === 'total')).toBe(false);

    // Per-scenario rows are untouched.
    const scenario = metrics.filter(m => m.dashboard_label.endsWith('loadtest'));
    expect(scenario.some(m => m.metric_name === 'checkout')).toBe(true);
    expect(scenario.some(m => m.metric_name === 'total')).toBe(true);
  });
});

// The web client recognises this dashboard by these two literals
// (ALL_AGGREGATED_DASHBOARD_LABEL / _UID in apps/web/lib/aggregated-perf-series.ts) to
// suppress its own synthetic "All aggregated" option. Renaming the scenario breaks that.
describe('the aggregated dashboard is display-only', () => {
  it('creates no compare configs, so ADAPT does not evaluate the roll-up', async () => {
    const dataSource = { query: vi.fn(async () => [row('loadtest', 'checkout'), row(null, null)]) };
    const processor = new TransactionsProcessor(
      dataSource as never,
      dashboardManager,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never
    );

    const { compareConfigs } = await processor.process('run-1', testRun, {} as ApdexThresholdLookup, 60);

    expect(compareConfigs.length).toBeGreaterThan(0);
    expect(compareConfigs.map(c => c.application_dashboard_id))
      .not.toContain(`dash-${ALL_AGGREGATED_SCENARIO}`);
  });
});

describe('the rollup grouping set', () => {
  it('is in the SQL the processor issues', async () => {
    // Tripwire. Every other test here hand-feeds a scenario_name:null row, so deleting the
    // GROUPING SETS clause — the substance of this feature — would leave them all green.
    const dataSource = { query: vi.fn(async () => [row('loadtest', 'checkout'), row(null, null)]) };
    const processor = new TransactionsProcessor(
      dataSource as never,
      dashboardManager,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never
    );

    await processor.process('run-1', testRun, {} as ApdexThresholdLookup, 60);

    const sql = dataSource.query.mock.calls[0]![0] as string;
    expect(sql).toContain('GROUPING SETS');
    // The rollup groups by bucket alone — that is what makes it run-wide.
    expect(sql.replace(/\s+/g, ' ')).toContain('(bd.bucket_time)');
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
