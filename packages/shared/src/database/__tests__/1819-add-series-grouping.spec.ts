// These specs live OUTSIDE src/database/migrations on purpose: that directory is globbed
// as migrations by Dockerfile.migrations, ormconfig.ts and apps/api/src/data-source.ts —
// a compiled *.spec.js there gets require()d as a migration and dies on describe().
import { AddSeriesGrouping1819000000000 as M } from '../migrations/1819000000000-AddSeriesGrouping';

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

  it('constrains preset, aggregation and origin to the known values', async () => {
    const sql = await run('up');
    expect(sql).toMatch(/preset IN \('k8s-pod', ?'k8s-daemonset', ?'ip-port', ?'trailing-id', ?'custom'\)/);
    expect(sql).toMatch(/aggregation IN \('avg', ?'sum', ?'max'\)/);
    expect(sql).toMatch(/origin IN \('manual', ?'suggestion', ?'copy'\)/);
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

  it('drops the derived table before the rules table it references', async () => {
    const sql = await run('down');
    const groups = sql.indexOf('DROP TABLE IF EXISTS public.ds_metric_series_groups');
    const rules = sql.indexOf('DROP TABLE IF EXISTS public.series_grouping_rules');
    expect(groups).toBeGreaterThan(-1);
    expect(rules).toBeGreaterThan(groups);
  });
});
