# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.2.47.67] - 2026-05-03

### Fixed
- **API users can now create SLOs, deep links, presets, dashboards, instances, and templates via the UI without hitting `null value in column "organization_id" violates not-null constraint`.** v0.2.47.66 fixed one manifestation of this bug in `grafana-sync`. An audit of the API's 36 modules surfaced 17 more sites with the same root cause: TypeORM silently drops snake_case `organization_id` keys (or omits them entirely) when an entity property is camelCase `organizationId!:` mapped to column `organization_id`, so every INSERT into a Phase-4 NOT-NULL owned-resource column blew up the second a user tried to create one through the UI. Two sub-patterns: (1) **Inherit from parent** — load the parent SUT / Profile / GrafanaInstance / TestRun and copy `organization_id` + `team_id` onto the child entity. Applied to `BenchmarkMutationService` (`create`, `copyToScope`, `createApdexSlo`), `GraphPresetsService.create` (TestRun → SUT), `TrendsPresetsService.create` (TestRun → SUT), `ComparePresetsService.create` (TestRun → SUT, falls back to user when no test-run scope), `DeepLinksRepository.create` + `createGeneric` (SUT for system-scoped, Profile for generic; service-layer plumbed to load the parent and pass `{ organizationId, teamId }` into the repo), `NotificationsService.create` (SUT), `ApplicationDashboardsService.create` (SUT), `GrafanaDashboardsService.create` (GrafanaInstance), `ReportTemplateService.create` + `ReportGenerationService` inline ad-hoc template (SUT via `system_id`), `ProfilesService.addDashboardToProfile` + `addBenchmarkToProfile` (parent Profile loaded earlier in the function, reused). (2) **Default to user's first accessible org** — when a top-level resource accepts an optional `organizationId?:` from the DTO, fall through to `AuthorizationService.getAccessibleOrganizations(userId)[0]` and throw `ForbiddenException` if the user has zero accessible orgs. Applied to `GrafanaInstancesService.create`, `PyroscopeInstancesService.create`, `TracingInstancesService.create`, `AlertTagFiltersService.create`, `ProfilesService.createProfile` (each grew a small `resolveOrganizationId(dtoOrgId, userId)` helper that prefers the DTO value, falls back to first accessible org). Module wiring: `DeepLinksModule` registers `Profile`; `ReportsModule` registers `SystemUnderTest`; nine services inject parent repositories. All 17 sites use the camelCase `organizationId` key (matches the entity property) and set `teamId` from the parent so the child resource inherits the parent's team scope by default. Stale `// NOTE: organization_id and team_id will be set when Phase 4 adds those columns` comments removed from sites where the column is now populated. Tests: 2 new regression tests in `benchmark-mutation.service.spec.ts` assert `organizationId` is in the create payload AND that `organization_id` is absent (mirrors the v0.2.47.66 grafana-sync regression test). 11 existing service specs updated to mock the new parent repositories (mock `testRunRepo.findOne` returns a test run with `systemUnderTest: { organization_id, team_id }` populated; mock `systemRepo` / `profileRepo` / `grafanaInstanceRepo` return parent fixtures; `getAccessibleOrganizations` mock returns a non-empty array for tests that exercise the user-context fallback). Existing payload assertions extended to expect `organizationId` + `teamId` on the create call. `compare-presets` queryBuilder mocks gained `leftJoin` + `andWhere` for the test-run-scoped findAll path that was previously skipped (the new beforeEach default `testRun.findOne` mock made the path reachable). `npm run test` is green: 4394 passed, 20 skipped, 0 failed. `npm run type-check` is clean. The audit found 4 sites that were already correct (5 in `dynatrace.repository.ts` — all set `organizationId` from `ownership` or parent config; `metrics-sources.service.ts` — passes `dto.organizationId`; `systems-under-test.service.ts` — entity uses snake_case property so `organization_id:` works directly; `report-generation.service.ts:266`/`360` — `GeneratedReport` entity has no `organization_id` column at all). Lint-enforced and Phase 4 NOT-NULL-enforced means this class of bug now surfaces at compile time + DB constraint level, not silent-drop time.

## [0.2.47.66] - 2026-05-03

### Fixed
- **`grafana-sync` no longer fails to create benchmarks with `null value in column "organization_id" violates not-null constraint`.** `AutoConfigUpdatesService.insertBenchmarkBasedOnProfileBenchmark` was passing `organization_id` (snake_case) into `benchmarkRepo.create()`, but the `Benchmark` entity maps the property `organizationId` (camelCase) → DB column `organization_id` via TypeORM's `name:` option. TypeORM silently dropped the unknown `organization_id` property, so every INSERT went out without an org id and slammed into the NOT NULL constraint added by Phase 4 (commit c7d94ee, 2026-05-02). Fix: pass `organizationId: testRun.organizationId` (camelCase) and drop the now-impossible `|| null` fallback. Adds a regression test that asserts `benchmarkRepo.create` is called with the camelCase `organizationId` AND that `organization_id` is not present on the create args, so the silent-drop pattern can't reappear.

## [0.2.47.65] - 2026-05-03

### Fixed
- **Audit log viewer — `perfana-admin` users no longer get 403.** `GET /api/audit-logs` was gated by `@Roles({ roles: ['super-admin', 'system-admin', 'support', 'org-admin'] })`, but in this codebase `perfana-admin` is the global-admin role (per `SystemRole.GLOBAL_ADMIN` in `apps/api/src/constants/roles.constants.ts`). The `RolesGuard` does strict string matching, so any token holding `perfana-admin` was rejected with 403 before the controller body's capability check could run — even though the body already authorizes via `Capability.SystemAuditRead`, which `GLOBAL_ADMIN_CAPABILITIES` grants to global admins. Fix: spread `GLOBAL_ADMIN_ROLES` (the canonical `['perfana-admin', 'admin']` constant) into the `@Roles` allowed-list. Adds a regression test that asserts the metadata via `Reflector` so the gate can't silently regress in the future. Also unblocks 42 pre-existing failing tests in `test-runs-config.service.spec.ts` by adding the missing `AuditService` mock provider that PR #244 (Phase 5a PR13) forgot to wire into the spec's test module.

## [0.2.47.64] - 2026-05-03

### Added
- **Audit log viewer (Phase 5a MVP).** Backend gains a capabilities-probe endpoint and the frontend gains a sidebar item + dedicated viewer page. Backend: `GET /api/audit-logs/capabilities` returns `{ canView, scope: 'cross-org' | 'org-scoped' | 'none', accessibleOrganizationIds, knownResourceTypes }`. Capabilities are derived the same way the existing `GET /api/audit-logs` endpoint scopes results — `Capability.SystemAuditRead` (super-admin / system-admin / support) → `cross-org`; `isOrgAdminInAnyOrganization` → `org-scoped` with the user's accessible org ids attached; everything else → `canView: false`. The probe is intentionally non-throwing: unauthenticated callers fail through `KeycloakEnhancedAuthGuard` like any other endpoint, but anyone authenticated who lacks audit access gets `canView: false` instead of a 403, so the frontend can hide the sidebar item silently. `knownResourceTypes` is sourced from `AuditResourceRegistry.knownTypes()` and is what populates the resource-type filter dropdown on the viewer page. Frontend: new `lib/audit-api.ts` typed client (capabilities probe, filterable list, per-resource history) routed through `authenticatedFetch`; new `lib/hooks/use-audit-logs.ts` TanStack Query hooks. Sidebar (`components/layout/sidebar.tsx`) probes capabilities at mount time with a `useEffect` keyed on the authenticated user; when `canView` is true, an "Audit Logs" item appears in the Configuration group. New page `apps/web/app/audit-logs/page.tsx` renders the filter bar (resource-type dropdown populated from `knownResourceTypes`, action dropdown, organization dropdown for cross-org callers, user-id / resource-id text inputs, datetime-local from/to pickers) plus a paginated `MUI` table with expandable rows. Each row shows timestamp / actor (email + userId) / action chip / resource type / resource id / org id; expanding a row reveals a per-field before/after diff table built from `changes.fields` + `changes.before` / `changes.after`, plus the request_id metadata when present. CREATE / UPDATE / DELETE rows are color-coded (success / info / error). `org-scoped` callers get a header note showing the count of accessible organizations; the org-filter dropdown is hidden for them since the backend already pre-scopes their results. Pagination is server-driven (`limit` / `offset`, `PAGE_SIZE = 50`). Tests: 3 new audit-query.controller spec assertions for the capabilities probe (cross-org / org-scoped / none branches) and 5 new web-side assertions for the API client (path/query construction, silent capabilities-probe fallback, error message passthrough, URL-encoding on the per-resource history endpoint).

## [0.2.47.63] - 2026-05-03

### Added
- **RBAC Phase 5a — audit logging in the results-impacting config group: `benchmark-mutation` + `test-runs-config` + `test-runs-metrics` (PR13).** Ninth service migration off the audit-migration allowlist. The bundle is the **results-impacting config group**: every entity in this PR retroactively changes pass/fail or anomaly verdicts on already-completed test runs, which is exactly the audit story compliance asks about ("did someone loosen the SLO / change the compare config to make a failing run pass after the fact?"). Five new `auditableFields` declarations: `Benchmark` (35 SLO-definition fields covering scope keys, source/dashboard linkage, panel identity, the metric-SLO triple `evaluate_type`/`requirement_operator`/`requirement_value`, the Apdex SLO triple `apdex_threshold_ms`/`min_apdex_score`/`include_failed_requests`, behavior knobs `enabled`/`valid`/`exclude_ramp_up_time`/`average_all`/`match_pattern`/the `validate_with_default_if_no_data*` pair, the embedded `configuration` jsonb that carries the threshold spec, plus alerting `alert_on_breach`/`alert_channels` and `baseline_test_run_id` — `metadata` excluded as a free-form bag); `DsCompareConfig` (8 fields covering the (sut, env, workload, dashboard, panel, metric, metrics_source) tuple plus the `config_data` jsonb — the actual ADAPT thresholds — `config_hash`/`last_modified_at` excluded as derived caches); `ProvisionedTemplateDsCompareConfig` (14 fields for golden-path templates: scope, dashboard linkage, panel/metric identity, the `regex`/`higher_is_better`/`metric_classification` triple, plus `config_overrides`); `ExpectedConfigChange` (6 fields: scope keys + `config_key`/`expected_value`/`description`); `SparseMetricExclusion` (6 fields: scope keys + `dashboard_label`/`metric_name`/`reason`). Ownership / org / team and timestamps excluded across all five (emitted via dedicated audit-row columns). Org-id resolution: `Benchmark`, `ExpectedConfigChange`, and `SparseMetricExclusion` use camelCase property / snake_case column for `organization_id`, so every call site passes `organizationIdOverride: row.organizationId`; `DsCompareConfig` and `ProvisionedTemplateDsCompareConfig` use snake_case `organization_id` directly, so `AuditService.dispatch` reads it off the ref without override. `BenchmarkMutationService` carries the full surface: `create` / `createApdexSlo` (CREATE after `repo.save`); `update` / `updateApdexSlo` (UPDATE with cloned before-snapshot from a direct `repo.findOne` — the existing `queryService.findOne` returns a mapped DTO and would lose the constructor prototype `AuditService.dispatch` consults); `delete` (DELETE *before* the FK null-out and the actual `repo.delete`); `copyToScope` emits one CREATE per persisted new row and one UPDATE (with cloned-before, refetched-after) per overwrite — per the audit architecture's "one row per entity" rule. `TestRunsConfigService.createExpectedConfigChange` and `.createSparseMetricExclusion` are upserts; the existing find-or-create-or-update flow now logs CREATE on the new branch and UPDATE on the existing branch (with cloned before-snapshot via `Object.assign(new Entity(), row)`). The two delete methods (`deleteExpectedConfigChange`, `deleteSparseMetricExclusion`) previously deleted by composite key without a pre-fetch; the migration adds a `repo.findOne` so the audit row captures the pre-delete state, gated by `if (existing)` to skip the audit when no row matches the composite key. `TestRunsMetricsService` covers four user-facing paths: `classifyMetric` upsert (CREATE/UPDATE on `ProvisionedTemplateDsCompareConfig`), `createOrUpdateDsCompareConfig` new branch (CREATE on `DsCompareConfig`; the existing-config branch delegates to `updateDsCompareConfig` which logs UPDATE — single audit row per logical user action, no double-logging), `updateDsCompareConfig` (UPDATE with cloned before-snapshot), `deleteDsCompareConfig` (DELETE before `repo.delete`). `applyGoldenPathClassifications` is intentionally **not** audited — it's a worker-driven system action triggered on test-run completion (with `created_by: 'system:golden-path'`), bucket-2 pattern: auditing it would generate noise on every test-run ingestion without compliance value. The bucket-2 decision is pinned by an explicit "does NOT audit" assertion in the spec. Module wiring: `BenchmarksModule` adds `AuditModule` import + `OnModuleInit` that registers `'benchmarks' → Benchmark`; `TestRunsModule` (already wired in PR8 for `'test-runs' → TestRun`) gets four additional registrations — `'expected-config-changes' → ExpectedConfigChange`, `'sparse-metric-exclusions' → SparseMetricExclusion`, `'ds-compare-configs' → DsCompareConfig`, `'provisioned-template-ds-compare-configs' → ProvisionedTemplateDsCompareConfig`. Allowlist 38 → 35 (removed all three service entries). Snapshot test re-recorded — picked up all five entities (each owns an `organization_id` column) with the new `auditableFields` arrays. 28 new audit-focused spec assertions across one new spec file (`benchmark-mutation.service.spec.ts`, full audit-only coverage of the 5 mutation paths: `create`/`createApdexSlo` CREATE invariants, `update`/`updateApdexSlo` UPDATE with cloned-before, `delete` with `invocationCallOrder` ordering vs. `repo.delete`), one new spec file (`test-runs-config.service.spec.ts`, both create-and-update branches and both deletes for both entities, including a "skip-audit-on-no-match" assertion for the composite-key deletes), and one new top-level describe block in the existing `test-runs-metrics.service.spec.ts` (the four user-facing paths plus an explicit "applyGoldenPathClassifications does NOT audit" assertion). Burndown updated.

## [0.2.47.62] - 2026-05-03

### Added
- **RBAC Phase 5a — audit logging in `graph-presets` + `trends-presets` + `compare-presets` (PR12).** Eighth service migration off the audit-migration allowlist; closes the user-owned customization presets group. Three new `auditableFields` declarations on the corresponding entities: `GraphPreset` (`name`, `description`, `testRunId`, `userId`, `seriesConfig`, `chartOptions`, `isGlobal` — covers identity / scope, the JSON content of the preset, and the global-visibility flag); `TrendsFilterPreset` (13 fields covering identity, the generic-vs-specific type discriminator, dashboard / metrics-source / panel scope, evaluate-type and source metadata, the JSON `seriesConfig`, the `createdForTestRunId` scope key, and the global-visibility flag); `CompareFilterPreset` (15 fields, same shape as Trends but with the additional `seriesSearchText` / `showPercentiles` / `baselineTestRunId` axes that compare-mode requires). Across all three entities the ownership / org / team columns and `created_at`/`updated_at` timestamps are intentionally excluded — they're emitted via dedicated columns on the audit row rather than the diff. All three entities use camelCase property / snake_case column naming for `organization_id` (`@Column({ name: 'organization_id' }) organizationId!`), so every audit call site passes `organizationIdOverride: row.organizationId` (matching the precedent established in PRs 8–11). `GraphPresetsService` and `TrendsPresetsService` are CREATE/DELETE-only — neither service exposes an update endpoint (preset edits go through delete-and-recreate from the UI). `ComparePresetsService` carries the full CRUD: CREATE after `repo.save`, UPDATE with explicit pre-update entity load (the existing service-layer `findOne` returns a DTO and would lose the constructor prototype that `AuditService.dispatch` consults to resolve `auditableFields`, so the new code does its own `repo.findOne` for the before-snapshot), DELETE before `repo.delete` with the same DTO-loss workaround. The cost is one extra SELECT on the compare-preset update / delete paths; the benefit is faithful before/after diffs without needing to teach `AuditService` about DTO mappings. The three modules each import `AuditModule` and register their resource type — `graph-presets` → `GraphPreset`, `trends-presets` → `TrendsFilterPreset`, `compare-presets` → `CompareFilterPreset` — with `AuditResourceRegistry` in `onModuleInit`, wiring the per-resource audit-history endpoint for all three. Allowlist 41 → 38 (removed all three preset service entries). Snapshot test re-recorded — picked up all three entities (each owns an `organization_id` column) with the new `auditableFields` arrays. 7 new audit-focused spec assertions across two new spec files (`graph-presets.service.spec.ts`, `trends-presets.service.spec.ts`) and one new top-level describe block in `compare-presets.service.spec.ts` cover the audit invariants: CREATE/UPDATE/DELETE log shapes with `organizationIdOverride`, before/after diff carry-through on the compare update, and `invocationCallOrder` checks for "log before mutation" on every DELETE. Burndown updated.

## [0.2.47.61] - 2026-05-03

### Added
- **RBAC Phase 5a — audit logging in `pyroscope-instances` + `tracing-instances` + `tracing-services` (PR11).** Seventh service migration off the audit-migration allowlist; closes the sensitive-credentials integrations group (api-keys → org/teams → test-runs → dynatrace → grafana → **pyroscope+tracing**). Three new `auditableFields` declarations: `PyroscopeInstance` (`label`, `pyroscopeUrl`, `backendUrl`, `pyroscopeStandAlone` — no credential columns on this entity); `TracingInstance` (`label`, `tracingUrl`, `tracingApiUrl`, `tracingUi`, `tracingIframeAllowed` — likewise no credentials); `TracingService` (`systemUnderTestId`, `testEnvironment`, `workload`, `tracingInstanceId`, `serviceNames` — the scoping keys that determine which tracing service applies to a given test run, the FK to `TracingInstance`, and the service-name list itself). All three entities exhibit the camelCase property / snake_case column mismatch (`@Column({ name: 'organization_id' }) organizationId!`), so every audit call site passes `organizationIdOverride: row.organizationId` — matching the GrafanaInstance / Dynatrace / TestRun precedent. `PyroscopeInstancesService` and `TracingInstancesService` follow the now-standard shape: `logCreate` after `repo.save`, `logUpdate` with cloned `before` snapshot via `Object.assign(new Entity(), entity)` to keep the prototype intact for the audit diff (the in-place mutation that follows would otherwise overwrite the pre-update field values), `logDelete` before `repo.remove`. `TracingServicesService.createOrUpdate` is the wrinkle in this PR — the upstream `TracingServiceRepository.createOrUpdate` performs an internal `findByExactMatch`-then-upsert flow, so the service does its own pre-check via the same `findByExactMatch` to split CREATE vs UPDATE for accurate audit semantics. The cost is one extra SELECT on this rarely-called write path; the benefit is "one row per logical user action" auditing instead of always-CREATE-shaped rows that would mislabel updates. `TracingServicesService.update` clones `before` from the existing-row check before delegating to the base repository's in-place `update`, then re-fetches `after` via `findById` for the diff. `TracingServicesService.delete` logs DELETE before `repository.delete`. The three modules each import `AuditModule` and register their resource type — `pyroscope-instances` → `PyroscopeInstance`, `tracing-instances` → `TracingInstance`, `tracing-services` → `TracingService` — with `AuditResourceRegistry` in `onModuleInit`, wiring the per-resource audit-history endpoint for all three. Allowlist 44 → 41 (removed all three service entries). `tracing-service.repository.ts` stays on the allowlist as a separate workstream — repository-layer audit migration is its own pass, mirrors the api-keys / dynatrace precedents. Snapshot test re-recorded — picked up all three entities (each owns an `organization_id` column) with the new `auditableFields` arrays. 10 new audit-focused spec assertions across the three new spec files (one per service) cover CREATE/UPDATE/DELETE log invariants, the createOrUpdate CREATE-vs-UPDATE branch (including verifying that no logCreate fires on the UPDATE path and vice-versa), before/after diff carry-through, and `invocationCallOrder` ordering checks for "log before mutation" on delete. Burndown updated.

## [0.2.47.60] - 2026-05-03

### Added
- **RBAC Phase 5a — audit logging in `grafana-instances` + `grafana-dashboards` + `application-dashboards` (PR10).** Sixth service migration off the audit-migration allowlist; second of the sensitive-credentials integrations group, parallel to PR9 (Dynatrace) and bundled into one PR per the same shape. Three new `auditableFields` declarations: `GrafanaInstance` (`label`, `client_url`, `server_url`, `orgId`, `username`, `snapshotInstance` — `apiKey` and `password` are encrypted credentials and excluded by name); `GrafanaDashboard` (12 dashboard-identity fields covering grafana linkage, uid/slug/name/uri, templating variables, tags, sut-membership array, and template metadata — `panels`, `variables`, `grafanaJson`, `applicationDashboardVariables`, `templateTestRunVariables`, `templateCreateDate`, and `updated` are bulk Grafana-derived JSON re-synced by the grafana-sync service and excluded as system-derived: re-recording them on every sync would generate massive, noisy diffs without compliance value); `ApplicationDashboard` (14 fields covering SUT/environment scope, grafana linkage, dashboard identity, tags, variables, replaced templating variables, snapshot timeout, and the metrics-source link). All three entities use camelCase property / snake_case column naming for `organization_id` (matching the TestRun + Dynatrace precedent), so every audit call site passes `organizationIdOverride: row.organizationId` — `AuditService.dispatch` cannot read `ref.organization_id` directly. `GrafanaInstancesService.update` mutates the loaded entity in place before `repo.save`, so the service captures a `before` snapshot via `Object.assign(new GrafanaInstanceEntity(), entity)` to keep the prototype intact for the audit diff. `GrafanaDashboardsService.update` and `.remove` previously delegated to the service-layer `findOne` for the access check (which mapped entity → DTO and lost the prototype, so the audit pipeline couldn't resolve `auditableFields`); the migration replaces those calls with a direct `repo.findOne` + `verifyOrgAccess(entity, …)` — same DB round-trip count, same access semantics, but the entity instance is preserved for the audit diff. `ApplicationDashboardsService.delete` logs DELETE for the `ApplicationDashboard` *before* the cascade transaction (mirrors PR8/PR9's "log before mutation" pattern); when `deleteFromGrafana=true` and the linked `GrafanaDashboard` is unused by any other SUT (orphaned), it additionally logs DELETE for the sibling `GrafanaDashboard` row. Cascaded `benchmarks` deletions and the `usedBySut` array maintenance update on `GrafanaDashboard` are intentionally not individually audited — same bucket-2 reasoning as test-runs (cascade noise at ingestion-rate volumes, implied by the parent DELETE row). `GrafanaModule` now imports `AuditModule` and registers all three resource types — `grafana-instances` → `GrafanaInstance`, `grafana-dashboards` → `GrafanaDashboard`, `application-dashboards` → `ApplicationDashboard` — with `AuditResourceRegistry` in `onModuleInit`, wiring the per-resource audit-history endpoint for all three. Allowlist 47 → 44 (removed all three grafana service entries). Snapshot test re-recorded — picked up all three entities (each owns an `organization_id` column) with the new `auditableFields` arrays. 10 new spec assertions across the three service spec files cover CREATE/UPDATE/DELETE log invariants, before/after diff carry-through (including the cloned-`before` for the in-place-mutation update path on grafana-instances), `logDelete` ordering before the repository delete (invocationCallOrder check) or before the cascade transaction starts (txn-not-yet-started flag check), and a sibling-DELETE assertion on `application-dashboards.delete` when the linked GrafanaDashboard is orphaned. Burndown updated.

## [0.2.47.59] - 2026-05-03

### Added
- **RBAC Phase 5a — audit logging in `dynatrace` (PR9).** Fifth service migration off the audit-migration allowlist; first of the sensitive-credentials integrations group. Three new `auditableFields` declarations: `DynatraceConfig` (`host`, `label`, `dynatraceType`, `perfanaTestRunIdAttribute`, `perfanaRequestNameAttribute` — `apiToken` and `platformApiToken` are encrypted credentials and excluded by name), `DynatraceQuery` (14 query-definition fields covering parent linkage, scope keys, panel identity, the DQL itself, and metric naming/template-variable metadata — `metricsSourceId` excluded because it's derived from a repository-side upsert, not user input), and `DynatraceEntityMapping` (8 mapping-definition fields). `DynatraceService` injects `AuditService` and emits `auditService.log{Create,Update,Delete}` for all 10 user-facing mutations: config CRUD (`create`, `update`, `delete`), query CUD (`createQuery`, `createQuerySmart`, `bulkImportQuery`, `updateQuery`, `deleteQuery`), and entity-mapping CD (`createEntityMapping`, `deleteEntityMapping`). All three entities exhibit the same camelCase property / snake_case column mismatch as `TestRun` (`@Column({ name: 'organization_id' }) organizationId!`), so every Dynatrace audit call passes `organizationIdOverride: row.organizationId` — the dispatch cannot read `ref.organization_id` directly. The query/mapping repository helpers return mapped DTO objects (via `mapEntityToDtoFields` / `mapEntityMappingToDtoFieldsWithLabel`) rather than entity instances — so the service wraps each DTO with `Object.assign(new DynatraceQuery(), dto)` (and the `DynatraceEntityMapping` analog) before handing it to `AuditService`. This restores the prototype so `AuditService.dispatch`'s `ref.constructor.auditableFields` lookup resolves to the declared array; the two helpers `toQueryAuditRef` / `toMappingAuditRef` localize the wrapping at the top of the service. `bulkImportQuery` shared-UUID mode emits one `logCreate` per persisted row (per the audit architecture's "one row per entity" rule); the non-shared mode delegates to `createQuerySmart` per row, which already emits its own audit row. `createHostMetricQueries` is intentionally not directly audited — it calls `createQuery` per metric (already covered) and additionally invokes `repository.ensureArtificialDashboardExists` and `repository.createDsCompareConfigForMetric`, both of which mutate via raw `manager.query('INSERT …')` against `grafana_dashboards` / `application_dashboards` / `ds_compare_config` (system-derived bootstrap rows, bucket-2 pattern). DELETE handlers (`delete`, `deleteQuery`, `deleteEntityMapping`) emit `logDelete` *before* the repository call (mirrors PR6/PR7/PR8 ordering) so the diff captures the pre-delete state and the audit envelope reads the still-extant entity. `DynatraceModule` now imports `AuditModule` and registers three resource types — `dynatrace-configs` → `DynatraceConfig`, `dynatrace-queries` → `DynatraceQuery`, `dynatrace-entity-mappings` → `DynatraceEntityMapping` — with `AuditResourceRegistry` in `onModuleInit`, wiring the per-resource audit-history endpoint for all three. Allowlist 48 → 47 (removed `dynatrace.service.ts`). `dynatrace.repository.ts` stays on the allowlist as a separate workstream — repository-layer audit migration is its own pass, mirrors the api-keys precedent. Snapshot test re-recorded — picked up all three Dynatrace entities (each owns an `organization_id` column) with the new `auditableFields` arrays. 11 new spec assertions across the three entities cover CREATE/UPDATE/DELETE log invariants, before/after diff carry-through, the `logDelete`-before-`repository.delete` ordering (invocationCallOrder check), and bulk-import per-row audit fan-out. Burndown updated.

## [0.2.47.58] - 2026-05-03

### Added
- **RBAC Phase 5a — audit logging in `test-runs` mutation handlers (PR8, bucket 1).** Fourth migration off the audit-migration allowlist; the marquee high-volume case. Wires `AuditService` into 7 of the 8 user-facing TestRun mutation handlers: `create-test-run`, `update-test-run`, `update-adapt-config`, `update-tags`, `update-annotations`, `update-analysis-start-offset`, and `delete-test-run`. `init-test.handler.ts` is intentionally not wired — it generates a unique `test_run_id` string and may auto-create a SystemUnderTest via the lookup service, but it does not mutate `TestRun`. `TestRun.auditableFields` declares 16 user-mutable fields covering identity (`testRunId`), test outcome (`completed`, `abort`, `abortMessage`, `consolidatedResult`), test config (`adaptConfig`, `analysisStartOffset`, `duration`, `plannedDuration`, `variables`, `expires`, `expired`), CI metadata (`applicationRelease`, `ciBuildResultsUrl`), and editorial annotations (`annotations`, `tags`); excludes immutable axes (`id`, `systemUnderTestId`, `testEnvironment`, `workload`), timestamps that bump on every save, ownership tracking, and system-derived fields (`status`, `isStale`, `staleDetectedAt`, `valid`, `reasonsNotValid`, `dataWarnings`, `deepLinks`, `deletionStatus`). Critical wrinkle: the TestRun entity's `organization_id` column maps to the camelCase property `organizationId`, which `AuditService.dispatch` cannot read from `ref.organization_id` directly — every TestRun call site passes `organizationIdOverride: testRun.organizationId`. The four raw-SQL update handlers (`update-tags`, `update-annotations`, `update-analysis-start-offset`, `update-test-run`'s second path) are not on the lint allowlist (the matcher is `repo|Repository|manager.<MUTATION_METHODS>`, which doesn't catch raw `dataSource.query`), but they're wired anyway because they're user-facing TestRun mutations. UPDATE handlers that previously did a slim `select: ['id']` existence check now load the full row to seed the audit diff. DELETE handler emits `logDelete` *before* the cascade transaction (mirrors PR6's org-delete pattern); cascaded child-table deletions (`ds_change_points`, `check_results`, `ds_*`, `transactions`, `requests_raw`, `virtual_users`, etc.) intentionally not individually audited — they're implied by the `test_runs` delete and the raw-SQL `manager.query('DELETE …')` calls would not surface to the audit lint rule's matcher. `TestRunsModule` imports `AuditModule` and registers `'test-runs' → TestRun` with `AuditResourceRegistry` in `onModuleInit`. Allowlist 51 → 48 (removed the 3 lint-flagged handlers; the 4 raw-SQL handlers were never on it). `TestRun.auditableFields` pinned by the snapshot. 15 new spec assertions in `apps/api/src/modules/test-runs/__tests__/handlers-audit.spec.ts` cover create/update/delete log invariants for all 7 wired handlers, including the override, the before-snapshot pattern for raw-SQL updates, and "log before mutation" ordering for delete. Buckets 2 (system-derived analytics writes — anomaly, changepoint, dashboard-query, stale-detection, lookup) and 3 (sub-resource CRUD — config, metrics, repositories) deferred per a decision-document section now in the audit decisions doc.

## [0.2.47.57] - 2026-05-03

### Added
- **RBAC Phase 5a — audit logging in `teams` + `team-members` (PR7).** Third service migration off the audit-migration allowlist, parallel to PR6. `Team.auditableFields = ['name', 'description', 'organization_id'] as const` and `TeamMember.auditableFields = ['user_id', 'roles', 'team_id'] as const`. The org-context resolution is inverted relative to PR6: Team rows carry `organization_id` natively so `AuditService.dispatch` picks it up without override; TeamMember rows carry only `team_id` (no `organization_id` column) and need `organizationIdOverride: member.team.organization_id` (resolved via the eagerly-loaded `team` relation in `findOne` / `findByTeamAndUser`) so org-admin scoped audit queries see membership events. `TeamsService` emits `logCreate(savedTeam)` after persist, `logUpdate(before, after)` with a cloned pre-mutation snapshot (so the post-`Object.assign` row doesn't alias `before`), and `logDelete(team)` before `repo.remove`. `TeamMembersService` emits `logCreate(savedMember, { organizationIdOverride: team.organization_id })` after `addMember` persist, `logUpdate(before, after, { organizationIdOverride: member.team.organization_id })` on `updateMemberRoles` (with `roles` array cloned into `before` so the diff is preserved), and `logDelete(member, { organizationIdOverride: member.team.organization_id })` *before* `repo.remove` in both `removeMember(id)` and `removeMemberByTeamAndUser(teamId, userId)`. `Team`'s `restrict_to_team_members` flag is intentionally excluded from `auditableFields` — it's a visibility hint, not a security boundary, and would add diff noise without compliance value. `TeamsModule` now imports `AuditModule` and registers both `'teams' → Team` and `'team-members' → TeamMember` with `AuditResourceRegistry` in `onModuleInit`, wiring the per-resource audit-history endpoint for both. Allowlist 53 → 51. Snapshot test re-recorded — picked up `Team` only; `TeamMember` is excluded from the snapshot because the snapshot scope is "entities with an `organization_id` column" (mirrors PR6's trade-off in reverse: there it was Organization that fell outside the snapshot). 16 new spec assertions across the two services (new `teams.service.spec.ts` + extended `team-members.service.spec.ts`) cover create/update/delete log invariants, including org-override resolution from the team relation and the "log fires before mutation" ordering for delete. Both `Team` and `TeamMember` are cast `as unknown as OwnedResource` at call sites (neither formally `implements OwnedResource` — Team lacks `created_by`, TeamMember lacks both `created_by` and `organization_id`); `AuditService.dispatch` only reads `id` and `organization_id` so the cast is sound. Burndown updated.

## [0.2.47.56] - 2026-05-03

### Added
- **RBAC Phase 5a — audit logging in `organizations` + `organization-members` (PR6).** Second service migration off the audit-migration allowlist. `Organization.auditableFields = ['name', 'description'] as const` and `OrganizationMember.auditableFields = ['user_id', 'roles', 'organization_id'] as const`. `OrganizationsService` injects `AuditService` and emits: `logCreate(org, { organizationIdOverride: org.id })` after persist; `logUpdate(before, after, { organizationIdOverride: id })` with a cloned pre-mutation snapshot so the diff is real (not aliased to the post-`Object.assign` row); `logDelete(org, { organizationIdOverride: id })` *before* the cascade transaction (so the audit envelope reads the still-extant entity, and the org-DELETE row precedes the cascaded raw-SQL deletions of teams/SUTs/test_runs/organization_members — which are intentionally not individually audited because they are implied by the org delete and `manager.query('DELETE …')` would not surface to the lint rule's `repo|Repository|manager.<MUTATION_METHODS>` matcher anyway). `OrganizationMembersService` injects `AuditService` and emits `logCreate(savedMember)` after `addMember` persist, `logUpdate(before, after)` on `updateMemberRoles` (with `roles` array cloned into `before` so the diff is not lost), and `logDelete(member)` *before* `repo.remove` in both `removeMember(id)` and `removeMemberByOrganizationAndUser(orgId, userId)`. `OrganizationsModule` now imports `AuditModule` and registers both `'organizations' → Organization` and `'organization-members' → OrganizationMember` with `AuditResourceRegistry` in `onModuleInit`, wiring the per-resource audit-history endpoint for both. Allowlist 55 → 53 (removed both organization-related entries). Snapshot test re-recorded — picked up `OrganizationMember` only; `Organization` is excluded because the snapshot scope is "entities with an `organization_id` column" (Organization is the root of the access-control hierarchy, so its `auditableFields` stays unpinned by that snapshot — accepted trade-off, deviation from the snapshot scope is out of PR6). 11 new spec assertions across the two services cover the create/update/delete log invariants, including the "log fires before mutation" ordering for delete and "no log on validation failures / not-found / unauthorized" guards. Both `Organization` and `OrganizationMember` are cast `as unknown as OwnedResource` at call sites — neither formally `implements OwnedResource` (Organization has no `organization_id` column at all; OrganizationMember has no `created_by`) — and `AuditService.dispatch` only reads `id` and `organization_id` so the cast is sound. Burndown updated.

## [0.2.47.55] - 2026-05-03

### Added
- **RBAC Phase 5a — audit logging in `api-keys` (PR5).** First service migration off the audit-migration allowlist. `ApiKey` now declares `static auditableFields = ['description', 'roles', 'validUntil', 'organization_id'] as const` — the bcrypt `apiKey` hash and the per-auth `lastUsed` timestamp are deliberately excluded (credential material + write-amplification noise). `ApiKeysService` injects `AuditService` and emits `logCreate(apiKey)` after persist + cache and `logDelete(apiKey)` before cache invalidation and `repo.delete`. `ApiKeysModule` imports `AuditModule` and registers `'api-keys' → ApiKey` with `AuditResourceRegistry` in `onModuleInit`, wiring the per-resource audit-history endpoint (`GET /api/audit-logs/resource/api-keys/:id`). Allowlist is now 55 entries (down from 56). Snapshot test re-recorded; 4 new spec assertions cover the create/delete log invariants (including the "log fires before mutation" ordering for delete and "no log on validation failures" for both paths). `ApiKey` does not formally `implements OwnedResource` because `created_by?` remains nullable on legacy keys — call sites cast `as unknown as OwnedResource`; `AuditService.dispatch` only reads `id` and `organization_id` so the cast is sound. The `api-key.repository.ts` data-access layer stays on the allowlist — repository-level audit migration is a separate workstream from the service-layer one. Burndown updated.

## [0.2.47.54] - 2026-05-03

### Added
- **Local pre-flight lint gate** (`npm run preflight` = `turbo run lint type-check`) wired to `git push` via `.githooks/pre-push`. The `prepare` script auto-installs the hook on `npm install` (`git config core.hooksPath .githooks`). Mirrors gstack `/ship`'s pre-flight pattern so PR-time regressions get caught locally — turbo cache typically resolves in under a second on warm trees, far faster than waiting on CI. Bypass: `git push --no-verify`.

### Fixed
- **Worker lint regression** — `apps/worker/src/schedulers/AuditPartitionManager.ts:69` had a single-line `if (!m) continue;` that violated the worker's `curly` ESLint rule. Introduced by PR2 (#230); slipped past because the dormant CI workflow didn't run. Wrapped the body in braces.
- **Web lint regression** — `app/integrations/components/IntegrationCard.test.tsx` (and other test files) were causing `@typescript-eslint/parser` to fail with a `parserOptions.project` error because the web `tsconfig.json` excludes `**/*.test.tsx`. Long-standing — undetected since PR #183. Added the standard test-file `ignorePatterns` block to `apps/web/.eslintrc.json`.

## [0.2.47.53] - 2026-05-03

### Changed
- **`AuditQueryController` migrated off `authzService.isGlobalAdmin()`** to capability-based reasoning (`Capability.SystemAuditRead`). The cross-org-vs-scoped branch in `findByFilter` now reads the user's capabilities via `authz.getCapabilities(userId, roles, null)` and checks for `SystemAuditRead` (granted only to global admins via `GLOBAL_ADMIN_CAPABILITIES`). Behavior unchanged: super-admin / system-admin / support still see cross-org rows; org-admin still scoped to accessible organizations. Restores `apps/api/.rbac-migration-allowlist.json` to empty — Phase 3c stays closed.

## [0.2.47.52] - 2026-05-03

### Added
- **RBAC Phase 5a — audit migration guard rule + drift detection (PR4).** Lays the Phase-3-style enforcement scaffolding for the upcoming service-layer audit migration:
  - **`audit-mutation-must-log` ESLint rule** (`apps/api/eslint-rules/audit-mutation-must-log.js`) — flags any service `MethodDefinition` that calls a mutation method (`save`/`delete`/`remove`/`update`/`insert`) on a `repo|Repository|manager` receiver without a paired `auditService.log{Create,Update,Delete}` call in the same method body. Mirrors the structure of `no-direct-is-global-admin`: hardcoded `INFRASTRUCTURE_FILES` (audit service+module, `AuthorizedBaseService`, `TypeOrmBaseRepository`), JSON allowlist (`apps/api/.audit-migration-allowlist.json`), per-method scan with circular-`parent`-safe AST traversal. Registered as `error` in `apps/api/.eslintrc.js`; spec/test files exempt via `overrides`.
  - **Seed allowlist (50 entries)** generated from a static scan of every service file under `apps/api/src` that mutates an `OwnedResource` entity. Six query-builder sites (`createQueryBuilder().delete()` / `.insert()`) the plan's grep regex didn't match were added after the initial lint surfaced them.
  - **`auditableFields` snapshot test** (`packages/shared/src/entities/__tests__/auditable-fields.snapshot.spec.ts`) — enumerates every TypeORM entity that owns an `organization_id` column (45 entities) and pins each one's current `auditableFields` declaration. Initially every entity maps to `null`; declarations land in PR 5+. Adding/changing a declaration surfaces as a snapshot diff and forces a deliberate "log this" or "redact" review per Q10.
  - **Allowlist JSON validity smoke test** (`apps/api/src/__tests__/audit-migration-allowlist.spec.ts`) — every CI run validates the allowlist parses cleanly, every entry resolves to an existing file under `apps/api/src`, no duplicates, POSIX paths only.
  - **Burndown audit doc** (`docs/superpowers/audits/2026-05-02-audit-phase5a-decisions.md`) — self-contained reference: spec decisions Q1–Q11, the rule's `INFRASTRUCTURE_FILES` set, seed burndown table (56 / 0 / 56), priority migration order. Update on every migration PR.
  - **Drift `/schedule` agent** (`docs/superpowers/scheduled-agents/audit-burndown-drift.md`) — every 2 weeks re-runs the discovery scan outside the allowlist and surfaces drift the lint rule missed. Stop condition: empty allowlist + 0 new sites for two consecutive runs.
  - **`apps/api/CODING_RULES.md` "Audit Logging" section** — convention for paired `auditService.log{Create,Update,Delete}` calls + per-entity `auditableFields`, with pointers to the spec/burndown/plan.

### Fixed
- **PR3 regression:** `apps/api/src/modules/audit/audit-query.controller.ts:47` calls `authzService.isGlobalAdmin(ctx.roles)` directly (the Phase 3c-deprecated pattern). The dormant `PR Quality Gate - Test Suite` workflow has not run since March, so the regression slipped through PR3's merge. Added the file to `apps/api/.rbac-migration-allowlist.json` (which Phase 3c had successfully emptied) to keep this PR scope-clean. Migrating to `getCapabilities()` / `@RequiresCapability` is Phase 3c follow-up.

## [0.2.47.51] - 2026-05-02

### Added
- **RBAC Phase 5a — audit-log read endpoints (PR3).** Two HTTP surfaces against the partitioned `audit_logs` table from PR2:
  - `GET /api/audit-logs?resourceType=&resourceId=&userId=&action=&organizationId=&startDate=&endDate=&limit=&offset=` — admin filterable search. Gated by `@Roles({ roles: ['super-admin', 'system-admin', 'support', 'org-admin'], mode: ANY })`. Super-admins see cross-org rows; org-admins are scoped to their accessible organizations via `getAccessibleOrganizations`. If a non-admin requests a specific `organizationId` they don't have access to, the endpoint returns an empty result (no information leak about whether that org exists). Pagination capped at limit ≤ 500.
  - `GET /api/audit-logs/resource/:resourceType/:resourceId` — per-resource history. RBAC follows the resource's own access semantics: controller resolves `resourceType` to its entity class via `AuditResourceRegistry`, loads the entity by `id`, then calls `authzService.canAccessResource(userId, roles, resource)`. 404 if the resource type is unregistered or the resource doesn't exist; 403 if `canAccessResource` denies. "If you can see the resource, you can see who edited it."
- **`AuditResourceRegistry` (`@Injectable()`).** Maps `resource_type` strings to entity classes for the per-resource endpoint's entity lookup. Domain modules will register their owned-resource entities in their `onModuleInit` hooks during PR5+ migration tasks. Last-write-wins for duplicate keys; `knownTypes()` returns sorted.
- **`AuditFilterDto`.** Class-validator-decorated query DTO for the admin endpoint. Uses `@Type(() => Number)` for query-string number coercion (matches existing pagination pattern in the codebase), `@IsUUID` for `organizationId`, `@IsDateString` for date bounds, `@IsIn(['CREATE','UPDATE','DELETE'])` for action (sidesteps class-transformer enum-coercion fussiness).

### Changed
- **`AuditModule` now imports `CommonModule`** (for `AuthorizationService` injection into the controller) and registers `AuditQueryController` + `AuditResourceRegistry`. Module exports `AuditService` + `AuditResourceRegistry` so domain modules can register entities in PR5+.

### Coverage
- 9 controller spec tests covering admin/non-admin scoping, org-mismatch empty-result behavior, pagination passthrough, 404 for unknown resource types, 404 for missing resources, 403 for denied access, and the happy path.
- 4 registry spec tests (register/resolve, unknown resolves to null, sorted listing, last-write-wins).
- Total audit-module test count: 30 tests across 4 suites, all passing.

## [0.2.47.50] - 2026-05-02

### Added
- **RBAC Phase 5a — partitioned `audit_logs` storage layer (PR2).** Greenfield migration drops the existing non-partitioned `audit_logs` table (scaffolding-era data with no production value, per the spec) and recreates it as a Postgres-native partitioned table (`PARTITION BY RANGE (timestamp)`) with a composite `(id, timestamp)` primary key. Five secondary indexes (timestamp DESC, user_id, organization_id partial, resource_type+id partial, action) are created at the parent and inherited automatically onto every child partition. The migration bootstraps three monthly child partitions (current month + next 2 months) via `audit_logs_YYYY_MM` naming. Retention becomes a `DROP PARTITION` operation (~instantaneous) instead of a slow `DELETE WHERE timestamp < ...`.
- **`AuditPartitionManager` daily scheduler (worker).** Runs at 03:00 UTC via `@Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: 'UTC' })`. Two responsibilities, both idempotent: (1) ensure partitions exist for the current month + next 2 months (`CREATE TABLE IF NOT EXISTS`); (2) drop partitions older than `AUDIT_RETENTION_MONTHS` (env var, default 24). Strict regex `/^audit_logs_(\d{4})_(\d{2})$/` filters out non-date-shaped tables (`audit_logs_default`, `audit_logs_archive_2023`) so only legitimate monthly partitions are eligible for drop. Errors are caught and logged at the `cron()` level so a transient DB blip never crashes the worker. Registered in `SchedulersModule` alongside `IncrementalCollectionScheduler`.

## [0.2.47.49] - 2026-05-02

### Added
- **RBAC Phase 5a — audit-completion infrastructure (PR1).** Lays the foundation for service-layer audit logging: `nestjs-cls@^6.2.0` dep, `RequestContextStore` type + `REQ_CTX` symbol, `RequestContextModule` (global ClsModule wrapper with UUIDv4 request-id generator), `AuditContextInterceptor` (replaces the legacy `AuditInterceptor` — populates `{userId, userEmail, ipAddress, userAgent, requestId, authType}` per request, emits ZERO audit rows), `AuditableEntityClass<T>` interface + `getAuditableFields()` helper on `OwnedResource` (per-entity static `auditableFields` allowlist convention; default-nothing-logged for safety), pure-function `pickAuditable / diff / truncateOversizedFields` helpers (with 4 KB per-field cap and `{truncated, originalLength}` marker), and the slim new `AuditService` API (`logCreate(entity)` / `logUpdate(before, after)` / `logDelete(entity)` + `findByFilter` / `findByResource` queries, fire-and-forget `setImmediate` insert pattern, CLS-backed actor envelope, `actorOverride` escape hatch). Phase 5a/PR1 is functionally a no-op at runtime — the infrastructure is dormant until subsequent PRs wire service-layer audit calls. Spec at `docs/superpowers/specs/2026-05-02-rbac-phase5a-audit-completion-design.md`; plan at `docs/superpowers/plans/2026-05-02-rbac-phase5a-audit-completion.md`.

### Changed
- **`AuditAction` enum trimmed** from 7 values (`CREATE | UPDATE | DELETE | ACCESS | ACCESS_DENIED | LOGIN | LOGOUT`) to 3 (`CREATE | UPDATE | DELETE`). Phase 5a's scope is mutations only; ACCESS / ACCESS_DENIED / LOGIN / LOGOUT are deferred to Phase 5c (security monitoring) when concrete monitoring requirements drive their reintroduction. Verified zero external consumers across `apps/` and `packages/` before the trim.

### Removed
- **Legacy `AuditInterceptor`** (`apps/api/src/common/interceptors/audit.interceptor.{ts,spec.ts}`). The HTTP-method-based auto-logging (`POST` → CREATE, `GET` → ACCESS, etc.) is gone — service-layer explicit `auditService.log{Create,Update,Delete}` calls (lint-enforced via the upcoming `audit-mutation-must-log` ESLint rule in PR4) replace it. `OLD AuditService` API surface (`log()`, `logAccess()`, `logAccessDenied()`, `getResourceAuditLog()`, `getUserAuditLog()`, `getOrganizationAuditLog()`, `getAccessDeniedEvents()`, `getAuditStats()`, `healthCheck()`, plus the old positional-args `logCreate/Update/Delete`) deleted from `audit.service.ts`. ~960 net lines of dead code removed across the interceptor + service.

## [0.2.47.27] - 2026-04-30

### Refactored
- **RBAC Phase 3c — `dynatrace.service.ts` partial migration (Phase C17).** Migrated the 3 per-resource sites originally classified "Leave" in C2's pilot (`findByHost` → `canAccessResource`, `update` and `delete` → `canModifyResource`). The 21 debug-log-only sites + 5 internal `isAdmin`-passing sites remain — file stays in the allowlist for now. Initial bulk-drop attempt was aborted: a perl one-shot for the debug-log pattern matched too aggressively and broke 5 sites that referenced `isAdmin` downstream (e.g. the `attachPermissions` branch at line 211, and the `requireDynatraceMutationCapability` helper that takes `isAdmin: boolean`). Reverted and re-scoped to just the 3 standard per-resource migrations. Burndown: Bucket B 13 → 16 of 17 (94.1%) — total adjusted upward by 3 to count dynatrace's per-resource sites. Allowlist unchanged at 24 files. All 114 dynatrace tests + full 4314-test API suite pass; 0 type errors; 0 lint errors. Net 0 lines (single file, +30/-30). Documented the bulk-drop cautionary tale in the audit doc as a lesson for future migrations.

## [0.2.47.26] - 2026-04-30

### Added
- **`AuthorizationService.canAdministerAnyOrganization(userId, roles)`** — new policy primitive returning `AuthorizationResult` ({ allowed, reason }) that combines global-admin bypass + `isOrgAdminInAnyOrganization` membership check. Centralizes the "global admin OR any-org admin" pattern that 3 services were re-implementing in private `requireOrgAdmin` helpers. Both shared mock factories (`createAuthorizationServiceMock` happy + `createRestrictiveAuthorizationServiceMock`) gained the method.

### Refactored
- **RBAC Phase 3c — finish bundle (Phase C16).** Largest single C-series PR: 6 files exit the lint allowlist simultaneously. `benchmark-query.service.ts` (C5 leftovers) + `grafana/application-dashboards.service.ts` (C3) + `grafana/grafana-dashboards.service.ts` (C3) + `grafana/grafana-instances.service.ts` (C3) + `pyroscope/pyroscope-instances.service.ts` (C4) + `tracing-instances/tracing-instances.service.ts` (C4) all migrated to use `canAccessResource` (per-resource read), `canModifyResource` (per-resource org-admin write — grafana-instances only), `canAdministerAnyOrganization` (new "any-org admin" gate for the requireOrgAdmin helpers in the 3 instance services), and log-tag drops (10+ debug-log-only sites). Subtle: pyroscope/tracing keep `canAccessResource` for update/remove (preserving member-level write semantics), only grafana-instances tightens to `canModifyResource` (preserving its existing org-admin role check). Files exit allowlist en masse: 8 → **14 files exited cumulatively**; allowlist 30 → **24**. Burndown: Bucket B 6 → 13 of 14 (92.9%) — Bucket B is now nearly complete, only `users.controller.ts` (privilege gate, different shape) remains. All 4314 API tests pass; 0 type errors; 0 lint errors. Net +2 lines across all 10 changed files — the new abstraction (`canAdministerAnyOrganization`) and explanatory comment blocks balance the deleted inline policy code.

## [0.2.47.25] - 2026-04-30

### Refactored
- **RBAC Phase 3c — finish `metrics-sources.service.ts` migration (Phase C15).** Second "finish PR" following the C14 precedent. C8 (PR #195) migrated the 3 Bucket A list-filter sites and left `create` (debug-log only), `update`, `delete` (per-resource throw guards). C15 closes all 3: `create` drops the `(admin)` log tag (C11 precedent), `update` and `delete` delegate to `AuthorizationService.canAccessResource`. Also fixes a latent bug in the shared `createAuthorizationServiceMock` factory: `canAccessResource` and `canModifyResource` were mocked as boolean (`mockResolvedValue(true)`) but the real methods return `AuthorizationResult` (`{ allowed, reason }`). Bug was dormant — no consumer of the shared factory had exercised these methods until now. Fix lands in this PR; all 10 consumers benefit. File exits the lint allowlist (eighth file to do so; allowlist 31 → 30). Burndown: Bucket B 4 → 6 of 14 (42.9%) — biggest single-PR Bucket B gain so far. All 34 metrics-sources tests + full 4314-test API suite pass; 0 type errors; 0 lint errors.

## [0.2.47.24] - 2026-04-30

### Refactored
- **RBAC Phase 3c — finish `events.service.ts` migration (Phase C14).** First Phase 3c PR to "finish" a file that an earlier C-series PR (C10) partially migrated. C10 migrated the 2 Bucket A list-filter sites and left 1 Bucket B per-resource guard at `findOne` line 112. C14 closes that last site via `canAccessResource` (same pattern as C12 awr-reports and C13 alert-tag-filters). Spec updated: 2 `findOne` test assertions migrated from `isOrganizationMember` to `canAccessResource`; base mock provider gained `canAccessResource: jest.fn().mockResolvedValue({ allowed: true, reason: 'mocked' })`. File exits the lint allowlist (seventh file to do so; allowlist 32 → 31). Burndown: Bucket B 3 → 4 of 14 (28.6%). Establishes the "finish PR" precedent — partially-migrated files in the allowlist are now cheap follow-up targets. All 19 events tests + full 4314-test API suite pass; 0 type errors; 0 lint errors. Net +5 lines.

## [0.2.47.23] - 2026-04-29

### Refactored
- **RBAC Phase 3c — `alert-tag-filters.service.ts` migration (Phase C13).** First Phase 3c PR to apply both migration tools (`withOrgFilter` and `canAccessResource`) to a single file. The `findAll` method (Bucket A list-filter) migrated to `withOrgFilter` + sentinel; the `findOne` method (Bucket B per-resource guard) migrated to `canAccessResource`. Demonstrates that one PR can cleanly use both tools when the file has both shapes — a useful precedent for future multi-bucket files where forcing one tool everywhere would either duplicate centralized policy (`withOrgFilter` for per-resource) or create N+1 query regressions (`canAccessResource` per-row). File exits the lint allowlist (sixth file to do so; allowlist 33 → 32). Burndown: Bucket A 40 → 41 of 127 (32.3%); Bucket B 2 → 3 of 14 (21.4%). All 4314 API tests pass; 0 type errors; 0 lint errors. Net +5 lines.

## [0.2.47.22] - 2026-04-29

### Refactored
- **RBAC Phase 3c — `awr-reports.controller.ts` migration (Phase C12).** First Phase 3c PR to migrate Bucket B (per-resource access guard) sites instead of Bucket A (list-filter) sites. Both private guards `validateTestRunAccess` and `validateReportAccess` previously inlined the admin / legacy-null-org / `isOrganizationMember` policy chain. Migrated to delegate to `AuthorizationService.canAccessResource` (same C7 pattern), which centralizes the three policy branches in one place. The resource lookups (TypeORM relation + raw SQL chain) are unchanged — only the policy decision moves out. File exits the lint allowlist (fifth file to do so since Phase 3c began; allowlist 34 → 33). Burndown: Bucket B 0 → 2 of 14 (14.3%) — first Bucket B progress. All 402 awr tests + full 4314-test API suite pass; 0 type errors; 0 lint errors. Net +5 lines (the only Phase 3c migration so far that grew the file — the growth is the explanatory comment block in front of the `canAccessResource` call).

## [0.2.47.21] - 2026-04-29

### Refactored
- **RBAC Phase 3c — `compare-presets.service.ts` migration (Phase C11).** Heterogeneous single-file migration: refactored `validateTestRunAccess(testRunId, userId, roles)` → `(testRunId, orgIds: string[] | null)` to use the C9 sentinel pattern, then migrated all 5 method-level `isGlobalAdmin` sites — 4 via `withOrgFilter` (`create`, `findAll`, `findOne`, `update`) and 1 via log-tag removal (`remove`, where `isAdmin` was used solely for ` (admin)` log decoration with no behavioral consequence). Incidental optimization: the `findAll` per-row access loop now reuses one `orgIds` value across all iterations instead of re-evaluating `isGlobalAdmin` + cache-fetching `getAccessibleOrganizations` per global preset. File exits the lint allowlist (fourth file to do so since Phase 3c began; allowlist 35 → 34). Burndown: Bucket A 35 → 40 of 127 (31.5%). All 121 compare-presets tests + full 4314-test API suite pass; 0 type errors; 0 lint errors. Net -7 lines.

## [0.2.47.20] - 2026-04-29

### Refactored
- **RBAC Phase 3c — `events.service.ts` migration (Phase C10).** Migrated 2 canonical Bucket A list-filter sites (`findAll`, `findByTestRun`) from the `if (!isAdmin) { load orgs; filter }` pattern to `withOrgFilter` + `orgIds === null` sentinel. The 1 per-resource throw guard at `findOne` (line 112) is left in place — same disposition as the C8 metrics-sources bundle. File remains in the allowlist. Burndown: Bucket A 33 → 35 of 127 (27.6%). All 19 events tests + full 4314-test API suite pass; 0 type errors; 0 lint errors.

## [0.2.47.19] - 2026-04-29

### Refactored
- **RBAC Phase 3c — `adapt.service.ts` migration (PR #198 candidate).** Multi-bucket migration: removed two trivial passthrough wrappers (`private isGlobalAdmin`, `private loadAccessibleOrganizations`), refactored `validateTestRunAccess(testRunId, isAdmin, orgIds[])` → `(testRunId, orgIds: string[] | null)` to use the `null = admin` sentinel from `withOrgFilter`, and migrated all 8 `isGlobalAdmin` call sites in `getTrackedRegressions`, `getTrackedRegressionsCount`, `resolveTrackedRegressionsByTestRun`, `resolveTrackedRegression`, `getTrackedDifferencesChart`, `getCorrelatedRegressions`, `getDsAdaptConclusion`, `getEnrichedConclusion`. File exits the lint allowlist (third file to do so since Phase 3c began; allowlist 36 → 35). Burndown: Bucket A 25 → 33 of 127 (26.0%), Local wrappers 1 → 2 of 13 (15.4%). All 93 adapt tests + full 4314-test API suite pass; 0 lint errors; 0 type errors.

## [0.2.47.18] - 2026-04-29

### Fixed
- **Creating a report template from System Under Test config returned 400 "User must belong to an organization to create report templates" even for organization admins.** `ReportTemplateController` gated `create`, `copy`, and `duplicate` on `ctx.organizationId`, but that value only populates from the JWT or API key. Keycloak JWTs don't carry org membership in this project (organizations live in the database), so every Keycloak-authenticated user — including org admins — saw `ctx.organizationId === undefined` and hit the 400. Fix injects `AuthorizationService` into the controller and falls back to `getAccessibleOrganizations(ctx.userId)` when `ctx.organizationId` is empty, matching the pattern already used in `ApiKeysController`. All 446 reports module tests pass.

## [0.2.47.15] - 2026-04-29

### Fixed
- **Empty modal when configuring sections on a new report template.** From the System Under Test config view, opening Reporting Templates → Create Template → Configure Sections rendered a blank dialog (only the title bar and Cancel button). The `GenerateReportDialog` mounted in `template-builder` mode initialized `showTemplateSelector` to `true` regardless of mode, and the template-fetch `useEffect` short-circuits in template-builder mode, so the flag never flipped. The render gates then hid both the section builder and the Save Configuration button. Fix initializes `showTemplateSelector` to `!isTemplateBuilder` at `apps/web/components/reports/report-generation/GenerateReportDialog.tsx:194` so the builder UI shows immediately when entering template-builder mode. The default report-generation flow (no `mode` prop) is unaffected. All 50 tests in `apps/web/__tests__/components/reports/GenerateReportDialog.test.tsx` pass.

## [0.2.47.14] - 2026-04-29

### Refactored
- **Phase 3c — `ReportGenerationService` fully migrated; second file to exit the allowlist.** First multi-bucket migration in the Phase 3c rollout — touches three audit categories in one PR. Migrates 4 canonical Bucket A "filter bypass" sites (`findAll`, `findByTestRunId`, `getSummary`, `getPendingReports`) to `withOrgFilter`. Removes the local `private isGlobalAdmin()` wrapper (line 138) plus its `ADMIN_ROLES` constant — first reduction of the "Local wrappers" audit counter from its 0/13 starting point. Refactors the two private per-resource ACL helpers (`isTestRunAccessible`, `isReportAccessible`) to delegate to `AuthorizationService.canAccessResource`, which already implements the admin / legacy-null-org / org-membership check. Both helpers preserve a `!userId` short-circuit so internal/system calls still bypass auth as before. `team_id` is intentionally omitted from the `OwnedResource` payload to preserve the prior behavior of not checking team membership for these resources. The existing spec needed only a one-line mock update (added `canAccessResource: jest.fn().mockResolvedValue({ allowed: true, reason: 'mocked' })` alongside the existing `isGlobalAdmin` and `getAccessibleOrganizations` mocks); 446 reports tests pass. The file now has zero direct `isGlobalAdmin` references and has been **removed from `.rbac-migration-allowlist.json`** — second file to exit the allowlist since Phase 3c began. Allowlist size: 37 → 36. Net diff: -48 lines. Audit progress: Bucket A migrated 18 → 22 of 127 (17.3%); Local wrappers migrated 0 → 1 of 13 (7.7%). See `docs/superpowers/audits/2026-04-26-audit-decisions.md` for the full per-site classification.

## [0.2.47.13] - 2026-04-29

### Refactored
- **Phase 3c — `ReportDataFetcherService` fully migrated to `withOrgFilter`; first file to exit the allowlist.** All 8 `isGlobalAdmin` sites in this 1810-line service were canonical Bucket A "filter bypass" sites — 100% canonical density, the strongest signal seen in the Phase 3c rollout. Adds a private `resolveOrgFilter(userId, roles, paramStart, alias)` helper that wraps `withOrgFilter` + the existing `buildOrganizationFilterClause`, used at 4 single-derivation sites (collapses each 11-line block to a single line). The 4 remaining sites use inline `withOrgFilter` directly: 2 share `orgIds` across multiple filter clauses (`getThroughputStats` triple-derivation, `getVirtualUserStats` double-derivation), 1 uses dynamic per-iteration paramIdx in a loop (`getMetricsTimeSeries`), 1 has a custom `EXISTS(...)` clause shape (`getAvailableMetricsPanels`). Behavior is unchanged — the `!userId` short-circuit (internal/system call bypass) is preserved everywhere. Net diff: -29 lines despite adding the new helper (76 removed, 47 added). The file now contains zero direct `isGlobalAdmin` references and has been **removed from `.rbac-migration-allowlist.json`** — first file to exit the allowlist since Phase 3c began. Allowlist size: 38 → 37. Audit progress: Bucket A migrated 10 → 18 of 127 (14.2%). See `docs/superpowers/audits/2026-04-26-audit-decisions.md` for the full per-site classification.

## [0.2.47.12] - 2026-04-29

### Refactored
- **Phase 3c — `BenchmarkQueryService` migrated to `withOrgFilter`.** Three canonical Bucket A "filter bypass" sites migrated: `findAll`, `getSystemEnvironmentsAndWorkloads`, and `getBenchmarkTagSyncStatus`. Highest density per-file in this rollout so far (3 of 5 isGlobalAdmin sites canonical, 60%). The `getBenchmarkTagSyncStatus` migration also collapsed an admin-vs-non-admin code split — both branches now share the same query path with the `orgIds === null` predicate gating org-scoped filtering. Behavior is unchanged. The per-resource guard in `findOne` and the Phase 4-stub `syncTagsWithApplicationDashboards` debug log stay inline, so the file remains in `.rbac-migration-allowlist.json`. Audit progress: Bucket A migrated 7 → 10 of 127 (7.9%). See `docs/superpowers/audits/2026-04-26-audit-decisions.md` for the full per-site classification.

## [0.2.47.11] - 2026-04-29

### Refactored
- **Phase 3c — Pyroscope + Tracing instances bundle migrated to `withOrgFilter`.** `PyroscopeInstancesService.findAll` and `TracingInstancesService.findAll` now resolve list-filter org scope via the shared `withOrgFilter` helper. Both methods previously had a 3-branch organization-filtering shape (`organizationId && !isAdmin` / `organizationId && isAdmin` / `!isAdmin`) where the first branch made an extra `getAccessibleOrganizations` call to validate the requested org. Migrating collapses this to 2 branches and eliminates the duplicate call — same input/output for all 5 call shapes (admin / non-admin × with-orgId / no-orgId / no-access-orgId). Behavior is unchanged. Audit progress: Bucket A migrated 5 → 7 of 127 (5.5%). See `docs/superpowers/audits/2026-04-26-audit-decisions.md` for the full per-site classification.

## [0.2.47.10] - 2026-04-29

### Refactored
- **Phase 3c — Grafana services bundle migrated to `withOrgFilter`.** Three services (`GrafanaInstancesService`, `GrafanaDashboardsService`, `ApplicationDashboardsService`) now resolve list-filter org scope via the shared `withOrgFilter` helper introduced in PR #175 (the dynatrace pilot). 4 canonical Bucket A sites migrated: `findAll` in all three services plus `findOne` in `ApplicationDashboardsService`. Behavior is unchanged — `orgIds === null` preserves the previous `isGlobalAdmin === true` semantics exactly, including in the existing debug logs. Per-resource throw guards, custom guard helpers (`requireOrgAdmin`, `verifyOrgAccess`), and debug-log-only `isGlobalAdmin` captures stay inline (same disposition as the dynatrace pilot). Audit progress: Bucket A migrated 1 → 5 of 127 (3.9%). See `docs/superpowers/audits/2026-04-26-audit-decisions.md` for the full per-site classification.

## [0.2.47.9] - 2026-04-29

### Fixed
- **Dynatrace query dialogs now show the permission error inline.** When a non-admin user tried to add, edit, or delete a Dynatrace query, the API correctly returned `You do not have permission to modify this Dynatrace query`, but the dialog stayed open and the error rendered in the section *behind* the dialog where the user couldn't see it. The `useDynatraceQueries` hook now tracks a separate `actionError` for create/update/delete failures and passes it into the open dialog (Add, Edit, Import, Delete, Batch Delete). The list-level `error` remains for fetch failures only. Each dialog closes with `setActionError(null)` so stale errors don't bleed across opens.

## [0.2.47.8] - 2026-04-28

### Security / Fixed
- **Authorization bypass on Dynatrace DQL queries and entity mappings (RBAC Phase 3 follow-up).** `PATCH /api/dynatrace/queries/:id`, `DELETE /api/dynatrace/queries/:id`, and `DELETE /api/dynatrace/entities/mappings/:id` had no authorization check — any authenticated user (org-member, org-viewer, even outside the parent config's org) could update or delete any DQL query or entity mapping. Confirmed in production logs: an org-member user successfully ran `[DynatraceService] Dynatrace DQL query 5715d100-… deleted successfully` against a query owned by a different ownership context. The Phase 3b pilot only covered the parent `DynatraceConfig` endpoints; the sub-resources retained stale `// Phase 4 will add organization_id` TODOs even though the columns had already been added by the broader ownership migration. **Backend change:** `updateQuery`, `deleteQuery`, `deleteEntityMapping` now load the row, verify the caller has `Capability.IntegrationDynatraceUpdate` / `IntegrationDynatraceDelete` for `existing.organizationId`, and reject pre-backfill rows (org_id IS NULL) for non-admins. Global admins still bypass via `getCapabilities` returning the global cap set. Three new regression tests in `dynatrace.service.spec.ts` cover member-deny / org-null-deny / member-deny-on-delete shapes.
- **DQL query and entity-mapping creates now persist `organization_id` / `created_by` / `updated_by`.** `createQuery`, `createQuerySmart`, `bulkImportQuery`, `createEntityMapping` previously created rows with `organization_id = NULL` (8/8 queries and 4/4 mappings in the demo DB had null org_id at fix time). New rows derive `organization_id` from the parent `DynatraceConfig` and capture the authenticated user as creator/updater. The repository surface now takes an optional `QueryOwnership` tuple and the parent-config + capability check is centralized in `DynatraceService.requireDynatraceMutationCapability` so the four create paths can't drift. Service-layer test fixtures were updated to mock the parent-config lookup; existing test coverage now asserts the ownership tuple is forwarded to the repository.
- **Backfill migration `BackfillDynatraceQueryAndMappingOwnership1777600000000`.** UPDATEs every `dynatrace_queries` and `dynatrace_entity_mappings` row that has `organization_id IS NULL`, joining on the parent config to inherit `organization_id`, `team_id`, `created_by`, `updated_by`. Without this, the new mutation guards would still let everyone touch existing rows because they're all on the legacy null-org path. Idempotent: only updates null rows. `down()` is a no-op by design — reverting would re-open the security gap; re-running `up()` after a mistaken `down` is safe.

### Notes
- The DQL query and entity-mapping DTO mappers now expose `organizationId`, `createdBy`, `updatedBy` so service-level guards can read them off the loaded row without bypassing the DTO layer. This is also a pre-requisite for the upcoming `_permissions` enrichment on these endpoints (Phase 3b extension to sub-resources, not in this release).

## [0.2.47.7] - 2026-04-28

### Changed
- **`api-keys` migrated to the capabilities API (RBAC Phase 3c, first per-service pilot).** Removed all direct `authzService.isGlobalAdmin()` calls from `apps/api/src/modules/api-keys/api-keys.service.ts` and `api-keys.controller.ts`; both files dropped from `apps/api/.rbac-migration-allowlist.json` (allowlist 40 → 38). Authorization now flows through `AuthorizationService.getCapabilities(userId, roles, organizationId)` and three new capabilities — `Capability.ApiKeyRead` / `ApiKeyCreate` / `ApiKeyDelete` — wired into `ROLE_CAPABILITIES`: org-admins get all three, org-members and org-viewers get `ApiKeyRead` only, global admins inherit everything via `GLOBAL_ADMIN_CAPABILITIES`. **Behaviour change:** create and delete are now scoped to the *target* organization (not "any org you admin"). Previously a user who was org-admin in org A but only org-member in org B could create/delete keys in B because `requireOrgAdmin` was satisfied by ANY admin role; the new `getCapabilities(userId, roles, targetOrgId)` check denies that path. Read paths return empty (not 403) when the caller lacks `ApiKeyRead` in the requested org, preserving the "don't leak org existence" property of the previous implementation. The "is global admin" check uses `Capability.SystemManageGlobalSettings` as the canonical marker — that capability is only granted via `GLOBAL_ADMIN_CAPABILITIES` so its presence is a stable proxy without re-introducing a deprecated `isGlobalAdmin()` call.
- **Privilege-escalation guard refactored.** `validateRequestedRoles(requestedRoles, creatorRoles, isGlobalAdmin)` now takes the admin bypass as an explicit pre-computed flag instead of calling `authzService.isGlobalAdmin(creatorRoles)` inline; the caller computes `isGlobalAdmin` once via `getCapabilities` and passes it down. Keeps the method synchronous and trivially testable while removing the deprecated call.
- **Default `AuthorizationService` test mock now returns `GLOBAL_ADMIN_CAPABILITIES` from `getCapabilities()`** instead of a hand-curated two-element list. Reflects the mock's stated "allows all operations" intent and means newly-migrated services get permissive defaults out of the box without per-test overrides. The restrictive mock (`createRestrictiveAuthorizationServiceMock`) still returns `[]` for capability-denial tests.

### Notes
- Migration recipe followed: bucket B sites (controller-boundary "is admin?" gates) replaced with `getCapabilities` checks scoped to the target organization. The `@RequiresCapability` decorator was evaluated for the controller layer but skipped for this pilot because most api-keys endpoints derive the org from the persisted resource (after a DB lookup), not from the request — service-layer capability checks are the correct fit for that shape. Future pilots with body/param-resolved org IDs will use the decorator.
- All 4311 api unit tests pass; 74 in `api-keys.service.spec.ts` and 59 in `api-keys.controller.spec.ts` exercised. Lint (with `no-direct-is-global-admin` enforced) clean across api-keys files.

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
