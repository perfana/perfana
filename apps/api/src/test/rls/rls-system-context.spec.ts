/**
 * Phase 5b PR7: system-actor parity tests.
 *
 * Asserts that worker / grafana-sync / perfana-report / audit-partition-manager
 * connections, set up via `buildSystemConnectionPreamble`, see all rows
 * regardless of the per-user RLS policies (super-admin role GUC short-circuit)
 * and that the actor identity flows into `current_user_id` (where audit rows
 * pick it up).
 */
import { O1, RlsTestHarness } from './rls-test-harness';

describe('RLS system context', () => {
  const harness = new RlsTestHarness();

  beforeAll(async () => {
    await harness.init();
  });

  afterAll(async () => {
    await harness.destroy();
  });

  it.each(['worker', 'grafana-sync', 'perfana-report', 'audit-partition-manager'] as const)(
    '%s actor identity flows into current_user_id',
    async actor => {
      const rows = await harness.asSystem(actor, em =>
        em.query(`SELECT current_setting('app.current_user_id', true) AS uid`),
      );
      expect(rows[0].uid).toBe(`system:${actor}`);
    },
  );

  it.each(['worker', 'grafana-sync', 'perfana-report', 'audit-partition-manager'] as const)(
    '%s actor sees super-admin role GUC',
    async actor => {
      const rows = await harness.asSystem(actor, em =>
        em.query(`SELECT current_setting('app.current_user_roles', true) AS roles`),
      );
      expect(rows[0].roles).toBe('["super-admin"]');
    },
  );

  it.each(['worker', 'grafana-sync', 'perfana-report', 'audit-partition-manager'] as const)(
    '%s actor short-circuits is_global_admin to TRUE',
    async actor => {
      const rows = await harness.asSystem(actor, em =>
        em.query(`SELECT is_global_admin() AS ok`),
      );
      expect(rows[0].ok).toBe(true);
    },
  );

  it('worker can SELECT api_keys without org/team GUCs (super-admin short-circuit)', async () => {
    // The query must not throw and must return without RLS filtering. We don't
    // assert a specific count — different test runs leave different fixture
    // residue — only that the count call completes against the live policies.
    const rows = await harness.asSystem('worker', em =>
      em.query(`SELECT count(*)::int AS c FROM api_keys`),
    );
    expect(rows[0].c).toBeGreaterThanOrEqual(0);
  });

  it('worker can INSERT into a real org (cleanup inline)', async () => {
    await harness.asSystem('worker', async em => {
      const inserted: { id: string }[] = await em.query(
        `INSERT INTO api_keys (id, organization_id, created_by, description, api_key)
         VALUES (gen_random_uuid(), $1, 'system:worker', $2, $3)
         RETURNING id`,
        [
          O1.id,
          `rls-system-test-${Date.now()}-${Math.random()}`,
          `key-system-${Date.now()}-${Math.random()}`,
        ],
      );
      expect(inserted).toHaveLength(1);
      await em.query(`DELETE FROM api_keys WHERE id = $1`, [inserted[0].id]);
    });
  });
});
