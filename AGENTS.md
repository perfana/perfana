# Perfana — AI Agent Instructions

Performance analysis platform — ingests load test results, collects metrics from Grafana/Dynatrace/Prometheus, runs ADAPT regression detection, provides dashboards with SLO compliance.

## Quick Start

```bash
npm install
docker compose -f docker-compose.infra.yml up -d
# Wait for Postgres + Keycloak to be healthy, then:
npm run dev
```

- API: http://localhost:3001/api/docs (Swagger)
- Web: http://localhost:4001
- Keycloak: http://localhost:8080 (admin/admin, realm: perfana-prod)
- Login: perfana@example.com / perfana

## Project Index

> **Progressive disclosure:** Scan this index. Read only what's relevant to your task.

| Area | Path | What's there | Docs |
|------|------|-------------|------|
| API | `apps/api/` | NestJS REST API, 36+ modules | [CODING_RULES](apps/api/CODING_RULES.md) |
| Frontend | `apps/web/` | Next.js, MUI + Radix + Tailwind | [CODING_RULES](apps/web/CODING_RULES.md) |
| Worker | `apps/worker/` | BullMQ pipelines, ADAPT algorithm | [README](apps/worker/README.md) |
| Grafana Sync | `apps/grafana-sync/` | Dashboard sync background service | [CODING_RULES](apps/grafana-sync/CODING_RULES.md) |
| Shared | `packages/shared/` | TypeORM entities, types, utils | [README](packages/shared/README.md) |
| Config | `packages/config/` | TypeORM config factory | — |
| MCP Server | `apps/mcp/` | MCP tool server for AI agents | [README](apps/mcp/README.md) |
| Report | `apps/perfana-report/` | Report generation service | [README](apps/perfana-report/README.md) |
| Deep Reference | `docs/reference/` | ADAPT, RBAC, schemas, features (narrative). For derivable "how does X work / what calls this" use GitNexus. | [Index](docs/reference/index.md) |
| Infra | `docker-compose.infra.yml` | Full local stack | — |

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

- `npm run dev` — Start all services (api :3001, web :4001, grafana-sync :3002, worker)
- `npm run build` / `npm run test` / `npm run type-check` / `npm run lint`
- `npm run dev:api` / `npm run dev:web` / `npm run dev:grafana-sync` — Individual services
- `lsof -ti:3001,3002,4001 | xargs kill -9 && npm run dev` — Kill and restart

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
| Phase 1 | Role definitions & constants | Completed |
| Phase 2 | Membership & ownership infrastructure | Completed |
| Phase 3 | Service-layer authorization enforcement | Lint-enforced (allowlist empty) |
| Phase 4 | Data migration — `organization_id` NOT NULL on owned resources | Completed (2026-05-02) |
| Phase 5a | Audit logging | Completed (2026-05-04 — allowlist empty; 29 services migrated, 27 closed via `POLICY_EXEMPT`). On deploys upgraded before v0.2.73.0 the trail is empty from 2026-08-01 until the default-partition fix lands — the rows were rejected, not hidden. |
| Phase 5b | Row-Level Security | Shipped — `RlsTransactionInterceptor` opens a per-request transaction, runs `SET LOCAL ROLE perfana_app`, and sets four `app.current_*` GUCs the policies read. Owned-resource repository calls go through `withRequestEm()` (`apps/api/.rls-em-migration-allowlist.json` is empty). `npm run preflight` runs `apps/api/src/test/rls/`. One deliberate carve-out — see "API-key organization resolution" below. |

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
- `organization_id` - Organization the resource belongs to (NOT NULL on all 26 owned-resource entities as of Phase 4; nullable only on `audit_logs`, for system-level events with no org context. `test_runs.organization_id` is NOT NULL in the DDL — the service-layer check still reads the joined system's column)
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

An API-key principal (`api-key:{uuid}`) gets its organization from the `api_keys` row itself, not from `organization_members`. `AuthorizationService.isOrganizationMember` and `getAccessibleOrganizations` read that row through the **plain pooled repository**, not `withRequestEm()` — both sites carry an `eslint-disable-next-line owned-resource-must-use-request-em`. Do not "fix" this back:

- **Scoping it is circular.** `RlsTransactionInterceptor` calls `getAccessibleOrganizations` to *build* `app.current_user_organizations`, which is what `rls_api_keys_select` then reads. The key would have to already be in the organization to prove it is in the organization.
- **The membership cache demands a context-free answer.** `buildOrgMembershipKey` carries no RLS context, so a context-dependent result would be cached and replayed.
- **Safe only because `userId` is the authenticated principal.** Passing a third-party `userId` here would make it a cross-org membership oracle.

**Deployment constraint**: `api_keys` is `FORCE ROW LEVEL SECURITY`, so this read returns rows only because the API's login role is `rolsuper`/`rolbypassrls`. Under a least-privilege role without that bypass, both api-key branches return zero rows and every API key silently loses organization access, surfacing as the misleading denial `user is not a member of organization X`. Nothing enforces this yet (filed in TODOS.md).

`api_keys` rows are treated as immutable and delete-only; the `api-key:<id>` membership cache is invalidated in `ApiKeysService.deleteApiKey`. A revoke flag or org-move endpoint would need that invalidation to grow.

### RLS does not backstop a caller-named `organization_id` on create

`can_access_resource` is a chain of ORs whose **last** branch is `created_by = current_user_id()` — a fallback, not a short-circuit. On an INSERT the org check fails first (the caller is not a member of the org the body named), the team check fails, and the creator check then returns TRUE anyway because an inserted row is self-created by definition. So `WITH CHECK (can_access_resource(...))` admits the row whatever organization it carries. `rls_dynatrace_configs_insert` is the worked example; the shape is shared by every owned-resource insert policy.

So **a create endpoint that reads `organizationId` from the request body must check membership itself** — `@RequiresCapability(Capability.X, { orgIdFromBody: 'organizationId' })` on the controller, or `getCapabilities(userId, roles, organizationId)` in the service before the write, defaulting to `getAccessibleOrganizations(userId)[0]` when the body names none. `DynatraceService.create` was missing this until v0.2.92.0: any authenticated user could plant a Dynatrace configuration — including the browser-facing `client_url` org members then follow out of Perfana — into an organization they did not belong to.

### Per-resource authorization in test-runs

`TestRunsCrudQueryService` splits two patterns that look alike:

- **List methods** use `withOrgFilter` / `withTeamFilter` to compute the accessible sets once.
- **Per-resource methods** (`findByTestRunId`, `findOne`, `getTestRunByTestRunId`) delegate to the private `denialReason()` helper, which calls `isOrganizationMember` / `canViewTeamResources` on the single row via the joined `SystemUnderTest`.

`denialReason()` **fails closed**: a missing `systemUnderTest` relation is a denial, not a skip. `system_under_test_id` is NOT NULL, so a null relation means the LEFT JOIN produced nothing — under RLS a legitimate refusal, since a run can be visible via its own `created_by` while its system is policy-filtered.

All five denial causes return an indistinguishable refusal (404, or `null` from `getTestRunByTestRunId`) so nobody learns whether a run exists. The **server log is the only place they are distinguishable**, so any new caller of `denialReason()` must log the returned reason before refusing. Caller-supplied ids go through `forLog()` first — `testRunId` is a raw path parameter and Express percent-decodes path segments, so an unsanitized `%0A` would let a caller forge lines in the denial stream.

### Ownership column nullability

- `organization_id` is **NOT NULL** on all 26 owned-resource entities (Phase 4, 2026-05-02). The "null org = visible to all authenticated users" backward-compat rule is gone.
- Exception intentionally kept nullable: `audit_logs.organization_id` (system-level events with no org context). `test_runs.organization_id` is NOT NULL in the DDL and `rls_test_runs_select` reads it directly, but the service-layer per-resource check still goes through the joined `SystemUnderTest` (the TypeORM entity also still declares it `nullable: true` — drift against the DDL).
- `audit_logs` is RANGE-partitioned by month and carries an `audit_logs_default` DEFAULT partition (v0.2.73.0). Nothing at runtime creates partitions — `perfana_app`/`perfana_system` hold `USAGE` but not `CREATE` on schema `public` — so the default is what keeps an audit write from being rejected once the shipped months run out, and it is where every row lands from here on. Every partition has RLS enabled with no policies of its own: the parent's policies cover parent-routed access, and direct access (`SELECT * FROM audit_logs_2026_07`) is deny-all. A partition does **not** inherit the parent's RLS, so one created by hand needs `ENABLE` + `FORCE` immediately, and attaching it full-scans `audit_logs_default` under ACCESS EXCLUSIVE. Retention is `AuditRetentionManager`'s nightly batched `DELETE` of rows past `AUDIT_RETENTION_MONTHS` (default 24), never `DROP TABLE` — that needs an ownership the worker's role lacks.
- `team_id` remains nullable on all entities — teams are optional even on owned resources.
- Authorization enforcement (Phase 3) is now lint-enforced and the data layer (Phase 4) prevents the escape hatch.

### Resource creation pattern (avoid the camelCase / snake_case TypeORM gotcha)

When creating a child resource via `repo.create({...})`, you MUST use the **camelCase entity property name** (e.g. `organizationId`), not the **snake_case DB column name** (e.g. `organization_id`). TypeORM silently drops unknown properties when an entity declares `@Column({ name: 'organization_id' }) organizationId!: string`. A snake_case key compiles, runs, and INSERTs without an org id — which slams into the Phase 4 NOT NULL constraint at runtime, not compile time.

Two correct patterns:
- **Inherit from parent**: load the parent (SUT, Profile, GrafanaInstance, TestRun) and copy `organizationId` + `teamId` onto the child entity in `repo.create({...})`.
- **Default to user's first accessible org**: when a top-level resource accepts an optional `organizationId?` from the DTO, fall through to `AuthorizationService.getAccessibleOrganizations(userId)[0]` and throw `ForbiddenException` if the user has zero accessible orgs.

v0.2.47.66 + v0.2.47.67 fixed 18 sites with this pattern. New services should follow it from day one.

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
- `AUDIT_RETENTION_MONTHS` - How long `audit_logs` rows are kept, in months (default: `24`). Read by the **worker**: `AuditRetentionManager` deletes older rows on boot and daily at 03:00 UTC and logs the count. Retention is a `DELETE`, not a partition `DROP` — the worker's `perfana_system` role owns no tables.

**Frontend:**
- `NEXT_PUBLIC_API_URL` - Backend API base URL (defaults to localhost:3001/api)
- `NEXT_PUBLIC_KEYCLOAK_URL` - Keycloak server URL
- `NEXT_PUBLIC_KEYCLOAK_REALM` - Keycloak realm name
- `NEXT_PUBLIC_KEYCLOAK_CLIENT_ID` - Keycloak client ID
- `NEXT_PUBLIC_USE_KEYCLOAK_AUTH` - Enable/disable Keycloak auth (default: `true`)

## Common Patterns

### Error Handling

Use the safe `instanceof Error` pattern:

```typescript
catch (err) {
  const msg = err && typeof err === 'object' && 'message' in err
    ? (err as Error).message : 'Unknown error';
}
```

### `grafana_dashboards` is a mixed table

Not every row is a real Grafana dashboard. `ensureArtificialDashboardExists()` in `apps/api/src/modules/dynatrace/dynatrace.repository.ts` writes **artificial** placeholder rows so non-Grafana sources have somewhere to hang their panels, with a synthetic `grafana_id` from an 800000+ range for Dynatrace. Artificial rows have `grafana_json` NULL and must never be pushed to Grafana.

**Never classify by `grafana_id`.** The range convention in that comment (800000+ Dynatrace, 900000+ perf-test) holds in neither direction: nothing emits 900000+, and real Grafana ids are snowflake-style and far larger than both ranges — 40 of 46 rows on the dev database sit above 900000 and are all real. A `grafana_id >= 800000` test would call the whole table artificial. Use `grafana_json` and the `metrics_sources` join.

- **Do not tighten the API's `findAll` filter.** Its `source_type != 'grafana'` exclusion is skipped when a `uid` is supplied, on purpose: the SLO dialog and `useAddSLOForm`'s by-uid lookup both need artificial rows. A test (`useDashboardManagement.artificialDashboards.test.ts`) guards this. Filter client-side with `isArtificialDashboard` (`apps/web/lib/metrics-source-utils.ts`) instead.
- That predicate also misses artificial application dashboards from a SUT import — those have `metrics_source_id` NULL. Where a filter must hold (grafana-sync restore), `grafana_json` is the reliable signal.
- A dashboard `uid` is unique only within a Grafana instance, so every lookup by uid must also scope by `grafana_instance_id`. Both the grafana-sync restore sweep and the uid arm of `GrafanaDashboardsService.remove`'s pre-check do — the latter shipped unscoped in v0.2.89.0 and caused a false 409, fixed in v0.2.89.1.
- `DELETE /api/grafana/dashboards/:id` returns **409** when application dashboards still reference the dashboard. It does not cascade: Grafana dashboards are shared and a SUT delete leaves them behind on purpose. Remove the references via `/api/grafana/application-dashboards` first.

### Client URL vs server URL: Grafana and Dynatrace have opposite polarity

Both integrations can point the browser at a different address than the API calls (reverse proxy, split DNS). Which column is required is **inverted** between them, deliberately — do not "align" them.

| | Server-side URL | Browser-facing URL |
|---|---|---|
| `grafana_instances` | `server_url` — optional | `client_url` — **required** |
| `dynatrace_configs` | `host` — **required** | `client_url` — optional (v0.2.92.0) |

Grafana's required column is the client one because Perfana renders Grafana panels in the browser; Dynatrace's is the server one because every Dynatrace API call is server-side. The optional column falls back to the required one when unset.

For Dynatrace: read the base through `deepLinkBaseUrl(config)` in `apps/web/app/test-runs/[id]/components/dynatrace/utils/dynatrace-formatters.ts` (returns `clientUrl || host`), never `config.host` — a new link reading `host` reintroduces the bug. The column has exactly **one unset representation** (NULL): create collapses `''` to `undefined`, update treats `null` and `''` alike as "clear it", and only an absent key leaves the stored value alone. It is never fetched server-side, so it skips `normalizeUrl` (an SSRF guard) and is guarded by a pinned scheme instead — `@IsUrl({ protocols: ['http','https'], require_protocol: true })`; drop `require_protocol` and validator.js never consults the protocol list, so `javascript:alert(1)` passes.

`createPlatformUrl` rewrites **only** a single-label SaaS tenant URL (`https://<tenant>[.live].dynatrace.com`) to `<tenant>.apps.dynatrace.com`. A Managed host, a proxy address, or a URL already naming the platform host comes back untouched.

### ADAPT's baseline depends on the `pct_agg` sketch

`ds_metric_statistics.pct_agg` is the per-run t-digest from #289; `ControlGroupStatisticsPipeline` pools the sketches with `rollup(pct_agg)`. Rows written before #289 — or restored from a backup or SUT transfer — have `pct_agg = NULL`, forcing a raw scan over `ds_metrics` that exceeds `ANALYTICS_STATEMENT_TIMEOUT_MS` (default 120s) on a large baseline. `ds_control_group_statistics` stays empty and ADAPT reports INSUFFICIENT_DATA against a baseline that is fine.

- **Self-heal first (v0.2.90.0, #552).** `backfillMissingSketches()` reruns `StatisticsPipeline` on control runs missing `pct_agg` *before* the aggregation transaction. Best-effort by contract: a failure is caught and the legacy raw scan still runs. `StatisticsPipeline` can succeed while writing nothing (no `ds_metrics` rows left), so the code checks `processedRecords` rather than trusting `success`.
- **Manual escape hatch:** `POST /api/data/recalculate-statistics/:testRunId` → `enqueueStatisticsCalculation()` on the **`perfana-analyze`** queue, jobId `statistics-<testRunId>`, not retained after it settles (a retained record would make every later click a silent no-op). In the UI: the **Recalculate baseline statistics** button beside the ADAPT message (`AnomalyDetectionSubsection` in `EvaluationResultsSection.tsx`), shown only for `details.cause === 'baseline-aggregation-failed'`. It posts for each id in `details.controlRuns`, so it targets the **baseline** runs, not the run showing the error.
- It fetches nothing — `StatisticsPipeline` reads only `ds_metrics`, so it is safe on runs whose Grafana window has expired.
- **Pass a pipeline the canonical `test_run_id`, never the UUID.** `verifyTestRunAccess` accepts either and returns `test_run_id`; pipelines filter on that column, so a UUID enqueues a job that matches zero rows and reports success.
- `control-group-statistics` is registered with `softFail`, so a failed aggregation still completes its BullMQ job. The reevaluate orchestrator checks the return value via the exported `assertStageSucceeded()`; any new stage waiting on a `softFail` pipeline must do the same.

### Common Issues

1. **"Failed to fetch"** → Missing `...getAuthHeaders()` in fetch calls
2. **401 Unauthorized** → Expired token, Keycloak handles refresh
3. **403 Forbidden** → Wrong auth type for admin endpoints
4. **409 deleting a Grafana dashboard** → Application dashboards still reference it; remove those first.
5. **ADAPT could not build a baseline / INSUFFICIENT_DATA on a healthy baseline** → the baseline's `ds_metric_statistics` rows are missing `pct_agg`. The pipeline self-heals; if it could not, use the **Recalculate baseline statistics** button beside the message, then re-evaluate.

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
