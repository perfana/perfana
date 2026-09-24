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

### `virtual_users` has no time-only index, and that is the fix, not an omission

TimescaleDB creates a default index on the time column of every hypertable.
`virtual_users_time_idx` was dropped in v0.2.96.10 (migration 1811) because no query in
this repo can use it and the planner kept choosing it anyway, at ~50x the buffers.

Measured on production 2026-09-22, `GET /test-runs/:id/virtual-users` on a 3h07m run,
both plans warm and with **literal** timestamps:

| via | buffers | time | rows read -> returned |
|---|---|---|---|
| `virtual_users_time_idx` | 592,940 | 473 ms | 590,949 -> 261,597 |
| `idx_virtual_users_test_run_id_time` | 11,975 | 265 ms | 313,617 -> 261,597 |

The extra 329,352 rows are other tests. Four nightly runs share the 7-day chunk's time
range, so the time index matches all of them and `test_run_id` is only a post-filter
(`Rows Removed by Filter: 109784` per worker). Deployment-wide that index had read
**1.65 billion tuples**, with `idx_tup_fetch` at 99.97% of `idx_tup_read`.

Four things worth keeping straight:

1. **It is not stale statistics, so do not go looking for an ANALYZE to schedule.** The
   chunk had been autoanalyzed 52 times, most recently the same day, and `test_run_id`
   carries all 18 of its distinct values in the MCV list. It is correlated-predicate
   underestimation: each nightly run occupies its own band of the night, so the two
   predicates are strongly correlated and Postgres multiplies their selectivities as if
   they were not — estimating 26,315 rows per worker against 87,199 actual. `time` also
   has correlation 0.9974, which makes a range scan on it look nearly sequential.
2. **Extended statistics would not have held.** `CREATE STATISTICS` on `(test_run_id,
   time)` is the textbook answer, but the planner reads the **chunk's** statistics for a
   per-chunk scan and the object is not propagated to chunks created later, so it would
   silently stop working for every new chunk. Same parent-versus-chunk trap as
   `ds_metrics_groupkey`, in the opposite direction — see "`ds_metrics` carries one
   group-key statistics object, on the PARENT" in [apps/worker/CLAUDE.md](../worker/CLAUDE.md).
3. **Every reader must keep filtering by `test_run_id`.** That is what makes the drop
   safe: the five read sites (the two queries in `test-runs-performance-query.service.ts`,
   the two in `report-data-fetcher.service.ts`, and the worker's `scenario-processors.ts`)
   all do, and the composite index carries `time` second so a time-ordered scan within one
   run is still fully index-served. A new query filtering on time alone would fall back to
   a scan bounded by chunk exclusion — correct, but much slower than it looks.
4. **Removing the `CREATE INDEX` from `schema-sql.ts` would not have worked on its own.**
   `createHypertables()` calls `create_hypertable()` with the default
   `create_default_indexes => TRUE`, which recreates a time index when none exists, so it
   would come back under the same name on every new install. The migration runs after the
   consolidated schema so greenfield and existing databases share one code path.

**The other four hypertables were swept on 2026-09-22 and only `virtual_users` was
droppable.** Do not generalise this migration; the sweep is recorded here so nobody
repeats it:

| hypertable | per-run + time window query | CAGG reads it by time? | verdict |
|---|---|---|---|
| `virtual_users` | `virtual_users_time_idx`, 49x buffers | **no** | dropped (1811) |
| `transactions` | `transactions_time_idx`, 7462 ms / 1.30M buffers vs 804 ms / 815k | **yes**, 2 jobs every 30 s | **keep** |
| `requests_raw` | `Parallel Seq Scan`, 2453 ms vs 1017 ms | **yes**, 2 jobs every 30 s | **keep** |
| `requests_error` | `idx_requests_error_test_run_id_time`, correct | yes | fine |
| `ds_metrics` | `uniq_ds_metrics_upsert`, Index Only, correct | no CAGG | fine |

Two things that sweep settled:

- **`transactions` has the identical trap and still must not be dropped.** Its time index
  is what the `transactions_5s` / `transactions_passed_5s` refresh policies scan — proven
  directly, `Index Scan using _hyper_4_566_chunk_transactions_time_idx`, 45,660 rows in
  116 ms, and the ~1.49M recorded scans line up with the two jobs' 74,284 + ~74,000 runs.
  Drop it and every refresh becomes a sequential scan of a multi-million-row chunk twice a
  minute. `requests_raw` and `requests_error` are the same story. The per-run cost is real
  but it is the smaller of the two, and the biggest caller of that shape —
  `getSummaryTimeseries` — now reads the CAGGs instead (above).
- **`ds_metrics` does not have the trap**, even though it has a time index and no CAGG.
  `uniq_ds_metrics_upsert` carries `time` as its fifth column, so a per-run query with a
  window gets a Parallel Index Only Scan with both predicates in the `Index Cond`. Its
  time index still shows 40,679 scans over 6.4 billion tuples, which is not application
  traffic — most likely the compression policy walking chunks — so it is not a drop
  candidate without establishing what those scans are.

Do not "restore the missing time index" on a hypertable that has a composite leading with
the column every query filters on. Verified on TimescaleDB 2.28.3: after the drop, a newly
created chunk carries only `idx_virtual_users_test_run_id_time`.

### The analysis-window overview reads the 5s CAGGs, and its bounds must be bind parameters

`getSummaryTimeseries` (`modules/test-runs/services/test-runs-performance-query.service.ts`)
backs the ~100 bucket chart in the analysis time range dialog. It used to aggregate raw
`transactions` + `requests_raw` for the whole run to produce those buckets: 5,041,887 rows
for ~360 output points on a 3h07m production run, and second on the entire deployment by
blocks read in `pg_stat_statements` (525 calls, 686 GB, 7784 ms mean). Since v0.2.96.10 it
reads `transactions_5s` / `requests_raw_5s`, which already hold `n` and `avg_rt` per 5 s
bucket, and falls back to the raw scan when they answer with nothing.

Four things are load-bearing, and three of them were learned by measuring the wrong version
first:

1. **Resolve the run, then pass scalars. Never join a `run` CTE to the aggregate.** Written
   as `WITH run AS (SELECT … FROM test_runs …)` joined to the CAGG, the planner cannot see
   the bounds: the bucket range degrades from an `Index Cond` to a `Join Filter` and it
   sequentially scans the whole aggregate. Measured on the same run: **58.5 seconds**,
   32.2 M rows scanned with 14.0 M discarded by the filter — ten times worse than the raw
   query it was meant to replace. With the bounds as bind parameters it is one chunk per
   CAGG and single-digit milliseconds. `getThroughputStats`' `loadThroughputRunInfo` is the
   existing example of the same round-trip-first shape (issue #288).
2. **Union both families.** The comment this replaced claimed only one of `transactions` /
   `requests_raw` would hold rows ("JMeter/Gatling vs JTL-imported"). That is false — an
   ordinary JMeter run populates both (983 and 4559 on a local run), and reading either
   alone silently loses most of the samples. Verified equal: raw and CAGG both total 5542.
3. **The bucket size is rounded to a multiple of 5** so the 5 s aggregate composes exactly.
   A 730 s run picked 7 s before, which no whole number of 5 s buckets adds up to. This is
   visible in the response: `bucketSizeSeconds` can now differ by a second or two from what
   the old arithmetic produced, which is why the spec pins it.
4. **`time_bucket` takes the run's own 5 s-floored start as its origin.** On the default
   origin it aligns to the wall clock, so the first bucket can precede the run and
   `time_seconds` goes negative. Flooring to 5 s keeps the origin on a CAGG boundary, which
   is what makes the rollup exact; the price is that buckets can sit up to 4 s earlier in
   absolute time than the raw query put them, so per-bucket values differ by a few percent
   as samples move across a boundary. Invisible at ~100 buckets over a multi-hour run, but
   it is a real change and not a rounding detail.

The fallback fires on an **empty** CAGG read, which is the only signal available — the
aggregates are real-time, so a missing materialisation reads as "no rows" rather than as an
error. It covers SUT-imported runs, a system filtered by RLS (the metadata query joins
`systems_under_test` with a LEFT JOIN so that degrades to the raw scan instead of a 404),
and a deploy whose refresh policies are starved of worker slots — see the Postgres worker
budget note in the root [CLAUDE.md](../../CLAUDE.md).

Residue: `errors_per_second` is still hardcoded `0`, as it was before. The CAGGs carry
`n_err` and could populate it for the first time, but that changes what the chart draws and
was left out of a performance fix on purpose.

### Two SLOs on one panel, and why `uq_benchmarks_unique` never stopped them

`uq_benchmarks_unique` is `(system_under_test_id, test_environment, workload,
application_dashboard_id, generic_check_id)`. `generic_check_id` is the golden-path
auto-config key from grafana-sync and is **NULL for every SLO the UI creates** — 31 of 48 rows
on the dev database. NULLs never collide in a btree unique, so for exactly the SLO type the
Add-SLO dialog and the Duplicate button produce, the constraint is inert.

The consequence was not a tidy extra row. Two benchmarks on one panel produce two
`check_results` that match in `application_dashboard_id`, `panel_id` and `metric_name` — the
three fields the run view keys its SLO rows on — so React saw two siblings with one key,
dropped the duplicate on the first re-render, and **neither row could be expanded**. Observed
on WERKNL / `Performance test metrics T_WG_Mijn_Vacatures` / Transaction Error Rate, and on
Bravo; the audit trail shows the Bravo pair came from Duplicate (a `create` writes
`description: ''`, `duplicate`'s `cloneColumns` preserves `null`).

**`uq_benchmarks_active_metric_target`** (migration 1812) states the invariant the checks
pipeline actually depends on: no two benchmarks that `BenchmarkMatcher` will evaluate may
target the same panel, series and aggregation. Four things about its shape:

1. **The predicate is `WHERE valid AND enabled`**, matching `BenchmarkMatcher`'s own filter
   (`apps/worker/src/pipelines/checks/BenchmarkMatcher.ts`), and scoped to
   `benchmark_type = 'metric'` with a non-NULL `application_dashboard_id`. Apdex and
   aggregated SLOs carry a NULL dashboard and the UI keys their rows on `benchmark_id`
   already, so they cannot collide.
2. **The match pattern is a COALESCE, and it must stay one.** `withColumnMatchPattern`
   prefers `configuration->>'matchPattern'` and falls back to the `match_pattern` column, so
   the index reads
   `COALESCE(NULLIF(configuration->>'matchPattern',''), NULLIF(match_pattern,''), '')`. Key
   it on either source alone and two rows that evaluate the same series read as different.
3. **`requirement_operator` / `requirement_value` and `exclude_ramp_up_time` are deliberately
   NOT in the key.** Two SLOs differing only in those still collapse to one check-result key,
   which is the bug — the stricter one just hides the other.
4. **`duplicate()` clones disabled**, which is what keeps the Duplicate button working: the
   clone is identical to its source in every key column until the user edits it, and
   `WHERE enabled` is the only thing that lets it exist. Switching it on unedited gets a 409
   from `update`. That made an **Enabled** checkbox in the edit dialog load-bearing — before
   v0.2.96.15 nothing in the UI could set the column, so a disabled clone would have been
   unrecoverable.

Both `create` and `update` translate 23505 on this index to a `ConflictException` rather than
a 500, and `copyToScope` counts it as `skipped`. Two things that are easy to get wrong there:

- **The controller must let the ConflictException through.** `create`'s catch block had no
  `if (error instanceof HttpException) throw error;` guard, so the 409 arrived as a 500
  reading "Failed to create benchmark" — the feature was dead end to end on the create path
  while the service-level spec passed. `update` and `copyBenchmarks` already guarded.
- **Swallowing 23505 inside the RLS transaction needs a SAVEPOINT.** `RlsTransactionInterceptor`
  wraps each authenticated request in one transaction and `POST /benchmarks/copy` has no
  `@SkipRls`, so the unique violation aborts that transaction (25P02) and every later
  `findOne`/`save` in the loop fails with "current transaction is aborted". Catching and
  continuing without rolling back to a savepoint does not salvage the copy — it guarantees a
  500 and loses the rows already written. `saveSkippingDuplicateTarget` guards both branches,
  gated on `getRequestEm() !== null` because a SAVEPOINT is only legal inside a transaction.

`copyToScope`'s own `conflictKey` probe is coarser than the index (it matches on config/panel
title), so the index is the only thing that catches a target row with a different title on
the same panel.

Migration 1812 **disables** the newer of each existing pair rather than deleting it, and
deletes the check results it produced. A user may have meant to edit one into a variant.

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

