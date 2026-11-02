/**
 * Series grouping at the statistics layer (docs/design/2026-11-01-series-grouping-plan.md, Task 3).
 *
 * Every query is answered by SQL text, not call order: the whole point of these tests is which
 * statements a batch issues, so an ordered mock would encode the thing under test.
 */
import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { StatisticsPipeline } from '../../../pipelines/StatisticsPipeline.js';
import {
  buildMembership,
  buildGroupedExclusion,
  buildGroupedStatisticsSQL,
  derivedCompareConfigParams,
  derivedSeriesConfigRows,
  groupedStatementParams,
  hasExtraAggregations,
  insertMembershipSql,
  INSERT_DERIVED_COMPARE_CONFIG_SQL,
  membershipInsertParams,
  seriesGroupingRulesSql,
  type LoadedRule,
  type MembershipRow,
  type SeriesRow,
} from '../../../pipelines/helpers/series-grouping-plan.js';
import { buildStatisticsInsertSQL } from '../../../pipelines/helpers/statistics-sql.js';
import { getLogger } from '../../../lib/utils/logger.js';
import * as databaseAccessor from '../../../common/database-accessor.js';
import {
  SERIES_GROUPING_AGGREGATIONS,
  seriesGroupingRuleHash,
  type SeriesGroupingRuleSpec,
} from '@perfana/shared/utils';

vi.mock('../../../lib/utils/logger.js');
vi.mock('../../../common/database-accessor.js');

const DASH = '11111111-1111-1111-1111-111111111111';
const OTHER_DASH = '22222222-2222-2222-2222-222222222222';

const spec = (overrides: Partial<SeriesGroupingRuleSpec> = {}): SeriesGroupingRuleSpec => ({
  preset: 'k8s-pod',
  pattern: null,
  replacement: '',
  aggregation: 'avg',
  extraAggregations: [],
  trackMemberCount: false,
  ...overrides,
});

const ruleRow = (overrides: Record<string, unknown> = {}) => ({
  test_run_id: 'run-a',
  id: 'rule-1',
  application_dashboard_id: DASH,
  panel_id: 7,
  system_under_test_id: '33333333-3333-3333-3333-333333333333',
  test_environment: 'acc',
  workload: 'peak',
  preset: 'k8s-pod',
  pattern: null,
  replacement: '',
  aggregation: 'avg',
  extra_aggregations: [],
  track_member_count: false,
  ...overrides,
});

const series = (metric: string, overrides: Partial<SeriesRow> = {}): SeriesRow => ({
  test_run_id: 'run-a',
  application_dashboard_id: DASH,
  panel_id: 7,
  metric_name: metric,
  dashboard_label: 'K8s resources',
  panel_title: 'CPU per pod',
  ...overrides,
});

describe('StatisticsPipeline — series grouping', () => {
  let pipeline: StatisticsPipeline;
  let logger: { info: any; warn: any; error: any; debug: any };
  let tablesPresent: boolean;
  let columnPresent: boolean;
  let rulesRows: Array<Record<string, unknown>>;
  let rulesError: Error | null;
  let existingMembership: boolean;
  let seriesRows: SeriesRow[];
  let alignmentRows: Array<Record<string, unknown>>;
  let pooled: Array<{ sql: string; params?: unknown[] }>;
  let tx: Array<{ sql: string; params?: unknown[] }>;
  /** Every in-transaction statement, settings included, in order. */
  let txAll: string[];

  const txWith = (needle: string) => tx.filter((c) => c.sql.includes(needle));

  beforeEach(() => {
    vi.clearAllMocks();
    tablesPresent = true;
    columnPresent = true;
    rulesRows = [];
    rulesError = null;
    existingMembership = false;
    seriesRows = [];
    alignmentRows = [];
    pooled = [];
    tx = [];
    txAll = [];

    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    vi.mocked(getLogger).mockReturnValue(logger as any);

    const manager = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        const text = String(sql);
        txAll.push(text);
        // Postgres, not a stub: a statement that NAMES a column the database does not have raises
        // 42703. Without this the missing-column case is unrepresentable — every in-transaction
        // statement resolved to `[undefined, 0]` however the column list was built — which is
        // exactly how the unconditional membership INSERT reached review. The DO-NOT-name rule
        // applies to the column list, not to the `pg_attribute` probe that asks whether it exists.
        if (!columnPresent && !text.includes('attname') && /\bextra_aggregations\b/.test(text)) {
          const err: Error & { code?: string } = new Error(
            'column "extra_aggregations" of relation "ds_metric_series_groups" does not exist',
          );
          err.code = '42703';
          throw err;
        }
        if (text.includes("current_setting('enable_mergejoin')")) return [{ previous: 'on' }];
        if (text.includes('set_config') || text.includes('SET LOCAL') || text.includes('UPDATE ds_metrics')) return undefined;
        tx.push({ sql: text, params });
        if (text.includes('grouped_points')) return alignmentRows;
        if (text.includes('application_dashboard_id = ANY($2::uuid[])')) {
          const runId = String(params?.[0]);
          const dashboards = new Set((params?.[1] as string[]) ?? []);
          return seriesRows.filter((s) => s.test_run_id === runId && dashboards.has(s.application_dashboard_id));
        }
        if (text.includes('DELETE FROM ds_metric_statistics')) return [[], 3];
        if (text.includes('DELETE FROM ds_metric_series_groups')) return [[], 2];
        if (text.includes('SELECT COUNT(*)::integer as count')) return [{ count: 4 }];
        return undefined;
      }),
    };

    const db = {
      transaction: vi.fn((fn: (m: unknown) => unknown) => fn(manager)),
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        const text = String(sql);
        pooled.push({ sql: text, params });
        if (text.includes('has_metrics')) return [{ has_metrics: true }];
        if (text.includes('m.ramp_up IS DISTINCT FROM')) return [];
        if (text.includes('to_regclass')) return [{ present: tablesPresent, has_extras: columnPresent }];
        if (text.includes('JOIN series_grouping_rules')) {
          if (rulesError) throw rulesError;
          // Honour the projection, as Postgres does: a statement that selected NULL::varchar(8)[]
          // cannot hand back the column. Without this both probe arms see the fixture's extras
          // and the pre-1820 conditional is untested.
          const projectsNull = /NULL::varchar\(8\)\[\] AS extra_aggregations/.test(text);
          return projectsNull
            ? rulesRows.map((r) => ({ ...r, extra_aggregations: null }))
            : rulesRows;
        }
        if (text.includes('FROM ds_metric_series_groups')) return [{ present: existingMembership }];
        return [undefined, 0];
      }),
      decompressChunksForRange: vi.fn().mockResolvedValue(undefined),
      recompressTouchedChunks: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(databaseAccessor.getDatabaseService).mockReturnValue(db as any);
    pipeline = new StatisticsPipeline(logger as any);
  });

  afterEach(() => vi.restoreAllMocks());

  const mainInsert = () =>
    tx.find((c) => c.sql.includes('INSERT INTO ds_metric_statistics') && !c.sql.includes('grouped_points'))!;

  describe('a batch that groups nothing keeps today\'s statements', () => {
    test('tables absent: no grouping statement and the unchanged aggregation SQL', async () => {
      tablesPresent = false;
      const result = await pipeline.execute({ testRunIds: ['run-a', 'run-b'] });

      expect(result.success).toBe(true);
      expect(pooled.some((c) => c.sql.includes('JOIN series_grouping_rules'))).toBe(false);
      expect(txWith('ds_metric_series_groups')).toHaveLength(0);
      expect(txWith('grouped_points')).toHaveLength(0);
      expect(mainInsert().sql).toBe(buildStatisticsInsertSQL('$1, $2'));
      expect(mainInsert().params).toEqual(['run-a', 'run-b']);
    });

    test('rule loading throws: the batch still succeeds, ungrouped, with a warning', async () => {
      rulesError = new Error('relation "series_grouping_rules" does not exist');
      const result = await pipeline.execute({ testRunIds: ['run-a'] });

      expect(result.success).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: rulesError }),
        expect.stringContaining('series-grouping: rules unavailable'),
      );
      expect(txWith('ds_metric_series_groups')).toHaveLength(0);
      expect(mainInsert().sql).toBe(buildStatisticsInsertSQL('$1'));
    });

    test('tables present, no rules, no old membership: nothing extra inside the transaction', async () => {
      await pipeline.execute({ testRunIds: ['run-a'] });

      expect(txWith('ds_metric_series_groups')).toHaveLength(0);
      expect(tx.map((c) => c.sql.split('\n').find((l) => l.trim())!.trim().slice(0, 30))).toHaveLength(3);
      expect(mainInsert().sql).toBe(buildStatisticsInsertSQL('$1'));
    });

    test('a removed rule: old membership is deleted, statistics stay ungrouped', async () => {
      existingMembership = true;
      await pipeline.execute({ testRunIds: ['run-a'] });

      const deletes = txWith('DELETE FROM ds_metric_series_groups');
      expect(deletes).toHaveLength(1);
      expect(deletes[0]!.params).toEqual(['run-a']);
      expect(txWith('INSERT INTO ds_metric_series_groups')).toHaveLength(0);
      expect(txWith('grouped_points')).toHaveLength(0);
      expect(mainInsert().sql).toBe(buildStatisticsInsertSQL('$1'));
    });
  });

  describe('a batch with one grouped panel', () => {
    beforeEach(() => {
      rulesRows = [ruleRow({ track_member_count: true })];
      seriesRows = [
        series('api-7d9f8c6b5-x2k4p'),
        series('api-7d9f8c6b5-z9w2t'),
        series('worker-6b8f7d9c4-h5k2l'),
        // Same dashboard, another panel: no rule covers it, so it stays ungrouped.
        series('heap-used', { panel_id: 8 }),
      ];
      alignmentRows = [
        { test_run_id: 'run-a', application_dashboard_id: DASH, panel_id: 7, group_name: 'api', avg_members: 2 },
        { test_run_id: 'run-a', application_dashboard_id: DASH, panel_id: 7, group_name: 'worker', avg_members: 1 },
      ];
    });

    test('loads the rules per run, before the transaction, excluding perf-test dashboards', async () => {
      await pipeline.execute({ testRunIds: ['run-a'] });

      const rulesQuery = pooled.find((c) => c.sql.includes('JOIN series_grouping_rules'))!;
      expect(rulesQuery.sql).toBe(seriesGroupingRulesSql(true));
      expect(rulesQuery.params).toEqual([['run-a']]);
      expect(seriesGroupingRulesSql(true)).toMatch(/NOT LIKE 'performance-test-metrics-%'/);
      expect(tx.some((c) => c.sql.includes('JOIN series_grouping_rules'))).toBe(false);
    });

    test('reads the series of the touched dashboards once per run', async () => {
      await pipeline.execute({ testRunIds: ['run-a'] });

      const reads = tx.filter((c) => c.sql.includes('application_dashboard_id = ANY($2::uuid[])'));
      expect(reads).toHaveLength(1);
      expect(reads[0]!.params).toEqual(['run-a', [DASH]]);
    });

    test('writes membership for every series of the grouped panel, aligned element for element', async () => {
      await pipeline.execute({ testRunIds: ['run-a'] });

      const insert = txWith('INSERT INTO ds_metric_series_groups')[0]!;
      const [runs, dashes, panels, metrics, groups, memberCounts, , , aggregations, ruleIds, hashes, extras] =
        insert.params as unknown[][];
      expect(metrics).toEqual(['api-7d9f8c6b5-x2k4p', 'api-7d9f8c6b5-z9w2t', 'worker-6b8f7d9c4-h5k2l']);
      expect(groups).toEqual(['api', 'api', 'worker']);
      expect(memberCounts).toEqual(['api (pod count)', 'api (pod count)', 'worker (pod count)']);
      expect(runs).toEqual(['run-a', 'run-a', 'run-a']);
      expect(dashes).toEqual([DASH, DASH, DASH]);
      expect(panels).toEqual([7, 7, 7]);
      expect(aggregations).toEqual(['avg', 'avg', 'avg']);
      // No extras on this rule: one empty string per row, which the statement string_to_arrays
      // back to '{}'. The column is written on every row, the extras ARM is not.
      expect(extras).toEqual(['', '', '']);
      expect(ruleIds).toEqual(['rule-1', 'rule-1', 'rule-1']);
      expect(hashes).toEqual(Array(3).fill(seriesGroupingRuleHash(spec({ trackMemberCount: true }))));
    });

    test('deletes the old membership before writing the new one', async () => {
      await pipeline.execute({ testRunIds: ['run-a'] });

      const del = tx.findIndex((c) => c.sql.includes('DELETE FROM ds_metric_series_groups'));
      const ins = tx.findIndex((c) => c.sql.includes('INSERT INTO ds_metric_series_groups'));
      expect(del).toBeGreaterThan(-1);
      expect(ins).toBeGreaterThan(del);
    });

    test('excludes the grouped panel from the main statement, and only that panel', async () => {
      await pipeline.execute({ testRunIds: ['run-a'] });

      expect(mainInsert().sql).toBe(buildStatisticsInsertSQL('$1', buildGroupedExclusion(2)));
      expect(mainInsert().params).toEqual(['run-a', ['run-a'], [DASH], [7]]);
    });

    test('aggregates the grouped panel in its own statement with aligned member arrays', async () => {
      await pipeline.execute({ testRunIds: ['run-a'] });

      const grouped = txWith('grouped_points');
      expect(grouped).toHaveLength(1);
      const sql = grouped[0]!.sql;
      expect(sql).toContain('INSERT INTO ds_metric_statistics');
      // Never the main statement's CTE: referencing it twice would materialise the raw rows.
      // (Comments in the shared statistics chain may still mention it by name.)
      expect(sql.replace(/--[^\n]*/g, '')).not.toContain('metrics_filtered');
      expect(sql).toContain('UPDATE ds_metric_series_groups');
      const [runId, runs, , , metrics, groups, aggregations, tracked, memberCounts] = grouped[0]!.params as unknown[];
      expect(runId).toBe('run-a');
      expect(runs).toHaveLength(3);
      expect(metrics).toEqual(['api-7d9f8c6b5-x2k4p', 'api-7d9f8c6b5-z9w2t', 'worker-6b8f7d9c4-h5k2l']);
      expect(groups).toEqual(['api', 'api', 'worker']);
      expect(aggregations).toEqual(['avg', 'avg', 'avg']);
      expect(tracked).toEqual([true, true, true]);
      expect(memberCounts).toEqual(['api (pod count)', 'api (pod count)', 'worker (pod count)']);
    });

    // Measured on TimescaleDB 2026-11-01 (1.87 M ds_metrics rows, compressed): the planner
    // estimates the join to the bound member arrays at 1 row against 432,000, picks a merge join
    // and spills a 1.15 M-row sort to disk — 8.5 s. With merge joins off it hash-joins: 3.0 s.
    test('runs the grouped statement with merge joins off, and restores the setting after', async () => {
      await pipeline.execute({ testRunIds: ['run-a'] });

      const grouped = txAll.findIndex((sql) => sql.includes('grouped_points'));
      const off = txAll.findIndex((sql) => sql.includes("set_config('enable_mergejoin', 'off', true)"));
      const restore = txAll.findIndex((sql, i) => i > grouped && sql.includes("set_config('enable_mergejoin'"));
      expect(off).toBeGreaterThan(-1);
      expect(off).toBeLessThan(grouped);
      expect(restore).toBeGreaterThan(grouped);
      // The main statement is planned with the setting untouched.
      const main = txAll.findIndex((sql) => sql.includes('INSERT INTO ds_metric_statistics') && !sql.includes('grouped_points'));
      expect(main).toBeLessThan(off);
    });

    test('warns about a multi-member group whose timestamps do not line up', async () => {
      alignmentRows = [
        { test_run_id: 'run-a', application_dashboard_id: DASH, panel_id: 7, group_name: 'api', avg_members: 1 },
        { test_run_id: 'run-a', application_dashboard_id: DASH, panel_id: 7, group_name: 'worker', avg_members: 1 },
      ];
      await pipeline.execute({ testRunIds: ['run-a'] });

      const warnings = logger.warn.mock.calls.map((c: unknown[]) => String(c.at(-1)));
      expect(warnings.filter((w: string) => w.includes('timestamps are not aligned'))).toHaveLength(1);
      expect(warnings.find((w: string) => w.includes('timestamps are not aligned'))).toContain('"api" has 2 members');
    });

    test('does not warn when members share timestamps', async () => {
      await pipeline.execute({ testRunIds: ['run-a'] });

      const warnings = logger.warn.mock.calls.map((c: unknown[]) => String(c.at(-1)));
      expect(warnings.some((w: string) => w.includes('timestamps are not aligned'))).toBe(false);
    });

    test('logs one summary line', async () => {
      await pipeline.execute({ testRunIds: ['run-a'] });

      const infos = logger.info.mock.calls.map((c: unknown[]) => String(c.at(-1)));
      const summary = infos.filter((l: string) => l.startsWith('series-grouping:'));
      expect(summary).toHaveLength(1);
      expect(summary[0]).toMatch(
        /runs=1 rules=1 panels=1 rawSeries=3 groups=2 memberCountSeries=2 extraSeries=0 in \d+ms/,
      );
    });

    test('a rule with extras writes them on every member row and adds the arm', async () => {
      rulesRows = [ruleRow({ extra_aggregations: ['sum'] })];
      await pipeline.execute({ testRunIds: ['run-a'] });

      const insert = txWith('INSERT INTO ds_metric_series_groups')[0]!;
      // LAST bind position, so it can be dropped on a pre-1820 database without renumbering.
      const extras = (insert.params as unknown[][])[11];
      // Every series on the covered panel is renamed here, so every row carries the extra.
      expect(extras).toEqual(['sum', 'sum', 'sum']);

      const sql = txWith('grouped_points')[0]!.sql;
      expect(sql).toContain("group_name || ' (' || x.agg || ')'");
      expect(sql).toContain('AVG(m.value) AS v_avg');
      // The ninth bound array only exists when the statement reads it.
      expect((txWith('grouped_points')[0]!.params as unknown[]).length).toBe(10);

      const infos = logger.info.mock.calls.map((c: unknown[]) => String(c.at(-1)));
      expect(infos.find((l: string) => l.startsWith('series-grouping:'))).toContain('extraSeries=2');
    });

    /**
     * Value:
     *   protects — a series the rule does not rename is a group of ONE, where SUM equals AVG, so
     *     its membership row must carry no extras even while its siblings on the same panel do.
     *   fails_when — `buildMembership` reads the extras off `rule.spec.extraAggregations` instead
     *     of `grouping.extraAggregations.get(group)`. The grouped statement then emits
     *     `heap-used (sum)` as a second copy of `heap-used`'s own values — a junk series on every
     *     picker, chart and baseline, with nothing logged.
     *   why_new — the extras tests above group only renamed series, so the per-group lookup and a
     *     flat per-rule one are indistinguishable; the ELEMENT-FOR-ELEMENT alignment of the ninth
     *     bound array against the metric names is only observable with a mixed panel.
     *   seam — the INSERT's bound arrays, which are positional.
     */
    test('a series the rule does not rename carries no extras, element for element', async () => {
      rulesRows = [ruleRow({ extra_aggregations: ['sum'] })];
      // Same panel as the pods, and the k8s-pod preset leaves it alone: a group of one.
      seriesRows.push(series('heap-used'));

      await pipeline.execute({ testRunIds: ['run-a'] });

      const insert = txWith('INSERT INTO ds_metric_series_groups')[0]!;
      const params = insert.params as unknown[][];
      expect(params[3]).toEqual([
        'api-7d9f8c6b5-x2k4p',
        'api-7d9f8c6b5-z9w2t',
        'heap-used',
        'worker-6b8f7d9c4-h5k2l',
      ]);
      expect(params[4]).toEqual(['api', 'api', 'heap-used', 'worker']);
      expect(params[11]).toEqual(['sum', 'sum', '', 'sum']);
    });

    /**
     * Value:
     *   protects — the window between v0.2.97.43 (which shipped migration 1819 alone) and 1820
     *     landing, on a worker already rolled out. Grouping needs nothing from 1820, so the run
     *     must be grouped normally with no extras.
     *   fails_when — any statement inside the transaction NAMES `extra_aggregations` while the
     *     column is absent. That was the shipped state: `INSERT_MEMBERSHIP_SQL` was a module
     *     constant naming it unconditionally, so the probe let the rules SELECT through, the
     *     membership DELETE ran, and the INSERT raised 42703 INSIDE withAnalyticsTransaction —
     *     aborting a stage that is not softFail, failing the whole re-evaluate batch, and rolling
     *     the DELETE back so the stale membership the probe exists to remove survived anyway.
     *     Strictly worse than the pre-probe behaviour it replaced.
     *   why_new — `columnPresent` existed but was never set false in any case, and every
     *     in-transaction statement resolved to `[undefined, 0]` regardless of its column list, so
     *     a missing column was unrepresentable. The harness now raises 42703 like Postgres.
     *   seam — the membership INSERT's column list, which is now a function of `extrasPresent`.
     */
    test('pre-1820: the run is still grouped, with no extras and no mention of the column', async () => {
      columnPresent = false;
      rulesRows = [ruleRow({ extra_aggregations: ['sum'] })];

      const result = await pipeline.execute({ testRunIds: ['run-a'] });

      expect(result.success).toBe(true);
      // Grouped, not degraded to ungrouped: membership is written and the panel is excluded.
      const insert = txWith('INSERT INTO ds_metric_series_groups')[0]!;
      expect(insert.sql).not.toMatch(/\bextra_aggregations\b/);
      expect((insert.params as unknown[][]).length).toBe(11);
      expect((insert.params as unknown[][])[4]).toEqual(['api', 'api', 'worker']);
      expect(txWith('grouped_points')).toHaveLength(1);
      // The extras arm is off on its own: a NULL projection coalesces to [] per rule.
      expect(txWith('grouped_points')[0]!.sql).not.toContain('v_avg');
      const infos = logger.info.mock.calls.map((c: unknown[]) => String(c.at(-1)));
      expect(infos.find((l: string) => l.startsWith('series-grouping:'))).toContain('extraSeries=0');
    });

    test('an invalid stored custom rule is skipped with a warning, not applied', async () => {
      rulesRows = [ruleRow({ preset: 'custom', pattern: '(a+)+' })];
      await pipeline.execute({ testRunIds: ['run-a'] });

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('rule rule-1 skipped'));
      expect(txWith('INSERT INTO ds_metric_series_groups')).toHaveLength(0);
      expect(txWith('grouped_points')).toHaveLength(0);
      expect(mainInsert().sql).toBe(buildStatisticsInsertSQL('$1'));
    });
  });
});

describe('buildMembership', () => {
  const loaded = (overrides: Partial<LoadedRule> = {}): LoadedRule => {
    const s = overrides.spec ?? spec();
    return {
      testRunId: 'run-a',
      ruleId: 'rule-1',
      applicationDashboardId: DASH,
      panelId: 7,
      systemUnderTestId: '33333333-3333-3333-3333-333333333333',
      testEnvironment: 'acc',
      workload: 'peak',
      spec: s,
      hash: seriesGroupingRuleHash(s),
      ...overrides,
    };
  };

  test('a panel rule beats the dashboard-wide rule on its panel', () => {
    const rows = buildMembership(
      [
        loaded({ ruleId: 'dashboard-wide', panelId: null, spec: spec({ preset: 'k8s-daemonset' }) }),
        loaded({ ruleId: 'panel-7', panelId: 7 }),
      ],
      [series('api-7d9f8c6b5-x2k4p'), series('api-7d9f8c6b5-x2k4p', { panel_id: 9 })],
    );
    expect(rows.find((r) => r.panel_id === 7)).toMatchObject({ rule_id: 'panel-7', group_name: 'api' });
    // Panel 9 has no panel rule, so the dashboard-wide (DaemonSet) rule applies.
    expect(rows.find((r) => r.panel_id === 9)).toMatchObject({ rule_id: 'dashboard-wide', group_name: 'api-7d9f8c6b5' });
  });

  test('a series the rule does not rename is a group of one on a grouped panel', () => {
    const rows = buildMembership([loaded()], [series('api-7d9f8c6b5-x2k4p'), series('heap-used')]);
    expect(rows.map((r) => [r.metric_name, r.group_name])).toEqual([
      ['api-7d9f8c6b5-x2k4p', 'api'],
      ['heap-used', 'heap-used'],
    ]);
  });

  test('ignores panels and dashboards no rule covers', () => {
    const rows = buildMembership(
      [loaded()],
      [series('api-7d9f8c6b5-x2k4p', { panel_id: 8 }), series('api-7d9f8c6b5-x2k4p', { application_dashboard_id: OTHER_DASH })],
    );
    expect(rows).toEqual([]);
  });

  test('applies each run its own rule', () => {
    const rows = buildMembership(
      [loaded({ testRunId: 'run-a' }), loaded({ testRunId: 'run-b', ruleId: 'rule-b', spec: spec({ aggregation: 'max' }) })],
      [series('api-7d9f8c6b5-x2k4p'), series('api-7d9f8c6b5-x2k4p', { test_run_id: 'run-b' })],
    );
    expect(rows.map((r) => [r.test_run_id, r.rule_id, r.aggregation])).toEqual([
      ['run-a', 'rule-1', 'avg'],
      ['run-b', 'rule-b', 'max'],
    ]);
  });
});

describe('buildGroupedStatisticsSQL — the extras arm is opt-in', () => {
  const row = (extra: Array<'avg' | 'sum' | 'max'>): MembershipRow => ({
    test_run_id: 'run-a',
    application_dashboard_id: DASH,
    panel_id: 7,
    metric_name: 'api-7d9f8c6b5-x2k4p',
    dashboard_label: 'K8s resources',
    panel_title: 'CPU per pod',
    group_name: 'api',
    member_count_name: null,
    aggregation: 'avg',
    extra_aggregations: extra,
    track_member_count: false,
    rule_id: 'rule-1',
    rule_hash: 'deadbeef',
    system_under_test_id: '33333333-3333-3333-3333-333333333333',
    test_environment: 'acc',
    workload: 'peak',
  });

  // A rule with no extras must send the statement v0.2.97.43 sent, byte for byte: no third
  // aggregate pass for a feature nobody switched on.
  test('a rule with no extras sends the pre-extras statement and eight bound arrays', () => {
    // A GOLDEN, not a self-comparison: `expect(f(1, false)).toBe(f(1))` compared a pure function
    // to itself and could only ever catch a change to the parameter's default (which is now gone).
    // Regenerate this snapshot only when the no-extras statement is deliberately changed.
    expect(buildGroupedStatisticsSQL(1, false)).toMatchSnapshot('grouped-sql-no-extras');
    const sql = buildGroupedStatisticsSQL(1, false);
    expect(sql).not.toContain('v_avg');
    expect(sql).not.toContain('extra_aggregations');
    expect(groupedStatementParams(['run-a'], [row([])])).toHaveLength(9);
    expect(hasExtraAggregations([row([])])).toBe(false);
  });

  test('a rule with extras grows one arm, three aggregate states and one bound array', () => {
    const sql = buildGroupedStatisticsSQL(1, true);
    expect(sql).toContain('AVG(m.value) AS v_avg');
    expect(sql).toContain('SUM(m.value) AS v_sum');
    expect(sql).toContain('MAX(m.value) AS v_max');
    expect(sql).toContain("CROSS JOIN LATERAL unnest(string_to_array(NULLIF(gp.extra_aggregations, ''), ','))");
    expect(groupedStatementParams(['run-a'], [row(['sum'])])).toHaveLength(10);
    expect(hasExtraAggregations([row(['sum'])])).toBe(true);
  });

  test('every aggregation has its own arm, so none falls through to the average', () => {
    const sql = buildGroupedStatisticsSQL(1, true);
    // The ELSE arm is the average, so avg needs no WHEN of its own; everything else does.
    for (const agg of SERIES_GROUPING_AGGREGATIONS.filter((a) => a !== 'avg')) {
      expect(sql).toContain(`WHEN '${agg}' THEN gp.v_${agg}`);
    }
    // Each aggregate state is named exactly twice: produced in grouped_points, read in the arm.
    for (const [state, fn] of [['v_avg', 'AVG'], ['v_sum', 'SUM'], ['v_max', 'MAX']] as const) {
      expect(sql).toContain(`${fn}(m.value) AS ${state}`);
      expect([...sql.matchAll(new RegExp(`\\b${state}\\b`, 'g'))]).toHaveLength(2);
    }
  });

  // A derived series is pod-count dependent: scale out and it doubles against its baseline. Left
  // classified, ADAPT counts that as a regression and buildConclusionSQL flips the whole run —
  // the exact case the feature exists to rule out.
  test('derived series get one unclassified compare config each, per config scope', () => {
    const rows = [
      row(['sum', 'max']),
      { ...row(['sum', 'max']), metric_name: 'api-7d9f8c6b5-z9w2t' },
      // Same group on another run of the same workload: the config scope is identical, so the
      // rows must collapse rather than duplicating.
      { ...row(['sum', 'max']), test_run_id: 'run-b' },
    ];
    const configs = derivedSeriesConfigRows(rows);
    expect(configs.map((c) => c.metric_name).sort()).toEqual(['api (max)', 'api (sum)']);
    expect(configs.every((c) => c.workload === 'peak' && c.panel_id === 7)).toBe(true);
  });

  test('a tracked member-count series is given one too', () => {
    const configs = derivedSeriesConfigRows([{ ...row([]), member_count_name: 'api (pod count)' }]);
    expect(configs.map((c) => c.metric_name)).toEqual(['api (pod count)']);
  });

  test('a group with no derived series produces no compare config at all', () => {
    expect(derivedSeriesConfigRows([row([])])).toEqual([]);
  });

  test('the extras travel as one delimited string per row, not as a per-row array', () => {
    const params = groupedStatementParams(['run-a'], [row(['sum', 'max'])]);
    expect(params[params.length - 1]).toEqual(['sum,max']);
  });

  /**
   * Value:
   *   protects — the `$n` arithmetic in the statement and the order of
   *     `groupedStatementParams` stay one contract, for every batch size and on both sides of
   *     the extras arm.
   *   fails_when — the ninth array is added to the params without `p(8)` being bound in the
   *     `members` CTE, or `p()`'s `runCount + 1 + offset` base drifts. Postgres answers
   *     `bind message supplies N parameters, but prepared statement requires M`, or silently
   *     reads the wrong array into a column — and `statistics-calculation` is not softFail, so
   *     it fails the whole re-evaluate batch.
   *   why_new — every existing case uses one run id, where an off-by-one in the base and an
   *     off-by-one in the offset cancel out. A batch is up to `REEVALUATE_CHUNK_SIZE` (5) runs.
   *   seam — the highest placeholder in the emitted SQL against the bound parameter count.
   */
  test.each([
    [1, false],
    [1, true],
    [2, true],
    [5, false],
    [5, true],
  ])('runCount=%i hasExtras=%s binds exactly as many parameters as the statement reads', (runCount, hasExtras) => {
    const sql = buildGroupedStatisticsSQL(runCount as number, hasExtras as boolean);
    const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1] ?? 0));
    const runIds = Array.from({ length: runCount as number }, (_, i) => `run-${i}`);
    const params = groupedStatementParams(runIds, [row(hasExtras ? ['sum'] : [])]);

    expect(Math.max(...placeholders)).toBe(params.length);
    // Contiguous: no placeholder is skipped, which a bare max cannot see.
    expect(new Set(placeholders).size).toBe(params.length);
  });

  /**
   * Value:
   *   protects — the same contract for the other two statements this module emits, including
   *     BOTH arms of the membership INSERT, whose column list, SELECT list, `unnest()` args and
   *     `AS s()` aliases all have to move together when `extrasPresent` flips.
   *   fails_when — extras are dropped from the column list but not the params (or the reverse),
   *     or the actor is added to `INSERT_DERIVED_COMPARE_CONFIG_SQL` as `$8` without reaching
   *     `derivedCompareConfigParams`. Postgres answers `bind message supplies N parameters, but
   *     prepared statement requires M`, inside `withAnalyticsTransaction` — and
   *     `statistics-calculation` is not softFail, so the whole re-evaluate batch fails.
   *   why_new — a cycle-3 review verified both arms' arity by hand with PREPARE against the real
   *     schema. This makes that a standing check rather than a one-off, and it is the arm count
   *     (13/11 against 14/12) that a reader is most likely to get wrong when editing the lists.
   *   seam — the emitted placeholders against the built parameter array.
   */
  test.each([true, false])('the membership INSERT binds what it reads (extrasPresent=%s)', (extrasPresent) => {
    const rows = [row(extrasPresent ? ['sum'] : [])];
    const sql = insertMembershipSql(extrasPresent);
    const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1] ?? 0));
    const params = membershipInsertParams(rows, extrasPresent);

    expect(Math.max(...placeholders)).toBe(params.length);
    expect(new Set(placeholders).size).toBe(params.length);
    // The column list, the SELECT list and the alias list move as one.
    expect(sql.includes('extra_aggregations')).toBe(extrasPresent);
    expect(params.length).toBe(extrasPresent ? 12 : 11);
  });

  test('the derived compare-config INSERT binds what it reads, actor included', () => {
    const configs = derivedSeriesConfigRows([row(['sum'])]);
    const placeholders = [...INSERT_DERIVED_COMPARE_CONFIG_SQL.matchAll(/\$(\d+)/g)].map((m) => Number(m[1] ?? 0));
    const params = derivedCompareConfigParams(configs);

    expect(Math.max(...placeholders)).toBe(params.length);
    expect(new Set(placeholders).size).toBe(params.length);
    // Bound, not interpolated — the house style both cited precedents use.
    expect(INSERT_DERIVED_COMPARE_CONFIG_SQL).not.toContain("'worker-pipeline'");
    expect(params[params.length - 1]).toBe('worker-pipeline');
  });
});
