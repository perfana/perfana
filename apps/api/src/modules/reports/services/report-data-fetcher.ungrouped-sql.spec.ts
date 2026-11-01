import { ReportDataFetcherService } from './report-data-fetcher.service';

/**
 * Series grouping must be INERT for a panel that has none.
 *
 * The two report readers that touch `ds_metrics` by series name are pinned here verbatim,
 * parameters included. The group-aware change adds a lookup against the grouping tables
 * for a section that names a series; it must not alter a single statement on `ds_metrics`
 * for a panel with no grouping. See the sibling pin in
 * `metrics/metrics.service.ungrouped-sql.spec.ts`.
 *
 * If one of these snapshots needs updating, the change is no longer inert for ungrouped
 * panels. Stop and ask why before touching it.
 */
function build() {
  const query = jest.fn().mockResolvedValue([]);
  const authz = {
    isGlobalAdmin: jest.fn().mockReturnValue(false),
    getAccessibleOrganizations: jest.fn().mockResolvedValue(['org-1']),
  };
  const repo = { query } as never;
  const service = new ReportDataFetcherService(repo, authz as never, {} as never);
  return { service, query };
}

/** Statements that read the measurement table. */
const dsMetricsStatements = (query: jest.Mock): Array<[string, unknown[]]> =>
  query.mock.calls
    .filter(([sql]) => /\bFROM ds_metrics\b/.test(String(sql)))
    .map(([sql, params]) => [String(sql), (params as unknown[]) ?? []]);

describe('ReportDataFetcherService: SQL for a panel with no series grouping is pinned', () => {
  it('getMetricsTimeSeries by label, panel id and metric name, ramp-up excluded, org-scoped', async () => {
    const { service, query } = build();

    await service.getMetricsTimeSeries(
      'run-1',
      [{ dashboardLabel: 'Perf', panelId: 201, panelTitle: 'RT', metricName: 'T01.login' }],
      true,
      'user-1',
      ['user'],
    );

    expect(dsMetricsStatements(query)).toMatchSnapshot();
  });

  it('getMetricsTimeSeries by label and title with no metric name, system call', async () => {
    const { service, query } = build();

    await service.getMetricsTimeSeries('run-1', [{ dashboardLabel: 'Perf', panelTitle: 'RT' }], false, '', []);

    expect(dsMetricsStatements(query)).toMatchSnapshot();
  });

  it('getAvailableMetricsPanels, org-scoped', async () => {
    const { service, query } = build();

    await service.getAvailableMetricsPanels('run-1', 'user-1', ['user']);

    expect(dsMetricsStatements(query)).toMatchSnapshot();
  });

  it('getAvailableMetricsPanels, system call', async () => {
    const { service, query } = build();
    query.mockResolvedValue([{ dashboard_label: 'Perf', panel_title: 'RT', metric_name: 'a' }]);

    const panels = await service.getAvailableMetricsPanels('run-1');

    expect(dsMetricsStatements(query)).toMatchSnapshot();
    expect(panels).toEqual([{ dashboardLabel: 'Perf', panelTitle: 'RT', metricName: 'a' }]);
  });
});
