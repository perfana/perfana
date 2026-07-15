# TODOS

Cross-PR follow-up work. Items here are real backlog — captured because
they came up during a planning or review session and shouldn't get lost,
but aren't tied to a single in-flight PR. Format: one entry per item with
priority (P0–P4), origin, and enough context that someone picking it up in
3 months can act without re-deriving the motivation.

When an item ships, move it to the `## Completed` section at the bottom
with the version it landed in.

---

## RBAC

### Add Grafana panel for `auth_capability_denied_total`

**Priority:** P3
**Origin:** /plan-eng-review on `docs/superpowers/plans/2026-04-27-rbac-completion.md` (2026-04-28).
**Depends on:** Phase 3c shipping the metric counter inside `CapabilityGuard`.
**Why:** A spike in capability denials is real ops signal — misconfigured
user, attack, deployment regression, missing membership backfill. Without a
dashboard, the counter is dead data; with one, ops can spot patterns and
alert on per-capability or per-org spikes.
**What:** A Grafana panel in the existing observability dashboard (or a new
RBAC-focused dashboard) showing:
- `rate(auth_capability_denied_total[5m])` per capability, over time.
- Top denied capabilities in the last 24h.
- Per-organization denial counts (label slice).
**Where to start:** confirm Phase 3c has shipped the counter (grep
`auth_capability_denied_total` in `apps/api/src`); decide whether to extend
an existing dashboard or create a new one (check `infra/grafana/dashboards/`
for the pattern); add an alert rule on per-user denial rate >10/min for
attack detection.

### Cold-cache p99 benchmark for `/api/users/me/permissions`

**Priority:** P3
**Origin:** /plan-eng-review on `docs/superpowers/plans/2026-04-27-rbac-completion.md` (2026-04-28).
**Depends on:** Phase 3a deployed (the endpoint must exist).
**Why:** The plan parallelizes per-org capability lookups via `Promise.all`
and uses a versioned cache key strategy to avoid `redis.keys()`. Both should
keep cold-cache p99 at one round-trip's latency regardless of org count, but
neither has been verified empirically. For a user with 20+ orgs (a realistic
admin or support user scenario), a regression could quietly add hundreds of
ms of session-startup latency.
**What:** Hit `/api/users/me/permissions` 100 times for a seeded user with
20 orgs against an empty Redis (cold cache); record p50/p95/p99/max. Repeat
warm cache. Pass criterion: cold p99 < 200ms; warm p99 < 30ms.
**Where to start:** if perfana has a load-test rig (k6, artillery), add a
scenario; if not, a `bun run scripts/bench-me-permissions.ts` ad-hoc script
that fires 100 sequential requests and prints the histogram is enough for
a one-off check.

### Extend `_permissions` enrichment to Dynatrace sub-resources

**Priority:** P3
**Origin:** PR #187 / v0.2.47.8 (RBAC Phase 3 follow-up).
**Depends on:** Nothing — sub-resources already have `organizationId` on the
DTO (added in this PR) and `getCapabilities` is in place.
**Why:** PR #187 closed the *backend* authz bypass on `dynatrace_queries` and
`dynatrace_entity_mappings` — non-admins now correctly get 403 on PATCH/DELETE.
But the *frontend* doesn't know to disable those buttons, so the user only
discovers the denial after clicking and seeing an error. Same UX gap that
Phase 3b closed for the parent `DynatraceConfig`.
**What:** Mirror the Phase 3b pattern on the read endpoints for queries and
entity mappings: `attachPermissions(row, { update: …, delete: … })` with the
booleans computed from `getCapabilities(userId, roles, row.organizationId)`.
Frontend already has `<RequiresPermission>` wired — wrap the
update/delete buttons in the query editor and entity-mapping list.
**Where to start:** `apps/api/src/modules/dynatrace/dynatrace.service.ts` —
the read methods (`findAllQuery`, `findQueryById`, `findQueryBySystemAndEnvironment`,
`getEntityMappings`, `getEntityMappingById`) still have stale "treated as
legacy data" TODO comments. Reuse the batched `capsByOrg` pattern from
`findAll` (lines 105-121). Frontend wrappers go in the same place that
already handles the parent config — `apps/web/app/integrations/components/`
and any DQL query / entity-mapping editor pages.

---

## Reports

### SLO section renders a green "all clear" card when the check-results query fails

**Priority:** P2
**Origin:** Adversarial review during /ship on `fix/report-sut-name-and-slo-units` (2026-07-10). Pre-existing behavior, adjacent to the SLO unit-formatting fix.
**Why:** `getSloCheckResults` swallows any query error (`logger.warn` + return `[]`), and the SLO renderer shows the green ✓ "No SLO check results available" card for an empty list. A transient DB error during generation produces a permanently stored report that visually implies "all clear". Worse: a single `check_results` row whose `requirement->>'value'` isn't castable to numeric throws in the `::numeric` cast and collapses *every* SLO into that green card.
**What:** Distinguish "query failed" from "no results" — e.g. let the error propagate to fail the generation job (it retries), or render an explicit warning card. Consider `NULLIF`-guarding the `::numeric` cast so one malformed row doesn't blank the section.
**Where:** `apps/api/src/modules/reports/services/report-data-fetcher.service.ts` (~1532-1555, the catch), `apps/api/src/modules/reports/renderers/slo-renderer.ts` (empty-state card).

---

## Tests

### Consider clearing `persistedListeners` on manual `disconnect()`

**Priority:** P3
**Origin:** Noticed during /investigate of failing web tests on `fix/web-stale-failing-tests` (2026-05-31).
**Why:** `socketManager.disconnect()` tears down the socket but intentionally preserves `persistedListeners` so they survive transient reconnects. A *manual* disconnect is a full teardown though — a later `connect()` re-attaches listeners the caller may have meant to drop. This same leak caused the socket `on()` test to grab a stale handler across the suite (worked around in the test, not the source).
**What:** Decide whether a manual `disconnect()` should clear `persistedListeners` while reconnect-triggered teardown keeps them. If yes, distinguish manual teardown from reconnect teardown.
**Where:** `apps/web/lib/socket.ts` — `disconnect()` (~line 281) and `persistedListeners` (~line 55).

---

## Completed

### Fix pre-existing DynatraceCard test failures (23 tests)

Root cause was not label/markup drift but the expanded card's primary tab order: Hosts rendered at index 0 (default) and Services at index 1, contradicting the component's own "Services | Hosts" comment. Since Hosts is disabled with zero host entities, a services-only run opened to a disabled empty tab and all Services content (service sub-tabs, request filtering, analysis, comparison) stayed hidden. Swapped Services to index 0. DynatraceCard suite back to 47/47.
**Completed:** v0.2.61.61 (2026-07-15)

### Regenerate ADAPT golden-file snapshot

Resolved by gating instead of regenerating. The failure was environmental: the guard ran the strict comparison against *any* PerfanaWebshop data, so dev DBs with a different row count (771/1,041 vs the fixture's 950) produced false failures. `dbAvailable` now requires `storedCount === goldenFile.resultCount`, so the test runs only against the exact golden snapshot and skips (with a reseed warning) everywhere else. The golden file (950) is left intact as the regression baseline — exactly what the old Note asked for.
**Completed:** v0.2.61.61 (2026-07-15)

### Fix pre-existing web test failures (socket + TestRunDetailsCard)

Updated stale test assertions to match intentional source changes: socket transport order (polling-first, #377), socket `on()` listener registration (state-leak workaround + rename), and abort UI (`<Chip label="Aborted">` instead of removed text). Full web suite back to 3963/3963.
**Completed:** v0.2.61.2 (2026-05-31)
