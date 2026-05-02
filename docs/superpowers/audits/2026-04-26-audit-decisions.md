# Audit Decisions — 2026-04-26

## Migration progress

Phase 3c rolls capabilities through every site listed below. Update these counts on every PR that migrates a site (subtract from the "remaining" column, add to the "migrated" column). When all reach 0 / N, mark Phase 3 as Completed in CLAUDE.md.

| Bucket | Total | Migrated | Remaining | % done |
| --- | ---: | ---: | ---: | ---: |
| A — bypass filter | 131 | 70 | 61 | 53.4% |
| B — bypass guard | 43 | 42 | 1 | 97.7% |
| Local `private isGlobalAdmin()` wrappers | 13 | 8 | 5 | 61.5% |

**Lint enforcement:** `apps/api/.rbac-migration-allowlist.json` lists every file currently exempt from the `no-direct-is-global-admin` lint rule (1 file as of 2026-05-02). When a site is migrated, remove its file from the allowlist (the file may have multiple sites — only remove when the LAST one is migrated). Allowlist size IS the burndown.

**Bucket A total adjusted upward by 2 in C30 and 2 in C31:** C30 enumerates the user-owned `findAll` list-filter sites in `graph-presets.service.ts` and `trends-presets.service.ts` that were not in the original audit (which focused on org-owned resources). C31 enumerates the membership-filtered `findAll` sites in `teams.service.ts` and `organizations.service.ts` — these are filtered by org membership rather than `organization_id IN (...)` and were not in the original audit either.

**Bucket B total adjusted upward by 3 in C17, 1 in C25, 4 in C30, 10 in C31, 6 in C32, 1 in C33, and 4 in C34:** C17 brings dynatrace per-resource sites in-scope (originally "Leave" until `canAccessResource`/`canModifyResource` shipped). C25 adds `verifyTestRunAccess` from `test-runs-query.service.ts`. C30 adds the 4 user-owned per-resource sites in graph/trends-presets. C31 enumerates 10 per-resource guard sites across `teams.service.ts` and `organizations.service.ts`. C32 enumerates 6 per-resource guard sites in `systems-under-test.service.ts` (`createSut`, `findOne`, `findSystemSummary`, `findByName`, `update`, `remove`) — the file's per-resource shape was not in the original audit's enumeration despite C31's prediction that "no upward adjustment expected". C33 promotes the `requireOrgAdmin` custom-guard-helper in `profiles.service.ts` from its original "Leave" classification (line 143 of the C2 enumeration) to a counted Bucket B site, since the migration removes its inline `isGlobalAdmin` call. C34 promotes the 4 helper-passing sites in `dynatrace.service.ts` (`createQuery`, `createQuerySmart`, `bulkImportQuery`, `createEntityMapping`) from their original DEBUG-LOG-ONLY classification (lines 616, 648, 693, 906 of the C2 enumeration) — they were also forwarding `isAdmin` to `requireDynatraceMutationCapability` for the capability bypass, which the C2 enumeration missed; the helper refactor removes that pathway and the inline `isGlobalAdmin` call sites with it.

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

---

## Phase C16 — Bundle: 6 files exiting in one PR + new `canAdministerAnyOrganization` primitive

**Audit date:** 2026-04-30
**Scope:** **Largest single C-series PR.** Bundles all six "finish" candidates remaining from C2–C8 partial migrations into one PR. Six files exit the allowlist simultaneously. Also introduces a new `AuthorizationService.canAdministerAnyOrganization` method to centralize the "global admin OR any-org admin" pattern that three services were re-implementing.
**Files migrated:**

- `apps/api/src/modules/benchmarks/services/benchmark-query.service.ts` (C5 leftovers)
- `apps/api/src/modules/grafana/application-dashboards.service.ts` (C3 leftovers, debug-log only)
- `apps/api/src/modules/grafana/grafana-dashboards.service.ts` (C3 leftovers)
- `apps/api/src/modules/grafana/grafana-instances.service.ts` (C3 leftovers)
- `apps/api/src/modules/pyroscope/pyroscope-instances.service.ts` (C4 leftovers)
- `apps/api/src/modules/tracing-instances/tracing-instances.service.ts` (C4 leftovers)

### New primitive: `AuthorizationService.canAdministerAnyOrganization(userId, roles)`

The C2–C4 instance services (`grafana-instances`, `pyroscope-instances`, `tracing-instances`) each had a private `requireOrgAdmin` helper with identical shape:

```typescript
private async requireOrgAdmin(userId: string, roles: string[]): Promise<void> {
  if (this.authzService.isGlobalAdmin(roles)) return;
  const isOrgAdmin = await this.authzService.isOrgAdminInAnyOrganization(userId);
  if (!isOrgAdmin) throw new ForbiddenException(...);
}
```

This is the "global admin OR any-org admin" pattern — used to gate write operations that aren't scoped to a specific organization yet (CRUD on instance/source services where the resource doesn't carry the user's org). The duplicated logic was three subtly-different inline implementations of the same policy.

C16 adds `AuthorizationService.canAdministerAnyOrganization(userId, roles): Promise<AuthorizationResult>` that centralizes this. Each `requireOrgAdmin` helper collapses to:

```typescript
private async requireOrgAdmin(userId: string, roles: string[]): Promise<void> {
  const result = await this.authzService.canAdministerAnyOrganization(userId, roles);
  if (!result.allowed) throw new ForbiddenException(...);
}
```

The shared mock factory (`apps/api/test/mocks/authorization-service.mock.ts`) was updated to include `canAdministerAnyOrganization` in both happy and restrictive variants, with the same `{ allowed, reason }` shape established in C15.

### Site Classification (across all 6 files)

| File | Sites Migrated | Tools Used |
|------|---------------|------------|
| benchmark-query | findOne (per-resource) + syncTagsWithApplicationDashboards (log-tag drop) | `canAccessResource` + log-tag drop |
| application-dashboards | 5 debug-log-only sites (`create`, `update`, `getDeleteInfo`, `getBatchDeleteInfo`, `delete`) | log-tag drop only |
| grafana-dashboards | `verifyOrgAccess` helper + 5 debug-log sites | `canAccessResource` + log-tag drop |
| grafana-instances | `requireOrgAdmin` helper + `findOne` + `update` + `remove` + 2 testConnection log-drops | `canAdministerAnyOrganization`, `canAccessResource`, **`canModifyResource`** (org-admin role check), log-tag drop |
| pyroscope-instances | `requireOrgAdmin` + `findOne` + `update` + `remove` + 2 testConnection log-drops | `canAdministerAnyOrganization`, `canAccessResource` (member-level, NOT canModifyResource — see below), log-tag drop |
| tracing-instances | Same shape as pyroscope | Same |

### Why grafana-instances uses `canModifyResource` but pyroscope/tracing use `canAccessResource`

This is the most subtle decision in C16 and worth documenting. The pre-migration `update`/`remove` per-resource guards differed across the three instance services:

- **`grafana-instances.service.ts`**: `if (!isAdmin && entity.organizationId) { isOrganizationAdmin(userId, entity.organizationId) }` — admin-of-the-org required. Migrate to `canModifyResource` (which checks org-admin role).
- **`pyroscope-instances.service.ts`** and **`tracing-instances.service.ts`**: `if (!isAdmin && entity.organizationId) { getAccessibleOrganizations + accessibleOrganizations.includes(orgId) }` — member-of-the-org sufficient. Migrate to `canAccessResource` (which checks org membership at any role).

**Preserving observable semantics is the priority.** Tightening pyroscope/tracing to `canModifyResource` would deny modify access to non-admin org members who can currently modify these resources. That's a behavior change deferred for separate discussion (likely Phase 4 or a dedicated review). Inline comments document the choice at each call site so future reviewers understand why two seemingly-identical migrations use different tools.

### Spec update required: grafana-dashboards "deny" path

The `findOne` deny test at `grafana-dashboards.service.spec.ts:1734` was asserting that `getAccessibleOrganizations.mockResolvedValue(['org-other'])` would deny access to a dashboard in `org-restricted`. Post-migration, the deny verdict comes directly from `canAccessResource` instead. Updated to:

```typescript
authzService.canAccessResource.mockResolvedValue({
  allowed: false,
  reason: `User ${mockUserId} does not have access to this resource`,
});
```

The other three tests in the same describe block (legacy null org, member access, admin bypass) all pass unchanged — the default `canAccessResource: { allowed: true }` mock from `createAuthorizationServiceMock()` covers them.

### Subtle near-miss: variable shadowing + parameter rename slip

Two real bugs caught during verification, both worth noting:

1. **Variable shadowing in `metrics-sources` (C15) reprised here**: I introduced `const result = await canAccessResource(...)` while a `const result = await this.findOne(...)` was already in scope. TypeScript caught it but Jest's babel-mode parse error surfaced first as a misleading "Missing semicolon" in dependent specs. Renamed to `accessResult` / `modifyResult` proactively across all C16 files.

2. **`_roles` rename slip in `application-dashboards` `update`**: I aggressively renamed unused `roles` → `_roles` for the 5 debug-log-only methods. But `update`'s body still called `this.findOne(id, userId, roles)` later. Tests caught it as `ReferenceError: roles is not defined`. Reverted that one rename. The audit pattern: only rename `roles` → `_roles` when **no other body reference exists** — including downstream method calls.

### Test Results

| Test run | Result |
|----------|--------|
| `cd apps/api && npx jest src/modules/grafana` | 491 passed (7 suites) |
| `cd apps/api && npx jest src/modules/benchmarks` | passed |
| `cd apps/api && npx jest src/modules/pyroscope` (no spec) | n/a |
| `cd apps/api && npx jest src/modules/tracing-instances` (no spec) | n/a |
| `cd apps/api && npx jest` (full suite) | 4314 passed, 20 skipped (pre-existing), 0 failed |
| `npm run type-check` (`@perfana/api`) | 0 errors |
| `npm run lint` (`@perfana/api`) | 0 errors, 59 pre-existing warnings (none introduced) |

### Net diff (per file)

- `authorization.service.ts`: +40 / -0 = +40 (new method)
- `authorization-service.mock.ts`: +8 / -0 = +8 (new mock entry in both factories)
- `benchmark-query.service.ts`: +14 / -18 = -4
- `application-dashboards.service.ts`: +8 / -18 = -10
- `grafana-dashboards.service.ts`: +15 / -13 = +2
- `grafana-dashboards.service.spec.ts`: +5 / -2 = +3
- `grafana-instances.service.ts`: +38 / -50 = -12
- `pyroscope-instances.service.ts`: +38 / -47 = -9
- `tracing-instances.service.ts`: +38 / -48 = -10
- `.rbac-migration-allowlist.json`: 0 / -6 = -6 (six file entries removed)
- **Total: +204 / -202 = net +2 lines**

The new method body and explanatory comment blocks balance against the deleted inline policy code and dropped log tags. **First C-series migration to net flat at the line level despite touching 6 production files plus the auth service plus the mock factory plus a spec.** The new abstraction pulled its weight.

### Files changed (10 total)

- `apps/api/src/common/services/authorization.service.ts` — add `canAdministerAnyOrganization`
- `apps/api/src/modules/benchmarks/services/benchmark-query.service.ts`
- `apps/api/src/modules/grafana/application-dashboards.service.ts`
- `apps/api/src/modules/grafana/grafana-dashboards.service.ts`
- `apps/api/src/modules/grafana/grafana-dashboards.service.spec.ts` — update deny-path test mock
- `apps/api/src/modules/grafana/grafana-instances.service.ts`
- `apps/api/src/modules/pyroscope/pyroscope-instances.service.ts`
- `apps/api/src/modules/tracing-instances/tracing-instances.service.ts`
- `apps/api/test/mocks/authorization-service.mock.ts` — add `canAdministerAnyOrganization` in both factories
- `apps/api/.rbac-migration-allowlist.json` — remove 6 entries
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file

### Allowlist disposition

**Six files EXIT the allowlist simultaneously.** Cumulative exits since Phase 3c began: 8 → **14**. Allowlist size: 30 → **24**. Bucket B: 6 → 13 of 14 (92.9%) — Bucket B is now nearly complete; the lone remaining Bucket B site is `users.controller.ts`, which is a privilege-gate (admin OR org-admin) rather than a resource access check, and may need a different abstraction.

---

## Phase C17 — Partial migration: `dynatrace.service.ts` per-resource sites only

**Audit date:** 2026-04-30
**Scope:** Partial migration. The original C2 pilot intentionally migrated only `findAll` (1 site of 25) and deferred the rest, classifying 3 sites as PER-RESOURCE ("Leave") and 21 as DEBUG-LOG-ONLY ("Leave"). C17 closes the 3 PER-RESOURCE sites now that `canAccessResource`/`canModifyResource` is established. The 21 debug-log-only sites are **not** touched in this PR — see "Why partial" below.
**File re-verified:** `apps/api/src/modules/dynatrace/dynatrace.service.ts` (1500+ lines)

### Site Classification

| Line | Method | Migration approach |
|------|--------|--------------------|
| 188 | `findByHost` | `canAccessResource` (per-resource read guard, throws NotFoundException) |
| 282 | `update` | `canModifyResource` (per-resource org-admin check, throws ForbiddenException) |
| 322 | `delete` | `canModifyResource` (same as update) |

**3 sites migrated. ~21 debug-log-only sites and ~5 internal `isAdmin`-passing sites unchanged.** File **stays in the allowlist.**

### Subtle: preserving the `isAdmin` derivation in `findByHost`

`findByHost` uses `isAdmin` downstream at line 211 (post-migration):

```typescript
if (isAdmin || config.organizationId == null) {
  return attachPermissions(this.maskConfig(config), { update: true, delete: true });
}
// otherwise derive from per-org capabilities
```

This is a different branching question than per-resource access — it's "what permissions does this user have on this resource for the response payload?". The original code short-circuited admin/null-org to "all mutations allowed" and otherwise looked up capabilities.

The migration preserves this exactly by deriving `isAdmin` from the just-computed `accessResult`:

```typescript
const isAdmin = accessResult.reason === 'User has global admin privileges';
```

This is a brittle string-match bridge — a future refactor should expose `isGlobalAdmin` more cleanly via `AuthorizationResult` (e.g. `result.isGlobalAdmin: boolean`), but that's a separate concern from C17's scope. Documented inline so the next maintainer doesn't have to figure it out.

### Why partial: the bulk-drop cautionary tale

Initial attempt: a perl one-shot to drop the 21 debug-log-only sites in bulk by matching the `const isAdmin = ...; this.logger.debug(...isGlobalAdmin=${isAdmin}...);` pattern. **The script worked but was too aggressive** — it removed `const isAdmin = ...` declarations that had **downstream usages** in the same scope:

- Line 211 (`findByHost`): `if (isAdmin || config.organizationId == null)` — the permissions-attach branch
- Lines 705, 744, 802, 1038: `requireDynatraceMutationCapability(... isAdmin ...)` — a private helper that takes `isAdmin: boolean` to bypass capability checks
- Lines 857, 898, 1079: more `if (!isAdmin)` blocks scattered through the queries module

After the bulk drop, those references became `ReferenceError: isAdmin is not defined`. Reverted and re-scoped C17 to **just the 3 per-resource sites**.

The remaining 21 debug-log-only sites are now mixed with non-trivial `isAdmin` users. To finish the file in a future PR, each one needs to be classified (truly debug-log-only vs has-downstream-use) and migrated individually. This is more work than a "finish PR" should be — the file may need a dedicated multi-PR cleanup or a deeper refactor of `requireDynatraceMutationCapability` to drop its `isAdmin` parameter entirely.

**Lesson for future bulk drops:** the `const isAdmin = ...; debug(...);` pattern only matches if `isAdmin` is *truly local-only*. Verify with a downstream-reference check before running the script. The C16 dynatrace-style files (grafana-instances, pyroscope-instances, etc.) had this property because their `isAdmin` was always confined to the immediate method scope; this file has cross-method helper plumbing that does not.

### Test Results

| Test run | Result |
|----------|--------|
| `cd apps/api && npx jest src/modules/dynatrace` | 114 passed (2 suites) |
| `cd apps/api && npx jest` (full suite) | 4314 passed, 20 skipped (pre-existing), 0 failed |
| `npm run type-check` (`@perfana/api`) | 0 errors |
| `npm run lint` (`@perfana/api`) | 0 errors, 59 pre-existing warnings (none introduced) |

### Net diff

- `dynatrace.service.ts`: +30 / -30 = **net 0 lines.** Migrating 3 inline policy blocks to `canAccessResource`/`canModifyResource` calls + explanatory comments roughly balanced the deleted `const isAdmin` lines and old `if`-blocks.

### Files changed

- `apps/api/src/modules/dynatrace/dynatrace.service.ts` — import `OwnedResource` + 3 site migrations (`findByHost`, `update`, `delete`)
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file

### Allowlist disposition

The file **remains** in `.rbac-migration-allowlist.json` — 21 debug-log-only sites + 5 internal `isAdmin`-passing sites still trip the lint rule. Allowlist size unchanged at 24. Burndown: Bucket B 13 → 16 of 17 (94.1%) (total adjusted upward by 3 to account for dynatrace's per-resource sites that were originally classified as "Leave" but are now in-scope after `canAccessResource`/`canModifyResource` was established).


---

## Phase C25 — Single file: `test-runs-query.service.ts` finish + new `withTeamFilter` helper

**Audit date:** 2026-05-02
**Scope:** Single-file migration. All 3 `isGlobalAdmin` sites in `apps/api/src/modules/test-runs/services/test-runs-query.service.ts` (366 lines) closed in one PR. File **exits the lint allowlist** (12 → 11). First Phase 3c migration to mix all three primitives — `canAccessResource` (one site), `withOrgFilter` (one site), and the new `withTeamFilter` helper introduced in this PR (one site).

### Site Classification

| Line | Method | Migration approach |
|------|--------|--------------------|
| 83 | `verifyTestRunAccess` | `canAccessResource` — per-resource read guard. Mirrors `data-science.controller.ts` `verifyTestRunAccess` (already migrated). Loads `organization_id, created_by` from `test_runs`, defers admin/null-org/membership policy to `canAccessResource`. Preserves the silent-return-on-missing behavior so the downstream service still owns the 404. |
| 264 | `resolveOrganizationIds` (private helper) | `withOrgFilter` — admin → null collapsed to `[]` so the existing sub-service contract (`empty array = no filter`) is preserved. The helper itself stays — it adds the `organizationId` explicit-filter shortcut on top of `withOrgFilter`. |
| 276 | `resolveTeamIds` (private helper) | `withTeamFilter` (NEW) — symmetric `null` for admin / `string[]` for everyone else. Same null-collapse to `[]` as above. |

### New utility: `withTeamFilter`

File: `apps/api/src/common/utils/with-team-filter.ts` (24 lines incl. doc comment).

Mirror of `withOrgFilter` for team membership. Same structural duck-type for `authzService` (just `isGlobalAdmin` + `getAccessibleTeams`), same `string[] | null` return contract. Permanently exempt from the `no-direct-is-global-admin` lint rule via `INFRASTRUCTURE_FILES` in `apps/api/eslint-rules/no-direct-is-global-admin.js`, alongside `withOrgFilter`. Cost is one new tiny module; benefit is symmetry plus a target for future migrations of the four other call sites that currently use `getAccessibleTeams` directly without an admin bypass (e.g. `test-runs-crud-query.service.ts:53,205,329,885`, `systems-under-test.service.ts:189`).

### Test Results

| Test run | Result |
|----------|--------|
| `cd apps/api && npx jest src/modules/test-runs` | 766 passed (19 suites) |
| `cd apps/api && npx jest` (full suite) | 4309 passed, 20 skipped (pre-existing), 0 failed |
| `npm run type-check` (`@perfana/api`) | 0 errors |
| `npm run lint` (`@perfana/api`) | 0 errors, 59 pre-existing warnings (none introduced) |

No spec changes required: `test-runs-query.service.spec.ts` uses the shared `createAuthorizationServiceMock()` factory (which already provides `canAccessResource`/`getAccessibleOrganizations`/`getAccessibleTeams`) and does not assert directly on `verifyTestRunAccess`. The `data-science.controller.spec.ts` mocks reference *its* own `verifyTestRunAccess` private method (which was migrated separately in C19), not the query service one.

### Net diff

- `with-team-filter.ts`: +24 lines (new file)
- `test-runs-query.service.ts`: +14 / -10 = **net +4 lines** — one extra explanatory comment per migrated helper accounts for most of the growth.
- `eslint-rules/no-direct-is-global-admin.js`: +1 line (`with-team-filter.ts` added to `INFRASTRUCTURE_FILES`)
- `.rbac-migration-allowlist.json`: -1 line

### Files changed

- `apps/api/src/common/utils/with-team-filter.ts` — new utility
- `apps/api/src/modules/test-runs/services/test-runs-query.service.ts` — 3 site migrations
- `apps/api/eslint-rules/no-direct-is-global-admin.js` — exempt `with-team-filter.ts`
- `apps/api/.rbac-migration-allowlist.json` — remove `test-runs-query.service.ts`
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file

### Allowlist disposition

The file **EXITS** the allowlist — zero direct `isGlobalAdmin` references after the migration. Allowlist size: 12 → **11**. (The audit doc has detailed phase entries through C17 only; the C18–C24 PRs trimmed the allowlist from 24 down to 12 without writing per-phase sections in this file, so a precise "Nth exit" count would require reading those commit messages.)


---

## Phase C26 — Single file: `test-runs-dashboard-query.service.ts` finish + `roles → isAdmin` parameter swap

**Audit date:** 2026-05-02
**Scope:** Single-file migration. Drops the `private isGlobalAdmin` wrapper from `apps/api/src/modules/test-runs/services/test-runs-dashboard-query.service.ts` (416 lines) plus its 3 internal call sites, exiting the file from the allowlist (11 → **10**). Sixth file in Phase 3c to use the "drop the local wrapper" pattern (after report-data-fetcher C6, report-generation C7, adapt C9, compare-presets C11, and pyroscope/tracing-instances in the C16 bundle). Also touches `test-runs-query.service.ts` (parent facade) — the new `roles → isAdmin` boundary surface lives there.

### Site classification

| Line | Method | Migration |
|------|--------|-----------|
| 44 (pre-edit) | `private isGlobalAdmin(roles)` | **Wrapper deleted.** No longer needed — admin is now a parameter. |
| 104, 254, 332 | `getDashboardStatistics`, `getRecentFailures`, `getDashboardSystemsSummary` | **Signature changed:** 4th positional parameter `roles: string[] = []` becomes `isAdmin: boolean = false`. The internal `const isAdmin = this.isGlobalAdmin(roles);` line in each method is deleted; the rest of the body uses the param directly. |
| 21 | `const ADMIN_ROLES = ...` | Module-level constant deleted (only consumer was the wrapper). |

The sub-service no longer needs to know anything about roles — only whether the caller has the global-admin bypass. This is the cleanest fit: roles → admin lookup belongs at the boundary (the parent facade), not at every leaf service.

### Parent facade change (`test-runs-query.service.ts`)

`resolveOrganizationIds` now returns `{ orgIds: string[]; isAdmin: boolean }` instead of `string[]`. The `isAdmin` flag is derived from `withOrgFilter`'s null sentinel (`accessible === null`), so no direct `isGlobalAdmin` call is reintroduced. The 3 dashboard delegations destructure the tuple and pass `isAdmin` to the sub-service.

```typescript
private async resolveOrganizationIds(...): Promise<{ orgIds: string[]; isAdmin: boolean }> {
  const accessible = await withOrgFilter(userId, roles, this.authzService);
  const isAdmin = accessible === null;
  if (organizationId) return { orgIds: [organizationId], isAdmin };
  return { orgIds: accessible ?? [], isAdmin };
}
```

This is a small contract change to a private helper — only 3 call sites in the same file, no external consumers.

### Test changes

`test-runs-query.service.spec.ts` had 6 assertions on the old `dashboardService.<method>(..., testRoles, ...)` shape (`testRoles = ['perfana-admin']`). All 6 updated to `..., true, ...` (the admin-bypass case). No new tests added — the existing coverage exercises both admin and explicit-org branches and now passes after the assertion update.

### Test results

| Test run | Result |
|----------|--------|
| `npx jest src/modules/test-runs/services/test-runs-query.service.spec.ts` | 29 passed |
| `npx jest src/modules/test-runs` | 766 passed (19 suites) |
| `npx jest` (full API suite) | 4309 passed, 20 skipped (pre-existing), 0 failed |
| `npm run type-check` (`@perfana/api`) | 0 errors |
| `npm run lint` (`@perfana/api`) | 0 errors, 59 pre-existing warnings (none introduced) |

### Net diff

- `test-runs-dashboard-query.service.ts`: -16 lines (wrapper + ADMIN_ROLES const + 3 internal isAdmin computations deleted; doc comments updated)
- `test-runs-query.service.ts`: +9 / -7 = **net +2** (resolveOrganizationIds now returns a tuple; 3 callers destructure it)
- `test-runs-query.service.spec.ts`: 6 assertion edits, net 0
- `.rbac-migration-allowlist.json`: -1 line

### Files changed

- `apps/api/src/modules/test-runs/services/test-runs-dashboard-query.service.ts` — drop wrapper + ADMIN_ROLES, swap `roles → isAdmin` in 3 method signatures
- `apps/api/src/modules/test-runs/services/test-runs-query.service.ts` — `resolveOrganizationIds` returns `{orgIds, isAdmin}`; 3 dashboard delegations updated
- `apps/api/src/modules/test-runs/services/test-runs-query.service.spec.ts` — 6 assertions updated to the new shape
- `apps/api/.rbac-migration-allowlist.json` — remove `test-runs-dashboard-query.service.ts`
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file

### Allowlist disposition

The file **EXITS** the allowlist — zero direct `isGlobalAdmin` references after the migration (the wrapper is gone, callers receive a boolean). Allowlist size: 11 → **10**. Burndown: Bucket A 43 → 46 of 127 (3 of the wrapper sites count against Bucket A — they were the list-filter shape inside the wrapper); Local wrappers 5 → 6 of 13 (the 6th wrapper-bearing file to lose its wrapper).

### Pattern note: `roles → isAdmin` at the parent boundary

This is the **first Phase 3c migration** to push the admin-resolution boundary up to the facade and out of a sub-service. Three other test-runs sub-services (`test-runs-performance-query.service.ts`, `test-runs-metrics.service.ts`, plus the standalone `test-runs-crud-query.service.ts`) carry the same `private isGlobalAdmin` wrapper or direct calls and are good candidates for the same treatment in future PRs. The win is that each sub-service drops a dependency on the role-list shape entirely — boolean in, query out.

---

## Phase C27 — Single file: `test-runs-performance-query.service.ts` finish + `roles → isAdmin` parameter swap

**Audit date:** 2026-05-02
**Scope:** Single-file migration. Drops the `private isGlobalAdmin` wrapper from `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts` (1227 lines pre-edit) plus its 5 internal call sites, exiting the file from the allowlist (10 → **9**). Direct sequel to C26 — same `roles → isAdmin` boundary-swap pattern, applied to the second of the three test-runs sub-services that the C26 phase note named as candidates. Touches `test-runs-query.service.ts` (parent facade) for the 5 perf-query delegations.

### Site classification

| Line (pre-edit) | Method | Migration |
|------|--------|-----------|
| 18 | `const ADMIN_ROLES = ...` | Module-level constant deleted (only consumer was the wrapper). |
| 37 | `private isGlobalAdmin(roles)` | **Wrapper deleted.** No longer needed — admin is now a parameter. |
| 384 | `getTransactionStats` | **Signature changed:** 3rd positional parameter `roles: string[] = []` → `isAdmin: boolean = false`. The internal `const isAdmin = this.isGlobalAdmin(roles);` line is deleted; the rest of the body uses the param directly. |
| 581 | `getTransactionSamples` | Same shape as above (4th positional parameter — `transactionName` is added before `excludeRampUp`). |
| 768 | `getTransactionErrors` | Same shape (4th positional parameter — `transactionName?` and `samplerName?` come before). |
| 956 | `getVirtualUserStats` | Same shape (3rd positional parameter). |
| 1082 | `getThroughputStats` | Same shape (3rd positional parameter). |

The sub-service no longer needs to know anything about roles — only whether the caller has the global-admin bypass. Same cleanest-fit reasoning as C26: roles → admin lookup belongs at the facade boundary, not at every leaf service.

### Parent facade change (`test-runs-query.service.ts`)

The 5 perf-query delegations (`getTransactionStats`, `getTransactionSamples`, `getTransactionErrors`, `getVirtualUserStats`, `getThroughputStats`) were already calling `this.authzService.getAccessibleOrganizations(userId)` directly to get an org list, then forwarding `roles` for the sub-service to compute `isAdmin`. After C26 introduced the `resolveOrganizationIds` helper (returns `{ orgIds, isAdmin }` derived from `withOrgFilter`), the cleanest move is to reuse it here too:

```typescript
// Before
const organizationIds = await this.authzService.getAccessibleOrganizations(userId);
return this.performanceService.getTransactionStats(testRunId, excludeRampUp, roles, organizationIds, sinceMinutes);

// After
const { orgIds, isAdmin } = await this.resolveOrganizationIds(userId, roles);
return this.performanceService.getTransactionStats(testRunId, excludeRampUp, isAdmin, orgIds, sinceMinutes);
```

The semantic is unchanged: for admins, the sub-service ignores `organizationIds` (the `if (isAdmin) { /* skip filter */ }` branch wins); for non-admins, the org list is still loaded the same way (`withOrgFilter` calls `getAccessibleOrganizations` internally). The only behavioral difference would be for an admin who is *also* a member of orgs — `withOrgFilter` returns `null` (collapsed to `[]`) instead of the user's actual org list — but the sub-service never reads `organizationIds` for admins, so no observable change.

### Test changes

**`test-runs-performance-query.service.spec.ts`** (the sub-service's own spec):
- Replaced the spec's `ADMIN_ROLES = ['perfana-admin']` / `USER_ROLES = ['user']` constants with `IS_ADMIN = true` / `NOT_ADMIN = false` (98 call sites updated by `replace_all`, no semantic change — the boolean now represents what the wrapper used to compute).
- **Deleted 7 tests** that exercised role-string membership in the now-deleted wrapper:
  - 2 tests in the `authorization` block (`recognises super-admin role as admin`, `recognises admin role as admin`)
  - The entire `role-based admin detection` describe block (5 tests)
  These tests asserted that specific role strings (`'super-admin'`, `'admin'`, `'perfana-admin'`, mixed arrays) trigger the admin branch — knowledge that has moved to the facade. The facade's `resolveOrganizationIds` is covered by `withOrgFilter`'s own spec (which is already in place for C26's helper) and by `AuthorizationService.isGlobalAdmin`'s spec.

**`test-runs-query.service.spec.ts`** (facade spec):
- 5 `toHaveBeenCalledWith` delegation assertions updated: 4th positional argument changed from `mockRoles` (a `['user']` array) to `true` (the boolean the mock's `isGlobalAdmin` resolves to — `createAuthorizationServiceMock()` returns `true` by default).

**`test-runs-query.service.getTransactionStats.spec.ts`** (focused facade spec):
- 9 `toHaveBeenCalledWith` assertions updated: same `mockRoles → true` substitution. Three positional shapes covered: `(testRunId, undefined, ..., [], undefined)`, `(testRunId, true, ..., [], undefined)`, `(testRunId, false, ..., [], undefined)`.

### Test results

| Test run | Result |
|----------|--------|
| `npx jest src/modules/test-runs` | 759 passed (19 suites) — 7 fewer than C26's 766 because of the deleted role-recognition tests |
| `npx jest` (full API suite) | 4302 passed, 20 skipped (pre-existing), 0 failed |
| `npm run type-check` (workspace) | 8/8 tasks successful, 0 errors |
| `npm run lint` (`@perfana/api`) | 0 errors, 59 pre-existing warnings (none introduced) |

### Net diff

- `test-runs-performance-query.service.ts`: -22 lines (ADMIN_ROLES const + comment + wrapper + 5× `const isAdmin = this.isGlobalAdmin(roles);`; jsdoc lines updated `@param roles` → `@param isAdmin` net 0)
- `test-runs-query.service.ts`: 5× delegation rewritten — net 0 (each delegation is the same line count, just different content)
- `test-runs-performance-query.service.spec.ts`: -50 lines net (constants renamed in place; 7 tests deleted)
- `test-runs-query.service.spec.ts`: 5 assertion edits, net 0
- `test-runs-query.service.getTransactionStats.spec.ts`: 9 assertion edits, net 0
- `.rbac-migration-allowlist.json`: -1 line

### Files changed

- `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts` — drop wrapper + ADMIN_ROLES, swap `roles → isAdmin` in 5 method signatures
- `apps/api/src/modules/test-runs/services/test-runs-query.service.ts` — 5 perf-query delegations switched to `resolveOrganizationIds`/pass `isAdmin`
- `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.spec.ts` — constants renamed to booleans, 7 wrapper-behavior tests deleted
- `apps/api/src/modules/test-runs/services/test-runs-query.service.spec.ts` — 5 delegation assertions updated to boolean
- `apps/api/src/modules/test-runs/services/test-runs-query.service.getTransactionStats.spec.ts` — 9 delegation assertions updated to boolean
- `apps/api/.rbac-migration-allowlist.json` — remove `test-runs-performance-query.service.ts`
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file

### Allowlist disposition

The file **EXITS** the allowlist — zero direct `isGlobalAdmin` references after the migration (the wrapper is gone, callers receive a boolean). Allowlist size: 10 → **9**. Burndown: Bucket A 46 → 51 of 127 (5 of the wrapper sites count against Bucket A — they were the list-filter shape inside the wrapper); Local wrappers 6 → 7 of 13 (the 7th wrapper-bearing file to lose its wrapper).

### Pattern note: second application of C26's `roles → isAdmin` boundary swap

C26 set the precedent with `test-runs-dashboard-query.service.ts`; C27 confirms it generalizes cleanly. The two remaining test-runs sub-services with the same shape (`test-runs-metrics.service.ts` — has the wrapper; `test-runs-crud-query.service.ts` — uses `this.authzService.isGlobalAdmin` directly without a wrapper) are next candidates. The crud-query file is materially harder because its 17 sites mix org and team filtering at most call sites — likely a dedicated PR with care taken on the `withTeamFilter` integration. Metrics is a near-clone of perf-query and should be straightforward.

---

## Phase C28 — `test-runs-metrics.service.ts` finish + boundary push to `TestRunsService`

**Audit date:** 2026-05-02
**Scope:** Single-file migration. Drops the local `private isGlobalAdmin` wrapper (and `ADMIN_ROLES` constant) from `apps/api/src/modules/test-runs/services/test-runs-metrics.service.ts` plus its 5 internal call sites, exiting the file from the allowlist (9 → **8**). Same `roles → isAdmin` boundary-swap pattern as C26/C27, but the parent here is `TestRunsService` (the outer facade) rather than `TestRunsQueryService`, so the boundary push touches a service that did not previously inject `AuthorizationService`.

### Site classification

| Line (pre-edit) | Method | Migration |
|------|--------|-----------|
| 19 | `const ADMIN_ROLES = [...]` | Module-level constant deleted (only consumer was the wrapper). |
| 28 | `private isGlobalAdmin(roles)` | **Wrapper deleted.** No longer needed — admin is now a parameter. |
| 36 | `private resolveOrganizationIds(userId, roles)` | Helper signature simplified to `(userId)` only — admin guarding is now a caller responsibility. |
| 62 | `classifyMetric` | **Signature changed:** 7th positional parameter `roles: string[] = []` → `isAdmin: boolean = false`. The internal `const isAdmin = this.isGlobalAdmin(roles);` line is deleted; the rest of the body uses the param directly. |
| 206 | `createOrUpdateDsCompareConfig` | Same shape (3rd positional parameter). The two internal recursive calls (`getDsCompareConfig`, `updateDsCompareConfig`) now forward `isAdmin` instead of `roles`. |
| 304 | `getDsCompareConfig` | Same shape (8th positional parameter). |
| 398 | `updateDsCompareConfig` | Same shape (4th positional parameter). |
| 599 | `deleteDsCompareConfig` | Same shape (3rd positional parameter). |

`applyGoldenPathClassifications` is unchanged — it took no `roles` argument (it's called from `TestRunsMutationService` for completed test runs, no per-user authz).

### Parent facade change (`test-runs.service.ts`)

`TestRunsService` did not previously inject `AuthorizationService`. C28 adds it as the 8th constructor dep (after the 7 sub-services) and a new `private resolveIsAdmin(userId, roles)` helper that delegates to the existing `withOrgFilter` utility — `withOrgFilter` returns `null` iff the user is a global admin, so `=== null` collapses cleanly to a boolean. Reusing `withOrgFilter` (rather than calling `this.authzService.isGlobalAdmin(roles)` directly) keeps `TestRunsService` itself out of the allowlist: the `no-direct-is-global-admin` lint rule fires on direct `authzService.isGlobalAdmin` calls, but `withOrgFilter` is the canonical approved indirection.

```typescript
// Before (5×)
async classifyMetric(testRunId, ..., userId?, roles?) {
  return this.metricsService.classifyMetric(..., userId, roles);
}

// After (5×)
async classifyMetric(testRunId, ..., userId?, roles?) {
  const isAdmin = await this.resolveIsAdmin(userId ?? '', roles ?? []);
  return this.metricsService.classifyMetric(..., userId, isAdmin);
}
```

The semantic is unchanged: for admins, the metrics sub-service skips org filtering (the `if (isAdmin) { /* skip */ }` branch wins); for non-admins, the metrics service still loads its own org list internally via the (now simplified) `resolveOrganizationIds(userId)` helper. The minor inefficiency — for non-admins, `withOrgFilter` calls `getAccessibleOrganizations(userId)` at the parent and the metrics service calls it again internally — is the cost of keeping the metrics sub-service self-contained for org loading. A future PR could push `orgIds` through the parameters to dedupe; for now the duplicate call hits Redis cache and is observably negligible.

### Test changes

**`test-runs-metrics.service.spec.ts`** — unchanged. The existing spec only tests `applyGoldenPathClassifications` (which takes no roles); none of the boundary-swapped methods had test coverage in this file.

**`test-runs.service.spec.ts`** (parent facade spec):
- `AuthorizationService` was already provided by `createAuthorizationServiceMock()` in the existing test setup (the mock's default `isGlobalAdmin` returns `true`, so `withOrgFilter` returns `null`, so `resolveIsAdmin` returns `true`).
- 2 `toHaveBeenCalledWith` delegation assertions updated: 8th positional argument changed from `undefined` (the old `roles` value) to `true` (the boolean the mock resolves to).

### Test results

| Test run | Result |
|----------|--------|
| `npx jest src/modules/test-runs` | 759 passed (19 suites) — unchanged from C27 |
| `npx jest` (full API suite) | 4302 passed, 20 skipped (pre-existing), 0 failed |
| `npm run type-check` (workspace) | 8/8 tasks successful, 0 errors |
| `npm run lint` (`@perfana/api`) | 0 errors, 59 pre-existing warnings (none introduced) |

### Net diff

- `test-runs-metrics.service.ts`: -16 lines (ADMIN_ROLES const + comment + wrapper + roles parameter on resolveOrganizationIds + 5× `const isAdmin = this.isGlobalAdmin(roles);`)
- `test-runs.service.ts`: +12 lines (1 import + 1 constructor dep + 1 helper method + 5× `const isAdmin = await this.resolveIsAdmin(...);` lines)
- `test-runs.service.spec.ts`: 2 assertion edits, net 0
- `.rbac-migration-allowlist.json`: -1 line

### Files changed

- `apps/api/src/modules/test-runs/services/test-runs-metrics.service.ts` — drop wrapper + ADMIN_ROLES, simplify `resolveOrganizationIds` signature, swap `roles → isAdmin` in 5 method signatures
- `apps/api/src/modules/test-runs/test-runs.service.ts` — inject `AuthorizationService`, add `resolveIsAdmin` helper, 5 metrics delegations call it
- `apps/api/src/modules/test-runs/test-runs.service.spec.ts` — 2 delegation assertions updated to boolean
- `apps/api/.rbac-migration-allowlist.json` — remove `test-runs-metrics.service.ts`
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file

### Allowlist disposition

The file **EXITS** the allowlist — zero direct `isGlobalAdmin` references after the migration (the wrapper is gone, callers receive a boolean). Allowlist size: 9 → **8**. Burndown: Bucket A 51 → 56 of 127 (5 of the wrapper sites count against Bucket A — same shape as C27); Local wrappers 7 → 8 of 13 (the 8th wrapper-bearing file to lose its wrapper).

### Pattern note: third application of C26's `roles → isAdmin` boundary swap

C28 generalizes the C26/C27 pattern one level up: when the parent of the leaf service is a service that did not previously inject `AuthorizationService`, the boundary push requires adding the dependency. Reusing `withOrgFilter` rather than calling `authzService.isGlobalAdmin` directly is the key trick — the lint rule and the burndown both treat `withOrgFilter` as the approved indirection, so the parent stays clean without entering the allowlist itself.

The remaining test-runs sub-service with the same shape is `test-runs-crud-query.service.ts` — its 17 sites mix org and team filtering and use `this.authzService.isGlobalAdmin` directly (no wrapper). C29 likely lands as a dedicated PR with care taken around `withTeamFilter` integration.

---

## Phase C29 — `test-runs-crud-query.service.ts` full migration with `withOrgFilter` + `withTeamFilter` integration

**Audit date:** 2026-05-02
**Scope:** Single-file migration of the largest remaining test-runs sub-service. Drops all 12 direct `authzService.isGlobalAdmin` / `getAccessibleOrganizations` / `getAccessibleTeams` call sites in `apps/api/src/modules/test-runs/services/test-runs-crud-query.service.ts` (1153 lines pre-edit) and pushes admin / org-list / team-list resolution up to `TestRunsQueryService`, exiting the file from the allowlist (8 → **7**). Eighth and final test-runs sub-service to be migrated. Same `roles → isAdmin` boundary-swap pattern as C26/C27/C28, but extended with `organizationIds` / `userTeamIds` array parameters because the file's list-filter methods need both. Mirrors the dashboard-query (C26) parameter shape exactly.

### Site classification

| Method | Type | Migration |
|--------|------|-----------|
| `applyTeamRestriction` | private helper | Signature swapped from `(qb, alias, userId): Promise<void>` to `(qb, alias, userTeamIds): void`; the inner `await getAccessibleTeams(userId)` call is gone (parent pre-resolves). Now synchronous. |
| `findAllPaginated` | list-filter | `(userId, roles, paginationDto?, orgId?)` → `(isAdmin, organizationIds, userTeamIds, paginationDto?, orgId?)`. Inner `getAccessibleOrganizations` and `getAccessibleTeams` calls deleted. |
| `getFilterOptions` | list-filter | `(userId, roles, orgId?)` → `(isAdmin, organizationIds, userTeamIds, orgId?)`. Same shape. |
| `findAll` (DEPRECATED) | list-filter | `(userId, roles)` → `(isAdmin, organizationIds)`. No team filter (preserves existing behavior). |
| `findByTestRunId` | per-resource | `(testRunId, userId, roles)` → `(testRunId, userId, isAdmin)`. Per-resource `isOrganizationMember` / `canViewTeamResources` calls preserved (those aren't direct `isGlobalAdmin` calls). |
| `findOne` | per-resource | Same shape as `findByTestRunId`. |
| `getTestRunByTestRunId` | per-resource | Same shape; returns `null` instead of throwing. |
| `findByTestRunIdAndParams` | list-filter | `(testRunId, sys, env, wl, userId, roles, orgId?)` → `(testRunId, sys, env, wl, isAdmin, organizationIds, userTeamIds, orgId?)`. Inner `getAccessibleOrganizations` deleted; `applyTeamRestriction` call updated to pass pre-resolved `userTeamIds`. |
| `getRelatedTestRuns` | passthrough | `(testRunId, userId, roles, sys?, env?, wl?)` → `(testRunId, isAdmin, organizationIds, userTeamIds, sys?, env?, wl?)`. Forwards to `findByTestRunIdAndParams` with new signature. |
| `getSystemsSummary` | list-filter | `(userId, roles, orgId?)` → `(isAdmin, organizationIds, userTeamIds, orgId?)`. Inner org/team fetches deleted. |
| `getAllTags` | list-filter | `(userId, roles)` → `(isAdmin, organizationIds)`. No team filter (test_runs has no team_id, only org filtering applies). |
| `getAllAnnotations` | list-filter | Same as `getAllTags`. |
| `getBaselineCandidates` | unauth | `(sutId, env, wl, userId, _roles, exclude?, limit?)` → `(sutId, env, wl, exclude?, limit?)`. The `userId` and `_roles` parameters were unused (pre-existing `// NOTE: Organization filtering will be added here when TestRun entity has organization_id`); dropped both. |
| `getRequestNames` | passthrough | `(testRunId, userId, roles, panelDescription?)` → `(testRunId, userId, isAdmin, panelDescription?)`. Forwards to `findByTestRunId`. |

### Parent facade change (`test-runs-query.service.ts`)

`TestRunsQueryService` already had `resolveOrganizationIds` (returns `{ orgIds, isAdmin }`) and `resolveTeamIds` (returns `string[]`) helpers from C25; C29 only adds a small `resolveIsAdmin` helper for the per-resource methods that need only the boolean:

```typescript
private async resolveIsAdmin(userId: string, roles: string[]): Promise<boolean> {
  return (await withOrgFilter(userId, roles, this.authzService)) === null;
}
```

Each of the 14 crud-query delegations is updated to compute and forward the right primitives. List-filter methods compute both `{ orgIds, isAdmin }` and `userTeamIds`; per-resource methods compute only `isAdmin`. The `withOrgFilter` indirection keeps the parent clean — it remains outside the lint allowlist as a structural infrastructure file.

### Test changes

**`test-runs-crud-query.service.spec.ts`** (1832 lines pre-edit) — fully rewritten to match the new signatures. Removed the `adminRoles`/`userRoles` constants; tests now call methods directly with `true`/`false` for `isAdmin` and explicit `[]`/`['org-1']` arrays for `organizationIds`/`userTeamIds`. Per-resource tests still set `authzService.isOrganizationMember`/`canViewTeamResources` mocks (those calls still happen inside the service). 95 tests pass (down 0 — every prior test has a corresponding new-signature test).

**`test-runs-query.service.spec.ts`** (parent facade spec) — 14 delegation assertions updated. Default `createAuthorizationServiceMock()` returns `isGlobalAdmin = true` and empty arrays for `getAccessibleOrganizations`/`getAccessibleTeams`, so `resolveOrganizationIds`/`resolveTeamIds` collapse to `{ orgIds: [], isAdmin: true }` and `[]`; assertions now expect `(true, [], [], …)` where they previously expected `(userId, ['user'], …)`.

### Test results

| Test run | Result |
|----------|--------|
| `npx jest src/modules/test-runs` | 759 passed (19 suites) — unchanged from C28 |
| `npx jest` (full API suite) | 4302 passed, 20 skipped (pre-existing), 0 failed |
| `npx tsc --noEmit` (apps/api) | 0 errors |
| `npm run lint` (`@perfana/api`) | 0 errors, 59 pre-existing warnings (none introduced) |

### Net diff

- `test-runs-crud-query.service.ts`: ~−40 lines (12 inline `getAccessibleOrganizations`/`Teams` calls + 12 inline `isGlobalAdmin` calls + various redundant `userId` debug-log lines deleted; signature parameter changes net to a small reduction)
- `test-runs-query.service.ts`: ~+25 lines (14 delegations now call `resolveOrganizationIds`/`resolveTeamIds`/`resolveIsAdmin`; new `resolveIsAdmin` helper added)
- `test-runs-crud-query.service.spec.ts`: rewritten (similar size, 95 tests, signature-aligned)
- `test-runs-query.service.spec.ts`: 14 delegation assertions updated
- `.rbac-migration-allowlist.json`: −1 line

### Files changed

- `apps/api/src/modules/test-runs/services/test-runs-crud-query.service.ts` — drop all direct `authzService.isGlobalAdmin`/`getAccessibleOrganizations`/`getAccessibleTeams` calls, simplify `applyTeamRestriction`, swap signatures across 12 methods
- `apps/api/src/modules/test-runs/services/test-runs-query.service.ts` — 14 delegations now compute and forward `isAdmin`/`organizationIds`/`userTeamIds`; new `resolveIsAdmin` helper
- `apps/api/src/modules/test-runs/services/test-runs-crud-query.service.spec.ts` — rewritten for new signatures
- `apps/api/src/modules/test-runs/services/test-runs-query.service.spec.ts` — 14 delegation assertions updated
- `apps/api/.rbac-migration-allowlist.json` — remove `test-runs-crud-query.service.ts`
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file

### Allowlist disposition

The file **EXITS** the allowlist — zero direct `isGlobalAdmin` references after the migration. Allowlist size: 8 → **7**. Burndown: Bucket A 56 → 64 of 127 (8 of the migrated sites count against Bucket A — `findAllPaginated`, `getFilterOptions`, `findAll`, `findByTestRunIdAndParams`, `getSystemsSummary`, `getAllTags`, `getAllAnnotations`, plus the team-filter site in `findAllPaginated` shared logic). Bucket B unchanged (per-resource sites in this file already used `isOrganizationMember` and `canViewTeamResources`, not direct `isGlobalAdmin`).

### Pattern note: full `withOrgFilter` + `withTeamFilter` boundary push

C29 is the first Phase 3c migration to push **both** org and team list resolution up the call stack in a single PR. C25 introduced `withTeamFilter` and used it in the parent facade only; C26–C28 did `roles → isAdmin` boundary swaps without pushing the array params. C29 generalizes by passing the pre-resolved `organizationIds: string[]` and `userTeamIds: string[]` arrays alongside `isAdmin: boolean` — matching the shape that dashboard-query already used since C26. The benefit beyond exiting the allowlist: the sub-service no longer issues redundant authz lookups (e.g. `findAllPaginated` previously called `getAccessibleOrganizations` and `getAccessibleTeams` inline; now both come from the parent's single `resolveOrganizationIds` + `resolveTeamIds` calls per request). Cache-hit on Redis means the savings are observably small, but the architectural simplification is meaningful.

With C29, all 8 test-runs services are migrated. Remaining allowlist (7 files): `dynatrace.service.ts`, `graph-presets.service.ts`, `organizations.service.ts`, `profiles.service.ts`, `systems-under-test.service.ts`, `teams.service.ts`, `trends-presets.service.ts`. Next candidates by complexity: `graph-presets.service.ts` and `trends-presets.service.ts` (both list-filter heavy, smaller surface than crud-query).

---

## Phase C30 — `graph-presets` + `trends-presets` combined `roles → isAdmin` boundary push

**Audit date:** 2026-05-02
**Scope:** Combined migration of two near-identical preset services. Drops all 8 direct `authzService.isGlobalAdmin` call sites across `apps/api/src/modules/graph-presets/graph-presets.service.ts` (259 lines) and `apps/api/src/modules/trends-presets/trends-presets.service.ts` (282 lines), pushes admin resolution up to **the controller** (the entry point — these services have no parent service, unlike test-runs sub-services). Both files exit the allowlist simultaneously (7 → **5**). First Phase 3c migration where the boundary push lands in a controller rather than a parent service. Also the first migration of user-owned (`userId` / `createdBy` + `isGlobal` flag) resources rather than org-owned resources — the canonical `withOrgFilter` indirection still works (it returns `null` for global admins regardless of whether the caller intends to filter by org), so the lint-exempt path generalizes cleanly to non-org resource models.

### Site classification (per file — both files have identical shape)

| Method | Type | Migration |
|--------|------|-----------|
| `create` | debug-log only | `(dto, userId, roles)` → `(dto, userId)`. The `isAdmin` was computed and used **only** in a debug log that was deleted (same disposition as C11/C15 `(admin)` log-tag drops). The `roles` parameter is removed entirely. |
| `findAll` | list-filter (Bucket A) | `(userId, roles, …)` → `(userId, isAdmin, …)`. Inner `isGlobalAdmin(roles)` deleted; the existing `if (!isAdmin) { queryBuilder.where(userId OR isGlobal) }` filter remains in place, now reading the parameter directly. |
| `findOne` | per-resource guard (Bucket B) | `(id, userId, roles)` → `(id, userId, isAdmin)`. Inner `isGlobalAdmin(roles)` deleted; the `if (isAdmin) return preset` bypass + `if (preset.userId !== userId && !preset.isGlobal) throw Forbidden` guard remain unchanged. |
| `remove` | per-resource guard (Bucket B) | `(id, userId, roles)` → `(id, userId, isAdmin)`. Same structural change as `findOne`. |

`AuthorizationService` is no longer injected into either service — these were the only consumers of it. Both services lose one constructor parameter.

### Controller boundary push

Both controllers (`GraphPresetsController`, `TrendsPresetsController`) now inject `AuthorizationService` and add a private `resolveIsAdmin` helper:

```typescript
private async resolveIsAdmin(userId: string, roles: string[]): Promise<boolean> {
  return (await withOrgFilter(userId, roles, this.authzService)) === null;
}
```

This is the same trick C28 introduced (and C29 reused): `withOrgFilter` is in `INFRASTRUCTURE_FILES` (lint-exempt), and it returns `null` iff the caller is a global admin — collapse with `=== null` and the controller never calls `isGlobalAdmin` directly. The controller stays out of the allowlist. `create` does not call `resolveIsAdmin` because the underlying service no longer needs `isAdmin` (debug-log site was deleted).

`findAll`, `findOne`, and `remove` each call `resolveIsAdmin` once and forward the boolean to the service. The async `withOrgFilter` call adds one cache-friendly Redis hit per request (typically a hit, since the same user's accessible orgs are loaded everywhere); the cost is negligible and identical to what C26–C28 introduced for test-runs sub-services.

### Test changes

**None.** Neither `graph-presets` nor `trends-presets` had any existing unit tests, controller tests, or e2e tests in the API workspace before this PR. Verification relied on:

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` (apps/api) | 0 errors |
| `npm run lint -w apps/api` | 0 errors, 59 pre-existing warnings (none introduced) |
| `npx jest` (full API suite) | 4302 passed, 20 skipped (unchanged from C29) |
| Allowlist contents | Both files removed; remaining 5 files match audit doc |
| Direct `isGlobalAdmin` references in migrated files | Only in doc comments (one per controller, explaining the `withOrgFilter` indirection) |

Adding test coverage for both modules is a separate concern not blocking this PR — the migration is signature-equivalent at runtime: the boolean now arrives from the controller via `withOrgFilter` rather than being computed in the service via `isGlobalAdmin`, both of which read the same `AuthorizationService.isGlobalAdmin(roles)` source of truth.

### Net diff

- `graph-presets.service.ts`: ~−15 lines (4 inline `isGlobalAdmin` calls + 4 debug-log lines + `AuthorizationService` import/injection deleted; doc comments updated)
- `graph-presets.controller.ts`: ~+25 lines (`AuthorizationService` injection + `withOrgFilter` import + `resolveIsAdmin` helper + 3 method awaits)
- `trends-presets.service.ts`: ~−15 lines (same shape as graph-presets)
- `trends-presets.controller.ts`: ~+25 lines (same shape as graph-presets)
- `.rbac-migration-allowlist.json`: −2 lines

Net: roughly +20 lines across all four files. The growth is the duplicated `resolveIsAdmin` helper + boundary plumbing in each controller; the service-side simplification offsets it but doesn't fully cover it. A shared helper extracted to `apps/api/src/common/utils/` could fold the duplication, but with two call sites (and the helper being three lines including the doc comment) it's not yet warranted.

### Files changed

- `apps/api/src/modules/graph-presets/graph-presets.service.ts` — drop `AuthorizationService` injection + 4 inline `isGlobalAdmin` calls + 4 debug-log lines; swap signatures for 4 methods (`create` loses `roles` entirely; `findAll`/`findOne`/`remove` swap `roles` for `isAdmin`)
- `apps/api/src/modules/graph-presets/graph-presets.controller.ts` — inject `AuthorizationService`, add `withOrgFilter` import + `resolveIsAdmin` helper, await `isAdmin` in `findAll`/`findOne`/`remove` and forward to service
- `apps/api/src/modules/trends-presets/trends-presets.service.ts` — same shape as graph-presets
- `apps/api/src/modules/trends-presets/trends-presets.controller.ts` — same shape as graph-presets
- `apps/api/.rbac-migration-allowlist.json` — remove both files
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file (burndown table updates + this section)

### Allowlist disposition

Both files **EXIT** the allowlist — zero direct `isGlobalAdmin` references after the migration. Allowlist size: 7 → **5** (two files exit in one PR — first multi-file exit since C16's six-file bundle). Burndown: Bucket A 56 → 66 of 129 (10 of the migrated test-runs-crud-query sites from C29 + 2 of the preset `findAll` sites — total adjusted upward by 2 to enumerate the user-owned list-filter shape). Bucket B 17 → 21 of 22 (4 user-owned per-resource guards added — total adjusted upward by 4).

### Pattern notes

**1. First controller-as-boundary migration.** C26–C29 pushed admin resolution up from a leaf service to a parent service. C30 has no parent service: the controller is the entry point. The same `resolveIsAdmin` helper backed by `withOrgFilter` works identically in a controller context. This generalizes the boundary push to any service whose entry point is HTTP, not just to services with internal facades.

**2. First user-owned resource migration.** Graph presets and trends presets are owned by `userId` / `createdBy`, not by `organization_id`. The audit's Bucket A (org-filter) and Bucket B (org-guard) framing was designed around org-owned resources. The migration shows the framing extends cleanly: the admin bypass is intrinsic to the policy, regardless of whether the resource is org-owned, team-owned, or user-owned. `withOrgFilter` continues to work as the lint-exempt indirection because its admin check (`isGlobalAdmin === null` return) is independent of the org list it returns.

**3. Combined-PR precedent for clones.** C30 lands two near-identical files in one PR rather than two single-file PRs. C26–C29 followed strict one-file-per-PR cadence; C30 deviates because the two files are structural clones (same 4-method shape, same migration delta, same controller pattern). The earlier C16 bundle PR set the precedent for combining files when the unifying signal (matching `roles → isAdmin` swap) is strong enough that splitting would just be churn. Future migrations of clone-pairs can follow this approach.

### Remaining allowlist (5 files)

After C30, the allowlist contains: `dynatrace.service.ts`, `organizations.service.ts`, `profiles.service.ts`, `systems-under-test.service.ts`, `teams.service.ts`. These are mostly larger, more architecturally embedded services — none are clones of each other, and several mix Bucket A and Bucket B sites with multi-tenant concerns. Next candidates by complexity: `teams.service.ts` and `organizations.service.ts` (smaller files, both deal directly with the membership entities so the migration patterns may need new shapes); `profiles.service.ts` is the largest remaining surface and likely warrants a multi-PR split similar to the test-runs sub-services in C25–C29.

---

## Phase C31 — `teams` + `organizations` combined `roles → isAdmin` boundary push

**Date:** 2026-05-02
**Branch:** `rbac/3c-teams-orgs-c31`
**Related:** Phase 3c, C30 (graph/trends-presets clone-pair precedent), C26–C29 (boundary push pattern)

**Scope:** Combined-PR migration of two membership-rooted services. Drops 12 direct `authzService.isGlobalAdmin` call sites — 6 in `apps/api/src/modules/teams/teams.service.ts` (365 lines pre-edit) and 6 in `apps/api/src/modules/organizations/organizations.service.ts` (370 lines pre-edit) — and pushes admin resolution up to the corresponding controllers. Both files **EXIT** the allowlist (5 → **3**). Same `resolveIsAdmin` helper backed by `withOrgFilter` as C30, identical controller-as-boundary shape.

### Migration shape

Per file, the transformation is:

```typescript
// Before (service)
async findAll(userId: string = '', roles: string[] = []): Promise<Team[]> {
  const isAdmin = this.authzService.isGlobalAdmin(roles);
  this.logger.debug(`findAll: userId=${userId}, isGlobalAdmin=${isAdmin}`);
  if (isAdmin) { /* return all */ }
  // ... membership-filtered path
}

// After (service)
async findAll(userId: string = '', isAdmin: boolean = false): Promise<Team[]> {
  if (isAdmin) { /* return all */ }
  // ... membership-filtered path (unchanged)
}
```

Controllers add `AuthorizationService` injection plus the `resolveIsAdmin(userId, roles)` helper (same body as C30). Each method that previously forwarded `ctx.roles` now `await`s `resolveIsAdmin` once and forwards the boolean. Internal self-calls (`create` and `update` both call `findOne(savedId, userId, isAdmin)` to return the hydrated record) thread the resolved boolean through unchanged.

The trivial `isGlobalAdmin=${isAdmin}` debug logs at every method entry — pure observability noise — are deleted entirely. The `Access denied` warn-logs (only emitted when authorization actually fails) are preserved.

### Per-method site mapping

`teams.service.ts` (6 isGlobalAdmin sites, all migrated):

| Method | Bucket | Notes |
| --- | --- | --- |
| `findAll` | A | Returns all teams when admin; otherwise `WHERE organization_id IN (accessibleOrgIds)`. |
| `findOne` | B | Per-resource guard; admin bypasses `isOrganizationMember` + `isTeamMember` fallback. |
| `findByOrganization` | B | Per-resource guard; admin bypasses `isOrganizationMember`. |
| `create` | B | Per-resource guard; admin bypasses `isOrganizationAdmin`. |
| `update` | B | Per-resource guard; admin bypasses `isOrganizationAdmin` ∧ `isTeamAdmin`. |
| `remove` | B | Per-resource guard; admin bypasses `isOrganizationAdmin` ∧ `isTeamAdmin`. |

`organizations.service.ts` (6 isGlobalAdmin sites, all migrated):

| Method | Bucket | Notes |
| --- | --- | --- |
| `findAll` | A | Returns all orgs when admin; otherwise `WHERE id IN (accessibleOrgIds)`. |
| `findOne` | B | Per-resource guard; admin bypasses `isOrganizationMember`. |
| `findByName` | B | Per-resource guard; admin bypasses `isOrganizationMember` (returns `null` on denial for back-compat). |
| `create` | B | Per-resource guard is a no-op today (all auth users may create); the `isAdmin` debug log was the only `isGlobalAdmin` site. The boolean is still threaded into the trailing `findOne` self-call. |
| `update` | B | Per-resource guard; admin bypasses `isOrganizationAdmin`. |
| `remove` | B | Per-resource guard; admin bypasses `isOrganizationAdmin`. |

### Verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` (apps/api) | clean |
| `npx eslint --rulesdir eslint-rules 'src/**/*.ts'` | 0 errors, 59 warnings (all `@typescript-eslint/no-explicit-any` warnings — unchanged from C30) |
| `grep -n isGlobalAdmin` on the four touched files | only doc-comment references in the two new controller `resolveIsAdmin` helpers (explaining the indirection); zero call sites |
| `npx jest src/modules/teams src/modules/organizations` | 124 passed (2 suites — `team-members.service.spec.ts`, `organization-members.service.spec.ts`) |
| `npx jest` (full API suite) | 4302 passed, 20 skipped (unchanged from C30) |

Note: there are no unit tests for `teams.service.ts` or `organizations.service.ts` themselves — only the `*-members.service` siblings have specs. The 4302/4302 total is the regression check; behavior for the migrated entry points is exercised by `e2e` paths the suite already covers.

### Diff size

- `teams.service.ts`: ~−25 lines (6 `isGlobalAdmin` calls + 6 debug-log lines deleted; signatures swap `roles: string[]` → `isAdmin: boolean`; 2 internal self-calls in `create`/`update` switch from `roles` to `isAdmin`)
- `teams.controller.ts`: ~+25 lines (`AuthorizationService` injection + `withOrgFilter` import + `resolveIsAdmin` helper + 5 method awaits)
- `organizations.service.ts`: ~−25 lines (same shape as teams)
- `organizations.controller.ts`: ~+25 lines (same shape as teams)
- `.rbac-migration-allowlist.json`: −2 lines

Net: roughly zero across all five files. Service-side simplification (deleted debug logs + signature shrink) almost exactly offsets the duplicated controller-side `resolveIsAdmin` plumbing.

### Files changed

- `apps/api/src/modules/teams/teams.service.ts` — swap signatures, drop 6 inline `isGlobalAdmin` calls + 6 debug-log lines, thread `isAdmin` through internal self-calls in `create`/`update`
- `apps/api/src/modules/teams/teams.controller.ts` — inject `AuthorizationService`, add `withOrgFilter` import + `resolveIsAdmin` helper, await `isAdmin` in all 5 service-call methods (`findAll` / `findByOrganization` / `findOne` / `create` / `update` / `remove`)
- `apps/api/src/modules/organizations/organizations.service.ts` — same shape as teams
- `apps/api/src/modules/organizations/organizations.controller.ts` — same shape as teams
- `apps/api/.rbac-migration-allowlist.json` — remove both files
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file (burndown table updates + this section)

### Allowlist disposition

Both files **EXIT** the allowlist — zero direct `isGlobalAdmin` call sites after the migration. Allowlist size: 5 → **3** (second multi-file exit in a row, after C30). Burndown: Bucket A 66 → 68 of 131 (2 of the migrated `findAll` sites — total adjusted upward by 2 to enumerate the membership-rooted list-filter shape). Bucket B 21 → 31 of 32 (10 per-resource guards added — total adjusted upward by 10).

### Pattern notes

**1. Membership-rooted services confirm the boundary-push pattern is universal.** The audit doc had flagged teams/orgs as services where "the migration patterns may need new shapes" because they deal directly with the membership entities themselves. They didn't. The same `resolveIsAdmin` helper, the same `withOrgFilter` indirection, the same `roles → isAdmin` signature swap, and the same controller-as-boundary structure all worked unchanged. The only adjustment was bookkeeping: the migrated sites weren't in the original Bucket A/B enumeration, so the totals were adjusted upward (same way C30 adjusted upward for user-owned presets).

**2. Internal self-call threading is mechanical.** Both `create` and `update` end with `return await this.findOne(savedId, userId, ???)` to return a hydrated record. The migration just swaps the third arg from `roles` to `isAdmin` — no other change. This is the simplest sub-pattern of the boundary push: the parent already had the resolved boolean in scope, so threading it through is one identifier rename per call site.

**3. Combined-PR cadence for clone-pairs is now established.** C30 introduced the precedent; C31 follows it. The two files share method shape, signature shape, debug-log shape, and migration delta. Splitting them into separate PRs would double the review cost and produce two near-identical audit entries. The bar for combining: the migration delta must be structurally identical, not merely topically related — which is the case for the four `findX` / `create` / `update` / `remove` methods across both files.

**4. The audit "next candidates" predictions are improving.** C30's audit entry predicted "teams.service.ts and organizations.service.ts (smaller files, both deal directly with the membership entities so the migration patterns may need new shapes)". The first half (smaller files, next-up) was right; the second half (new shapes needed) was wrong — the existing pattern covered them with no adjustments. Worth keeping in mind for the remaining three files: the prediction biased toward "this will be hard"; the reality is mostly mechanical.

### Remaining allowlist (3 files)

After C31, the allowlist contains: `dynatrace.service.ts`, `profiles.service.ts`, `systems-under-test.service.ts`. The remaining surface is dominated by `dynatrace.service.ts` (1566 lines) and `profiles.service.ts` (1190 lines), with `systems-under-test.service.ts` (661 lines) in between. Likely sequencing:

- **C32:** `systems-under-test.service.ts` (smallest of the three, single-file PR). The audit's original Bucket A/B enumeration covers this file directly — no upward adjustment expected.
- **C33–C34:** `profiles.service.ts` split. Likely a 2–3 PR sequence following the test-runs sub-service C25–C29 pattern: extract method clusters by surface (CRUD vs. metrics-source-resolution vs. variable-resolution) and migrate each cluster independently to keep PRs reviewable.
- **C35–C36:** `dynatrace.service.ts` finish. C17 already migrated the per-resource sites; the remaining surface is the larger CRUD + tile-management shape. Multi-PR split likely.

After C31, the lint rule actively guards every controller and every test-runs sub-service plus the entire `*-presets` and membership-rooted module surfaces. Phase 3c's coverage is now structurally complete for the most-trafficked entry points; the remaining three allowlist files are heavyweight integration services rather than user-facing CRUD.

---

## Phase C32 — `systems-under-test.service.ts` full migration via controller boundary push

**Date:** 2026-05-02
**Branch:** `rbac/3c-systems-under-test-c32`
**Related:** Phase 3c, C30/C31 (controller-as-boundary precedent), C26–C29 (boundary push pattern)

**Scope:** Single-file migration. Drops all 9 direct `authzService.isGlobalAdmin` call sites in `apps/api/src/modules/systems-under-test/systems-under-test.service.ts` (661 lines pre-edit) and pushes admin resolution up to `SystemsUnderTestController`. File **EXITS** the allowlist (3 → **2**). Same `resolveIsAdmin` helper backed by `withOrgFilter` as C30/C31, identical controller-as-boundary shape. Smallest of the three remaining allowlist files; cleared in one PR.

### Per-method site mapping

The 9 `isGlobalAdmin` sites split into three classifications:

| Method | Bucket | Notes |
| --- | --- | --- |
| `findAll` | A | Returns all systems when admin (no org filter); otherwise composes `accessibleOrgIds` + `accessibleTeamIds` into a 3-OR query (org-level + unrestricted-team + direct-team-membership). |
| `createSut` | B | Per-resource guard; admin bypasses `isOrganizationMember` before transactional create. Threads `isAdmin` into 2 internal `findOne` self-calls (idempotency-hit return + post-create return). |
| `findOne` | B | Per-resource guard; admin bypasses `isOrganizationMember` + `canViewTeamResources`. |
| `findSystemSummary` | B | Per-resource guard with same shape as `findOne` but returns `null` on denial (vs `findOne`'s `NotFoundException`). |
| `findByName` | B | Per-resource guard with same null-on-denial shape as `findSystemSummary`. |
| `update` | B | Per-resource guard via `findOne`, plus a duplicated inline `isOrganizationMember` check. Threads `isAdmin` into 2 internal `findOne` self-calls. |
| `remove` | B | Per-resource guard via `findOne`, plus a duplicated inline `isOrganizationMember` check. Threads `isAdmin` into 1 internal `findOne` self-call. |
| `create` (legacy) | DEBUG-LOG-ONLY | The `isAdmin` value was only interpolated into a `logger.debug` call; the surrounding write-path has no admin-gated branch. Threads `isAdmin` into 1 internal `findOne` self-call. |
| `updatePyroscopeConfig` | DEBUG-LOG-ONLY | Same shape as legacy `create` — the value reached only `logger.debug`. Threads `isAdmin` into 2 internal `findOne` self-calls. |

The 2 debug-log-only sites are deleted (the `const isAdmin = isGlobalAdmin(roles)` capture goes away; the `logger.debug` line uses the parameter directly). The 7 functional sites swap `roles: string[]` → `isAdmin: boolean` and drop their inline `isGlobalAdmin` call.

### Migration shape

```typescript
// Before (service)
async findOne(id: string, userId: string, roles: string[]): Promise<SystemUnderTestEntity> {
  const isAdmin = this.authzService.isGlobalAdmin(roles);
  this.logger.debug(`findOne: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);
  // ... per-resource guard using isAdmin
}

// After (service)
async findOne(id: string, userId: string, isAdmin: boolean): Promise<SystemUnderTestEntity> {
  this.logger.debug(`findOne: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);
  // ... per-resource guard using isAdmin (unchanged)
}
```

Controller adds `AuthorizationService` injection (now 3rd dep after `SystemsUnderTestService` + `DeleteSystemUnderTestHandler`) plus the `resolveIsAdmin(userId, roles)` helper (same body as C30/C31). All 7 service-call methods on the controller (`create` / `findAll` / `findOne` / `update` / `updatePyroscopeConfig` / `getDeletePreview` / `remove`) `await` the helper once and forward the boolean.

### Verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` (apps/api) | clean |
| `npx eslint --rulesdir eslint-rules 'src/**/*.ts'` | 0 errors, 59 warnings (all `@typescript-eslint/no-explicit-any` warnings — unchanged from C31) |
| `grep -n isGlobalAdmin` on the touched files | only the 7 retained `logger.debug` lines (all reference the `isAdmin` *parameter*) plus a doc-comment in the controller's `resolveIsAdmin` helper; zero call sites |
| `npx jest src/modules/systems-under-test` | 73 passed (2 suites — unchanged from pre-migration) |
| `npx jest` (full API suite) | 4302 passed, 20 skipped (unchanged from C31) |

### Diff size

- `systems-under-test.service.ts`: ~−18 lines (9 inline `isGlobalAdmin` calls deleted + 2 unused debug-log-only `const isAdmin` captures merged into single-line interpolation; signatures swap `roles: string[]` → `isAdmin: boolean`; 8 internal `findOne` self-calls retargeted)
- `systems-under-test.controller.ts`: ~+25 lines (`AuthorizationService` injection + `withOrgFilter` import + `resolveIsAdmin` helper + 7 method awaits)
- `systems-under-test.service.spec.ts`: small touch (rename `testRoles`/`adminRoles` → `testIsAdmin`/`adminIsAdmin`; the 2 `Authorization context` tests reframed to assert the new admin/non-admin lookup paths since `isGlobalAdmin` is no longer called inside the service)
- `systems-under-test.controller.spec.ts`: small touch (add `AuthorizationService` mock provider + 6 expectation updates from `mockUserContext.roles` to literal `true`)
- `.rbac-migration-allowlist.json`: −1 line

Net: roughly +5 lines across all 5 files. Slightly positive because the controller plumbing for a 7-method surface is larger than the previous 5-method surfaces in C30/C31.

### Files changed

- `apps/api/src/modules/systems-under-test/systems-under-test.service.ts` — swap signatures, drop 9 inline `isGlobalAdmin` calls, merge 7 `const isAdmin` captures into log lines, thread `isAdmin` through 8 internal `findOne` self-calls
- `apps/api/src/modules/systems-under-test/systems-under-test.controller.ts` — inject `AuthorizationService`, add `withOrgFilter` import + `resolveIsAdmin` helper, await `isAdmin` in all 7 service-call methods
- `apps/api/src/modules/systems-under-test/systems-under-test.service.spec.ts` — rename roles fixtures, reframe 2 `isGlobalAdmin`-assertion tests
- `apps/api/src/modules/systems-under-test/systems-under-test.controller.spec.ts` — add `AuthorizationService` mock provider, update 6 expectations
- `apps/api/.rbac-migration-allowlist.json` — remove the migrated file
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file (burndown table updates + this section)

### Allowlist disposition

File **EXITS** the allowlist — zero direct `isGlobalAdmin` call sites after the migration. Allowlist size: 3 → **2**. Burndown: Bucket A 68 → 69 of 131 (1 list-filter site migrated). Bucket B 31 → 37 of 38 (6 per-resource guards migrated — total adjusted upward by 6 since `systems-under-test.service.ts`'s per-resource shape was not in the original audit's enumeration; C31's prediction that "no upward adjustment expected" turned out to be wrong, in the same direction as every prior file-finishing PR).

### Pattern notes

**1. The "no upward adjustment expected" prediction was wrong, again.** C31 closed by predicting that the original audit's Bucket A/B enumeration covered systems-under-test directly. It didn't — 6 per-resource guards needed to be added to the Bucket B total. This is the third audit prediction in a row (C16, C25, C32) that under-counted the unmigrated surface and required upward adjustment. The pattern: the original audit was scoped to the dynatrace pilot and a rough codebase-wide count; per-file re-verification consistently finds more sites than the rough count, especially for per-resource (Bucket B) shapes. Future predictions should default to "expect upward adjustment" unless a per-file scan has already been done.

**2. Three-classification migration in one file.** Every prior C-series file had either Bucket A only, Bucket B only, or A+B mixed — never with debug-log-only as a third class. systems-under-test had all three: 1 Bucket A + 6 Bucket B + 2 debug-log-only. The migration treats them uniformly: the parameter swap (`roles → isAdmin`) is identical across all three, the inline `isGlobalAdmin` call is dropped uniformly, and only the *follow-on* shape differs (Bucket A: filter branch; Bucket B: guard branch; debug-log-only: nothing — just the log line preserved). One PR cleanly closed all three classifications because the migration pattern is universal.

**3. Internal self-call density is high here.** systems-under-test has 8 internal `findOne` self-calls across `createSut` (×2), `create` (×1), `update` (×2), `remove` (×1), `updatePyroscopeConfig` (×2). Each one needed its third arg flipped from `roles` to `isAdmin`. Mechanical, but easy to miss in review — every method that does "save then return hydrated record" is a candidate site. A grep for `this.findOne(.*userId.*roles` would have caught all of them in this file; future migrations of services with similar "save → return findOne" shapes should grep first.

**4. Test reframing is the small-but-required cost.** Two service-spec tests asserted `mockAuthzService.isGlobalAdmin` was called with specific roles. After C32 the service no longer calls `isGlobalAdmin`, so those assertions become tautologies (or compile errors, since the mock's `isGlobalAdmin` is no longer reached from the service code path). The fix: reframe the tests to assert the *behavioral consequence* of admin vs non-admin (admin path bypasses `getAccessibleOrganizations` lookup; non-admin path calls it). This is a more durable assertion shape — it would survive a future refactor that swaps `withOrgFilter` for a different admin-check primitive — and is the right shape going forward for any service whose admin-resolution boundary moves to the controller.

### Remaining allowlist (2 files)

After C32, the allowlist contains: `dynatrace.service.ts` (1566 lines), `profiles.service.ts` (1190 lines). Both are heavyweight integration services. Likely sequencing:

- **C33–C34:** `profiles.service.ts` split. Likely a 2–3 PR sequence following the test-runs sub-service C25–C29 pattern: extract method clusters by surface (CRUD vs. metrics-source-resolution vs. variable-resolution) and migrate each cluster independently to keep PRs reviewable.
- **C35–C36:** `dynatrace.service.ts` finish. C17 already migrated the per-resource sites; the remaining surface is the larger CRUD + tile-management shape. Multi-PR split likely.

Phase 3c's user-facing CRUD coverage is now essentially complete: every controller-fronted module has had its admin-resolution boundary pushed to the controller. The remaining work is internal integration services where the entry-point shape differs (dynatrace's tile-management surface is internal-only; profiles' metrics-source-resolution is called from worker pipelines, not just HTTP). The boundary-push pattern still applies but the "boundary" may not always be a controller — for profiles, the parent service that orchestrates pipeline calls is the more natural target.

---

## Phase C33 — `profiles.service.ts` full migration via controller boundary push (combined PR)

**Date:** 2026-05-02
**Branch:** `rbac/3c-profiles-c33`
**Related:** Phase 3c, C30/C31/C32 (controller-as-boundary precedent)

**Scope:** Single-file migration. Drops all 11 direct `authzService.isGlobalAdmin` call sites in `apps/api/src/modules/profiles/profiles.service.ts` (1190 lines pre-edit) and pushes admin resolution up to `ProfilesController`. File **EXITS** the allowlist (2 → **1**). Same `resolveIsAdmin` helper backed by `withOrgFilter` as C30/C31/C32.

The C32 close-out predicted a 2–3 PR split for profiles following the test-runs sub-service pattern. After surveying the file, the split was unnecessary: profiles has a single `ProfilesService` class with three method clusters (Profile CRUD, dashboards sub-resource, benchmarks sub-resource) all fronted by the same controller. The migration is mechanical and the diff fits cleanly into one reviewable PR — so C33 ships the full file in one shot rather than across three (formerly C33/C34/C35).

### Per-method site mapping

The 11 `isGlobalAdmin` sites split into three classifications:

| Method | Bucket | Notes |
| --- | --- | --- |
| `findAll` | A | Returns all profiles when admin (no org filter); otherwise filters by `accessibleOrgIds` (with `OR organization_id IS NULL` legacy clause until Phase 4 adds org_id to Profile entity). |
| `requireOrgAdmin` (private) | B | Custom-guard-helper: admin-bypass, then `isOrgAdminInAnyOrganization` for non-admins. Promoted from "Leave" in the original C2 enumeration. Guards 9 callers (`createDashboard`, `updateDashboard`, `deleteDashboard`, `createBenchmark`, `updateBenchmark`, `deleteBenchmark`, `createProfile`, `updateProfile`, `deleteProfile`). |
| `findOne` | DEBUG-LOG-ONLY | The `isAdmin` value reached only `logger.debug`; per-resource access checks are blocked behind a Phase 4 `organization_id` column note. |
| `findDashboardsByProfileId` | DEBUG-LOG-ONLY | Same as `findOne`. |
| `createDashboard` | DEBUG-LOG-ONLY | Same as `findOne`. (Guard via `requireOrgAdmin` — the `isAdmin` value here is purely for the log line.) |
| `updateDashboard` | DEBUG-LOG-ONLY | Same as `createDashboard`. |
| `deleteDashboard` | DEBUG-LOG-ONLY | Same as `createDashboard`. |
| `findBenchmarksByProfileId` | DEBUG-LOG-ONLY | Same as `findOne`. |
| `createBenchmark` | DEBUG-LOG-ONLY | Same as `createDashboard`. |
| `updateBenchmark` | DEBUG-LOG-ONLY | Same as `createDashboard`. |
| `deleteBenchmark` | DEBUG-LOG-ONLY | Same as `createDashboard`. |

The 9 debug-log-only sites collapse from two lines (`const isAdmin = …; this.logger.debug(...)`) to one (just the log line — `isAdmin` is now the parameter). The 1 Bucket A site (`findAll`) and 1 Bucket B site (`requireOrgAdmin`) drop their inline `isGlobalAdmin` call. All 14 methods that took `roles: string[]` swap to `isAdmin: boolean` (13 user-facing + 1 private helper).

### Migration shape

```typescript
// Before (service)
private async requireOrgAdmin(userId: string, roles: string[]): Promise<void> {
  if (this.authzService.isGlobalAdmin(roles)) return;
  const isOrgAdmin = await this.authzService.isOrgAdminInAnyOrganization(userId);
  if (!isOrgAdmin) throw new ForbiddenException(/* ... */);
}

// After (service)
private async requireOrgAdmin(userId: string, isAdmin: boolean): Promise<void> {
  if (isAdmin) return;
  const isOrgAdmin = await this.authzService.isOrgAdminInAnyOrganization(userId);
  if (!isOrgAdmin) throw new ForbiddenException(/* ... */);
}
```

Controller adds `AuthorizationService` injection (now 2nd dep after `ProfilesService`) plus the `resolveIsAdmin(userId, roles)` helper (same body as C30/C31/C32). All 13 service-call methods on the controller (`findAll` / `findOne` / `create` / `update` / `remove` / `findDashboards` / `createDashboard` / `updateDashboard` / `deleteDashboard` / `getProfileBenchmarks` / `createProfileBenchmark` / `updateProfileBenchmark` / `deleteProfileBenchmark`) `await` the helper once and forward the boolean. The single internal self-call site in `updateProfile` (`this.findOne(id, userId, roles)` after a save) was retargeted to forward `isAdmin`.

### Verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` (apps/api) | clean |
| `grep -n isGlobalAdmin` on the touched files | only the 9 retained `logger.debug` lines (all reference the `isAdmin` *parameter*) plus a doc-comment reference in the controller's `resolveIsAdmin` helper and one in the service's class docblock; zero call sites |
| `npx jest src/modules/profiles/profiles.service.spec.ts src/modules/profiles/profiles.controller.spec.ts` | 106 passed (2 suites — 55 service + 51 controller) |

### Diff size

- `profiles.service.ts`: ~−15 lines (11 inline `isGlobalAdmin` calls deleted + 9 unused debug-log-only `const isAdmin` captures merged into the existing log lines; signatures swap `roles: string[]` → `isAdmin: boolean` on 14 methods; 1 internal `findOne` self-call retargeted)
- `profiles.controller.ts`: ~+25 lines (`AuthorizationService` injection + `withOrgFilter` import + `resolveIsAdmin` helper + 13 method awaits)
- `profiles.service.spec.ts`: tiny touch (rename `mockRoles` → `mockIsAdmin` and change fixture from `['user']` to `true` to preserve the prior admin-path behavior — the original mock's `isGlobalAdmin` always returned `true` regardless of input, so all tests were always exercising the admin path; the swap keeps that)
- `profiles.controller.spec.ts`: small touch (add `AuthorizationService` mock provider + 23 expectation updates from `mockUserContext.roles` to literal `true`)
- `.rbac-migration-allowlist.json`: −1 line

Net: roughly +10 lines across all 5 files.

### Files changed

- `apps/api/src/modules/profiles/profiles.service.ts` — swap signatures on 14 methods, drop 11 inline `isGlobalAdmin` calls, merge 9 `const isAdmin` captures into existing log lines, retarget 1 internal `findOne` self-call
- `apps/api/src/modules/profiles/profiles.controller.ts` — inject `AuthorizationService`, add `withOrgFilter` import + `resolveIsAdmin` helper, await `isAdmin` in all 13 service-call methods
- `apps/api/src/modules/profiles/profiles.service.spec.ts` — rename `mockRoles` → `mockIsAdmin`; change fixture to `true` (preserves prior admin-path test semantics — see Diff size note)
- `apps/api/src/modules/profiles/profiles.controller.spec.ts` — add `AuthorizationService` mock provider, update 23 expectations
- `apps/api/.rbac-migration-allowlist.json` — remove the migrated file
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — this file (burndown table updates + this section)

### Allowlist disposition

File **EXITS** the allowlist — zero direct `isGlobalAdmin` call sites after the migration. Allowlist size: 2 → **1**. Burndown: Bucket A 69 → 70 of 131 (1 list-filter site migrated). Bucket B 37 → 38 of 39 (1 custom-guard-helper migrated — total adjusted upward by 1 since `requireOrgAdmin` was originally classified as "Leave" / CUSTOM-GUARD-HELPER in the C2 enumeration and not counted as a Bucket B site).

### Pattern notes

**1. The original "split into 3 PRs" prediction was wrong, in the opposite direction this time.** C32 closed by predicting a 2–3 PR split for profiles following the test-runs sub-service C25–C29 pattern. The premise was that profiles' three method clusters (Profile CRUD, dashboards, benchmarks) would benefit from independent PRs — but profiles isn't actually three sub-services like test-runs was; it's a single class with three method clusters all fronted by the same controller. The migration is uniform across all clusters, the diff stays under ~250 lines total, and a combined PR is reviewable. The lesson: predict splits when there's a structural seam (separate service classes, separate controllers, separate concerns), not when there's just a method-cluster pattern.

**2. Debug-log-only is dominant in this file.** 9 of the 11 sites are debug-log-only — the highest debug-log-only proportion of any C-series file so far (systems-under-test had 2 of 9; dynatrace had ~13 of 26). The reason: profiles' per-resource permission checks are blocked behind a Phase 4 `organization_id` column on Profile that doesn't exist yet, so the methods only *log* the admin status rather than acting on it. After Phase 4 lands, several of these sites will likely transition from debug-log-only to per-resource Bucket B; the boundary push done here means that transition will be a service-internal change, with no further controller surgery required.

**3. Custom-guard-helper migration is shape-preserving.** The `requireOrgAdmin` helper had two callers' worth of guard logic (admin-bypass + org-admin-fallback). Its body shape is preserved — only the first conditional changes from `if (this.authzService.isGlobalAdmin(roles))` to `if (isAdmin)`. All 9 callers (createDashboard, updateDashboard, deleteDashboard, createBenchmark, updateBenchmark, deleteBenchmark, createProfile, updateProfile, deleteProfile) just forward `isAdmin` instead of `roles`. This is the smallest possible signature swap for a custom-guard-helper migration.

**4. Test fixture semantics matter.** The service spec's `mockRoles = ['user']` fixture combined with the test mock's default `isGlobalAdmin: jest.fn().mockReturnValue(true)` meant all tests were silently running as admin. Naively swapping to `mockIsAdmin = false` would have changed test semantics (non-admin path exercises `getAccessibleOrganizations` which returns `[]` by default, causing early returns). The correct swap is `mockIsAdmin = true` — preserves the prior admin path. A shorter version of the C32 lesson: when migrating tests, look at what the *mock returns* for `isGlobalAdmin`, not what the fixture *passes in*.

### Remaining allowlist (1 file)

After C33, the allowlist contains: `dynatrace.service.ts` (1566 lines). Likely sequencing:

- **C34–C35:** `dynatrace.service.ts` finish. C17 already migrated the per-resource sites; the remaining surface is the larger CRUD + tile-management shape (~13 debug-log-only sites + some Bucket B per-resource shape). Multi-PR split likely given the file's size.

Phase 3c's user-facing surface is now structurally complete. The only remaining file is dynatrace, an internal integration service whose tile-management surface is called from a non-controller boundary. The boundary-push pattern still applies; the "boundary" will likely be the parent service that orchestrates the worker pipeline calls.

---

## Phase C34 — `dynatrace.service.ts` helper refactor + bulk debug-log drop

**Date:** 2026-05-02
**Branch:** `rbac/3c-dynatrace-c34`
**Related:** Phase 3c, C2 (pilot), C17 (per-resource sites)

**Scope:** Single-file partial migration. Drops 19 of the 22 remaining direct `authzService.isGlobalAdmin` call sites in `apps/api/src/modules/dynatrace/dynatrace.service.ts` via two coordinated changes: (1) refactor `requireDynatraceMutationCapability` to drop its `isAdmin` parameter (its 4 callers stop computing `isGlobalAdmin`), and (2) bulk-drop the 15 verified pure-debug-only sites whose downstream usage is now empty. File **stays** in the allowlist — the 3 remaining `if (!isAdmin)` mutation guards (`updateQuery`, `deleteQuery`, `deleteEntityMapping`) are deferred to C35.

This is the first dynatrace-finishing PR since C17 (which closed only the 3 per-resource sites). C17 attempted a bulk drop of all debug-log-only sites and reverted because some `const isAdmin` declarations had downstream uses (`requireDynatraceMutationCapability`'s `isAdmin: boolean` parameter, plus the 3 `if (!isAdmin)` mutation guards). C34 surgically eliminates the helper-parameter pathway first, which makes the 4 helper-callers' `const isAdmin` declarations safe to drop alongside the 15 truly-local debug-log-only sites — the bulk drop that was unsafe in C17 becomes safe after the helper refactor.

### Site classification

The 22 remaining direct `isGlobalAdmin` call sites at C34 entry:

| Bucket | Count | Sites |
|--------|------:|-------|
| Helper-parameter sites (originally DEBUG-LOG-ONLY in C2; promoted to Bucket B) | 4 | `createQuery`, `createQuerySmart`, `bulkImportQuery`, `createEntityMapping` — each computes `isAdmin` and forwards it to `requireDynatraceMutationCapability` |
| Pure DEBUG-LOG-ONLY (no downstream `isAdmin` use) | 15 | `create`, `fetchEntities`, `fetchRequestAttributes`, `getRequestAttributesForConfig`, `findAllQuery`, `findQueryBySystemAndEnvironment`, `findQueryById`, `getDistinctDashboardLabels`, `getPanelTitlesForDashboard`, `getEntityMappings`, `getMetricNames`, `fetchHostProperties`, `fetchHostMetrics`, `fetchHostProblems`, `createHostMetricQueries` |
| `if (!isAdmin)` mutation guards (per-resource Bucket B) | 3 | `updateQuery`, `deleteQuery`, `deleteEntityMapping` — each has a downstream `if (!isAdmin) { … capability check … }` block that needs `canModifyResource`-style migration |

C34 closes 19 sites (the first 2 rows). C35 will close the remaining 3 mutation guards.

### Helper refactor

**Before:**
```typescript
private async requireDynatraceMutationCapability(
  dynatraceConfigId: string,
  userId: string,
  roles: string[],
  isAdmin: boolean,
  op: 'create' | 'update' | 'delete',
): Promise<string | undefined> {
  const parentConfig = await this.repository.findById(dynatraceConfigId);
  if (!parentConfig) throw new NotFoundException(/* … */);

  if (isAdmin) return parentConfig.organizationId;

  if (!parentConfig.organizationId) throw new ForbiddenException(/* … */);

  const requiredCapability = op === 'delete'
    ? Capability.IntegrationDynatraceDelete
    : Capability.IntegrationDynatraceUpdate;
  const caps = await this.authzService.getCapabilities(userId, roles, parentConfig.organizationId);
  if (!caps.includes(requiredCapability)) throw new ForbiddenException(/* … */);
  return parentConfig.organizationId;
}
```

**After:**
```typescript
private async requireDynatraceMutationCapability(
  dynatraceConfigId: string,
  userId: string,
  roles: string[],
  op: 'create' | 'update' | 'delete',
): Promise<string | undefined> {
  const parentConfig = await this.repository.findById(dynatraceConfigId);
  if (!parentConfig) throw new NotFoundException(/* … */);

  const requiredCapability = op === 'delete'
    ? Capability.IntegrationDynatraceDelete
    : Capability.IntegrationDynatraceUpdate;
  const caps = await this.authzService.getCapabilities(
    userId,
    roles,
    parentConfig.organizationId ?? null,
  );
  if (!caps.includes(requiredCapability)) throw new ForbiddenException(/* … */);
  return parentConfig.organizationId;
}
```

Three branches collapse to one capability check. Correctness rests on `CapabilitiesService.compute` (`apps/api/src/common/services/capabilities.service.ts:34`): when `systemRoles` includes a global admin role, the function short-circuits and returns the entire `GLOBAL_ADMIN_CAPABILITIES` set regardless of the org/team scope. So:

- Global admin + org-scoped parent: `getCapabilities(userId, roles, parentConfig.organizationId)` returns admin caps → check passes → returns parent's org.
- Global admin + null-org parent (legacy): `getCapabilities(userId, roles, null)` still returns admin caps (the `compute` short-circuit doesn't depend on org scope) → check passes → returns `undefined`. Same as before.
- Non-admin + org-scoped parent: same code path as before.
- Non-admin + null-org parent (legacy): `getCapabilities(userId, roles, null)` returns `[]` (no orgRoles loaded; non-admin systemRoles contribute no caps) → check fails → throws Forbidden. Same as before.

The four matrix cells preserve exact prior semantics. The redundant explicit `if (isAdmin)` and `if (!parentConfig.organizationId)` branches go away.

### Bulk debug-log drop

The 15 pure-debug-only sites all share the same pattern:

```typescript
const isAdmin = this.authzService.isGlobalAdmin(roles);
this.logger.debug(`<methodName>: …, isGlobalAdmin=${isAdmin}, …`);
```

After C34:

```typescript
this.logger.debug(`<methodName>: …, …`);
```

The `isGlobalAdmin=…` fragment is removed from each log line. C17's bulk drop failed because some sites had downstream uses; C34 verifies emptiness mechanically before each drop. Per-method `awk` count of `isAdmin` references in scope was exactly 2 (the `const` + the log fragment) — confirming no other use. Then for each of the 4 helper-callers, the `const isAdmin` is dropped alongside the helper's now-unused `isAdmin` parameter argument.

### Unused `_roles` parameters

After dropping the debug-log-only sites, 13 service methods now have `roles` parameters that are never read inside the body (the only prior consumer was the `isGlobalAdmin` call). Keeping the parameter — renamed to `_roles` per the existing precedent in `apps/api/src/modules/test-runs/services/test-runs-data-sources.service.ts:371` — preserves the controller's uniform `(…, ctx.userId, ctx.roles)` call shape and signals "intentionally unused, awaiting Phase 4 wiring" without churning every controller call site. The 13 methods: `create`, `fetchEntities`, `fetchRequestAttributes`, `findAllQuery`, `findQueryBySystemAndEnvironment`, `findQueryById`, `getDistinctDashboardLabels`, `getPanelTitlesForDashboard`, `getEntityMappings`, `getMetricNames`, `fetchHostProperties`, `fetchHostMetrics`, `fetchHostProblems`. Two other debug-log-dropped methods — `getRequestAttributesForConfig` (forwards `roles` to `fetchRequestAttributes`) and `createHostMetricQueries` (forwards `roles` to internal calls) — keep the un-prefixed `roles` parameter because it is still consumed downstream.

### Verification

| Check | Result |
|-------|--------|
| `npx jest src/modules/dynatrace` | 114 passed (2 suites), unchanged from C17 baseline |
| `npx jest` (full @perfana/api suite) | 4302 passed, 20 skipped, 0 failed — same baseline as C33 |
| `npm run type-check` (workspace) | 0 errors across all 8 packages |
| `npm run lint` (workspace, @perfana/api) | 0 errors, 59 pre-existing warnings unchanged |
| `grep -c 'isAdmin = this.authzService.isGlobalAdmin' dynatrace.service.ts` | 3 (the 3 mutation-guard sites left for C35) |

### Why the existing tests still pass

The shared mock at `apps/api/test/mocks/authorization-service.mock.ts:92` defaults `getCapabilities` to `GLOBAL_ADMIN_CAPABILITIES`. Existing happy-path tests for `createQuery` / `createQuerySmart` / `bulkImportQuery` / `createEntityMapping` (which previously relied on the helper's `if (isAdmin) return early` shortcut via the default `isGlobalAdmin: jest.fn().mockReturnValue(true)` mock) now flow through the capability check instead — the mock's default cap set includes `IntegrationDynatraceUpdate`, so the check passes and behavior is identical. The negative-path tests at `dynatrace.service.spec.ts:806` / `:823` / `:852` exercise `updateQuery` / `deleteQuery` (still on the unchanged if-block path), so they remain untouched until C35.

### Net diff

- `dynatrace.service.ts`: −56 lines (15 `const isAdmin` lines + 4 helper-caller `const isAdmin` lines + 4 helper-arg lines + 4 helper-impl lines + 15 `, isGlobalAdmin=${isAdmin}` log fragments collapsed into shorter log lines + 9-line `if (isAdmin) return …; if (!parentConfig.organizationId) throw …` branch removed from helper); +12 lines (helper docstring rewrite explaining the `getCapabilities` admin-bypass semantics + 12 `roles` → `_roles` renames preserving signatures). Net ~−45 lines.

### Files changed

- `apps/api/src/modules/dynatrace/dynatrace.service.ts` — helper refactor + 19 site drops + 12 `_roles` renames

### Allowlist disposition

File **remains** in `.rbac-migration-allowlist.json` — 3 mutation-guard sites still trip the lint rule. Allowlist size unchanged at 1. Burndown: Bucket B 38 → 42 of 43 (4 helper-passing sites migrated — total adjusted upward by 4 since C2 misclassified them as DEBUG-LOG-ONLY despite their helper-parameter usage). The 15 pure-debug-only drops are not bucket-counted (consistent with C7/C12/C14/C33 precedent — DEBUG-LOG-ONLY sites are outside the burndown table; they're incidental cleanup).

### Pattern notes

**1. Helper refactor unblocks bulk drop.** C17's lesson was "the bulk drop pattern only matches if `isAdmin` is *truly local-only*; verify with a downstream-reference check before running the script". C34 generalizes that lesson: when downstream-reference checks find a *pattern* (the `isAdmin: boolean` helper parameter, used in 4 places), refactor the pattern away first, then the bulk drop becomes safe for those 4 sites alongside the truly-local ones. The helper refactor + bulk drop in a single PR is more reviewable than a 5-PR sequence (1 per helper-caller + 1 for the helper) because the four caller diffs are mechanically identical and the helper's correctness argument (capability-set short-circuit for admins) is best read alongside the call-site changes that depend on it.

**2. `getCapabilities` is the right indirection for capability-bypass cases.** Bucket B sites that were "admin OR has-capability" guards can usually be collapsed to "has-capability" once `CapabilitiesService.compute` short-circuits on global admin (which it does for every system role in `GLOBAL_ADMIN_ROLES`). The `withOrgFilter` indirection covers list-filter cases (Bucket A); `canAccessResource`/`canModifyResource` cover ownership-style per-resource cases; `getCapabilities` covers capability-style per-resource cases. C34 is the first PR to use the third primitive for the lint-bypass purpose. Future per-resource Bucket B sites with capability semantics (rather than ownership semantics) can use the same pattern.

**3. `_roles` is the right shape for Phase-4-pending unused params.** Removing `roles` entirely would have required updating the controller's 12 call sites and 12 spec test fixtures, plus re-adding the parameter when Phase 4 wires up the `organization_id` columns on Dynatrace entities. The `_roles` rename is a 12-character change per method that preserves the controller signature and signals intent. Precedent: `test-runs-data-sources.service.ts:371-718` uses `_userId, _roles` for the same reason. Net: 12 service-method renames + 0 controller changes + 0 spec changes vs. 12 + 12 + 12 for the alternative.

**4. C17's 21-debug-log-only count was off by 6.** C17 estimated "21 debug-log-only sites + 5 internal `isAdmin`-passing sites". The actual distribution at C34 entry: 15 debug-log-only + 4 helper-passing + 3 if-block = 22 total. The 5th "internal `isAdmin`-passing" site C17 counted was the helper's parameter usage (not a separate call site), and the C2 enumeration's debug-log-only count over-counted because some of those sites also had helper-passing usage that was missed at audit time. Verification by running per-method `awk` counts before bulk drops is the cheapest way to keep these enumerations honest.

### Remaining work in dynatrace.service.ts

After C34, the file has 3 direct `isGlobalAdmin` call sites left (verified by `grep`):

- Line 833 — `updateQuery`: `if (!isAdmin) { … getCapabilities check … }`
- Line 879 — `deleteQuery`: same shape
- Line 1060 — `deleteEntityMapping`: same shape

All three are per-resource mutation guards with capability semantics — the same `getCapabilities` short-circuit argument from the helper refactor applies. **C35** will collapse all three to direct `getCapabilities` calls (or to `canModifyResource` if the entities pick up `organization_id` columns first), drop the 3 `isGlobalAdmin` sites, and **EXIT the allowlist** — the last file in Phase 3c's per-file lint burndown.
