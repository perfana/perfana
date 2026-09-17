/**
 * The Transaction/Request Concurrency panels: SUM(response_time) / 1000 / bucket seconds
 * (= throughput x avg_rt, the average requests in flight — the Top 10 "performance ranking"
 * figure per second of run, unitless), emitted by both processors and classified so ADAPT
 * evaluates them. The division is what keeps two runs with different bucket sizes
 * comparable. Fails if either panel drops out of the VALUES list or the classified set.
 */
import { describe, it, expect, vi } from 'vitest';
import { RequestsProcessor } from '../../../pipelines/helpers/requests-processor.js';
import { TransactionsProcessor } from '../../../pipelines/helpers/transactions-processor.js';
import type { DashboardManager } from '../../../pipelines/helpers/dashboard-manager.js';
import { METRIC_TYPE_PANEL_IDS, METRIC_TYPE_PANEL_NAMES, METRIC_TYPE_PANEL_UNITS } from '../../../constants/performance-metrics.js';
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
} as unknown as TestRunMetadata;

const mockDataSource = () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce([{ scenario_name: 'loadtest' }])
    .mockResolvedValue([[], 1]);
  const transaction = (fn: (em: { query: typeof query }) => Promise<unknown>) =>
    fn({ query: ((sql: string, params?: unknown[]) => (sql.includes('set_config') ? Promise.resolve([]) : query(sql, params))) as typeof query });
  return { query, transaction };
};

const insertSql = (ds: ReturnType<typeof mockDataSource>) =>
  (ds.query.mock.calls[1]![0] as string).replace(/\s+/g, ' ');

describe.each([
  ['TransactionsProcessor', TransactionsProcessor, METRIC_TYPE_PANEL_IDS.TXN_CONCURRENCY, 'Transaction Concurrency'],
  ['RequestsProcessor', RequestsProcessor, METRIC_TYPE_PANEL_IDS.REQ_CONCURRENCY, 'Request Concurrency'],
] as const)('%s concurrency panel', (_name, Processor, panelId, title) => {
  it('emits SUM(response_time) / 1000 per bucket second on a classified panel', async () => {
    const ds = mockDataSource();
    const { compareConfigs } = await new Processor(ds as never, dashboardManager, logger)
      .process('run-1', testRun, {} as ApdexThresholdLookup, 60, false);

    const sql = insertSql(ds);
    expect(sql).toContain('SUM(bd.response_time)::double precision / 1000 / $4 as concurrency');
    expect(sql).toContain(`(${panelId}, c.concurrency::double precision)`);

    const config = compareConfigs.find((c) => c.panel_id === panelId && c.application_dashboard_id === 'dash-loadtest');
    expect(config?.config_data.metricClassification).toEqual({ classification: 'RED_duration', higherIsBetter: false });
    expect(config?.config_data.thresholds.aggregation).toBe('mean');
  });

  it('joins the panel title and unit onto every concurrency row', async () => {
    // insertDsMetricsFromAggregate binds (panel_id, panel_title, unit) as three consecutive
    // parameters of the metric_panels VALUES table; a panel with no name throws there and a
    // missing unit lands as NULL on every row of the panel, so both are pinned as literals:
    // the title so the rename is a visible test diff, and '' because the value is a
    // dimensionless count (like Apdex) — a unit string here would be wrong, not missing.
    const ds = mockDataSource();
    await new Processor(ds as never, dashboardManager, logger)
      .process('run-1', testRun, {} as ApdexThresholdLookup, 60, false);

    const params = ds.query.mock.calls[1]![1] as unknown[];
    const at = params.indexOf(panelId);
    expect(at).toBeGreaterThan(-1);
    expect(METRIC_TYPE_PANEL_UNITS[panelId]).toBe('');
    expect(params.slice(at, at + 3)).toEqual([panelId, title, '']);
  });

  it('writes the concurrency roll-up onto the all-aggregated dashboard without a compare config', async () => {
    // The roll-up row is display-only: the grouping set emits it for every panel in the
    // VALUES list (concurrency included), but ADAPT must not trend a run-wide sum that moves
    // with the traffic mix.
    const ds = mockDataSource();
    const { compareConfigs } = await new Processor(ds as never, dashboardManager, logger)
      .process('run-1', testRun, {} as ApdexThresholdLookup, 60, false);

    const params = ds.query.mock.calls[1]![1] as unknown[];
    expect(params).toContain('dash-all aggregated');
    expect(compareConfigs.some((c) => c.panel_id === panelId && c.application_dashboard_id === 'dash-all aggregated')).toBe(false);
  });

  it('projects every VALUES column through the computed CTE', async () => {
    // `c.<column>` in the LATERAL VALUES reads from `computed`, which has to re-project the
    // column from `aggregated` by name. A rename applied to the aggregate alias but not to
    // that projection (the v0.2.95.41 impact -> concurrency rename touched both, in two
    // files) only fails inside Postgres with `column c.concurrency does not exist`; the
    // alias check above cannot see it.
    const ds = mockDataSource();
    await new Processor(ds as never, dashboardManager, logger)
      .process('run-1', testRun, {} as ApdexThresholdLookup, 60, false);

    const sql = insertSql(ds);
    const computed = sql.match(/computed AS \( SELECT (.*?) FROM aggregated \)/)?.[1];
    expect(computed).toBeDefined();
    const projected = new Set(
      computed!.split(',').map((col) => col.trim().split(/\s+as\s+/i).pop()!.trim())
    );
    for (const column of sql.matchAll(/\(\d+, c\.(\w+)::double precision\)/g)) {
      expect(projected).toContain(column[1]);
    }
    expect(projected).toContain('concurrency');
    expect(sql).not.toMatch(/\bas impact\b|c\.impact\b/);
  });
});

it('titles the panels Transaction/Request Concurrency with an empty unit', () => {
  // The title is the only thing that tells a row written by this version from one a
  // v0.2.95.38-40 worker wrote in ms/s under the same panel_id (they pool into one
  // baseline 1000x apart), and it is what every metric picker shows. The web test uses the
  // same literal against mocked data, so this is the one place the two are tied together.
  expect(METRIC_TYPE_PANEL_IDS.TXN_CONCURRENCY).toBe(108);
  expect(METRIC_TYPE_PANEL_IDS.REQ_CONCURRENCY).toBe(219);
  expect(METRIC_TYPE_PANEL_NAMES[108]).toBe('Transaction Concurrency');
  expect(METRIC_TYPE_PANEL_NAMES[219]).toBe('Request Concurrency');
  expect(METRIC_TYPE_PANEL_UNITS[108]).toBe('');
  expect(METRIC_TYPE_PANEL_UNITS[219]).toBe('');
});

it('keeps every worker panel id out of the web\'s virtual URL panel block 210-218', () => {
  // apps/web/lib/url-perf-panels.ts synthesises 210-218 on the perf-test dashboards and
  // isUrlPanel() routes any stored id in that block through the sampler-URL rollup.
  expect(Object.values(METRIC_TYPE_PANEL_IDS).filter((id) => id >= 210 && id <= 218)).toEqual([]);
});

