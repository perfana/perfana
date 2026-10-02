import { Logger } from '@nestjs/common';
import { ReportDataFetcherService } from './report-data-fetcher.service';

/**
 * `getMetricsTimeSeries` — how a report section names the series it wants.
 *
 * The rule this pins is the one the comparisons section's per-row graphs shipped broken
 * on: **the panel id filters and the title is only echoed back**. The perf-test panels are
 * RENAMED for display — `perfPanelTitle` collapses
 * `Transaction RT Avg/P90/P95/P99` into one `Transaction RT` — so a selector carrying that
 * display title matched no stored `panel_title` at all, the query returned nothing, and
 * every graph silently vanished. Nothing errored and nothing was logged.
 *
 * Filtering on BOTH would be just as broken, which is why the two are an `else if` and not
 * two independent conditions.
 */
describe('ReportDataFetcherService.getMetricsTimeSeries', () => {
  const authzStub = {} as never;
  const dataSourceStub = {} as never;

  const row = (over: Record<string, unknown> = {}) => ({
    time: '2026-10-02T10:00:00Z',
    value: '42.5',
    metric_name: 'T03_Search_Products',
    panel_title: 'Transaction RT Avg',      // what is STORED
    dashboard_label: 'Perf',
    unit: 'ms',
    ...over,
  });

  const svc = (rows: unknown[] | Error) => {
    const query = rows instanceof Error
      ? jest.fn().mockRejectedValue(rows)
      : jest.fn().mockResolvedValue(rows);
    const repo = { query } as never;
    return { svc: new ReportDataFetcherService(repo, authzStub, dataSourceStub), query };
  };

  /** The WHERE of the one query that was issued, whitespace-collapsed. */
  const whereOf = (query: jest.Mock, call = 0) =>
    (query.mock.calls[call]![0] as string).replace(/\s+/g, ' ');

  it('filters on the panel ID and never on the title, when both are given', async () => {
    const { svc: s, query } = svc([row()]);

    await s.getMetricsTimeSeries('run-001', [{
      dashboardLabel: 'Perf',
      panelId: 101,
      panelTitle: 'Transaction RT',          // the DISPLAY name — matches nothing stored
      metricName: 'T03_Search_Products',
    }], false, '', []);

    const where = whereOf(query);
    expect(where).toContain('dm.panel_id = $3');
    // The bug: a title filter here is a guaranteed zero-row lookup on a renamed panel.
    expect(where).not.toContain('dm.panel_title =');
    expect(query.mock.calls[0]![1]).toEqual(['run-001', 'Perf', 101, 'T03_Search_Products']);
  });

  it('echoes the caller title back on the result, so a row can be matched up again', async () => {
    const { svc: s } = svc([row()]);

    const [panel] = await s.getMetricsTimeSeries('run-001', [{
      dashboardLabel: 'Perf', panelId: 101, panelTitle: 'Transaction RT', metricName: 'T03_Search_Products',
    }], false, '', []);

    // Not 'Transaction RT Avg' from the DB row: the caller keeps the name it asked under,
    // which is what lets the comparisons renderer key its chart back to its table row.
    expect(panel!.panelTitle).toBe('Transaction RT');
    expect(panel!.dataPoints).toEqual([{ time: new Date('2026-10-02T10:00:00Z'), value: 42.5 }]);
  });

  it('still filters on the title when there is no id — a Grafana panel has a real name', async () => {
    const { svc: s, query } = svc([row({ panel_title: 'Heap' })]);

    await s.getMetricsTimeSeries('run-001', [{ dashboardLabel: 'JVM', panelTitle: 'Heap' }], false, '', []);

    const where = whereOf(query);
    expect(where).toContain('dm.panel_title = $3');
    expect(where).not.toContain('dm.panel_id =');
  });

  it('treats panelId 0 as a real id, not as absent', async () => {
    // `!= null` rather than a truthiness test: panel 0 exists.
    const { svc: s, query } = svc([row()]);
    await s.getMetricsTimeSeries('run-001', [{ panelId: 0, panelTitle: 'Heap' }], false, '', []);
    expect(whereOf(query)).toContain('dm.panel_id = $2');
    expect(whereOf(query)).not.toContain('dm.panel_title =');
  });

  it('leaves out a filter the selector does not carry', async () => {
    const { svc: s, query } = svc([row()]);
    await s.getMetricsTimeSeries('run-001', [{}], false, '', []);
    const where = whereOf(query);
    expect(where).toContain('dm.test_run_id = $1');
    expect(where).not.toContain('dm.dashboard_label =');
    expect(where).not.toContain('dm.panel_id =');
    expect(where).not.toContain('dm.metric_name =');
    expect(query.mock.calls[0]![1]).toEqual(['run-001']);
  });

  it('adds the ramp-up predicate only when asked to exclude it', async () => {
    const { svc: a, query: qa } = svc([row()]);
    await a.getMetricsTimeSeries('run-001', [{ panelId: 1 }], true, '', []);
    expect(whereOf(qa)).toContain('dm.ramp_up');

    const { svc: b, query: qb } = svc([row()]);
    await b.getMetricsTimeSeries('run-001', [{ panelId: 1 }], false, '', []);
    expect(whereOf(qb)).not.toContain('dm.ramp_up');
  });

  it('asks once per selector, and keeps the caller order', async () => {
    const { svc: s, query } = svc([row()]);
    const panels = await s.getMetricsTimeSeries(
      'run-001',
      [{ panelId: 1, panelTitle: 'A' }, { panelId: 2, panelTitle: 'B' }],
      false, '', [],
    );
    expect(query).toHaveBeenCalledTimes(2);
    expect(panels.map((p) => p.panelTitle)).toEqual(['A', 'B']);
  });

  it('omits a selector that matched nothing rather than returning an empty panel', async () => {
    // The comparisons renderer relies on this: a row whose baseline has no series must
    // produce no entry at all, so the chart is drawn with one line and says so.
    const { svc: s } = svc([]);
    expect(await s.getMetricsTimeSeries('run-001', [{ panelId: 1 }], false, '', [])).toEqual([]);
  });

  it('issues no query at all for an empty selector list', async () => {
    const { svc: s, query } = svc([row()]);
    expect(await s.getMetricsTimeSeries('run-001', [], false, '', [])).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('keeps a null sample as null rather than coercing it to 0', async () => {
    const { svc: s } = svc([row({ value: null })]);
    const [panel] = await s.getMetricsTimeSeries('run-001', [{ panelId: 1 }], false, '', []);
    expect(panel!.dataPoints[0]!.value).toBeNull();
  });

  it('answers an empty list and logs when the query throws, instead of failing the report', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { svc: s } = svc(new Error('ds_metrics unavailable'));
    expect(await s.getMetricsTimeSeries('run-001', [{ panelId: 1 }], false, '', [])).toEqual([]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('skips org filtering for a system call with no userId', async () => {
    // Report HTML generation runs with an empty userId; an org filter there sees nothing.
    const { svc: s, query } = svc([row()]);
    await s.getMetricsTimeSeries('run-001', [{ panelId: 1 }], false, '', []);
    expect(whereOf(query)).not.toContain('FROM test_runs tr');
  });
});

/**
 * `key` — the opaque correlation token the comparisons section's row graphs pair on.
 *
 * Results come back ONLY for selectors that had rows, so a caller cannot pair them up
 * positionally. Reconstructing a key from the echoed fields does not work either: a
 * display title collapses panels 101-104 into one name, and a dashboard-mapped baseline is
 * selected by title with no id to echo. So the caller sends a token and matches on it, and
 * the one thing that has to hold is that this method hands it back untouched. If it stops,
 * `ComparisonsRenderer.renderRowCharts` indexes an empty map and EVERY graph silently
 * disappears — no error, no log, just a section with no `<details>` in it.
 */
describe('ReportDataFetcherService.getMetricsTimeSeries — the `key` echo', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    time: '2026-10-02T10:00:00Z', value: '1', metric_name: 'T03',
    panel_title: 'Transaction RT Avg', dashboard_label: 'Perf', unit: 'ms', ...over,
  });

  const svc = (rows: unknown[]) => {
    const query = jest.fn().mockResolvedValue(rows);
    return { svc: new ReportDataFetcherService({ query } as never, {} as never, {} as never), query };
  };

  it('echoes the token back untouched on the matching panel', async () => {
    const { svc: s } = svc([row()]);
    const [panel] = await s.getMetricsTimeSeries('run-001', [{
      dashboardLabel: 'Perf', panelId: 101, panelTitle: 'Transaction RT',
      metricName: 'T03', key: 'Perf\u0000101\u0000T03',
    }], false, '', []);
    expect(panel!.key).toBe('Perf\u0000101\u0000T03');
  });

  it('never sends the token to SQL — it is a correlation token, not a filter', async () => {
    const { svc: s, query } = svc([row()]);
    await s.getMetricsTimeSeries('run-001', [{ panelId: 101, key: 'whatever' }], false, '', []);
    expect(query.mock.calls[0]![1]).toEqual(['run-001', 101]);
    expect(query.mock.calls[0]![0] as string).not.toContain('key');
  });

  it('keeps each selector token with its own panel across a batch', async () => {
    // Four rows of one transaction share a DISPLAY title, so only the token tells the
    // results apart. This is the case the pairing exists for.
    const { svc: s } = svc([row()]);
    const panels = await s.getMetricsTimeSeries('run-001', [
      { panelId: 101, panelTitle: 'Transaction RT', metricName: 'T03', key: 'k-avg' },
      { panelId: 103, panelTitle: 'Transaction RT', metricName: 'T03', key: 'k-p95' },
    ], false, '', []);
    expect(panels.map((p) => p.key)).toEqual(['k-avg', 'k-p95']);
    // ...and the echoed fields really are identical, which is why a field key would fail.
    expect(panels[0]!.panelTitle).toBe(panels[1]!.panelTitle);
    expect(panels[0]!.metricName).toBe(panels[1]!.metricName);
  });

  it('leaves `key` undefined when the caller did not send one', async () => {
    const { svc: s } = svc([row()]);
    const [panel] = await s.getMetricsTimeSeries('run-001', [{ panelId: 101 }], false, '', []);
    expect(panel!.key).toBeUndefined();
  });
});
