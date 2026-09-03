# CLAUDE.md

Performance analysis platform — ingests load test results, collects metrics from Grafana/Dynatrace/Prometheus, runs ADAPT regression detection, provides dashboards with SLO compliance.

## Quick Start

```bash
npm install
docker compose -f docker-compose.infra.yml up -d
# Wait for Postgres + Keycloak to be healthy, then:
npm run dev
```

- API: http://localhost:3001/api/docs (Swagger)
- Web: http://localhost:4000
- Keycloak: http://localhost:8080 (admin/admin, realm: perfana-prod)
- Login: perfana@example.com / perfana

## Project Index

> **Progressive disclosure:** Scan this index. Read only what's relevant to your task.

| Area | Path | What's there | Docs |
|------|------|-------------|------|
| 📡 API | `apps/api/` | NestJS REST API, 36+ modules | [CODING_RULES](apps/api/CODING_RULES.md) |
| 🌐 Frontend | `apps/web/` | Next.js, MUI + Radix + Tailwind | [CODING_RULES](apps/web/CODING_RULES.md) |
| 🔧 Worker | `apps/worker/` | BullMQ pipelines, ADAPT algorithm | [README](apps/worker/README.md) |
| 🔄 Grafana Sync | `apps/grafana-sync/` | Dashboard sync background service | [CODING_RULES](apps/grafana-sync/CODING_RULES.md) |
| 🗄️ Shared | `packages/shared/` | TypeORM entities, types, utils | [README](packages/shared/README.md) |
| ⚙️ Config | `packages/config/` | TypeORM config factory | — |
| 🔌 MCP Server | `apps/mcp/` | MCP tool server for AI agents | [README](apps/mcp/README.md) |
| 📊 Report | `apps/perfana-report/` | Report generation service | [README](apps/perfana-report/README.md) |
| 📚 Deep Reference | `docs/reference/` | ADAPT, RBAC, schemas, features (narrative). For derivable "how does X work / what calls this" use GitNexus. | [Index](docs/reference/index.md) |
| 🏗️ Infra | `docker-compose.infra.yml` | Full local stack | — |

→ System diagrams: [ARCHITECTURE.md](ARCHITECTURE.md)
→ Code patterns: [CONVENTIONS.md](CONVENTIONS.md)

---

## Technology Stack

- **Database**: PostgreSQL with TypeORM
- **Backend**: NestJS (TypeScript, decorators, dependency injection)
- **Frontend**: Next.js (React, App Router, Server Components)
- **Authentication**: Keycloak JWT + API Keys
- **Background Jobs**: BullMQ with Redis
- **Language**: TypeScript throughout

## Development Commands

- `npm run dev` — Start all services (api :3001, web :4000, grafana-sync :3002, worker)
- `npm run build` / `npm run test` / `npm run type-check` / `npm run lint`
- `npm run dev:api` / `npm run dev:web` / `npm run dev:grafana-sync` — Individual services
- `lsof -ti:3001,3002,4000 | xargs kill -9 && npm run dev` — Kill and restart

## Authentication System

**CRITICAL**: Perfana uses a **dual authentication system** to support both web users and programmatic access.

### Authentication Methods

1. **Keycloak JWT Authentication** (Web Users)
   - JWT tokens managed by Keycloak with automatic refresh
   - SSO/enterprise authentication support
   - Integration via keycloak-js adapter

2. **API Key Authentication** (Programmatic Access)
   - Bearer token format with base64 encoded description#uuid
   - Configurable TTL (time-to-live)
   - Managed via `/api-keys` endpoints

### Backend Implementation

- **KeycloakEnhancedAuthGuard**: Handles both authentication methods (tries API key first, falls back to Keycloak JWT)
- **Admin endpoints**: Require Keycloak JWT authentication with admin role
- **All API endpoints**: Protected by default, use `@Public()` decorator to bypass

### Frontend API Client Requirements

**MANDATORY**: All frontend API calls MUST include authentication headers. Use `authenticatedFetch()` from `lib/api.ts` — it handles token injection, 401 refresh, and base URL prepending automatically.

```typescript
// PREFERRED: authenticatedFetch (handles everything)
import { authenticatedFetch } from '@/lib/api';

const response = await authenticatedFetch('/test-runs', { method: 'GET' });

// FALLBACK: manual headers (only when authenticatedFetch doesn't fit)
import { getAuthHeaders } from '@/lib/api';

const response = await fetch(`${env.API_URL}/endpoint`, {
  headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
});
```

**Never** import from `@/lib/keycloak-auth` directly or read tokens from `sessionStorage`/`localStorage` — always go through `lib/api.ts`.

### API Endpoints

All endpoints are documented in Swagger: `http://localhost:3001/api/docs`

- All endpoints protected by default via `KeycloakEnhancedAuthGuard`
- Use `@Public()` for unauthenticated access (e.g., health checks)
- Admin endpoints require `perfana-admin` or `admin` role in Keycloak token

## Role-Based Access Control (RBAC)

Perfana implements a multi-tenant RBAC system for fine-grained access control across organizations and teams.

### RBAC Implementation Status

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Role definitions & constants | ✅ Completed |
| Phase 2 | Membership & ownership infrastructure | ✅ Completed |
| Phase 3 | Service-layer authorization enforcement | ✅ Lint-enforced (2026-05-02 — `.rbac-migration-allowlist.json` is empty; Bucket B 100%, Bucket A 70/131 lint-only (53.4%) or 68/127 strict (53.5%); 2 user-owned preset `findAll` sites are the remaining strict-legacy sites (they filter by row-level ownership and have no `withOrgFilter` equivalent); see `docs/superpowers/audits/2026-04-26-audit-decisions.md` Phase C37) |
| Phase 4 | Data migration for existing resources | ✅ Completed (2026-05-02 — null-org escape hatch closed; `organization_id` is NOT NULL on all 26 owned-resource entities; `audit_logs` keeps nullable for documented reasons; null-org defensive branches deleted from `AuthorizationService`, `AuthorizedBaseService`, `dynatrace.service.ts`, `api-keys.service.ts`, `systems-under-test.service.ts`, `test-runs-crud-query.service.ts`; extended in v0.2.72.0 to `check_results`, `ds_compare_config`, `ds_metric_collection_status` and `ds_change_points`, NOT NULL on both greenfield and migrated databases) |
| Phase 5a | Audit logging | ✅ Completed (2026-05-04 — `apps/api/.audit-migration-allowlist.json` is empty; 29 services migrated with paired `auditService.log{Create,Update,Delete}` calls across PRs 5–17, 27 files closed via the lint rule's `POLICY_EXEMPT` batch in PR20 (bucket-2 system writes + NO-decision admin config + repo-layer follow-ups); see `docs/superpowers/audits/2026-05-02-audit-phase5a-decisions.md` for per-PR burndown). Note: on deploys upgraded before v0.2.73.0 the trail is empty from 2026-08-01 until the default-partition fix lands — the rows were rejected, not hidden. |
| Phase 5b | Row-Level Security | ✅ Shipped — `RlsTransactionInterceptor` (`apps/api/src/common/interceptors/`) opens a per-request transaction, runs `SET LOCAL ROLE perfana_app` and sets four `app.current_*` GUCs that the policies read. Owned-resource repository calls go through `withRequestEm()`; `apps/api/.rls-em-migration-allowlist.json` is empty. Policies, helper functions, and the `perfana_app`/`perfana_system` roles live in the consolidated migration; `npm run preflight` runs `apps/api/src/test/rls/`. One deliberate carve-out — see "API-key organization resolution" below. |

### Role Hierarchy

**System Roles** (defined in `apps/api/src/constants/roles.constants.ts`):
- `super-admin` - Full system access across all organizations
- `system-admin` - System administration capabilities
- `support` - Support staff with read access
- `user` - Standard authenticated user

**Organization Roles**:
- `org-admin` - Full control over organization
- `org-member` - Standard member access
- `org-viewer` - Read-only access

**Team Roles**:
- `team-admin` - Full control over team
- `team-member` - Standard member access
- `team-viewer` - Read-only access

### Ownership Tracking

All resource entities implement the `OwnedResource` interface with four ownership columns:
- `created_by` - User ID (Keycloak sub or api-key:{id}) who created the resource
- `updated_by` - User ID who last modified the resource
- `organization_id` - Organization the resource belongs to (NOT NULL on all owned-resource entities as of Phase 4; nullable only on `audit_logs`, for system-level events with no org context). `test_runs.organization_id` is NOT NULL in the DDL and `rls_test_runs_select` reads it directly, but the **service-layer** per-resource check in `TestRunsCrudQueryService` still goes through the joined `systems_under_test.organization_id`
- `team_id` - Team the resource belongs to (nullable)

**Entities with Ownership Tracking** (~25 entities):
- Test runs, benchmarks, systems under test, profiles
- Grafana dashboards, instances, application dashboards
- Tracing instances/services, Pyroscope instances
- Dynatrace configs/queries/entity mappings
- Report templates, generated reports
- API keys, notification channels
- Graph presets, filter presets
- Deep links, URL patterns, expected config changes

### Key Services

**OrganizationMembersService** (`apps/api/src/modules/organizations/`):
- CRUD operations for organization membership
- Role checking: `isMember()`, `isOrgAdmin()`, `hasRole()`
- Bulk operations for managing members

**TeamMembersService** (`apps/api/src/modules/teams/`):
- CRUD operations for team membership
- Role checking: `isMember()`, `isTeamAdmin()`, `hasRole()`
- Bulk operations for managing members

**AuthorizationService** (`apps/api/src/common/services/`):
- Centralized permission checking with Redis caching
- `isGlobalAdmin()` - Check global admin roles
- `canAccessResource()` - Read permission check
- `canModifyResource()` - Write permission check
- `getAccessibleOrganizations()` / `getAccessibleTeams()` - Cached membership lookups
- Cache invalidation on membership changes

### Organization Loading in Services

**CRITICAL**: Do NOT rely on `ctx.organizations` from `@UserCtx()` for organization-based access checks. The decorator only has access to organizations embedded in the JWT or API key, which may be empty. `ctx.organizations` will often be `[]`.

**Correct pattern**: Services must load organizations themselves using `AuthorizationService.getAccessibleOrganizations(userId)`. Pass `userId` and `roles` from the controller — not `organizationIds`.

```typescript
// Controller: pass userId and roles
@Get()
async findAll(@UserCtx() ctx: UserContext) {
  return this.myService.findAll(ctx.userId, ctx.roles);
}

// Service: load orgs from DB via AuthorizationService
async findAll(userId: string, roles: string[]) {
  if (this.isGlobalAdmin(roles)) { /* bypass filtering */ }
  const organizationIds = await this.authzService.getAccessibleOrganizations(userId);
  // ... use organizationIds for filtering
}
```

This is how `test-runs` and all working services implement it.

### API-key organization resolution (deliberately outside RLS)

An API-key principal (`api-key:{uuid}`) gets its organization from the `api_keys` row itself, not from `organization_members`. `AuthorizationService.isOrganizationMember` and `getAccessibleOrganizations` read that row through the **plain pooled repository**, not `withRequestEm()` — the two sites carry an `eslint-disable-next-line owned-resource-must-use-request-em`.

This is not an oversight, and it must not be "fixed" back:

- **Scoping it is circular.** `RlsTransactionInterceptor` calls `getAccessibleOrganizations` to *build* `app.current_user_organizations`, which is exactly what `rls_api_keys_select` then reads. A key would have to already be in the organization to prove it is in the organization, and the answer would change with whichever GUCs happened to be in force.
- **The membership cache demands a context-free answer.** `buildOrgMembershipKey` carries no RLS context, so a context-dependent result would be cached and replayed.
- **It is safe only because `userId` is the authenticated principal.** Every caller passes `ctx.userId` or a self-derived id. Passing a third-party `userId` here would turn it into a cross-org membership oracle that RLS would otherwise have blocked.

**Deployment constraint**: `api_keys` is `FORCE ROW LEVEL SECURITY`, so this read returns rows only because the API's login role is `rolsuper`/`rolbypassrls`. Deploy the API under a least-privilege role without that bypass and **both** api-key branches return zero rows: every API key silently loses all organization access, surfacing as the misleading denial `user is not a member of organization X`. Nothing enforces this yet — a boot-time assertion is filed in TODOS.md.

`api_keys` rows are treated as immutable and delete-only. The membership cache is keyed on `api-key:<id>` and invalidated in `ApiKeysService.deleteApiKey`. Add a revoke flag or an org-move endpoint and that invalidation has to grow to match.

### RLS does not backstop a caller-named `organization_id` on create

`can_access_resource` is a chain of ORs and `created_by = current_user_id()` is its **last** branch — a fallback, not a short-circuit. On an INSERT the org check runs first and fails (the caller is not a member of the organization the body named), the team check fails too, and then the creator check returns TRUE anyway: a row the caller is inserting is self-created by definition. So `WITH CHECK (can_access_resource(...))` admits the row no matter which organization it carries. `rls_dynatrace_configs_insert` is the worked example, and the shape is shared by every owned-resource insert policy.

The consequence: **a create endpoint that reads `organizationId` out of the request body must check membership itself.** RLS will not catch it. Before v0.2.92.0 `DynatraceService.create` passed `dto.organizationId` straight through, so any authenticated user could plant a Dynatrace configuration — including the browser-facing `client_url` that org members then follow out of Perfana — into an organization they do not belong to.

The fix is the standard two-line pair, and it is what a new create path should copy:

```typescript
// Body may name a target org; default to the caller's own.
const organizationId =
  dto.organizationId ?? (await this.authzService.getAccessibleOrganizations(userId))[0];
if (!organizationId) throw new ForbiddenException('User has no accessible organization');

// getCapabilities is scoped to that org and already grants global admins the full
// set, so this is the whole check.
const caps = await this.authzService.getCapabilities(userId, roles, organizationId);
if (!caps.includes(Capability.IntegrationDynatraceCreate)) throw new ForbiddenException(...);
```

A controller-level `@RequiresCapability(Capability.X, { orgIdFromBody: 'organizationId' })` is the equivalent declarative gate and is preferred where the create path has no other org-resolution work to do.

### Per-resource authorization in test-runs

`TestRunsCrudQueryService` splits two patterns that look similar and are not:

- **List methods** use `withOrgFilter` / `withTeamFilter` to compute the accessible sets once.
- **Per-resource methods** (`findByTestRunId`, `findOne`, `getTestRunByTestRunId`) delegate to the private `denialReason()` helper, which calls `isOrganizationMember` / `canViewTeamResources` on the single row. The service-layer check reads the **joined `SystemUnderTest`'s** `organization_id` / `team_id`, not the run's own column. (The DB does have `test_runs.organization_id NOT NULL` and `rls_test_runs_select` uses it directly — the service check predates that and still goes through the system. The TypeORM entity also still declares the column `nullable: true`, which is drift against the DDL.)

`denialReason()` **fails closed**: a missing `systemUnderTest` relation is a denial, not a skip. `system_under_test_id` is NOT NULL, so a null relation never means "this run has no system" — it means the LEFT JOIN produced nothing, which under RLS is a legitimate refusal (a run can be visible via its own `created_by` while its system is policy-filtered).

All five denial causes return an indistinguishable refusal to the caller (404, or `null` from `getTestRunByTestRunId`) so nobody learns whether a run exists. The **server log is the only place the causes are distinguishable**, so any new caller of `denialReason()` must log the returned reason before refusing. Caller-supplied ids are passed through `forLog()` first — `testRunId` is a raw path parameter and Express percent-decodes path segments, so an unsanitized `%0A` would let an authenticated caller forge lines in the denial stream.

### Ownership column nullability

- `organization_id` is **NOT NULL** on all 26 owned-resource entities (Phase 4, 2026-05-02). The "null org = visible to all authenticated users" backward-compat rule is gone.
- Exception intentionally kept nullable: `audit_logs.organization_id` (system-level events with no org context). `test_runs.organization_id` was previously vestigial; Phase 5b backfilled and tightened it to NOT NULL so the standard RLS policy works without subqueries.
- `audit_logs` is RANGE-partitioned by month and carries an `audit_logs_default` DEFAULT partition (v0.2.73.0). Nothing at runtime creates partitions — `perfana_app`/`perfana_system` hold `USAGE` but not `CREATE` on schema `public` — so the default is what keeps an audit write from being rejected once the shipped months run out, and it is where every row lands from here on. Every partition has RLS enabled with no policies of its own: the parent's policies cover parent-routed access, and direct access (`SELECT * FROM audit_logs_2026_07`) is deny-all. A partition does **not** inherit the parent's RLS, so one created by hand needs `ENABLE` + `FORCE` immediately, and attaching it full-scans `audit_logs_default` under ACCESS EXCLUSIVE. Retention is `AuditRetentionManager`'s nightly batched `DELETE` of rows past `AUDIT_RETENTION_MONTHS` (default 24), never `DROP TABLE` — that needs an ownership the worker's role lacks.
- `team_id` remains nullable on all entities — teams are optional even on owned resources.
- Authorization enforcement (Phase 3) is now lint-enforced and the data layer (Phase 4) prevents the escape hatch.

## Environment Configuration

### Required Environment Variables

**Backend:**
- `DB_HOST` - PostgreSQL host
- `DB_PORT` - PostgreSQL port
- `DB_USERNAME` - PostgreSQL username
- `DB_PASSWORD` - PostgreSQL password
- `DB_NAME` - PostgreSQL database name
- `KEYCLOAK_URL` - Keycloak server URL
- `KEYCLOAK_REALM` - Keycloak realm name
- `KEYCLOAK_CLIENT_ID` - Keycloak client ID
- `KEYCLOAK_CLIENT_SECRET` - Keycloak client secret
- `LOG_VIEWER_ENABLED` - Enable admin log viewer (default: `false`). Requires a read-only Docker socket mount on the api service (`/var/run/docker.sock:/var/run/docker.sock:ro`). The distroless api runs non-root, so also grant it the socket's group (`group_add: ["0"]` in compose) or it gets EACCES and the container list is empty.
- `LOG_VIEWER_COMPOSE_PROJECT` - Docker Compose project name for container filtering (default: `perfana`). Must match your deploy's compose project (often the directory name) or the list is empty.
- `SUT_TRANSFER_ENABLED` - Enable admin-only SUT export/import feature (default: `false`). Exports production data — including grafana/dynatrace connection rows — to a downloadable file and imports bundles into this environment; keep off in production unless deliberately debugging. Admin (perfana-admin) only.
- `SCHEMA_DRIFT_CHECK` - How the boot-time entity/schema comparison behaves: `warn` (default) logs any column the database is missing at ERROR and keeps serving, `strict` refuses to start, `off` skips it. A column that reaches only `ConsolidatedSchema.ts` exists on new installs and nowhere else, and the symptom is a read that fails and a list that looks empty rather than an error — see `apps/api/src/common/db/assert-entity-columns.ts`. The matching pre-ship gate is `npm run check:entity-migrations`, wired into `npm run preflight`.
- `API_BODY_LIMIT` - Maximum JSON/urlencoded request body (default: `2mb`). Express defaults to 100 kB, which a report section's configuration can exceed on its own — selecting every series across two dashboards is a few thousand entries and the whole section is posted to render a preview. Raise it only if a legitimate payload is rejected with `request entity too large`.
- `AUDIT_RETENTION_MONTHS` - How long `audit_logs` rows are kept, in months (default: `24`). Read by the **worker**: `AuditRetentionManager` deletes older rows on boot and daily at 03:00 UTC and logs the count. Retention is a `DELETE`, not a partition `DROP` — the worker's `perfana_system` role owns no tables.
- `AGGREGATION_STATEMENT_TIMEOUT_MS` - Budget in milliseconds for the **worker's** heavy aggregation transactions — `StatisticsPipeline` and `ControlGroupStatisticsPipeline` (default: `540000`, v0.2.93.3). Deliberately **separate from `ANALYTICS_STATEMENT_TIMEOUT_MS`, not a replacement for it**: that one is a cap on runaway reads and has to stay lowerable, while these two are the job's own work and a 20 M-row run needs more than 120 s. `BasePipelineTypeORM.setAggregationBudget()` applies it with `set_config(..., true)` as the **first** statement inside `withAnalyticsTransaction`, so the whole transaction gets it — including `StatisticsPipeline`'s `ramp_up` refresh, which runs before the aggregation and is the statement most likely to blow the 120 s cap. Keep the value strictly **below** the analytics pool's client-side `query_timeout` (600000, `apps/worker/src/config/typeorm.config.ts`): at equal deadlines node-postgres destroys the connection instead of letting Postgres cancel the statement, and you lose both the clean rollback and the diagnosable `canceling statement due to statement timeout`. 540000 is that headroom.
- `AGGREGATION_WORK_MEM` - `work_mem` for those same two transactions (default: `128MB`, v0.2.93.3). It keeps ~20k `percentile_agg` sketches in a HashAggregate; spilling turns the aggregation into a GroupAggregate that sorts every input row to disk. Postgres charges `work_mem` per hash/sort node **and** per parallel worker, then again per concurrent job (`WORKER_ANALYZE_CONCURRENCY` + `WORKER_BATCH_CONCURRENCY`, 2 each), so the deploy-wide peak is roughly this value x (1 + `max_parallel_workers_per_gather`) x 4. Raise it only against that budget.

**Frontend:**
- `NEXT_PUBLIC_API_URL` - Backend API base URL (defaults to localhost:3001/api)
- `NEXT_PUBLIC_KEYCLOAK_URL` - Keycloak server URL
- `NEXT_PUBLIC_KEYCLOAK_REALM` - Keycloak realm name
- `NEXT_PUBLIC_KEYCLOAK_CLIENT_ID` - Keycloak client ID
- `NEXT_PUBLIC_USE_KEYCLOAK_AUTH` - Enable/disable Keycloak auth (default: `true`)
- `NEXT_PUBLIC_LOG_VIEWER_ENABLED` - Enable admin log viewer UI (default: `false`). Must match backend `LOG_VIEWER_ENABLED`.
- `NEXT_PUBLIC_SUT_TRANSFER_ENABLED` - Enable the SUT export dialog + import page UI (default: `false`). Must match backend `SUT_TRANSFER_ENABLED`.

**CSP note (not an env var, but a deploy footgun):** the report viewer and the public share page load report HTML into their iframe from a `blob:` URL rather than `srcDoc`, so `frame-src` must include `blob:` or the iframe never renders — see the comment in `apps/web/next.config.js`. This is baked into the CSP defaults and reapplied by the runtime patcher in `apps/web/scripts/start-server.js` (both keyed off `NEXT_PUBLIC_CSP_FRAME_SRC`), so a deploy that only sets env vars is fine. It breaks only if a reverse proxy or CDN in front of the web app sets or rewrites its own `Content-Security-Policy` header — that path bypasses both files, and the symptom is a report that silently fails to render with no error surfaced.

**Postgres worker budget (not an env var, but a deploy footgun):** TimescaleDB needs `max_worker_processes >= timescaledb.max_background_workers + max_parallel_workers + 1`. The `timescaledb-ha` image ships `max_worker_processes=8` against a default 16 background + parallel workers, so the job scheduler loses the race for a slot and logs `failed to start a background worker` instead of running the 15 continuous-aggregate refresh policies. `docker-compose.infra.yml` sets `max_worker_processes=32`; a deploy running its own Postgres has to set it too, and nothing asserts it at boot. The symptom is not an error — the CAGGs simply stop being materialised, and because they are **real-time** aggregates every query that reads one silently falls back to re-aggregating the raw hypertable. Pages get slow, nothing gets logged. Diagnose by comparing `_timescaledb_catalog.continuous_aggs_watermark` against the window you are querying, and by looking for a `Seq Scan on _hyper_*_chunk` in the `EXPLAIN` of what should be a CAGG read. Same symptom, second cause: a refresh policy's `start_offset` shorter than the test run it has to cover (see `1799000000000-WidenCaggRefreshWindows.ts`).

## Common Patterns

### Error Handling

Use the safe `instanceof Error` pattern:

```typescript
catch (err) {
  const msg = err && typeof err === 'object' && 'message' in err
    ? (err as Error).message : 'Unknown error';
}
```

### Idempotent Provisioning Endpoints

Some endpoints are designed for CI/CD pre-provisioning. They return the existing resource with HTTP 409 instead of failing, so pipeline scripts can call them unconditionally:

```typescript
// Service returns a conflict flag instead of throwing
if (existing) return { ...existing, conflict: true };

// Controller converts the flag to a 409 with the resource body
if (result.conflict) {
  const { conflict: _, ...resource } = result;
  throw new HttpException({ message: 'Already exists', resource }, HttpStatus.CONFLICT);
}
```

Example: `POST /api/systems-under-test` — creates the SUT (with optional environments and workloads) or returns the existing one with 409.

### Resource creation: use camelCase entity properties (avoid the silent-drop)

When creating a child resource via `repo.create({...})`, pass the **camelCase entity property name** (e.g. `organizationId`), NOT the snake_case DB column name (e.g. `organization_id`). Most owned-resource entities declare `@Column({ name: 'organization_id' }) organizationId!: string`. TypeORM silently drops unknown properties, so a snake_case key compiles, runs, and INSERTs without an org id — which slams into the Phase 4 NOT NULL constraint at runtime, not compile time.

Two correct patterns:

```typescript
// Pattern A — Inherit from parent (child resources):
const sut = await this.sutRepo.findOne({ where: { id: parentSystemId } });
const child = this.repo.create({
  ...rest,
  organizationId: sut.organizationId,  // camelCase, not organization_id
  teamId: sut.teamId,
});

// Pattern B — Default to user's first accessible org (top-level resources):
const orgId = dto.organizationId
  ?? (await this.authzService.getAccessibleOrganizations(userId))[0];
if (!orgId) throw new ForbiddenException('User has no accessible organization');
const entity = this.repo.create({ ...dto, organizationId: orgId });
```

v0.2.47.66 + v0.2.47.67 fixed 18 sites that hit this gotcha across `grafana-sync` and 17 API services. New services must follow these patterns from day one.

### `grafana_dashboards` is a mixed table (not every row is a Grafana dashboard)

Non-Grafana metrics sources need somewhere to hang their panels, so `ensureArtificialDashboardExists()` in `apps/api/src/modules/dynatrace/dynatrace.repository.ts` writes **artificial** placeholder rows into `grafana_dashboards`, with a synthetic `grafana_id` drawn from an 800000+ range for Dynatrace. Artificial rows have `grafana_json` NULL, have no counterpart in any Grafana, and must never be pushed to one.

**Never use `grafana_id` to tell them apart.** The comment at that insert reads as a range convention (800000+ Dynatrace, 900000+ performance-test metrics), but it does not hold in either direction: nothing emits the 900000+ range — the perf-test path creates no synthetic row at all — and real Grafana ids are snowflake-style and enormous, so they land far above both ranges. On the dev database 40 of 46 rows sit above 900000 and every one of them is a real dashboard. A `grafana_id >= 800000` test would classify the entire table as artificial. Use `grafana_json` and the `metrics_sources` join, as below.

Anything that reads this table has to decide whether it means "real dashboards" or "all rows". Four traps:

1. **The API's `findAll` filter is deliberately loose — do not "fix" it.** It hides artificial rows with a `NOT EXISTS` on `metrics_sources.source_type != 'grafana'`, but only when no `uid` is supplied (`grafana-dashboards.service.ts`, `if (!query.uid)`), so `GET /grafana/dashboards?uid=…` still returns them by design. Two callers need that: the SLO dialog (an SLO on a Dynatrace host metric is the point) and `useAddSLOForm`'s by-uid lookup. **Tightening `findAll` breaks both**, and `apps/web/app/systems/[id]/config/hooks/__tests__/useDashboardManagement.artificialDashboards.test.ts` exists to guard against exactly that. The picker-side filter belongs in the client: `isArtificialDashboard` in `apps/web/lib/metrics-source-utils.ts`, applied in `useDashboardManagement`.
2. **`source_type != 'grafana'` is not airtight anyway.** It misses artificial application dashboards that arrived via a **SUT import** — those have `metrics_source_id` NULL, so they join to no source type. Where a filter genuinely has to hold (the grafana-sync restore sweep), `grafana_json` is what catches them.
3. **A dashboard `uid` is unique only within a Grafana instance.** The same uid routinely exists on several, so every lookup by uid must also scope by `grafana_instance_id` — otherwise one instance's rows vouch for another's. Both sites do: the grafana-sync restore sweep, and the uid arm of `GrafanaDashboardsService.remove`'s delete pre-check. v0.2.89.0 shipped that second one unscoped and it refused deletes nothing referenced (a false 409); fixed in v0.2.89.1.
4. **Deleting one is not free.** `application_dashboards.grafana_dashboard_id` is `ON DELETE NO ACTION`, and app dashboards can also reference by `dashboard_uid` with a NULL foreign key. `DELETE /api/grafana/dashboards/:id` refuses with **409** rather than cascading, because Grafana dashboards are shared and a SUT delete deliberately leaves them behind. Remove the referencing rows first via `/api/grafana/application-dashboards`.

v0.2.89.0 fixed three symptoms of this: the grafana-sync restore sweep re-pushing artificial rows every 30s forever, one rejected dashboard aborting the whole sweep, and the API delete returning an opaque 500. See `docs/reference/Apps/Grafana Sync/Grafana Sync Overview.md` and `apps/api/src/modules/grafana/README.md`.

### Client URL vs server URL: Grafana and Dynatrace have opposite polarity

Both integrations can point the browser at a different address than the API calls, for deploys behind a reverse proxy or split DNS. **Which column is the required one is inverted between them, and that is deliberate — do not "align" them.**

| | Server-side URL (what api/worker call) | Browser-facing URL (deep links) |
|---|---|---|
| `grafana_instances` | `server_url` — **optional** override | `client_url` — **required** |
| `dynatrace_configs` | `host` — **required** | `client_url` — **optional** (v0.2.92.0) |

Grafana's required column is the client one because Perfana renders Grafana panels in the user's browser; Dynatrace's required column is the server one because every Dynatrace API call is made server-side. In both cases the optional column falls back to the required one when unset.

Three rules for the Dynatrace side:

1. **Read it through `deepLinkBaseUrl(config)`** (`apps/web/app/test-runs/[id]/components/dynatrace/utils/dynatrace-formatters.ts`), never `config.host`. It returns `clientUrl || host`, trailing slashes stripped. Every deep-link builder — service links, service flow, MDA, the run comparison, host details — goes through it. A new link that reads `host` directly reintroduces the bug.
2. **One unset representation.** The column is NULL when unset. Create collapses `''` to `undefined`; update treats `null` and `''` alike as "clear it", and only an **absent key** leaves the stored value alone. That is what lets a client GET a config and POST/PATCH it back without special-casing a cleared field.
3. **It is never fetched server-side, so it is not normalised like `host`.** `normalizeUrl` is an SSRF guard for URLs the API calls; `client_url` only ever reaches `window.open`. Its guard is a pinned scheme instead — `@IsUrl({ protocols: ['http','https'], require_protocol: true })` on both DTOs, mirrored by a `httpsOnly` refine in `apps/web/lib/validations.ts`. Drop `require_protocol` and validator.js stops consulting the protocol list entirely, so `javascript:alert(1)` passes. `require_tld` stays off on purpose for internal hostnames.

Related: `createPlatformUrl` rewrites **only** a single-label SaaS tenant URL (`https://<tenant>[.live].dynatrace.com`) to its `<tenant>.apps.dynatrace.com` twin. Anything else — a Managed host, a proxy address, a URL already naming the platform host — comes back untouched. Before v0.2.92.0 it string-replaced blindly and produced `<tenant>.apps.apps.dynatrace.com` or grafted `.apps.dynatrace.com` onto a Managed hostname.

### ADAPT's baseline depends on the `pct_agg` sketch

`ds_metric_statistics.pct_agg` is the per-run t-digest added in #289. `ControlGroupStatisticsPipeline` pools those sketches with `rollup(pct_agg)` — the fast path. Rows written before #289, or restored from a backup or a SUT transfer, have `pct_agg = NULL`, which forces the legacy path: a raw scan over `ds_metrics`. On a large baseline that scan runs out of time, `ds_control_group_statistics` is left empty, and ADAPT reports INSUFFICIENT_DATA against a baseline that is actually fine.

**Which timeout applies changed in v0.2.93.3.** Both aggregation transactions now call `BasePipelineTypeORM.setAggregationBudget()` as their first statement, so they run under `AGGREGATION_STATEMENT_TIMEOUT_MS` (default 540s) rather than the `ANALYTICS_STATEMENT_TIMEOUT_MS` cap (default 120s) that the rest of the analytics pool uses. Both live in `apps/worker/src/config/environment.ts`. Two consequences when you are reading a timeout in the log: the number you are up against is 540s unless the deploy lowered it, and **lowering `ANALYTICS_STATEMENT_TIMEOUT_MS` no longer shortens these two jobs** — it never reaches them.

Four things to know before touching this path:

1. **The pipeline self-heals first (v0.2.90.0, #552).** `backfillMissingSketches()` runs *before* the aggregation transaction: it finds control runs whose `ds_metric_statistics` rows have `pct_agg IS NULL` and reruns `StatisticsPipeline` on them, so the fast path applies instead of walking into a known timeout. It is **best-effort by contract** — any failure is caught and the legacy raw scan still runs, which is why the legacy-path warning now says the backfill did not repair the rows. `StatisticsPipeline` can also succeed while writing nothing (no `ds_metrics` rows left), so success alone does not mean the sketches exist; the code checks `processedRecords` and logs which happened.
2. **The manual escape hatch is `POST /api/data/recalculate-statistics/:testRunId`** → `BullMQClientService.enqueueStatisticsCalculation()` on the **`perfana-analyze`** queue (not the batch queue `addJob` uses), jobId `statistics-<testRunId>` so repeated clicks coalesce. The job record is *not* retained after it settles — BullMQ refuses an `add` whose jobId still exists, so retention would make every later click a silent no-op behind a "started" toast. In the UI it is the **Recalculate baseline statistics** button rendered by `AnomalyDetectionSubsection` (`EvaluationResultsSection.tsx`) beside the ADAPT message itself — deliberately not a permanent menu item, since it helps for exactly one cause. It posts for each id in the conclusion's `details.controlRuns`, so it repairs the **baseline** runs rather than the run showing the error, and the user never has to know that.
3. **Recalculating fetches nothing.** `StatisticsPipeline` reads only `ds_metrics` and rewrites `ds_metric_statistics`, so it is safe on old runs whose Grafana/Dynatrace window has long expired.
4. **Pass the canonical `test_run_id` to a pipeline, never the UUID.** `verifyTestRunAccess` accepts either and now *returns* `test_run_id`; every pipeline filters on that column, so forwarding the UUID enqueues a job that matches zero rows and reports success.

5. **A timeout in `control-group-statistics` is not always a missing sketch.** The org-scope filter used to be two `IN (SELECT … WHERE organization_id = tr.organization_id)` subqueries correlated on a `test_runs` join. Correlated subqueries cannot be pulled up into a semi-join, so the planner emitted `Join Filter: ((SubPlan 1) OR (SubPlan 2))` — a seq scan of `application_dashboards` plus a sort+unique over `dynatrace_queries` — re-run for **every** `ds_metrics` row. 2.9 M rows × 163 dashboards ≈ 473 M subplan row evaluations. Fixed in v0.2.93.1 by resolving the org once into a `scoped_dashboards` CTE (17.8 s → 3.2 s on the legacy path, 751 ms → 315 ms on the fast path, byte-identical output). Keep it uncorrelated; both `organization_id` columns are NOT NULL, so the old `OR … IS NULL` arms were dead. On a deploy whose DB role lacks `BYPASSRLS` this shape is far worse still, because each of those rows also invokes the PL/pgSQL `can_access_resource` policy — the giveaway in the error is `where: 'PL/pgSQL function can_access_resource(uuid,uuid,text)'`.

   The same planner failure recurs in a second disguise: an **OR between two `IN` subqueries** on the dashboard filter. An OR of two subqueries cannot be pulled up into a semi-join either, so the planner emits `Filter: ((hashed SubPlan 1) OR (hashed SubPlan 2))` and re-evaluates it per candidate row. Three sites are known, all now fixed — the control-group aggregation above, `buildValidDashboardFilterSQL()` in `apps/worker/src/pipelines/helpers/adapt/control-group-processor.ts` (single caller `results-processor.ts:135`), and the empty-control-group probe in `apps/worker/src/pipelines/helpers/adapt/adapt-validator.ts`; the latter two sat on the ADAPT insert path at 102 s and 5.2 M buffer hits. Write a new one as a single `IN` over a `UNION` of the two id sets, with a `WHERE application_dashboard_id IS NOT NULL` arm on the `dynatrace_queries` side (or as a MATERIALIZED CTE where the query owns its own CTE list). The plan then goes from that `Filter` over a full scan to a `Hash Join` over `Index Only Scan using uniq_ds_metric_statistics`, and the two dashboard-id sets are provably the same — a FULL JOIN of old against new returns 0 differing rows.

6. **`ds_metrics` is compressed with `compress_segmentby = 'test_run_id'`, so anything that touches it per-group is a trap — and the write side is worse than the read side.** A compressed chunk holds one segment per run; nothing below `test_run_id` can be pushed into it. Compression starts at 7 days and every run the sketch backfill visits is older than that, so this is the backfill's normal path, not an edge case. A dev database — where chunks are typically uncompressed — will never show either half. Both were fixed in v0.2.93.2:

   - **Reads: one probe per output group.** `StatisticsPipeline` fetched `last_value` with a `LEFT JOIN LATERAL`. TimescaleDB *does* push `ORDER BY time DESC LIMIT 1` into the columnar scan, so a metric still reporting at the end of the run was found in the first batch (~0.04 ms/loop) — the cost is metrics that **stop reporting early**, which force a deep backward walk (~0.97 ms/loop, 24x worse). Enough of those and you exceed the budget (this was measured against the 120 s `ANALYTICS_STATEMENT_TIMEOUT_MS` cap that applied before v0.2.93.3): 60.1 s over 12,370 groups, against 1.19 s for `last(value, time)` in the aggregate pass already running. Aggregate in the single pass. `last()` is core `timescaledb` (not toolkit), `PARALLEL SAFE`, and deterministic here because `uniq_ds_metrics_upsert` is UNIQUE on the group key plus `time`, so no group can hold two rows at the same instant. It needs its own `FILTER (WHERE value IS NOT NULL)`: unlike every other aggregate there, `last()` returns the value *at* the greatest time even when that value is NULL.
   - **Writes: a predicate on a non-segmentby column decompresses the whole run as DML.** `refreshRampUpFlags` runs `UPDATE ds_metrics … WHERE m.ramp_up IS DISTINCT FROM <expr>` immediately before the aggregation, in the same transaction. `ramp_up` is neither segmentby nor orderby, so TimescaleDB decompresses the run's entire segment just to evaluate the guard — **even when zero rows change**. Measured: 53.7 s and 2,620,348 tuples on a 2.6 M-row run whose flags were already correct, ending in `tuple decompression limit exceeded by operation` (`max_tuples_decompressed_per_dml_transaction` defaults to 100 000). "Only rows that actually change are written" does not make such an UPDATE cheap — the guard *is* the expensive part. Ask with a SELECT first (a read decompresses transiently and rewrites nothing: 939 ms on 2.6 M rows, scaling roughly linearly — budget ~8 s on a 20 M-row run — and the chunks stay compressed), and when a write really is needed call `decompressChunksForRange` outside the transaction first, the way `simple-orchestrate-reevaluate-batch.ts` already does for force-refetch.

   - **Decompress the narrowest span that works, per run — widening it is not free (v0.2.93.3).** `decompress_chunk` works at **chunk** granularity and a chunk holds every run in its time range, so an over-wide range converts other runs' data to row store too, and every later query over that window scans row store until the compression policy catches up. `findRunsWithStaleRampUpFlags` therefore returns `MIN(m.time)`/`MAX(m.time)` **over the disagreeing rows** rather than the run's `start_time`/`end_time`, and both `decompressChunksForRange` and the `UPDATE` are bound to those per-run bounds — one statement per run, never one global min/max across a batch. A stale trailing flag spans minutes; the run-wide bounds it replaced decompressed hours, and a batch of stale runs spanning months decompressed the months between them. The per-run `UPDATE` also earns chunk exclusion: `test_run_id` is `compress_segmentby` and `time` is `compress_orderby`, so TimescaleDB can skip whole batches on their min/max metadata instead of decompressing the run's entire segment to evaluate the `ramp_up` guard. Splitting per run does **not** buy each run its own decompression budget — `max_tuples_decompressed_per_dml_transaction` is charged per **transaction** and all N statements share one. The up-front `decompressChunksForRange` is the only thing keeping the loop under it, which is why its "skipped" path logs at **warn**, not debug (v0.2.93.3): when it silently no-ops (chunk owned by another role, recompressed in between, TimescaleDB error) the caller hits `tuple decompression limit exceeded` with nothing in the log explaining why.

   The two failure modes are told apart only by the error string: the read side is `canceling statement due to statement timeout` inside `aggregateMetricStatistics`; the write side is `tuple decompression limit exceeded` before it. If neither appears and ADAPT still reports INSUFFICIENT_DATA, check whether the chunks are compressed at all — a deploy whose TimescaleDB job scheduler is starved of worker slots (see the Postgres worker budget note above) never runs the compression policy, and neither of these is then your problem.

7. **Do not add a diagnostic that groups raw `ds_metrics` by anything other than its physical key (v0.2.93.3).** `ds_metrics` is organised by `test_run_id` and `time` and nothing else, so a `GROUP BY` on any other combination reads the entire run to return almost nothing. Take the number from `ds_metric_statistics`, where it has already been computed, or from the row count the real work returns anyway. Three counts existed only to write "will process N unique metrics" into the log and to warn on an expected-vs-actual mismatch, and all three read `ds_metrics` in full: `COUNT(*)` over a run's data points (16 s on 20.6 M rows), `COUNT(DISTINCT (test_run_id, dashboard, panel, metric))` (32 s on that same run — a composite `DISTINCT` cannot be parallelised and spills an external sort of anonymous `ROW()` values, which cost 4.7 s and ~370 MB of temp I/O even on a run of only 1.58 M rows), and the control-group twin, which scanned raw `ds_metrics` for every baseline run **on the fast path too** — the one path that exists to avoid exactly that scan. Together they could outlast the statement timeout before the real work started. What survives is the smallest thing that changes a decision: an `EXISTS` probe in `StatisticsPipeline`, which stops at the first row and exists solely to guard the `DELETE` (a run whose `ds_metrics` have aged out must keep its statistics rather than have them wiped and replaced with nothing). Every number the removed logs carried is already in the `INSERT`'s own row count. A zero result after a positive `EXISTS` is now a real problem — most likely org-scoping dropped every dashboard — and is logged as such, because "nothing to do" returned earlier.

   The rule is not confined to those two pipelines — `DataSanityCheckPipeline` was never covered by it and paid the most. Its sparse-metric check grouped raw `ds_metrics` by `(metric_name, dashboard_label, panel_title)` with `HAVING COUNT(*) < $2`; none of those three columns is `compress_segmentby`, so every run was read in full to surface a handful of thin metrics. Profiled with `pg_stat_statements` across a re-evaluate of 4 large runs it was **92% of all block reads on the deployment**: 4 calls, 12,613,099 shared blocks read (~103 GB) against 1,154,636 hits, 70,062 ms, 6,234 rows returned — 16.5 MB read per row returned. It now sums the per-metric `count` that `StatisticsPipeline` writes into `ds_metric_statistics` in the stage immediately before (`SUM(count) … GROUP BY metric_name, dashboard_label, panel_title HAVING SUM(count) < $2`). That changes what the threshold means, deliberately: `ds_metric_statistics` counts only non-null values inside the analysis window (`ramp_up = false`) and only org-scoped dashboards, where the old count included ramp-up rows and NULLs — so it now measures points that actually reach analysis. Two consequences, both deliberate. It fires **more** often: a metric with 1000 raw points of which 998 are in a long ramp-up used to count 1000 and stay silent, and now counts 2 and warns — expect new warnings on existing runs with a large `analysisStartOffset`. And it fires **less** on one case: a metric whose points are *entirely* in ramp-up (or that sits on a dashboard outside the org scope) gets no `ds_metric_statistics` row at all, so it is not a group and cannot be flagged. That gap is **not** covered by the "No steady-state data" reason — that branch only runs when the whole run has zero statistics, so a handful of all-ramp-up metrics inside an otherwise healthy run now go unreported. Two smaller reads in the same pipeline went the same way: `SELECT COUNT(*) FROM ds_metrics WHERE test_run_id = $1`, whose result was only ever compared against zero, is an `EXISTS` probe (it was 11.1 s and 66k blocks), and the `avg_timestep_sec` in the warning text — the only remaining reason to pull `MIN(time)`/`MAX(time)` off that scan — is gone, replaced by the run duration the message already had in scope. Do not "restore" it by dividing the duration by the point count: 3 points clustered in the first 90 s of a 3600 s run are 45 s apart and that arithmetic would call them 1800 s.

8. **The analysis offsets must FIT inside the run, and the check lives in two mirrored places (v0.2.93.3).** The analysis window is `[start + analysisStartOffset, end - analysisEndOffset]`. When a short run meets offsets configured for a long one, the leading and trailing exclusions overlap, every sample matches one of them, and the entire run is flagged outside the window. Nothing downstream reports that as a misconfiguration: `ds_metric_statistics` comes out empty, the Apdex rollup misses on every transaction and falls back to the slow path, and ADAPT writes INSUFFICIENT_DATA against a run that plainly has data. It is also the worst case for `refreshRampUpFlags`, which then rewrites every row of a compressed run instead of the boundary band the per-run bounds exist to narrow it to. The fallback is to analyse the **whole** run — the offsets are a request to trim, not to discard — guarded by `duration > ramp_up + ramp_down`. That guard exists **twice**: `MetricsPipeline` bakes the flag at ingestion, `RAMP_UP_EXPR` in `StatisticsPipeline` recomputes it on recalculation. Change one and you must change the other, or a run's flags flip depending on which path last touched it.

Related: `control-group-statistics` is registered with `softFail`, so a failed aggregation still completes its BullMQ job. The reevaluate orchestrator reads the job's return value through the exported `assertStageSucceeded()` (`apps/worker/src/workers/simple-orchestrate-reevaluate-batch.ts`) instead of logging a green tick and running ADAPT on an empty baseline. Any new stage waiting on a `softFail` pipeline has to do the same.

### The transaction time-series route pads one series and deliberately not the other

`GET /test-runs/:id/transactions/:name/timeseries` returns two things: `transaction_data`, one series for the whole transaction, and `sampler_data`, one series per sampler. **`transaction_data` is padded against a `generate_series` bucket grid; `sampler_data` is not, and must not be.** Padding the sampler side costs buckets x samplers rows — on a 3 h run with 19 samplers that was 41,420 rows carrying 560 rows of data, an 11.8 MB response instead of 173 KB.

The padding is still required for the **render**, just not on the wire, and the two halves only work as a pair:

1. **Plotly will not fill a bucket that no trace has.** The sampler chart is a stacked area (`stackgroup` with `stackgaps: 'infer zero'`), and `infer zero` only fills a bucket some *other* trace in the stackgroup carries. A bucket where every sampler was silent is absent from the group's x-union entirely, so the filled band interpolates straight across it — an idle window or a real outage renders as a solid coloured band.
2. **So the client re-grids instead.** `buildSamplerTraces` (`apps/web/app/test-runs/[id]/components/performance-analysis/transaction-graph-modal/utils/trace-builders.ts`) rebuilds every sampler series against the buckets in `transaction_data`, which *is* still padded, inserting `null` where that sampler has nothing. It costs nothing on the wire.

Do not "simplify" either half. Removing the server-side padding, or the client re-grid, draws outages as solid bands; restoring the sampler-side LEFT JOIN brings back the 11.8 MB response.

**`aggregationSeconds` is optional on this route** (it stays required-with-a-default on the sibling single-sampler route). Omitted means the server picks the bucket size from the run duration via `AGGREGATION_LADDER` in `apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.ts`, aiming at roughly 360 points per series. Two consequences:

- **The response echoes `aggregation_seconds`, and a client must divide throughput counts by that, never by an assumed 5.** The counts are per bucket, so a client that hardcodes 5 against a 300 s bucket draws throughput 60x too low.
- **A rung added to the ladder must be added to BOTH web option lists** — `transaction-graph-modal/utils/chart-config.ts` and `RequestTimeSeriesModal.tsx` — or the MUI `Select` is handed a value with no matching `MenuItem` and renders blank.

Related: responses now differ in size by ~60x across bucket choices, so `useTransactionGraphData` tags each request with a sequence number and drops stale ones. A small 300 s response routinely lands before a large 5 s one issued earlier, and last-write-wins on arrival pairs one response's data with another response's divisor.

### Common Issues

1. **"Failed to fetch"** → Missing `...getAuthHeaders()` in fetch calls
2. **401 Unauthorized** → Expired token, Keycloak handles refresh
3. **403 Forbidden** → Wrong auth type for admin endpoints
4. **`null value in column "organization_id" violates not-null constraint`** → You passed `organization_id` (snake_case) to `repo.create()`. Use `organizationId` (camelCase). See "Resource creation" pattern above.
5. **409 deleting a Grafana dashboard** → Application dashboards still reference it. Remove those first; the API will not cascade. See "`grafana_dashboards` is a mixed table" above.
6. **ADAPT says it could not build a baseline / INSUFFICIENT_DATA on a healthy baseline** → the baseline's `ds_metric_statistics` rows are missing `pct_agg` and the control-group aggregation timed out. The pipeline now repairs this itself; if it could not, use the **Recalculate baseline statistics** button beside the message, then re-evaluate. See "ADAPT's baseline depends on the `pct_agg` sketch" above.
7. **INSUFFICIENT_DATA on the run itself, with empty statistics and an Apdex that misses every transaction** → different cause from #6: the run is shorter than `analysisStartOffset + analysisEndOffset`, so the two exclusions overlap and the whole run reads as outside the analysis window. Fixed in v0.2.93.3 (the whole run is analysed when the offsets do not fit); on an older deploy, shorten the offsets for that workload. See item 8 of "ADAPT's baseline depends on the `pct_agg` sketch" above.
8. **Transaction time-series graph draws a solid band across an idle window, or throughput reads far too low** → the sampler series is sent unpadded on purpose. Either the client-side re-grid in `buildSamplerTraces` was removed, or a caller is dividing counts by an assumed 5 instead of the response's `aggregation_seconds`. See "The transaction time-series route pads one series and deliberately not the other" above.
9. **A re-evaluate is slow, the buffer cache hit ratio has collapsed, and no single query looks slow enough to blame** → order `pg_stat_statements` by `shared_blks_read`, not by `total_exec_time`, and look for a diagnostic grouping raw `ds_metrics`. A query can read 103 GB to return 6,234 rows while ranking unremarkably by wall clock, and it evicts everything else's pages on the way. See item 7 of "ADAPT's baseline depends on the `pct_agg` sketch" above.

## How-To Tutorials

### Tutorial 1: How to Add a New Metrics Source

A metrics source represents a data provider (e.g., Grafana, Dynatrace, Prometheus). To add a new one (e.g., `datadog`):

**Step 1: Add the type to the entity**

In `packages/shared/src/entities/metrics-source.entity.ts`, add your type to the `MetricsSourceType` union:

```typescript
export type MetricsSourceType =
  | 'grafana'
  | 'dynatrace'
  | 'prometheus'
  | 'influxdb'
  | 'performance_test'
  | 'datadog';  // <-- new
```

**Step 2: Create a pipeline**

Create a new file in `apps/worker/src/pipelines/` (e.g., `DatadogPipeline.ts`). Extend `BasePipelineTypeORM` from `apps/worker/src/pipelines/BasePipelineTypeORM.ts`:

```typescript
import { BasePipelineTypeORM } from './BasePipelineTypeORM.js';
import { PipelineResult } from '../types/pipeline.js';

export class DatadogPipeline extends BasePipelineTypeORM {
  validateInput(input: unknown): boolean { /* ... */ }
  async execute(input: unknown): Promise<PipelineResult> { /* ... */ }
}
```

See `apps/worker/src/pipelines/DynatracePipeline.ts` for a complete non-Grafana source example.

**Step 3: Add a job name constant**

In `apps/worker/src/types/jobs.ts`, add a new entry to `JOB_NAMES`:

```typescript
DATADOG_COLLECTION: 'datadog-collection',
```

Also add a Zod schema for input validation and an entry in `ENHANCED_JOB_CONFIGS` and `JOB_QUEUE_CONFIGS`.

**Step 4: Register the pipeline**

In `apps/worker/src/workers/pipeline-registrations.ts`, import your pipeline and call `registerPipeline()`:

```typescript
import { DatadogPipeline } from '../pipelines/DatadogPipeline.js';

registerPipeline({
  jobName: JOB_NAMES.DATADOG_COLLECTION,
  createPipeline: (logger) => new DatadogPipeline(logger),
  successMessage: 'Datadog collection',
});
```

See `apps/worker/src/workers/pipeline-registry.ts` for the registry interface.

**Step 5: Add API support**

Add endpoints to the API for configuring the new source. Follow the module pattern in `apps/api/src/modules/metrics-sources/` (controller, service, module, DTOs). Reference `apps/api/src/modules/test-runs/test-runs.module.ts` for the NestJS module structure.

**Step 6: Add frontend display**

Update the frontend to show the new source type. Existing pages live under `apps/web/app/test-runs/` and `apps/web/app/integrations/`.

**Step 7: Add tests**

- Worker: add unit tests in `apps/worker/src/test/unit/pipelines/` and integration tests in `apps/worker/src/test/integration/` (Vitest)
- API: add `.spec.ts` files alongside the controller/service (Jest)

**Step 8: Create a database migration**

```bash
npm run migration:generate -- src/database/migrations/AddDatadogSupport
```

Migrations live in `packages/shared/src/database/migrations/`.

---

### Tutorial 2: How to Add a New Pipeline

Pipelines are BullMQ job processors that perform background work (metrics collection, analysis, etc.).

**Step 1: Create the pipeline class**

Create a new file in `apps/worker/src/pipelines/`. Extend `BasePipelineTypeORM`:

```typescript
import { BasePipelineTypeORM } from './BasePipelineTypeORM.js';
import { PipelineResult } from '../types/pipeline.js';

export class MyNewPipeline extends BasePipelineTypeORM {
  async execute(input: unknown): Promise<PipelineResult> {
    const startTime = Date.now();
    // Use this.db for database access
    // Use this.withTransaction() for transactional operations
    // Use this.loadTestRun() to fetch test run data
    return this.createSuccessResult({ /* data */ }, Date.now() - startTime);
  }
}
```

Key base class methods (from `apps/worker/src/pipelines/BasePipelineTypeORM.ts`):
- `this.db` -- `WorkerDatabaseService` for queries
- `this.withTransaction(fn)` -- TypeORM transaction wrapper
- `this.createSuccessResult()` / `this.createErrorResult()` -- result builders
- `this.logPerformance()` / `this.logError()` -- structured logging

**Step 2: Add a Zod schema for input validation**

In `apps/worker/src/types/jobs.ts`:

```typescript
export const MyNewJobSchema = z.object({
  testRunIds: z.array(z.string()).min(1),
});
```

Also add a job name to `JOB_NAMES`, a config to `ENHANCED_JOB_CONFIGS`, and a queue config to `JOB_QUEUE_CONFIGS`.

**Step 3: Register the pipeline**

In `apps/worker/src/workers/pipeline-registrations.ts`:

```typescript
registerPipeline({
  jobName: JOB_NAMES.MY_NEW_PIPELINE,
  schema: MyNewJobSchema,
  createPipeline: (logger) => new MyNewPipeline(logger),
  successMessage: 'My new pipeline',
});
```

Options: use `transformInput` to reshape job data, `softFail: true` to return failure instead of throwing.

**Step 4: Add tests**

- Unit test: `apps/worker/src/test/unit/pipelines/MyNewPipeline.test.ts`
- Integration test: `apps/worker/src/test/integration/my-new-pipeline.integration.test.ts`

Run with: `cd apps/worker && npx vitest run`

---

### Tutorial 3: Common Tasks

#### Add an API Endpoint

1. Create a module directory: `apps/api/src/modules/<your-module>/`
2. Create these files following the test-runs module pattern:
   - `<name>.module.ts` -- NestJS module (see `apps/api/src/modules/test-runs/test-runs.module.ts`)
   - `<name>.service.ts` -- business logic (see `apps/api/src/modules/test-runs/test-runs.service.ts`)
   - `controllers/<name>.controller.ts` -- route handlers (see `apps/api/src/modules/test-runs/controllers/test-runs.controller.ts`)
   - `dto/<name>.dto.ts` -- request/response DTOs (see `apps/api/src/modules/test-runs/dto/`)
3. Register the module in the app module
4. All endpoints are protected by default; use `@Public()` to make one public
5. Add Swagger decorators: `@ApiTags`, `@ApiOperation`
6. Add tests: `<name>.service.spec.ts` and `<name>.controller.spec.ts` (Jest)

#### Add a Frontend Page

1. Create a directory under `apps/web/app/` following Next.js App Router conventions
2. Add `page.tsx` for the route (see existing pages: `apps/web/app/test-runs/page.tsx`, `apps/web/app/settings/page.tsx`)
3. For dynamic routes, use `[id]/page.tsx` (see `apps/web/app/test-runs/[id]/page.tsx`)
4. All API calls must include auth headers -- use `authenticatedFetch()` from `@/lib/api`

#### Add a Database Migration

1. Make entity changes in `packages/shared/src/entities/`
2. Generate the migration:
   ```bash
   npm run migration:generate -- src/database/migrations/DescriptiveName
   ```
3. Migrations are created in `packages/shared/src/database/migrations/`
4. Migrations run automatically on service startup
5. Review the generated SQL before committing

---

### Tutorial 4: Testing Patterns

| App | Framework | Config | Run |
|-----|-----------|--------|-----|
| Worker | Vitest | `apps/worker/vitest.config.ts` | `cd apps/worker && npx vitest run` |
| API | Jest | `apps/api/jest.config.js` | `cd apps/api && npx jest` |
| Web | Jest | `apps/web/jest.config.js` | `cd apps/web && npx jest` |
| Grafana Sync | Jest | `apps/grafana-sync/jest.config.js` | `cd apps/grafana-sync && npx jest` |

Run all tests from the repo root: `npm run test`

**Worker test structure** (Vitest):
- Unit tests: `apps/worker/src/test/unit/` (e.g., `pipelines/DynatracePipeline.test.ts`, `services/DataProcessor.test.ts`)
- Integration tests: `apps/worker/src/test/integration/` (e.g., `dynatrace-pipeline.integration.test.ts`)
- Golden file tests: `apps/worker/src/test/golden-files/`
- Edge case / performance tests: `apps/worker/src/test/edge-cases/`, `apps/worker/src/test/performance/`

**API test structure** (Jest):
- Tests live alongside source files with `.spec.ts` suffix
- Controllers: `apps/api/src/modules/test-runs/test-runs.controller.spec.ts`
- Services: `apps/api/src/modules/test-runs/test-runs.service.spec.ts`
- DTOs: `apps/api/src/modules/test-runs/dto/test-run-config.dto.spec.ts`
- E2E tests: `apps/api/src/modules/test-runs/test-runs.e2e-spec.ts`

**Web test structure** (Jest):
- Tests live alongside components with `.spec.ts` or `.test.ts` suffix

## Health Stack

- typecheck: turbo run type-check
- lint: turbo run lint
- test: turbo run test
- deadcode: npx knip
- shell: shellcheck $(git ls-files '*.sh') .githooks/pre-push — optional local tool (`brew install shellcheck`); not wired into preflight so a machine without it can still push.
- schema constraints: `npm run check:schema-constraints -- --target <url> --reference <url>` — reports every NOT NULL / CHECK / UNIQUE / PK / FK a deployment is missing relative to a freshly migrated database, with the `ALTER TABLE` for each and the violating-row count for a NOT NULL. Read-only. Build the reference with `DB_NAME=perfana_ref npm run migration:run` on an empty database. Not in preflight — it needs two live databases, one of which is the deployment's.
- **preflight (pre-push gate): npm run preflight** — runs lint + type-check across the monorepo, then the API RLS test suite (`apps/api/src/test/rls/` with `DB_ENABLE_RLS_ROLE=true`). Wired to `git push` via `.githooks/pre-push` (auto-installed by `npm install` via the `prepare` script). Local-only by design — turbo's cache makes warm runs sub-second, and the RLS suite is ~3s. The RLS step targets the local dev DB (`perfana` on `localhost:5432` by default; override with `DB_NAME`); it requires Phase 5b migrations to be applied (cluster roles `perfana_app`/`perfana_system` + per-DB RLS policies and helper functions). Bypass: `git push --no-verify` (use sparingly).

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **perfana** (34285 symbols, 59845 relationships, 208 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/perfana/context` | Codebase overview, check index freshness |
| `gitnexus://repo/perfana/clusters` | All functional areas |
| `gitnexus://repo/perfana/processes` | All execution flows |
| `gitnexus://repo/perfana/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
