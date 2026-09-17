/**
 * The Transaction/Request Impact panels: SUM(response_time) per bucket (= avg_rt x count,
 * the Top 10 "performance ranking" figure), emitted by both processors and classified so
 * ADAPT evaluates them. Fails if either panel drops out of the VALUES list or the
 * classified set.
 */
import { describe, it, expect, vi } from 'vitest';
import { RequestsProcessor } from '../../../pipelines/helpers/requests-processor.js';
import { TransactionsProcessor } from '../../../pipelines/helpers/transactions-processor.js';
import type { DashboardManager } from '../../../pipelines/helpers/dashboard-manager.js';
import { METRIC_TYPE_PANEL_IDS, METRIC_TYPE_PANEL_NAMES } from '../../../constants/performance-metrics.js';
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
  ['TransactionsProcessor', TransactionsProcessor, METRIC_TYPE_PANEL_IDS.TXN_IMPACT],
  ['RequestsProcessor', RequestsProcessor, METRIC_TYPE_PANEL_IDS.REQ_IMPACT],
] as const)('%s impact panel', (_name, Processor, panelId) => {
  it('emits SUM(response_time) per bucket on a classified panel', async () => {
    const ds = mockDataSource();
    const { compareConfigs } = await new Processor(ds as never, dashboardManager, logger)
      .process('run-1', testRun, {} as ApdexThresholdLookup, 60, false);

    const sql = insertSql(ds);
    expect(sql).toContain('SUM(bd.response_time) as impact');
    expect(sql).toContain(`(${panelId}, c.impact::double precision)`);

    const config = compareConfigs.find((c) => c.panel_id === panelId && c.application_dashboard_id === 'dash-loadtest');
    expect(config?.config_data.metricClassification).toEqual({ classification: 'RED_duration', higherIsBetter: false });
    expect(config?.config_data.thresholds.aggregation).toBe('mean');
  });
});
