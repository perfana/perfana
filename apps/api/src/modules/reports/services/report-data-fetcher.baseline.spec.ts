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

  it.each([
    [201, 'Request RT Avg'],
    [206, 'Request Throughput'],
  ])('attaches the normalized URL to request rows on panel %i', async (panelId, panelTitle) => {
    // 205-209 name their series `transaction.sampler` exactly like the RT panels, so a
    // throughput or error-rate comparison gets the URL too — it used to stop at 204.
    const rows = [
      { test_run_id: 'cur', dashboard_label: 'Perf', panel_title: panelTitle, panel_id: panelId, metric_name: 'checkout.login', mean: 110, q95: 220, q99: 300, unit: 'ms' },
      { test_run_id: 'base', dashboard_label: 'Perf', panel_title: panelTitle, panel_id: panelId, metric_name: 'checkout.login', mean: 100, q95: 200, q99: 250, unit: 'ms' },
    ];
    const dataSource = { query: jest.fn().mockResolvedValue(rows) };
    const testRunRepo = { query: jest.fn().mockResolvedValue([
      { metric_name: 'checkout.login', normalized_url: 'https://shop.example.com/api/v1/login' },
    ]) } as any;
    const svc = new ReportDataFetcherService(testRunRepo, authzStub, dataSource as any);
    const data = await svc.getBaselineRunComparison('cur', 'base', 'performance-metrics',
      { metrics: ['avg'], userId: '', roles: [], selections: [{ dashboardLabel: 'Perf', panelId }] });
    expect(data!.rows[0]!.url).toBe('https://shop.example.com/api/v1/login');
    expect(testRunRepo.query.mock.calls[0]![0]).toContain('test_run_sampler_stats');
  });

  it('still renders the comparison when the sampler URL lookup fails', async () => {
    // A missing URL is cosmetic; losing the whole comparison because the sampler
    // rollup query failed would not be.
    const rows = [
      { test_run_id: 'cur', dashboard_label: 'Perf', panel_title: 'Request RT Avg', panel_id: 201, metric_name: 'checkout.login', mean: 110, q95: 220, q99: 300, unit: 'ms' },
      { test_run_id: 'base', dashboard_label: 'Perf', panel_title: 'Request RT Avg', panel_id: 201, metric_name: 'checkout.login', mean: 100, q95: 200, q99: 250, unit: 'ms' },
    ];
    const dataSource = { query: jest.fn().mockResolvedValue(rows) };
    const testRunRepo = { query: jest.fn().mockRejectedValue(new Error('sampler stats unavailable')) } as any;
    const svc = new ReportDataFetcherService(testRunRepo, authzStub, dataSource as any);
    const data = await svc.getBaselineRunComparison('cur', 'base', 'performance-metrics',
      { metrics: ['avg'], userId: '', roles: [], selections: [{ dashboardLabel: 'Perf', panelId: 201 }] });
    expect(data!.rows).toHaveLength(1);
    expect(data!.rows[0]!.url).toBeUndefined();
    expect(data!.rows[0]!.metrics[0]!.diffPercent).toBeCloseTo(10);
  });

  it('leaves non-request rows without a URL and does not query the sampler map', async () => {
    const rows = [
      { test_run_id: 'cur', dashboard_label: 'Perf', panel_title: 'Transaction RT Avg', panel_id: 101, metric_name: 'T01_Checkout', mean: 110, q95: 220, q99: 300, unit: 'ms' },
      { test_run_id: 'base', dashboard_label: 'Perf', panel_title: 'Transaction RT Avg', panel_id: 101, metric_name: 'T01_Checkout', mean: 100, q95: 200, q99: 250, unit: 'ms' },
    ];
    const dataSource = { query: jest.fn().mockResolvedValue(rows) };
    const testRunRepo = { query: jest.fn() } as any;
    const svc = new ReportDataFetcherService(testRunRepo, authzStub, dataSource as any);
    const data = await svc.getBaselineRunComparison('cur', 'base', 'performance-metrics',
      { metrics: ['avg'], userId: '', roles: [], selections: [{ dashboardLabel: 'Perf', panelId: 101 }] });
    expect(data!.rows[0]!.url).toBeUndefined();
    expect(testRunRepo.query).not.toHaveBeenCalled();
  });

  it('pairs ds_metric_statistics rows by dashboard/panel/metric (grafana)', async () => {
    const rows = [
      { test_run_id: 'cur', dashboard_label: 'JVM', panel_title: 'Heap', panel_id: 3, metric_name: 'used', mean: 110, q95: 220, q99: 300, unit: 'bytes' },
      { test_run_id: 'base', dashboard_label: 'JVM', panel_title: 'Heap', panel_id: 3, metric_name: 'used', mean: 100, q95: 200, q99: 250, unit: 'bytes' },
    ];
    const dataSource = { query: jest.fn().mockResolvedValue(rows) };
    const svc = new ReportDataFetcherService(repoStub, authzStub, dataSource as any);
    const data = await svc.getBaselineRunComparison('cur', 'base', 'grafana',
      { metrics: ['avg', 'p95'], userId: 'u', roles: [] });
    const row = data!.rows[0]!;
    expect(row.group).toBe('JVM / Heap');
    expect(row.metrics.find(m => m.key === 'avg')!.diffPercent).toBeCloseTo(10);
  });

  it('scopes the SQL to the selected dashboard and filters current rows by panel ids', async () => {
    const rows = [
      // selected panel 3 — kept
      { test_run_id: 'cur', dashboard_label: 'JVM', panel_title: 'Heap', panel_id: 3, metric_name: 'used', mean: 110, q95: 220, q99: 300, unit: 'bytes' },
      // panel 99 not selected — dropped from output
      { test_run_id: 'cur', dashboard_label: 'JVM', panel_title: 'Threads', panel_id: 99, metric_name: 'count', mean: 5, q95: 6, q99: 7, unit: '' },
      // baseline pairs by TITLE even when its panel id differs (mapped dashboards can renumber panels)
      { test_run_id: 'base', dashboard_label: 'JVM', panel_title: 'Heap', panel_id: 1234, metric_name: 'used', mean: 100, q95: 200, q99: 250, unit: 'bytes' },
    ];
    const dataSource = { query: jest.fn().mockResolvedValue(rows) };
    const svc = new ReportDataFetcherService(repoStub, authzStub, dataSource as any);
    const data = await svc.getBaselineRunComparison('cur', 'base', 'grafana',
      { metrics: ['avg'], userId: 'u', roles: [], selections: [{ dashboardLabel: 'JVM', panelId: 3 }] });
    const [sql, params] = dataSource.query.mock.calls[0]!;
    // Real column is metrics_sources.source_type — `ms.type` blew up against the live DB
    expect(sql).toContain('ms.source_type = $2');
    expect(sql).not.toContain('ms.type =');
    expect(sql).toContain('s.dashboard_label = ANY($3)');
    // Panel filter is applied in JS to the CURRENT run only — the baseline
    // dashboard may use different panel ids; pairing is by panel title.
    // (s.panel_id may appear in the SELECT list, but never as a WHERE filter.)
    expect(sql).not.toContain('s.panel_id =');
    expect(sql).not.toContain('s.panel_id IN');
    expect(params).toEqual([['cur', 'base'], 'grafana', ['JVM']]);
    expect(data!.rows).toHaveLength(1);
    expect(data!.rows[0]!.label).toBe('used');
    expect(data!.rows[0]!.metrics[0]!.diffPercent).toBeCloseTo(10);
  });

  it('scopes the SQL to every selected dashboard and keeps only the selected series', async () => {
    const rows = [
      { test_run_id: 'cur', dashboard_label: 'JVM', panel_title: 'Heap', panel_id: 3, metric_name: 'used', mean: 110, q95: 220, q99: 300, unit: 'bytes' },
      // same panel, series not selected — dropped
      { test_run_id: 'cur', dashboard_label: 'JVM', panel_title: 'Heap', panel_id: 3, metric_name: 'committed', mean: 9, q95: 9, q99: 9, unit: 'bytes' },
      // second dashboard, no panel selection on it — every panel is in scope
      { test_run_id: 'cur', dashboard_label: 'Docker', panel_title: 'CPU', panel_id: 8, metric_name: 'cpu', mean: 20, q95: 30, q99: 40, unit: '%' },
      { test_run_id: 'base', dashboard_label: 'JVM', panel_title: 'Heap', panel_id: 3, metric_name: 'used', mean: 100, q95: 200, q99: 250, unit: 'bytes' },
      { test_run_id: 'base', dashboard_label: 'Docker', panel_title: 'CPU', panel_id: 8, metric_name: 'cpu', mean: 10, q95: 20, q99: 30, unit: '%' },
    ];
    const dataSource = { query: jest.fn().mockResolvedValue(rows) };
    const svc = new ReportDataFetcherService(repoStub, authzStub, dataSource as any);
    const data = await svc.getBaselineRunComparison('cur', 'base', 'grafana', {
      metrics: ['avg'], userId: 'u', roles: [],
      selections: [
        { dashboardLabel: 'JVM', panelId: 3, metricNames: ['used'] },
        { dashboardLabel: 'Docker' },
      ],
    });
    const [, params] = dataSource.query.mock.calls[0]!;
    expect(params).toEqual([['cur', 'base'], 'grafana', ['JVM', 'Docker']]);
    expect(data!.rows.map((r) => r.label)).toEqual(['used', 'cpu']);
  });

  it('compares selected performance-metrics dashboards from the rollups, not the transactions table', async () => {
    const rows = [
      { test_run_id: 'cur', dashboard_label: 'Performance test metrics Checkout', panel_title: 'Response times', panel_id: 1, metric_name: 'T05', mean: 110, q95: 220, q99: 300, unit: 'ms' },
      { test_run_id: 'base', dashboard_label: 'Performance test metrics Checkout', panel_title: 'Response times', panel_id: 1, metric_name: 'T05', mean: 100, q95: 200, q99: 250, unit: 'ms' },
    ];
    const dataSource = { query: jest.fn().mockResolvedValue(rows) };
    const repo = { query: jest.fn() } as any;
    const svc = new ReportDataFetcherService(repo, authzStub, dataSource as any);

    const data = await svc.getBaselineRunComparison('cur', 'base', 'performance-metrics', {
      metrics: ['avg'], userId: 'u', roles: [],
      selections: [{ dashboardLabel: 'Performance test metrics Checkout' }],
    });

    // The transactions query never runs — the rollups answer it
    expect(repo.query).not.toHaveBeenCalled();
    const [, params] = dataSource.query.mock.calls[0]!;
    expect(params[1]).toBe('performance_test');
    expect(data!.rows[0]!.dashboardLabel).toBe('Performance test metrics Checkout');
    expect(data!.rows[0]!.metrics[0]!.diffPercent).toBeCloseTo(10);
  });

  it('still compares transactions when no dashboard is selected', async () => {
    const rows = [
      { test_run_id: 'cur', scenario_name: 'checkout', transaction_name: 'login', avg_ms: '110', p90_ms: null, p95_ms: null, p99_ms: null },
      { test_run_id: 'base', scenario_name: 'checkout', transaction_name: 'login', avg_ms: '100', p90_ms: null, p95_ms: null, p99_ms: null },
    ];
    const repo = { query: jest.fn().mockResolvedValue(rows) } as any;
    const dataSource = { query: jest.fn() };
    const svc = new ReportDataFetcherService(repo, authzStub, dataSource as any);

    const data = await svc.getBaselineRunComparison('cur', 'base', 'performance-metrics',
      { metrics: ['avg'], userId: '', roles: [] });

    expect(dataSource.query).not.toHaveBeenCalled();
    expect(data!.rows[0]!.group).toBe('checkout');
    expect(data!.rows[0]!.dashboardLabel).toBeUndefined();
  });

  it('compares URL panels from the sampler rollup, and only URL RT carries percentiles', async () => {
    const urlRows = [
      { test_run_id: 'cur', normalized_url: '/checkout', avg_response_time: '120', p90: '200', p95: '250', p99: '400',
        avg_latency: '30', avg_connect_time: '5', error_percentage: '2.5', throughput: '10' },
      { test_run_id: 'base', normalized_url: '/checkout', avg_response_time: '100', p90: '150', p95: '200', p99: '300',
        avg_latency: '20', avg_connect_time: '4', error_percentage: '1.25', throughput: '8' },
    ];
    const repo = { query: jest.fn().mockResolvedValue(urlRows) } as any;
    const dataSource = { query: jest.fn() };
    const svc = new ReportDataFetcherService(repo, authzStub, dataSource as any);

    const data = await svc.getBaselineRunComparison('cur', 'base', 'performance-metrics', {
      metrics: ['avg', 'p95'], userId: '', roles: [],
      selections: [
        { dashboardLabel: 'Performance test metrics Checkout', panelId: 210 },  // URL RT
        { dashboardLabel: 'Performance test metrics Checkout', panelId: 214 },  // URL Error Rate
      ],
    });

    // Sampler rollup, not ds_metric_statistics
    expect(dataSource.query).not.toHaveBeenCalled();
    expect(repo.query.mock.calls[0]![0]).toContain('test_run_sampler_stats');

    const rt = data!.rows.find((r) => r.panelTitle === 'URL Response Times')!;
    expect(rt.label).toBe('/checkout');
    expect(rt.metrics.find((m) => m.key === 'avg')!.diffPercent).toBeCloseTo(20);
    expect(rt.metrics.find((m) => m.key === 'p95')!.diffPercent).toBeCloseTo(25);

    // An error rate is one number per URL — the percentile column stays empty rather
    // than repeating the average
    const errors = data!.rows.find((r) => r.panelTitle === 'URL Error Rate')!;
    expect(errors.metrics.find((m) => m.key === 'avg')!.current).toBe(2.5);
    expect(errors.metrics.find((m) => m.key === 'p95')!.current).toBeNull();
  });

  it('keeps a URL panel and a statistics panel in the same comparison', async () => {
    const statsRows = [
      { test_run_id: 'cur', dashboard_label: 'Perf', panel_title: 'Transaction RT Avg', panel_id: 101, metric_name: 'T01', mean: 110, q95: 220, q99: 300, unit: 'ms' },
      { test_run_id: 'base', dashboard_label: 'Perf', panel_title: 'Transaction RT Avg', panel_id: 101, metric_name: 'T01', mean: 100, q95: 200, q99: 250, unit: 'ms' },
    ];
    const urlRows = [
      { test_run_id: 'cur', normalized_url: '/checkout', avg_response_time: '120', p90: null, p95: null, p99: null,
        avg_latency: null, avg_connect_time: null, error_percentage: null, throughput: null },
    ];
    const repo = { query: jest.fn().mockResolvedValue(urlRows) } as any;
    const dataSource = { query: jest.fn().mockResolvedValue(statsRows) };
    const svc = new ReportDataFetcherService(repo, authzStub, dataSource as any);

    const data = await svc.getBaselineRunComparison('cur', 'base', 'performance-metrics', {
      metrics: ['avg'], userId: '', roles: [],
      selections: [
        { dashboardLabel: 'Perf', panelId: 101 },
        { dashboardLabel: 'Perf', panelId: 210 },
      ],
    });

    // Stored titles name the statistic; the report names the panel once, spelled out
    expect(data!.rows.map((r) => r.panelTitle)).toEqual(['Transaction Response Times', 'URL Response Times']);
  });

  it('names the four per-percentile RT panels once, spelled out', async () => {
    const rows = [
      { test_run_id: 'cur', dashboard_label: 'Perf', panel_title: 'Transaction RT Avg', panel_id: 101, metric_name: 'T01', mean: 110, q95: 220, q99: 300, unit: 'ms' },
      { test_run_id: 'cur', dashboard_label: 'Perf', panel_title: 'Request RT P95', panel_id: 203, metric_name: 'R01', mean: 60, q95: 90, q99: 120, unit: 'ms' },
      { test_run_id: 'cur', dashboard_label: 'Perf', panel_title: 'Transaction Error Rate', panel_id: 105, metric_name: 'T01', mean: 1, q95: 2, q99: 3, unit: 'percent' },
      { test_run_id: 'base', dashboard_label: 'Perf', panel_title: 'Transaction RT Avg', panel_id: 101, metric_name: 'T01', mean: 100, q95: 200, q99: 250, unit: 'ms' },
    ];
    const dataSource = { query: jest.fn().mockResolvedValue(rows) };
    const svc = new ReportDataFetcherService(repoStub, authzStub, dataSource as any);

    const data = await svc.getBaselineRunComparison('cur', 'base', 'performance-metrics', {
      metrics: ['avg'], userId: 'u', roles: [],
      selections: [{ dashboardLabel: 'Perf' }],
    });

    expect(data!.rows.map((r) => r.panelTitle)).toEqual([
      'Transaction Response Times',
      'Request Response Times',
      'Transaction Error Rate',   // panels that are not response times keep their stored title
    ]);
  });

  it('answers the "All aggregated" series from the run-wide rollup, not the per-series rows', async () => {
    const statsRows = [
      { test_run_id: 'cur', dashboard_label: 'Perf', panel_title: 'Transaction RT Avg', panel_id: 101, metric_name: 'login', mean: 110, q95: 220, q99: 300, unit: 'ms' },
      { test_run_id: 'base', dashboard_label: 'Perf', panel_title: 'Transaction RT Avg', panel_id: 101, metric_name: 'login', mean: 100, q95: 200, q99: 250, unit: 'ms' },
    ];
    const dataSource = { query: jest.fn().mockResolvedValue(statsRows) };
    const repo = { query: jest.fn()
      .mockResolvedValueOnce([{ avg: '150', p90: null, p95: '250', p99: '300', pass: '1', fail: '0' }])  // current
      .mockResolvedValueOnce([{ avg: '120', p90: null, p95: '200', p99: '250', pass: '1', fail: '0' }]) } as any; // baseline
    const svc = new ReportDataFetcherService(repo, authzStub, dataSource as any);

    const data = await svc.getBaselineRunComparison('cur', 'base', 'performance-metrics', {
      metrics: ['avg'], userId: '', roles: [],
      selections: [{ dashboardLabel: 'Perf', panelId: 101, metricNames: ['All aggregated', 'login'] }],
    });

    const agg = data!.rows.find((r) => r.label === 'All aggregated')!;
    expect(agg.panelTitle).toBe('Transaction Response Times');
    expect(agg.metrics[0]!.current).toBe(150);
    expect(agg.metrics[0]!.diffPercent).toBeCloseTo(25);
    // The sentinel is stripped before the per-series query, which still returns 'login'
    expect(data!.rows.some((r) => r.label === 'login')).toBe(true);
  });

  it('runs no per-series query for a panel that asked only for the aggregate', async () => {
    const dataSource = { query: jest.fn() };
    const repo = { query: jest.fn().mockResolvedValue([{ avg: '10', p90: null, p95: null, p99: null, pass: '1', fail: '0' }]) } as any;
    const svc = new ReportDataFetcherService(repo, authzStub, dataSource as any);

    const data = await svc.getBaselineRunComparison('cur', 'base', 'performance-metrics', {
      metrics: ['avg'], userId: '', roles: [],
      selections: [{ dashboardLabel: 'Perf', panelId: 201, metricNames: ['All aggregated'] }],
    });

    expect(dataSource.query).not.toHaveBeenCalled();
    expect(data!.rows).toHaveLength(1);
    expect(data!.rows[0]!.panelTitle).toBe('Request Response Times');
  });

  it('omits dashboard/panel filters when not configured', async () => {
    const dataSource = { query: jest.fn().mockResolvedValue([]) };
    const svc = new ReportDataFetcherService(repoStub, authzStub, dataSource as any);
    await svc.getBaselineRunComparison('cur', 'base', 'grafana',
      { metrics: ['avg'], userId: 'u', roles: [] });
    const [sql, params] = dataSource.query.mock.calls[0]!;
    expect(sql).not.toContain('s.dashboard_label =');
    expect(params).toEqual([['cur', 'base'], 'grafana']);
  });

  it('pairs across dashboards via dashboardMap and widens the SQL scope to the mapped label', async () => {
    const rows = [
      { test_run_id: 'cur', dashboard_label: 'JVM (acc)', panel_title: 'Heap', panel_id: 3, metric_name: 'used', mean: 110, q95: 220, q99: 300, unit: 'bytes' },
      { test_run_id: 'base', dashboard_label: 'JVM (prod)', panel_title: 'Heap', panel_id: 3, metric_name: 'used', mean: 100, q95: 200, q99: 250, unit: 'bytes' },
    ];
    const dataSource = { query: jest.fn().mockResolvedValue(rows) };
    const svc = new ReportDataFetcherService(repoStub, authzStub, dataSource as any);
    const data = await svc.getBaselineRunComparison('cur', 'base', 'grafana',
      {
        metrics: ['avg'], userId: 'u', roles: [],
        selections: [{ dashboardLabel: 'JVM (acc)' }],
        dashboardMap: [{ current: 'JVM (acc)', baseline: 'JVM (prod)' }],
      });
    const [, params] = dataSource.query.mock.calls[0]!;
    // Both labels must survive the SQL scope filter or the baseline rows never arrive
    expect(params).toEqual([['cur', 'base'], 'grafana', ['JVM (acc)', 'JVM (prod)']]);
    const row = data!.rows[0]!;
    expect(row.group).toBe('JVM (acc) / Heap');
    expect(row.metrics[0]!.diffPercent).toBeCloseTo(10);
  });

  it('applies dashboardMap for dynatrace pairing too', async () => {
    const rows = [
      { test_run_id: 'cur', dashboard_label: 'Hosts acc', panel_title: 'CPU', panel_id: 1, metric_name: 'builtin:host.cpu.usage', mean: 60, q95: 80, q99: 90, unit: '%' },
      { test_run_id: 'base', dashboard_label: 'Hosts prod', panel_title: 'CPU', panel_id: 1, metric_name: 'builtin:host.cpu.usage', mean: 50, q95: 70, q99: 85, unit: '%' },
    ];
    const dataSource = { query: jest.fn().mockResolvedValue(rows) };
    const svc = new ReportDataFetcherService(repoStub, authzStub, dataSource as any);
    const data = await svc.getBaselineRunComparison('cur', 'base', 'dynatrace',
      { metrics: ['avg'], userId: 'u', roles: [], dashboardMap: [{ current: 'Hosts acc', baseline: 'Hosts prod' }] });
    const row = data!.rows[0]!;
    expect(row.metrics[0]!.diffPercent).toBeCloseTo(20);
  });

  it('groups dynatrace rows by the leading dt.entity id prefix (real worker encoding)', async () => {
    // Worker DataProcessor stores dynatrace series as `{dt.entity.* id}_{metric}`,
    // e.g. HOST-0A1B2C3D4E5F6789_cpu.usage — NOT host-as-last-dotted-segment.
    const rows = [
      { test_run_id: 'cur', dashboard_label: 'Hosts', panel_title: 'CPU', panel_id: 1, metric_name: 'HOST-0A1B2C3D4E5F6789_builtin:host.cpu.usage', mean: 60, q95: 80, q99: 90, unit: '%' },
      { test_run_id: 'base', dashboard_label: 'Hosts', panel_title: 'CPU', panel_id: 1, metric_name: 'HOST-0A1B2C3D4E5F6789_builtin:host.cpu.usage', mean: 50, q95: 70, q99: 85, unit: '%' },
    ];
    const dataSource = { query: jest.fn().mockResolvedValue(rows) };
    const svc = new ReportDataFetcherService(repoStub, authzStub, dataSource as any);
    const data = await svc.getBaselineRunComparison('cur', 'base', 'dynatrace',
      { metrics: ['avg'], userId: 'u', roles: [] });
    const row = data!.rows[0]!;
    expect(row.group).toBe('HOST-0A1B2C3D4E5F6789');
    expect(row.metrics[0]!.diffPercent).toBeCloseTo(20);
  });
});
