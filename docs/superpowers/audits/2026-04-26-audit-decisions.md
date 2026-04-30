# Audit Decisions — 2026-04-26

## Migration progress

Phase 3c rolls capabilities through every site listed below. Update these counts on every PR that migrates a site (subtract from the "remaining" column, add to the "migrated" column). When all reach 0 / N, mark Phase 3 as Completed in CLAUDE.md.

| Bucket | Total | Migrated | Remaining | % done |
| --- | ---: | ---: | ---: | ---: |
| A — bypass filter | 127 | 41 | 86 | 32.3% |
| B — bypass guard | 14 | 6 | 8 | 42.9% |
| Local `private isGlobalAdmin()` wrappers | 13 | 2 | 11 | 15.4% |

**Lint enforcement:** `apps/api/.rbac-migration-allowlist.json` lists every file currently exempt from the `no-direct-is-global-admin` lint rule (30 files as of 2026-04-30). When a site is migrated, remove its file from the allowlist (the file may have multiple sites — only remove when the LAST one is migrated). Allowlist size IS the burndown.

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

---

## Phase C8 — Single file: `metrics-sources.service.ts`

**Audit date:** 2026-04-29
**Scope:** Single-file migration. Mid-density target outside the test-runs hot path: 6 `isGlobalAdmin` call sites across CRUD methods, 5 `getAccessibleOrganizations` calls. Same module shape as `grafana-instances.service.ts` (CRUD + per-resource throw guards).
**File re-verified:** `apps/api/src/modules/metrics-sources/metrics-sources.service.ts`

### Site Classification

| Line | Method | Classification | Action |
|------|--------|---------------|--------|
| 53 | `findAll` | **CANONICAL** Bucket A — `if (!isAdmin) { load orgs; if empty → org_id IS NULL; else IN (orgs) OR NULL }` | Migrate |
| 112 | `findOne` | **CANONICAL** Bucket A — single-row variant of the same shape | Migrate |
| 151 | `findByApplicationDashboardId` | **CANONICAL** Bucket A — same shape, sub-select on dashboard_uid | Migrate |
| 185 | `create` | DEBUG-LOG-ONLY — `isAdmin` only interpolated into `logger.debug`, no branch | Leave |
| 225 | `update` | PER-RESOURCE — `if (!isAdmin && existing.organizationId)` calls `accessibleOrgs.includes(...)`, throws ForbiddenException | Leave |
| 269 | `delete` | PER-RESOURCE — same per-resource throw guard shape as `update` | Leave |

**Canonical count: 3 of 6 (50%).** The remaining 3 sites are 1 debug-log capture and 2 per-resource throw guards — same disposition as the dynatrace, grafana, and pyroscope/tracing bundles.

### Migration shape

All 3 canonical sites share the identical "include null-org rows" filter block — important for backward compat with legacy null-`organization_id` rows (Phase 4 will close the null-org gap, at which point this branch becomes deletable):

```typescript
// before
const isAdmin = this.authzService.isGlobalAdmin(roles);
this.logger.debug(`...isGlobalAdmin=${isAdmin}`);
if (!isAdmin) {
  const accessibleOrgs = await this.authzService.getAccessibleOrganizations(userId);
  if (accessibleOrgs.length === 0) qb.andWhere('ms.organizationId IS NULL');
  else qb.andWhere('(ms.organizationId IN (:...orgIds) OR ms.organizationId IS NULL)', { orgIds: accessibleOrgs });
}

// after
const orgIds = await withOrgFilter(userId, roles, this.authzService);
this.logger.debug(`...isGlobalAdmin=${orgIds === null}`);
if (orgIds !== null) {
  if (orgIds.length === 0) qb.andWhere('ms.organizationId IS NULL');
  else qb.andWhere('(ms.organizationId IN (:...orgIds) OR ms.organizationId IS NULL)', { orgIds });
}
```

The `orgIds === null` predicate preserves the original `isGlobalAdmin=true|false` debug-log semantics exactly. Null-org-row inclusion behavior is unchanged.

### Test Results

| Test run | Result |
|----------|--------|
| `cd apps/api && npx jest src/modules/metrics-sources` | 34 passed (2 suites) |
| `cd apps/api && npx jest` (full suite) | 4314 passed, 20 skipped (pre-existing), 0 failed |
| `npm run type-check` | 8/8 tasks successful, 0 errors |
| `npm run lint` (`@perfana/api`) | 0 errors, 59 pre-existing warnings (none introduced) |

The existing spec uses `createAuthorizationServiceMock()` whose `isGlobalAdmin` defaults to `true` — so `withOrgFilter` returns `null` and the filter branch is skipped, matching the prior behavior. No spec changes were needed.

### Files changed

- `apps/api/src/modules/metrics-sources/metrics-sources.service.ts` — import + 3 method migrations
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file

### Allowlist disposition

The file **remains** in `.rbac-migration-allowlist.json` — the 3 non-canonical `isGlobalAdmin` sites (debug-log-only at 185, per-resource guards at 225 and 269) still trip the lint rule. Same disposition as the dynatrace, grafana, and pyroscope/tracing bundles.

---

## Phase C9 — Single file: `adapt.service.ts` — second multi-bucket migration

**Audit date:** 2026-04-29
**Scope:** Single-file migration. The signal scan flagged this file as the highest-density target with a local wrapper still in place — 8 `isGlobalAdmin` call sites all routed through a private `isGlobalAdmin` wrapper, every site paired 1:1 with a `loadAccessibleOrganizations` (also a local wrapper) call. **8/8 = 100% canonical density**, matching the strongest signal seen so far in Phase 3c.
**File re-verified:** `apps/api/src/modules/adapt/adapt.service.ts`

### Site Classification

Total `isGlobalAdmin` references: 9 (1 wrapper definition + 8 call sites). Two distinct shape categories:

**Local wrapper (1 site)**
| Line | Type | Action |
|------|------|--------|
| 104 | `private isGlobalAdmin(roles)` returning `this.authzService.isGlobalAdmin(roles)` | **Remove** — trivial passthrough. The sibling `private loadAccessibleOrganizations(userId)` (line 111) is the same shape (passthrough to `authzService.getAccessibleOrganizations`); both are removed together since both lose all callers after the migration. |

**Per-resource access guards (8 sites)**

The shape across all 8 sites was uniform — a per-resource guard built on top of `validateTestRunAccess`:

```typescript
const isAdmin = this.isGlobalAdmin(roles);
const organizationIds = isAdmin ? [] : await this.loadAccessibleOrganizations(userId);
this.logger.log(`... ${isAdmin ? ' (admin)' : ` (orgs: ${organizationIds.length})`}`);
if (!isAdmin && organizationIds.length === 0) return EMPTY;
const hasAccess = await this.validateTestRunAccess(testRunId, isAdmin, organizationIds);
if (!hasAccess) return EMPTY;
```

`validateTestRunAccess` itself was a SQL helper: `isAdmin → return true`, `orgIds.length === 0 → return false`, else run a `SELECT 1 FROM test_runs WHERE org_id = ANY($2)` parameterized query. The list-filter happens *inside* the helper — it's effectively Bucket A list-filter, not Bucket B throw-guard.

| Line | Method | Variant | Action |
|------|--------|---------|--------|
| 282 | `getTrackedRegressions` | Standard shape | Migrate via `withOrgFilter` |
| 385 | `getTrackedRegressionsCount` | Standard shape | Same |
| 418 | `resolveTrackedRegressionsByTestRun` | Standard shape (returns `{success: false, ...}`) | Same |
| 499 | `resolveTrackedRegression` | Pre-load lookup before validate; reuses `regression.test_run_id` | Same |
| 571 | `getTrackedDifferencesChart` | Standard shape (returns `[]`) | Same |
| 639 | `getCorrelatedRegressions` | Standard shape (returns `[]`) | Same |
| 723 | `getDsAdaptConclusion` | Standard shape (returns `null`) | Same |
| 755 | `getEnrichedConclusion` | Standard shape (returns `null`) | Same |

**Canonical Bucket A: 8. Local wrappers removed: 1 + 1 sibling (`loadAccessibleOrganizations`).**

### Migration approach: 2-step refactor

1. **Wrapper removal.** Delete `private isGlobalAdmin` and `private loadAccessibleOrganizations`. Both are trivial passthroughs with no other callers after step 2.

2. **`validateTestRunAccess` signature change.** Change `(testRunId, isAdmin: boolean, organizationIds: string[])` → `(testRunId, orgIds: string[] | null)`. Internally, the dispatch is now sentinel-driven: `orgIds === null` → admin bypass, `orgIds.length === 0` → deny, else SQL filter. This collapses two parameters into one and matches `withOrgFilter`'s return contract directly — the helper's caller can pass through `orgIds` without unpacking.

3. **8 site migrations.** Standard pattern: replace the 3-line preamble (`isAdmin = ...; organizationIds = isAdmin ? [] : ...; logger.log(...)`) with a single-line `orgIds = await withOrgFilter(...)` and a log line keyed off `orgIds === null`. The early-exit predicate `!isAdmin && organizationIds.length === 0` becomes `orgIds !== null && orgIds.length === 0`, preserving the `null → never early-exit` admin bypass exactly. The `validateTestRunAccess(testRunId, isAdmin, organizationIds)` call becomes `validateTestRunAccess(testRunId, orgIds)`.

### Test fixture compatibility

The existing `adapt.service.spec.ts` uses `createAuthorizationServiceMock()` whose `isGlobalAdmin` defaults to `true`. Post-migration, `withOrgFilter` evaluates that mock first and returns `null` — same effective admin behavior. The 93 pre-existing tests pass unchanged (none of them mock or assert against `loadAccessibleOrganizations` or the now-removed local `isGlobalAdmin`).

### Test Results

| Test run | Result |
|----------|--------|
| `cd apps/api && npx jest src/modules/adapt` | 93 passed (1 suite) |
| `cd apps/api && npx jest` (full suite) | 4314 passed, 20 skipped (pre-existing), 0 failed |
| `npm run type-check` | 8/8 tasks successful, 0 errors |
| `npm run lint` (`@perfana/api`) | 0 errors, 59 pre-existing warnings (none introduced) |

### Net diff

- Lines removed: 63 (the two wrapper bodies + per-site preambles)
- Lines added: 37 (single-line `withOrgFilter` calls + new `validateTestRunAccess` signature + log-line updates)
- **Net -26 lines.** Smaller than C6/C7 because the per-site preamble was already terser here (3 lines vs. 6 in `report-data-fetcher`), so the `string[] | null` sentinel had less code to collapse. Same root-cause shape, different starting point.

### Files changed

- `apps/api/src/modules/adapt/adapt.service.ts` — 2 wrapper removals + `validateTestRunAccess` signature refactor + 8 site migrations
- `apps/api/.rbac-migration-allowlist.json` — remove the file entry
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file

### Allowlist disposition

This file **EXITS the allowlist** — zero direct `isGlobalAdmin` references after the migration. **Third file to fully exit** the allowlist since Phase 3c began (after `report-data-fetcher.service.ts` in C6 and `report-generation.service.ts` in C7). Allowlist size: 36 → 35.

---

## Phase C10 — Single file: `events.service.ts`

**Audit date:** 2026-04-29
**Scope:** Single-file migration. Mid-density target: 3 `isGlobalAdmin` call sites, 2 `getAccessibleOrganizations` calls. Same module shape as `metrics-sources.service.ts` (CRUD + per-resource throw guard) — the C8 migration's twin.
**File re-verified:** `apps/api/src/modules/events/events.service.ts`

### Site Classification

| Line | Method | Classification | Action |
|------|--------|---------------|--------|
| 27 | `findAll` | **CANONICAL** Bucket A — `if (!isAdmin) { load orgs; filter org_id IN (...) OR IS NULL }` | Migrate |
| 71 | `findByTestRun` | **CANONICAL** Bucket A — same shape, scoped to a test run's SUT/environment time window | Migrate |
| 113 | `findOne` | PER-RESOURCE — `if (!isAdmin && event.organizationId)` calls `isOrganizationMember`, throws NotFoundException | Leave |

**Canonical count: 2 of 3 (66%).** The remaining site is a per-resource throw guard — same disposition as the dynatrace, grafana, pyroscope/tracing, and metrics-sources bundles.

### Migration shape

Both canonical sites had an identical "include null-org rows" filter block with a sentinel-UUID hack for empty org lists (Postgres `IN ()` is invalid; passing the all-zeros UUID guarantees no match):

```typescript
// before
const isAdmin = this.authzService.isGlobalAdmin(roles);
if (!isAdmin) {
  const orgIds = await this.authzService.getAccessibleOrganizations(userId);
  qb.andWhere(
    '(e.organization_id IN (:...orgIds) OR e.organization_id IS NULL)',
    { orgIds: orgIds.length > 0 ? orgIds : ['00000000-0000-0000-0000-000000000000'] },
  );
}

// after
const orgIds = await withOrgFilter(userId, roles, this.authzService);
if (orgIds !== null) {
  qb.andWhere(
    '(e.organization_id IN (:...orgIds) OR e.organization_id IS NULL)',
    { orgIds: orgIds.length > 0 ? orgIds : ['00000000-0000-0000-0000-000000000000'] },
  );
}
```

Same body, just `orgIds` lifted out of the conditional. Null-org-row inclusion behavior unchanged. Sentinel-UUID hack preserved.

### Test Results

| Test run | Result |
|----------|--------|
| `cd apps/api && npx jest src/modules/events` | 19 passed (2 suites) |
| `cd apps/api && npx jest` (full suite) | 4314 passed, 20 skipped (pre-existing), 0 failed |
| `npm run type-check` (`@perfana/api`) | 0 errors |
| `npm run lint` (`@perfana/api`) | 0 errors, 59 pre-existing warnings (none introduced) |

### Files changed

- `apps/api/src/modules/events/events.service.ts` — import + 2 method migrations
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file

### Allowlist disposition

The file **remains** in `.rbac-migration-allowlist.json` — the per-resource throw guard at line 113 (now 112 after the migration's net line reduction) still trips the lint rule. Same disposition as the metrics-sources bundle (C8); when Phase 3 introduces a generalized per-resource guard refactor (e.g., delegate to `canAccessResource`), this file can fully exit then.

---

## Phase C11 — Single file: `compare-presets.service.ts`

**Audit date:** 2026-04-29
**Scope:** Single-file migration. 6 `isGlobalAdmin` references (1 helper-internal + 5 method-level). The methods use `isAdmin` for varied combinations of log decoration, list-filter WHERE clauses, per-resource throw guards, and per-row access loops — making this the most heterogeneous single-file migration in the C-series so far.
**File re-verified:** `apps/api/src/modules/compare-presets/compare-presets.service.ts`

### Site Classification

| Line | Method | Role of `isAdmin` | Migration approach |
|------|--------|-------------------|--------------------|
| 34 | `validateTestRunAccess` (helper) | Internal admin bypass + load-orgs + SQL filter | **Refactor signature** to `(testRunId, orgIds: string[] | null)` — same C9 adapt pattern |
| 64 | `create` | Log decoration + skip per-resource validates for admins | `withOrgFilter` + `orgIds === null` |
| 129 | `findAll` | Log + WHERE clause (admins see all presets) + per-row access loop over global presets | `withOrgFilter`, reuse `orgIds` across loop iterations (small optimization vs the prior code which re-called `getAccessibleOrganizations` per iteration through the helper) |
| 256 | `findOne` | Log + per-resource validate skip (only check non-owned globals for non-admins) | `withOrgFilter` |
| 320 | `update` | Log + per-resource validate skip for new test run reference | `withOrgFilter` |
| 404 | `remove` | **Log decoration only** — no behavioral branch | **Drop the ` (admin)` log tag** rather than add a wasteful `withOrgFilter` call |

**All 6 sites migrated. File fully exits the allowlist.**

### Migration approach: 3-tier strategy

1. **Helper signature change** (line 34). Same as the C9 adapt pilot: `validateTestRunAccess(testRunId, userId, roles)` → `validateTestRunAccess(testRunId, orgIds: string[] | null)`. Internal dispatch is now sentinel-driven.

2. **Standard `withOrgFilter` migration** (4 sites: 64, 129, 256, 320). Replace `const isAdmin = isGlobalAdmin(roles); ...; if (!isAdmin)` with `const orgIds = await withOrgFilter(...); ...; if (orgIds !== null)`. Log lines key on `orgIds === null`. The 2 `validateTestRunAccess` calls at each site become `(testRunId, orgIds)`.

3. **Log-only site treatment** (line 404). The `remove` method's `isAdmin` was used solely for ` (admin)` log tag decoration — no behavioral consequence. Adding a `withOrgFilter` call here for the sole purpose of preserving the tag would be a wasted async call (and still triggers a `getAccessibleOrganizations` for non-admins). The pragmatic choice: drop the log tag. Loses minimal diagnostic value (the actual access decision happens in `findOne` which is called from `remove` and would surface its own admin tag). This is the first "drop the log tag" decision in the C-series — worth flagging as a precedent for similar log-only sites in future migrations.

### Per-row loop optimization (incidental)

The pre-migration `findAll` called `validateTestRunAccess(presetId, userId, roles)` inside a `for (const preset of filteredData)` loop. Each call re-evaluated `isGlobalAdmin(roles)` and re-fetched `getAccessibleOrganizations(userId)` from cache. Post-migration, the caller computes `orgIds` once outside the loop and passes the same value into each `validateTestRunAccess(presetId, orgIds)` call. Cache lookups are now bypassed entirely inside the loop.

For workloads with many global presets per user, this is a small but real reduction in `AuthorizationService` traffic. Not the goal of this migration — but a free side-benefit of the sentinel pattern.

### Test fixture compatibility

The existing `compare-presets.service.spec.ts` has explicit `validateTestRunAccess (via create)` test coverage at line 1588 covering the admin bypass, non-admin with orgs, and non-admin with empty orgs paths. The mock `AuthorizationService` defaults `isGlobalAdmin` to a role-based implementation and `getAccessibleOrganizations` to `['org-1']`. Post-migration:

- Admin path: `isGlobalAdmin` returns `true` → `withOrgFilter` returns `null` → `validateTestRunAccess(testRunId, null)` returns `true`. ✅
- Non-admin with orgs: `isGlobalAdmin` returns `false` → `withOrgFilter` returns `['org-1']` → `validateTestRunAccess` runs SQL with those orgs. ✅
- Non-admin no orgs: `isGlobalAdmin` returns `false` → `withOrgFilter` returns `[]` → `validateTestRunAccess(testRunId, [])` returns `false`. ✅

All 121 compare-presets tests pass without spec changes.

### Test Results

| Test run | Result |
|----------|--------|
| `cd apps/api && npx jest src/modules/compare-presets` | 121 passed (2 suites) |
| `cd apps/api && npx jest` (full suite) | 4314 passed, 20 skipped (pre-existing), 0 failed |
| `npm run type-check` (`@perfana/api`) | 0 errors |
| `npm run lint` (`@perfana/api`) | 0 errors, 59 pre-existing warnings (none introduced) |

### Net diff

- Lines removed: 35
- Lines added: 28
- **Net -7 lines.** Modest size reduction; the heterogeneous shape (5 different uses of `isAdmin` across 5 methods) limits the per-line wins compared to the more uniform C9/C10 migrations.

### Files changed

- `apps/api/src/modules/compare-presets/compare-presets.service.ts` — import + helper refactor + 5 site migrations (1 with log-tag drop)
- `apps/api/.rbac-migration-allowlist.json` — remove the file entry
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file

### Allowlist disposition

This file **EXITS the allowlist** — zero direct `isGlobalAdmin` references after the migration. **Fourth file to fully exit** the allowlist since Phase 3c began (after `report-data-fetcher.service.ts` C6, `report-generation.service.ts` C7, and `adapt.service.ts` C9). Allowlist size: 35 → 34.

---

## Phase C12 — Single file: `awr-reports.controller.ts` — first pure Bucket B migration

**Audit date:** 2026-04-29
**Scope:** Single-file migration. **First Phase 3c PR to migrate Bucket B (bypass guard) sites** rather than Bucket A (bypass filter). Both `isGlobalAdmin` references in this file are inside private per-resource access guard helpers (`if (isGlobalAdmin) return true; ... membership check`) — the canonical Bucket B shape, not the list-filter Bucket A shape `withOrgFilter` was designed for.
**File re-verified:** `apps/api/src/modules/awr/controllers/awr-reports.controller.ts`

### Site Classification

| Line | Helper | Shape |
|------|--------|-------|
| 102 | `validateTestRunAccess` | Per-resource guard: admin bypass → SQL lookup of test run's SUT → null-org backward compat → `isOrganizationMember` |
| 121 | `validateReportAccess` | Same shape, raw SQL chain `awr_reports → test_runs → systems_under_test` to find org_id |

**Both sites: Bucket B (per-resource access guards). 2 of 14 Bucket B sites migrated codebase-wide.**

### Migration approach: delegate to `canAccessResource`

`AuthorizationService.canAccessResource(userId, roles, resource: OwnedResource)` already implements all three branches the helpers were inlining:

1. Global admin bypass (returns `{allowed: true, reason: 'global admin'}`)
2. Legacy null-org backward compat (returns `{allowed: true, reason: 'no organization'}`)
3. Organization membership check (returns `{allowed: <bool>, reason: ...}`)

Each helper now:

1. Loads the resource (test run via repo, report via raw SQL — same lookups as before)
2. Calls `canAccessResource(ctx.userId, ctx.roles, { organization_id: <looked-up>, created_by: '' } as OwnedResource)`
3. Returns `result.allowed`

Same shape as the C7 `report-generation` per-resource refactors — uses the C7-established `created_by: '' as OwnedResource` cast pattern (the `OwnedResource` interface requires `created_by: string`, but `canAccessResource` only reads it from `canModifyResource`'s code path; passing `''` is safe and the cast satisfies TypeScript).

### Why this is Bucket B, not Bucket A

`withOrgFilter` returns the user's accessible org IDs (or `null` for admin) and is designed for **list filtering** — turning a "WHERE org_id IN (...) OR org_id IS NULL" filter into a sentinel-driven branch. These helpers do something different: they **already know the resource ID**, look up its org, and check the user's membership against that single org. The "list of accessible orgs" abstraction adds nothing here — the question is "is the user a member of THIS org?", not "what orgs can the user see?".

`canAccessResource` is the right tool. Same lookup pattern; the centralized service handles all three policy branches the helpers were inlining manually.

### Optimization: drop the unused upfront `isGlobalAdmin` check

Pre-migration, each helper started with `if (isGlobalAdmin(roles)) return true;` to short-circuit before doing the resource lookup. Post-migration, the resource lookup happens unconditionally and `canAccessResource` does the admin check after. For admin users this trades a single role array check (zero I/O) for a database lookup — a small regression for the admin happy path.

The trade-off is intentional and matches C7's pattern. The clarity win (one centralized auth policy across the codebase) outweighs the per-call cost, and the admin lookup is fast (single-row by primary key, repository-cached). If admin-bypass-before-lookup proves measurable in a hot path, `canAccessResource` itself can be refactored to take a deferred resource loader — but that change should be made in the centralized service, not duplicated in every per-resource helper.

### Test Results

| Test run | Result |
|----------|--------|
| `cd apps/api && npx jest src/modules/awr` | 402 passed (9 suites) |
| `cd apps/api && npx jest` (full suite) | 4314 passed, 20 skipped (pre-existing), 0 failed |
| `npm run type-check` (`@perfana/api`) | 0 errors |
| `npm run lint` (`@perfana/api`) | 0 errors, 59 pre-existing warnings (none introduced) |

The AWR module has no controller-level tests — the existing 402 tests cover parsers, analyzers, and utilities. The two helpers are exercised in production via the controller's endpoint methods but not unit-tested directly. No spec changes needed.

### Net diff

- Lines removed: 13
- Lines added: 18
- **Net +5 lines.** First Phase 3c migration that grew the file. The growth comes from the explanatory comment block in front of the `canAccessResource` call (clarifying why `team_id` is omitted and `created_by` is empty — this is the same pattern as C7's report-generation refactor). The migration trades a few lines of inline policy for a centralized delegation; the lookup logic stays the same. Net cost is acceptable in exchange for one fewer place where the admin / null-org / membership policy is hand-rolled.

### Files changed

- `apps/api/src/modules/awr/controllers/awr-reports.controller.ts` — import `OwnedResource` + 2 helper migrations
- `apps/api/.rbac-migration-allowlist.json` — remove the file entry
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file

### Allowlist disposition

This file **EXITS the allowlist** — zero direct `isGlobalAdmin` references after the migration. **Fifth file to fully exit** the allowlist since Phase 3c began (after `report-data-fetcher.service.ts` C6, `report-generation.service.ts` C7, `adapt.service.ts` C9, and `compare-presets.service.ts` C11). Allowlist size: 34 → 33.

---

## Phase C13 — Single file: `alert-tag-filters.service.ts` — first single-file migration to use BOTH `withOrgFilter` and `canAccessResource`

**Audit date:** 2026-04-29
**Scope:** Single-file migration. Small file (87 lines) with one Bucket A list-filter site and one Bucket B per-resource guard site. **First Phase 3c PR to apply both migration tools — `withOrgFilter` and `canAccessResource` — to a single file in one PR.** Useful as a reference for future multi-bucket files where both shapes coexist.
**File re-verified:** `apps/api/src/modules/alerts/alert-tag-filters.service.ts`

### Site Classification

| Line | Method | Bucket | Tool |
|------|--------|--------|------|
| 17 | `findAll` | **A** — list-filter `if (!isAdmin) { load orgs; filter org_id IN OR IS NULL }` | `withOrgFilter` |
| 40 | `findOne` | **B** — per-resource guard `if (!isGlobalAdmin && filter.organizationId) { isOrganizationMember; throw }` | `canAccessResource` |

**Both sites migrated. File fully exits the allowlist.**

### Migration shape

**Bucket A site (`findAll`):** Same pattern as C8 metrics-sources, C10 events. The `org_id IN (...) OR IS NULL` clause and the empty-orgs sentinel-UUID hack are preserved verbatim — only the outer admin gate changes from `if (!isAdmin)` to `if (orgIds !== null)`.

**Bucket B site (`findOne`):** Same pattern as C12 awr-reports. The original code had a subtlety: `if (!isGlobalAdmin(roles) && filter.organizationId)` — the `&& filter.organizationId` short-circuit meant filters with `null` org were allowed for non-admins (legacy backward compat by accident, since the membership check was skipped entirely). `canAccessResource` codifies this explicitly via its "Resource has no organization (legacy data)" branch — same observable behavior, different code structure.

### Why split tools across the file

For files where one method does list filtering and another does per-resource access, using one tool everywhere is the wrong call:

- Forcing `findOne` to use `withOrgFilter` would require manually re-implementing the org-membership-check logic against `orgIds`. That's exactly what `canAccessResource` already does, and duplicating it loses the centralization benefit.
- Forcing `findAll` to use `canAccessResource` per-row would turn a single SQL query with an `IN (...)` filter into N+1 membership checks. That's a real regression.

The buckets exist for a reason. C13 demonstrates that one PR can cleanly use both.

### Test Results

| Test run | Result |
|----------|--------|
| `cd apps/api && npx jest` (full suite) | 4314 passed, 20 skipped (pre-existing), 0 failed |
| `npm run type-check` (`@perfana/api`) | 0 errors |
| `npm run lint` (`@perfana/api`) | 0 errors, 59 pre-existing warnings (none introduced) |

The alerts module has no `.spec.ts` files; the alert-tag-filters service is exercised in production via its controller endpoints but not unit-tested directly. No spec changes needed.

### Net diff

- Lines removed: 8
- Lines added: 13
- **Net +5 lines.** Same shape and same growth-magnitude as C12 awr-reports — the explanatory comment block in front of the `canAccessResource` call adds the lines. Acceptable trade for centralized policy.

### Files changed

- `apps/api/src/modules/alerts/alert-tag-filters.service.ts` — imports + 2 site migrations
- `apps/api/.rbac-migration-allowlist.json` — remove the file entry
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file

### Allowlist disposition

This file **EXITS the allowlist** — zero direct `isGlobalAdmin` references after the migration. **Sixth file to fully exit** the allowlist since Phase 3c began (after `report-data-fetcher.service.ts` C6, `report-generation.service.ts` C7, `adapt.service.ts` C9, `compare-presets.service.ts` C11, and `awr-reports.controller.ts` C12). Allowlist size: 33 → 32.

---

## Phase C14 — Single file: `events.service.ts` finish — first split-PR finish

**Audit date:** 2026-04-30
**Scope:** Single-file finishing migration. C10 migrated the 2 Bucket A list-filter sites (`findAll`, `findByTestRun`) and left 1 Bucket B per-resource guard at `findOne` line 112. C14 closes that last site, fully exiting the file from the allowlist. **First Phase 3c PR to "finish" a file that an earlier C-series PR partially migrated** — establishes a precedent for low-cost follow-up PRs that complete files left partially-migrated by earlier work.
**File re-verified:** `apps/api/src/modules/events/events.service.ts`

### Site Classification

| Line | Method | Bucket | Tool |
|------|--------|--------|------|
| 112 | `findOne` | **B** — per-resource guard `if (!isGlobalAdmin && event.organizationId) { isOrganizationMember; throw }` | `canAccessResource` |

**Single site migrated. File fully exits the allowlist.**

### Migration shape

Same pattern as C12 awr-reports and C13 alert-tag-filters' `findOne`:

```typescript
// before
if (!this.authzService.isGlobalAdmin(roles) && event.organizationId) {
  const hasAccess = await this.authzService.isOrganizationMember(userId, event.organizationId);
  if (!hasAccess) {
    throw new NotFoundException(`Event ${id} not found`);
  }
}

// after
const result = await this.authzService.canAccessResource(userId, roles, {
  organization_id: event.organizationId,
  created_by: '',
} as OwnedResource);
if (!result.allowed) {
  throw new NotFoundException(`Event ${id} not found`);
}
```

Same `&& filter.organizationId` short-circuit-as-backward-compat semantics as C13 — `canAccessResource` codifies it via "Resource has no organization (legacy data)" branch.

### Spec update required

Unlike C12 (no controller spec) and C13 (no alerts spec), `events.service.ts` has 4 explicit `findOne` tests in `events.service.spec.ts`:

1. "should return event for global admin" — used `isGlobalAdmin.mockReturnValue(true)`. Post-migration the call goes through `canAccessResource` instead. Default mock `canAccessResource: jest.fn().mockResolvedValue({ allowed: true, reason: 'mocked' })` makes this pass without explicit setup.

2. "should throw NotFoundException if event not found" — unchanged (event-not-found case throws before the auth check).

3. "should check org membership for non-admin" — was asserting `isOrganizationMember` was called with `('user-1', mockEvent.organizationId)`. Updated to assert `canAccessResource` was called with `('user-1', ['user'], { organization_id: mockEvent.organizationId, ... })`.

4. "should throw NotFoundException for non-admin without org access" — was mocking `isOrganizationMember.mockResolvedValue(false)`. Updated to mock `canAccessResource.mockResolvedValue({ allowed: false, reason: 'denied' })`.

The base `AuthorizationService` mock provider (line 82) gained `canAccessResource: jest.fn().mockResolvedValue({ allowed: true, reason: 'mocked' })` so the default path works without explicit setup.

### "Finish" PR precedent

C-series PRs so far have either fully migrated a file (C6/C7/C9/C11/C12/C13) or partially migrated it and left some sites in the allowlist (C8 metrics-sources, C10 events). The "left some sites" disposition was always pragmatic: the partial migration covered the canonical Bucket A list-filter sites, but per-resource Bucket B sites were deferred until the `canAccessResource` pattern was established (C12).

C14 closes the loop. With `canAccessResource` now established as the standard tool for per-resource guards (C12, C13), partially-migrated files can be cheaply finished. The pattern is:

1. Find a file that's still in the allowlist with a single Bucket B site remaining
2. Migrate the site to `canAccessResource`
3. Update spec mocks to expect `canAccessResource` instead of `isOrganizationMember`
4. File exits the allowlist

This makes "finishing" partially-migrated files a fast follow-up category. After C14, the partially-migrated files in the allowlist are: `metrics-sources.service.ts` (3 sites: 1 debug-log, 2 per-resource), `dynatrace.service.ts` (24 debug-log + per-resource sites), `grafana/application-dashboards.service.ts`, `grafana/grafana-dashboards.service.ts`, `grafana/grafana-instances.service.ts`, `pyroscope/pyroscope-instances.service.ts`, `tracing-instances/tracing-instances.service.ts`, `benchmark-query.service.ts`. Each is a candidate for a future "finish" PR following the C14 precedent.

### Test Results

| Test run | Result |
|----------|--------|
| `cd apps/api && npx jest src/modules/events` | 19 passed (2 suites) |
| `cd apps/api && npx jest` (full suite) | 4314 passed, 20 skipped (pre-existing), 0 failed |
| `npm run type-check` (`@perfana/api`) | 0 errors |
| `npm run lint` (`@perfana/api`) | 0 errors, 59 pre-existing warnings (none introduced) |

### Net diff

- Lines removed: 5
- Lines added: 10
- **Net +5 lines** (service). Plus +5/-3 in the spec for the mock additions and assertion updates.

### Files changed

- `apps/api/src/modules/events/events.service.ts` — import `OwnedResource` + 1 site migration
- `apps/api/src/modules/events/events.service.spec.ts` — add `canAccessResource` mock + update 2 `findOne` test assertions
- `apps/api/.rbac-migration-allowlist.json` — remove the file entry
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file

### Allowlist disposition

This file **EXITS the allowlist** — zero direct `isGlobalAdmin` references after the migration. **Seventh file to fully exit** the allowlist since Phase 3c began (after C6, C7, C9, C11, C12, and C13). Allowlist size: 32 → 31.

---

## Phase C15 — Single file: `metrics-sources.service.ts` finish (+ shared mock fix)

**Audit date:** 2026-04-30
**Scope:** Second "finish PR" following the C14 precedent. C8 (PR #195) migrated the 3 Bucket A list-filter sites in `metrics-sources.service.ts` and left 3 sites: `create` (debug-log only), `update` and `delete` (per-resource throw guards). C15 closes all 3, fully exiting the file. **Also fixes a latent bug in the shared `createAuthorizationServiceMock` factory** that was previously dormant — `canAccessResource` and `canModifyResource` were mocked as boolean (`mockResolvedValue(true)`), but the real methods return `AuthorizationResult` (`{ allowed, reason }`).
**Files re-verified:** `apps/api/src/modules/metrics-sources/metrics-sources.service.ts`, `apps/api/test/mocks/authorization-service.mock.ts`

### Site Classification

| Line | Method | Role of `isAdmin` | Migration approach |
|------|--------|-------------------|--------------------|
| 183 | `create` | **Log decoration only** — no behavioral consequence | Drop the ` (admin)` log tag (C11 precedent), rename `roles` → `_roles` |
| 223 | `update` | Log decoration + per-resource guard via `getAccessibleOrganizations + accessibleOrgs.includes(orgId)` | Drop log tag + delegate guard to `canAccessResource` |
| 267 | `delete` | Same as `update` | Same |

**All 3 sites migrated. File fully exits the allowlist.**

### Why `canAccessResource`, not `canModifyResource`

The original guards in `update` and `delete` used `getAccessibleOrganizations + accessibleOrgs.includes(orgId)` — i.e., "is the user a member of any role in this org?" That's read-membership semantics. `canAccessResource` matches this exactly. `canModifyResource` would tighten to org-admin or team-admin, which would be a behavior change. C15 preserves the existing semantics, deferring the org-admin tightening to a separate decision (likely Phase 4 or a dedicated audit).

This is the first single-file C-series migration where the choice between `canAccessResource` and `canModifyResource` was ambiguous from the call site (write operation, but member-level guard). The decision is documented inline in the code so future reviewers don't have to re-derive it.

### Shared mock fix (latent bug)

`apps/api/test/mocks/authorization-service.mock.ts` exports `createAuthorizationServiceMock()` used by 10+ specs. Two of its methods were mocked with the wrong return shape:

```typescript
// before (wrong shape)
canAccessResource: jest.fn().mockResolvedValue(true),
canModifyResource: jest.fn().mockResolvedValue(true),

// after (matches AuthorizationResult)
canAccessResource: jest.fn().mockResolvedValue({ allowed: true, reason: 'Mock: access allowed' }),
canModifyResource: jest.fn().mockResolvedValue({ allowed: true, reason: 'Mock: modify allowed' }),
```

The `restrictiveAuthorizationServiceMock` factory had the same bug for the `false` case — also fixed.

The bug was dormant because no consumer of the shared factory was exercising `canAccessResource` or `canModifyResource` until this PR. C7 and C14 (`report-generation` and `events`) used custom inline mocks with the correct shape, so they sidestepped the bug. C15 is the first migration to use the shared factory through one of these methods, so the fix lands here. All 10 consumers benefit going forward.

### Test fixture compatibility

`metrics-sources.service.spec.ts` uses `createAuthorizationServiceMock()` directly. With the shared mock fixed, the default `canAccessResource: { allowed: true, ... }` covers the admin happy path for all `update`/`delete` tests without per-test overrides. Pre-existing tests (34 in metrics-sources, including 4 update + 3 delete tests) pass unchanged — the mock now correctly conveys that the migrated `canAccessResource` calls succeed for the default-admin test setup.

### Subtle near-miss: shadow `result` variable

The `update` method already has a `const result = await this.findOne(id, ...)` near the end. Initially the migration introduced a second `const result = await this.authzService.canAccessResource(...)` earlier in the same try-block — TypeScript caught the duplicate declaration immediately, but Jest surfaced it first as a parse error in dependent specs. Renamed the new variable to `accessResult` to avoid the shadow.

### Test Results

| Test run | Result |
|----------|--------|
| `cd apps/api && npx jest src/modules/metrics-sources` | 34 passed (2 suites) |
| `cd apps/api && npx jest` (full suite) | 4314 passed, 20 skipped (pre-existing), 0 failed |
| `npm run type-check` (`@perfana/api`) | 0 errors |
| `npm run lint` (`@perfana/api`) | 0 errors, 59 pre-existing warnings (none introduced) |

The shared mock fix did not break any of the 10 consuming specs — confirmed by the full-suite green result.

### Net diff

- `metrics-sources.service.ts`: +23 / -19 = **net +4 lines**
- `authorization-service.mock.ts`: +8 / -6 = **net +2 lines**
- **Total net +6 lines.** Same growth pattern as C12/C13/C14 — the explanatory comment block in front of `canAccessResource` is the dominant driver.

### Files changed

- `apps/api/src/modules/metrics-sources/metrics-sources.service.ts` — import `OwnedResource` + 3 site migrations (1 log-tag drop + 2 `canAccessResource` delegations)
- `apps/api/test/mocks/authorization-service.mock.ts` — fix `canAccessResource` and `canModifyResource` mock shapes in both happy and restrictive factories
- `apps/api/.rbac-migration-allowlist.json` — remove the file entry
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file

### Allowlist disposition

This file **EXITS the allowlist** — zero direct `isGlobalAdmin` references after the migration. **Eighth file to fully exit** the allowlist since Phase 3c began (after C6, C7, C9, C11, C12, C13, and C14). Allowlist size: 31 → 30.
