import { ReportDataFetcherService } from './report-data-fetcher.service';

/**
 * The Comparisons section's control-group baseline: this run's `ds_metric_statistics` against
 * the pooled `ds_control_group_statistics` anomaly detection compares it with.
 */
const DASH = '3f8b1c7e-2a4d-4e6f-9b1a-7c2d5e8f0a13';
const OTHER_DASH = '7e2a9c4b-1d3f-4a5e-8b6c-0d9e8f7a6b5c';

// A global admin, so resolveOrgFilter adds no clause and the `$n` assertions stay stable;
// the tenant case below swaps it for a scoped user.
const adminAuthz = { isGlobalAdmin: () => true } as never;

const currentRow = (over: Record<string, unknown> = {}) => ({
  application_dashboard_id: DASH,
  dashboard_label: 'Kubernetes',
  panel_title: 'CPU',
  panel_id: 4,
  metric_name: 'api',
  unit: 'percent',
  mean: 55,
  q90: 70,
  q95: 80,
  q99: 95,
  ...over,
});

const controlRow = (over: Record<string, unknown> = {}) => ({
  application_dashboard_id: DASH,
  panel_id: 4,
  panel_title: 'CPU',
  dashboard_label: 'Kubernetes',
  metric_name: 'api',
  unit: 'percent',
  metrics_source_id: null,
  mean: 50,
  median: 48,
  min_value: 10,
  max_value: 99,
  q90: 64,
  q95: 75,
  q99: 90,
  count: 120,
  ...over,
});

/** Answers by statement so the order of reads does not matter to the test. */
function dataSourceAnswering(current: unknown[], control: unknown[]) {
  return {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('report:control-group-comparison')) return current;
      if (sql.includes('control-group:statistics')) return control;
      return [];
    }),
  };
}

describe('ReportDataFetcherService.getControlGroupComparison', () => {
  it('pairs each current series with its pooled control row by dashboard id, panel and name', async () => {
    const dataSource = dataSourceAnswering(
      [
        currentRow(),
        // Same label and panel but on another dashboard: must NOT pair with the control row
        // for DASH, which a label-based pairing would have done.
        currentRow({ application_dashboard_id: OTHER_DASH, metric_name: 'api' }),
      ],
      [controlRow()],
    );
    const svc = new ReportDataFetcherService({ query: jest.fn() } as never, adminAuthz, dataSource as never);

    const data = await svc.getControlGroupComparison('run-7', 'run-7', 'grafana',
      { metrics: ['avg', 'p95'], userId: 'u', roles: [] });

    expect(data!.rows).toHaveLength(2);
    const [paired, unpaired] = data!.rows;
    expect(paired!.metrics).toEqual([
      { key: 'avg', current: 55, baseline: 50, diffPercent: 10 },
      { key: 'p95', current: 80, baseline: 75, diffPercent: expect.closeTo(6.667, 2) },
    ]);
    expect(paired!.group).toBe('Kubernetes / CPU');
    // A series the control group never pooled keeps its row with an empty baseline.
    expect(unpaired!.metrics.every((m) => m.baseline === null && m.diffPercent === null)).toBe(true);

    const [sql, params] = dataSource.query.mock.calls.find(([q]) => q.includes('report:control-group-comparison'))!;
    expect(sql).toMatch(/FROM ds_metric_statistics s/);
    expect(sql).toMatch(/s\.test_run_id = \$1/);
    expect(params).toEqual(['run-7', 'grafana']);
    const [, controlParams] = dataSource.query.mock.calls.find(([q]) => q.includes('control-group:statistics'))!;
    expect(controlParams).toEqual(['run-7']);
  });

  it('reads Transaction RT Avg per transaction for a performance-metrics section with no selection', async () => {
    const dataSource = dataSourceAnswering(
      [currentRow({ dashboard_label: 'Performance test metrics Checkout', panel_title: 'Transaction RT Avg', panel_id: 101, metric_name: 'login', unit: 'ms' })],
      [controlRow({ panel_id: 101, metric_name: 'login', unit: 'ms', mean: 100 })],
    );
    const svc = new ReportDataFetcherService({ query: jest.fn() } as never, adminAuthz, dataSource as never);

    const data = await svc.getControlGroupComparison('run-7', 'run-7', 'performance-metrics',
      { metrics: ['avg'], userId: '', roles: [] });

    const [sql, params] = dataSource.query.mock.calls.find(([q]) => q.includes('report:control-group-comparison'))!;
    expect(sql).toMatch(/s\.panel_id = ANY\(\$3::int\[\]\)/);
    expect(params).toEqual(['run-7', 'performance_test', [101]]);
    // Not the raw `transactions` scan the run-vs-run default uses.
    expect(dataSource.query.mock.calls.some(([q]) => /FROM transactions/.test(q))).toBe(false);
    expect(data!.rows[0]!.panelTitle).toBe('Transaction Response Times');
    expect(data!.rows[0]!.metrics[0]).toEqual({ key: 'avg', current: 55, baseline: 100, diffPercent: -45 });
  });

  it('lists the synthetic aggregate and the URL panels with the current value only', async () => {
    const dataSource = dataSourceAnswering(
      [currentRow({ dashboard_label: 'Perf', panel_id: 201, panel_title: 'Request RT Avg', metric_name: 'checkout.login', unit: 'ms' })],
      [controlRow({ panel_id: 201, metric_name: 'checkout.login', unit: 'ms' })],
    );
    const testRunRepo = {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes('FROM test_run_sampler_stats s') && sql.includes('normalized_url') && sql.includes('rollup')) {
          // getUrlComparison: asked for the current run alone.
          expect(params[0]).toEqual(['run-7']);
          return [{ test_run_id: 'run-7', normalized_url: '/api/login', avg_response_time: '80', p90: '90', p95: '95', p99: '99',
            avg_latency: null, avg_connect_time: null, error_percentage: null, throughput: null }];
        }
        return [];
      }),
    };
    const svc = new ReportDataFetcherService(testRunRepo as never, adminAuthz, dataSource as never);
    const aggregated = jest.spyOn(svc as never as { getAggregatedScalars: () => unknown }, 'getAggregatedScalars')
      .mockResolvedValue({ avg: 70, p90: 80, p95: 90, p99: 99 } as never);

    const data = await svc.getControlGroupComparison('run-7', 'run-7', 'performance-metrics', {
      metrics: ['avg'],
      userId: '',
      roles: [],
      selections: [
        { dashboardLabel: 'Perf', panelId: 101, metricNames: ['All aggregated'] },
        { dashboardLabel: 'Perf', panelId: 201, metricNames: ['checkout.login'] },
        { dashboardLabel: 'Perf', panelId: 210 },
      ],
    });

    // The aggregate is read for the current run only: there is no baseline run to read.
    expect(aggregated).toHaveBeenCalledTimes(1);
    expect(aggregated.mock.calls[0]![0]).toBe('run-7');
    const labels = data!.rows.map((r) => [r.label, r.metrics[0]!.baseline]);
    expect(labels).toEqual([
      ['All aggregated', null],
      ['checkout.login', 50],
      ['/api/login', null],
    ]);
  });

  /**
   * Value: protects=a section that picked only unpooled series reads no statistics and is an empty comparison;
   * fails_when=the early return goes and the emptied selection reads as "no selection", an unscoped read of every statistic;
   * why_new=the existing unpooled case also picks a pooled panel, so the emptied-selection branch never runs; seam=none;
   * no_claim=the URL rows' own values, which the case above already pins.
   */
  it('reads no statistics when every selected series is one ADAPT does not pool', async () => {
    // A statistics row that an unscoped read would happily return and pair.
    const dataSource = dataSourceAnswering([currentRow()], [controlRow()]);
    const testRunRepo = {
      query: jest.fn(async (sql: string) => (sql.includes('FROM test_run_sampler_stats s') && sql.includes('normalized_url')
        ? [{ test_run_id: 'run-7', normalized_url: '/api/login', avg_response_time: '80', p90: '90', p95: '95', p99: '99',
          avg_latency: null, avg_connect_time: null, error_percentage: null, throughput: null }]
        : [])),
    };
    const svc = new ReportDataFetcherService(testRunRepo as never, adminAuthz, dataSource as never);
    jest.spyOn(svc as never as { getAggregatedScalars: () => unknown }, 'getAggregatedScalars')
      .mockResolvedValue({ avg: 70, p90: 80, p95: 90, p99: 99 } as never);

    const data = await svc.getControlGroupComparison('run-7', 'run-7', 'performance-metrics', {
      metrics: ['avg'],
      userId: '',
      roles: [],
      selections: [
        { dashboardLabel: 'Perf', panelId: 101, metricNames: ['All aggregated'] },
        { dashboardLabel: 'Perf', panelId: 210 },
      ],
    });

    // Nothing in it has a baseline, so it is an empty comparison (the renderer explains why),
    // not two current-only rows the section would count as "within range".
    expect(data).toEqual({ source: 'performance-metrics', rows: [] });
    expect(dataSource.query.mock.calls.some(([q]) => q.includes('report:control-group-comparison'))).toBe(false);
    expect(dataSource.query.mock.calls.some(([q]) => q.includes('control-group:statistics'))).toBe(false);
  });

  it('answers an empty list, not baseline-less rows, when the group has nothing to pair with', async () => {
    // The group's pooled statistics were never written (control-group-statistics timed out),
    // or hold another source: every row would read "vs –" and count as within range.
    const dataSource = dataSourceAnswering([currentRow()], [controlRow({ application_dashboard_id: OTHER_DASH })]);
    const svc = new ReportDataFetcherService({ query: jest.fn() } as never, adminAuthz, dataSource as never);

    const data = await svc.getControlGroupComparison('run-7', 'run-7', 'grafana',
      { metrics: ['avg'], userId: 'u', roles: [] });

    expect(data).toEqual({ source: 'grafana', rows: [] });
  });

  // Value: protects=a series whose metrics source changed since the group's runs gets no baseline, as ADAPT calls it incomparable; fails_when=the pairing key drops metrics_source_id; why_new=every other case uses one source; seam=none; no_claim=ADAPT's own join, which lives in the worker.
  it('pairs on the metrics source too, as ADAPT does', async () => {
    const dataSource = dataSourceAnswering(
      [currentRow({ metrics_source_id: 'src-new' }), currentRow({ metric_name: 'web', metrics_source_id: 'src-old' })],
      [controlRow({ metrics_source_id: 'src-old' }), controlRow({ metric_name: 'web', metrics_source_id: 'src-old' })],
    );
    const svc = new ReportDataFetcherService({ query: jest.fn() } as never, adminAuthz, dataSource as never);

    const data = await svc.getControlGroupComparison('run-7', 'run-7', 'grafana',
      { metrics: ['avg'], userId: 'u', roles: [] });

    expect(data!.rows.map((r) => [r.label, r.metrics[0]!.baseline])).toEqual([['api', null], ['web', 50]]);
  });

  it('does not read the control group when the run\'s own statistics are hidden from the caller', async () => {
    const dataSource = dataSourceAnswering([], [controlRow()]);
    const authz = {
      isGlobalAdmin: () => false,
      getAccessibleOrganizations: jest.fn().mockResolvedValue(['org-1']),
    } as never;
    const svc = new ReportDataFetcherService({ query: jest.fn() } as never, authz, dataSource as never);

    const data = await svc.getControlGroupComparison('run-7', 'run-7', 'grafana',
      { metrics: ['avg'], userId: 'user-1', roles: ['user'] });

    expect(data).toBeNull();
    const [sql, params] = dataSource.query.mock.calls[0]!;
    expect(sql).toMatch(/organization_id/);
    expect(params).toEqual(['run-7', 'grafana', 'org-1']);
    expect(dataSource.query.mock.calls.some(([q]) => q.includes('control-group:statistics'))).toBe(false);
  });
});

describe('ReportDataFetcherService.getControlGroupForRun', () => {
  it('answers null rather than failing the section when the lookup throws', async () => {
    const dataSource = { query: jest.fn().mockRejectedValue(new Error('relation does not exist')) };
    const svc = new ReportDataFetcherService({} as never, adminAuthz, dataSource as never);

    await expect(svc.getControlGroupForRun('run-7')).resolves.toBeNull();
  });
});
