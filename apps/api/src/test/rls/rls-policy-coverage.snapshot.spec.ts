import { DataSource } from 'typeorm';
import { AppDataSource } from '../../data-source';

/**
 * Phase 5b: Snapshot the RLS posture (FORCE flag + policy commands) for every
 * owned-resource table. Adding a new owned-resource table without policies
 * fails this snapshot in PR review — forces the conversation about whether
 * the table should be RLS-protected, exempt with a documented reason, or
 * a candidate for the `audit_logs`-style special-case shape.
 *
 * Discovery: walks pg_class for tables that have an organization_id column
 * and lives in the `public` schema. Excludes timeseries hypertable child
 * partitions (TimescaleDB internal naming) and audit_logs partition children.
 */
describe('RLS policy coverage snapshot', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = AppDataSource;
    if (!ds.isInitialized) await ds.initialize();
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('every owned-resource table has FORCE RLS + 4 policies', async () => {
    const tables = await ds.query(`
      SELECT DISTINCT c.relname AS table_name,
             c.relrowsecurity AS rls_enabled,
             c.relforcerowsecurity AS rls_forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN information_schema.columns col
        ON col.table_schema = n.nspname AND col.table_name = c.relname
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND col.column_name = 'organization_id'
        AND c.relname NOT LIKE '_hyper_%'
        AND c.relname !~ '^audit_logs_\\d{4}_\\d{2}$'
      ORDER BY c.relname
    `);

    const snapshot: Record<string, { rls: boolean; force: boolean; policies: string[] }> = {};
    for (const t of tables) {
      const polRows = await ds.query(
        `SELECT policyname, cmd FROM pg_policies WHERE schemaname='public' AND tablename=$1 ORDER BY cmd, policyname`,
        [t.table_name],
      );
      snapshot[t.table_name] = {
        rls: t.rls_enabled,
        force: t.rls_forced,
        policies: polRows.map((p: { policyname: string; cmd: string }) => `${p.cmd}:${p.policyname}`),
      };
    }
    expect(snapshot).toMatchSnapshot();
  });
});
