# Audit Decisions — 2026-04-26

## Migration progress

Phase 3c rolls capabilities through every site listed below. Update these counts on every PR that migrates a site (subtract from the "remaining" column, add to the "migrated" column). When all reach 0 / N, mark Phase 3 as Completed in CLAUDE.md.

| Bucket | Total | Migrated | Remaining | % done |
| --- | ---: | ---: | ---: | ---: |
| A — bypass filter | 127 | 22 | 105 | 17.3% |
| B — bypass guard | 14 | 0 | 14 | 0% |
| Local `private isGlobalAdmin()` wrappers | 13 | 1 | 12 | 7.7% |

**Lint enforcement:** `apps/api/.rbac-migration-allowlist.json` lists every file currently exempt from the `no-direct-is-global-admin` lint rule (40 files as of 2026-04-28). When a site is migrated, remove its file from the allowlist (the file may have multiple sites — only remove when the LAST one is migrated). Allowlist size IS the burndown.

**Date-bound revisit:** by **2026-08-01**, Phase 3c migration must be at least 50% complete (Bucket A + B combined: 70+ sites migrated). If not, re-evaluate the architecture or the priorities. "We forgot about it" is the failure mode this gate prevents.

**Drift check:** a `/schedule` agent runs every 2 weeks (see `docs/superpowers/scheduled-agents/rbac-drift-check.md`) and opens a PR if it finds new direct `isGlobalAdmin` usage outside the allowlist. The lint rule should make this redundant; the agent catches anything that snuck in via dependencies or merge conflicts.

---

## Codebase Audit: `isGlobalAdmin` Bucket A Sites

**Audit date:** 2026-04-26  
**Scope:** Full codebase scan for the recurring `isAdmin = isGlobalAdmin(roles); if (!isAdmin) { load orgs; filter }` pattern  
**Total Bucket A sites identified:** 127 across 20+ services  
**Pilot target:** `apps/api/src/modules/dynatrace/dynatrace.service.ts` (25 audit-flagged lines — highest density file)

---

## Phase C2 — Pilot: `dynatrace.service.ts`

### Phase C2 helper landing

**Decision: Option 2 — Standalone utility at `apps/api/src/common/utils/with-org-filter.ts`**

`DynatraceService` manages three distinct entity types (`DynatraceConfig`, `DynatraceQuery`, `DynatraceEntityMapping`) with no single primary entity, so extending `AuthorizedBaseService<T>` would require picking one type arbitrarily and either fighting the generic constraint or subclassing the wrong entity. The standalone `withOrgFilter` helper avoids that entirely: it takes a structural duck-type for `authzService` and returns `string[] | null`, letting any service call it without inheritance.

### Site Classification Table

All 25 audit-flagged lines were re-verified against the actual source code at commit time.

| Line | Method | Classification | Action |
|------|--------|---------------|--------|
| 68 | `findAll` | **CANONICAL** — `isAdmin` feeds `else if (!isAdmin)` list-filter branch | Migrate |
| 111 | `findByHost` | PER-RESOURCE — `if (!isAdmin)` checks one entity's org via `isOrganizationMember`, throws NotFoundException | Leave |
| 146 | `create` | DEBUG-LOG-ONLY — result used only in `logger.debug`, no filter/guard branch | Leave |
| 197 | `update` | PER-RESOURCE — `if (!isAdmin && existing.organizationId)` calls `isOrganizationAdmin`, throws ForbiddenException | Leave |
| 238 | `delete` | PER-RESOURCE — same per-resource admin guard shape as `update` | Leave |
| 317 | `fetchEntities` | DEBUG-LOG-ONLY | Leave |
| 461 | `fetchRequestAttributes` | DEBUG-LOG-ONLY | Leave |
| 518 | `getRequestAttributesForConfig` | DEBUG-LOG-ONLY | Leave |
| 547 | `findAllQuery` | DEBUG-LOG-ONLY | Leave |
| 569 | `findQueryBySystemAndEnvironment` | DEBUG-LOG-ONLY | Leave |
| 589 | `findQueryById` | DEBUG-LOG-ONLY | Leave |
| 616 | `createQuery` | DEBUG-LOG-ONLY | Leave |
| 648 | `createQuerySmart` | DEBUG-LOG-ONLY | Leave |
| 693 | `bulkImportQuery` | DEBUG-LOG-ONLY | Leave |
| 744 | `updateQuery` | DEBUG-LOG-ONLY | Leave |
| 774 | `deleteQuery` | DEBUG-LOG-ONLY | Leave |
| 806 | `getDistinctDashboardLabels` | DEBUG-LOG-ONLY | Leave |
| 841 | `getPanelTitlesForDashboard` | DEBUG-LOG-ONLY | Leave |
| 886 | `getEntityMappings` | DEBUG-LOG-ONLY | Leave |
| 906 | `createEntityMapping` | DEBUG-LOG-ONLY | Leave |
| 938 | `deleteEntityMapping` | DEBUG-LOG-ONLY | Leave |
| 997 | `fetchHostProperties` | DEBUG-LOG-ONLY | Leave |
| 1077 | `fetchHostMetrics` | DEBUG-LOG-ONLY | Leave |
| 1222 | `fetchHostProblems` | DEBUG-LOG-ONLY | Leave |
| 1316 | `createHostMetricQueries` | DEBUG-LOG-ONLY | Leave |

**Canonical count: 1 of 25** (audit over-counted by flagging every `isGlobalAdmin` call including debug-log-only uses).  
The 21 DEBUG-LOG-ONLY sites are `const isAdmin = ...` captures whose value is interpolated into a `logger.debug` call but never used to branch filtering logic — the entity methods that follow all have `// NOTE: ... will be added here when Phase 4 adds organization_id column` markers. The 3 PER-RESOURCE sites are per-entity guards with `throw` semantics, not list-filter bypasses.

### Migration: `findAll` (the sole canonical site)

**Before:**
```typescript
const isAdmin = this.authzService.isGlobalAdmin(roles);
this.logger.debug(`findAll: userId=${userId}, isGlobalAdmin=${isAdmin}, organizationId=${organizationId}`);
// ...
} else if (!isAdmin) {
  const accessibleOrganizations = await this.authzService.getAccessibleOrganizations(userId);
  // filter using accessibleOrganizations
}
```

**After:**
```typescript
const orgIds = await withOrgFilter(userId, roles, this.authzService);
this.logger.debug(`findAll: userId=${userId}, isGlobalAdmin=${orgIds === null}, organizationId=${organizationId}`);
// ...
} else if (orgIds !== null) {
  // filter using orgIds (already equals what accessibleOrganizations was)
}
```

Debug log preserves `isGlobalAdmin=true/false` semantics: `orgIds === null` is `true` iff the user is a global admin.

### Test Results

| Test run | Result |
|----------|--------|
| `cd apps/api && npx jest src/common/utils/with-org-filter.spec.ts` | 3 passed |
| `cd apps/api && npx jest src/modules/dynatrace` | 105 passed |
| `cd apps/api && npx jest` (full suite) | 4256 passed, 20 skipped (pre-existing), 0 failed |
| `npm run type-check` | 8/8 tasks successful, 0 errors |
| `npm run lint` | 0 errors, 254 pre-existing warnings (none in changed files) |
| `gitnexus_detect_changes` | Scope: `DynatraceService.findAll` + helper; risk: LOW; 0 affected processes |

### Files changed

- `apps/api/src/modules/dynatrace/dynatrace.service.ts` — import + `findAll` migration
- `apps/api/src/common/utils/with-org-filter.ts` — new helper
- `apps/api/src/common/utils/with-org-filter.spec.ts` — new helper spec
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file

### Implications for remaining Bucket A sites across the codebase

The 102 remaining canonical Bucket A sites in 20+ other services are **not** touched by this PR. They continue to use the original `isAdmin = isGlobalAdmin / if (!isAdmin) { load orgs; filter }` pattern which is correct and safe. Future PRs can adopt `withOrgFilter` incrementally per-service without risk.

The audit's 127-site count reflected all `isGlobalAdmin` occurrences codebase-wide, including debug-log-only captures like those in this file. The actual "canonical list-filter bypass" count across the full codebase is lower than 127; a service-by-service re-verification (as done here for dynatrace) is recommended before each per-service migration PR.

---

## Phase C3 — Bundle: Grafana services

**Audit date:** 2026-04-29
**Scope:** Three Grafana-domain services migrated as a single bundle PR following the dynatrace pilot pattern.
**Files re-verified:**
- `apps/api/src/modules/grafana/grafana-instances.service.ts`
- `apps/api/src/modules/grafana/grafana-dashboards.service.ts`
- `apps/api/src/modules/grafana/application-dashboards.service.ts`

### Site Classification Tables

**`grafana-instances.service.ts`** (8 lines flagged):

| Line | Method | Classification | Action |
|------|--------|---------------|--------|
| 47 | `requireOrgAdmin` (private) | CUSTOM-GUARD-HELPER — admin-bypass inside a private "any-org admin" guard | Leave |
| 95 | `findAll` | **CANONICAL** Bucket A | Migrate |
| 149 | `findOne` | PER-RESOURCE — `if (!isAdmin && entity.organizationId)` calls `isOrganizationMember`, throws NotFoundException | Leave |
| 194 | `create` | DEBUG-LOG-ONLY | Leave |
| 237 | `update` | PER-RESOURCE — `if (!isAdmin && entity.organizationId)` calls `isOrganizationAdmin`, throws ForbiddenException | Leave |
| 295 | `remove` | PER-RESOURCE — same per-resource admin guard shape as `update` | Leave |
| 340 | `testConnection` | DEBUG-LOG-ONLY | Leave |
| 384 | `testConnectionWithParams` | DEBUG-LOG-ONLY | Leave |

**`grafana-dashboards.service.ts`** (7 lines flagged):

| Line | Method | Classification | Action |
|------|--------|---------------|--------|
| 57 | `verifyOrgAccess` (private) | CUSTOM-GUARD-HELPER — admin-bypass inside per-resource throw helper | Leave |
| 74 | `findAll` | **CANONICAL** Bucket A | Migrate |
| 197 | `findOne` | DEBUG-LOG-ONLY | Leave |
| 252 | `create` | DEBUG-LOG-ONLY | Leave |
| 305 | `update` | DEBUG-LOG-ONLY | Leave |
| 370 | `remove` | DEBUG-LOG-ONLY | Leave |
| 409 | `getVariableValues` | DEBUG-LOG-ONLY | Leave |

**`application-dashboards.service.ts`** (7 lines flagged):

| Line | Method | Classification | Action |
|------|--------|---------------|--------|
| 113 | `findAll` | **CANONICAL** Bucket A | Migrate |
| 244 | `findOne` | **CANONICAL** Bucket A — single-row variant uses the same `isAdmin / load orgs / WHERE org_id IN (...)` shape | Migrate |
| 334 | `create` | DEBUG-LOG-ONLY (Phase 4 stub) | Leave |
| 417 | `update` | DEBUG-LOG-ONLY (Phase 4 stub) | Leave |
| 575 | `getDeleteInfo` | DEBUG-LOG-ONLY (Phase 4 stub) | Leave |
| 637 | `getBatchDeleteInfo` | DEBUG-LOG-ONLY (Phase 4 stub) | Leave |
| 683 | `delete` | DEBUG-LOG-ONLY (Phase 4 stub) | Leave |

**Canonical count: 4 of 22.** The remaining 18 lines are debug-log-only captures (interpolated into `logger.debug`), per-resource throw guards (post-load org membership checks), or admin-bypass branches inside private custom guard helpers — same categorization the dynatrace pilot established.

### Migrations applied

All four migrations follow the dynatrace pilot shape:

```typescript
// before
const isAdmin = this.authzService.isGlobalAdmin(roles);
this.logger.debug(`...isGlobalAdmin=${isAdmin}`);
// ... if (!isAdmin) { load orgs; filter }

// after
const orgIds = await withOrgFilter(userId, roles, this.authzService);
this.logger.debug(`...isGlobalAdmin=${orgIds === null}`);
// ... if (orgIds !== null) { filter using orgIds }
```

The `orgIds === null` predicate preserves the previous `isGlobalAdmin=true|false` debug-log semantics exactly — the helper returns `null` iff the user is a global admin.

### Test Results

| Test run | Result |
|----------|--------|
| `cd apps/api && npx jest src/modules/grafana` | 491 passed (7 suites) |
| `cd apps/api && npx jest` (full suite) | 4314 passed, 20 skipped (pre-existing), 0 failed |
| `npm run type-check` | 8/8 tasks successful, 0 errors |
| `npm run lint` (`@perfana/api`) | 0 errors, 59 pre-existing warnings (none introduced) |

### Files changed

- `apps/api/src/modules/grafana/grafana-instances.service.ts` — import + `findAll` migration
- `apps/api/src/modules/grafana/grafana-dashboards.service.ts` — import + `findAll` migration
- `apps/api/src/modules/grafana/application-dashboards.service.ts` — import + `findAll` + `findOne` migration
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file

### Allowlist disposition

The 3 Grafana service files **remain** in `.rbac-migration-allowlist.json`. Per the migration rule, files only exit the allowlist once the LAST direct `isGlobalAdmin` call has been removed; the 18 non-canonical sites identified above (debug-log captures, per-resource guards, custom-guard helpers) are out of scope for this PR. Same disposition as `dynatrace.service.ts` after the pilot.

---

## Phase C4 — Bundle: Pyroscope + Tracing instances

**Audit date:** 2026-04-29
**Scope:** Two single-service modules sharing the same "instance" CRUD shape as `grafana-instances.service.ts`. Migrated as one PR.
**Files re-verified:**
- `apps/api/src/modules/pyroscope/pyroscope-instances.service.ts`
- `apps/api/src/modules/tracing-instances/tracing-instances.service.ts`

### Site Classification Tables

**`pyroscope-instances.service.ts`** (8 lines flagged):

| Line | Method | Classification | Action |
|------|--------|---------------|--------|
| 49 | `requireOrgAdmin` (private) | CUSTOM-GUARD-HELPER — admin-bypass inside a private "any-org admin" guard | Leave |
| 85 | `findAll` | **CANONICAL** Bucket A | Migrate |
| 144 | `findOne` | PER-RESOURCE — `if (!isAdmin && entity.organizationId)` checks accessible orgs, throws NotFoundException | Leave |
| 186 | `create` | DEBUG-LOG-ONLY (org-admin guard handled by `requireOrgAdmin`) | Leave |
| 226 | `update` | PER-RESOURCE — same per-resource org check as `findOne` | Leave |
| 280 | `remove` | PER-RESOURCE — same shape as `update` | Leave |
| 325 | `testConnection` | DEBUG-LOG-ONLY | Leave |
| 362 | `testConnectionWithParams` | DEBUG-LOG-ONLY | Leave |

**`tracing-instances.service.ts`** (8 lines flagged):

| Line | Method | Classification | Action |
|------|--------|---------------|--------|
| 40 | `requireOrgAdmin` (private) | CUSTOM-GUARD-HELPER — admin-bypass inside a private "any-org admin" guard | Leave |
| 77 | `findAll` | **CANONICAL** Bucket A | Migrate |
| 136 | `findOne` | PER-RESOURCE | Leave |
| 178 | `create` | DEBUG-LOG-ONLY | Leave |
| 219 | `update` | PER-RESOURCE | Leave |
| 274 | `remove` | PER-RESOURCE | Leave |
| 319 | `testConnection` | DEBUG-LOG-ONLY | Leave |
| 356 | `testConnectionWithParams` | DEBUG-LOG-ONLY | Leave |

**Canonical count: 2 of 16.** The remaining 14 sites are debug-log-only captures, per-resource throw guards, or admin-bypass branches inside private custom guard helpers — same disposition as the dynatrace and grafana migrations.

### Migration shape

Both `findAll` methods had a 3-branch pattern (`organizationId && !isAdmin` / `organizationId && isAdmin` / `!isAdmin`) where the first branch made an extra `getAccessibleOrganizations` call to validate the requested org. Migrating to `withOrgFilter` collapsed this to 2 branches and eliminated the duplicate call:

```typescript
// before — 3 branches, 2 calls to getAccessibleOrganizations
const isAdmin = this.authzService.isGlobalAdmin(roles);
if (organizationId && !isAdmin) { /* validate access via accessibleOrganizations.includes */ filter; }
else if (organizationId && isAdmin) { filter; }
else if (!isAdmin) { /* load accessibleOrganizations again */ filter to accessible orgs; }

// after — 2 branches, 1 call
const orgIds = await withOrgFilter(userId, roles, this.authzService);
if (organizationId) {
  if (orgIds !== null && !orgIds.includes(organizationId)) return [];
  filter;
} else if (orgIds !== null) { filter to orgIds; }
```

Behavior verified by tracing the 5 input cases (admin / non-admin × with-orgId / no-orgId / no-access-orgId) — output matches the original branch logic exactly.

### Test Results

| Test run | Result |
|----------|--------|
| `cd apps/api && npx jest` (full suite) | 4314 passed, 20 skipped (pre-existing), 0 failed |
| `npm run type-check` | 8/8 tasks successful, 0 errors |
| `npm run lint` (`@perfana/api`) | 0 errors, 59 pre-existing warnings (none introduced) |

Note: neither `pyroscope-instances` nor `tracing-instances` has dedicated `.spec.ts` files. Coverage gap is pre-existing and out of scope; the broader API suite covers AuthorizationService and the helper.

### Files changed

- `apps/api/src/modules/pyroscope/pyroscope-instances.service.ts` — import + `findAll` migration
- `apps/api/src/modules/tracing-instances/tracing-instances.service.ts` — import + `findAll` migration
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file

### Allowlist disposition

Both files **remain** in `.rbac-migration-allowlist.json` — the 14 non-canonical `isGlobalAdmin` sites still trip the lint rule. Same disposition as the dynatrace and grafana bundles.

---

## Phase C5 — Single file: `benchmark-query.service.ts`

**Audit date:** 2026-04-29
**Scope:** Single-file migration. The signal scan (`isGlobalAdmin` × `getAccessibleOrganizations` co-occurrence) flagged this file as the highest-density canonical Bucket A target outside the already-migrated services.
**File re-verified:** `apps/api/src/modules/benchmarks/services/benchmark-query.service.ts`

### Site Classification

| Line | Method | Classification | Action |
|------|--------|---------------|--------|
| 48 | `findAll` | **CANONICAL** Bucket A — `if (!isAdmin) { load orgs; filter by sut.organization_id }` | Migrate |
| 138 | `findOne` | PER-RESOURCE — `if (!isAdmin)` checks `isOrganizationMember` for the loaded row's SUT, returns null on deny | Leave |
| 191 | `getSystemEnvironmentsAndWorkloads` | **CANONICAL** Bucket A — same shape as `findAll`, scoped to a single SUT | Migrate |
| 242 | `getBenchmarkTagSyncStatus` | **CANONICAL** Bucket A — admin-vs-non-admin split with raw SQL parameterized by `orgIds` | Migrate |
| 290 | `syncTagsWithApplicationDashboards` | DEBUG-LOG-ONLY (Phase 4 stub — operates on all benchmarks via stored procedure) | Leave |

**Canonical count: 3 of 5.** Highest density per-file in this Phase 3c rollout so far (60% canonical vs ~5–25% in earlier bundles).

### Migration shape

The `findAll` and `getSystemEnvironmentsAndWorkloads` migrations follow the established pattern (swap `isAdmin = isGlobalAdmin / if (!isAdmin) { load orgs; filter }` → `orgIds = await withOrgFilter(...) / if (orgIds !== null) { filter }`).

The `getBenchmarkTagSyncStatus` migration is the more interesting case: it has separate non-admin and admin code paths (raw SQL with `orgIds` parameter for non-admin, simpler raw SQL for admin). The `orgIds === null` predicate cleanly maps the original `if (!isAdmin)` branch to `if (orgIds !== null)` — no semantic change, the admin path on the `else`-equivalent runs unchanged.

Also fixed: `findAll` previously logged ` (admin)` vs ` (filtered by organizations)` based on the now-removed `isAdmin` variable. Replaced with `orgIds === null` for the same observable behavior.

### Test Results

| Test run | Result |
|----------|--------|
| `cd apps/api && npx jest src/modules/benchmarks` | 116 passed (2 suites) |
| `cd apps/api && npx jest` (full suite) | 4314 passed, 20 skipped (pre-existing), 0 failed |
| `npm run type-check` | 8/8 tasks successful, 0 errors |
| `npm run lint` (`@perfana/api`) | 0 errors, 59 pre-existing warnings (none introduced) |

### Files changed

- `apps/api/src/modules/benchmarks/services/benchmark-query.service.ts` — import + 3 method migrations
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file

### Allowlist disposition

The file **remains** in `.rbac-migration-allowlist.json` — the 2 non-canonical `isGlobalAdmin` sites (per-resource guard at line 138, debug-log-only at line 290) still trip the lint rule. Same disposition as every prior Phase 3c migration.

---

## Phase C6 — Single file: `report-data-fetcher.service.ts`

**Audit date:** 2026-04-29
**Scope:** Single-file migration. The signal scan flagged this file as the **highest-density target outside test-runs hot path** — every `isGlobalAdmin` site paired 1:1 with a `getAccessibleOrganizations` call (8/8 = 100% canonical density), the strongest signal seen so far in Phase 3c.
**File re-verified:** `apps/api/src/modules/reports/services/report-data-fetcher.service.ts`

### Site Classification

All 8 `isGlobalAdmin` sites are **CANONICAL Bucket A — `skipOrgFilter` variant.** The shape across all 8 was uniform:

```typescript
const skipOrgFilter = !userId || this.authzService.isGlobalAdmin(roles);
let organizationIds: string[] = [];
if (!skipOrgFilter) {
  organizationIds = await this.authzService.getAccessibleOrganizations(userId);
}
const orgFilter = !skipOrgFilter
  ? this.buildOrganizationFilterClause(N, organizationIds, alias)
  : { clause: '', params: [] };
```

The `!userId` short-circuit captures internal/system calls (anonymous/non-user-context invocations bypass org filtering). The `isGlobalAdmin(roles)` short-circuit is the standard admin bypass.

| Line | Method | Variant | Action |
|------|--------|---------|--------|
| 381 | `getRampUpCutoffTime` | Single derivation, paramStart=2 | Migrate via `resolveOrgFilter` |
| 424 | `getScenarioDataFromDatabase` | Single derivation, paramStart=3 | Migrate via `resolveOrgFilter` |
| 527 | `getApdexData` | Single derivation, paramStart=4 | Migrate via `resolveOrgFilter` |
| 753 | `getThroughputStats` | **Triple derivation** (orgFilter + orgFilterCte + orgFilterJoin), shared organizationIds, paramStart=4 | Migrate inline via `withOrgFilter` |
| 914 | `getVirtualUserStats` | **Double derivation** (orgFilter + orgFilterJoinClause), shared organizationIds, paramStart=4 | Migrate inline via `withOrgFilter` |
| 1558 | `getRecentTestRuns` | Single derivation, paramStart=5 | Migrate via `resolveOrgFilter` |
| 1679 | `getMetricsTimeSeries` | Loop over panels with dynamic paramIdx per iteration | Migrate inline via `withOrgFilter` |
| 1772 | `getAvailableMetricsPanels` | Custom `EXISTS(...)` orgClause shape, organizationIds resolved inside the `if` block, paramStart=2 | Migrate inline via `withOrgFilter` |

**Canonical count: 8 of 8 (100%).** Every site was a list-filter bypass — no debug-log-only, no per-resource guards, no custom guard helpers.

### Migration approach

Two-tier strategy:

1. **New private helper `resolveOrgFilter(userId, roles, paramStart, alias)`** — wraps `withOrgFilter` + the existing `buildOrganizationFilterClause` for the most common case (single derivation + no special clause shape). Returns `{ clause, params }` directly. Used at 4 sites (single-derivation, no custom shape).

2. **Inline `withOrgFilter`** at 4 sites that don't fit `resolveOrgFilter`'s assumption: multi-derivation sites that share `orgIds` across multiple filter clauses (753, 914), and sites with custom clause shapes (1679 loop, 1772 EXISTS). These replace `skipOrgFilter` with `orgIds === null` and reuse `orgIds` as needed.

`resolveOrgFilter` (helper, ~11 lines):
```typescript
private async resolveOrgFilter(userId, roles, paramStartIndex, testRunAlias = 'tr') {
  if (!userId) return { clause: '', params: [] };
  const orgIds = await withOrgFilter(userId, roles, this.authzService);
  if (orgIds === null) return { clause: '', params: [] };
  return this.buildOrganizationFilterClause(paramStartIndex, orgIds, testRunAlias);
}
```

### Test Results

| Test run | Result |
|----------|--------|
| `cd apps/api && npx jest src/modules/reports` | 446 passed (16 suites) |
| `cd apps/api && npx jest` (full suite) | 4314 passed, 20 skipped (pre-existing), 0 failed |
| `npm run type-check` | 8/8 tasks successful, 0 errors |
| `npm run lint` (`@perfana/api`) | 0 errors, 59 pre-existing warnings (none introduced) |

### Net diff

- Lines removed: 76
- Lines added: 47 (including the 17-line `resolveOrgFilter` helper)
- **Net -29 lines** despite adding the new helper

### Files changed

- `apps/api/src/modules/reports/services/report-data-fetcher.service.ts` — import + new `resolveOrgFilter` helper + 8 site migrations
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file

### Allowlist disposition

This file **EXITS the allowlist** — the 8 migrated sites were the only `isGlobalAdmin` calls in the file. After this PR, the file has zero direct `isGlobalAdmin` references, so the lint rule's exemption can be removed. **First file to fully exit the allowlist** since the Phase 3c rollout began. Allowlist size: 38 → 37.

---

## Phase C7 — Single file: `report-generation.service.ts` — first multi-bucket migration

**Audit date:** 2026-04-29
**Scope:** Single-file migration, sibling to the just-merged `report-data-fetcher.service.ts` (PR #192). Touches **three different audit buckets** in one PR — first PR to reduce the "Local wrappers" counter from its 0/13 starting point.
**File re-verified:** `apps/api/src/modules/reports/services/report-generation.service.ts`

### Site Classification

Total `isGlobalAdmin` references: 7. Two distinct shape categories:

**Local wrapper (1 site)**
| Line | Type | Action |
|------|------|--------|
| 138 | `private isGlobalAdmin(roles)` returning `roles.some(role => ADMIN_ROLES.includes(role))` | **Remove** — duplicates `authzService.isGlobalAdmin`. The local `ADMIN_ROLES = ['perfana-admin','super-admin','admin']` constant (line 26) was the wrapper's only consumer; remove that too. |

**Per-resource ACL helpers (2 sites)**
| Line | Method | Original shape | Migration |
|------|--------|---------------|-----------|
| 168 | `isTestRunAccessible` | Loaded testRun, then `if (!userId \|\| isAdmin) return accessible; if (!testRunOrgId) return accessible; load orgs; check membership` | **Migrate to `AuthorizationService.canAccessResource`.** Preserves `!userId` short-circuit explicitly (canAccessResource would deny anonymous calls). Passes `team_id: undefined` to preserve the prior behavior of not checking team membership. |
| 219 | `isReportAccessible` | Same shape, `report.test_run.organizationId` as the org | Same migration via `canAccessResource`. |

**List-filter Bucket A (4 sites)**
| Line | Method | Variant | Migration |
|------|--------|---------|-----------|
| 460 | `findAll` | `if (!isAdmin) { load orgs; if empty → empty list; else apply filter }` | `withOrgFilter` + `orgIds === null` for admin, `orgIds.length === 0` for empty-list early exit |
| 513 | `findByTestRunId` | Same | Same |
| 575 | `getSummary` | Same but returns empty summary object | Same |
| 671 | `getPendingReports` | Same but returns empty array | Same |

**Canonical Bucket A: 4. Local wrapper: 1. Per-resource ACL refactors: 2.**

### Migration approach: 3-tier strategy

1. **Wrapper removal.** Delete the private `isGlobalAdmin` method and the `ADMIN_ROLES` constant. Both unused after the per-resource helpers migrate to `canAccessResource`.

2. **Per-resource → `AuthorizationService.canAccessResource`.** The two private helpers `isTestRunAccessible` / `isReportAccessible` previously inlined the admin/legacy/membership checks. They now delegate to `canAccessResource` which already implements all three. Each helper preserves a `!userId` short-circuit (anonymous calls bypass auth — preserved from the original semantics, since `canAccessResource` would deny when it can't find the user in any org). `team_id` is intentionally omitted to preserve the prior behavior of not checking team membership for these resources.

3. **List-filter sites → `withOrgFilter`.** The 4 sites use the standard `orgIds === null` (admin) / `orgIds.length === 0` (empty-list early exit) pattern. The internal `applyReportOrganizationFilter` query-builder helper takes `organizationIds: string[]` so we pass `orgIds` (now `string[] | null`) directly when non-null.

### Test fixture update

The existing `report-generation.service.spec.ts` mock for `AuthorizationService` had `isGlobalAdmin` and `getAccessibleOrganizations` but lacked `canAccessResource`. Added: `canAccessResource: jest.fn().mockResolvedValue({ allowed: true, reason: 'mocked' })`. 10 spec failures (all in `findById`/`updateStatus`/`storeHtmlContent`/`incrementRetryCount`/`delete`/`generateHtml` — methods routed through `isReportAccessible` or `isTestRunAccessible`) became 10 passes. No production-code change driven by this — spec just needed to mock the now-called method.

### Test Results

| Test run | Result |
|----------|--------|
| `cd apps/api && npx jest src/modules/reports` | 446 passed (16 suites) |
| `cd apps/api && npx jest` (full suite) | 4314 passed, 20 skipped (pre-existing), 0 failed |
| `npm run type-check` | 8/8 tasks successful, 0 errors |
| `npm run lint` (`@perfana/api`) | 0 errors, 59 pre-existing warnings (none introduced) |

### Net diff

- Lines removed: 119
- Lines added: 71 (including the 1-line spec mock update)
- **Net -48 lines** — biggest reduction yet, driven by replacing two inlined per-resource ACL helpers with delegation to the centralized `canAccessResource`

### Files changed

- `apps/api/src/modules/reports/services/report-generation.service.ts` — wrapper removal + 2 per-resource refactors + 4 list-filter migrations
- `apps/api/src/modules/reports/__tests__/report-generation.service.spec.ts` — add `canAccessResource` mock
- `apps/api/.rbac-migration-allowlist.json` — remove the file entry
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file

### Allowlist disposition

This file **EXITS the allowlist** — zero direct `isGlobalAdmin` references after the migration. **Second file to fully exit** the allowlist since Phase 3c began. Allowlist size: 37 → 36.
