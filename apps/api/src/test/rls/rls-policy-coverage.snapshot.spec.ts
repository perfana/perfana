import { DataSource } from 'typeorm';
import { AppDataSource } from '../../data-source';

/**
 * Phase 5b: Snapshot the RLS posture (FORCE flag + policy commands) for every
 * owned-resource table AND every policy-bearing table. Adding a new owned-
 * resource table without policies — or removing/altering policies on existing
 * tables — fails this snapshot in PR review.
 *
 * Discovery query includes any public table that either:
 *   (a) has an `organization_id` column (the standard owned-resource shape), OR
 *   (b) has any RLS policy attached (catches subquery-policy tables like
 *       `generated_reports` that lack `organization_id` but delegate via a
 *       joined parent).
 * Excludes TimescaleDB hypertable child partitions and audit_logs partition
 * children.
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

  it('every owned-resource and policy-bearing table is RLS-snapshotted', async () => {
    const tables = await ds.query(`
      SELECT DISTINCT c.relname AS table_name,
             c.relrowsecurity AS rls_enabled,
             c.relforcerowsecurity AS rls_forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND c.relname NOT LIKE '_hyper_%'
        AND c.relname !~ '^audit_logs_\\d{4}_\\d{2}$'
        AND (
          EXISTS (
            SELECT 1 FROM information_schema.columns col
            WHERE col.table_schema = n.nspname
              AND col.table_name = c.relname
              AND col.column_name = 'organization_id'
          )
          OR EXISTS (
            SELECT 1 FROM pg_policies pol
            WHERE pol.schemaname = n.nspname
              AND pol.tablename = c.relname
          )
        )
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
