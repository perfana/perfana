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
