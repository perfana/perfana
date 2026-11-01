import { SeriesGroupResolver, buildSeriesRelation, mapNamesToGroups, type SeriesGroup } from './series-group-resolver';

const RUN = 'run-1';
const DASH = '6f1c1c52-0000-4000-8000-000000000001';
const POD_A = 'api-7d9f8c6b5-x2k4p';
const POD_B = 'api-7d9f8c6b5-m4nb6';

type Row = Record<string, unknown>;

/** A membership row as the lookup statement returns it. */
const membership = (over: Row = {}): Row => ({
  kind: 'm',
  application_dashboard_id: DASH,
  panel_id: 201,
  dashboard_label: 'Perf',
  panel_title: 'CPU per pod',
  metric_name: POD_A,
  group_name: 'api',
  aggregation: 'avg',
  member_count_name: null,
  preset: null,
  pattern: null,
  replacement: null,
  track_member_count: null,
  ...over,
});

/** A rule candidate as the lookup statement returns it. */
const rule = (over: Row = {}): Row => ({
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
 * A queryable that answers by statement: the presence probe, the lookup, and (for the
 * live-run fallback only) the read of the panel's raw names.
 */
function queryable(opts: { present?: boolean; lookup?: Row[]; names?: Row[]; failLookup?: boolean } = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('to_regclass')) return [{ present: opts.present ?? true }];
    if (/\bFROM ds_metrics\b/.test(sql)) return opts.names ?? [];
    if (opts.failLookup) throw new Error('boom');
    return opts.lookup ?? [];
  });
  return { query, calls };
}

const touchedDsMetrics = (calls: Array<{ sql: string }>) => calls.some((c) => /\bFROM ds_metrics\b/.test(c.sql));

describe('SeriesGroupResolver', () => {
  describe('a panel nothing groups', () => {
    it('costs one lookup against the grouping tables and never touches ds_metrics', async () => {
      const q = queryable();
      const groups = await new SeriesGroupResolver().groupsForPanel(
        q,
        { testRunId: RUN, applicationDashboardId: DASH, panelId: 201 },
        [POD_A, 'heap-used'],
      );

      expect(groups).toEqual([]);
      // The presence probe, then the single lookup.
      expect(q.calls).toHaveLength(2);
      expect(touchedDsMetrics(q.calls)).toBe(false);
      expect(q.calls[1]!.sql).toContain('FROM ds_metric_series_groups g');
      expect(q.calls[1]!.sql).toContain('FROM series_grouping_rules r');
      expect(q.calls[1]!.params).toEqual([RUN, DASH, 201]);
    });

    it('remembers that the tables exist, so later lookups are one statement', async () => {
      const q = queryable();
      const resolver = new SeriesGroupResolver();
      const ref = { testRunId: RUN, applicationDashboardId: DASH, panelId: 201 };

      await resolver.groupsForPanel(q, ref, []);
      await resolver.groupsForPanel(q, ref, []);

      expect(q.calls.filter((c) => c.sql.includes('to_regclass'))).toHaveLength(1);
      expect(q.calls).toHaveLength(3);
    });

    it('does nothing at all while migration 1819 has not run, and keeps probing until it has', async () => {
      const q = queryable({ present: false });
      const resolver = new SeriesGroupResolver();
      const ref = { testRunId: RUN, applicationDashboardId: DASH, panelId: 201 };

      expect(await resolver.groupsForPanel(q, ref, [POD_A])).toEqual([]);
      expect(await resolver.groupsForPanel(q, ref, [POD_A])).toEqual([]);

      // Neither grouping table is named in a statement that could fail on a missing table.
      expect(q.calls.every((c) => c.sql.includes('to_regclass'))).toBe(true);
      expect(q.calls).toHaveLength(2);
    });

    it('never throws: a failing lookup reads as "nothing grouped"', async () => {
      const q = queryable({ failLookup: true });
      await expect(
        new SeriesGroupResolver().groupsForPanel(q, { testRunId: RUN, applicationDashboardId: DASH, panelId: 201 }, []),
      ).resolves.toEqual([]);
    });

    it('answers a reference that addresses no panel with nothing, without querying', async () => {
      const q = queryable();
      const groups = await new SeriesGroupResolver().groupsForPanel(q, { testRunId: RUN, panelId: 201 });
      expect(groups).toEqual([]);
      expect(q.calls.every((c) => c.sql.includes('to_regclass'))).toBe(true);
    });
  });

  describe('membership rows', () => {
    const rows = [
      membership({ metric_name: POD_A }),
      membership({ metric_name: POD_B }),
      // A series nothing renamed is a "group of one" in the table: not a group to expand.
      membership({ metric_name: 'heap-used', group_name: 'heap-used' }),
    ];

    it('win: the stored membership is the answer, even though a rule candidate exists', async () => {
      // Even if a lookup returned a rule beside membership, membership is what the run's
      // statistics were computed with, so a chart has to agree with it.
      const q = queryable({ lookup: [...rows, rule({ preset: 'trailing-id' })] });

      const groups = await new SeriesGroupResolver().groupsForPanel(
        q,
        { testRunId: RUN, applicationDashboardId: DASH, panelId: 201 },
        [POD_A, POD_B, 'heap-used'],
      );

      expect(groups).toEqual<SeriesGroup[]>([
        { group: 'api', members: [POD_B, POD_A].sort(), aggregation: 'avg', memberCountName: null },
      ]);
      // No raw-name read: membership already says it all.
      expect(touchedDsMetrics(q.calls)).toBe(false);
    });

    it('guards the rule arm with NOT EXISTS so a run with membership never joins the rules', async () => {
      const q = queryable({ lookup: rows });
      await new SeriesGroupResolver().groupsForPanel(q, { testRunId: RUN, applicationDashboardId: DASH, panelId: 201 });

      expect(q.calls[1]!.sql).toMatch(/AND NOT EXISTS \(SELECT 1 FROM ds_metric_series_groups g2/);
    });

    it('carries the stored aggregation and the member-count name', async () => {
      const q = queryable({
        lookup: [
          membership({ metric_name: POD_A, aggregation: 'sum', member_count_name: 'api (pod count)' }),
          membership({ metric_name: POD_B, aggregation: 'sum', member_count_name: 'api (pod count)' }),
        ],
      });

      const [group] = await new SeriesGroupResolver().groupsForPanel(q, {
        testRunId: RUN,
        applicationDashboardId: DASH,
        panelId: 201,
      });

      expect(group).toMatchObject({ group: 'api', aggregation: 'sum', memberCountName: 'api (pod count)' });
    });

    it('treats a single renamed pod as a group, because its group name exists nowhere in ds_metrics', async () => {
      const q = queryable({ lookup: [membership({ metric_name: POD_A })] });
      const groups = await new SeriesGroupResolver().groupsForPanel(q, {
        testRunId: RUN,
        applicationDashboardId: DASH,
        panelId: 201,
      });
      expect(groups).toEqual([{ group: 'api', members: [POD_A], aggregation: 'avg', memberCountName: null }]);
    });
  });

  describe('live-run fallback: no membership, the current rule applies', () => {
    const ref = { testRunId: RUN, applicationDashboardId: DASH, panelId: 201 };

    it('applies the rule to the raw names the caller holds, without reading ds_metrics', async () => {
      const q = queryable({ lookup: [rule()] });

      const groups = await new SeriesGroupResolver().groupsForPanel(q, ref, [POD_A, POD_B, 'heap-used']);

      expect(groups).toEqual([{ group: 'api', members: [POD_B, POD_A].sort(), aggregation: 'avg', memberCountName: null }]);
      expect(touchedDsMetrics(q.calls)).toBe(false);
    });

    it('names the member-count series the rule tracks', async () => {
      const q = queryable({ lookup: [rule({ track_member_count: true, aggregation: 'max' })] });

      const [group] = await new SeriesGroupResolver().groupsForPanel(q, ref, [POD_A, POD_B]);

      expect(group).toMatchObject({ group: 'api', aggregation: 'max', memberCountName: 'api (pod count)' });
    });

    it('prefers a panel rule over a dashboard-wide rule', async () => {
      const q = queryable({
        lookup: [rule({ panel_id: null, preset: 'trailing-id' }), rule({ panel_id: 201, preset: 'k8s-pod', aggregation: 'sum' })],
      });

      const [group] = await new SeriesGroupResolver().groupsForPanel(q, ref, [POD_A, POD_B]);

      // `trailing-id` would have produced "api-7d9f8c6b5" / "api" differently; the panel rule is k8s-pod.
      expect(group).toMatchObject({ group: 'api', aggregation: 'sum' });
    });

    it('reads the panel\'s series from ds_metrics only when a rule candidate exists and none were given', async () => {
      const q = queryable({
        lookup: [rule()],
        names: [
          { panel_id: 201, metric_name: POD_A },
          { panel_id: 201, metric_name: POD_B },
        ],
      });

      const groups = await new SeriesGroupResolver().groupsForPanel(q, ref);

      expect(groups.map((g) => g.group)).toEqual(['api']);
      const read = q.calls.find((c) => /\bFROM ds_metrics\b/.test(c.sql))!;
      expect(read.sql).toContain('SELECT DISTINCT panel_id, metric_name');
      expect(read.params).toEqual([RUN, DASH, 201]);
    });

    it('does not read ds_metrics when there is no rule candidate', async () => {
      const q = queryable({ lookup: [] });
      await new SeriesGroupResolver().groupsForPanel(q, ref);
      expect(touchedDsMetrics(q.calls)).toBe(false);
    });

    it('skips a rule that does not compile instead of throwing', async () => {
      const q = queryable({ lookup: [rule({ preset: 'custom', pattern: '(a+)+' })] });
      await expect(new SeriesGroupResolver().groupsForPanel(q, ref, [POD_A])).resolves.toEqual([]);
    });
  });

  describe('addressed by label and title', () => {
    it('matches membership on label and title, and rules through the dashboard label', async () => {
      const q = queryable();

      await new SeriesGroupResolver().groupsForPanel(q, {
        testRunId: RUN,
        dashboardLabel: 'Perf',
        panelTitle: 'CPU per pod',
      });

      const lookup = q.calls[1]!;
      expect(lookup.sql).toContain('g.dashboard_label = $2');
      expect(lookup.sql).toContain('g.panel_title = $3');
      expect(lookup.sql).toContain('ad.dashboard_label = $2');
      expect(lookup.params).toEqual([RUN, 'Perf', 'CPU per pod']);
    });

    it('applies a rule per panel id found in ds_metrics, since the caller has only a title', async () => {
      const q = queryable({
        lookup: [rule({ panel_id: 201 })],
        names: [
          { panel_id: 201, metric_name: POD_A },
          { panel_id: 201, metric_name: POD_B },
          // Another panel under the same title that the panel rule does not cover.
          { panel_id: 202, metric_name: POD_A },
        ],
      });

      const groups = await new SeriesGroupResolver().groupsForPanel(q, {
        testRunId: RUN,
        dashboardLabel: 'Perf',
        panelTitle: 'CPU per pod',
      });

      expect(groups).toEqual([{ group: 'api', members: [POD_B, POD_A].sort(), aggregation: 'avg', memberCountName: null }]);
      const read = q.calls.find((c) => /\bFROM ds_metrics\b/.test(c.sql))!;
      expect(read.sql).toContain('dashboard_label = $2');
      expect(read.sql).toContain('panel_title = $3');
    });
  });

  describe('expand', () => {
    const lookup = [
      membership({ metric_name: POD_A, member_count_name: 'api (pod count)' }),
      membership({ metric_name: POD_B, member_count_name: 'api (pod count)' }),
    ];
    const ref = { testRunId: RUN, applicationDashboardId: DASH, panelId: 201 };

    it('turns a group name into its members', async () => {
      const q = queryable({ lookup });
      const { raw, groups } = await new SeriesGroupResolver().expand(q, ref, ['api']);
      expect(raw).toEqual([]);
      expect(groups).toEqual([
        { group: 'api', members: [POD_B, POD_A].sort(), aggregation: 'avg', memberCountName: 'api (pod count)' },
      ]);
    });

    it('turns a member-count name into COUNT over the same members', async () => {
      // The count series exists only in ds_metric_statistics, never in ds_metrics.
      const q = queryable({ lookup });
      const { raw, groups } = await new SeriesGroupResolver().expand(q, ref, ['api (pod count)']);
      expect(raw).toEqual([]);
      expect(groups).toEqual([
        { group: 'api (pod count)', members: [POD_B, POD_A].sort(), aggregation: 'count', memberCountName: null },
      ]);
    });

    it('passes a non-group name straight through, a raw pod name included', async () => {
      const q = queryable({ lookup });
      const { raw, groups } = await new SeriesGroupResolver().expand(q, ref, [POD_A, 'heap-used']);
      expect(raw).toEqual([POD_A, 'heap-used']);
      expect(groups).toEqual([]);
    });

    it('splits a mixed request', async () => {
      const q = queryable({ lookup });
      const { raw, groups } = await new SeriesGroupResolver().expand(q, ref, ['heap-used', 'api', 'api']);
      expect(raw).toEqual(['heap-used']);
      expect(groups.map((g) => g.group)).toEqual(['api']);
    });

    it('passes everything through when nothing is grouped, after one lookup and no ds_metrics read', async () => {
      const q = queryable();
      const { raw, groups } = await new SeriesGroupResolver().expand(q, ref, ['api']);
      expect(raw).toEqual(['api']);
      expect(groups).toEqual([]);
      expect(touchedDsMetrics(q.calls)).toBe(false);
    });

    it('asks nothing for an empty request', async () => {
      const q = queryable();
      await new SeriesGroupResolver().expand(q, ref, []);
      expect(q.query).not.toHaveBeenCalled();
    });
  });

  describe('a whole run, for the pickers', () => {
    it('loads membership and rules for the run in one statement', async () => {
      const q = queryable({ lookup: [membership({ metric_name: POD_A }), membership({ metric_name: POD_B }), rule()] });
      const resolver = new SeriesGroupResolver();

      const run = await resolver.loadRun(q, RUN);

      expect(run.isEmpty).toBe(false);
      expect(q.calls).toHaveLength(2);
      expect(q.calls[1]!.params).toEqual([RUN]);
      expect(q.calls[1]!.sql).not.toContain('NOT EXISTS');

      const panel = { dashboardLabel: 'Perf', panelTitle: 'CPU per pod', panelId: 201 };
      expect(resolver.groupsInRun(run, panel, [POD_A, POD_B]).map((g) => g.group)).toEqual(['api']);
    });

    it('falls back to the rule for a panel the run has no membership for', async () => {
      const q = queryable({ lookup: [membership({ panel_id: 999, metric_name: POD_A }), rule()] });
      const resolver = new SeriesGroupResolver();
      const run = await resolver.loadRun(q, RUN);

      const groups = resolver.groupsInRun(
        run,
        { dashboardLabel: 'Perf', panelTitle: 'Memory per pod', panelId: 202 },
        [POD_A, POD_B],
      );

      expect(groups.map((g) => g.group)).toEqual(['api']);
    });

    it('is empty for a run nothing groups', async () => {
      const run = await new SeriesGroupResolver().loadRun(queryable(), RUN);
      expect(run.isEmpty).toBe(true);
    });
  });
});

describe('mapNamesToGroups', () => {
  const groups: SeriesGroup[] = [
    { group: 'api', members: [POD_A, POD_B], aggregation: 'avg', memberCountName: 'api (pod count)' },
  ];

  it('replaces covered names with the group and its count series, sorted, and keeps the rest', () => {
    const { names, seriesGroups } = mapNamesToGroups([POD_A, 'heap-used', POD_B], groups);
    expect(names).toEqual(['api', 'api (pod count)', 'heap-used']);
    expect(seriesGroups).toEqual([{ ...groups[0], members: [POD_A, POD_B] }]);
  });

  it('lists only the members this panel actually has', () => {
    const { seriesGroups } = mapNamesToGroups([POD_A], groups);
    expect(seriesGroups[0]!.members).toEqual([POD_A]);
  });

  it('returns no series group for a group none of whose members are present', () => {
    expect(mapNamesToGroups(['heap-used'], groups).seriesGroups).toEqual([]);
  });
});

describe('buildSeriesRelation', () => {
  const group: SeriesGroup = {
    group: "api'; DROP TABLE ds_metrics; --",
    members: [POD_A, POD_B],
    aggregation: 'sum',
    memberCountName: null,
  };
  const base = { alias: 'm', conditions: ['m.test_run_id = $1', 'm.panel_id = $2'], params: [RUN, 201] };

  it('combines members per timestamp, with the stored aggregation, in bound arrays', () => {
    const { sql, params } = buildSeriesRelation({ ...base, groups: [group] });

    expect(sql).toMatch(/GROUP BY m\."time", g\.group_name/);
    expect(sql).toContain("WHEN 'sum' THEN SUM(m.value)");
    expect(sql).toContain("WHEN 'max' THEN MAX(m.value)");
    expect(sql).toContain("WHEN 'count' THEN COUNT(*)::double precision");
    expect(sql).toContain('ELSE AVG(m.value)');
    expect(sql).toContain('bool_and(m.ramp_up) AS ramp_up');
    expect(sql).toContain('m.test_run_id = $1 AND m.panel_id = $2');
    expect(params).toEqual([
      RUN,
      201,
      [POD_A, POD_B],
      [group.group, group.group],
      ['sum', 'sum'],
      [POD_A, POD_B],
    ]);
  });

  it('never interpolates a name: the group name appears only as a bound value', () => {
    const { sql } = buildSeriesRelation({ ...base, groups: [group] });
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).not.toContain(POD_A);
  });

  it('carries every group of the request through one scan', () => {
    const second: SeriesGroup = { group: 'db', members: ['db-aaaaa-bbbbb'], aggregation: 'max', memberCountName: null };
    const { sql, params } = buildSeriesRelation({ ...base, groups: [group, second] });

    expect(sql.match(/FROM ds_metrics m/g)).toHaveLength(1);
    expect(params[2]).toEqual([POD_A, POD_B, 'db-aaaaa-bbbbb']);
    expect(params[3]).toEqual([group.group, group.group, 'db']);
    expect(params[4]).toEqual(['sum', 'sum', 'max']);
  });

  it('adds the plain series of a whole-panel read beside the groups', () => {
    const { sql, params } = buildSeriesRelation({ ...base, groups: [group], excludeNames: [POD_A, POD_B] });

    expect(sql).toContain('UNION ALL');
    expect(sql).toContain('NOT (m.metric_name = ANY($3::text[]))');
    expect(params[2]).toEqual([POD_A, POD_B]);
  });

  it('reads members raw, unaggregated, for a drill-down', () => {
    const { sql, params } = buildSeriesRelation({ ...base, rawNames: [POD_A, POD_B] });

    expect(sql).not.toContain('GROUP BY');
    expect(sql).toContain('m.metric_name = ANY($3::text[])');
    expect(params[2]).toEqual([POD_A, POD_B]);
  });

  it('takes the alias and extra columns of the caller', () => {
    const { sql } = buildSeriesRelation({
      alias: 'dm',
      conditions: ['dm.test_run_id = $1'],
      params: [RUN],
      groups: [group],
      attributes: ['unit', 'panel_title'],
    });

    expect(sql).toContain('MIN(dm.unit) AS unit');
    expect(sql).toContain('MIN(dm.panel_title) AS panel_title');
    expect(sql).toContain('FROM ds_metrics dm');
  });

  it('does not mutate the caller\'s parameter list', () => {
    const params = [RUN, 201];
    buildSeriesRelation({ ...base, params, groups: [group] });
    expect(params).toEqual([RUN, 201]);
  });
});
