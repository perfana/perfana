# CLAUDE.md — apps/api

NestJS REST API. Root [CLAUDE.md](../../CLAUDE.md) has the stack, env vars, the dual-auth contract
and the symptom index ("Common Issues") that points back here.
Coding rules: [CODING_RULES.md](CODING_RULES.md).

## Role-Based Access Control (RBAC)

Perfana implements a multi-tenant RBAC system for fine-grained access control across organizations and teams.

### RBAC Implementation Status

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Role definitions & constants | ✅ Completed |
| Phase 2 | Membership & ownership infrastructure | ✅ Completed |
| Phase 3 | Service-layer authorization enforcement | ✅ Lint-enforced (2026-05-02 — `.rbac-migration-allowlist.json` is empty; Bucket B 100%, Bucket A 70/131 lint-only (53.4%) or 68/127 strict (53.5%); 2 user-owned preset `findAll` sites are the remaining strict-legacy sites (they filter by row-level ownership and have no `withOrgFilter` equivalent); see `docs/superpowers/audits/2026-04-26-audit-decisions.md` Phase C37) |
| Phase 4 | Data migration for existing resources | ✅ Completed (2026-05-02 — null-org escape hatch closed; `organization_id` is NOT NULL on all 26 owned-resource entities; `audit_logs` keeps nullable for documented reasons; null-org defensive branches deleted from `AuthorizationService`, `AuthorizedBaseService`, `dynatrace.service.ts`, `api-keys.service.ts`, `systems-under-test.service.ts`, `test-runs-crud-query.service.ts`; extended in v0.2.72.0 to `check_results`, `ds_compare_config`, `ds_metric_collection_status` and `ds_change_points`, NOT NULL on both greenfield and migrated databases) |
| Phase 5a | Audit logging | ✅ Completed (2026-05-04 — `apps/api/.audit-migration-allowlist.json` is empty; 29 services migrated with paired `auditService.log{Create,Update,Delete}` calls across PRs 5–17, 27 files closed via the lint rule's `POLICY_EXEMPT` batch in PR20 (bucket-2 system writes + NO-decision admin config + repo-layer follow-ups); see `docs/superpowers/audits/2026-05-02-audit-phase5a-decisions.md` for per-PR burndown). Note: on deploys upgraded before v0.2.73.0 the trail is empty from 2026-08-01 until the default-partition fix lands — the rows were rejected, not hidden. |
| Phase 5b | Row-Level Security | ✅ Shipped — `RlsTransactionInterceptor` (`apps/api/src/common/interceptors/`) opens a per-request transaction, runs `SET LOCAL ROLE perfana_app` and sets four `app.current_*` GUCs that the policies read. Owned-resource repository calls go through `withRequestEm()`; `apps/api/.rls-em-migration-allowlist.json` is empty. Policies, helper functions, and the `perfana_app`/`perfana_system` roles live in the consolidated migration; `npm run preflight` runs `apps/api/src/test/rls/`. One deliberate carve-out — see "API-key organization resolution" below. |

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
- `organization_id` - Organization the resource belongs to (NOT NULL on all owned-resource entities as of Phase 4; nullable only on `audit_logs`, for system-level events with no org context). `test_runs.organization_id` is NOT NULL in the DDL and `rls_test_runs_select` reads it directly, but the **service-layer** per-resource check in `TestRunsCrudQueryService` still goes through the joined `systems_under_test.organization_id`
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

An API-key principal (`api-key:{uuid}`) gets its organization from the `api_keys` row itself, not from `organization_members`. `AuthorizationService.isOrganizationMember` and `getAccessibleOrganizations` read that row through the **plain pooled repository**, not `withRequestEm()` — the two sites carry an `eslint-disable-next-line owned-resource-must-use-request-em`.

This is not an oversight, and it must not be "fixed" back:

- **Scoping it is circular.** `RlsTransactionInterceptor` calls `getAccessibleOrganizations` to *build* `app.current_user_organizations`, which is exactly what `rls_api_keys_select` then reads. A key would have to already be in the organization to prove it is in the organization, and the answer would change with whichever GUCs happened to be in force.
- **The membership cache demands a context-free answer.** `buildOrgMembershipKey` carries no RLS context, so a context-dependent result would be cached and replayed.
- **It is safe only because `userId` is the authenticated principal.** Every caller passes `ctx.userId` or a self-derived id. Passing a third-party `userId` here would turn it into a cross-org membership oracle that RLS would otherwise have blocked.

**Deployment constraint**: `api_keys` is `FORCE ROW LEVEL SECURITY`, so this read returns rows only because the API's login role is `rolsuper`/`rolbypassrls`. Deploy the API under a least-privilege role without that bypass and **both** api-key branches return zero rows: every API key silently loses all organization access, surfacing as the misleading denial `user is not a member of organization X`. Nothing enforces this yet — a boot-time assertion is filed in TODOS.md.

`api_keys` rows are treated as immutable and delete-only. The membership cache is keyed on `api-key:<id>` and invalidated in `ApiKeysService.deleteApiKey`. Add a revoke flag or an org-move endpoint and that invalidation has to grow to match.

### RLS does not backstop a caller-named `organization_id` on create

`can_access_resource` is a chain of ORs and `created_by = current_user_id()` is its **last** branch — a fallback, not a short-circuit. On an INSERT the org check runs first and fails (the caller is not a member of the organization the body named), the team check fails too, and then the creator check returns TRUE anyway: a row the caller is inserting is self-created by definition. So `WITH CHECK (can_access_resource(...))` admits the row no matter which organization it carries. `rls_dynatrace_configs_insert` is the worked example, and the shape is shared by every owned-resource insert policy.

The consequence: **a create endpoint that reads `organizationId` out of the request body must check membership itself.** RLS will not catch it. Before v0.2.92.0 `DynatraceService.create` passed `dto.organizationId` straight through, so any authenticated user could plant a Dynatrace configuration — including the browser-facing `client_url` that org members then follow out of Perfana — into an organization they do not belong to.

The fix is the standard two-line pair, and it is what a new create path should copy:

```typescript
// Body may name a target org; default to the caller's own.
const organizationId =
  dto.organizationId ?? (await this.authzService.getAccessibleOrganizations(userId))[0];
if (!organizationId) throw new ForbiddenException('User has no accessible organization');

// getCapabilities is scoped to that org and already grants global admins the full
// set, so this is the whole check.
const caps = await this.authzService.getCapabilities(userId, roles, organizationId);
if (!caps.includes(Capability.IntegrationDynatraceCreate)) throw new ForbiddenException(...);
```

A controller-level `@RequiresCapability(Capability.X, { orgIdFromBody: 'organizationId' })` is the equivalent declarative gate and is preferred where the create path has no other org-resolution work to do.

### Per-resource authorization in test-runs

`TestRunsCrudQueryService` splits two patterns that look similar and are not:

- **List methods** use `withOrgFilter` / `withTeamFilter` to compute the accessible sets once.
- **Per-resource methods** (`findByTestRunId`, `findOne`, `getTestRunByTestRunId`) delegate to the private `denialReason()` helper, which calls `isOrganizationMember` / `canViewTeamResources` on the single row. The service-layer check reads the **joined `SystemUnderTest`'s** `organization_id` / `team_id`, not the run's own column. (The DB does have `test_runs.organization_id NOT NULL` and `rls_test_runs_select` uses it directly — the service check predates that and still goes through the system. The TypeORM entity also still declares the column `nullable: true`, which is drift against the DDL.)

`denialReason()` **fails closed**: a missing `systemUnderTest` relation is a denial, not a skip. `system_under_test_id` is NOT NULL, so a null relation never means "this run has no system" — it means the LEFT JOIN produced nothing, which under RLS is a legitimate refusal (a run can be visible via its own `created_by` while its system is policy-filtered).

All five denial causes return an indistinguishable refusal to the caller (404, or `null` from `getTestRunByTestRunId`) so nobody learns whether a run exists. The **server log is the only place the causes are distinguishable**, so any new caller of `denialReason()` must log the returned reason before refusing. Caller-supplied ids are passed through `forLog()` first — `testRunId` is a raw path parameter and Express percent-decodes path segments, so an unsanitized `%0A` would let an authenticated caller forge lines in the denial stream.

### Ownership column nullability

- `organization_id` is **NOT NULL** on all 26 owned-resource entities (Phase 4, 2026-05-02). The "null org = visible to all authenticated users" backward-compat rule is gone.
- Exception intentionally kept nullable: `audit_logs.organization_id` (system-level events with no org context). `test_runs.organization_id` was previously vestigial; Phase 5b backfilled and tightened it to NOT NULL so the standard RLS policy works without subqueries.
- `audit_logs` is RANGE-partitioned by month and carries an `audit_logs_default` DEFAULT partition (v0.2.73.0). Nothing at runtime creates partitions — `perfana_app`/`perfana_system` hold `USAGE` but not `CREATE` on schema `public` — so the default is what keeps an audit write from being rejected once the shipped months run out, and it is where every row lands from here on. Every partition has RLS enabled with no policies of its own: the parent's policies cover parent-routed access, and direct access (`SELECT * FROM audit_logs_2026_07`) is deny-all. A partition does **not** inherit the parent's RLS, so one created by hand needs `ENABLE` + `FORCE` immediately, and attaching it full-scans `audit_logs_default` under ACCESS EXCLUSIVE. Retention is `AuditRetentionManager`'s nightly batched `DELETE` of rows past `AUDIT_RETENTION_MONTHS` (default 24), never `DROP TABLE` — that needs an ownership the worker's role lacks.
- `team_id` remains nullable on all entities — teams are optional even on owned resources.
- Authorization enforcement (Phase 3) is now lint-enforced and the data layer (Phase 4) prevents the escape hatch.

### Idempotent Provisioning Endpoints

Some endpoints are designed for CI/CD pre-provisioning. They return the existing resource with HTTP 409 instead of failing, so pipeline scripts can call them unconditionally:

```typescript
// Service returns a conflict flag instead of throwing
if (existing) return { ...existing, conflict: true };

// Controller converts the flag to a 409 with the resource body
if (result.conflict) {
  const { conflict: _, ...resource } = result;
  throw new HttpException({ message: 'Already exists', resource }, HttpStatus.CONFLICT);
}
```

Example: `POST /api/systems-under-test` — creates the SUT (with optional environments and workloads) or returns the existing one with 409.

### The SUT export is large by default, and only Chrome and Edge can stream it to disk

`SUT_TRANSFER_ENABLED` gates an admin-only export that streams a gzipped NDJSON bundle with no
`Content-Length`. Three things about it are not obvious, and all three present as the same
useless symptom: a bare **"Network error"** in the export dialog.

1. **`ds_metrics` is a `core` resource, so it ships on every export.** The "Include raw sample
   data" checkbox covers the `raw` group — `requests_raw`, `requests_error`, `transactions`,
   `virtual_users` — and nothing else. Unchecking it does **not** make a large run's export
   small; the measurement data is the bulk of it and leaves regardless. The groups are declared
   in `SUT_RESOURCES` (`apps/api/src/modules/sut-transfer/sut-resource-graph.ts`), which is the
   only place to check what a given export will actually contain.

2. **The browser is the size ceiling unless it can write to disk.** The dialog asks for a file
   via `showSaveFilePicker()` and streams each chunk straight through, retaining nothing. That
   API exists only in Chrome and Edge (and needs a secure context, so not in a cross-origin
   iframe). Everywhere else — Firefox, Safari — it falls back to buffering the whole bundle in
   the tab as a chunk array and then copying it into a `Blob`, roughly 2x the bundle in memory.
   A large run kills the tab, and `fetch` reports that as `network error`, indistinguishable
   from a real one. The dialog says which path it took while the export runs; believe it before
   blaming the network. `pickDiskSink` and `readWithProgress` in `ExportSystemDialog.tsx` are
   exported and unit-tested precisely because this branch is invisible from the UI.

3. **A proxy can hold the whole thing back.** The export service sync-flushes the gzip every 2 s
   (`GZIP_FLUSH_INTERVAL_MS`) so the socket is never idle, but nginx buffers a proxied response
   by default and swallows exactly that signal. The route sends `X-Accel-Buffering: no` to
   suppress it. A load balancer with a **total** request cap (as opposed to an idle timeout) is
   not covered by any of this — nothing client-side helps, so export fewer runs per bundle.

Two rules if you touch this path. **Aborting the sink is not enough — abort the fetch too.**
With no `read()` outstanding the response stream stops draining the socket instead of closing
it, so the server never sees `res.on('close')` and keeps its Postgres cursor and one of 50
pooled connections open until the tab dies. And **do not add `res.flushHeaders()`** to the
route; see "A streamed response cannot report its own failure once the body is in flight" in
[CONVENTIONS.md](../../CONVENTIONS.md) for why, and for the `res.destroy()` trap that made every
server-side export failure arrive as an unexplained connection error before v0.2.94.3.

Cancelling still leaves a 0-byte file at the chosen location: the picker creates the entry
before the first byte arrives, and `abort()` discards the swap file, not the entry.

