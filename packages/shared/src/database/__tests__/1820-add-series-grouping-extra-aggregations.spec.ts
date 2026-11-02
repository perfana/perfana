// These specs live OUTSIDE src/database/migrations on purpose: that directory is globbed
// as migrations by Dockerfile.migrations, ormconfig.ts and apps/api/src/data-source.ts —
// a compiled *.spec.js there gets require()d as a migration and dies on describe().
import { AddSeriesGroupingExtraAggregations1820000000000 as M } from '../migrations/1820000000000-AddSeriesGroupingExtraAggregations';
import { SCHEMA_SQL } from '../migrations/schema-sql';
import { SERIES_GROUPING_AGGREGATIONS } from '../../utils/series-grouping';

const TABLES = ['series_grouping_rules', 'ds_metric_series_groups'] as const;

const run = async (direction: 'up' | 'down'): Promise<string> => {
  const queries: string[] = [];
  const runner = { query: jest.fn(async (sql: string) => { queries.push(sql); return []; }) };
  await new M()[direction](runner as never);
  return queries.join('\n');
};

describe('migration 1820 — more than one aggregation per grouping rule', () => {
  it('adds the column to both tables, idempotently, defaulting to no extras', async () => {
    const sql = await run('up');
    for (const table of TABLES) {
      expect(sql).toMatch(
        new RegExp(
          `ALTER TABLE public\\.${table}\\s+ADD COLUMN IF NOT EXISTS extra_aggregations character varying\\(8\\)\\[\\] DEFAULT '\\{\\}'`,
        ),
      );
    }
  });

  // NOT NULL here breaks SUT transfer: both tables are `core` in SUT_RESOURCES, and the import's
  // json_populate_recordset yields NULL — not the DEFAULT — for a key an older bundle lacks, so
  // 23502 aborts the whole bundle. Same trap migration 1808 documents and avoids.
  it('leaves the column NULLABLE, so a bundle exported before it still imports', async () => {
    const sql = await run('up');
    expect(sql).not.toMatch(/extra_aggregations[^;]*NOT NULL/);
  });

  // The existing `aggregation` column keeps emitting the bare group name, so every reader that
  // predates this migration keeps working and no stored metric_name is renamed.
  it('leaves the existing aggregation column alone', async () => {
    const sql = await run('up');
    expect(sql).not.toMatch(/DROP COLUMN IF EXISTS aggregation\b/);
    expect(sql).not.toMatch(/ALTER COLUMN aggregation/);
    expect(sql).not.toMatch(/\bUPDATE\b/);
  });

  // Without the second clause a rule could emit `api` and `api (avg)` as two copies of one series.
  // The list is BUILT from the shared constant, never spelled: with a literal here, adding a
  // fourth aggregation to the TypeScript lists leaves every test green while the CHECK silently
  // rejects it — the DTO accepts the value and the INSERT raises a 23514 nobody translates.
  it('constrains exactly the aggregations the code knows about', async () => {
    const sql = await run('up');
    const expected = SERIES_GROUPING_AGGREGATIONS.map((a) => `'${a}'`).join(', ');
    expect(sql).toContain(`extra_aggregations <@ ARRAY[${expected}]::character varying(8)[]`);
    expect(sql).toMatch(/NOT \(aggregation = ANY \(extra_aggregations\)\)/);
  });

  // array_length of an empty array is NULL, not 0, so `IS DISTINCT FROM 0` was true for every
  // possible value including the DEFAULT. It constrained nothing and would have read as a real
  // rule in check:schema-constraints output forever.
  it('carries no clause that cannot fail', async () => {
    const sql = await run('up');
    expect(sql).not.toMatch(/array_length/);
  });

  // A column that reaches only the migration exists on upgraded databases and nowhere else.
  // `check:entity-migrations` does not cover this: it reads ConsolidatedSchema.ts and only counts
  // added migration FILES, so deleting the schema-sql.ts lines leaves it reporting OK.
  it('matches what a greenfield install gets from schema-sql.ts', async () => {
    for (const table of TABLES) {
      const create = SCHEMA_SQL.slice(SCHEMA_SQL.indexOf(`CREATE TABLE public.${table} (`));
      const body = create.slice(0, create.indexOf('\n);'));
      expect(body).toMatch(/extra_aggregations character varying\(8\)\[\][^,]*DEFAULT '\{\}'/);
      // Nullable on both sides, for the SUT-import reason above.
      expect(body).not.toMatch(/extra_aggregations[^,]*NOT NULL/);
    }
    const expected = SERIES_GROUPING_AGGREGATIONS.map((a) => `'${a}'::character varying`).join(', ');
    expect(SCHEMA_SQL).toContain(`ck_series_grouping_rules_extra_aggregations CHECK`);
    expect(SCHEMA_SQL).toContain(`(ARRAY[${expected}])::character varying(8)[]`);
    expect(SCHEMA_SQL).not.toMatch(/ck_series_grouping_rules_extra_aggregations[^;]*array_length/);
  });

  it('replaces the constraint rather than failing on a re-run', async () => {
    const sql = await run('up');
    const drop = sql.indexOf('DROP CONSTRAINT IF EXISTS ck_series_grouping_rules_extra_aggregations');
    const add = sql.indexOf('ADD CONSTRAINT ck_series_grouping_rules_extra_aggregations');
    expect(drop).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(drop);
  });

  // Both tables are written inside the analytics transaction, which runs for up to
  // AGGREGATION_STATEMENT_TIMEOUT_MS (540 s), and ALTER TABLE needs ACCESS EXCLUSIVE. Postgres'
  // lock queue is FIFO, so an unbounded wait parks every writer behind this request.
  it.each(['up', 'down'] as const)('bounds the %s lock wait and retries instead of queueing', async (dir) => {
    const sql = await run(dir);
    expect(sql).toMatch(/set_config\('lock_timeout',\s*'3s',\s*true\)/);
    expect(sql).toMatch(/EXCEPTION WHEN lock_not_available/);
    expect(sql).toMatch(/pg_sleep\(3\)/);
    expect(sql).toMatch(/attempt >= 10/);
  });

  // set_config(..., true) is transaction-local and the runner uses transaction: "all" — ONE
  // transaction for the whole batch — so an unrestored 3s lock_timeout leaks into every migration
  // numbered above this one, where it surfaces as 55P03 instead of a wait and poisons the deploy.
  it.each(['up', 'down'] as const)('restores lock_timeout on both %s exit paths', async (dir) => {
    const sql = await run(dir);
    const restores = [...sql.matchAll(/set_config\('lock_timeout',\s*prev_lock_timeout,\s*true\)/g)];
    expect(restores).toHaveLength(2); // the success path and before the RAISE
    expect(sql).toMatch(/prev_lock_timeout text := current_setting\('lock_timeout'\)/);
    expect(sql.indexOf('set_config(\'lock_timeout\', prev_lock_timeout, true)')).toBeGreaterThan(
      sql.indexOf("set_config('lock_timeout', '3s', true)"),
    );
  });

  // The value matters, not just the presence of a restore. `'0'` means lock_timeout UNLIMITED, so
  // restoring to it would STRIP a non-zero postgresql.conf lock_timeout from the rest of the batch
  // — the opposite of this block's purpose — and `DEFAULT` would clobber a SET LOCAL an earlier
  // migration in the same transaction set for itself. Only the captured entry value is correct, and
  // without this case reverting to either reads as a passing test.
  it.each(['up', 'down'] as const)('restores the ENTRY value, not a constant (%s)', async (dir) => {
    const sql = await run(dir);
    expect(sql).not.toMatch(/set_config\('lock_timeout',\s*'0'/);
    expect(sql).not.toMatch(/lock_timeout\s*=\s*DEFAULT/);
  });

  it('drops the constraint before the column it constrains', async () => {
    const sql = await run('down');
    const drop = sql.indexOf('DROP CONSTRAINT IF EXISTS ck_series_grouping_rules_extra_aggregations');
    const column = sql.indexOf('ALTER TABLE public.series_grouping_rules DROP COLUMN IF EXISTS extra_aggregations');
    expect(drop).toBeGreaterThan(-1);
    expect(column).toBeGreaterThan(drop);
  });
});
