# RBAC Phase 5b — Row-Level Security Activation (Design Spec)

**Status:** Brainstormed 2026-05-04. Implementation plan to follow via `superpowers:writing-plans`.

**Predecessors:** RBAC Phases 1–5a — all complete as of `2249ae4` (PR #259) on 2026-05-04. Phase 5a's CLS infrastructure (PR #229) is a direct dependency.

**Successors:** A future Phase 5c (security monitoring: ACCESS_DENIED + auth event mirroring) — separate spec/plan.

---

## 1. Purpose & Scope

### 1.1 What this phase actually is

Despite the CLAUDE.md "Pending — separate spec to be drafted" framing, Phase 5b is **not** a from-scratch design. The repo already contains:

- 25 tables with `FORCE ROW LEVEL SECURITY` enabled at the schema level.
- ~100 `CREATE POLICY rls_<table>_{select,insert,update,delete}` declarations (4 per table).
- DB helper functions: `is_global_admin()`, `can_access_resource(uuid, uuid, text)`, `can_modify_resource(uuid, uuid, text)`, `current_user_id()`, `current_user_organizations()`, `current_user_teams()` — all reading the four GUCs `app.current_user_id`, `app.current_user_organizations`, `app.current_user_teams`, `app.current_user_roles`.
- A non-bypass-RLS role `perfana_app` (`NOSUPERUSER NOBYPASSRLS NOLOGIN`).
- An env var `DB_ENABLE_RLS_ROLE` defined in `apps/api/src/config/env.validation.ts` — but no code reads it. The flag is wired to nothing.

What's **missing** for activation:

- No middleware that runs `SET LOCAL ROLE perfana_app` or sets the four GUCs per request. The CLS infrastructure from Phase 5a (PR #229) is the natural carrier but isn't connected to RLS.
- The `can_access_resource` helper has a pre-Phase-4 escape hatch (`IF resource_org_id IS NULL THEN RETURN TRUE`) that contradicts the Phase 4 invariant that `organization_id` is `NOT NULL` on every owned-resource entity.
- Two tables (`url_patterns`, `generated_reports`) had their policies temporarily downgraded to `USING (true)` after `team_id` was dropped from them in `1776148518354-AddWorkloadToEvents`. `generated_reports` had its ownership columns restored in Phase 4; the policy needs re-tightening.
- `test_runs.organization_id` is documented in CLAUDE.md as "vestigial" because access is checked via the joined SUT. The current `rls_test_runs_select` policy uses the column directly — combined with the helper's NULL-org branch, any test_run with `organization_id IS NULL` becomes world-visible the moment RLS is enforced.
- `audit_logs.organization_id` is intentionally nullable for system events but the current policy uses the standard helper, which would either leak system events to all org-admins or hide them from super-admins, depending on which branch runs.
- The worker, grafana-sync, and report apps run their own DB sessions and have no RLS posture decided.

So Phase 5b is **activation + audit**: connect CLS to GUCs, switch the API to a non-bypass role, repair the helpers and the special-case tables, and turn the env flag on.

### 1.2 Use cases this phase serves

- **Defense-in-depth on multi-tenant data.** A bug in service-layer authorization (a missing `withOrgFilter`, a forgotten capability check) cannot leak cross-tenant rows because the database physically refuses to return them.
- **Audit-grade tenant isolation guarantee.** Compliance reviewers can be told "RLS is enforced at the database level; even a SQL-injection-shaped bug in a service can only see the requesting user's accessible orgs." Today this is a service-layer guarantee; after 5b it's a DB-level guarantee.
- **Safer rapid development.** New services don't need to remember to filter by org — RLS catches mistakes the lint rule misses (e.g., a service that hand-writes raw SQL via `dataSource.query`).

### 1.3 Use cases deferred

- **Tamper-evidence.** RLS doesn't make the audit log tamper-evident — that's a separate cryptographic concern (5a §6.1).
- **Real-time cross-tenant access detection.** RLS silently filters; it doesn't log denied attempts. A future Phase 5c instruments `ACCESS_DENIED` at the service-layer + alerts on patterns.
- **Per-row capability gates beyond org/team/creator.** Resource-level capabilities (e.g., "this dashboard is read-only for this user") stay in the service layer; RLS handles the coarse tenant boundary only.

---

## 2. Decisions (locked through brainstorming, 2026-05-04)

| # | Decision | Rationale |
|---|---|---|
| Q1 | Scope = activation + audit; no helper redesign | Existing infra is mostly correct; the value is wiring it on, not rewriting it. Helper redesign was tempting but turns the spec into a refactor rather than an activation. |
| Q2 | Transaction-scoped `SET LOCAL` via `RlsTransactionInterceptor` | Strongest isolation, zero leak risk between requests sharing pool connections. The "every read becomes a transaction" cost is negligible on Postgres. Alternatives (per-request QueryRunner + `SET` non-LOCAL) carry real leak risk in a multi-tenant system. |
| Q3 | `perfana_system` role + identity GUCs for non-API processes | RLS still evaluates for system processes; `is_global_admin()` short-circuits via `app.current_user_roles = '["super-admin"]'`. Pairs with 5a `actorOverride` so audit identity matches DB role identity. |
| Q4 | Single boolean flag `DB_ENABLE_RLS_ROLE`, env-gated rollout | Standard feature-flag shape; reversible by config rollback. Per-table allowlists or shadow modes add infrastructure that's strictly less correct than what's already FORCE-enabled at the schema level. |
| Q5 | Keep service-layer + RLS as belt-and-suspenders | `withOrgFilter` and `AuthorizedBaseService.findAll` stay; lint rule + drift agent stay. RLS is defense-in-depth, not a replacement. ~700 LOC of belt is cheap to maintain and catches bugs at PR review rather than at runtime. |
| Q6 | Full per-entity test matrix (26 entities × 7 roles × 4 ops) | Auto-generated from a registry. Service-layer tests cover same ground but RLS tests pin the policy expressions themselves; helper-function bugs aren't caught by service-layer tests. |
| Q7 | Tighten test_runs.organization_id; special-case audit_logs policy | One-time backfill from SUT (bounded; SUT is required on every test_run). Audit_logs gets a custom policy: super-admin sees all rows including null-org; org-admin sees rows with `organization_id ∈ accessible_orgs`. |

---

## 3. Architecture

```
                              Request
                                 │
                  ┌──────────────▼──────────────┐
                  │  KeycloakEnhancedAuthGuard  │  → req.user, req.authType
                  └──────────────┬──────────────┘
                                 │
                  ┌──────────────▼──────────────┐
                  │  AuditContextInterceptor    │  (Phase 5a) → CLS REQ_CTX populated
                  │  (existing, unchanged)      │
                  └──────────────┬──────────────┘
                                 │
                  ┌──────────────▼──────────────┐
                  │  RlsTransactionInterceptor  │  (NEW)
                  │  if (DB_ENABLE_RLS_ROLE &&  │
                  │      reqCtx.userId) {       │
                  │    dataSource.transaction(  │
                  │      em => {                │
                  │        SET LOCAL ROLE       │
                  │        SET LOCAL app.current_user_id        │
                  │        SET LOCAL app.current_user_organizations │
                  │        SET LOCAL app.current_user_teams     │
                  │        SET LOCAL app.current_user_roles     │
                  │        cls.set(REQ_EM, em);                 │
                  │        return next.handle();                │
                  │      })                     │
                  │  }                          │
                  └──────────────┬──────────────┘
                                 │
                  ┌──────────────▼──────────────┐
                  │  Controller → Service       │
                  │  withRequestEm(this.repo)   │
                  │     .find(...)              │
                  │  service-layer              │
                  │  withOrgFilter still active │
                  │  (belt; RLS = suspenders)   │
                  └──────────────┬──────────────┘
                                 │
                  ┌──────────────▼──────────────┐
                  │  Postgres (perfana_app)     │
                  │  FORCE ROW LEVEL SECURITY   │
                  │  policies USING/WITH CHECK  │
                  │  consult helpers + GUCs     │
                  └─────────────────────────────┘
```

System processes (worker / grafana-sync / perfana-report / audit-partition-manager) connect via `createSystemDataSource(actor)`, which on every pool checkout runs:

```sql
SET ROLE perfana_system;
SELECT set_config('app.current_user_id', 'system:<actor>', false);
SELECT set_config('app.current_user_roles', '["super-admin"]', false);
SELECT set_config('app.current_user_organizations', '[]', false);
SELECT set_config('app.current_user_teams', '[]', false);
```

`is_global_admin()` returns true → policies short-circuit → all rows visible. `app.current_user_id` ties DB-side identity to audit-log identity. The owner role `perfana` runs migrations (DDL privileges) and is otherwise unused.

### 3.1 Trust boundary

RLS is a backstop, not the primary check. Service-layer enforcement (`withOrgFilter`, `AuthorizedBaseService`, `@RequiresCapability`) is the precise authorization model. RLS catches:

- Service code that bypasses the standard repos (raw `dataSource.query`).
- New services that forget to apply `withOrgFilter`.
- Bugs in the lint rule or its allowlist.
- SQL-injection-shaped vulnerabilities that synthesize cross-tenant queries.

Failure mode of getting RLS wrong is **always** "user sees too few rows" (false negative), never "user sees other tenants' rows" (false positive). This is by design: the policy is `USING (can_access_resource(...))`, which defaults to false; any helper bug or GUC misconfiguration causes denial, not leakage.

### 3.2 Surface area added

| Component | Status | Path |
|---|---|---|
| `RlsTransactionInterceptor` | new | `apps/api/src/common/interceptors/rls-transaction.interceptor.ts` |
| `withRequestEm` helper + `REQ_EM` symbol | new | `apps/api/src/common/db/request-em.ts` |
| `createSystemDataSource` factory | new | `packages/shared/src/database/data-source-system.ts` |
| `buildSystemConnectionPreamble` helper | new | `packages/shared/src/database/system-connection.ts` |
| `/api/me/db-context` health endpoint | new endpoint added | location TBD by plan — likely `apps/api/src/modules/users/users-permissions.controller.ts` or a new `me` module; the existing `/me/permissions` endpoint sets the precedent |
| `perfana_system` role | new migration | `1778000000000-CreatePerfanaSystemRole.ts` |
| `can_access_resource` / `can_modify_resource` tightened | migration | `1778100000000-TightenRlsHelpers.ts` |
| `generated_reports` policy retightened | migration | `1778200000000-RetightenGeneratedReportsRls.ts` |
| test_runs.organization_id NOT NULL | migration | `1778300000000-TightenTestRunsOrganizationId.ts` |
| `audit_logs` RLS rewritten | migration | `1778400000000-RewriteAuditLogsRls.ts` |
| ESLint rule `local/owned-resource-must-use-request-em` | new | `apps/api/eslint-plugin-local/rules/owned-resource-must-use-request-em.js` |
| RLS migration allowlist | new | `apps/api/.rls-em-migration-allowlist.json` |
| RLS test harness + matrix | new | `apps/api/src/test/rls/` |
| Drift-check `/schedule` agent | new (clone of 5a) | `docs/superpowers/scheduled-agents/rls-burndown-drift.md` |

System-context wiring touches three apps. None of these have a separate `db/data-source.ts` file today — the DataSource is configured via `TypeOrmModule.forRoot(...)` in each `app.module.ts`. The plan extracts the configuration into a system-aware factory:
- `apps/worker/src/app.module.ts` (currently configures TypeOrmModule inline)
- `apps/grafana-sync/src/app.module.ts`
- `apps/perfana-report/src/app.module.ts`

Each switches to `TypeOrmModule.forRootAsync({ useFactory: () => createSystemDataSourceOptions('worker', baseOpts) })` or equivalent, with the `pool.on('connect', ...)` hook attached after the data source initializes.

Service-layer migration touches ~80 call-sites across 26 owned-resource services (mechanical: `this.repo.X(...)` → `withRequestEm(this.repo).X(...)`).

---

## 4. Components

### 4.1 `RlsTransactionInterceptor`

```ts
@Injectable()
export class RlsTransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cls: ClsService,
    private readonly authz: AuthorizationService,
    @Inject(ENV_TOKEN) private readonly env: { DB_ENABLE_RLS_ROLE: 'true' | 'false' },
  ) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const reqCtx = this.cls.get<RequestContextStore>(REQ_CTX);
    if (!reqCtx?.userId || this.env.DB_ENABLE_RLS_ROLE !== 'true') {
      return next.handle();
    }
    // Roles aren't in the 5a RequestContextStore today; read from req.user, which
    // KeycloakEnhancedAuthGuard already populates. (Alternative: extend
    // RequestContextStore to include roles in PR2 — sub-decision deferred to plan.)
    const req = ctx.switchToHttp().getRequest<{ user?: { roles?: string[] } }>();
    const roles = req.user?.roles ?? [];

    const [orgs, teams] = await Promise.all([
      this.authz.getAccessibleOrganizations(reqCtx.userId),
      this.authz.getAccessibleTeams(reqCtx.userId),
    ]);
    return new Observable(subscriber => {
      this.dataSource.transaction(async em => {
        await em.query(`SET LOCAL ROLE perfana_app`);
        await em.query(`SELECT set_config('app.current_user_id', $1, true)`, [reqCtx.userId]);
        await em.query(`SELECT set_config('app.current_user_organizations', $1, true)`, [JSON.stringify(orgs)]);
        await em.query(`SELECT set_config('app.current_user_teams', $1, true)`, [JSON.stringify(teams)]);
        await em.query(`SELECT set_config('app.current_user_roles', $1, true)`, [JSON.stringify(roles)]);
        this.cls.set(REQ_EM, em);
        // toArray() instead of firstValueFrom() so streaming/multi-emit handlers
        // pass through. The transaction stays open until the source completes.
        return await lastValueFrom(next.handle().pipe(toArray()));
      })
        .then(values => { for (const v of values) subscriber.next(v); subscriber.complete(); })
        .catch(e => subscriber.error(e));
    });
  }
}
```

Interceptor order in `app.module.ts`: Keycloak → AuditContext → **RlsTransaction** → Throttler. The CLS store from AuditContext must be populated; the transaction must wrap the actual handler.

`getAccessibleOrganizations` and `getAccessibleTeams` are Redis-cached per user (Phase 3 invariant), so populating GUCs costs one cache hit on the hot path.

The `toArray()` choice matters for any endpoint that returns `Observable<T>` with multiple emissions (streaming, server-sent events). It buffers them inside the transaction, which is acceptable for typical REST handlers but problematic for true server-sent-events that emit over minutes — those endpoints need a `@SkipRls()` decorator (sub-decision: implementation plan identifies streaming endpoints and decides per-endpoint whether to keep the transaction with a sized pool, or carve out the decorator).

### 4.2 `withRequestEm` helper

```ts
export const REQ_EM = Symbol('request-entity-manager');

export function getRequestEm(): EntityManager | null {
  return ClsServiceManager.getClsService().get<EntityManager>(REQ_EM) ?? null;
}

export function withRequestEm<T>(repo: Repository<T>): Repository<T> {
  const em = getRequestEm();
  return em ? em.getRepository(repo.target) : repo;
}
```

Service call-sites: `this.repo.find(...)` → `withRequestEm(this.repo).find(...)`. When `DB_ENABLE_RLS_ROLE=false` or the call happens outside a request, `getRequestEm()` returns null and the helper returns the original repo (existing behavior).

This is mechanical and lint-enforceable (§4.7). A repo-proxy approach (e.g., `nestjs-cls-typeorm-adapter`) is cleaner long-term but adds dependency and indirection that's hard to debug; the explicit wrapper is one line per call-site, fully discoverable in code review, trivially removable.

### 4.3 System data source

```ts
// packages/shared/src/database/data-source-system.ts
export type SystemActor = 'worker' | 'grafana-sync' | 'perfana-report' | 'audit-partition-manager';

export async function createSystemDataSource(
  actor: SystemActor,
  opts: DataSourceOptions,
): Promise<DataSource> {
  const ds = new DataSource(opts);
  await ds.initialize();
  const pool = (ds.driver as any).master as Pool;
  pool.on('connect', async client => {
    try {
      for (const stmt of buildSystemConnectionPreamble(actor)) {
        await client.query(stmt);
      }
    } catch (err) {
      // Force-destroy the connection on preamble failure so it doesn't return
      // to the pool half-configured. Pool will dial up a replacement on next checkout.
      logger.error(`system preamble failed for actor=${actor}; destroying connection`, err);
      client.release(true);  // true = force destroy, not return to pool
      throw err;
    }
  });
  // Sanity check: assert role switched after first checkout
  const [{ current_user }] = await ds.query(`SELECT current_user`);
  if (current_user !== 'perfana_system') {
    throw new Error(`Expected role perfana_system after preamble, got ${current_user}`);
  }
  return ds;
}

export function buildSystemConnectionPreamble(actor: SystemActor): string[] {
  return [
    `SET ROLE perfana_system`,
    `SELECT set_config('app.current_user_id', 'system:${actor}', false)`,
    `SELECT set_config('app.current_user_roles', '["super-admin"]', false)`,
    `SELECT set_config('app.current_user_organizations', '[]', false)`,
    `SELECT set_config('app.current_user_teams', '[]', false)`,
  ];
}
```

`set_config(..., false)` sets the GUC at session level (persists for the connection's lifetime). When the connection returns to the pool, the next checkout re-runs the preamble — idempotent because actor is stable. Workers don't transaction-wrap every job, so transaction-scoped LOCAL would be wrong here.

### 4.4 Helper function tightening

Migration `1778100000000-TightenRlsHelpers.ts`:

```sql
CREATE OR REPLACE FUNCTION public.can_access_resource(
  resource_org_id uuid,
  resource_team_id uuid,
  resource_created_by text
) RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  AS $$
  BEGIN
    IF is_global_admin() THEN
      RETURN TRUE;
    END IF;
    -- Phase 4: organization_id is NOT NULL on every owned resource. A NULL
    -- here indicates a bug or a misconfigured caller — fail closed.
    IF resource_org_id IS NULL THEN
      RETURN FALSE;
    END IF;
    IF resource_org_id = ANY(current_user_organizations()) THEN
      RETURN TRUE;
    END IF;
    IF resource_team_id IS NOT NULL AND resource_team_id = ANY(current_user_teams()) THEN
      RETURN TRUE;
    END IF;
    IF resource_created_by IS NOT NULL AND resource_created_by = current_user_id() THEN
      RETURN TRUE;
    END IF;
    RETURN FALSE;
  END;
  $$;
```

`can_modify_resource` rewritten with the same pattern: strip the NULL-org branches, keep the existing role-aware logic for org-admin / org-member / team-admin / creator paths. The capability semantics in `can_modify_resource` are intentionally **looser** than service-layer enforcement (any org-member can modify any same-org resource) — documented as a SQL comment so future maintainers don't try to "fix" the asymmetry. Service layer is the precise check; RLS is the coarse backstop.

The 2-arg variants from `1777400000000-RestoreRlsPoliciesPostTeamIdRemoval` delegate to the 3-arg helpers; they pick up the tightened semantics automatically.

### 4.5 `generated_reports` retightening

Migration `1778200000000-RetightenGeneratedReportsRls.ts` issues `DROP POLICY ... CREATE POLICY ...` to replace the temporary `USING (true)` policies with the standard `can_access_resource(organization_id, team_id, created_by)` shape (or 2-arg if `team_id` is permanently dropped — verified in plan).

`url_patterns` stays at the permissive shape: it's a deduplication cache without tenant-distinguishable data; the URL itself is the natural key. Documented as a SQL comment that this is intentional, not an oversight.

### 4.6 `test_runs.organization_id` tightening + audit_logs special case

Migration `1778300000000-TightenTestRunsOrganizationId.ts`:

```sql
UPDATE test_runs t
SET organization_id = sut.organization_id,
    team_id = COALESCE(t.team_id, sut.team_id)
FROM systems_under_test sut
WHERE t.system_under_test_id = sut.id
  AND t.organization_id IS NULL;

DO $$
DECLARE
  orphan_count int;
BEGIN
  SELECT count(*) INTO orphan_count FROM test_runs WHERE organization_id IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Cannot tighten test_runs.organization_id: % rows still NULL after backfill', orphan_count;
  END IF;
END $$;

ALTER TABLE test_runs ALTER COLUMN organization_id SET NOT NULL;
```

CLAUDE.md update lands in the same PR: remove the test_runs exception from "Ownership column nullability." `audit_logs` becomes the lone exception.

Migration `1778400000000-RewriteAuditLogsRls.ts`:

```sql
DROP POLICY IF EXISTS rls_audit_logs_select ON audit_logs;
CREATE POLICY rls_audit_logs_select ON audit_logs FOR SELECT
  USING (
    is_global_admin()
    OR (organization_id IS NOT NULL AND can_access_resource(organization_id, NULL, NULL))
  );

DROP POLICY IF EXISTS rls_audit_logs_insert ON audit_logs;
CREATE POLICY rls_audit_logs_insert ON audit_logs FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS rls_audit_logs_update ON audit_logs;
CREATE POLICY rls_audit_logs_update ON audit_logs FOR UPDATE
  USING (is_global_admin());

DROP POLICY IF EXISTS rls_audit_logs_delete ON audit_logs;
CREATE POLICY rls_audit_logs_delete ON audit_logs FOR DELETE
  USING (is_global_admin());
```

Read is org-scoped (org-admins see their org's events; super-admins see everything including system events with `organization_id IS NULL`). Write is permissive at the RLS layer because `AuditService` is the only writer. UPDATE/DELETE is super-admin only because audit logs are append-only — partition-manager `DROP TABLE` is DDL, which bypasses RLS.

### 4.7 Migration tooling (mirrors Phase 3 / 5a)

- **Custom ESLint rule `local/owned-resource-must-use-request-em`.** Errors when a service method calls `repo.{find, findOne, save, remove, update, delete, count}` on an `OwnedResource` repository unless the call is wrapped in `withRequestEm()`. Allowlist: `apps/api/.rls-em-migration-allowlist.json`.
- **Burndown table** appended to a new audit doc `docs/superpowers/audits/2026-05-04-rls-decisions.md`.
- **Drift-check `/schedule` agent** every 2 weeks (clone of Phase 3 / 5a agent at `docs/superpowers/scheduled-agents/`).
- File entries removed from the allowlist as each service is migrated; allowlist empty = phase complete.
- **Snapshot test** `apps/api/src/test/rls/rls-policy-coverage.snapshot.spec.ts` enumerates every `OwnedResource` entity, queries `pg_class.relforcerowsecurity` and `pg_policies`, captures `(table, force, policy_count, policy_cmds)`. Adding a new owned-resource entity without policies fails the snapshot in PR.

### 4.8 `/api/me/db-context` health endpoint

```ts
// apps/api/src/modules/me/me.controller.ts (new endpoint added to existing controller)
@Get('db-context')
async dbContext(@UserCtx() ctx: UserContext) {
  if (this.env.DB_ENABLE_RLS_ROLE !== 'true') {
    return { rls: 'disabled', role: 'perfana', gucs: null };
  }
  const em = getRequestEm();
  if (!em) return { rls: 'enabled', role: 'unknown', error: 'no request EntityManager' };
  const [{ current_user }] = await em.query(`SELECT current_user`);
  const gucs = await em.query(`
    SELECT
      current_setting('app.current_user_id', true) AS user_id,
      current_setting('app.current_user_organizations', true) AS organizations,
      current_setting('app.current_user_teams', true) AS teams,
      current_setting('app.current_user_roles', true) AS roles
  `);
  return { rls: 'enabled', role: current_user, gucs: gucs[0] };
}
```

Operators hit this to confirm "is RLS active for me right now and what does my session see." Authenticated only; any logged-in user can introspect their own session.

---

## 5. Data flow

### 5.1 Worked example: GET /api/api-keys (authenticated user)

```
1. KeycloakEnhancedAuthGuard
   → req.user = { sub: 'kc-user-123', email: 'daniel@perfana.io', roles: ['user'] }
   → req.authType = 'keycloak'

2. AuditContextInterceptor (5a)
   → cls.set(REQ_CTX, { userId: 'kc-user-123', userEmail, ipAddress, userAgent, requestId, authType })

3. RlsTransactionInterceptor (5b)
   reqCtx = cls.get(REQ_CTX) → { userId: 'kc-user-123', ... }
   roles  = req.user.roles                                                  // ['user'] (read directly from request)
   orgs   = await authzService.getAccessibleOrganizations('kc-user-123')    // ['org-A', 'org-B'] (Redis-cached)
   teams  = await authzService.getAccessibleTeams('kc-user-123')             // []

   dataSource.transaction(async em => {
     SET LOCAL ROLE perfana_app
     SET LOCAL app.current_user_id          = 'kc-user-123'
     SET LOCAL app.current_user_organizations = '["org-A","org-B"]'
     SET LOCAL app.current_user_teams       = '[]'
     SET LOCAL app.current_user_roles       = '["user"]'
     cls.set(REQ_EM, em)
     return await next.handle()  // ← controller runs inside this transaction
   })

4. ApiKeysController.findAll(ctx) → ApiKeysService.findAll(ctx.userId, ctx.roles)
   const orgIds = await authzService.getAccessibleOrganizations(userId)  // ['org-A', 'org-B']
   return withRequestEm(this.repo)
            .createQueryBuilder('k')
            .where(withOrgFilter(qb, 'k', orgIds))
            .getMany()

5. Postgres
   - Role: perfana_app (NOBYPASSRLS)
   - Sees policy: rls_api_keys_select USING (can_access_resource(organization_id, team_id, created_by::text))
   - For each row evaluated:
     - is_global_admin() → false (roles = '["user"]', no super-admin/system-admin)
     - resource_org_id ('org-X') = ANY(current_user_organizations()) → true if 'org-X' ∈ {'org-A', 'org-B'}
   - Plus the service-layer WHERE clause (withOrgFilter) restricts to 'org-A' or 'org-B' anyway.
   - Net: rows returned = api_keys where organization_id IN ('org-A', 'org-B'). Belt + suspenders agree.

6. Transaction commits; 200 response returned.
```

### 5.2 Worked example: worker-side test_run mutation

```
1. BullMQ job processor picks up job — no HTTP request, no CLS REQ_CTX.
2. Worker DB connection (pool checkout) ran preamble on connect:
     SET ROLE perfana_system
     set_config('app.current_user_id', 'system:worker', false)
     set_config('app.current_user_roles', '["super-admin"]', false)
     set_config('app.current_user_organizations', '[]', false)
     set_config('app.current_user_teams', '[]', false)
3. Pipeline runs `await this.testRunRepo.update(...)`. No transaction wrap.
4. Postgres:
   - Role: perfana_system
   - Policy: rls_test_runs_update USING (can_modify_resource(...))
   - is_global_admin() → true (roles array contains "super-admin")
   - Policy short-circuits to TRUE → row update succeeds.
5. AuditService (if called) logs with actorOverride: { userId: 'system:worker' }.
   Audit row's user_id matches DB-side identity.
```

### 5.3 Variations

- **Unauthenticated request (login, public endpoints).** RlsTransactionInterceptor sees `reqCtx?.userId` is missing, skips the transaction wrap entirely. Service queries (if any) run on the default connection (still as `perfana` if `DB_ENABLE_RLS_ROLE=false`, or as `perfana_app` with empty GUCs if true — in which case every policy denies, and the request can only succeed if it doesn't touch RLS-protected tables).
- **API key authentication.** `KeycloakEnhancedAuthGuard` resolves to `userId = 'api-key:<id>'`. The rest of the flow is identical. API keys are owned by an organization, so `getAccessibleOrganizations('api-key:<id>')` returns the API key's org.
- **Super-admin via web session.** `roles = ['super-admin']` → `is_global_admin()` returns true → all policies short-circuit. The service-layer filter still narrows by accessible orgs (which for super-admin is all orgs, per `AuthorizationService`).
- **Migrations.** Run via TypeORM at app startup as the `perfana` owner role. The owner role retains `BYPASSRLS` via the role hierarchy. The system-data-source from §4.3 is only for runtime queries.
- **Explicit transactions inside services** (e.g., `delete-test-run.handler.ts` calls `em.transaction(...)`). With Q2=A, the request handler is already inside a transaction. Postgres allows nested `BEGIN`s as savepoints; the inner transaction commits/rolls back to its savepoint, and the outer (interceptor-managed) transaction commits or rolls back at request end. The `SET LOCAL` GUCs from the outer transaction remain valid in the inner transaction (LOCAL is transaction-scoped, not statement-scoped). **Critical:** services must use `em.transaction(cb)` where `em` comes from `getRequestEm()` — NOT `dataSource.transaction(cb)` or `entityManagerInjectedAtConstructorTime.transaction(cb)`. The latter two check out a fresh connection from the pool, bypassing the request's GUCs entirely. The plan adds an ESLint rule sub-task to detect `dataSource.transaction(...)` calls in service code.
- **Bulk endpoints / streaming responses.** Holding a transaction for the duration of a streaming response holds a pool connection too. For the few streaming endpoints (e.g., metrics export), the implementation plan will identify them and either keep the transaction (acceptable if pool sized for it) or carve out an exception.

---

## 6. Failure modes

| Failure | What happens | Why it's safe |
|---|---|---|
| Service forgets `withRequestEm()` and uses raw `this.repo` | Query runs on a non-transactional connection without GUCs. With `DB_ENABLE_RLS_ROLE=true` and no GUCs set, `is_global_admin()` returns false and `current_user_organizations()` returns `[]`. Every policy denies. Query returns `[]` or 0-rows-affected. | **Failure mode is "user sees empty results," never "user sees other tenants' data."** Lint rule blocks the pattern at PR review; integration tests catch any allowlist regression. |
| Interceptor throws before `cls.set(REQ_EM)` | Transaction rolls back; request returns 500. RLS not active = no data leak. | Loud failure surfaces immediately. |
| `next.handle()` throws inside the transaction | Transaction rolls back; same as today. RLS GUCs vanish with the rollback. | No leak across requests. |
| `set_config` with malformed JSON (e.g., empty array literal) | Postgres raises; transaction rolls back; 500. | Test coverage asserts `JSON.stringify([])` round-trips; UUIDs round-trip; this is statically safe. |
| Connection pool exhausted (every request now holds a connection for the full handler) | Default pool = 10. Hot endpoints could starve under high concurrency. | Mitigation: bump pool size pre-rollout (already 20–50 in prod-like configs). Documented in CLAUDE.md "Environment Configuration." Soak in staging surfaces this before prod. |
| `perfana_system` role doesn't exist on a fresh DB | `SET ROLE` fails in `createSystemDataSource`; assertion check rejects connection; app exits at startup. | Loud, not silent. |
| Worker connects to a DB missing policies (e.g., a fresh test DB before migrations) | `is_global_admin()` short-circuits (super-admin role) — no rows hidden. Test setup proceeds. | Tests pass; production-DB has policies. |
| `getAccessibleOrganizations` cache stale after org-switch | Phase 3 already invalidates this cache on membership changes via `AuthorizationService`. | Existing primitive; no new code path. |
| RLS hides a row the user expected to see | Surfaces as "missing data" complaint. `/api/me/db-context` lets them confirm their session's GUCs match expectations. | Operator-debuggable in seconds. |
| Snapshot test for entity coverage drifts | New `OwnedResource` entity without `FORCE RLS + 4 policies` → snapshot diff in PR → reviewer signs off either "yes, add policies" or "no, exempt with reason." | Forces the conversation. |
| `can_modify_resource` capability semantics looser than service-layer expectation | E.g., org-member can update org-admin-only resource at the DB layer. Service-layer `@RequiresCapability` blocks it first. | Documented in SQL comment. RLS = coarse backstop; service layer = precise check. |
| Streaming response holds a transaction for minutes | Connection pool starvation under sustained concurrent streams. | Implementation-plan task: identify streaming endpoints, decide per-endpoint (keep transaction with sized pool, OR carve out a `@SkipRls` decorator). |
| Service uses `dataSource.transaction(cb)` (vs `em.transaction(cb)` from `getRequestEm()`) | Inner transaction checks out a separate connection from the pool. That connection has no GUCs set. With RLS on, every query in the inner transaction returns 0 rows or denies writes. | Failure mode is empty results, not data leak. Detected by lint rule (sub-task in plan); regression-tested in `rls-failure-modes.spec.ts`. |
| Long-running request (e.g., heavy aggregation) holds GUC stale across an org-switch mid-request | The user's accessible orgs read at request start are baked into GUCs; an org-switch mid-request doesn't update them. | Acceptable: org-switch is a UI navigation, the next request picks up the new orgs. The stale GUC narrows access (user can still see their old org), it doesn't broaden. |

### 6.1 Out of scope for 5b

- **Tamper-evident audit log.** Cryptographic chaining; separate concern from RLS.
- **`ACCESS_DENIED` instrumentation.** RLS silently filters; logging denied attempts is a Phase 5c security-monitoring concern.
- **Per-row capability (resource-level read-only flags).** Service-layer concern; RLS handles tenant boundary only.
- **Helper redesign** (Q1=B excludes C). `can_modify_resource`'s plpgsql is fine for now; rewrite if security review later flags the looseness as a real concern.

---

## 7. Testing

### 7.1 Test layout

```
apps/api/src/test/rls/
  rls-test-harness.ts                  ← real Postgres, two orgs, six users + system context
  rls-policy-matrix.spec.ts            ← parameterized matrix (26 entities × 4 ops × 7 user contexts)
  rls-policy-coverage.snapshot.spec.ts ← from §4.7
  rls-helper-functions.spec.ts         ← unit tests of can_access_resource / can_modify_resource / is_global_admin
  rls-system-context.spec.ts           ← worker / grafana-sync / report bypass behavior
  rls-interceptor.spec.ts              ← RlsTransactionInterceptor unit tests (mocked DataSource + Cls)
  rls-failure-modes.spec.ts            ← missing GUC, unset role, transaction rollback, pool starvation
```

### 7.2 The harness

Boots a fresh Postgres schema via the existing test-DB pattern (Phase 3 set the precedent), seeds two organizations and six users plus a system context. Membership matrix:

| User | super-admin | org-admin in O₁ | org-admin in O₂ | org-member in O₁ | org-viewer in O₁ | unaffiliated |
|---|---|---|---|---|---|---|
| `super` | ✓ | | | | | |
| `o1Admin` | | ✓ | | | | |
| `o2Admin` | | | ✓ | | | |
| `o1Member` | | | | ✓ | | |
| `o1Viewer` | | | | | ✓ | |
| `nobody` | | | | | | ✓ |

Helpers:
- `asUser(user, fn)` — opens a transaction, runs the four GUCs + `SET LOCAL ROLE perfana_app`, runs `fn(em)`, rolls back. Mirrors the production interceptor exactly.
- `asSystem(actor, fn)` — runs the system preamble at session level, runs `fn(em)`, no rollback.
- `seedOwnedRow(entityClass, org, overrides?)` — inserts a fixture row owned by the given org; returns `{ id }`.

### 7.3 Per-entity matrix

```ts
const OWNED_ENTITIES = listOwnedResourceEntities(); // 26 classes from packages/shared/src/entities

describe.each(OWNED_ENTITIES)('RLS policy matrix: %s', entityClass => {
  let o1Row: { id: string };
  let o2Row: { id: string };
  beforeAll(async () => {
    o1Row = await seedOwnedRow(entityClass, O1);
    o2Row = await seedOwnedRow(entityClass, O2);
  });

  describe('SELECT', () => {
    it('super-admin sees all rows');
    it('o1Admin sees only O1 rows');
    it('o2Admin sees only O2 rows');
    it('o1Member sees only O1 rows');
    it('o1Viewer sees only O1 rows');
    it('nobody sees zero rows');
    it('system context sees all rows');
  });

  describe('INSERT', () => {
    it('o1Admin can insert into O1');
    it('o1Admin cannot insert into O2');
    it('nobody cannot insert anywhere');
    it('o1Viewer cannot insert (entity-fixture-dependent)');
  });

  describe('UPDATE', () => {
    it('o1Admin can update O1 rows');
    it('o1Admin cannot update O2 rows');
    it('o1Viewer cannot update O1 rows (entity-fixture-dependent)');
  });

  describe('DELETE', () => { /* mirrors UPDATE */ });
});
```

26 × 4 × 5–7 ≈ 600–700 assertions. Per-entity fixture declares policy nuance (e.g., "this entity allows org-viewers to INSERT" — minority case). `test_runs` and `audit_logs` get custom expectations matching their special policies.

### 7.4 Helper unit tests

```ts
describe('can_access_resource', () => {
  it('returns true for global admin regardless of org');
  it('returns false for null org_id (post-Phase-4 fail-closed)');
  it('returns true when org_id ∈ user orgs');
  it('returns true when team_id ∈ user teams');
  it('returns true when created_by = current_user_id');
  it('returns false when none match');
});

describe('can_modify_resource', () => {
  it('returns true for global admin');
  it('returns false for null org_id (post-Phase-4 fail-closed)');
  it('returns true for creator');
  it('returns true for org-admin in org');
  it('returns true for org-member in org');
  it('returns true for team-admin / team-member where team matches');
  it('returns false for foreign-org user');
});

describe('is_global_admin', () => {
  it('returns true for super-admin');
  it('returns true for system-admin');
  it('returns false for org-admin (NOT a global admin)');
  it('returns false for unset role GUC');
});
```

### 7.5 Interceptor unit test

Mocked `DataSource` and `ClsService`:
- Asserts the SQL preamble runs in the documented order.
- Asserts `cls.set(REQ_EM, em)` happens.
- Asserts the transaction commits on success.
- Asserts the transaction rolls back on `next.handle()` throwing.
- Asserts the env-flag-off path skips wrapping entirely.
- Asserts unauthenticated requests skip wrapping.

### 7.6 Failure-mode tests

- Service forgets `withRequestEm()` and calls raw `this.repo` → real `repo.find()` outside the request EM → returns `[]` (not the cross-tenant data). Asserts the failure shape.
- Connection pool saturation: spawn 50 concurrent requests against a pool of 5; assert no GUC bleed (every request sees only its own GUCs even under contention).
- Mid-transaction `next.handle()` throws after `set_config` runs → rollback → next request sees fresh GUCs.
- Lint-rule allowlist drift: a fixture file with a missing `withRequestEm()` call triggers the rule.

### 7.7 CI gate (Q4)

A required check on every PR: `npm run test:rls` boots Postgres, runs migrations, sets `DB_ENABLE_RLS_ROLE=true`, runs the entire `apps/api/src/test/rls/` suite. Failure blocks merge. Runtime budget: ≤2 min — fixture setup amortized across the parameterized matrix.

### 7.8 Not tested in 5b

- Long-running query performance under RLS. Per-row policy evaluation has measurable cost on hot tables; if production tells us so, address with `BYPASSRLS` carve-outs for specific high-throughput read paths or denormalize the join. Documented as a follow-up, not a 5b deliverable.
- Cross-process audit (worker → API consistency under RLS). The system role + identity GUC make this internally consistent; no specific test.
- Recovery from a multi-day pool starvation incident. Documented as ops-debuggable via `/api/me/db-context` + standard pool metrics.

---

## 8. Done criteria

A reviewer should be able to verify Phase 5b is complete by:

1. `RlsTransactionInterceptor` is registered globally and runs after `AuditContextInterceptor`.
2. Every owned-resource service uses `withRequestEm()` for repo calls; lint rule + drift agent enforce it (allowlist empty or shrinking weekly).
3. `apps/worker`, `apps/grafana-sync`, `apps/perfana-report` use `createSystemDataSource(<actor>)`.
4. Migrations 1778000000000 through 1778400000000 applied:
   - `perfana_system` role exists with NOBYPASSRLS + correct grants.
   - `can_access_resource` and `can_modify_resource` no longer have NULL-org permissive branches.
   - `generated_reports` has standard policies (no `USING (true)`).
   - `test_runs.organization_id` is NOT NULL with full backfill.
   - `audit_logs` policies match §4.6.
5. The per-entity test matrix (`apps/api/src/test/rls/rls-policy-matrix.spec.ts`) passes with `DB_ENABLE_RLS_ROLE=true` in CI.
6. The `rls-policy-coverage.snapshot.spec.ts` snapshot is committed and stable.
7. `/api/me/db-context` returns `{ rls: 'enabled', role: 'perfana_app', gucs: {...} }` for any authenticated request in production.
8. `DB_ENABLE_RLS_ROLE=true` is set in production env config; staging soak ≥1 week prior; ops alerting baseline established.
9. CLAUDE.md "RBAC Implementation Status" table updated: Phase 5b row marked ✅ with reference to this spec and the activation date.
10. `audit_logs` is the lone owned-resource entity with nullable `organization_id`; all others (including `test_runs`) are NOT NULL.

---

## 9. Sequencing & PR shape (sketch — refined in plan)

1. **PR1 — Migrations: tighten the schema.** Lands the five migrations (`1778000000000` through `1778400000000`) plus the snapshot test. Zero runtime behavior change because `DB_ENABLE_RLS_ROLE` stays `false`.
2. **PR2 — Foundation: interceptor + system-context wiring.** Lands `RlsTransactionInterceptor`, `withRequestEm`, system-data-source wiring across the three apps, `/api/me/db-context`, and all unit/system-context tests. Still gated by env flag.
3. **PR3 — Lint rule + allowlist + drift agent.** Mirrors Phase 3 / 5a. Initial allowlist contains every owned-resource service file.
4. **PR4..N — Service migrations.** One per service group (test-runs, api-keys, dynatrace, grafana-dashboards, profiles, etc.). Each: update repo call-sites to `withRequestEm()`, remove from allowlist, lint passes. Drips in via adjacent feature work too.
5. **PR(N+1) — Per-entity test matrix.** Lands the heavy parameterized matrix once policies are stable.
6. **PR(N+2) — Activation.** CI gets `DB_ENABLE_RLS_ROLE=true` in the test job (now a required check). Staging env flips on; soak ≥1 week. Prod env flips on. CLAUDE.md updated.
7. **PR(N+3) — Cleanup.** Empty allowlist removed, audit doc burndown closed, drift agent retired.

Total: ~5 + N PRs, where N ≈ 10 service groups. Cadence matches Phase 5a (21 PRs).

Each PR follows the existing Perfana ship workflow (`/ship` skill).

---

## 10. References

- Master RBAC plan: `docs/superpowers/plans/2026-04-27-rbac-completion.md` — Phase 5 deferred at line 2212.
- Phase 5a spec: `docs/superpowers/specs/2026-05-02-rbac-phase5a-audit-completion-design.md` — CLS infrastructure that 5b builds on.
- Phase 5a audit decisions: `docs/superpowers/audits/2026-05-02-audit-phase5a-decisions.md`.
- Phase 3 lint+allowlist+drift pattern: `apps/api/.rbac-migration-allowlist.json` + `local/no-direct-is-global-admin` rule.
- Phase 4 closure: PR #228 (commit `c7d94ee`), 2026-05-02 — established the NOT NULL invariant 5b's helper changes depend on.
- Existing RLS scaffolding:
  - `packages/shared/src/database/migrations/1700000000000-ConsolidatedSchema.ts` — `perfana_app` role, helpers, FORCE RLS on 25 tables.
  - `packages/shared/src/database/migrations/schema-sql.ts` — helper definitions and the 100 `CREATE POLICY` statements.
  - `packages/shared/src/database/migrations/1777400000000-RestoreRlsPoliciesPostTeamIdRemoval.ts` — 2-arg helper variants and the team_id-drop fixup that left `url_patterns` and `generated_reports` permissive.
- `DB_ENABLE_RLS_ROLE` env var: `apps/api/src/config/env.validation.ts:40-43`.
- CLS infrastructure (Phase 5a PR1): `apps/api/src/common/context/request-context.module.ts`, `apps/api/src/common/interceptors/audit-context.interceptor.ts`.
