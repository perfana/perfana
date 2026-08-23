import { RlsTestHarness, O1, O2, USERS } from './rls-test-harness';

/**
 * Behaviour tests for the audit_logs partition fix (v0.2.73.0). The coverage snapshot pins the
 * catalog flags; these pin what the flags are supposed to buy:
 *
 *  1. A write for a month with no monthly partition lands instead of being rejected. That is the
 *     original bug — `audit_logs` held 0 rows for August 2026 because the newest partition ended
 *     2026-08-01 and nothing at runtime could add another (the app roles hold USAGE but not
 *     CREATE on schema public).
 *  2. A partition is not readable around the parent. Policies live on `audit_logs` and apply to
 *     parent-routed queries only, so before this fix `SELECT * FROM audit_logs_2026_07` as
 *     perfana_app returned rows that `SELECT * FROM audit_logs` correctly hid.
 *  3. Retention still works as the worker actually connects — `perfana_system`, which cannot
 *     DROP a partition and must therefore pass `rls_audit_logs_delete` to delete rows at all.
 *     If that assumption is wrong the DELETE removes nothing, raises nothing, and retention is
 *     silently dead: the same failure shape the fix exists to end.
 */
describe('audit_logs partitions under RLS', () => {
  const harness = new RlsTestHarness();
  const MARKER = 'kc-rls-audit-partition-probe';

  // The statement AuditRetentionManager issues, verbatim, so a divergence shows up here.
  const RETENTION_SQL = `
    WITH victims AS (
      SELECT id, "timestamp" FROM audit_logs
      WHERE "timestamp" < now() - make_interval(months => $1)
      ORDER BY "timestamp"
      LIMIT $2
    ), expired AS (
      DELETE FROM audit_logs a
      USING victims v
      WHERE a.id = v.id AND a."timestamp" = v."timestamp"
      RETURNING 1
    )
    SELECT count(*)::int AS deleted FROM expired`;

  async function seed(timestampSql: string, orgId: string): Promise<void> {
    await harness.rawDs.query(
      `INSERT INTO audit_logs ("timestamp", user_id, action, resource_type, resource_name, organization_id)
       VALUES (${timestampSql}, $1, 'CREATE', 'rls-partition-probe', 'probe', $2)`,
      [MARKER, orgId],
    );
  }

  async function cleanup(): Promise<void> {
    await harness.rawDs.query(`DELETE FROM audit_logs WHERE user_id = $1`, [MARKER]);
  }

  async function partitionNames(): Promise<string[]> {
    const rows = await harness.rawDs.query(
      `SELECT inhrelid::regclass::text AS name FROM pg_inherits
        WHERE inhparent = 'public.audit_logs'::regclass ORDER BY 1`,
    );
    return rows.map((r: { name: string }) => r.name);
  }

  beforeAll(async () => {
    await harness.init();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await harness.destroy();
  });

  afterEach(cleanup);

  it('accepts a write dated outside every monthly range', async () => {
    // Five years out, so the assertion does not depend on which months this database happens to
    // have. Before the default partition existed this INSERT failed with
    // "no partition of relation audit_logs found for row".
    const rows = await harness.withRollback(USERS.o1Admin, async em => {
      await em.query(
        `INSERT INTO audit_logs ("timestamp", user_id, action, resource_type, organization_id)
         VALUES (now() + interval '5 years', $1, 'CREATE', 'rls-partition-probe', $2)`,
        [MARKER, O1.id],
      );
      return em.query<{ partition: string }[]>(
        `SELECT tableoid::regclass::text AS partition FROM audit_logs WHERE user_id = $1`,
        [MARKER],
      );
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].partition).toBe('audit_logs_default');
  });

  it('hides rows from a direct partition read that the parent also hides', async () => {
    await seed(`now()`, O2.id);
    const names = await partitionNames();
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      // Name comes from pg_inherits, not from user input.
      const rows = await harness.query<{ n: number }>(
        USERS.o1Admin,
        `SELECT count(*)::int AS n FROM ${name} WHERE user_id = $1`,
        [MARKER],
      );
      expect({ partition: name, visible: rows[0].n }).toEqual({ partition: name, visible: 0 });
    }
  });

  it('still shows an org member their own rows through the parent', async () => {
    await seed(`now()`, O1.id);

    const mine = await harness.query<{ n: number }>(
      USERS.o1Admin,
      `SELECT count(*)::int AS n FROM audit_logs WHERE user_id = $1`,
      [MARKER],
    );
    expect(mine[0].n).toBe(1);

    // ...and not another organization's.
    const theirs = await harness.query<{ n: number }>(
      USERS.o2Admin,
      `SELECT count(*)::int AS n FROM audit_logs WHERE user_id = $1`,
      [MARKER],
    );
    expect(theirs[0].n).toBe(0);
  });

  it('lets the worker role delete expired rows, and only expired ones', async () => {
    await seed(`now() - interval '30 months'`, O1.id);
    await seed(`now()`, O1.id);

    const deleted = await harness.asSystem('worker', async em => {
      // Rolled back so a developer's genuinely-old audit rows are not collateral damage.
      await em.query(`BEGIN`);
      try {
        const rows = await em.query<{ deleted: number }[]>(RETENTION_SQL, [24, 10_000]);
        const survivors = await em.query<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM audit_logs WHERE user_id = $1`,
          [MARKER],
        );
        expect(survivors[0].n).toBe(1); // the recent row is untouched
        return rows[0].deleted;
      } finally {
        await em.query(`ROLLBACK`);
      }
    });

    expect(deleted).toBeGreaterThanOrEqual(1);
  });
});
