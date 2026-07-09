import { ReportDataFetcherService } from './report-data-fetcher.service';

const repoStub = {} as any;
const authzStub = {} as any;
const dataSourceStub = {} as any;

describe('ReportDataFetcherService.getBaselineRunComparison', () => {
  it('pairs transactions by scenario+name and diffs avg/p95/p99 as a system call (empty userId)', async () => {
    // One combined result set for both runs, as returned by the direct SQL query.
    // userId is '' — the background HTML-generation job has no user context, and
    // the fetcher's system-call convention (resolveOrgFilter) must still return data.
    const rows = [
      { test_run_id: 'cur', scenario_name: 'checkout', transaction_name: 'login', avg_ms: '110', p95_ms: '220', p99_ms: '300' },
      { test_run_id: 'base', scenario_name: 'checkout', transaction_name: 'login', avg_ms: '100', p95_ms: '200', p99_ms: '250' },
    ];
    const testRunRepo = { query: jest.fn().mockResolvedValue(rows) } as any;
    const svc = new ReportDataFetcherService(testRunRepo, authzStub, dataSourceStub);
    const data = await svc.getBaselineRunComparison('cur', 'base', 'performance-metrics',
      { metrics: ['avg', 'p95', 'p99'], userId: '', roles: [] });
    expect(data!.rows).toHaveLength(1);
    const row = data!.rows[0]!;
    expect(row.group).toBe('checkout');
    expect(row.label).toBe('login');
    expect(row.metrics.find(m => m.key === 'avg')!.diffPercent).toBeCloseTo(10);
    expect(row.metrics.find(m => m.key === 'p99')!.diffPercent).toBeCloseTo(20);
    // System call: no org filter params appended
    const [sql, params] = testRunRepo.query.mock.calls[0]!;
    expect(sql).toContain('FROM transactions');
    expect(params).toEqual([['cur', 'base']]);
  });

  it('pairs ds_metric_statistics rows by dashboard/panel/metric (grafana)', async () => {
    const rows = [
      { test_run_id: 'cur', dashboard_label: 'JVM', panel_title: 'Heap', metric_name: 'used', mean: 110, q95: 220, q99: 300, unit: 'bytes' },
      { test_run_id: 'base', dashboard_label: 'JVM', panel_title: 'Heap', metric_name: 'used', mean: 100, q95: 200, q99: 250, unit: 'bytes' },
    ];
    const dataSource = { query: jest.fn().mockResolvedValue(rows) };
    const svc = new ReportDataFetcherService(repoStub, authzStub, dataSource as any);
    const data = await svc.getBaselineRunComparison('cur', 'base', 'grafana',
      { metrics: ['avg', 'p95'], userId: 'u', roles: [] });
    const row = data!.rows[0]!;
    expect(row.group).toBe('JVM / Heap');
    expect(row.metrics.find(m => m.key === 'avg')!.diffPercent).toBeCloseTo(10);
  });

  it('filters by dashboard and panel ids when configured (grafana)', async () => {
    const rows = [
      { test_run_id: 'cur', dashboard_label: 'JVM', panel_title: 'Heap', metric_name: 'used', mean: 110, q95: 220, q99: 300, unit: 'bytes' },
      { test_run_id: 'base', dashboard_label: 'JVM', panel_title: 'Heap', metric_name: 'used', mean: 100, q95: 200, q99: 250, unit: 'bytes' },
    ];
    const dataSource = { query: jest.fn().mockResolvedValue(rows) };
    const svc = new ReportDataFetcherService(repoStub, authzStub, dataSource as any);
    await svc.getBaselineRunComparison('cur', 'base', 'grafana',
      { metrics: ['avg'], userId: 'u', roles: [], dashboardLabel: 'JVM', panelIds: [3, 7] });
    const [sql, params] = dataSource.query.mock.calls[0]!;
    expect(sql).toContain('s.dashboard_label = $3');
    expect(sql).toContain('s.panel_id = ANY($4)');
    expect(params).toEqual([['cur', 'base'], 'grafana', 'JVM', [3, 7]]);
  });

  it('omits dashboard/panel filters when not configured', async () => {
    const dataSource = { query: jest.fn().mockResolvedValue([]) };
    const svc = new ReportDataFetcherService(repoStub, authzStub, dataSource as any);
    await svc.getBaselineRunComparison('cur', 'base', 'grafana',
      { metrics: ['avg'], userId: 'u', roles: [] });
    const [sql, params] = dataSource.query.mock.calls[0]!;
    expect(sql).not.toContain('s.dashboard_label =');
    expect(sql).not.toContain('s.panel_id =');
    expect(params).toEqual([['cur', 'base'], 'grafana']);
  });

  it('remaps host token for dynatrace baseline lookup', async () => {
    const rows = [
      { test_run_id: 'cur', dashboard_label: 'Hosts', panel_title: 'CPU', metric_name: 'cpu.host-A', mean: 60, q95: 80, q99: 90, unit: '%' },
      { test_run_id: 'base', dashboard_label: 'Hosts', panel_title: 'CPU', metric_name: 'cpu.host-B', mean: 50, q95: 70, q99: 85, unit: '%' },
    ];
    const dataSource = { query: jest.fn().mockResolvedValue(rows) };
    const svc = new ReportDataFetcherService(repoStub, authzStub, dataSource as any);
    const data = await svc.getBaselineRunComparison('cur', 'base', 'dynatrace',
      { metrics: ['avg'], userId: 'u', roles: [], hostMap: [{ current: 'host-A', baseline: 'host-B' }] });
    const row = data!.rows[0]!;
    expect(row.group).toBe('host-A');
    expect(row.metrics[0]!.diffPercent).toBeCloseTo(20);
  });
});
