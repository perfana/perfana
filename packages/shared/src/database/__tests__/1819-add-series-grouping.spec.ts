// These specs live OUTSIDE src/database/migrations on purpose: that directory is globbed
// as migrations by Dockerfile.migrations, ormconfig.ts and apps/api/src/data-source.ts —
// a compiled *.spec.js there gets require()d as a migration and dies on describe().
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AddSeriesGrouping1819000000000 as M } from '../migrations/1819000000000-AddSeriesGrouping';
import { SERIES_GROUPING_AGGREGATIONS } from '../../utils/series-grouping';

const run = async (direction: 'up' | 'down'): Promise<string> => {
  const queries: string[] = [];
  const runner = { query: jest.fn(async (sql: string) => { queries.push(sql); return []; }) };
  await new M()[direction](runner as never);
  return queries.join('\n');
};

describe('migration 1819 — series grouping tables', () => {
  it('creates both tables idempotently', async () => {
    const sql = await run('up');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.series_grouping_rules/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.ds_metric_series_groups/);
  });

  // A plain UNIQUE lets two dashboard-wide rules (panel_id NULL) coexist on one slot, because
  // NULLs never collide in a btree unique — root CLAUDE.md #36, uq_benchmarks_unique.
  it('makes the rule slot unique with NULLS NOT DISTINCT', async () => {
    const sql = await run('up');
    expect(sql).toMatch(
      /uq_series_grouping_rules_slot UNIQUE NULLS NOT DISTINCT\s*\(\s*system_under_test_id,\s*test_environment,\s*workload,\s*application_dashboard_id,\s*panel_id\s*\)/,
    );
  });

  it('requires a pattern exactly when the preset is custom', async () => {
    const sql = await run('up');
    expect(sql).toMatch(/CHECK \(\(preset = 'custom'\) = \(pattern IS NOT NULL\)\)/);
  });

  it('constrains preset and origin to the known values', async () => {
    const sql = await run('up');
    expect(sql).toMatch(/preset IN \('k8s-pod', ?'k8s-daemonset', ?'ip-port', ?'trailing-id', ?'custom'\)/);
    expect(sql).toMatch(/origin IN \('manual', ?'suggestion', ?'copy'\)/);
  });

  /**
   * Value:
   *   protects — `aggregations` is a LIST, and both halves of its CHECK matter: the `<@` bounds
   *     it to the values the code knows, and `array_length >= 1` refuses a rule that would emit
   *     no series at all while still excluding its panels from the main statistics statement.
   *   fails_when — the list is spelled by hand and drifts from `SERIES_GROUPING_AGGREGATIONS`,
   *     so the DTO accepts a value the CHECK then rejects with a 23514 nobody translates (a 500).
   *     Built from the shared constant for that reason, never typed out.
   *   seam — the CHECK text against the one list the DTO and the dialog also read.
   */
  it('constrains the aggregations list to the values the code knows, and refuses an empty one', async () => {
    const sql = await run('up');
    const expected = SERIES_GROUPING_AGGREGATIONS.map((a) => `'${a}'`).join(', ');
    expect(sql).toContain(`aggregations <@ ARRAY[${expected}]::character varying(8)[]`);
    expect(sql).toMatch(/array_length\(aggregations, 1\) >= 1/);
  });

  // The old singular `aggregation` and `track_member_count` are folded into that one list; a
  // leftover column would be written by nothing and read as authoritative by the next reader.
  // Asserted against the DDL with its comments stripped — the docblock mentions the old names on
  // purpose, and a test that reads prose fails on an edit that changes nothing it is about.
  it('carries no singular aggregation or member-count column', async () => {
    const ddl = (await run('up')).replace(/--[^\n]*/g, '');
    expect(ddl).not.toMatch(/\baggregation\b(?!s)/);
    expect(ddl).not.toMatch(/track_member_count/);
    expect(ddl).not.toMatch(/member_count_name/);
  });

  /**
   * Value: protects=the ENTITY declares no column the migrations do not create;
   * fails_when=a @Column is added to DsMetricSeriesGroup for a retired column, or a column is
   * dropped from the migration while the entity keeps it; why_new=the case above asserts the DDL
   * only, and the two drifted apart in exactly that gap; seam=none; no_claim=column TYPES and
   * nullability are not compared, only presence
   *
   * REGRESSION GUARD. v0.2.97.44 shipped `@Column(...) member_count_name!: string | null` on this
   * entity while 1819 never creates that column and 1820 drops it. TypeORM names every declared
   * column in its SELECT, so the first read of the table fails with "column does not exist", and
   * `SCHEMA_DRIFT_CHECK` logs it at ERROR (`strict` refuses to boot). It was dormant only because
   * nothing imports the entity yet. Asserting the DDL alone could never catch it: the drift is
   * between the DDL and the entity, so the test has to read both.
   */
  it('declares no entity column the migration does not create', async () => {
    const entity = await readFile(
      join(__dirname, '../../entities/ds-metric-series-group.entity.ts'),
      'utf8',
    );
    // Column names as TypeORM sees them: this entity spells its properties in snake_case, so the
    // property name IS the column name. Comments are stripped — both files discuss the old names.
    const code = entity.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const declared = [...code.matchAll(/@Column\([^)]*\)\s*([a-z_][a-z0-9_]*)!?\s*[?:]/gi)].map(
      (m) => m[1]!,
    );
    expect(declared.length).toBeGreaterThan(0);

    const ddl = (await run('up')).replace(/--[^\n]*/g, '');
    const groupsTable = /CREATE TABLE IF NOT EXISTS public\.ds_metric_series_groups \(([\s\S]*?)\n {2}\);/.exec(ddl);
    expect(groupsTable).not.toBeNull();

    const missing = declared.filter((c) => !new RegExp(`\\b${c}\\b`).test(groupsTable![1]!)).sort();
    expect(missing).toEqual([]);
  });

  // Root CLAUDE.md #57: an unindexed FK child turns every parent delete into a scan per child.
  it('indexes every foreign key column on the child side', async () => {
    const sql = await run('up');
    expect(sql).toMatch(/idx_series_grouping_rules_app_dashboard\s+ON public\.series_grouping_rules \(application_dashboard_id\)/);
    expect(sql).toMatch(/idx_ds_metric_series_groups_app_dashboard\s+ON public\.ds_metric_series_groups \(application_dashboard_id\)/);
    expect(sql).toMatch(/idx_ds_metric_series_groups_rule\s+ON public\.ds_metric_series_groups \(rule_id\)/);
    // systems_under_test(id) is served by the slot's unique index, which leads on it.
  });

  it('indexes the two lookups the readers make', async () => {
    const sql = await run('up');
    expect(sql).toMatch(
      /idx_ds_metric_series_groups_group\s+ON public\.ds_metric_series_groups \(test_run_id, application_dashboard_id, panel_id, group_name\)/,
    );
    expect(sql).toMatch(
      /idx_ds_metric_series_groups_label\s+ON public\.ds_metric_series_groups \(test_run_id, dashboard_label, panel_title, panel_id\)/,
    );
  });

  it('puts RLS on the rules table only, with the four standard policies', async () => {
    const sql = await run('up');
    expect(sql).toMatch(/ALTER TABLE public\.series_grouping_rules ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE public\.series_grouping_rules FORCE ROW LEVEL SECURITY/);
    for (const op of ['select', 'insert', 'update', 'delete']) {
      expect(sql).toMatch(new RegExp(`CREATE POLICY rls_series_grouping_rules_${op} ON public\\.series_grouping_rules`));
    }
    // Derived, like ds_metric_statistics: no policy of its own.
    expect(sql).not.toMatch(/ds_metric_series_groups (ENABLE|FORCE) ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/POLICY \w+ ON public\.ds_metric_series_groups/);
  });

  // The two REFERENCES clauses take SHARE ROW EXCLUSIVE on application_dashboards and
  // systems_under_test, and the SUT deletion queue can hold ROW EXCLUSIVE on them for minutes.
  // Postgres' lock queue is FIFO, so an unbounded wait would stall every writer behind it.
  it.each(['up', 'down'] as const)('bounds the %s lock wait and retries instead of queueing', async (dir) => {
    const sql = await run(dir);
    expect(sql).toMatch(/set_config\('lock_timeout',\s*'3s',\s*true\)/);
    expect(sql).toMatch(/EXCEPTION WHEN lock_not_available/);
    expect(sql).toMatch(/pg_sleep\(3\)/);
    expect(sql).toMatch(/attempt >= 10/);
  });

  // The runner uses transaction: "all" — ONE transaction for the whole batch — so a 3s
  // lock_timeout left in place leaks into every migration numbered above this one, where it
  // surfaces as 55P03 instead of a wait. Restoring the CAPTURED ENTRY VALUE is the only correct
  // form: `'0'` means UNLIMITED, which would strip a deployment's configured lock_timeout from
  // the rest of the batch, and `DEFAULT` resolves to the conf value, clobbering a SET LOCAL an
  // earlier migration set for itself.
  it.each(['up', 'down'] as const)('restores the lock_timeout it captured on %s entry', async (dir) => {
    const sql = await run(dir);
    expect(sql).toMatch(/prev_lock_timeout text := current_setting\('lock_timeout'\)/);
    const restores = [...sql.matchAll(/set_config\('lock_timeout',\s*prev_lock_timeout,\s*true\)/g)];
    expect(restores).toHaveLength(2); // the success path and before the RAISE
    expect(sql).not.toMatch(/set_config\('lock_timeout',\s*'0'/);
    expect(sql).not.toMatch(/lock_timeout\s*=\s*DEFAULT/);
  });

  it('drops the derived table before the rules table it references', async () => {
    const sql = await run('down');
    const groups = sql.indexOf('DROP TABLE IF EXISTS public.ds_metric_series_groups');
    const rules = sql.indexOf('DROP TABLE IF EXISTS public.series_grouping_rules');
    expect(groups).toBeGreaterThan(-1);
    expect(rules).toBeGreaterThan(groups);
  });
});
