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
- Web: http://localhost:4001
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
| 🏗️ Infra | `docker-compose.infra.yml` | Full local stack | — |

→ System diagrams: [ARCHITECTURE.md](ARCHITECTURE.md)
→ Code patterns: [CONVENTIONS.md](CONVENTIONS.md)
→ Improvement plan: [PLAN.md](PLAN.md)

---

## 📋 Development Standards

For comprehensive coding standards and best practices, see:
- **[Frontend Coding Rules](apps/web/CODING_RULES.md)** - Next.js & TypeScript development standards, testing requirements, security guidelines, and quality gates
- **[Backend Coding Rules](apps/api/CODING_RULES.md)** - NestJS & TypeScript API development standards, database patterns, security implementation, and observability
- **[Grafana Sync Coding Rules](apps/grafana-sync/CODING_RULES.md)** - NestJS scheduled tasks, retry patterns, resilience, and background service development

## Project Overview

**Perfana** is a performance analysis and observability tool being refactored from a legacy MongoDB/Meteor stack to a modern TypeScript-based architecture.

### Architecture

The platform consists of multiple services:
- **API Service** (`apps/api`) - Main NestJS REST API backend
- **Web Application** (`apps/web`) - Next.js frontend application
- **Grafana Sync Service** (`apps/grafana-sync`) - Background service for dashboard synchronization and auto-configuration
- **Worker Service** (`apps/worker`) - Background job processing with BullMQ

## Technology Stack

- **Database**: PostgreSQL with TypeORM
- **Backend**: NestJS (TypeScript, decorators, dependency injection)
- **Frontend**: Next.js (React, App Router, Server Components)
- **Authentication**: Keycloak JWT + API Keys
- **Background Jobs**: BullMQ with Redis
- **Scheduling**: @nestjs/schedule for cron jobs
- **Language**: TypeScript throughout
- **Runtime**: Node.js v18+

## Development Commands

### Monorepo Commands
- `npm install` - Install dependencies for all workspaces
- `npm run dev` - Start all development servers (api, web, grafana-sync, worker)
- `npm run build` - Build all apps for production
- `npm run test` - Run test suites for all apps
- `npm run type-check` - TypeScript type checking for all apps
- `npm run lint` - Code linting for all apps

### Individual Service Commands
- `npm run dev:api` - Start API service only (port 3001)
- `npm run dev:web` - Start web application only (port 4001)
- `npm run dev:grafana-sync` - Start Grafana sync service only (port 3002)
- `lsof -ti:3001,3002,4001 | xargs kill -9 && npm run dev` - Kill and restart all services

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

**MANDATORY**: All frontend API calls MUST include authentication headers:

```typescript
import keycloakAuth from '@/lib/keycloak-auth';

function getAuthHeaders(): Record<string, string> {
  const token = keycloakAuth.getToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

// Example API call
const response = await fetch(`/endpoint`, {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
  },
});

// Handle 401 responses - Keycloak handles token refresh automatically
if (response.status === 401) {
  // Redirect to Keycloak login
  await keycloakAuth.login();
}
```

### API Endpoints

#### Public Endpoints (No Authentication)
- `GET /auth/health` - Health check

#### Protected Endpoints (Keycloak JWT or API Key)
- `GET /test-runs` - List test runs
- `GET /test-runs/:testRunId` - Get single test run (supports both UUID and test_run_id with query params)
- `POST /test` - Create/update test runs
- `POST /test-config` - Add a single test run configuration key-value pair
- `POST /test-configs` - Add multiple test run configuration key-value pairs
- `POST /test-config-json` - Add test run configuration from JSON with include/exclude patterns
- `GET /api-keys` - List API keys
- All other application endpoints

#### Admin Only Endpoints (Keycloak JWT with admin role Required)
- Admin operations require `perfana-admin` or `admin` role in Keycloak token

## Role-Based Access Control (RBAC)

Perfana implements a multi-tenant RBAC system for fine-grained access control across organizations and teams.

### RBAC Implementation Status

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Role definitions & constants | ✅ Completed |
| Phase 2 | Membership & ownership infrastructure | ✅ Completed |
| Phase 3 | Service-layer authorization enforcement | 🚧 TODO |
| Phase 4 | Data migration for existing resources | 🚧 TODO |
| Phase 5 | Row-level security & audit logging | 🚧 TODO |

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

## Development Guidelines

### Adding New API Endpoints

1. **Backend (NestJS)**:
   - All endpoints are protected by default via `KeycloakEnhancedAuthGuard`
   - Use `@Public()` decorator only for truly public endpoints
   - For admin-only endpoints, use `KeycloakEnhancedAuthGuard.isAdmin(request)` or check for `perfana-admin` role
   - Include proper Swagger documentation with `@ApiTags`, `@ApiOperation`

2. **Frontend API Clients**:
   - **ALWAYS** include `...getAuthHeaders()` in fetch requests
   - Handle 401 responses with token refresh logic
   - Use consistent error handling patterns
   - Place API functions in `/lib/` directory

### Error Handling Pattern

Use the safe error handling pattern for `instanceof Error`:

```typescript
// ❌ Problematic (can cause runtime errors)
catch (err) {
  setError(err instanceof Error ? err.message : 'Default message');
}

// ✅ Safe approach
catch (err) {
  setError(err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Default message');
}
```

### Common Issues

1. **"Failed to fetch"** errors → Missing authentication headers
2. **401 Unauthorized** → Expired/invalid tokens, implement refresh
3. **403 Forbidden** → Wrong auth type for admin endpoints
4. **Runtime TypeError with instanceof** → Use safe error checking pattern

## Current Implementation Status

### ✅ Completed Features

1. **Authentication System** - Dual authentication (Keycloak JWT + API Keys) with enhanced auth guard
2. **Test Runs Module** - Full CRUD operations with enhanced UI and expandable cards
3. **API Keys Management** - CRUD operations with TTL support and settings page
4. **Test Run Configuration Management** - Configuration comparison, expected changes tracking, JSON import/export
5. **Grafana Integration** - Complete dashboard library (21 dashboards), instance management, application configurations
6. **Grafana Sync Service** - Automated dashboard synchronization, auto-configuration detection, sanity checking
7. **Database Schema & Seed Data** - PostgreSQL tables with complete MongoDB migration and dynamic ID resolution
8. **RBAC Phase 2** - Organization membership, team membership, and resource ownership tracking infrastructure (see RBAC section below)

### 🚧 In Progress / TODO

1. **Additional Modules** - Organizations, teams, benchmarks, reports
2. **Data Science Features** - Performance regression detection, AI-powered analysis, metric classifications
3. **Real-time Features** - Live test monitoring via Socket.IO + Redis

### 🎯 Service Ports & URLs

- **API Service**: `http://localhost:3001/api` (REST API)
- **API Swagger Docs**: `http://localhost:3001/api/docs` (API documentation)
- **Web Application**: `http://localhost:4001` (Next.js frontend)
- **Grafana Sync Service**: `http://localhost:3002` (Background service - no HTTP interface)
- **Worker Service**: Background job processing (no HTTP interface)

## Configuration Management

### Key Features

1. **Configuration Storage & Retrieval** - Store key-value pairs for test runs with nested JSON support
2. **Expected Configuration Changes** - Define and track expected vs unexpected changes
3. **Configuration Comparison** - Side-by-side comparison with status indicators
4. **JSON Import/Export** - Bulk updates with include/exclude patterns

### Configuration Endpoints

- `POST /test-config` - Add single configuration
- `POST /test-configs` - Add multiple configurations
- `POST /test-config-json` - Import from JSON with patterns
- `GET /test-runs/:testRunId/configs` - Get configurations
- `GET /test-runs/expected-config-changes` - Get expected changes
- `POST /test-runs/expected-config-changes` - Create expected change

## Grafana Sync Service

### Overview

The Grafana Sync Service (`apps/grafana-sync`) is a standalone NestJS background service that automates Grafana dashboard management and configuration. It runs independently from the main API service and performs scheduled tasks.

### Key Features

1. **Dashboard Synchronization**
   - Periodically syncs dashboards from configured Grafana instances
   - Configurable sync intervals and batch processing
   - Retry logic with exponential backoff
   - Dashboard filtering by tags and folders

2. **Auto-Configuration Detection**
   - Automatically detects dashboard variables (system-under-test, workload, environment, etc.)
   - Pattern-based variable detection with confidence scoring
   - Configurable confidence thresholds
   - Updates dashboard metadata automatically

3. **Sanity Checking**
   - Validates dashboard configurations
   - Detects missing or outdated dashboards
   - Identifies configuration errors
   - Optional notifications (email, Slack)

### Configuration

Environment variables for the Grafana Sync Service:
- `GRAFANA_SYNC_ENABLED` - Enable/disable sync (default: true)
- `GRAFANA_SYNC_INTERVAL` - Sync interval in milliseconds (default: 30000)
- `AUTO_CONFIG_ENABLED` - Enable auto-configuration (default: true)
- `SANITY_CHECK_ENABLED` - Enable sanity checks (default: true)

See `apps/grafana-sync/README.md` for complete configuration options.

### Development

```bash
# Start Grafana sync service only
npm run dev:grafana-sync

# Run tests
cd apps/grafana-sync && npm test

# Build
cd apps/grafana-sync && npm run build
```

## Grafana Integration

### Complete Dashboard Library (21 Dashboards)

#### Load Testing
- Gatling Overview, JMeter Overview, JMeter Request Performance, K6 HTTP, Neoload, Request Duration

#### Infrastructure & Containers
- System Under Test, Containers, Kubernetes Namespace, Kubernetes Pod

#### JVM & Application
- Micrometer JVM, JVM Memory Usage, Afterburner Database

#### HTTP & Network
- HTTP Client Requests, HTTP Server Requests, HTTP Request Duration

#### Connection Pools
- Hikari Connection Pool, HTTP Connection Pool

#### Advanced Monitoring
- Span Metrics, Dynatrace USQL, Loki, Trends

### Grafana Endpoints

- `GET /grafana/instances` - List Grafana instances
- `GET /grafana/dashboards` - List dashboards with filtering
- `GET /grafana/application-dashboards` - List application configurations
- `POST /grafana/dashboards/sync` - Synchronize dashboards from instance
- `POST /grafana/application-dashboards/:id/snapshot` - Generate snapshot

## UI Design Standards

### Test Run Details Card Styling

#### Grid Layout
- Fixed card height: `440px` (collapsed), `auto` (expanded)
- Grid gap: `24px` between cards
- Responsive columns: `1fr` (xs), `repeat(2, minmax(0, 1fr))` (md), `repeat(3, minmax(0, 1fr))` (lg)

#### Card Structure (Five Sections)
1. **Header**: Dynamic typography with expand/collapse functionality
2. **Primary Info**: Blue-themed box with centered content and monospace data
3. **Secondary Content**: Fancy chips with gradients and hover effects
4. **Status Icon** (Optional): Centered circular icon with tooltip
5. **Footer**: Decorative line with gradient text

#### Color Themes
- Primary (Blue): `rgba(25, 118, 210, *)`
- Secondary (Purple): `rgba(156, 39, 176, *)`
- Success (Green): `#4caf50` and `#66bb6a`
- Error (Red): `#f44336` and `#ef5350`
- Warning (Orange): `#ff9800` and `#ffb74d`

### Auto-Focus Feature for Expandable Cards

All expandable cards implement automatic focus when expanded:
1. **Scrolls into view** using smooth scrolling behavior
2. **Receives focus** for keyboard navigation accessibility
3. **Centers in viewport** for optimal visibility

#### Implementation Pattern
```typescript
const handleExpand = () => {
  const wasCollapsed = !expanded;
  onExpand();

  if (wasCollapsed) {
    setTimeout(() => {
      const expandedCard = document.querySelector('[data-testid="card-name-expanded"]');
      if (expandedCard) {
        expandedCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        (expandedCard as HTMLElement).focus({ preventScroll: true });
      }
    }, 300);
  }
};
```

## Core Features & Integrations

### Key Integration Points
- **Grafana**: Dashboard and metrics visualization
- **Dynatrace**: APM integration via DQL queries
- **InfluxDB**: Time-series metrics storage
- **Performance Testing**: Gatling, JMeter, k6 support
- **Tracing**: Tempo, Jaeger integration
- **Profiling**: Pyroscope integration

### Core Features to Preserve
- Automated performance regression detection
- Integration with distributed tracing and profiling tools
- AI-powered root cause analysis
- Real-time test monitoring and alerts
- Multi-format data export capabilities

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
4. All API calls must include auth headers -- use `getAuthHeaders()` from `@/lib/keycloak-auth`

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

## gstack

Use `/browse` for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

Available: `/office-hours` `/plan-ceo-review` `/plan-eng-review` `/plan-design-review` `/design-consultation` `/review` `/ship` `/browse` `/qa` `/qa-only` `/design-review` `/setup-browser-cookies` `/retro` `/investigate` `/document-release` `/codex` `/careful` `/freeze` `/guard` `/unfreeze` `/gstack-upgrade`

If gstack skills aren't working: `cd .claude/skills/gstack && ./setup`

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review