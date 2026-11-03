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
  INSERT_DERIVED_COMPARE_CONFIG_SQL,
  INSERT_MEMBERSHIP_SQL,
  membershipInsertParams,
  SERIES_GROUPING_RULES_SQL,
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
  aggregations: ['avg'],
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
  aggregations: ['avg'],
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
        if (text.includes('to_regclass')) return [{ present: tablesPresent }];
        if (text.includes('JOIN series_grouping_rules')) {
          if (rulesError) throw rulesError;
          return rulesRows;
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
      rulesRows = [ruleRow({ aggregations: ['avg', 'count'] })];
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
      expect(rulesQuery.sql).toBe(SERIES_GROUPING_RULES_SQL);
      expect(rulesQuery.params).toEqual([['run-a']]);
      expect(SERIES_GROUPING_RULES_SQL).toMatch(/NOT LIKE 'performance-test-metrics-%'/);
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
      const [runs, dashes, panels, metrics, groups, , , aggregations, ruleIds, hashes] =
        insert.params as unknown[][];
      expect(metrics).toEqual(['api-7d9f8c6b5-x2k4p', 'api-7d9f8c6b5-z9w2t', 'worker-6b8f7d9c4-h5k2l']);
      expect(groups).toEqual(['api', 'api', 'worker']);
      expect(runs).toEqual(['run-a', 'run-a', 'run-a']);
      expect(dashes).toEqual([DASH, DASH, DASH]);
      expect(panels).toEqual([7, 7, 7]);
      // One comma-joined string per row, which the statement string_to_arrays back to an array.
      // Every member of a group carries the SAME list: it is a property of the group.
      expect(aggregations).toEqual(['avg,count', 'avg,count', 'avg,count']);
      expect(ruleIds).toEqual(['rule-1', 'rule-1', 'rule-1']);
      expect(hashes).toEqual(Array(3).fill(seriesGroupingRuleHash(spec({ aggregations: ['avg', 'count'] }))));
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
      const [runId, runs, , , metrics, groups, aggregations, renamed] = grouped[0]!.params as unknown[];
      expect(runId).toBe('run-a');
      expect(runs).toHaveLength(3);
      expect(metrics).toEqual(['api-7d9f8c6b5-x2k4p', 'api-7d9f8c6b5-z9w2t', 'worker-6b8f7d9c4-h5k2l']);
      expect(groups).toEqual(['api', 'api', 'worker']);
      expect(aggregations).toEqual(['avg,count', 'avg,count', 'avg,count']);
      // Every one of these was renamed by the rule, so each emits suffixed series rather than
      // passing through under its own name.
      expect(renamed).toEqual([true, true, true]);
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
        /runs=1 rules=1 panels=1 rawSeries=3 groups=2 renamedGroups=2 derivedSeries=4 in \d+ms/,
      );
    });

    test('a multi-aggregation rule writes the same list on every member row', async () => {
      rulesRows = [ruleRow({ aggregations: ['avg', 'sum'] })];
      await pipeline.execute({ testRunIds: ['run-a'] });

      const insert = txWith('INSERT INTO ds_metric_series_groups')[0]!;
      expect((insert.params as unknown[][])[7]).toEqual(['avg,sum', 'avg,sum', 'avg,sum']);

      const infos = logger.info.mock.calls.map((c: unknown[]) => String(c.at(-1)));
      // 2 renamed groups x 2 aggregations.
      expect(infos.find((l: string) => l.startsWith('series-grouping:'))).toContain('derivedSeries=4');
    });

    /**
     * Value:
     *   protects — a series the rule does not rename is a group of ONE, which passes through
     *     under its own name. It must carry no aggregations, so the grouped statement's bare arm
     *     picks it up and the suffixed arm does not.
     *   fails_when — `buildMembership` reads the list off `rule.spec.aggregations` instead of
     *     `grouping.seriesAggregations.get(group)`. The statement would then emit
     *     `heap-used (avg)` INSTEAD of `heap-used`, silently renaming a series the rule was never
     *     meant to touch and breaking its baseline.
     *   seam — the INSERT's bound arrays, which are positional.
     */
    test('a series the rule does not rename carries no aggregations and is not renamed', async () => {
      rulesRows = [ruleRow({ aggregations: ['avg', 'sum'] })];
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
      expect(params[7]).toEqual(['avg,sum', 'avg,sum', '', 'avg,sum']);
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
      [loaded({ testRunId: 'run-a' }), loaded({ testRunId: 'run-b', ruleId: 'rule-b', spec: spec({ aggregations: ['max'] }) })],
      [series('api-7d9f8c6b5-x2k4p'), series('api-7d9f8c6b5-x2k4p', { test_run_id: 'run-b' })],
    );
    expect(rows.map((r) => [r.test_run_id, r.rule_id, r.aggregations.join(',')])).toEqual([
      ['run-a', 'rule-1', 'avg'],
      ['run-b', 'rule-b', 'max'],
    ]);
  });
});

describe('buildGroupedStatisticsSQL', () => {
  const row = (
    aggregations: Array<'avg' | 'sum' | 'max' | 'count'>,
    renamed = true,
  ): MembershipRow => ({
    test_run_id: 'run-a',
    application_dashboard_id: DASH,
    panel_id: 7,
    metric_name: 'api-7d9f8c6b5-x2k4p',
    dashboard_label: 'K8s resources',
    panel_title: 'CPU per pod',
    group_name: 'api',
    aggregations,
    renamed,
    rule_id: 'rule-1',
    rule_hash: 'deadbeef',
    system_under_test_id: '33333333-3333-3333-3333-333333333333',
    test_environment: 'acc',
    workload: 'peak',
  });

  /**
   * Value:
   *   protects — the statement is now unconditional: one shape, whatever the rules ask for. The
   *     golden is what makes a change to it deliberate.
   *   fails_when — anyone reintroduces a branch on what the rules happen to contain. A
   *     half-conditional statement is how the previous design shipped a 42703 inside the
   *     analytics transaction, which is not softFail and failed the whole re-evaluate batch.
   *   seam — the emitted SQL.
   */
  /**
   * Value: protects=buildGroupedStatisticsSQL only projects members columns the CTE declares,
   * qualified, from exactly one alias; fails_when=a projection names a retired or undeclared
   * members column, qualified or bare, or a second AS s(...) appears; why_new=the snapshot test
   * records whatever SQL it is given as golden and passed through the whole outage;
   * seam=none; no_claim=schema resolution of m.*, tr.* and STATISTICS_INSERT's column list
   * against the real ds_metrics/ds_metric_statistics (only Postgres can judge that; no committed
   * test does, see the preflight decision in TODOS.md)
   *
   * REGRESSION GUARD, and the one the snapshot above could not be.
   *
   * `members` is a VALUES list built in JavaScript, so a projection naming a column it does not
   * declare resolves nowhere until Postgres parses the statement — at which point the whole
   * aggregation transaction aborts, the DELETE that preceded it rolls back, and the run keeps its
   * PREVIOUS statistics. The only symptom is a number that silently never moves; the stage logs
   * `query failed` with no column named at error level.
   *
   * That shipped: `bool_or(s.track_member_count)` and `MIN(s.member_count_name)` outlived their
   * columns when the member count became an ordinary aggregation. Both were dead — nothing
   * downstream read them — and both still had to resolve. Every `statistics-calculation` on a
   * database with one enabled grouping rule failed, for every run, with no statistics written
   * anywhere. The snapshot test passed throughout, because the snapshot had been regenerated and
   * recorded the broken SQL as golden.
   *
   * So this asserts the two halves against each other rather than against a stored copy.
   */
  test('never projects a members column the CTE does not declare', () => {
    const sql = buildGroupedStatisticsSQL(1);

    const alias = /AS s\(([^)]*)\)/.exec(sql);
    expect(alias).not.toBeNull();
    // Exactly one `s` alias in the statement. The regex above is first-match, and this repo has
    // already learned that a first-match SQL-text assertion is nearly worthless on a statement
    // that names a thing twice: a second `AS s(...)` CTE would have its references judged against
    // the members column list, and vice versa. Count, never first-match.
    expect([...sql.matchAll(/AS s\(/g)]).toHaveLength(1);
    const declared = alias![1]!.split(',').map((c) => c.trim()).filter(Boolean);
    expect(declared.length).toBeGreaterThan(0);

    // The unnest arity has to match the alias list, or Postgres silently pads with NULL columns.
    const unnest = /FROM unnest\(([\s\S]*?)\)\s*\n?\s*AS s\(/.exec(sql);
    expect(unnest).not.toBeNull();
    expect(unnest![1]!.split('::').length - 1).toBe(declared.length);

    // Comments are stripped first: this file explains the bug in prose that names the column.
    const code = sql.replace(/--[^\n]*/g, '');
    const referenced = [...code.matchAll(/\bs\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1]!);
    expect(referenced.length).toBeGreaterThan(0);
    // Every projected column must be declared. Reported as a set difference so a failure names
    // the offending column instead of just the first one.
    const undeclared = [...new Set(referenced)].filter((c) => !declared.includes(c)).sort();
    expect(undeclared).toEqual([]);

    // ...and the projection has to be alias-QUALIFIED, which the scan above cannot see. Measured:
    // re-adding the bug unqualified — `bool_or(track_member_count)` — passes everything above,
    // and `PREPARE` still answers `column "track_member_count" does not exist`. Same 42703, same
    // aborted transaction, same silently frozen statistics. So the `grouped_points` body is
    // checked separately: every aggregate in it reads through an alias, or is COUNT(*).
    const body = /grouped_points AS \(([\s\S]*?)\n {6}\),/.exec(sql);
    expect(body).not.toBeNull();
    const unqualified = [
      ...body![1]!
        .replace(/--[^\n]*/g, '')
        .matchAll(/\b(AVG|SUM|MIN|MAX|COUNT|bool_or)\(\s*([^)\s,]+)/g),
    ]
      .filter((m) => m[2] !== '*' && !/^[a-z_]+\./.test(m[2] ?? ''))
      .map((m) => `${m[1]}(${m[2]})`);
    expect(unqualified).toEqual([]);

    // Belt and braces for the two names this bug was actually about, because the two checks above
    // are shape-sensitive and a rating pass measured both blind spots: the aggregate whitelist
    // misses `string_agg(track_member_count)`, and a bare `track_member_count AS tmc` carries no
    // aggregate at all. Both are the same 42703. A text guard cannot close the GENERAL case — only
    // Postgres can say whether a column resolves, which is what `npm run check:grouped-sql` does —
    // so this closes the specific one by name instead of pretending to close the class.
    for (const retired of ['track_member_count', 'member_count_name', 'extra_aggregations']) {
      expect(code).not.toContain(retired);
    }
  });

  test('is one unconditional statement, whatever the rules ask for', () => {
    expect(buildGroupedStatisticsSQL(1)).toMatchSnapshot('grouped-sql');
    // All four states are computed every time; which become series is decided per group, in SQL.
    const sql = buildGroupedStatisticsSQL(1);
    for (const [state, fn] of [['v_avg', 'AVG'], ['v_sum', 'SUM'], ['v_max', 'MAX']] as const) {
      expect(sql).toContain(`${fn}(m.value) AS ${state}`);
    }
    expect(sql).toContain('COUNT(*) AS member_count');
    expect(sql).toContain("CROSS JOIN LATERAL unnest(string_to_array(NULLIF(gp.aggregations, ''), ','))");
  });

  test('every aggregation has its own arm, so none falls through to the average', () => {
    const sql = buildGroupedStatisticsSQL(1);
    // The ELSE arm is the average, so avg needs no WHEN of its own; everything else does.
    expect(sql).toContain("WHEN 'sum' THEN gp.v_sum");
    expect(sql).toContain("WHEN 'max' THEN gp.v_max");
    expect(sql).toContain("WHEN 'count' THEN gp.member_count::double precision");
  });

  /**
   * Value:
   *   protects — a series the rule did NOT rename passes through under its own name. Suffixing
   *     it would rename a series the rule was never meant to touch.
   *   fails_when — the `WHERE NOT renamed` / `WHERE gp.renamed` split is collapsed into one arm.
   *     Every ungrouped series on a grouped panel would then be renamed to `heap-used (avg)`,
   *     breaking its baseline silently — or, with the bare arm dropped, vanish entirely.
   *   seam — the two arms of the `points` CTE.
   */
  test('an unrenamed group passes through under its own name, a renamed one is suffixed', () => {
    const sql = buildGroupedStatisticsSQL(1);
    expect(sql).toContain('WHERE NOT renamed');
    expect(sql).toContain('WHERE gp.renamed');
    expect(sql).toContain("gp.group_name || ' (' || x.agg || ')' AS metric_name");
  });

  // A member-count-dependent series doubles when a Deployment is scaled out, against a baseline
  // recorded at the old replica count. Left classified, ADAPT counts that as a regression and
  // buildConclusionSQL flips the whole run — the exact case the feature exists to rule out.
  test('only the member-count-dependent series get an unclassified compare config', () => {
    const rows = [
      row(['avg', 'sum', 'max', 'count']),
      { ...row(['avg', 'sum', 'max', 'count']), metric_name: 'api-7d9f8c6b5-z9w2t' },
      // Same group on another run of the same workload: the config scope is identical, so the
      // rows must collapse rather than duplicating.
      { ...row(['avg', 'sum', 'max', 'count']), test_run_id: 'run-b' },
    ];
    const configs = derivedSeriesConfigRows(rows);
    // `avg` and `max` do not move with the replica count, so they inherit the panel's
    // classification and a genuine regression in either still flags the run.
    expect(configs.map((c) => c.metric_name).sort()).toEqual(['api (count)', 'api (sum)']);
    expect(configs.every((c) => c.workload === 'peak' && c.panel_id === 7)).toBe(true);
  });

  test('a group emitting neither sum nor count produces no compare config at all', () => {
    expect(derivedSeriesConfigRows([row(['avg', 'max'])])).toEqual([]);
  });

  test('an unrenamed group produces no compare config, because it emits no derived series', () => {
    expect(derivedSeriesConfigRows([row([], false)])).toEqual([]);
  });

  test('the aggregations travel as one delimited string per row, not as a per-row array', () => {
    const params = groupedStatementParams(['run-a'], [row(['sum', 'max'])]);
    // Second to last; `renamed` is last.
    expect(params[params.length - 2]).toEqual(['sum,max']);
  });

  /**
   * Value:
   *   protects — the `$n` arithmetic in the statement and the order of `groupedStatementParams`
   *     stay one contract, for every batch size.
   *   fails_when — an array is added to the params without being bound in the `members` CTE, or
   *     `p()`'s `runCount + 1 + offset` base drifts. Postgres answers `bind message supplies N
   *     parameters, but prepared statement requires M`, or silently reads the wrong array into a
   *     column — and `statistics-calculation` is not softFail, so the whole batch fails.
   *   why_new — a single run id makes an off-by-one in the base and one in the offset cancel
   *     out. A batch is up to `REEVALUATE_CHUNK_SIZE` (5) runs.
   *   seam — the highest placeholder in the emitted SQL against the bound parameter count.
   */
  test.each([1, 2, 5])('runCount=%i binds exactly as many parameters as the statement reads', (runCount) => {
    const sql = buildGroupedStatisticsSQL(runCount);
    const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1] ?? 0));
    const runIds = Array.from({ length: runCount }, (_, i) => `run-${i}`);
    const params = groupedStatementParams(runIds, [row(['sum'])]);

    expect(Math.max(...placeholders)).toBe(params.length);
    // Contiguous: no placeholder is skipped, which a bare max cannot see.
    expect(new Set(placeholders).size).toBe(params.length);
  });

  /**
   * Value:
   *   protects — the same contract for the other two statements this module emits.
   *   fails_when — a column is added to one list and not the other, or the actor is added to
   *     `INSERT_DERIVED_COMPARE_CONFIG_SQL` as `$8` without reaching `derivedCompareConfigParams`.
   *     Postgres answers a bind-count error inside `withAnalyticsTransaction`.
   *   seam — the emitted placeholders against the built parameter array.
   */
  test('the membership INSERT binds what it reads', () => {
    const placeholders = [...INSERT_MEMBERSHIP_SQL.matchAll(/\$(\d+)/g)].map((m) => Number(m[1] ?? 0));
    const params = membershipInsertParams([row(['sum'])]);
    expect(Math.max(...placeholders)).toBe(params.length);
    expect(new Set(placeholders).size).toBe(params.length);
    expect(params.length).toBe(10);
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
