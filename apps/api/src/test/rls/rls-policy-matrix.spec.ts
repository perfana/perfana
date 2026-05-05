/**
 * Phase 5b PR7: parameterized RLS policy matrix.
 *
 * For each owned-resource entity covered by `ENTITY_FIXTURES`, runs:
 *   - SELECT × {super-admin, o1Admin, o2Admin, o1Member, o1Viewer, nobody, system}
 *   - UPDATE × {o1Admin against own/foreign org}
 *   - DELETE × {o1Admin against own/foreign org}
 *
 * Initial scope: 8 representative owned-resource tables covering the FK shapes
 * in the project (top-level org-owned, top-level user-owned, child-of-org-via-
 * parent). The remaining 18 owned-resource tables follow the same pattern and
 * land in follow-up PRs as the matrix is filled in.
 *
 * Tests run against `AppDataSource` (the migration-bearing DB). Fixtures use
 * `rawDs` (owner role) to bypass RLS for setup and cleanup.
 */
import { DataSource } from 'typeorm';
import { O1, O2, USERS, RlsTestHarness } from './rls-test-harness';

type FixtureFn = (ds: DataSource, orgId: string) => Promise<{ id: string; ownerColumn?: string; idColumn?: string }>;

/**
 * Each fixture inserts a minimal-valid row owned by `orgId` and returns its
 * primary key. `ownerColumn` / `idColumn` default to `organization_id` / `id`
 * but a few entities use different names (none in this initial scope).
 */
const ENTITY_FIXTURES: Record<string, FixtureFn> = {
  api_keys: async (ds, orgId) => {
    const rows = await ds.query(
      `INSERT INTO api_keys (id, organization_id, created_by, description, api_key)
       VALUES (gen_random_uuid(), $1, 'fixture-creator', $2, $3)
       RETURNING id`,
      [orgId, `rls-fixture-${orgId}-${Date.now()}-${Math.random()}`, `key-${orgId}-${Date.now()}-${Math.random()}`],
    );
    return { id: rows[0].id };
  },

  grafana_instances: async (ds, orgId) => {
    const rows = await ds.query(
      `INSERT INTO grafana_instances (id, organization_id, label, client_url, org_id, created_by)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'fixture-creator')
       RETURNING id`,
      [orgId, `rls-fixture-${orgId}-${Date.now()}`, `https://example.com/${Date.now()}`, '1'],
    );
    return { id: rows[0].id };
  },

  systems_under_test: async (ds, orgId) => {
    const rows = await ds.query(
      `INSERT INTO systems_under_test (id, organization_id, name, description, created_by)
       VALUES (gen_random_uuid(), $1, $2, $3, 'fixture-creator')
       RETURNING id`,
      [orgId, `rls-fixture-sut-${orgId}-${Date.now()}-${Math.random()}`, 'RLS fixture SUT'],
    );
    return { id: rows[0].id };
  },

  notification_channels: async (ds, orgId) => {
    // Needs a parent SUT in the same org.
    const sut = await ds.query(
      `INSERT INTO systems_under_test (id, organization_id, name, description, created_by)
       VALUES (gen_random_uuid(), $1, $2, $3, 'fixture-creator')
       RETURNING id`,
      [orgId, `rls-fixture-nc-sut-${orgId}-${Date.now()}-${Math.random()}`, 'Parent for notification channel fixture'],
    );
    const rows = await ds.query(
      `INSERT INTO notification_channels (id, organization_id, system_under_test_id, type, name, webhook_url, created_by)
       VALUES (gen_random_uuid(), $1, $2, 'slack', $3, 'https://hooks.slack.com/services/test', 'fixture-creator')
       RETURNING id`,
      [orgId, sut[0].id, `rls-fixture-channel-${orgId}-${Date.now()}-${Math.random()}`],
    );
    return { id: rows[0].id };
  },

  profiles: async (ds, orgId) => {
    const rows = await ds.query(
      `INSERT INTO profiles (id, organization_id, name, description, created_by)
       VALUES (gen_random_uuid(), $1, $2, 'RLS fixture profile', 'fixture-creator')
       RETURNING id`,
      [orgId, `rls-fixture-profile-${orgId}-${Date.now()}-${Math.random()}`],
    );
    return { id: rows[0].id };
  },

  graph_presets: async (ds, orgId) => {
    const rows = await ds.query(
      `INSERT INTO graph_presets (id, organization_id, name, user_id, series_config, created_by)
       VALUES (gen_random_uuid(), $1, $2, 'fixture-creator', '[]'::jsonb, 'fixture-creator')
       RETURNING id`,
      [orgId, `rls-fixture-gp-${orgId}-${Date.now()}-${Math.random()}`],
    );
    return { id: rows[0].id };
  },

  compare_filter_presets: async (ds, orgId) => {
    const rows = await ds.query(
      `INSERT INTO compare_filter_presets (id, organization_id, name, preset_type, created_by)
       VALUES (gen_random_uuid(), $1, $2, 'generic', 'fixture-creator')
       RETURNING id`,
      [orgId, `rls-fixture-cfp-${orgId}-${Date.now()}-${Math.random()}`],
    );
    return { id: rows[0].id };
  },

  benchmarks: async (ds, orgId) => {
    // Needs a parent SUT.
    const sut = await ds.query(
      `INSERT INTO systems_under_test (id, organization_id, name, description, created_by)
       VALUES (gen_random_uuid(), $1, $2, 'Parent for benchmark fixture', 'fixture-creator')
       RETURNING id`,
      [orgId, `rls-fixture-bm-sut-${orgId}-${Date.now()}-${Math.random()}`],
    );
    // Source = 'dynatrace' avoids the dashboardUid/id requirement enforced by
    // the validate_benchmark_configuration trigger on grafana-sourced rows.
    // Workload + test_environment are distinct per fixture row to avoid the
    // COALESCE-based unique constraint when rows from different orgs share
    // NULL application_dashboard_id / generic_check_id.
    const rows = await ds.query(
      `INSERT INTO benchmarks (
         id, organization_id, system_under_test_id, test_environment, workload,
         source, configuration, created_by
       ) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'dynatrace', '{}'::jsonb, 'fixture-creator')
       RETURNING id`,
      [orgId, sut[0].id, `env-${orgId}-${Date.now()}`, `wl-${orgId}-${Date.now()}-${Math.random()}`],
    );
    return { id: rows[0].id };
  },
};

const TABLES = Object.keys(ENTITY_FIXTURES);

describe.each(TABLES)('RLS policy matrix: %s', tableName => {
  const harness = new RlsTestHarness();
  let o1Id: string;
  let o2Id: string;

  beforeAll(async () => {
    await harness.init();
    const o1 = await ENTITY_FIXTURES[tableName](harness.rawDs, O1.id);
    const o2 = await ENTITY_FIXTURES[tableName](harness.rawDs, O2.id);
    o1Id = o1.id;
    o2Id = o2.id;
  });

  afterAll(async () => {
    // Clean up fixture rows. Cascade-delete handles parent SUTs for child
    // fixtures (notification_channels, benchmarks) implicitly via FK.
    await harness.rawDs.query(`DELETE FROM ${tableName} WHERE id IN ($1, $2)`, [o1Id, o2Id]);
    await harness.destroy();
  });

  describe('SELECT policy', () => {
    const cases: ReadonlyArray<readonly [string, keyof typeof USERS, () => string[]]> = [
      ['super-admin sees all rows', 'super', () => [o1Id, o2Id]],
      ['o1Admin sees only O1 rows', 'o1Admin', () => [o1Id]],
      ['o2Admin sees only O2 rows', 'o2Admin', () => [o2Id]],
      ['o1Member sees only O1 rows', 'o1Member', () => [o1Id]],
      ['o1Viewer sees only O1 rows', 'o1Viewer', () => [o1Id]],
      ['nobody sees zero rows', 'nobody', () => []],
    ];

    it.each(cases)('%s', async (_label, userKey, expectedIdsFn) => {
      const rows = await harness.query<{ id: string }>(
        USERS[userKey],
        `SELECT id FROM ${tableName} WHERE id IN ($1, $2) ORDER BY id`,
        [o1Id, o2Id],
      );
      expect(rows.map(r => r.id).sort()).toEqual([...expectedIdsFn()].sort());
    });

    it('system context (worker) sees all fixture rows', async () => {
      const rows = await harness.asSystem('worker', em =>
        em.query(`SELECT id FROM ${tableName} WHERE id IN ($1, $2) ORDER BY id`, [o1Id, o2Id]),
      );
      expect(rows.map((r: { id: string }) => r.id).sort()).toEqual([o1Id, o2Id].sort());
    });
  });

  // TypeORM's `em.query()` against pg returns `[rows, affectedCount]` for
  // UPDATE/DELETE...RETURNING; unwrap to the row array for assertions.
  const unwrapMutation = (result: unknown): { id: string }[] => {
    if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0])) {
      return result[0] as { id: string }[];
    }
    return result as { id: string }[];
  };

  describe('UPDATE policy', () => {
    it('o1Admin can update O1 rows', async () => {
      const result = await harness.withRollback<unknown>(
        USERS.o1Admin,
        em => em.query(
          `UPDATE ${tableName} SET updated_at = now() WHERE id = $1 RETURNING id`,
          [o1Id],
        ),
      );
      const rows = unwrapMutation(result);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(o1Id);
    });

    it('o1Admin cannot update O2 rows (RLS hides them)', async () => {
      const result = await harness.withRollback<unknown>(
        USERS.o1Admin,
        em => em.query(
          `UPDATE ${tableName} SET updated_at = now() WHERE id = $1 RETURNING id`,
          [o2Id],
        ),
      );
      expect(unwrapMutation(result)).toHaveLength(0);
    });

    it('nobody cannot update any row', async () => {
      const result = await harness.withRollback<unknown>(
        USERS.nobody,
        em => em.query(
          `UPDATE ${tableName} SET updated_at = now() WHERE id IN ($1, $2) RETURNING id`,
          [o1Id, o2Id],
        ),
      );
      expect(unwrapMutation(result)).toHaveLength(0);
    });
  });

  describe('DELETE policy', () => {
    it('o1Admin can delete O1 rows (rolled back)', async () => {
      const result = await harness.withRollback<unknown>(
        USERS.o1Admin,
        em => em.query(
          `DELETE FROM ${tableName} WHERE id = $1 RETURNING id`,
          [o1Id],
        ),
      );
      expect(unwrapMutation(result)).toHaveLength(1);
    });

    it('o1Admin cannot delete O2 rows', async () => {
      const result = await harness.withRollback<unknown>(
        USERS.o1Admin,
        em => em.query(
          `DELETE FROM ${tableName} WHERE id = $1 RETURNING id`,
          [o2Id],
        ),
      );
      expect(unwrapMutation(result)).toHaveLength(0);
    });
  });
});
