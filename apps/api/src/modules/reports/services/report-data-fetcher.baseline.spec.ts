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
});
