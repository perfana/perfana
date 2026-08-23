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
 * Excludes TimescaleDB hypertable child partitions and the monthly `audit_logs_YYYY_MM`
 * children. The month set is a property of a given database's history, not of the code — this
 * suite runs against the developer's own `perfana` DB — so snapshotting those names makes the
 * gate fail on any DB whose partitions differ, with a diff that reads like an RLS regression.
 * `audit_logs_default` stays in the snapshot: it is created by the schema and the migration, so
 * it exists on every database. The property that matters for all of them — RLS on with no
 * policies of their own, since the parent's policies only cover parent-routed queries — is
 * asserted by shape in the second test instead of by name.
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

  it('every audit_logs partition enforces RLS and carries no policies of its own', async () => {
    // Shape, not names. A partition inherits the parent's policies only for parent-routed
    // queries; with RLS off it is readable directly by any role holding the schema-wide grants,
    // which is how `SELECT * FROM audit_logs_2026_07` as perfana_app returned rows that
    // `SELECT * FROM audit_logs` hid. A hand-created partition does not inherit RLS, so this
    // has to be checked for whatever set of partitions the database actually has.
    const partitions = await ds.query(`
      SELECT c.relname,
             c.relrowsecurity AS rls,
             c.relforcerowsecurity AS force,
             pg_get_expr(c.relpartbound, c.oid) AS bounds,
             (SELECT count(*)::int FROM pg_policies p
               WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS own_policies
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = 'public.audit_logs'::regclass
      ORDER BY c.relname
    `);

    expect(partitions.length).toBeGreaterThan(0);
    for (const p of partitions) {
      expect({ table: p.relname, rls: p.rls, force: p.force, ownPolicies: p.own_policies }).toEqual({
        table: p.relname,
        rls: true,
        force: true,
        ownPolicies: 0,
      });
    }

    // An audit write for a month with no monthly partition has to land somewhere. Without a
    // DEFAULT partition it is rejected outright and the audit trail goes silently empty.
    expect(partitions.some((p: { bounds: string }) => p.bounds === 'DEFAULT')).toBe(true);
  });
});
