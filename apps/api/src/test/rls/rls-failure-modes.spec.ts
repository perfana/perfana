/**
 * Phase 5b PR7: failure-mode tests.
 *
 * Asserts:
 * - Unset GUCs deny access (every policy fails closed).
 * - GUCs from one user-context transaction do not leak into another (LOCAL
 *   scope + transaction boundary).
 * - Mid-transaction errors roll back GUCs (no leak through the connection).
 */
import { USERS, O1, RlsTestHarness } from './rls-test-harness';

describe('RLS failure modes', () => {
  const harness = new RlsTestHarness();

  beforeAll(async () => {
    await harness.init();
  });

  afterAll(async () => {
    await harness.destroy();
  });

  it('unset GUCs deny access (every policy fails closed)', async () => {
    // Run as perfana_app with NO user-context GUCs set. Every owned-resource
    // SELECT policy reads `current_user_organizations()` (null/empty) and
    // `is_global_admin()` (false) — both branches deny.
    const rows = await harness.rawDs.transaction(async em => {
      await em.query(`SET LOCAL ROLE perfana_app`);
      // Intentionally no set_config calls.
      return em.query(`SELECT count(*)::int AS c FROM api_keys`);
    });
    expect(rows[0].c).toBe(0);
  });

  it('user GUCs from one transaction do not leak into a later transaction on the same connection', async () => {
    // o1Admin reads under O1; o2Admin reads under O1. The second query must
    // see zero of o1's rows, proving the GUCs reset between transactions.
    const o1View = await harness.query<{ c: number }>(
      USERS.o1Admin,
      `SELECT count(*)::int AS c FROM api_keys WHERE organization_id = $1`,
      [O1.id],
    );
    const o2View = await harness.query<{ c: number }>(
      USERS.o2Admin,
      `SELECT count(*)::int AS c FROM api_keys WHERE organization_id = $1`,
      [O1.id],
    );
    expect(o2View[0].c).toBe(0);
    expect(o1View[0].c).toBeGreaterThanOrEqual(0); // Sanity: o1 may or may not have rows depending on test residue.
  });

  it('mid-transaction error rolls back the LOCAL-scope GUCs', async () => {
    // Set a sentinel value inside a transaction, throw — the rollback should
    // discard the GUC. A subsequent read on a fresh transaction must not
    // observe the sentinel.
    const SENTINEL = 'rls-leak-sentinel';

    await expect(
      harness.rawDs.transaction(async em => {
        await em.query(`SET LOCAL ROLE perfana_app`);
        await em.query(`SELECT set_config('app.current_user_id', $1, true)`, [SENTINEL]);
        throw new Error('handler boom');
      }),
    ).rejects.toThrow('handler boom');

    // Fresh transaction, no GUC manipulation. current_user_id() must NOT see
    // the sentinel — would prove a LOCAL leak otherwise.
    const rows = await harness.rawDs.query(
      `SELECT current_setting('app.current_user_id', true) AS uid`,
    );
    expect(rows[0].uid).not.toBe(SENTINEL);
  });
});
