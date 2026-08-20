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

### Run the cold-cache p99 benchmark for `/api/users/me/permissions`

**Priority:** P3
**Origin:** /plan-eng-review on `docs/superpowers/plans/2026-04-27-rbac-completion.md` (2026-04-28).
**Status:** the harness landed in v0.2.68.4 —
`apps/api/scripts/bench-me-permissions.mjs`, no dependencies, exits non-zero when it
misses the criterion. What is still owed is the **measurement**, which needs a fixture
the local dev DB does not have.
**Why:** the endpoint parallelises per-org capability lookups with `Promise.all` and uses
a versioned cache key (never `redis.keys()`). Both should keep p99 at one round trip
regardless of org count — reasoned, never measured. For a user with 20+ orgs (a realistic
admin or support account) a regression would quietly add hundreds of ms to session start,
on the path every page load waits for.
**What:** seed a user into 20 organizations, flush `auth:*` from Redis, then
`PERFANA_TOKEN=<bearer> node apps/api/scripts/bench-me-permissions.mjs`.
Pass criterion (already encoded in the script): cold p99 < 200ms, warm p99 < 30ms.

---

---

## Grafana dashboards

### `concurrency: 1` deletion queues are per-process, not per-cluster

**Priority:** P3
**Origin:** Adversarial review during /ship on `fix/queue-grafana-dashboard-batch-delete` (2026-08-15).
Re-examined during /ship on `fix/queue-and-socket` (2026-08-20) and deliberately left open.
**Why:** Both deletion processors run their BullMQ `Worker` inside the API process with
`concurrency: 1`, which is what stops the hypertable cascades from deadlocking each other. That
guarantee holds only while exactly one API process exists — scale to N replicas and effective
concurrency becomes N, silently restoring the deadlocks the queue was built to prevent.
**Current state:** no replica count is configured anywhere in the repo (`docker-compose*.yml` sets
`deploy:` only on infra services), so the assumption holds today. That is what makes it a P3 and
not a P2 — and also what makes it easy to break without noticing.
**What:** Two real options, and one false one.
- Move both workers into the worker app, which is one replica by design. Largest change,
  smallest ongoing risk.
- Take a Redis `SET NX PX` lock around the delete, so concurrency stays 1 cluster-wide.
  Small diff, but it is deadlock-sensitive code and needs a multi-process test to be worth
  trusting — do not land it on a green unit suite alone.
- **Not** a heartbeat/registry that merely *detects* multiple workers: `redis.keys()` is banned
  here for good reason, a TTL-based set is more moving parts than the lock it replaces, and
  detection after the fact still leaves the deadlock.
**Where:** `apps/api/src/modules/grafana/processors/application-dashboard-deletion.processor.ts`
(~line 112), `apps/api/src/modules/test-runs/processors/test-run-deletion.processor.ts` (~line 155).

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

### Surface failed background dashboard deletions in the UI

`application_dashboards` gains `deletion_status`, mirroring `test_runs`: null when idle,
`'queued'` set before the jobs are enqueued, `'deleting'` when the worker picks one up, and
`'failed'` from the `failed` handler once retries are exhausted. The API returns it on the list
DTO, and `DashboardTable` renders a badge. The UI no longer drops the rows optimistically — that
was the actual defect: it told the user "queued for deletion" and then nothing ever contradicted
it, so a permanently failed job surfaced only as the dashboard reappearing after a reload with
the reason buried in the API log.

**Also fixed here: twelve more dead null-org escapes that the previous sweep missed.** That
sweep grepped `organization_id IS NULL` — the SQL-column form — and TypeORM query builders spell
it `ad.organizationId IS NULL`, against the entity *property*. Those did not match.
`application-dashboards` (4), `grafana-dashboards` (2), `metrics-sources` (6) are now clear, and
`grep -rn "organizationId IS NULL" apps/api/src` returns nothing.
**Completed:** v0.2.68.7 (2026-08-20)

### Consider clearing `persistedListeners` on manual `disconnect()`

Yes — it clears them. The investigation settled the open question: **nothing in the app calls
`disconnect()`**, and reconnection does not go through it (that path is `scheduleReconnect` →
`connect` → `reapplyPersistedListeners`, which builds a fresh socket). So the method is a full
teardown by definition and there is no manual-vs-reconnect distinction to build — which would
have been machinery for a case that does not exist. Clearing the map also removes the state leak
that made one suite's socket `on()` test grab another's stale handler, which had been worked
around in the test rather than the source.
**Completed:** v0.2.68.7 (2026-08-20)

### Reports: SLO all-clear card, prose measure, table scrolling, builder floor, section accents

Five items from the Reports section, in one pass over the same files.

**SLO section rendered a green "all clear" card when the query failed** (P2). Two separate
faults, both fixed. `getSloCheckResults` now returns `null` on failure instead of `[]`, and
the renderer draws an explicit amber "Section incomplete" card for it — an empty array still
means the run genuinely has no checks. And the `(requirement->>'value')::numeric` cast is
guarded by a regex, so one uncastable row yields NULL for that row rather than throwing and
collapsing *every* SLO into the green card. The guard admits scientific notation, verified
against the live database (`1e5` → 100000, `abc` → NULL, no error).

**Prose measure and body size.** `max-width: 75ch` on `.section-text` and section `<p>`, and
a screen-only `body { font-size: 16px }`. Tables keep the 340mm measure; print keeps 11pt.

**Wide tables scroll in their own container.** All twelve `<table>` emitters across the nine
renderers are wrapped in `<div class="table-scroll">` and the `overflow-x` rule moved off
`section` onto it. On the section the scrollbar sat at the bottom of the whole 30px-padded
card, the card's right padding collapsed at the end of the scroll, and per spec `overflow-y`
computed from `visible` to `auto`.

**Report builder ~662px floor.** The palette now auto-collapses below 900px, and
`DialogContent` scrolls instead of clipping — the clipping is what made the overflow
unreachable rather than merely off-screen.

**Section accents and icons are all distinct.** Eleven distinct accents, contrast-checked for
dark-mode paper (the brown and blue-grey are gone), and the four duplicated icons resolved:
`text_block` → Notes, `slo` → Rule (was AssignmentIcon rotated 180°), `transaction_response_times`
→ Timeline (was TrendingUp, same as `trends`). Kept as literals rather than theme tokens: it is
a closed set of eleven that does not vary by theme, and a palette extension for them would be
indirection for its own sake.

API 733 report tests passing, web 3945, lint and tsc clean in both.
**Completed:** v0.2.68.6 (2026-08-20)

### Turn on `strict` in apps/web

`"strict": true` in `apps/web/tsconfig.json`; all 81 errors cleared. `tsc --noEmit` 0,
lint clean, 3945 tests passing.

Most were real nullability the types had been hiding. The one **behaviour** bug it caught:
`GraphsChart` built its Plotly traces with `allSeries.map(... => null)` for series with no
data and passed the array — nulls included — straight to `<Plot data=...>`. Now filtered.

Judgement calls worth knowing about:

- **Plotly props stay `unknown` at the hook boundary**, narrowed with a cast at each
  `<Plot>` call site. Typing the trace builders through `@types/plotly.js` is a real job
  (its `Layout` is structurally strict about things like `xanchor`) and buys no
  null-safety, so it is not this change.
- **The anomaly config payload stays `unknown` through the component tree** and is
  narrowed once at `AnomalyDetectionSection`. Its six declarations genuinely disagree on
  which threshold fields are nullable; unifying them is a separate refactor. The first
  attempt propagated `ConfigFormData` downward and cascaded — reverted.
- **`DrawerData | null` was propagated**, because the fetch really does store `null` on
  failure and every consumer was claiming otherwise.
- **The zod `.default('saas')` was NOT removed.** Dropping it made the types line up and
  the tests immediately failed on `should default to "saas" when not provided` — it is
  load-bearing. Fixed properly with `useForm<Input, unknown, Output>` plus an exported
  `CreateDynatraceConfigFormInput`.
- A leftover `console.log('UnresolvedRegressionTable Debug:', ...)` block was the source
  of four of the 81 errors and is gone.

Not turned on: `noUncheckedIndexedAccess`, `noImplicitReturns`, `noUnusedLocals`,
`noUnusedParameters`, `strictPropertyInitialization`. Each is its own error budget and the
item asked for `strict`.
**Completed:** v0.2.68.5 (2026-08-20)

### Fail fast when the API's DB role cannot bypass RLS

`assertRlsBypass` runs in `bootstrap()` before the app listens: it queries `pg_roles` for
`current_user` and refuses to start unless the role is `rolsuper` or `rolbypassrls`, with an
error naming `api_keys`, the FORCE ROW LEVEL SECURITY dependency, and the fix. Postgres does
not inherit role attributes through membership, so the current role's own attributes are the
thing that matters. Unit-tested for superuser, bypassrls, the least-privilege deploy the item
describes, and the unresolvable-role case (which also refuses, rather than assuming).
**Completed:** v0.2.68.4 (2026-08-20)

### Live-DB RLS regression test for API-key organization resolution

`apps/api/src/test/rls/rls-api-key-org-resolution.spec.ts`, 7 cases. It pins the *policy
outcome* the unit guards cannot show: an RLS-scoped read of `api_keys` returns nothing for the
key itself (the circularity that forces the carve-out), the unscoped read the production code
actually uses returns the row, and `api_keys` really is FORCE ROW LEVEL SECURITY.

The test corrected the item's premise. An unresolved organization is **partial** blindness, not
total: `can_access_resource` has a creator branch, so a key keeps reading the runs it uploaded
itself and silently stops seeing everything else in its own org. That is why the failure reads
as a confusing bug in the field rather than an outage — and it is now asserted in both
directions. RLS suite: 142 passing, up from 135.

### Extend `_permissions` enrichment to Dynatrace sub-resources

`findAllQuery`, `findQueryBySystemAndEnvironment`, `findQueryById` and `getEntityMappings` now
attach `_permissions`, batched one capability lookup per unique org rather than per row. The
flags read the same `IntegrationDynatraceUpdate`/`Delete` capabilities `updateQuery` /
`deleteQuery` / `deleteEntityMapping` enforce, so the button state and the eventual 403 cannot
disagree. There is no `getEntityMappingById` on the service (the item listed it; it exists only
on the repository), and no update endpoint for mappings — delete only.

No `isGlobalAdmin` short-circuit: `getCapabilities` already returns the full admin set
regardless of org scope, which is both less code and what the `no-direct-is-global-admin` lint
rule requires.

Frontend: `QueriesTable` (edit + delete) and `EntityMappingsTable` (delete) wrap their buttons
in `<RequiresPermission>`. The button is the *direct* child in both — a MUI `Tooltip` in between
would have received the injected `disabled` prop instead of the button. `organizationId` and
`_permissions` are carried through `DynatraceQueryLocal` and the `useDynatraceQueries` mapper,
and `mapEntityMappingToDtoFieldsWithLabel` now emits `organizationId` (it did not).
**Completed:** v0.2.68.4 (2026-08-20)

### Add Grafana panel for `auth_capability_denied_total` — closed, not built

The counter never shipped, and the item assumed an observability stack this repo does not have:
no `prom-client`, no `/metrics` endpoint, no scrape config, and `infra/grafana/dashboards/` holds
only Perfana's own product dashboard templates. Standing up a metrics pipeline to serve one
denial counter is disproportionate for a P3.

The ops signal already exists: `CapabilityGuard` emits a structured WARN on every denial with
capability, userId, orgId and route, and the admin log viewer (`LOG_VIEWER_ENABLED`) reads it.
Reopen this only alongside a decision to add Prometheus metrics to the API generally — at which
point the counter is a few lines and the panel follows.
**Completed:** v0.2.68.4 (2026-08-20)

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
