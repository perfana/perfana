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
    // excludeRampUp=false → both cutoffs null; system call → no org params.
    expect(params).toEqual(['run-1', null, null]);
  });

  it('trims BOTH ends of the analysis window, the way the baked ds_metrics.ramp_up column does', async () => {
    // The bug this guards: with only a start cutoff, an aggregate series drawn beside a
    // stored ds_metrics series on one preset chart runs past it by the ramp-down band.
    const testRunRepo = {
      query: jest.fn()
        // getAnalysisWindowBounds
        .mockResolvedValueOnce([{
          start_time: '2025-06-01T10:00:00.000Z', ramp_up: '120',
          end_time: '2025-06-01T11:00:00.000Z', ramp_down: '60',
        }])
        .mockResolvedValueOnce([]),
    } as any;
    const svc = new ReportDataFetcherService(testRunRepo, {} as any, {} as any);

    await svc.getAggregatedSeries('run-1', 'transaction_response_time', 'p95', true, '', []);

    const [sql, params] = testRunRepo.query.mock.calls[1];
    expect(sql).toContain('t.time >= $2::timestamptz');
    expect(sql).toContain('t.time <= $3::timestamptz');
    expect(params[1]).toEqual(new Date('2025-06-01T10:02:00.000Z'));
    expect(params[2]).toEqual(new Date('2025-06-01T10:59:00.000Z'));
  });

  it('computes percentiles the way the /aggregated-metric-timeseries endpoint does', async () => {
    // Exact PERCENTILE_CONT is the better number in isolation and the WRONG one here: the
    // Graphs card draws the same series from that endpoint's t-digest, and the two were
    // measured up to 21% apart on a spiky bucket.
    const testRunRepo = { query: jest.fn().mockResolvedValue([]) } as any;
    const svc = new ReportDataFetcherService(testRunRepo, {} as any, {} as any);

    await svc.getAggregatedSeries('run-1', 'request_response_time', 'p95', false, '', []);

    const [sql] = testRunRepo.query.mock.calls[0];
    expect(sql).toContain('approx_percentile(0.95, percentile_agg(t.response_time::double precision))');
    expect(sql).not.toMatch(/PERCENTILE_CONT/i);
  });

  it('getAggregatedSeries uses requests_raw + error math for error_percentage', async () => {
    const testRunRepo = { query: jest.fn().mockResolvedValue([]) } as any;
    const svc = new ReportDataFetcherService(testRunRepo, {} as any, {} as any);

    await svc.getAggregatedSeries('run-1', 'error_percentage', 'avg', false, '', []);

    const [sql] = testRunRepo.query.mock.calls[0];
    expect(sql).toContain('FROM requests_raw');
    expect(sql).toContain('FILTER (WHERE NOT t.success)');
  });

  it('getAggregatedScalars returns run-wide avg/p90/p95/p99/pass/fail with no GROUP BY', async () => {
    const testRunRepo = {
      query: jest.fn().mockResolvedValue([{ avg: '110', p90: '180', p95: '220', p99: '300', pass: '980', fail: '20' }]),
    } as any;
    const svc = new ReportDataFetcherService(testRunRepo, {} as any, {} as any);

    const s = await svc.getAggregatedScalars('run-1', '', []);

    expect(s).toEqual({ avg: 110, p90: 180, p95: 220, p99: 300, pass: 980, fail: 20 });
    const [sql] = testRunRepo.query.mock.calls[0];
    expect(sql).toContain('FROM transactions');
    expect(sql).not.toContain('GROUP BY');
  });
});

describe('ReportDataFetcherService getGraphPresetPanels', () => {
  it('tags the saved series that names the synthetic aggregate, and only that one', async () => {
    // The bug this guards: a preset stores the run-wide aggregate like any other
    // series, so unless it is recognised here the renderer queries ds_metrics for a
    // metric name the pipeline never wrote and the preset renders empty.
    const testRunRepo = {
      query: jest.fn().mockResolvedValue([{
        id: 'p1',
        name: 'Run-wide RT vs heap',
        series_config: [
          {
            dashboardLabel: 'Performance test metrics BrowseAndSearch',
            panelId: 103,
            panelTitle: 'Transaction RT P95',
            metricName: 'All aggregated — Transaction RT P95',
          },
          { dashboardLabel: 'JVM', panelId: 7, panelTitle: 'Heap', metricName: 'heap_used' },
        ],
      }]),
    } as any;
    const svc = new ReportDataFetcherService(testRunRepo, {} as any, {} as any);

    const { presets } = await svc.getGraphPresetPanels(['p1'], '', []);

    expect(presets[0]!.panels).toEqual([
      {
        dashboardLabel: 'Performance test metrics BrowseAndSearch',
        panelTitle: 'Transaction RT P95',
        metricName: 'All aggregated — Transaction RT P95',
        aggregate: { metric: 'transaction_response_time', stat: 'p95', unit: 'ms' },
      },
      // An ordinary series stays untagged, or the renderer would compute a run-wide
      // number in place of the metric the author picked.
      { dashboardLabel: 'JVM', panelTitle: 'Heap', metricName: 'heap_used', aggregate: undefined },
    ]);
  });
});
