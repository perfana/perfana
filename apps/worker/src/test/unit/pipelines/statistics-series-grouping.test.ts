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
  SERIES_GROUPING_RULES_SQL,
  type LoadedRule,
  type SeriesRow,
} from '../../../pipelines/helpers/series-grouping-plan.js';
import { buildStatisticsInsertSQL } from '../../../pipelines/helpers/statistics-sql.js';
import { getLogger } from '../../../lib/utils/logger.js';
import * as databaseAccessor from '../../../common/database-accessor.js';
import { seriesGroupingRuleHash, type SeriesGroupingRuleSpec } from '@perfana/shared/utils';

vi.mock('../../../lib/utils/logger.js');
vi.mock('../../../common/database-accessor.js');

const DASH = '11111111-1111-1111-1111-111111111111';
const OTHER_DASH = '22222222-2222-2222-2222-222222222222';

const spec = (overrides: Partial<SeriesGroupingRuleSpec> = {}): SeriesGroupingRuleSpec => ({
  preset: 'k8s-pod',
  pattern: null,
  replacement: '',
  aggregation: 'avg',
  trackMemberCount: false,
  ...overrides,
});

const ruleRow = (overrides: Record<string, unknown> = {}) => ({
  test_run_id: 'run-a',
  id: 'rule-1',
  application_dashboard_id: DASH,
  panel_id: 7,
  preset: 'k8s-pod',
  pattern: null,
  replacement: '',
  aggregation: 'avg',
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
  let rulesRows: Array<Record<string, unknown>>;
  let rulesError: Error | null;
  let existingMembership: boolean;
  let seriesRows: SeriesRow[];
  let alignmentRows: Array<Record<string, unknown>>;
  let pooled: Array<{ sql: string; params?: unknown[] }>;
  let tx: Array<{ sql: string; params?: unknown[] }>;

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

    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    vi.mocked(getLogger).mockReturnValue(logger as any);

    const manager = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        const text = String(sql);
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
      const [runs, dashes, panels, metrics, groups, memberCounts, , , aggregations, ruleIds, hashes] =
        insert.params as unknown[][];
      expect(metrics).toEqual(['api-7d9f8c6b5-x2k4p', 'api-7d9f8c6b5-z9w2t', 'worker-6b8f7d9c4-h5k2l']);
      expect(groups).toEqual(['api', 'api', 'worker']);
      expect(memberCounts).toEqual(['api (pod count)', 'api (pod count)', 'worker (pod count)']);
      expect(runs).toEqual(['run-a', 'run-a', 'run-a']);
      expect(dashes).toEqual([DASH, DASH, DASH]);
      expect(panels).toEqual([7, 7, 7]);
      expect(aggregations).toEqual(['avg', 'avg', 'avg']);
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
      expect(summary[0]).toMatch(/runs=1 rules=1 panels=1 rawSeries=3 groups=2 memberCountSeries=2 in \d+ms/);
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
