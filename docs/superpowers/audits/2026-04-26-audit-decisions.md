# Audit Decisions — 2026-04-26

## Migration progress

Phase 3c rolls capabilities through every site listed below. Update these counts on every PR that migrates a site (subtract from the "remaining" column, add to the "migrated" column). When all reach 0 / N, mark Phase 3 as Completed in CLAUDE.md.

| Bucket | Total | Migrated | Remaining | % done |
| --- | ---: | ---: | ---: | ---: |
| A — bypass filter | 127 | 10 | 117 | 7.9% |
| B — bypass guard | 14 | 0 | 14 | 0% |
| Local `private isGlobalAdmin()` wrappers | 13 | 0 | 13 | 0% |

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
