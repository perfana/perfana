/**
 * Live-DB regression test for the API-key organization carve-out.
 *
 * `AuthorizationService.isOrganizationMember` / `getAccessibleOrganizations`
 * resolve an API key's organization by reading `api_keys` through the PLAIN
 * pooled repository, outside RLS. Two `eslint-disable owned-resource-must-use-
 * request-em` comments mark the deliberate exception, and unit guards pin which
 * repository those two call sites use.
 *
 * What the unit guards cannot show is the *policy outcome* that makes the
 * exception necessary. This does: under an RLS-scoped read the key starves —
 * it cannot see its own row, because `rls_api_keys_select` asks whether the
 * caller is in the organization, which is the exact question the read exists to
 * answer. That circularity is the whole reason for the carve-out, and the
 * reason it must not be "fixed" back to `withRequestEm`.
 *
 * Requires Phase 5b migrations (roles `perfana_app`/`perfana_system`, policies,
 * helper functions) against the target database. `npm run preflight` runs it.
 */
import { O1, O2, RlsTestHarness, TestUser } from './rls-test-harness';

const KEY_ID = '00000000-0000-0000-0000-0000000ab001';
const RUN_ID = '00000000-0000-0000-0000-0000000ab002';
const SUT_ID = '00000000-0000-0000-0000-0000000ab003';
const RUN_BY_OTHER_ID = '00000000-0000-0000-0000-0000000ab004';
const TEST_RUN_ID = 'rls-apikey-fixture-001';
const TEST_RUN_BY_OTHER_ID = 'rls-apikey-fixture-002';

/**
 * How `RlsTransactionInterceptor` presents an API-key principal once
 * `getAccessibleOrganizations` has already resolved the key's org out-of-band.
 */
const keyWithOrgResolved: TestUser = {
  id: `api-key:${KEY_ID}`,
  email: 'api-key@rls-test',
  roles: ['user'],
  organizations: [O1.id],
  teams: [],
};

/**
 * The same principal *before* the carve-out answers — i.e. what the context
 * would look like if resolution were itself RLS-scoped. This is the circular
 * state the carve-out exists to escape.
 */
const keyWithNoOrgYet: TestUser = { ...keyWithOrgResolved, organizations: [] };

describe('RLS: API-key organization resolution', () => {
  const harness = new RlsTestHarness();

  beforeAll(async () => {
    await harness.init();
    const ds = harness.rawDs;

    await ds.query(
      `INSERT INTO api_keys (id, api_key, description, roles, organization_id, created_by)
       VALUES ($1, $2, 'rls fixture key', '{}', $3, 'rls-test')
       ON CONFLICT (id) DO NOTHING`,
      [KEY_ID, `rls-fixture-secret-${KEY_ID}`, O1.id],
    );
    await ds.query(
      `INSERT INTO systems_under_test (id, name, description, organization_id, created_by)
       VALUES ($1, 'RlsApiKeyFixtureSut', 'rls fixture system', $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [SUT_ID, O1.id, `api-key:${KEY_ID}`],
    );
    await ds.query(
      `INSERT INTO test_runs (id, test_run_id, system_under_test_id, test_environment, workload,
                              start_time, end_time, organization_id, created_by)
       VALUES ($1, $2, $3, 'rls-test-env', 'rls-test-workload',
               now(), now(), $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [RUN_ID, TEST_RUN_ID, SUT_ID, O1.id, `api-key:${KEY_ID}`],
    );
    // A second run in the same organization that the key did NOT create. The
    // distinction matters: `can_access_resource` has a creator branch, so a run
    // the key uploaded stays visible even with no organization context at all.
    // Only rows created by someone else — the UI, another key — actually starve.
    await ds.query(
      `INSERT INTO test_runs (id, test_run_id, system_under_test_id, test_environment, workload,
                              start_time, end_time, organization_id, created_by)
       VALUES ($1, $2, $3, 'rls-test-env', 'rls-test-workload',
               now(), now(), $4, 'kc-rls-o1-member')
       ON CONFLICT (id) DO NOTHING`,
      [RUN_BY_OTHER_ID, TEST_RUN_BY_OTHER_ID, SUT_ID, O1.id],
    );
  });

  afterAll(async () => {
    const ds = harness.rawDs;
    await ds.query('DELETE FROM test_runs WHERE id = ANY($1::uuid[])', [[RUN_ID, RUN_BY_OTHER_ID]]);
    await ds.query('DELETE FROM systems_under_test WHERE id = $1', [SUT_ID]);
    await ds.query('DELETE FROM api_keys WHERE id = $1', [KEY_ID]);
    await harness.destroy();
  });

  describe('why the carve-out exists', () => {
    it('an RLS-scoped read cannot resolve the key own organization — it starves', async () => {
      // This is the circular state: to see the api_keys row that says which org
      // the key belongs to, the GUC would already have to name that org.
      const rows = await harness.query(
        keyWithNoOrgYet,
        'SELECT id FROM api_keys WHERE id = $1',
        [KEY_ID],
      );

      expect(rows).toHaveLength(0);
    });

    it('the unscoped read the production code actually uses does resolve it', async () => {
      // No SET ROLE, no GUCs — exactly what the pooled repository does at the
      // two eslint-disabled call sites.
      const rows = await harness.rawDs.query(
        'SELECT organization_id FROM api_keys WHERE id = $1',
        [KEY_ID],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].organization_id).toBe(O1.id);
    });

    it('api_keys is FORCE ROW LEVEL SECURITY, so the unscoped read works only via role bypass', async () => {
      const rows = await harness.rawDs.query(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'api_keys'::regclass`,
      );

      expect(rows[0].relrowsecurity).toBe(true);
      expect(rows[0].relforcerowsecurity).toBe(true);
    });
  });

  describe('once resolution has happened out-of-band', () => {
    it('the key reads both its own run and a colleague run in the organization', async () => {
      const rows = await harness.query(
        keyWithOrgResolved,
        'SELECT test_run_id FROM test_runs WHERE id = ANY($1::uuid[]) ORDER BY test_run_id',
        [[RUN_ID, RUN_BY_OTHER_ID]],
      );

      expect(rows.map(r => r.test_run_id)).toEqual([TEST_RUN_ID, TEST_RUN_BY_OTHER_ID]);
    });

    it('a key scoped to another organization reads only what it created itself', async () => {
      const otherOrgKey: TestUser = { ...keyWithOrgResolved, organizations: [O2.id] };

      const rows = await harness.query(
        otherOrgKey,
        'SELECT test_run_id FROM test_runs WHERE id = ANY($1::uuid[])',
        [[RUN_ID, RUN_BY_OTHER_ID]],
      );

      // Not zero: `can_access_resource` grants the creator access regardless of
      // organization, and this key uploaded RUN_ID. The cross-tenant guarantee
      // is that it cannot reach the run somebody else created.
      expect(rows.map(r => r.test_run_id)).toEqual([TEST_RUN_ID]);
    });
  });

  describe('what an unresolved organization actually costs', () => {
    // The failure mode the boot assertion prevents. It is a partial blindness,
    // not a clean shutdown, which is why it reads as a confusing bug in the
    // field rather than an outage: the key keeps working for runs it uploaded
    // itself and silently stops seeing everything else in the same org.
    it('keeps reading runs it created itself, via the creator branch', async () => {
      const rows = await harness.query(
        keyWithNoOrgYet,
        'SELECT test_run_id FROM test_runs WHERE id = $1',
        [RUN_ID],
      );

      expect(rows.map(r => r.test_run_id)).toEqual([TEST_RUN_ID]);
    });

    it('stops seeing a run created by anyone else in its own organization', async () => {
      const rows = await harness.query(
        keyWithNoOrgYet,
        'SELECT test_run_id FROM test_runs WHERE id = $1',
        [RUN_BY_OTHER_ID],
      );

      expect(rows).toHaveLength(0);
    });
  });
});
