import type { Provider } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TestRun } from '@perfana/shared';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { ReportDataFetcherService } from './report-data-fetcher.service';
import { SeriesGroupResolver } from '../../metrics/series-group-resolver';

/**
 * The report readers that touch `ds_metrics` by series name are group-aware.
 *
 * A report section is built from a graph preset or a template that holds whatever name the
 * picker offered, and the picker offers GROUP names (they come from `ds_metric_statistics`).
 * `ds_metrics` only has the raw pods, so an unexpanded group name is a chart section that
 * silently reads "No metrics data found" (root CLAUDE.md #20). The sibling pin,
 * `report-data-fetcher.ungrouped-sql.spec.ts`, holds that a panel with no grouping is untouched.
 */

const RUN = 'run-1';
const DASH = '6f1c1c52-0000-4000-8000-000000000001';
const POD_A = 'api-7d9f8c6b5-x2k4p';
const POD_B = 'api-7d9f8c6b5-m4nb6';

type Row = Record<string, unknown>;

const membershipRow = (metric_name: string, over: Row = {}): Row => ({
  kind: 'm',
  application_dashboard_id: DASH,
  panel_id: 201,
  dashboard_label: 'Perf',
  panel_title: 'CPU per pod',
  metric_name,
  group_name: 'api',
  aggregation: 'avg',
  member_count_name: null,
  preset: null,
  pattern: null,
  replacement: null,
  track_member_count: null,
  ...over,
});

const ruleRow = (over: Row = {}): Row => ({
  kind: 'r',
  application_dashboard_id: DASH,
  panel_id: null,
  dashboard_label: 'Perf',
  panel_title: null,
  metric_name: null,
  group_name: null,
  aggregation: 'avg',
  member_count_name: null,
  preset: 'k8s-pod',
  pattern: null,
  replacement: '',
  track_member_count: false,
  ...over,
});

/**
 * One `query` mock answers everything the fetcher sends through the test-run repository:
 * the grouping presence probe, the grouping lookup, and the data read, told apart by SQL.
 */
function build(opts: { lookup?: Row[]; names?: Row[]; data?: Row[]; isAdmin?: boolean; withResolver?: boolean } = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('to_regclass')) return [{ present: true }];
    if (sql.includes('FROM ds_metric_series_groups')) return opts.lookup ?? [];
    // The live-run fallback's read of a panel's raw series, when the caller holds none.
    if (sql.includes('SELECT DISTINCT panel_id, metric_name')) return opts.names ?? [];
    return opts.data ?? [];
  });
  const authz = {
    isGlobalAdmin: jest.fn().mockReturnValue(opts.isAdmin ?? false),
    getAccessibleOrganizations: jest.fn().mockResolvedValue(['org-1']),
  };
  const service = new ReportDataFetcherService(
    { query } as never,
    authz as never,
    {} as never,
    opts.withResolver === false ? undefined : new SeriesGroupResolver(),
  );
  const dataReads = () => calls.filter((c) => /\bFROM ds_metrics\b/.test(c.sql) && !c.sql.includes('to_regclass'));
  return { service, calls, query, dataReads };
}

const POINT = { time: '2026-10-02T10:00:00Z', value: '42.5', metric_name: 'api', panel_title: 'CPU per pod', dashboard_label: 'Perf', unit: 'percent' };
const GROUPED = [membershipRow(POD_A), membershipRow(POD_B)];

describe('ReportDataFetcherService.getMetricsTimeSeries with a series group', () => {
  it('answers a group name from its members, combined per timestamp with the stored aggregation', async () => {
    const { service, dataReads } = build({
      lookup: [membershipRow(POD_A, { aggregation: 'sum' }), membershipRow(POD_B, { aggregation: 'sum' })],
      data: [POINT],
      isAdmin: true,
    });

    const result = await service.getMetricsTimeSeries(
      RUN,
      [{ dashboardLabel: 'Perf', panelId: 201, panelTitle: 'CPU per pod', metricName: 'api', key: 'k1' }],
      true,
      'user-1',
      ['admin'],
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ metricName: 'api', dashboardLabel: 'Perf', unit: 'percent', key: 'k1' });
    expect(result[0]!.dataPoints).toEqual([{ time: new Date(POINT.time), value: 42.5 }]);

    const [read] = dataReads();
    expect(read!.sql).toContain("WHEN 'sum' THEN SUM(dm.value)");
    expect(read!.sql).toContain('GROUP BY dm."time", g.group_name');
    // The same filters the plain read applies: label, and the id winning over the title.
    expect(read!.sql).toContain('dm.test_run_id = $1 AND dm.dashboard_label = $2 AND dm.panel_id = $3');
    expect(read!.sql).not.toContain('dm.panel_title =');
    expect(read!.sql).not.toContain('dm.metric_name = $');
    expect(read!.sql).toContain('(dm.ramp_up IS NULL OR dm.ramp_up = false)');
    expect(read!.sql).toMatch(/ORDER BY "time" ASC|ORDER BY s\."time" ASC/);
    expect(read!.params).toEqual([RUN, 'Perf', 201, [POD_B, POD_A].sort(), ['api', 'api'], ['sum', 'sum'], [POD_B, POD_A].sort()]);
  });

  it('keeps the organization filter on the grouped read', async () => {
    const { service, dataReads } = build({ lookup: GROUPED, data: [POINT] });

    await service.getMetricsTimeSeries(
      RUN,
      [{ dashboardLabel: 'Perf', panelId: 201, metricName: 'api' }],
      false,
      'user-1',
      ['user'],
    );

    const [read] = dataReads();
    expect(read!.sql).toContain('EXISTS (SELECT 1 FROM test_runs tr WHERE tr.test_run_id = dm.test_run_id AND tr.organization_id IN ($4))');
    expect(read!.params.slice(0, 4)).toEqual([RUN, 'Perf', 201, 'org-1']);
  });

  it('addresses the panel by title when no id is given', async () => {
    const { service, calls, dataReads } = build({ lookup: GROUPED, data: [POINT], isAdmin: true });

    await service.getMetricsTimeSeries(
      RUN,
      [{ dashboardLabel: 'Perf', panelTitle: 'CPU per pod', metricName: 'api' }],
      false,
      'user-1',
      ['admin'],
    );

    const lookup = calls.find((c) => c.sql.includes('FROM ds_metric_series_groups'))!;
    expect(lookup.params).toEqual([RUN, 'Perf', 'CPU per pod']);
    expect(dataReads()[0]!.sql).toContain('dm.panel_title = $3');
  });

  it('draws a member-count name as COUNT of the members', async () => {
    const lookup = [membershipRow(POD_A, { member_count_name: 'api (pod count)' }), membershipRow(POD_B, { member_count_name: 'api (pod count)' })];
    const { service, dataReads } = build({ lookup, data: [{ ...POINT, metric_name: 'api (pod count)', value: '2' }], isAdmin: true });

    const [panel] = await service.getMetricsTimeSeries(
      RUN,
      [{ dashboardLabel: 'Perf', panelId: 201, metricName: 'api (pod count)' }],
      false,
      '',
      [],
    );

    expect(panel!.metricName).toBe('api (pod count)');
    expect(dataReads()[0]!.params.slice(3, 6)).toEqual([[POD_B, POD_A].sort(), ['api (pod count)', 'api (pod count)'], ['count', 'count']]);
  });

  it('groups a live run by the current rule, reading the panel\'s series only because a rule applies', async () => {
    const { service, dataReads, calls } = build({
      lookup: [ruleRow({ aggregation: 'max' })],
      names: [
        { panel_id: 201, metric_name: POD_A },
        { panel_id: 201, metric_name: POD_B },
      ],
      data: [POINT],
      isAdmin: true,
    });

    await service.getMetricsTimeSeries(RUN, [{ dashboardLabel: 'Perf', panelId: 201, metricName: 'api' }], false, '', []);

    expect(calls.some((c) => c.sql.includes('SELECT DISTINCT panel_id, metric_name'))).toBe(true);
    const [read] = dataReads().filter((c) => c.sql.includes('GROUP BY dm."time", g.group_name'));
    expect(read!.params).toEqual([RUN, 'Perf', 201, [POD_B, POD_A].sort(), ['api', 'api'], ['max', 'max'], [POD_B, POD_A].sort()]);
  });

  it('looks a panel up once, however many of its series the section names', async () => {
    const { service, calls } = build({ lookup: GROUPED, data: [POINT], isAdmin: true });

    await service.getMetricsTimeSeries(
      RUN,
      [
        { dashboardLabel: 'Perf', panelId: 201, metricName: 'api' },
        { dashboardLabel: 'Perf', panelId: 201, metricName: 'heap-used' },
        { dashboardLabel: 'Perf', panelId: 201, metricName: POD_A },
      ],
      false,
      '',
      [],
    );

    expect(calls.filter((c) => c.sql.includes('FROM ds_metric_series_groups'))).toHaveLength(1);
  });

  it('leaves a raw pod name to the equality read', async () => {
    const { service, dataReads } = build({ lookup: GROUPED, data: [POINT], isAdmin: true });

    await service.getMetricsTimeSeries(RUN, [{ dashboardLabel: 'Perf', panelId: 201, metricName: POD_A }], false, '', []);

    const [read] = dataReads();
    expect(read!.sql).toContain('dm.metric_name = $4');
    expect(read!.sql).not.toContain('unnest(');
  });
});

describe('ReportDataFetcherService.getMetricsTimeSeries: a panel with no grouping', () => {
  const selector = { dashboardLabel: 'Perf', panelId: 201, panelTitle: 'CPU per pod', metricName: 'T01.login' };

  it('issues exactly the statement it issued before, plus one lookup that never reads ds_metrics', async () => {
    const before = build({ withResolver: false, data: [POINT] });
    const after = build({ data: [POINT] });

    await before.service.getMetricsTimeSeries(RUN, [selector], true, 'user-1', ['user']);
    await after.service.getMetricsTimeSeries(RUN, [selector], true, 'user-1', ['user']);

    expect(after.dataReads()).toEqual(before.dataReads());
    const extra = after.calls.filter((c) => !before.calls.includes(c) && !after.dataReads().includes(c));
    expect(extra.every((c) => !/\bFROM ds_metrics\b/.test(c.sql))).toBe(true);
  });

  it('does not consult the grouping tables for a selector with no series name', async () => {
    const { service, calls } = build({ lookup: GROUPED, data: [POINT], isAdmin: true });

    await service.getMetricsTimeSeries(RUN, [{ dashboardLabel: 'Perf', panelTitle: 'CPU per pod' }], false, '', []);

    expect(calls.some((c) => c.sql.includes('ds_metric_series_groups'))).toBe(false);
  });

  it('does not consult the grouping tables for a selector with no dashboard label', async () => {
    const { service, calls } = build({ lookup: GROUPED, data: [POINT], isAdmin: true });

    await service.getMetricsTimeSeries(RUN, [{ panelId: 201, metricName: 'api' }], false, '', []);

    expect(calls.some((c) => c.sql.includes('ds_metric_series_groups'))).toBe(false);
  });
});

describe('ReportDataFetcherService.getAvailableMetricsPanels with a series group', () => {
  const PANEL_ROWS = [
    { dashboard_label: 'Perf', panel_title: 'CPU per pod', panel_id: 201, metric_name: POD_A },
    { dashboard_label: 'Perf', panel_title: 'CPU per pod', panel_id: 201, metric_name: POD_B },
    { dashboard_label: 'Perf', panel_title: 'CPU per pod', panel_id: 201, metric_name: 'heap-used' },
  ];

  it('offers the group in place of its pods, so the report cascade can pick it', async () => {
    const { service, dataReads } = build({ lookup: [...GROUPED, membershipRow('heap-used', { group_name: 'heap-used' })], data: PANEL_ROWS, isAdmin: true });

    const panels = await service.getAvailableMetricsPanels(RUN);

    expect(panels).toEqual([
      { dashboardLabel: 'Perf', panelTitle: 'CPU per pod', metricName: 'api' },
      { dashboardLabel: 'Perf', panelTitle: 'CPU per pod', metricName: 'heap-used' },
    ]);
    // The group read has to see every raw series, so it cannot carry the cap of 20 that the
    // plain read applies to raw rows; the cap is applied to what is returned.
    const [read] = dataReads();
    expect(read!.sql).toContain('dm.panel_id');
    expect(read!.sql).not.toContain('LIMIT 20');
  });

  it('offers the member-count series beside the group', async () => {
    const lookup = [membershipRow(POD_A, { member_count_name: 'api (pod count)' }), membershipRow(POD_B, { member_count_name: 'api (pod count)' })];
    const { service } = build({ lookup, data: PANEL_ROWS.slice(0, 2) });

    const panels = await service.getAvailableMetricsPanels(RUN);

    expect(panels.map((p) => p.metricName)).toEqual(['api', 'api (pod count)']);
  });

  it('still caps what it returns at 20', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      dashboard_label: 'Perf', panel_title: 'Other', panel_id: 300, metric_name: `series-${String(i).padStart(2, '0')}`,
    }));
    const { service } = build({ lookup: GROUPED, data: [...PANEL_ROWS.slice(0, 2), ...many] });

    expect(await service.getAvailableMetricsPanels(RUN)).toHaveLength(20);
  });

  it('keeps the organization filter on the grouped read', async () => {
    const { service, dataReads } = build({ lookup: GROUPED, data: PANEL_ROWS });

    await service.getAvailableMetricsPanels(RUN, 'user-1', ['user']);

    const [read] = dataReads();
    expect(read!.sql).toContain('tr.organization_id IN ($2)');
    expect(read!.params).toEqual([RUN, 'org-1']);
  });

  it('issues exactly the statement it issued before when the run has no grouping', async () => {
    const before = build({ withResolver: false, data: PANEL_ROWS });
    const after = build({ lookup: [], data: PANEL_ROWS });

    const expected = await before.service.getAvailableMetricsPanels(RUN, 'user-1', ['user']);
    const actual = await after.service.getAvailableMetricsPanels(RUN, 'user-1', ['user']);

    expect(after.dataReads()).toEqual(before.dataReads());
    expect(actual).toEqual(expected);
  });
});

describe('statistics readers carry group names unchanged', () => {
  // `ds_metric_statistics` already holds the group, so these two need no expansion. Pinned so
  // a well-meaning "make every reader group-aware" cannot start rewriting what they return.
  it('getMetricTrends returns a series under its group name, with its per-run values', async () => {
    const dataSource = {
      query: jest.fn().mockResolvedValue([
        { test_run_id: 'r1', dashboard_label: 'Perf', panel_title: 'CPU per pod', panel_id: 201, metric_name: 'api', unit: 'percent', source_type: 'grafana', mean: 11 },
        { test_run_id: 'r2', dashboard_label: 'Perf', panel_title: 'CPU per pod', panel_id: 201, metric_name: 'api', unit: 'percent', source_type: 'grafana', mean: 13 },
      ]),
    };
    const repo = { query: jest.fn() };
    const svc = new ReportDataFetcherService(repo as never, {} as never, dataSource as never, new SeriesGroupResolver());

    const series = await svc.getMetricTrends(['r1', 'r2'], [{ dashboardLabel: 'Perf', panelId: 201, metricNames: ['api'] }]);

    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ metricName: 'api', valuesByRun: { r1: 11, r2: 13 } });
    // Not a word to the grouping tables or to ds_metrics.
    expect(repo.query).not.toHaveBeenCalled();
    expect(dataSource.query.mock.calls.every(([sql]) => !String(sql).includes('ds_metric_series_groups'))).toBe(true);
  });

  it('getBaselineRunComparison pairs a group name across the two runs, and its member-count series', async () => {
    const stat = (run: string, name: string, mean: number) => ({
      test_run_id: run, dashboard_label: 'Perf', panel_title: 'CPU per pod', panel_id: 201, metric_name: name, mean, q95: mean, q99: mean, unit: 'percent',
    });
    const dataSource = {
      query: jest.fn().mockResolvedValue([
        stat('cur', 'api', 110), stat('base', 'api', 100),
        stat('cur', 'api (pod count)', 3), stat('base', 'api (pod count)', 2),
      ]),
    };
    const repo = { query: jest.fn() };
    const svc = new ReportDataFetcherService(repo as never, { isGlobalAdmin: () => true } as never, dataSource as never, new SeriesGroupResolver());

    const data = await svc.getBaselineRunComparison('cur', 'base', 'grafana', { metrics: ['avg'], userId: 'u', roles: [] });

    expect(data!.rows.map((r) => r.label)).toEqual(['api', 'api (pod count)']);
    expect(data!.rows[0]!.metrics[0]!.diffPercent).toBeCloseTo(10);
    expect(data!.rows[1]!.metrics[0]!.diffPercent).toBeCloseTo(50);
    expect(repo.query).not.toHaveBeenCalled();
  });
});

describe('dependency injection', () => {
  // The fetcher is built by hand in most specs, which would never notice a broken DI wiring.
  const providers = (extra: Provider[]): Provider[] => [
    ReportDataFetcherService,
    { provide: getRepositoryToken(TestRun), useValue: { query: jest.fn() } },
    { provide: AuthorizationService, useValue: {} },
    { provide: DataSource, useValue: {} },
    ...extra,
  ];

  it('injects the resolver the reports module provides', async () => {
    const module = await Test.createTestingModule({ providers: providers([SeriesGroupResolver]) }).compile();
    expect((module.get(ReportDataFetcherService) as unknown as { seriesGroups: unknown }).seriesGroups).toBeInstanceOf(
      SeriesGroupResolver,
    );
  });

  it('still builds without one, and then reads ungrouped', async () => {
    const module = await Test.createTestingModule({ providers: providers([]) }).compile();
    expect((module.get(ReportDataFetcherService) as unknown as { seriesGroups: unknown }).seriesGroups).toBeUndefined();
  });
});
