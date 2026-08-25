import { ReportDataFetcherService } from './report-data-fetcher.service';

const authzStub = {} as any;

const runRow = (id: string, start: string) => ({
  test_run_id: id,
  start_time: start,
  application_release: 'v1',
  duration: '600',
  consolidated_result: { meetsRequirement: true, adaptTestRunOK: true },
  annotations: ['note'],
  avg_ms: '100',
  p95_ms: '200',
  p99_ms: '300',
  error_rate: '0',
  total_transactions: '10',
});

describe('ReportDataFetcherService trend window', () => {
  it('starts the window at ADAPT\'s most recent change point', async () => {
    const dataSource = {
      // change_point lookup for the run's control group
      query: jest.fn().mockResolvedValue([{ test_run_id: 'run-005' }]),
    };
    const repo = {
      query: jest.fn()
        .mockResolvedValueOnce([{ start_time: '2026-08-14T07:50:20.413Z' }]) // the change-point run
        .mockResolvedValueOnce([runRow('run-009', '2026-08-18T10:00:00Z'), runRow('run-008', '2026-08-17T10:00:00Z')]),
    } as any;
    const svc = new ReportDataFetcherService(repo, authzStub, dataSource as any);

    const data = await svc.getTrendsData(
      { testRunId: 'run-009', systemUnderTestId: 's', testEnvironment: 'acc', workload: 'load', startTime: new Date() } as never,
      10, '', [], 'changepoint',
    );

    // The runs query is floored at the change-point run's start time — bound as a
    // parameter, never interpolated into the SQL text
    const [runsSql, runsParams] = repo.query.mock.calls[1]!;
    expect(runsSql).toContain('AND tr.start_time >= $5');
    expect(runsSql).not.toContain('2026-08-14');
    expect(runsParams[4]).toEqual(new Date('2026-08-14T07:50:20.413Z'));
    expect(data!.currentRun.testRunId).toBe('run-009');
    expect(data!.currentRun.annotations).toEqual(['note']);
  });

  it('falls back to the run count when no change point has been recorded', async () => {
    const dataSource = { query: jest.fn().mockResolvedValue([]) };  // no control group / no change point
    const repo = {
      query: jest.fn().mockResolvedValue([runRow('run-009', '2026-08-18T10:00:00Z'), runRow('run-008', '2026-08-17T10:00:00Z')]),
    } as any;
    const svc = new ReportDataFetcherService(repo, authzStub, dataSource as any);

    await svc.getTrendsData(
      { testRunId: 'run-009', systemUnderTestId: 's', testEnvironment: 'acc', workload: 'load', startTime: new Date() } as never,
      5, '', [], 'changepoint',
    );

    // No floor, and the run count still caps the window (5 + the anchor run)
    const runsSql = repo.query.mock.calls[0]![0] as string;
    expect(runsSql).not.toContain('AND tr.start_time >=');
    expect(runsSql).toContain('LIMIT 6');
  });

  it('pins the window to a chosen run', async () => {
    const dataSource = { query: jest.fn() };
    const repo = {
      query: jest.fn()
        .mockResolvedValueOnce([{ start_time: '2026-08-01T00:00:00Z' }])
        .mockResolvedValueOnce([runRow('run-009', '2026-08-18T10:00:00Z'), runRow('run-008', '2026-08-17T10:00:00Z')]),
    } as any;
    const svc = new ReportDataFetcherService(repo, authzStub, dataSource as any);

    await svc.getTrendsData(
      { testRunId: 'run-009', systemUnderTestId: 's', testEnvironment: 'acc', workload: 'load', startTime: new Date() } as never,
      10, '', [], 'run-000',
    );

    // A pinned run needs no change-point lookup at all
    expect(dataSource.query).not.toHaveBeenCalled();
    const [pinnedSql, pinnedParams] = repo.query.mock.calls[1]!;
    expect(pinnedSql).toContain('AND tr.start_time >= $5');
    expect(pinnedParams[4]).toEqual(new Date('2026-08-01T00:00:00Z'));
  });
});

describe('ReportDataFetcherService.getMetricTrends', () => {
  it('answers URL panels from the sampler rollup and the aggregate from the run-wide rollup', async () => {
    const statsRows = [
      { test_run_id: 'r1', dashboard_label: 'Perf', panel_title: 'Transaction RT Avg', panel_id: 101, metric_name: 'T01', unit: 'ms', source_type: 'performance_test', mean: 100, q95: 200, q99: 300 },
      { test_run_id: 'r2', dashboard_label: 'Perf', panel_title: 'Transaction RT Avg', panel_id: 101, metric_name: 'T01', unit: 'ms', source_type: 'performance_test', mean: 110, q95: 210, q99: 310 },
    ];
    const dataSource = { query: jest.fn().mockResolvedValue(statsRows) };
    const repo = {
      query: jest.fn()
        // URL rollup for both runs
        .mockResolvedValueOnce([
          { test_run_id: 'r1', normalized_url: '/checkout', avg_response_time: '120', p95: '200', p99: '300', avg_latency: '10', avg_connect_time: '5', error_percentage: '1', throughput: '9' },
          { test_run_id: 'r2', normalized_url: '/checkout', avg_response_time: '150', p95: '250', p99: '350', avg_latency: '12', avg_connect_time: '6', error_percentage: '2', throughput: '8' },
        ])
        // run-wide transaction aggregate per run
        .mockResolvedValueOnce([
          { test_run_id: 'r1', avg: '100', pct: '200' },
          { test_run_id: 'r2', avg: '130', pct: '260' },
        ]),
    } as any;
    const svc = new ReportDataFetcherService(repo, authzStub, dataSource as any);

    const series = await svc.getMetricTrends(['r1', 'r2'], [
      { dashboardLabel: 'Perf', panelId: 101, metricNames: ['T01', 'All aggregated'] },
      { dashboardLabel: 'Perf', panelId: 210 },  // URL RT
    ]);

    const byName = Object.fromEntries(series.map((s) => [s.metricName, s]));
    // Stored per-series row, renamed to the spelled-out panel
    expect(byName['T01']!.panelTitle).toBe('Transaction Response Times');
    expect(byName['T01']!.valuesByRun).toEqual({ r1: 100, r2: 110 });
    // URL series comes from the sampler rollup, not the statistics
    expect(byName['/checkout']!.panelTitle).toBe('URL Response Times');
    expect(byName['/checkout']!.valuesByRun).toEqual({ r1: 120, r2: 150 });
    // The aggregate is the whole run rolled up, per run
    expect(byName['All aggregated']!.valuesByRun).toEqual({ r1: 100, r2: 130 });
  });

  it('renames response-time panels for performance metrics only — panel ids collide across sources', async () => {
    const rows = [
      // Same panel id, different sources: only the perf-test one is renamed
      { test_run_id: 'r1', dashboard_label: 'Perf', panel_title: 'Transaction RT Avg', panel_id: 101, metric_name: 'T01', unit: 'ms', source_type: 'performance_test', mean: 1, q95: 1, q99: 1 },
      { test_run_id: 'r1', dashboard_label: 'JVM', panel_title: 'Heap used', panel_id: 101, metric_name: 'used', unit: 'bytes', source_type: 'grafana', mean: 2, q95: 2, q99: 2 },
    ];
    const dataSource = { query: jest.fn().mockResolvedValue(rows) };
    const svc = new ReportDataFetcherService({ query: jest.fn() } as any, authzStub, dataSource as any);

    const series = await svc.getMetricTrends(['r1'], [
      { dashboardLabel: 'Perf' }, { dashboardLabel: 'JVM' },
    ]);

    const titles = Object.fromEntries(series.map((s) => [s.dashboardLabel, s.panelTitle]));
    expect(titles['Perf']).toBe('Transaction Response Times');
    expect(titles['JVM']).toBe('Heap used');
  });

  it('returns nothing when the section selected nothing', async () => {
    const dataSource = { query: jest.fn() };
    const repo = { query: jest.fn() } as any;
    const svc = new ReportDataFetcherService(repo, authzStub, dataSource as any);

    expect(await svc.getMetricTrends(['r1'], [])).toEqual([]);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('applies the run count as well as the change-point floor', async () => {
    // The floor used to replace the run count with a flat 51. That was survivable
    // while a floor required an explicit choice; once the change-point window
    // became the default it made every template's configured run count dead and
    // quietly pulled up to 50 runs through the percentile LATERAL.
    const dataSource = { query: jest.fn().mockResolvedValue([{ test_run_id: 'run-005' }]) };
    const repo = {
      query: jest.fn()
        .mockResolvedValueOnce([{ start_time: '2026-08-14T07:50:20.413Z' }])
        .mockResolvedValueOnce([runRow('run-009', '2026-08-18T10:00:00Z')]),
    } as any;
    const svc = new ReportDataFetcherService(repo, authzStub, dataSource as any);

    await svc.getTrendsData(
      { testRunId: 'run-009', systemUnderTestId: 's', testEnvironment: 'e', workload: 'w', startTime: new Date('2026-08-18T10:00:00Z') } as any,
      10, '', [], 'changepoint',
    );

    // The windowed query is the second repo call; the first resolved the floor.
    const windowedSql = repo.query.mock.calls[1][0] as string;
    expect(windowedSql).toContain('LIMIT 11');
    expect(windowedSql).not.toContain('LIMIT 51');
    // ...and the floor is still applied.
    expect(windowedSql).toContain('tr.start_time >=');
  });
});