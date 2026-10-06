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

### The chain decoration on a transaction expand is bounded by an index, not by its LIMIT

`attachParallelGroups` (`modules/test-runs/services/test-runs-performance-query.service.ts`)
labels each sampler with the chain of controllers it ran under. The sampler rollup does not
carry the chain, so it is a separate lookup against `requests_raw`, shaped as

```sql
... FROM requests_raw
 WHERE test_run_id = $1 AND transaction_name = $2
 ORDER BY time LIMIT 5000
```

Measured on production 2026-10-01, WERKNL-acceptatie-combitest-00006 /
`WNL_AN_WZ_HP_02_DeWerkhoek` (680 rows in a 4,040,185-row run), warm:

| | buffers | time | rows |
|---|---|---|---|
| with `transaction_name` | 3,887,755 | 19,270 ms | 680 |
| without `transaction_name` | 2,364 | 13 ms | 5000 |
| with `idx_requests_raw_run_tx_time` | 601 | 9.6 ms | 680 |

**The LIMIT bounds nothing.** A comment on that query used to claim the bound was on rows
*scanned* rather than rows *matched*, because the chain filter sits outside the subquery.
Only the chain filter is outside; `transaction_name` sits **inside**, next to the LIMIT. A
transaction with 680 rows never fills 5000, so `ORDER BY time` with no time predicate makes
ChunkAppend walk every chunk of the hypertable — 22 of them, back four months. 19,263 ms of
the 19,270 was a single node: today's uncompressed chunk, read through
`_hyper_2_897_chunk_requests_raw_time_idx` (TimescaleDB's time-only default index) as an
`Index Scan Backward` with `Rows Removed by Filter: 4,753,041` — every other nightly run
sharing that day's chunk, fetched from the heap and discarded.

Fixed in v0.2.96.26 by migration 1813: `idx_requests_raw_run_tx_time (test_run_id,
transaction_name, time)`, paid for by dropping `idx_requests_raw_test_run_id_time`, which was
an exact duplicate of `idx_requests_raw_test_run_time` (same columns, opposite direction, and
btree scans either way). Net index count on the ingest path is unchanged.

Four things worth keeping straight:

1. **Dropping `requests_raw_time_idx` would not have fixed it.** That is the reflex this
   repo already has — migration 1811 did exactly that for `virtual_users`, and this is the
   same correlated-predicate underestimation (estimated 1161 rows, actual 680 after 4.75 M;
   a time-ordered scan under a LIMIT looks almost free). But the fallback here is
   `idx_requests_raw_test_run_time`, which index-conds `test_run_id` and then post-filters
   `transaction_name` across all 4,040,185 of the run's rows. Only an index carrying **both**
   equality columns turns this into a bounded ordered scan, and it wins on cost outright
   rather than by a margin the planner can mis-estimate away. `requests_raw_time_idx` also
   must stay for a second reason: the `requests_raw_5s` refresh policies scan it twice a
   minute — see the sweep table in "`virtual_users` has no time-only index" above.
2. **`idx_requests_raw_grouping` cannot serve it.** It is `(test_run_id, scenario_name,
   transaction_name, sampler_name, time)`, and `scenario_name` sits between the two equality
   columns while being unbound here.
3. **The 21 compressed chunks are not the problem.** `ColumnarScan` reaches them through the
   `compress_segmentby` key (`test_run_id`) and — since TimescaleDB started keeping sparse
   bloom filters on the other columns — excludes `transaction_name` with
   `bloom1_contains_any_hashes` before decompressing anything, at ~0.04 ms per chunk. Adding
   a time window from the run would buy nothing measurable. It is the one uncompressed chunk
   that carries the whole cost.

   The flip side: at 22 chunks, planning this query (27.9 ms) now costs three times its
   execution. That is the floor for any unbounded-time query on this hypertable and is not
   worth chasing, but do not read a 30 ms expand as a regression.
4. **Keep the chain filter outside the subquery.** A run with no tagged requests — every run
   recorded before `source_element_path` existed — would otherwise scan the whole transaction
   hunting for matches that cannot exist.

**Adding an index to `requests_raw` has exactly one legal shape, and it is neither 1791's nor
1807's.** This is the hottest write table in the deployment, so 1807's "plain CREATE INDEX, the
table is small enough" does not transfer — a plain build holds a SHARE lock that blocks INSERTs on
every chunk for the whole build. 1791's `COMMIT` + `CREATE INDEX CONCURRENTLY` is not available
either. All four constraints were probed against TimescaleDB 2.28.3, the version production runs:

| statement | result |
|---|---|
| `CREATE INDEX CONCURRENTLY` | `ERROR: hypertables do not support concurrent index creation` |
| `WITH (timescaledb.transaction_per_chunk)` | works — built on all 6 dev chunks |
| the same, inside a transaction block | `ERROR: cannot run inside a transaction block` |
| `DROP INDEX CONCURRENTLY <parent>` | `ERROR: does not support dropping multiple objects` |

So the shape is 1791's `COMMIT` escape followed by a **per-chunk** build, and a **plain** DROP.
There is a second, independent reason a single-transaction build is wrong on this table, in the
`max_locks_per_transaction` note in `docker-compose.infra.yml`: its 1-day chunks have no retention
policy, one statement locks every chunk **plus its compressed twin**, and the lock table is
`max_locks_per_transaction x max_connections`. The local stack raises that to 256; a deploy on the
Postgres default of 64 hits `out of shared memory` once a few hundred chunks exist.

**A partial per-chunk build is silent, self-masking, and lands on the worst possible chunk.** This
is reproduced, not theorised — hold a conflicting `ROW EXCLUSIVE` lock on the live chunk with
`lock_timeout` below the hold time and:

1. the build takes the parent index and 5 of 6 chunks, then fails on the live chunk with
   `canceling statement due to lock timeout`;
2. re-running the **identical** statement prints `NOTICE: relation "..." already exists, skipping`
   and then `CREATE INDEX` — it **reports success**;
3. coverage is unchanged, and the chunk left uncovered is the live one, which is precisely the
   chunk the 49 s report was about. The fix appears to deploy and the slow plan quietly survives
   for the newest data.

`IF NOT EXISTS` matches on the parent, so it cannot see missing chunks, which means the statement's
own exit status is not evidence of anything — and on the retry it is actively misleading. Migration
1813 therefore ends each build with `assertFullCoverage`, which compares chunk-level copies against
`timescaledb_information.chunks` and throws naming the uncovered chunks. Recovery is `DROP INDEX
<name>` then re-run; **not** `REINDEX`, which has nothing to work on for a chunk with no copy. Any
future per-chunk build on this table needs the same assert — without it a half-built index is
indistinguishable from a good one.

`lock_timeout` must be session-scoped here, not `SET LOCAL` — `SET LOCAL` dies with the `COMMIT`
above it, leaving the build waiting indefinitely behind a long-running read. It must then be reset
in a `finally`, because the migration image runs `runMigrations()` with TypeORM's default
`transaction: "all"` (see 1796's docblock), so a session `SET` left behind leaks into every later
migration in the same deploy batch. It never reaches an application pool — `migrationsRun` is false
everywhere and `perfana-migration` exits when done — so the batch is the consumer to reason about.

**The DROP looks like the step most likely to fail, and measurement says otherwise.** `DROP INDEX`
needs ACCESS EXCLUSIVE on the table and every chunk index it cascades to — a mode that conflicts
with plain `SELECT` — and the worker's minutes-long aggregations would block it outright. But a
probe taking that exact lock **while a test was running** got it in **0.45 ms** (production,
2026-10-01): write transactions here are short (a JDBC `INSERT` observed `idle in transaction` at
28 ms), so the conflicting windows are brief. Treat a failure as unlikely rather than expected.
If it does happen it costs nothing: the performance fix is already live and
coverage-verified by the time the DROP runs, a retry skips straight to it, and a thrown error is
never recorded as applied (TypeORM's `insertExecutedMigration` is in the `.then()` of `up()`), so
the next deploy retries it for free. **Do not raise `lock_timeout` to "give it more room"** —
Postgres' lock queue is FIFO, so a *waiting* ACCESS EXCLUSIVE blocks every new reader behind it. A
30 s timeout buys a 30 s stall of the busiest table, not a 30 s grace period.

**A `COMMIT` inside a migration ends the whole batch's transaction, not just its own.** Under
`transaction: "all"` (what `Dockerfile.migrations` runs) the executor opens one transaction for the
entire batch, so the escape hatch 1791 and 1813 both use means every migration numbered above them
in the same batch runs outside any shared transaction — the batch quietly stops being
all-or-nothing from that point. TypeORM does not notice, because its `isTransactionActive` flag is
only moved by the driver's own commit/rollback and never by inspecting raw SQL, so its later bare
`COMMIT`/`ROLLBACK` are `WARNING: there is no transaction in progress` rather than errors. Nothing
breaks; but a migration that is relying on the batch to roll back for it cannot do so if an earlier
one in the same deploy used this pattern.

One honest caveat on cost: net index **count** on the ingest path is unchanged, but net **width**
is not. The new index's third column averages ~19 bytes, so its leaf entries run 35-40% larger than
those of the 2-column index dropped alongside it, and WAL per insert on that one index rises to
match.

The check for this is the plan, not a unit test: `EXPLAIN (ANALYZE, BUFFERS)` the query and
confirm `Index Cond` carries both `test_run_id` and `transaction_name`, with no
million-row `Rows Removed by Filter`. Building the index on the single current chunk inside
a rolled-back transaction is enough to prove it and takes seconds, where the hypertable-wide
build takes minutes — but check afterwards that the probe index is actually gone. `CREATE
INDEX` is transactional, so a `ROLLBACK` removes it; a client that autocommits each statement
does not, and the leftover then sits on one chunk where no migration tracks it.

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

Migration 1812 **disables** the newer of each existing pair rather than deleting it, and keeps
the `check_results` it already produced. A user may have meant to edit one into a variant, and
the results are per-run history: `test_runs.consolidated_result` is a stored verdict derived
from them and nothing here recomputes it, so deleting them would leave a finished run whose
header says FAILED with every SLO row green and no evidence left to explain it. A duplicate
check-result row renders correctly now anyway. The disabled rows are marked by appending
`Disabled by migration 1812: duplicate of an identical SLO on the same panel` to `description`,
which is what `down()` keys on to switch them back on.

One deploy-time failure mode is worth knowing: `benchmarks` is `FORCE ROW LEVEL SECURITY` and
the migration runner sets none of the `app.current_user_*` GUCs `can_modify_resource` reads, so
a migration login that owns the table without superuser or `BYPASSRLS` would update zero rows
and then fail the index build on rows it could not see. `up()` re-counts the duplicate groups
after the dedupe and throws with that cause named rather than letting an opaque 23505 block the
deploy.

### The report's charts follow the app's chart standard, from a copy of its tokens

A report is one self-contained HTML file read in an iframe with no `allow-scripts`, so there
is no Plotly: every chart in every section is server-rendered SVG. Three builders draw them —
`chart-svg.service.ts` (Graphs, Comparisons, Trends), the errors-over-time chart in
`error-analysis-renderer.ts`, and the response-times chart in
`transaction-response-times-renderer.ts` — and until v0.2.97.2 each answered "what colour, how
thick, which gridlines" differently, none of them the way the app does.

They now read `chart-tokens.ts`, a hand copy of `apps/web/lib/charts/tokens.ts`. Nine things
about that arrangement are easy to get wrong:

1. **The copy is guarded, not trusted.** `chart-tokens.spec.ts` reads the web file off disk
   and compares the palette, the inks, the line widths, the type scale and both font stacks.
   Change the app's palette and this fails here rather than producing a report whose teal is
   last quarter's teal. Its first case asserts the web file was *found* — a moved or renamed
   tokens file must fail loudly, not pass every later comparison against `undefined`.
2. **`CHART_SANS` is single-quoted where the app's `SANS` is not, and that is not cosmetic.**
   A report sets fonts through inline `style="…"` attributes, so `"Inter"` closes the
   attribute and the rest of the declaration lands in the markup as stray text. The drift
   spec compares the two stacks with quotes normalised, so they still cannot diverge.
3. **A `chartSeriesTable` legend is a CSS grid with table roles, never an HTML `<table>`.**
   The comparisons section draws a chart inside a detail row of its own data table, and
   `report-interactivity.ts` enhances every `.table-scroll table` on the page — a real
   `<table>` there would be given sortable headers and its own "Filter rows..." box inside
   the chart card, and would put `<td>`s inside a detail cell that `collectUnits` requires to
   be the row's only cell.

   **One builder has no `chartSeriesTable` at all, by design.** Response times over time
   (`transaction-response-times-renderer.ts`) uses its own transactions data table as the
   legend (v0.2.97.4): the swatch sits in the row, and `data-series` rides the `<tr>`. It had
   both, and they disagreed — the grid's Mean was the mean of the per-minute bucket means
   while the table's Avg was `AVG(response_time)` over every request, so one transaction
   carried two numbers two centimetres apart.

   The real `<table>` works HERE because it is top-level markup, not a chart nested in
   another table's detail row. **Sort is safe and filter is not**, and the difference is
   worth knowing: the pairing survives a sort because `data-series` rides the row it belongs
   to (verified against the real `REPORT_INTERACTIVITY_SCRIPT` in jsdom), but the injected
   "Filter rows..." box hides rows with `display:none` (`report-interactivity.ts`) while the
   chart keeps drawing their lines — so a filtered row takes its line's only colour key with
   it, and the iframe has no scripts with which to hide the line too. That is what
   `renderChartKey` is for: a name-only swatch row under the chart, outside the table and
   therefore outside the filter, so every line always has a name on the page. It carries no
   numbers on purpose — a second set of numbers is the bug this section started with.

   **The swatches follow what the chart GOT, not what the section asked for.** `includeChart`
   is the section's configuration; `drew` is `includeChart && timeSeries.length > 0`, and with
   no time buckets `renderResponseTimesChart` emits a "no time series data" card with no
   `<svg>` in it at all. Only `drew` may put swatches in the rows, `data-series` on the `<tr>`
   or a `.chart-hover` around the pair — otherwise a colour key keys nothing and the wrapper
   scopes a hover that can never fire. The table's second parameter is that answer, hoisted
   out of the chart builder so the table can see it; do not wire it back to `includeChart`.

   Do not copy the table-as-legend to the other two builders: they draw series that have no
   data table of their own.
4. **Two marks stay louder than the app's on purpose, because a report prints.** The
   analysis-window boundary keeps amber (`ANALYSIS_BOUNDARY_COLOR`) where the Graphs card
   draws a `theme.faint` hairline, and the excluded band uses `CHART_INK.excludedPrint` (10%)
   rather than the app's `excluded` (4%), which is invisible on paper.
5. **In `chart-svg.service.ts` only, tick labels keep their unit, so its left gutter stays
   wide.** That chart's `formatValue` rescales per value, so one axis can legitimately read
   `900 ms` and `1.2 s`; dropping the unit would make those two numbers incomparable, and
   `padding.left` is sized for `287.36 ms`, not for `287.36`. The other two builders carry a
   single fixed unit, name it in the axis caption and keep a narrow gutter (56-62px) with
   bare numeric ticks — do not "fix" those to match.
6. **The series table is one grid, and its rows are `display:contents`.** Re-declaring
   `grid-template-columns` per row makes every row its own grid sized to its own content,
   and then the number columns do not line up and `text-align:right` aligns nothing — which
   is the entire point of replacing a swatch legend with a table. The app's `SeriesTable`
   survives per-row grids only because its tracks are fixed pixel widths; a report's numbers
   are formatted per unit, so the tracks have to be content-sized. Type and colour are
   declared once on the container and inherited: repeating them per cell cost ~1.9 KB per
   series row in a document that is stored in Postgres, mailed and run through Puppeteer.
7. **`CHART_SIZE.legendFont` is 11px and is NOT mirrored from the app.** The compiler prints
   under `body { zoom: 0.8 }`, so the table's 10px would reach paper at 8px — smaller than
   the 9pt legend it replaced. The SVG needs no such allowance: its text scales with the
   viewBox, not the zoom.
8. **The legend sits BELOW its chart, and hover is CSS, not script.** `CHART_HOVER_CSS`
   (`chart-tokens.ts`) does two things the viewer's script-less iframe would otherwise rule
   out: hovering a series-table row dims every other line, and hovering the plot shows a
   crosshair with each series' value there. All three builders put their legend below the
   chart and emit `class="chart-hover"` + `data-series` groups — for response times that
   legend is the transactions table itself (item 3), wrapped with the chart in one
   `.chart-hover`; the **cursor readout exists
   only in `chart-svg.service.ts`** (so it covers Graphs, Comparisons and Trends), because
   the other two would each need their own copy of the band machinery. Six things:

   - **The pairing is `data-series="<row index>"` on both the table row and the SVG group**,
     and `:has()` is what lets a row *below* the chart reach back up into it. One rule per
     slot is generated because nothing selects "the element whose attribute equals the
     hovered one's" — so **the attribute itself is gated** on `HOVER_SERIES_SLOTS` through
     `hoverSlot()`. A series past the last slot must carry no attribute at all: with the
     attribute and no un-dim rule, hovering it fades the whole chart to 15% and highlights
     nothing, which is the inverse of the feature. A JMeter scenario with 300 transactions
     is one series each, so this is reachable, not theoretical.
   - **Both compiler entry points need the CSS.** `compileHtml` AND `compilePreviewHtml` —
     the section preview renders the same chart markup in a `sandbox=""` iframe, so its own
     `<style>` is all it gets, and without the block every band's readout is visible at
     once, ~40 boxes stacked across the plot. It shipped that way for about an hour.
   - **Everything constant about a readout is painted from the stylesheet**, which ships
     once per document: the crosshair's stroke, the box's fill and the 80-character mono
     font stack were 51% of the hover layer's bytes when they were per band (29.4 KB →
     19.2 KB on a 3-series chart). Only geometry and the per-series colour stay inline.
     Two attributes deliberately stay on the elements: `fill="transparent"` on the band
     rect (without the stylesheet a bare rect is BLACK, not invisible) and `opacity="0"` on
     the readout group (so a consumer missing the stylesheet degrades to "no hover").
   - **A reading has to lie inside its own band**, tested as the band's interval rather than
     a distance from its centre. The intervals tile exactly; a half-band *distance* test
     loses the common case, because a regularly sampled series puts every point exactly
     half a band from the nearest centre. This is what stops one readout printing a
     timestamp over values measured a full band apart.
   - **Non-finite times and values are filtered with the nulls.** `Math.abs(NaN - t) > span`
     is FALSE, so an Invalid Date fails the band guard OPEN and is read as that series'
     value in *every* band on the chart.
   - **The band pitch (~22px, 48 max) is a size budget, not a precision dial**, and the
     readout sheds rows into "+N more" to fit the plot's height. Print hides the whole
     band, not just the readout — `opacity: 0` still lays a group out and embeds it.
9. **`npm run preflight` runs the drift spec** (`test:chart-tokens`, 0.3 s). Before that it
   was a spec nothing executed: preflight is lint + type-check + two check scripts + the RLS
   suite, and `.github/workflows/pr-quality-gate.yml` is `workflow_dispatch` only, so a
   palette edit in `apps/web` could merge with the guard never running.

Deliberately **not** mirrored: the dark palette (there is no dark report), and the y-axis
domain. The app pins a non-negative axis to `[0, niceTop]`; the report keeps its padded
min..max, because re-framing the charts of a report people have already read is a different
change from restyling them.

### The host metric list has ONE definition, and the disk metrics must fold explicitly

`HOST_METRICS` in `modules/dynatrace/dynatrace.service.ts` is the single list behind both
halves of the host-metrics feature: the stored `dynatrace_queries` rows
`createHostMetricQueries` writes when a HOST is mapped, and the live series
`fetchHostMetrics` draws in the Dynatrace card's host detail. They were separate inline
arrays until v0.2.96.22 and had quietly disagreed for a year.

Two things that are easy to get wrong here:

1. **Every `builtin:host.disk.*` metric carries a `dt.entity.disk` dimension.**
   `builtin:host.disk.X:filter(eq("dt.entity.host","HOST-…")):avg` therefore returns one
   series PER DISK, not one for the host. The worker stored all of them (per-disk rows are
   what anomaly detection showed), while the card read `response.data.result[0].data[0]` —
   the **first** series — and labelled it as the host's. Nobody aggregated anything; the
   card was plotting one arbitrary disk. Every disk entry now carries an explicit
   `splitBy()` in its `transform`, so each key of `HostMetricsResponse.metrics` holds
   exactly one folded series by construction and the card's `[0]` is safe.

2. **Latencies average across disks, counts sum.** `splitBy():avg` for `readTime` /
   `writeTime`, `splitBy():sum` for `readOps` / `writeOps` / `queueLength`. Averaging IOPS
   would report a host doing 4000 IOPS on one volume and nothing on three others as 1000.

**`builtin:host.disk.utilTime` was removed from the list in v0.2.96.22, deliberately.** It is
iostat's `%util` — the fraction of wall-clock time a device had at least one request in
flight — which saturates at 100% on any device that services requests in parallel (every SSD,
every SAN volume) and then cannot distinguish 2x over capacity from 20x. It was replaced by
`readTime`, `writeTime`, `readOps`, `writeOps` and `queueLength`, which do move with load.
Three residues:

- **Hosts mapped before that version keep their `Disk Utilization` query** and do not gain
  the new ones. Nothing migrates them — an SLO or compare config may target that panel.
  Re-adding the host, or copying it to the scope, writes the new set.
- **The report's `disk` column still means `utilTime`, and must keep meaning it.**
  `DYNATRACE_HOST_COLUMNS` in `packages/shared/src/types/reports.types.ts` is persisted
  inside saved report section configs, so removing the key or redefining what it measures
  silently rewrites every template that selected it — `pickColumns` drops anything outside
  the whitelist, and a template left with nothing falls all the way back to the cpu+memory
  default. `diskLatency` and `diskIops` were added **beside** it instead, each rendering a
  read and a write column, and are what new sections should use. The card's Hosts tab
  (`fetchHostsOverview`) has no disk column at all and never did.
  `dynatrace-hosts-renderer.spec.ts` pins both halves (mutation-verified: deleting `'disk'`
  from the list fails two cases).
- **`packages/shared/src/constants/dynatrace-metrics.ts` is gone** (deleted in v0.2.96.22,
  after the disk change). It was dead — zero importers — and documented panel ids 100-105, a
  USE classification table and metric-name templates for a host metric set Perfana no longer
  collects, with `DISK_UTILIZATION` carrying the very misconception this section exists to
  correct. `HOST_METRICS` is the registry; there is no second one. Note the `./constants`
  barrel survives, because `perf-test-profile` is exported through it and eight files use
  that.

**The two latency units are assumed, not verified.** `unit: 'ms'` on `readTime` / `writeTime`
is a guess: Dynatrace has shipped both ms and µs for these across versions, and the local
mock (`infra/dynatrace-mock`) stubs only `cpu.usage`, so there was nothing to check against.
`GET /api/v2/metrics/builtin:host.disk.readTime` on a real tenant returns the authoritative
unit. It only drives the axis suffix, and a user can override it per query in the edit
dialog.

`dynatrace.service.spec.ts` asserts the two selector sets are equal, that all five disk
selectors fold, and that no selector mentions `utilTime` (mutation-verified: removing one
`splitBy()` fails it). That test is the only thing stopping a private copy of the list from
reappearing.

### A golden-path template loses to any row already on the panel, and a Dynatrace host panel always has one

`applyGoldenPathClassifications` (`modules/test-runs/services/test-runs-metrics.service.ts`) runs at
run completion and refuses to overwrite a `ds_compare_config` row that already sits on the panel —
user edits must survive. Its one exception used to be `updated_by = 'worker-pipeline'`, the default
row `PerformanceTestMetricsPipeline` seeds during the run.

**`createDsCompareConfigForMetric` (`modules/dynatrace/dynatrace.repository.ts`) writes a panel-level
row the moment a HOST is mapped, and its INSERT names no `created_by`/`updated_by` at all.** So the
row read as a user edit while being pure boilerplate — classification hardcoded `USE_utilization`,
`absoluteThreshold: null`, `percentageThreshold: 0.10`. Measured on the dev database: of the 56
(dashboard, panel) pairs a `dashboardUid: '^dynatrace-'` + `panelTitle: CPU Usage` / `Memory Usage`
template resolves, **56 were already occupied and 0 were mergeable**, so the template was a
guaranteed no-op on every run, forever. The provisioning side was fine — the rows were in
`provisioned_template_ds_compare_configs`, the uid matched (`dynatrace-dynatrace-host-metrics-…`),
`ds_panels` carried the titles. Nothing was logged; the panels simply kept `absoluteThreshold: null`.

The discriminator is `config_data.source`, not authorship:

- The Dynatrace insert stamps `source: 'dynatrace-host'`, and a UI save rewrites it to
  `'metric'`/`'panel'` **and** sets `updated_by` (`updateDsCompareConfig`). So
  `!updated_by && source === 'dynatrace-host'` is the one shape nobody has touched. 591 of the dev
  database's 592 null-author rows match it; the one that does not reads `source: 'panel'`.
- **The merge is self-limiting.** It stamps `GOLDEN_PATH_ACTOR`, so the row stops matching after the
  first pass — which is also why the null-author half of the test cannot be dropped.
- **It takes effect on the next completed run**, not at boot. Rows already written stay as they are
  until that run analyses.
- `higher_is_better` comes from the template, so a template whose `panelTitle` reaches
  `Network Traffic` would overwrite the `higherIsBetter: null` the Dynatrace path sets deliberately
  for an informational metric. The shipped templates name CPU and Memory only.

A row the golden path itself authored is never revisited, so **editing a template's `absThreshold` in
YAML does not propagate to panels it already seeded** — that was true before this fix and still is.

`regex` support landed in v0.2.95.35 and `panelTitle` in v0.2.95.37; a deploy older than those
ignores both halves of such a template.

### An artificial Dynatrace dashboard is per-workload, but its unique constraint is not

`generateDynatraceDashboardUuid` hashes `(system, environment, workload, label)`, so every
workload gets its own `application_dashboards` row. `uq_application_dashboards_unique` is
`(system_under_test_id, test_environment, grafana_instance_id, dashboard_uid, dashboard_label)` —
**no workload**, and `generateDynatraceDashboardUid` builds the uid from the label alone. So for
a second workload in the same environment the two disagree: a new id, an identical natural key.

`ensureArtificialDashboardExists` filled `grafana_instance_id` with `SELECT id FROM
grafana_instances LIMIT 1` — an arbitrary instance these rows have no relationship to — which made
that collision real. Its `ON CONFLICT … DO NOTHING` then swallowed the insert, and the next
statement, the `ds_compare_config` insert that reads the dashboard's `organization_id`, failed on
the NOT NULL with `null value in column "organization_id" of relation "ds_compare_config"
violates not-null constraint`. Nothing named the dashboard. Fixed in v0.2.96.23 by leaving the
column NULL: NULLs never collide in a btree unique, so the per-workload row can be written.

**The part that is easy to get wrong next:** once the column is NULL,
`uq_application_dashboards_unique` cannot fire on these rows at all, and `ON CONFLICT (id) DO
NOTHING` becomes their only dedupe. That is sound *only* while every caller passes a
**deterministic** id from `generateDynatraceDashboardUuid`, which hashes the workload in.
`createQuerySmart` and `bulkImportQuery` both used `randomUUID()` and were changed in the same
version — with a random id the conflict target never matches, so each call inserted another
`application_dashboards` row with an identical natural key, silently. (On the old code those two
failed the other way: the natural key collided, the insert was swallowed, and the queries were
written against a `sharedUuid` with no row behind it. Neither was ever right.) A new caller that
reintroduces a random id gets the duplicate-row version with nothing to stop it.

The worker has a near-twin of this insert in
`apps/worker/src/pipelines/helpers/dynatrace-dashboard-manager.ts` that also omits the column.
**Do not cite it as precedent:** nothing outside its own tests calls it — `DynatracePipeline` uses
the stored `applicationDashboardId` instead — and its uuid formula (`…-${env}${workload ? '-' +
workload : ''}-dynatrace-…`) differs from this one (`…-${env}-${workload}-dynatrace-…`) whenever
the workload is empty, so the two do *not* always compute the same id.

Three things that go with it:

- **It was never only the copy path.** Mapping a host by hand into a second workload of the same
  environment hit it too; the copy feature is just what made it easy to reach.
- **The synthetic `grafana_dashboards` row stays**, and `application_dashboards.grafana_dashboard_id`
  still points at it. The SLO dialog looks these up by uid (`GET /grafana/dashboards?uid=…`) — see
  trap 1 of "`grafana_dashboards` is a mixed table" in the root [CLAUDE.md](../../CLAUDE.md) — so
  dropping it would break creating an SLO on a Dynatrace host metric. Only
  `application_dashboards.grafana_instance_id` is given up.
- **That column has more readers than it looks, and one of them had to change with it.**
  `grafana_dashboards.grafana_instance_id` is NOT NULL and FKs to `grafana_instances`, but the SUT
  export reaches the two tables by different joins: instances through `ad.grafana_instance_id`,
  dashboards through `ad.grafana_dashboard_id`. A Dynatrace-only SUT therefore exported the
  synthetic dashboard with no instance to hang it on, and the import FK-violated —
  `sut-resource-graph.ts` now unions in the instances reachable *through* `grafana_dashboards`.
  The other readers are fine as they are, and two of them improve: the grafana-sync restore sweep
  (`restore-dashboard.service.ts`) no longer counts an artificial row as a reference, and
  `IncrementalCollectionScheduler` no longer classifies one as a Grafana collection source for an
  instance it has no relationship to. `ApplicationDashboardsService` keeps an optional
  `grafanaInstanceId` filter and **emits** the column (plus the joined `grafana_instance` object,
  now `undefined`) in the application-dashboards response — both already optional, and the one UI
  that would follow the link filters artificial rows out first via `isArtificialDashboard`.
  `findByGrafanaInstance` / `deleteByGrafanaInstance` in `application-dashboard.repository.ts` are
  currently uncalled but key on it too. One reader **fails open** and is worth knowing about:
  `groupPanelsByGrafanaInstance` in `apps/worker/src/config/grafana-client-factory.ts` reads a NULL
  as "the default Grafana singleton" rather than as "not a Grafana source" — the opposite of
  `collectable-sources.ts`, which skips it. No production path feeds an artificial dashboard's
  panels into it today; one that did would ask a Grafana for a Dynatrace panel.
- **`ApplicationDashboardsService.copyToScope` had to change with it.** It rebuilt each row with
  `grafana_instance_id ?? ''`, and `''` is not a NULL to Postgres — it is `22P02 invalid input
  syntax for type uuid`, so the whole copy 500s the moment any source row has a NULL. `create()`
  is called service-to-service there, so the DTO's `@IsOptional() @IsUUID()` never runs (and
  `@IsOptional()` skips `null`/`undefined`, not `''`). It is `?? undefined` now. Its `makeKey`
  still collapses every workload's artificial row for one host to a single key, since the key is
  `instance|uid|label` and all three now match — see TODOS.md.
- **Old rows keep their arbitrary instance id.** Nothing backfills them, so a deployment upgraded
  into this version holds a mixed population indefinitely: dashboards written before it still match
  `?grafanaInstanceId=<whichever instance was first>`, ones written after match no value of that
  filter. Both are harmless; it is only confusing if you go looking.
- **`createDsCompareConfigForMetric` reads the org in its own statement now**, not as a subquery
  inside the INSERT. A missing or RLS-invisible dashboard says so by name instead of substituting
  NULL and surfacing as the not-null violation above. Its existence probe is also scoped by
  `(system, environment, workload)`, matching `uniq_ds_compare_config_panel`.

### `findDashboardByLabel` is scoped, and has to stay that way

`createQuerySmart` reuses an existing artificial dashboard before deriving one. That lookup was
`findOne({ where: { dashboardLabel } })` — `dynatrace_queries` has only a PK, no unique on the
label, and `copyQueries` deliberately writes the same label into other scopes, so it matched any
query anywhere and handed the new query another system's or workload's
`application_dashboard_id`. Its metrics, `ds_compare_config` rows and ADAPT verdicts then landed
on that scope's dashboard.

Worse, it sits on the left of `existingUuid ?? generateDynatraceDashboardUuid(...)`, so a hit
**short-circuited the deterministic id** — which is the only dedupe an artificial dashboard has
left since it stopped carrying `grafana_instance_id` (see the section above). v0.2.96.23 fixed the
fallback and left this arm; v0.2.96.25 scoped it to
`(dashboardLabel, systemUnderTestId, testEnvironment, workload)`.

Keep the reuse arm rather than always deriving: rows created before the deterministic scheme
carry a `randomUUID` id, and dropping the lookup would orphan them.

### Copying Dynatrace config to another scope

`POST /dynatrace/queries/copy` and `POST /dynatrace/entities/mappings/copy` (v0.2.96.22) take
the same body as the deep-links / SLO / dashboard copy endpoints, so the web app's one
`CopyToScopeDialog` drives all of them. Four things specific to the Dynatrace pair:

1. **`applicationDashboardId` is re-derived, never carried over.** A Dynatrace query hangs off
   an artificial dashboard keyed on `(system, environment, workload, label)`. Copying the id
   would point the target's metrics at the source's dashboard — see "`grafana_dashboards` is a
   mixed table" in the root [CLAUDE.md](../../CLAUDE.md). `copyQueries` calls
   `generateDynatraceDashboardUuid` against the target scope and `ensureArtificialDashboardExists`
   creates the row.

   That row only became insertable in v0.2.96.23 — see "An artificial Dynatrace dashboard is
   per-workload, but its unique constraint is not" above.
2. **A copied HOST mapping also gets its metric queries**, because the mapping alone collects
   nothing. Skipped when `countQueriesForDashboard` says the target dashboard already holds
   queries, so a repeated copy does not duplicate them.
3. **Each mapping keeps its own `level`.** A `sut`-level mapping stays system-level in the
   target (no environment, no workload), matching `idx_dynatrace_entity_mappings_unique`, which
   collapses NULLs to `''`. The conflict probe has to scope itself the same way or it compares
   the wrong rows.
4. **Cross-organization copies are refused with a 400.** Both paths call
   `requireCopyTargetOrg`, which compares the target system's organization against the one
   behind every source row's Dynatrace connection. RLS would not catch this: the copied rows
   carry the *config's* org, and `can_access_resource`'s `created_by` fallback admits any row
   the caller is inserting — see "RLS does not backstop a caller-named `organization_id` on
   create" above. `getSystemOrganizationId` reads through `withRequestQuery`, so a system the
   caller cannot see and one that does not exist are the same 404.

Conflict keys: `dashboardLabel` + `panelTitle` for queries (what the Queries tab shows), and
`entityId` within the target scope for mappings. `overwrite` updates a conflicting query in
place; for a mapping it is a no-op — the only mutable field is `labels` — so a mapping conflict
always counts as `skipped`.

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


### The errors endpoint's `sample_url` is a key the client sends back, so it must not be normalised

`GET /test-runs/:id/errors` groups `requests_error` rows and hands each group a `url`. That value
is not display text — the web client sends it straight back as the `url` query param of
`GET /test-runs/:id/error-analysis/details`, whose `WHERE` matches `url` **exactly**. Any
transform on the way out is a guaranteed zero-row lookup on the way back.

Until v0.2.96.17 the group query selected `LOWER(eg.sample_url) as sample_url`, so every error on
a mixed-case URL produced a drill-down click that returned `[]` — an empty dialog with nothing in
the log. It was also the worst query shape available: `ORDER BY time DESC LIMIT 10` cannot stop
early when nothing matches, so the miss costs a full scan of the run's errors for that sampler.

Three things to keep straight in that same `SELECT`
(`services/test-runs-performance-query.service.ts`, the error-groups CTE):

1. **`normalized_url` and `url_pattern` stay lowercased.** They are grouping keys the client only
   ever displays, and the lowering is what makes the grouping case-insensitive.
2. **`sample_url` stays raw.** It is the sample row's own URL, the one `/error-analysis/details`
   stored. `test-runs-performance-query.service.spec.ts` asserts the raw form (mutation-verified:
   re-adding `LOWER()` fails it), so the guard is the spec, not the comment.
3. **`sample_response_data` has had no web consumer since v0.2.96.17** — the drill-down fetches
   bodies from `/error-analysis/details` on demand instead. It is still selected because it is a
   documented response field of a public REST endpoint; dropping it and its Swagger schema is
   filed in TODOS.md.

The general rule this is an instance of: when one endpoint's response field is another endpoint's
exact-match lookup key, the two ends are a contract. Normalise for grouping in a separate column,
never in place.

### Graph presets are scoped by their series' dashboards, and `findAll` alone is half a fix

`graph_presets` rows are owned resources, but the module had two independent scoping holes
until v0.2.96.27. Both are worth reading before touching any list-and-by-id service pair.

**1. `isGlobal` means "all runs of this system and environment", not "all systems".**
`findAll`'s old SUT arm was `tr.system_under_test_id = … OR preset.testRunId IS NULL`, and the
save dialog defaulted to Global with no run id — so every global preset was every preset, and
they showed on every system. The owning system is now derived from the preset's **own first
series' `dashboardId`**, matched against `application_dashboards` for that SUT and
environment. Four details are load-bearing:

- **The subselect is uncorrelated on purpose.** As a correlated `EXISTS` it re-ran per preset
  row, and `application_dashboards` carries an RLS SELECT policy backed by a plpgsql function
  — so the function ran once per (preset x dashboard) pair. Uncorrelated, Postgres hashes it
  once.
- **Derived, not stored, so it survives the run being pruned.** `test_run_id` has no foreign
  key and a test-run delete leaves it dangling.
- **`ad.id` is compared as text** (`IN (SELECT ad.id::text …)`). A legacy row whose
  `dashboardId` is not a uuid would make a `::uuid` cast throw for the whole query instead of
  simply not matching.
- **A preset whose first series' dashboard was deleted drops off the list** while staying
  reachable by id. That is the accepted trade; the alternative is a stored column that
  nothing keeps in sync.

`workload` is deliberately **not** part of the scope any more, and the non-global arm is an
exact `preset.testRunId = :testRunId`. A "Test Run Specific" preset therefore appears on that
run only — it used to appear on every run of the same SUT, environment and workload, which is
not what the option said.

**2. Filtering `findAll` by organization does not close a tenant leak.** The bare
`GET /api/graph-presets` (no `testRunId`) returned every `is_global` preset in the database —
other tenants' preset names, descriptions, dashboard labels and metric names — because the
SUT block only runs when a run id is supplied. But the by-id routes were just as open:
`findOne` served any global preset to any tenant, and `update`/`remove` authorized on `userId`
alone. **There is no RLS backstop here**: `DB_ENABLE_RLS_ROLE` defaults to `'false'` and is
set in none of the shipped compose files.

The shape that fixes it, and the one to copy:

- Every route resolves `accessibleOrgIds` once via `withOrgFilter` (`null` = global admin) and
  passes it to the service. The controller's old `resolveIsAdmin` collapsed that to a boolean
  and threw the list away.
- `accessibleOrgIds` is a **required** parameter on `findAll`, not optional. As an optional
  one, a forgotten argument silently restores the cross-tenant behaviour with no type error
  and no log line.
- The by-id guard (`assertTenantAccess`) answers **404, not 403**, for a preset outside the
  caller's organizations. A 403 confirms the id exists, which is itself a cross-tenant
  disclosure.
- A non-admin with an empty org list returns `[]` early — `IN (:...orgs)` on an empty array is
  rendered `IN ()`, a syntax error rather than an empty result.
- **`create` authorizes the caller-supplied `testRunId` before inheriting its org.** Run ids
  are human-readable and routinely pasted into CI logs and chat; without the check, naming
  another tenant's run writes a preset into their organization, and `isGlobal: true` then puts
  attacker-chosen name, description and series into their list. It refuses with the same
  "Test run not found" message rather than confirming the run exists.

**`testRunId` is now required on create and absent from update.** `UpdateGraphPresetDto` is
`PartialType(OmitType(CreateGraphPresetDto, ['testRunId']))`, so a preset can never change
which system it belongs to and `organization_id`/`team_id` stay consistent with the run it was
created from. Re-scoping is a delete and a re-save. Two traps the new `PATCH /graph-presets/:id`
(v0.2.96.27) had to handle:

- **`PartialType` + class-validator's `@IsOptional()` skips `null` as well as `undefined`.**
  `{"name": null}` passes the pipe, and an apply block keyed on `!== undefined` writes NULL
  into a NOT NULL column — a 500 carrying raw Postgres text. `name`, `seriesConfig` and
  `isGlobal` reject an explicit null; `description` is nullable, so a null legitimately clears
  it.
- **`isGlobal: false` on a legacy preset with no `test_run_id` is refused.** `findAll`'s
  non-global arm is `preset.testRunId = :testRunId`, so narrowing such a preset matches no arm
  on any run: it vanishes from every list, and since `testRunId` is not updatable the user
  could never undo it through the API.

Client side, see "A graph preset's scope is a flag, not a missing `test_run_id`" in
[apps/web/CLAUDE.md](../web/CLAUDE.md) — in particular the rule that an upsert must match on
owner, because `findAll` legitimately returns other people's global presets.
