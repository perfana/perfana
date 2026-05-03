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
| Deep Reference | `docs-site/content/` | ADAPT, RBAC, schemas, features | [Index](docs-site/content/index.md) |
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
| Phase 3 | Service-layer authorization enforcement | TODO |
| Phase 4 | Data migration for existing resources | TODO |
| Phase 5 | Row-level security & audit logging | TODO |

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
- `organization_id` - Organization the resource belongs to (nullable for backward compatibility)
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

### Backward Compatibility

- All ownership columns are **nullable** to support existing data
- Resources with `null` `organization_id` are accessible to all authenticated users
- Authorization enforcement is opt-in (Phase 3) and won't break existing functionality

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

### Common Issues

1. **"Failed to fetch"** → Missing `...getAuthHeaders()` in fetch calls
2. **401 Unauthorized** → Expired token, Keycloak handles refresh
3. **403 Forbidden** → Wrong auth type for admin endpoints

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

This project is indexed by GitNexus as **perfana** (33397 symbols, 56987 relationships, 192 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
