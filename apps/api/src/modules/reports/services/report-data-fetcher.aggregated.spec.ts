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
        id: '11111111-1111-4111-8111-111111111111',
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

    const { presets } = await svc.getGraphPresetPanels(['11111111-1111-4111-8111-111111111111'], '', []);

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

describe('ReportDataFetcherService getTrendsPresetSeries', () => {
  it('drops a malformed id instead of letting the uuid cast fail the whole batch', async () => {
    // A stray non-uuid string in a template used to make `$1::uuid[]` throw, which reported
    // every valid preset beside it as "no longer exists".
    const testRunRepo = { query: jest.fn().mockResolvedValue([]) } as any;
    const svc = new ReportDataFetcherService(testRunRepo, {} as any, {} as any);

    await svc.getTrendsPresetSeries(['not-a-uuid', '22222222-2222-4222-8222-222222222222'], '', []);

    expect(testRunRepo.query.mock.calls[0]![1][0]).toEqual(['22222222-2222-4222-8222-222222222222']);
  });


  it('maps a trends preset to per-series selections and its statistic', async () => {
    const testRunRepo = {
      query: jest.fn().mockResolvedValue([{
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Nightly RT',
        evaluate_type: 'q95',
        series_config: [
          // The card stores the synthetic aggregate under its composed name; it becomes an
          // aggregate at the PANEL's stat (103 = p95), not a statistics selection.
          { dashboardLabel: 'Perf', panelId: 103, panelTitle: 'Transaction RT P95', metricName: 'All aggregated — Transaction RT P95', isAggregated: true },
          { dashboardLabel: 'JVM', panelId: 7, metricName: 'heap_used' },
          { dashboardLabel: 'JVM', metricName: 'no-panel-id' },
        ],
      }]),
    } as any;
    const svc = new ReportDataFetcherService(testRunRepo, {} as any, {} as any);

    const { presets, foundIds } = await svc.getTrendsPresetSeries(['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'], '', []);

    expect(foundIds).toEqual(['22222222-2222-4222-8222-222222222222']);
    expect(presets).toEqual([{
      id: '22222222-2222-4222-8222-222222222222', name: 'Nightly RT', stat: 'p95',
      selections: [
        { dashboardLabel: 'JVM', panelId: 7, metricNames: ['heap_used'] },
      ],
      aggregates: [
        { dashboardLabel: 'Perf', panelTitle: 'Transaction RT P95', metricName: 'All aggregated — Transaction RT P95', metric: 'transaction_response_time', stat: 'p95', unit: 'ms' },
      ],
    }]);
  });

  it('queries nothing for an empty id list', async () => {
    const testRunRepo = { query: jest.fn() } as any;
    const svc = new ReportDataFetcherService(testRunRepo, {} as any, {} as any);

    expect(await svc.getTrendsPresetSeries([], '', [])).toEqual({ presets: [], foundIds: [] });
    expect(testRunRepo.query).not.toHaveBeenCalled();
  });

  it('answers "no presets" when the lookup fails, so the section warns instead of the report dying', async () => {
    const testRunRepo = { query: jest.fn().mockRejectedValue(new Error('relation does not exist')) } as any;
    const svc = new ReportDataFetcherService(testRunRepo, {} as any, {} as any);

    expect(await svc.getTrendsPresetSeries(['22222222-2222-4222-8222-222222222222'], '', [])).toEqual({ presets: [], foundIds: [] });
  });

  it('falls back to avg for an unknown statistic and to no selections for a preset without series', async () => {
    // A preset saved before series_config existed, or with a statistic this path cannot plot.
    const testRunRepo = {
      query: jest.fn().mockResolvedValue([
        { id: '55555555-5555-4555-8555-555555555555', name: 'Old', evaluate_type: 'stddev', series_config: null },
        { id: '44444444-4444-4444-8444-444444444444', name: 'Unset', evaluate_type: null, series_config: [] },
      ]),
    } as any;
    const svc = new ReportDataFetcherService(testRunRepo, {} as any, {} as any);

    const { presets, foundIds } = await svc.getTrendsPresetSeries(['44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'], '', []);

    // Returned in the order they were asked for, not the order the database answered
    expect(foundIds).toEqual(['44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555']);
    expect(presets).toEqual([
      { id: '44444444-4444-4444-8444-444444444444', name: 'Unset', stat: 'avg', selections: [], aggregates: [] },
      { id: '55555555-5555-4555-8555-555555555555', name: 'Old', stat: 'avg', selections: [], aggregates: [] },
    ]);
  });
});

describe('ReportDataFetcherService getAggregatedTrendValues', () => {
  it('reads the rollup tables the card endpoint reads, percentile from the merged sketch', async () => {
    const testRunRepo = { query: jest.fn().mockResolvedValue([{ test_run_id: 'r1', value: '412.50' }, { test_run_id: 'r2', value: null }]) } as any;
    const svc = new ReportDataFetcherService(testRunRepo, {} as any, {} as any);

    const values = await svc.getAggregatedTrendValues(['r1', 'r2'], 'transaction_response_time', 'p95');

    expect(values).toEqual({ r1: 412.5, r2: null });
    const [sql, params] = testRunRepo.query.mock.calls[0];
    expect(sql).toContain('FROM test_run_transaction_stats');
    expect(sql).toContain('approx_percentile(0.95, pct_agg)');
    expect(sql).toContain('bool_or(ramp_up_excluded)');
    expect(params).toEqual([['r1', 'r2']]);
  });

  it('answers error percentage from the sampler rollup counts', async () => {
    const testRunRepo = { query: jest.fn().mockResolvedValue([{ test_run_id: 'r1', value: '1.25' }]) } as any;
    const svc = new ReportDataFetcherService(testRunRepo, {} as any, {} as any);

    await svc.getAggregatedTrendValues(['r1'], 'error_percentage', 'avg');

    const [sql] = testRunRepo.query.mock.calls[0];
    expect(sql).toContain('FROM test_run_sampler_stats');
    expect(sql).toContain('failed_count');
    expect(sql).not.toContain('pct_agg');
  });
});
