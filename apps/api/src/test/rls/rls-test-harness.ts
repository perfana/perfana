/**
 * Phase 5b PR7: shared harness for RLS policy + helper-function tests.
 *
 * Provides:
 * - A canonical set of test users covering global-admin, per-org admin/member/
 *   viewer, and the unauthenticated edge.
 * - `asUser` / `query` helpers that wrap a transaction in `SET LOCAL ROLE
 *   perfana_app` and the four GUCs (`app.current_user_id`, `_organizations`,
 *   `_teams`, `_roles`) that the RLS helpers read.
 * - `asSystem` for parity with how non-API processes connect via
 *   `buildSystemConnectionPreamble` (super-admin role short-circuit).
 *
 * Design note: the original plan included an `asUser` variant that auto-rolled-
 * back the wrapping transaction. That implementation conflicts with returning
 * a value from the closure (re-throwing to force rollback discards the result).
 * We landed on `query()` for SELECT-shaped assertions (no mutation, no rollback
 * needed) plus `withRollback()` for tests that intentionally mutate and want
 * to discard the change. Both reset GUCs at transaction end.
 */
import { DataSource, EntityManager } from 'typeorm';
import { AppDataSource } from '../../data-source';
import { SystemActor, buildSystemConnectionPreamble } from '@perfana/shared/database/system-connection';

export type TestUser = {
  id: string;
  email: string;
  roles: string[];
  organizations: string[];
  teams: string[];
};

export type TestOrg = { id: string; name: string };

export const O1: TestOrg = { id: '00000000-0000-0000-0000-000000000a01', name: 'RLS Test Org A' };
export const O2: TestOrg = { id: '00000000-0000-0000-0000-000000000a02', name: 'RLS Test Org B' };

export const USERS: Record<string, TestUser> = {
  super: {
    id: 'kc-rls-super',
    email: 'super@rls-test',
    roles: ['super-admin'],
    organizations: [O1.id, O2.id],
    teams: [],
  },
  o1Admin: {
    id: 'kc-rls-o1-admin',
    email: 'o1admin@rls-test',
    roles: ['user', 'org-admin'],
    organizations: [O1.id],
    teams: [],
  },
  o2Admin: {
    id: 'kc-rls-o2-admin',
    email: 'o2admin@rls-test',
    roles: ['user', 'org-admin'],
    organizations: [O2.id],
    teams: [],
  },
  o1Member: {
    id: 'kc-rls-o1-member',
    email: 'o1member@rls-test',
    roles: ['user', 'org-member'],
    organizations: [O1.id],
    teams: [],
  },
  o1Viewer: {
    id: 'kc-rls-o1-viewer',
    email: 'o1viewer@rls-test',
    roles: ['user', 'org-viewer'],
    organizations: [O1.id],
    teams: [],
  },
  nobody: {
    id: 'kc-rls-nobody',
    email: 'nobody@rls-test',
    roles: ['user'],
    organizations: [],
    teams: [],
  },
};

export class RlsTestHarness {
  private ds!: DataSource;

  async init(): Promise<void> {
    this.ds = AppDataSource;
    if (!this.ds.isInitialized) await this.ds.initialize();
    // Seed test orgs idempotently so fixture rows can FK to them. Uses owner
    // role (no SET ROLE) so RLS doesn't apply to the seed.
    await this.ds.query(
      `INSERT INTO organizations (id, name) VALUES ($1, $2), ($3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [O1.id, O1.name, O2.id, O2.name],
    );
  }

  async destroy(): Promise<void> {
    // Don't tear down the shared DataSource; later suites may need it.
  }

  /** Direct DataSource for fixture seeding / cleanup that bypasses RLS. */
  get rawDs(): DataSource {
    return this.ds;
  }

  /**
   * Run `fn` inside a transaction with `SET LOCAL ROLE perfana_app` and the
   * four user-context GUCs populated. Returns the closure's value. The caller
   * is responsible for any rollback semantics; use `withRollback` if you want
   * mutations discarded.
   */
  async asUser<T>(user: TestUser, fn: (em: EntityManager) => Promise<T>): Promise<T> {
    return this.ds.transaction(async em => {
      await applyUserContext(em, user);
      return fn(em);
    });
  }

  /**
   * Like `asUser`, but the wrapping transaction always rolls back. Use for
   * tests that intentionally mutate fixture rows but don't want the change
   * to persist.
   */
  async withRollback<T>(user: TestUser, fn: (em: EntityManager) => Promise<T>): Promise<T> {
    const sentinel = { value: undefined as T | undefined };
    const ROLLBACK = Symbol('rollback');
    try {
      await this.ds.transaction(async em => {
        await applyUserContext(em, user);
        sentinel.value = await fn(em);
        throw ROLLBACK;
      });
    } catch (err) {
      if (err !== ROLLBACK) throw err;
    }
    return sentinel.value as T;
  }

  /**
   * Convenience: run a SELECT-shaped query under a user context. The wrapping
   * transaction commits (no mutation, nothing to roll back).
   */
  async query<T>(user: TestUser, sql: string, params: unknown[] = []): Promise<T[]> {
    return this.asUser(user, em => em.query(sql, params) as Promise<T[]>);
  }

  /**
   * Run `fn` as a system actor: SET ROLE perfana_system + super-admin role
   * GUC short-circuit. Mirrors how worker / grafana-sync / perfana-report
   * connections are configured by `buildSystemConnectionPreamble`.
   */
  async asSystem<T>(actor: SystemActor, fn: (em: EntityManager) => Promise<T>): Promise<T> {
    const conn = this.ds.createQueryRunner();
    try {
      await conn.connect();
      for (const stmt of buildSystemConnectionPreamble(actor)) {
        await conn.query(stmt);
      }
      return await fn(conn.manager);
    } finally {
      try { await conn.query(`RESET ROLE`); } catch { /* best-effort */ }
      try { await conn.query(`RESET app.current_user_id`); } catch { /* best-effort */ }
      try { await conn.query(`RESET app.current_user_organizations`); } catch { /* best-effort */ }
      try { await conn.query(`RESET app.current_user_teams`); } catch { /* best-effort */ }
      try { await conn.query(`RESET app.current_user_roles`); } catch { /* best-effort */ }
      await conn.release();
    }
  }
}

async function applyUserContext(em: EntityManager, user: TestUser): Promise<void> {
  await em.query(`SET LOCAL ROLE perfana_app`);
  await em.query(`SELECT set_config('app.current_user_id', $1, true)`, [user.id]);
  await em.query(`SELECT set_config('app.current_user_organizations', $1, true)`, [JSON.stringify(user.organizations)]);
  await em.query(`SELECT set_config('app.current_user_teams', $1, true)`, [JSON.stringify(user.teams)]);
  await em.query(`SELECT set_config('app.current_user_roles', $1, true)`, [JSON.stringify(user.roles)]);
}
