import { ReportDataFetcherService } from './report-data-fetcher.service';

const repoStub = {} as any;
const authzStub = {} as any;
const dataSourceStub = {} as any;

describe('ReportDataFetcherService.getBaselineRunComparison', () => {
  it('pairs transactions by scenario+name and diffs avg/p95/p99', async () => {
    const current = [
      { scenario_name: 'checkout', transaction_name: 'login', avg_response_time: '110', p95_response_time: '220', p99_response_time: '300' },
    ];
    const baseline = [
      { scenario_name: 'checkout', transaction_name: 'login', avg_response_time: '100', p95_response_time: '200', p99_response_time: '250' },
    ];
    const testRuns = { getTransactionStats: jest.fn()
      .mockResolvedValueOnce(current).mockResolvedValueOnce(baseline) };
    const svc = new ReportDataFetcherService(repoStub, authzStub, dataSourceStub, testRuns as any);
    const data = await svc.getBaselineRunComparison('cur', 'base', 'performance-metrics',
      { metrics: ['avg', 'p95', 'p99'], userId: 'u', roles: [] });
    expect(data!.rows).toHaveLength(1);
    const row = data!.rows[0]!;
    expect(row.group).toBe('checkout');
    expect(row.label).toBe('login');
    expect(row.metrics.find(m => m.key === 'avg')!.diffPercent).toBeCloseTo(10);
    expect(row.metrics.find(m => m.key === 'p99')!.diffPercent).toBeCloseTo(20);
  });

  it('pairs ds_metric_statistics rows by dashboard/panel/metric (grafana)', async () => {
    const rows = [
      { test_run_id: 'cur', dashboard_label: 'JVM', panel_title: 'Heap', metric_name: 'used', mean: 110, q95: 220, q99: 300, unit: 'bytes' },
      { test_run_id: 'base', dashboard_label: 'JVM', panel_title: 'Heap', metric_name: 'used', mean: 100, q95: 200, q99: 250, unit: 'bytes' },
    ];
    const dataSource = { query: jest.fn().mockResolvedValue(rows) };
    const svc = new ReportDataFetcherService(repoStub, authzStub, dataSource as any, {} as any);
    const data = await svc.getBaselineRunComparison('cur', 'base', 'grafana',
      { metrics: ['avg', 'p95'], userId: 'u', roles: [] });
    const row = data!.rows[0]!;
    expect(row.group).toBe('JVM / Heap');
    expect(row.metrics.find(m => m.key === 'avg')!.diffPercent).toBeCloseTo(10);
  });

  it('remaps host token for dynatrace baseline lookup', async () => {
    const rows = [
      { test_run_id: 'cur', dashboard_label: 'Hosts', panel_title: 'CPU', metric_name: 'cpu.host-A', mean: 60, q95: 80, q99: 90, unit: '%' },
      { test_run_id: 'base', dashboard_label: 'Hosts', panel_title: 'CPU', metric_name: 'cpu.host-B', mean: 50, q95: 70, q99: 85, unit: '%' },
    ];
    const dataSource = { query: jest.fn().mockResolvedValue(rows) };
    const svc = new ReportDataFetcherService(repoStub, authzStub, dataSource as any, {} as any);
    const data = await svc.getBaselineRunComparison('cur', 'base', 'dynatrace',
      { metrics: ['avg'], userId: 'u', roles: [], hostMap: [{ current: 'host-A', baseline: 'host-B' }] });
    const row = data!.rows[0]!;
    expect(row.group).toBe('host-A');
    expect(row.metrics[0]!.diffPercent).toBeCloseTo(20);
  });
});
