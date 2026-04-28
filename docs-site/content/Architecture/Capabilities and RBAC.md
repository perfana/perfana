---
title: Capabilities and RBAC
---

# Capabilities and RBAC

Perfana's authorization model is **capabilities-based**, not role-based at the call
site. Code asks "can the current user do action X in scope Y?", not "what role does
the user have?". This page explains how the system works, when to use which helper,
and how to extend the role-→-capabilities mapping.

## The two surfaces

`AuthorizationService` exposes two related-but-distinct authorization surfaces.
They are complements, not competitors.

### Capabilities (action-level)

Answer **"can I do action X in scope Y?"** Used for menu and button gating, route
guards, and pre-fetch decisions where the specific resource isn't loaded yet.

```typescript
// In a controller — declarative gate:
@Patch(':id')
@RequiresCapability(Capability.IntegrationDynatraceUpdate, { orgIdFromBody: 'organizationId' })
async update() { ... }

// In a service — programmatic check:
const caps = await this.authzService.getCapabilities(userId, roles, organizationId);
if (caps.includes(Capability.IntegrationDynatraceUpdate)) { ... }

// In the frontend — declarative wrapper:
<RequiresPermission action="integration:dynatrace:update" orgId={currentOrgId}>
  <Button onClick={openConfigure}>Configure</Button>
</RequiresPermission>
```

Capabilities are computed from `(systemRoles, orgRoles, teamRoles)` and cached per
`(userId, organizationId, teamId)` with a Redis-backed versioned key strategy.

### Resource ACL (row-level)

Answer **"can this user touch this specific row?"** Used inside services AFTER a
resource has been loaded, when ownership and team-scope data are known.

```typescript
const config = await this.repository.findById(id);
if (!await this.authzService.canModifyResource(userId, config.organizationId)) {
  throw new ForbiddenException();
}
```

The methods return booleans; admin bypass is implicit (a global admin always
returns `true`).

### How they compose

A controller checks the capability via `@RequiresCapability` to authorize the
**intent** ("you are allowed to update integrations in this org"); the service
calls `canModifyResource` after loading the row to authorize the **target** ("you
are allowed to update *this* integration, given its organization and ownership").
Neither replaces the other.

| Use case | Use this |
|---|---|
| Hide/disable a UI button | `usePermissions().can(action, { organizationId })` (frontend) |
| Reject a request before it touches the DB | `@RequiresCapability(...)` decorator (controller) |
| Reject a request after loading the resource | `canAccessResource` / `canModifyResource` (service) |
| Decide "should I add a `WHERE organization_id IN (...)` clause" | `withOrgFilter` or `getAccessibleOrgIds` (service) |

## Role decision matrix

The role-→-capabilities mapping lives in `apps/api/src/constants/capabilities.constants.ts`.
This is the only place the policy lives. Adding a new role, changing what an existing
role can do, or adding a new capability all happen here.

### Current mapping

System roles (from JWT `realm_access.roles` or API key `roles`):

| Role | Capabilities |
|---|---|
| `perfana-admin` | every defined capability (global admin) |
| `admin` | every defined capability (legacy alias for `perfana-admin`) |
| `perfana-user` | none directly — capabilities come from org/team membership |

Organization roles (from `organization_members.roles`):

| Role | Capabilities granted |
|---|---|
| `org-admin` | integration CRUD (all types), test-run CRUD + delete, profile/benchmark/SUT/dashboard manage, org/team admin operations |
| `org-member` | test-run read/update/annotate, profile/benchmark/SUT/dashboard manage. **No integration mutations.** |
| `org-viewer` | test-run read only |

Team roles (from `team_members.roles`):

| Role | Capabilities granted |
|---|---|
| `team-admin` | team:update, team:manage-members |
| `team-member` | (none directly — access flows through org membership) |
| `team-viewer` | (none directly) |

### Adding a new role

1. Add the role value to the appropriate enum in `apps/api/src/constants/roles.constants.ts`.
2. Add an entry to `ROLE_CAPABILITIES.organization` (or `.team`) in
   `apps/api/src/constants/capabilities.constants.ts` listing the capabilities the
   role grants. The `Record<OrganizationRole, CapabilitySet>` type forces a
   compile error if the new role is missed.
3. Add a unit test to `capabilities.service.spec.ts` asserting the new role gets
   the expected capability set.
4. Run `npm run type-check` to catch any usage that depends on the role enum.
5. Update this docs page's "Current mapping" table.

### Adding a new capability

1. Add it to the `Capability` enum in
   `apps/api/src/constants/capabilities.constants.ts`. Use the format
   `<resource>:<action>` (e.g. `integration:dynatrace:update`).
2. Add it to the appropriate role's array in `ROLE_CAPABILITIES`. Do NOT add it
   to multiple roles unless the same capability is genuinely shared.
3. Use it in code via `@RequiresCapability(Capability.YourNewCapability, ...)` or
   `usePermissions().can(Capability.YourNewCapability, ...)`. **Never use the
   string literal directly — always go through the enum** so a typo is a
   compile error.

### Auth-method-agnostic by construction

`getCapabilities(userId, roles, organizationId, teamId?)` takes `roles` as a
parameter, not from request context. `KeycloakEnhancedAuthGuard.getRoles()`
unifies JWT (`request.user.roles`) and API key (`request.apiKey.roles`) into a
single array. The capability mapping treats both identically — an admin API key
gets the same capabilities as an admin JWT. No special-casing in the controller,
the service, or the cache.

## Migrating existing code

If you're migrating a `this.authzService.isGlobalAdmin(roles)` call (the lint
rule sent you here):

- **Bucket A** (the result is used to decide whether to skip an org-id filter):
  use `withOrgFilter(userId, roles, this.authzService)` from
  `apps/api/src/common/utils/with-org-filter.ts`. See PR #175 for an example.
- **Bucket B** (the result is used as a guard that throws `ForbiddenException`):
  use the `@RequiresCapability(Capability.X, { orgIdParam: '...' })` decorator on
  the controller method. The decorator handles the deny path including the WARN
  log for ops telemetry.
- **Bucket C** (the result is mixed with other business logic): consult the
  audit log at `docs/superpowers/audits/2026-04-26-audit-decisions.md`. Many
  Bucket C sites are pre-Phase-4 stubs that become deletable once
  `organization_id NOT NULL` lands.

After migrating a site, remove its file from
`apps/api/.rbac-migration-allowlist.json` and update the burndown table in the
audit log. The lint rule allowlist size IS the burndown.

## Telemetry

`CapabilityGuard` emits a structured WARN log on every deny:

```
Capability denied: capability=integration:dynatrace:update userId=u-123 orgId=o-456 route=PATCH /api/dynatrace/abc
```

If `MetricsService` is available in the project, the guard also bumps
`auth_capability_denied_total{capability=...}`. A spike in denials is a real ops
signal: misconfigured user, attack, deployment regression, missing membership
backfill.

## Out of scope

- **ABAC (attribute-based)**: rules like "creator can always edit their own"
  aren't modeled. If needed, that's a future Phase 6.
- **Capability versioning**: renaming a capability string would break any external
  client that cached the value. Not a problem today (no external consumers); flag
  if/when one appears.
- **Cross-team capabilities**: capabilities are computed per scope. A user with
  team-admin in team A doesn't automatically get permissions in team B even if
  both are in the same org.
