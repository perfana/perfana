---
aliases:
  - Role-Based Access Control
  - Roles
  - Permissions
tags:
  - feature
  - security
---

# RBAC

Perfana enforces multi-tenant Role-Based Access Control across **system**, **organization**, and **team** scopes. Authorization is decoupled from roles via a **capability** layer: services and UI check capabilities, never roles directly. The policy lives in `apps/api/src/constants/capabilities.constants.ts`.

> **Source of truth in code**:
> - Roles → `apps/api/src/constants/roles.constants.ts`
> - Capabilities → `apps/api/src/constants/capabilities.constants.ts`
> - Authorization service → `apps/api/src/common/services/authorization.service.ts`
> - Capabilities service → `apps/api/src/common/services/capabilities.service.ts`

---

## 1. Identity

A request authenticates as one of two principal types (see [[API Authentication]]):

| Principal | `userId` format | Source of roles |
|---|---|---|
| Web user | Keycloak `sub` (UUID) | JWT `realm_access.roles` |
| API key | `api-key:{uuid}` | Roles stored on the API key + the key's `organization_id` |

Both flow through `KeycloakEnhancedAuthGuard` and produce a uniform `UserContext` (`ctx.userId`, `ctx.roles`).

> ⚠️ `ctx.organizations` from `@UserCtx()` is JWT-only and often `[]`. Services MUST resolve organizations via `AuthorizationService.getAccessibleOrganizations(userId)`.

For an API-key principal, `getAccessibleOrganizations` and `isOrganizationMember` fall back to the `organization_id` on the `api_keys` row itself when `organization_members` yields nothing. That fallback reads `api_keys` on the **plain pooled connection, deliberately outside RLS**: `RlsTransactionInterceptor` calls `getAccessibleOrganizations` to build `app.current_user_organizations`, so reading it through a policy that consumes that GUC would be circular. It is sound only because the `userId` passed is always the authenticated principal itself.

> ⚠️ **Deployment constraint.** `api_keys` is `FORCE ROW LEVEL SECURITY`, so that unscoped read returns rows only because the API's login role is `rolsuper`/`rolbypassrls`. Deploy the API under a least-privilege role without the bypass and every API key silently loses all organization access — surfacing as the misleading denial `user is not a member of organization X`, not as a startup error.

---

## 2. Role hierarchy

### System roles (global)

Defined in `SystemRole`. Granted via Keycloak realm role.

| Role | String | Effect |
|---|---|---|
| Global admin | `perfana-admin` | Bypasses all org / team / capability checks |
| Admin (legacy) | `admin` | Same as `perfana-admin`, kept for back-compat |

`hasGlobalAdminRole(roles)` short-circuits every authorization decision to "allow".

### Organization roles

Defined in `OrganizationRole`. Granted by inserting an `organization_members` row.

| Role | String | Intent |
|---|---|---|
| Org admin | `org-admin` | Full control of the organization, its teams, members, integrations, and resources |
| Org member | `org-member` | Day-to-day producer: create/manage SUTs, profiles, benchmarks, dashboards, test runs |
| Org viewer | `org-viewer` | Read-only access to the organization's resources |

### Team roles

Defined in `TeamRole`. Granted by inserting a `team_members` row.

| Role | String | Intent |
|---|---|---|
| Team admin | `team-admin` | Manage team settings and team membership |
| Team member | `team-member` | Member visibility (see Team scope below) |
| Team viewer | `team-viewer` | Member visibility (see Team scope below) |

> Team roles today govern **team administration** (rename, delete, member management). They do **not** add or remove resource-level capabilities — those come from the org role. Team membership is what controls **visibility** of team-restricted resources.

---

## 3. Authorization model

Every authorization decision passes through this hierarchy (in order):

```
1. Global admin role        → ALLOW (bypass everything)
2. Resource creator         → ALLOW for modify (created_by == userId)
3. Org admin of resource    → ALLOW for read + modify
4. Org member of resource   → ALLOW for read; modify requires org-admin or owner
5. Team admin of resource   → ALLOW for read + modify of team-scoped resource
6. Team member of resource  → ALLOW for read of team-scoped resource
7. Otherwise                → DENY
```

The `AuthorizationService` exposes four checks:

| Method | Use for |
|---|---|
| `canAccessResource(userId, roles, resource)` | Read a single resource |
| `canModifyResource(userId, roles, resource)` | Update / delete a single resource |
| `canViewTeamResources(userId, teamId)` | Listing/visibility through team scope, applies the `restrict_to_team_members` rule |
| `canAdministerAnyOrganization(userId, roles)` | Pre-scope writes (e.g. create a top-level resource before an org is selected) |

Read-time list filtering uses query helpers — `withOrgFilter`, `withTeamFilter`, and an inline `restrict_to_team_members` join — that mirror the same rules at SQL level.

---

## 4. Ownership model — `OwnedResource`

Every business resource implements `OwnedResource` (`packages/shared/src/entities/owned-resource.interface.ts`):

| Column | Required | Meaning |
|---|---|---|
| `organization_id` | **NOT NULL** on all 26 owned-resource entities (Phase 4) | Multi-tenant boundary |
| `team_id` | nullable | Optional team scope within the org |
| `created_by` | required | Identity who created the resource (`sub` or `api-key:{id}`) |
| `updated_by` | optional | Identity of last modifier |

**Owner privilege**: if `resource.created_by == userId`, the user can always modify the resource — regardless of org/team role. Useful for users to clean up their own work.

**Exceptions kept nullable** (documented in `CLAUDE.md`):
- `audit_logs.organization_id` — system-level events have no org context.

When creating a child entity, always pass camelCase `organizationId`, never snake_case `organization_id`. TypeORM silently drops unknown keys, which collides with the Phase 4 NOT NULL constraint at runtime.

---

## 5. Capabilities

Capabilities are canonical strings (`<resource>:<action>` or `<resource>:<sub>:<action>`) that describe **what** a user is allowed to do. The role → capability mapping is the only place the policy lives.

### Capability catalog

| Group | Capability | String |
|---|---|---|
| Integrations — Grafana | Create / Update / Delete | `integration:grafana:{create,update,delete}` |
| Integrations — Dynatrace | Create / Update / Delete | `integration:dynatrace:{create,update,delete}` |
| Integrations — Pyroscope | Create / Update / Delete | `integration:pyroscope:{create,update,delete}` |
| Integrations — Tracing | Create / Update / Delete | `integration:tracing:{create,update,delete}` |
| Test runs | Read / Update / Delete / Annotate | `test-run:{read,update,delete,annotate}` |
| Profiles | Manage (full CRUD) | `profile:manage` |
| Benchmarks | Manage (full CRUD) | `benchmark:manage` |
| Systems Under Test | Manage (full CRUD) | `sut:manage` |
| Dashboards | Manage (full CRUD) | `dashboard:manage` |
| Organization | Create / Update / Delete / ManageMembers | `org:{create,update,delete,manage-members}` |
| Team | Create / Update / Delete / ManageMembers | `team:{create,update,delete,manage-members}` |
| API keys | Read / Create / Delete | `api-key:{read,create,delete}` |
| System | AuditRead / ManageUsers / ManageGlobalSettings | `system:{audit-read,manage-users,manage-global-settings}` |

### Role → capability mapping

| Capability | Global admin | Org admin | Org member | Org viewer | Team admin | Team member | Team viewer |
|---|---|---|---|---|---|---|---|
| `integration:*:create/update/delete` (all 4 sources) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `test-run:read` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `test-run:update` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `test-run:annotate` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `test-run:delete` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `profile:manage` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `benchmark:manage` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `sut:manage` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `dashboard:manage` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `api-key:read` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `api-key:create` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `api-key:delete` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `org:create` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `org:update` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `org:delete` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `org:manage-members` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `team:create` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `team:update` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| `team:delete` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `team:manage-members` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| `system:audit-read` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `system:manage-users` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `system:manage-global-settings` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

> Listing integrations is governed by org filtering at the service layer rather than an explicit `integration:*:read` capability — viewers naturally see the same list as members because the SQL filter excludes orgs they don't belong to.

---

## 6. Resource → action matrix

The table below collapses 26 owned-resource entity classes into the user-facing resources exposed by the REST API. Required role is the **minimum** role; any higher role inherits.

| Resource | List / Read | Create | Update | Delete | Notes |
|---|---|---|---|---|---|
| **Organization** | org-member | global-admin | org-admin | global-admin | `POST /organizations` is global-admin only |
| Organization member | org-member | org-admin | org-admin | org-admin | `org:manage-members` |
| **Team** | org-member | org-admin | org-admin / team-admin | org-admin | `team-admin` can rename own team |
| Team member | org-member (subject to team restriction) | org-admin / team-admin | org-admin / team-admin | org-admin / team-admin | `team:manage-members` |
| **System Under Test** (SUT) | org-member (+ team rule) | org-member | org-member or owner | org-admin or owner | `sut:manage` |
| SUT environment | inherits SUT | inherits SUT | inherits SUT | inherits SUT | Lifecycle bound to SUT |
| SUT workload | inherits SUT | inherits SUT | inherits SUT | inherits SUT | Lifecycle bound to SUT |
| **Test run** | org-viewer (+ team rule) | (ingested via API key) | org-member | org-admin or owner | `test-run:{read,update,delete,annotate}` |
| Test run event | inherits test run | org-member | org-member | org-admin or owner | |
| Test run annotation | inherits test run | org-member | org-member | org-member | `test-run:annotate` |
| **Profile** | org-member | org-member | org-member or owner | org-admin or owner | `profile:manage` |
| Profile ↔ benchmark mapping | inherits profile | profile owner | profile owner | profile owner | |
| Profile ↔ dashboard mapping | inherits profile | profile owner | profile owner | profile owner | |
| **Benchmark** | org-member | org-member | org-member or owner | org-admin or owner | `benchmark:manage` |
| **Application dashboard** | org-member (+ team rule) | org-member | org-member or owner | org-admin or owner | `dashboard:manage` |
| Grafana dashboard (synced) | org-member | (sync only) | (sync only) | (sync only) | Maintained by `grafana-sync` service |
| **Grafana instance** | org-member | org-admin | org-admin | org-admin | `integration:grafana:*` |
| **Dynatrace config / query / entity-mapping** | org-member | org-admin | org-admin | org-admin | `integration:dynatrace:*` |
| **Pyroscope instance** | org-member | org-admin | org-admin | org-admin | `integration:pyroscope:*` |
| **Tracing instance / service** | org-member | org-admin | org-admin | org-admin | `integration:tracing:*` |
| **Metrics source** | org-member | org-admin | org-admin | org-admin | Wraps the above integrations |
| **Notification channel** | org-member | org-admin | org-admin | org-admin | |
| **Report template** | org-member | org-member | org-member or owner | org-admin or owner | |
| Generated report | org-member (+ team rule) | (worker) | n/a | org-admin or owner | Output of report templates |
| **Graph preset** | org-member | org-member | owner | owner | User-owned preset |
| **Compare filter preset** | org-member | org-member | owner | owner | User-owned preset |
| **Trends filter preset** | org-member | org-member | owner | owner | User-owned preset |
| **Deep link** / Generic deep link / URL pattern | org-member | org-admin | org-admin | org-admin | |
| **Expected config change** | org-member | org-member | org-member | org-admin or owner | |
| **API key** | org-member (own org) | org-admin | n/a (rotate via delete + create) | org-admin | `api-key:{read,create,delete}` |
| **Audit log** | global-admin | (system writes) | n/a | n/a | `system:audit-read` |
| **User** (Keycloak directory) | global-admin | global-admin | global-admin | global-admin | `system:manage-users` |

> "Owner" refers to `created_by == userId` and grants the same privileges as if the user were org-admin for that single resource (see [§3](#3-authorization-model)).

---

## 7. Team scope and `restrict_to_team_members`

Every team has a boolean column `restrict_to_team_members` (default `false`).

| Team flag | Org member who is **not** a team member | Org member who **is** a team member | Org admin / global admin |
|---|---|---|---|
| `false` (default — unrestricted) | ✅ Can see team's resources | ✅ Can see team's resources | ✅ Can see team's resources |
| `true` (restricted) | ❌ Hidden from listings, 404 on direct fetch | ✅ Can see team's resources | ✅ Can see team's resources |

Resources without a `team_id` (i.e. org-only) are visible to every member of the organization regardless of team membership.

### Where the rule is enforced

- **Single-resource read**: `AuthorizationService.canViewTeamResources(userId, teamId)`
- **List queries**: SQL clauses such as
  ```sql
  team.restrict_to_team_members = false
   OR team_member.user_id = :userId
   OR system.team_id IS NULL
  ```
  applied in `test-runs-crud-query.service.ts`, `test-runs-dashboard-query.service.ts`, `systems-under-test.service.ts`, and any other listing service that exposes team-scoped resources.

### Setting the flag

`PUT /api/teams/:id` accepts `restrict_to_team_members: boolean`. Required role: **org-admin** or **team-admin** of that team (`team:update`).

### Cascade

Marking a team `restrict_to_team_members = true` instantly hides every resource scoped to that team from non-members. There is no separate per-resource visibility flag — team scope is the single source of truth.

---

## 8. Putting it together — a worked example

Imagine an organization "Acme" with two teams, **Payments** (restricted) and **Catalog** (open).

| User | Org membership | Team membership | Can list Payments SUTs? | Can list Catalog SUTs? | Can create a SUT in Payments? | Can delete a SUT they did not create in Payments? |
|---|---|---|---|---|---|---|
| Alice | `org-admin` | — | ✅ | ✅ | ✅ | ✅ (org-admin) |
| Bob | `org-member` | `team-member` of Payments | ✅ | ✅ | ✅ | ❌ (not owner, not admin) |
| Carol | `org-member` | `team-member` of Catalog | ❌ (Payments restricted) | ✅ | ❌ (no team membership) | ❌ |
| Dave | `org-viewer` | — | — read-only of Catalog only | ✅ (read-only) | ❌ | ❌ |
| `perfana-admin` JWT | global | — | ✅ | ✅ | ✅ | ✅ |

---

## 9. Caching

`AuthorizationService` caches every membership/role lookup in Redis with a TTL of `AUTH_CACHE_TTL_SECONDS` (default **300 s**) and a versioned per-user capability key.

Cache is invalidated automatically on:
- `OrganizationMembersService` add/update/remove
- `TeamMembersService` add/update/remove
- `Team.restrict_to_team_members` toggle (via team update)
- API key delete

Manual flush: `AuthorizationService.clearAllCaches()` (testing only — uses SCAN, not KEYS).

---

## 10. Phase status

| Phase | Description | Status |
|---|---|---|
| 1 | Role definitions & constants | ✅ |
| 2 | Membership & ownership infrastructure | ✅ |
| 3 | Service-layer authorization enforcement | ✅ Lint-enforced (allowlist empty) |
| 4 | `organization_id` NOT NULL backfill | ✅ (2026-05-02) |
| 5a | Audit logging | ✅ (2026-05-04) |
| 5b | Postgres Row-Level Security | ✅ Shipped — `RlsTransactionInterceptor` + `withRequestEm()`; `.rls-em-migration-allowlist.json` empty; suite in `apps/api/src/test/rls/` runs in `npm run preflight` |

See `CLAUDE.md` for the full burndown record and PR references.

---

## Related

- [[API Authentication]] — How JWT and API keys produce a `UserContext`
- [[Multi-tenancy]] — Why `organization_id` is the boundary
- [[API Overview]] — Guard chain (`KeycloakEnhancedAuthGuard` → `RolesGuard` → `EnhancedThrottlerGuard`)
