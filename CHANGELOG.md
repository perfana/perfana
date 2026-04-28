# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.2.47.6] - 2026-04-28

### Fixed
- **`RestoreRlsPoliciesPostTeamIdRemoval` migration failed on `url_patterns`** with `column "organization_id" does not exist`. The migration's `replacePolicies` helper hardcoded `organization_id, (created_by)::text` references on every policy expression, but `AddWorkloadToEvents` (1776148518354) had previously dropped both columns from `url_patterns` AND `generated_reports` — only `api_keys` retained them. Reworked `replacePolicies` to take per-operation SQL expressions explicitly. `api_keys` keeps the ownership-based 2-arg policies. `url_patterns` (deduplication cache, no per-row ownership) and `generated_reports` (lost ownership in AddWorkloadToEvents, pending Phase 4 restoration) both ship with permissive read/insert and admin-only update/delete: defense-in-depth without referencing columns that don't exist. Fix is forward-compatible: production envs that recorded the migration as completed (somehow) skip it; envs where it failed (the common case) re-run cleanly because every operation is `DROP POLICY IF EXISTS` + `CREATE POLICY` and `CREATE OR REPLACE FUNCTION` for the helpers.

## [0.2.47.5] - 2026-04-28

### Added
- **`@RequiresCapability` decorator + `CapabilityGuard` (RBAC Phase 3c foundation).** The decorator at `apps/api/src/common/decorators/requires-capability.decorator.ts` stores the required capability + an org-id source (`{ orgIdParam, orgIdFromBody, orgIdFromQuery }`) as Reflector metadata. The guard at `apps/api/src/common/guards/capability.guard.ts` reads the metadata, extracts userId + roles via `KeycloakEnhancedAuthGuard.getUserId/.getRoles` (auth-method-agnostic — works for both JWT and API key callers), resolves the org ID from the configured request source, calls `AuthorizationService.getCapabilities(userId, roles, orgId)`, and either grants the request or emits a structured WARN log (`Capability denied: capability=… userId=… orgId=… route=…`) and throws `ForbiddenException`. DB failures from `getCapabilities` deliberately bubble up as 500 — silent empty caps would let mutations through that should be denied. With this in place, controllers gating Bucket B sites (the 14 `if (!isGlobalAdmin) throw ForbiddenException` patterns the audit log enumerates) can now use `@RequiresCapability(Capability.X, { orgIdParam: '…' })` declaratively at the controller boundary instead of inlining the check inside the service.
- **CapabilityGuard integration test** at `apps/api/src/common/guards/capability.guard.integration.spec.ts` boots a minimal NestJS app, registers `CapabilityGuard` via `APP_GUARD`, and fires real HTTP requests through a test controller decorated with `@RequiresCapability`. Real Reflector, real metadata, real decorator, real guard, real Logger spy, real supertest. Only `AuthorizationService.getCapabilities` is mocked (its own coverage lives in the unit specs from Phase 3a). Closes the one outstanding gap from `/plan-eng-review`'s Failure modes section: the guard's full pipeline (metadata → extraction → authz → log → throw) is now end-to-end verified, not just unit-tested in isolation.

### Notes for migration
- Phase 3c per-service rollout begins after this PR. The migration recipe is in `docs-site/content/Architecture/Capabilities and RBAC.md`: Bucket A sites use `withOrgFilter`; Bucket B sites use the new `@RequiresCapability` decorator at the controller boundary; Bucket C sites consult the audit log case-by-case. The `local/no-direct-is-global-admin` lint rule still blocks new direct `isGlobalAdmin()` usage outside `INFRASTRUCTURE_FILES` and the grandfathered `apps/api/.rbac-migration-allowlist.json`.
- The audit log's "Migration progress" burndown table tracks Bucket A / Bucket B / local-wrapper progress. When a service file is migrated, remove its entry from the allowlist and update the burndown counts.
- Date-bound revisit gate is **2026-08-01**: if the burndown isn't ≥50% by then, the team explicitly re-evaluates.

## [0.2.47.4] - 2026-04-28

### Added
- **RBAC frontend pilot — closes the Dynatrace integration UX gap (RBAC Phase 3 frontend, FE.1 + FE.2 + FE.3).** New `usePermissions()` React Query hook (`apps/web/hooks/usePermissions.ts`) fetches `GET /api/users/me/permissions` once per session, caches with `staleTime: Infinity`, and exposes `can(action, ctx?)` with `resourcePermissions` precedence over capabilities. New `<RequiresPermission action orgId resourcePermissions disabledReason>` wrapper component (`apps/web/components/auth/RequiresPermission.tsx`) renders children disabled-with-tooltip when the capability check fails — the v1 ships a single render mode (the speculative hide / custom-fallback / render-prop modes were dropped per the eng-review YAGNI finding). The Configure and Delete buttons on every IntegrationCard (`apps/web/app/integrations/components/IntegrationCard.tsx`) are now wrapped: org-non-admins see disabled buttons with an "Org admin only" tooltip instead of clickable buttons that 403 on submit. **The original report — `test@perfana.io` (org-member + org-viewer) clicking Configure on a Dynatrace card and getting a silent 403 — is now closed at the UX level.** When the page-level data flow surfaces `instanceData._permissions` from the Phase 3b server hint, the wrapper picks up the per-row answer automatically (no further frontend changes needed); until then it falls back gracefully to capability-based decisions via `usePermissions().can()`. 19 new tests across the three components: 7 for `usePermissions` (3 baseline + 4 from the eng review covering resourcePermissions precedence, error-state, and org-switch React Query invalidation), 7 for `RequiresPermission`, 5 for `IntegrationCard` including the regression case for the original bug.

## [0.2.47.3] - 2026-04-28

### Added
- **Per-resource `_permissions` field on Dynatrace config responses (RBAC Phase 3b pilot).** `GET /api/dynatrace`, `GET /api/dynatrace/:id`, and `GET /api/dynatrace/host/:host` now include `_permissions: { update: boolean, delete: boolean }` on every returned config. The boolean is computed server-side from the requesting user's capability set for the config's organization (`integration:dynatrace:update` / `integration:dynatrace:delete`); legacy configs with `organization_id IS NULL` short-circuit to `update: true, delete: true` to match existing service-level behavior (the Phase-4 escape hatch closes when `organization_id` becomes NOT NULL). Capability lookups are batched per unique organization across the result set, so a `findAll` returning N configs across M unique orgs costs M Redis hits, not N. The frontend (Phase 3b consumer, FE.1/FE.2/FE.3) reads this field directly to gate Configure/Delete buttons without a round-trip to `/me/permissions`. Pilot scope: Dynatrace only — Grafana, Pyroscope, and Tracing integrations stay on the original pattern until they adopt incrementally.
- New `attachPermissions(resource | resources, permissionsMap)` serializer at `apps/api/src/common/serializers/with-permissions.serializer.ts`. Generic, supports single resource and array overloads, immutable input. Reused by every future endpoint that exposes per-row permissions.
- `_permissions` field added to `DynatraceConfigDto` with `@ApiPropertyOptional` Swagger decoration so the Swagger UI at `/api/docs` reflects the field on `GET /api/dynatrace` and `GET /api/dynatrace/:id` responses.

## [0.2.47.2] - 2026-04-28

### Added
- **Capabilities API foundation (RBAC Phase 3a).** New `Capability` enum (~30 typed string literals), `CapabilitiesService` (pure mapping from `(systemRoles, orgRoles, teamRoles)` to capability set), `AuthorizationService.getCapabilities(userId, roles, orgId, teamId?)`, and `GET /api/users/me/permissions` endpoint returning `{ userId, global: string[], byOrg: Record<orgId, string[]> }`. Capabilities are computed per `(userId, organizationId, teamId)`, cached in Redis with a versioned-key strategy (`auth:capabilities:{userId}:{orgId}:{teamId}:v{version}` plus a per-user `auth:capabilities-version:{userId}` counter), and invalidated via `INCR` on the version counter when membership changes. The versioned strategy avoids `redis.keys()` scans entirely — every prior cached entry becomes unreachable in O(1) on invalidation, then expires via TTL. Cold-path role loads are parallelized via `Promise.all` so `/me/permissions` p99 stays at one round-trip's latency regardless of org count. Auth-method-agnostic by construction: JWT (`request.user.roles` from Keycloak `realm_access` + client roles) and API key (`request.apiKey.roles`) callers flow through the same `getRoles()` unification and the same capability mapping. Closes the foundation requirement of CLAUDE.md's RBAC Phase 3.
- **RBAC migration tooling.** Custom ESLint rule `local/no-direct-is-global-admin` blocks new direct `authzService.isGlobalAdmin()` usage outside the AuthorizationService and a permanent `INFRASTRUCTURE_FILES` exemption set (which covers `authorization.service.ts`, `authorized-base.service.ts`, `with-org-filter.ts`, and `capability.guard.ts` — the helpers that legitimately encapsulate the admin-bypass check). A grandfathered `apps/api/.rbac-migration-allowlist.json` (40 files at ship time) tolerates existing sites; removing a file from the allowlist is the trigger for migrating its sites to the capabilities API. The audit log at `docs/superpowers/audits/2026-04-26-audit-decisions.md` now has a "Migration progress" burndown table; allowlist size IS the burndown. `CONTRIBUTING.md` documents the adjacent-migration rule (when you touch an allowlisted file, migrate its sites in the same PR). A drift-check `/schedule` agent at `docs/superpowers/scheduled-agents/rbac-drift-check.md` catches new sites the lint rule missed (e.g., from merge conflicts or new dependencies). The plan's date-bound revisit gate is **2026-08-01**: if the burndown isn't ≥50% migrated by then, the team explicitly re-evaluates the architecture or the priorities — preventing silent stalling.
- **Engineer-facing docs.** `docs-site/content/Architecture/Capabilities and RBAC.md` covers the two-surface authorization model (capabilities answer "can I do action X in scope Y?" — used for menu/button gating, route guards, and pre-fetch decisions; resource ACL `canAccessResource`/`canModifyResource` answer "can this user touch this specific row?" — used inside services after a resource is loaded), the current role-→-capability mapping (system, organization, team), how to add a new role or capability, and the Bucket A/B/C migration recipe. The lint rule's deprecation message now points at this page so blocked developers get a real how-to instead of an audit-log link.

### Changed
- `CLAUDE.md` "RBAC Implementation Status" table: Phase 3 row updated to "In progress (foundation shipped 2026-04-28; per-service rollout tracked in `docs/superpowers/audits/2026-04-26-audit-decisions.md` — burndown 0% / target 50% by 2026-08-01)".

## [0.2.47.1] - 2026-04-26

### Changed
- Pilot of a `withOrgFilter(userId, roles, authzService)` helper for the recurring "if global admin, return everything; else filter by accessible org IDs" pattern (`apps/api/src/common/utils/with-org-filter.ts`). Migrates one method — `DynatraceService.findAll` — as proof-of-pattern; the other Bucket A sites enumerated by the 2026-04-26 codebase audit (`docs/superpowers/audits/2026-04-26-audit-decisions.md`) stay on the original inline pattern and can adopt incrementally per-service. The audit's site re-verification on `dynatrace.service.ts` found 1 truly-canonical bypass-filter site of the 25 originally flagged; the other 24 were debug-log captures or per-resource guards left untouched. No behaviour change — debug logs preserve their `isGlobalAdmin=true/false` semantics by deriving the boolean from `orgIds === null`. Tests: 3 new helper tests cover admin/non-admin/empty-membership cases; full `apps/api` suite (4256 tests) green; type-check and lint clean.

## [0.2.47.0] - 2026-04-24

### Added
- Scenario filter above the Performance Analysis card tabs, styled to match the Grafana Dashboards tag filter. Select one or more scenarios to scope every tab (Overview, Top 10 Transactions, Top 10 Requests, Top 10 URLs, Error Analysis) to just those scenarios; empty selection is a no-op and shows everything. Chips are derived from the loaded transactions, so only scenarios that actually exist in this run appear. A "No Scenario" chip is rendered only when the run contains rows with null/empty `scenario_name`. On the Overview tab, filtering recomputes the `Overall Test Metrics` panel (weighted avg/p95/p99 response time, apdex, error rate, peak throughput, peak virtual users) from the filtered transactions and from the matching `by_scenario` entries on throughput/VU stats, so the "overall" aggregates reflect only the selected scenarios. Top 10 tabs filter samplers/transactions before aggregation into dimensions, so rankings (slowest, highest throughput, highest impact, highest error rate) recompute against the filtered pool. For Error Analysis, the five `/api/test-runs/:id/error-analysis/{summary,by-code,by-transaction,over-time,over-time-by-code}` endpoints accept an optional `scenarios` query parameter (comma-separated scenario names; the sentinel `__NO_SCENARIO__` matches `scenario_name IS NULL`) and the service applies `AND (scenario_name = ANY($list) OR scenario_name IS NULL)` to `requests_error` — and the corresponding `requests_raw` count used for the overall error rate — when the parameter is present. The frontend hook refetches when the selection changes; the details endpoint is unchanged (still keyed by transaction/sampler/url).

## [0.2.46.0] - 2026-04-24

### Added
- TimescaleDB continuous aggregates (CAGGs) over the three high-volume request hypertables: `requests_raw_{5s,1m,5m}`, `transactions_{5s,1m,5m}`, and `requests_error_{5s,1m,5m}` (migration `1777500000000-AddContinuousAggregates`). The `1m` view is hierarchical — materialized from `5s` — and `5m` is materialized from `1m`; associative aggregates (count, sum, weighted avg via `sum(x*n)/NULLIF(sum(n),0)`, min, max, and `rollup(percentile_agg)` for tdigest percentiles) make this safe. Grafana panels resolve a `cagg_suffix` template variable from `${__interval_ms}` (5s when `<= 15000`, 1m when `<= 300000`, else 5m) and query `FROM <table>_${cagg_suffix}`, cutting p50 panel latency from ~4 s (raw scan of ~12 M index entries on a 30-minute window) to under 200 ms (direct lookup on pre-bucketed rows). Each CAGG gets a refresh policy (30 s cadence on 5s, 1 min on 1m, 5 min on 5m; 1-minute `end_offset` keeps jobs out of the current chunk's write path) and a 90-day retention policy — intentionally longer than any retention on raw so long-term trend panels survive raw-data pruning. Aggregate columns were chosen from the actual panel queries: `n, n_ok, n_err, avg_rt, min_rt, max_rt, pct_agg` plus per-table extras (`avg_connect, avg_latency, bytes_in, bytes_out, avg_response_size` on `requests_raw`; `n` only on `requests_error`, which stores per-error-row data that CAGGs can't represent). The migration is idempotent (`CREATE MATERIALIZED VIEW IF NOT EXISTS` plus `if_not_exists => TRUE` on policies) and reversible (`down()` drops views in reverse hierarchy order with `CASCADE`, which also removes the associated policies). Verified under both TypeORM `migrationsTransactionMode: 'all'` (CLI) and `'each'` (production `run-migrations.ts`) — TimescaleDB 2.26.3 accepts CAGG DDL inside a transaction block, so no `transaction = false` opt-out is needed. Dashboard JSON rewrites for `template-timescaledb-jmeter`, `template-timescaledb-transaction-analysis`, and `template-timescaledb-request-analysis` ship as a companion change in the `perfana-demo` repo on branch `perfana-next-gen`. Live "now" stat panels (queries filtering `time > now() - interval '<60 seconds>'`), row-level detail panels (e.g. error-message lookup by `random_id`), and success-filtered single-number stats on the per-sampler/per-transaction drill-down dashboards stay on raw hypertables — the CAGG doesn't distinguish success from failure for response-time aggregates, and the composite index from #137 keeps those narrowly-scoped queries responsive. See `docs-site/content/Database/Continuous Aggregates.md` for the full decision record, including the aggregate-column choices, refresh-lag expectation (~60 s), and known semantic shifts on time-series response-time panels. Closes #147.

## [0.2.45.0] - 2026-04-24

### Added
- Space-partition dimension `by_hash('system_under_test', 4)` added to the `requests_raw`, `requests_error`, and `transactions` hypertables (migration `1777300000000-AddSpaceDimensionToRequestHypertables`). Scope is new-chunk behavior only — existing chunks keep their single-partition layout, so the practical win lands as traffic rolls forward and new chunks are created. The benefit is strongest on deployments with several concurrently-active SUTs: the planner can prune non-matching hash buckets on SUT-filtered queries before touching chunk data, and per-chunk decompression on aggregation queries is scoped to a single hash bucket instead of mixing rows from every SUT in the chunk. Operators wanting retroactive partitioning on existing chunks must follow the documented offline rebuild procedure (`docs-site/content/Operations/Hypertable Space Rebuild.md`); most installs can ignore the rebuild and still pick up the benefit over time. The partition count defaults to 4 and is overridable at migration time via `HYPERTABLE_SPACE_PARTITIONS` (range 1–64); adjust later with `set_number_partitions()` rather than re-running the migration. Idempotent via `if_not_exists => TRUE` plus an explicit check against `timescaledb_information.dimensions`; each table is wrapped in a savepoint so an older-TimescaleDB-version rejection on one table (e.g. compressed-chunk edge cases) doesn't abort the rest of the migration. Compression settings (segmentby `test_run_id, transaction_name`) are unaffected — space partitioning sits at chunk-boundary level and is orthogonal to per-chunk columnar layout. Closes #145.

## [0.2.44.0] - 2026-04-24

### Added
- Sortable column headers in the Anomaly Detection results table. Click Dashboard, Panel, Metric, Classification, Conclusion, Test Value, Control Group, or Difference to sort ascending; click again to reverse. Unsorted columns show a neutral indicator; the active column shows an up/down arrow. The Difference column has an extra **Abs / %** toggle so you can sort on either the raw difference or the percentage change relative to the control group (`(diff / control) * 100`). Sorting runs before pagination so page 1 always shows the top of the sort; changing sort or mode resets to page 1. Rows with missing values or a zero control group sort to the end regardless of direction. Headers are keyboard-accessible (Enter/Space), focus-visible, and carry tooltip hints.

## [0.2.43.1] - 2026-04-24

### Changed
- Per-table autovacuum tuning for `url_patterns` (migration `1777200000000-TuneAutovacuumForUrlPatterns`). Sets `autovacuum_vacuum_scale_factor=0.05`, `autovacuum_analyze_scale_factor=0.05`, and `autovacuum_vacuum_cost_limit=1000` so the table is vacuumed/analyzed sooner on smaller batches and each batch drains faster. Under global defaults (cost limit 200), a `VACUUM ANALYZE url_patterns` (~2.9 GB on busy tenants) ran long enough to overlap with autovacuum on `requests_raw` chunks, saturating disk I/O and blocking foreground dashboard queries on `IO:DataFileRead`. Shrinking the contention window avoids the storm without touching global defaults or any other table. Closes #142.

## [0.2.43.0] - 2026-04-23

### Fixed
- Creating an API key with a description that already exists no longer surfaces as an opaque 500 from the GlobalExceptionFilter (`QueryFailedError: api_keys_description_key`). New migration `1777100000000-ApiKeyDescriptionUniquePerOrg` replaces the global `UNIQUE(description)` constraint on `api_keys` with a composite `UNIQUE(organization_id, description)` so common names like `CI`, `Jenkins`, or `Grafana sync` can be reused across organizations. `ApiKeysService.createApiKey` now pre-checks for an existing key in the target organization and throws `ConflictException` (HTTP 409) with the message `An API key with description "X" already exists in this organization.`; the rare concurrent-create race that still hits the unique index is translated to the same 409 from the catch block, and `isUniqueDescriptionViolation` checks both the top-level and `driverError`-wrapped pg fields so the translation never falls through to a 500 on alternative TypeORM driver shapes. Frontend `useApiKeys` routes the 409 to the description field (`form.setError('description', ...)`) instead of the generic root alert, so the user sees exactly which field to fix. Closes #117.
- `ApiKeysService.validateApiKey` no longer rejects legitimate API keys when two organizations share a description. The previous flow cached keys by description alone and the DB fallback used `.find()` to pick the first matching row — both assumed globally-unique descriptions, which the per-org migration above invalidates. The lookup now treats the cached key as a hint (bcrypt-verified, with fall-through to DB on mismatch), and the DB fallback scans every same-description candidate with bcrypt, skipping expired rows. Without this, the per-org uniqueness change would have caused intermittent 401s on validate calls. The DTO `organizationId` field is also now `@IsUUID()` instead of `@IsString()` so non-UUID input is rejected at the validation layer rather than producing a confusing 500 from the pg type cast. Three new regression tests cover the cross-org collision and the `driverError` race translation; two pre-existing validateApiKey tests were updated to mock the DB fallback path that the new code now reaches.

## [0.2.42.0] - 2026-04-23

### Added
- Composite `(system_under_test, test_environment, scenario_name, time DESC)` indexes on the `requests_error`, `requests_raw`, and `transactions` hypertables (migration `1777000000000-AddCompositeSutEnvScenIndexes`). Grafana panels filter these tables by `system_under_test`, `test_environment`, and `scenario_name` over a bounded time window; without a matching composite, the planner fell back to a parallel index-scan on `time` followed by a row-by-row filter — measured at ~57 s to return zero rows against a 30-minute window of a ~10 M-row weekly chunk when the scenario didn't match. The indexes were applied manually on `performance-praegus` on 2026-04-19 to relieve live pain; this migration formalizes them so fresh installs and other environments get them automatically. Idempotent (`CREATE INDEX IF NOT EXISTS`); storage footprint is ~300 MB per hypertable at current production size. The original plan called for `WITH (timescaledb.transaction_per_chunk)` to keep writes flowing on other chunks during the build, but TimescaleDB rejects that option inside a transaction block and TypeORM wraps all migrations in one, so it's documented as a manual step for large pre-existing environments while production remains unaffected (indexes already in place). Closes #137.

## [0.2.41.2] - 2026-04-22

### Fixed
- Anomaly-detection trends plots and compare-runs charts no longer throw `ReferenceError: adjustedYAxesFormat is not defined` when the plotted unit triggers automatic conversion (seconds with all values under 1, or milliseconds with all values over 1000). Regression from the PR #130 lint cleanup, which prefixed the `adjustedYAxesFormat` `let` declaration with `_` but left the reassignments unprefixed — ReferenceError in strict mode. Variable was dead code (never read anywhere), so removed entirely in `trends-plot-utils.ts` and `ComparisonPlot.tsx` rather than renamed back.

## [0.2.41.1] - 2026-04-22

### Fixed
- JTL upload (and every other `INSERT … ON CONFLICT (test_run_id, key, tags_hash(tags))` upsert in `TestRunsConfigService`) no longer fails with PostgreSQL SQLSTATE 42P10 ("there is no unique or exclusion constraint matching the ON CONFLICT specification"). New migration `1776900000000-RestoreTestRunConfigsTagsHashUniqueIndex` restores the functional unique index on `test_run_configs (test_run_id, key, tags_hash(tags))` that `AddWorkloadToEvents1776148518354.up()` dropped without recreating — TypeORM's auto-generator can't represent expression-based indexes, so it silently removed it. Same migration also restores the companion `idx_dynatrace_entity_mappings_unique` on `(system_under_test_id, COALESCE(test_environment,''), COALESCE(workload,''), entity_id)` — no live `ON CONFLICT` depends on it today, but losing it removed the data-integrity guarantee against duplicate dynatrace entity mappings per SUT/env/workload. Both blocks are idempotent (`CREATE OR REPLACE` / `IF NOT EXISTS`); the dynatrace block fails loudly with the offending duplicate count if any exist. Closes the audit hole left by `AddMissingUniqueConstraints` (#125), `AddDsUniqueIndexesForUpserts` (#132), and `RequireNonNullSourceIdOnCollectionStatus` — those caught the plain-column uniques the same auto-gen pattern dropped; this one catches the two functional indexes.

## [0.2.41.0] - 2026-04-20

### Added
- Per-test-run pre-computed stats rollup. Two new tables, `test_run_transaction_stats` and `test_run_sampler_stats`, hold transaction- and sampler-level aggregates (counts, tdigest, impact score) for completed runs. Rows are keyed on `(test_run_id, transaction_name, [sampler_name,] scenario_name, ramp_up_excluded)` so both full-run and ramp-up-excluded variants are available. p95/p99 and Apdex are computed at read time via `approx_percentile` / `approx_percentile_rank` on the stored tdigest against the *current* threshold, so editing `workload_apdex_thresholds` takes effect immediately with no recompute.
- New `transaction-stats-rollup` stage in the `analyze-test` pipeline (runs after `performance-test-metrics`). Single-scan `FILTER` + `UNION ALL` computes both variants per group. The stage is soft-fail: if rollup times out or errors, ADAPT / statistics / checks continue and the dashboard falls back to live aggregation. DELETE-before-INSERT guarantees the rollup always reflects current raw data — no stale rows after ramp-up edits or raw-row changes. Statement timeout raised to 10 minutes for the initial population on large runs (the live query it replaces was measured at 135–213s).
- Backfill script `apps/worker/scripts/backfill-test-run-stats-rollup.ts`. Resumable, batched, rate-limited. Enqueues the same pipeline as the finalization stage so there is one canonical code path. Supports `--dry-run`.

### Changed
- `TestRunsPerformanceQueryService.getTransactionStats` and `getTransactionSamples` now read from the rollup when it exists, falling back to live aggregation for in-progress runs, un-backfilled runs, or `sinceMinutes` windows. No DTO change. Measured impact: the 140s `stream_download_segment` sampler query (issue #151, 11.35M rows in `requests_raw`) becomes a single rollup-row read. The Top 10 Transactions tab, Top 10 Requests tab, and Overview-row expand (all three defaulting to `excludeRampUp=true`) now serve from the rollup on completed runs.
- Editing `analysisStartOffset` on a completed run re-enqueues the rollup job with a deterministic `jobId`, so rapid successive edits coalesce into a single pending job. The pipeline re-reads the current `analysisStartOffset` at execute time, so last-write-wins is correct regardless of processing order.
- Test-run deletion now cleans up the rollup tables alongside `ds_*` and hypertables.

## [0.2.40.0] - 2026-04-19

### Fixed
- Performance-test runs no longer flip to `valid = false` with `"Data collection coverage … / failed collection ranges"` after a baseline test. Two compounding issues were causing every overlapping incremental tick of the same `test_run_id` to crash on `duplicate key value violates unique constraint "uniq_ds_metric_statistics"` (the index restored in #132): `PerformanceTestMetricsPipeline.computeAndSaveStatistics` did `DELETE` then plain `INSERT` (slow under load — a 97-second DELETE was observed in #134 — leaving a wide window for the next scheduler tick to start before the first finished), and `IncrementalCollectionScheduler` ticks for the same run were not mutually exclusive. The DELETE+INSERT is now a single `INSERT … ON CONFLICT (test_run_id, application_dashboard_id, panel_id, metric_name) DO UPDATE SET …` (idempotent, atomic, no inter-statement window), and `collectPerformanceTestMetrics` now acquires a per-`test_run_id` Redis lock (`job:lock:perf-test-metrics:<id>`, 15-minute TTL); a tick that finds the lock held returns success-with-zero-data-points so the next tick retries the same window. Affected runs now reach `valid = true` on a clean stack (#134).

### Changed
- Intra-batch metric grouping in `computeAndSaveStatistics` now truncates `metric_name` to 255 characters when forming the group key so it matches what is persisted. Previously, two metrics whose first 255 characters were identical produced two stat records that collided on the persisted unique key, which under the new upsert form would have raised Postgres's `cardinality_violation` ("ON CONFLICT DO UPDATE command cannot affect row a second time").

## [0.2.39.0] - 2026-04-19

### Fixed
- Analyze pipeline no longer aborts on SQLSTATE 42P10 (`INSERT … ON CONFLICT` without matching unique index). A new migration (`1776600000000-AddDsUniqueIndexesForUpserts`) restores the nine `ds_*` unique indexes that `AddWorkloadToEvents1776148518354.up()` dropped without recreating — covering `ds_metrics`, `ds_compare_config` (panel + metric partials), `ds_control_groups`, `ds_metric_statistics`, `ds_control_group_statistics`, `ds_adapt_results`, `ds_adapt_conclusion`, and `ds_adapt_tracked_results`. Checks, ADAPT, and stats now populate on baseline runs (#132).
- `IncrementalMetricsPipeline.execute` now propagates per-collector failures as a pipeline-level error (`INCREMENTAL_COLLECTOR_FAILED`) instead of hiding them behind an overall `success: true`. Before, a collector that caught an upsert failure internally (e.g. the 42P10 above) still let `ds_metric_collection_status` get marked `is_complete=true, total_data_points=0` — so reanalyze saw no gap and left `ds_metrics` empty forever. Affected runs now re-collect from scratch on the next analyze.

## [0.2.38.0] - 2026-04-18

### Fixed
- `config-hash.ts`: volatile field exclusion was broken by the lint cleanup pass, which prefixed `last_modified_at` and `config_hash` with underscores (ESLint unused-vars) while the actual config object uses the non-prefixed names. Hashes now correctly exclude these fields so config comparisons ignore timestamp and hash metadata.
- Anomaly detection, AWR insights, `useSystemData`: kept `as any` casts where `as unknown` (introduced by an overlapping lint pass) would prevent TypeScript from accessing properties directly — `unknown` requires explicit type narrowing before property access.

## [0.2.37.0] - 2026-04-18

### Fixed
- `POST /api/config/json`: no longer returns 404 when the test run doesn't exist yet. Configs are now stored with a string-based test run ID and associated once the test run is created — consistent with the behavior of `POST /config/key` and `POST /config/keys`. This fixes a timing window where CI/CD pipelines sending config before the test run record is written received a 404.
- Worker: resolved 92 TypeScript type errors introduced during the `any` cleanup refactor. Casts are now scoped to point-of-access rather than widening entire function signatures.
- Swagger: removed stale 404 response from `POST /config/json` — that status code is no longer returned by the endpoint.

## [0.2.36.2] - 2026-04-14

### Fixed
- `AddWorkloadToEvents` migration: drop RLS policies on `url_patterns` and `generated_reports` before removing ownership columns. PostgreSQL refuses non-CASCADE column drops when policies depend on the column (SQLSTATE 2BP01), causing the migration to fail on a fresh database.
- `chart-utils.test.ts`: update `calculateRampUpEndIndex` tests to use `analysis_start_offset` (renamed from `ramp_up` in 0.2.36.0), and update `buildChartConfig` height assertion from 500 to 600.
- `TestRunDetailsCard.test.tsx`: update mock test run to use `analysis_start_offset` instead of `ramp_up`, fixing two failing duration-formatting tests.
- `slo-renderer.ts`: `let` → `const` for `checkResults` (no reassignment).

## [0.2.36.1] - 2026-04-14

### Fixed
- `alert-tag-filters.service.ts`: wrong property name `testType` used when creating alert tag filter entities (should be `workload` after the rename in 0.2.36.0).
- `test-run-config.dto.ts`: unused `ApiPropertyOptional` import causing TypeScript build error.
- `test-runs.controller.spec.ts` / `test-runs.service.spec.ts`: `updateAdaptConfig` test assertions had wrong argument order and were missing the `mode` parameter, causing test failures after the API was extended.
- `jest.config.js`: `phase5-migration-validation.test.ts` (a DB integration test requiring a live database) was being picked up by the unit test runner, causing spurious failures in CI.

## [0.2.36.0] - 2026-04-12

### Added
- **Full report rendering pipeline with real data.** All seven report section renderers now fetch live data instead of returning stubs or mock values:
  - **SLO renderer** queries `check_results` and renders a pass/fail table with per-metric requirement vs actual values.
  - **Regressions renderer** fetches ADAPT results and renders a sorted table of regressions and improvements with conclusion icons.
  - **AWR renderer** reads parsed AWR reports and analysis insights from `awr_reports` / `awr_analysis` and renders a severity-grouped summary.
  - **Trends renderer** queries historical test runs with the same system/environment/workload and renders a sparkline-style progression table.
  - **Comparisons renderer** fetches `ds_adapt_results` and renders a side-by-side metric comparison with difference percentages.
  - **Graphs renderer** reads time-series data from `ds_metrics` and renders inline SVG charts for each panel.
  - **Header renderer** now shows real SLO pass/fail counts and regression detection status instead of placeholder badges.
- **`ReportDataFetcherService`** gains nine new methods: `getSloCheckResults`, `getSloSummary`, `getRegressionsData`, `getAnomalySummary`, `getAwrData`, `getComparisonsData`, `getTrendsData`, `getMetricsTimeSeries`, and `getAvailableMetricsPanels`. All support `userId` / `roles` parameters for org-level access filtering.
- **`getTrendsData`** and **`getMetricsTimeSeries`** auto-discover available panels from `ds_metrics` when no explicit panel selector is provided.

### Fixed
- `getTrendsData` clamps the `maxRuns` parameter to a validated integer (1–50) before interpolating into SQL, preventing runaway queries from uncapped values.

## [0.2.35.0] - 2026-04-11

### Fixed
- The `perfana-api` Docker image no longer fails with `Cannot find module 'axios'` on startup. The root cause was that npm's hoisting algorithm placed axios in `apps/api/node_modules/` instead of the root `node_modules/`, making it unreachable by `@nestjs/axios` at runtime. Adding axios as a root-level dependency forces correct hoisting. Workers, grafana-sync, and perfana-report retain their own nested `node_modules` COPY lines since they have other production packages that still require separate handling.

## [0.2.34.0] - 2026-04-09

### Added
- `POST /api/systems-under-test` lets you fully provision a System Under Test before the first load test run. Pass `name`, `organizationId`, and an optional `environments` array (each with `workloads`) to create the SUT, test environments, and workloads in a single atomic request. All subsequent configuration endpoints — ADAPT settings, tracing, Pyroscope, Dynatrace mappings — work immediately after. Re-sending the same `name` + `organizationId` is safe: returns the existing SUT with a 409 status so CI/CD scripts can call it idempotently.

## [0.2.33.1] - 2026-04-09

### Fixed
- The ADAPT Settings tab is now always visible in the system under test configuration page. When all integrations are active (Dynatrace, Distributed Tracing, Pyroscope), the 9 tabs overflowed the tab bar on smaller screens, clipping the last tab. The tab bar now scrolls horizontally with auto-shown scroll buttons.

## [0.2.33.0] - 2026-04-09

### Fixed
- `GET /api/test-runs/:id/connected-sources` now correctly returns `dynatrace.available: true` when Dynatrace is configured for a system under test. Previously, the endpoint always returned `false` because `DynatraceQuery.metricsSourceId` was never populated during query creation, leaving `ds_metrics.metrics_source_id` always NULL. Dynatrace queries now automatically upsert a `MetricsSource` row keyed by SUT, environment, workload, and config ID when created.
- Concurrent Dynatrace query creation no longer throws unique constraint violations: `ensureMetricsSourceExists` now uses a proper upsert (ON CONFLICT DO NOTHING) instead of a find-then-insert pattern.
- `GET /api/test-runs/:id/connected-sources` Dynatrace config lookup changed from N individual queries to a single `WHERE id IN (...)` batch query, eliminating an N+1 pattern.
- Bulk Dynatrace query creation now validates that all DTOs share the same config/SUT/environment/workload, preventing silent data mis-attribution on mixed-batch calls.

### Changed
- WireMock Dynatrace mock mappings (saas and managed): split the ambiguous `/api/v2/entities.*` pattern into separate exact-match list endpoint and regex single-entity endpoint, preventing incorrect response shapes for `fetchHostProperties` calls.
- Dynatrace mock entity lists now include SERVICE entities (afterburner-be, afterburner-fe) in addition to HOST entities.
- Added missing managed Dynatrace mock mappings: problems, request-attributes, entities-by-id.

## [0.2.32.3] - 2026-04-05

### Removed
- One-off debug and test scripts committed to app roots (debug-token.ts, test-preset-api.sh, monitor-db-connections.sh, monitor-pool.js, test-blocking.cjs, test-job-add.cjs, test-simple-job.cjs)

## [0.2.32.2] - 2026-04-05

### Removed
- 46 stale AI-generated report and summary markdown files across api, grafana-sync, web, worker, and docs

## [0.2.32.1] - 2026-04-05

### Fixed
- Changepoint flag now visible in test run list for BASELINE mode runs (previously hidden by mutually exclusive rendering)

## [0.2.32.0] - 2026-04-05

### Fixed
- SCALING mode test runs now correctly included in control groups after BASELINE mode rename (data migration converts existing SCALING runs)
- Data sanity check no longer falsely flags changepoint runs as missing ADAPT results

### Changed
- ControlGroupsPipeline accepts both BASELINE and SCALING modes for backward compatibility during migration rollout

## [0.2.31.0] - 2026-04-04

### Fixed
- Scaling session creation no longer fails with "User must belong to an organization" for Keycloak JWT users

### Added
- Link SLOs to scaling sessions when starting a session to define success criteria at each load level
- Scaling progression card redesigned as a selectable run list: test run ID (hover shows version + annotations), date, SLO summary, and editable comment per run
- Selecting a run shows its linked SLO results in a table matching the SLO card pattern (dashboard, metric, requirement, pass/fail)
- Anomaly detection TLDR section with SoftBadge chips per selected run, clicking deeplinks to anomaly card (new tab for different runs)
- Per-run comments stored on scaling sessions with inline editing

### Changed
- Scaling progression now uses check_results for SLO data instead of hardcoded ds_metric_statistics panels

### Removed
- Standalone scaling sessions page and sidebar link (scaling lives inside test run details)
- ADAPT conclusion from scaling progression (not meaningful in scaling context)

## [0.2.29.0] - 2026-04-04

### Fixed
- Chart PNG export now includes background, title, axes, gridlines, and legend (was transparent/invisible in dark mode, missing in light mode)
- SLO row hover no longer turns black in light mode (MUI alpha() was replacing alpha channel instead of multiplying)

## [0.2.28.0] - 2026-04-04

### Added
- Scaling sessions: group related scaling test runs with shared baseline and progression tracking
- `scaling_sessions` table with CRUD API (POST/GET/PUT /scaling-sessions)
- Progression endpoint (GET /scaling-sessions/:id/progression) returning metrics, ADAPT conclusions, and load config across all runs in a session
- Test runs with `scalingSessionId` auto-get SCALING mode and session baseline; first run auto-sets as baseline
- Scaling Progression card on test run detail page with recharts line chart, metric selector, and run status chips
- ADAPT Settings tab on system configuration page to toggle Regression/Scaling mode per workload

## [0.2.27.0] - 2026-04-04

### Added
- ADAPT SCALING mode for sizing/scaling tests: compare against a single baseline run instead of last 10 successful runs
- `adaptMode` and `baselineTestRunId` fields on POST /test for programmatic SCALING mode activation
- Workload-level ADAPT settings (GET/PUT /test-runs/workload-adapt-settings) so SCALING mode applies automatically to all new runs without plugin changes
- GET /metrics/ds-metrics/panels-by-dashboard endpoint for querying panels from ds_metric_statistics by application dashboard ID
- 7 new unit tests for SCALING mode control group selection

### Fixed
- Panel dropdown empty when selecting "Performance test metrics" dashboards in graphs, trends, and compare cards (was hitting wrong Grafana endpoint)
- Same panel dropdown bug in Add SLO and Edit SLO dialogs (fetchPerfMetricsPanels now queries ds_metric_statistics instead of Grafana)

## [0.2.26.0] - 2026-04-04

### Removed
- 37 unused source files: dead interceptors, services, DTOs, barrel exports, config files, and scripts (-7,794 lines)
- 28 unused dependencies across 7 package.json files (-106 packages from node_modules)

### Fixed
- Add missing `date-fns` dependency to web package (was only resolved via hoisting)

## [0.2.25.0] - 2026-04-04

### Added
- ~1,537 new unit tests across API, Worker, and Web packages (7,419 → 9,558 total)
- API test coverage: 45% → 53% statements, 69% → 73% branches, 57% → 61% functions
- Worker test coverage: 34% → 48% statements, 82% → 85% branches, 49% → 62% functions
- Web test coverage: 41% → 44% statements, 73% → 75% branches, 39% → 43% functions
- New test suites for: ApdexCalculator, RequirementChecker, PipelineOrchestrator, IncrementalCollectionScheduler, WorkerDatabaseService, PerformanceTestMetricsPipeline, test-runs-crud-query, data-science controller, report-data-fetcher, jtl-import, error-analysis, anomaly detection, Tempo service, deep-links, compare-presets, grafana-client, application-dashboards, grafana-dashboards, performance-query, report-html-compiler, useReports, useTemplates, usePyroscopeData, chart-utils, JobProgressIndicator

## [0.2.24.0] - 2026-04-04

### Fixed
- Fix 4 failing web tests (DashboardsSection and ServiceLevelObjectivesSection) where test assertions were out of sync with actual `authenticatedFetch` call signatures
- Fix broken web linter: update eslint-config-next from v14 to v15, replace deprecated `next lint` with direct ESLint CLI
- Fix 2 pre-existing grafana-sync lint errors (unused GrafanaInstance import and unused variable)

### Changed
- Eliminate all 289 API ESLint warnings (274 `no-explicit-any`, 7 `ban-types`, 5 `no-empty-function`, 2 `no-prototype-builtins`, 1 `no-var-requires`) with proper TypeScript types across 88 files
- Add knip dead code detection tool with workspace-aware configuration

### Added
- `knip.json` workspace configuration for dead code detection across all packages
- `npm run knip` script for running dead code analysis

## [0.2.23.1] - 2026-04-03

### Fixed
- Add ENCRYPTION_KEY validation to grafana-sync startup (prevents silent runtime crash on encrypted credentials)
- Align CORS env var: rename CORS_ORIGIN to CORS_ALLOWED_ORIGINS to match what main.ts actually reads
- Add FRONTEND_URL to API env validation schema
- Add AUTO_CONFIG_ENABLED with boolean coercion to grafana-sync validation schema
- Move class-transformer from devDependencies to dependencies in API (required at runtime by ValidationPipe)
- Align BullMQ to v5 across API and worker (was v4 in worker, causing potential job serialization mismatches)
- Fix reflect-metadata version skew in grafana-sync (0.2.x to 0.1.x to match all other packages)

### Changed
- Rename default database from `perfana_native` to `perfana` across all configs, docker-compose, and env examples
- Align DB_NAME in all .env.example files to match docker-compose POSTGRES_DB value

### Removed
- 7 unused dependencies from grafana-sync: mysql, moment, bluebird, async, semver, jsonpath-plus, lodash

## [0.2.23] - 2026-04-03

### Fixed
- Fix memory leak in job polling (monitorJobAndRefresh) that continued API calls after page navigation
- Remove Math.random() from ComparisonStatus that showed non-deterministic data to users
- Fix URL sync loop in test runs filters that could cause redundant router.replace calls
- Remove double-fetch in 4 integration hooks that duplicated the page-level data load
- Remove unused searchParams dependency in systems page that caused spurious refetches

### Changed
- Memoize AuthContext and SidebarContext provider values to prevent unnecessary re-renders across the app
- Wrap 6 derived computations in useAnomalyDetection with useMemo (filter, paginate, dropdown options)
- Replace searchParams object dependencies with primitive string extractions in useTestRunData and useRelatedTestRuns
- Remove redundant useMemo with JSON.stringify in useTestRunData (upstream equality check already prevents re-renders)

## [0.2.22] - 2026-04-03

### Fixed
- Add accessible labels and tooltips to icon-only delete buttons in profile dashboard forms and alert filters
- Wire showToast through TrackedRegressionsView so batch re-evaluation and ADAPT config updates produce user-visible feedback instead of silent no-ops
- Wrap disabled IconButtons in `<span>` for MUI Tooltip compatibility

### Removed
- 107 lines of debug `console.log` statements across 11 components (SectionConfigs, JobProgressBanner, ActionsMenu, PyroscopeSection, and others)
- Unused `components/members/` directory (4 files, 766 lines) superseded by `components/organizations/`
- Unused `OrganizationSwitcher.tsx` (178 lines) superseded by `OrganizationSelector`
- Placeholder `onLoad` console.log callbacks in ReportCard and test run page

## [0.2.21] - 2026-04-03

### Fixed
- Remove debug logging that wrote request metadata and auth config to localStorage on every API call (security)
- Remove localStorage token fallback, use sessionStorage only to prevent XSS token theft (security)
- Fix `validateApiKey` calling bare `fetch` without authentication headers
- Fix `instanceof Error` checks in GenerateReportDialog and useDeepLinksData to use safe cross-context pattern
- Fix `DeleteSystemDialog` using raw fetch instead of `authenticatedFetch` (missing 401 auto-retry)
- Fix `getPublicReport` and `buildShareUrl` bypassing runtime config (`env.API_URL`) with hardcoded `process.env`

### Changed
- Migrate 5 hooks from direct localStorage token reads to `useAuth()` context (useTrendsPresets, useComparePresets, useSLOSection, useDashboardsData)
- Remove redundant manual auth headers from hooks that already use `authenticatedFetch`
- Update CODING_RULES.md to document correct auth header pattern

### Removed
- Debug console.log statements from systems.ts, profiles.ts, reports.ts, keycloak-auth.ts
- Dead debug tools (`public/debug-logs.js`, `public/jwt-debugger.js`) that referenced removed localStorage logging
- Keycloak init session debug logging from keycloak-auth.ts

## [0.2.20] - 2026-04-03

### Fixed
- Prevent database deadlocks when bulk-deleting test runs with millions of rows in TimescaleDB hypertables
- Add deadlock retry logic (PostgreSQL 40P01) with linear backoff to deletion handler
- Set 30-second lock timeout on deletion transactions to fail fast instead of waiting indefinitely

### Added
- Bulk delete endpoint (`POST /test-runs/bulk-delete`) that queues deletions via BullMQ with concurrency 1
- Async deletion for single `DELETE /test-runs/:id` endpoint (returns 202 Accepted)
- `deletion_status` column on test runs for tracking queued/deleting/failed states
- Deletion status banner on test run detail page for other users viewing a run scheduled for deletion
- Synchronous fallback when Redis is unavailable

### Changed
- Frontend bulk delete now sends a single API call instead of N concurrent DELETE requests
- Test run list automatically filters out runs queued for deletion

## [0.2.19] - 2026-04-01

### Fixed
- Fix REEVALUATE_CHECKS stub pipeline silently returning success without doing any work (now returns failure with warning)
- Replace console.error with structured pino logger in ChecksPipeline realtime publishing
- Fix dead batch progress variables in MetricsPipeline (now actually logs batch progress)

### Removed
- Remove dead createErrorRecord/createEmptyRecord methods from MetricsPipeline
- Remove dead maybeSetAdaptDifferencesAccepted call and method from ChecksPipeline
- Remove dead getSettings method and 56-line migration guide from BasePipelineTypeORM
- Remove dead validateTestRun/hasExistingMetrics exports from worker analyze module
- Remove dead executeBatchProcessing/executeReevaluationBatch stubs from PipelineOrchestrator
- Remove unused imports from ChecksPipeline and MetricsPipeline

## [0.2.18] - 2026-03-31

### Fixed
- Fix ADAPT `computeStatus` algorithm bug where resolved regressions with non-accepted/denied resolution were incorrectly shown as UNRESOLVED
- Fix `verifyTestRunAccess` in data-science controller silently passing when test run does not exist (now throws 404)
- Add admin role check to `DELETE /data/locks` endpoint (any authenticated user could previously force-release job locks)
- Fix compare-presets admin bypass missing in `findAll` (global admins couldn't see non-global presets from other users)
- Fix `ResourceNotFoundException` being swallowed as 500 in compare-presets create/update
- Fix `ForbiddenException` being swallowed as 400 in data-science `releaseLock`
- Fix HttpException swallowing in events and alert-tag-filters controllers (NotFoundException/ForbiddenException now propagate correctly)
- Set `createdBy` field in graph-presets for RBAC Phase 2 consistency

### Removed
- Remove shipped stub endpoint `getTrackedRegressionChart` (returned wrong data with hardcoded zero percentages)
- Replace stub `getTestRunJobs` with proper 400 error (was returning fake empty data with "implementation in progress")
- Delete dead DTO files (`batch-reevaluate.dto.ts`, `batch-refresh.dto.ts`) that duplicated `batch-processing.dto.ts`
- Delete dead entity file `adapt/entities/tracked-regression.entity.ts` (real entity in packages/shared)
- Remove dead test helper and unused variables in events test suite

## [0.2.17] - 2026-03-31

### Fixed
- Fix RBAC bypass in metrics-sources write path — any authenticated user could update/delete other orgs' metrics sources
- Fix RBAC bypass in tracing-instances and pyroscope-instances — organizationId query param not validated against user's accessible orgs
- Fix Dynatrace update endpoint leaking plaintext API token in response (now masked)
- Remove Dynatrace API token prefix from debug logs (partial credential leak)
- Fix unreachable Dynatrace route caused by duplicate parameterized path (`GET :id/request-attributes`)
- Fix Grafana dashboards create endpoint blocking all JWT users (unreliable `ctx.organizationId` guard)
- Fix metrics `validateTestRunAccess` early-exit blocking access to unscoped test runs for users with no org memberships
- Replace bare `throw new Error()` with proper NestJS HTTP exceptions (ForbiddenException, BadRequestException) across 6 services
- Add `@IsUrl()` validation to Pyroscope URL generation DTOs
- Add `@IsDateString()` validation to trace-analysis time fields
- Add `@IsInt() @Min(1)` validation to Tempo search limit
- Add `@IsNotEmpty()` validation to Dynatrace entity mapping DTO fields
- Add missing `@ApiBearerAuth()` Swagger decorator to metrics and grafana/dashboards controllers

### Removed
- Remove 3 dead stub methods (findAll/findOne/create) from MetricsService and dead GET /metrics endpoint
- Remove `getFallbackValues` returning hardcoded demo data (MyAfterburner) on Grafana datasource errors
- Remove dead DTOs (DashboardRenderRequestDto, DashboardVariableValuesDto)
- Remove dead `dateToTimestamp` from PyroscopeUrlService
- Remove dead `getMaxTracesToAnalyze`/`getDefaultSearchLimit` from TraceQueryService
- Remove unused `isAdmin` assignments from TracingServicesService
- Remove orphaned JSDoc block and SQL debug logging

## [0.2.16] - 2026-03-29

### Fixed
- Resolve Next.js binary path in Docker container — start-server.js now tries workspace-level node_modules first with root fallback
- Use application_dashboard_id for ADAPT control group statistics join instead of metrics_source_id

### Added
- /auth-audit skill for multi-tenant authentication and authorization security audits

## [0.2.15] - 2026-03-28

### Changed
- Sparse data warnings no longer invalidate test runs — they are now informational "Data Notices" shown alongside results when all SLO checks completed successfully
- New `data_warnings` column on test runs separates informational warnings from hard validation errors
- Frontend shows sparse data as blue "Data Notices" section (informational) instead of orange "Data Quality Issues" (error)
- Slack and Teams notifications include data warnings as "Data Notices" with info icon

## [0.2.14] - 2026-03-28

### Fixed
- Worker now picks up Grafana instances added after startup instead of permanently caching the empty state from boot time
- Eliminated thundering herd: concurrent jobs waiting for Grafana config share a single database query via promise deduplication

## [0.2.13] - 2026-03-27

### Fixed
- Edit SLO dialog now pre-populates all fields (Source, Dashboard, Metric) from the benchmark's own data instead of relying on a fragile async fetch-and-match chain that failed for non-grafana sources and left the Save button permanently disabled
- Application dashboard API calls across SLO forms now use `?systemId=` (UUID) instead of `?system=` (name), which the backend silently ignored, causing unfiltered results
- `systemName` prop in test run SLO card now resolves to the actual system name instead of passing the UUID

### Added
- 136 unit tests for the Edit SLO form hook, validator utilities, and formatter utilities
- Generic dashboard/metric display in Edit SLO dialog for non-grafana/dynatrace sources (e.g., custom, prometheus)
- `metrics_source_id` field added to frontend Benchmark type for proper type safety
- `getSourceOption` now handles all source types (custom, prometheus, influxdb) instead of defaulting everything to "Grafana"

## [0.2.12] - 2026-03-27

### Fixed
- PostgreSQL autovacuum throttling on `ds_metrics` and `transactions` hypertables causing 68.5s query times on `transaction_buckets` CTE
- `autovacuum_vacuum_cost_delay` reduced from 20ms (set in migration 020) back to 2ms to match global default, preventing dead tuple buildup and stale visibility maps
- Added `autovacuum_analyze_scale_factor` to `transactions` table to keep planner statistics fresh
- Propagated autovacuum settings to all existing TimescaleDB chunks (parent-only ALTER TABLE does not affect existing chunks)

## [0.2.11] - 2026-03-27

### Added
- Centralized metric formatting utility (`apps/web/lib/format-units.ts`) with 11 functions: `formatDuration`, `formatDurationCompact`, `formatDurationClock`, `formatBytes`, `formatPercentage`, `formatRatioAsPercentage`, `formatChangePercentage`, `formatRate`, `formatNumber`, `formatCompactNumber`, `formatInteger`
- New `formatRate` function for rate-based metrics (req/s, ops/s, MB/s)
- 65 unit tests for centralized formatters covering all edge cases (null, undefined, NaN, negative, zero, boundaries)
- 22 unit tests for test-run-utils (formatDuration, calculateElapsedDuration, calculateProgress, isRecentlyActive)

### Changed
- AWR formatters (`awr/utils/formatters.ts`) now re-export shared functions from centralized source, eliminating 311 lines of duplication
- `test-run-utils.ts` and `test-run-formatters.ts` delegate to centralized `formatDurationClock`
- `HostPropertiesSection.tsx` uses centralized `formatBytes` instead of inline implementation

## [0.2.10] - 2026-03-26

### Fixed
- PostgreSQL write starvation prevention — reduced analyze concurrency from 5 to 2, added 120s statement timeout for analytical queries, dedicated write connection pool, backpressure via in-flight job dedup
- Prevent redundant incremental collection jobs via in-flight deduplication in scheduler
- Restore test run ID font size in collapsed card after refactor

### Changed
- Performance analysis collapsed card now shows "Ramp-up" state when test is running and still in ramp-up phase
- Add "Exclude Ramp-up" toggle to collapsed performance analysis card when in ramp-up state
- Move copy icon next to "Test Run ID" label in collapsed test run info card
- Tune PostgreSQL autovacuum for `ds_metrics` table (high-write workload)
- Worker pool size reduced from 100 to 30 connections to match reduced concurrency
- Analytical pipelines (Statistics, ControlGroups, ADAPT) use `withAnalyticsTransaction` with SET LOCAL timeout
- Metric writes (MetricsPipeline, PerformanceTestMetricsPipeline) use dedicated write connection pool

## [0.2.9] - 2026-03-25

### Added
- Copy-to-clipboard icon next to test run ID in both collapsed and expanded test run info cards
- Apdex Threshold column in performance analysis transaction tables and sampler tables
- Per-scenario transaction name filter in performance analysis overview tab
- Organization-scoped Grafana dashboard filtering — non-admin users only see dashboards from their organization's grafana instances

### Changed
- Add `organization_id` to frontend `SystemUnderTest` type for org-aware dashboard management
- Dashboard add dialog now fetches only dashboards from the system's organization grafana instances

## [0.2.8] - 2026-03-25

### Fixed
- Drop narrow unique constraints on `ds_compare_config` that blocked saving compare configs when the same dashboard+panel is used across different workloads (e.g., loadTest vs stressTest)
- Clear `setTimeout` in worker `PipelineOrchestrator.executeStage()` after `Promise.race` completes to prevent unhandled rejection crash 10 minutes after job completion

## [0.2.7] - 2026-03-25

### Fixed
- Propagate config scope (metric vs panel) through save dialog so panel-level ADAPT classification and thresholds are correctly applied

### Changed
- Disable PR Quality Gate, Claude Code Review, and Docker Build CI pipelines on pull requests (manual dispatch only)

## [0.2.6] - 2026-03-25

### Fixed
- Use fixed 1-second bucket size for incremental performance test metrics collection to prevent resolution changing mid-test (was 1s→5s after ~17 minutes)
- Delete old performance_test metrics before force re-fetch to avoid mixed-resolution data from prior incremental collection
- Add `MetricsSource` entity to grafana-sync TypeORM connection to fix startup crash (`ApplicationDashboard#metricsSource was not found`)

## [0.2.5] - 2026-03-25

### Fixed
- Propagate `metrics_source_id` through all metric pipeline paths (Grafana, performance test, incremental) to fix ADAPT regression detection failing with `NO_BASELINES_FOUND`
- Use `IS NOT DISTINCT FROM` for null-safe `metrics_source_id` join in ADAPT validator to prevent false empty control group detection

## [0.2.4] - 2026-03-25

### Fixed
- Apdex report card now uses per-transaction threshold overrides from `workload_transaction_apdex_thresholds` instead of a single default threshold
- Apdex report transactions table displays the actual threshold used per transaction
- Overall Apdex threshold display shows "varies per txn" when different transactions use different thresholds

### Removed
- Stale auto-claude artifacts (`.auto-claude-security.json`, `.auto-claude-status`, `.claude_settings.json`)
- Completed database migration consolidation docs (`database/DEPLOYMENT_CHECKLIST.md`, `MIGRATION_CONSOLIDATION.md`, `PRODUCTION_DEPLOYMENT_SUMMARY.md`)
- Unused SonarQube files (`fix-coverage-paths.sh`, `run-sonar-scan.sh`, `sonar-project.properties`)

### Changed
- Updated `.gitignore` to prevent future accumulation of tool artifacts (`.playwright-mcp/`, `.serena/`, auto-claude files)

## [0.2.3] - 2026-03-24

### Removed
- 53 obsolete files: backup files (.bak/.backup), unused Dockerfiles (optimized/security/simple/slim), superseded SQL migrations, archived TypeORM migrations, stale planning docs, one-time fix scripts, dead utilities, and build artifacts
- Old migration archives (`database/migrations/`, `database/migrations_archive/`)

### Fixed
- Exported previously inert migrations 003 (AddTagsHashUniqueIndex) and 004 (AddAlertsSupport) from `packages/shared/src/database/index.ts`

### Changed
- Upgraded vendored gstack to v0.11.15.0

## [0.2.2] - 2026-03-24

### Added
- Server-side ADAPT regression classification in MCP `get_adapt_results` tool — returns pre-classified regressions, dashboard groupings, causal chains, and hypotheses so Claude doesn't need to parse raw data
- Optional Obsidian output in perfana-report skill — user can choose between Obsidian vault or local `reports/` file

### Changed
- MCP permissions use wildcard `mcp__perfana__*` instead of individual tool entries — eliminates ~20 approval prompts per report
- Updated perfana-report skill Step 3.5 to consume pre-processed ADAPT data directly

### Fixed
- CI Docker build failures (missing curly braces for eslint, dollar escapes in schema-sql)
- Embedded schema SQL in migrations to eliminate Docker build dependency on pg_dump
- Trace and Pyroscope bugfixes from demo testing (scenario/transaction filtering, cross-source correlation)
- Data sources service resilience improvements

## [0.2.1] - 2026-03-23

### Added
- Cross-source root cause investigation in the `perfana-report` Claude Code skill — automatically fetches traces, flamegraphs, and Dynatrace problems when data sources are connected
- Investigation playbook reference mapping 15 hypothesis types to targeted MCP tool calls with evidence quality criteria
- Enhanced report template with Investigation section: distributed traces, CPU profiling hotspots, Dynatrace infrastructure problems, dashboard snapshots, evidence chain, and confidence levels
- Graceful degradation when sources are unavailable — investigation gaps are noted in the report, analysis continues

## [0.2.0] - 2026-03-23

### Added
- 8 new MCP tools for cross-source root cause analysis: `list_connected_sources`, `get_grafana_dashboard_snapshot`, `get_slow_traces`, `get_trace_detail`, `get_error_traces`, `get_flamegraph`, `get_hotspots`, `get_dynatrace_problems`
- Test-run-scoped API endpoints that resolve data source instances automatically from testRunId
- Tempo trace proxy: search slow/error traces and fetch full span breakdowns via TraceQL
- Pyroscope flamegraph proxy: fetch collapsed-stack profiles and hotspot analysis for a service
- Dynatrace problems proxy: fetch infrastructure problems detected during a test run time window
- Dashboard snapshot endpoint: aggregate min/max/avg/last stats for all panels in one call
- Connected data sources discovery: shows which Grafana, Tempo, Pyroscope, and Dynatrace instances are available for a test run
- Input validation for trace IDs (hex format) and service names (TraceQL injection prevention)
- Downstream request timeouts (10s) for all Tempo and Pyroscope proxy calls
- 16 new MCP client tests covering all new methods

## [0.1.0] - 2026-03-23

### Added
- MetricsSource entity unifying Grafana, Dynatrace, InfluxDB, and Prometheus under a single abstraction (Phase 3)
- MetricsSource 1:1 granularity eliminating synthetic GrafanaDashboard rows (Phase 3.7)
- ADAPT algorithm JOINs on `metrics_source_id` for cross-source regression detection (Phase 3.7)
- Frontend `source_type` utility for consistent metrics source display (Phase 3.7)
- Dynatrace WireMock mappings for local development (Phase 3)
- Pipeline registry pattern replacing per-source worker wrappers (Phase 4g)
- Document algorithms, extract magic numbers, and fix error logging (Phase 4a-c)
- Panels in reevaluate flow and incremental collection resilience (Phase 4e-f)
- Grouped dashboard dropdown with source badges in SLO dialog (Phase 6)
- Fetch all SLO dashboard sources on dialog open (Phase 6)
- Open source launch files: LICENSE (Apache 2.0), CONTRIBUTING.md, README, setup script
- GitHub Actions CI workflow (`pr-quality-gate.yml`)
- Dependabot configuration for automated dependency updates

### Changed
- `metrics_source_id` wired end-to-end through DynatracePipeline
- Configuration migration to reference MetricsSource instead of legacy dashboard IDs
- Filter synthetic dashboards from Add Dashboard picker using `source_type`
- Dark mode fix for Dynatrace host performance graphs

### Removed
- Dead worker code totaling ~960 lines (Phase 4d)
- Old worker wrappers replaced by pipeline registry (~1,413 lines)
- Stale Supabase references and unused dev scripts
