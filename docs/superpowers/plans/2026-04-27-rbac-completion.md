# RBAC Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This is a master roadmap plan.** Phase 3a is fully decomposed into bite-sized TDD tasks. Phases 3b, 3c, 4, and the Frontend phase are documented with locked architecture, file structure, and a worked first task — they should be expanded into per-phase sub-plans (in this same `docs/superpowers/plans/` directory) immediately before each phase is executed. Phase 5 is deferred and only sketched.

**Goal:** Complete the RBAC implementation (Phases 3 + 4 from `CLAUDE.md`) plus the frontend layer that consumes it, so that authorization is enforced consistently at every service boundary, the legacy "null `organization_id`" escape hatch is closed, and the UI gates actions on real per-org capabilities instead of leaking 403s through dangling buttons.

**Architecture:** Capabilities-based permission model. The backend computes a flat set of capability strings (e.g. `integration:dynatrace:update`) per `(userId, organizationId)` and exposes them via `GET /api/users/me/permissions`. Resources that need per-row decisions (legacy null-org rows, ownership-scoped) include a `_permissions: { action: boolean }` field in their API responses. The frontend reads the global+per-org capabilities via `usePermissions()` and gates actions with a declarative `<RequiresPermission>` wrapper. Backend remains the source of truth — the UI layer is advisory UX only; every mutating endpoint still returns 403 if a capability is missing.

**Tech Stack:** NestJS (`apps/api/`), TypeScript, TypeORM migrations in `packages/shared/src/database/migrations/`, Redis-backed cache via existing `AuthorizationService.getCachedMembership` plumbing. Frontend is Next.js with React Query (`apps/web/`). Tests: Jest for `apps/api` and `apps/web`.

---

## File Structure

**Phase 3a — Capabilities API (backend):**

- Create: `apps/api/src/constants/capabilities.constants.ts` — single source of truth for capability strings + role→capability mapping.
- Create: `apps/api/src/common/services/capabilities.service.ts` — pure logic that maps `(roles, orgRole, teamRole)` → capability set. Stateless and easy to test.
- Create: `apps/api/src/common/services/capabilities.service.spec.ts` — unit tests for the mapping.
- Modify: `apps/api/src/common/services/authorization.service.ts` — add `getCapabilities(userId, organizationId, teamId?)` that loads memberships and delegates to `CapabilitiesService`. Reuses the Redis cache helpers already in this file.
- Modify: `apps/api/src/common/services/authorization.service.spec.ts` — tests for the cached `getCapabilities` path.
- Create: `apps/api/src/modules/users/users-permissions.controller.ts` — handles `GET /api/users/me/permissions`.
- Create: `apps/api/src/modules/users/users-permissions.controller.spec.ts` — controller tests.
- Modify: `apps/api/src/modules/users/users.module.ts` — register the new controller.
- Modify: `apps/api/src/modules/users/users.controller.ts` ONLY if a routing conflict surfaces; otherwise leave alone.

**Phase 3b — Per-resource `_permissions` field:**

- Create: `apps/api/src/common/serializers/with-permissions.serializer.ts` — generic `attachPermissions(resource, actionMap)` helper that augments a resource (or array) with `_permissions`.
- Create: `apps/api/src/common/serializers/with-permissions.serializer.spec.ts` — unit tests.
- Modify (pilot): `apps/api/src/modules/dynatrace/dynatrace.service.ts` — `findAll`, `findOne`, `findByHost` produce the resource via `attachPermissions(...)` so the frontend can read `data._permissions.update`.
- Modify: `apps/api/src/modules/dynatrace/dynatrace.service.spec.ts` — assert `_permissions` shape on the returned configs.
- Modify: `packages/shared/src/types/api.ts` (or equivalent existing shared API types file — verify path during execution) — add the optional `_permissions` field to the response DTOs that get it.

**Phase 3c — Service-layer enforcement walkthrough:**

- Modify the ~190 behavioral `isGlobalAdmin` sites enumerated in `docs/superpowers/audits/2026-04-26-audit-decisions.md`. Each site falls into one of:
  - **Bucket A (filter bypass):** migrate to the `withOrgFilter` helper from PR #175.
  - **Bucket B (guard):** migrate to a new `@RequiresCapability('...')` decorator (created in this phase).
  - **Bucket C (mixed):** review case-by-case; some need explicit `canModifyResource` calls, some are stubs awaiting Phase 4.

- Create: `apps/api/src/common/decorators/requires-capability.decorator.ts` — method/class decorator + matching guard.
- Create: `apps/api/src/common/guards/capability.guard.ts` — reads required capability from metadata, validates against `AuthorizationService.getCapabilities(...)`, throws `ForbiddenException` if missing.
- Modify: per-service files identified in the audit log (one PR per service or per logical group of 3–5 services).

**Phase 4 — Data migration (backfill + NOT NULL):**

- Create one migration per entity in `packages/shared/src/database/migrations/`:
  - `<timestamp>-BackfillDynatraceConfigOrganizationId.ts`
  - `<timestamp>-DynatraceConfigOrganizationIdNotNull.ts`
  - …repeat for the ~25 entities listed in `CLAUDE.md` under "Entities with Ownership Tracking".
- Modify each entity in `packages/shared/src/entities/` to remove `nullable: true` from `organization_id` once the corresponding NOT NULL migration has run.
- Modify any service code that branches on `organizationId == null` (the `if (existing.organizationId)` pattern) — the branch becomes dead and is deleted.

**Frontend phase — capabilities client + UI gating:**

- Create: `apps/web/lib/api/permissions.ts` — fetcher for `GET /api/users/me/permissions`.
- Create: `apps/web/hooks/usePermissions.ts` — React Query-backed hook exposing `can(action, ctx?)`.
- Create: `apps/web/hooks/usePermissions.test.ts` — unit tests.
- Create: `apps/web/components/auth/RequiresPermission.tsx` — declarative wrapper component (renders children, disables/hides them, or shows a tooltip based on capability check).
- Create: `apps/web/components/auth/RequiresPermission.test.tsx` — render tests.
- Modify: `apps/web/lib/contexts/organization-context.tsx` — load permissions on auth/org-switch, expose them via the existing `useOrganizationContext()` consumer surface OR delegate purely to `usePermissions()` (decision locked in Phase 3a frontend planning step).
- Modify (pilot): `apps/web/app/integrations/components/IntegrationCard.tsx` — wrap Configure/Delete buttons in `<RequiresPermission action="integration:<type>:update" orgId={...}>`.

**Phase 5 (deferred) — Row-level security + audit logging:**

Out of scope for this plan. Tracked for a separate plan once Phase 3 + 4 are stable. Notes at the bottom of this document.

---

## Phase 3a: Capabilities API (backend) — fully expanded

This is the foundation. Every other phase depends on the capability strings, the mapping service, and the `/me/permissions` endpoint. Built in TDD, single PR.

### Architecture boundary: capabilities vs resource ACL

`AuthorizationService` ends up with two related-but-distinct authorization surfaces. They are complements, not competitors. Use this rule when deciding which to call:

- **Capabilities** answer **"can I do action X in scope Y?"** — used for menu and button gating, route guards, and pre-fetch decisions where the specific resource isn't loaded yet. Capabilities are computed from `(systemRoles, orgRoles, teamRoles)` and cached per `(userId, organizationId, teamId)`. The `@RequiresCapability(...)` decorator + `CapabilityGuard` enforce them at the controller boundary.

- **Resource ACL** (`canAccessResource(userId, resourceOrgId)` / `canModifyResource(userId, resourceOrgId)`) answers **"can this user touch this specific row?"** — used inside services AFTER a resource has been loaded, when ownership and team-scope data are known. The methods return booleans; admin bypass is implicit (a global admin always returns `true`).

They compose. A controller checks the capability via `@RequiresCapability` to authorize the **intent** ("you are allowed to update integrations in this org"); the service calls `canModifyResource` after loading the row to authorize the **target** ("you are allowed to update *this* integration, given its organization and ownership"). Neither replaces the other. Don't try to fold capabilities into `canAccessResource` — capabilities are about action vocabulary; ACL is about row ownership. Different jobs.

**`getAccessibleOrgIds(userId, roles)` returns `string[] | undefined`** (admin → undefined, non-admin → array). It's NOT being deprecated. It's the right primitive for the `withOrgFilter`-style "should I add a `WHERE organization_id IN (...)` clause" decision, and it's used inside `getCapabilities` to load the org-scoped role data.

### Auth-method-agnostic by construction

`getCapabilities(userId, roles, organizationId, teamId?)` takes `roles` as a parameter, not from request context. `KeycloakEnhancedAuthGuard.getRoles()` (`apps/api/src/guards/keycloak-enhanced-auth.guard.ts:185-191`) already unifies JWT (`request.user.roles` from Keycloak `realm_access` + client roles) and API key (`request.apiKey.roles`) into a single array. The capability mapping treats both identically — an admin API key gets the same capabilities as an admin JWT. No special-casing in the controller, the service, or the cache. The controller pulls `ctx.roles` via `@UserCtx()` and passes them through; everything downstream is auth-method-blind.

### Request flow

```
  HTTP request (JWT or API key in header)
        │
        ▼
  KeycloakEnhancedAuthGuard ────► request.user.roles = [...]
        │                          (system roles from JWT or API key)
        ▼
  Controller method
        │  @UserCtx() → ctx.userId, ctx.roles
        │  @RequiresCapability('foo:bar') → CapabilityGuard.canActivate()
        ▼                                         │
  CapabilityGuard.canActivate()                   │
        │                                         │
        ▼                                         │
  AuthorizationService.getCapabilities(           │
    userId, roles, organizationId, teamId         │
  )                                               │
        │  ┌──────────────────────────┐           │
        ├─►│ Redis                    │ HIT ──────┘
        │  │ auth:capabilities        │  return cached array
        │  │   :{userId}:{orgId}:{tm} │
        │  └──────────────────────────┘
        │      MISS
        │      ▼
        │  ┌──────────────────────────┐
        │  │ Postgres                 │
        │  │ organization_members     │
        │  │ team_members             │
        │  └──────────────────────────┘
        │      │  orgRoles, teamRoles
        │      ▼
        │  CapabilitiesService.compute({
        │    systemRoles, orgRoles, teamRoles
        │  })  ← pure, stateless
        │      │
        │      ▼  CapabilityValue[]
        │  Cache write (TTL = cacheTtlSeconds) + return
        ▼
  Capability check: caps.includes('foo:bar')
        │
        ├─ true  → service method runs
        │           │
        │           ▼
        │     (optional) canAccessResource()/canModifyResource()
        │     for per-row check after the resource is loaded
        │           │
        │           ▼
        │     200 + (optional) _permissions field on response
        │           (Phase 3b adds the field; capability still drives the boolean)
        │
        └─ false → ForbiddenException
                   + WARN log: capability=foo:bar userId=... orgId=...
                   + counter: auth_capability_denied_total (Phase 3c telemetry)
```

Cache invalidation flows the other way: `OrganizationMembersService` / `TeamMembersService` call `AuthorizationService.invalidateMembershipCache(userId, organizationId?)` on every write, which `redis.del()`s the matching `auth:capabilities:*` keys (Task 3a.5).

### Task 3a.1: Define capability constants

**Files:**
- Create: `apps/api/src/constants/capabilities.constants.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/constants/capabilities.constants.spec.ts`:

```typescript
import {
  Capability,
  ROLE_CAPABILITIES,
  GLOBAL_ADMIN_CAPABILITIES,
} from './capabilities.constants';
import {
  OrganizationRole,
  TeamRole,
  GLOBAL_ADMIN_ROLES,
} from './roles.constants';

describe('capabilities.constants', () => {
  it('defines distinct capability strings', () => {
    const values = Object.values(Capability);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('uses <resource>:<action> or <resource>:<sub>:<action> format', () => {
    for (const cap of Object.values(Capability)) {
      expect(cap).toMatch(/^[a-z][a-z0-9-]*(:[a-z0-9-]+){1,2}$/);
    }
  });

  it('maps every OrganizationRole to a capability set', () => {
    for (const role of Object.values(OrganizationRole)) {
      expect(ROLE_CAPABILITIES.organization[role]).toBeDefined();
    }
  });

  it('maps every TeamRole to a capability set', () => {
    for (const role of Object.values(TeamRole)) {
      expect(ROLE_CAPABILITIES.team[role]).toBeDefined();
    }
  });

  it('global admin capabilities are a superset of org-admin capabilities', () => {
    const orgAdmin = ROLE_CAPABILITIES.organization[OrganizationRole.ADMIN];
    for (const cap of orgAdmin) {
      expect(GLOBAL_ADMIN_CAPABILITIES).toContain(cap);
    }
  });

  it('GLOBAL_ADMIN_ROLES includes perfana-admin and admin', () => {
    expect(GLOBAL_ADMIN_ROLES).toEqual(
      expect.arrayContaining(['perfana-admin', 'admin']),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx jest src/constants/capabilities.constants.spec.ts
```

Expected: FAIL with `Cannot find module './capabilities.constants'`.

- [ ] **Step 3: Implement the capabilities constants**

Create `apps/api/src/constants/capabilities.constants.ts`:

```typescript
import { OrganizationRole, TeamRole } from './roles.constants';

/**
 * Canonical capability strings. Format: `<resource>:<action>` or `<resource>:<sub>:<action>`.
 * Capabilities are decoupled from roles: the role→capability mapping below is the only
 * place the policy lives. UI and services check capabilities, never roles.
 */
export const Capability = {
  // Integrations (one capability set per integration type — fine-grained for future role-shaping)
  IntegrationGrafanaCreate: 'integration:grafana:create',
  IntegrationGrafanaUpdate: 'integration:grafana:update',
  IntegrationGrafanaDelete: 'integration:grafana:delete',
  IntegrationDynatraceCreate: 'integration:dynatrace:create',
  IntegrationDynatraceUpdate: 'integration:dynatrace:update',
  IntegrationDynatraceDelete: 'integration:dynatrace:delete',
  IntegrationPyroscopeCreate: 'integration:pyroscope:create',
  IntegrationPyroscopeUpdate: 'integration:pyroscope:update',
  IntegrationPyroscopeDelete: 'integration:pyroscope:delete',
  IntegrationTracingCreate: 'integration:tracing:create',
  IntegrationTracingUpdate: 'integration:tracing:update',
  IntegrationTracingDelete: 'integration:tracing:delete',

  // Test runs
  TestRunRead: 'test-run:read',
  TestRunUpdate: 'test-run:update',
  TestRunDelete: 'test-run:delete',
  TestRunAnnotate: 'test-run:annotate',

  // Profiles, benchmarks, SUTs, dashboards
  ProfileManage: 'profile:manage',
  BenchmarkManage: 'benchmark:manage',
  SutManage: 'sut:manage',
  DashboardManage: 'dashboard:manage',

  // Organization administration
  OrgManageMembers: 'org:manage-members',
  OrgUpdate: 'org:update',
  OrgDelete: 'org:delete',
  OrgCreate: 'org:create',

  // Team administration
  TeamCreate: 'team:create',
  TeamUpdate: 'team:update',
  TeamDelete: 'team:delete',
  TeamManageMembers: 'team:manage-members',

  // System-level (global admin only)
  SystemAuditRead: 'system:audit-read',
  SystemManageUsers: 'system:manage-users',
  SystemManageGlobalSettings: 'system:manage-global-settings',
} as const;

export type CapabilityValue = (typeof Capability)[keyof typeof Capability];

const integrationReadOnly: CapabilityValue[] = [
  // org-viewer can list integrations but not mutate. No explicit "read" capability —
  // listing is governed by org filtering at the service layer; the *_LIST output
  // already excludes orgs the viewer doesn't belong to.
];

const integrationCrud: CapabilityValue[] = [
  Capability.IntegrationGrafanaCreate,
  Capability.IntegrationGrafanaUpdate,
  Capability.IntegrationGrafanaDelete,
  Capability.IntegrationDynatraceCreate,
  Capability.IntegrationDynatraceUpdate,
  Capability.IntegrationDynatraceDelete,
  Capability.IntegrationPyroscopeCreate,
  Capability.IntegrationPyroscopeUpdate,
  Capability.IntegrationPyroscopeDelete,
  Capability.IntegrationTracingCreate,
  Capability.IntegrationTracingUpdate,
  Capability.IntegrationTracingDelete,
];

const testRunCrud: CapabilityValue[] = [
  Capability.TestRunRead,
  Capability.TestRunUpdate,
  Capability.TestRunAnnotate,
];

const orgAdminExtras: CapabilityValue[] = [
  Capability.OrgManageMembers,
  Capability.OrgUpdate,
  Capability.TeamCreate,
  Capability.TeamUpdate,
  Capability.TeamDelete,
  Capability.TeamManageMembers,
  Capability.ProfileManage,
  Capability.BenchmarkManage,
  Capability.SutManage,
  Capability.DashboardManage,
  Capability.TestRunDelete,
];

/**
 * Role → capability mapping.
 * Each role grants the union of its mapped capabilities.
 *
 * The type constraint ensures every role enum value has an entry (compile error
 * if a role is missed) and that array entries are valid CapabilityValue references
 * (compile error on a typo like 'integration:dynatrce:updte').
 */
type CapabilitySet = readonly CapabilityValue[];
type RoleCapabilityMap = {
  organization: Record<OrganizationRole, CapabilitySet>;
  team: Record<TeamRole, CapabilitySet>;
};

export const ROLE_CAPABILITIES: RoleCapabilityMap = {
  organization: {
    [OrganizationRole.ADMIN]: [
      ...integrationCrud,
      ...testRunCrud,
      ...orgAdminExtras,
    ],
    [OrganizationRole.MEMBER]: [
      ...testRunCrud,
      Capability.ProfileManage,
      Capability.BenchmarkManage,
      Capability.SutManage,
      Capability.DashboardManage,
    ],
    [OrganizationRole.VIEWER]: [
      ...integrationReadOnly,
      Capability.TestRunRead,
    ],
  },
  team: {
    [TeamRole.ADMIN]: [
      Capability.TeamUpdate,
      Capability.TeamManageMembers,
    ],
    [TeamRole.MEMBER]: [],
    [TeamRole.VIEWER]: [],
  },
} as const;

/**
 * Global admins (system-roles `perfana-admin` / `admin`) get every capability.
 * Computed at module load — no need to enumerate again here, the service expands it.
 */
export const GLOBAL_ADMIN_CAPABILITIES: CapabilityValue[] = Object.values(Capability);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/api && npx jest src/constants/capabilities.constants.spec.ts
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/constants/capabilities.constants.ts apps/api/src/constants/capabilities.constants.spec.ts
git commit -m "feat(api): introduce Capability enum and role→capability mapping"
```

### Task 3a.2: Pure CapabilitiesService

**Files:**
- Create: `apps/api/src/common/services/capabilities.service.ts`
- Create: `apps/api/src/common/services/capabilities.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/common/services/capabilities.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { CapabilitiesService } from './capabilities.service';
import { Capability } from '../../constants/capabilities.constants';
import { OrganizationRole, TeamRole } from '../../constants/roles.constants';

describe('CapabilitiesService', () => {
  let service: CapabilitiesService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [CapabilitiesService],
    }).compile();
    service = moduleRef.get(CapabilitiesService);
  });

  it('returns all capabilities for global admins', () => {
    const caps = service.compute({
      systemRoles: ['perfana-admin'],
      orgRoles: [],
      teamRoles: [],
    });
    expect(caps).toContain(Capability.IntegrationDynatraceUpdate);
    expect(caps).toContain(Capability.SystemManageUsers);
  });

  it('grants org-admin capabilities to org-admins', () => {
    const caps = service.compute({
      systemRoles: ['perfana-user'],
      orgRoles: [OrganizationRole.ADMIN],
      teamRoles: [],
    });
    expect(caps).toContain(Capability.IntegrationDynatraceUpdate);
    expect(caps).toContain(Capability.OrgManageMembers);
    expect(caps).not.toContain(Capability.SystemManageUsers);
  });

  it('grants only read+annotate to org-viewers (no integration mutate)', () => {
    const caps = service.compute({
      systemRoles: ['perfana-user'],
      orgRoles: [OrganizationRole.VIEWER],
      teamRoles: [],
    });
    expect(caps).toContain(Capability.TestRunRead);
    expect(caps).not.toContain(Capability.IntegrationDynatraceUpdate);
    expect(caps).not.toContain(Capability.OrgManageMembers);
  });

  it('grants org-member capabilities to org-members (no integration mutate)', () => {
    const caps = service.compute({
      systemRoles: ['perfana-user'],
      orgRoles: [OrganizationRole.MEMBER],
      teamRoles: [],
    });
    expect(caps).toContain(Capability.ProfileManage);
    expect(caps).toContain(Capability.TestRunUpdate);
    expect(caps).not.toContain(Capability.IntegrationDynatraceUpdate);
  });

  it('returns the union when user holds multiple roles', () => {
    const caps = service.compute({
      systemRoles: ['perfana-user'],
      orgRoles: [OrganizationRole.MEMBER, OrganizationRole.VIEWER],
      teamRoles: [TeamRole.ADMIN],
    });
    expect(caps).toContain(Capability.TestRunUpdate);
    expect(caps).toContain(Capability.TeamManageMembers);
  });

  it('returns no capabilities for unauthenticated/empty input', () => {
    const caps = service.compute({ systemRoles: [], orgRoles: [], teamRoles: [] });
    expect(caps).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx jest src/common/services/capabilities.service.spec.ts
```

Expected: FAIL with `Cannot find module './capabilities.service'`.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/common/services/capabilities.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import {
  Capability,
  CapabilityValue,
  GLOBAL_ADMIN_CAPABILITIES,
  ROLE_CAPABILITIES,
} from '../../constants/capabilities.constants';
import {
  GLOBAL_ADMIN_ROLES,
  OrganizationRole,
  TeamRole,
} from '../../constants/roles.constants';

export interface CapabilityInput {
  /** System-level roles from the JWT (Keycloak `realm_access.roles`). */
  systemRoles: string[];
  /** Organization-level roles for the *currently-scoped* organization. Empty if none. */
  orgRoles: OrganizationRole[];
  /** Team-level roles for the *currently-scoped* team. Empty if none. */
  teamRoles: TeamRole[];
}

/**
 * Pure mapping from (systemRoles, orgRoles, teamRoles) to a capability set.
 * Stateless. No I/O. Easy to test exhaustively.
 *
 * Loading the role data is the AuthorizationService's job; this service only
 * does the mapping math.
 */
@Injectable()
export class CapabilitiesService {
  compute(input: CapabilityInput): CapabilityValue[] {
    const caps = new Set<CapabilityValue>();

    if (input.systemRoles.some((r) => GLOBAL_ADMIN_ROLES.includes(r))) {
      for (const c of GLOBAL_ADMIN_CAPABILITIES) caps.add(c);
      return Array.from(caps);
    }

    for (const role of input.orgRoles) {
      for (const c of ROLE_CAPABILITIES.organization[role] ?? []) caps.add(c);
    }
    for (const role of input.teamRoles) {
      for (const c of ROLE_CAPABILITIES.team[role] ?? []) caps.add(c);
    }

    return Array.from(caps);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/api && npx jest src/common/services/capabilities.service.spec.ts
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/services/capabilities.service.ts apps/api/src/common/services/capabilities.service.spec.ts
git commit -m "feat(api): add pure CapabilitiesService that maps roles to capability strings"
```

### Task 3a.3: Wire `getCapabilities` into AuthorizationService with cache

**Files:**
- Modify: `apps/api/src/common/services/authorization.service.ts`
- Modify: `apps/api/src/common/services/authorization.service.spec.ts`
- Modify: `apps/api/src/common/common.module.ts` (or wherever `AuthorizationService` is provided — verify during execution).

**Signature decision (locked):** `getCapabilities(userId, roles, organizationId, teamId?)`. `roles` are the system roles from the JWT/API key, passed in by the caller. The service does NOT reach into request context — keeping it side-effect-free at this boundary makes it trivially testable and works identically for JWT- and API-key-authenticated calls (both flow through `KeycloakEnhancedAuthGuard.getRoles()` already). The controller in Task 3a.4 extracts `ctx.roles` via `@UserCtx()` and passes them through.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/common/services/__tests__/authorization.service.spec.ts`:

```typescript
describe('getCapabilities', () => {
  // Reuses the test bed already wired up in this file. If the existing harness
  // doesn't inject CapabilitiesService, add it to the providers array of the
  // testing module setup.

  it('returns global-admin capabilities when caller passes perfana-admin', async () => {
    const caps = await service.getCapabilities('user-1', ['perfana-admin'], null);
    expect(caps).toContain('integration:dynatrace:update');
    expect(caps).toContain('system:manage-users');
  });

  it('returns org-admin capabilities for an org-admin in the given org', async () => {
    // Arrange: user has organization_members row with role org-admin in 'org-a'
    const caps = await service.getCapabilities('user-2', ['perfana-user'], 'org-a');
    expect(caps).toContain('integration:dynatrace:update');
    expect(caps).toContain('org:manage-members');
    expect(caps).not.toContain('system:manage-users');
  });

  it('returns empty set when user has no membership in the org', async () => {
    const caps = await service.getCapabilities('outsider', ['perfana-user'], 'org-a');
    expect(caps).toEqual([]);
  });

  it('caches results: second call hits Redis, not the DB', async () => {
    await service.getCapabilities('user-2', ['perfana-user'], 'org-a');
    const dbSpy = jest.spyOn(orgMemberRepository, 'findOne');
    await service.getCapabilities('user-2', ['perfana-user'], 'org-a');
    expect(dbSpy).not.toHaveBeenCalled();
  });
});
```

(Adapt mock/spy names to whatever harness `authorization.service.spec.ts` already uses — the existing tests in that file show the shape.)

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx jest src/common/services/__tests__/authorization.service.spec.ts -t "getCapabilities"
```

Expected: FAIL — `getCapabilities is not a function`.

- [ ] **Step 3: Implement `getCapabilities`**

In `apps/api/src/common/services/authorization.service.ts`, inject `CapabilitiesService` into the constructor and append:

```typescript
import { CapabilitiesService } from './capabilities.service';
import { CapabilityValue } from '../../constants/capabilities.constants';
import { OrganizationRole, TeamRole } from '../../constants/roles.constants';

// ... existing class body ...

  /**
   * Compute the user's flat capability set for the given organization context.
   * Returns global-admin capabilities (every defined capability) when the caller
   * passes a system-admin role.
   *
   * Cached by `(userId, organizationId, teamId)`; cache is invalidated on
   * membership change via the existing `invalidateMembershipCache` flow.
   *
   * @param userId   User identity (Keycloak sub or `api-key:{id}`).
   * @param roles    System roles from the JWT/API key (pass `ctx.roles` from `@UserCtx()`).
   * @param organizationId  Organization scope, or `null` for global-only resolution.
   * @param teamId   Optional team scope.
   */
  async getCapabilities(
    userId: string,
    roles: string[],
    organizationId: string | null,
    teamId?: string | null,
  ): Promise<CapabilityValue[]> {
    const cacheKey = `auth:capabilities:${userId}:${organizationId ?? '_'}:${teamId ?? '_'}`;
    const cached = await this.getCachedCapabilities(cacheKey);
    if (cached !== null) return cached;

    const orgRoles = organizationId
      ? await this.loadOrgRoles(userId, organizationId)
      : [];
    const teamRoles = teamId ? await this.loadTeamRoles(userId, teamId) : [];

    const caps = this.capabilitiesService.compute({
      systemRoles: roles,
      orgRoles,
      teamRoles,
    });

    await this.cacheCapabilities(cacheKey, caps);
    return caps;
  }

  private async getCachedCapabilities(
    cacheKey: string,
  ): Promise<CapabilityValue[] | null> {
    if (!this.enableCache) return null;
    try {
      const raw = await this.redis.get(cacheKey);
      return raw ? (JSON.parse(raw) as CapabilityValue[]) : null;
    } catch {
      return null;
    }
  }

  private async cacheCapabilities(
    cacheKey: string,
    caps: CapabilityValue[],
  ): Promise<void> {
    if (!this.enableCache) return;
    try {
      await this.redis.set(cacheKey, JSON.stringify(caps), 'EX', this.cacheTtlSeconds);
    } catch {
      /* cache failures are non-fatal */
    }
  }

  private async loadOrgRoles(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationRole[]> {
    const member = await this.organizationMemberRepository.findOne({
      where: { user_id: userId, organization_id: organizationId },
    });
    return (member?.roles ?? []) as OrganizationRole[];
  }

  private async loadTeamRoles(userId: string, teamId: string): Promise<TeamRole[]> {
    const member = await this.teamMemberRepository.findOne({
      where: { user_id: userId, team_id: teamId },
    });
    return (member?.roles ?? []) as TeamRole[];
  }
```

> **Note for the engineer:** Do not introduce any `loadSystemRoles` helper or AsyncLocalStorage reach-back. Roles flow in as a parameter, full stop. If a caller can't easily get them, fix the caller — they probably already have `@UserCtx()` available.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/api && npx jest src/common/services/__tests__/authorization.service.spec.ts
```

Expected: all green, including the 4 new `getCapabilities` cases.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/services/authorization.service.ts apps/api/src/common/services/__tests__/authorization.service.spec.ts apps/api/src/common/common.module.ts
git commit -m "feat(api): add getCapabilities to AuthorizationService with Redis caching"
```

### Task 3a.4: Add `GET /api/users/me/permissions` endpoint

**Files:**
- Create: `apps/api/src/modules/users/users-permissions.controller.ts`
- Create: `apps/api/src/modules/users/users-permissions.controller.spec.ts`
- Create: `apps/api/src/modules/users/dto/permissions-response.dto.ts`
- Modify: `apps/api/src/modules/users/users.module.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/users/users-permissions.controller.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { UsersPermissionsController } from './users-permissions.controller';
import { AuthorizationService } from '../../common/services/authorization.service';

describe('UsersPermissionsController', () => {
  let controller: UsersPermissionsController;
  let authz: { getCapabilities: jest.Mock; getAccessibleOrganizations: jest.Mock };

  beforeEach(async () => {
    authz = {
      getCapabilities: jest.fn(),
      getAccessibleOrganizations: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersPermissionsController],
      providers: [{ provide: AuthorizationService, useValue: authz }],
    }).compile();
    controller = moduleRef.get(UsersPermissionsController);
  });

  it('returns global capabilities + per-org capability map', async () => {
    authz.getCapabilities
      .mockResolvedValueOnce(['system:manage-users']) // global, organizationId=null
      .mockResolvedValueOnce(['integration:dynatrace:update']) // org-a
      .mockResolvedValueOnce(['test-run:read']); // org-b
    authz.getAccessibleOrganizations.mockResolvedValue(['org-a', 'org-b']);

    const result = await controller.getMyPermissions({
      userId: 'user-1',
      roles: ['perfana-user'],
    } as any);

    expect(result).toEqual({
      userId: 'user-1',
      global: ['system:manage-users'],
      byOrg: {
        'org-a': ['integration:dynatrace:update'],
        'org-b': ['test-run:read'],
      },
    });
  });

  it('returns empty byOrg when user has no org memberships', async () => {
    authz.getCapabilities.mockResolvedValueOnce([]);
    authz.getAccessibleOrganizations.mockResolvedValue([]);

    const result = await controller.getMyPermissions({
      userId: 'user-1',
      roles: ['perfana-user'],
    } as any);

    expect(result).toEqual({
      userId: 'user-1',
      global: [],
      byOrg: {},
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx jest src/modules/users/users-permissions.controller.spec.ts
```

Expected: FAIL — controller does not exist.

- [ ] **Step 3: Implement DTO**

Create `apps/api/src/modules/users/dto/permissions-response.dto.ts`:

```typescript
import { ApiProperty } from '@nestjs/swagger';

export class PermissionsResponseDto {
  @ApiProperty({ description: 'Authenticated user ID (Keycloak sub or api-key:{id})' })
  userId!: string;

  @ApiProperty({
    description: 'Capability strings the user has globally (independent of org context)',
    type: [String],
  })
  global!: string[];

  @ApiProperty({
    description: 'Capability strings per accessible organization, keyed by organizationId',
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string' } },
  })
  byOrg!: Record<string, string[]>;
}
```

- [ ] **Step 4: Implement controller**

Create `apps/api/src/modules/users/users-permissions.controller.ts`:

```typescript
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthorizationService } from '../../common/services/authorization.service';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';
import { PermissionsResponseDto } from './dto/permissions-response.dto';

@ApiTags('users')
@Controller('users/me')
export class UsersPermissionsController {
  constructor(private readonly authzService: AuthorizationService) {}

  @Get('permissions')
  @ApiOperation({
    summary: 'Get the current user\'s capability set',
    description:
      'Returns global capabilities (independent of org) and per-organization capabilities for ' +
      'every org the user belongs to. The frontend uses this to gate UI actions.',
  })
  async getMyPermissions(@UserCtx() ctx: UserContext): Promise<PermissionsResponseDto> {
    const orgIds = await this.authzService.getAccessibleOrganizations(ctx.userId);

    // Fan out the per-org capability lookups in parallel. Each call hits Redis
    // (cached) or Postgres (cold cache). Serial would be N round-trips for a
    // user with N orgs; Promise.all keeps p99 at one round-trip's latency
    // regardless of org count.
    const [global, ...orgCaps] = await Promise.all([
      this.authzService.getCapabilities(ctx.userId, ctx.roles, null),
      ...orgIds.map((orgId) =>
        this.authzService.getCapabilities(ctx.userId, ctx.roles, orgId),
      ),
    ]);

    const byOrg: Record<string, string[]> = {};
    orgIds.forEach((orgId, i) => {
      byOrg[orgId] = orgCaps[i];
    });

    return { userId: ctx.userId, global, byOrg };
  }
}
```

(Note: this file passes `roles` to `getCapabilities` per the Task 3a.3 implementation note — confirm signature consistency before running tests.)

- [ ] **Step 5: Register the controller**

Modify `apps/api/src/modules/users/users.module.ts` — add `UsersPermissionsController` to the `controllers` array.

- [ ] **Step 6: Run unit test**

```bash
cd apps/api && npx jest src/modules/users/users-permissions.controller.spec.ts
```

Expected: 2 passing.

- [ ] **Step 7: Run full apps/api suite to catch wiring breakage**

```bash
cd apps/api && npx jest
```

Expected: all green. Any unrelated failure means a DI miss or a roles-constants regression.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/users
git commit -m "feat(api): add GET /api/users/me/permissions endpoint"
```

### Task 3a.5: Cache invalidation on membership change

**Files:**
- Modify: `apps/api/src/modules/organizations/organization-members.service.ts` — wherever `invalidateMembershipCache` is currently called, also invalidate the new `auth:capabilities:*` keys.
- Modify: `apps/api/src/modules/teams/team-members.service.ts` — same.
- Modify: `apps/api/src/common/services/authorization.service.ts` — extend `invalidateMembershipCache(userId, orgId?)` to also `redis.del()` the capability keys for that user.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/common/services/__tests__/authorization.service.spec.ts`:

```typescript
it('invalidates capability cache when membership changes', async () => {
  // First call populates cache
  await service.getCapabilities('user-2', ['perfana-user'], 'org-a');
  // Membership change
  await service.invalidateMembershipCache('user-2', 'org-a');
  // Second call should re-hit DB
  const dbSpy = jest.spyOn(orgMemberRepository, 'findOne');
  await service.getCapabilities('user-2', ['perfana-user'], 'org-a');
  expect(dbSpy).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx jest src/common/services/__tests__/authorization.service.spec.ts -t "invalidates capability cache"
```

Expected: FAIL — invalidation doesn't touch capability keys.

- [ ] **Step 3: Extend invalidation**

In `authorization.service.ts`, find `invalidateMembershipCache` and append:

```typescript
  async invalidateMembershipCache(userId: string, organizationId?: string): Promise<void> {
    // ... existing membership-key deletions ...

    // Capabilities depend on memberships — flush per-user capability keys.
    const pattern = organizationId
      ? `auth:capabilities:${userId}:${organizationId}:*`
      : `auth:capabilities:${userId}:*`;
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) await this.redis.del(...keys);
    } catch {
      /* non-fatal */
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/api && npx jest src/common/services/__tests__/authorization.service.spec.ts
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/services/authorization.service.ts apps/api/src/common/services/__tests__/authorization.service.spec.ts
git commit -m "feat(api): invalidate capability cache on membership changes"
```

### Task 3a.6: Migration tooling (lint + burndown + drift check + date gate)

The capabilities API is foundation; without scaffolding, Phase 3c (rolling capabilities through the 102 deferred Bucket A sites + 14 Bucket B sites + removing the 13 local `private isGlobalAdmin()` wrappers) becomes the half-shipped pattern that haunts the codebase forever. This task installs five mechanisms that make Phase 3c self-driving instead of dependent on someone remembering to do it.

**Files:**
- Create: `apps/api/eslint-rules/no-direct-is-global-admin.js` — custom ESLint rule.
- Create: `apps/api/eslint-rules/no-direct-is-global-admin.spec.js` — rule tests.
- Modify: `apps/api/.eslintrc.js` (or `eslint.config.mjs` — verify during execution) — register the rule + grandfathered file allowlist.
- Create: `apps/api/.rbac-migration-allowlist.json` — generated from the audit log; lists the 116 files that legally still call `authzService.isGlobalAdmin(...)` directly. Shrinks as Phase 3c progresses.
- Modify: `docs/superpowers/audits/2026-04-26-audit-decisions.md` — add a "Migration progress" section at the top.
- Create: `CONTRIBUTING.md` (if missing) or modify it — add an "RBAC migration" section.
- Create: `docs/superpowers/scheduled-agents/rbac-drift-check.md` — instructions for the recurring `/schedule` agent that catches drift the lint rule misses.
- Modify: `CLAUDE.md` — update the "Phase 3" status row to reference the burndown.

- [ ] **Step 1: Generate the grandfathered allowlist from the audit log**

```bash
# Extract every file path from the audit log that has at least one Bucket A or Bucket B site.
# This becomes the lint rule's allowlist — these files are exempt until they're migrated.
node <<'JS' > apps/api/.rbac-migration-allowlist.json
const fs = require('fs');
const log = fs.readFileSync('docs/superpowers/audits/2026-04-26-audit-decisions.md', 'utf8');
const re = /`(apps\/api\/src\/[^:`]+\.ts)/g;
const paths = new Set([...log.matchAll(re)].map((m) => m[1]));
console.log(JSON.stringify(Array.from(paths).sort(), null, 2));
JS
wc -l apps/api/.rbac-migration-allowlist.json
```

Expected: ~116 unique file paths (one per file containing a Bucket A or B site), sorted alphabetically.

- [ ] **Step 2: Write the failing lint-rule test**

Create `apps/api/eslint-rules/no-direct-is-global-admin.spec.js`:

```javascript
const { RuleTester } = require('eslint');
const rule = require('./no-direct-is-global-admin');

const ruleTester = new RuleTester({
  parser: require.resolve('@typescript-eslint/parser'),
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('no-direct-is-global-admin', rule, {
  valid: [
    // The AuthorizationService itself is allowed to define and use isGlobalAdmin.
    {
      filename: 'apps/api/src/common/services/authorization.service.ts',
      code: `class A { isGlobalAdmin(roles) { return roles.includes('admin'); } }`,
    },
    // Capabilities-based check is the new pattern, never flagged.
    {
      filename: 'apps/api/src/modules/foo/foo.service.ts',
      code: `class B { check(caps) { return caps.includes('foo:bar'); } }`,
    },
    // Grandfathered file (from .rbac-migration-allowlist.json) — flagged but tolerated.
    {
      filename: 'apps/api/src/modules/dynatrace/dynatrace.service.ts',
      code: `class C { x(roles) { return this.authzService.isGlobalAdmin(roles); } }`,
    },
  ],
  invalid: [
    // New file (not on allowlist) using the old pattern → fail.
    {
      filename: 'apps/api/src/modules/newfeature/newfeature.service.ts',
      code: `class D { x(roles) { return this.authzService.isGlobalAdmin(roles); } }`,
      errors: [
        {
          messageId: 'noDirectIsGlobalAdmin',
          data: { file: 'apps/api/src/modules/newfeature/newfeature.service.ts' },
        },
      ],
    },
  ],
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd apps/api && npx jest eslint-rules/no-direct-is-global-admin.spec.js
```

Expected: FAIL — rule does not exist.

- [ ] **Step 4: Implement the rule**

Create `apps/api/eslint-rules/no-direct-is-global-admin.js`:

```javascript
const fs = require('fs');
const path = require('path');

let allowlist = null;
function loadAllowlist(cwd) {
  if (allowlist !== null) return allowlist;
  try {
    const p = path.join(cwd, 'apps/api/.rbac-migration-allowlist.json');
    allowlist = new Set(JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch {
    allowlist = new Set();
  }
  return allowlist;
}

// Authz infrastructure: these files legitimately call authzService.isGlobalAdmin
// because that IS their job (encapsulating the admin-bypass check so that callers
// don't have to). Permanently exempt — never on the burndown.
const INFRASTRUCTURE_FILES = new Set([
  'apps/api/src/common/services/authorization.service.ts',     // defines isGlobalAdmin
  'apps/api/src/common/services/authorized-base.service.ts',   // applyOrgFilter, getAccessibleOrgIds, verifyOrganizationAccess
  'apps/api/src/common/utils/with-org-filter.ts',              // shipped in PR #175 — the helper the migration uses
  'apps/api/src/common/guards/capability.guard.ts',            // CapabilityGuard reads getCapabilities (added in Phase 3c)
]);

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid new direct calls to authzService.isGlobalAdmin(). Use AuthorizationService.getCapabilities() or the @RequiresCapability decorator. Grandfathered files (from the 2026-04-26 audit) are allowed via apps/api/.rbac-migration-allowlist.json. Authz infrastructure files (AuthorizationService, AuthorizedBaseService, withOrgFilter, CapabilityGuard) are permanently exempt — they implement the helpers the migration uses.',
    },
    messages: {
      noDirectIsGlobalAdmin:
        'Direct authzService.isGlobalAdmin() is deprecated. Use getCapabilities() or @RequiresCapability. See docs/superpowers/audits/2026-04-26-audit-decisions.md. To migrate this file, remove it from .rbac-migration-allowlist.json.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();
    const cwd = context.getCwd ? context.getCwd() : process.cwd();
    const relPath = path.relative(cwd, filename);

    // Authz infrastructure: permanent exemption.
    if (INFRASTRUCTURE_FILES.has(relPath)) return {};

    // Grandfathered files: tolerate (they're on the burndown list).
    const allow = loadAllowlist(cwd);
    if (allow.has(relPath)) return {};

    return {
      // Match `<anything>.isGlobalAdmin(...)` calls.
      "CallExpression[callee.property.name='isGlobalAdmin']"(node) {
        context.report({ node, messageId: 'noDirectIsGlobalAdmin' });
      },
    };
  },
};
```

- [ ] **Step 5: Register the rule**

Modify `apps/api/.eslintrc.js` (or whichever ESLint config the API uses — verify with `ls apps/api/.eslint*` and `ls apps/api/eslint*` during execution):

```javascript
// Add to the existing config
module.exports = {
  // ... existing config ...
  rules: {
    // ... existing rules ...
    'local/no-direct-is-global-admin': 'error',
  },
  plugins: {
    // ... existing plugins ...
    local: { rules: { 'no-direct-is-global-admin': require('./eslint-rules/no-direct-is-global-admin') } },
  },
};
```

If the project uses flat config (`eslint.config.mjs`), the equivalent is:

```javascript
import noDirectIsGlobalAdmin from './eslint-rules/no-direct-is-global-admin.js';

export default [
  {
    plugins: { local: { rules: { 'no-direct-is-global-admin': noDirectIsGlobalAdmin } } },
    rules: { 'local/no-direct-is-global-admin': 'error' },
  },
];
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd apps/api && npx jest eslint-rules/no-direct-is-global-admin.spec.js
```

Expected: 4 passing.

- [ ] **Step 7: Run lint against the API to verify the allowlist is correct**

```bash
cd apps/api && npm run lint
```

Expected: zero NEW lint errors. The grandfathered files don't trigger the rule because they're on the allowlist. If a non-allowlisted file fails, the audit log missed it — add it to the allowlist (and the audit log) and re-run.

- [ ] **Step 8: Add the burndown section to the audit log**

Modify `docs/superpowers/audits/2026-04-26-audit-decisions.md` — insert at the top, immediately after the H1:

```markdown
## Migration progress

Phase 3c rolls capabilities through every site listed below. Update these counts on every PR that migrates a site (subtract from the "remaining" column, add to the "migrated" column). When all reach 0 / N, mark Phase 3 as Completed in CLAUDE.md.

| Bucket | Total | Migrated | Remaining | % done |
| --- | ---: | ---: | ---: | ---: |
| A — bypass filter | 127 | 1 | 126 | 0.8% |
| B — bypass guard | 14 | 0 | 14 | 0% |
| Local `private isGlobalAdmin()` wrappers | 13 | 0 | 13 | 0% |

**Lint enforcement:** `apps/api/.rbac-migration-allowlist.json` lists every file currently exempt from the `no-direct-is-global-admin` lint rule. When a site is migrated, remove its file from the allowlist (the file may have multiple sites — only remove when the LAST one is migrated). Allowlist size IS the burndown.

**Date-bound revisit:** by **2026-08-01**, Phase 3c migration must be at least 50% complete (Bucket A + B combined: 70+ sites migrated). If not, re-evaluate the architecture or the priorities. "We forgot about it" is the failure mode this gate prevents.

**Drift check:** a `/schedule` agent runs every 2 weeks (see `docs/superpowers/scheduled-agents/rbac-drift-check.md`) and opens a PR if it finds new direct `isGlobalAdmin` usage outside the allowlist. The lint rule should make this redundant; the agent catches anything that snuck in via dependencies or merge conflicts.
```

- [ ] **Step 9: Add the CONTRIBUTING.md rule**

If `CONTRIBUTING.md` doesn't exist, create it with this section. If it does, append the section.

```markdown
## RBAC migration (in progress until 2026-08-01)

When you modify any file listed in `apps/api/.rbac-migration-allowlist.json`, migrate its `isGlobalAdmin` sites to the capabilities API as part of the same PR. The lint rule (`local/no-direct-is-global-admin`) blocks new sites; the allowlist tolerates existing ones. Migration patterns:

- **Bucket A (filter bypass):** use `withOrgFilter` (`apps/api/src/common/utils/with-org-filter.ts`).
- **Bucket B (guard):** use the `@RequiresCapability(...)` decorator.
- **Bucket C (mixed):** check `docs/superpowers/audits/2026-04-26-audit-decisions.md` — these aren't always migratable. If yours is in C and resists migration, leave a comment on the call site explaining why.

After migrating a site, remove its file from `apps/api/.rbac-migration-allowlist.json` (when the LAST site in that file is migrated) and update the burndown table in the audit log.
```

- [ ] **Step 10: Document the drift-check schedule**

Create `docs/superpowers/scheduled-agents/rbac-drift-check.md`:

````markdown
# RBAC Drift Check

**Cadence:** every 2 weeks.

**Trigger:** `/schedule "every 2 weeks: run docs/superpowers/scheduled-agents/rbac-drift-check.md"`.

**Job:** audit `apps/api/src` for direct `isGlobalAdmin` usage outside the AuthorizationService and the grandfathered allowlist. Catches drift the ESLint rule missed (new dependencies bringing the pattern in, merge conflicts that re-introduced a removed call, etc.).

**Steps:**

1. Read `apps/api/.rbac-migration-allowlist.json`.
2. Run:
   ```bash
   rg -l "this\.authzService\.isGlobalAdmin\(" apps/api/src --type ts -g '!*.spec.ts' \
     | grep -vFf <(jq -r '.[]' apps/api/.rbac-migration-allowlist.json)
   ```
3. If the output is non-empty, those are NEW sites that snuck past the lint rule. For each:
   - Open a PR migrating the site (use the existing `withOrgFilter` / `@RequiresCapability` patterns).
   - If the migration isn't trivial, add the file to the allowlist with a comment explaining why and open a follow-up issue.
4. Also report the burndown numbers: count remaining allowlist entries, compare to the previous run's count. If the prior 14 days show zero progress, raise it as a stalled-migration concern.

**Stop condition:** allowlist reaches empty AND audit log burndown shows 0/127 + 0/14. Disable the schedule.
````

- [ ] **Step 11: Update CLAUDE.md status table**

Modify the RBAC Implementation Status table in `CLAUDE.md`:

```markdown
| Phase 3 | Service-layer authorization enforcement | In progress (foundation shipped 2026-04-28; per-service rollout tracked in `docs/superpowers/audits/2026-04-26-audit-decisions.md` — burndown 0% / target 50% by 2026-08-01) |
```

- [ ] **Step 12: Commit**

```bash
git add apps/api/eslint-rules apps/api/.eslintrc.js apps/api/eslint.config.mjs apps/api/.rbac-migration-allowlist.json docs/superpowers/audits/2026-04-26-audit-decisions.md docs/superpowers/scheduled-agents/rbac-drift-check.md CONTRIBUTING.md CLAUDE.md
git status --short  # verify only intended files are staged
git commit -m "feat(api): set up RBAC migration tooling (lint rule + burndown + drift check)"
```

(Stage only the files that exist after Steps 5/9 — if `CONTRIBUTING.md` already existed, the `git add` of it is fine; if not, it's now created. Same for which ESLint config file got modified.)

### Task 3a.7: Phase 3a integration smoke test + ship

**Files:**
- Test only.

- [ ] **Step 1: Smoke-test the live endpoint**

```bash
# Start the dev stack if not already running
lsof -ti:3001 >/dev/null || npm run dev:api &

# Get a JWT for the admin test user (admin@perfana.io / admin123 per CLAUDE.md or local seed)
TOKEN=$(curl -s -X POST 'http://localhost:8080/realms/perfana-prod/protocol/openid-connect/token' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=password' -d 'client_id=perfana-web' \
  --data-urlencode 'username=admin@perfana.io' --data-urlencode 'password=<seed-password>' | jq -r .access_token)

curl -s 'http://localhost:3001/api/users/me/permissions' \
  -H "Authorization: Bearer $TOKEN" | jq
```

Expected: response shape `{ userId, global: [...], byOrg: { "<orgId>": [...] } }`. Global admin sees every capability. Org-member sees only their org's mapped capabilities.

- [ ] **Step 2: Bump version + CHANGELOG + open PR**

Same flow as PR #175: bump VERSION (MICRO), add CHANGELOG entry, commit, push, open PR. Capture PR URL.

---

## Phase 3b: Per-resource `_permissions` field

> **Status:** Architecture locked, sub-plan to be expanded immediately before execution.

### What it delivers

API responses for resources where ownership matters carry `_permissions` so the frontend can render edit/delete affordances correctly per row, without needing to re-implement the policy. Pilot on Dynatrace configs because that's the surface that bit us; rolling pattern after.

### Architecture decisions (locked)

- **Generic helper, not per-resource decorator.** `attachPermissions(resource, actionMap)` takes a resource and a map `{ update: boolean, delete: boolean, ... }` and returns the resource with a non-enumerable-friendly `_permissions` field. Service-layer code calls it; controllers stay thin.
- **Compute happens in the service, not in an interceptor.** Interceptors don't have the resource-specific authorization context (e.g. "is this config in an org I'm an admin of?"). Services already do; they just need to surface the boolean.
- **Action set is per-resource-type.** Dynatrace configs get `{ update, delete }`. Reports get `{ update, delete, share }`. Etc. No global action vocabulary — match what the resource supports.
- **Frontend always reads `_permissions` if present, falls back to `usePermissions().can(...)` if absent.** Ensures backward compatibility while migrating.

### Worked first task (full TDD)

**Task 3b.1: Generic `attachPermissions` helper**

**Files:**
- Create: `apps/api/src/common/serializers/with-permissions.serializer.ts`
- Create: `apps/api/src/common/serializers/with-permissions.serializer.spec.ts`

Test:

```typescript
import { attachPermissions } from './with-permissions.serializer';

describe('attachPermissions', () => {
  it('adds _permissions to a single resource', () => {
    const r = { id: 'a', label: 'foo' };
    const out = attachPermissions(r, { update: true, delete: false });
    expect(out).toEqual({ id: 'a', label: 'foo', _permissions: { update: true, delete: false } });
  });

  it('adds _permissions to each item in an array', () => {
    const list = [{ id: 'a' }, { id: 'b' }];
    const out = attachPermissions(list, { update: true });
    expect(out).toEqual([
      { id: 'a', _permissions: { update: true } },
      { id: 'b', _permissions: { update: true } },
    ]);
  });

  it('preserves existing fields without mutation', () => {
    const r = { id: 'a', _permissions: { update: false } };
    const out = attachPermissions(r, { delete: true });
    expect(out._permissions).toEqual({ delete: true });
    expect(r._permissions).toEqual({ update: false });
  });
});
```

Implementation:

```typescript
export type PermissionsMap = Record<string, boolean>;

export function attachPermissions<T extends object>(
  resource: T,
  permissions: PermissionsMap,
): T & { _permissions: PermissionsMap };
export function attachPermissions<T extends object>(
  resources: T[],
  permissions: PermissionsMap,
): Array<T & { _permissions: PermissionsMap }>;
export function attachPermissions<T extends object>(
  resourceOrList: T | T[],
  permissions: PermissionsMap,
): unknown {
  if (Array.isArray(resourceOrList)) {
    return resourceOrList.map((r) => ({ ...r, _permissions: permissions }));
  }
  return { ...resourceOrList, _permissions: permissions };
}
```

Commit: `feat(api): add attachPermissions serializer for per-resource permission hints`.

### Remaining 3b tasks (to expand into a sub-plan)

- **3b.2:** Wire into `DynatraceService.findAll` — compute `_permissions.update` and `_permissions.delete` per config based on `existing.organizationId === null` (legacy escape hatch flag) OR org-admin in that org.
- **3b.3:** Wire into `DynatraceService.findOne` and `findByHost` (same shape).
- **3b.4:** Update `apps/api/src/modules/dynatrace/dto/dynatrace-config-response.dto.ts` with the optional `_permissions` field for Swagger/typing.
- **3b.5:** Add the same shape to other integration types (Grafana, Pyroscope, Tracing) — copy the dynatrace pattern. One PR per integration is fine; or batch.

### Done criteria

`GET /api/dynatrace` returns each config with `_permissions: { update: boolean, delete: boolean }`. The boolean reflects: `globalAdmin OR orgAdmin(config.organizationId)`. Frontend can read it directly.

---

## Phase 3c: Service-layer enforcement walkthrough

> **Status:** Architecture locked, sub-plan per service group to be expanded immediately before execution. Reference list of sites in `docs/superpowers/audits/2026-04-26-audit-decisions.md`.

### What it delivers

Every authorization decision in the API surface goes through `AuthorizationService` (capabilities or per-resource ACL). No service inlines the role check anymore. Adds a `@RequiresCapability` decorator + guard for the Bucket B (throw-on-non-admin) sites.

### Architecture decisions (locked)

- **Bucket A sites** (filter bypass): use the existing `withOrgFilter` helper from PR #175. Migrate per-service per-PR using the dynatrace pilot as the worked example.
- **Bucket B sites** (throw guard): replace inline `if (!isGlobalAdmin) throw` patterns with a method-level decorator:
  ```typescript
  @RequiresCapability(Capability.IntegrationDynatraceUpdate)
  async update(...) { ... }
  ```
  The decorator + guard pull `organizationId` from a request param or DTO field via reflection. For per-resource cases (where the org comes from the resource itself, not the request), keep the inline `canModifyResource` call.
- **Bucket C sites** (mixed/log-only/Phase-4 stubs): handle case-by-case. Many will become DONE once Phase 4 closes the null-org gap and the pre-Phase-4 stub blocks become deletable.

### Worked first task (architecture only)

**Task 3c.1: `@RequiresCapability` decorator + guard**

**Files:**
- Create: `apps/api/src/common/decorators/requires-capability.decorator.ts`
- Create: `apps/api/src/common/guards/capability.guard.ts`
- Create: spec for both.

The decorator stores the required capability + the org-id-source (`@RequiresCapability(cap, { orgIdParam: 'id' })`). The guard reads metadata, resolves the org ID from the request, calls `authzService.getCapabilities(userId, roles, orgId)`, and throws `ForbiddenException` if the capability isn't present.

Spec example:

```typescript
@Controller('foo')
export class FooController {
  @Patch(':id')
  @RequiresCapability(Capability.IntegrationDynatraceUpdate, { orgIdFromBody: 'organizationId' })
  async update() { ... }
}
```

When `PATCH /foo/abc` arrives with body `{ organizationId: 'org-a', ... }`, the guard checks the user has `integration:dynatrace:update` in `org-a`. If not → 403.

**Telemetry on deny (mandatory).** A capability denial is real ops signal in a multi-tenant system: misconfigured user, attack, deployment regression, missing membership backfill. With zero telemetry, you only learn about it from support tickets. Inside the deny path, BEFORE the throw:

```typescript
this.logger.warn(
  `Capability denied: capability=${requiredCapability} userId=${ctx.userId} orgId=${orgId ?? 'null'} route=${request.method} ${request.url}`,
);
// If perfana has Prometheus metrics infrastructure (verify during execution):
this.metrics?.increment('auth_capability_denied_total', { capability: requiredCapability });
throw new ForbiddenException(`Missing capability: ${requiredCapability}`);
```

The structured log is the minimum. Bumping a counter is bonus if `MetricsService` (or equivalent) is already wired in the project — verify by grepping `apps/api/src` for an existing metrics provider before adding the line. If none exists, ship the WARN log alone; don't introduce new infrastructure for one counter.

The matching test asserts the WARN was emitted with the right shape. Ops can grep for `Capability denied:` in production logs to spot patterns; pair with an alert on per-user rate spikes if your log pipeline supports it.

### Remaining 3c tasks (to expand into a sub-plan)

For each Bucket A and Bucket B file in `2026-04-26-audit-decisions.md`:
- One PR per service (or per ~3 small services bundled).
- Per-PR pattern: classify each site (canonical vs not), migrate canonical sites, leave non-canonical, run tests, ship.
- Track progress in the audit log doc.

### Done criteria

- 100% of Bucket A canonical sites use `withOrgFilter`.
- 100% of Bucket B sites use `@RequiresCapability` (or have a documented reason to stay inline).
- The 13 local `private isGlobalAdmin()` wrappers are deleted.
- Audit log shows every site with a final disposition.

---

## Phase 4: Data migration (close the null-org escape hatch)

> **Status:** Architecture locked, per-entity sub-plan to be expanded immediately before execution.

### What it delivers

Every owned resource has a non-null `organization_id`. The "any authenticated user can edit a legacy null-org row" hole is closed. Service code that conditioned on `organizationId === null` becomes dead and is deleted.

### Architecture decisions (locked)

- **Backfill strategy:** for each resource with `organization_id == null`, assign to the org of the resource's `created_by` user's first organization membership. If the creator has no org membership (e.g. system-seeded data, deleted user), assign to a designated "Unowned" org created in the migration. After backfill, alter the column to `NOT NULL`.
- **One migration per entity, two files:** a `Backfill...` migration runs in production safely (idempotent, batched if the table is large), a follow-up `...NotNull` migration runs once all envs have backfilled. This avoids long ALTER TABLE locks on hot tables.
- **Order:** start with low-traffic entities (Profiles, Benchmarks, Notification Channels). Build muscle. Tackle high-traffic last (Test Runs is by far the biggest — separate care).
- **Code cleanup:** for each entity, after the NOT NULL migration ships, delete the `if (existing.organizationId)` checks in services. Stop conditioning on a column that can no longer be null.

### Worked first task (sketch)

**Task 4.1: Backfill `dynatrace_configs.organization_id`**

**Files:**
- Create: `packages/shared/src/database/migrations/<timestamp>-BackfillDynatraceConfigOrganizationId.ts`
- (later) Create: `packages/shared/src/database/migrations/<timestamp>-DynatraceConfigOrganizationIdNotNull.ts`
- Modify (later): `packages/shared/src/entities/dynatrace-config.entity.ts` — remove `nullable: true`.
- Modify (later): `apps/api/src/modules/dynatrace/dynatrace.service.ts` — delete the `if (existing.organizationId)` branches in `update()` and `delete()`.

**Chunking rule (mandatory for every Phase 4 backfill):** every backfill UPDATE on a table with >100k rows MUST run in chunks of 1,000 rows with a short `pg_sleep` between batches. A single unbounded `UPDATE … WHERE organization_id IS NULL` will hold an exclusive lock for minutes on hot tables (Test Runs is the obvious worst case but Application Dashboards, Grafana Dashboards, and Reports are all in the danger zone) and will block production traffic or time out under autovacuum contention. Even the small-table cases (Profiles, Notification Channels, Graph Presets) use the chunked pattern below — uniform shape, easier to copy-paste-adapt, no judgment call about "is this table big enough."

Backfill migration sketch (chunked, copy this pattern verbatim for every entity):

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillDynatraceConfigOrganizationId1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) Ensure an "Unowned" fallback org exists. This is a backstop — every
    // row that lands in this org should be reported back to the caller and
    // either reassigned or deleted before Phase 4 closes.
    await queryRunner.query(`
      INSERT INTO organizations (id, name, created_at, updated_at)
      VALUES ('00000000-0000-0000-0000-000000000001', 'Unowned (migration fallback)', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `);

    // 2) Chunked backfill. Loops 1k rows at a time, sleeps 100ms between
    // batches to give autovacuum and concurrent writes room. SKIP LOCKED
    // means a row another transaction is editing is left for the next pass
    // instead of blocking. Idempotent — re-running is a no-op once every
    // row has organization_id set.
    await queryRunner.query(`
      DO $$
      DECLARE
        rows_updated INTEGER := 1;
      BEGIN
        WHILE rows_updated > 0 LOOP
          WITH chunk AS (
            SELECT id
            FROM dynatrace_configs
            WHERE organization_id IS NULL
            LIMIT 1000
            FOR UPDATE SKIP LOCKED
          )
          UPDATE dynatrace_configs c
          SET organization_id = COALESCE(
            (
              SELECT organization_id
              FROM organization_members
              WHERE user_id = c.created_by
              LIMIT 1
            ),
            '00000000-0000-0000-0000-000000000001'
          )
          FROM chunk
          WHERE c.id = chunk.id;
          GET DIAGNOSTICS rows_updated = ROW_COUNT;
          PERFORM pg_sleep(0.1);
        END LOOP;
      END $$;
    `);

    // 3) Report how many rows landed in the "Unowned" backstop. Engineers
    // running this migration should grep the migration output for this
    // line and follow up if the count is non-zero.
    const unownedCount = await queryRunner.query(`
      SELECT COUNT(*)::int AS n
      FROM dynatrace_configs
      WHERE organization_id = '00000000-0000-0000-0000-000000000001'
    `);
    // eslint-disable-next-line no-console
    console.log(`[backfill] dynatrace_configs in Unowned org: ${unownedCount[0].n}`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op: backfilling is one-way. The follow-up NOT NULL migration is the
    // gate; reverting that gate restores nullability without losing data.
  }
}
```

The follow-up `NotNull` migration runs `ALTER TABLE dynatrace_configs ALTER COLUMN organization_id SET NOT NULL` plus a foreign key validation pass.

### Remaining 4.* tasks (to expand into a sub-plan)

For each of the ~25 entities in CLAUDE.md "Entities with Ownership Tracking":
- One PR per entity (or per closely-related cluster).
- Same backfill+NotNull pattern.
- Code cleanup to delete the `if (existing.organizationId)` branch.

Cluster suggestion (low-traffic first):
1. Profiles, Benchmarks, Notification Channels, API Keys
2. Graph Presets, Filter Presets, Trends Presets
3. Dynatrace configs/queries, Pyroscope instances, Tracing instances/services, Grafana instances
4. Application Dashboards, Grafana Dashboards
5. Deep Links, URL Patterns, Expected Config Changes
6. Report Templates, Generated Reports
7. **Test Runs (last, separate plan)** — biggest table, longest backfill, highest blast radius. Treat as its own multi-step operation with maintenance window planning.

### Done criteria

- Every "owned" entity has `organization_id NOT NULL` in production.
- No service conditions on `existing.organizationId == null`.
- The audit log's "legacy escape hatch" risk is closed.

---

## Frontend phase: capabilities client + UI gating

> **Status:** Architecture locked, sub-plan to be expanded immediately before execution.

### What it delivers

The frontend gates UI actions on real capabilities, shipped via `usePermissions()` and `<RequiresPermission>`. Pilot on the Integrations page (the surface that triggered this work). Other UI areas migrate incrementally.

### Architecture decisions (locked)

- **`usePermissions()` is the only UI-facing entry point.** Components never inspect `user.roles` or `organization.role` directly. Anyone reaching for those is a code-review red flag.
- **`<RequiresPermission action orgId fallback>` for declarative gating:**
  - `fallback="hide"` — render nothing (use sparingly; "where did the button go?" support tickets)
  - `fallback="disabled"` (default) — render disabled with a tooltip explaining why
  - `fallback={<CustomElement/>}` — render a custom alternative
- **Per-resource `_permissions` takes precedence over capabilities** when present. Use the resource's own answer; capabilities are the fallback.
- **Loaded via React Query** with infinite stale time, invalidated on `auth:user-changed` and `auth:org-switched` events.

### Worked first task (full TDD)

**Task FE.1: `usePermissions()` hook**

**Files:**
- Create: `apps/web/lib/api/permissions.ts`
- Create: `apps/web/hooks/usePermissions.ts`
- Create: `apps/web/hooks/usePermissions.test.tsx`

Test:

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePermissions } from './usePermissions';

jest.mock('@/lib/api/permissions', () => ({
  fetchPermissions: jest.fn(),
}));
const { fetchPermissions } = require('@/lib/api/permissions');

function wrapper({ children }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('usePermissions', () => {
  beforeEach(() => fetchPermissions.mockReset());

  it('returns can(action, ctx) that resolves from byOrg map', async () => {
    fetchPermissions.mockResolvedValue({
      userId: 'u',
      global: [],
      byOrg: { 'org-a': ['integration:dynatrace:update'] },
    });
    const { result } = renderHook(() => usePermissions(), { wrapper });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.can('integration:dynatrace:update', { organizationId: 'org-a' })).toBe(true);
    expect(result.current.can('integration:dynatrace:update', { organizationId: 'org-b' })).toBe(false);
  });

  it('returns can(action) that resolves from global capabilities', async () => {
    fetchPermissions.mockResolvedValue({
      userId: 'u',
      global: ['system:manage-users'],
      byOrg: {},
    });
    const { result } = renderHook(() => usePermissions(), { wrapper });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.can('system:manage-users')).toBe(true);
  });

  it('returns false during initial load', () => {
    fetchPermissions.mockResolvedValue({ userId: 'u', global: [], byOrg: {} });
    const { result } = renderHook(() => usePermissions(), { wrapper });
    expect(result.current.isLoaded).toBe(false);
    expect(result.current.can('anything')).toBe(false);
  });
});
```

Implementation:

```typescript
// apps/web/lib/api/permissions.ts
import { authenticatedFetch } from '@/lib/api';

export interface PermissionsResponse {
  userId: string;
  global: string[];
  byOrg: Record<string, string[]>;
}

export async function fetchPermissions(): Promise<PermissionsResponse> {
  const r = await authenticatedFetch('/users/me/permissions');
  if (!r.ok) throw new Error(`Failed to fetch permissions: ${r.status}`);
  return r.json();
}
```

```typescript
// apps/web/hooks/usePermissions.ts
import { useQuery } from '@tanstack/react-query';
import { fetchPermissions } from '@/lib/api/permissions';

export interface PermissionContext {
  organizationId?: string;
  /** When true, prefer the per-resource _permissions field if available. */
  resourcePermissions?: Record<string, boolean>;
}

export function usePermissions() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['permissions', 'me'],
    queryFn: fetchPermissions,
    staleTime: Infinity,
  });

  const can = (action: string, ctx?: PermissionContext): boolean => {
    if (ctx?.resourcePermissions && action in ctx.resourcePermissions) {
      return ctx.resourcePermissions[action] === true;
    }
    if (!data) return false;
    if (data.global.includes(action)) return true;
    if (ctx?.organizationId) {
      return data.byOrg[ctx.organizationId]?.includes(action) ?? false;
    }
    return false;
  };

  return { can, isLoaded: !isLoading && !isError };
}
```

Run tests: `cd apps/web && npx jest hooks/usePermissions.test.tsx`. Commit: `feat(web): add usePermissions hook backed by /api/users/me/permissions`.

### Remaining FE.* tasks (to expand into a sub-plan)

- **FE.2:** `<RequiresPermission>` wrapper component (declarative gating). 4 render modes (hide, disabled-tooltip, custom fallback, render-prop). Tested.
- **FE.3:** Pilot on `IntegrationCard` — wrap Configure and Delete buttons in `<RequiresPermission action="integration:<type>:update" orgId={...}>`. Visual verification per integration type (Dynatrace, Grafana, Pyroscope, Tracing).
- **FE.4:** Migrate other UI surfaces (Settings → Members management, Test Run actions, Profile Settings). Per-PR per surface.
- **FE.5:** Audit pass — grep for `user?.roles` and `OrganizationRole` references in `apps/web/`. Any direct role inspection that's not in `usePermissions` or `<RequiresPermission>` is a regression. Fix or document.

### Done criteria

- No frontend component reads `user.roles` directly except via `usePermissions`.
- Configure/Delete buttons on integration cards are disabled (with tooltip) for org-members and org-viewers.
- The Dynatrace config update flow that triggered this audit shows a clear "Org admin only" tooltip — no more dangling 403.

---

## Phase 5 (deferred): Row-level security + audit logging

Out of scope for this plan; tracked here so it isn't lost.

**RLS:** Postgres `ROW LEVEL SECURITY` policies on owned tables, defense-in-depth so that even a service-layer bug can't leak cross-org data. Requires a per-request `SET LOCAL app.current_user_id = ...` and `SET LOCAL app.current_org_ids = '{a,b,c}'`, plus matching `USING (organization_id = ANY(...))` policies. Real but big — needs benchmarking; RLS checks add per-row cost on hot queries.

**Audit logging:** an `audit_log` table capturing `(actor_id, action, resource_type, resource_id, organization_id, before, after, ip, user_agent, ts)` for mutations. Implementation: a Nest interceptor that hooks `@Auditable()` decorated methods, writes to the table, fans out to a separate retention strategy (long-term archive, etc.).

When ready, brainstorm + create a separate plan: `docs/superpowers/plans/<date>-rbac-phase5-rls-audit.md`.

---

## Done criteria (whole plan)

- `GET /api/users/me/permissions` returns the user's full capability set (global + per-org). Cached, invalidated correctly.
- **Migration tooling installed (Phase 3a):** custom ESLint rule `local/no-direct-is-global-admin` blocks new direct `isGlobalAdmin` usage outside the AuthorizationService and the grandfathered allowlist; `apps/api/.rbac-migration-allowlist.json` exists; the audit log has a "Migration progress" burndown table; CONTRIBUTING.md documents the adjacent-migration rule; the drift-check `/schedule` agent is set up and running every 2 weeks.
- **Date-bound revisit gate hit (2026-08-01):** Bucket A + B combined burndown is at least 50% (≥70 sites migrated). If the gate is missed, the team explicitly re-evaluates the architecture or priorities — no silent drift.
- Every Bucket A site uses `withOrgFilter`; every Bucket B site uses `@RequiresCapability`. Local wrappers deleted. The migration allowlist file is empty.
- Every owned resource has `organization_id NOT NULL` (Phase 4 complete for all entities except, optionally, Test Runs as a separate operation).
- Frontend gates Configure/Delete on Integration cards via `<RequiresPermission>`. The Dynatrace UX gap is closed.
- `apps/web/` contains zero direct `user.roles` reads outside `usePermissions`.
- `CLAUDE.md` "RBAC Implementation Status" table updated: Phase 3 = Completed, Phase 4 = Completed (or partial if Test Runs deferred).

## Sequencing

1. **Phase 3a** — single PR (7 tasks: 6 capability-API tasks + 1 migration-tooling task). Foundation + scaffolding for the rollout. Nothing else can ship without this — and the ESLint rule blocks new sites of the old pattern from the moment 3a merges.
2. **Phase 3b pilot** — single PR for Dynatrace. Lets the frontend phase pilot ship.
3. **Frontend Phase FE.1 + FE.2 + FE.3 (Integrations pilot)** — single PR, depends on 3a + 3b. Closes the immediate UX gap.
4. **Phase 4** — N PRs, one per entity cluster. Can run in parallel with Phase 3c + Phase 3b rollout to other integrations once the pattern is in place.
5. **Phase 3c rollout** — N PRs, one per service group. References the audit log + the burndown; expand the sub-plan per group. CONTRIBUTING.md rule + lint allowlist mean migrations also drip in via adjacent feature work, so the explicit per-group PRs only need to cover whatever's left over by the date gate.
6. **Frontend FE.4 / FE.5** — incremental, as UI surfaces are touched.
7. **2026-08-01 — Phase 3 revisit gate.** Audit burndown numbers. If <50% complete, hold a 30-minute scope conversation: keep going, descope, or rip the half-shipped pattern back out.
8. **Phase 5** — separate plan, later.
