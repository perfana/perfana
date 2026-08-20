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

### Fail fast when the API's DB role cannot bypass RLS

**Priority:** P2
**Origin:** Red team review during /ship on `fix/api-key-authz-rls-and-denial-logging` (2026-08-18).
**Why:** `AuthorizationService` resolves an API key's organization by reading
`api_keys` on the pooled connection, deliberately outside RLS (the read is an
*input* to the RLS context, so scoping it is circular). `api_keys` is FORCE ROW
LEVEL SECURITY, so that read only returns rows because the API's login role is
`rolsuper`/`rolbypassrls`. Deploy the API under a least-privilege role — the
stated point of `perfana_app`, or an RDS master user, which is not BYPASSRLS —
and both api-key branches return zero rows. Every API key silently loses all
organization access, and it surfaces as the misleading denial
"user is not a member of organization X". The dependency is documented in a
comment but nothing enforces it.
**What:** On boot, assert the configured `DB_USERNAME` has `rolsuper` OR
`rolbypassrls` and fail with an explicit message naming this constraint, rather
than degrading into blanket api-key 404s at runtime.
**Where to start:** `apps/api/src/common/services/authorization.service.ts`
(comment above the api-key branch in `isOrganizationMember` states the
invariant); query `pg_roles` for the connected user during the existing startup
checks.

---

### Live-DB RLS regression test for API-key organization resolution

**Priority:** P3
**Origin:** /ship coverage audit on `fix/api-key-authz-rls-and-denial-logging` (2026-08-18).
**Why:** The unit guards added in that PR pin *which repository* the api-key
lookups use (they fail if either reverts to `withRequestEm`), but not the
*policy outcome*. Nothing proves end-to-end that an RLS-scoped read actually
starves an API-key caller, which is the behavior the whole fix turns on.
**What:** A test in `apps/api/src/test/rls/` that seeds an API key plus a test
run in its organization, drives a request through `RlsTransactionInterceptor`,
and asserts the key reads its own run — and that the scoped variant does not.
**Where to start:** `apps/api/src/test/rls/rls-test-harness.ts` already sets the
four GUCs; needs Phase 5b migrations applied to the target database.

---

## Grafana dashboards

### Surface failed background dashboard deletions in the UI

**Priority:** P2
**Origin:** Deliberate scope call during /ship on `fix/queue-grafana-dashboard-batch-delete` (2026-08-15).
**Why:** Batch dashboard deletion is now queued, but `application_dashboards` has no `deletion_status` column (test runs do). The UI drops the queued rows optimistically and a permanently failed job only surfaces as the dashboard reappearing after a reload, with the reason buried in the API log. The user is told "queued for deletion" and nothing contradicts that.
**What:** Either add `deletion_status` to `application_dashboards` and mirror the test-run treatment (queued/deleting/failed badge, row stays visible), or return a per-id result the UI can poll. The `failed` handler in the processor is already the hook point.
**Where:** `apps/api/src/modules/grafana/processors/application-dashboard-deletion.processor.ts` (the `failed` worker event), `apps/web/app/systems/[id]/config/hooks/useDashboardManagement.ts` (`handleBatchDeleteDashboards`), compare with `apps/api/src/modules/test-runs/processors/test-run-deletion.processor.ts`.

### `concurrency: 1` deletion queues are per-process, not per-cluster

**Priority:** P3
**Origin:** Adversarial review during /ship on `fix/queue-grafana-dashboard-batch-delete` (2026-08-15). Pre-existing shape, inherited by the new dashboard-deletion queue.
**Why:** Both deletion processors run their BullMQ `Worker` inside the API process with `concurrency: 1`, which is what stops the hypertable cascades from deadlocking each other. That guarantee holds only while exactly one API process exists — scale the API to N replicas and effective concurrency becomes N, silently restoring the deadlocks the queue was built to prevent. Nothing in the code or the deploy config asserts the single-replica assumption.
**What:** Either move both workers into the worker app (one replica by design), or take a Redis-based distributed lock around the delete so concurrency stays 1 cluster-wide. At minimum, assert the assumption where replicas are configured.
**Where:** `apps/api/src/modules/grafana/processors/application-dashboard-deletion.processor.ts` (~line 92), `apps/api/src/modules/test-runs/processors/test-run-deletion.processor.ts` (~line 155).

---

## Type safety

### Turn on `strict` in apps/web

**Priority:** P2
**Origin:** /ship on `fix/web-type-errors-ts2339` (2026-08-15), after clearing 506 type errors.
**Why:** apps/web compiles with `strict: false`, so `strictNullChecks` is off. The types added in that
branch describe nullability accurately (113 optional fields on the shared API shapes), but nothing
enforces it: a caller can dereference a possibly-undefined field and the compiler stays quiet. So the
type system now catches shape and name errors, which is what all 506 were, and catches no null
dereferences at all.
**What:** Flip `strict` (or start with just `strictNullChecks`) in `apps/web/tsconfig.json` and work the
errors down. Measured cost at the time of writing: `npx tsc -p tsconfig.json --noEmit --strict` reports
**81 errors**. Bounded enough to do in one pass.
**Where:** `apps/web/tsconfig.json`.

---

## Reports

### SLO section renders a green "all clear" card when the check-results query fails

**Priority:** P2
**Origin:** Adversarial review during /ship on `fix/report-sut-name-and-slo-units` (2026-07-10). Pre-existing behavior, adjacent to the SLO unit-formatting fix.
**Why:** `getSloCheckResults` swallows any query error (`logger.warn` + return `[]`), and the SLO renderer shows the green ✓ "No SLO check results available" card for an empty list. A transient DB error during generation produces a permanently stored report that visually implies "all clear". Worse: a single `check_results` row whose `requirement->>'value'` isn't castable to numeric throws in the `::numeric` cast and collapses *every* SLO into that green card.
**What:** Distinguish "query failed" from "no results" — e.g. let the error propagate to fail the generation job (it retries), or render an explicit warning card. Consider `NULLIF`-guarding the `::numeric` cast so one malformed row doesn't blank the section.
**Where:** `apps/api/src/modules/reports/services/report-data-fetcher.service.ts` (~1532-1555, the catch), `apps/api/src/modules/reports/renderers/slo-renderer.ts` (empty-state card).

### Report typography on screen: prose measure and body size

**Priority:** P3
**Origin:** /ship design specialist on `feat/reporting-improvements` (2026-08-18).
**Why:** The screen measure was widened to 340mm so the seven-column regressions table fits.
Tables need it; prose does not — body copy now runs ~150-170 characters per line, past the
65-75 range the width change was partly meant to fix. Separately, body is 11pt (~14.7px) on
screen, below the 16px floor, which was defensible while the report was print-first and is less
so now it is a deliberate on-screen reading surface.
**Where:** `apps/api/src/modules/reports/services/report-html-compiler.service.ts` — the
`@media screen` block. `max-width: 75ch` on `.section-text` and section `<p>`; a screen-only
`body { font-size: 16px }` leaving 11pt for print.
**Deferred because:** the report layout had already been through several rounds; only the print
legibility floor was taken.

### Scroll wide tables in their own container, not the whole section

**Priority:** P3
**Origin:** /ship design specialist on `feat/reporting-improvements` (2026-08-18).
**Why:** `@media screen { section { overflow-x: auto } }` makes every section a scroll container,
not just the wide tables. The scrollbar lands at the bottom of the whole 30px-padded card rather
than under the table, the card's right padding collapses at the end of the scroll, and per spec
`overflow-y` computes from `visible` to `auto`, so any child overflowing vertically gets its own
scrollbar.
**Where:** emit `<div class="table-scroll">` around `.data-table` in the renderers and scope the
rule to it, leaving `section` alone.

### Report builder has a ~662px hard floor

**Priority:** P3
**Origin:** /ship design specialist on `feat/reporting-improvements` (2026-08-18).
**Why:** `minWidth: 380` on the canvas plus `minWidth: 210` on the palette plus gaps, inside a
`DialogContent` with `overflow: hidden`. Below that the overflow is clipped rather than scrolled,
so on tablet-portrait or a small laptop window part of the palette or canvas is unreachable. The
collapse control exists but is manual and defaults to expanded.
**Where:** `apps/web/components/reports/report-generation/GenerateReportDialog.tsx` — stack the
columns below a breakpoint, or auto-collapse the palette when the dialog is narrow.

### Section accent colours are not unique and are not theme tokens

**Priority:** P4
**Origin:** /ship design specialist on `feat/reporting-improvements` (2026-08-18).
**Why:** The palette, card avatar and order badge all key off `config.color`, but `trends` and
`transaction_response_times` share an icon, `trends` and `top_10_lists` share `#ff9800`, `header`
and `transaction_response_times` share `#2196f3`, and `text_block`/`slo` share a rotated
AssignmentIcon. All eleven accents are hardcoded literals, so the darker ones (brown `#795548`,
blue-grey `#607d8b`) sit near the 3:1 non-text contrast floor on dark-mode paper.
**Where:** `apps/web/components/reports/report-generation/section-config.tsx`.

---

## Tests

### Consider clearing `persistedListeners` on manual `disconnect()`

**Priority:** P3
**Origin:** Noticed during /investigate of failing web tests on `fix/web-stale-failing-tests` (2026-05-31).
**Why:** `socketManager.disconnect()` tears down the socket but intentionally preserves `persistedListeners` so they survive transient reconnects. A *manual* disconnect is a full teardown though — a later `connect()` re-attaches listeners the caller may have meant to drop. This same leak caused the socket `on()` test to grab a stale handler across the suite (worked around in the test, not the source).
**What:** Decide whether a manual `disconnect()` should clear `persistedListeners` while reconnect-triggered teardown keeps them. If yes, distinguish manual teardown from reconnect teardown.
**Where:** `apps/web/lib/socket.ts` — `disconnect()` (~line 281) and `persistedListeners` (~line 55).

---

## Compare card

### Parallelise and dedupe the aggregated-series fetch loop

**Priority:** P3
**Origin:** /ship performance specialist on `feat/aggregated-percentiles` (2026-08-14), deferred as out of scope.
**Why:** The aggregate query moved onto the rollups and is now cheap, so the
client-side loop is what the user actually waits on. Two problems, both
pre-existing rather than regressions: the loop `await`s one series at a time,
so each aggregated series costs a serialized round trip and these stack on
top of the already-serialized per-dashboard-group loop above it. And `stat`
no longer changes the SQL — every statistic comes off the merged sketch — so
two series sharing a metric now issue byte-identical requests. Panels 105 and
205 (transaction and request error rate) both map to `error_percentage`, so
this is reachable today; a legacy preset holding 101+102 duplicates too.
**What:** Replace the loop body with `Promise.all` over the series, and dedupe
by `spec.metric` before fetching — one request per distinct metric, fanned
back out to every series that maps to it. Keep `spec.stat` on the series side;
`buildAggregatedComparisons` still needs it for the value-only fallback path.
**Where:** `apps/web/app/test-runs/[id]/components/compare/hooks/useCompareData.ts`
(~line 415) and the same shape at
`apps/web/app/test-runs/[id]/components/trends/hooks/useTrendsData.ts` (~line 440).

### Distinguish the aggregate row from the transactions it summarises

**Priority:** P3
**Origin:** /ship design review on `feat/aggregated-percentiles` (2026-08-14), deferred pending a visual check.
**Why:** The aggregate row used to be self-evident because it carried one
value and three blank cells. Now it fills the same four columns as every
transaction row, with the same band border and delta chips, so it reads as a
peer of its own constituents. `isAggregated` exists on the row but is used
only to suppress the graph button. Worse, the panel header's `reg`/`warn`/`ok`
tallies count the roll-up alongside the transactions inside it, so "3
regressions" can mean two transactions plus their own aggregate.
**What:** Give the row a lightweight marker (an outlined "aggregate" chip next
to the metric name, or a distinct left border), and exclude `isAggregated`
rows from the panel-header counts and band-chip filters.
**Where:** `apps/web/app/test-runs/[id]/components/compare/components/MetricsComparisonTable.tsx`
— counts at ~line 296, row render at ~line 371, `isAggregated` at ~line 232.

### Normalise legacy per-percentile aggregated series on preset restore

**Priority:** P4
**Origin:** /ship design review on `feat/aggregated-percentiles` (2026-08-14).
**Why:** `collapsePerfRtPanels` only filters the panel dropdown. Preset restore
rebuilds series straight from the stored `panelId`/`metricName`, so a preset
saved before the collapse can hold panel 202 — a row labelled "All aggregated
— Request RT P90" that now shows AVG/P90/P95/P99, contradicting its own label
and duplicating the collapsed "All aggregated — Request RT" row if both are
added. Only affects presets saved before the collapse shipped.
**What:** On restore, when `isAggregated` and the panel id is a non-avg RT spec
(102–104 / 202–204), rewrite it to the keeper (101/201) and rebuild the name
via `buildAggregatedMetricName(RT_KEEPER_TITLES[keeper])`.
**Where:** `apps/web/app/test-runs/[id]/components/compare/hooks/useComparePresets.ts`
(~line 93); keeper map in `apps/web/lib/aggregated-perf-series.ts` (~line 34).

## Completed

### Twenty-three more dead `organization_id IS NULL` branches

All gone, across 13 files. Two shapes:

- `... IN (:...orgIds) OR ... IS NULL` — the null half only ever matched a LEFT JOIN
  miss, so it was deleted outright. Where the surrounding code passed a possibly-empty
  array straight into `IN (:...orgIds)`, it now uses the same all-zeroes sentinel the
  other services already used (`profiles.service.ts`, `report-generation.service.ts`).
- `orgIds.length === 0 → organization_id IS NULL` as the *entire* filter — the no-access
  case spelled as a filter. Now `AND FALSE` / `1 = 0` / an empty CTE. The outcome was
  already "see nothing" (the column is NOT NULL), so this is a correctness-of-intent fix,
  not a behavior change: it stops reading as a legacy-data allowance that someone would
  later "restore".

`resolveOrgFilter` in `report-data-fetcher.service.ts` was checked first — system calls
(no userId) and global admins return an empty clause *before* reaching the filter builder,
so an empty org list there genuinely means a user with zero memberships.
`apps/api/src/modules/grafana/README.md` documented the null-org allowance as intended
behavior and was corrected. Five specs that asserted the old contract now assert the new
one. API suite green at 5203 passing.
**Completed:** v0.2.68.3 (2026-08-20)

### Test-run mutations have no write-permission check

`TestRunsMutationService` now gates every mutation of an existing run on
`Capability.TestRunUpdate`, which `org-viewer` does not hold. Covers the five endpoints the
item named plus three it did not — `deleteTestRun`, `abortTestRun`, `updateAdaptConfig` — and
the update branch of `updateRunningTest`; all four stale "Permission check will be added here"
NOTEs are gone. RLS is not this gate and cannot be: `rls_test_runs_update` calls
`can_modify_resource`, whose final branch grants modify to any org member and whose own comment
defers precision to the service layer. Delete is gated on `TestRunUpdate`, not `TestRunDelete`,
so org-members keep the delete they have today; viewers lose it either way. API-key principals
are exempt and the exemption is asserted in a test — a key has no `organization_members` row,
so `getCapabilities` returns an empty set for every key and gating on it would deny all CI
writes; issuing one requires `api-key:create`, which only org-admins hold.
**Completed:** v0.2.68.2 (2026-08-20)

### Five test-run handlers write outside the RLS transaction

All five now use `withRequestQuery(this.dataSource)`. `init-test.handler.ts` turned out to be a
`SELECT MAX(...)` rather than a write; it was scoped anyway, and the comment records why that is
safe (every row it can see belongs to the caller's own org, and `test_run_id` is UNIQUE, so a
hypothetically hidden row fails loudly rather than reusing a counter). `rls-write-routing.spec.ts`
pins all five with *distinct* spies for `dataSource.query` and `dataSource.manager.query` — the
obvious shared-spy mock passes either way and pins nothing.
**Completed:** v0.2.68.2 (2026-08-20)

### Delete the dead `sut.organization_id IS NULL` branch in filter-options access filter

Both sites in `test-runs-crud-query.service.ts` deleted (the item named one; the sibling audit it
asked for found a second, in the system-name lookup at ~line 759). Verified against the local DB
first: zero dangling `test_runs.system_under_test_id`, and `systems_under_test.organization_id` is
NOT NULL, so the branch could only ever match a LEFT JOIN miss. The wider sweep — 23 more sites
across 13 files — is filed as its own item rather than smuggled into a security PR.
**Completed:** v0.2.68.2 (2026-08-20)

### Move `--fix` out of the lint check scripts

`lint` in `apps/api`, `apps/grafana-sync` and `apps/perfana-report` now reports
instead of repairing; the repair pass moved to a new `lint:fix` script in each.
All three still pass clean, so nothing was being silently auto-fixed.
**Completed:** v0.2.68.1 (2026-08-20)

### Three more places still say 50

All four leftovers now key off `MAX_REPORT_SECTIONS` (20): the `createAdHocReport`
backstop, `ReportSectionConfigDto.order`'s `@Max`, and the three `create-template.dto.ts`
caps. A fourth site the item did not list — `report-template.service.ts`
`validateSections` — was aligned too. Decision taken on the open question: **templates
share the report cap**, since a template holding more sections than a report can render
can never be generated.
**Completed:** v0.2.68.1 (2026-08-20)

### `apps/api/.test-db-config.json` is tracked but machine-generated

`git rm --cached` plus a `.gitignore` entry. No `.example.json`: both readers
(`setup-database.ts`, `phase5-migration-validation.test.ts`) guard with `existsSync`
and fall back to defaults, so the shape needs no separate documentation.
**Completed:** v0.2.68.1 (2026-08-20)

### Fix pre-existing DynatraceCard test failures (23 tests)

Root cause was not label/markup drift but the expanded card's primary tab order: Hosts rendered at index 0 (default) and Services at index 1, contradicting the component's own "Services | Hosts" comment. Since Hosts is disabled with zero host entities, a services-only run opened to a disabled empty tab and all Services content (service sub-tabs, request filtering, analysis, comparison) stayed hidden. Swapped Services to index 0. DynatraceCard suite back to 47/47.
**Completed:** v0.2.61.61 (2026-07-15)

### Regenerate ADAPT golden-file snapshot

Resolved by gating instead of regenerating. The failure was environmental: the guard ran the strict comparison against *any* PerfanaWebshop data, so dev DBs with a different row count (771/1,041 vs the fixture's 950) produced false failures. `dbAvailable` now requires `storedCount === goldenFile.resultCount`, so the test runs only against the exact golden snapshot and skips (with a reseed warning) everywhere else. The golden file (950) is left intact as the regression baseline — exactly what the old Note asked for.
**Completed:** v0.2.61.61 (2026-07-15)

### Fix pre-existing web test failures (socket + TestRunDetailsCard)

Updated stale test assertions to match intentional source changes: socket transport order (polling-first, #377), socket `on()` listener registration (state-leak workaround + rename), and abort UI (`<Chip label="Aborted">` instead of removed text). Full web suite back to 3963/3963.
**Completed:** v0.2.61.2 (2026-05-31)

### Cap the `testRunIds` query param on the aggregate endpoint

**Priority:** P4
**Origin:** /ship performance specialist on `feat/aggregated-percentiles` (2026-08-14).
**Why:** `testRunIds` is parsed from an unbounded comma-separated param straight
into `= ANY($1::text[])`. Materially de-risked now that each id costs an indexed
rollup read instead of a raw-table scan, but Trends passes every run in the
selected range, so a wide range on a busy SUT still fans one request into an
arbitrarily large aggregate.
**Where:** `apps/api/src/modules/test-runs/controllers/test-runs-aggregated-timeseries.controller.ts`
— alongside the existing metric/stat validation (~line 124).
**Completed:** v0.2.63.4 (2026-08-18)
