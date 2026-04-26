# Audit Decisions — 2026-04-26

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
