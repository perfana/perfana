import { ReportDataFetcherService } from './report-data-fetcher.service';

describe('ReportDataFetcherService aggregate methods', () => {
  it('getAggregatedSeries maps rows to {Date,number} and aggregates across all transactions', async () => {
    const testRunRepo = {
      query: jest.fn().mockResolvedValue([
        { time: '2025-06-01T10:00:00.000Z', value: '120.5' },
        { time: '2025-06-01T10:01:00.000Z', value: '130' },
      ]),
    } as any;
    const svc = new ReportDataFetcherService(testRunRepo, {} as any, {} as any);

    const series = await svc.getAggregatedSeries('run-1', 'transaction_response_time', 'avg', false, '', []);

    expect(series).toEqual([
      { time: new Date('2025-06-01T10:00:00.000Z'), value: 120.5 },
      { time: new Date('2025-06-01T10:01:00.000Z'), value: 130 },
    ]);
    const [sql, params] = testRunRepo.query.mock.calls[0];
    expect(sql).toContain('FROM transactions');
    expect(sql).toContain("date_trunc('minute', t.time)");
    // The whole point: NO per-transaction grouping — one series for the run.
    expect(sql).not.toMatch(/transaction_name/i);
    // excludeRampUp=false → null cutoff; system call → no org params.
    expect(params).toEqual(['run-1', null]);
  });

  it('getAggregatedSeries uses requests_raw + error math for error_percentage', async () => {
    const testRunRepo = { query: jest.fn().mockResolvedValue([]) } as any;
    const svc = new ReportDataFetcherService(testRunRepo, {} as any, {} as any);

    await svc.getAggregatedSeries('run-1', 'error_percentage', 'avg', false, '', []);

    const [sql] = testRunRepo.query.mock.calls[0];
    expect(sql).toContain('FROM requests_raw');
    expect(sql).toContain('FILTER (WHERE NOT t.success)');
  });

  it('getAggregatedScalars returns run-wide avg/p95/p99/pass/fail with no GROUP BY', async () => {
    const testRunRepo = {
      query: jest.fn().mockResolvedValue([{ avg: '110', p95: '220', p99: '300', pass: '980', fail: '20' }]),
    } as any;
    const svc = new ReportDataFetcherService(testRunRepo, {} as any, {} as any);

    const s = await svc.getAggregatedScalars('run-1', '', []);

    expect(s).toEqual({ avg: 110, p95: 220, p99: 300, pass: 980, fail: 20 });
    const [sql] = testRunRepo.query.mock.calls[0];
    expect(sql).toContain('FROM transactions');
    expect(sql).not.toContain('GROUP BY');
  });
});
