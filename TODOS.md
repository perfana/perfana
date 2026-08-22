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

### Schema changes reach new databases only, and the code assumes otherwise

**Priority:** P0
**Origin:** the 0.2.68.7 incident — "deploying the last version deleted all application
dashboards" (2026-08-21). Nothing was deleted.
**Status:** parts 2 and 3 are built (v0.2.68.14) — `assertEntityColumns` at boot and
`scripts/check-entity-migrations.mjs` in preflight. **Part 1, the constraint audit, is still
open**, which is why this item stays P0. The outage itself is fixed by
`1795000000000-AddApplicationDashboardDeletionStatus.ts` (v0.2.68.12). An automatic
organization_id backfill shipped in 0.2.68.11 and was removed in .13 — it addressed a different,
unreported condition and would have rewritten millions of rows during start-up.
**Why:** Phase 4 declared `organization_id` NOT NULL on the owned-resource tables, but only
inside `1700000000000-ConsolidatedSchema.ts`, which runs on a FRESH database. No migration ever
carried the constraint or the backfill to an existing one. Code was then written against the
declaration — v0.2.68.7 deleted ~35 `OR organization_id IS NULL` escapes because "the column
cannot be null" — and every deployment older than the consolidated schema lost the rows from
every list. The premise was true in dev and false in production, which is the worst shape a
premise can have. Any future "this column cannot be null, delete the dead branch" cleanup
repeats it, and so does any other constraint that lives only in the consolidated schema.
**It has now caused a production outage, not just a theory.** `application_dashboards.deletion_status`
(v0.2.68.7) landed in the consolidated schema alone. The entity declares it, TypeORM names every
declared column in its SELECT, and an existing database does not have it — so the dashboard list
query failed on the first request after the upgrade, and `useDashboardManagement.ts` turned the
failure into `setDashboards([])`: an empty list, no error on screen, every SUT, plus the compare
card. Fixed by `1795000000000-AddApplicationDashboardDeletionStatus.ts`, but only after the
column had been missing in production for a full release.

**What:** three parts.

1. **STILL OPEN — audit the constraints.** `1700000000000-ConsolidatedSchema.ts` holds NOT NULL,
   CHECK, UNIQUE and FK declarations with no corresponding incremental migration, so an existing
   database does not have them while the code assumes it does. Columns are now covered by parts 2
   and 3; constraints are not, and `organization_id NOT NULL` is the known example. The cheapest
   enumeration is an `information_schema` diff between a fresh database and a restored production
   dump — `docs/ops/2026-08-21-org-id-backfill-runbook.md` phase 0 does exactly that for one
   column and can be widened.

2. **DONE (v0.2.68.14) — boot assertion.** `apps/api/src/common/db/assert-entity-columns.ts`
   compares TypeORM's entity metadata against `information_schema` on whatever database the
   service is pointed at, and reports what is missing. Warns by default; `SCHEMA_DRIFT_CHECK=strict`
   refuses the boot. Warn is the default because a false positive that takes the API down on a
   healthy database trades a silent bug for a self-inflicted outage — and the log line alone
   turns this incident's day into a minute.

3. **DONE (v0.2.68.14) — pre-ship gate.** `scripts/check-entity-migrations.mjs`, wired into
   `npm run preflight`: adding an `@Column` in a branch with no new migration file fails, naming
   the column.

   **The check this item originally proposed would NOT have caught the bug.** "Compare entity
   metadata against a database migrated from scratch" passes, because a database migrated from
   scratch is built from the consolidated schema and therefore HAS the new column. Only an
   existing database lacks it. That is the whole shape of this failure, and it is why the two
   checks that shipped are a diff gate and a check against the live database rather than against
   a fresh one. Verified by running the gate against `deeb3990`, the commit that caused the
   incident: it fails, naming `application-dashboard.entity.ts → deletion_status`.

**Left over from the backfill:** `ds_metric_collection_status` has no `system_under_test_id`, so
the migration cannot infer its organization and leaves the column nullable with a warning. It
needs a rule of its own. A greenfield database also shows null-org rows in `check_results`,
`ds_change_points`, `ds_compare_config` and `ds_metric_collection_status`, so "NOT NULL on all 26
owned entities" is not true even for new installs.

---

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

### The series dropdown is not virtualised, so a whole-system selection renders every option

**Priority:** P3
**Origin:** Adversarial review during /ship on `fix/compare-and-report-metric-pickers` (2026-08-21),
where the picker became multi-select at all three levels.
**Why:** With select-all on dashboards and panels, the series list is the product of both — on a
system with tens of dashboards it can reach several thousand options. MUI's `Autocomplete` renders
every option matching the current filter with no virtualisation, so the popup gets slow to open and
to type in. Nothing breaks; it degrades, and only for a selection the user opted into. The request
fan-out behind those levels is already bounded (`OPTION_FETCH_CONCURRENCY` in
`apps/web/app/test-runs/[id]/components/compare/utils/metric-options.ts`) — this is rendering, not
fetching.
**What:** Either a `ListboxComponent` backed by `react-window` (the pattern MUI documents for large
option sets), or a cheaper cap: stop rendering past N options and tell the user to type to narrow.
Measure before choosing — the threshold where it actually hurts has not been established.
**Where:** `apps/web/app/test-runs/[id]/components/compare/components/CompareSelectionPanel.tsx`,
the Series `Autocomplete`.

---


## Dead code detection

### knip treats every file under `apps/web/app/**` as an entry point, so nothing there is ever unused

**Priority:** P3
**Origin:** deleting `trends-chart-utils.ts` for v0.2.70.0 (2026-08-22). That file was 387 lines
of dead code that knip had never reported.
**Why:** `knip.json` sets `apps/web.entry` to `["app/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"]`. An
entry point is a root of the reachability graph, so declaring the whole App Router tree as entries
means no file or export under `app/` can ever be reported unused — the largest part of the
frontend is exempt from the dead-code check that `npm run knip` implies is covering it. The
blanket glob also disables the benefit of knip's built-in Next.js plugin, which already knows the
real entry conventions (`page`/`layout`/`route`/`loading`/`error`/`not-found`/`template`/`default`,
plus `middleware.ts` and `instrumentation.ts`).
**Evidence:** a probe run with those conventions as the entry set reports **323 unused exports**
under `app/`, including all eight exports of the file deleted in v0.2.70.0. The default config
reports 12 findings for the whole monorepo and none of them.
**What:** replace the blanket entry glob with the Next.js conventions, then triage the backlog.
It cannot land as one change — 323 findings is a release of its own, and per
`docs/` history much of it is the known false-positive classes: barrel files that re-export a
component both named and default (removing the named export breaks runtime rendering and `tsc`
does not catch it — that is why `"exclude": ["duplicates"]` is already set), and type vocabularies
consumed only by feature code. Suggested order: land the config change with the current backlog
captured in a baseline/ignore list, then burn the list down by directory so each PR stays
reviewable.

## Reports

### A new report section type must be registered in six places

**Priority:** P3

Adding `error_analysis` in v0.2.69.0 required edits in six separate registries, and
missing any one of them fails in a different way:

- `packages/shared/src/entities/report-template.entity.ts` — the `ReportSectionType` union
- `packages/shared/src/types/reports.types.ts` — `REPORT_SECTION_TYPES`, `SECTION_TYPES_WITH_TEXT`, `SECTION_TYPE_LABELS`
- `apps/web/lib/api/reports.ts` — the web's own copy of all three
- `apps/api/src/modules/reports/dto/create-report.dto.ts` — a third copy, used by `@IsEnum`
- `apps/api/src/modules/reports/services/report-utils.service.ts` — `Record<ReportSectionType, string>`
- `apps/api/src/modules/reports/services/report-template.service.ts` — `validTypes` (now derived)

Only the two `Record<ReportSectionType, …>` maps fail at compile time. The array copies
drift silently: `validTypes` rejected the new type at save time, and the test meant to
catch that had itself drifted two types behind. Both are fixed by deriving from the
canonical list — the remaining copies (web, DTO) should do the same, or the web should
import from `@perfana/shared` rather than keeping its own registry.

**Found:** v0.2.69.0 (2026-08-22)

## Completed

### Compare card: parallelised aggregate fetch, aggregate-row marker, legacy preset restore

**Parallelise and dedupe the aggregated-series fetch loop.** One request per *distinct
metric* now, issued with `Promise.all`. `stat` stopped changing the SQL when the aggregate
moved onto the merged sketch, so two series sharing a metric were issuing byte-identical
requests one after the other — panels 105 and 205 both map to `error_percentage`, so it was
reachable without a legacy preset. Applied to the twin in `useTrendsData.ts` as well.
`spec.stat` stays on the series side; `buildAggregatedComparisons` still needs it for the
value-only fallback.

**Distinguish the aggregate row.** An outlined `aggregate` chip next to the metric name, and
the row is excluded from the panel-header `reg`/`warn`/`ok` tallies and from the band-chip
filter (it is always rendered). Counting the roll-up alongside its own constituents meant "3
regressions" could be two transactions plus their own aggregate.

**Normalise legacy per-percentile aggregated series on preset restore.**
`normaliseLegacyAggregatedSeries` rewrites 102/103/104 → 101 and 202/203/204 → 201, rebuilding
the name from the keeper title, and preset restore runs every series through it. Returns the
input untouched for the keepers, the error-rate panels, non-aggregated series (panel ids are
not unique across sources — a Grafana panel 202 is not an RT panel) and unknown panels; all
six cases are tested.

Web: 3957 passing (12 new), lint and tsc clean.
**Completed:** v0.2.68.8 (2026-08-20)

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
