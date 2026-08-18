---
aliases:
  - Multi-tenant
  - Organizations
  - Teams
tags:
  - feature
  - security
---

# Multi-tenancy

Perfana is a multi-tenant platform where all data is scoped by organizations. Organizations contain teams, and teams contain members.

## Data Model

```
Organization
├── Members (OrganizationMember)
├── Teams
│   └── Members (TeamMember)
├── Systems Under Test
├── Grafana Instances
├── Dynatrace Configs
├── API Keys
└── All test data (test runs, metrics, benchmarks, etc.)
```

## Organization Scoping

### API Layer
- The caller's accessible organizations are resolved server-side from `AuthorizationService.getAccessibleOrganizations(userId)` — there is no client-supplied organization header
- `RlsTransactionInterceptor` opens a per-request transaction and sets the RLS context on it
- Queries routed through `withRequestEm()` are filtered by organization at the database level

### Database Layer (Row-Level Security)
Per request, inside the transaction:
```sql
SET LOCAL ROLE perfana_app;
SELECT set_config('app.current_user_id',            '<user_id>',        true);
SELECT set_config('app.current_user_organizations', '["<org_id>", ...]', true);
SELECT set_config('app.current_user_teams',         '["<team_id>", ...]', true);
SELECT set_config('app.current_user_roles',         '["<role>", ...]',  true);
```

RLS policies (`can_access_resource` / `can_modify_resource` / `is_global_admin`) read those GUCs to enforce data isolation at the database level.

### Frontend Layer
- `OrganizationContext` manages org selection
- Single-org non-admin users: auto-selected
- Multi-org or admin users: explicit selection required
- Selection persisted in `localStorage`

## Organization Switcher

The sidebar includes an organization selector:
- Shows all organizations the user belongs to
- Admin users can see and manage all organizations
- Switching organization reloads all data contexts
- Read-only mode for single-org non-admin users

## Ownership Columns

All tenant-scoped tables include:
- `organization_id` — Organization ownership
- `created_by` — User who created the record

These columns were added in a migration and are enforced by the middleware.

> [!warning] Worker Security Fix
> A critical security issue was identified where Worker pipelines did **not** filter by `organization_id`. This meant:
> - Test runs from Org A could match benchmarks from Org B
> - Dashboards from any organization could be accessed
> - Statistics could be aggregated across organizations
>
> **Fix**: Added `organization_id` filtering to all `WorkerDatabaseService` query methods including:
> - `getApplicationDashboards()`
> - `getBenchmarksByDashboard()`
> - All dashboard and benchmark operations

## API Key Multi-Org Support

API keys are scoped to a single organization:
- Created with `organization_id` association
- Requests with API keys automatically use the key's organization
- No org switching available for API key auth

That organization is resolved by reading the `api_keys` row on the **plain pooled connection, deliberately outside RLS** — the result *becomes* `app.current_user_organizations`, so it cannot be read through a policy that consumes it. `api_keys` is `FORCE ROW LEVEL SECURITY`, so the read works only while the API's login role bypasses RLS (`rolsuper`/`rolbypassrls`). Under a role without the bypass, every API key silently loses organization access. See [[RBAC]] §1.

## Profile Filtering

Performance profiles are organization-scoped:
- Profiles belong to an organization
- Profile-linked dashboards and benchmarks inherit org scope
- Cross-org profile sharing not supported

## Related

- [[RBAC]] — Role-based access control
- [[API Authentication]] — Auth and org validation
- [[Schema Overview]] — Entity relationships
