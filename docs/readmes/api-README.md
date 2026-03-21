# @perfana/api — NestJS REST API

## Module Index

| Module | Path | Controllers | Key endpoints |
|--------|------|------------|---------------|
| health | `modules/health/` | 1 | `GET /health`, `/health/db`, `/health/memory` |
| auth | `modules/auth/` | 1 | Token info, JWT validation via Keycloak |
| organizations | `modules/organizations/` | 1 | CRUD + member management |
| teams | `modules/teams/` | 1 | CRUD + member management (org-scoped) |
| systems-under-test | `modules/systems-under-test/` | 1 | CRUD + Pyroscope config + delete preview |
| api-keys | `modules/api-keys/` | 1 | CRUD + validate |
| test-runs | `modules/test-runs/` | **4** | See below |
| benchmarks | `modules/benchmarks/` | 1 | CRUD + Apdex SLOs + copy |
| profiles | `modules/profiles/` | 1 | CRUD + nested dashboards/benchmarks |

## Test-Runs Controllers (consolidated from 12 → 4)

| Controller | File | Handles |
|-----------|------|---------|
| TestRunsCrudController | `controllers/test-runs-crud.controller.ts` | List, get, create, delete, annotations, tags, dashboard stats, init, JTL upload |
| TestRunsMetricsController | `controllers/test-runs-metrics.controller.ts` | Transactions, timeseries, virtual users, throughput, errors, Apdex |
| TestRunsAnalysisController | `controllers/test-runs-analysis.controller.ts` | ADAPT results, changepoints, anomaly detection, compare config |
| TestRunsConfigController | `controllers/test-runs-config.controller.ts` | Test configs, SLO checks, related runs, expected config changes |

## Common Infrastructure

| Area | Path | Purpose |
|------|------|---------|
| Guards | `common/guards/` | `KeycloakAuthGuard` → `RolesGuard` → API key validation |
| Decorators | `common/decorators/` | `@Public`, `@Roles`, `@AdminOnly`, `@UserCtx`, `@ThrottleConfig` |
| Filters | `common/filters/` | `GlobalExceptionFilter` with data sanitization |
| Interceptors | `common/interceptors/` | `AuditInterceptor` (fire-and-forget logging) |
| Exceptions | `common/exceptions/` | `BusinessException` hierarchy (9 subclasses) |
| Services | `common/services/` | `AuthorizationService` (Redis-cached RBAC) |
| Middleware | `middleware/` | `DatabaseSessionMiddleware` (sets RLS session vars) |
| Types | `common/types/` | `AuthenticatedRequest`, `SessionContext`, `KeycloakUser` |
| Constants | `common/constants/` | `SystemRole`, `OrganizationRole`, `TeamRole` |

## Guard Execution Order

```
Request → KeycloakAuthGuard → RolesGuard → ThrottlerGuard → Controller
              (JWT/API key)    (@Roles)     (rate limit)
```

`@Public()` skips auth. `@AdminOnly()` requires perfana-admin role.

## Adding an Endpoint

1. Find the module in `src/modules/<domain>/`
2. Add business logic to `<domain>.service.ts`
3. Add route to `<domain>.controller.ts` with decorators:
   ```typescript
   @Get(':id')
   @Roles('user')
   @ApiOperation({ summary: 'Get item by ID' })
   async getById(@Param('id', ParseUUIDPipe) id: string, @UserCtx() ctx: UserContext) {
     return this.service.findById(id, ctx);
   }
   ```
4. Write test in `<domain>.service.test.ts`

## Stub Methods

Many service methods currently throw `NotImplementedException` — they're stubs waiting for the worker pipeline integration (Phase 3) and external integrations (Phase 4) to be wired up. Search for `NotImplementedException` to find them.
