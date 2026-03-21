# organizations

CRUD management for organizations (tenants) and their member rosters, including role assignment.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/organizations` | List all orgs accessible to the calling user |
| GET | `/organizations/:id` | Single org by UUID |
| POST | `/organizations` | Create a new org (global-admin only in practice) |
| PUT | `/organizations/:id` | Update org name/settings |
| DELETE | `/organizations/:id` | Delete an org |
| GET | `/organizations/:orgId/members` | List all members of an org |
| POST | `/organizations/:orgId/members` | Add a user to an org |
| DELETE | `/organizations/:orgId/members/:userId` | Remove a member by user ID |
| GET | `/users/me/organizations` | All org memberships for the current user |
| GET | `/organization-members/:id` | Single membership record by membership UUID |
| PUT | `/organization-members/:id/roles` | Update a member's org-level roles |
| DELETE | `/organization-members/:id` | Remove a membership by membership UUID |

## Key files

| File | Purpose |
|------|---------|
| `organizations.module.ts` | Module registration |
| `organizations.controller.ts` | All HTTP handlers with inline auth guards |
| `organizations.service.ts` | Business logic, DB queries, `isOrgAdmin` / `isMember` helpers |

## Notes

- Auth is enforced in two tiers: global `JwtAuthGuard` (JWT required) plus inline controller guards (`requireOrgAdminAccess` / `requireOrgMemberAccess`).
- `hasGlobalAdminRole(ctx.roles)` short-circuits all org-level permission checks — global admins bypass org membership requirements.
- Org-admin operations (add member, update roles, remove member) call `requireOrgAdminAccess` which fetches the membership record and throws `ForbiddenException` if the caller is not an admin.
- The `DELETE /organizations/:orgId/members/:userId` path accepts a Keycloak `sub` UUID or the string `api-key:{id}` for API-key principals.
- DTOs (`CreateOrganizationDto`, `AddOrganizationMemberDto`, `UpdateOrganizationMemberRolesDto`) are defined inline in `organizations.service.ts` and re-exported — unusual pattern kept for historical reasons, consolidate in Phase 4.
