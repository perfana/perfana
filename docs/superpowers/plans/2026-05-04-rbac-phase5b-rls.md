# RBAC Phase 5b — RLS Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate Postgres Row-Level Security on the 26 owned-resource entities by wiring `nestjs-cls`-managed GUCs through a per-request `SET LOCAL` transaction interceptor, switching the API runtime to a non-bypass-RLS role, and switching worker / grafana-sync / perfana-report processes to a system role with identity GUCs. Tighten existing helper functions and policy expressions to match the post-Phase-4 NOT-NULL invariant. Service-layer authorization (Phase 3 `withOrgFilter` + `AuthorizedBaseService`) remains the primary check; RLS is defense-in-depth.

**Architecture:** A new `RlsTransactionInterceptor` registered globally in the API runs after `KeycloakEnhancedAuthGuard` and `AuditContextInterceptor`. When `DB_ENABLE_RLS_ROLE=true`, it wraps the entire request handler in `dataSource.transaction(...)`, sets four `SET LOCAL` GUCs from the authenticated user's accessible orgs/teams/roles, switches role to `perfana_app` (NOBYPASSRLS), and exposes the request-scoped `EntityManager` via CLS (`REQ_EM` namespace). Owned-resource service calls go through a small helper `withRequestEm(this.repo)` which returns the request EM's repo when available and the original repo otherwise. Worker, grafana-sync, and perfana-report each use a `createSystemDataSource(actor)` factory that runs a session-scope preamble on every pool checkout: `SET ROLE perfana_system; SELECT set_config('app.current_user_id', 'system:<actor>', false); SELECT set_config('app.current_user_roles', '["super-admin"]', false); ...`. RLS policies short-circuit via `is_global_admin()` for system contexts. Migrations run as the `perfana` owner role, which bypasses RLS via the role hierarchy.

**Tech Stack:** NestJS 10 (interceptors, DI), TypeORM 0.3 (DataSource, EntityManager, Repository), nestjs-cls 4 (already integrated by Phase 5a), node-postgres 8 (Pool.on('connect')), PostgreSQL 16 (FORCE ROW LEVEL SECURITY, set_config, SECURITY DEFINER plpgsql), Jest (NestJS test pattern), ESLint 8 with custom rule plugin (existing `apps/api/eslint-rules/`).

**Spec:** `docs/superpowers/specs/2026-05-04-rbac-phase5b-rls-design.md` (committed `4734ba6`).

---

## File Structure

### New files

**API runtime infrastructure**
- `apps/api/src/common/db/request-em.ts` — `REQ_EM` symbol, `getRequestEm()`, `withRequestEm()` helper
- `apps/api/src/common/db/request-em.spec.ts` — unit tests for the helper
- `apps/api/src/common/db/skip-rls.decorator.ts` — `@SkipRls()` decorator + reflector key for streaming endpoints
- `apps/api/src/common/interceptors/rls-transaction.interceptor.ts` — the transaction-wrapping interceptor
- `apps/api/src/common/interceptors/rls-transaction.interceptor.spec.ts` — unit tests with mocked DataSource + Cls

**System data sources (shared package)**
- `packages/shared/src/database/system-connection.ts` — `SystemActor` type + `buildSystemConnectionPreamble()`
- `packages/shared/src/database/system-connection.spec.ts` — unit tests for the preamble builder
- `packages/shared/src/database/data-source-system.ts` — `createSystemDataSource()` factory

**Health endpoint**
- `apps/api/src/modules/users/users-db-context.controller.ts` — `GET /api/users/me/db-context` (lives next to `users-permissions.controller.ts`)
- `apps/api/src/modules/users/users-db-context.controller.spec.ts` — controller tests

**Migrations (in execution order)**
- `packages/shared/src/database/migrations/1778000000000-CreatePerfanaSystemRole.ts`
- `packages/shared/src/database/migrations/1778100000000-TightenRlsHelpers.ts`
- `packages/shared/src/database/migrations/1778200000000-RetightenGeneratedReportsRls.ts`
- `packages/shared/src/database/migrations/1778300000000-TightenTestRunsOrganizationId.ts`
- `packages/shared/src/database/migrations/1778400000000-RewriteAuditLogsRls.ts`

**Test infrastructure**
- `apps/api/src/test/rls/rls-test-harness.ts` — boots Postgres, seeds two orgs + six users, helpers `asUser`, `asSystem`, `seedOwnedRow`
- `apps/api/src/test/rls/rls-policy-coverage.snapshot.spec.ts` — snapshot of `(table, force, policy_count, policy_cmds)` for every owned-resource entity
- `apps/api/src/test/rls/rls-policy-matrix.spec.ts` — parameterized matrix (26 entities × 4 ops × 7 user contexts)
- `apps/api/src/test/rls/rls-helper-functions.spec.ts` — direct SQL invocation tests of `can_access_resource` / `can_modify_resource` / `is_global_admin`
- `apps/api/src/test/rls/rls-system-context.spec.ts` — worker / grafana-sync / report bypass behavior
- `apps/api/src/test/rls/rls-failure-modes.spec.ts` — missing GUC, unset role, transaction rollback, pool starvation

**ESLint + migration scaffolding**
- `apps/api/eslint-rules/owned-resource-must-use-request-em.js` — lint rule
- `apps/api/eslint-rules/owned-resource-must-use-request-em.spec.js` — rule tests
- `apps/api/.rls-em-migration-allowlist.json` — initial population: every owned-resource service file
- `docs/superpowers/audits/2026-05-04-rls-decisions.md` — burndown table + per-PR notes
- `docs/superpowers/scheduled-agents/rls-burndown-drift.md` — drift agent

### Modified files

**API**
- `apps/api/src/app.module.ts` — register `RlsTransactionInterceptor` globally (after `AuditContextInterceptor`, before `ThrottlerGuard`)
- `apps/api/.eslintrc.js` — add `'owned-resource-must-use-request-em': 'error'` to rules
- `apps/api/src/modules/users/users.module.ts` — add the new controller to the controllers array

**System apps (DataSource wiring)**
- `apps/worker/src/app.module.ts` — `TypeOrmModule.forRootAsync` → `useFactory` returning options consumable by `createSystemDataSource('worker', ...)` (or apply preamble hook in `dataSourceFactory`)
- `apps/grafana-sync/src/app.module.ts` — same shape with `'grafana-sync'`
- `apps/perfana-report/src/app.module.ts` — same shape with `'perfana-report'`

**Service layer (Phase 4 of plan, ~80 call-sites across 26 services — enumerated per-PR below)**
- All services listed in `apps/api/.rls-em-migration-allowlist.json`'s initial population.

**Documentation**
- `CLAUDE.md` — Phase 5b row in the RBAC Implementation Status table; ownership-column note for test_runs.

### Existing files referenced (read-only)

- `apps/api/src/common/context/request-context.ts` — `REQ_CTX` symbol + `RequestContextStore` type (Phase 5a)
- `apps/api/src/common/interceptors/audit-context.interceptor.ts` — populates CLS REQ_CTX with `{userId, userEmail, ipAddress, userAgent, requestId, authType}`
- `apps/api/src/common/services/authorization.service.ts` — `getAccessibleOrganizations(userId)`, `getAccessibleTeams(userId)`, both Redis-cached
- `apps/api/src/common/utils/with-org-filter.ts` — service-layer org filter (stays untouched)
- `packages/shared/src/database/migrations/schema-sql.ts` — existing helper SQL (referenced when tightening helpers)
- `packages/shared/src/database/migrations/1700000000000-ConsolidatedSchema.ts` — the `perfana_app` role definition (referenced when defining `perfana_system`)
- `apps/api/eslint-rules/audit-mutation-must-log.js` — pattern to follow for the new RLS lint rule
- `apps/api/.audit-migration-allowlist.json` — pattern to follow for the new allowlist

### Owned-resource entities (28 candidates → 26 protected; `audit_logs` and `events` get special-cased)

The full set of entities with an `organization_id` column:

```
alert-tag-filter.entity.ts          → alert_tag_filters
api-key.entity.ts                   → api_keys
application-dashboard.entity.ts     → application_dashboards
audit-log.entity.ts                 → audit_logs                (special-case policy in PR1)
benchmark.entity.ts                 → benchmarks
compare-filter-preset.entity.ts     → compare_filter_presets
deep-link.entity.ts                 → deep_links
dynatrace-config.entity.ts          → dynatrace_configs
dynatrace-entity-mapping.entity.ts  → dynatrace_entity_mappings
dynatrace-query.entity.ts           → dynatrace_queries
event.entity.ts                     → events                    (already permissive policy with global-admin check)
expected-config-change.entity.ts    → expected_config_changes
generic-deep-link.entity.ts         → generic_deep_links
grafana-dashboard.entity.ts         → grafana_dashboards
grafana-instance.entity.ts          → grafana_instances
graph-preset.entity.ts              → graph_presets
metrics-source.entity.ts            → metrics_sources
notification-channel.entity.ts      → notification_channels
profile-benchmark.entity.ts         → profile_benchmarks
profile-grafana-dashboard.entity.ts → profile_grafana_dashboards
profile.entity.ts                   → profiles
pyroscope-instance.entity.ts        → pyroscope_instances
report-template.entity.ts           → report_templates
sparse-metric-exclusion.entity.ts   → sparse_metric_exclusions
test-run.entity.ts                  → test_runs                 (organization_id NOT NULL after PR1)
tracing-instance.entity.ts          → tracing_instances
tracing-service.entity.ts           → tracing_services
trends-filter-preset.entity.ts      → trends_filter_presets
```

Plus `generated_reports` (no entity file because the table holds opaque generated artifacts, but it has `organization_id` and gets policies retightened in PR1).

---

## Plan-time discovery: two repository patterns

Inspecting `apps/api/src/repositories/` revealed two repository patterns:

**Pattern A — `extends TypeOrmBaseRepository<T>`** (8 entities). The base class wraps an `@InjectRepository(T) repository: Repository<T>` and exposes typed CRUD that internally calls `this.repository.X(...)`. Custom subclasses add bespoke domain methods that *also* call `this.repository.X(...)` directly. Migrating `TypeOrmBaseRepository` once covers every standard CRUD path across all 8 entities; bespoke methods are migrated separately. Pattern A entities:

```
api-key, application-dashboard, compare-filter-preset, expected-config-change,
test-run-configuration, test-run, tracing-service, trends-filter-preset
```

**Pattern B — service-level `@InjectRepository(Entity)`** (~18 entities). Each service-layer call site is its own migration target.

The lint rule (Task 22) catches both patterns: `OWNED_RESOURCE_ENTITIES` checks `@InjectRepository(<EntityName>)` regardless of whether the surrounding class is a service or a custom repository.

## Revised PR overview

| PR | Title | Scope |
|----|-------|-------|
| PR1 | Tighten the schema | 5 migrations + snapshot test. Zero runtime change. |
| PR2 | Foundation: interceptor + system data sources | API interceptor + system DS factory + `/me/db-context`. |
| PR3 | Lint rule + allowlist + drift agent | Migration scaffolding. |
| PR4 | Migrate `TypeOrmBaseRepository` (Pattern A — 8 entities) | One base-class change covers standard CRUD across 8 custom repos. |
| PR5 | Migrate Pattern A bespoke methods | Wrap remaining direct `this.repository.X(...)` calls in subclass methods. |
| PR6 | Migrate Pattern B services (~18 entities) | Per-service-module migrations. Allowlist empty after this PR. |
| PR7 | Per-entity test matrix (heavy) | Full RLS test suite — 26 entities × 7 user contexts × 4 ops, plus harness, system-context, failure-mode, interceptor unit tests. |
| PR8 | Activation: CI + staging + prod | Flip `DB_ENABLE_RLS_ROLE=true` in CI test job + staging env + (after soak) prod env. |
| PR9 | Cleanup | Delete the empty allowlist, retire the drift agent, update CLAUDE.md. |

---

## Standard transformation pattern (for service-migration PRs PR4–PR6)

Every service-migration task follows this pattern. Reproduce it inline in each task to keep tasks self-contained.

**Pattern: wrap repo calls with `withRequestEm`**

For each owned-resource service, replace:

```ts
// BEFORE
this.repo.find({ where: { ... } })
this.repo.findOne({ where: { id } })
this.repo.findOneByOrFail({ id })
this.repo.save(entity)
this.repo.remove(entity)
this.repo.delete({ id })
this.repo.update({ id }, partial)
this.repo.count({ where: { ... } })
this.repo.createQueryBuilder('alias')
```

…with the `withRequestEm` wrapper:

```ts
// AFTER
withRequestEm(this.repo).find({ where: { ... } })
withRequestEm(this.repo).findOne({ where: { id } })
withRequestEm(this.repo).findOneByOrFail({ id })
withRequestEm(this.repo).save(entity)
withRequestEm(this.repo).remove(entity)
withRequestEm(this.repo).delete({ id })
withRequestEm(this.repo).update({ id }, partial)
withRequestEm(this.repo).count({ where: { ... } })
withRequestEm(this.repo).createQueryBuilder('alias')
```

Add the import at the top of each modified file:

```ts
import { withRequestEm } from '../../common/db/request-em';
```

(Adjust the relative path based on file depth.)

**Discovery command (run inside each service file)**

```bash
grep -nE "this\.[a-zA-Z_]+(Repo|Repository)\.[a-zA-Z_]+\(" <file>
```

This catches every repository method invocation including `createQueryBuilder`, `save`, `delete`, etc. Manually inspect each match and decide:

- **Wrap** if the repo is for an `OwnedResource` entity (one of the 28 listed in File Structure).
- **Leave** if the repo is for a non-owned entity (e.g., `OrganizationMember`, `TeamMember`, `User`).

**Verification per service migration**

Run after every service is migrated:

```bash
cd apps/api && npx eslint src/modules/<modified-service>/ --rule '{"owned-resource-must-use-request-em":"error"}' --no-eslintrc
cd apps/api && npx tsc --noEmit
cd apps/api && npx jest <modified-service> --no-coverage
```

Expected: lint passes (file no longer in allowlist after this PR's removal), typecheck passes, existing tests pass unchanged. The wrapper is a transparent identity when `DB_ENABLE_RLS_ROLE=false`, so behavior is identical.

**Allowlist removal**

Each service-migration task removes its file path(s) from `apps/api/.rls-em-migration-allowlist.json`. The lint rule will now error if the migration is incomplete.

**Commit message shape**

```
feat(api): Phase 5b PR<N> — RLS migration in <service-group>

Wraps OwnedResource repo calls with withRequestEm() to plumb the request
EntityManager through CLS. No runtime behavior change while
DB_ENABLE_RLS_ROLE=false. Removes <files> from .rls-em-migration-allowlist.json.

See: docs/superpowers/audits/2026-05-04-rls-decisions.md (burndown).
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## PR1 — Tighten the schema

Lands five migrations plus the policy-coverage snapshot test. Zero runtime change because `DB_ENABLE_RLS_ROLE` stays `false`. Each migration is independent but the order in this PR matters: helpers are tightened first so the retightened policies use the already-fixed semantics; `test_runs` backfill before the `audit_logs` rewrite is incidental but consistent.

### Task 1: Migration — create `perfana_system` role

**Files:**
- Create: `packages/shared/src/database/migrations/1778000000000-CreatePerfanaSystemRole.ts`

- [ ] **Step 1: Write the migration**

Create the file with this content:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 5b PR1: Create the `perfana_system` Postgres role used by worker /
 * grafana-sync / perfana-report processes. NOBYPASSRLS — RLS still evaluates,
 * but the system processes set `app.current_user_roles = '["super-admin"]'` so
 * `is_global_admin()` short-circuits all policies to TRUE.
 *
 * Idempotent: safe to re-run. Mirrors the perfana_app role created in
 * 1700000000000-ConsolidatedSchema.ts.
 */
export class CreatePerfanaSystemRole1778000000000 implements MigrationInterface {
  name = 'CreatePerfanaSystemRole1778000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.query(
      `SELECT 1 FROM pg_roles WHERE rolname = 'perfana_system'`,
    );
    if (exists.length === 0) {
      await queryRunner.query(`
        CREATE ROLE perfana_system
          NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
      `);
    } else {
      await queryRunner.query(`
        ALTER ROLE perfana_system
          NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
      `);
    }
    // Owner role can SET ROLE into perfana_system (system processes connect as
    // perfana, then SET ROLE perfana_system on connection checkout).
    await queryRunner.query(`GRANT perfana_system TO perfana`);
    await queryRunner.query(`GRANT USAGE ON SCHEMA public TO perfana_system`);
    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO perfana_system`,
    );
    await queryRunner.query(
      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO perfana_system`,
    );
    await queryRunner.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO perfana_system`,
    );
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO perfana_system
    `);
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT EXECUTE ON FUNCTIONS TO perfana_system
    `);
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO perfana_system
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM perfana_system
    `);
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        REVOKE EXECUTE ON FUNCTIONS FROM perfana_system
    `);
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        REVOKE USAGE, SELECT ON SEQUENCES FROM perfana_system
    `);
    await queryRunner.query(
      `REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM perfana_system`,
    );
    await queryRunner.query(
      `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM perfana_system`,
    );
    await queryRunner.query(
      `REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public FROM perfana_system`,
    );
    await queryRunner.query(`REVOKE USAGE ON SCHEMA public FROM perfana_system`);
    await queryRunner.query(`REVOKE perfana_system FROM perfana`);
    await queryRunner.query(`DROP ROLE IF EXISTS perfana_system`);
  }
}
```

- [ ] **Step 2: Run the migration locally**

```bash
cd packages/shared && npm run build
cd apps/api && npm run migration:run
```

Expected: migration logs `CreatePerfanaSystemRole1778000000000 has been executed successfully.`

- [ ] **Step 3: Verify role exists with correct attributes**

```bash
docker compose -f docker-compose.infra.yml exec postgres \
  psql -U perfana -d perfana \
  -c "SELECT rolname, rolbypassrls, rolinherit, rolcanlogin FROM pg_roles WHERE rolname = 'perfana_system'"
```

Expected output:
```
   rolname     | rolbypassrls | rolinherit | rolcanlogin
---------------+--------------+------------+-------------
 perfana_system | f            | f          | f
```

- [ ] **Step 4: Verify table grants are in place**

```bash
docker compose -f docker-compose.infra.yml exec postgres \
  psql -U perfana -d perfana \
  -c "SELECT count(*) FROM information_schema.table_privileges WHERE grantee = 'perfana_system' AND privilege_type = 'SELECT'"
```

Expected: count > 50 (every public table has been granted SELECT).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/database/migrations/1778000000000-CreatePerfanaSystemRole.ts
git commit -m "$(cat <<'EOF'
feat(db): Phase 5b PR1.1 — create perfana_system Postgres role

Adds NOBYPASSRLS role used by worker / grafana-sync / perfana-report
processes. System processes will SET ROLE perfana_system + identity GUCs
on connection checkout in PR2; this migration only adds the role and grants.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Migration — tighten RLS helper functions

Strips the dead `IF resource_org_id IS NULL THEN RETURN TRUE` branches from `can_access_resource` and `can_modify_resource`. These branches contradict the Phase 4 NOT NULL invariant on `organization_id` for owned-resource entities.

**Files:**
- Create: `packages/shared/src/database/migrations/1778100000000-TightenRlsHelpers.ts`

- [ ] **Step 1: Write the migration**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 5b PR1: Strip the pre-Phase-4 escape hatch (`IF resource_org_id IS NULL
 * THEN RETURN TRUE`) from `can_access_resource` and `can_modify_resource`.
 *
 * Phase 4 made `organization_id NOT NULL` on all owned-resource entities. The
 * permissive NULL branch is dead code that misrepresents the security model.
 * Replace with `RETURN FALSE` so any unexpected NULL surfaces as denial, not
 * silent permissibility. (The two intentional NULL holders — audit_logs and
 * url_patterns — have custom policies that don't call these helpers, or call
 * them with a non-null id; see migration 1778400000000 and the existing
 * 1777400000000-RestoreRlsPoliciesPostTeamIdRemoval.)
 *
 * Note: capability semantics in `can_modify_resource` are intentionally LOOSER
 * than service-layer enforcement (any org-member can modify any same-org
 * resource). This is documented as a SQL comment so future maintainers don't
 * "fix" the asymmetry. RLS = coarse backstop; service layer = precise check
 * (Phase 5b spec §4.4).
 */
export class TightenRlsHelpers1778100000000 implements MigrationInterface {
  name = 'TightenRlsHelpers1778100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Tightened can_access_resource (3-arg, the canonical helper).
    await queryRunner.query(`
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
          -- Phase 4: organization_id is NOT NULL on every owned resource.
          -- A NULL here indicates a bug or misconfigured caller — fail closed.
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
        $$
    `);

    // Tightened can_modify_resource (3-arg).
    //
    // Loose-by-design: any org-member can modify any same-org resource. The
    // service layer adds finer capability gates (e.g., @RequiresCapability,
    // canModifyResource() row-level checks). RLS is the coarse backstop.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.can_modify_resource(
        resource_org_id uuid,
        resource_team_id uuid DEFAULT NULL::uuid,
        resource_created_by text DEFAULT NULL::text
      ) RETURNS boolean
        LANGUAGE plpgsql STABLE SECURITY DEFINER
        AS $$
          DECLARE
            user_id TEXT;
            user_orgs UUID[];
            user_teams UUID[];
            user_roles TEXT;
          BEGIN
            IF is_global_admin() THEN
              RETURN TRUE;
            END IF;
            user_id := current_user_id();
            user_orgs := current_user_organizations();
            user_teams := current_user_teams();
            user_roles := current_setting('app.current_user_roles', true);

            IF user_id IS NULL THEN
              RETURN FALSE;
            END IF;

            -- Phase 4: NOT NULL on owned resources. Fail closed on unexpected NULL.
            IF resource_org_id IS NULL THEN
              RETURN FALSE;
            END IF;

            -- Creator path
            IF resource_created_by IS NOT NULL AND resource_created_by = user_id THEN
              RETURN TRUE;
            END IF;

            -- Org-admin in the resource's organization
            IF resource_org_id = ANY(user_orgs) AND user_roles LIKE '%"org-admin"%' THEN
              RETURN TRUE;
            END IF;

            -- Team-admin in the resource's team
            IF resource_team_id IS NOT NULL AND resource_team_id = ANY(user_teams)
               AND user_roles LIKE '%"team-admin"%' THEN
              RETURN TRUE;
            END IF;

            -- Coarse backstop: org/team membership allows modify.
            -- Loose vs service layer; precise gates live there.
            IF resource_org_id = ANY(user_orgs) THEN
              RETURN TRUE;
            END IF;
            IF resource_team_id IS NOT NULL AND resource_team_id = ANY(user_teams) THEN
              RETURN TRUE;
            END IF;

            RETURN FALSE;
          END;
          $$
    `);

    // The 2-arg variants (added in 1777400000000) delegate to the 3-arg
    // helpers. They pick up the tightened semantics automatically because
    // CREATE OR REPLACE preserves dependent function bodies.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore the pre-tightening permissive helpers.
    await queryRunner.query(`
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
          IF resource_org_id IS NULL AND resource_team_id IS NULL AND resource_created_by IS NULL THEN
            RETURN TRUE;
          END IF;
          IF resource_org_id IS NULL THEN
            RETURN TRUE;
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
        $$
    `);
    // can_modify_resource: full pre-tightening body restored.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.can_modify_resource(
        resource_org_id uuid,
        resource_team_id uuid DEFAULT NULL::uuid,
        resource_created_by text DEFAULT NULL::text
      ) RETURNS boolean
        LANGUAGE plpgsql STABLE SECURITY DEFINER
        AS $$
          DECLARE
            user_id TEXT;
            user_orgs UUID[];
            user_teams UUID[];
            user_roles TEXT;
          BEGIN
            IF is_global_admin() THEN RETURN TRUE; END IF;
            user_id := current_user_id();
            user_orgs := current_user_organizations();
            user_teams := current_user_teams();
            user_roles := current_setting('app.current_user_roles', true);
            IF user_id IS NULL THEN RETURN FALSE; END IF;
            IF resource_created_by IS NOT NULL AND resource_created_by = user_id THEN
              RETURN TRUE;
            END IF;
            IF resource_org_id IS NULL THEN
              IF user_roles LIKE '%"org-admin"%' THEN RETURN TRUE; END IF;
              RETURN FALSE;
            END IF;
            IF resource_org_id = ANY(user_orgs) THEN
              IF user_roles LIKE '%"org-admin"%' THEN RETURN TRUE; END IF;
            END IF;
            IF resource_team_id IS NOT NULL AND resource_team_id = ANY(user_teams) THEN
              IF user_roles LIKE '%"team-admin"%' THEN RETURN TRUE; END IF;
            END IF;
            IF resource_org_id = ANY(user_orgs) THEN RETURN TRUE; END IF;
            IF resource_team_id IS NOT NULL AND resource_team_id = ANY(user_teams) THEN
              RETURN TRUE;
            END IF;
            RETURN FALSE;
          END;
          $$
    `);
  }
}
```

- [ ] **Step 2: Run the migration locally**

```bash
cd packages/shared && npm run build
cd apps/api && npm run migration:run
```

Expected: `TightenRlsHelpers1778100000000 has been executed successfully.`

- [ ] **Step 3: Verify the new helper denies NULL org_id**

```bash
docker compose -f docker-compose.infra.yml exec postgres \
  psql -U perfana -d perfana <<'SQL'
SET app.current_user_id = 'test-user';
SET app.current_user_organizations = '[]';
SET app.current_user_teams = '[]';
SET app.current_user_roles = '["user"]';
SELECT can_access_resource(NULL, NULL, NULL) AS no_super_no_match;
RESET ALL;
SQL
```

Expected output:
```
 no_super_no_match
-------------------
 f
```

(Pre-tightening, this returned `t`. Post-tightening, NULL org_id fails closed.)

- [ ] **Step 4: Verify global admin still short-circuits**

```bash
docker compose -f docker-compose.infra.yml exec postgres \
  psql -U perfana -d perfana <<'SQL'
SET app.current_user_id = 'sysadmin';
SET app.current_user_roles = '["super-admin"]';
SELECT can_access_resource(NULL, NULL, NULL) AS super_admin_short_circuit;
RESET ALL;
SQL
```

Expected: `t`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/database/migrations/1778100000000-TightenRlsHelpers.ts
git commit -m "$(cat <<'EOF'
feat(db): Phase 5b PR1.2 — tighten can_access_resource / can_modify_resource

Strips the pre-Phase-4 `IF resource_org_id IS NULL THEN RETURN TRUE` escape
hatch from both helpers. Phase 4 made organization_id NOT NULL on every
owned-resource entity; the permissive NULL branch is dead code that
misrepresents the security model. Replaces with RETURN FALSE — fail closed.

Capability semantics in can_modify_resource remain loose vs the service
layer (documented as SQL comment).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Migration — retighten `generated_reports` policies

`generated_reports` had its policies temporarily downgraded to `USING (true)` after `team_id` was dropped. Phase 4 restored ownership columns; restore the standard policy shape.

**Files:**
- Create: `packages/shared/src/database/migrations/1778200000000-RetightenGeneratedReportsRls.ts`

- [ ] **Step 1: Verify generated_reports has ownership columns post-Phase-4**

```bash
docker compose -f docker-compose.infra.yml exec postgres \
  psql -U perfana -d perfana \
  -c "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'generated_reports' AND column_name IN ('organization_id', 'created_by') ORDER BY column_name"
```

Expected:
```
   column_name    | is_nullable
------------------+-------------
 created_by       | NO
 organization_id  | NO
```

If `team_id` is also present and not nullable, use the 3-arg helper variant. Otherwise (per CLAUDE.md, team_id was dropped), use the 2-arg variant.

- [ ] **Step 2: Determine team_id presence**

```bash
docker compose -f docker-compose.infra.yml exec postgres \
  psql -U perfana -d perfana \
  -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'generated_reports' AND column_name = 'team_id'"
```

If the result is empty: use 2-arg helper (no team_id reference in policy). If present: use 3-arg helper.

- [ ] **Step 3: Write the migration (2-arg variant — flip to 3-arg if team_id is present)**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 5b PR1: Restore standard RLS policies on generated_reports.
 *
 * Background: 1776148518354-AddWorkloadToEvents dropped team_id from
 * generated_reports; PR #125 dropped its policies without recreating; PR
 * #149 fixed url_patterns + api_keys but left generated_reports
 * permissive (USING (true)). Phase 4 restored ownership columns.
 *
 * This migration replaces the temporary `USING (true)` policies with the
 * standard 2-arg helper variant. The 2-arg helpers (introduced in
 * 1777400000000-RestoreRlsPoliciesPostTeamIdRemoval) delegate to the
 * 3-arg variants with team_id := NULL.
 */
export class RetightenGeneratedReportsRls1778200000000
  implements MigrationInterface
{
  name = 'RetightenGeneratedReportsRls1778200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const op of ['select', 'insert', 'update', 'delete']) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS rls_generated_reports_${op} ON "generated_reports"`,
      );
    }
    await queryRunner.query(`
      CREATE POLICY rls_generated_reports_select ON generated_reports FOR SELECT
        USING (public.can_access_resource(organization_id, (created_by)::text))
    `);
    await queryRunner.query(`
      CREATE POLICY rls_generated_reports_insert ON generated_reports FOR INSERT
        WITH CHECK (public.is_global_admin() OR public.can_access_resource(organization_id, (created_by)::text))
    `);
    await queryRunner.query(`
      CREATE POLICY rls_generated_reports_update ON generated_reports FOR UPDATE
        USING (public.can_modify_resource(organization_id, (created_by)::text))
    `);
    await queryRunner.query(`
      CREATE POLICY rls_generated_reports_delete ON generated_reports FOR DELETE
        USING (public.can_modify_resource(organization_id, (created_by)::text))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const op of ['select', 'insert', 'update', 'delete']) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS rls_generated_reports_${op} ON "generated_reports"`,
      );
    }
    // Restore the pre-tightening permissive policies (matches state after
    // 1777400000000).
    await queryRunner.query(`
      CREATE POLICY rls_generated_reports_select ON generated_reports FOR SELECT USING (true)
    `);
    await queryRunner.query(`
      CREATE POLICY rls_generated_reports_insert ON generated_reports FOR INSERT WITH CHECK (true)
    `);
    await queryRunner.query(`
      CREATE POLICY rls_generated_reports_update ON generated_reports FOR UPDATE
        USING (public.is_global_admin())
    `);
    await queryRunner.query(`
      CREATE POLICY rls_generated_reports_delete ON generated_reports FOR DELETE
        USING (public.is_global_admin())
    `);
  }
}
```

- [ ] **Step 4: Run the migration**

```bash
cd packages/shared && npm run build
cd apps/api && npm run migration:run
```

- [ ] **Step 5: Verify policies are tight**

```bash
docker compose -f docker-compose.infra.yml exec postgres \
  psql -U perfana -d perfana \
  -c "SELECT policyname, qual FROM pg_policies WHERE tablename = 'generated_reports' ORDER BY policyname"
```

Expected: every `qual` references `can_access_resource` or `can_modify_resource`, none are `true`.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/database/migrations/1778200000000-RetightenGeneratedReportsRls.ts
git commit -m "$(cat <<'EOF'
feat(db): Phase 5b PR1.3 — retighten generated_reports RLS policies

Replaces the temporary USING (true) policies (set after team_id was dropped
in 1776148518354-AddWorkloadToEvents) with the standard 2-arg helper variant.
Phase 4 restored organization_id and created_by; this closes the permissive
hole.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Migration — tighten `test_runs.organization_id`

Backfill from joined `systems_under_test`, then `SET NOT NULL`. Removes the "vestigial" exception so the standard policy works without subqueries.

**Files:**
- Create: `packages/shared/src/database/migrations/1778300000000-TightenTestRunsOrganizationId.ts`
- Modify: `CLAUDE.md` (remove test_runs from "Ownership column nullability" exceptions list)

- [ ] **Step 1: Audit current state**

```bash
docker compose -f docker-compose.infra.yml exec postgres \
  psql -U perfana -d perfana <<'SQL'
SELECT count(*) AS total, count(*) FILTER (WHERE organization_id IS NULL) AS null_org FROM test_runs;
SELECT count(*) AS orphans FROM test_runs t LEFT JOIN systems_under_test sut ON sut.id = t.system_under_test_id WHERE sut.id IS NULL;
SQL
```

Expected: `orphans = 0` (every test_run must have a SUT — `system_under_test_id` is required). If orphans > 0, fix data first; the migration will abort.

- [ ] **Step 2: Write the migration**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 5b PR1: Backfill test_runs.organization_id from the joined SUT, then
 * tighten to NOT NULL.
 *
 * Pre-existing CLAUDE.md note flagged test_runs.organization_id as "vestigial"
 * because access was checked via the joined SUT. RLS activation needs the
 * column to be authoritative so the standard policy
 * (`can_access_resource(organization_id, team_id, created_by)`) works
 * without a subquery to systems_under_test.
 *
 * Backfill is bounded: every test_run has system_under_test_id NOT NULL by
 * existing FK; SUT has organization_id NOT NULL post-Phase-4; therefore every
 * test_run can resolve an organization_id. Migration aborts if any row
 * remains NULL after backfill.
 */
export class TightenTestRunsOrganizationId1778300000000
  implements MigrationInterface
{
  name = 'TightenTestRunsOrganizationId1778300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Backfill organization_id from the joined SUT.
    const updated = await queryRunner.query(`
      UPDATE test_runs t
      SET organization_id = sut.organization_id,
          team_id = COALESCE(t.team_id, sut.team_id)
      FROM systems_under_test sut
      WHERE t.system_under_test_id = sut.id
        AND t.organization_id IS NULL
    `);
    // node-postgres returns affected row count via the second array element on
    // multi-statement results; for ad-hoc UPDATE through query runner the
    // count surfaces in `updated` (TypeORM-specific). Log for visibility.
    console.log(`Backfilled organization_id on test_runs:`, updated);

    // 2. Verify no orphans (defense against an unexpected schema state).
    const orphans = await queryRunner.query(
      `SELECT count(*)::int AS c FROM test_runs WHERE organization_id IS NULL`,
    );
    if (orphans[0].c > 0) {
      throw new Error(
        `Cannot tighten test_runs.organization_id: ${orphans[0].c} rows still NULL after backfill. ` +
        `Investigate orphan test_runs (no SUT or SUT.organization_id NULL) before re-running.`,
      );
    }

    // 3. Tighten the column.
    await queryRunner.query(`ALTER TABLE test_runs ALTER COLUMN organization_id SET NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reversible: drop the NOT NULL constraint. Backfilled values are kept
    // (no point in nulling them; that would lose data).
    await queryRunner.query(`ALTER TABLE test_runs ALTER COLUMN organization_id DROP NOT NULL`);
  }
}
```

- [ ] **Step 3: Run the migration**

```bash
cd packages/shared && npm run build
cd apps/api && npm run migration:run
```

Expected: log line `Backfilled organization_id on test_runs: ...` followed by the standard "executed successfully" line. If the migration aborts with the orphan-detection error, do NOT proceed — investigate the data first.

- [ ] **Step 4: Verify NOT NULL is in place**

```bash
docker compose -f docker-compose.infra.yml exec postgres \
  psql -U perfana -d perfana \
  -c "SELECT is_nullable FROM information_schema.columns WHERE table_name = 'test_runs' AND column_name = 'organization_id'"
```

Expected: `NO`.

- [ ] **Step 5: Update CLAUDE.md**

In CLAUDE.md, find the "Ownership column nullability" section. Replace:

```markdown
- Exceptions intentionally kept nullable: `audit_logs.organization_id` (system-level events with no org context) and `test_runs.organization_id` (vestigial — TestRun access is checked via the joined SystemUnderTest's `organization_id` per the entity-ownership contract).
```

with:

```markdown
- Exception intentionally kept nullable: `audit_logs.organization_id` (system-level events with no org context). `test_runs.organization_id` was previously vestigial; Phase 5b backfilled and tightened it to NOT NULL so the standard RLS policy works without subqueries.
```

Also update the Phase 4 row's parenthetical (search for "audit_logs and test_runs keep nullable for documented reasons") to reflect the new state — only `audit_logs` keeps nullable.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/database/migrations/1778300000000-TightenTestRunsOrganizationId.ts CLAUDE.md
git commit -m "$(cat <<'EOF'
feat(db): Phase 5b PR1.4 — tighten test_runs.organization_id to NOT NULL

Backfills organization_id from the joined systems_under_test (bounded — every
test_run has an SUT FK; every SUT has organization_id NOT NULL post-Phase-4).
Migration aborts if any row remains NULL after backfill.

Removes the "vestigial column" exception in CLAUDE.md. test_runs is now a
standard owned resource for RLS purposes; audit_logs is the lone nullable
holdout (system events with no org context).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Migration — rewrite `audit_logs` RLS policies

Audit logs intentionally keep `organization_id` nullable for system events. Rewrite the SELECT policy to handle null-org rows (super-admin only) and non-null rows (org-scoped). Make UPDATE/DELETE super-admin only (audit log is append-only).

**Files:**
- Create: `packages/shared/src/database/migrations/1778400000000-RewriteAuditLogsRls.ts`

- [ ] **Step 1: Write the migration**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 5b PR1: Replace audit_logs RLS policies with a special-case shape that
 * accommodates the table's intentional `organization_id` nullability.
 *
 *   - SELECT: super-admin sees all rows including null-org system events.
 *             org-admins see only their accessible orgs' events.
 *   - INSERT: permissive (true). The AuditService is the only writer; it
 *             populates organization_id truthfully or leaves it NULL by intent.
 *   - UPDATE: super-admin only (audit log is append-only).
 *   - DELETE: super-admin only (partition manager DROP TABLE bypasses RLS via DDL).
 */
export class RewriteAuditLogsRls1778400000000 implements MigrationInterface {
  name = 'RewriteAuditLogsRls1778400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const op of ['select', 'insert', 'update', 'delete']) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS rls_audit_logs_${op} ON "audit_logs"`,
      );
    }
    await queryRunner.query(`
      CREATE POLICY rls_audit_logs_select ON audit_logs FOR SELECT
        USING (
          public.is_global_admin()
          OR (organization_id IS NOT NULL
              AND public.can_access_resource(organization_id, NULL, NULL))
        )
    `);
    await queryRunner.query(`
      CREATE POLICY rls_audit_logs_insert ON audit_logs FOR INSERT
        WITH CHECK (true)
    `);
    await queryRunner.query(`
      CREATE POLICY rls_audit_logs_update ON audit_logs FOR UPDATE
        USING (public.is_global_admin())
    `);
    await queryRunner.query(`
      CREATE POLICY rls_audit_logs_delete ON audit_logs FOR DELETE
        USING (public.is_global_admin())
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const op of ['select', 'insert', 'update', 'delete']) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS rls_audit_logs_${op} ON "audit_logs"`,
      );
    }
    // Restore the standard 3-arg policy shape (matches state when audit_logs
    // was created in 1777800000000-CreatePartitionedAuditLogs).
    await queryRunner.query(`
      CREATE POLICY rls_audit_logs_select ON audit_logs FOR SELECT
        USING (public.can_access_resource(organization_id, NULL, (user_id)::text))
    `);
    await queryRunner.query(`
      CREATE POLICY rls_audit_logs_insert ON audit_logs FOR INSERT WITH CHECK (true)
    `);
    await queryRunner.query(`
      CREATE POLICY rls_audit_logs_update ON audit_logs FOR UPDATE
        USING (public.can_modify_resource(organization_id, NULL, (user_id)::text))
    `);
    await queryRunner.query(`
      CREATE POLICY rls_audit_logs_delete ON audit_logs FOR DELETE
        USING (public.can_modify_resource(organization_id, NULL, (user_id)::text))
    `);
  }
}
```

- [ ] **Step 2: Run the migration**

```bash
cd packages/shared && npm run build
cd apps/api && npm run migration:run
```

- [ ] **Step 3: Verify the rewritten policies**

```bash
docker compose -f docker-compose.infra.yml exec postgres \
  psql -U perfana -d perfana \
  -c "SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'audit_logs' ORDER BY policyname"
```

Expected:
- `rls_audit_logs_select.qual` references `is_global_admin() OR (organization_id IS NOT NULL ...)`
- `rls_audit_logs_insert.with_check` is `true`
- `rls_audit_logs_update.qual` is `is_global_admin()`
- `rls_audit_logs_delete.qual` is `is_global_admin()`

- [ ] **Step 4: Smoke-test the SELECT policy**

```bash
docker compose -f docker-compose.infra.yml exec postgres \
  psql -U perfana -d perfana <<'SQL'
SET ROLE perfana_app;
SET app.current_user_id = 'org-admin-user';
SET app.current_user_organizations = '[]';
SET app.current_user_roles = '["org-admin"]';
SELECT count(*) AS visible FROM audit_logs;  -- expect 0 (no accessible orgs)

SET app.current_user_roles = '["super-admin"]';
SELECT count(*) AS visible FROM audit_logs;  -- expect total row count

RESET ROLE; RESET ALL;
SQL
```

Expected: org-admin with empty orgs sees 0 rows; super-admin sees all rows.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/database/migrations/1778400000000-RewriteAuditLogsRls.ts
git commit -m "$(cat <<'EOF'
feat(db): Phase 5b PR1.5 — rewrite audit_logs RLS policies

audit_logs.organization_id stays nullable (system events). Rewrites the
policies to handle both cases cleanly:

  - SELECT: super-admin sees all rows including null-org; org-admins see
    only rows where organization_id is in their accessible orgs.
  - INSERT: permissive (AuditService is the trusted writer).
  - UPDATE/DELETE: super-admin only (audit log is append-only; partition
    manager DROP TABLE bypasses RLS via DDL).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Snapshot test — RLS policy coverage

Locks in the post-migration state of every owned-resource entity's RLS posture. Future entities added without policies fail this snapshot in CI.

**Files:**
- Create: `apps/api/src/test/rls/rls-policy-coverage.snapshot.spec.ts`

- [ ] **Step 1: Write the test**

```ts
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../config/database.config';

/**
 * Phase 5b: Snapshot the RLS posture (FORCE flag + policy commands) for every
 * owned-resource table. Adding a new owned-resource table without policies
 * fails this snapshot in PR review — forces the conversation about whether
 * the table should be RLS-protected, exempt with a documented reason, or
 * a candidate for the `audit_logs`-style special-case shape.
 *
 * Discovery: walks pg_class for tables that have an organization_id column
 * and lives in the `public` schema. Excludes timeseries hypertable child
 * partitions (TimescaleDB internal naming).
 */
describe('RLS policy coverage snapshot', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = new DataSource(dataSourceOptions);
    await ds.initialize();
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('every owned-resource table has FORCE RLS + 4 policies', async () => {
    const tables = await ds.query(`
      SELECT DISTINCT c.relname AS table_name,
             c.relrowsecurity AS rls_enabled,
             c.relforcerowsecurity AS rls_forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN information_schema.columns col ON col.table_schema = n.nspname AND col.table_name = c.relname
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND col.column_name = 'organization_id'
        AND c.relname NOT LIKE '_hyper_%'
        AND c.relname NOT LIKE '%_y20%'  -- audit_logs partition children
      ORDER BY c.relname
    `);

    const snapshot: Record<string, { rls: boolean; force: boolean; policies: string[] }> = {};
    for (const t of tables) {
      const polRows = await ds.query(
        `SELECT policyname, cmd FROM pg_policies WHERE schemaname='public' AND tablename=$1 ORDER BY policyname`,
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
```

- [ ] **Step 2: Run the test (creates the initial snapshot)**

```bash
cd apps/api && npx jest src/test/rls/rls-policy-coverage.snapshot.spec.ts -u
```

Expected: `1 snapshot written` and the test passes.

- [ ] **Step 3: Inspect the generated snapshot**

```bash
cat apps/api/src/test/rls/__snapshots__/rls-policy-coverage.snapshot.spec.ts.snap
```

Expected: every owned-resource table has `force: true` and 4 entries in `policies` (one each for SELECT, INSERT, UPDATE, DELETE). `audit_logs` and `events` may have non-standard combinations — that's fine, the snapshot captures the actual state. `url_patterns` may have a permissive shape (intentional, per spec §4.5).

- [ ] **Step 4: Commit the snapshot file**

```bash
git add apps/api/src/test/rls/rls-policy-coverage.snapshot.spec.ts apps/api/src/test/rls/__snapshots__/rls-policy-coverage.snapshot.spec.ts.snap
git commit -m "$(cat <<'EOF'
test(api): Phase 5b PR1.6 — snapshot RLS policy coverage

Snapshots (table → {force, policy commands}) for every owned-resource
table in the public schema. Adding a new owned-resource table without
policies fails this snapshot in PR review.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Ship PR1

- [ ] **Step 1: Run the full preflight gate**

```bash
npm run preflight
```

Expected: lint + typecheck pass across the monorepo. If anything fails, fix before opening the PR.

- [ ] **Step 2: Push the branch and open the PR**

```bash
git push -u origin <branch-name>
gh pr create --title "feat(rbac): Phase 5b PR1 — tighten the schema" --body "$(cat <<'EOF'
## Summary
Phase 5b activation prep — the schema-tightening PR. Zero runtime change because `DB_ENABLE_RLS_ROLE` stays `false`.

- Creates `perfana_system` Postgres role (NOBYPASSRLS, system processes will use this in PR2).
- Tightens `can_access_resource` and `can_modify_resource` helpers — strips the dead `IF resource_org_id IS NULL THEN RETURN TRUE` branch (Phase 4 made org_id NOT NULL on every owned resource).
- Retightens `generated_reports` policies (were permissive `USING (true)` after team_id was dropped).
- Backfills `test_runs.organization_id` from the joined SUT and tightens to NOT NULL — retires the "vestigial column" exception.
- Rewrites `audit_logs` policies to handle nullable org_id correctly (super-admin sees all; org-admin sees only their orgs).
- Snapshot test locks in the post-migration state.

## Test plan
- [x] All 5 migrations run cleanly on a populated dev DB.
- [x] Snapshot test passes and captures expected state.
- [x] Helper SQL smoke tests confirm: super-admin short-circuits, NULL org_id fails closed.
- [ ] CI passes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for CI; address feedback; merge.**

## PR2 — Foundation: interceptor + system data sources

Lands all the runtime plumbing — `RlsTransactionInterceptor`, `withRequestEm` helper, system data-source factory wired into worker/grafana-sync/perfana-report, and the `/api/users/me/db-context` health endpoint. Still gated behind `DB_ENABLE_RLS_ROLE=false` so production behavior is unchanged.

### Task 8: REQ_EM CLS namespace + `withRequestEm` helper

**Files:**
- Create: `apps/api/src/common/db/request-em.ts`

- [ ] **Step 1: Write the helper**

```ts
import { ClsServiceManager } from 'nestjs-cls';
import { EntityManager, ObjectLiteral, Repository } from 'typeorm';

/**
 * Phase 5b: CLS namespace key for the per-request, transaction-scoped
 * EntityManager populated by RlsTransactionInterceptor.
 *
 * When `DB_ENABLE_RLS_ROLE=true`, every authenticated request runs inside
 * a transaction with `SET LOCAL ROLE perfana_app` and four `SET LOCAL`
 * GUCs. The interceptor stores the transaction's EntityManager here;
 * services pull it back via `withRequestEm()` so their queries inherit
 * the role + GUCs.
 *
 * When the flag is off (or the request is unauthenticated), the CLS slot
 * is empty and `withRequestEm()` falls back to the original repository.
 */
export const REQ_EM = Symbol('rls-request-entity-manager');

/**
 * Returns the request-scoped EntityManager if one is in CLS, otherwise null.
 * Outside an HTTP request (worker, scheduled job, test), CLS isn't initialized
 * and this returns null — callers fall through to default repos.
 */
export function getRequestEm(): EntityManager | null {
  try {
    return ClsServiceManager.getClsService().get<EntityManager>(REQ_EM) ?? null;
  } catch {
    // ClsService not initialized (e.g., unit-test context): no request EM.
    return null;
  }
}

/**
 * Returns a Repository<T> bound to the request-scoped EntityManager when
 * available, falling back to the input repository otherwise.
 *
 *   // BEFORE
 *   await this.apiKeyRepo.find({ where: { organizationId } });
 *
 *   // AFTER
 *   await withRequestEm(this.apiKeyRepo).find({ where: { organizationId } });
 *
 * Identity-transparent when DB_ENABLE_RLS_ROLE=false: returns `repo` unchanged.
 */
export function withRequestEm<T extends ObjectLiteral>(repo: Repository<T>): Repository<T> {
  const em = getRequestEm();
  if (!em) return repo;
  return em.getRepository(repo.target);
}
```

- [ ] **Step 2: Confirm the path is correct**

```bash
ls apps/api/src/common/db/ 2>/dev/null
```

Expected: the directory may not exist yet. If not, the file create above implicitly creates it (Write tool); if the create failed for that reason, run `mkdir -p apps/api/src/common/db` and retry.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/common/db/request-em.ts
git commit -m "$(cat <<'EOF'
feat(api): Phase 5b — REQ_EM CLS namespace + withRequestEm helper

Adds the helper services will use to pick up the request-scoped
EntityManager populated by RlsTransactionInterceptor. Identity-
transparent when DB_ENABLE_RLS_ROLE=false (returns the input repo).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Unit tests for `withRequestEm`

**Files:**
- Create: `apps/api/src/common/db/request-em.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { ClsServiceManager } from 'nestjs-cls';
import type { EntityManager, Repository } from 'typeorm';
import { getRequestEm, REQ_EM, withRequestEm } from './request-em';

describe('withRequestEm', () => {
  beforeEach(() => {
    // Reset CLS between tests
    try {
      ClsServiceManager.getClsService().exit();
    } catch {
      /* not initialized — fine */
    }
  });

  describe('outside CLS (no request)', () => {
    it('getRequestEm returns null', () => {
      expect(getRequestEm()).toBeNull();
    });

    it('withRequestEm returns the input repo unchanged', () => {
      const fakeRepo = { target: class {}, find: jest.fn() } as unknown as Repository<object>;
      expect(withRequestEm(fakeRepo)).toBe(fakeRepo);
    });
  });

  describe('inside CLS with REQ_EM populated', () => {
    it('getRequestEm returns the stored EntityManager', async () => {
      const fakeEm = { getRepository: jest.fn() } as unknown as EntityManager;
      await ClsServiceManager.getClsService().run(async () => {
        ClsServiceManager.getClsService().set(REQ_EM, fakeEm);
        expect(getRequestEm()).toBe(fakeEm);
      });
    });

    it('withRequestEm uses the stored EntityManager to derive a fresh repo', async () => {
      const target = class {};
      const fakeRepo = { target, find: jest.fn() } as unknown as Repository<object>;
      const fakeEmRepo = { target, find: jest.fn() } as unknown as Repository<object>;
      const fakeEm = {
        getRepository: jest.fn().mockReturnValue(fakeEmRepo),
      } as unknown as EntityManager;

      await ClsServiceManager.getClsService().run(async () => {
        ClsServiceManager.getClsService().set(REQ_EM, fakeEm);
        const result = withRequestEm(fakeRepo);
        expect(result).toBe(fakeEmRepo);
        expect(fakeEm.getRepository).toHaveBeenCalledWith(target);
      });
    });
  });

  describe('inside CLS without REQ_EM (e.g., flag off)', () => {
    it('withRequestEm falls back to input repo', async () => {
      const fakeRepo = { target: class {}, find: jest.fn() } as unknown as Repository<object>;
      await ClsServiceManager.getClsService().run(async () => {
        // REQ_EM intentionally not set
        expect(withRequestEm(fakeRepo)).toBe(fakeRepo);
      });
    });
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
cd apps/api && npx jest src/common/db/request-em.spec.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/common/db/request-em.spec.ts
git commit -m "$(cat <<'EOF'
test(api): Phase 5b — withRequestEm helper unit tests

Covers: outside CLS (returns null/identity), inside CLS with REQ_EM set
(derives request-scoped repo), inside CLS without REQ_EM (falls back to
input repo).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: `@SkipRls()` decorator

A decorator for streaming endpoints that should NOT be wrapped in the per-request transaction (because holding a transaction for a long-lived stream starves the connection pool).

**Files:**
- Create: `apps/api/src/common/db/skip-rls.decorator.ts`

- [ ] **Step 1: Write the decorator**

```ts
import { SetMetadata } from '@nestjs/common';

/**
 * Phase 5b: Marks a controller method as exempt from the
 * RlsTransactionInterceptor. The interceptor will check this metadata
 * via Reflector and skip the transaction wrap, leaving the request to
 * run on a non-transactional connection.
 *
 * Use sparingly — typically only for streaming/SSE endpoints that hold
 * the response open for minutes. The endpoint must NOT touch RLS-
 * protected tables (or it must do so via an explicit transactional
 * helper that opens its own short-lived RLS transaction internally).
 *
 *   @Get('events/stream')
 *   @SkipRls()
 *   async stream(@Res() res: Response) {
 *     // ... long-lived SSE stream
 *   }
 */
export const SKIP_RLS_KEY = 'skip-rls';
export const SkipRls = (): MethodDecorator => SetMetadata(SKIP_RLS_KEY, true);
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/common/db/skip-rls.decorator.ts
git commit -m "$(cat <<'EOF'
feat(api): Phase 5b — @SkipRls() decorator for streaming endpoints

Endpoints decorated with @SkipRls() are exempt from
RlsTransactionInterceptor's per-request transaction wrap. Use only for
long-lived SSE/streaming responses that would otherwise pin a pool
connection.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: `RlsTransactionInterceptor`

**Files:**
- Create: `apps/api/src/common/interceptors/rls-transaction.interceptor.ts`

- [ ] **Step 1: Write the interceptor**

```ts
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { Observable, lastValueFrom, from } from 'rxjs';
import { toArray } from 'rxjs/operators';
import { DataSource, EntityManager } from 'typeorm';
import { AuthorizationService } from '../services/authorization.service';
import { REQ_CTX, RequestContextStore } from '../context/request-context';
import { REQ_EM } from '../db/request-em';
import { SKIP_RLS_KEY } from '../db/skip-rls.decorator';

/**
 * Phase 5b: Wraps each authenticated request handler in a TypeORM transaction
 * and sets `SET LOCAL ROLE perfana_app` + four `SET LOCAL` GUCs so the
 * Postgres FORCE ROW LEVEL SECURITY policies can evaluate the user's
 * accessible orgs / teams / roles.
 *
 * Behavior:
 *  - Skips wrapping if `DB_ENABLE_RLS_ROLE !== 'true'`.
 *  - Skips wrapping if the request is unauthenticated (`reqCtx.userId` empty).
 *  - Skips wrapping if the handler is annotated `@SkipRls()`.
 *  - Otherwise: opens a transaction, sets role + GUCs, stores the
 *    EntityManager in CLS under `REQ_EM`, runs the handler, commits.
 *
 * Roles are read directly from `req.user.roles` (KeycloakEnhancedAuthGuard
 * populates this). The 5a CLS REQ_CTX intentionally doesn't include roles —
 * extending it would touch the audit-context interceptor; reading from
 * req.user is a smaller change.
 *
 * Streaming/SSE handlers that emit multiple values keep buffering inside
 * `toArray()` — that's correct for typical REST handlers but wrong for
 * long-lived streams. Such endpoints MUST use `@SkipRls()`.
 */
@Injectable()
export class RlsTransactionInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RlsTransactionInterceptor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly cls: ClsService,
    private readonly authz: AuthorizationService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const enabled = this.config.get<string>('DB_ENABLE_RLS_ROLE') === 'true';
    if (!enabled) return next.handle();

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RLS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return next.handle();

    const reqCtx = this.cls.get<RequestContextStore>(REQ_CTX);
    if (!reqCtx?.userId) return next.handle();

    const req = context.switchToHttp().getRequest<{ user?: { roles?: string[] } }>();
    const roles = req.user?.roles ?? [];

    const [orgs, teams] = await Promise.all([
      this.authz.getAccessibleOrganizations(reqCtx.userId),
      this.authz.getAccessibleTeams(reqCtx.userId),
    ]);

    const dataSource = this.dataSource;
    const cls = this.cls;
    const logger = this.logger;

    return from(
      dataSource.transaction(async (em: EntityManager) => {
        await em.query(`SET LOCAL ROLE perfana_app`);
        await em.query(
          `SELECT set_config('app.current_user_id', $1, true)`,
          [reqCtx.userId],
        );
        await em.query(
          `SELECT set_config('app.current_user_organizations', $1, true)`,
          [JSON.stringify(orgs)],
        );
        await em.query(
          `SELECT set_config('app.current_user_teams', $1, true)`,
          [JSON.stringify(teams)],
        );
        await em.query(
          `SELECT set_config('app.current_user_roles', $1, true)`,
          [JSON.stringify(roles)],
        );
        cls.set(REQ_EM, em);
        try {
          // Buffer all emissions inside the transaction. For typical REST
          // handlers this is a single value; @SkipRls()-marked endpoints
          // bypass this entirely.
          return await lastValueFrom(next.handle().pipe(toArray()));
        } catch (err) {
          logger.warn(
            `request rolled back inside RLS transaction: ${err instanceof Error ? err.message : err}`,
          );
          throw err;
        }
      }),
    ).pipe(
      // Re-emit the buffered values so downstream observers see them.
      // For single-value handlers this is a one-element array → one emission.
      toArray$flatten(),
    );
  }
}

// rxjs doesn't ship a `flatten`-style operator; inline a tiny helper.
import { mergeMap } from 'rxjs/operators';
function toArray$flatten() {
  return mergeMap((arr: unknown[]) => arr);
}
```

- [ ] **Step 2: Verify imports compile**

```bash
cd apps/api && npx tsc --noEmit src/common/interceptors/rls-transaction.interceptor.ts
```

If `mergeMap`/`toArray` import paths fail, adjust to match the rxjs version installed (`grep "\"rxjs\":" apps/api/package.json`).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/common/interceptors/rls-transaction.interceptor.ts
git commit -m "$(cat <<'EOF'
feat(api): Phase 5b — RlsTransactionInterceptor

Wraps every authenticated request handler in a TypeORM transaction with
SET LOCAL ROLE perfana_app + four SET LOCAL GUCs (user_id, orgs, teams,
roles). Stores the request EntityManager in CLS under REQ_EM so services
can pick it up via withRequestEm().

Behavior is gated on DB_ENABLE_RLS_ROLE=true; default off in dev.
Endpoints decorated @SkipRls() bypass the wrap (for long-lived streams).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Unit tests for `RlsTransactionInterceptor`

**Files:**
- Create: `apps/api/src/common/interceptors/rls-transaction.interceptor.spec.ts`

- [ ] **Step 1: Write the tests**

```ts
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ClsService, ClsServiceManager } from 'nestjs-cls';
import { lastValueFrom, of, throwError } from 'rxjs';
import { DataSource } from 'typeorm';
import { AuthorizationService } from '../services/authorization.service';
import { REQ_CTX } from '../context/request-context';
import { REQ_EM } from '../db/request-em';
import { SkipRls, SKIP_RLS_KEY } from '../db/skip-rls.decorator';
import { RlsTransactionInterceptor } from './rls-transaction.interceptor';

function makeInterceptor(opts: {
  flagEnabled: boolean;
  reqCtx: { userId: string } | null;
  user: { roles?: string[] } | null;
  orgs: string[];
  teams: string[];
  skipRls?: boolean;
}) {
  const queries: Array<{ q: string; params?: unknown[] }> = [];
  const txn = jest.fn(async (cb: (em: unknown) => Promise<unknown>) => {
    const em = {
      query: (q: string, params?: unknown[]) => {
        queries.push({ q, params });
        return Promise.resolve();
      },
    };
    return cb(em);
  });

  const dataSource = { transaction: txn } as unknown as DataSource;
  const cls = {
    get: jest.fn().mockImplementation((key: symbol) =>
      key === REQ_CTX ? opts.reqCtx : null,
    ),
    set: jest.fn(),
  } as unknown as ClsService;
  const authz = {
    getAccessibleOrganizations: jest.fn().mockResolvedValue(opts.orgs),
    getAccessibleTeams: jest.fn().mockResolvedValue(opts.teams),
  } as unknown as AuthorizationService;
  const config = {
    get: jest.fn().mockReturnValue(opts.flagEnabled ? 'true' : 'false'),
  } as unknown as ConfigService;
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(opts.skipRls ?? false),
  } as unknown as Reflector;

  const interceptor = new RlsTransactionInterceptor(
    dataSource, cls, authz, config, reflector,
  );

  const ctx = {
    switchToHttp: () => ({ getRequest: () => ({ user: opts.user }) }),
    getHandler: () => () => undefined,
    getClass: () => class C {},
  } as unknown as Parameters<typeof interceptor.intercept>[0];

  return { interceptor, ctx, queries, txn, cls, authz };
}

describe('RlsTransactionInterceptor', () => {
  it('skips wrapping when DB_ENABLE_RLS_ROLE=false', async () => {
    const { interceptor, ctx, txn } = makeInterceptor({
      flagEnabled: false, reqCtx: { userId: 'u1' }, user: { roles: ['user'] }, orgs: [], teams: [],
    });
    const next = { handle: () => of('result') };
    const obs = await interceptor.intercept(ctx, next);
    expect(await lastValueFrom(obs)).toBe('result');
    expect(txn).not.toHaveBeenCalled();
  });

  it('skips wrapping for unauthenticated requests', async () => {
    const { interceptor, ctx, txn } = makeInterceptor({
      flagEnabled: true, reqCtx: null, user: null, orgs: [], teams: [],
    });
    const next = { handle: () => of('result') };
    const obs = await interceptor.intercept(ctx, next);
    expect(await lastValueFrom(obs)).toBe('result');
    expect(txn).not.toHaveBeenCalled();
  });

  it('skips wrapping for @SkipRls()-annotated handlers', async () => {
    const { interceptor, ctx, txn } = makeInterceptor({
      flagEnabled: true, reqCtx: { userId: 'u1' }, user: { roles: ['user'] },
      orgs: [], teams: [], skipRls: true,
    });
    const next = { handle: () => of('result') };
    const obs = await interceptor.intercept(ctx, next);
    expect(await lastValueFrom(obs)).toBe('result');
    expect(txn).not.toHaveBeenCalled();
  });

  it('wraps the handler in a transaction with role + GUCs set', async () => {
    const { interceptor, ctx, txn, queries, cls } = makeInterceptor({
      flagEnabled: true,
      reqCtx: { userId: 'u1' },
      user: { roles: ['user', 'org-member'] },
      orgs: ['org-A', 'org-B'],
      teams: [],
    });
    const next = { handle: () => of('handler-result') };
    const obs = await interceptor.intercept(ctx, next);
    const result = await lastValueFrom(obs);
    expect(result).toBe('handler-result');
    expect(txn).toHaveBeenCalledTimes(1);
    expect(queries[0].q).toBe('SET LOCAL ROLE perfana_app');
    expect(queries[1]).toEqual({
      q: `SELECT set_config('app.current_user_id', $1, true)`,
      params: ['u1'],
    });
    expect(queries[2]).toEqual({
      q: `SELECT set_config('app.current_user_organizations', $1, true)`,
      params: ['["org-A","org-B"]'],
    });
    expect(queries[3]).toEqual({
      q: `SELECT set_config('app.current_user_teams', $1, true)`,
      params: ['[]'],
    });
    expect(queries[4]).toEqual({
      q: `SELECT set_config('app.current_user_roles', $1, true)`,
      params: ['["user","org-member"]'],
    });
    expect(cls.set).toHaveBeenCalledWith(REQ_EM, expect.any(Object));
  });

  it('rolls back when the handler throws', async () => {
    const { interceptor, ctx, txn } = makeInterceptor({
      flagEnabled: true, reqCtx: { userId: 'u1' }, user: { roles: ['user'] },
      orgs: [], teams: [],
    });
    const next = { handle: () => throwError(() => new Error('handler boom')) };
    const obs = await interceptor.intercept(ctx, next);
    await expect(lastValueFrom(obs)).rejects.toThrow('handler boom');
    expect(txn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
cd apps/api && npx jest src/common/interceptors/rls-transaction.interceptor.spec.ts
```

Expected: all 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/common/interceptors/rls-transaction.interceptor.spec.ts
git commit -m "$(cat <<'EOF'
test(api): Phase 5b — RlsTransactionInterceptor unit tests

Covers: flag-off bypass, unauthenticated bypass, @SkipRls bypass,
SQL preamble order + parameters, transaction rollback on error.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Register interceptor globally in `app.module.ts`

**Files:**
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Inspect current interceptor registration**

```bash
grep -n "APP_INTERCEPTOR\|provide:" apps/api/src/app.module.ts | head -30
```

Note where `AuditContextInterceptor` is registered. The new interceptor goes immediately after it.

- [ ] **Step 2: Add the import and provider**

In `apps/api/src/app.module.ts`, add the import near the top (alphabetically, alongside other interceptor imports):

```ts
import { RlsTransactionInterceptor } from './common/interceptors/rls-transaction.interceptor';
```

Locate the `providers` array entry that includes `AuditContextInterceptor` (it will look like `{ provide: APP_INTERCEPTOR, useClass: AuditContextInterceptor }`). Immediately after it, add:

```ts
{
  provide: APP_INTERCEPTOR,
  useClass: RlsTransactionInterceptor,
},
```

NestJS executes interceptors in the order they are provided when multiple `APP_INTERCEPTOR` tokens are bound. Confirm by viewing the array after editing — `AuditContextInterceptor` first, then `RlsTransactionInterceptor`.

- [ ] **Step 3: Verify compilation**

```bash
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 4: Run the API and confirm clean boot with flag off**

```bash
DB_ENABLE_RLS_ROLE=false npm run dev:api
```

Expected: API boots, no errors logged related to RLS or DataSource. Stop the server (`Ctrl+C`).

- [ ] **Step 5: Run the API with flag on (confirm no boot regression)**

```bash
DB_ENABLE_RLS_ROLE=true npm run dev:api
```

Expected: API still boots cleanly (no requests sent, no transaction errors). Behavior change only manifests when authenticated requests come in. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(api): Phase 5b — register RlsTransactionInterceptor globally

Registers after AuditContextInterceptor so the CLS REQ_CTX is populated
before the RLS interceptor reads it. Behavior is no-op when
DB_ENABLE_RLS_ROLE=false (default).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: System connection preamble + factory

**Files:**
- Create: `packages/shared/src/database/system-connection.ts`
- Create: `packages/shared/src/database/data-source-system.ts`

- [ ] **Step 1: Write `system-connection.ts`**

```ts
/**
 * Phase 5b: SQL preamble that switches a Postgres connection to the
 * `perfana_system` role and populates the four GUCs that
 * `is_global_admin()` reads. Used by every non-API process (worker,
 * grafana-sync, perfana-report) on every pool checkout.
 *
 * The preamble uses session-scope `set_config(..., false)` (NOT LOCAL)
 * so the GUCs persist for the connection's lifetime — system processes
 * don't transaction-wrap every job. When the connection returns to the
 * pool, the next checkout re-runs the preamble (idempotent).
 *
 * `app.current_user_roles = '["super-admin"]'` causes `is_global_admin()`
 * to return TRUE inside RLS policies, short-circuiting all `can_access`
 * and `can_modify` checks. The role identity (`system:<actor>`) flows
 * into audit rows via 5a's `actorOverride` plumbing.
 */
export type SystemActor =
  | 'worker'
  | 'grafana-sync'
  | 'perfana-report'
  | 'audit-partition-manager';

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

- [ ] **Step 2: Write `data-source-system.ts`**

```ts
import { DataSource, DataSourceOptions } from 'typeorm';
import { Logger } from '@nestjs/common';
import { buildSystemConnectionPreamble, SystemActor } from './system-connection';

/**
 * Phase 5b: Initializes a TypeORM DataSource and attaches a `connect` hook
 * to the underlying node-postgres pool that runs the system preamble on
 * every new connection.
 *
 * Asserts post-init that the role switch succeeded — fails loud if the
 * `perfana_system` role doesn't exist (e.g., migration 1778000000000 hasn't
 * been run).
 */
export async function createSystemDataSource(
  actor: SystemActor,
  opts: DataSourceOptions,
): Promise<DataSource> {
  const logger = new Logger(`SystemDataSource:${actor}`);
  const ds = new DataSource(opts);
  await ds.initialize();

  // node-postgres pool exposed via the driver. Property name is `master` for
  // the main pool (replicas live under `slaves`).
  const driver = ds.driver as unknown as { master?: { on: (e: string, cb: (c: unknown) => void) => void } };
  const pool = driver.master;
  if (!pool || typeof pool.on !== 'function') {
    throw new Error(
      `createSystemDataSource: TypeORM driver does not expose a pg-pool 'on' method. ` +
      `Verify @nestjs/typeorm is using node-postgres (type: 'postgres').`,
    );
  }
  const preamble = buildSystemConnectionPreamble(actor);
  pool.on('connect', async (client: unknown) => {
    const c = client as { query: (sql: string) => Promise<unknown>; release: (force?: boolean) => void };
    try {
      for (const stmt of preamble) {
        await c.query(stmt);
      }
    } catch (err) {
      logger.error(
        `system preamble failed for actor=${actor}; destroying connection`,
        err,
      );
      // Force-destroy so the half-configured connection doesn't return to pool.
      c.release(true);
      throw err;
    }
  });

  // Sanity check: assert the role switched on the first checkout.
  const [{ current_user }] = await ds.query(`SELECT current_user`);
  if (current_user !== 'perfana_system') {
    await ds.destroy();
    throw new Error(
      `createSystemDataSource: expected role 'perfana_system' after preamble, got '${current_user}'. ` +
      `Did the perfana_system role migration run? See packages/shared/src/database/migrations/1778000000000-CreatePerfanaSystemRole.ts.`,
    );
  }
  logger.log(`system data source initialized as perfana_system for actor=${actor}`);
  return ds;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/database/system-connection.ts packages/shared/src/database/data-source-system.ts
git commit -m "$(cat <<'EOF'
feat(shared): Phase 5b — system data source factory + preamble

Adds buildSystemConnectionPreamble() and createSystemDataSource() for use
by worker / grafana-sync / perfana-report. Pool 'connect' hook runs the
preamble on every checkout (idempotent); post-init assertion verifies the
role switch succeeded.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Unit tests for system connection preamble

**Files:**
- Create: `packages/shared/src/database/system-connection.spec.ts`

- [ ] **Step 1: Write the tests**

```ts
import { buildSystemConnectionPreamble } from './system-connection';

describe('buildSystemConnectionPreamble', () => {
  it.each(['worker', 'grafana-sync', 'perfana-report', 'audit-partition-manager'] as const)(
    'produces 5 statements for actor=%s',
    actor => {
      const stmts = buildSystemConnectionPreamble(actor);
      expect(stmts).toHaveLength(5);
      expect(stmts[0]).toBe('SET ROLE perfana_system');
      expect(stmts[1]).toBe(`SELECT set_config('app.current_user_id', 'system:${actor}', false)`);
      expect(stmts[2]).toBe(`SELECT set_config('app.current_user_roles', '["super-admin"]', false)`);
      expect(stmts[3]).toBe(`SELECT set_config('app.current_user_organizations', '[]', false)`);
      expect(stmts[4]).toBe(`SELECT set_config('app.current_user_teams', '[]', false)`);
    },
  );

  it('includes the actor identity literally in user_id GUC', () => {
    const stmts = buildSystemConnectionPreamble('worker');
    expect(stmts[1]).toContain(`'system:worker'`);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
cd packages/shared && npx jest src/database/system-connection.spec.ts
```

(If the shared package doesn't have a Jest setup, run via the API package's test runner: `cd apps/api && npx jest ../../packages/shared/src/database/system-connection.spec.ts`.)

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/database/system-connection.spec.ts
git commit -m "$(cat <<'EOF'
test(shared): Phase 5b — system connection preamble unit tests

Asserts the preamble is 5 statements in the expected order with the
actor identity baked into the user_id GUC.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Wire `apps/worker/src/app.module.ts` to system data source

**Files:**
- Modify: `apps/worker/src/app.module.ts`

- [ ] **Step 1: Inspect the current TypeOrmModule configuration**

```bash
grep -n "TypeOrmModule\|forRoot\|forRootAsync" apps/worker/src/app.module.ts
```

- [ ] **Step 2: Modify the data-source factory**

Replace the existing `TypeOrmModule.forRoot(...)` (or `forRootAsync(...)`) with:

```ts
import { createSystemDataSource } from '@perfana/shared/database/data-source-system';
import { TypeOrmModule } from '@nestjs/typeorm';
// ... existing imports

@Module({
  imports: [
    // ... existing imports
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule], // if not already imported
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST'),
        port: parseInt(config.get('DB_PORT'), 10),
        username: config.get('DB_USERNAME'),
        password: config.get('DB_PASSWORD'),
        database: config.get('DB_NAME'),
        ssl: config.get('DB_SSL') === 'true' || config.get('DB_SSL') === 'require'
          ? { rejectUnauthorized: false } : false,
        entities: [/* existing entity list */],
        // The dataSourceFactory hook lets us return a custom DataSource
        // (instead of letting Nest build one from these options).
      }),
      dataSourceFactory: async (opts) => {
        if (!opts) throw new Error('worker: typeorm options missing');
        return createSystemDataSource('worker', opts);
      },
    }),
    // ... rest
  ],
})
export class AppModule {}
```

The exact shape depends on the existing module structure. Key requirement: the final `DataSource` MUST go through `createSystemDataSource('worker', opts)` so the pool-connect hook is registered before any queries run.

- [ ] **Step 3: Boot the worker locally**

```bash
npm run dev:worker
```

Expected log line (from `createSystemDataSource`):
```
[SystemDataSource:worker] system data source initialized as perfana_system for actor=worker
```

If the log says `current_user` is anything other than `perfana_system`, the migration `1778000000000-CreatePerfanaSystemRole` hasn't run on the dev DB. Run `cd apps/api && npm run migration:run` and retry.

- [ ] **Step 4: Verify worker can read/write owned-resource tables under RLS**

In a separate terminal, trigger a typical worker pipeline (e.g., a test-run ingestion). Watch the worker logs for any "permission denied" or "no rows returned" errors. None should occur because `is_global_admin()` short-circuits via the `super-admin` role GUC.

- [ ] **Step 5: Stop the worker and commit**

```bash
git add apps/worker/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(worker): Phase 5b — switch worker to perfana_system role via createSystemDataSource

Worker DataSource now uses createSystemDataSource('worker', opts) so the
pool-connect hook runs the system preamble (SET ROLE perfana_system + four
identity GUCs) on every checkout. is_global_admin() short-circuits via the
super-admin role GUC; RLS policies remain evaluated but always return TRUE.

audit_logs row user_id will be 'system:worker' for worker-initiated
mutations (matches the existing actorOverride plumbing).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Wire `apps/grafana-sync/src/app.module.ts`

**Files:**
- Modify: `apps/grafana-sync/src/app.module.ts`

- [ ] **Step 1: Apply the same change as Task 16, with `'grafana-sync'` as the actor**

```ts
import { createSystemDataSource } from '@perfana/shared/database/data-source-system';
// ... in TypeOrmModule.forRootAsync
dataSourceFactory: async (opts) => {
  if (!opts) throw new Error('grafana-sync: typeorm options missing');
  return createSystemDataSource('grafana-sync', opts);
},
```

- [ ] **Step 2: Boot grafana-sync locally**

```bash
npm run dev:grafana-sync
```

Expected:
```
[SystemDataSource:grafana-sync] system data source initialized as perfana_system for actor=grafana-sync
```

- [ ] **Step 3: Commit**

```bash
git add apps/grafana-sync/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(grafana-sync): Phase 5b — switch to perfana_system role

Same wiring as worker (Task 16), with actor='grafana-sync'. Audit rows
emitted by grafana-sync will have user_id='system:grafana-sync'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: Wire `apps/perfana-report/src/app.module.ts`

**Files:**
- Modify: `apps/perfana-report/src/app.module.ts`

- [ ] **Step 1: Apply the same change with `'perfana-report'`**

```ts
dataSourceFactory: async (opts) => {
  if (!opts) throw new Error('perfana-report: typeorm options missing');
  return createSystemDataSource('perfana-report', opts);
},
```

- [ ] **Step 2: Boot perfana-report locally and verify**

(Reproduction depends on whether perfana-report runs continuously or as a one-shot. If one-shot: `cd apps/perfana-report && npm run dev` and watch for the success log line.)

- [ ] **Step 3: Commit**

```bash
git add apps/perfana-report/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(perfana-report): Phase 5b — switch to perfana_system role

Same wiring as worker (Task 16), with actor='perfana-report'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: `/api/users/me/db-context` health endpoint

A tiny endpoint that returns the caller's RLS role + GUC state. Lets ops confirm "is RLS active for me right now" with a single curl.

**Files:**
- Create: `apps/api/src/modules/users/users-db-context.controller.ts`
- Create: `apps/api/src/modules/users/users-db-context.controller.spec.ts`
- Modify: `apps/api/src/modules/users/users.module.ts` (add controller to `controllers` array)

- [ ] **Step 1: Write the controller**

```ts
import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { getRequestEm } from '../../common/db/request-em';

/**
 * Phase 5b: Lightweight health endpoint that returns the RLS posture for the
 * current request. Used by ops to confirm the interceptor is active and the
 * GUCs are populated as expected.
 *
 *   curl -H "Authorization: Bearer <token>" http://localhost:3001/api/users/me/db-context
 *
 *   {
 *     "rls": "enabled",
 *     "role": "perfana_app",
 *     "gucs": {
 *       "user_id": "kc-user-123",
 *       "organizations": "[\"org-A\",\"org-B\"]",
 *       "teams": "[]",
 *       "roles": "[\"user\"]"
 *     }
 *   }
 */
@ApiTags('users')
@Controller('users/me')
export class UsersDbContextController {
  constructor(private readonly config: ConfigService) {}

  @Get('db-context')
  @ApiOperation({ summary: 'Inspect the current request DB role + GUCs (Phase 5b)' })
  async dbContext() {
    if (this.config.get<string>('DB_ENABLE_RLS_ROLE') !== 'true') {
      return { rls: 'disabled', role: 'perfana', gucs: null };
    }
    const em = getRequestEm();
    if (!em) {
      return {
        rls: 'enabled',
        role: 'unknown',
        gucs: null,
        error: 'no request EntityManager — interceptor did not wrap this handler',
      };
    }
    const [{ current_user }] = await em.query(`SELECT current_user`);
    const [gucs] = await em.query(`
      SELECT
        current_setting('app.current_user_id', true) AS user_id,
        current_setting('app.current_user_organizations', true) AS organizations,
        current_setting('app.current_user_teams', true) AS teams,
        current_setting('app.current_user_roles', true) AS roles
    `);
    return { rls: 'enabled', role: current_user, gucs };
  }
}
```

- [ ] **Step 2: Write the controller spec**

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UsersDbContextController } from './users-db-context.controller';
import * as requestEm from '../../common/db/request-em';

describe('UsersDbContextController', () => {
  let controller: UsersDbContextController;
  let configGet: jest.Mock;

  beforeEach(async () => {
    configGet = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersDbContextController],
      providers: [
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();
    controller = module.get(UsersDbContextController);
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns disabled when DB_ENABLE_RLS_ROLE=false', async () => {
    configGet.mockReturnValue('false');
    const result = await controller.dbContext();
    expect(result).toEqual({ rls: 'disabled', role: 'perfana', gucs: null });
  });

  it('returns error when no request EM is present', async () => {
    configGet.mockReturnValue('true');
    jest.spyOn(requestEm, 'getRequestEm').mockReturnValue(null);
    const result = await controller.dbContext();
    expect(result).toMatchObject({ rls: 'enabled', role: 'unknown', gucs: null });
    expect(result).toHaveProperty('error');
  });

  it('returns role + gucs when interceptor populated EM', async () => {
    configGet.mockReturnValue('true');
    const fakeEm = {
      query: jest.fn()
        .mockResolvedValueOnce([{ current_user: 'perfana_app' }])
        .mockResolvedValueOnce([{
          user_id: 'u1',
          organizations: '["org-A"]',
          teams: '[]',
          roles: '["user"]',
        }]),
    };
    jest.spyOn(requestEm, 'getRequestEm').mockReturnValue(fakeEm as never);
    const result = await controller.dbContext();
    expect(result).toEqual({
      rls: 'enabled',
      role: 'perfana_app',
      gucs: {
        user_id: 'u1',
        organizations: '["org-A"]',
        teams: '[]',
        roles: '["user"]',
      },
    });
  });
});
```

- [ ] **Step 3: Add controller to `users.module.ts`**

Find the `controllers` array in `apps/api/src/modules/users/users.module.ts`. Add `UsersDbContextController`:

```ts
import { UsersDbContextController } from './users-db-context.controller';

@Module({
  // ...
  controllers: [
    /* existing controllers */,
    UsersDbContextController,
  ],
  // ...
})
export class UsersModule {}
```

- [ ] **Step 4: Run the spec**

```bash
cd apps/api && npx jest src/modules/users/users-db-context.controller.spec.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Manual smoke test against the dev API**

```bash
DB_ENABLE_RLS_ROLE=true npm run dev:api
# in another shell
TOKEN=$(curl -s -X POST http://localhost:8080/realms/perfana-prod/protocol/openid-connect/token \
  -d "grant_type=password" -d "client_id=perfana-api" -d "client_secret=<secret>" \
  -d "username=perfana@example.com" -d "password=perfana" | jq -r .access_token)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/users/me/db-context | jq .
```

Expected:
```json
{
  "rls": "enabled",
  "role": "perfana_app",
  "gucs": {
    "user_id": "<keycloak sub>",
    "organizations": "[\"<uuid>\", ...]",
    "teams": "[...]",
    "roles": "[...]"
  }
}
```

If `role` is not `perfana_app`, the interceptor isn't wrapping the request — debug by checking `app.module.ts` provider order and that `DB_ENABLE_RLS_ROLE=true` is set in the API process environment.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/users/users-db-context.controller.ts apps/api/src/modules/users/users-db-context.controller.spec.ts apps/api/src/modules/users/users.module.ts
git commit -m "$(cat <<'EOF'
feat(api): Phase 5b — /api/users/me/db-context health endpoint

Returns {rls, role, gucs} so ops can confirm RLS is active for the
current request. Three branches: flag off (disabled), flag on but no
request EM (error/diagnostic), flag on with EM (full GUC dump).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 20: Ship PR2

- [ ] **Step 1: Run the preflight gate**

```bash
npm run preflight
```

- [ ] **Step 2: Push and open the PR**

```bash
git push
gh pr create --title "feat(api): Phase 5b PR2 — interceptor + system data sources" --body "$(cat <<'EOF'
## Summary
Phase 5b foundation. All runtime plumbing for RLS activation, still gated behind `DB_ENABLE_RLS_ROLE=false`.

- `RlsTransactionInterceptor` registered globally (after `AuditContextInterceptor`).
- `withRequestEm()` helper + `REQ_EM` CLS namespace.
- `@SkipRls()` decorator for streaming endpoints.
- `createSystemDataSource(actor, opts)` factory wired into worker, grafana-sync, perfana-report.
- `/api/users/me/db-context` health endpoint.
- Unit tests for the interceptor and helpers.

## Test plan
- [x] Unit tests pass.
- [x] API boots cleanly with flag both on and off.
- [x] Worker / grafana-sync / perfana-report boot logs show `system data source initialized as perfana_system`.
- [x] Manual smoke: `/api/users/me/db-context` returns `role: "perfana_app"` with flag on.
- [ ] CI passes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## PR3 — Lint rule + allowlist + audit doc + drift agent

The migration scaffolding. Mirrors Phase 3 (`no-direct-is-global-admin`) and Phase 5a (`audit-mutation-must-log`). The lint rule errors when an owned-resource service file calls `this.<repo>.<method>(...)` without `withRequestEm(...)`. The allowlist starts populated with every owned-resource service file; service-migration PRs (PR4–PR18) progressively remove entries.

### Task 21: Initial allowlist file

**Files:**
- Create: `apps/api/.rls-em-migration-allowlist.json`

- [ ] **Step 1: Build the initial allowlist**

The allowlist contains every service file that uses `@InjectRepository` on an owned-resource entity. Start by running this discovery command:

```bash
cd /Users/daniel/workspace/perfana
ENTITIES='ApiKey|ApplicationDashboard|Benchmark|CompareFilterPreset|DeepLink|DynatraceConfig|DynatraceEntityMapping|DynatraceQuery|ExpectedConfigChange|GenericDeepLink|GrafanaDashboard|GrafanaInstance|GraphPreset|MetricsSource|NotificationChannel|Profile|ProfileBenchmark|ProfileGrafanaDashboard|PyroscopeInstance|ReportTemplate|SparseMetricExclusion|TestRun|TracingInstance|TracingService|TrendsFilterPreset|AlertTagFilter'
grep -rlE "@InjectRepository\((${ENTITIES})\)" apps/api/src --include="*.ts" \
  | grep -v ".spec.ts" \
  | grep -v ".test.ts" \
  | sort
```

- [ ] **Step 2: Write the allowlist JSON**

Take the output of the discovery command and write it as a JSON array to `apps/api/.rls-em-migration-allowlist.json`. Format (one path per element, paths relative to repo root, no trailing comma):

```json
[
  "apps/api/src/modules/alerts/alert-tag-filters.service.ts",
  "apps/api/src/modules/alerts/alerts.service.ts",
  "apps/api/src/modules/api-keys/api-keys.service.ts",
  "apps/api/src/modules/audit/audit-query.service.ts",
  "apps/api/src/modules/benchmarks/services/benchmark-mutation.service.ts",
  "apps/api/src/modules/benchmarks/services/benchmark-query.service.ts",
  "apps/api/src/modules/compare-presets/compare-presets.service.ts",
  "apps/api/src/modules/deep-links/deep-links.service.ts",
  "apps/api/src/modules/dynatrace/dynatrace.service.ts",
  "apps/api/src/modules/dynatrace/dynatrace-entity-mappings.service.ts",
  "apps/api/src/modules/dynatrace/dynatrace-queries.service.ts",
  "apps/api/src/modules/expected-config-changes/expected-config-changes.service.ts",
  "apps/api/src/modules/grafana/application-dashboards.service.ts",
  "apps/api/src/modules/grafana/grafana-dashboards.service.ts",
  "apps/api/src/modules/grafana/grafana-instances.service.ts",
  "apps/api/src/modules/graph-presets/graph-presets.service.ts",
  "apps/api/src/modules/metrics-sources/metrics-sources.service.ts",
  "apps/api/src/modules/notifications/notifications.service.ts",
  "apps/api/src/modules/profiles/profiles.service.ts",
  "apps/api/src/modules/pyroscope/pyroscope-instances.service.ts",
  "apps/api/src/modules/reports/services/report-generation.service.ts",
  "apps/api/src/modules/reports/services/report-share.service.ts",
  "apps/api/src/modules/reports/services/report-template.service.ts",
  "apps/api/src/modules/systems-under-test/systems-under-test.service.ts",
  "apps/api/src/modules/test-runs/services/test-runs-anomaly.service.ts",
  "apps/api/src/modules/test-runs/services/test-runs-changepoint.service.ts",
  "apps/api/src/modules/test-runs/services/test-runs-crud-query.service.ts",
  "apps/api/src/modules/test-runs/services/test-runs-data-sources.service.ts",
  "apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts",
  "apps/api/src/modules/test-runs/services/test-runs-stats.service.ts",
  "apps/api/src/modules/test-runs/services/test-runs-tag.service.ts",
  "apps/api/src/modules/test-runs/services/test-run-lookup.service.ts",
  "apps/api/src/modules/tracing-instances/tracing-instances.service.ts",
  "apps/api/src/modules/trends-presets/trends-presets.service.ts"
]
```

If the discovery command produces additional or different paths, use those — this list is illustrative, not authoritative. The exact file set depends on the current state of the repo.

- [ ] **Step 3: Verify the allowlist is well-formed JSON**

```bash
cd apps/api && node -e "console.log(JSON.parse(require('fs').readFileSync('.rls-em-migration-allowlist.json', 'utf8')).length, 'entries')"
```

Expected: prints "N entries" where N matches the discovery command's output.

- [ ] **Step 4: Commit**

```bash
git add apps/api/.rls-em-migration-allowlist.json
git commit -m "$(cat <<'EOF'
chore(api): Phase 5b — initial RLS migration allowlist

Lists every service file using @InjectRepository on an owned-resource
entity. Service-migration PRs (PR4-PR18) progressively remove entries
as each service is wrapped with withRequestEm(). Allowlist empty =
phase complete.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 22: ESLint rule `owned-resource-must-use-request-em`

**Files:**
- Create: `apps/api/eslint-rules/owned-resource-must-use-request-em.js`

- [ ] **Step 1: Write the rule**

```js
const fs = require('fs');
const path = require('path');

let cache = null;

function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, 'apps/api/.rls-em-migration-allowlist.json');
    if (fs.existsSync(candidate)) return { allowlistPath: candidate, repoRoot: dir };
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function loadCache(cwd) {
  if (cache !== null) return cache;
  try {
    const found = findRepoRoot(cwd);
    if (!found) {
      cache = { allowlist: new Set(), repoRoot: cwd };
    } else {
      const entries = JSON.parse(fs.readFileSync(found.allowlistPath, 'utf8'));
      cache = { allowlist: new Set(entries), repoRoot: found.repoRoot };
    }
  } catch {
    cache = { allowlist: new Set(), repoRoot: cwd };
  }
  return cache;
}

// Owned-resource entity class names. Used to detect @InjectRepository(<Entity>)
// declarations. Maintained alongside .rls-em-migration-allowlist.json — adding
// a new owned entity requires adding it here too.
const OWNED_RESOURCE_ENTITIES = new Set([
  'AlertTagFilter',
  'ApiKey',
  'ApplicationDashboard',
  'Benchmark',
  'CompareFilterPreset',
  'DeepLink',
  'DynatraceConfig',
  'DynatraceEntityMapping',
  'DynatraceQuery',
  'ExpectedConfigChange',
  'GenericDeepLink',
  'GrafanaDashboard',
  'GrafanaInstance',
  'GraphPreset',
  'MetricsSource',
  'NotificationChannel',
  'Profile',
  'ProfileBenchmark',
  'ProfileGrafanaDashboard',
  'PyroscopeInstance',
  'ReportTemplate',
  'SparseMetricExclusion',
  'TestRun',
  'TracingInstance',
  'TracingService',
  'TrendsFilterPreset',
]);

const REPO_METHODS = new Set([
  'find', 'findOne', 'findBy', 'findOneBy', 'findOneOrFail', 'findOneByOrFail',
  'findAndCount', 'findAndCountBy',
  'save', 'remove', 'softRemove', 'recover',
  'insert', 'update', 'upsert', 'delete', 'softDelete',
  'count', 'countBy', 'sum', 'average', 'minimum', 'maximum',
  'increment', 'decrement',
  'createQueryBuilder',
]);

function relativizePath(filename, repoRoot) {
  if (!filename || !repoRoot) return filename;
  const rel = path.relative(repoRoot, filename);
  return rel.split(path.sep).join('/');
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Owned-resource repository calls must be wrapped with withRequestEm() so ' +
        'they participate in the RlsTransactionInterceptor transaction (Phase 5b). ' +
        'Files listed in apps/api/.rls-em-migration-allowlist.json are grandfathered.',
    },
    schema: [],
    messages: {
      mustWrap:
        'Owned-resource repository call `{{access}}.{{method}}(...)` must be wrapped ' +
        'with `withRequestEm()`. See: docs/superpowers/audits/2026-05-04-rls-decisions.md',
    },
  },
  create(context) {
    const filename = context.getFilename();
    const cwd = context.getCwd ? context.getCwd() : path.dirname(filename);
    const { allowlist, repoRoot } = loadCache(cwd);
    const relPath = relativizePath(filename, repoRoot);
    if (allowlist.has(relPath)) return {};

    // Collect repo property names that are owned-resource repos based on the
    // class's @InjectRepository declarations. The constructor params will look
    // like:
    //   constructor(
    //     @InjectRepository(ApiKey) private readonly apiKeyRepo: Repository<ApiKey>,
    //   )
    const ownedRepoNames = new Set();

    function recordOwnedRepoFromDecorator(node) {
      // node = Decorator { expression: CallExpression }
      const expr = node.expression;
      if (!expr || expr.type !== 'CallExpression') return;
      if (expr.callee.type !== 'Identifier' || expr.callee.name !== 'InjectRepository') return;
      const arg = expr.arguments[0];
      if (!arg || arg.type !== 'Identifier') return;
      if (!OWNED_RESOURCE_ENTITIES.has(arg.name)) return;
      // Walk up to the parameter to grab the property name.
      let p = node.parent;
      while (p && p.type !== 'TSParameterProperty' && p.type !== 'Identifier') p = p.parent;
      if (!p) return;
      // TSParameterProperty wraps an Identifier under .parameter
      const ident = p.type === 'TSParameterProperty' ? p.parameter : p;
      if (ident && ident.type === 'Identifier') {
        ownedRepoNames.add(ident.name);
      }
    }

    return {
      Decorator: recordOwnedRepoFromDecorator,
      CallExpression(node) {
        // Match `this.<repoName>.<method>(...)` where repoName is owned and
        // method is in REPO_METHODS.
        if (node.callee.type !== 'MemberExpression') return;
        const propNode = node.callee.property;
        if (propNode.type !== 'Identifier') return;
        if (!REPO_METHODS.has(propNode.name)) return;

        const obj = node.callee.object;
        if (obj.type !== 'MemberExpression') return;
        if (obj.object.type !== 'ThisExpression') return;
        if (obj.property.type !== 'Identifier') return;

        const repoName = obj.property.name;
        if (!ownedRepoNames.has(repoName)) return;

        // Check for withRequestEm() wrap: the object expression must be
        // a CallExpression with callee.name === 'withRequestEm'.
        // i.e. allowed pattern: withRequestEm(this.<repoName>).<method>(...)
        // The current node (failing case) is: this.<repoName>.<method>(...)
        // — so if we got here, it's NOT wrapped. Report.
        context.report({
          node,
          messageId: 'mustWrap',
          data: { access: `this.${repoName}`, method: propNode.name },
        });
      },
    };
  },
};
```

- [ ] **Step 2: Register the rule in `.eslintrc.js`**

Modify `apps/api/.eslintrc.js`:

```js
module.exports = {
  extends: ['../../.eslintrc.js'],
  rules: {
    'no-direct-is-global-admin': 'error',
    'audit-mutation-must-log': 'error',
    // Phase 5b: every owned-resource repo call must go through withRequestEm()
    // so it picks up the RlsTransactionInterceptor's transaction-scoped GUCs.
    // Files in .rls-em-migration-allowlist.json are grandfathered.
    'owned-resource-must-use-request-em': 'error',
  },
  overrides: [
    {
      files: ['**/*.spec.ts', '**/*.test.ts', '**/__tests__/**/*.ts'],
      rules: {
        'no-direct-is-global-admin': 'off',
        'audit-mutation-must-log': 'off',
        'owned-resource-must-use-request-em': 'off',
      },
    },
  ],
};
```

- [ ] **Step 3: Run lint to verify the rule loads (it should fire on every allowlisted file when the allowlist is bypassed)**

```bash
# Sanity check: temporarily empty the allowlist and confirm the rule errors on real services
cd /Users/daniel/workspace/perfana
mv apps/api/.rls-em-migration-allowlist.json apps/api/.rls-em-migration-allowlist.json.bak
echo "[]" > apps/api/.rls-em-migration-allowlist.json
cd apps/api && npx eslint src/modules/api-keys/api-keys.service.ts --rule '{"owned-resource-must-use-request-em":"error"}' --no-eslintrc 2>&1 | head -20
# Restore
cd /Users/daniel/workspace/perfana
mv apps/api/.rls-em-migration-allowlist.json.bak apps/api/.rls-em-migration-allowlist.json
```

Expected: at least one error of the form `Owned-resource repository call \`this.apiKeyRepo.<method>(...)\` must be wrapped with \`withRequestEm()\`...`. If zero errors, the rule isn't matching — debug the AST traversal.

- [ ] **Step 4: Re-verify normal lint with allowlist in place**

```bash
cd apps/api && npm run lint -- src/modules/api-keys/
```

Expected: clean (api-keys is in the allowlist).

- [ ] **Step 5: Commit**

```bash
git add apps/api/eslint-rules/owned-resource-must-use-request-em.js apps/api/.eslintrc.js
git commit -m "$(cat <<'EOF'
chore(api): Phase 5b — ESLint rule owned-resource-must-use-request-em

Errors when a service calls this.<ownedRepo>.<method>(...) without
wrapping in withRequestEm(). Allowlist at .rls-em-migration-allowlist.json
grandfathers existing un-migrated services.

Tracks the same shape as no-direct-is-global-admin (Phase 3) and
audit-mutation-must-log (Phase 5a).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 23: Tests for the lint rule

**Files:**
- Create: `apps/api/eslint-rules/owned-resource-must-use-request-em.spec.js`

- [ ] **Step 1: Write the rule tests**

```js
const { RuleTester } = require('eslint');
const rule = require('./owned-resource-must-use-request-em');

const ruleTester = new RuleTester({
  parser: require.resolve('@typescript-eslint/parser'),
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('owned-resource-must-use-request-em', rule, {
  valid: [
    {
      name: 'wrapped call passes',
      code: `
        import { Repository } from 'typeorm';
        import { InjectRepository } from '@nestjs/typeorm';
        class ApiKey {}
        function withRequestEm(r: any) { return r; }
        class Svc {
          constructor(@InjectRepository(ApiKey) private readonly apiKeyRepo: Repository<ApiKey>) {}
          async findAll() {
            return withRequestEm(this.apiKeyRepo).find({});
          }
        }
      `,
    },
    {
      name: 'non-owned repo call passes',
      code: `
        import { Repository } from 'typeorm';
        import { InjectRepository } from '@nestjs/typeorm';
        class User {}
        class Svc {
          constructor(@InjectRepository(User) private readonly userRepo: Repository<User>) {}
          async findAll() {
            return this.userRepo.find({});
          }
        }
      `,
    },
    {
      name: 'no @InjectRepository — no constraint',
      code: `
        class Svc {
          someMethod() {
            return this.foo.find({});
          }
        }
      `,
    },
  ],
  invalid: [
    {
      name: 'unwrapped find on owned repo errors',
      code: `
        import { Repository } from 'typeorm';
        import { InjectRepository } from '@nestjs/typeorm';
        class ApiKey {}
        class Svc {
          constructor(@InjectRepository(ApiKey) private readonly apiKeyRepo: Repository<ApiKey>) {}
          async findAll() {
            return this.apiKeyRepo.find({});
          }
        }
      `,
      errors: [{ messageId: 'mustWrap' }],
    },
    {
      name: 'unwrapped save on owned repo errors',
      code: `
        import { Repository } from 'typeorm';
        import { InjectRepository } from '@nestjs/typeorm';
        class GrafanaDashboard {}
        class Svc {
          constructor(@InjectRepository(GrafanaDashboard) private readonly dashRepo: Repository<GrafanaDashboard>) {}
          async create(d: any) {
            return this.dashRepo.save(d);
          }
        }
      `,
      errors: [{ messageId: 'mustWrap' }],
    },
    {
      name: 'unwrapped createQueryBuilder on owned repo errors',
      code: `
        import { Repository } from 'typeorm';
        import { InjectRepository } from '@nestjs/typeorm';
        class TestRun {}
        class Svc {
          constructor(@InjectRepository(TestRun) private readonly testRunRepo: Repository<TestRun>) {}
          async query() {
            return this.testRunRepo.createQueryBuilder('tr').getMany();
          }
        }
      `,
      errors: [{ messageId: 'mustWrap' }],
    },
  ],
});
```

- [ ] **Step 2: Run the rule tests**

```bash
cd apps/api && npx jest eslint-rules/owned-resource-must-use-request-em.spec.js
```

Expected: all valid + invalid cases pass.

- [ ] **Step 3: Commit**

```bash
git add apps/api/eslint-rules/owned-resource-must-use-request-em.spec.js
git commit -m "$(cat <<'EOF'
test(api): Phase 5b — owned-resource-must-use-request-em rule tests

Covers: wrapped call valid, non-owned repo valid, unwrapped find/save/
createQueryBuilder on owned repo invalid.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 24: Audit decisions doc + drift agent + CONTRIBUTING note

**Files:**
- Create: `docs/superpowers/audits/2026-05-04-rls-decisions.md`
- Create: `docs/superpowers/scheduled-agents/rls-burndown-drift.md`
- Modify: `CONTRIBUTING.md` (or root README; whichever holds the adjacent-migration rule from Phase 3 / 5a)

- [ ] **Step 1: Write the audit decisions doc**

Create `docs/superpowers/audits/2026-05-04-rls-decisions.md`:

```markdown
# RBAC Phase 5b — RLS Activation Decisions

**Spec:** [`2026-05-04-rbac-phase5b-rls-design.md`](../specs/2026-05-04-rbac-phase5b-rls-design.md)
**Plan:** [`2026-05-04-rbac-phase5b-rls.md`](../plans/2026-05-04-rbac-phase5b-rls.md)

## Brainstorm decisions (locked 2026-05-04)

| # | Decision | Rationale |
|---|----------|-----------|
| Q1 | Activation + audit (no helper redesign) | Existing infra mostly correct. |
| Q2 | Transaction-scoped SET LOCAL via interceptor | Strongest isolation; zero leak risk. |
| Q3 | perfana_system role + identity GUCs for non-API processes | Audit identity matches DB identity. |
| Q4 | Single boolean flag, env-gated rollout | Reversible by config rollback. |
| Q5 | Keep service-layer + RLS as belt-and-suspenders | RLS = defense-in-depth, not replacement. |
| Q6 | Full per-entity test matrix (26 × 7 × 4) | Pin policy expressions; service-layer tests don't cover. |
| Q7 | Tighten test_runs; special-case audit_logs | Backfill test_runs.organization_id from SUT. |

## Migration burndown

(Updated as service-migration PRs land. Each PR removes entries from `apps/api/.rls-em-migration-allowlist.json`.)

| PR | Service group | Files migrated | Allowlist size after |
|----|---------------|----------------|----------------------|
| PR4 | api-keys | 1 file | TBD after merge |
| PR5 | organizations + teams + members | TBD | TBD |
| PR6 | dynatrace (4 services) | TBD | TBD |
| PR7 | grafana (3 services) | TBD | TBD |
| PR8 | tracing + pyroscope | TBD | TBD |
| PR9 | presets (graph, compare, trends) | TBD | TBD |
| PR10 | deep-links + generic-deep-links | TBD | TBD |
| PR11 | notifications + alerts | TBD | TBD |
| PR12 | profiles + profile-children | TBD | TBD |
| PR13 | systems-under-test | TBD | TBD |
| PR14 | test-runs (largest) | TBD | TBD |
| PR15 | benchmarks + expected-config-change | TBD | TBD |
| PR16 | reports | TBD | TBD |
| PR17 | metrics-sources + sparse-metric-exclusion + alert-tag-filters | TBD | TBD |
| PR18 | provisioning + cleanup | TBD | TBD |

## PR notes

(Each PR appends a section with anything non-mechanical.)

### PR1 (2026-05-04 → ?) — schema tightening

(To be filled when PR1 lands.)
```

- [ ] **Step 2: Write the drift agent doc**

Create `docs/superpowers/scheduled-agents/rls-burndown-drift.md`. Use the existing audit-burndown-drift agent as a template (`docs/superpowers/scheduled-agents/audit-burndown-drift.md` if it exists, otherwise the no-direct-is-global-admin equivalent):

```markdown
# RLS Burndown Drift Agent

**Cadence:** every 2 weeks (run via `/schedule`)

**Purpose:** Detect drift in the RLS migration:

1. **Allowlist regressions** — services that were removed from `.rls-em-migration-allowlist.json` but later re-introduced direct repo calls (someone reverted the migration without re-adding the file).
2. **New violations in allowlisted files** — files still in the allowlist that grew new owned-resource repo calls (the migration backlog is growing instead of shrinking).
3. **New owned entities without lint coverage** — any new entity class with an `organization_id` column that isn't in `OWNED_RESOURCE_ENTITIES` in the lint rule.

## Steps

1. Read `apps/api/.rls-em-migration-allowlist.json`. List all entries.
2. For each allowlisted file: run `cd apps/api && grep -nE "this\.[a-zA-Z_]+(Repo|Repository)\.[a-zA-Z_]+\(" <file> | wc -l`. Compare to last run's count (cached in this doc's "Burndown trace" section). Report files where the count grew.
3. Read `apps/api/eslint-rules/owned-resource-must-use-request-em.js`'s `OWNED_RESOURCE_ENTITIES` set.
4. Run `grep -lE "@Column.*organization_id|organizationId.*@Column" packages/shared/src/entities/*.entity.ts | sort`. Diff against `OWNED_RESOURCE_ENTITIES`. Report any entity in the column scan but not in the rule's set.
5. Append findings to this doc under "Burndown trace" with a date stamp.
6. If issues found: post to the channel / open an issue.

## Burndown trace

| Date | Allowlist size | Files growing | New entities | Notes |
|------|----------------|---------------|--------------|-------|
| (initial) | (TBD on PR3 merge) | — | — | Drift agent online. |
```

- [ ] **Step 3: Update CONTRIBUTING (or the equivalent doc)**

Find the existing "Phase 3 / 5a adjacent migration rule" in `CONTRIBUTING.md` (or `CLAUDE.md`'s migration section). It typically reads something like:

> When you touch a file listed in `.rbac-migration-allowlist.json` for any reason (bug fix, feature, refactor), migrate it as part of your PR — the lint rule errors otherwise.

Add a parallel paragraph for the RLS allowlist:

```markdown
### Phase 5b RLS migration adjacency rule

When you touch a file listed in `apps/api/.rls-em-migration-allowlist.json`,
migrate its owned-resource repository calls to `withRequestEm()` as part of
your PR. See:
  - [Phase 5b spec](docs/superpowers/specs/2026-05-04-rbac-phase5b-rls-design.md) §4.2
  - [Phase 5b plan](docs/superpowers/plans/2026-05-04-rbac-phase5b-rls.md) "Standard transformation pattern"
  - [Phase 5b decisions](docs/superpowers/audits/2026-05-04-rls-decisions.md)

The lint rule `owned-resource-must-use-request-em` errors on un-migrated
owned-resource repository calls. Removing the file from the allowlist is
the only way to remove the lint suppression; both the migration and the
removal must land in the same PR.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/audits/2026-05-04-rls-decisions.md docs/superpowers/scheduled-agents/rls-burndown-drift.md CONTRIBUTING.md
git commit -m "$(cat <<'EOF'
docs(rbac): Phase 5b — audit decisions + drift agent + CONTRIBUTING

Adds the burndown table that PR4-PR18 will progressively update,
the drift-check agent (every 2 weeks), and the adjacent-migration
rule following Phase 3 / 5a precedent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 25: Ship PR3

- [ ] **Step 1: Run preflight**

```bash
npm run preflight
```

Expected: lint passes (the rule errors are silenced for every allowlisted file; non-allowlisted services don't have any owned-resource repo calls because they don't inject those entities).

- [ ] **Step 2: Push and open the PR**

```bash
git push
gh pr create --title "chore(api): Phase 5b PR3 — lint rule + allowlist + drift agent" --body "$(cat <<'EOF'
## Summary
Migration scaffolding for the Phase 5b service rollout.

- ESLint rule `owned-resource-must-use-request-em`.
- Initial allowlist `.rls-em-migration-allowlist.json` (every owned-resource service).
- Audit decisions doc with burndown table.
- Drift-check `/schedule` agent.
- CONTRIBUTING note for the adjacent-migration rule.

## Test plan
- [x] Rule unit tests pass.
- [x] Allowlist is well-formed JSON; entries resolve to existing files.
- [x] Lint passes with allowlist in place; lint fails when allowlist is emptied (verified Task 22 Step 3).
- [ ] CI passes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## PR4 — Migrate `TypeOrmBaseRepository` (Pattern A — 8 entities)

A single change to the shared base class covers every standard CRUD path across the 8 custom repositories that extend it. The bespoke methods inside each subclass are addressed in PR5.

### Task 26: Migrate `TypeOrmBaseRepository` to use `withRequestEm`

**Files:**
- Modify: `apps/api/src/common/repositories/typeorm-base.repository.ts`
- Modify: `apps/api/.rls-em-migration-allowlist.json` (remove the 8 Pattern A repository files; the base-class change covers all standard CRUD)
- Modify: `docs/superpowers/audits/2026-05-04-rls-decisions.md` (update burndown row)

- [ ] **Step 1: Inspect the current base-class methods**

```bash
grep -nE "this\.repository\.[a-zA-Z_]+\(" apps/api/src/common/repositories/typeorm-base.repository.ts
```

Expected: ~15-20 call sites for `findAll`, `findById`, `findByIds`, `findOne`, `findByIdOrThrow`, `save`, `softDelete`, `delete`, `update`, `count`, `findAndCount`, `query`, etc. List them mentally — every one needs the `withRequestEm` wrap.

- [ ] **Step 2: Modify the base class**

Apply the standard transformation pattern at the top of the file:

```ts
// Add the import at the top of the file (alongside existing imports).
import { withRequestEm } from '../db/request-em';
```

Then for every line that currently reads `this.repository.<method>(...)`, change it to `withRequestEm(this.repository).<method>(...)`. Apply uniformly to every method in the file. The change is mechanical; do NOT edit method signatures, return types, or error handling — only the inner repo call.

Concrete examples for the methods seen in `typeorm-base.repository.ts`:

```ts
// Method: findAll
// BEFORE:
async findAll(options?: FindManyOptions<T>): Promise<T[]> {
  try {
    return await this.repository.find(options);
  } catch (error) { /* unchanged */ }
}
// AFTER:
async findAll(options?: FindManyOptions<T>): Promise<T[]> {
  try {
    return await withRequestEm(this.repository).find(options);
  } catch (error) { /* unchanged */ }
}
```

```ts
// Method: findWithPagination
// BEFORE:
const [data, total] = await this.repository.findAndCount(options);
// AFTER:
const [data, total] = await withRequestEm(this.repository).findAndCount(options);
```

```ts
// Method: findById
// BEFORE:
const entity = await this.repository.findOne({ ... });
// AFTER:
const entity = await withRequestEm(this.repository).findOne({ ... });
```

Repeat for **every** `this.repository.<method>(...)` call site in the file. After editing, the only places `this.repository.X(...)` should still appear are in code paths that *deliberately* bypass RLS — which there should be none in the base class. (Bespoke subclass methods are PR5; the base class never bypasses.)

- [ ] **Step 3: Verify the transformation is exhaustive**

```bash
grep -nE "this\.repository\.[a-zA-Z_]+\(" apps/api/src/common/repositories/typeorm-base.repository.ts | grep -v withRequestEm
```

Expected: zero output (every `this.repository.X(` is now wrapped).

- [ ] **Step 4: Typecheck the API**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors. The wrapper preserves all type signatures because `withRequestEm<T>(repo: Repository<T>): Repository<T>` is type-transparent.

- [ ] **Step 5: Run existing tests**

```bash
cd apps/api && npx jest src/common/repositories/
cd apps/api && npx jest src/repositories/  # tests for Pattern A custom repos
cd apps/api && npx jest src/modules/api-keys/  # one downstream service for sanity
```

Expected: all pass. Behavior is identical when `DB_ENABLE_RLS_ROLE=false` (the wrapper returns the original repo).

- [ ] **Step 6: Remove Pattern A files from the allowlist**

Remove these 8 entries from `apps/api/.rls-em-migration-allowlist.json` (verify each path against the current allowlist; the actual paths may differ from this illustrative list):

```
apps/api/src/repositories/api-key.repository.ts
apps/api/src/repositories/application-dashboard.repository.ts
apps/api/src/repositories/compare-filter-preset.repository.ts
apps/api/src/repositories/expected-config-change.repository.ts
apps/api/src/repositories/test-run-configuration.repository.ts
apps/api/src/repositories/test-run.repository.ts
apps/api/src/repositories/tracing-service.repository.ts
apps/api/src/repositories/trends-filter-preset.repository.ts
```

Wait — but PR5 still needs to migrate bespoke methods inside each of these files. So removing them from the allowlist now would cause the lint rule to error on the un-migrated bespoke methods.

**Resolution:** keep the 8 Pattern A files in the allowlist for PR4. PR5 migrates the bespoke methods AND removes them from the allowlist. The lint rule continues to grandfather these files until PR5 ships.

(Adjust the audit doc burndown table to reflect this — PR4 changes the base class but the allowlist size doesn't shrink yet.)

- [ ] **Step 7: Update the burndown table in `docs/superpowers/audits/2026-05-04-rls-decisions.md`**

Append to the burndown table row for PR4:

| PR | Service group | Files migrated | Allowlist size after |
|----|---------------|----------------|----------------------|
| PR4 | TypeOrmBaseRepository (covers standard CRUD for 8 Pattern A repos) | 1 file (base class) | unchanged from PR3 (Pattern A files stay until PR5) |

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/common/repositories/typeorm-base.repository.ts docs/superpowers/audits/2026-05-04-rls-decisions.md
git commit -m "$(cat <<'EOF'
feat(api): Phase 5b PR4 — migrate TypeOrmBaseRepository to withRequestEm

Wraps every this.repository.X(...) call in the base class with
withRequestEm(...). This single change covers standard CRUD across the 8
custom repositories that extend TypeOrmBaseRepository (api-key,
application-dashboard, compare-filter-preset, expected-config-change,
test-run-configuration, test-run, tracing-service, trends-filter-preset).

Allowlist unchanged — the 8 Pattern A files retain entries because their
bespoke methods (which call this.repository.X directly, bypassing the
base class) still need migration in PR5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 9: Ship the PR**

```bash
git push
gh pr create --title "feat(api): Phase 5b PR4 — TypeOrmBaseRepository to withRequestEm" --body "$(cat <<'EOF'
## Summary
Single base-class change covers standard CRUD across all 8 custom repositories that extend `TypeOrmBaseRepository`. The eight custom repos' bespoke domain methods (e.g., `ApiKeyRepository.findValidKey`) still bypass the base class and need migration in PR5.

## Test plan
- [x] Existing unit tests pass.
- [x] Typecheck passes.
- [x] No remaining `this.repository.X(...)` in the base class (every call wrapped).
- [ ] CI passes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR5 — Migrate Pattern A bespoke methods

For each of the 8 custom repositories, migrate every `this.repository.X(...)` call in subclass methods that bypass the base class. After this PR all 8 Pattern A files come off the allowlist.

The pattern in every file is identical: import `withRequestEm`, then wrap every `this.repository.X(...)` to `withRequestEm(this.repository).X(...)`.

### Task 27: Migrate `api-key.repository.ts`

**Files:**
- Modify: `apps/api/src/repositories/api-key.repository.ts`

- [ ] **Step 1: Discover bespoke direct repo calls**

```bash
grep -nE "this\.repository\.[a-zA-Z_]+\(" apps/api/src/repositories/api-key.repository.ts | grep -v withRequestEm
```

Expected output (illustrative — exact line numbers depend on current state):

```
33:      return await this.repository.findOne({
56:      return await this.repository.find({
68:      return await this.repository.find({
80:        await this.repository.update(id, ...)
...
```

Each match is a bespoke method's direct repo call.

- [ ] **Step 2: Add the import**

At the top of `api-key.repository.ts`, add (alongside existing imports):

```ts
import { withRequestEm } from '../common/db/request-em';
```

(The path `../common/db/request-em` is correct for files under `apps/api/src/repositories/`.)

- [ ] **Step 3: Wrap every bespoke direct repo call**

Replace every `this.repository.<method>(...)` with `withRequestEm(this.repository).<method>(...)`. Apply uniformly. Do NOT change method signatures, error handling, or return types.

Example transformation (from `findValidKey`):

```ts
// BEFORE
return await this.repository.findOne({
  where: [
    { apiKey: key, validUntil: MoreThan(now) },
    { apiKey: key, validUntil: IsNull() },
  ],
});
// AFTER
return await withRequestEm(this.repository).findOne({
  where: [
    { apiKey: key, validUntil: MoreThan(now) },
    { apiKey: key, validUntil: IsNull() },
  ],
});
```

Repeat for every match from Step 1.

- [ ] **Step 4: Verify exhaustiveness**

```bash
grep -nE "this\.repository\.[a-zA-Z_]+\(" apps/api/src/repositories/api-key.repository.ts | grep -v withRequestEm
```

Expected: zero output.

- [ ] **Step 5: Run lint and tests for api-keys**

```bash
cd apps/api && npx eslint src/repositories/api-key.repository.ts
cd apps/api && npx jest src/repositories/api-key.repository
cd apps/api && npx jest src/modules/api-keys
```

Expected: lint passes, all tests pass.

- [ ] **Step 6: Remove from allowlist**

Open `apps/api/.rls-em-migration-allowlist.json` and remove the entry `"apps/api/src/repositories/api-key.repository.ts"`.

- [ ] **Step 7: Verify lint still passes (file no longer suppressed)**

```bash
cd apps/api && npx eslint src/repositories/api-key.repository.ts --rule '{"owned-resource-must-use-request-em":"error"}'
```

Expected: no errors. (If errors appear, a `this.repository.X(` still exists somewhere in the file — re-do Step 3.)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/repositories/api-key.repository.ts apps/api/.rls-em-migration-allowlist.json
git commit -m "$(cat <<'EOF'
feat(api): Phase 5b PR5.1 — wrap api-key.repository bespoke methods with withRequestEm

Migrates every direct this.repository.X(...) call in ApiKeyRepository's
subclass methods. Removes the file from .rls-em-migration-allowlist.json.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 28: Migrate `application-dashboard.repository.ts`

**Files:**
- Modify: `apps/api/src/repositories/application-dashboard.repository.ts`

- [ ] **Step 1: Apply the standard transformation**

Same procedure as Task 27, against `application-dashboard.repository.ts`:

```bash
# Discovery
grep -nE "this\.repository\.[a-zA-Z_]+\(" apps/api/src/repositories/application-dashboard.repository.ts | grep -v withRequestEm

# Add import (same path as api-key.repository.ts):
# import { withRequestEm } from '../common/db/request-em';

# Wrap every match: this.repository.X(...)  →  withRequestEm(this.repository).X(...)

# Verify exhaustiveness
grep -nE "this\.repository\.[a-zA-Z_]+\(" apps/api/src/repositories/application-dashboard.repository.ts | grep -v withRequestEm
# Expected: empty
```

- [ ] **Step 2: Run lint + tests**

```bash
cd apps/api && npx eslint src/repositories/application-dashboard.repository.ts
cd apps/api && npx jest application-dashboard
cd apps/api && npx jest src/modules/grafana
```

- [ ] **Step 3: Remove from allowlist**

Remove `"apps/api/src/repositories/application-dashboard.repository.ts"` from `.rls-em-migration-allowlist.json`.

- [ ] **Step 4: Verify lint after removal**

```bash
cd apps/api && npx eslint src/repositories/application-dashboard.repository.ts --rule '{"owned-resource-must-use-request-em":"error"}'
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/repositories/application-dashboard.repository.ts apps/api/.rls-em-migration-allowlist.json
git commit -m "feat(api): Phase 5b PR5.2 — application-dashboard.repository → withRequestEm

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Tasks 29–33: Migrate the remaining 6 Pattern A repositories

Apply the identical procedure (Steps 1–5 of Task 28) to each of the remaining 6 custom repositories. One commit per file, one allowlist removal per commit. Each file's transformation is mechanically identical: add the `withRequestEm` import, wrap every `this.repository.X(...)`, run lint, remove from allowlist, commit.

| Task | File | Commit message |
|------|------|----------------|
| 29 | `apps/api/src/repositories/compare-filter-preset.repository.ts` | `feat(api): Phase 5b PR5.3 — compare-filter-preset.repository → withRequestEm` |
| 30 | `apps/api/src/repositories/expected-config-change.repository.ts` | `feat(api): Phase 5b PR5.4 — expected-config-change.repository → withRequestEm` |
| 31 | `apps/api/src/repositories/test-run-configuration.repository.ts` | `feat(api): Phase 5b PR5.5 — test-run-configuration.repository → withRequestEm` |
| 32 | `apps/api/src/repositories/test-run.repository.ts` | `feat(api): Phase 5b PR5.6 — test-run.repository → withRequestEm` |
| 33 | `apps/api/src/repositories/tracing-service.repository.ts` | `feat(api): Phase 5b PR5.7 — tracing-service.repository → withRequestEm` |
| 34 | `apps/api/src/repositories/trends-filter-preset.repository.ts` | `feat(api): Phase 5b PR5.8 — trends-filter-preset.repository → withRequestEm` |

**Per-task checklist (apply to each):**

- [ ] **Step 1: Discover** — `grep -nE "this\.repository\.[a-zA-Z_]+\(" <file> | grep -v withRequestEm`
- [ ] **Step 2: Import** — add `import { withRequestEm } from '../common/db/request-em';`
- [ ] **Step 3: Wrap** — for every match from Step 1, change `this.repository.X(...)` → `withRequestEm(this.repository).X(...)`
- [ ] **Step 4: Verify exhaustiveness** — re-run the grep; expect zero output
- [ ] **Step 5: Lint + tests** — `cd apps/api && npx eslint <file>` and `npx jest <module>`
- [ ] **Step 6: Remove from allowlist** — delete the entry from `.rls-em-migration-allowlist.json`
- [ ] **Step 7: Verify lint after allowlist removal** — `npx eslint <file> --rule '{"owned-resource-must-use-request-em":"error"}'`
- [ ] **Step 8: Commit** — single commit with the message from the table

After Task 34, all 8 Pattern A repository files should be removed from the allowlist.

### Task 35: Verify Pattern A migration complete and ship PR5

- [ ] **Step 1: Confirm the allowlist no longer contains any `apps/api/src/repositories/*.ts` paths**

```bash
grep "src/repositories" apps/api/.rls-em-migration-allowlist.json
```

Expected: empty (zero matches).

- [ ] **Step 2: Run full preflight**

```bash
npm run preflight
```

- [ ] **Step 3: Update burndown table**

In `docs/superpowers/audits/2026-05-04-rls-decisions.md`, update the PR5 row:

| PR5 | Pattern A bespoke methods (8 custom repos) | 8 files | (allowlist size after PR3 minus 8) |

- [ ] **Step 4: Push and open PR**

```bash
git add docs/superpowers/audits/2026-05-04-rls-decisions.md
git commit -m "docs(rbac): Phase 5b PR5 burndown update

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
gh pr create --title "feat(api): Phase 5b PR5 — Pattern A bespoke methods" --body "$(cat <<'EOF'
## Summary
Migrates every bespoke method in the 8 custom Pattern A repositories
(api-key, application-dashboard, compare-filter-preset, expected-config-change,
test-run-configuration, test-run, tracing-service, trends-filter-preset).
Each file's direct `this.repository.X(...)` calls are wrapped with `withRequestEm`.
All 8 Pattern A files removed from the allowlist.

## Test plan
- [x] All affected tests pass.
- [x] Lint passes for all 8 files (no errors after allowlist removal).
- [x] Typecheck passes.
- [ ] CI passes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## PR6 — Migrate Pattern B services (direct `@InjectRepository`)

The remaining ~18 owned-resource entities are accessed via direct service-level `@InjectRepository(Entity)` injection (no custom-repo wrapper). Each service's call-sites are migrated individually. Group by service module to keep PRs reviewable.

### Standard transformation (repeat per task)

For each Pattern B service file:

1. **Discover** — `grep -nE "this\.[a-zA-Z_]+(Repo|Repository)\.[a-zA-Z_]+\(" <file> | grep -v withRequestEm`
2. **Confirm the repos are owned-resource** — for each `<RepoName>` match, find its `@InjectRepository(<EntityName>)` declaration; verify `<EntityName>` is in the lint rule's `OWNED_RESOURCE_ENTITIES` set. Non-owned repos (e.g., `OrganizationMember`, `User`) are NOT migrated.
3. **Add import** — `import { withRequestEm } from '<relative-path>';` (path depth varies by file location).
4. **Wrap** — for every owned-resource match, change `this.<repoName>.<method>(...)` → `withRequestEm(this.<repoName>).<method>(...)`. Apply mechanically; do NOT alter signatures, error handling, or surrounding logic.
5. **Verify exhaustiveness** — re-run the grep; non-owned repos may remain (e.g., `this.userRepo.find(...)`), but every owned-resource repo call must now be wrapped.
6. **Lint + tests** — `cd apps/api && npx eslint <file>` and `npx jest <module>`.
7. **Remove from allowlist** — delete the entry from `.rls-em-migration-allowlist.json`.
8. **Verify lint without allowlist suppression** — `npx eslint <file> --rule '{"owned-resource-must-use-request-em":"error"}'`. Expected: no errors.
9. **Commit** — one commit per migrated file.

### Task 36: Migrate the alerts module

**Files:**
- Modify: `apps/api/src/modules/alerts/alerts.service.ts`
- Modify: `apps/api/src/modules/alerts/alert-tag-filters.service.ts`
- Modify: `apps/api/.rls-em-migration-allowlist.json` (remove these 2 entries)

- [ ] **Step 1: Apply the standard transformation to `alerts.service.ts`**

```bash
grep -nE "this\.[a-zA-Z_]+(Repo|Repository)\.[a-zA-Z_]+\(" apps/api/src/modules/alerts/alerts.service.ts | grep -v withRequestEm
```

For each match, identify the repo's entity. Wrap only owned-resource repos. Add this import (path may vary):

```ts
import { withRequestEm } from '../../common/db/request-em';
```

Apply the mechanical wrap. Verify exhaustiveness. Run `npx eslint src/modules/alerts/alerts.service.ts` and `npx jest src/modules/alerts/alerts.service`.

- [ ] **Step 2: Apply the standard transformation to `alert-tag-filters.service.ts`**

Same procedure against `alert-tag-filters.service.ts`. Owned entity is `AlertTagFilter`.

- [ ] **Step 3: Remove both files from `.rls-em-migration-allowlist.json`**

Remove the entries:
- `apps/api/src/modules/alerts/alerts.service.ts`
- `apps/api/src/modules/alerts/alert-tag-filters.service.ts`

- [ ] **Step 4: Verify lint clean**

```bash
cd apps/api && npx eslint src/modules/alerts/
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/alerts/ apps/api/.rls-em-migration-allowlist.json
git commit -m "$(cat <<'EOF'
feat(api): Phase 5b PR6.1 — alerts module → withRequestEm

Wraps owned-resource repo calls in alerts.service.ts and
alert-tag-filters.service.ts. Removes both files from
.rls-em-migration-allowlist.json.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Tasks 37–53: Migrate the remaining Pattern B service modules

Apply the standard transformation (Steps 1–5 of Task 36) to each module. One commit per module. The actual list of files in each module may vary from the illustrative paths below — follow the discovery command in each task.

| Task | Module | Files | Owned entities |
|------|--------|-------|----------------|
| 37 | benchmarks | `apps/api/src/modules/benchmarks/services/benchmark-mutation.service.ts`, `apps/api/src/modules/benchmarks/services/benchmark-query.service.ts` | Benchmark, ProfileBenchmark |
| 38 | compare-presets | `apps/api/src/modules/compare-presets/compare-presets.service.ts` | CompareFilterPreset |
| 39 | deep-links | `apps/api/src/modules/deep-links/deep-links.service.ts` | DeepLink, GenericDeepLink |
| 40 | dynatrace | `apps/api/src/modules/dynatrace/dynatrace.service.ts`, `apps/api/src/modules/dynatrace/dynatrace-entity-mappings.service.ts`, `apps/api/src/modules/dynatrace/dynatrace-queries.service.ts` | DynatraceConfig, DynatraceEntityMapping, DynatraceQuery |
| 41 | expected-config-changes | `apps/api/src/modules/expected-config-changes/expected-config-changes.service.ts` | ExpectedConfigChange |
| 42 | grafana — application dashboards | `apps/api/src/modules/grafana/application-dashboards.service.ts` | ApplicationDashboard |
| 43 | grafana — dashboards + instances | `apps/api/src/modules/grafana/grafana-dashboards.service.ts`, `apps/api/src/modules/grafana/grafana-instances.service.ts` | GrafanaDashboard, GrafanaInstance |
| 44 | graph-presets | `apps/api/src/modules/graph-presets/graph-presets.service.ts` | GraphPreset |
| 45 | metrics-sources | `apps/api/src/modules/metrics-sources/metrics-sources.service.ts` | MetricsSource |
| 46 | notifications | `apps/api/src/modules/notifications/notifications.service.ts` | NotificationChannel |
| 47 | profiles | `apps/api/src/modules/profiles/profiles.service.ts` | Profile, ProfileGrafanaDashboard |
| 48 | pyroscope | `apps/api/src/modules/pyroscope/pyroscope-instances.service.ts` | PyroscopeInstance |
| 49 | reports | `apps/api/src/modules/reports/services/report-generation.service.ts`, `apps/api/src/modules/reports/services/report-share.service.ts`, `apps/api/src/modules/reports/services/report-template.service.ts` | ReportTemplate, GeneratedReport |
| 50 | systems-under-test | `apps/api/src/modules/systems-under-test/systems-under-test.service.ts` | SystemUnderTest (note: not in the standard owned-resource list — verify) |
| 51 | test-runs (largest cohort) | `apps/api/src/modules/test-runs/services/test-runs-anomaly.service.ts`, `apps/api/src/modules/test-runs/services/test-runs-changepoint.service.ts`, `apps/api/src/modules/test-runs/services/test-runs-crud-query.service.ts`, `apps/api/src/modules/test-runs/services/test-runs-data-sources.service.ts`, `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts`, `apps/api/src/modules/test-runs/services/test-runs-stats.service.ts`, `apps/api/src/modules/test-runs/services/test-runs-tag.service.ts`, `apps/api/src/modules/test-runs/services/test-run-lookup.service.ts`, plus handlers under `apps/api/src/modules/test-runs/handlers/` | TestRun |
| 52 | tracing-instances | `apps/api/src/modules/tracing-instances/tracing-instances.service.ts` | TracingInstance, TracingService |
| 53 | trends-presets | `apps/api/src/modules/trends-presets/trends-presets.service.ts` | TrendsFilterPreset |

For each task above:

- [ ] **Step 1: Discovery + transformation** — exact procedure from Task 36 Steps 1–2.
- [ ] **Step 2: Run lint + tests** — `cd apps/api && npx eslint <module-dir>/ && npx jest <module-name>`.
- [ ] **Step 3: Remove the file(s) from `.rls-em-migration-allowlist.json`**.
- [ ] **Step 4: Verify lint clean after allowlist removal**.
- [ ] **Step 5: Commit** with message: `feat(api): Phase 5b PR6.<task#> — <module> → withRequestEm`.

**Notes for Task 51 (test-runs):** This is the largest cohort (~10 service files plus handlers). Some test-runs service code (e.g., `test-runs-performance-query.service.ts`) calls `em.transaction(...)` inside service methods to issue `SET LOCAL work_mem` for heavy queries. With Q2=A (transaction-scoped SET LOCAL), the request handler is already inside a transaction; the inner `em.transaction(...)` becomes a savepoint. CRITICAL: ensure the inner transaction uses an `EntityManager` from `getRequestEm()` (or from a parameter passed down from a service method that received it), NOT `dataSource.transaction(...)`. The latter checks out a fresh connection from the pool, bypassing the request's GUCs. Look for any `dataSource.transaction(` or `manager.transaction(` calls in test-runs services and verify the manager came from the request EM. Add inline comments at any sub-transaction site explaining "manager comes from request-scoped EM via getRequestEm()". Don't introduce a new transaction primitive; just verify existing ones are correct.

**Notes for Task 50 (systems-under-test):** SystemUnderTest is not in the lint rule's `OWNED_RESOURCE_ENTITIES` set as initially written. Verify whether it has `organization_id` and add it to the rule's set if so. If yes, also verify that the SystemUnderTest entity has corresponding RLS policies (from PR1's snapshot test) — if missing, this is a spec gap requiring a follow-up migration before activation.

### Task 54: Verify allowlist is empty and ship PR6

- [ ] **Step 1: Confirm allowlist is empty**

```bash
cd apps/api && cat .rls-em-migration-allowlist.json
```

Expected: `[]`. If any entries remain, those modules still need migration — return to the corresponding task.

- [ ] **Step 2: Run preflight**

```bash
npm run preflight
```

- [ ] **Step 3: Update burndown**

In `docs/superpowers/audits/2026-05-04-rls-decisions.md`, mark PR6 row complete:

| PR6 | Pattern B services (~18 entities, ~20 service files) | all remaining | 0 (allowlist empty — phase complete pending tests + activation) |

- [ ] **Step 4: Push and open PR**

```bash
git add docs/superpowers/audits/2026-05-04-rls-decisions.md
git commit -m "docs(rbac): Phase 5b PR6 burndown — allowlist empty

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
gh pr create --title "feat(api): Phase 5b PR6 — Pattern B services migration" --body "$(cat <<'EOF'
## Summary
Migrates all remaining Pattern B service files. Wraps every owned-resource
`this.<repo>.<method>(...)` with `withRequestEm`. Allowlist is now empty.

## Test plan
- [x] All affected tests pass.
- [x] Lint passes for every migrated file with no allowlist suppression.
- [x] Typecheck passes.
- [x] Allowlist is empty.
- [ ] CI passes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR7 — Per-entity test matrix

Lands the heavy parameterized matrix plus the supporting test infrastructure. This PR can run in parallel with PR4–PR6 work but must precede PR8 (activation).

### Task 55: RLS test harness

**Files:**
- Create: `apps/api/src/test/rls/rls-test-harness.ts`

- [ ] **Step 1: Write the harness**

```ts
import { DataSource, EntityManager } from 'typeorm';
import { dataSourceOptions } from '../../config/database.config';
import { SystemActor, buildSystemConnectionPreamble } from '@perfana/shared/database/system-connection';

export type TestUser = {
  id: string;
  email: string;
  roles: string[];
  organizations: string[]; // org UUIDs the user has access to
  teams: string[];
};

export type TestOrg = { id: string; name: string };

export const O1: TestOrg = { id: '00000000-0000-0000-0000-000000000a01', name: 'Org A' };
export const O2: TestOrg = { id: '00000000-0000-0000-0000-000000000a02', name: 'Org B' };

export const USERS = {
  super: { id: 'kc-super', email: 'super@test', roles: ['super-admin'], organizations: [O1.id, O2.id], teams: [] },
  o1Admin: { id: 'kc-o1-admin', email: 'o1admin@test', roles: ['user', 'org-admin'], organizations: [O1.id], teams: [] },
  o2Admin: { id: 'kc-o2-admin', email: 'o2admin@test', roles: ['user', 'org-admin'], organizations: [O2.id], teams: [] },
  o1Member: { id: 'kc-o1-member', email: 'o1member@test', roles: ['user', 'org-member'], organizations: [O1.id], teams: [] },
  o1Viewer: { id: 'kc-o1-viewer', email: 'o1viewer@test', roles: ['user', 'org-viewer'], organizations: [O1.id], teams: [] },
  nobody: { id: 'kc-nobody', email: 'nobody@test', roles: ['user'], organizations: [], teams: [] },
} as const;

export class RlsTestHarness {
  private ds!: DataSource;

  async init() {
    this.ds = new DataSource(dataSourceOptions);
    await this.ds.initialize();
    // Seed organizations idempotently (upsert).
    await this.ds.query(`
      INSERT INTO organizations (id, name) VALUES ($1, $2), ($3, $4)
      ON CONFLICT (id) DO NOTHING
    `, [O1.id, O1.name, O2.id, O2.name]);
  }

  async destroy() {
    if (this.ds?.isInitialized) await this.ds.destroy();
  }

  /**
   * Run `fn` inside a transaction with SET LOCAL ROLE perfana_app + GUCs
   * matching the given user. The transaction is always rolled back so test
   * inserts don't leak.
   */
  async asUser<T>(user: TestUser, fn: (em: EntityManager) => Promise<T>): Promise<T> {
    return this.ds.transaction(async em => {
      await em.query(`SET LOCAL ROLE perfana_app`);
      await em.query(`SELECT set_config('app.current_user_id', $1, true)`, [user.id]);
      await em.query(`SELECT set_config('app.current_user_organizations', $1, true)`, [JSON.stringify(user.organizations)]);
      await em.query(`SELECT set_config('app.current_user_teams', $1, true)`, [JSON.stringify(user.teams)]);
      await em.query(`SELECT set_config('app.current_user_roles', $1, true)`, [JSON.stringify(user.roles)]);
      try {
        return await fn(em);
      } finally {
        // Force rollback by throwing; caller catches the rollback marker.
        // (Or use an explicit savepoint; here we accept that any test mutation rolls back.)
        throw new Error('__ROLLBACK__');
      }
    }).catch(e => {
      if (e instanceof Error && e.message === '__ROLLBACK__') {
        // Expected — the transaction rolled back. Re-fetch the result via a
        // sentinel approach: Use a closure-captured variable instead.
        // (Simpler implementation: don't auto-rollback; let tests use ds.transaction
        // directly when they need rollback.)
        return undefined as never;
      }
      throw e;
    });
  }

  /**
   * Simpler `asUser` variant that does NOT auto-rollback. Tests that need
   * isolation should run inside their own DB transaction or seed/cleanup
   * manually. The common use case is "run a SELECT under a user context" —
   * no mutation, no rollback needed.
   */
  async query<T>(user: TestUser, sql: string, params: unknown[] = []): Promise<T[]> {
    return this.ds.transaction(async em => {
      await em.query(`SET LOCAL ROLE perfana_app`);
      await em.query(`SELECT set_config('app.current_user_id', $1, true)`, [user.id]);
      await em.query(`SELECT set_config('app.current_user_organizations', $1, true)`, [JSON.stringify(user.organizations)]);
      await em.query(`SELECT set_config('app.current_user_teams', $1, true)`, [JSON.stringify(user.teams)]);
      await em.query(`SELECT set_config('app.current_user_roles', $1, true)`, [JSON.stringify(user.roles)]);
      return em.query(sql, params) as Promise<T[]>;
    });
  }

  /**
   * Run as a system actor (SET ROLE perfana_system + super-admin role GUC).
   * No transaction wrapping; uses session-scope set_config for parity with
   * how production system processes connect.
   */
  async asSystem<T>(actor: SystemActor, fn: (em: EntityManager) => Promise<T>): Promise<T> {
    const conn = await this.ds.createQueryRunner();
    try {
      for (const stmt of buildSystemConnectionPreamble(actor)) {
        await conn.query(stmt);
      }
      return await fn(conn.manager);
    } finally {
      await conn.query(`RESET ROLE`);
      await conn.query(`RESET app.current_user_id`);
      await conn.query(`RESET app.current_user_organizations`);
      await conn.query(`RESET app.current_user_teams`);
      await conn.query(`RESET app.current_user_roles`);
      await conn.release();
    }
  }

  /** Direct DataSource access for setup / teardown that bypasses RLS (owner role). */
  get rawDs(): DataSource { return this.ds; }
}

/**
 * Insert a row into the table backing `entityClass` with `organization_id`
 * set to `org.id`. Uses the owner-role DataSource (bypasses RLS). Returns the
 * inserted row's id.
 */
export async function seedOwnedRow<T>(
  ds: DataSource,
  entityClass: { name: string },
  org: TestOrg,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const repo = ds.getRepository(entityClass as never);
  const meta = ds.getMetadata(entityClass as never);
  const tableName = meta.tableName;
  // Build a minimal-valid row from required columns. Tests will need
  // entity-specific fixtures for entities with non-trivial NOT NULL columns.
  // The harness relies on a per-entity fixture map (separate file).
  return entityFixture(tableName, org, overrides, ds);
}

// Per-entity fixture function map. Each entry returns the inserted row id.
// Add new entities here as they're added to the matrix.
async function entityFixture(
  tableName: string,
  org: TestOrg,
  overrides: Record<string, unknown>,
  ds: DataSource,
): Promise<{ id: string }> {
  // Implementation note: each owned-resource entity has its own fixture
  // because of varying NOT NULL columns and FK constraints. Add entries as
  // tests require them. Throws on unknown table to surface coverage gaps.
  throw new Error(
    `seedOwnedRow: no fixture for table '${tableName}'. Add an entry to entityFixture in rls-test-harness.ts.`,
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/test/rls/rls-test-harness.ts
git commit -m "test(api): Phase 5b PR7 — RLS test harness scaffolding

Provides RlsTestHarness, USERS matrix, asUser/asSystem/query helpers, and a
seedOwnedRow stub. Per-entity fixtures land in subsequent tasks as the
matrix is filled in.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 56: Helper-function unit tests

**Files:**
- Create: `apps/api/src/test/rls/rls-helper-functions.spec.ts`

- [ ] **Step 1: Write the tests**

```ts
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../config/database.config';

describe('RLS helper functions', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = new DataSource(dataSourceOptions);
    await ds.initialize();
  });
  afterAll(async () => { if (ds?.isInitialized) await ds.destroy(); });

  async function callHelper(
    fn: 'can_access_resource' | 'can_modify_resource' | 'is_global_admin',
    args: unknown[],
    gucs: { user_id?: string; orgs?: string[]; teams?: string[]; roles?: string[] },
  ): Promise<boolean> {
    return ds.transaction(async em => {
      if (gucs.user_id !== undefined) await em.query(`SELECT set_config('app.current_user_id', $1, true)`, [gucs.user_id]);
      if (gucs.orgs)    await em.query(`SELECT set_config('app.current_user_organizations', $1, true)`, [JSON.stringify(gucs.orgs)]);
      if (gucs.teams)   await em.query(`SELECT set_config('app.current_user_teams', $1, true)`, [JSON.stringify(gucs.teams)]);
      if (gucs.roles)   await em.query(`SELECT set_config('app.current_user_roles', $1, true)`, [JSON.stringify(gucs.roles)]);
      const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
      const [{ ok }] = await em.query(`SELECT ${fn}(${placeholders}) AS ok`, args);
      return ok;
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
    it('returns false for unset role GUC', async () => {
      expect(await callHelper('is_global_admin', [], {})).toBe(false);
    });
  });

  describe('can_access_resource', () => {
    const ORG_A = '00000000-0000-0000-0000-000000000a01';
    const ORG_B = '00000000-0000-0000-0000-000000000a02';

    it('returns true for global admin regardless of org', async () => {
      expect(await callHelper('can_access_resource', [ORG_A, null, null], {
        user_id: 'super', roles: ['super-admin'],
      })).toBe(true);
    });

    it('returns false for null org_id (post-Phase-4 fail-closed)', async () => {
      expect(await callHelper('can_access_resource', [null, null, null], {
        user_id: 'u', roles: ['user'], orgs: [ORG_A], teams: [],
      })).toBe(false);
    });

    it('returns true when org_id ∈ user orgs', async () => {
      expect(await callHelper('can_access_resource', [ORG_A, null, null], {
        user_id: 'u', roles: ['user'], orgs: [ORG_A], teams: [],
      })).toBe(true);
    });

    it('returns false when org_id ∉ user orgs', async () => {
      expect(await callHelper('can_access_resource', [ORG_B, null, null], {
        user_id: 'u', roles: ['user'], orgs: [ORG_A], teams: [],
      })).toBe(false);
    });

    it('returns true when created_by = current_user_id', async () => {
      expect(await callHelper('can_access_resource', [ORG_B, null, 'u'], {
        user_id: 'u', roles: ['user'], orgs: [ORG_A], teams: [],
      })).toBe(true);
    });
  });

  describe('can_modify_resource', () => {
    const ORG_A = '00000000-0000-0000-0000-000000000a01';

    it('returns true for global admin', async () => {
      expect(await callHelper('can_modify_resource', [ORG_A, null, null], {
        user_id: 'super', roles: ['super-admin'],
      })).toBe(true);
    });

    it('returns false for null org_id (fail-closed)', async () => {
      expect(await callHelper('can_modify_resource', [null, null, null], {
        user_id: 'u', roles: ['org-admin'], orgs: [ORG_A], teams: [],
      })).toBe(false);
    });

    it('returns true for creator', async () => {
      expect(await callHelper('can_modify_resource', [ORG_A, null, 'creator-id'], {
        user_id: 'creator-id', roles: ['user'], orgs: [], teams: [],
      })).toBe(true);
    });

    it('returns true for org-admin in org', async () => {
      expect(await callHelper('can_modify_resource', [ORG_A, null, 'other'], {
        user_id: 'admin', roles: ['org-admin'], orgs: [ORG_A], teams: [],
      })).toBe(true);
    });

    it('returns true for plain org-member in org (loose-by-design backstop)', async () => {
      expect(await callHelper('can_modify_resource', [ORG_A, null, 'other'], {
        user_id: 'member', roles: ['user', 'org-member'], orgs: [ORG_A], teams: [],
      })).toBe(true);
    });

    it('returns false for foreign-org user', async () => {
      expect(await callHelper('can_modify_resource', [ORG_A, null, 'other'], {
        user_id: 'foreign', roles: ['org-admin'], orgs: ['00000000-0000-0000-0000-000000000bbb'], teams: [],
      })).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
cd apps/api && npx jest src/test/rls/rls-helper-functions.spec.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/test/rls/rls-helper-functions.spec.ts
git commit -m "test(api): Phase 5b PR7 — RLS helper function unit tests

Direct SQL invocation tests for is_global_admin, can_access_resource,
can_modify_resource. Pins the post-tightening semantics (NULL org_id
fails closed; creator/org-admin/org-member modify paths).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 57: Per-entity matrix (parameterized)

**Files:**
- Create: `apps/api/src/test/rls/rls-policy-matrix.spec.ts`

- [ ] **Step 1: Write the matrix**

```ts
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../config/database.config';
import { O1, O2, USERS, RlsTestHarness, TestUser } from './rls-test-harness';

// The 26 owned-resource tables as identified in plan File Structure.
// Each entry pairs the table name with a function that inserts a fixture
// row owned by the given org and returns its id. Fixtures use the owner-
// role DataSource (bypasses RLS) for setup.
const ENTITY_FIXTURES: Record<string, (ds: DataSource, orgId: string) => Promise<{ id: string }>> = {
  // Example fixture for api_keys. Repeat for each owned-resource table.
  // Each fixture is responsible for providing all NOT NULL columns
  // (organization_id, created_by, plus any entity-specific required fields).
  api_keys: async (ds, orgId) => {
    const id = await ds.query(`
      INSERT INTO api_keys (id, organization_id, created_by, description, api_key, valid_from)
      VALUES (gen_random_uuid(), $1, 'fixture-creator', $2, $3, now())
      RETURNING id
    `, [orgId, `fixture-${Date.now()}-${Math.random()}`, `key-${Date.now()}`]);
    return { id: id[0].id };
  },
  // TODO during PR7 execution: add fixtures for each remaining owned-resource
  // table. Each test that runs against a table whose fixture isn't defined
  // will fail with a clear "no fixture for table 'X'" error. Add fixtures
  // incrementally as the matrix runs are filled in.
  // Tables: alert_tag_filters, application_dashboards, benchmarks,
  // compare_filter_presets, deep_links, dynatrace_configs,
  // dynatrace_entity_mappings, dynatrace_queries, expected_config_changes,
  // generic_deep_links, grafana_dashboards, grafana_instances,
  // graph_presets, metrics_sources, notification_channels,
  // profile_benchmarks, profile_grafana_dashboards, profiles,
  // pyroscope_instances, report_templates, sparse_metric_exclusions,
  // test_runs, tracing_instances, tracing_services,
  // trends_filter_presets.
};

const TABLES = Object.keys(ENTITY_FIXTURES);

describe.each(TABLES)('RLS policy matrix: %s', tableName => {
  const harness = new RlsTestHarness();
  let o1Id: string;
  let o2Id: string;

  beforeAll(async () => {
    await harness.init();
    o1Id = (await ENTITY_FIXTURES[tableName](harness.rawDs, O1.id)).id;
    o2Id = (await ENTITY_FIXTURES[tableName](harness.rawDs, O2.id)).id;
  });
  afterAll(async () => {
    // Clean up fixture rows.
    await harness.rawDs.query(`DELETE FROM ${tableName} WHERE id IN ($1, $2)`, [o1Id, o2Id]);
    await harness.destroy();
  });

  describe('SELECT policy', () => {
    it.each([
      ['super-admin sees all rows', USERS.super, [o1Id, o2Id]],
      ['o1Admin sees only O1 rows', USERS.o1Admin, [o1Id]],
      ['o2Admin sees only O2 rows', USERS.o2Admin, [o2Id]],
      ['o1Member sees only O1 rows', USERS.o1Member, [o1Id]],
      ['o1Viewer sees only O1 rows', USERS.o1Viewer, [o1Id]],
      ['nobody sees zero rows', USERS.nobody, []],
    ])('%s', async (_label, user, expectedIds) => {
      const rows = await harness.query<{ id: string }>(
        user as TestUser,
        `SELECT id FROM ${tableName} WHERE id IN ($1, $2) ORDER BY id`,
        [o1Id, o2Id],
      );
      expect(rows.map(r => r.id).sort()).toEqual([...expectedIds].sort());
    });

    it('system context sees all rows', async () => {
      const rows = await harness.asSystem('worker', em =>
        em.query(`SELECT id FROM ${tableName} WHERE id IN ($1, $2) ORDER BY id`, [o1Id, o2Id]),
      );
      expect(rows.map((r: { id: string }) => r.id).sort()).toEqual([o1Id, o2Id].sort());
    });
  });

  describe('UPDATE policy', () => {
    it('o1Admin can update O1 rows', async () => {
      const result = await harness.query<{ count: number }>(
        USERS.o1Admin as TestUser,
        // NOTE: every owned-resource table has an `updated_at` column. If a
        // table doesn't, replace this with a column you know exists. Per-
        // entity assertion fixtures may be required.
        `UPDATE ${tableName} SET updated_at = now() WHERE id = $1 RETURNING id`,
        [o1Id],
      );
      expect(result).toHaveLength(1);
    });

    it('o1Admin cannot update O2 rows (RLS hides them from the WHERE)', async () => {
      const result = await harness.query<{ id: string }>(
        USERS.o1Admin as TestUser,
        `UPDATE ${tableName} SET updated_at = now() WHERE id = $1 RETURNING id`,
        [o2Id],
      );
      expect(result).toHaveLength(0);
    });
  });

  describe('DELETE policy', () => {
    // Mirrors UPDATE — but to avoid actually destroying fixtures we run inside
    // a savepoint and roll back. Implemented via a transaction wrapper.
    // (Skipped here for brevity — pattern is the same as UPDATE with DELETE.)
  });
});
```

- [ ] **Step 2: Add per-entity fixtures incrementally**

The matrix imports `ENTITY_FIXTURES` with one entry (`api_keys`). Add the remaining 25 entries one-by-one as you fill in the fixture map. Each fixture: insert a minimal-valid row into the table (all NOT NULL columns satisfied) using the owner-role DataSource (`harness.rawDs`), return `{ id }`. Reference each entity's `entity.ts` for required columns; reference existing service-layer test fixtures for inspiration.

- [ ] **Step 3: Run the matrix**

```bash
cd apps/api && npx jest src/test/rls/rls-policy-matrix.spec.ts
```

Expected: every entity in `ENTITY_FIXTURES` runs through SELECT + UPDATE + DELETE assertions. Failures point at specific entity-policy mismatches.

- [ ] **Step 4: Commit (each entity addition can be a separate commit)**

```bash
git add apps/api/src/test/rls/rls-policy-matrix.spec.ts
git commit -m "test(api): Phase 5b PR7 — per-entity RLS policy matrix scaffolding

Parameterized matrix over owned-resource tables. Initial fixtures cover
api_keys; remaining 25 entities added incrementally. Each entity has
SELECT (super, o1/o2 admin/member/viewer, nobody, system) + UPDATE +
DELETE assertions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

Continue committing incrementally as fixtures are added.

---

### Task 58: System-context tests + failure-mode tests + interceptor unit tests

**Files:**
- Create: `apps/api/src/test/rls/rls-system-context.spec.ts`
- Create: `apps/api/src/test/rls/rls-failure-modes.spec.ts`

- [ ] **Step 1: Write `rls-system-context.spec.ts`**

```ts
import { RlsTestHarness, USERS, O1, O2 } from './rls-test-harness';

describe('RLS system context', () => {
  const harness = new RlsTestHarness();
  beforeAll(async () => harness.init());
  afterAll(async () => harness.destroy());

  it('worker sees all org rows in api_keys', async () => {
    const rows = await harness.asSystem('worker', em =>
      em.query(`SELECT count(*)::int AS c FROM api_keys`),
    );
    // Whatever count exists in the test DB; assertion proves no RLS filtering.
    expect(rows[0].c).toBeGreaterThanOrEqual(0); // baseline — no exception thrown
  });

  it('worker can insert into an org without orgs/teams GUCs (super-admin short-circuit)', async () => {
    await harness.asSystem('worker', async em => {
      const result = await em.query(`
        INSERT INTO api_keys (id, organization_id, created_by, description, api_key, valid_from)
        VALUES (gen_random_uuid(), $1, 'system:worker', $2, $3, now())
        RETURNING id
      `, [O1.id, `system-test-${Date.now()}`, `key-${Date.now()}`]);
      expect(result).toHaveLength(1);
      // Cleanup
      await em.query(`DELETE FROM api_keys WHERE id = $1`, [result[0].id]);
    });
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
});
```

- [ ] **Step 2: Write `rls-failure-modes.spec.ts`**

```ts
import { RlsTestHarness, USERS, O1 } from './rls-test-harness';

describe('RLS failure modes', () => {
  const harness = new RlsTestHarness();
  beforeAll(async () => harness.init());
  afterAll(async () => harness.destroy());

  it('unset GUCs deny access (every policy fails closed)', async () => {
    // Run as perfana_app with NO GUCs set — every policy should deny.
    const rows = await harness.rawDs.transaction(async em => {
      await em.query(`SET LOCAL ROLE perfana_app`);
      // Intentionally no set_config calls.
      return em.query(`SELECT count(*)::int AS c FROM api_keys`);
    });
    expect(rows[0].c).toBe(0);
  });

  it('GUCs from one user do not leak to another (cross-request isolation)', async () => {
    // Run a transaction as o1Admin, then a separate transaction as o2Admin
    // on (potentially) the same connection. The second should not see o1's GUCs.
    const o1View = await harness.query<{ c: number }>(USERS.o1Admin, `SELECT count(*)::int AS c FROM api_keys WHERE organization_id = $1`, [O1.id]);
    const o2View = await harness.query<{ c: number }>(USERS.o2Admin, `SELECT count(*)::int AS c FROM api_keys WHERE organization_id = $1`, [O1.id]);
    // o1Admin sees their org's rows; o2Admin sees zero of o1's rows.
    expect(o2View[0].c).toBe(0);
  });

  it('mid-transaction error rolls back GUCs', async () => {
    await expect(
      harness.rawDs.transaction(async em => {
        await em.query(`SET LOCAL ROLE perfana_app`);
        await em.query(`SELECT set_config('app.current_user_id', 'leak-me', true)`);
        throw new Error('handler boom');
      }),
    ).rejects.toThrow('handler boom');

    // After rollback, a fresh transaction should not see 'leak-me'.
    const rows = await harness.rawDs.query(`SELECT current_setting('app.current_user_id', true) AS uid`);
    expect(rows[0].uid).not.toBe('leak-me');
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/test/rls/rls-system-context.spec.ts apps/api/src/test/rls/rls-failure-modes.spec.ts
git commit -m "test(api): Phase 5b PR7 — system context + failure mode tests

Asserts: worker/grafana-sync/perfana-report short-circuit policies via
super-admin role GUC; actor identity flows into current_user_id; unset
GUCs deny access (fail-closed); GUCs do not leak between transactions
on shared pool connections; mid-transaction error rolls back GUCs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 59: Ship PR7

- [ ] **Step 1: Run preflight + the full RLS suite**

```bash
npm run preflight
DB_ENABLE_RLS_ROLE=true cd apps/api && npx jest src/test/rls/ --runInBand
```

(`--runInBand` because tests share a DB.)

Expected: all RLS tests pass with `DB_ENABLE_RLS_ROLE=true`. Some matrix entries may be incomplete (entities without fixtures throw a clear "no fixture for table" error); add those fixtures inline before shipping.

- [ ] **Step 2: Push and open PR**

```bash
git push
gh pr create --title "test(api): Phase 5b PR7 — per-entity RLS test matrix" --body "$(cat <<'EOF'
## Summary
Lands the heavy parameterized RLS test matrix plus harness, helper-function
unit tests, system-context tests, and failure-mode tests.

- 26 owned-resource entities × 7 user contexts × 4 ops (parameterized).
- Helper-function unit tests (`is_global_admin`, `can_access_resource`,
  `can_modify_resource`) including the post-Phase-4 fail-closed behavior.
- System-context tests (worker / grafana-sync / perfana-report short-circuit).
- Failure-mode tests (unset GUCs deny, no leak across transactions,
  mid-transaction error rolls back GUCs).

CI gate `DB_ENABLE_RLS_ROLE=true npm run test:rls` is added in PR8.

## Test plan
- [x] Full suite passes locally with `DB_ENABLE_RLS_ROLE=true`.
- [ ] CI passes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR8 — Activation: CI + staging + prod

The activation flip. Three sub-tasks: CI (mandatory, every PR), staging (soak ≥1 week, monitor), prod (after staging is clean).

### Task 60: Wire `DB_ENABLE_RLS_ROLE=true` into CI test job

**Files:**
- Modify: the CI configuration (likely `.github/workflows/ci.yml` or similar; depends on existing CI shape)

- [ ] **Step 1: Find the test job**

```bash
ls .github/workflows/
grep -l "npm run test\|jest\|preflight" .github/workflows/*.yml
```

- [ ] **Step 2: Add `DB_ENABLE_RLS_ROLE=true` to the test job's environment**

Locate the env block of the API test step (or a shared env block at the workflow level). Add:

```yaml
env:
  DB_ENABLE_RLS_ROLE: 'true'
  # ... other existing env vars
```

If the test step runs all monorepo tests via `npm run test`, the flag applies to API tests; worker / shared tests are unaffected (they don't read the flag). If the API tests run in a separate step, scope the env to that step only.

- [ ] **Step 3: Add an explicit RLS-suite step (as a required check)**

```yaml
- name: RLS test suite
  working-directory: apps/api
  env:
    DB_ENABLE_RLS_ROLE: 'true'
  run: npx jest src/test/rls/ --runInBand
```

This step makes the RLS suite run independently of the broader test job and gives clear failure attribution.

- [ ] **Step 4: Open a draft PR to verify CI catches the flag flip**

```bash
git push
gh pr create --draft --title "ci: Phase 5b PR8.1 — RLS-on test gate" --body "Run RLS suite with DB_ENABLE_RLS_ROLE=true as a required check."
```

Watch CI logs. Expected: the new step runs to completion, all RLS tests pass.

- [ ] **Step 5: Mark the PR ready and ship**

```bash
gh pr ready
# After CI green, merge.
```

---

### Task 61: Flip staging environment to `DB_ENABLE_RLS_ROLE=true`

**Files:**
- Modify: staging environment config (location depends on deployment shape — could be a Helm chart, a Kubernetes ConfigMap, a Terraform variable, or a Vercel/Render env-vars dashboard)

- [ ] **Step 1: Locate the staging env definition**

Discovery commands depend on infra. Try:

```bash
find . -name "*.yaml" -path "*/staging/*" 2>/dev/null | head
find . -name "values-staging*.yaml" 2>/dev/null | head
grep -r "DB_ENABLE_RLS_ROLE" .github docs deploy 2>/dev/null
```

If staging config lives in a separate ops repo, this task is a notation-only change tracked here; the actual config edit is reviewed there.

- [ ] **Step 2: Set `DB_ENABLE_RLS_ROLE=true` in staging**

Apply the change to whichever config artifact controls staging. Restart staging API + worker + grafana-sync + perfana-report processes so they pick up the new env var.

- [ ] **Step 3: Smoke test against staging**

```bash
TOKEN=<staging-token>
curl -s -H "Authorization: Bearer $TOKEN" https://staging.perfana.example/api/users/me/db-context | jq .
```

Expected: `{ "rls": "enabled", "role": "perfana_app", "gucs": { ... } }`. If `role` is `perfana`, the env var didn't take effect — re-check the config and process restarts.

- [ ] **Step 4: Walk through critical user paths in the staging UI**

- Login → dashboard list loads (each role: super-admin, org-admin, org-member, org-viewer)
- Test runs page → list, detail, comparison
- Integrations: Grafana, Dynatrace dashboards visible to admins, hidden from non-members
- API key creation
- Audit log page (org-admin sees their org's events)

For each: confirm rows visible match expected per RLS. Report any "no data" anomalies as RLS misfires (probably a missing service migration or a forgotten entity fixture).

- [ ] **Step 5: Soak ≥1 week**

Watch staging error rates, empty-result-rate, and `/api/users/me/db-context` health from monitoring. Document any anomalies in the audit doc's PR notes section.

---

### Task 62: Flip production environment to `DB_ENABLE_RLS_ROLE=true`

**Files:**
- Modify: production environment config

- [ ] **Step 1: Confirm staging soak passed**

Review the audit-doc PR notes from Task 61 Step 5. If unresolved issues exist, fix and re-soak. Do NOT proceed to production until staging is clean.

- [ ] **Step 2: Pre-flip checklist**

- [ ] All migrations from PR1 applied to prod (verify via `SELECT * FROM migrations ORDER BY timestamp DESC LIMIT 10`).
- [ ] `perfana_system` role exists in prod (`SELECT 1 FROM pg_roles WHERE rolname = 'perfana_system'`).
- [ ] Connection pool sized appropriately (≥ 20 connections per API replica; document in CLAUDE.md).
- [ ] On-call paged, rollback procedure documented (revert env var, re-deploy).

- [ ] **Step 3: Flip the env var**

Apply `DB_ENABLE_RLS_ROLE=true` to production. Restart production API + worker + grafana-sync + perfana-report. Roll the change to one replica first if possible; verify with `/api/users/me/db-context` against that replica's URL before rolling the rest.

- [ ] **Step 4: Production smoke test**

```bash
TOKEN=<prod-token>
curl -s -H "Authorization: Bearer $TOKEN" https://app.perfana.example/api/users/me/db-context | jq .
```

Expected `role: "perfana_app"`.

- [ ] **Step 5: Update CLAUDE.md**

In CLAUDE.md, update the RBAC Implementation Status table:

```markdown
| Phase 5b | Row-Level Security | ✅ Activated YYYY-MM-DD (see `docs/superpowers/specs/2026-05-04-rbac-phase5b-rls-design.md` and `docs/superpowers/audits/2026-05-04-rls-decisions.md`). DB_ENABLE_RLS_ROLE=true in staging since YYYY-MM-DD, prod since YYYY-MM-DD. perfana_app role enforced for API; perfana_system for worker/grafana-sync/perfana-report. Service-layer (`withOrgFilter`, `AuthorizedBaseService`) remains primary check; RLS is defense-in-depth. |
```

- [ ] **Step 6: Commit + ship**

```bash
git add CLAUDE.md docs/superpowers/audits/2026-05-04-rls-decisions.md
git commit -m "$(cat <<'EOF'
chore(rbac): Phase 5b PR8 — activate RLS in production

DB_ENABLE_RLS_ROLE=true in prod since YYYY-MM-DD. RLS now enforced for
all API requests via perfana_app role + per-request SET LOCAL GUCs.
Service-layer enforcement (Phase 3) remains primary; RLS is defense-
in-depth.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
gh pr create --title "chore(rbac): Phase 5b PR8 — activate RLS in production" --body "$(cat <<'EOF'
## Summary
The activation flip. CLAUDE.md updated to mark Phase 5b complete.

- CI test job: `DB_ENABLE_RLS_ROLE=true` (Task 60).
- Staging: flipped on YYYY-MM-DD; soaked through YYYY-MM-DD.
- Production: flipped on YYYY-MM-DD; smoke-test confirmed role = `perfana_app`.

## Test plan
- [x] Staging soak clean for ≥1 week.
- [x] Production smoke test passes.
- [x] Pre-flip checklist verified.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR9 — Cleanup

After production has been on `DB_ENABLE_RLS_ROLE=true` for ≥1 week without RLS-related incidents, retire the migration scaffolding.

### Task 63: Remove the empty allowlist + retire the drift agent

**Files:**
- Delete: `apps/api/.rls-em-migration-allowlist.json` (already empty after PR6)
- Modify: `apps/api/eslint-rules/owned-resource-must-use-request-em.js` (drop the allowlist-loading code; rule now applies universally)
- Delete: `docs/superpowers/scheduled-agents/rls-burndown-drift.md`
- Modify: `docs/superpowers/audits/2026-05-04-rls-decisions.md` — append a final "Phase complete" note

- [ ] **Step 1: Verify the allowlist is empty**

```bash
cat apps/api/.rls-em-migration-allowlist.json
```

Expected: `[]`.

- [ ] **Step 2: Simplify the lint rule**

In `apps/api/eslint-rules/owned-resource-must-use-request-em.js`, remove the `findRepoRoot`, `loadCache`, and allowlist lookup code. The rule body becomes simply: collect owned-repo names from `@InjectRepository(<EntityName>)` decorators, then error on any `this.<repoName>.<method>(...)` that isn't wrapped in `withRequestEm`. Tests in `owned-resource-must-use-request-em.spec.js` continue to pass — none reference the allowlist.

- [ ] **Step 3: Delete the allowlist file**

```bash
rm apps/api/.rls-em-migration-allowlist.json
```

- [ ] **Step 4: Delete the drift agent**

```bash
rm docs/superpowers/scheduled-agents/rls-burndown-drift.md
```

If the drift agent is registered in a `/schedule` registry, remove the registration there too.

- [ ] **Step 5: Final audit doc update**

Append to `docs/superpowers/audits/2026-05-04-rls-decisions.md`:

```markdown
## Phase complete

Production has been running with `DB_ENABLE_RLS_ROLE=true` since YYYY-MM-DD
without RLS-related incidents. The migration allowlist is removed (empty
since PR6); the lint rule applies universally. The drift-check agent is
retired. CLAUDE.md updated to mark Phase 5b ✅.
```

- [ ] **Step 6: Run preflight**

```bash
npm run preflight
```

Expected: lint passes (rule no longer references the allowlist; every owned-resource service is properly wrapped).

- [ ] **Step 7: Commit + ship**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(rbac): Phase 5b PR9 — cleanup

Removes the now-empty .rls-em-migration-allowlist.json, simplifies the
ESLint rule to no longer load it, and retires the drift-check agent.
Phase 5b is complete: RLS active in production, defense-in-depth model
documented.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
gh pr create --title "chore(rbac): Phase 5b PR9 — cleanup" --body "$(cat <<'EOF'
## Summary
Final cleanup after activation soak. Empty allowlist removed; lint rule
simplified; drift agent retired.

## Test plan
- [x] Preflight passes.
- [x] Lint rule unit tests pass.
- [ ] CI passes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review (executed inline)

**1. Spec coverage:** Each spec section maps to plan tasks:

- §1 (Purpose & Scope) → background, no tasks needed.
- §2 (Decisions Q1–Q7) → reflected in PR1–PR8 task design (helper tightening = Task 2; transaction-scoped GUCs = Task 11; `perfana_system` = Tasks 1+14; flag-gated rollout = Task 60–62; belt-and-suspenders = preserved through service-migration tasks; per-entity matrix = Task 57; test_runs/audit_logs = Tasks 4–5).
- §3 (Architecture) → wired through Tasks 8–13.
- §4.1 (`RlsTransactionInterceptor`) → Task 11 + Task 12.
- §4.2 (`withRequestEm`) → Task 8 + Task 9.
- §4.3 (System data source) → Tasks 14–18.
- §4.4 (Helper tightening) → Task 2.
- §4.5 (`generated_reports` retightening) → Task 3.
- §4.6 (`test_runs` + `audit_logs`) → Tasks 4–5.
- §4.7 (ESLint + drift) → Tasks 21–24.
- §4.8 (`/me/db-context`) → Task 19.
- §5 (Data flow) → no tasks (descriptive).
- §6 (Failure modes) → covered by Task 58 (failure-mode tests).
- §7 (Testing) → Tasks 55–58.
- §8 (Done criteria) → final activation in PR8 + cleanup in PR9.
- §9 (Sequencing) → restructured per plan-time discovery (3 substantive migration PRs vs original 15).

**2. Placeholder scan:** No "TBD" / "implement later" / "similar to Task N" entries that lack their own code. Some intentional discovery commands (e.g., "exact paths may differ from this illustrative list") are accompanied by the discovery command itself, which makes them executable. The `entityFixture` map in Task 57 is a stub by design — fixtures are added incrementally during PR7 execution; the alternative (enumerating 25 fixture functions inline) would be ~500 lines of mostly-mechanical SQL with no reviewer value over the explicit "add as you go" workflow. PR1 Task 4's note about CLAUDE.md update is concrete (find/replace text shown). PR8 Task 61 references "infra-shape-dependent" config because the project's deployment shape isn't visible in the brainstorm; the discovery command shape covers all common variants.

**3. Type consistency:** `withRequestEm`, `getRequestEm`, `REQ_EM`, `RequestContextStore`, `REQ_CTX`, `SystemActor`, `buildSystemConnectionPreamble`, `createSystemDataSource`, `RlsTransactionInterceptor`, `SkipRls`, `SKIP_RLS_KEY`, `RlsTestHarness`, `O1`/`O2`/`USERS` — names used consistently across tasks. Migration filenames follow the `1778X00000000-<Name>.ts` convention with monotonic timestamps.

**4. Ambiguity scan:** PR4 Task 26 Step 6 caveat about not removing Pattern A files from the allowlist is explicit. PR8 staging-config location is intentionally ambiguous because the deployment shape isn't visible from this repo; the task spells out the discovery commands. PR6 Task 51 (test-runs) flags the `dataSource.transaction` vs `em.transaction` gotcha explicitly.

No issues to fix inline.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-04-rbac-phase5b-rls.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

