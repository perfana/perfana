# Perfana API — Coding Rules

Perfana-specific development standards for `apps/api`. For general project context, see [CLAUDE.md](../../CLAUDE.md).

## Authentication & Authorization

Perfana uses **dual authentication**: Keycloak JWT (web users) + API keys (programmatic access). There are no local passwords — Keycloak manages all identity.

### Guards & Decorators

| Decorator / Guard | Purpose |
|---|---|
| `KeycloakEnhancedAuthGuard` | Global guard — tries API key first, falls back to Keycloak JWT. Applied to all routes by default. |
| `@Public()` | Skips authentication entirely (health checks, public endpoints) |
| `@AdminOnly()` | Requires `perfana-admin` or `admin` role in the JWT |
| `@UserCtx()` | Parameter decorator — extracts a unified `UserContext` from either auth type |

### UserContext

```typescript
interface UserContext {
  userId: string;           // Keycloak sub or api-key:{id}
  roles: string[];          // From Keycloak or API key
  organizations: string[];  // From API key or JWT
  teams: string[];          // From JWT
  organizationId?: string;  // First from organizations list
  teamId?: string;          // First from teams list
  email?: string;           // Keycloak JWT only
}
```

### Organization Loading (Critical)

**Do NOT use `ctx.organizations`** from `@UserCtx()` for access checks — it may be empty. Instead, load orgs via `AuthorizationService`:

```typescript
// Controller — pass userId and roles
@Get()
async findAll(@UserCtx() ctx: UserContext) {
  return this.myService.findAll(ctx.userId, ctx.roles);
}

// Service — load orgs from DB
async findAll(userId: string, roles: string[]) {
  if (this.authzService.isGlobalAdmin(roles)) { /* bypass */ }
  const orgIds = await this.authzService.getAccessibleOrganizations(userId);
  // filter by orgIds
}
```

### AuthorizationService Key Methods

- `isGlobalAdmin(roles)` — checks for perfana-admin/admin
- `canAccessResource(userId, resource, requiredRoles)` — read check with Redis cache
- `canModifyResource(userId, resource)` — write check
- `getAccessibleOrganizations(userId)` / `getAccessibleTeams(userId)` — cached membership
- `invalidateUserCache()` / `invalidateOrganizationCache()` / `invalidateTeamCache()`

## Module Structure

The API has 34 modules under `src/modules/`. Each follows this pattern:

```
modules/<name>/
  <name>.module.ts        # NestJS module (imports, controllers, providers, exports)
  <name>.service.ts       # Business logic
  controllers/
    <name>.controller.ts  # Route handlers with Swagger decorators
  dto/
    <name>.dto.ts         # Request/response DTOs with class-validator
```

Reference: `modules/test-runs/` is the canonical example for new modules.

### Key Modules

| Module | Purpose |
|---|---|
| `test-runs` | Core test run CRUD, configs, expected changes |
| `auth` | Keycloak integration, token validation |
| `api-keys` | API key CRUD with TTL |
| `grafana` | Dashboard library, instance management, snapshots |
| `adapt` | ADAPT regression detection orchestration |
| `metrics-sources` | Multi-source metrics configuration |
| `organizations` / `teams` | Multi-tenant RBAC membership |
| `benchmarks` | Benchmark definitions and management |

## Guards Location

Guards live at `src/guards/`, not `src/common/guards/`:
- `keycloak-enhanced-auth.guard.ts` — primary auth guard
- `api-key.guard.ts` — API key validation
- `roles.guard.ts` — role-based access
- `enhanced-throttler.guard.ts` — rate limiting

## Database Patterns

- **ORM**: TypeORM with PostgreSQL
- **Entities**: Defined in `packages/shared/src/entities/`
- **Migrations**: `packages/shared/src/database/migrations/`
- **Generate**: `npm run migration:generate -- src/database/migrations/DescriptiveName`
- **Transactions**: Use TypeORM `DataSource.transaction()` or `QueryRunner`

### Ownership Columns

All resource entities include nullable ownership columns for RBAC:
- `created_by`, `updated_by` — user ID who created/modified
- `organization_id`, `team_id` — org/team scope (nullable for backward compat)

## Testing

- **Framework**: Jest with ts-jest
- **Pattern**: `*.spec.ts` files alongside source
- **Run**: `cd apps/api && npx jest`
- **Config**: `jest.config.js` (all tests), `jest.unit.config.js` (unit only)

```typescript
// Standard test setup
const module: TestingModule = await Test.createTestingModule({
  providers: [MyService, { provide: getRepositoryToken(MyEntity), useValue: mockRepo }],
}).compile();
```

## API Documentation

All endpoints must have Swagger decorators:
- `@ApiTags('module-name')` on controllers
- `@ApiOperation({ summary: '...' })` on handlers
- `@ApiResponse()` for response types

Swagger UI: `http://localhost:3001/api/docs`

## Error Handling

Use the safe `instanceof Error` pattern:

```typescript
catch (err) {
  const message = err && typeof err === 'object' && 'message' in err
    ? (err as Error).message
    : 'Default message';
}
```

## Code Style

- TypeScript strict mode
- class-validator for DTO validation
- class-transformer for serialization
- Structured logging via NestJS `Logger`
- Environment variables validated at startup via ConfigModule

## Audit Logging (Phase 5a)

Service mutations on `OwnedResource` entities must log audit events. The `audit-mutation-must-log` ESLint rule (`apps/api/eslint-rules/audit-mutation-must-log.js`) enforces this.

### Convention

Every mutation method on a service must pair the `repo.save | delete | remove | update | insert` call with an `auditService.log{Create,Update,Delete}` call **in the same method body**:

```typescript
async update(id: string, dto: UpdateDto, ctx: UserContext): Promise<Foo> {
  const before = await this.repo.findOneByOrFail({ id });
  const after = await this.repo.save({ ...before, ...dto });
  this.auditService.logUpdate(before, after);  // ← required
  return after;
}

async delete(id: string): Promise<void> {
  const before = await this.repo.findOneByOrFail({ id });
  this.auditService.logDelete(before);          // ← required
  await this.repo.remove(before);
}
```

### `auditableFields` (per-entity)

Each `OwnedResource` entity declares which columns get diffed and recorded. **Default = nothing logged.** Sensitive columns (token hashes, secrets, credentials) are NEVER on this list.

```typescript
@Entity('foo')
export class Foo implements OwnedResource {
  static auditableFields = ['name', 'description', 'organization_id'] as const;
  // ...
}
```

The snapshot test at `packages/shared/src/entities/__tests__/auditable-fields.snapshot.spec.ts` pins the current declarations — adding/removing fields surfaces as a snapshot diff that forces a deliberate "log this" or "redact" review.

### Migration allowlist

Files at `apps/api/.audit-migration-allowlist.json` are grandfathered until migrated. To migrate a service: add the audit calls + `auditableFields` declarations, then remove the file from the allowlist. The `/schedule` agent at `docs/superpowers/scheduled-agents/audit-burndown-drift.md` polls every 2 weeks for new sites that snuck past the lint rule.

### References

- Spec: [`docs/superpowers/specs/2026-05-02-rbac-phase5a-audit-completion-design.md`](../../docs/superpowers/specs/2026-05-02-rbac-phase5a-audit-completion-design.md)
- Burndown: [`docs/superpowers/audits/2026-05-02-audit-phase5a-decisions.md`](../../docs/superpowers/audits/2026-05-02-audit-phase5a-decisions.md)
- Plan: [`docs/superpowers/plans/2026-05-02-rbac-phase5a-audit-completion.md`](../../docs/superpowers/plans/2026-05-02-rbac-phase5a-audit-completion.md)
