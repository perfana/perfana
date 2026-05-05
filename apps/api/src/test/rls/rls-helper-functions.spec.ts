/**
 * Phase 5b PR7: direct SQL invocation tests for the RLS helper functions
 * (`is_global_admin`, `can_access_resource`, `can_modify_resource`). Pins the
 * post-Phase-4 fail-closed semantics from migration
 * `1778100000000-TightenRlsHelpers` and the loose-by-design org-membership
 * backstop in `can_modify_resource`.
 *
 * Tests run against `AppDataSource` (the migration-bearing DB). The helpers
 * are SECURITY DEFINER so they don't require `SET ROLE perfana_app` — only
 * the GUCs need to be set.
 */
import { DataSource, EntityManager } from 'typeorm';
import { AppDataSource } from '../../data-source';

type HelperName = 'is_global_admin' | 'can_access_resource' | 'can_modify_resource';

type GucBag = {
  user_id?: string | null;
  orgs?: string[];
  teams?: string[];
  roles?: string[];
};

const ORG_A = '00000000-0000-0000-0000-000000000a01';
const ORG_B = '00000000-0000-0000-0000-000000000a02';

describe('RLS helper functions', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = AppDataSource;
    if (!ds.isInitialized) await ds.initialize();
  });

  afterAll(async () => {
    // Don't destroy: shared with other RLS specs in the same Jest worker.
  });

  async function applyGucs(em: EntityManager, gucs: GucBag): Promise<void> {
    if (gucs.user_id !== undefined) {
      await em.query(`SELECT set_config('app.current_user_id', $1, true)`, [gucs.user_id ?? '']);
    }
    if (gucs.orgs) {
      await em.query(`SELECT set_config('app.current_user_organizations', $1, true)`, [JSON.stringify(gucs.orgs)]);
    }
    if (gucs.teams) {
      await em.query(`SELECT set_config('app.current_user_teams', $1, true)`, [JSON.stringify(gucs.teams)]);
    }
    if (gucs.roles) {
      await em.query(`SELECT set_config('app.current_user_roles', $1, true)`, [JSON.stringify(gucs.roles)]);
    }
  }

  async function callHelper(fn: HelperName, args: unknown[], gucs: GucBag): Promise<boolean> {
    return ds.transaction(async em => {
      await applyGucs(em, gucs);
      const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
      const rows: { ok: boolean }[] = await em.query(
        `SELECT ${fn}(${placeholders}) AS ok`,
        args,
      );
      return rows[0].ok;
    });
  }

  describe('is_global_admin', () => {
    it('returns true for super-admin role', async () => {
      expect(await callHelper('is_global_admin', [], { roles: ['super-admin'] })).toBe(true);
    });

    it('returns true for system-admin role', async () => {
      expect(await callHelper('is_global_admin', [], { roles: ['system-admin'] })).toBe(true);
    });

    it('returns false for org-admin (NOT a global admin)', async () => {
      expect(await callHelper('is_global_admin', [], { roles: ['org-admin'] })).toBe(false);
    });

    it('returns false for plain user role', async () => {
      expect(await callHelper('is_global_admin', [], { roles: ['user'] })).toBe(false);
    });

    it('returns false for an empty roles GUC', async () => {
      expect(await callHelper('is_global_admin', [], { roles: [] })).toBe(false);
    });
  });

  describe('can_access_resource', () => {
    it('returns true for global admin regardless of org', async () => {
      expect(
        await callHelper('can_access_resource', [ORG_A, null, null], {
          user_id: 'super', roles: ['super-admin'], orgs: [], teams: [],
        }),
      ).toBe(true);
    });

    it('returns false for null org_id (post-Phase-4 fail-closed)', async () => {
      expect(
        await callHelper('can_access_resource', [null, null, null], {
          user_id: 'u', roles: ['user'], orgs: [ORG_A], teams: [],
        }),
      ).toBe(false);
    });

    it('returns true when org_id ∈ user orgs', async () => {
      expect(
        await callHelper('can_access_resource', [ORG_A, null, null], {
          user_id: 'u', roles: ['user'], orgs: [ORG_A], teams: [],
        }),
      ).toBe(true);
    });

    it('returns false when org_id ∉ user orgs', async () => {
      expect(
        await callHelper('can_access_resource', [ORG_B, null, null], {
          user_id: 'u', roles: ['user'], orgs: [ORG_A], teams: [],
        }),
      ).toBe(false);
    });

    it('returns true when created_by = current_user_id (creator escape hatch)', async () => {
      expect(
        await callHelper('can_access_resource', [ORG_B, null, 'u'], {
          user_id: 'u', roles: ['user'], orgs: [ORG_A], teams: [],
        }),
      ).toBe(true);
    });

    it('returns false for a creator string that does not match current_user_id', async () => {
      expect(
        await callHelper('can_access_resource', [ORG_B, null, 'someone-else'], {
          user_id: 'u', roles: ['user'], orgs: [ORG_A], teams: [],
        }),
      ).toBe(false);
    });
  });

  describe('can_modify_resource', () => {
    it('returns true for global admin', async () => {
      expect(
        await callHelper('can_modify_resource', [ORG_A, null, null], {
          user_id: 'super', roles: ['super-admin'], orgs: [], teams: [],
        }),
      ).toBe(true);
    });

    it('returns false for null org_id (fail-closed)', async () => {
      expect(
        await callHelper('can_modify_resource', [null, null, null], {
          user_id: 'u', roles: ['org-admin'], orgs: [ORG_A], teams: [],
        }),
      ).toBe(false);
    });

    it('returns true for the resource creator', async () => {
      expect(
        await callHelper('can_modify_resource', [ORG_A, null, 'creator-id'], {
          user_id: 'creator-id', roles: ['user'], orgs: [], teams: [],
        }),
      ).toBe(true);
    });

    it('returns true for org-admin in the resource org', async () => {
      expect(
        await callHelper('can_modify_resource', [ORG_A, null, 'other'], {
          user_id: 'admin', roles: ['org-admin'], orgs: [ORG_A], teams: [],
        }),
      ).toBe(true);
    });

    it('returns true for plain org-member in the resource org (loose-by-design backstop)', async () => {
      expect(
        await callHelper('can_modify_resource', [ORG_A, null, 'other'], {
          user_id: 'member', roles: ['user', 'org-member'], orgs: [ORG_A], teams: [],
        }),
      ).toBe(true);
    });

    it('returns false for foreign-org user', async () => {
      expect(
        await callHelper('can_modify_resource', [ORG_A, null, 'other'], {
          user_id: 'foreign',
          roles: ['org-admin'],
          orgs: ['00000000-0000-0000-0000-000000000bbb'],
          teams: [],
        }),
      ).toBe(false);
    });

    it('returns false when no GUCs are set (every path fails closed)', async () => {
      const result = await ds.transaction(async em => {
        const rows: { ok: boolean }[] = await em.query(
          `SELECT can_modify_resource($1, $2, $3) AS ok`,
          [ORG_A, null, 'creator'],
        );
        return rows[0].ok;
      });
      expect(result).toBe(false);
    });
  });
});
