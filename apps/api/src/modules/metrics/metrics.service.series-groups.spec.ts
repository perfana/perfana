import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { SeriesGroupResolver } from './series-group-resolver';
import { createAuthorizationServiceMock } from '../../../test/mocks/authorization-service.mock';

/**
 * The `ds_metrics` readers are group-aware.
 *
 * A group name is chosen from `ds_metric_statistics` (the pickers, a saved graph preset, a
 * report section, a deep link) and comes back to a reader that holds only RAW series names.
 * Without expansion that is a silent empty chart (root CLAUDE.md #18, #20, #49). These tests
 * pin the expansion; `metrics.service.ungrouped-sql.spec.ts` pins that a panel with no
 * grouping is untouched.
 */

const RUN = 'run-1';
const DASH = '6f1c1c52-0000-4000-8000-000000000001';
const POD_A = 'api-7d9f8c6b5-x2k4p';
const POD_B = 'api-7d9f8c6b5-m4nb6';
const POD_C = 'api-5c4d9b7f8-q7zt2';

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

function build(grouping: { lookup?: Row[] | ((params: unknown[]) => Row[]); names?: Row[] } = {}) {
  const repo = () => ({
    find: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    query: jest.fn(),
    createQueryBuilder: jest.fn(),
    manager: { query: jest.fn(), transaction: jest.fn() },
  });
  const metricsRepo = repo();
  const testRunRepo = repo();
  const appDashboardRepo = repo();
  const authz = createAuthorizationServiceMock();
  testRunRepo.query.mockResolvedValue([{ organization_id: 'org-1', created_by: 'creator' }]);
  appDashboardRepo.findOne.mockResolvedValue({ id: DASH, organizationId: 'org-1', createdBy: 'creator' });

  // The grouping lookups go through the manager, never through the repository's own query().
  metricsRepo.manager.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('to_regclass')) return [{ present: true }];
    if (/\bFROM ds_metrics\b/.test(sql) && sql.includes('DISTINCT panel_id')) return grouping.names ?? [];
    if (sql.includes('FROM ds_metric_series_groups')) {
      return typeof grouping.lookup === 'function' ? grouping.lookup(params) : (grouping.lookup ?? []);
    }
    return [];
  });

  const service = new MetricsService(
    metricsRepo as never,
    repo() as never,
    repo() as never,
    repo() as never,
    repo() as never,
    testRunRepo as never,
    appDashboardRepo as never,
    authz as never,
    new SeriesGroupResolver(),
  );
  return { service, metricsRepo, testRunRepo, authz };
}

const GROUPED = [membershipRow(POD_A), membershipRow(POD_B), membershipRow('heap-used', { group_name: 'heap-used' })];

/** The statements a reader sent to `ds_metrics` through the repository. */
const reads = (metricsRepo: { query: jest.Mock }) =>
  metricsRepo.query.mock.calls.map(([sql, params]) => ({ sql: String(sql), params: params as unknown[] }));

describe('findDSMetricsForPanel with a series group', () => {
  it('answers a group name from its members, combined per timestamp with the stored aggregation', async () => {
    const { service, metricsRepo } = build({ lookup: [membershipRow(POD_A, { aggregation: 'sum' }), membershipRow(POD_B, { aggregation: 'sum' })] });
    const rows = [
      { time: new Date('2024-01-01T10:00:00Z'), metric_name: 'api', value: 30, timestep: 1, ramp_up: false },
    ];
    metricsRepo.query.mockImplementation(async (sql: string) =>
      sql.includes('needs_downsampling') ? [{ needs_downsampling: false }] : rows,
    );

    const result = await service.findDSMetricsForPanel(RUN, 201, DASH, 'api');

    expect(result).toEqual(rows);
    // The group is not a column in ds_metrics, so the TypeORM `find` (metric_name = 'api') must not run.
    expect(metricsRepo.find).not.toHaveBeenCalled();
    const [probe, read] = reads(metricsRepo);
    for (const statement of [probe!, read!]) {
      expect(statement.sql).toContain("WHEN 'sum' THEN SUM(m.value)");
      expect(statement.sql).toContain('GROUP BY m."time", g.group_name');
      expect(statement.sql).toContain('m.test_run_id = $1 AND m.panel_id = $2 AND m.application_dashboard_id = $3');
      expect(statement.sql).not.toContain('m.metric_name = $');
      expect(statement.params).toEqual([RUN, 201, DASH, [POD_B, POD_A].sort(), ['api', 'api'], ['sum', 'sum'], [POD_B, POD_A].sort()]);
    }
    expect(read!.sql).toMatch(/ORDER BY timestep ASC/);
  });

  it('downsamples the aggregated series, not the raw members', async () => {
    const { service, metricsRepo } = build({ lookup: GROUPED });
    metricsRepo.query.mockImplementation(async (sql: string) => {
      if (sql.includes('needs_downsampling')) return [{ needs_downsampling: true }];
      if (sql.includes('COUNT(DISTINCT')) return [{ count: 1 }];
      return [{ metric_name: 'api', time: new Date('2024-01-01T10:00:00Z'), value: 12 }];
    });

    const result = await service.findDSMetricsForPanel(RUN, 201, DASH, 'api');

    expect(result).toEqual([{ time: new Date('2024-01-01T10:00:00Z'), metric_name: 'api', value: 12 }]);
    const [probe, count, lttb] = reads(metricsRepo);
    expect(probe!.sql).toContain('LIMIT 4001 OFFSET 4000');
    expect(count!.sql).toContain('COUNT(DISTINCT metric_name)');
    expect(lttb!.sql).toContain('lttb("time", value, 4000)');
    for (const statement of [probe!, count!, lttb!]) {
      expect(statement.sql).toContain('GROUP BY m."time", g.group_name');
      // The same relation, therefore the same bound arrays.
      expect(statement.params).toEqual(probe!.params);
    }
  });

  it('carries the zoom window into the aggregated read', async () => {
    const { service, metricsRepo } = build({ lookup: GROUPED });
    metricsRepo.query.mockResolvedValue([{ needs_downsampling: false }]);
    const range = { from: '2024-01-01T00:00:00.000Z', to: '2024-01-01T01:00:00.000Z' };

    await service.findDSMetricsForPanel(RUN, 201, DASH, 'api', '', [], undefined, range);

    const [probe] = reads(metricsRepo);
    expect(probe!.sql).toContain('m."time" >= $4::timestamptz AND m."time" <= $5::timestamptz');
    expect(probe!.params.slice(0, 5)).toEqual([RUN, 201, DASH, range.from, range.to]);
  });

  it('prefers a metrics source over the dashboard id for the filter, as the ungrouped path does', async () => {
    const { service, metricsRepo } = build({ lookup: GROUPED });
    metricsRepo.query.mockResolvedValue([{ needs_downsampling: false }]);

    await service.findDSMetricsForPanel(RUN, 201, DASH, 'api', '', [], 'ms-1');

    const [probe] = reads(metricsRepo);
    expect(probe!.sql).toContain('m.metrics_source_id = $3');
    expect(probe!.sql).not.toContain('m.application_dashboard_id = $');
    expect(probe!.params.slice(0, 3)).toEqual([RUN, 201, 'ms-1']);
  });

  it('draws a member-count name as COUNT of the members', async () => {
    const { service, metricsRepo } = build({
      lookup: [membershipRow(POD_A, { member_count_name: 'api (pod count)' }), membershipRow(POD_B, { member_count_name: 'api (pod count)' })],
    });
    metricsRepo.query.mockResolvedValue([{ needs_downsampling: false }]);

    await service.findDSMetricsForPanel(RUN, 201, DASH, 'api (pod count)');

    const [probe] = reads(metricsRepo);
    // The bound aggregation is `count`, under the member-count name, over the group's members.
    expect(probe!.params.slice(3)).toEqual([[POD_B, POD_A].sort(), ['api (pod count)', 'api (pod count)'], ['count', 'count'], [POD_B, POD_A].sort()]);
    expect(probe!.sql).toContain("WHEN 'count' THEN COUNT(*)::double precision");
  });

  it('returns one aggregated series per group, plus the series nothing groups, when no name is given', async () => {
    const { service, metricsRepo } = build({ lookup: GROUPED });
    metricsRepo.query.mockResolvedValue([{ needs_downsampling: false }]);

    await service.findDSMetricsForPanel(RUN, 201, DASH);

    const [probe] = reads(metricsRepo);
    expect(probe!.sql).toContain('NOT (m.metric_name = ANY($4::text[]))');
    expect(probe!.sql).toContain('UNION ALL');
    // Excluded: the pods the group replaces. `heap-used` is a group of one: it stays a plain series.
    expect(probe!.params[3]).toEqual([POD_B, POD_A].sort());
    expect(probe!.params[4]).toEqual([POD_B, POD_A].sort());
    expect(probe!.params[5]).toEqual(['api', 'api']);
  });

  it('returns the per-pod series when members=true, with a group name', async () => {
    const { service, metricsRepo } = build({ lookup: GROUPED });
    metricsRepo.query.mockResolvedValue([{ needs_downsampling: false }]);

    await service.findDSMetricsForPanel(RUN, 201, DASH, 'api', '', [], undefined, undefined, true);

    const [probe] = reads(metricsRepo);
    expect(probe!.sql).not.toContain('GROUP BY');
    expect(probe!.sql).toContain('m.metric_name = ANY($4::text[])');
    expect(probe!.params[3]).toEqual([POD_B, POD_A].sort());
  });

  it('with members=true and no name, reads exactly what it read before and never consults the grouping tables', async () => {
    const { service, metricsRepo } = build({ lookup: GROUPED });
    metricsRepo.query.mockResolvedValue([{ needs_downsampling: false }]);
    metricsRepo.find.mockResolvedValue([]);

    await service.findDSMetricsForPanel(RUN, 201, DASH, undefined, '', [], undefined, undefined, true);

    expect(metricsRepo.find).toHaveBeenCalled();
    expect(metricsRepo.manager.query).not.toHaveBeenCalled();
  });

  it('leaves a raw pod name alone: it is not a group, so the existing equality read answers it', async () => {
    const { service, metricsRepo } = build({ lookup: GROUPED });
    metricsRepo.query.mockResolvedValue([{ needs_downsampling: false }]);
    metricsRepo.find.mockResolvedValue([]);

    await service.findDSMetricsForPanel(RUN, 201, DASH, POD_A);

    expect(metricsRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ metric_name: POD_A }) }),
    );
  });

  it('applies the CURRENT rule for a live run that has no membership yet', async () => {
    const { service, metricsRepo } = build({
      lookup: [ruleRow({ aggregation: 'max' })],
      names: [
        { panel_id: 201, metric_name: POD_A },
        { panel_id: 201, metric_name: POD_B },
      ],
    });
    metricsRepo.query.mockResolvedValue([{ needs_downsampling: false }]);

    await service.findDSMetricsForPanel(RUN, 201, DASH, 'api');

    const [probe] = reads(metricsRepo);
    expect(probe!.params.slice(3)).toEqual([[POD_B, POD_A].sort(), ['api', 'api'], ['max', 'max'], [POD_B, POD_A].sort()]);
  });

  it('is not misled by a group-looking name when the panel has no grouping at all', async () => {
    const { service, metricsRepo } = build({ lookup: [] });
    metricsRepo.query.mockResolvedValue([{ needs_downsampling: false }]);
    metricsRepo.find.mockResolvedValue([]);

    await service.findDSMetricsForPanel(RUN, 201, DASH, 'api');

    expect(metricsRepo.find).toHaveBeenCalled();
    expect(reads(metricsRepo).every((r) => !r.sql.includes('unnest('))).toBe(true);
  });
});

describe('ds-metrics-comparison expands each run with its own members', () => {
  it('uses the membership of the current run for the current run, and of the baseline for the baseline', async () => {
    const { service, metricsRepo } = build({
      // The two runs scaled differently: three pods against two, with different names.
      lookup: (params) =>
        params[0] === 'run-current'
          ? [membershipRow(POD_A), membershipRow(POD_B), membershipRow(POD_C)]
          : [membershipRow('api-6b8f4d7c9-aaaaa'), membershipRow('api-6b8f4d7c9-bbbbb')],
    });
    metricsRepo.query.mockResolvedValue([{ needs_downsampling: false }]);
    const controller = new MetricsController(service, {} as never);

    await controller.getDSMetricsComparison(
      { userId: 'user-1', roles: ['user'] } as never,
      'run-current',
      'run-baseline',
      DASH,
      '201',
      'api',
    );

    const probes = reads(metricsRepo).filter((r) => r.sql.includes('needs_downsampling'));
    const byRun = new Map(probes.map((p) => [p.params[0] as string, p.params]));
    expect(byRun.get('run-current')![3]).toEqual([POD_A, POD_B, POD_C].sort());
    expect(byRun.get('run-baseline')![3]).toEqual(['api-6b8f4d7c9-aaaaa', 'api-6b8f4d7c9-bbbbb']);
  });
});

describe('getDistinctMetricNames with a series group', () => {
  const names = [POD_A, POD_B, 'heap-used'];

  it('lists group names in place of the pods they replace', async () => {
    const { service, metricsRepo } = build({ lookup: GROUPED });
    metricsRepo.manager.query.mockImplementation(wrapNames(metricsRepo, names, GROUPED));

    const result = await service.getDistinctMetricNames(DASH, 201, 'user-1', ['user'], undefined, RUN);

    expect(result).toEqual(['api', 'heap-used']);
  });

  it('lists the member-count name beside its group', async () => {
    const lookup = [membershipRow(POD_A, { member_count_name: 'api (pod count)' }), membershipRow(POD_B, { member_count_name: 'api (pod count)' })];
    const { service, metricsRepo } = build({ lookup });
    metricsRepo.manager.query.mockImplementation(wrapNames(metricsRepo, [POD_A, POD_B], lookup));

    expect(await service.getDistinctMetricNames(DASH, 201, 'user-1', ['user'], undefined, RUN)).toEqual([
      'api',
      'api (pod count)',
    ]);
  });

  it('returns the raw names with members=true', async () => {
    const { service, metricsRepo } = build({ lookup: GROUPED });
    metricsRepo.manager.query.mockImplementation(wrapNames(metricsRepo, names, GROUPED));

    const result = await service.getDistinctMetricNames(DASH, 201, 'user-1', ['user'], undefined, RUN, true);

    expect(result).toEqual(names);
  });

  it('returns the names untouched when nothing is grouped', async () => {
    const { service, metricsRepo } = build({ lookup: [] });
    metricsRepo.manager.query.mockImplementation(wrapNames(metricsRepo, names, []));

    expect(await service.getDistinctMetricNames(DASH, 201, 'user-1', ['user'], undefined, RUN)).toEqual(names);
  });

  it('groups a live run by the current rule, from the names it already read', async () => {
    const { service, metricsRepo } = build({ lookup: [ruleRow()] });
    metricsRepo.manager.query.mockImplementation(wrapNames(metricsRepo, names, [ruleRow()]));

    const result = await service.getDistinctMetricNames(DASH, 201, 'user-1', ['user'], undefined, RUN);

    expect(result).toEqual(['api', 'heap-used']);
    // The names query ran once: the rule was applied to its output, not to a second read.
    const namesReads = metricsRepo.manager.query.mock.calls.filter(([sql]) => /\bFROM ds_metrics\b/.test(String(sql)));
    expect(namesReads).toHaveLength(1);
  });

  it('does not group the unscoped fallback, which spans runs and so has no membership to ask', async () => {
    const { service, metricsRepo } = build({ lookup: GROUPED });
    metricsRepo.query.mockResolvedValue([]);
    metricsRepo.manager.query.mockImplementation(wrapNames(metricsRepo, [], GROUPED));
    (metricsRepo.manager.transaction as jest.Mock).mockImplementation(async (cb: (em: unknown) => unknown) =>
      cb({ query: jest.fn(async (sql: string) => (sql.includes('statement_timeout') ? [] : names.map((metric_name) => ({ metric_name })))) }),
    );

    const result = await service.getDistinctMetricNames(DASH, 201, 'user-1', ['user']);

    expect(result).toEqual(names);
  });
});

/** Routes the names query to `names` and everything else to the grouping lookup. */
function wrapNames(metricsRepo: { manager: { query: jest.Mock } }, names: string[], lookup: Row[]) {
  return async (sql: string) => {
    if (sql.includes('to_regclass')) return [{ present: true }];
    if (/\bFROM ds_metrics\b/.test(sql) && sql.includes('SELECT DISTINCT metric_name')) return names.map((metric_name) => ({ metric_name }));
    if (/\bFROM ds_metrics\b/.test(sql)) return names.map((metric_name) => ({ panel_id: 201, metric_name }));
    if (sql.includes('FROM ds_metric_series_groups')) return lookup;
    return [];
  };
}

describe('getAvailableDashboards with a series group', () => {
  const ROW = {
    dashboard_label: 'Perf',
    panel_title: 'CPU per pod',
    panel_id: 201,
    unit: 'percent',
    metric_count: '3',
    metric_names: ['heap-used', POD_A, POD_B],
  };
  const OTHER = { dashboard_label: 'Perf', panel_title: 'Heap', panel_id: 202, unit: 'MB', metric_count: '1', metric_names: ['used'] };

  it('replaces grouped names with group names and says what each group stands for', async () => {
    const { service, metricsRepo } = build({ lookup: GROUPED });
    metricsRepo.query.mockResolvedValue([ROW, OTHER]);

    const rows = await service.getAvailableDashboards(RUN, 'user-1', ['user']);

    expect(rows[0]).toEqual({
      ...ROW,
      metric_count: '2',
      metric_names: ['api', 'heap-used'],
      series_groups: [{ group: 'api', members: [POD_B, POD_A].sort(), aggregation: 'avg' }],
    });
    // A panel with no grouping is returned exactly as the query produced it.
    expect(rows[1]).toEqual(OTHER);
    expect(Object.keys(rows[1]!)).not.toContain('series_groups');
  });

  it('keeps metric_count a bigint string of the names it now returns', async () => {
    const { service, metricsRepo } = build({ lookup: GROUPED });
    metricsRepo.query.mockResolvedValue([ROW]);

    const [row] = await service.getAvailableDashboards(RUN, 'user-1', ['user']);

    expect(typeof row!.metric_count).toBe('string');
    expect(row!.metric_count).toBe(String((row!.metric_names as string[]).length));
  });

  it('lists the member-count series beside its group', async () => {
    const lookup = [membershipRow(POD_A, { member_count_name: 'api (pod count)' }), membershipRow(POD_B, { member_count_name: 'api (pod count)' })];
    const { service, metricsRepo } = build({ lookup });
    metricsRepo.query.mockResolvedValue([{ ...ROW, metric_names: [POD_A, POD_B] }]);

    const [row] = await service.getAvailableDashboards(RUN, 'user-1', ['user']);

    expect(row!.metric_names).toEqual(['api', 'api (pod count)']);
    expect(row!.series_groups).toEqual([{ group: 'api', members: [POD_B, POD_A].sort(), aggregation: 'avg', member_count_name: 'api (pod count)' }]);
  });

  it('returns raw names, and consults nothing, with members=true', async () => {
    const { service, metricsRepo } = build({ lookup: GROUPED });
    metricsRepo.query.mockResolvedValue([ROW]);

    const rows = await service.getAvailableDashboards(RUN, 'user-1', ['user'], true);

    expect(rows).toEqual([ROW]);
    expect(metricsRepo.manager.query).not.toHaveBeenCalled();
  });

  it('groups a live run by the current rule, matching the rule\'s dashboard by label', async () => {
    const { service, metricsRepo } = build({ lookup: [ruleRow()] });
    metricsRepo.query.mockResolvedValue([ROW]);

    const [row] = await service.getAvailableDashboards(RUN, 'user-1', ['user']);

    expect(row!.metric_names).toEqual(['api', 'heap-used']);
  });

  it('does not group a dashboard whose label no rule is for', async () => {
    const { service, metricsRepo } = build({ lookup: [ruleRow({ dashboard_label: 'Another' })] });
    metricsRepo.query.mockResolvedValue([ROW]);

    expect(await service.getAvailableDashboards(RUN, 'user-1', ['user'])).toEqual([ROW]);
  });

  it('leaves the rows alone, with one lookup, when the run has no grouping', async () => {
    const { service, metricsRepo } = build({ lookup: [] });
    metricsRepo.query.mockResolvedValue([ROW]);

    expect(await service.getAvailableDashboards(RUN, 'user-1', ['user'])).toEqual([ROW]);
    expect(metricsRepo.manager.query).toHaveBeenCalledTimes(2); // presence probe + lookup
  });
});

describe('getMetricTimeSeries with a series group', () => {
  function withQueryBuilder(metricsRepo: { createQueryBuilder: jest.Mock }) {
    const qb: Record<string, jest.Mock> = {};
    for (const m of ['select', 'where', 'andWhere', 'orderBy', 'addOrderBy']) qb[m] = jest.fn().mockReturnValue(qb);
    qb.getMany = jest.fn().mockResolvedValue([{ metric_name: POD_A }]);
    metricsRepo.createQueryBuilder.mockReturnValue(qb);
    return qb;
  }

  it('answers a group name from its members, aggregated, addressed by label and title', async () => {
    const { service, metricsRepo } = build({ lookup: [membershipRow(POD_A, { aggregation: 'max' }), membershipRow(POD_B, { aggregation: 'max' })] });
    const qb = withQueryBuilder(metricsRepo);
    const rows = [{ time: new Date('2024-01-01T10:00:00Z'), metric_name: 'api', value: 9, timestep: 1, ramp_up: false, unit: 'percent' }];
    metricsRepo.query.mockResolvedValue(rows);

    const result = await service.getMetricTimeSeries(RUN, 'Perf', 'CPU per pod', 'api', false, 'user-1', ['user']);

    expect(result).toEqual(rows);
    expect(qb.getMany).not.toHaveBeenCalled();
    const [read] = reads(metricsRepo);
    expect(read!.sql).toContain('m.test_run_id = $1 AND m.dashboard_label = $2 AND m.panel_title = $3');
    expect(read!.sql).toContain("WHEN 'max' THEN MAX(m.value)");
    expect(read!.sql).toContain('MIN(m.unit) AS unit');
    expect(read!.sql).toMatch(/ORDER BY metric_name, "time"/);
    expect(read!.params).toEqual([RUN, 'Perf', 'CPU per pod', [POD_B, POD_A].sort(), ['api', 'api'], ['max', 'max'], [POD_B, POD_A].sort()]);
  });

  it('keeps the ramp-up exclusion the caller asked for', async () => {
    const { service, metricsRepo } = build({ lookup: GROUPED });
    withQueryBuilder(metricsRepo);
    metricsRepo.query.mockResolvedValue([]);

    await service.getMetricTimeSeries(RUN, 'Perf', 'CPU per pod', 'api', true, 'user-1', ['user']);

    expect(reads(metricsRepo)[0]!.sql).toContain('m.ramp_up = false');
  });

  it('returns the per-pod series with members=true', async () => {
    const { service, metricsRepo } = build({ lookup: GROUPED });
    withQueryBuilder(metricsRepo);
    metricsRepo.query.mockResolvedValue([]);

    await service.getMetricTimeSeries(RUN, 'Perf', 'CPU per pod', 'api', false, 'user-1', ['user'], true);

    const [read] = reads(metricsRepo);
    expect(read!.sql).not.toContain('GROUP BY');
    expect(read!.params[3]).toEqual([POD_B, POD_A].sort());
  });

  it('keeps the query-builder path for a raw name', async () => {
    const { service, metricsRepo } = build({ lookup: GROUPED });
    const qb = withQueryBuilder(metricsRepo);

    await service.getMetricTimeSeries(RUN, 'Perf', 'CPU per pod', POD_A, false, 'user-1', ['user']);

    expect(qb.getMany).toHaveBeenCalled();
    expect(metricsRepo.query).not.toHaveBeenCalled();
  });

  it('keeps the query-builder path when no name is given, and never consults the grouping tables', async () => {
    const { service, metricsRepo } = build({ lookup: GROUPED });
    const qb = withQueryBuilder(metricsRepo);

    await service.getMetricTimeSeries(RUN, 'Perf', 'CPU per pod', undefined, false, 'user-1', ['user']);

    expect(qb.getMany).toHaveBeenCalled();
    expect(metricsRepo.manager.query).not.toHaveBeenCalled();
  });
});

describe('MetricsController: members=true reaches the readers', () => {
  function controllerWithSpy() {
    const service = {
      getAvailableDashboards: jest.fn().mockResolvedValue([]),
      getMetricTimeSeries: jest.fn().mockResolvedValue([]),
      findDSMetricsForPanel: jest.fn().mockResolvedValue([]),
      getDistinctMetricNames: jest.fn().mockResolvedValue([]),
    };
    return { service, controller: new MetricsController(service as never, {} as never) };
  }
  const ctx = { userId: 'user-1', roles: ['user'] } as never;

  it.each([
    ['true', true],
    [undefined, false],
    ['false', false],
    ['1', false],
  ])('ds-metrics/available: members=%s -> %s', async (raw, expected) => {
    const { service, controller } = controllerWithSpy();
    await controller.getAvailableDashboards(RUN, ctx, raw);
    expect(service.getAvailableDashboards).toHaveBeenCalledWith(RUN, 'user-1', ['user'], expected);
  });

  it('ds-metrics/time-series passes members last', async () => {
    const { service, controller } = controllerWithSpy();
    await controller.getMetricTimeSeries(RUN, ctx, 'Perf', 'CPU', 'api', 'true', 'true');
    expect(service.getMetricTimeSeries).toHaveBeenCalledWith(RUN, 'Perf', 'CPU', 'api', true, 'user-1', ['user'], true);
  });

  it('ds-metrics/:testRunId/:panelId passes members after the zoom window', async () => {
    const { service, controller } = controllerWithSpy();
    await controller.getDSMetricsForPanel(RUN, '201', ctx, undefined, DASH, undefined, undefined, undefined, 'true');
    expect(service.findDSMetricsForPanel).toHaveBeenCalledWith(RUN, 201, DASH, undefined, 'user-1', ['user'], undefined, undefined, true);
  });

  it('ds-metrics/distinct-names passes members last', async () => {
    const { service, controller } = controllerWithSpy();
    await controller.getDistinctMetricNames(ctx, DASH, '201', undefined, RUN, 'true');
    expect(service.getDistinctMetricNames).toHaveBeenCalledWith(DASH, 201, 'user-1', ['user'], undefined, RUN, true);
  });
});
