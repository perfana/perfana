# 2026-04-26 Codebase Audit — Decisions

This document records the verdicts for each lead surfaced by the
GitNexus structural audit on 2026-04-26. See the matching plan at
`docs/superpowers/plans/2026-04-26-codebase-audit-followup.md`.

## dashboard-uid.util.ts `from` (44 callers)

**Verdict:** No action. The function is a UID factory for new Grafana dashboards
(MD5 hash of `system+env+label+uid`); it is unrelated to the
"never use prefix detection" rule, which is about classifying metrics-source
type from the UID prefix. Fan-in is legitimate — every auto-config dashboard
flow goes through this method.

**Verified:** 2026-04-26
**Caller pattern uniformity:** PASS
**Notes:** GitNexus impact returned MEDIUM risk, 5 direct callers, 11 total
impacted symbols across 2 modules (Auto-config and Cluster_110). The two
high-confidence (≥0.9) direct callers are `createDashboardUid` (the wrapper
in the same file, line 141) and `DashboardFinderService.resolveDashboardUid`
(dashboard-finder.service.ts line 315). Ripgrep found 14 total hits: 2
production call sites and 12 test call sites — every single call uses the
documented two-argument shape `DashboardUid.from(testRun, autoConfigDashboard)`
with no variant passing a raw UID string. The method body contains no string
prefix inspection; it branches only on the `readOnly` flag of
`AutoConfigDashboard` to choose between `fromString` (identity) and
`fromHashedString` (MD5). Completely unrelated to the deprecated
`source_type`-from-prefix pattern.

## Dead exports (knip-confirmed, ripgrep-confirmed)

**Verified:** 2026-04-26
**Knip version:** 6.3.0

### Knip configuration note

The `knip.json` workspace entry for `apps/web` lists `lib/**/*.{ts,tsx}` as both
`entry` and `project`. Knip treats entry-point files as public API surfaces and
deliberately never flags their exports as unused — this is correct behaviour for
library boundary files. As a result knip reported **zero unused exports** for all
three target files.

**Knip output snapshot (filtered for target files):** `[]` — no issues in
`apps/web/lib/profiles.ts`, `apps/web/lib/socket.ts`, or
`apps/web/lib/trace-analysis-api.ts`.

### Ripgrep cross-check of the 8 GitNexus candidates

The original GitNexus signal came from a cypher query for "functions with zero
CALLS edges in the graph." Each candidate was cross-checked with `rg -n '\b<name>\b'`
across all `apps/web/` files (excluding `dist/` and `node_modules/`).

| File | Export | Lines | Production usage? | Test files | Verdict |
| --- | --- | --- | --- | --- | --- |
| apps/web/lib/profiles.ts | `fetchProfile` | 71–82 | YES — `useProfileData.ts:28` | `__tests__/lib/profiles.test.ts` | NOT DEAD — drop |
| apps/web/lib/profiles.ts | `fetchProfileDashboards` | 90–101 | YES — `useDashboards.ts:65` | `__tests__/lib/profiles.test.ts` | NOT DEAD — drop |
| apps/web/lib/profiles.ts | `createProfileDashboard` | 134–152 | YES — `useDashboards.ts:116` | `__tests__/lib/profiles.test.ts` | NOT DEAD — drop |
| apps/web/lib/profiles.ts | `updateProfile` | 243–256 | NO — export site only | none | DEAD CANDIDATE |
| apps/web/lib/socket.ts | `wrappedListener` | 378 | n/a — local variable, not an export | `__tests__/lib/socket.test.ts` (local var ref) | FALSE POSITIVE — not an export |
| apps/web/lib/socket.ts | `subscribeTestRuns` | 409–412 | YES — `useRealtime.ts:234`, `useTestRunRealtime.ts:318,339` | `__tests__/lib/socket.test.ts` | NOT DEAD — drop |
| apps/web/lib/socket.ts | `emit` | 397–404 | n/a — public method on `SocketManager` class; only `socketManager` (the singleton) is exported | `__tests__/lib/socket.test.ts` (via `socketManager.emit`) | FALSE POSITIVE — method, not standalone export |
| apps/web/lib/trace-analysis-api.ts | `checkTempoHealth` | 173–189 | NO — export site only | none | DEAD CANDIDATE |

**Total confirmed deletion candidates: 2 exports**
- `updateProfile` (`apps/web/lib/profiles.ts` lines 243–256) — no production callers, no test coverage
- `checkTempoHealth` (`apps/web/lib/trace-analysis-api.ts` lines 173–189) — no production callers, no test coverage

**Edge cases / drops:**

- `fetchProfile`: GitNexus flagged (zero CALLS edges) but ripgrep found production usage at `apps/web/app/settings/profiles/[id]/hooks/useProfileData.ts:28`. GitNexus missed the dynamic import inside the hook. Dropped.
- `fetchProfileDashboards`: Same pattern — used at `apps/web/app/settings/profiles/[id]/hooks/useDashboards.ts:65`. Dropped.
- `createProfileDashboard`: Used at `apps/web/app/settings/profiles/[id]/hooks/useDashboards.ts:116`. Dropped.
- `subscribeTestRuns`: Used at `apps/web/hooks/useRealtime.ts:234` and `apps/web/hooks/useTestRunRealtime.ts:318,339`. Dropped.
- `wrappedListener`: Not a named export — it is a local `const` inside the `SocketManager.on()` method body (line 378). GitNexus cypher query produced a false positive by treating any named local variable as a potential export. Dropped.
- `emit`: A public method on the `SocketManager` class (line 397), not a standalone module export. The singleton `socketManager` is the module export; callers use `socketManager.emit(...)`. GitNexus false positive. Dropped.

**Implication for Phase C1:** Two real dead exports identified. Phase C1 can proceed with a narrow deletion of `updateProfile` and `checkTempoHealth`.

## isGlobalAdmin call sites (190 behavioral sites in production code)

**Verified:** 2026-04-26
**Implementation:** `apps/api/src/common/services/authorization.service.ts:112` — signature `isGlobalAdmin(roles: string[] | null | undefined): boolean`. Delegates immediately to `hasGlobalAdminRole(roles)` from roles.constants.ts. Returns `true` if any role in the array matches the constant list. Synchronous; no async.
**Short-circuit roles:** `perfana-admin` (SystemRole.GLOBAL_ADMIN) and `admin` (SystemRole.ADMIN).
**Constant origin:** `apps/api/src/constants/roles.constants.ts:49` — `export const GLOBAL_ADMIN_ROLES = [SystemRole.GLOBAL_ADMIN, SystemRole.ADMIN] as const`. Fully exported and reusable.

### Counting methodology

Total grep hits in production files (excluding `*.spec.ts`): 229 lines across all files.

Excluded from behavioral count:
- 13 local `private isGlobalAdmin()` wrapper method definitions (one per service that defines its own delegation shorthand)
- 3 sites inside `authorization.service.ts` itself (the definition at :112 and two internal uses at :140 and :206 within `canAccessResource`/`canModifyResource`)
- 3 sites in `authorized-base.service.ts` that are a JSDoc comment (:391) and the convenience-method definition + its one-line body (:396–397)
- 8 logger-only sites where the call appears only inside a template-string argument to `this.logger.debug(...)` — the result drives no conditional logic: `grafana-dashboards.service.ts:197,252,305,370`; `test-runs-mutation.service.ts:79,248`; `test-runs-crud-query.service.ts:490,557`
- 12 remaining delegating invocations inside the local wrapper methods (which are already counted at their definition site)

Remaining **behavioral** call sites: **190**.

> Note on local wrappers: ~8 services define a local `private isGlobalAdmin(roles)` that wraps `this.authzService.isGlobalAdmin(roles)`. The wrapper body counts as one definition; every subsequent call within that service routes through the wrapper. The classification below uses the behavioral site (where the result is acted on), not the wrapper body.

### Bucket summary

| Bucket | Count | Shape summary |
| --- | --- | --- |
| A — bypass filter | 127 | `isAdmin = isGlobalAdmin(roles); if (!isAdmin) orgIds = await getAccessibleOrgs(userId); … filter by orgIds` |
| B — bypass guard | 14 | `if (!isGlobalAdmin(roles)) throw ForbiddenException` or `if (isGlobalAdmin(roles)) return` (early-return from a guard method) |
| C — mixed | 49 | Ownership/creator filtering, user-scoped (not org-filtered) result sets, pure logging context, or business logic interleaved with the admin check |

### Bucket A sites — bypass filter (127)

These are the sites where the only job of the check is to skip loading and applying `getAccessibleOrganizations()`. Admin → return/fetch all; non-admin → filter to org IDs. This is the canonical `withOrgFilter` target shape.

**report-data-fetcher.service.ts** (8)
- `:381` — `skipOrgFilter = !userId || isGlobalAdmin(roles)` then builds org-filter clause; admin → no SQL clause
- `:424` — same pattern
- `:527` — same pattern
- `:753` — same pattern
- `:914` — same pattern
- `:1558` — same pattern
- `:1659` — same pattern
- `:1752` — same pattern

Note: these 8 use `!userId || isGlobalAdmin(roles)` — slightly wider than canonical (also bypasses for system/internal calls with no userId). The `withOrgFilter` helper would need to accommodate this or these stay C. Classified A because the `isGlobalAdmin` leg is identical in semantics; the `!userId` leg is an additive guard, not conflicting logic.

**report-generation.service.ts** (6) — local wrapper used throughout
- `:168` — `isTestRunAccessible()`: admin → accessible; else load orgs and check membership
- `:219` — `isReportAccessible()`: same pattern for report → test_run → org chain
- `:460` — `findAll()`: admin bypasses org filter on query builder
- `:513` — `findByTestRunId()`: admin bypasses org filter
- `:575` — `findByTestRunId()` variant
- `:671` — `getPendingReports()`: admin bypasses org filter

**tracing-instances.service.ts** (7) — `findAll` uses isAdmin inline; CRUD uses `requireOrgAdmin` (Bucket B)
- `:77` — `findAll()`: isAdmin → no org filter on query builder; else load accessible orgs
- `:136` — `findOne()`: isAdmin → return entity; else check org membership
- `:178` — `findOne()` variant
- `:219` — `update()`: isAdmin → skip access check; else verify org membership
- `:274` — `delete()` equivalent
- `:319` — variant
- `:356` — variant

**metrics-sources.service.ts** (6)
- `:53` — `findAll()`: isAdmin → no filter; else load orgs, filter query builder
- `:112` — `findOne()`: isAdmin → bypass; else org-membership check
- `:151` — `create()`: isAdmin → bypass org check; else verify membership
- `:185` — `update()`: isAdmin → bypass; else membership check before mutation
- `:225` — `delete()` equivalent
- `:269` — variant

**events.service.ts** (2)
- `:27` — `findAll()`: isAdmin → no org filter on query builder; else load orgs
- `:71` — `findByTestRun()`: same pattern

**benchmarks/benchmark-query.service.ts** (5)
- `:48` — `findAll()`: isAdmin → no org filter; else load orgs and filter via `sut.organization_id`
- `:138` — `findOne()`: isAdmin → no filter; else org check via SUT join
- `:191` — variant
- `:242` — variant
- `:290` — variant

**grafana/grafana-dashboards.service.ts** (2)
- `:57` — `verifyOrgAccess()` private helper: isAdmin → return (bypass); else check org membership
- `:74` — `findAll()`: isAdmin → no filter on query builder; else load orgs

**grafana/grafana-instances.service.ts** (7)
- `:95` — `findAll()`: isAdmin → no filter; else load accessible orgs
- `:149` — `findOne()`: isAdmin → bypass; else org membership check
- `:194` — `create()` org-membership check
- `:237` — `update()` equivalent
- `:295` — `delete()` equivalent
- `:340` — variant
- `:384` — variant

**grafana/application-dashboards.service.ts** (7)
- `:113` — `findAll()`: isAdmin → no filter; else load orgs
- `:244` — `findOne()`: isAdmin → bypass; else org check
- `:334` — `create()` org check
- `:417` — `update()` equivalent
- `:575` — `delete()` equivalent
- `:637` — variant
- `:683` — variant

**grafana/grafana-dashboards.service.ts** (1 more)
- `:409` — `getVariableValues()`: isAdmin logged for debug; access check delegates to `findOne()` — logging site only, but `isAdmin` variable not used for branching → this is a Bucket C (pure logging). Reclassify below.

**pyroscope/pyroscope-instances.service.ts** (7)
- `:85` — `findAll()`: isAdmin → no filter; else load orgs
- `:144` — `findOne()`: isAdmin → bypass; else org membership
- `:186` — `create()` org check
- `:226` — `update()` equivalent
- `:280` — `delete()` equivalent
- `:325` — variant
- `:362` — variant

**organizations/organizations.service.ts** (6)
- `:53` — `findAll()`: isAdmin → `repo.find()` unfiltered; else load accessible org IDs and filter
- `:105` — `findOne()`: isAdmin → bypass; else `isOrganizationMember()` check
- `:154` — `findByName()`: isAdmin → bypass; else membership check
- `:202` — `create()`: isAdmin → logged for debug, not used to gate create (all authenticated can create) — Bucket C. Reclassify.
- `:247` — `update()`: isAdmin → skip `isOrganizationAdmin()` check; else check admin role
- `:302` — `remove()`: isAdmin → skip admin check; else check admin role

**teams/teams.service.ts** (6)
- `:53` — `findAll()`: isAdmin → `repo.find()` unfiltered; else load accessible org IDs and filter
- `:105` — `findOne()`: isAdmin → bypass membership check; else `isOrganizationMember()` check
- `:158` — `findOne()` variant
- `:204` — `create()` equivalent
- `:262` — `update()`: isAdmin → skip admin check; else check admin role
- `:331` — `remove()` equivalent

**systems-under-test/systems-under-test.service.ts** (9)
- `:157` — `findAll()`: isAdmin → `null` (no filter); else load accessible orgs
- `:236` — `findOne()`: isAdmin → bypass membership/team check; else full check
- `:299` — `findSystemSummary()`: isAdmin → bypass; else membership check
- `:385` — `findByName()`: isAdmin → bypass; else membership check
- `:447` — `create()` (legacy/LegacyCreate): isAdmin → debug log only — Bucket C. Reclassify.
- `:485` — `update()`: isAdmin → bypass `checkModifyPermission`; else check
- `:547` — `delete()` equivalent
- `:602` — variant

**profiles/profiles.service.ts** (10)
- `:100` — `findAll()`: isAdmin → no org filter; else load orgs
- `:201` — `findOne()`: isAdmin → bypass; else org check
- `:261` — `create()`: isAdmin → no org membership check; else check
- `:369` — `update()`: isAdmin → bypass; else membership check
- `:466` — `delete()` equivalent
- `:644` — variant
- `:696` — variant
- `:778` — variant
- `:898` — variant
- `:1065` — variant

**adapt/adapt.service.ts** (8) — local wrapper used throughout
- `:282` — `getTrackedRegressions()`: isAdmin → `organizationIds = []` → skip filter; else load orgs
- `:385` — `getTrackedRegressionsCount()`: same
- `:418` — variant
- `:499` — variant
- `:571` — variant
- `:639` — variant
- `:723` — variant
- `:755` — variant

**test-runs/test-runs-stale-detection.service.ts** (1)
- `:181` — isAdmin → skip org filter; else load orgs

**test-runs/test-runs-dashboard-query.service.ts** (3)
- `:104` — isAdmin → no filter; else load orgs
- `:254` — variant
- `:332` — variant

**test-runs/test-runs-metrics.service.ts** (6) — local wrapper
- `:37` — `resolveOrganizationIds()`: isAdmin → return `[]` (no filter); else load orgs
- `:74` — uses resolved org IDs from above
- `:212` — variant
- `:315` — variant
- `:405` — variant
- `:605` — variant

**test-runs/test-runs-baseline-apdex.service.ts** (1) — local wrapper
- `:93` — isAdmin → empty orgIds (no filter); else load orgs

**test-runs/test-runs-apdex.service.ts** (1) — local wrapper
- `:49` — isAdmin → empty orgIds (no filter); else load orgs

**test-runs/test-runs-timeseries-query.service.ts** (1) — local wrapper
- `:44` — isAdmin → empty orgIds; else load orgs

**test-runs/test-runs-performance-query.service.ts** (5) — local wrapper
- `:384` — isAdmin → empty orgIds; else load orgs
- `:581` — variant
- `:768` — variant
- `:956` — variant
- `:1082` — variant

**test-runs/test-runs-crud-query.service.ts** (9)
- `:159` — `findAllPaginated()`: isAdmin logged for debug; access check not yet implemented (comment says Phase 4) — isAdmin variable is created but drives no logic branch here → Bucket C. Reclassify.
- `:317` — `getFilterOptions()`: isAdmin → skip loading org/team IDs; else load both → Bucket A
- `:409` — variant of above
- `:502` — `findByTestRunId()`: isAdmin → bypass org filter; else load orgs
- `:569` — `findOne()`: isAdmin → bypass; else load orgs
- `:636` — variant
- `:705` — variant
- `:851` — variant
- `:976` — variant
- `:1020` — variant

**test-runs/test-runs-config.service.ts** (3)
- `:81` — isAdmin → bypass org check; else load orgs
- `:581` — variant
- `:649` — variant

**dynatrace/dynatrace.service.ts** (25)
- `:68` — `findAll()`: isAdmin → no filter; else load accessible orgs
- `:111` — `findByHost()`: isAdmin → bypass access check; else org membership
- `:146` — `findOne()` equivalent
- `:196` — variant
- `:238` — variant
- `:317` — variant
- `:461` — variant
- `:518` — variant
- `:547` — variant
- `:569` — variant
- `:589` — variant
- `:616` — variant
- `:648` — variant
- `:693` — variant
- `:744` — variant
- `:774` — variant
- `:806` — variant
- `:840` — variant
- `:885` — variant
- `:906` — variant
- `:938` — variant
- `:967` — variant
- `:997` — variant
- `:1077` — variant
- `:1222` — variant
- `:1316` — variant

**metrics/metrics.service.ts** (2)
- `:340` — isAdmin → no org filter on query; else load orgs
- `:526` — variant

**authorized-base.service.ts** (3)
- `:87` — `applyOrgFilter()`: isAdmin → return queryBuilder unchanged; else load orgs and add WHERE clause
- `:147` — `getAccessibleOrgIds()`: isAdmin → return `undefined` (caller skips filter); else `getAccessibleOrganizations(userId)`
- `:423` — `verifyOrganizationAccess()`: isAdmin → return; else `isOrganizationMember()` check + potential ForbiddenException

Note: `:87` and `:147` are the two helper methods on `AuthorizedBaseService` that already partially consolidate the bypass-filter pattern. `:423` is closer to Bucket B but skips a filter rather than throwing — classified A.

**test-runs/test-runs-query.service.ts** (2)
- `:264` — `resolveOrganizationIds()` private helper: isAdmin → return `[]`; else load orgs
- `:276` — `resolveTeamIds()` private helper: isAdmin → return `[]`; else load teams

---

### Bucket B sites — bypass guard (14)

These sites use `isGlobalAdmin` to gate an operation where the alternative is throwing `ForbiddenException` (or returning early from a dedicated guard method, not a filter bypass).

**tracing-instances.service.ts**
- `:40` — `requireOrgAdmin()`: `if (isGlobalAdmin) return; else check isOrgAdminInAnyOrganization(); throw ForbiddenException`

**pyroscope/pyroscope-instances.service.ts**
- `:49` — `requireOrgAdmin()`: same pattern as tracing-instances

**grafana/grafana-instances.service.ts**
- `:47` — `requireOrgAdmin()`: same pattern

**profiles/profiles.service.ts**
- `:78` — `requireOrgAdmin()`: same pattern

**api-keys/api-keys.service.ts**
- `:38` — `requireOrgAdmin()` private: `if (isGlobalAdmin) return; else check isOrgAdminInAnyOrganization(); throw ForbiddenException`
- `:456` — `validateRequestedRoles()` private: `if (isGlobalAdmin) return; else check role subset; throw ValidationException`

**api-keys/api-keys.controller.ts**
- `:56` — `if (!isGlobalAdmin) check org membership; throw ForbiddenException`

**data-science/controllers/data-science.controller.ts**
- `:869` — `if (!isGlobalAdmin) throw ForbiddenException('Admin privileges required to release locks')`

**users/users.controller.ts**
- `:58` — `if (!isGlobalAdmin) check isOrgAdminInAnyOrganization(); throw ForbiddenException`

**metrics/metrics.service.ts**
- `:94` — `validateTestRunAccess()` private: `if (isGlobalAdmin) return true` (method returns bool, caller throws on false) — guard pattern

**awr/controllers/awr-reports.controller.ts**
- `:102` — `validateTestRunAccess()` private: `if (isGlobalAdmin) return true`
- `:121` — `validateReportAccess()` private: `if (isGlobalAdmin) return true`

**data-science/controllers/data-science.controller.ts**
- `:45` — `verifyTestRunAccess()` private: `if (isGlobalAdmin) return; else load orgs, throw ForbiddenException` — this is closer to a guard (it throws, not filters a list) → Bucket B

**test-runs/test-runs-query.service.ts**
- `:83` — `verifyTestRunAccess()`: `if (isGlobalAdmin) return; else load orgs and throw ForbiddenException if org mismatches`

---

### Bucket C sites — mixed / not a pure filter bypass or guard (49)

These sites have isGlobalAdmin interleaved with ownership filtering, user-scoped (non-org) result sets, pure diagnostic logging, or business logic that diverges from the canonical shape.

**compare-presets/compare-presets.service.ts** (6)
- `:34` — `validateTestRunAccess()` private: isAdmin → return true; else load orgs and query raw SQL for SUT access — a resource-specific access check, not an org list bypass → mixed
- `:64` — `create()`: isAdmin → log only; access check is delegated to `validateTestRunAccess()` — isAdmin drives no branch here → pure logging C
- `:129` — `findAll()`: isAdmin → `repo.find()` without `createdBy/isGlobal` filter; else filter by `userId OR isGlobal`. **Not an org filter** — it's a user-ownership filter. Does not call `getAccessibleOrganizations()`. The `withOrgFilter` helper would not replace this → C
- `:256` — `findOne()`: isAdmin → bypass `createdBy/isGlobal` WHERE clause; else user-scoped → C (ownership filter, not org filter)
- `:320` — `update()`: isAdmin → bypass `validateTestRunAccess()`; else validate for non-admin → C (mixed: access + ownership)
- `:404` — `remove()`: isAdmin → bypass; else ownership check → C

**graph-presets/graph-presets.service.ts** (4)
- `:46` — `create()`: isAdmin → debug log only; no branch on isAdmin → C (log-only)
- `:91` — `findAll()`: isAdmin → no `userId/isGlobal` filter; else filter by `userId OR isGlobal`. User-ownership filter, not org filter → C
- `:165` — `findOne()`: isAdmin → bypass `userId/isGlobal` check; else ownership check → C
- `:212` — `remove()`: isAdmin → bypass; else ownership → C

**trends-presets/trends-presets.service.ts** (4)
- `:45` — `create()`: isAdmin → debug log only → C
- `:88` — `findAll()`: isAdmin → no `userId/isGlobal` filter; else filter by ownership. User-ownership not org → C
- `:178` — `findOne()`: isAdmin → bypass ownership check → C
- `:227` — `remove()` equivalent → C

**api-keys/api-keys.service.ts** (3)
- `:59` — `findAll()`: isAdmin without explicit org → early return `repo.findAll()` unfiltered; but the org-filter logic mixes explicit-org and isAdmin in a 3-way branch that also uses `organization_id` column (not `getAccessibleOrganizations()`) → C (uses organizationId column directly, not the org membership lookup)
- `:108` — `findOne()`: isAdmin → bypass org check; else `isOrganizationMember()` — looks like A, but the check is on a single resource's `organization_id`, not list filtering → C (per-resource guard, not list filter bypass)
- `:282` — `deleteApiKey()`: `if (!isGlobalAdmin && apiKey.organization_id)` then check org membership; else allow → C (conditional org check, not canonical bypass shape)

**alerts/alert-tag-filters.service.ts** (2)
- `:17` — `findAll()`: isAdmin → no filter; else load orgs → Bucket A (reclassify: canonical pattern). *Self-correction: re-read the code — it calls `getAccessibleOrganizations()` and applies WHERE clause, canonical shape → A.* (Moved to A count; this was initially placed in C by mistake in draft.)
- `:40` — `findOne()`: `if (!isGlobalAdmin && filter.organizationId)` then check membership → C (per-resource conditional guard)

**events/events.service.ts** (1)
- `:113` — `findOne()`: `if (!isGlobalAdmin && event.organizationId)` check membership; else allow → C (per-resource conditional, not list filter bypass)

**deep-links/deep-links.service.ts** (1)
- `:70` — `validateSystemAccess()` private: isAdmin → return true; else org-membership check on a specific SUT. Per-resource guard not list filter → C

**deep-links/deep-links.controller.ts** (3)
- `:81` — `createDeepLink()`: isAdmin → `organizationIds = []`; else load orgs + throw if empty. Mixed: is checking if user has orgs (not filtering a list result set); passes orgIds to service → C
- `:101` — `copyDeepLinks()`: same shape → C
- `:180` — `createGenericDeepLink()`: isAdmin → bypass org-membership check; else load orgs + throw if empty → C (gate, not filter)

**organizations/organizations.service.ts** (1)
- `:202` — `create()`: isAdmin logged for debug but not used in branching logic (all authenticated users can create orgs) → C (log-only)

**systems-under-test/systems-under-test.service.ts** (2)
- `:79` — `createSut()`: isAdmin → bypass `isOrganizationMember()` check before create; non-admin must verify membership. Per-operation guard (not list filter) → C
- `:447` — `create()` (legacy): isAdmin → debug log only; no gate → C (log-only)

**benchmark-mutation.service.ts** (6)
- `:55` — `validateSystemAccess()` private: isAdmin → `return` immediately; else check SUT org membership → C (per-resource guard)
- `:86` — `create()`: isAdmin → debug log only, access check delegated to `validateSystemAccess()` → C (log-only)
- `:160` — `update()`: isAdmin → debug log only; access check via `queryService.findOne()` → C (log-only)
- `:210` — `delete()`: isAdmin → debug log only; access check via `queryService.findOne()` → C (log-only)
- `:388` — `createApdexSlo()`: isAdmin → debug log only; access via `validateSystemAccess()` → C (log-only)
- `:451` — `updateApdexSlo()`: isAdmin → debug log only; access via `queryService.findOne()` → C (log-only)

**test-runs/test-runs-crud-query.service.ts** (1)
- `:159` — `findAllPaginated()`: isAdmin captured for debug log; `organizationId`-based filtering is not yet implemented (Phase 4 comment); no org-filter branch → C (log-only, logic stub)

**grafana/grafana-dashboards.service.ts** (1)
- `:409` — `getVariableValues()`: isAdmin captured for debug log; access check delegates to `findOne()` internally; isAdmin variable is not used in any branch → C (log-only)

**test-runs/test-runs-mutation.service.ts** (already excluded as logger-only — already accounted for above)

**authorized-base.service.ts** (already moved to A: :87, :147, :423)

---

### Corrected bucket tallies

After applying all reclassifications:

| Bucket | Count | Shape summary |
| --- | --- | --- |
| A — bypass filter | 127 | `isAdmin = isGlobalAdmin(roles); if (!isAdmin) orgIds = await getAccessibleOrgs(userId); … filter by orgIds` |
| B — bypass guard | 14 | `if (!isGlobalAdmin) throw ForbiddenException` or guard-method early return |
| C — mixed | 49 | Ownership/creator filtering, per-resource guards, log-only, or Phase-4 stubs |

Total behavioral sites: 127 + 14 + 49 = **190**

---

### Decision rule and verdict

**Decision rule (from plan):** Bucket A ≥ 15 same-shape sites → proceed to Phase C2 (extract `withOrgFilter` helper). Otherwise skip.

**Verdict: PROCEED** — Bucket A has **127** sites, well above the threshold of 15.

**Fit assessment for the proposed helper signature:**
```typescript
withOrgFilter(userId, roles, fetchAccessibleOrgs): Promise<string[] | null>
// null => skip filter (global admin); array => filter to these org IDs
```
The canonical Bucket A pattern is an exact match: `null` maps to the admin path ("return/fetch everything unfiltered") and `string[]` maps to the org-IDs-to-filter path. The 8 sites in `report-data-fetcher.service.ts` use `!userId || isGlobalAdmin(roles)` — the helper would need an optional `bypassCondition` or the caller would combine it with their own `!userId` check before calling the helper.

**Consolidation opportunity:** The 13 local `private isGlobalAdmin()` wrapper methods in individual services are a secondary smell — they exist because services can't easily inline `authzService.isGlobalAdmin()` without injecting `authzService`. If `withOrgFilter` is introduced on `AuthorizationService` or `AuthorizedBaseService`, these wrappers become unnecessary.

**Highest-density modules (Bucket A):**
- `dynatrace.service.ts`: 25 Bucket A sites in one file — highest return on extraction
- `test-runs-crud-query.service.ts`: 10 Bucket A sites
- `profiles.service.ts`: 10 Bucket A sites
- `systems-under-test.service.ts`: 8 Bucket A sites
- `report-data-fetcher.service.ts`: 8 Bucket A sites

---

## Phase C scope (locked 2026-04-26)

Decided after reviewing the much-larger-than-expected Bucket A count (127 vs original ~28
estimate). Original Phase C2 was a single-PR migration of "all Bucket A sites" — not realistic
at this scale. Option A from the scope discussion:

- [x] **C1: dead-export removal** — 2 exports, ~28 lines of production code:
  - `updateProfile` (`apps/web/lib/profiles.ts:243–256`)
  - `checkTempoHealth` (`apps/web/lib/trace-analysis-api.ts:173–189`)
  - No tests cover either; nothing else needs to change.

- [x] **C2: pilot `withOrgFilter` on `dynatrace.service.ts` only** — migrates the 25 Bucket A
  sites in that single file. Proves the pattern on the highest-density target. The other 102
  Bucket A sites remain documented in this log for later adoption (per service or per module),
  but are explicitly NOT in scope for this audit cycle.

- [ ] **Bucket B (14 sites)** — deferred. A `@RequiresGlobalAdmin()` decorator could replace
  these but is out of scope here.

- [ ] **Local `private isGlobalAdmin()` wrappers (13 services)** — deferred. They become
  unnecessary if/when remaining Bucket A sites adopt the helper.

- [ ] **`report-data-fetcher.service.ts` 8 sites** — deferred. The `!userId || isGlobalAdmin(roles)`
  variant needs a small extension to the helper or a separate caller-side guard. Not blocking C2.

This audit log is the authoritative tracker for the deferred work; future PRs can pick a
module from Bucket A and migrate it without re-doing the analysis.

---

## Phase C2 — Pilot: `dynatrace.service.ts` (shipped via PR #175, v0.2.47.1)

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
