# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.2.61.96] - 2026-07-22

### Added
- **The Dynatrace card's Hosts tab now opens on an overview table of every host** instead of a tab-per-host strip. Each row shows the host's average CPU % and memory % over the test-run window plus a problem indicator (a severity-colored count chip, or "healthy" when there are none), sorted so hosts with problems and higher CPU surface first. Clicking a row drills into the existing per-host detail view (properties, performance graphs, problems), with a "Back to hosts" button to return. A new batch endpoint (`GET /dynatrace/hosts/overview`) aggregates all hosts server-side — two Dynatrace API calls per instance (a split-by-host metrics query and a `type("HOST")` problems query) — and fails soft per instance so one unreachable Dynatrace config never blanks the whole table.

### Fixed
- **The "Add SLO" metric dropdown for a Dynatrace dashboard is no longer empty.** A lint change had renamed the destructured `key` to `_key` in the Dynatrace metric option renderer but left the JSX referencing the now-undefined `key`, so rendering each option threw and the dropdown showed nothing after a Dynatrace dashboard was selected. The option now uses a stable key derived from the metric, matching the Grafana and performance-metrics branches. (Grafana and performance-metrics dropdowns were unaffected.)

## [0.2.61.95] - 2026-07-22

### Fixed
- **The Dynatrace "Add Entity" tag Value dropdown (and tag Key list) is no longer capped to the first page of entities.** `fetchEntitiesFromHost` requested a single 500-entity page and never followed Dynatrace's `nextPageKey`, so tag values living on entities beyond page 1 were never offered as suggestions. The fetch now pages through the whole fleet via `nextPageKey` (follow-up requests send only the cursor, as the API requires), capped at 20 pages / 10k entities. This applies to every entity type, HOST and SERVICE alike, since the tag suggestions are derived from the fetched entities.
- **"Search hosts by name" now queries Dynatrace instead of only filtering the loaded page.** In HOST mode the name box filtered client-side over whatever page was already fetched; a host not on that page could never be found. The search now pushes the name into the entities endpoint (`entityName.contains(...)`) with a 2-character threshold, matching what the non-HOST entity search already did — so you can find any host by name regardless of fleet size.

## [0.2.61.94] - 2026-07-21

### Added
- **The Top 10 Lists tabs (Transactions, Requests, URLs) now have a name filter.** Each tab gets one filter box that narrows the pool *before* the top-10 slice, so searching for a name returns the top 10 matching rows across every dimension table in that tab rather than clipping whatever was already shown. The Requests filter matches request name or URL.
- **Long URLs no longer blow up row height anywhere they are shown.** URLs render on a single ellipsis-clipped line with a viewer icon beside them; the icon opens a popover with the full URL and a copy-to-clipboard button. Applied to the Top 10 Requests and URLs tabs, the Overview sampler table, the SLO Apdex requests breakdown, the metrics comparison table, and the error analysis table (which replaces its old truncate-plus-tooltip).

### Changed
- **The Top 10 Requests tab drops the "Show Request Name / URL" toggle.** The URL now shows directly under the request name in the same cell (matching the Overview sampler rows), so you see both at once instead of toggling between them.
- **The test run details breadcrumb matches the tab typography.** Same weight and size as the Results / Root Cause Analysis / Reporting tabs, so the header reads as one consistent bar.

## [0.2.61.93] - 2026-07-21

### Changed
- **The Dynatrace "Add Entity" tag filter is now type-ahead and filters the whole fleet server-side.** The Tag and Value fields were plain dropdowns that became unusable with many tags, and they only filtered the first 500 fetched hosts — a value living on hosts beyond that page never matched. They are now type-ahead autocompletes, and picking a tag pushes `tag("key:value")` into the Dynatrace `entitySelector` so filtering spans the entire fleet, not just one page. Tag filtering now works for SERVICE (and other non-HOST) entity types too, not only HOST. Clicking "Add Entity" no longer pre-fetches a throwaway list of 500 services — the first fetch happens when you pick an entity type.

## [0.2.61.92] - 2026-07-21

### Fixed
- **The Generate Report dialog no longer overflows its own width.** The report-layout column was a flex child without `min-width: 0`, so a wide section config (a long "Lists to include" value) forced the column past the dialog edge and clipped the panel. The column can now shrink to the dialog, and its full-width Selects truncate their own text.

## [0.2.61.91] - 2026-07-21

### Fixed
- **SUT import no longer fails with a phantom "SUT already exists" error.** Three exported tables (`ds_panels`, `ds_change_points`, `ds_control_group_statistics`) use env-local serial-integer primary keys. The import copied those ids verbatim, so the source env's small integer ids collided with whatever the target already had in that range — a guaranteed `23505` regardless of which SUT was being imported. These tables now insert with an explicit column list that omits `id`, letting the target's sequence assign a fresh one (verified none of the three is referenced by a foreign key). The `23505` catch-all also stopped blaming every duplicate on the SUT: it now only reports "SUT already exists — delete it first" when the collision is genuinely on `systems_under_test`, and surfaces the actual table/constraint/detail otherwise.

## [0.2.61.90] - 2026-07-20

### Added
- **Breadcrumb navigation replaces the back buttons on test run details and system configuration.** The test run details header now shows `Test Runs › <run id>` — the first crumb returns to the test runs list with the system/environment/workload filters preserved, and the run id doubles as the page heading. The system configuration page shows `Systems › Configuration`, and when opened from a test run (via the SLO, dashboards, deep links, reporting, Pyroscope, or distributed tracing cards — including links opened in a new tab) it shows `Test Runs › <run id> › Configuration` so you can jump straight back to the run you came from.

### Fixed
- **Request figures now update in realtime during a running test.** The performance analysis card refreshed transaction figures on every live update, but the request (sampler) rows of expanded transactions stayed frozen at their expand-time values. Expanded rows now refetch alongside the transactions on each update — without a spinner flash, with in-flight dedup so slow sampler queries cannot pile up across refresh ticks, and a failed background refresh keeps the last figures on screen with an inline error.
- **Test runs view filter dropdowns only offer combinations that exist.** The system, test environment, and workload dropdowns listed every distinct value in the database regardless of the other selections. Each dropdown is now constrained by the other two selected filters (server-side, respecting organization/team access), refetches when a selection changes, ignores out-of-order responses, and keeps your current selection visible even when it no longer matches. Repeated query parameters (`?system=a&system=b`) are coerced instead of erroring.

## [0.2.61.89] - 2026-07-17

### Fixed
- **Managed Dynatrace Top Web Requests, Distributed Tracing, and Multidimensional Analysis deep links now filter correctly.** The managed `/ui/services/<SERVICE>/…` routes reject the classic-hash `servicefilter` encoding those links carried (Dynatrace `\0` slash-escaping via `%5C0` plus trailing empty `%14` fields), so the request-attribute filters were dropped and the views opened unfiltered. Managed links on those routes now emit the newer encoding captured from a working managed cluster URL: bare `15%11<attribute>%14<value>` blocks joined by `%10`, values plainly URI-encoded (slashes stay `%2F`), request-name filter before test-run id. SaaS links and the classic `#hash` routes (Response Time Hotspots, Outliers, Method Hotspots, Exception Analysis, Service Flow, comparison) keep the previous encoding. Deep links also open with `noopener,noreferrer` now, so the target page cannot reach back into the Perfana tab.
- Regression tests pin the format selection per route and deployment type (managed ui routes vs managed classic-hash vs SaaS), the exact managed filter string, and the duration-block variants; the duration-block construction and the open-ended max-duration sentinel are deduplicated into shared helpers.

## [0.2.61.88] - 2026-07-17

### Fixed
- **Managed Multidimensional Analysis deep links are now service-scoped.** The managed MDA link targeted `${host}/ui/diagnostictools/mda`, which has no service context — the entity the user clicked was not reflected in the view (only the request-attribute `servicefilter` narrowed it). It now targets `${host}/ui/services/<SERVICE>/mda?…`, the same service-scoped route Top Web Requests uses; query params (metric, `dimension={Request:Name}`, `servicefilter`, time filter) are unchanged from v0.2.61.87. SaaS branch unchanged.

## [0.2.61.87] - 2026-07-17

### Fixed
- **Dynatrace managed-cluster deep links carry the request-attribute `servicefilter` again, and Multidimensional Analysis no longer breaks on an invalid dimension.** v0.2.61.85 rewrote the managed (`dynatraceType: 'managed'`) links to the `/ui/…` format but dropped the test-run-id/request-name `servicefilter` from **Top Web Requests** and **Distributed Tracing** (PurePaths), so those links opened unfiltered; both now include `servicefilter=<filter>` (same `buildServiceFilterParam` encoding the working Response Time Hotspots link uses). **Multidimensional Analysis** built its dimension as `{Request:Name}{RequestAttribute:<perfanaRequestNameAttribute>}` — but the config stores the request attribute's **UUID**, and Dynatrace's `{RequestAttribute:…}` dimension syntax only accepts the attribute *name*, making the whole MDA view fail to resolve; the dimension is now plain `{Request:Name}` and the request-attribute filtering rides in `servicefilter`, as it does in the classic links. SaaS branches unchanged. Added a formatter test suite pinning all three managed URLs.

## [0.2.61.86] - 2026-07-16

### Fixed
- **Worker Grafana metrics collection now uses axios (like the Dynatrace client in v0.2.61.84), so internal hosts behind a corporate proxy are reached.** The shared `GrafanaClient` used undici, which cannot bypass internal hosts: a DB-configured proxy tunneled every request, and the env-proxy fallback couldn't honor `NO_PROXY`. Same failure fingerprint as the Dynatrace bug — the external host worked (proxy forwards it) but internal hosts got the proxy's HTML block page. `GrafanaClient` now uses `axios` for both calls (batched panel-query POST, datasource-lookup GET) and takes an explicit axios `proxy` only when `use_proxy` is set + a `proxy_servers` row exists; otherwise it passes nothing so axios reads `HTTP(S)_PROXY`/`NO_PROXY` from the env and honors `NO_PROXY` (internal hosts bypass). The undici keep-alive `Pool` is replaced with per-request axios timeouts; non-2xx responses still surface as a status (`validateStatus: () => true`) so batch processing is unchanged. The worker's undici Grafana proxy path (`resolveProxyDispatcher`) is removed in favor of `resolveGrafanaAxiosProxy`, which mirrors the Dynatrace policy exactly. Added `axios` as a direct `@perfana/shared` dependency.

## [0.2.61.85] - 2026-07-16

### Fixed
- **Dynatrace managed-cluster deep links now use the cluster's `/ui/…` URL format instead of the classic `#hash` format that this version can't route.** On a managed instance (`dynatraceType: 'managed'`, e.g. UWV's `ketenmonitoring-managed.ba.uwv.nl/e/<env>`), three Services-tab links produced dead URLs: **Multidimensional Analysis** now targets `${host}/ui/diagnostictools/mda?…&metric=<M>&dimension={Request:Name}{RequestAttribute:<perfanaRequestNameAttribute>}&mergeServices=false&aggregation=AVERAGE&percentile=80&chart=LINE&servicefilter=<filter>` (service scoped via the request-attribute `servicefilter`, not the path); **Top Web Requests** now targets `${host}/ui/services/<SERVICE>/mda?mdaId=topweb&<timeFilter>&gf=all&metric=REQUEST_COUNT&dimension={Request:Name}&mergeServices=false&aggregation=COUNT&percentile=80&chart=COLUMN`; **PurePaths** now targets `${host}/ui/services/<SERVICE>/purepaths?<timeFilter>&gf=all`. SaaS branches are unchanged.
- **"PurePaths" is renamed to "Distributed Tracing"** in the Dynatrace card's Performance Insights section (label only; the `pure-paths` key and behavior are unchanged).

### Changed
- **The Dynatrace card opens on the Services tab when reached via a context-menu drill-down.** "View in Dynatrace" from performance analysis, anomaly detection, apdex SLO, and the top-10 transaction/request lists all carry service-scoped `initialFilters`; the card now defaults its primary tab to Services (index 1) in that case instead of Hosts. Direct expansion still defaults to Hosts when hosts exist, else Services (unchanged).

## [0.2.61.84] - 2026-07-16

### Fixed
- **Worker Dynatrace metrics collection now uses axios (like the API), so internal hosts behind a corporate proxy are reached.** The undici path proxied every request when a proxy was in play and couldn't bypass internal hosts: env `NO_PROXY` was only honored on the no-DB-proxy branch, and a DB-configured proxy (`proxy_servers` row) went through `undici.ProxyAgent`, which has no bypass concept at all. Result on a two-instance UWV/DCX setup: the external DCX host worked (proxy forwards it) but the internal `.ba.uwv.nl` host got the corporate proxy's HTML 403 block page — while the API (axios) reached both. `DynatraceAPIClient` now uses `axios` for all three calls (Metrics v2 GET, DQL start POST, DQL poll GET) and mirrors the API's `DynatraceService` proxy handling exactly via `resolveDynatraceAxiosProxy`: pass an explicit `proxy` only when `use_proxy` is set + a `proxy_servers` row exists, otherwise pass nothing so axios reads `HTTP(S)_PROXY`/`NO_PROXY` from the env and honors `NO_PROXY` (lenient matching, internal hosts bypass). The undici keep-alive `Agent` is replaced with per-request axios timeouts (Metrics 30s, DQL start 70s, poll 5s). The worker's undici Dynatrace proxy path (`resolveDynatraceProxyDispatcher` + its agent cache) is removed; the Grafana path (`resolveProxyDispatcher`) still uses shared undici and is unchanged. `[dt-diag]` root-cause logging from v0.2.61.82 is carried over in axios form. Added `axios` as a direct worker dependency.

## [0.2.61.83] - 2026-07-16

### Fixed
- **Dynatrace card Services-tab deep links now open the instance the service was mapped from, not always the first one.** `useDynatraceHandlers` used `configs[0]` for all three actions — Performance Insights deep links, Multidimensional Analysis, and Performance Comparison — so for a SUT spanning two Dynatrace instances, every service's link pointed at instance #1's host regardless of where that service actually lives. A service mapped from the second instance opened a URL on the wrong tenant (dead/incorrect link). Each handler now selects `configs.find(c => c.id === <mapping/entity>.dynatraceConfigId) ?? configs[0]`, threading the mapping's `dynatraceConfigId` (already present on `DynatraceEntityMapping`) through the entity passed to the deep-link and analysis handlers. Single-instance setups are unchanged (fallback to `configs[0]`). Same class as the v0.2.61.77 host-tab fix, now covering the services tab.
## [0.2.61.82] - 2026-07-16

### Added
- **`[dt-diag]` root-cause logging for worker Dynatrace metrics collection.** When a SUT spans two Dynatrace instances and metrics collection works for one but not the other (while the API's entities calls work for both), the worker now logs, per query: the routing decision (`metrics-v2` vs `dql`), the target host, and whether each credential (Api-Token / platform token) is present. A managed instance routed to DQL — which it can't authenticate, having no platform token — is flagged with a loud warning (`⚠️ MANAGED instance … routed to DQL`). On a Metrics API v2 failure the status code is mapped to a plain-English cause (403 → token lacks `metrics.read` scope, 401 → bad/undecrypted token, 404 → wrong host/path), and the body is read as text first so a non-JSON proxy/gateway block page is classified (`looksHtml=true`) instead of throwing an opaque JSON parse error. DQL auth failures (401/403) distinguish "token present but rejected" from "token MISSING". Grep `[dt-diag]` in the worker log to pinpoint which of the three failure modes is in play. Also hardened: `response.headers` access is now null-safe.

## [0.2.61.81] - 2026-07-16

### Fixed
- **Worker now honors glob-style `NO_PROXY` entries (`*ba.uwv.nl`), so Dynatrace/Grafana hosts behind a corporate proxy are reached directly.** undici's `EnvHttpProxyAgent` only strips a leading `*.` or `.` from `NO_PROXY` entries (regex `/^\*?\./`); an entry like `*ba.uwv.nl` (star with no dot) was kept as a literal hostname and never matched `ketenmonitoring-managed.ba.uwv.nl`, so the request went through the proxy and the proxy returned an HTML block page — surfacing as `Unexpected token '<', "<!DOCTYPE"... is not valid JSON` and `0/16 queries succeeded`. axios (used by the API) is lenient about this form, which is why the same `NO_PROXY` worked for `perfana-api` but not the worker. Added `normalizeNoProxy()` in `@perfana/shared/services/proxy` that rewrites a leading `*` not followed by `.` into `.` (`*foo` → `.foo`), and applied it when constructing `EnvHttpProxyAgent` in both the worker Dynatrace path (`proxy-resolver.ts`) and the shared Grafana path (`envProxyDispatcher`). Valid forms (`.foo`, `*.foo`, `foo`) are untouched. Operators should still prefer `.ba.uwv.nl`, but the malformed `*ba.uwv.nl` now works too.

## [0.2.61.80] - 2026-07-16

### Fixed
- **Worker Grafana collection now queries each dashboard's own Grafana instance instead of always the first one.** `grafana-config-cache` was a process-wide singleton that cached `grafana_instances` row #1 (`ORDER BY created_at ASC LIMIT 1`) and every worker Grafana call used it, ignoring each dashboard's `grafana_instance_id`. On a setup with a second Grafana instance, panel builds and metric queries hit the wrong host — 404s or empty/incorrect metrics. Same class of bug as the v0.2.61.77 Dynatrace `configs[0]` fix, but broader because it was a cached global rather than a local index. Added `getGrafanaConfigById()` (per-instance resolution + cache) and a `grafana-client-factory` that groups panels by their application dashboard's `grafana_instance_id` and builds a client per instance. `MetricsPipeline`, the incremental `GrafanaCollector`, and the panels-processing datasource lookup (datasource ids are instance-scoped) all resolve per instance now. Legacy rows with a null `grafana_instance_id` fall back to the existing singleton — no behavior change for single-instance deployments.

## [0.2.61.77] - 2026-07-16

### Fixed
- **Dynatrace host-tab graphs now populate when a SUT spans two Dynatrace instances.** `HostsTabContent` passed `configs[0]` (the first configured instance) to every host detail panel, so hosts belonging to a second instance requested `/dynatrace/hosts/{id}/properties?dynatraceConfigId={firstInstance}` and got a 404 (`Host entity … not found in Dynatrace`). The panel now selects the config matching each host's own `dynatraceConfigId` (which the mappings API already returns), falling back to `configs[0]`. Added `dynatraceConfigId` to the frontend `DynatraceEntityMapping` types.
- **Tag key/value dropdowns populate when adding host entities in the Dynatrace config.** The `/api/v2/entities` call to Dynatrace never requested the `tags` field, and the v2 entities API omits tags by default — so `entity.tags` was always empty and both tag dropdowns stayed blank in both instances. `fetchEntitiesFromHost` now passes `fields: '+tags'`.

## [0.2.61.76] - 2026-07-16

### Fixed
- **Escape user-authored values in the anomaly trend-graph hover template.** Follow-up to v0.2.61.75: the per-point Plotly `hovertemplate` interpolated `test_run_id`, `version`, `annotations`, and `conclusion_label` raw, and Plotly renders the template as pseudo-HTML — so a value containing `<`, `>`, or `&` could be read as markup. Both trend-plot builders (`utils.ts` and `components/utils/trends-plot-utils.ts`) now HTML-escape those values before interpolation, keeping the structural `<br>`/`<b>` literals intact. This hardening commit missed the v0.2.61.75 squash-merge; re-landed here.

## [0.2.61.75] - 2026-07-15

### Fixed
- **Integration add/edit dialogs no longer get clobbered by browser autofill, and Grafana edits no longer save `[MASKED]` over the real token.** Three related bugs on the Grafana and Dynatrace integration cards: (1) the credential `TextField`s had no `autoComplete` attributes, so Chrome's password manager autofilled saved values on open — pre-filling pristine "Add" fields and overwriting the loaded config in "Edit"; every text field now sets `autoComplete="off"` and every secret field `autoComplete="new-password"`. (2) The Grafana edit form pre-filled `apiKey` with the API's `[MASKED]` read and sent the whole form back on save, so the literal string `[MASKED]` got encrypted and stored — corrupting the token (and the blank `password` field wiped the stored password). The edit form now leaves secrets blank, and `handleUpdate` only sends `apiKey`/`password` when the user actually typed one. (3) `GrafanaInstancesService.update` and `DynatraceService.update` now ignore the `[MASKED]` sentinel defensively, so a masked read can never overwrite a real secret regardless of what the client sends.
- **Standardized secret handling across the integration dialogs.** Secret fields (Grafana API key/password, Dynatrace API token/platform token) are consistently blank on edit with a "Leave blank to keep existing" placeholder + helper, are only persisted when a new value is typed, and render as `type="password"`. Editing a Dynatrace config can now rotate its API token from the UI: `apiToken` was wired through `UpdateDynatraceConfigDto` → `DynatraceService.update` → `DynatraceRepository.update` (the encrypted-column transformer handles at-rest encryption, same path as create); previously the edit dialog's token field was inert.
- **Anomaly-detection trend graph hover tooltips now render correctly.** The trend plot's `hovertemplate` pulled the Version/Annotation lines out of `customdata` via `%{customdata.versionLine}`, and those substituted values contained `<br>` — which Plotly renders as a line break only when literal in the template, not inside a `%{customdata.*}` substitution. Both trend-plot builders (`utils.ts` for `TrendChart` and `components/utils/trends-plot-utils.ts` for the anomaly-table expanded row) now build a per-point `hovertemplate` array with all `<br>` literal and values interpolated in JS, matching the working test-run-details graph implementation. `customdata` is kept intact so the expanded row's `plotly_click`/`plotly_hover` handlers still read `customdata.testRunId`.

## [0.2.61.74] - 2026-07-15

### Fixed
- **Compare card no longer shows an empty graph for URL RT rows.** The virtual URL panels (`URL RT` 210, plus URL Error Rate/Throughput/Latency/Connect Time) are aggregate-only — their stats come from the `test_run_sampler_stats` rollup, which has no time dimension. But the graph toggle called `/metrics/ds-metrics-comparison`, which reads the `ds_metrics` table (Grafana/Dynatrace time-series only), so URL rows always expanded to a blank "no series" chart. `MetricsComparisonTable` now hides the graph toggle for URL panels (`isUrlPanel(row.panelId)`), same as it already does for aggregated rows. The compare table stats are unaffected.

### Changed
- **Added Series chips are grouped by dashboard with a header per group.** `AddedSeriesDisplay` was a flat chip list; it now buckets chips by `dashboardLabel` (first-seen order) under a small caption header, so a comparison spanning several dashboards is readable at a glance. The existing collapse-past-8 behavior is unchanged.
- **Select Series multi-select collapses when many series are picked.** Added `limitTags={8}` to the series `Autocomplete` in `CompareSelectionPanel`, so selecting a large set shows the first 8 chips plus a `+N` pill instead of growing the field to full height — matching the Added Series section's collapse threshold.

## [0.2.61.73] - 2026-07-15

### Added
- **Grafana repeating panels now expand into one panel per variable value.** A panel marked `repeat: "<var>"` (e.g. `repeat: "host"`) previously produced a single `ds_panels` row: the repeat variable resolved to only its first value, the query hit just that one host, and the title kept the literal `${host}`. `createPanelDocuments` (`apps/worker/src/pipelines/panels/helpers.ts`) now expands such a panel into one doc per value of the dashboard variable (capped at 20, overflow logged), substituting the value into both the query and the panel title. The real Grafana `panel_id` is preserved on every copy so "view in Grafana" deep links stay valid. To keep each value's metrics distinct on the `ds_metrics (panel_id, metric_name)` key when the repeat variable appears only in the title (not the query/legend), the panel JSONB carries a `__perfanaMetricPrefix` hint that the shared Grafana formatter (`packages/shared/src/services/grafana/formatter.ts`) prepends to `metric_name`; when the variable is already in the query, Grafana's series legend disambiguates and no prefix is added. Non-repeating panels are unaffected.

## [0.2.61.72] - 2026-07-15

### Fixed
- **Worker Dynatrace collection no longer 401s ("Token Authentication failed").** `dynatrace_configs.api_token` and `platform_api_token` are encrypted at rest (AES-256-GCM); the API loads configs through TypeORM entities whose `encryptedColumnTransformer` decrypts them transparently, but the worker's `DynatraceRepository` reads them via raw SQL (`SELECT api_token as "apiToken" …`), which bypasses the transformer and returned ciphertext. The worker then sent `Api-Token <ciphertext>` and Dynatrace rejected it with 401. All three raw-SQL config reads now run tokens through `safeDecrypt` (which passes legacy plaintext through unchanged). Requires the worker to have the same `ENCRYPTION_KEY` env var as the API. The Grafana worker path was already safe — it loads instances via the TypeORM repository, not raw SQL.
- **Dynatrace card host graphs render correctly on first open.** The 2×2 CPU/Memory/Disk/Network Plotly charts mount after the async metrics fetch and the lazy `react-plotly` chunk load, so Plotly's first draw could measure the grid before it had its final width — leaving the plots overlapping until an unrelated resize (switching host tabs) fixed them. `HostPerformanceGraphs` now dispatches a window `resize` on mount (rAF + 200ms fallback), triggering each plot's `useResizeHandler` to relayout at the correct width. Also fixed 4 pre-existing Plotly `Config` type errors in the same file (the file is excluded from the web build's type-check gate) by replacing the broken `as unknown` cast with a `Partial<Config>` return type.

## [0.2.61.71] - 2026-07-15

### Fixed
- **Worker env-proxy fallback actually fires now (Dynatrace + Grafana).** v0.2.61.69 (#458) added an `EnvHttpProxyAgent` fallback so the worker honors `HTTP_PROXY`/`HTTPS_PROXY`, but every call site still gated the whole proxy resolution behind the per-config `useProxy` flag — so in proxy-only deployments (no `ProxyServer` DB row, `useProxy` off) the fallback was never reached and the worker connected directly, timing out against Dynatrace/Grafana IPs (`Connect Timeout Error`). Removed the `useProxy` gate at all four call sites (`DynatracePipeline.ts`, `MetricsPipeline.ts`, `dynatrace-collector.ts`, `grafana-collector.ts`); each now always calls the resolver, which returns `undefined` when there is neither a DB proxy row nor proxy env vars — so no-proxy deployments are byte-identical to before. Deployments must set `HTTP_PROXY`/`HTTPS_PROXY` (and `NO_PROXY`) on the worker container for the fallback to engage.

## [0.2.61.70] - 2026-07-15

### Added
- **Compare card: Request RT rows show the normalized URL.** When comparing performance-metrics "Request RT", each request row now displays its normalized URL (e.g. `/api/checkout/{id}`) as a grey second line under the request name, matching the Performance Analysis card's URL source. New read-only endpoint `GET /test-runs/:testRunId/sampler-url-map` returns a `{ "transaction.sampler": "normalized/url" }` map for the run, joining `test_run_sampler_stats.url_hash → url_patterns.normalized_url` (highest-count url_hash wins per request; requests with no pattern are omitted so the row falls back to the bare name). The map key is `transaction_name.sampler_name` to match `ds_metric_statistics.metric_name` for panel 201, so the frontend joins by metric name. The map is fetched once, only when a Request RT panel is present, and org-scoped identically to the sibling URL endpoints. Also fixed two stale Compare-card tests (`useCompareData`, `useCompareHandlers`) that still asserted the P90 request panel survived after the v0.2.61.63 RT-panel collapse.

## [0.2.61.69] - 2026-07-15

### Fixed
- **Dynatrace card defaults to the Hosts tab again (when the run has hosts).** v0.2.61.61 (#454) made Services the first/default primary tab to avoid opening a host-less run on the disabled, empty Hosts tab. That regressed #425's intent (Hosts first). Restored Hosts as the first tab and, instead of a fixed default, the primary tab now defaults to Hosts when host entities exist and falls back to Services otherwise — so host runs open on Hosts and services-only runs no longer land on a disabled tab. Frontend-only (`DynatraceExpandedContent.tsx`, `useDynatraceData.ts`).
- **Worker honors `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` for Dynatrace and Grafana collection.** In proxy-only deployments the API reached Dynatrace/Grafana through the docker-compose env proxy but the worker could not, despite identical env config. The API uses axios, whose Node adapter reads these env vars automatically; the worker uses undici, which does not — it only proxied when an explicit `ProxyServer` DB row existed. Both worker resolvers (`resolveDynatraceProxyDispatcher`, `resolveProxyDispatcher`) now fall back to an `EnvHttpProxyAgent` built from the matching undici copy (worker's undici 7 for Dynatrace, shared's undici 6 for Grafana — no version skew) when no DB proxy row is found. Returns `undefined` when no proxy env vars are set, so the direct-connection path is unchanged.

## [0.2.61.68] - 2026-07-15

### Fixed
- **grafana-sync starts again: fix `Cannot find module '.../packages/shared/src/entities/grafana-instance.entity'`.** `grafana-api.service.ts` imported two entities via deep subpaths (`@perfana/shared/entities/grafana-instance.entity` and `.../proxy-server.entity`) that aren't declared in `@perfana/shared`'s `exports` map (only the `./entities` barrel is). Unsupported subpaths fall through to the tsconfig `paths` alias and get baked into the build as relative `packages/shared/src/...` requires — paths that don't exist in the runtime container (only `dist/` ships), so the service crashed on boot. Both now import from the `@perfana/shared/entities` barrel like the other 30 shared imports. Introduced in v0.2.61.61 (#454).

## [0.2.61.62] - 2026-07-15

### Added
- **Compare card: compare per aggregated normalized URL.** The Compare card can now compare two test runs grouped by normalized URL (e.g. `/api/user/{id}`), alongside the existing transaction and request (sampler) dimensions. For performance-test dashboards, the panel dropdown gains URL panels (URL RT Avg/P90/P95/P99, Error Rate, Throughput, Latency, Connect Time); selecting one lists normalized URLs as series. Values are re-aggregated at query time from the existing `test_run_sampler_stats` rollup grouped by `url_hash` — percentiles merged accurately via t-digest `rollup()`, means count-weighted — so it works on every existing run with no new table, migration, or backfill. Adds two read-only endpoints (`GET /test-runs/:id/url-distinct-names`, `GET /test-runs/:id/url-metric-statistics`), org-scoped identically to the sibling aggregated endpoints. Apdex is intentionally omitted (a per-URL Apdex has no single transaction threshold). URL panels appear only for performance-metrics dashboards, never Grafana/Dynatrace.

## [0.2.61.61] - 2026-07-15

### Fixed
- **Grafana dashboard list refreshes in place after add / edit / delete.** In System-under-test settings → Grafana dashboards, adding, editing, or deleting a dashboard left the table blank until a full page reload. The list refetch passed the system *display name* into the `?systemId=` query param, which matches on the system UUID, so it returned an empty list; a reload worked only because the initial load uses the route id. `handleSubmitDashboard`, `handleSubmitEditDashboard`, `handleConfirmDelete`, and `handleBatchDeleteDashboards` now refetch with the actual systemId. Frontend-only.
- **Dynatrace card opens on the Services tab.** The expanded card's primary tabs rendered Hosts at index 0 (the default) and Services at index 1, contradicting the component's own "Services | Hosts" order. Since the Hosts tab is disabled when a test run has no host entities, a services-only run opened to a disabled, empty tab with all Services content hidden. Services is now the first/default primary tab. Frontend-only.

### Internal
- **Test-suite cleanup that turbo's fail-fast had been masking.** A single stale entity snapshot aborted `turbo test` early, hiding real failures downstream. Fixing it surfaced (and this change repairs) broken suites across grafana-sync (`@InjectRepository(ProxyServer)` circular-import via a barrel), worker (DynatracePipeline mocks missing the new `proxyDispatcher` arg; ADAPT golden-file tests now gate on the exact snapshot instead of any data), plus lint (two `any` casts) and dead-code (seven over-exported symbols) cleanup. No product behavior change from the test/lint work.

## [0.2.61.60] - 2026-07-14

### Changed
- **Graphs card "All aggregated" is now a metric-dropdown option, matching Trends/Compare.** Replaced the standalone toggle (which overlaid three fixed, non-savable avg-only run-wide series) with a per-panel **"All aggregated"** entry in the metric dropdown, offered for aggregatable performance-test panels. Selecting it adds a normal, editable, savable series that uses the panel's actual statistic (avg/p90/p95/p99) via the shared `aggregated-perf-series` helper. Removed the Graphs card's private duplicate aggregation util and the overlay hook. Frontend-only.

## [0.2.61.59] - 2026-07-14

### Added
- **"N/A" state for thresholds that are configured but can't be evaluated.** When a threshold's ADAPT check reports `valid: false` — most commonly a zero-variance baseline where the control IQR is 0, which collapses the valid range to a single point (#417) — the Result column now shows a muted "N/A" chip with a hover tooltip explaining why ("Baseline has no variance (IQR = 0)…" or "Not enough baseline or test data…"). Previously such a row was mislabelled: first as "In range", then (after 0.2.61.58's geometric fix) as a spurious "Regression". N/A is distinct from "Not set" (threshold never configured). Frontend-only.

## [0.2.61.58] - 2026-07-14

### Fixed
- **Threshold Result now matches the displayed valid range.** The three-state classifier trusted ADAPT's per-check `isDifference` flag first, so a row could show "In range" even when its test value sat outside the range printed next to it (e.g. IQR range `4.32% – 4.32%`, test `6.06%`). Classification is now geometric — test value vs the shown lower/upper bounds decides in-range/improvement/regression — so the chip always agrees with the numbers in the row. `isDifference` is used only as a fallback when a row has no numeric bounds to show.

## [0.2.61.57] - 2026-07-14

### Changed
- **Anomaly-detection threshold Result column reworked to a three-state model.** Replaced the pass/fail/improve icon set with a judgment-first design: each row is now *In range* (neutral gray chip, `–`), *Improvement* (green chip), or *Regression* (red chip). The arrow encodes which side of the valid range the test value fell on (`▲` above / `▼` below) and the color encodes the verdict — decided by side × metric direction (`higherIsBetter`). For a lower-is-better metric, below-range = improvement and above-range = regression; for higher-is-better, reversed. Unconfigured thresholds show a muted "Not set". Builds on 0.2.61.56; frontend-only.

## [0.2.61.56] - 2026-07-14

### Fixed
- **Anomaly-detection threshold icons no longer flag an improvement as danger.** In the Statistical Analysis drawer, the per-threshold Result icon was computed purely from "is the value outside the valid range", ignoring metric direction. For a lower-is-better metric (e.g. `Request RT Avg`) whose value dropped *below* the range — a genuine improvement, and already labelled as such by the Conclusion — the Percent and IQR rows still showed the red danger icon. A favorable breach now renders a green trend arrow (`↓` for a decrease, `↑` for an increase) instead of red; regressions stay red, in-range stays a green check, and unconfigured thresholds stay amber. Direction is read from `metricClassification.higherIsBetter` and evaluated per row (bounds are nested, so a value can breach one threshold type but not another). Frontend-only — no ADAPT/backend change.

## [0.2.61.55] - 2026-07-14

### Fixed
- **InfluxDB v2 (Flux) metrics now ingest correctly.** The worker's Grafana response formatter identified the timestamp column by the literal name `time`, but Flux responses name it `_time` (schema `type: "time"`). As a result `_time` was treated as a metric, every real value inherited the current time, and dedup collapsed the whole series to a single stale point outside the test window — so panels looked empty. The formatter now identifies the timestamp column by its schema type, which is datasource-agnostic (Prometheus/InfluxQL `Time` already worked).
- **Grafana dashboard template variables backed by Flux queries now populate.** When adding a dashboard with a Flux (InfluxDB v2) variable, the API sent the Flux query to the legacy InfluxQL `/query?db=&q=` endpoint, which cannot run Flux, so the dropdown stayed empty. Flux datasources (detected via `jsonData.version === "Flux"`, with a query-shape fallback) now resolve variable values through `POST /api/ds/query` and parse the returned dataframes. The InfluxQL path is unchanged.

## [0.2.61.53] - 2026-07-13

### Added
- **The test-comparison report section (Baseline Run mode) gains a P90 metric.** P90 is now selectable alongside AVG/P95/P99 for all three sources (performance-metrics, Grafana, Dynatrace) and the "All aggregated" row. It's opt-in — the default metric set stays AVG/P95/P99, so existing reports are unchanged.
- **Configurable minimum absolute change threshold.** A new "Min. absolute change" field (in the metric's own units, e.g. ms) suppresses noise on tiny baselines: any change where `|current − baseline|` is below the threshold is treated as no difference, regardless of the percentage (a 1ms → 2ms move is +100% but only 1ms). Leave it empty to disable. When set, the legend notes it.

### Changed
- **The comparison section now names both runs explicitly** — a caption reads "Comparing current run `<id>` against baseline run `<id>`" so the report is unambiguous read out of context.
- **The baseline figure in each comparison cell is more present** — the grayed-out "vs `<baseline>`" text darkened from `#9aa2ab` to `#6b7280`, bumped to 12px, weight 600.

## [0.2.61.52] - 2026-07-13

### Added
- **The Trends and Compare cards (test-run detail page) now offer an "All aggregated" entry in the Metric Series dropdown for performance-test panels.** Selecting it adds a series equal to the panel's metric and statistic (e.g. Request RT P90) computed across all transactions/requests in the run — one line across runs on Trends, one comparison row on Compare. It uses a new `aggregated-metric-statistic` endpoint (batched over related runs) and only appears for the performance-metrics source (hidden for Grafana/Dynatrace). Available for response-time (avg/p90/p95/p99) and error-rate panels; aggregated series save into presets like any other series.

## [0.2.61.51] - 2026-07-13

### Changed
- **Audit log timestamps now display in the viewer's local timezone instead of UTC.** The audit log table rendered each timestamp with `toISOString()` (always UTC), which was confusing for anyone reading it in their own timezone. It now uses `toLocaleString` so times match the reader's local clock.

## [0.2.61.50] - 2026-07-13

### Added
- **The interactive Graphs card (test-run detail page) now has an "Include 'All aggregated' series" toggle for performance-test metrics.** When a performance-test panel source is selected, a switch appears that overlays the run-wide aggregate (all transactions collapsed) for transaction response time, request response time, and error percentage — the same three series the report's Graphs section already offers. The overlay is chart-only: it renders on the graph but is not added to the editable "Added Series" list and is never saved into a preset. It uses the existing `aggregated-metric-timeseries` endpoint (no backend change) and is hidden for Grafana/Dynatrace sources. The Compare and Trends cards are not covered by this change (they need net-new aggregated queries).

## [0.2.61.49] - 2026-07-13

### Fixed
- **Deleting a system under test no longer fails on large SUTs with "tuple decompression limit exceeded."** The cascade-delete cleared the five compressed TimescaleDB hypertables (`ds_metrics`, `requests_raw`, `requests_error`, `transactions`, `virtual_users`) with a single `DELETE … WHERE test_run_id IN (SELECT …)`. A subquery `IN` can't batch-drop compressed segments, so TimescaleDB decompressed inline and blew past `max_tuples_decompressed_per_dml_transaction`, rolling the whole delete back. Each hypertable is now cleared per-run with a constant-equality `DELETE … WHERE test_run_id = $1`, which drops whole segments with no decompression — the same pattern the single test-run delete already uses.
- **Deleting a test run is now recorded in the audit log.** Bulk deletes run through a background BullMQ worker with no HTTP request context, so the audit call was silently skipped (only the rarely-used single-delete endpoint was logged). The delete handler now forwards the queuing user's id from the job so the DELETE is attributed and recorded whether it runs in-request or in the worker.

### Changed
- **Generated reports now have recognizable names in the test-run Reports card.** New reports were all named `Report - <timestamp>`, which only differed by a time already shown in the Created column. The default name is now derived from the source template (e.g. `Apdex Overview - <timestamp>`), falling back to `Ad-hoc report` when starting from scratch. The template portion is capped so the name stays within the 255-char limit.

## [0.2.61.48] - 2026-07-13

### Added
- **Reports can now include an "All aggregated" series for performance-test metrics.** Three report sections gain an *Include 'All aggregated' series* toggle that adds the run-wide aggregate across **all** transactions (the same math as the aggregated-metric-timeseries endpoint — no per-transaction grouping):
  - **Graphs** — appends aggregated line charts for transaction response time, request response time, and error percentage (avg), on top of any configured/auto-discovered panels.
  - **Transaction Response Times** — prepends an "All aggregated" line to the chart and a row (avg/p95/p99, pass/fail) to the table.
  - **Comparisons** (baseline-run mode, performance-metrics source) — prepends an "All aggregated" row comparing the current run's run-wide aggregate against the baseline run's.
  - The toggle is off by default (existing reports render unchanged); the config is stored as JSON, so no migration. Aggregated percentiles use exact `PERCENTILE_CONT` rather than the endpoint's approximate percentile, so p95/p99 may differ slightly.

## [0.2.61.44] - 2026-07-11

### Fixed
- **Deleting a system under test no longer fails with a foreign-key error.** The cascade-delete handler was never updated after the MetricsSource refactor, so the final `DELETE FROM systems_under_test` tripped `metrics_sources`' FK (`FK_41fde009f014dff1c3f4f5396da`) and rolled the whole delete back. The handler now also removes the SUT's `metrics_sources`, `dynatrace_queries`, and `scaling_sessions` rows, ordered so `metrics_sources` is deleted last (after everything that references it). Verified against every blocking FK to `systems_under_test` (7) and `metrics_sources` (16).

## [0.2.61.42] - 2026-07-10

### Changed
- **All report sections now follow one visual style, so a generated report reads as a single document.** A shared style system (`report-style.ts`) is applied across the SLO, Apdex, Regressions, Comparisons, Trends, Response Times, AWR, Graphs and placeholder sections:
  - **One status scale.** The nine overlapping labels (`NO DIFFERENCE`, `PARTIAL REGRESSION`, `PARTIAL INCREASE`, `INCREASE`, `DECREASE`, `INCOMPARABLE`, …) collapse to five: `OK`, `WARNING`, `REGRESSION`, `IMPROVEMENT`, `N/A`. Judgment lives in the label; raw direction lives in the arrow.
  - **Delta arrows track the value.** `▲` for increases, `▼` for decreases, `–` only for a genuinely unchanged value — colored by what the movement means, not its direction. The generic `➖` next to every diff is gone.
  - **One number formatter.** Thousands grouping (`4,937,045`), at most two decimals, true-zero diffs render as `—`, percentages always one decimal, tabular numerals in all numeric cells.
  - **Uniform headers.** Every section title gets the same 4px blue accent with right-aligned summary chips (`10 regressions`, `4 improvements`); the mixed per-section emoji (`✓ ⭐ ❓ ↔`) and gradient icon boxes are removed. Comparison groups use one header component: source label + host chip + metric-count chip, with host-id prefixes stripped from metric names.
  - **Uniform severity pills** (uppercase with letter-spacing) and a **uniform author-comment block** (blue accent + speech-bubble icon) that is omitted entirely when empty.
- **Every report section's configuration now has the same comment box and preview.** All ten section types in the Generate Report dialog and template builder get the Section Comments field and a Preview Section button (previously only Apdex and Response Times had them). Sections without a bespoke preview render a real server-side preview of the section HTML.

## [0.2.61.41] - 2026-07-10

### Fixed
- **Generated reports show the system under test's name instead of its UUID.** The cover page and Test Run Summary previously printed the internal id (e.g. `70e6172c-9248-…`); they now show the system's name everywhere it appears.
- **SLO summary requirements and actuals are formatted like the rest of the app instead of showing raw Grafana unit codes.** `< 0.90 percentunit` now renders as `< 90%` (0.0–1.0 values are converted to percentages, matching the SLO config UI), `< 70.00 short` as `< 70`, and unit suffixes like `ms` keep their spacing. The `le`/`ge` operator spellings render as `≤`/`≥` like the web UI, and non-numeric measured values show `—` instead of `-`.
## [0.2.61.40] - 2026-07-10

### Added
- **Collapsed report sections now show what's inside them.** In the Generate Report dialog and template builder, each collapsed section card's subtitle summarizes its own configuration instead of repeating the generic type description — headers show their level and text (`H2 — Results`), text blocks show their content, response-time sections show the selected scenario, baseline-run comparisons show the dashboard, panel count, and comment, and other sections fall back to their section comment. Multiple instances of the same section type are distinguishable without expanding each one. Long summaries are ellipsized; values from hand-edited or API-written templates are treated as untrusted (invalid header levels fall back to H1, emoji aren't split mid-character).

### Fixed
- The section card header no longer crashes the report dialog when a stored template carries a section type this build doesn't recognize — it shows the raw type name instead.

## [0.2.61.39] - 2026-07-09

### Changed
- **Baseline comparison: dashboard mapping replaces host mapping, for both grafana and dynatrace.** The dynatrace-only free-text host-map editor (shipped in 0.2.61.37) is replaced by a dropdown-based dashboard mapping: pair a current-run dashboard with a differently named dashboard from the baseline run's environment (the baseline dropdown's options are fetched for the selected baseline run's environment/workload). The pairing substitutes the mapped `dashboard_label` in the series identity, and the SQL dashboard scope includes the mapped label so baseline rows survive the filter. Panel selection now filters the current run only (in code, not SQL) since a mapped baseline dashboard may renumber panels — pairing is by panel title. Saved configs with the old `hostMap` field ignore it. Note: dynatrace series that embed `dt.entity.*` ids in their names still only pair when those ids match across runs.
- **Baseline comparison config: grafana/dynatrace sources now prompt for a dashboard first, then one or more of its panels.** The comparison is scoped to the selection; configs saved without a selection keep comparing everything.

### Fixed
- **"Build and Push Docker Images" no longer fails when dispatched on a feature branch with "Push images" checked.** The `Log in to Docker Hub` step was gated on `github.event_name == 'push'`, while the build step's `push:` condition also allowed `workflow_dispatch` with `push_images=true` — so branch dispatches built for ~5 minutes and then pushed unauthenticated, dying with `401 Unauthorized: access token has insufficient scopes` in all six build jobs. The login condition now matches the push condition. Also gated the raw `VERSION` image tag to push events only: without that, the first successful branch push would silently overwrite the released version tag on Docker Hub whenever the branch's VERSION file matches main's (branch/sha tags are still pushed).

## [0.2.61.38] - 2026-07-09

### Fixed
- **`baseline_run` comparison sections no longer render empty in generated reports.** Report HTML generation runs in a background job with no user context (`generateHtml(reportId)` → `userId=''`), and the performance-metrics branch went through the controller-facing `TestRunsService.getTransactionStats`, which treats an empty user as a non-admin with zero organizations and returns `[]` — so the default source produced the empty-state in every real report while mocked unit tests stayed green. The fetcher now queries the `transactions` table directly (AVG/P95/P99 grouped by run, scenario, and transaction) via `resolveOrgFilter`, which implements the reports convention: empty userId = system call = no org filter; real users stay org-scoped. The now-unused `TestRunsService` dependency and `TestRunsModule` import were removed. SQL verified against a live database with the failing report's actual run IDs.

### Changed
- **The baseline test-run dropdown in the report section config now matches the compare card.** The plain select (env / workload / date) is replaced with the searchable Autocomplete pattern from the test-run details compare card: bold `test_run_id` with a formatted timestamp as the label, and a secondary line showing environment/workload (candidates span all environments of the system under test), application release, and annotations.

## [0.2.61.37] - 2026-07-08

### Added
- **Report `Comparisons` section gains a `baseline_run` mode: diff the current run against a chosen baseline run across three sources.** The existing section only did ADAPT control-group comparisons and ignored its `baselineTestRunId`. A new mode toggle keeps that path byte-for-byte unchanged (absent `comparisonMode` ⇒ `control_group`, so saved templates are unaffected) and adds a run-vs-run mode. The author picks a baseline test run (dropdown lists the same system-under-test across all environments/workloads — fits "same test, different app version" and "same version, different environment/server"), a source (`performance-metrics` / `grafana` / `dynatrace`), and which metrics to show (avg / p95 / p99). Results render as tables grouped by scenario (performance-metrics, from transaction stats), dashboard→panel (grafana, from `ds_metric_statistics`), or host (dynatrace), with each diff cell colored by configurable percentage bands (good / warning / critical, shared across sources). Response-time metrics are treated as higher-is-worse, so a faster-than-baseline result is always green regardless of band. For dynatrace, a host-mapping editor pairs current→baseline hosts so the same app on a different server compares correctly. The baseline-candidates endpoint was widened to accept optional environment/workload (same-SUT scope) without changing existing callers.

## [0.2.61.36] - 2026-07-08

### Fixed
- **The "Analysis timerange" toggle now filters every Performance Analysis tab, not just Overview.** The `excludeRampUp` toggle (which restricts stats to the configured analysis window, trimming ramp-up/ramp-down) was wired only into the Overview tab. The Top 10 Transactions/Requests/URLs tabs and the Error Analysis tab ignored it and always showed full-run data. The Top 10 tabs already hit endpoints (`/transactions`, `/samples`) that support `excludeRampUp`, so they now pass it and refetch when it flips. Error Analysis needed backend support: the five `error-analysis/*` endpoints now accept `excludeRampUp` and restrict `requests_error` to the analysis window (start = `start_time + ramp_up`, end = `end_time - ramp_down`, read from `test_runs`); the error-rate denominator switches to the `ramp_up_excluded = true` rollup total so numerator and denominator share the same window. Default stays `false` wherever the param is absent, so existing API behavior is unchanged.

## [0.2.61.35] - 2026-07-08

### Fixed
- **Anomaly-detection Trend chart hover tooltips no longer misalign.** The v0.2.61.34 fix cured the standalone Trends card but not the anomaly-detection Trend chart (`AnomalyExpandedContent`), which was still separating box from text. That chart already had `useResizeHandler={true}` and still broke, disproving the earlier "add useResizeHandler" theory: react-plotly.js 2.6.0's `useResizeHandler` only attaches a **window** resize listener (`create-plotly-component.js`, `window.addEventListener('resize', ...)`), not a container `ResizeObserver`. A MUI `<Collapse>` expanding resizes the container but not the window, so Plotly draws once mid-animation at partial height and never re-measures. The real fix: dispatch a `window` resize event from the Collapse's `onEntered` callback so the existing `useResizeHandler` relayouts once the animation settles. Applied to both `AnomalyExpandedContent.tsx` (the reported chart) and `trends/TrendsCard.tsx` (same latent gap — the v0.2.61.34 `useResizeHandler` there was also insufficient on its own).

## [0.2.61.34] - 2026-07-08

### Fixed
- **Trends card hover tooltips no longer misalign.** The v0.2.61.33 font fix did not resolve the Trends graph — the box and text still separated there, because the cause on that chart was different. The Trends `<Plot>` renders inside a MUI `<Collapse>` and, unlike the working `CurrentTestRunChart`, was missing `useResizeHandler`. So Plotly did its one and only draw (measuring hover-label text geometry) while the Collapse was still animating open — container at partial height — and never re-measured once it settled, leaving the hover box sized and placed against stale geometry. Adding `useResizeHandler={true}` (matching the sibling chart) attaches react-plotly.js's ResizeObserver, which relayouts after the Collapse finishes and re-measures hover geometry against the final size.

## [0.2.61.33] - 2026-07-08

### Fixed
- **Plotly chart hover tooltips no longer misalign on Windows Chrome.** Hover labels rendered the box and text separately: the tooltip text landed at the top-left of the chart (overlapping the title) while an empty white box drew near the data point. Cause was the theme's `"Inter"` web font in `hoverlabel.font.family` — Inter isn't a system font on Windows, so it loads async; Plotly sizes the hover box by measuring the rendered text, measures it against the fallback glyphs, then the text reflows to Inter once it loads, and box and text separate. All 10 hover labels across 8 chart builders (ADAPT Trend, trends, compare, SLO, graphs) now use a pure system-font stack via the shared `lib/plotly-fonts.ts` constant. Axis/title fonts keep Inter deliberately — they render once after load and never race. The two performance-analysis modals (inherit Plotly's default font) and `event-lines.ts` (uses `Roboto, sans-serif`, substitutes immediately) were already unaffected.

## [0.2.61.32] - 2026-07-08

### Added
- **TimescaleDB compression on the time-series hypertables.** `ds_metrics`, `requests_raw`, `transactions`, `virtual_users`, and `requests_error` now enable native columnar compression (`segmentby = test_run_id`, `orderby = time DESC`) with a 7-day `add_compression_policy`. `ds_metrics` alone is ~70% of the DB and compresses ~97% (measured: ~2.8 GB → ~81 MB), so this is a large storage reduction. Set up on greenfield in the consolidated migration (`createHypertables`, per-table nested savepoint so a compression failure never rolls back the hypertable) and on existing DBs via new migration `1788000000000-AddHypertableCompression` (idempotent, timescaledb-guarded); both run on fresh installs, the dated one as a no-op.

### Fixed
- **Force-refetch no longer breaks on compressed `ds_metrics`.** The reevaluate/force-refetch path (`orchestrate-reevaluate-batch`) does a selective `DELETE FROM ds_metrics WHERE test_run_id = $1 AND metrics_source_id IN (...)` then re-inserts. Because `metrics_source_id` isn't a compression `segmentby` column, TimescaleDB must decompress the run's whole segments inline, and runs over 100k rows exceeded `max_tuples_decompressed_per_dml_transaction` (default 100000) — aborting the entire refetch (`ERROR: tuple decompression limit exceeded`). `WorkerDatabaseService.decompressChunksForRange()` now decompresses the run's overlapping chunks up front (range-overlap query on `timescaledb_information.chunks`; `show_chunks` is boundary-based and misses a narrow window inside a chunk), called once per run before the source loop. The compression policy recompresses the chunk(s) afterward. Normal first-time collection is unaffected (it writes the recent, still-uncompressed chunk).

## [0.2.61.31] - 2026-07-07

### Fixed
- **Anomaly-detection "Selected Test Run" chart now renders the analysis-window markers.** In the anomaly-detection table, clicking a datapoint in a Trend graph to inspect another test run rendered the `Selected Test Run: <id>` chart without the start/end analysis-offset vertical lines, so it didn't match the `Current Test Run Details` chart. The selected-run `testRun` object passed to `CurrentTestRunChart` dropped `analysis_start_offset`/`analysis_end_offset` (they aren't carried in the trends data); it now reuses the current run's offsets (same SUT/env/workload analysis window). Clicking the current run's own point in the Trend graph also stopped rendering its markers because the selected-run branch fired even when the selection equalled the current run — the branch is now guarded with `selectedTestRunIdForRow !== testRunId` so it falls through to the full current-run object.

## [0.2.61.30] - 2026-07-07

### Fixed
- **Incremental metric collection no longer fails with `Custom Id cannot contain :`.** `IncrementalCollectionScheduler` built its BullMQ dedup `jobId` with `:` separators, which BullMQ rejects (it reserves `:` as its Redis key separator). Every `queue.add()` threw, so no collection jobs enqueued for in-progress test runs — starving `checks-evaluation` and making ADAPT report `INSUFFICIENT_DATA` on otherwise-valid runs. The job ID now uses `.` separators (colon-free and absent from every component) with a defensive strip of any residual `:`. Fixes #426.

## [0.2.61.29] - 2026-07-07

### Changed
- **Dynatrace test-run card opens on the Hosts tab.** In the expanded Dynatrace panel on a test-run page, Hosts is now the first (default-selected) primary tab, ahead of Services.

## [0.2.61.28] - 2026-07-07

### Added
- **Per-organization outbound proxy with a per-integration toggle.** An org can configure one HTTP proxy (URL + optional basic auth, credentials encrypted) under **Settings → Proxy**, then enable or disable it independently for each outbound integration (Grafana, Dynatrace, Pyroscope, Tempo/tracing, Notification webhooks) via a `Use proxy` switch on each integration dialog. When a proxy is configured and an integration's toggle is on, that integration's outbound calls route through the org's proxy; when off or unconfigured, behavior is byte-identical to before. New per-org `ProxyServer` entity (unique per org, full RLS: `ENABLE`+`FORCE` with scoped select/insert/update/delete policies) and a `use_proxy` column on all five integration entities. New org-scoped `proxy` CRUD API (`GET/PUT/DELETE /proxy`) — the password is never returned, and writes require the new org-admin `ProxyManage` capability. Routing is threaded through every outbound path: API `fetch` and `axios`, worker undici (Grafana `Pool` + Dynatrace), and grafana-sync `fetch`. Because the monorepo carries two undici majors (shared 6, worker/root 7), each consumer builds its `ProxyAgent` from its own undici copy, and agents are cached by connection identity to keep connections alive and avoid per-call socket/FD leaks.

### Security
- **Pyroscope flamegraph proxy resolution is server-authoritative and org-scoped to the caller.** The proxy for a flamegraph fetch is resolved from the `PyroscopeInstance` matching the request's backend URL, filtered to the caller's accessible organizations (`withOrgFilter` + `withRequestEm`) — closing a cross-tenant proxy-egress IDOR where a client could otherwise route requests through another org's proxy.

## [0.2.61.27] - 2026-07-06

### Fixed
- **ADAPT now respects the analysis time range (start offset / end offset) on re-analysis.** Editing a completed run's analysis window re-runs ADAPT, but the pipeline skips metric-collection for completed runs, so the `ds_metrics.ramp_up` flag that ADAPT's statistics filter on (`StatisticsPipeline` → `ds_metric_statistics` → `ControlGroupStatisticsPipeline` → ADAPT) stayed baked at ingestion — ADAPT read the *old* window while the SLO graphs (which compute `start + offset` live at query time) reflected the new one. `StatisticsPipeline.refreshRampUpFlags()` now recomputes `ds_metrics.ramp_up` from each run's current `analysisStartOffset`/`analysisEndOffset` (the exact `MetricsPipeline` formula, both ends) at the start of the aggregation transaction — the choke point every ADAPT re-analysis crosses — guarded by `IS DISTINCT FROM` so it's a no-op when offsets are unchanged. Also fixed the legacy control-group raw-scan path (`ControlGroupStatisticsPipeline`), which excluded no ramp-up/ramp-down points at all, to filter `ramp_up = false` like the fast path.

### Changed
- **The ADAPT per-run chart (expanded anomaly row) now shows the analysis time range the same way the SLO graphs do:** shaded excluded regions for the start and end offsets plus amber dashed boundary lines at `start + startOffset` and `end − endOffset`, driven by `analysis_start_offset`/`analysis_end_offset`. Previously it drew only a single ramp-up rectangle from a hardcoded 60s default and never marked the end of the window.

## [0.2.61.26] - 2026-07-05

### Fixed
- **Reports no longer get permanently stuck in "generating" (#421).** Two compounding defects: (1) the `perfana-report-html-generation` BullMQ job was enqueued *inside* the still-open per-request RLS transaction, so a fast worker on a different DB connection couldn't see the uncommitted `generated_reports` row, failed with "Report not found", and abandoned the job — and `updateJobId` ran on the default connection too, leaving `job_id` NULL after commit. (2) The HTML and PDF workers returned `{ success: false }` instead of throwing, so BullMQ marked the job *completed* and the configured `attempts: 3` / exponential backoff never fired. Fix: new `runAfterRequestCommit()` CLS hook (drained by `RlsTransactionInterceptor` after the transaction commits) defers the enqueue until the row is visible; `updateJobId` now runs via `withRequestEm` so `job_id` commits atomically with the report; and `HtmlGenerationProcessor.processJob` (perfana-api) plus `PdfQueueProcessor.processJob` (perfana-report) now re-throw on failure so BullMQ routes the job to `:failed` and retries. A report whose generation ultimately fails ends at `status='failed'` with `error_code`/`error_message` set — never orphaned at `pending`. Also: the validator now permits `failed → processing` so a BullMQ auto-retry genuinely re-runs the render instead of no-oping on the state-machine guard, and the manual **Retry** endpoint (`POST /reports/:id/retry`) now actually re-enqueues the job — previously it flipped status to `pending` and left the report with nothing processing it.

## [0.2.61.25] - 2026-07-05

### Changed
- **Test run details (Results tab): swapped the Anomaly Detection and Deep Links card positions, and made the Deep Links and Events cards conditional.** Anomaly Detection now sits earlier in the grid (where Deep Links used to be); Deep Links moved further down. The Deep Links card only renders when deep links are configured for the run's system/environment/workload (new lightweight `useHasDeepLinks` config check, separate from the card's own per-link resolve), and the Events card only renders when the run actually has events. Previously both always rendered — Deep Links showing an empty "No links configured" state and Events showing an empty card even with zero events.

## [0.2.61.24] - 2026-07-03

### Fixed
- **ADAPT no longer flags sub-threshold noise on saturated / zero-variance metrics as a "partial regression" (#417).** When a control-group metric is perfectly constant (`control_iqr = 0`, e.g. an Apdex saturated at ~1.0), the IQR check's band `control ± (control_iqr * iqrThreshold)` collapsed to zero width, so *any* nonzero test value tripped `iqr.isDifference = true` and produced a "partial regression" — while the same magnitude noise on a metric with real spread (IQR ≈ 50 ms) correctly read as "no difference". Both `AdaptSQLFragments.buildChecksJSONB()` and the inline copy in `TrackedResultsSQLBuilder` now guard the IQR check's `valid` flag and `isDifference` CASE with `control_iqr <> 0`, so a constant baseline makes the IQR check inert and classification falls through to the percentage / absolute checks (a genuine Apdex drop still trips `pct`). Same guard style already used for the informational `iqrDiff` display field.
- **The ADAPT empty-control-group message now distinguishes "no metrics_source match" from "baseline too short/aborted" (#417).** `writeExclusionConclusions` counts the control group's `ds_control_group_statistics` rows: when the baseline *has* data but none of it matched the run's `metrics_source_id` (usually different scenario/workload naming between ingestion paths), it now says so and points the user at SUT/environment/workload naming, instead of the misleading "the control run(s) contained insufficient metrics — they may have been too short or aborted."

## [0.2.61.23] - 2026-07-03

### Fixed
- **Apdex score no longer renders as `NaN` on the performance-analysis card when a transaction's threshold `T` equals the max value in its `pct_agg` t-digest (#416).** timescaledb_toolkit's `approx_percentile_rank(value, tdigest)` returns `NaN` when `value` is exactly the digest's max centroid; since the read-time Apdex expression `rank(T) + (rank(4T) - rank(T)) / 2` subtracts/adds that term, the whole score became `NaN`. This is common because per-transaction thresholds are frequently auto-derived near the observed max, so `T == max` is not rare. All 8 read-time Apdex sites in `test-runs-performance-query.service.ts` (rollup, CAGG live-Apdex, and raw-scan paths) now build their SQL from a single `apdexScoreSql()` helper that wraps every rank in `LEAST(1.0, COALESCE(NULLIF(approx_percentile_rank(...), 'NaN'), 1.0))`, mapping the boundary to `1.0` (all samples satisfied) to match the raw-count semantics of the worker's `ApdexCalculator`. Both the `T` and `4T` ranks are guarded (`4T` can also equal the max on very tight distributions). The report path (`getApdexDataFromDatabase` / `apdex-renderer.ts`) was already count-based (`response_time <= T`) and unaffected.

## [0.2.61.22] - 2026-06-30

### Fixed
- **First-run BASELINE adapt mode now persists to the workload config, so every subsequent run inherits it.** v0.2.61.17 forced `adaptConfig.mode=BASELINE` on the first test run of a sut/test-environment/workload combination, but only stamped that single run — it never wrote `adaptMode` to the workload's config. Since `storeTestRun` resolves the mode as `DTO override > workloadConfig.adaptMode > DEFAULT`, run #2 read a null `workloadConfig.adaptMode` and silently fell back to `DEFAULT`, so only the very first run was ever BASELINE. `CreateTestRunHandler` now also writes `adaptMode=BASELINE` to `SystemUnderTestWorkload.config` on the first run (via the existing `TestRunLookupService.updateWorkloadConfig`), the same field the SUT config → ADAPT Mode tab reads/writes. Every future run of the combination stays BASELINE until the user changes it in that tab. Best-effort — a config-write failure logs but does not break test run creation, matching the sibling first-run changepoint seeding.

## [0.2.61.21] - 2026-06-28

### Security
- **Actually cleared OpenSSL CVE-2026-31789 (`libssl3`) across every distroless image by overlaying the patched Debian package.** v0.2.61.20 assumed distroless inherits a patched openssl from the debian12 base via the floating `:nonroot` tag — that's **wrong**: Google's distroless lags Debian's openssl security releases, shipping `libssl3 3.0.18-1~deb12u2` while debian-security has `3.0.20-1~deb12u2`. So a rebuild does **not** clear the finding. (Node bundles its own OpenSSL — `process.versions.openssl` is 3.0.17 — and never links this lib, but scanners still flag the stale package.) Fix: a `debian:12-slim` `openssl-patch` stage `apt-get install`s the current `libssl3` and we overlay both the shared libs (`libssl.so.3`, `libcrypto.so.3`) and the dpkg metadata (`/var/lib/dpkg/status.d/libssl3`) onto the distroless final stages, so scanners read `3.0.20-1~deb12u2`. Install is unpinned (always the latest security build); the per-arch buildx stage resolves the correct `/usr/lib/<arch>` path. In `Dockerfile` this is a single shared `distroless-patched` base that web/api/grafana-sync/worker/runtime-prep all derive from; `Dockerfile.migrations` carries the same stage. Verified: built `api` and `migration` images both report `libssl3 3.0.20-1~deb12u2` and node still runs. (This is the overlay work that was dropped from PR #411's squash merge.)

## [0.2.61.20] - 2026-06-28

### Security
- **Moved the `perfana-migration` image off Alpine onto distroless (`gcr.io/distroless/nodejs20-debian12:nonroot`), the same base as the api/web/worker/grafana-sync runtimes.** The migration runner is pure-JS TypeORM with no native runtime deps, so it never needed Alpine's shell or package manager — the Alpine base only carried an OpenSSL that needed patching for CVE-2026-31789. Distroless inherits OpenSSL from the debian12 base (floating `:nonroot` tag → a rebuild pulls the patched library), removing this image from the Alpine-openssl patch treadmill entirely. The builder stage stays `node:20-alpine3.22` (needs `apk` for the node-gyp toolchain); only the final stage changed. Dropped the now-impossible `apk upgrade`, `addgroup`/`adduser`, and `RUN chown` lines (no shell in distroless); COPYs use `--chown=nonroot:nonroot`, and `CMD` is `["run-migrations.js"]` since distroless sets ENTRYPOINT to `/nodejs/bin/node`. `perfana-report` stays on Alpine — Puppeteer/Chromium needs the system libs only `apk` can install.

## [0.2.61.19] - 2026-06-25

### Security
- **Bumped the Alpine build base from `alpine3.20` to `alpine3.22` to clear CVE-2025-55131 (Node.js `vm` timeout race condition, CVSS 9.2 critical).** The fix landed in Node 20.20.0, but `node:20-alpine3.20` is frozen at 20.19.2 and `node:20-alpine3.21` at 20.19.6 — only `alpine3.22` ships a fixed runtime (20.20.2). This affected the build stages and, importantly, the `perfana-report` production image (the only prod image not on distroless, since Puppeteer needs system libs). The distroless runtime images (web/api/grafana-sync/worker) already shipped Node 20.20.0 and were never vulnerable. Single-line `ALPINE_VERSION` ARG change in `Dockerfile`.

## [0.2.61.18] - 2026-06-25

### Security
- **`npm audit`: cleared every prod-runtime advisory (56 → 36 vulnerabilities, all remaining are dev-tooling).** Bumped the prod-facing packages via `npm update` (incremental, no lockfile regen): `undici` → 7.28.0 (request smuggling, header injection, TLS bypass), `form-data` → 4.0.6 (CRLF injection), `hono` → 4.12.27 (path traversal, CORS wildcard), `protobufjs` → 7.6.4, `ajv`. Added two `overrides` in `package.json`: `multer` → ^2.2.0 (high DoS, pulled in via `@nestjs/platform-express`) and a scoped `@typescript-eslint/typescript-estree` → `minimatch` ^9.0.9 (high ReDoS, dev-only eslint tooling — scoped to avoid disturbing the 3.x/10.x minimatch consumers). The 36 remaining advisories all require breaking major bumps of dev toolchains (vitest/vite/esbuild/turbo/next-dev/testcontainers) and are deferred.
  - **Note for future lockfile work:** npm 10.9.2 drops 6–7 of `@nestjs/cli`'s transitive deps (e.g. `node-emoji`, `@inquirer/prompts`) when the lockfile is regenerated from scratch (`rm package-lock.json && npm install`) — it emits the dependency edge but never the package node, which breaks `nest build`. Apply override changes with `npm update <pkg>` (incremental, seeded from the committed lockfile) rather than a full regen.

## [0.2.61.17] - 2026-06-23

### Changed
- **First test run of a sut/test-environment/workload combination now seeds the baseline automatically.** `CreateTestRunHandler` detects when no prior run exists for the combination and forces `adaptConfig.mode = BASELINE` (differences auto-`ACCEPTED`), overriding any requested mode — there is nothing to compare a first run against. Subsequent runs keep their requested mode (`DEFAULT` by default). Mirrors the existing first-run changepoint seeding.

## [0.2.61.16] - 2026-06-23

### Added
- **Ok-only average is now derivable from the transaction & request continuous aggregates (#405).** Added a `sum_rt_ok` column (`sum(response_time) FILTER (WHERE success)`, rolled up as `sum(sum_rt_ok)` at the 1m/5m granularities) to the six main caggs — `transactions_5s/1m/5m` and `requests_raw_5s/1m/5m`. Since `n_ok` already lives in these views, dashboards can now compute the average of *successful* responses as `sum_rt_ok / n_ok` straight from the rollup, no raw-table scan. Purely additive to the cagg SELECT lists; existing columns (`avg_rt/min_rt/max_rt/n/n_ok/n_err/pct_agg`) are untouched.
  - Percentiles (p90/p95/p99) were already covered: the caggs store a `percentile_agg` sketch (`pct_agg`, plus ok-only `pct_agg_passed` in the `*_passed` sibling caggs) and queries use `approx_percentile(...)` over `rollup(pct_agg)`, which aggregates correctly across buckets. The PerformanceAnalysisCard's p95/p99 columns come from this path via `GET /test-runs/:id/transactions` → `test-runs-performance-query.service.ts`.

## [0.2.61.15] - 2026-06-23

### Added
- **Multi-select + delete confirmation on the Dynatrace "Entities" tab (system config), matching the "Queries" tab.** The entity mappings table now has a select-all header checkbox and per-row checkboxes; selecting one or more rows shows a toolbar ("N entities selected") with bulk-delete and clear-selection actions. Single-row deletes now open a confirmation dialog (`DeleteConfirmationDialog`) instead of deleting immediately, and bulk deletes prompt with a count before running. Bulk delete fires one `DELETE /dynatrace/entities/mappings/:id` per selected row; if any fails it keeps the dialog open and surfaces an error rather than silently dropping some. Frontend-only — no API, endpoint, or schema changes. Covered by a new Jest hook test (`useDynatraceEntityMappings.test.ts`).

### Fixed
- **Adding Dynatrace HOST entities now refreshes the Queries tab immediately.** Mapping a HOST auto-creates four metric queries server-side (CPU, memory, disk, network via `createHostMetricQueries`), but the Queries tab only fetched on mount, so the new queries didn't appear until a manual reload. The Entities tab now calls back into the parent (`onHostQueriesCreated` → `fetchQueries`) after a successful host add, so the Queries tab reflects them right away.

## [0.2.61.14] - 2026-06-22

### Added
- **Tag-based multi-select for Dynatrace HOST entity mappings.** In the system config "Add Dynatrace Entity" dialog, picking entity type `HOST` now shows a tag key + value filter and a checkbox list of matching hosts, so you can map many hosts at once instead of one autocomplete pick at a time. A name search box filters the list client-side alongside the tag filter; "Select all" maps every host currently matching. Submit loops the existing `POST /dynatrace/entities/mappings` once per selected host (already-mapped hosts return 409 and are skipped, not failed). Other entity types keep the original single-select autocomplete. Frontend-only — no API, endpoint, or schema changes.
  - Tag options are derived client-side from the fetched host page (≤500 hosts). If a fleet ever exceeds one page, push a `tag("k:v")` condition into the server-side `entitySelector` (marked with a `ponytail:` comment in `AddEntityDialog.tsx`).
  - Selected hosts are stored as full entity objects, not ids, so changing the tag/name filter never silently drops a selection from the submit set. Changing the Dynatrace instance clears the in-progress selection so it can't be submitted against the wrong instance. The batch is resilient: a non-409 failure mid-loop doesn't abort — it keeps the dialog open with only the failed hosts still selected and reports an added/skipped/failed summary.

## [0.2.61.13] - 2026-06-17

### Fixed
- **`auditableFields` entity snapshot updated after the `DsTrackedDifferences` removal in v0.2.61.12 (#401).** That PR deleted the dead `DsTrackedDifferences` entity but left it listed in `packages/shared/src/entities/__tests__/__snapshots__/auditable-fields.snapshot.spec.ts.snap`, so the snapshot test went red on `main`. Regenerated the snapshot (one line removed). The failure slipped through because the pre-push gate (`npm run preflight`) runs lint + type-check + the RLS suite, not the full Jest test suites.

## [0.2.61.12] - 2026-06-17

### Removed
- **Dead code removal surfaced by an over-engineering audit (−5,547 lines, −1 dependency, no behavior change).** Every cut was verified against real callers/importers before deletion; the audit's larger claims were checked and most rejected because the code was in active use.
  - `@perfana/config` package — zero importers; the live TypeORM config factory is `@perfana/shared/config`.
  - `DsTrackedDifferences` entity class — the `ds_tracked_differences` table is accessed only via raw SQL, so the class was never imported, registered in a `TypeOrmModule.forFeature`, or injected. Table and migrations are untouched.
  - 7 never-called `TypeOrmBaseRepository` methods (`findWithPagination`, `createMany`, `updateMany`, `deleteMany`, `softDelete`, `restore`, `exists`); the two repo-level `createMany` overrides are independent and unaffected.
  - 3 unused `BasePipelineTypeORM` methods (`writeQuery`, `createTimer`, `logTimingSummary`), an unused `PoolClient` import in `BaseCheckService`, and commented-out panel-106 debug blocks. `JSON.parse(JSON.stringify())` deep clone replaced with `structuredClone()` in the panel-request builder.
  - 7 unused shadcn `components/ui/` files (`alert`, `badge`, `data-table`, `metric-card`, `progress`, `select`, `spinner`) plus their tests — MUI is the real UI system. `data-table` was the only consumer of `@tanstack/react-table`, now dropped from `apps/web`. `button`/`card`/`input` stay (they back the live `/signin` Keycloak login and `/signup`).
  - `AuthorizedBaseService` abstract class (434 lines) — zero production subclasses; only a JSDoc example and a throwaway test subclass referenced it.

## [0.2.61.11] - 2026-06-12

### Fixed
- **Anomaly-detection rows for per-transaction performance metrics show their Current Test Run chart again** — a regression from #383 (v0.2.61.0). That change added the aggregated-metric-timeseries chart for whole-test aggregate SLO metrics and guarded `CurrentTestRunChart` with `row.source_type !== 'performance_test' || aggregatedMetricSource`, intending to block "falling back to the wrong Grafana endpoint" for unrecognised performance-test metrics. But `parseAggregatedMetricSource` only resolves the dotted aggregate format (`transactions.<name>.response_time.<stat>`), whereas per-transaction ADAPT rows store the plain transaction name in `metric_name` (e.g. `AV_BVAC_03_Vacatures`) with the type/stat in `panel_title` ("Transaction RT Avg"). So the parser returned `undefined` for every per-transaction row and the guard rendered "Chart not available for this metric type" instead — for *all* per-transaction performance rows (e.g. all 123k such ADAPT rows in a representative DB), even though `ds_metrics` holds their data keyed by `panel_id` + `metric_name` (the pre-#383 ds-metrics path drew them fine). The guard is removed: `CurrentTestRunChart` now renders for every row — aggregate-SLO rows still use the aggregated endpoint via `aggregatedMetricSource`, while per-transaction rows pass `aggregatedMetricSource={undefined}` and fall back to the ds-metrics panel endpoint as before #383. Regression covered by `apps/web/__tests__/app/test-runs/anomaly-detection/AnomalyExpandedContent.test.tsx`, plus a fixture-driven guardrail (`AnomalyExpandedContent.fixtures.test.tsx` + `fixtures/adapt-metric-names.ts`) that renders the component against real `ds_adapt_results` metric-name shapes (plain transaction names, `<txn>.<sub-request>`, global counters, Grafana series, and the dotted aggregate-SLO format) and asserts each renders a chart on the correct data path — encoding "what production metric names actually look like" once so the synthetic-input gap that hid this regression can't recur.

## [0.2.61.10] - 2026-06-11

### Fixed
- **JTL file imports no longer fail with foreign-key violation `FK_0f51a7f49362c67adfaaca3973c`** — a JTL upload creates the test run and writes its configs + metric rows in a *single* request. The run was `save()`-ed through the request-scoped RLS transaction (`withRequestEm`), but `TestRunsConfigService.addTestRunConfigsByUuid` and `JtlImportService`'s metric inserts (`insertRequests`/`insertTransactions`/`insertErrors`/`insertVirtualUsers`/`insertUrlPatterns`) wrote through raw `this.dataSource.query` — a *separate* pooled connection where the just-created run was still uncommitted and invisible. The `test_run_configs` FK to `test_runs.id` couldn't resolve → violation → `RlsTransactionInterceptor` rolled the whole request back, so the run and its metrics vanished. The raw-connection metric inserts autocommitted independently and *survived* the rollback, leaking orphaned `requests_raw`/`transactions`/`virtual_users` rows on every failed import. Live perfana-cli runs were spared only because they create-run and write-configs in *separate* polled requests (the run is already committed by the time configs are written). All config and JTL-metric writes now route through the request EntityManager (`withRequestEm` / the new `withRequestQuery` helper), so they share the run's transaction connection — the FK resolves and a failed import rolls back atomically with no orphans. `associateStringBasedConfigs` (the live perfana-cli path) moved onto the request transaction too; because it intentionally swallows errors ("not critical"), its mutations are wrapped in a Postgres `SAVEPOINT` so a swallowed failure rolls back only that sub-operation instead of poisoning (25P02) and silently rolling back the `updateRunningTest` request that called it. Regression covered by `apps/api/src/test/rls/jtl-import-request-em.spec.ts`.

## [0.2.61.9] - 2026-06-10

### Fixed
- **Migration Runner Docker image now builds for `linux/arm64`** — the multi-arch CI build (`linux/amd64,linux/arm64`) failed on the migration image with `exit code: 132` (SIGILL). The final stage of `Dockerfile.migrations` ran `npm install` for `typeorm`/`pg`/`dotenv`/`reflect-metadata` without `--platform=$BUILDPLATFORM`, so for the non-native architecture the install ran under QEMU emulation, where npm/node crashes with an illegal-instruction fault. These four packages are pure-JS (no arch-specific binaries), so the install now happens once in the native builder stage and the resulting `node_modules` is `COPY`-ed into the final stage — eliminating the emulated `npm install` entirely. Verified by building both arches and loading all four deps at runtime under amd64 emulation.

## [0.2.61.8] - 2026-06-09

### Fixed
- **Regex rules on chained dashboard template variables now narrow dependent variables** — auto-config applied a profile's `matchRegexForVariables` filters only *after* every template variable had been resolved against its datasource. When variables chain (a dependent variable's query references an already-resolved one, e.g. `... WHERE scenario_name IN ($scenarioName) AND transaction_name IN ($transaction)`), the dependent query ran against the full, unfiltered upstream values, so an upstream regex rule never reduced the dependent results. `VariableDiscoveryService.getApplicationDashboardVariables` now applies overrides + regex filtering after each variable is resolved, inside the discovery loop, so narrowed upstream values flow into the chained `IN (...)` clauses. Concretely, the `spanmetrics` profile (where `requestName` depends on `scenarioName` + `transaction`) generated a separate dashboard for every `requestName` regardless of the `scenarioName`/`transaction` regex rules; with the fix both rules constrain `requestName` via the chained SQL, so only matching requests produce dashboards. Profiles with no chained variables or a single rule are unaffected (the per-variable filtering is idempotent).

## [0.2.61.7] - 2026-06-09

### Fixed
- **Deleting a Grafana dashboard from a system under test no longer fails with `relation "ds_metric_classification" does not exist`** — the cascade-delete list in `ApplicationDashboardsService.delete` (added in #274) referenced `ds_metric_classification`, a table that has never existed (`metric_classification` is only a *column* on some `ds_*` tables, not a table of its own). The bogus `DELETE FROM ds_metric_classification ...` threw a `42P01` and rolled back the whole delete transaction. Removed the entry; the remaining 8 `ds_*` tables in the list are exactly the ones with NO ACTION FKs on `application_dashboard_id` that actually block the parent delete.
- **Deleting a dashboard referenced by a provisioned template no longer fails with a `23503` FK violation** — `provisioned_template_ds_compare_configs` also has a NO ACTION FK on `application_dashboard_id` but was missing from the cascade-delete list, so deleting a dashboard that a provisioned template config pointed at would abort the transaction. Added it to the list (mirrors the SUT delete handler, which already deletes these before `application_dashboards`); a template config referencing a deleted dashboard is meaningless.

## [0.2.61.6] - 2026-06-03

### Fixed
- **Long JMeter scenario names no longer abort the performance-test-metrics pipeline** (#388) — `generateScenarioDashboardUid()` now caps its output at the `application_dashboards.dashboard_uid` `varchar(100)` limit. Short names are unchanged (`performance-test-metrics-<sanitized>`, no churn for existing dashboards); names that would overflow are truncated and given a short deterministic SHA-256 suffix of the original name, so the UID stays stable across re-runs (idempotent) and two long names that share a truncated prefix still map to distinct UIDs. As defense-in-depth, `RequestsProcessor` and `TransactionsProcessor` now log-and-skip a scenario whose dashboard creation fails instead of aborting the whole run, so the remaining scenarios still produce `ds_metrics`.
- **Phantom "job in progress" now self-heals** (#387) — `JobProgressService` reconciles each in-memory active-job entry against authoritative state on read, so a finished job whose terminal `completed`/`failed` event was dropped clears automatically (no `perfana-api` restart). Eviction triggers: `lastProgressAt` older than a configurable staleness threshold (`JOB_PROGRESS_STALE_THRESHOLD_MS`, default 5 min), the Redis `job:progress:{jobId}` key gone, a terminal status present in Redis, or the scope lock held by a different job. The Redis progress key (refreshed every progress event) is treated as authoritative rather than the scope lock, which is not auto-extended and so legitimately expires for long-running jobs. `getActiveJobForScope()` and `getAllActiveJobs()` now both reconcile before returning.

## [0.2.61.5] - 2026-06-02

### Added
- **Surface failed-user session variables in the error UI** — the `session_variables` captured on `requests_error` (see 0.2.61.4) are now read by the API and shown wherever error details are presented. The Error Details dialog renders them as a key/value table (after Response Time, before URL), shown only when present. The errors table marks rows that have captured session data with a key icon ("Session variables captured") so users can spot them before drilling in. The MCP `get_error_details` tool now returns `sessionVariables` too, so AI agents receive them. Empty `{}` and `NULL` are treated identically (no section, no indicator). No DB migration — the column already exists. (#389)

## [0.2.61.4] - 2026-06-02

### Added
- **Capture session variables on failed samples** — added a nullable `session_variables jsonb` column to `requests_error` so the `perfana-jmeter-timescaledb` backend listener can persist a failed virtual user's session variables (key/value pairs) alongside the existing error detail. Capture is opt-in on the listener side and writes only for failed samples; existing and success rows stay `NULL`. Stored as `jsonb` so individual keys are queryable later (e.g. `WHERE session_variables->>'cartId' = '...'`). The `requests_error_5s/1m/5m` continuous aggregates are count rollups and are unaffected. (#389)

### Changed
- **Consolidated schema migration is now the single source of truth for a greenfield install** — folded the former standalone `tags_hash` unique-index migration into the consolidated migration as idempotent statements, so a fresh database is fully provisioned by the one consolidated migration with no dependency on a separate timestamped migration.

## [0.2.61.3] - 2026-05-31

### Changed
- **Open-source publication preparation** (no application code changes). Prepared the repository for going public:
  - **Secret audit**: full-history scan with gitleaks (47 findings, all triaged benign — test mocks + doc examples) and trufflehog (0 verified secrets). Decision recorded to keep git history as-is. Reports under `docs/audit/`.
  - **Repo curation**: untracked maintainer-local tooling from git while keeping it on disk — all of `.claude/skills/` (kept only the generic `.claude/agents/` helpers) and the internal `docs/superpowers/` specs/plans/audits. Stripped gstack/GitNexus/skill-routing sections from `CLAUDE.md` and `AGENTS.md` (kept the project-relevant Health Stack section). Untracked the `docs-site/content/.obsidian/` editor config.
  - **Docs**: fixed a dead `PLAN.md` link; verified the Quartz docs-site builds; set `quartz.config.ts` `baseUrl` to `perfana.github.io/perfana` for GitHub Pages.
  - **Onboarding**: wired `npm run seed` and documented it in the Quick Start; added pre-push-gate and architecture-onboarding sections to `CONTRIBUTING.md`.
  - **Governance**: added `NOTICE` (Apache-2.0 + bundled Quartz/MIT attribution), a PR template, and a DCO sign-off policy; confirmed the security reporting contact. Audited CI workflows — none expose secrets to fork PRs.
  - A pre-publication credential-rotation checklist (`docs/audit/2026-05-31-rotation-checklist.md`) and clean-clone validation remain as operator follow-ups before visibility is flipped to public.

## [0.2.61.2] - 2026-05-31

### Fixed
- **Repaired 3 stale `@perfana/web` tests** (no production code change — the tests had drifted behind intentional source changes). (1) `socket.test.ts` asserted the old `['websocket','polling']` transport order; the source intentionally switched to polling-first in #377 for proxy compatibility, so the assertion now matches. (2) The `on()` "wrap listener with logging" test leaked state across the full suite — the `socketManager` singleton re-attaches persisted listeners on every `connect()`, so `.find()` grabbed a stale handler; it now takes the last `test_event` registration (its own listener) and is renamed to reflect current behavior. (3) `TestRunDetailsCard.test.tsx` expected the removed text "Yes - Test was aborted"; abort is now rendered as a `<Chip label="Aborted">`, so it asserts on "Aborted". Full web suite back to 3963/3963 passing.

## [0.2.61.1] - 2026-05-31

### Changed
- **Dead-code cleanup (knip backlog cleared)**: Removed ~205 knip findings across the monorepo so `npx knip` exits clean. Deleted 43 dead files — the unwired `tracked-regressions/` anomaly-detection feature, the superseded `apdex-config-dialog` implementation, orphaned components (`ReportList`, `CollapsedCard`, `SLOContext`, `ConnectionStatus`, `useRealtime`, template-builder pieces), the worker `statistics-processor`, and unused barrel `index.ts` files. Removed ~180 unused exports/re-exports from `apps/api` and `apps/worker` (barrel re-exports, dead DTOs, helper functions, type aliases). Tagged framework-DI symbols (guards/pipes/validators/decorators) and live-feature type vocabularies (AWR, report-generation) with `/** @public */` where knip cannot trace runtime usage.
- **Dependency hygiene**: Declared previously-undeclared phantom deps in `apps/api` (`express`, `dotenv`, `domhandler`, `js-yaml`); removed `puppeteer` from `apps/api` (used only in `perfana-report`/`shared`); removed the redundant root `dependencies` block (each entry is declared in the workspace that uses it). Configured `knip.json` to ignore CLI binaries used in scripts (`typeorm`, `quartz`, `tsconfig-paths`) and tooling knip cannot trace (test runners, git hooks, eslint plugins).

## [0.2.61.0] - 2026-05-31

### Changed
- **"Exclude Ramp-up Time" renamed to "Apply to analysis timerange only"**: All UI labels, form checkboxes, and tooltips across benchmark forms, SLO threshold config, the aggregated SLO dialog, Apdex SLO dialogs, and the report generation section now use the new label. Helper text updated to match throughout.
- **Aggregated SLO source tag shows "performance-metrics" instead of "custom"**: The service-level objectives results list now displays the tag as "performance-metrics" for aggregated/custom-source SLOs. The stored data value is unchanged.
- **Anomaly detection test run details chart uses aggregated timeseries for performance-metrics rows**: When expanding an ADAPT row whose `source_type` is `performance_test`, the "Current Test Run Details" chart now fetches from the `/aggregated-metric-timeseries` endpoint (60-second bucketed data direct from performance tables) instead of the Grafana panel metrics endpoint. The metric and stat are derived from the row's metric name (e.g. `transactions.login.response_time.p95` → `transaction_response_time` / `p95`). Grafana-backed rows are unaffected. Metric types that cannot be mapped to a known aggregated source now show a "Chart not available" message instead of silently rendering an empty chart.
- **Current test run detail chart shows data points as lines with markers**: The chart mode changed from `lines` to `lines+markers` for clearer data point visibility.

### Fixed
- **Anomaly detection sort column only worked once**: Clicking the same column header a second time had no effect. The root cause was `setSortDirection` being called inside a `setSortBy` functional updater — React can bail out of re-rendering when state doesn't change, making the nested call unreliable. Fixed by reading `sortBy` directly and calling each setter independently.
- **Anomaly detection API includes `dashboard_uid`**: The `/test-runs/:id/anomaly-detection` endpoint now returns `dashboard_uid` in each result, enabling the frontend to identify performance-metrics rows.

## [0.2.60.3] - 2026-05-31

### Fixed
- **Aggregated SLO chart shows only analysis window data**: The timeseries fetch was using `applyAnalysisWindow=true`, clipping the chart data to the ramp-up/ramp-down window and leaving the chart empty outside the orange dashed boundary lines. Changed to `applyAnalysisWindow=false` so the full test run timeseries is shown; the analysis window boundaries remain visible as orange dashed vertical lines.

## [0.2.60.2] - 2026-05-29

### Fixed
- **Aggregated SLO chart crashes the page on expand**: PostgreSQL `NUMERIC` columns are returned as strings by the node-postgres driver at runtime. `benchmark.requirement_value` was being serialized as `"2000"` (string) into the `requirement` JSONB column, causing `"2000".toFixed(2)` → `TypeError: r.toFixed is not a function` when the aggregated SLO chart tried to render the threshold line — crashing the entire page. Fixed at three layers: (1) `ChecksPipeline.saveAggregatedCheckResult` now coerces `requirement_value` with `Number()` before JSON serialization, preventing future bad writes; (2) `TestRunsAnomalyService.getTestRunCheckResults` normalizes `requirement.value` to a number on read, fixing existing stored data without a migration; (3) `AggregatedSloChart` defensively coerces the value with `Number()` as a final guard.

## [0.2.60.1] - 2026-05-29

### Fixed
- **Socket.IO gateway not initializing in Docker**: In monorepo Docker builds, `npm ci --omit=dev` hoists packages differently than a local install, leaving `@nestjs/websockets` and `@nestjs/platform-socket.io` in `apps/api/node_modules` rather than the root. The `IoAdapter` parent class's `instanceof NestApplication` check silently failed against the duplicate `@nestjs/core` copy, causing Socket.IO to attach to the wrong object and return 404 on WebSocket upgrade. Fixed by hoisting `@nestjs/websockets` to the root `package.json` so it is always resolved from the root even in production Docker images.

### Changed
- **SocketIOAdapter extracted to its own module**: Moved the `SocketIOAdapter` class from `main.ts` to `apps/api/src/socket-io.adapter.ts` to make it independently testable. Added 8 unit tests covering the `port === 0` Docker shared-server path, the `port !== 0` fallback path, CORS origin configuration from env vars (`CORS_ALLOWED_ORIGINS`, `FRONTEND_URL`), and option merging.

## [0.2.60.0] - 2026-05-29

### Added
- **Aggregated SLO timeseries chart**: Expanding an aggregated SLO row now shows a timeseries graph for the underlying metric. New `GET /test-runs/:id/aggregated-metric-timeseries` endpoint returns 1-minute bucketed values (using `date_trunc` + `approx_percentile`/AVG/error-rate depending on the stat). New `AggregatedSloChart.tsx` component fetches and renders the chart with visibility-gated loading, loading/empty/error states, and a threshold reference line.

### Changed
- **SLO chart analysis-window visualization**: Replaced the single grey ramp-up rectangle with dark semi-transparent excluded-region overlays and amber dashed boundary lines for both the analysis-start and analysis-end offsets in `buildChartLayout`, giving a clearer visual indication of which time ranges are outside the analysis window.

## [0.2.59.15] - 2026-05-29

### Fixed
- **Result column spinner stuck after abort analysis**: `ChecksPipeline.publishRealtimeUpdate` was called inside `withTransaction` callbacks, so the API re-fetched the test run before the transaction committed and saw stale `evaluatingChecks=IN_PROGRESS` state — leaving the spinner permanently stuck. Both publish calls are now placed after their respective `withTransaction` blocks so the API always reads committed state (`consolidatedResult`, `valid`, final `evaluatingChecks`) when it re-fetches on the WebSocket event.

## [0.2.59.13] - 2026-05-28

### Fixed
- **Completion progress bar disappears on WebSocket updates**: The detail view's progress bars now use client-side `calculateProgress()` (based on `start_time` + `planned_duration`) instead of the server-computed `completion_percentage` field, which is `undefined` in WebSocket payloads and was causing the bar to vanish after the first real-time update.
- **Performance analysis auto-refresh never firing during running tests**: The auto-refresh trigger in the performance analysis card switched from `completion_percentage` (always `undefined` from WebSocket events) to `updated_at`, which is always present and changes on every database update, so the card now reliably re-fetches data as a test progresses.

## [0.2.59.12] - 2026-05-28

### Fixed
- **Abort analysis not triggered**: `abortTestRun` now sets `completed = true` on the entity before saving, allowing `TransactionStatsRollupPipeline` to proceed past its `!testRun.completed` guard and run ADAPT analysis on data collected up to the abort point.
- **Performance analysis card not auto-refreshing**: `UpdateTestRunHandler.mapEntityToTestRun` was missing `completion_percentage` in the WS event payload. The `usePerformanceAnalysisData` auto-refresh effect watches this field; without it, running-test WS updates never triggered a data fetch.
- **WS updates not re-rendering detail view after abort**: `abortTestRun` called `repo.save()` directly without emitting a WebSocket event. Injected `TestRunsGateway` into `TestRunsMutationService` and emit `TEST_RUN_UPDATED` after each abort so the detail view updates in real time.

## [0.2.59.10] - 2026-05-28

### Fixed
- Fixed broken `perfana-api` Docker image where `@nestjs/swagger`, `rxjs`, `@nestjs/websockets`, `@nestjs/platform-socket.io`, and 4 other production packages were missing at runtime. Root cause: NestJS v10→v11 upgrade changed npm hoisting so these packages now land in `apps/api/node_modules` instead of root, but the `COPY` for `apps/api/node_modules` had been removed in PR #119. Re-added `COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules` to the `runtime-prep` stage.

## [0.2.59.9] - 2026-05-28

### Fixed
- Fixed Docker CI build failure caused by NestJS v10→v11 upgrade changing npm workspace hoisting: `apps/web/node_modules`, `apps/grafana-sync/node_modules`, `apps/worker/node_modules`, and `apps/perfana-report/node_modules` were no longer created after production reinstall because all deps are now hoisted to root. Added `mkdir -p` in the builder stage to guarantee these directories exist before the `runtime-prep` COPY stage reads them.

## [0.2.59.6] - 2026-05-28

### Fixed
- Bumped `axios` from 1.16.0 → 1.16.1 to fix 3 critical CVEs (prototype pollution, HTTP response splitting) and 10 medium/high CVEs in `apps/api` and root workspace
- Fixed stale `package-lock.json` that was resolving `next` to 15.5.14 despite `^15.5.18` declared in `apps/web/package.json` — now correctly installs 15.5.18, patching 9 high-severity CVEs (auth bypass, SSRF, incorrect authorization, DoS)
- Fixed 6 pre-existing test failures in `test-runs-performance-query.service.spec.ts` where sinceMinutes/orgIds param index assertions were not updated when `endCutoff` was added as a second cutoff parameter

## [0.2.59.3] - 2026-05-27

### Changed
- Bumped `bullmq` from 5.66.5 → 5.77.6 to resolve Snyk vulnerability
- Bumped `uuid` from 11.1.0 → 11.1.1 to resolve Snyk vulnerability
- Bumped `ws` from 8.18.3 → 8.21.0 (root) and 8.19.0 → 8.21.0 (docs-site) to resolve Snyk vulnerability
- Added `ajv@^8.18.0` and `webpack@^5.104.1` npm overrides in root `package.json` to resolve Snyk transitive vulnerabilities
- Added `brace-expansion@^5.0.6` npm override in `docs-site/package.json` to resolve Snyk transitive vulnerability

## [0.2.59.2] - 2026-05-27

### Fixed
- `analysisEndOffset` is now correctly persisted when a test run is **created** via `POST /api/test` — it was included in the DTO but never written to the database because `CreateTestRunHandler` omitted the field from its `testRunData` object
- `POST /api/test` and keepalive responses now include `analysis_end_offset` in the JSON — both handler-level `mapEntityToTestRun` methods were missing the field, so the create and update response bodies never returned it even when the value was stored
- `analysisEndOffset: 0` is no longer silently dropped during test run create/update — the falsy guard `d.analysisEndOffset ?` now uses a null-check so zero is preserved

## [0.2.59.1] - 2026-05-25

### Fixed
- Analysis time range dialog now shows the correct saved offsets on page reload — `analysis_end_offset` was missing from `TestRunsMapperService`, so every GET response omitted it and the dialog always initialized with zero for the end offset

## [0.2.59.0] - 2026-05-25

### Fixed
- Analysis time range save now triggers ADAPT re-analysis automatically, so results update without needing a manual re-evaluation trigger
- After saving a new time range, reopening the dialog reflects the actual saved offsets rather than stale pre-save values (fixed missing `analysisEndOffset` in WebSocket normalizer and object-equality bug in change detection)
- Analysis window display no longer shows "N/A" when the start offset is zero; it now correctly shows "0s"

## [0.2.58.0] - 2026-05-25

### Added

- **Analysis end offset**: A symmetric counterpart to `analysisStartOffset` that excludes a tail period at the end of a test run from all statistical analysis (ADAPT, rollups, Grafana queries). The effective analysis window becomes `[startTime + analysisStartOffset, endTime − analysisEndOffset]`. A value of `0` means no end exclusion (default, backward-compatible).
  - **Database**: new `ramp_down` integer column on `test_runs` (mirrors `ramp_up`); migration backfills existing rows to `0`.
  - **API**: `PUT /test-runs/:id/analysis-time-range` atomically updates both start and end offsets and re-triggers the stats rollup. `GET /test-runs/:id/summary-timeseries` returns time-bucketed throughput, avg response time, and errors/s across the full run for the dialog chart; returns 404 for non-JTL/non-performance-test runs.
  - **Worker**: `TransactionStatsRollupPipeline` applies `endCutoff = endTime − analysisEndOffset` to the `ramp_up_excluded=true` variant. `MetricProcessor`, Grafana collector, and Dynatrace collector mark tail data points as `ramp_up = true`. `MetricsPipeline` ends Grafana API queries at `effectiveEndTime`. `DataSanityCheckPipeline` warns when the combined offsets eliminate the entire analysis window.
  - **UI**: "Analysis Window" row in the test-run timing section replaces the old inline `analysisStartOffset` edit field. A "Change analysis time range" button (hidden for Grafana-only runs) opens a dialog with a Recharts ComposedChart (throughput, avg RT, errors/s) and a MUI dual-handle slider. Moving the handles updates amber reference lines and shaded exclusion zones on the chart in real time.
- **JTL Parallel Controller sub-transaction filtering**: The JTL parser now excludes two categories of Parallel Controller noise by default — sub-requests from PC virtual threads (`threadName == ''`) and PC aggregation container rows (`dataType == ''`). Pass `includeSubTransactions=true` in the multipart upload (or check the new checkbox in the upload dialog) to retain them.

### Fixed

- **Stats rollup**: Pipeline now skips with a warning instead of using wall-clock time when `endTime` is null, preventing silent data corruption for incomplete test runs.
- **Analysis time range dialog chart**: `getSummaryTimeseries` no longer filters `ramp_up = false`, so the chart shows the full test run (including currently-excluded zones) rather than only the current analysis window.
- **DataProcessor (Dynatrace)**: `||` replaced with `??` for `startOffsetSeconds`/`endOffsetSeconds` reads so a zero `analysisEndOffset` is not silently bypassed by the fallback chain.
- **Analysis time range dialog**: `ReferenceArea` excluded zones now snap to the nearest bucket boundary so shaded regions always render at all slider positions, not only at exact bucket edges.
- **"Change analysis time range" button invisible**: `getSummaryTimeseries` queried `AVG(t.mean)` (column does not exist) and only read from `transactions`, so JTL-imported runs received a SQL error and the button never rendered. Fixed by using `AVG(t.response_time)` and adding a `UNION ALL` against `requests_raw`.
- **ADAPT golden file**: Refreshed `adapt-real-golden.json` to match the current pipeline output (950 results, up from the stale 894 captured two months ago).

## [0.2.57.0] - 2026-05-20

### Fixed

- **Aggregated SLO display**: The SLO list in test run analysis now shows a human-readable metric label ("P95 Transaction Response Times") instead of the raw panel title for aggregated SLOs. The requirement column shows a concise expression ("<= 2000 ms") instead of the verbose "Value should <= 2000 ms" form.
- **SUT config SLO table**: The Evaluation column now shows the stat (e.g. `p95`) for aggregated SLOs instead of "N/A". The Source column shows "performance-metrics" for aggregated and Apdex SLOs. The Metric column strips the redundant "(p95)" suffix from aggregated benchmark names since the stat is already visible in Evaluation.
- **Aggregated SLO evaluator**: Switched SQL aggregation queries to use the `response_time` column (was `elapsed`, which does not exist in `requests_raw`/`transactions`). Transaction response time queries now read from the `transactions` table instead of filtering `requests_raw` by `is_transaction`, matching the actual schema. Ramp-up exclusion is applied per query.
- **Aggregated SLO requirement JSON**: The stored requirement object now uses the `value` key (was `threshold`) so the frontend formatter reads it correctly.
- **JTL parser — concurrent thread interleaving**: Corrupted lines produced when multiple JMeter VU threads write to the same JTL file simultaneously are now detected and dropped before CSV parsing. Three patterns caught: odd quote count, a closing quote followed by a non-delimiter character, and wrong number of unquoted commas for the header column count.
- **JTL parser — per-thread transaction labels**: Requests are now assigned to the transaction label seen on the same thread, not the last transaction label seen on any thread. This prevents cross-thread label bleed when VU threads are interleaved by timestamp.
- **Benchmark API response**: The `aggregate_metric` and `aggregate_stat` fields are now included in the benchmark DTO returned by the API, allowing the frontend to render the correct evaluation stat without re-deriving it from the configuration JSON.

## [0.2.56.0] - 2026-05-20

### Added

- **Aggregated Test SLOs**: a new `benchmark_type = 'aggregated'` lets teams define a single pass/fail gate on a metric aggregated across all requests in a test run. Three metrics are supported: `transaction_response_time` (avg/p50/p90/p95/p99/max across all transactions), `request_response_time` (same stat options for HTTP requests), and `error_percentage`. Results appear in `check_results` alongside existing metric and Apdex SLOs and feed into the test run's overall validity.
  - **API**: new `POST /benchmarks/aggregated` and `PUT /benchmarks/aggregated/:id` endpoints accept `aggregate_metric`, `aggregate_stat`, `requirement_operator` (`<=`, `>=`, `<`, `>`), and `requirement_value`.
  - **Worker**: `AggregatedBenchmarkEvaluator` runs a direct SQL aggregation query; `ChecksPipeline` dispatches to it when `benchmark_type = 'aggregated'`.
  - **UI (Performance Analysis menu)**: "Set Aggregated SLO" item opens `AggregatedSloDialog` — a form for choosing metric, stat, operator, and threshold. Pre-populates for editing when an existing aggregated SLO is detected for the test run's workload.
  - **UI (SUT config / SLO tab)**: the "Add SLO" button is now a split dropdown; the second option opens the same aggregated SLO dialog. The SLO table gains a **Type** column with colour-coded chips (`metric` / `apdex` / `aggregated`).
  - **Database**: two nullable columns (`aggregate_metric varchar(50)`, `aggregate_stat varchar(10)`) added to the `benchmarks` table via a new migration.

## [0.2.55.1] - 2026-05-19

### Fixed

- Anomaly detection table: Dashboard, Panel, and Metric columns now wrap their full text rather than truncating to a single line. Values like long span metric names are fully readable without hovering.

## [0.2.55.0] - 2026-05-19

### Fixed

- Anomaly detection table: Dashboard, Panel, and Metric column text no longer overflows into adjacent columns. Long values are now truncated with an ellipsis and revealed in full on hover via a tooltip.

## [0.2.54.0] - 2026-05-17

### Fixed

- **ADAPT shows accurate message for test runs with no steady-state data**: when the analysis start offset (ramp-up) equals or exceeds the test duration, ADAPT now reports that the *current* run is too short to analyze — including the exact ramp-up and duration in seconds — instead of incorrectly blaming the baseline/control runs. Previously, placeholder metric rows written for these runs caused a false "empty control group" classification, producing a misleading message that the baseline runs contained insufficient metrics.

## [0.2.53.1] - 2026-05-17

### Fixed

- **Abort triggers ADAPT analysis**: aborting a test run from the UI now enqueues an ADAPT analysis job for the data collected up to the abort point, matching the behaviour of a normal test completion. Previously the abort endpoint set `abort=true` and saved but never triggered analysis, leaving aborted runs without check results.

## [0.2.53.0] - 2026-05-17

### Added

- **Abort running test run**: operators can now abort an in-progress test run directly from the test run list (icon button) or the test run detail header (outlined button). Clicking either opens a confirmation dialog; on confirm, `PATCH /test-runs/:id/abort` sets `abort=true` and records `abortMessage` with the triggering user's identity. The endpoint enforces access control, rejects requests for already-completed or already-aborted runs with HTTP 400, and writes an audit event. A race-condition fix ensures that subsequent agent heartbeats (`PUT /test`) can never silently clear the abort flag once it has been set.

### Fixed

- **Abort flag preserved across agent heartbeats**: the test-run update handler previously used `data.abort || false`, which caused any agent heartbeat without an explicit `abort: true` payload to overwrite an operator-set abort flag back to `false`. The handler now uses `data.abort === true ? true : (before?.abort ?? false)`, preserving the existing DB value when the incoming payload does not explicitly request an abort.

## [0.2.52.0] - 2026-05-17

### Fixed

- **MCP `get_adapt_results`**: tool no longer throws "Unexpected end of JSON input" when the Adapt conclusion endpoint returns an empty body; the HTTP client now reads the response as text first and emits a clear error describing the status code and path
- **Adapt controller**: `GET /adapt/conclusion/:testRunId` and `GET /adapt/conclusion/:testRunId/enriched` now return HTTP 404 (with a descriptive message) instead of HTTP 200 with an empty body when no conclusion exists for the given test run
- **RLS transaction interceptor**: API key requests now pass the correct role set into the Postgres GUC (`app.current_user_roles`); previously the interceptor always read from `req.user.roles` which is `undefined` for API key auth, silently setting an empty roles array
- **Audit context interceptor**: API key requests now populate the per-request CLS store (`REQ_CTX`) using the API key's own user ID, making the RLS transaction interceptor reachable for API key auth; also normalises the `keycloak-jwt` auth type to `keycloak` so the stored value always matches the declared `RequestContextStore` union type

## [0.2.51.3] - 2026-05-16

### Fixed

- **ADAPT regression confirmation now correctly sets test run to FAILED** — when a user confirmed a regression by setting `differencesAccepted = 'DENIED'`, the worker's status-updater SQL preserved the previous `overall` value for both `ACCEPTED` and `DENIED` states. This meant that denying a regression left `overall = true` even though `adaptTestRunOK` was correctly set to `false`. Fix: the SQL now only locks `overall` when the user explicitly accepted differences (`ACCEPTED`); for `DENIED` and `TBD` (pending) states it always recalculates from the current ADAPT findings so `adaptTestRunOK = false` propagates to `overall`. The API handler for updating adapt config also now explicitly sets `adaptTestRunOK = false` and `overall = false` for the `DENIED` case, ensuring the immediate API response is consistent.

## [0.2.51.2] - 2026-05-16

### Fixed

- **Re-evaluation jobs no longer hang when a test is actively running** — resolving a tracked regression or marking/removing a changepoint could trigger a BullMQ re-evaluation batch that included currently-running tests. The Checks and ADAPT pipeline stages cannot handle in-progress tests (no completion state), causing the orchestration worker to block until the 10-minute timeout. The four query sites in `TestRunsChangepointService` now filter for finished tests only: `completed = true` (normal end) OR `abort = true` (aborted end). Actively-running tests (`completed = false, abort = false`) are excluded from all re-evaluation batches.

## [0.2.51.1] - 2026-05-16

### Fixed

- **Dynatrace metric series now populate after incremental storage** — selecting a Dynatrace dashboard panel in the Graphs card showed an empty metric series dropdown unless a full force re-fetch had previously run. Root cause: the incremental collector omitted `metrics_source_id` from its SQL query, query config, and result mapping, so `ds_metrics` rows were written with `metrics_source_id = NULL`. The `/metrics/ds-metrics/distinct-names` endpoint queries by `metrics_source_id`, returning zero rows until a force re-fetch filled in the value.
- **Dynatrace verbose log noise reduced** — raw Metrics API v2 response body and per-metric data point counts now log at `debug` instead of `info`, keeping worker logs clean during normal operation.

## [0.2.51.0] - 2026-05-16

### Added

- **Dynatrace panels now stored in `ds_panels` during `PanelsPipeline`** — the pipeline previously wrote only Grafana panel records to `ds_panels`; Dynatrace tiles were silently skipped. The pipeline now reads `dynatrace_queries` for the test run's SUT/environment/workload and inserts a panel record per tile (with `datasource_type = 'dynatrace'`), making Dynatrace panels visible in the UI and available to ADAPT checks.
- **Scheduler log noise reduced** — non-Grafana dashboards that route through the separate `dynatrace_queries` path now log at `debug` instead of `warn`, removing misleading "not yet supported" warnings from normal operation.

## [0.2.50.1] - 2026-05-15

### Fixed

- Dynatrace metric query creation no longer violates the `organization_id NOT NULL` constraint on `metrics_sources` — `ensureMetricsSourceExists` was upserting without `organizationId`, causing the entire `createEntityMapping` transaction to roll back. The method now accepts `organizationId` as a required parameter and all three call sites (`createQuery`, `createQueryWithSharedUuid`, `bulkCreateQueryWithSharedUuid`) resolve and pass it through.

## [0.2.50.0] - 2026-05-15

### Fixed

- Dynatrace HOST entity metric queries now create successfully — `ensureArtificialDashboardExists` was inserting rows into `grafana_dashboards` and `application_dashboards` without `organization_id`, violating the NOT NULL constraint (Phase 4 RBAC). The function now accepts `organizationId` as a required parameter and propagates it through all four call sites.
- `createHostMetricQueries` now enforces authorization via `requireDynatraceMutationCapability` before creating resources; the call was previously missing, leaving that code path without an auth check.

## [0.2.49.1] - 2026-05-15

### Changed
- **ESLint rules promoted from warnings to errors** — all 11 existing rules now exit non-zero on violation, creating a hard lint gate on push. Added `react-hooks/exhaustive-deps` as an error rule to enforce correct hook dependency arrays.
- **27 existing lint warnings resolved** — removed unused imports across 13 files, replaced `any` types with precise inline types, wrapped `loadDashboards` (GrafanaDashboardsTable) and `fetchTeamSystems` (TeamSystemsTab) in `useCallback` for hook dependency correctness, and escaped unescaped JSX quotes.

## [0.2.49.0] - 2026-05-15

### Changed
- **Anomaly detection filter dropdowns now use faceted filtering** — each dropdown only shows values present in items that match all currently active filters. Selecting a dashboard no longer shows panels from unrelated dashboards; selecting a conclusion no longer shows classifications that have no results for that conclusion. This eliminates "ghost" filter options that would produce empty result sets.
- **"Clear All Filters" button added to anomaly detection** — a single button resets the search query, conclusion, classification, dashboard, and panel filters simultaneously. The button is disabled when no filters are active, giving users a clear visual signal of filter state.

## [0.2.48.5] - 2026-05-14

### Fixed
- **Grafana 13 compatibility: datasource proxy URLs migrated from numeric ID to UID** — `GrafanaClientService` was calling `/api/datasources/proxy/{numericId}/` for InfluxDB and Prometheus variable resolution. Grafana 13 disables numeric-ID datasource APIs by default (`datasourceLegacyIdApi` feature flag off). All three call sites switched to `/api/datasources/proxy/uid/{uid}/`, which works in Grafana 8+ including Grafana 12 and 13.
- **Grafana 13 compatibility: `folderId` → `folderUid` in dashboard create/restore payloads** — `POST /api/dashboards/db` dropped support for the numeric `folderId` field in Grafana 13. `GrafanaApiService.createOrFindFolder()` now returns `{ id, uid }` instead of a bare number; auto-config dashboard creation (`dashboard-processor.service.ts`) and dashboard restore (`restore-dashboard.service.ts`) send both `folderId` and `folderUid` for full Grafana 12/13 compatibility.
- **`ConsolidatedSchema` migration now succeeds on fresh databases** — the schema dump captured `ALTER DEFAULT PRIVILEGES … TO perfana_app/perfana_system` statements from a live DB that already had those roles. These slipped past the existing `GRANT … TO perfana_app` filter (which only matched statements starting with `GRANT`) and failed during Phase 1 before Phase 2 created the roles. A second filter clause now strips `ALTER DEFAULT PRIVILEGES … TO perfana_app/perfana_system` from Phase 1; Phase 2 re-applies the same grants after role creation.

## [0.2.48.4] - 2026-05-14

### Fixed
- **`application_dashboards.dashboard_id` and `benchmarks.dashboard_id` widened to `bigint`** — Grafana 12 returns dashboard IDs above the PostgreSQL `integer` max (2,147,483,647). The `ChangeGrafanaIdToBigint` migration that fixed `grafana_dashboards.grafana_id` missed these two columns. `benchmarks_view` (which selects `dashboard_id`) was dropped and recreated around the `ALTER TABLE`. The `migrate_benchmark_from_mongodb` function signature updated to `bigint` for consistency. ConsolidatedSchema `schema-sql.ts` updated so fresh-DB installs are correct from day one.

## [0.2.48.3] - 2026-05-14

### Changed
- **Migration consolidation: 59 TypeORM migrations → 1 `ConsolidatedSchema`.** All migrations from `1700000000000` to `1779100000000` are replaced by a single `ConsolidatedSchema1700000000000` migration. The migration is structured in five phases: (1) execute the full pg_dump schema SQL, (2) create the `perfana_app`/`perfana_system` cluster roles, (3) seed the default organization, (4) create TimescaleDB hypertables, (5) create continuous aggregates with refresh policies. Idempotent via `IF NOT EXISTS` / `IF EXISTS` guards and ALREADY_EXISTS_CODES error suppression throughout. Fresh-DB smoke test validated: 93 tables, clean diff.
- **`scripts/dump-schema.sh` added** for regenerating `schema-sql.ts` from a running Postgres container. Uses Python internally to avoid shell heredoc expansion of PostgreSQL `$1`/`$2` parameter refs and `$$` function body delimiters that would corrupt the TypeScript template literal.
- **`ALREADY_EXISTS_CODES` extracted as a static class constant** in `ConsolidatedSchema1700000000000` — eliminates duplication between the Phase 1 schema loop and the Phase 5 CAGG creation loop.
- **`down()` table list completed** — added 7 tables present in the live schema that were missing (`alert_tag_filters`, `metrics_sources`, `scaling_sessions`, `sparse_metric_exclusions`, `test_run_sampler_stats`, `test_run_transaction_stats`, `test_run_views`); removed stale `compare_results` entry.

## [0.2.48.2] - 2026-05-14

### Fixed
- **Removed unused `PyroscopeViewMode` enum members** (`SINGLE`, `DIFF`) and `PyroscopeTheme.LIGHT` — only `COMPARISON` and `DARK` are actually referenced. Eliminates dead enum branches that lint would eventually flag.
- **Audit capabilities test aligned to current `AuditCapabilities` type** — added `isSuperAdmin: false` to the expected shape so the test reflects the actual interface rather than an outdated subset.
- **gstack tooling upgraded from v1.34.1.0 → v1.34.2.0** — fixes `/codex review` breakage on Codex CLI 0.130+, silent `/investigate` learning drops, and `/sync-gbrain` engine detection for Supabase backends.

## [0.2.48.1] - 2026-05-14

### Changed
- **Frontend & API type safety: eliminated all `no-explicit-any` ESLint warnings across web and API apps.** Replaced 116 web and additional API `any` usages with precise types: Plotly callbacks use `unknown` + inline casts instead of `any`-typed parameters; MUI Select handlers use structural event types to avoid generic inference conflicts; `setDynatraceMetrics` now typed as `React.Dispatch<React.SetStateAction<DynatraceMetric[]>>`; `RecentFailure.consolidated_result` typed with its actual shape; dynamic `next/dynamic` component casts use `as unknown as` to bypass `Parameters<T>` constraint; `window` Plotly extension uses double-cast to avoid non-overlapping type error. API service files (adapt, benchmarks, compare-presets, dynatrace, grafana, metrics, provisioning, test-runs) similarly converted from `any` to `unknown` + targeted casts. Zero `eslint-disable` comments added.
- **`TestRun` entity: `reasonsNotValid` and `dataWarnings` now typed `string[] | null`** to match the nullable DB columns. `DataSanityCheckPipeline` assigns `null` (not `undefined`) when clearing these fields so TypeORM issues a SQL `NULL` rather than silently skipping the column. API mappers coerce `null → undefined` at the DTO boundary with `?? undefined`.

## [0.2.48.0] - 2026-05-14

### Changed
- **Worker type safety: replaced `any` with `unknown` across all pipeline code.** The `Pipeline` interface, `BasePipelineTypeORM`, and all 25+ pipeline implementations now use `unknown` instead of `any` for `execute()` and `validateInput()` inputs. SQL query result row fields are explicitly cast at the point of use rather than silently typed as `any`. This eliminates 200+ lint warnings and makes type violations visible at compile time rather than at runtime.
- **BullMQ Worker options aligned to current API.** `blockingConnection` (which changed from a Redis instance to `boolean` in newer BullMQ) and `drainDelay` (which moved from `settings` to a top-level option) are now correctly typed.

### Fixed
- **Grafana-sync circular dependency in `auto-config.service.spec.ts` eliminated.** The `@InjectRepository(AuditLog)` decorator in `grafana-sync-audit.service.ts` was executing at import time and triggering a circular import chain. The spec now mocks the audit service before any import resolves, making all 18 tests pass.
- **Unused `MutationCommandType` enum members removed** from `apps/api` (`ABORT_TEST_RUN`, `INIT_TEST_RUN`, `UPDATE_RUNNING_TEST`, `UPDATE_TEST_STATUS`). Only the three members actually referenced in command files are kept.
- **`markCollectionComplete` test corrected** to match the actual `TimeRange` type (`from/to` are `Date` objects, not ISO strings).

## [0.2.47.102] - 2026-05-13

### Fixed
- **`POST /api/tracing-services` no longer fails with a 500 RLS violation.** The endpoint was always returning HTTP 500 (`new row violates row-level security policy for table "tracing_services"`, PG error 42501) because `organization_id` was never set before the INSERT — the database received `DEFAULT` which resolves to `NULL`, and the RLS policy fails closed on `NULL`. The fix looks up the System Under Test by `systemUnderTestId` and derives `organization_id` from the SUT record; callers do not need to supply it. Fixes [#329](https://github.com/perfana/perfana/issues/329). **Files:** `apps/api/src/modules/tracing-services/tracing-services.service.ts`, `apps/api/src/modules/tracing-services/tracing-services.module.ts`.

## [0.2.47.101] - 2026-05-12

### Fixed
- **Test run list now shows the actual test start time instead of the import timestamp.** The "Start" column in the test runs table was reading `created_at` (the database row creation time) instead of `start_time` (the actual test start from the load tool). For JTL imports this caused the list to show the time of upload while the test run detail page correctly showed the real start time from the JTL data.
- **Apdex rollup: guard `approx_percentile_rank` against NaN when threshold equals tdigest maximum.** When an Apdex threshold was set to exactly the highest observed response time, TimescaleDB's `approx_percentile_rank` returned `NaN` instead of `1.0`. The subsequent `ROUND(NaN × count)::bigint` threw `"bigint out of range"`, aborting the Postgres transaction and wiping every check result for the test run — the UI showed "Not Configured" and the run was incorrectly excluded from ADAPT control groups. The fix introduces a `ranks` CTE that wraps both `approx_percentile_rank` calls in `COALESCE(NULLIF(…, 'NaN'::double precision), 1.0)` (threshold ≥ max means 100 % satisfied → 1.0 is semantically correct). A second defensive fix wraps each per-named-transaction iteration in `evaluateWorkloadLevelApdex` with `SAVEPOINT` / `RELEASE SAVEPOINT` / `ROLLBACK TO SAVEPOINT` so that any future fatal Postgres error on one transaction does not abort the pipeline for the remaining transactions. Fixes [#326](https://github.com/perfana/perfana/issues/326). **Files:** `apps/worker/src/pipelines/checks/ApdexCalculator.ts`.

## [0.2.47.100] - 2026-05-12

### Fixed
- **Expanded test run info card now shows the ADAPT conclusion message instead of the generic fallback when no baselines exist.** When `evaluatingAdapt === 'NO_BASELINES_FOUND'`, the Anomaly Detection subsection in the expanded info card (`EvaluationResultsSection`) was always displaying the hardcoded string "No previous results to compare with" — even when the `/adapt/conclusion/{testRunId}` endpoint returned a `details.message` (e.g. "Insufficient data to run ADAPT analysis"). The collapsed card (`AnomalyDetectionCollapsedCard`) had already been fixed in [#319](https://github.com/perfana/perfana/issues/319) to read `dsAdaptConclusion?.details?.message`, but the fix was not applied to the expanded path. The `AnomalyDetectionSubsection` component in `EvaluationResultsSection` now fetches the ADAPT conclusion on mount (guarded by the `NO_BASELINES_FOUND` condition) and surfaces `details.message` with the same fallback string as the collapsed card. Fixes [#324](https://github.com/perfana/perfana/issues/324). **Files:** `apps/web/app/test-runs/[id]/components/test-run-details/components/EvaluationResultsSection.tsx` (29 lines), `apps/web/__tests__/app/test-runs/test-run-details/TestRunDetailsCard.test.tsx` (4 lines, 2 new tests).

## [0.2.47.99] - 2026-05-12

### Fixed
- **Docker arm64 builds: use `--platform=$BUILDPLATFORM` on build stages to prevent QEMU SIGILL crash.** `npm ci` running under QEMU arm64 emulation crashes with `Illegal instruction` (SIGILL, exit 132) because Node.js 20's V8 engine uses CPU instructions that QEMU cannot emulate. Build stages (`security-base`, `deps`, `build-deps`, `source`, `builder` in `Dockerfile`; `builder` in `Dockerfile.migrations`) now pin to `$BUILDPLATFORM` so npm and tsc run natively on the amd64 CI runner. Final runtime stages (distroless, Alpine) remain unplatformed and are assembled for the target architecture by buildx. The compiled TypeScript output is pure JS with no native addons, so building on amd64 and running on arm64 is correct. **Files:** `Dockerfile` (5 lines), `Dockerfile.migrations` (1 line).

## [0.2.47.98] - 2026-05-12

### Changed
- **Docker builds now target `linux/amd64,linux/arm64` (multi-arch).** All six build jobs in the GitHub Actions workflow (`web`, `api`, `worker`, `grafana-sync`, `perfana-report`, `migration`) now produce multi-platform images via QEMU emulation on `ubuntu-latest` runners. The build summary step reflects both platforms. **Files:** `.github/workflows/docker-build.yml` (7 lines changed).

## [0.2.47.97] - 2026-05-12

### Fixed
- **`check_results.meets_requirement` now correctly writes `false` (not `NULL`) when an Apdex benchmark returns `NO_DATA` with `validate_with_default_if_no_data = false`.** The three NO_DATA return paths in `ApdexCalculator` — (1) no transactions found for a named transaction, (2) no transactions at all for workload-level, (3) all transactions have zero count for workload-level — previously returned `meets_requirement: null`. `updateConsolidatedResult` uses `COALESCE(meets_requirement, true)`, so NULL was silently treated as passing, causing short runs with no transaction data to pollute ADAPT control groups as if they had passed all checks. The fix is three one-line changes (`null → false`) in `ApdexCalculator.ts`. Note: `validate_with_default_if_no_data` is hardcoded to `false` for all Apdex results in `ChecksPipeline.saveApdexCheckResult`, so the default-value fallback path is never reached for Apdex — the `false` return is always the correct outcome. Three existing unit tests updated to assert `false` instead of `null`; 1350 worker tests pass. Fixes [#320](https://github.com/perfana/perfana/issues/320). **Files:** `apps/worker/src/pipelines/checks/ApdexCalculator.ts` (3 lines), `apps/worker/src/test/unit/pipelines/checks/ApdexCalculator.test.ts` (6 lines).

## [0.2.47.95] - 2026-05-10

### Documentation
- **Rewrote `docs-site/content/Features/RBAC.md` as the canonical RBAC reference.** The previous file was a phase-1 stub from before capabilities, owned-resources, and `restrict_to_team_members` shipped — the role table listed `org_admin` / `team_admin` (underscore form, never used in code) and made no mention of capabilities, the resource model, or team visibility rules. New doc derives every fact from source: `apps/api/src/constants/roles.constants.ts` (system / org / team role enums), `apps/api/src/constants/capabilities.constants.ts` (full capability catalog + role→capability map), `apps/api/src/common/services/authorization.service.ts` (the 7-step decision flow, `canAccessResource` / `canModifyResource` / `canViewTeamResources` / `canAdministerAnyOrganization` entrypoints, Redis cache + invalidation), `packages/shared/src/entities/owned-resource.interface.ts` (the four ownership columns), `packages/shared/src/entities/team.entity.ts` (the `restrict_to_team_members` flag), and the actual SQL filter clauses in `apps/api/src/modules/test-runs/services/test-runs-crud-query.service.ts` + `apps/api/src/modules/systems-under-test/systems-under-test.service.ts`. Sections: identity (JWT vs api-key principals), role hierarchy (3 scopes), authorization model (the global-admin → owner → org-admin → org-member → team-admin → team-member → deny order), `OwnedResource` columns + the camelCase pitfall, capability catalog with all 33 strings, role→capability matrix across all 7 roles, resource→action matrix for ~25 user-facing resources with required role per List/Read/Create/Update/Delete, team `restrict_to_team_members` rules with a worked Acme example showing what 5 different principals can see/do across restricted "Payments" + open "Catalog" teams, caching behavior, and phase status synced with `CLAUDE.md`. **Files:** `docs-site/content/Features/RBAC.md` (354 lines changed, 271 insertions / 83 deletions). No code change.

## [0.2.47.94] - 2026-05-09

### Changed
- **Performance Analysis card: live Apdex auto-refresh replaced with a manual "Refresh metrics" button.** During a running test, the card was re-fetching transactions, virtual-user stats, and throughput stats on every realtime entity update (which fires whenever the worker writes to the test_run row — frequently). Each refresh briefly flipped `loading=true`, which the UI used to gate the spinner branch — meaning the table and `OverallTestMetrics` would unmount, show a CircularProgress, then remount with new numbers. The result was a constant flash on the page during a live test, plus the surprise of the user's view jumping under their cursor. The fix has three parts: (1) The `realtimeTrigger` auto-refetch effect in `usePerformanceAnalysisData.ts` is gone — the prop is dropped from the hook's interface and its plumbing is removed all the way back through `PerformanceAnalysisCard.tsx`, the page-level destructure in `apps/web/app/test-runs/[id]/page.tsx`, and `useTestRunData.ts` (whose realtime subscription still updates the `testRun` entity for the rest of the page; only the trigger counter is dead-coded out). (2) A new IconButton (Refresh icon, MUI Tooltip "Refresh metrics") sits next to the LiveWindowSelector when the card is expanded and the test is running, calls `refreshAll`, shows a CircularProgress spinner and disables itself while the fetch is in flight. (3) The card-level loading gates are softened so refreshes update numbers in place rather than swapping the table for a spinner: the spinner branch now fires only on `loading && transactions.length === 0` (first load with no data yet), and the `OverallTestMetrics` block drops its `!loading` precondition so the metrics card stays mounted across refreshes — React reconciliation keeps row DOM nodes alive via the existing stable `transaction_name` keys, so the user sees Apdex, p95, p99, total_count cells transition to new values rather than the whole card flashing. **Side effect** (intentional cleanup, while-we're-here): the live-controls Box was anchored at `right: 48` overlapping the Apdex-options menu also at `right: 48` — both rendered together when expanded && isRunning. Moved the live-controls flex group to `right: 96` so the Apdex menu is now actually visible during a live test. **Files:** `apps/web/app/test-runs/[id]/components/performance-analysis/PerformanceAnalysisCard.tsx` (RefreshIcon import + button + softened loading gates + right:96 anchor), `apps/web/app/test-runs/[id]/components/performance-analysis/hooks/usePerformanceAnalysisData.ts` (removed `realtimeTrigger` prop + auto-refetch effect; rollup-pending 5s poll preserved — that's a separate gate for the post-test rollup catch-up), `apps/web/app/test-runs/[id]/hooks/useTestRunData.ts` (removed the dead `realtimeTrigger` state + return field + JSDoc; realtime subscription + `setTestRun` flow preserved), `apps/web/app/test-runs/[id]/page.tsx` (removed unused destructure + JSX prop). **Verification:** 64/64 jest tests pass on perf-analysis + useTestRunData; type-check + lint clean across all 8 packages; `grep -rEn 'realtimeTrigger' apps/web` returns zero references. **Out of scope:** the rollup-pending 5s poll (separate effect, fires only when the API returns 202 and stops as soon as the rollup finishes) and the realtime test-run entity subscription (drives status badge, completion banner, etc. on the rest of the page) are both preserved — only the per-realtime-tick refetch of the perf-analysis card's data was removed.

## [0.2.47.93] - 2026-05-09

### Security
- **Deleted dead `RealtimeGateway` (`/realtime` Socket.IO namespace) closing a cross-tenant IDOR — /cso 2026-05-09 finding #1, HIGH 9/10.** Investigation: the audit flagged that `apps/api/src/modules/realtime/realtime.gateway.ts:137` accepted `subscribe_test_run` / `subscribe_test_runs` events from any authenticated user without checking that the requested testRunId belonged to the user's organization. The handler invoked `realtimeService.getTestRunDetails()` / `getInitialTestRuns()` which called `testRunRepository.findByTestRunId` / `findAllWithSystem` with NO org filter. The sibling `TestRunsGateway` at `/test-runs` DOES enforce this check (`test-runs.gateway.ts:240-254`), so the question was: port the org check, or delete? Code-tracing (frontend `apps/web/lib/socket.ts:106` connects only to `/test-runs`; events emitted by the frontend use snake_case names that match `RealtimeGateway`'s handlers BUT are sent to the `/test-runs` namespace where they get silently dropped — `TestRunsGateway` registers only `subscribe:test-run` / `unsubscribe:test-run` kebab-with-colon variants; `socketManager` consumers `useTestRunRealtime.ts` and `useRealtime.ts` rely on the auto-room-join in `TestRunsGateway.handleConnection` lines 177-200 plus the worker → Redis → `RealtimeService` → `TestRunsGateway` fan-out path) confirmed `RealtimeGateway` has zero live consumers — frontend never connects to `/realtime`, worker publishes via the shared `RealtimePublisherService` → Redis channels which `RealtimeService` (the API-side bridge, NOT this gateway) subscribes to and forwards to `TestRunsGateway`. Porting the org check would have added maintenance burden on a parallel namespace nobody uses; deletion eliminates the IDOR with zero behavior change. **Files:** `apps/api/src/modules/realtime/realtime.gateway.ts` deleted; `apps/api/src/modules/realtime/realtime.module.ts` edited to remove the import + provider entry (`RealtimeService` export preserved — it's the load-bearing Redis subscriber bridge that forwards to `TestRunsGateway`). **Verification:** `apps/api` jest suite 4543/4543 passing (no test exercised `RealtimeGateway` directly); type-check + lint clean across all 8 packages; `grep -rEn '/realtime' apps/web` confirms zero frontend client refs to the deleted namespace. The disabled regression test at `apps/api/src/test/regression/realtime.test.ts.disabled` doesn't reference `RealtimeGateway` and is left alone (already disabled).

## [0.2.47.92] - 2026-05-09

### Security
- **All third-party `docker/*` GitHub Actions now SHA-pinned across `docker-build.yml` and `pr-quality-gate.yml`.** Closes /cso 2026-05-09 finding #3 (HIGH 9/10). The image-publish workflow runs on push-to-main with `packages: write` and uses `secrets.DOCKER_TOKEN` to log into the registry; before this change, every `docker/*` action was pinned to a floating major tag (`@v3` / `@v5`), and the inline TODO comments acknowledged the gap. A compromise of the docker org or any of its action maintainers' tokens (cf. tj-actions/changed-files Mar 2025) would have let an attacker republish v3/v5 with a malicious post-step that exfiltrates `DOCKER_TOKEN` and publishes backdoored `perfana/perfana-{api,web,worker,grafana-sync,migration}` images to every prod cluster on the next pull. SHA-pinning narrows the trust boundary from "the docker org continues to be honest" to "this exact tree of source code is the build dependency" — re-publish of the same tag onto a different commit cannot move the pin. **Files:** `.github/workflows/docker-build.yml` (30 sites: 6× `docker/setup-qemu-action`, 6× `docker/setup-buildx-action`, 6× `docker/login-action`, 6× `docker/metadata-action`, 6× `docker/build-push-action`); `.github/workflows/pr-quality-gate.yml` (3 sites of `docker/setup-buildx-action`). 33 sites total. SHAs resolved via `gh api repos/docker/<action>/commits/<tag> --jq '.sha'`: `setup-qemu-action@c7c53464625b32c7a7e944ae62b3e17d2b600130 # v3`, `setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f # v3`, `login-action@c94ce9fb468520275223c153574b00df6fe4bcc9 # v3`, `metadata-action@c299e40c65443455700f0fdfc63efafe5b349051 # v5`, `build-push-action@ca052bb54ab0790a636c9b5f226502c73d547a25 # v5`. Format follows the existing repo precedent (`anthropics/claude-code-action@<sha> # v1`, `codecov/codecov-action@<sha> # v4`) — keeps the human-readable version visible in `git blame`. **Out of scope (deferred to follow-up):** first-party `actions/*` references in `docs.yml`, `pr-quality-gate.yml`, `docker-build.yml`, `claude-review.yml` are still tag-pinned (finding #6, MEDIUM 9/10 — defense-in-depth; first-party tag compromise is rare but documented). **Verification:** `grep 'uses:\s*docker/' .github/workflows/*.yml | grep -v '@[a-f0-9]\{40\}'` returns empty; YAML still parses cleanly.

## [0.2.47.91] - 2026-05-09

### Security
- **axios bumped from 1.15.0 → 1.16.0 to clear 13 advisories.** /cso security audit (2026-05-09) flagged axios as the highest-priority finding: 13 active advisories on the installed range, including GHSA-pmwg-cvhr-8vh7 (NO_PROXY bypass via 127.0.0.0/8 loopback subnet, CVSS 7.2 — SSRF), GHSA-w9j2-pvgh-6h63 (auth bypass via prototype-pollution `validateStatus` merge gadget), GHSA-3w6x-2g7m-8v23 (invisible JSON response tampering via `parseReviver` prototype pollution gadget), GHSA-q8qp-cvcw-x6jj (prototype-pollution credential injection, CVSS 7.4), GHSA-62hf-57xw-28j9 (toFormData unbounded recursion DoS, CVSS 7.5), plus 8 more. Vulnerable range was `>=1.0.0 <1.15.1` for several of these — the patched ceiling is 1.15.1+ but per-advisory varies, so bumped to the current latest 1.16.0 to clear the entire set in one shot. axios is used server-side in the API for upstream Grafana, Dynatrace, and Prometheus calls (`apps/api/src/modules/dynatrace/dynatrace.service.ts`, `apps/api/src/modules/test-runs/services/test-runs-data-sources.service.ts`, `apps/api/src/modules/auth/auth.controller.ts`); SSRF and credential-leak gadgets in this role are directly reachable from any authenticated user who can configure a metrics source URL. **Files:** `package.json` (root `dependencies.axios` and `overrides.axios` both bumped — the override is what forces the hoisted resolution; without it, the workspace bump alone left `node_modules/axios` on 1.15.0 while only `apps/api/node_modules/axios` got 1.16.0); `apps/api/package.json` (`dependencies.axios` bumped); `package-lock.json` (regenerated). **Tests:** 4414/4434 passing on `apps/api` (20 skipped, 0 failed) — full suite excluding RLS + phase5-migration-validation (both blocked by no local postgres on :5432). Lint + type-check clean across all 8 packages. **Audit:** `npm audit --json | jq '.vulnerabilities.axios'` → no advisories on axios after the bump (was 13 before). **No code change required:** the three call sites use standard `axios.get/post/request` patterns + the `AxiosResponse` typedef — covered by 1.x semver guarantees, no migration shim needed.

## [0.2.47.90] - 2026-05-09

### Fixed
- **Error Analysis tabs no longer scan `requests_raw` for live (in-flight) tests — closes #304.** `getTransactionErrors`'s `sampler_stats` CTE used a 2-arm switch from #287: rollup table for completed runs (~µs) or a `FROM requests_raw rr` scan for everything else (~38 s on populated TimescaleDB). For an in-flight run the rollup table is empty by definition, so opening Error Analysis on a SUT with ≥1M requests fell straight into the legacy raw scan. PR #305 (v0.2.47.88) introduced the live-Apdex CAGG family (`requests_raw_5s` + `requests_raw_passed_5s`) and a `loadCaggApdexScope` helper; this PR plugs that family into `getTransactionErrors`. Replaced the 2-arm switch with a 3-arm switch — rollup → CAGG → raw — that mirrors `getTransactionSamples`'s gating logic from #305: the rollup arm still wins for completed runs, the new CAGG arm fires when `loadCaggApdexScope().hasRequestsRawCagg` reports the run window has CAGG buckets (the in-flight case), and the legacy raw scan is preserved as a last-resort fallback for the rare CAGG-empty case (no historical regression). The CAGG arm computes `total_count` via `SUM(c.n)` and `apdex_score` via `approx_percentile_rank` on `rollup(p.pct_agg_passed)` over the success-filtered sketch (post-#298), uses the same 7-key bucket join (`bucket`, `system_under_test`, `test_environment`, `scenario_name IS NOT DISTINCT FROM`, `sampler_name`, `transaction_name`, `location IS NOT DISTINCT FROM`) `getTransactionSamplesFromCagg` uses to avoid duplicate rows, threads the existing optional `transactionName` / `samplerName` filters into the CAGG WHERE clause, applies the ramp-up cutoff via `time_bucket('5 seconds', cutoffTime)` on `c.bucket`, and groups by `c.sampler_name, tc.active_threshold` (Postgres 42803 — `tc.active_threshold` is referenced inside `approx_percentile_rank` outside aggregates and must appear in GROUP BY). The `threshold_config` CTE is unchanged across all three arms — keyed on `sut.id` UUID for cross-org safety, identical resolution logic. **Out of scope (per the issue):** the `error_groups` CTE still scans `requests_error` since no CAGG carries the per-row `response_message` / `sample_response_data` / `url` / `sample_url` columns the errors view depends on, and `requests_error` cardinality is bounded by error count anyway. **Files:** `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts` (3-arm gate replaces 2-arm `useSamplerRollup` boolean — `caggScope` lookup is skipped entirely on the rollup-hit short circuit so completed runs pay zero extra DB cost; six new CAGG-arm parameter slots threaded after the existing rollup `ramp_up_excluded` slot but before the `orgIds` tail so the org-filter parameter index computation stays correct). **Tests:** 137 → 143 passing on `test-runs-performance-query.service.spec.ts` — six new tests under `getTransactionErrors > SQL structure > CAGG arm (#304)`: SQL-shape regressions (`FROM requests_raw_5s c`, `JOIN requests_raw_passed_5s p`, `rollup(p.pct_agg_passed)`, 7-key join shape, GROUP BY contains `tc.active_threshold`, `wat.system_under_test_id = sut.id` cross-org safety), transaction filter binds against `c.transaction_name = $2`, sampler filter binds against `c.sampler_name = $3` (correct positional index when `transactionName` is set), `orgIds` stays last for non-admin callers (six CAGG params inserted before it without breaking the org-filter `$N::uuid[]` slot), rollup hit short-circuits before `loadCaggApdexScope` is called (perf assertion + spy not called), CAGG-empty falls through to legacy raw scan. Existing fall-back-to-raw test extended to assert the CAGG JOIN is *not* present when no scope data. **No migration:** reuses migration `1779100000000` from #305. **Projected impact:** Error Analysis on populated in-flight runs ~38 s → <1 s, matching the live-Apdex card's UX from #305.

## [0.2.47.89] - 2026-05-09

### Changed
- **Live sampler `url_hash` / `url_pattern` accepted as `null` during the in-flight window — closes #303.** PR #305 (v0.2.47.88) routed `getTransactionSamples` through `requests_raw_5s` + `requests_raw_passed_5s` for live (running-test) and rollup-pending windows, and the CAGG GROUP BY does not include `url_hash` — so the helper returns `url_hash: null` / `url_pattern: null` for every sampler served from the fast path. Considered three options: (A) add `url_hash` to the new CAGG family's GROUP BY, (B) post-aggregation side-lookup against `requests_raw`, (C) accept and document. Chose **C**: A doubles the schema surface area on a CAGG family that just shipped (DROP+CREATE on the existing `requests_raw_5s` from migration 1777500000000 to add the join key, plus another migration on the new `requests_raw_passed_5s`) for a per-sampler cardinality factor that's typically 1; B re-introduces a `requests_raw` scan into the path we just engineered to <500ms. The rollup pipeline itself uses the same shape — `url_hash` is not in the GROUP BY; it materializes "last-seen `url_hash` per `(sampler, scenario)`" via `(ARRAY_AGG(r.url_hash ORDER BY r.time DESC) FILTER (WHERE r.url_hash IS NOT NULL))[1]` post-test — so we follow the same precedent in the live path. Frontend already degrades gracefully: `Top10ListsUrls` falls back to `sampler.url_pattern || sampler.sampler_name || 'Unknown'`, and `SamplerTable` / `SamplerDetailsModal` / `ErrorsModal` conditionally render the URL chip / row when `url_pattern` is truthy. Once the test completes and the rollup runs, `getTransactionSamplesFromRollup` serves real `url_pattern` from the `url_patterns` JOIN and the regression self-heals. Added a small inline hint in the Top 10 URLs view: when any sampler in the response has `url_pattern == null`, the view shows an MUI `Alert severity="info"` ("Some entries show the sampler name in place of the URL pattern. URL patterns populate once the test completes and the post-test rollup runs."), so users hitting the live window aren't left guessing whether the column is broken or pending. **Files:** `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts` (jsdoc on `getTransactionSamplesFromCagg` updated to mark #303 as accept + document and reference the rollup pipeline's analogous design choice); `apps/web/app/test-runs/[id]/components/performance-analysis/Top10ListsUrls.tsx` (`hasMissingUrlPatterns` derived from `samplers.some(s => s.url_pattern == null)` + conditional Alert above the dimension cards). No CAGG migration; no API behavior change beyond documentation.

## [0.2.47.88] - 2026-05-09

### Added
- **Live Apdex queries on `/test-runs/:id/transactions` and `/transactions/:name/samples` now read from new `transactions_passed_5s` / `requests_raw_passed_5s` continuous aggregates instead of scanning raw `transactions` / `requests_raw`.** Wall time on a 10M-row in-flight run drops from 60s+ to <500ms (target). Apdex correctness aligns with the post-test rollup-table fast path (success-filtered uddsketch) — failed-but-fast rows are correctly counted as frustrated, not satisfied. The HTTP 202 rollup-pending response from #302 now only fires when *both* the rollup table AND the CAGG are empty for the run window. Wired into `getTransactionStats` / `getTransactionSamples` between the existing rollup-table fast path and the raw-scan fallback (which retains the `clampSinceMinutes` + `withStatementTimeout` safety net for the rare CAGG-empty case). Live windows (`sinceMinutes != null`) also routed through the CAGG with `startTime` narrowed to `max(scope.startTime, NOW() - sinceMinutes*60s)`. Threshold join uses `system_under_test_id` (UUID) for cross-org safety. The `getTransactionSamples` path additionally preserves the existing `'ready' + hasSamplerRollup=false` fall-through (unsampled high-cardinality samplers) by routing it through CAGG too, so the legacy "rollup ready but per-transaction sampler row absent" case now serves a fast CAGG result instead of a slow raw scan. **Files:** `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts` (new private `loadCaggApdexScope` + `getTransactionStatsFromCagg` + `getTransactionSamplesFromCagg` helpers; gate logic in both public methods captures `'rollup-pending'` and serves CAGG result when present); `getRollupStatus` jsdoc updated to document the 2-signal decision tree. **Tests:** 130 → 137 passing on `test-runs-performance-query.service.spec.ts` (new `loadCaggApdexScope` block + two new `CAGG fast path` describe blocks under both `getTransactionStats` and `getTransactionSamples`, including SQL-shape regressions, 'rollup-pending + CAGG present → 200' and 'rollup-pending + CAGG empty → 202' transitions, live-window startTime clamping, and the `'ready' + hasSamplerRollup=false` fall-through routing through CAGG). New worker integration test `apps/worker/src/test/integration/cagg-apdex-equivalence.integration.test.ts` seeds 10k synthetic transactions and asserts `|raw_apdex - cagg_apdex| < 0.02` (skips cleanly when migration 1779100000000 isn't applied or `SKIP_CAGG_EQUIVALENCE_TEST=true`). **Known limitation:** sampler-level CAGG path returns `url_hash` / `url_pattern` as null (CAGGs don't carry them — addressing this requires either inflating CAGG cardinality or a side lookup; tracked as #303). **Migration:** new continuous aggregates `transactions_passed_5s/1m/5m` and `requests_raw_passed_5s/1m/5m` carrying success-filtered `pct_agg_passed` sketches via `percentile_agg(response_time::double precision) FILTER (WHERE success)` (uddsketch family — same as existing CAGGs). Side-by-side with the existing `transactions_5s` / `requests_raw_5s` family from migration 1777500000000 — rather than DROP+CREATE on those (which would dark out throughput panels for the duration of rematerialization). Refresh policies match the existing family (5s every 30s, 1m every 1min, 5m every 5min); 90-day retention. Production rollout requires phased backfill of historical data via `CALL refresh_continuous_aggregate(...)` in 1-day chunks during low-load hours; until backfill catches up, live-Apdex on older runs falls through to the existing raw-scan path (no regression).

## [0.2.47.87] - 2026-05-09

### Fixed
- **Performance Analysis card no longer hammers the database with a raw-data `percentile_agg` while the post-test `transaction-stats-rollup` is still in-flight.** On large runs (>10M requests) opening `/test-runs/<id>` immediately after completion fired `GET /test-runs/:id/transactions` while the analyze-test pipeline's stage 4 (`transaction-stats-rollup`) was still writing to `test_run_transaction_stats` — the rollup-empty fast-path check failed and the API fell through to a multi-CTE `WITH agg AS (... percentile_agg(t.response_time) ... FROM transactions t ... GROUP BY transaction_name, scenario_name)` over the active hypertable chunk. That query competed with the in-flight rollup INSERT for the same rows and pinned a connection for seconds-to-minutes per page open, multiplied by every realtime refresh tick. Added a two-signal gate at the API: when `sinceMinutes == null` AND the rollup table is empty AND `JobProgressService.getActiveJobForScope(sut, env, workload)` returns an active analyze-test job, `getTransactionStats`/`getTransactionSamples` return a `RollupPendingResult` discriminated union which the controller maps to HTTP 202 with body `{ status: 'rollup-pending', stage: 'transaction-stats-rollup', progress: { stageName, stageIndex, totalStages } }`. The frontend hook detects 202, exposes a `rollupPending` state, polls every 5s while pending, and the Performance Analysis card renders an MUI `Alert severity="info"` in both collapsed and expanded states ("stage 4 of 11: transaction-stats-rollup") instead of misleading-empty numbers derived from the empty `transactions[]`. The third arm of the gate — rollup empty + no active job (soft-failed rollup, rare) — preserves the existing live-aggregation fallback so historical/edge cases still serve data. Live-window queries (`sinceMinutes != null`) bypass the gate entirely by design — they hit raw data on running tests where no rollup exists yet, and that path is now bounded by a server-side clamp (`sinceMinutes` capped at `LIVE_WINDOW_MAX_MINUTES = 60`) plus `SET LOCAL statement_timeout = '10s'` wrapped around the live `withRequestEm(...).manager.transaction(...)` block (alongside the existing `SET LOCAL work_mem = '512MB'`) so a runaway query aborts cleanly rather than holding a connection. The proper fix for live-window heavy queries — routing through the existing `transactions_5s` continuous aggregate — is filed as a follow-up. **Files:** `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts` (new private `getRollupStatus` helper + `clampSinceMinutes` + `withStatementTimeout` + gate wiring on both methods; `hasTransactionRollup` removed, `hasSamplerRollup` retained as a per-transaction nested check inside the `'ready'` branch to preserve unsampled-high-cardinality fallback); `apps/api/src/modules/test-runs/services/test-runs-performance-query.types.ts` (new — `RollupPendingResult` + `isRollupPending` type guard); `apps/api/src/modules/test-runs/controllers/test-runs-metrics-transaction.controller.ts` (`isRollupPending` check → `throw new HttpException(result, HttpStatus.ACCEPTED)`); return-type widening on `test-runs-query.service.ts` and `test-runs.service.ts` facades; `apps/web/app/test-runs/[id]/components/performance-analysis/hooks/usePerformanceAnalysisData.ts` (202 detection, `RollupPendingState` exposure, `isValidRollupProgress` type-guard against backend schema drift, 5s poll while pending so the card transitions out even on completed runs where the realtime entity-update trigger is no longer firing); `PerformanceAnalysisCard.tsx` + `PerformanceAnalysisCollapsedView.tsx` (info Alert in both views, gates `OverallTestMetrics` on `!rollupPending`). **Tests:** 119/119 passing on `test-runs-performance-query.service.spec.ts` (114 existing + 4 `getRollupStatus` arms + 5 gate-wiring + 5 safety-net tests asserting clamp + statement_timeout); 4/4 new on the new `test-runs-metrics-transaction.controller.spec.ts` (happy-path returns array, rollup-pending throws 202 with body shape preserved, both methods covered); `tsc --noEmit` clean across api + web. The two known tradeoffs are documented inline in the service: a benign TOCTOU between the rollup-existence check and the active-job lookup (next client poll resolves it — the 5s frontend poll guarantees this), and the `'unavailable'` arm intentionally accepting current heavy-query cost on the rare soft-failed-rollup case rather than risk a perpetual "pending" UI.

## [0.2.47.86] - 2026-05-08

### Fixed
- **Workload-level Apdex SLO evaluation no longer scans the `transactions` hypertable to enumerate transaction names (#299).** `ApdexCalculator.getTransactionsWithScenarios()` (`apps/worker/src/pipelines/checks/ApdexCalculator.ts:727`) ran a `SELECT DISTINCT transaction_name, COALESCE(scenario_name, 'default') FROM transactions WHERE test_run_id = $1` once per workload-level Apdex benchmark per test_run inside `evaluateWorkloadLevelApdex`. After #296/#298 made the actual Apdex computation a sub-millisecond rollup read (`approx_percentile_rank` on `pct_agg` / `pct_agg_passed`), this `DISTINCT … FROM transactions` became the dominant cost of `checks-evaluation` for workload-level SLOs — measured at ~7.4 s mean per call on the lab fixture, ~75 % of the 25 s `checks-evaluation` total on a 5-run sut-a `orchestrate-reevaluate-batch`. The same `(test_run_id, transaction_name, scenario_name)` triples are already pre-aggregated by `TransactionStatsRollupPipeline` (#150/#151) into `test_run_transaction_stats`, keyed by the same triple — reading distinct values from there is an index-only scan on the existing PK (`O(distinct transactions)` vs the legacy `O(hypertable chunk)` cost). Both `getTransactionsWithScenarios()` and its sibling `getAvailableTransactions()` (line 712, used by the UI to populate the Apdex SLO config dropdown — same anti-pattern) now query `test_run_transaction_stats` first with `ramp_up_excluded = false` to pick one of the two variants the rollup pipeline always emits, and `COALESCE(NULLIF(scenario_name, ''), 'default')` to preserve the legacy caller contract — the rollup CTE stores `COALESCE(t.scenario_name, '')` (empty string) for NULL-scenario rows, so `NULLIF` maps that back to NULL and `COALESCE` returns `'default'`, matching the historical `'default'`-for-NULL behavior. When the rollup is empty (rollup pipeline has not run yet, or a historical run from before #150/#151), the calculator falls back to the legacy `transactions` scan — same shape the Apdex fast path uses for backward compatibility. 6 new ApdexCalculator unit tests lock both paths in (rollup-first happy path with `ramp_up_excluded` + `NULLIF` SQL-shape assertions, fallback to `FROM transactions` on empty rollup, both-empty returns `[]`, single-call optimization confirmed via `toHaveBeenCalledTimes(1)`); the existing "no transactions" workload-level tests updated to mock both rollup and legacy as empty for the fallback path. Worker test suite 70/70 passing on `ApdexCalculator.test.ts` (was 64 — added 6 new). API-side `benchmark-calculator.service.ts:63` (which scans `requests_raw` rather than `transactions`) is intentionally not changed in this PR — switching the UI dropdown source from `requests_raw` to `test_run_transaction_stats` is a behaviour change (only transactions-table-recorded names show up) and is left as a follow-up. **Projected impact:** sut-a soak fixture's `checks-evaluation` ~25 s → <2 s (per-reevaluate `getTransactionsWithScenarios` cost drops from `N_runs × ~7.4 s` to `N_runs × <1 ms`); after #296 + #298 + this fix, `orchestrate-reevaluate-batch` wall time becomes dominated by writes + ADAPT analysis rather than DISTINCT scans against the active write chunk.

## [0.2.47.85] - 2026-05-08

### Fixed
- **Apdex fast path no longer falls back to the legacy `FROM transactions` scan on workloads with non-trivial failure rates (#298 — #296 follow-up).** #296 / 0.2.47.84 made `ApdexCalculator.calculateApdex()` read from `test_run_transaction_stats` via `approx_percentile_rank(threshold, rollup(pct_agg))`, gated by `($4::boolean OR failed_count = 0)` so the rollup path was only taken when `includeFailedRequests=true` or every matching row had zero failures. The gate exists because the stored `pct_agg` is a `tdigest` over every row regardless of `success`, and there is no operation that subtracts failed-row response_times from a single all-rows sketch — fall-back to the raw scan was the only correct option for `includeFailedRequests=false` rollups carrying any failure. In production that matched ~99 % of `(test_run × transaction × scenario)` rows, so the fast path fired. But on every workload that exercises error-handling (soak runs validating error budgets, lab driver fixtures, chaos / negative-path SLO checks) every rollup row had `failed_count > 0` → the fast path bailed on every call and `checks-evaluation` regressed to ~70 s on the 5-run sut-a soak fixture (75 fast-path calls returning zero rows + 114 raw `FROM transactions` fall-back calls × 441 ms mean = ~50 s of legacy SQL per re-evaluate). Fix: store a second sketch built only over passing rows (`pct_agg_passed`), and let the calculator pick the right column at read time. **(1) Migration `1779000000000-AddPctAggPassedToStatsRollup`** adds nullable `pct_agg_passed tdigest` to `test_run_transaction_stats` and `test_run_sampler_stats` (both gain it for symmetry — the sampler-side consumer is the future #287 Errors-Overview Apdex-from-rollup branch). Nullable on purpose so existing rollup rows keep working — the calculator gates on `BOOL_AND(pct_agg_passed IS NOT NULL)` and falls back to the legacy scan when any matching row predates the migration; a normal `TransactionStatsRollupPipeline` rerun (or just letting the next analyze run for a test_run repopulate it) graduates legacy rows onto the fast path with no one-shot backfill. **(2) `TransactionStatsRollupPipeline`** (`apps/worker/src/pipelines/TransactionStatsRollupPipeline.ts`) extends both `TRANSACTION_ROLLUP_SQL` and `SAMPLER_ROLLUP_SQL` with `tdigest(100, response_time) FILTER (WHERE success)` (full window) and `tdigest(100, response_time) FILTER (WHERE success AND time >= $2)` (ramp-up-excluded window) in the same single-pass scan that already builds the all-rows sketches — TimescaleDB computes additional `FILTER`'d aggregates over the same row scan with no measurable extra cost. The new column is wired through both UNION-ALL branches and the `ON CONFLICT DO UPDATE SET` clause so updates land cleanly on reruns. **(3) `ApdexCalculator.calculateApdexFromRollup()`** (`apps/worker/src/pipelines/checks/ApdexCalculator.ts`) is rewritten to use `rollup(CASE WHEN $4::boolean THEN pct_agg ELSE pct_agg_passed END)` for sketch selection, computes `effective_total` from `total_count` (when `includeFailedRequests=true`) or `passed_count` (when `false`) so the score denominator matches the chosen sketch — same shape the legacy raw query produces with vs without the `success = true` filter. The `($4::boolean OR failed = 0)` eligibility filter is dropped; the only remaining miss conditions are "no rollup rows" (test run not yet rolled up) and "any matching row has NULL pct_agg_passed" (legacy rollup, includeFailedRequests=false). avg_response_time continues to be computed from the per-row `avg_response_time × total_count` weighted average — for the `includeFailedRequests=false` case this drifts slightly from the legacy success-only avg, but the difference is sub-millisecond on the workloads we measured and is dwarfed by the latency win; can be tightened by storing `avg_response_time_passed` if any consumer ever needs the strictly-success-only display value. **(4) Tests:** 3 new pipeline tests (pct_agg_passed appears in INSERTs + ON CONFLICT, FILTER (WHERE success) for full + ramp-up-excluded variants on both transaction and sampler rollups), 4 new ApdexCalculator tests (still-fires-with-failures, falls-back-on-NULL-pct_agg_passed, BOOL_AND gate present, sketch-selection flag plumbing — old eligibility-filter test rewritten to assert the new `failed = 0` predicate is gone). Worker suite 1345/1345 passing; type-check + lint clean across all 8 packages. **Projected impact:** sut-a soak fixture's `checks-evaluation` ~70.8 s → <2 s (75 fast-path-served calls × ~1 ms instead of 75 misses + 114 raw-scan fall-backs × 441 ms). Production runs that touch error-tolerance benchmarks (regression-fix validation, chaos / negative-path SLOs) move from "perpetual `FROM transactions` consumer" to "first-class on the rollup path".

## [0.2.47.84] - 2026-05-08

### Fixed
- **`checks-evaluation` no longer dominates reevaluate wall time on populated TimescaleDB stacks (#296).** `ApdexCalculator.calculateApdex()` (`apps/worker/src/pipelines/checks/ApdexCalculator.ts:118`) ran a `COUNT(*) FILTER … FROM transactions WHERE test_run_id = $1 AND transaction_name = $2` once per `(test_run × transaction)` during every `checks-evaluation` stage — measured at ~483 ms per call × 39 calls = ~19 s, with `checks-evaluation` itself accounting for 94.5 % of the entire `orchestrate-reevaluate-batch` wall time (79 s of 84 s) after the rollup fast paths landed for control-group statistics, throughput, and errors overview in #287/#288/#289. Same anti-pattern: `(passed_count, failed_count, avg_response_time, pct_agg)` per `(test_run × transaction × scenario × ramp_up_excluded)` is already pre-computed by `TransactionStatsRollupPipeline` (#150/#151) into `test_run_transaction_stats` after #278 hardened the `tdigest` sketch, and the same `approx_percentile_rank(threshold, rollup(pct_agg))` formula the Performance Analysis card uses for its parent-row Apdex (`getTransactionStatsFromRollup`) gives the same Apdex score in microseconds. Added `calculateApdexFromRollup()` as a single-query fast path: a CTE pools `total_count`/`passed_count`/`failed_count`/`avg_response_time` (weighted by total_count) and `rollup(pct_agg)` over the matching rows, then derives `satisfied = approx_percentile_rank(T, sketch) * total`, `tolerating = approx_percentile_rank(4T, sketch) * total - satisfied`, `frustrated = total - approx_percentile_rank(4T, sketch) * total`. Same JS-side `(satisfied + tolerating * 0.5) / total` formula as the raw path so the Apdex score is computed identically. All three callers funnel through the same `calculateApdex` entrypoint — `evaluateSingleTransaction` (transaction-scoped SLO), `evaluateWorkloadLevelApdex` (loops per-transaction so each iteration hits the fast path independently), and `previewApdex` (UI preview, only hits fast path when transactionName is provided). The fast path is gated `transactionName !== null` to keep the workload-level aggregate (rare; only `previewApdex(testRunId, null, ...)` reaches it) on the raw scan — the rollup table doesn't carry a workload-aggregate row across all transactions, and the savings on the hot per-transaction path already dominate. Eligibility filter `($4::boolean OR failed = 0)` keeps the SQL a single round-trip: when `includeFailedRequests=false` and the rollup carries failed transactions (the sketch is built without a `success` filter, so we can't subtract failed response_times from it), the fast-path query returns zero rows and the calculator falls back to the legacy `transactions` scan — preserving exact correctness for the configurations where the success filter actually changes the result. The vast majority of test runs have `failed_count = 0` per transaction in practice (per-transaction success rate is typically ≥99.9 %), so the fast path fires on virtually every call. Chose `test_run_transaction_stats` over the `test_run_sampler_stats` table referenced in #296's "Code references" section because the former is the natural granularity (built from `transactions.response_time` directly, keyed by `(test_run_id, transaction_name, scenario_name, ramp_up_excluded)` — exactly what `calculateApdex` filters on) while the latter is built from `requests_raw` (one rung deeper, would force a sampler→transaction sketch rollup that's strictly less accurate than reading the right rollup directly). 9 new unit tests in `apps/worker/src/test/unit/pipelines/checks/ApdexCalculator.test.ts` lock in the fast path: hit-on-rollup-row, miss-falls-back-to-raw-scan, transactionName-null-skips-fast-path, ramp_up_excluded plumbing, includeFailedRequests propagation, threshold parameterisation (`$5` only — 4× computed inline), avg-response-time rounding, null-avg handling, and equivalence to the raw path on a known fixture. All 64 ApdexCalculator tests passing (55 original + 9 new); checks pipeline suite 170/170; worker typecheck + lint clean. Per-reevaluate `checks-evaluation` projected impact: ~79 s → <5 s (the ~19 s Apdex SQL is the largest single chunk; remaining time is benchmark / threshold lookups + `check_results` writes which are cheap on small tables).

## [0.2.47.83] - 2026-05-08

### Fixed
- **Worker no longer exits during long analyze pipelines on populated DBs (#294).** On stacks with populated `requests_raw` (~14 K rows in the active chunk) the analyze pipeline runs 3–6 minutes per job, dominated by the `transaction-stats-rollup` INSERT (140–260 s). The pool-acquired ioredis socket was held idle for the duration of that INSERT and silently dropped by the OS / Docker / load-balancer idle-TCP timeout; `ProgressReporter.complete()`'s trailing `redis.expire()` — the only Redis call in `complete()` *not* wrapped in try/catch — then threw `Error: Connection is closed.`, the throw cascaded through `progressReporter.fail()` (also unguarded) and out of the worker callback as an unhandled rejection, and Node's global `unhandledRejection` handler called `shutdown()` → `process.exit()`. Surfaced as `❌ Unhandled promise rejection:` followed by `🛑 Shutting down worker... (signal: unhandledRejection)` in worker logs after 1–3 analyze jobs; with `restart: unless-stopped` the worker recovers but every recovery loses the in-flight BullMQ lock + progress state and re-runs the analyze from scratch (~6 min) while the UI shows a phantom-active job. Without a restart policy the worker stays dead and every queued analyze-test / reevaluate-batch sits unprocessed. Three changes, all in the worker package: (1) `apps/worker/src/config/redis-pool.ts` adds `keepAlive: 30000` to the pool's ioredis options so the OS detects dropped sockets within seconds — the previous "no keepAlive" comment was correct for the BullMQ blocking-worker connection (created separately in `createSimpleWorker`, where extra options interfere with `BRPOPLPUSH`) but wrong for these general-purpose pool connections, which are acquired once per analyze job and held for the full duration; comment updated to make the distinction explicit. (2) `apps/worker/src/services/ProgressReporter.ts` wraps the trailing `redis.expire()` calls in both `complete()` (line 136) and `fail()` (line 164) in try/catch with a logger.error, matching the pattern already used in `publishProgress()` / `publishCompletionEvent()`. (3) `apps/worker/src/services/PipelineOrchestrator.ts` wraps both `progressReporter.complete()` (line 548) and `progressReporter.fail()` (line 576) in their own try/catch blocks — best-effort progress reporting must not escape the orchestrator; the pipeline result is reported via the return value either way. (4) Bonus: `apps/worker/src/worker.ts` now serializes `Error` payloads in the `unhandledRejection` handler explicitly (`{ name, message, stack }`) — pino strips those fields when an Error is logged under an arbitrary key like `reason`, which is why the original incident report only had `❌ Unhandled promise rejection:` with no payload to debug from. (1) on its own would mask the bug; (2) and (3) are the actual fix that prevents *any* finalization Redis hiccup (Redis restart, network blip, `CLIENT KILL`) from taking the worker down. Worker typecheck + lint clean, `PipelineOrchestrator.test.ts` 65/65 passing.

## [0.2.47.82] - 2026-05-08

### Fixed
- **Errors Overview no longer 500s with `column "tc.active_threshold" must appear in the GROUP BY clause` after the rollup-fast-path landed (#287 follow-up).** PR #287 routed `getTransactionErrors()` through `test_run_sampler_stats` and added a `sampler_stats` CTE that joins `threshold_config` (a one-row CTE holding the per-transaction Apdex threshold) and references `tc.active_threshold` as the first argument to `approx_percentile_rank(...)`. `approx_percentile_rank` is a regular function, not an aggregate — only its second arg, `rollup(trss.pct_agg)`, is the aggregate — so Postgres treats `tc.active_threshold` as an ordinary column reference. Combined with `GROUP BY trss.sampler_name`, that violates the SQL-standard GROUP BY rule and Postgres rejects the query with `42803` (`parse_agg.c:1489`), surfacing as `GET /api/test-runs/:id/errors?transactionName=...&excludeRampUp=true` returning HTTP 500 (`DATABASE_ERROR` via `GlobalExceptionFilter`) on every Errors Overview open against any test run that has a populated `test_run_sampler_stats` rollup. Reproduces on `lab-sut-d-lab-lab-soak-00005` (and any other run that exercised the rollup fast path). The legacy raw-scan branch wraps `tc.active_threshold` inside `SUM(CASE WHEN rr.response_time <= tc.active_threshold ...)`, so it sits inside the aggregate and never tripped the rule — only the new rollup branch was affected. Fixed `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts:880` by adding `tc.active_threshold` to the GROUP BY (`GROUP BY trss.sampler_name, tc.active_threshold`). Safe because `threshold_config` is `LIMIT 1` — exactly one row, so the CROSS JOIN doesn't multiply rows and the extra GROUP BY column does not change result cardinality. Added a regression assertion in `test-runs-performance-query.service.spec.ts` (the rollup-CTE shape test now asserts `/GROUP BY\s+trss\.sampler_name,\s*tc\.active_threshold/`) so future drift back to grouping by `sampler_name` alone fails the test before reaching production. Spec suite: 105/105 passing; API typecheck clean.

## [0.2.47.81] - 2026-05-08

### Fixed
- **ADAPT re-evaluate no longer holds the worker for ~2–3 minutes scanning `ds_metrics` raw on every run (#289).** `ControlGroupStatisticsPipeline` (analyze pipeline Step 9, also re-run by every `orchestrate-reevaluate-batch` job with `adapt: true`) issued a multi-CTE query whose first stage was `percentile_agg(value) FROM ds_metrics … WHERE test_run_id = ANY($)` to pool a sketch across every control run. On a populated lab DB (28 GB hypertable, 188 K rows/min during a soak, ~70 K rows per (control_run × dashboard × panel × metric)) that single CTE took ~104 s per call, contended with autovacuum on the same `_hyper_*_chunk` (`Timeout:VacuumDelay` for ~109 s), and dominated the entire ADAPT re-evaluate wall time — every threshold tweak, control-group swap, or metric-config edit re-paid the full ~2–3 minutes. Same anti-pattern as #283 / #287 / #288, just on `ds_metrics` instead of `requests_raw` / `transactions`. `StatisticsPipeline` (Step 6, runs before this Step 9) was already calling `percentile_agg(value)` per (test_run, dashboard, panel, metric) to derive the scalar quantiles in `ds_metric_statistics` but threw the sketch away after extracting the percentiles. New migration `1778900000000-AddDsMetricStatisticsPctAgg` adds three nullable columns to `ds_metric_statistics`: `pct_agg uddsketch` (the per-run sketch), plus `sum_value` / `sum_sq_value` (the two extra moments needed to recombine population mean and `STDDEV_POP` exactly across pooled control runs — sketches don't preserve enough information for std-dev). `StatisticsPipeline` writes all three on every (re-)statistics run. `ControlGroupStatisticsPipeline.calculateStatisticsForControlGroup` now runs a sketch-availability pre-flight (`COUNT(*) FILTER (WHERE pct_agg IS NULL)` over the control runs); when zero, it switches to a fast-path query that pools per-run sketches via `rollup(ms.pct_agg)` over `ds_metric_statistics` (~10 control runs × ~795 metric rows ≈ 8 K rows scanned, vs. ~10 × ~70 K raw rows × ~50 metrics on the legacy path) and recombines mean / std-dev / min / max / is-constant from `SUM(sum_value)` / `SUM(sum_sq_value)` / `SUM(count)` / `MIN(min_value)` / `MAX(max_value)`. Approximate percentiles, IQR, and IDR all read off the pooled `pct_agg` exactly as they did before. When any control run was statisticed before #289 (its rows still have NULL `pct_agg`), the pipeline transparently falls back to the legacy raw-scan SQL — re-running `StatisticsPipeline` on those runs backfills the sketch and graduates them onto the fast path. Two new unit tests in `ControlGroupStatisticsPipeline.test.ts` lock both paths in: one asserts the fast-path SQL contains `per_run_pooled` + `rollup(ms.pct_agg)` and never `FROM ds_metrics m`; the other forces `missing_sketches > 0` and asserts the legacy CTE shape (`AVG(m.value)`, `STDDEV_POP(m.value)`, `FROM ds_metrics m`). Existing 28 ControlGroupStatisticsPipeline + 57 StatisticsPipeline unit tests updated for the new mock-call ordering and pass on this branch (worker suite 1331/1331). Lint + type-check clean across all 8 workspaces.

## [0.2.47.79] - 2026-05-08

### Fixed
- **Errors Overview opens in milliseconds instead of ~45 s on populated TimescaleDB stacks (#287).** Clicking a transaction in the Performance Analysis card and selecting Errors fired a single composite SQL with a `sampler_stats` CTE that scanned `requests_raw` (~14 K cold reads on the active 50 GB write chunk per click, ~38 s wall time) to compute per-sampler Apdex from raw `response_time` — even though `test_run_sampler_stats` already holds the same data pre-aggregated as a `tdigest`. A second offender on the errors-summary endpoint ran `SELECT COUNT(*) FROM requests_raw WHERE test_run_id = $1` to get "total requests" for the error-rate display (~5.5 s mean). Refactored `getTransactionErrors()` (`apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts:750`) to detect the rollup with a new `hasAnySamplerRollup()` check and rebuild the `sampler_stats` CTE on top of `test_run_sampler_stats` using `rollup(trss.pct_agg)` to merge tdigest sketches when the GROUP BY collapses multiple `(transaction_name, scenario_name)` rows onto a single `sampler_name` (the case when no transaction filter is provided). Apdex is computed via `approx_percentile_rank(active_threshold, rollup(pct_agg))` — same formula the rollup-based `getTransactionSamplesFromRollup()` already uses for the parent card, so the digits in the errors view match the parent row exactly. The legacy raw-scan CTE is retained as a fall-back for in-progress runs whose rollup hasn't been computed yet (mirrors the existing `hasSamplerRollup()` flag-guard in `getTransactionStats()`). Also threaded `excludeRampUp` (default `true` to match the parent card's default) from `ErrorsModal` → `PerformanceAnalysisDialogs` → controller → service so the rollup is queried with the same `ramp_up_excluded` flag the rest of the card is showing — without this, the Apdex in the errors view would silently disagree with the parent. `getErrorSummary()` (`apps/api/src/modules/test-runs/services/test-runs-error-analysis.service.ts:138`) now reads the total request count from `SUM(total_count) FROM test_run_transaction_stats WHERE ramp_up_excluded = false` when populated, falling back to the `requests_raw` `COUNT(*)` for in-progress runs. New `buildScenarioFilterForRollup()` helper handles the rollup table's `scenario_name text NOT NULL DEFAULT ''` semantics (empty string for "no scenario") vs `requests_raw`'s nullable `scenario_name`. 8 new unit tests added (5 in `test-runs-performance-query.service.spec.ts` for the rollup CTE shape + raw fallback + ramp-up param plumbing; 1 in `test-runs-error-analysis.service.spec.ts` for the rollup-based total-requests path; existing summary tests updated to reflect the new 3-call sequence: error-counts → existence check → rollup/raw count). API + web typecheck + lint clean; full API test suite passing 4493/4493 (excluding RLS tests requiring Phase 5b cluster setup); web Performance Analysis tests 64/64.

## [0.2.47.78] - 2026-05-07

### Fixed
- **Transaction time-series modal recovers — `getTransactionTimeSeries` no longer 500s with `column "c.bucket" must appear in the GROUP BY clause` (PR #285 follow-up).** PR #285 (v0.2.47.77, route test-run timeseries reads to CAGGs) routed transaction reads to `requests_raw_5s` via `TestRunsTimeSeriesQueryService.buildTimeSeriesQuery` with three kinds: `transaction`, `sampler`, `sampler-single`. The `sampler` kind prepends `c.sampler_name AS sampler_name` as the first SELECT column, shifting `time_bucket('${aggSec} seconds'::interval, c.bucket) AS time_bucket` to position 2 — but the trailing `GROUP BY 1${samplerGroupKey}` still resolved positional `1` to `sampler_name` (`samplerGroupKey` already adds `, c.sampler_name`), leaving the `time_bucket` expression ungrouped. Postgres rejects that with `42803 column "c.bucket" must appear in the GROUP BY clause or be used in an aggregate function` (`parse_agg.c:1489`), surfacing as `GET /api/test-runs/:id/transactions/:txn/timeseries?aggregationSeconds=5` returning HTTP 500 (`DATABASE_ERROR` via `GlobalExceptionFilter`) on every transaction graph open in the Performance Analysis modal. Replaced positional `1` with the explicit `time_bucket('${aggSec} seconds'::interval, c.bucket)` expression in `apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.ts:202`, so all three kinds group correctly: `transaction` and `sampler-single` group by the time bucket only, `sampler` groups by `(time_bucket, sampler_name)`. Added an explicit regression assertion in `test-runs-timeseries-query.service.spec.ts` (`groups by the time_bucket expression and sampler_name (not by positional ordinal)`) so a future drift back to `GROUP BY 1, c.sampler_name` fails the test rather than reaching production again. The pre-existing positional-grouping test only matched `/GROUP BY[\s\S]*sampler_name/`, which the buggy SQL also satisfied. Spec now 32/32 passing.
- **Removed `1 second` and `3 seconds` aggregation options from the request and transaction time-series dropdowns (PR #285 follow-up).** The CAGG floor on `requests_raw_5s` / `transactions_5s` is the 5-second `bucket` column, and `validateAggregationSeconds` (`apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.ts:83`) rejects anything below 5 or non-multiple of 5 with `BadRequestException`. The frontend dropdowns in `apps/web/app/test-runs/[id]/components/performance-analysis/RequestTimeSeriesModal.tsx` (request graphs) and `apps/web/.../transaction-graph-modal/utils/chart-config.ts` (transaction graphs) still surfaced `1 second` and `3 seconds`, both of which round-tripped to a 400 the moment a user selected them. Both `AGGREGATION_OPTIONS` arrays now start at `5 seconds` so the dropdown values match what the API will accept. Defaults already sat at `5` (`useState(5)` in `RequestTimeSeriesModal.tsx:87`, parent state in `useTransactionGraphData`), so no follow-up state change was needed.

## [0.2.47.77] - 2026-05-07

### Fixed
- **Analyze pipeline no longer aborts at `panels-processing` on stacks with no Grafana instance, restoring rollup / statistics / checks / ADAPT for Grafana-less SUTs (#282).** Grafana is documented as an optional metric source — load tests can ingest directly into TimescaleDB and `dynatrace-collection` already returns success with zero queries when nothing is configured. `panels-processing` did not: `getGrafanaConfig()` in `apps/worker/src/config/grafana-config-cache.ts` threw `Grafana config not available. No valid Grafana instance found in database.` whenever `grafana_instances` was empty. Combined with the orchestrator's `errorHandling: 'abort'` (`apps/worker/src/workers/analyze.ts:135`), Step 2's failure broke out of the loop and skipped Steps 3–10 — `transaction-stats-rollup`, `performance-test-metrics`, `statistics-calculation`, `checks-evaluation`, `control-groups-creation`, `control-group-statistics`, ADAPT — every analyze run on a Grafana-less stack landed with `consolidated_result: null`, empty `test_run_sampler_stats` / `test_run_transaction_stats`, no `check_results`, and the Performance Analysis card forced to fall back to live aggregation on every render (`~7.7s` per apdex query against a 220M-row `requests_raw` hypertable, vs `~0.7ms` with rollup populated — see #278). Reproduces on every soak in `perfana/perfana-demo`'s DB-stress lab (`lab/scripts/run-soak.sh --stage 1 --keep-db`) once a `DROP FROM grafana_instances` strips the row. `loadFromDatabase()` now returns a discriminated `LoadResult` (`'loaded' | 'not-configured' | 'invalid'`) so callers can distinguish "no row" (Grafana wasn't wired up — soft skip) from "row exists but missing `server_url`/`apiKey` or DB query failed" (real misconfiguration — fail loudly). New `tryGetGrafanaConfig()` returns `null` for `not-configured` and throws for `invalid`; legacy `getGrafanaConfig()` keeps its throw-on-anything-not-loaded contract for `incremental/grafana-collector.ts` and other callers that legitimately require Grafana. `PanelsPipeline.execute()` calls `tryGetGrafanaConfig()` first and short-circuits with `{ success: true, data: { skipped: 'no-grafana-configured' } }` — same shape `transaction-stats-rollup` already uses for soft-fail (`PipelineOrchestrator.ts:653–681`); the Step 11 sanity-check stage runs unconditionally anyway. `MetricsPipeline.execute()` gets the identical short-circuit before `initializeGrafanaClient()` so Step 5 never tries to instantiate `GrafanaClient` against a missing config. Distinguishing the two failure modes preserves the loud signal operators want when they actually configured Grafana but got it wrong (typo'd URL, expired API key, DB unreachable). 16 new tests: 12 in `grafana-config-cache.test.ts` covering all three `LoadResult` paths plus singleflight + caching for both `getGrafanaConfig`/`tryGetGrafanaConfig`; 2 each on `PanelsPipeline.test.ts` and `MetricsPipeline.test.ts` asserting the soft-skip never touches the DB / Grafana client and that the invalid-row path still surfaces as a stage failure. Integration mocks in `metrics-pipeline.integration.test.ts` and `panels-pipeline.integration.test.ts` updated to expose `tryGetGrafanaConfig` so the existing happy-path tests don't hit the real cache against a fixture DB. Worker test suite: 1331/1331 passing; turbo type-check + lint clean across worker + shared.

## [0.2.47.76] - 2026-05-07

### Fixed
- **Transaction stats rollup no longer aborts with `function tdigest(double precision) does not exist`, restoring the fast path on the Performance Analysis card (#278).** PR #275 (v0.2.47.75) corrected the sketch family from `percentile_agg`/`uddsketch` to `tdigest` to match the rollup table column type, but used the single-arg form `tdigest(t.response_time::double precision)`. TimescaleDB Toolkit `1.22.0` (running on TimescaleDB `2.26.4`) only ships the two-arg aggregate `tdigest(size integer, value double precision)` — there is no single-argument signature. The planner returned `function tdigest(double precision) does not exist` on the rollup INSERT, the whole transaction aborted, and `test_run_transaction_stats` / `test_run_sampler_stats` stayed empty the same way they did under the original `uddsketch` mismatch. Surfaced via `QueryFailedError: function tdigest(double precision) does not exist at TransactionStatsRollupPipeline.execute` in worker logs on every retry; reproduced on lab branch `lab/db-stress-18k-rps` against ~64M `requests_raw` rows across 4 SUTs × 2 runs. All four call sites in `TransactionStatsRollupPipeline.ts` (transaction full + excl, sampler full + excl) now pass `tdigest(100, t.response_time::double precision)` — 100 buckets matches the toolkit's documented default for response-time distributions and is sufficient for the p95/p99 the Performance Analysis card reads. Bucket count is hard-coded with a doc comment pointing readers at the right knob to bump if p999 estimates ever drift on high-cardinality runs (~10M+ unique samples) — there's no caller that needs to round-trip the exact value, so a config knob is YAGNI for now. The existing #278 regression test was tightened to assert the size argument explicitly (`tdigest\s*\(\s*\d+\s*,\s*[^)]*response_time`) so a future drift back to either single-arg `tdigest` or `percentile_agg` fails the test instead of slipping through.

## [0.2.47.75] - 2026-05-06

### Fixed
- **Performance test ingest unblocked: scenario dashboards now write `organization_id` and `ds_metrics` populates again for `source_type='performance_test'` (#275).** Migration `1777700000000-OrganizationIdNotNull` made `application_dashboards.organization_id` NOT NULL, but the worker's `DashboardManager.createScenarioDashboard` enumerated columns explicitly and never threaded the org through, so every JMeter / perf-test ingest blew up on the first INSERT with `null value in column "organization_id" of relation "application_dashboards" violates not-null constraint`. The retry path (`IncrementalCollectionScheduler`, once a minute) made no progress — in perfana-demo on `0.2.47.73` it had been retrying for ~40 minutes when found, with 7,335 `requests_raw` rows + 1,696 `transactions` rows on disk producing 0 derived `ds_metrics`. The grafana-backed metrics path was independent and kept working, which is why `ds_metrics` was non-empty but contained only `source_type='grafana'` rows. Fix resolves the owning org/team from the parent SUT (single SELECT against `systems_under_test`, cached per `systemUnderTestId` on the manager instance), threads them through the `application_dashboards` INSERT, and passes them into the `metrics_sources` upsert that follows. `created_by`/`updated_by` are stamped `'worker-pipeline'` to mirror the surrounding ds_* writes (ds_metrics, ds_panels, ds_metric_statistics, …). `metrics_sources` DO UPDATE refreshes `organization_id`/`team_id` (so re-parenting a dashboard to a different org propagates) but leaves `created_by` alone (preserves original creator across overlapping ticks — covered by an inverse-contract test). Audit per the issue's "while in dashboard-manager.ts" note: `DynatraceDashboardManager` had the identical bug and got the same fix. New `dashboard-manager.test.ts` (6 cases: org threading, ownership cache, scenario cache, missing-SUT error, missing-org error, DO-UPDATE invariant); `DynatracePipeline.test.ts` mocks updated for the new SUT lookup; integration test schema gets a `systems_under_test` stub so the dynatrace dashboard tests can satisfy the SELECT.

## [0.2.47.74] - 2026-05-06

### Fixed
- **`check_results` is no longer write-denied for the worker, restoring benchmark check evaluation end to end.** The consolidated schema (`schema-sql.ts`) ran `ALTER TABLE public.check_results ENABLE ROW LEVEL SECURITY` but never emitted the matching `CREATE POLICY rls_check_results_*` block — sister tables on the same line range (`api_keys`, `application_dashboards`, `benchmarks`, …) all have RLS *and* their four policies. With RLS enabled and zero policies, Postgres denies every row to non-owner roles. Once `1778000000000-CreatePerfanaSystemRole` introduced the `NOBYPASSRLS` `perfana_system` role used by the worker, every benchmark INSERT into `check_results` started failing with `new row violates row-level security policy for table "check_results"` — `is_global_admin()` had no policy to short-circuit from. Surfaced through `[checks-evaluation] Failed to process benchmark <id>: QueryFailedError: new row violates row-level security policy …` worker logs (issue #272), with all 30 benchmarks across 3 test runs failing and every test run flagged invalid. Same class of bug fixed for `api_keys` / `url_patterns` / `generated_reports` in `1777400000000-RestoreRlsPoliciesPostTeamIdRemoval` and for `profile_grafana_dashboards` / `profile_benchmarks` in `1778600000000-AddProfileChildrenRlsPolicies`; `check_results` was overlooked at the time. Migration `1778700000000-RestoreCheckResultsRlsPolicies` adds the four standard policies mirroring the `rls_benchmarks_*` shape exactly — same ownership columns (`organization_id`, `team_id`, `created_by`), same write semantics. INSERT uses `is_global_admin() OR can_access_resource(...)` so the worker (running as `perfana_system` with `app.current_user_roles='["super-admin"]'`) and regular org users can both write. `schema-sql.ts` updated so fresh installs no longer need the migration to repair them. Idempotent: each `CREATE POLICY` is guarded against `pg_policies` so partial up() runs do not error on re-run. `FORCE ROW LEVEL SECURITY` deliberately not added — `check_results.relforcerowsecurity` is currently `f` (matching the schema baseline); flipping it is a separate decision that affects superuser bypass and is out of scope.

## [0.2.47.73] - 2026-05-06

### Fixed
- **Worker no longer crashloops on the missing `'write'` DataSource provider, restoring metrics analysis end to end.** PR #261 (Phase 5b — system data sources, 2026-05-05) migrated the worker from `TypeOrmModule.forRoot(createWriteTypeOrmConfig())` to `TypeOrmModule.forRootAsync({ useFactory: () => createWriteTypeOrmConfig() })` for both pool configurations. The factory return still carried `name: 'write'`, but `@nestjs/typeorm` reads the named-provider token from the OUTER `forRootAsync` options object (the `name` returned from the factory is read by TypeORM's `DataSource` constructor only — it does not bubble up to NestJS's provider registry). Result: `@InjectDataSource('write') public readonly writeDataSource` in `WorkerDatabaseService` could not be resolved, NestJS DI failed to instantiate the service and all 17 of its dependents, and the worker container crashlooped at boot with `Nest can't resolve dependencies of the WorkerDatabaseService (DataSource, ?, …)`. The bug was latent for two days because the running stack kept a pre-#261 image; rebuilding to v0.2.47.72 to pick up the AutoConfigService race fix exposed it. Fix is one line: add `name: 'write'` at the outer `forRootAsync` options level in `apps/worker/src/app.module.ts`. Comment block left in place explaining why the inner `name` is insufficient on its own. Worker boots cleanly, BullMQ consumers attach, metrics analysis pipelines resume.
- **`profile_grafana_dashboards` and `profile_benchmarks` are now actually readable by the system role.** The consolidated schema enabled RLS on both tables but never created any policies — every other RLS-protected table in the schema (26 of them) has the standard SELECT/INSERT/UPDATE/DELETE policy set, but these two were missed. With RLS enabled and zero policies, Postgres denies every row to non-owner roles. Even with `app.current_user_roles='["super-admin"]'` set on the connection, `is_global_admin()` was never invoked because there was no policy to call it from — so `perfana_system` (used by `grafana-sync`, `worker`, `perfana-report`, `audit-partition-manager`) silently received empty result sets from both tables. Surfaced through grafana-sync's `AutoConfigService` cron logging "No auto config dashboards found. AutoConfig processing skipped." while a tagged test run was actively in flight: `findAutoConfigGrafanaDashboards` was reading 0 rows from a table that contained 16. Verified: as `perfana_system` with the super-admin GUC, `SELECT count(*) FROM profile_grafana_dashboards` now returns 16 (was 0); `profile_benchmarks` returns 11 (was 0); the AutoConfigService cron now logs "Found N application dashboards" / "Processing profile benchmark: …" / "Created benchmark for profile benchmark …" instead of "No auto config dashboards found." Migration `1778600000000-AddProfileChildrenRlsPolicies` adds the four standard policies to each table using the same `can_access_resource` / `can_modify_resource` pattern as `profiles`, `test_runs`, `benchmarks`, etc. INSERT uses `WITH CHECK (true)` to match the inert insert policy every other table in the schema uses — the service layer enforces write authorization, RLS is the coarse backstop on read paths. Idempotent: each `CREATE POLICY` is guarded against `pg_policies` so partial up() runs do not error on re-run. `FORCE ROW LEVEL SECURITY` deliberately not added; the parent `profiles` table is `FORCE`'d but these two children were not in the schema baseline, and adding `FORCE` is a separate decision that affects superuser bypass during admin work.

## [0.2.47.72] - 2026-05-06

### Fixed
- **AutoConfig dashboards no longer silently fail to provision while a test is still running, and three other system actors stop quietly leaking RLS-filtered query results.** `AutoConfigService` was logging "No recent test runs with tags found. AutoConfig processing skipped." every cron tick even when a tagged test run was actively in flight, so dashboards never got auto-configured until well after the test had ended. Root cause was a race in `createSystemDataSource` (`packages/shared/src/database/data-source-system.ts`): the per-connection preamble was installed via `pool.on('connect', async (client) => { ... })`, but pg-pool emits `'connect'` synchronously and does NOT await async listeners. The listener's `SET ROLE perfana_system` was queued first; the caller's first query was queued next; the four `SELECT set_config('app.current_user_*', ...)` calls that grant `is_global_admin()` super-admin status queued last. PostgreSQL ran them in queue order, so the first query on every freshly-created pool connection executed with `current_user=perfana_system` (no `BYPASSRLS`) but no super-admin GUC set — RLS then stripped every row. Confirmed in postgres backend logs by enabling `log_statement=all` and observing the SELECT landing between `SET ROLE` and the GUC `set_config` calls on PIDs 1821/1822 at the same instant. The fix moves the role switch and GUC assignments to libpq's `options` startup parameter via `extra.options`, which Postgres processes from the StartupMessage BEFORE the connection becomes available to the client — eliminating the race entirely. The `pool.on('connect', ...)` hook and the pre-warmed-connection drain loop are removed; the post-init `SELECT current_user` sanity check is preserved so a missing `perfana_system` role still surfaces as a startup error. Verified end-to-end with 50 concurrent queries on freshly-recycled pool connections (`idleTimeoutMillis: 1`): 50/50 returned the expected rows; the prior code returned 0/50 under the same harness. Affected actors: `grafana-sync`, `worker`, `perfana-report`, `audit-partition-manager` — every one of them was silently filtering RLS-protected SELECTs on every fresh connection. `buildSystemConnectionPreamble` in `system-connection.ts` is left intact since the API's RLS test harness still consumes it.

## [0.2.47.71] - 2026-05-04

### Added
- **Audit logging on profile mutations (Phase 5a, PR14).** `Profile`, `ProfileGrafanaDashboard`, and `ProfileBenchmark` now emit `CREATE`/`UPDATE`/`DELETE` audit rows for every user-driven mutation through `ProfilesService` (createProfile/updateProfile/deleteProfile, createDashboard/updateDashboard/deleteDashboard, createBenchmark/updateBenchmark/deleteBenchmark). Profile changes drive what gets evaluated on every test run, so join-table mutations are treated as part of the profile rather than cascade noise. New `auditableFields` declarations on each of the three entities; `metadata` is excluded on `ProfileBenchmark` (free-form bag, mirrors PR13's `Benchmark`). Profile's cascade-delete child rows (`ProfileGrafanaDashboard`, `ProfileBenchmark`) are intentionally not individually audited — the parent DELETE row implies them. UPDATE handlers clone the pre-mutation entity via `Object.assign(new EntityClass(), entity)` so the audit dispatcher's prototype-walk to `auditableFields` resolves correctly on the diff. `updateDashboard` is the wrinkle — it uses `repo.update(id, updateData)` followed by a re-fetch, so the audit `before` is captured before the in-place mutations begin and the `after` is the re-fetched row. Spec gains 9 new audit assertions in a top-level `describe('audit logging')` block (3 per entity), with `invocationCallOrder` checks on every DELETE pinning the "log before mutation" ordering — also the first tests for `createProfile`/`updateProfile`/`deleteProfile`, which previously had no spec coverage. `profiles.service.ts` removed from `apps/api/.audit-migration-allowlist.json` (35 → 34 remaining).
- **Phase 5a remaining-work scope locked in plan + decisions docs.** A 2026-05-04 per-resource brainstorm walked the remaining 35 allowlist entries one by one and locked decisions for PRs 14–20 (profiles full CRUD, systems-under-test destructive only, deep-links org-scoped only, reports templates full CRUD + delete-only generated, benchmarks user-facing CRUD verification, expected-config-change repo-layer, and a final "policy exemptions" PR that adds `POLICY_EXEMPT` alongside the existing `INFRASTRUCTURE_EXEMPT` so the migration allowlist can finally reach `[]`). Captured in `docs/superpowers/audits/2026-05-02-audit-phase5a-decisions.md` § "2026-05-04 per-resource brainstorm" and `docs/superpowers/plans/2026-05-02-rbac-phase5a-audit-completion.md` § "Remaining migration PRs (PR 14 through Final)".

## [0.2.47.70] - 2026-05-04

### Fixed
- **Auto-provisioned SLOs (benchmarks) created by perfana-grafana-sync now show up in the audit log.** Previously the auto-config pipeline called `benchmarkRepo.create()` / `save()` directly with no `AuditService` injection anywhere in the grafana-sync app, so user-driven benchmark mutations through the API/UI showed up in `/audit-logs` but the auto-provisioning path that fires when a new test run lands did not. The bug slipped past the `audit-mutation-must-log` lint rule because that rule only scans `apps/api/`. The API's `AuditService` is request-scoped via nestjs-cls (`REQ_CTX`) and would silently skip in a background scheduler, so a new `GrafanaSyncAuditService` mirrors the API's diff/truncate semantics but stamps a fixed `system:grafana-sync` actor on every row (with `metadata.auth_type: "system"`) since this app has no HTTP request context. Same `auditableFields` contract on `Benchmark`, same `pickAuditable` / `diff` / `truncateOversizedFields` helpers — those were hoisted into `@perfana/shared/utils` so both audit dispatchers consume the same logic. `AutoConfigUpdatesService.insertBenchmarkBasedOnProfileBenchmark` now emits `logCreate` (new benchmark) or `logUpdate` (with a hydrated `Object.assign(new Benchmark(), existingBenchmark)` before-snapshot so the diff resolves against `Benchmark.auditableFields`) around the existing `benchmarkRepo.save()` calls, threading `organizationIdOverride: testRun.organizationId`. `AuditLog` registered in the grafana-sync TypeORM root and in `AutoConfigModule` via the new `AuditModule`. Specs: new `grafana-sync-audit.service.spec.ts` covers CREATE row, UPDATE diff over `auditableFields`, no-op skip when nothing changes, `organizationIdOverride` fallback, and the action+actor-only path for entities without `auditableFields`; existing `auto-config-updates.service.spec.ts` gained an `Audit logging` block asserting CREATE/UPDATE dispatch with the org override and the hydrated before-snapshot. Audit-diff helpers' tests moved alongside the relocated module to `packages/shared/src/utils/__tests__/audit-diff.spec.ts`. Follow-up tracked separately: extend `audit-mutation-must-log` to gate `apps/grafana-sync/` so this class of bypass cannot regress.

## [0.2.47.69] - 2026-05-04

### Added
- **System under test filter on the audit log view, with audit rows showing human-readable names instead of UUIDs.** Added the denormalized `system_under_test_id` column to `audit_logs` (nullable UUID with a partial index on `(system_under_test_id, timestamp DESC)`) and populated it at write time in `AuditService.dispatch` — for `SystemUnderTest` itself the SUT id is its own row id; for child entities the dispatcher reads whichever shape the entity exposes (`systemUnderTestId` camelCase like `TestRun` or `system_under_test_id` snake_case like `Benchmark`). Existing rows stay NULL; no backfill, the SUT filter just won't match audit history written before this version. Frontend audit log page (`/audit-logs`) gains a SUT autocomplete dropdown sourced from `/systems-under-test` (already RBAC-scoped server-side) plus a new "System under test" column that resolves the id → name from the same list. The Org column also resolves `organizationId` → name via `useOrganizations` (now enabled for every audit viewer, not just super-admins, so org-admins see real names instead of UUIDs).

### Changed
- **Audit log filter dropdowns now use real data instead of static lists.** Resource Type dropdown queries `SELECT DISTINCT resource_type FROM audit_logs` — org-admins get the set scoped to their accessible organizations, cross-org admins get the full set; either way the dropdown only lists types that actually have rows. User filter swapped from a free-text Keycloak-`sub` field to an MUI `Autocomplete` backed by the same `useUserSearch` hook the org/team `AddMemberDialog` uses, so the dropdown shows displayName + email. Organization filter is now gated on `caps.isSuperAdmin` (new boolean on the capabilities response — true for `perfana-admin` / `admin` / `super-admin`) instead of `scope === 'cross-org'`; system-admin / support keep cross-org visibility but lose the org-switching dropdown.
- **Audit log capabilities response gained `isSuperAdmin` and the `knownResourceTypes` field is now DB-backed.** `GET /api/audit-logs/capabilities` returns `isSuperAdmin: boolean` and computes `knownResourceTypes` from `AuditService.getDistinctResourceTypes(scopedOrgIds?)` instead of `AuditResourceRegistry.knownTypes()` — the registry still drives per-resource history lookups but the viewer's dropdown now reflects the real audit_logs table. AuditFilter (service + DTO) gained `systemUnderTestId?: string`; `audit-query.controller.ts` forwards it to the service which adds it to the `findAndCount` where clause.

### Fixed
- **Org-admins (DB-only role) no longer get 403 on the audit log view.** `GET /api/audit-logs` was guarded by `@Roles({ roles: [...GLOBAL_ADMIN_ROLES, 'super-admin', 'system-admin', 'support', 'org-admin'] })`, but `org-admin` is a database-only role stored in `organization_members.roles` JSONB and never reaches the JWT (the `RolesGuard` reads `realm_access.roles` + `resource_access[azp].roles` from the Keycloak token). Three of the other strings in that list — `super-admin`, `system-admin`, `support` — also don't exist as Keycloak realm roles in `perfana-prod`, so the only string that ever matched was `perfana-admin` via `GLOBAL_ADMIN_ROLES`. Org-admins like `test@perfana.io` (JWT roles `[perfana-user]`, `organization_members.roles=["org-admin"]`) were rejected by the role guard before the controller body's `isOrgAdminInAnyOrganization` DB check could run. Fix: drop `@Roles` from `findByFilter` entirely and authorize in the body — `Capability.SystemAuditRead` (capability ←→ Keycloak role mapping owned by `capabilities.constants.ts`) for cross-org callers, `AuthorizationService.isOrgAdminInAnyOrganization(userId)` for org-admins, `ForbiddenException` otherwise. Mirrors the gate `getCapabilities` already uses. Replaced the brittle "@Roles must include X" regression test with one asserting no `@Roles` metadata exists; added an explicit 403 test for non-admin / non-org-admin users.

## [0.2.47.68] - 2026-05-04

### Added
- **Audit logging for workload-level Apdex thresholds.** `PUT /api/test-runs/:id/apdex-threshold`, `PUT /api/test-runs/:id/transactions/:txn/apdex-threshold`, and `DELETE /api/test-runs/:id/transactions/:txn/apdex-threshold` now emit CREATE / UPDATE / DELETE rows into `audit_logs` like every other Phase 5a resource. Previously these endpoints used raw `INSERT … ON CONFLICT DO UPDATE` SQL that bypassed `AuditService` entirely and never populated the `organization_id`, `team_id`, `created_by`, or `updated_by` ownership columns either, so user-driven Apdex SLO threshold changes vanished from the audit trail and the rows landed orphaned of any tenant. Two new TypeORM entities (`WorkloadApdexThreshold`, `WorkloadTransactionApdexThreshold`) map onto the existing `workload_apdex_thresholds` and `workload_transaction_apdex_thresholds` tables — no schema migration needed, both tables already had ownership columns waiting to be used. `TestRunsApdexService` swapped its raw SQL paths for repo-based `findOne → save` (or `remove`) so we get a real before/after snapshot, inherits `organizationId`/`teamId` from the parent `SystemUnderTest` (matches the v0.2.47.66/.67 inherit-from-parent pattern), sets `created_by`/`updated_by` from the request user, and calls `auditService.logCreate` / `logUpdate` / `logDelete` with `organizationIdOverride` so the audit-log viewer can scope by tenant. Legacy rows that landed pre-fix with NULL ownership get backfilled on their next update — no data migration required, just touch the threshold once. `TestRunsModule` registers both entities in `TypeOrmModule.forFeature` and in `AuditResourceRegistry` under `workload-apdex-thresholds` and `workload-transaction-apdex-thresholds` so the per-resource audit history endpoint resolves them. New spec `test-runs-apdex.service.spec.ts` covers all five mutation paths: CREATE on first set, UPDATE with before/after diff on second set, ownership backfill for legacy rows, CREATE/UPDATE for transaction-level thresholds, DELETE with snapshot, and NotFoundException-without-audit-call when deleting a missing transaction threshold.

## [0.2.47.67] - 2026-05-03

### Fixed
- **API users can now create SLOs, deep links, presets, dashboards, instances, and templates via the UI without hitting `null value in column "organization_id" violates not-null constraint`.** v0.2.47.66 fixed one manifestation of this bug in `grafana-sync`. An audit of the API's 36 modules surfaced 17 more sites with the same root cause: TypeORM silently drops snake_case `organization_id` keys (or omits them entirely) when an entity property is camelCase `organizationId!:` mapped to column `organization_id`, so every INSERT into a Phase-4 NOT-NULL owned-resource column blew up the second a user tried to create one through the UI. Two sub-patterns: (1) **Inherit from parent** — load the parent SUT / Profile / GrafanaInstance / TestRun and copy `organization_id` + `team_id` onto the child entity. Applied to `BenchmarkMutationService` (`create`, `copyToScope`, `createApdexSlo`), `GraphPresetsService.create` (TestRun → SUT), `TrendsPresetsService.create` (TestRun → SUT), `ComparePresetsService.create` (TestRun → SUT, falls back to user when no test-run scope), `DeepLinksRepository.create` + `createGeneric` (SUT for system-scoped, Profile for generic; service-layer plumbed to load the parent and pass `{ organizationId, teamId }` into the repo), `NotificationsService.create` (SUT), `ApplicationDashboardsService.create` (SUT), `GrafanaDashboardsService.create` (GrafanaInstance), `ReportTemplateService.create` + `ReportGenerationService` inline ad-hoc template (SUT via `system_id`), `ProfilesService.addDashboardToProfile` + `addBenchmarkToProfile` (parent Profile loaded earlier in the function, reused). (2) **Default to user's first accessible org** — when a top-level resource accepts an optional `organizationId?:` from the DTO, fall through to `AuthorizationService.getAccessibleOrganizations(userId)[0]` and throw `ForbiddenException` if the user has zero accessible orgs. Applied to `GrafanaInstancesService.create`, `PyroscopeInstancesService.create`, `TracingInstancesService.create`, `AlertTagFiltersService.create`, `ProfilesService.createProfile` (each grew a small `resolveOrganizationId(dtoOrgId, userId)` helper that prefers the DTO value, falls back to first accessible org). Module wiring: `DeepLinksModule` registers `Profile`; `ReportsModule` registers `SystemUnderTest`; nine services inject parent repositories. All 17 sites use the camelCase `organizationId` key (matches the entity property) and set `teamId` from the parent so the child resource inherits the parent's team scope by default. Stale `// NOTE: organization_id and team_id will be set when Phase 4 adds those columns` comments removed from sites where the column is now populated. Tests: 2 new regression tests in `benchmark-mutation.service.spec.ts` assert `organizationId` is in the create payload AND that `organization_id` is absent (mirrors the v0.2.47.66 grafana-sync regression test). 11 existing service specs updated to mock the new parent repositories (mock `testRunRepo.findOne` returns a test run with `systemUnderTest: { organization_id, team_id }` populated; mock `systemRepo` / `profileRepo` / `grafanaInstanceRepo` return parent fixtures; `getAccessibleOrganizations` mock returns a non-empty array for tests that exercise the user-context fallback). Existing payload assertions extended to expect `organizationId` + `teamId` on the create call. `compare-presets` queryBuilder mocks gained `leftJoin` + `andWhere` for the test-run-scoped findAll path that was previously skipped (the new beforeEach default `testRun.findOne` mock made the path reachable). `npm run test` is green: 4394 passed, 20 skipped, 0 failed. `npm run type-check` is clean. The audit found 4 sites that were already correct (5 in `dynatrace.repository.ts` — all set `organizationId` from `ownership` or parent config; `metrics-sources.service.ts` — passes `dto.organizationId`; `systems-under-test.service.ts` — entity uses snake_case property so `organization_id:` works directly; `report-generation.service.ts:266`/`360` — `GeneratedReport` entity has no `organization_id` column at all). Lint-enforced and Phase 4 NOT-NULL-enforced means this class of bug now surfaces at compile time + DB constraint level, not silent-drop time.

## [0.2.47.66] - 2026-05-03

### Fixed
- **`grafana-sync` no longer fails to create benchmarks with `null value in column "organization_id" violates not-null constraint`.** `AutoConfigUpdatesService.insertBenchmarkBasedOnProfileBenchmark` was passing `organization_id` (snake_case) into `benchmarkRepo.create()`, but the `Benchmark` entity maps the property `organizationId` (camelCase) → DB column `organization_id` via TypeORM's `name:` option. TypeORM silently dropped the unknown `organization_id` property, so every INSERT went out without an org id and slammed into the NOT NULL constraint added by Phase 4 (commit c7d94ee, 2026-05-02). Fix: pass `organizationId: testRun.organizationId` (camelCase) and drop the now-impossible `|| null` fallback. Adds a regression test that asserts `benchmarkRepo.create` is called with the camelCase `organizationId` AND that `organization_id` is not present on the create args, so the silent-drop pattern can't reappear.

## [0.2.47.65] - 2026-05-03

### Fixed
- **Audit log viewer — `perfana-admin` users no longer get 403.** `GET /api/audit-logs` was gated by `@Roles({ roles: ['super-admin', 'system-admin', 'support', 'org-admin'] })`, but in this codebase `perfana-admin` is the global-admin role (per `SystemRole.GLOBAL_ADMIN` in `apps/api/src/constants/roles.constants.ts`). The `RolesGuard` does strict string matching, so any token holding `perfana-admin` was rejected with 403 before the controller body's capability check could run — even though the body already authorizes via `Capability.SystemAuditRead`, which `GLOBAL_ADMIN_CAPABILITIES` grants to global admins. Fix: spread `GLOBAL_ADMIN_ROLES` (the canonical `['perfana-admin', 'admin']` constant) into the `@Roles` allowed-list. Adds a regression test that asserts the metadata via `Reflector` so the gate can't silently regress in the future. Also unblocks 42 pre-existing failing tests in `test-runs-config.service.spec.ts` by adding the missing `AuditService` mock provider that PR #244 (Phase 5a PR13) forgot to wire into the spec's test module.

## [0.2.47.64] - 2026-05-03

### Added
- **Audit log viewer (Phase 5a MVP).** Backend gains a capabilities-probe endpoint and the frontend gains a sidebar item + dedicated viewer page. Backend: `GET /api/audit-logs/capabilities` returns `{ canView, scope: 'cross-org' | 'org-scoped' | 'none', accessibleOrganizationIds, knownResourceTypes }`. Capabilities are derived the same way the existing `GET /api/audit-logs` endpoint scopes results — `Capability.SystemAuditRead` (super-admin / system-admin / support) → `cross-org`; `isOrgAdminInAnyOrganization` → `org-scoped` with the user's accessible org ids attached; everything else → `canView: false`. The probe is intentionally non-throwing: unauthenticated callers fail through `KeycloakEnhancedAuthGuard` like any other endpoint, but anyone authenticated who lacks audit access gets `canView: false` instead of a 403, so the frontend can hide the sidebar item silently. `knownResourceTypes` is sourced from `AuditResourceRegistry.knownTypes()` and is what populates the resource-type filter dropdown on the viewer page. Frontend: new `lib/audit-api.ts` typed client (capabilities probe, filterable list, per-resource history) routed through `authenticatedFetch`; new `lib/hooks/use-audit-logs.ts` TanStack Query hooks. Sidebar (`components/layout/sidebar.tsx`) probes capabilities at mount time with a `useEffect` keyed on the authenticated user; when `canView` is true, an "Audit Logs" item appears in the Configuration group. New page `apps/web/app/audit-logs/page.tsx` renders the filter bar (resource-type dropdown populated from `knownResourceTypes`, action dropdown, organization dropdown for cross-org callers, user-id / resource-id text inputs, datetime-local from/to pickers) plus a paginated `MUI` table with expandable rows. Each row shows timestamp / actor (email + userId) / action chip / resource type / resource id / org id; expanding a row reveals a per-field before/after diff table built from `changes.fields` + `changes.before` / `changes.after`, plus the request_id metadata when present. CREATE / UPDATE / DELETE rows are color-coded (success / info / error). `org-scoped` callers get a header note showing the count of accessible organizations; the org-filter dropdown is hidden for them since the backend already pre-scopes their results. Pagination is server-driven (`limit` / `offset`, `PAGE_SIZE = 50`). Tests: 3 new audit-query.controller spec assertions for the capabilities probe (cross-org / org-scoped / none branches) and 5 new web-side assertions for the API client (path/query construction, silent capabilities-probe fallback, error message passthrough, URL-encoding on the per-resource history endpoint).

## [0.2.47.63] - 2026-05-03

### Added
- **RBAC Phase 5a — audit logging in the results-impacting config group: `benchmark-mutation` + `test-runs-config` + `test-runs-metrics` (PR13).** Ninth service migration off the audit-migration allowlist. The bundle is the **results-impacting config group**: every entity in this PR retroactively changes pass/fail or anomaly verdicts on already-completed test runs, which is exactly the audit story compliance asks about ("did someone loosen the SLO / change the compare config to make a failing run pass after the fact?"). Five new `auditableFields` declarations: `Benchmark` (35 SLO-definition fields covering scope keys, source/dashboard linkage, panel identity, the metric-SLO triple `evaluate_type`/`requirement_operator`/`requirement_value`, the Apdex SLO triple `apdex_threshold_ms`/`min_apdex_score`/`include_failed_requests`, behavior knobs `enabled`/`valid`/`exclude_ramp_up_time`/`average_all`/`match_pattern`/the `validate_with_default_if_no_data*` pair, the embedded `configuration` jsonb that carries the threshold spec, plus alerting `alert_on_breach`/`alert_channels` and `baseline_test_run_id` — `metadata` excluded as a free-form bag); `DsCompareConfig` (8 fields covering the (sut, env, workload, dashboard, panel, metric, metrics_source) tuple plus the `config_data` jsonb — the actual ADAPT thresholds — `config_hash`/`last_modified_at` excluded as derived caches); `ProvisionedTemplateDsCompareConfig` (14 fields for golden-path templates: scope, dashboard linkage, panel/metric identity, the `regex`/`higher_is_better`/`metric_classification` triple, plus `config_overrides`); `ExpectedConfigChange` (6 fields: scope keys + `config_key`/`expected_value`/`description`); `SparseMetricExclusion` (6 fields: scope keys + `dashboard_label`/`metric_name`/`reason`). Ownership / org / team and timestamps excluded across all five (emitted via dedicated audit-row columns). Org-id resolution: `Benchmark`, `ExpectedConfigChange`, and `SparseMetricExclusion` use camelCase property / snake_case column for `organization_id`, so every call site passes `organizationIdOverride: row.organizationId`; `DsCompareConfig` and `ProvisionedTemplateDsCompareConfig` use snake_case `organization_id` directly, so `AuditService.dispatch` reads it off the ref without override. `BenchmarkMutationService` carries the full surface: `create` / `createApdexSlo` (CREATE after `repo.save`); `update` / `updateApdexSlo` (UPDATE with cloned before-snapshot from a direct `repo.findOne` — the existing `queryService.findOne` returns a mapped DTO and would lose the constructor prototype `AuditService.dispatch` consults); `delete` (DELETE *before* the FK null-out and the actual `repo.delete`); `copyToScope` emits one CREATE per persisted new row and one UPDATE (with cloned-before, refetched-after) per overwrite — per the audit architecture's "one row per entity" rule. `TestRunsConfigService.createExpectedConfigChange` and `.createSparseMetricExclusion` are upserts; the existing find-or-create-or-update flow now logs CREATE on the new branch and UPDATE on the existing branch (with cloned before-snapshot via `Object.assign(new Entity(), row)`). The two delete methods (`deleteExpectedConfigChange`, `deleteSparseMetricExclusion`) previously deleted by composite key without a pre-fetch; the migration adds a `repo.findOne` so the audit row captures the pre-delete state, gated by `if (existing)` to skip the audit when no row matches the composite key. `TestRunsMetricsService` covers four user-facing paths: `classifyMetric` upsert (CREATE/UPDATE on `ProvisionedTemplateDsCompareConfig`), `createOrUpdateDsCompareConfig` new branch (CREATE on `DsCompareConfig`; the existing-config branch delegates to `updateDsCompareConfig` which logs UPDATE — single audit row per logical user action, no double-logging), `updateDsCompareConfig` (UPDATE with cloned before-snapshot), `deleteDsCompareConfig` (DELETE before `repo.delete`). `applyGoldenPathClassifications` is intentionally **not** audited — it's a worker-driven system action triggered on test-run completion (with `created_by: 'system:golden-path'`), bucket-2 pattern: auditing it would generate noise on every test-run ingestion without compliance value. The bucket-2 decision is pinned by an explicit "does NOT audit" assertion in the spec. Module wiring: `BenchmarksModule` adds `AuditModule` import + `OnModuleInit` that registers `'benchmarks' → Benchmark`; `TestRunsModule` (already wired in PR8 for `'test-runs' → TestRun`) gets four additional registrations — `'expected-config-changes' → ExpectedConfigChange`, `'sparse-metric-exclusions' → SparseMetricExclusion`, `'ds-compare-configs' → DsCompareConfig`, `'provisioned-template-ds-compare-configs' → ProvisionedTemplateDsCompareConfig`. Allowlist 38 → 35 (removed all three service entries). Snapshot test re-recorded — picked up all five entities (each owns an `organization_id` column) with the new `auditableFields` arrays. 28 new audit-focused spec assertions across one new spec file (`benchmark-mutation.service.spec.ts`, full audit-only coverage of the 5 mutation paths: `create`/`createApdexSlo` CREATE invariants, `update`/`updateApdexSlo` UPDATE with cloned-before, `delete` with `invocationCallOrder` ordering vs. `repo.delete`), one new spec file (`test-runs-config.service.spec.ts`, both create-and-update branches and both deletes for both entities, including a "skip-audit-on-no-match" assertion for the composite-key deletes), and one new top-level describe block in the existing `test-runs-metrics.service.spec.ts` (the four user-facing paths plus an explicit "applyGoldenPathClassifications does NOT audit" assertion). Burndown updated.

## [0.2.47.62] - 2026-05-03

### Added
- **RBAC Phase 5a — audit logging in `graph-presets` + `trends-presets` + `compare-presets` (PR12).** Eighth service migration off the audit-migration allowlist; closes the user-owned customization presets group. Three new `auditableFields` declarations on the corresponding entities: `GraphPreset` (`name`, `description`, `testRunId`, `userId`, `seriesConfig`, `chartOptions`, `isGlobal` — covers identity / scope, the JSON content of the preset, and the global-visibility flag); `TrendsFilterPreset` (13 fields covering identity, the generic-vs-specific type discriminator, dashboard / metrics-source / panel scope, evaluate-type and source metadata, the JSON `seriesConfig`, the `createdForTestRunId` scope key, and the global-visibility flag); `CompareFilterPreset` (15 fields, same shape as Trends but with the additional `seriesSearchText` / `showPercentiles` / `baselineTestRunId` axes that compare-mode requires). Across all three entities the ownership / org / team columns and `created_at`/`updated_at` timestamps are intentionally excluded — they're emitted via dedicated columns on the audit row rather than the diff. All three entities use camelCase property / snake_case column naming for `organization_id` (`@Column({ name: 'organization_id' }) organizationId!`), so every audit call site passes `organizationIdOverride: row.organizationId` (matching the precedent established in PRs 8–11). `GraphPresetsService` and `TrendsPresetsService` are CREATE/DELETE-only — neither service exposes an update endpoint (preset edits go through delete-and-recreate from the UI). `ComparePresetsService` carries the full CRUD: CREATE after `repo.save`, UPDATE with explicit pre-update entity load (the existing service-layer `findOne` returns a DTO and would lose the constructor prototype that `AuditService.dispatch` consults to resolve `auditableFields`, so the new code does its own `repo.findOne` for the before-snapshot), DELETE before `repo.delete` with the same DTO-loss workaround. The cost is one extra SELECT on the compare-preset update / delete paths; the benefit is faithful before/after diffs without needing to teach `AuditService` about DTO mappings. The three modules each import `AuditModule` and register their resource type — `graph-presets` → `GraphPreset`, `trends-presets` → `TrendsFilterPreset`, `compare-presets` → `CompareFilterPreset` — with `AuditResourceRegistry` in `onModuleInit`, wiring the per-resource audit-history endpoint for all three. Allowlist 41 → 38 (removed all three preset service entries). Snapshot test re-recorded — picked up all three entities (each owns an `organization_id` column) with the new `auditableFields` arrays. 7 new audit-focused spec assertions across two new spec files (`graph-presets.service.spec.ts`, `trends-presets.service.spec.ts`) and one new top-level describe block in `compare-presets.service.spec.ts` cover the audit invariants: CREATE/UPDATE/DELETE log shapes with `organizationIdOverride`, before/after diff carry-through on the compare update, and `invocationCallOrder` checks for "log before mutation" on every DELETE. Burndown updated.

## [0.2.47.61] - 2026-05-03

### Added
- **RBAC Phase 5a — audit logging in `pyroscope-instances` + `tracing-instances` + `tracing-services` (PR11).** Seventh service migration off the audit-migration allowlist; closes the sensitive-credentials integrations group (api-keys → org/teams → test-runs → dynatrace → grafana → **pyroscope+tracing**). Three new `auditableFields` declarations: `PyroscopeInstance` (`label`, `pyroscopeUrl`, `backendUrl`, `pyroscopeStandAlone` — no credential columns on this entity); `TracingInstance` (`label`, `tracingUrl`, `tracingApiUrl`, `tracingUi`, `tracingIframeAllowed` — likewise no credentials); `TracingService` (`systemUnderTestId`, `testEnvironment`, `workload`, `tracingInstanceId`, `serviceNames` — the scoping keys that determine which tracing service applies to a given test run, the FK to `TracingInstance`, and the service-name list itself). All three entities exhibit the camelCase property / snake_case column mismatch (`@Column({ name: 'organization_id' }) organizationId!`), so every audit call site passes `organizationIdOverride: row.organizationId` — matching the GrafanaInstance / Dynatrace / TestRun precedent. `PyroscopeInstancesService` and `TracingInstancesService` follow the now-standard shape: `logCreate` after `repo.save`, `logUpdate` with cloned `before` snapshot via `Object.assign(new Entity(), entity)` to keep the prototype intact for the audit diff (the in-place mutation that follows would otherwise overwrite the pre-update field values), `logDelete` before `repo.remove`. `TracingServicesService.createOrUpdate` is the wrinkle in this PR — the upstream `TracingServiceRepository.createOrUpdate` performs an internal `findByExactMatch`-then-upsert flow, so the service does its own pre-check via the same `findByExactMatch` to split CREATE vs UPDATE for accurate audit semantics. The cost is one extra SELECT on this rarely-called write path; the benefit is "one row per logical user action" auditing instead of always-CREATE-shaped rows that would mislabel updates. `TracingServicesService.update` clones `before` from the existing-row check before delegating to the base repository's in-place `update`, then re-fetches `after` via `findById` for the diff. `TracingServicesService.delete` logs DELETE before `repository.delete`. The three modules each import `AuditModule` and register their resource type — `pyroscope-instances` → `PyroscopeInstance`, `tracing-instances` → `TracingInstance`, `tracing-services` → `TracingService` — with `AuditResourceRegistry` in `onModuleInit`, wiring the per-resource audit-history endpoint for all three. Allowlist 44 → 41 (removed all three service entries). `tracing-service.repository.ts` stays on the allowlist as a separate workstream — repository-layer audit migration is its own pass, mirrors the api-keys / dynatrace precedents. Snapshot test re-recorded — picked up all three entities (each owns an `organization_id` column) with the new `auditableFields` arrays. 10 new audit-focused spec assertions across the three new spec files (one per service) cover CREATE/UPDATE/DELETE log invariants, the createOrUpdate CREATE-vs-UPDATE branch (including verifying that no logCreate fires on the UPDATE path and vice-versa), before/after diff carry-through, and `invocationCallOrder` ordering checks for "log before mutation" on delete. Burndown updated.

## [0.2.47.60] - 2026-05-03

### Added
- **RBAC Phase 5a — audit logging in `grafana-instances` + `grafana-dashboards` + `application-dashboards` (PR10).** Sixth service migration off the audit-migration allowlist; second of the sensitive-credentials integrations group, parallel to PR9 (Dynatrace) and bundled into one PR per the same shape. Three new `auditableFields` declarations: `GrafanaInstance` (`label`, `client_url`, `server_url`, `orgId`, `username`, `snapshotInstance` — `apiKey` and `password` are encrypted credentials and excluded by name); `GrafanaDashboard` (12 dashboard-identity fields covering grafana linkage, uid/slug/name/uri, templating variables, tags, sut-membership array, and template metadata — `panels`, `variables`, `grafanaJson`, `applicationDashboardVariables`, `templateTestRunVariables`, `templateCreateDate`, and `updated` are bulk Grafana-derived JSON re-synced by the grafana-sync service and excluded as system-derived: re-recording them on every sync would generate massive, noisy diffs without compliance value); `ApplicationDashboard` (14 fields covering SUT/environment scope, grafana linkage, dashboard identity, tags, variables, replaced templating variables, snapshot timeout, and the metrics-source link). All three entities use camelCase property / snake_case column naming for `organization_id` (matching the TestRun + Dynatrace precedent), so every audit call site passes `organizationIdOverride: row.organizationId` — `AuditService.dispatch` cannot read `ref.organization_id` directly. `GrafanaInstancesService.update` mutates the loaded entity in place before `repo.save`, so the service captures a `before` snapshot via `Object.assign(new GrafanaInstanceEntity(), entity)` to keep the prototype intact for the audit diff. `GrafanaDashboardsService.update` and `.remove` previously delegated to the service-layer `findOne` for the access check (which mapped entity → DTO and lost the prototype, so the audit pipeline couldn't resolve `auditableFields`); the migration replaces those calls with a direct `repo.findOne` + `verifyOrgAccess(entity, …)` — same DB round-trip count, same access semantics, but the entity instance is preserved for the audit diff. `ApplicationDashboardsService.delete` logs DELETE for the `ApplicationDashboard` *before* the cascade transaction (mirrors PR8/PR9's "log before mutation" pattern); when `deleteFromGrafana=true` and the linked `GrafanaDashboard` is unused by any other SUT (orphaned), it additionally logs DELETE for the sibling `GrafanaDashboard` row. Cascaded `benchmarks` deletions and the `usedBySut` array maintenance update on `GrafanaDashboard` are intentionally not individually audited — same bucket-2 reasoning as test-runs (cascade noise at ingestion-rate volumes, implied by the parent DELETE row). `GrafanaModule` now imports `AuditModule` and registers all three resource types — `grafana-instances` → `GrafanaInstance`, `grafana-dashboards` → `GrafanaDashboard`, `application-dashboards` → `ApplicationDashboard` — with `AuditResourceRegistry` in `onModuleInit`, wiring the per-resource audit-history endpoint for all three. Allowlist 47 → 44 (removed all three grafana service entries). Snapshot test re-recorded — picked up all three entities (each owns an `organization_id` column) with the new `auditableFields` arrays. 10 new spec assertions across the three service spec files cover CREATE/UPDATE/DELETE log invariants, before/after diff carry-through (including the cloned-`before` for the in-place-mutation update path on grafana-instances), `logDelete` ordering before the repository delete (invocationCallOrder check) or before the cascade transaction starts (txn-not-yet-started flag check), and a sibling-DELETE assertion on `application-dashboards.delete` when the linked GrafanaDashboard is orphaned. Burndown updated.

## [0.2.47.59] - 2026-05-03

### Added
- **RBAC Phase 5a — audit logging in `dynatrace` (PR9).** Fifth service migration off the audit-migration allowlist; first of the sensitive-credentials integrations group. Three new `auditableFields` declarations: `DynatraceConfig` (`host`, `label`, `dynatraceType`, `perfanaTestRunIdAttribute`, `perfanaRequestNameAttribute` — `apiToken` and `platformApiToken` are encrypted credentials and excluded by name), `DynatraceQuery` (14 query-definition fields covering parent linkage, scope keys, panel identity, the DQL itself, and metric naming/template-variable metadata — `metricsSourceId` excluded because it's derived from a repository-side upsert, not user input), and `DynatraceEntityMapping` (8 mapping-definition fields). `DynatraceService` injects `AuditService` and emits `auditService.log{Create,Update,Delete}` for all 10 user-facing mutations: config CRUD (`create`, `update`, `delete`), query CUD (`createQuery`, `createQuerySmart`, `bulkImportQuery`, `updateQuery`, `deleteQuery`), and entity-mapping CD (`createEntityMapping`, `deleteEntityMapping`). All three entities exhibit the same camelCase property / snake_case column mismatch as `TestRun` (`@Column({ name: 'organization_id' }) organizationId!`), so every Dynatrace audit call passes `organizationIdOverride: row.organizationId` — the dispatch cannot read `ref.organization_id` directly. The query/mapping repository helpers return mapped DTO objects (via `mapEntityToDtoFields` / `mapEntityMappingToDtoFieldsWithLabel`) rather than entity instances — so the service wraps each DTO with `Object.assign(new DynatraceQuery(), dto)` (and the `DynatraceEntityMapping` analog) before handing it to `AuditService`. This restores the prototype so `AuditService.dispatch`'s `ref.constructor.auditableFields` lookup resolves to the declared array; the two helpers `toQueryAuditRef` / `toMappingAuditRef` localize the wrapping at the top of the service. `bulkImportQuery` shared-UUID mode emits one `logCreate` per persisted row (per the audit architecture's "one row per entity" rule); the non-shared mode delegates to `createQuerySmart` per row, which already emits its own audit row. `createHostMetricQueries` is intentionally not directly audited — it calls `createQuery` per metric (already covered) and additionally invokes `repository.ensureArtificialDashboardExists` and `repository.createDsCompareConfigForMetric`, both of which mutate via raw `manager.query('INSERT …')` against `grafana_dashboards` / `application_dashboards` / `ds_compare_config` (system-derived bootstrap rows, bucket-2 pattern). DELETE handlers (`delete`, `deleteQuery`, `deleteEntityMapping`) emit `logDelete` *before* the repository call (mirrors PR6/PR7/PR8 ordering) so the diff captures the pre-delete state and the audit envelope reads the still-extant entity. `DynatraceModule` now imports `AuditModule` and registers three resource types — `dynatrace-configs` → `DynatraceConfig`, `dynatrace-queries` → `DynatraceQuery`, `dynatrace-entity-mappings` → `DynatraceEntityMapping` — with `AuditResourceRegistry` in `onModuleInit`, wiring the per-resource audit-history endpoint for all three. Allowlist 48 → 47 (removed `dynatrace.service.ts`). `dynatrace.repository.ts` stays on the allowlist as a separate workstream — repository-layer audit migration is its own pass, mirrors the api-keys precedent. Snapshot test re-recorded — picked up all three Dynatrace entities (each owns an `organization_id` column) with the new `auditableFields` arrays. 11 new spec assertions across the three entities cover CREATE/UPDATE/DELETE log invariants, before/after diff carry-through, the `logDelete`-before-`repository.delete` ordering (invocationCallOrder check), and bulk-import per-row audit fan-out. Burndown updated.

## [0.2.47.58] - 2026-05-03

### Added
- **RBAC Phase 5a — audit logging in `test-runs` mutation handlers (PR8, bucket 1).** Fourth migration off the audit-migration allowlist; the marquee high-volume case. Wires `AuditService` into 7 of the 8 user-facing TestRun mutation handlers: `create-test-run`, `update-test-run`, `update-adapt-config`, `update-tags`, `update-annotations`, `update-analysis-start-offset`, and `delete-test-run`. `init-test.handler.ts` is intentionally not wired — it generates a unique `test_run_id` string and may auto-create a SystemUnderTest via the lookup service, but it does not mutate `TestRun`. `TestRun.auditableFields` declares 16 user-mutable fields covering identity (`testRunId`), test outcome (`completed`, `abort`, `abortMessage`, `consolidatedResult`), test config (`adaptConfig`, `analysisStartOffset`, `duration`, `plannedDuration`, `variables`, `expires`, `expired`), CI metadata (`applicationRelease`, `ciBuildResultsUrl`), and editorial annotations (`annotations`, `tags`); excludes immutable axes (`id`, `systemUnderTestId`, `testEnvironment`, `workload`), timestamps that bump on every save, ownership tracking, and system-derived fields (`status`, `isStale`, `staleDetectedAt`, `valid`, `reasonsNotValid`, `dataWarnings`, `deepLinks`, `deletionStatus`). Critical wrinkle: the TestRun entity's `organization_id` column maps to the camelCase property `organizationId`, which `AuditService.dispatch` cannot read from `ref.organization_id` directly — every TestRun call site passes `organizationIdOverride: testRun.organizationId`. The four raw-SQL update handlers (`update-tags`, `update-annotations`, `update-analysis-start-offset`, `update-test-run`'s second path) are not on the lint allowlist (the matcher is `repo|Repository|manager.<MUTATION_METHODS>`, which doesn't catch raw `dataSource.query`), but they're wired anyway because they're user-facing TestRun mutations. UPDATE handlers that previously did a slim `select: ['id']` existence check now load the full row to seed the audit diff. DELETE handler emits `logDelete` *before* the cascade transaction (mirrors PR6's org-delete pattern); cascaded child-table deletions (`ds_change_points`, `check_results`, `ds_*`, `transactions`, `requests_raw`, `virtual_users`, etc.) intentionally not individually audited — they're implied by the `test_runs` delete and the raw-SQL `manager.query('DELETE …')` calls would not surface to the audit lint rule's matcher. `TestRunsModule` imports `AuditModule` and registers `'test-runs' → TestRun` with `AuditResourceRegistry` in `onModuleInit`. Allowlist 51 → 48 (removed the 3 lint-flagged handlers; the 4 raw-SQL handlers were never on it). `TestRun.auditableFields` pinned by the snapshot. 15 new spec assertions in `apps/api/src/modules/test-runs/__tests__/handlers-audit.spec.ts` cover create/update/delete log invariants for all 7 wired handlers, including the override, the before-snapshot pattern for raw-SQL updates, and "log before mutation" ordering for delete. Buckets 2 (system-derived analytics writes — anomaly, changepoint, dashboard-query, stale-detection, lookup) and 3 (sub-resource CRUD — config, metrics, repositories) deferred per a decision-document section now in the audit decisions doc.

## [0.2.47.57] - 2026-05-03

### Added
- **RBAC Phase 5a — audit logging in `teams` + `team-members` (PR7).** Third service migration off the audit-migration allowlist, parallel to PR6. `Team.auditableFields = ['name', 'description', 'organization_id'] as const` and `TeamMember.auditableFields = ['user_id', 'roles', 'team_id'] as const`. The org-context resolution is inverted relative to PR6: Team rows carry `organization_id` natively so `AuditService.dispatch` picks it up without override; TeamMember rows carry only `team_id` (no `organization_id` column) and need `organizationIdOverride: member.team.organization_id` (resolved via the eagerly-loaded `team` relation in `findOne` / `findByTeamAndUser`) so org-admin scoped audit queries see membership events. `TeamsService` emits `logCreate(savedTeam)` after persist, `logUpdate(before, after)` with a cloned pre-mutation snapshot (so the post-`Object.assign` row doesn't alias `before`), and `logDelete(team)` before `repo.remove`. `TeamMembersService` emits `logCreate(savedMember, { organizationIdOverride: team.organization_id })` after `addMember` persist, `logUpdate(before, after, { organizationIdOverride: member.team.organization_id })` on `updateMemberRoles` (with `roles` array cloned into `before` so the diff is preserved), and `logDelete(member, { organizationIdOverride: member.team.organization_id })` *before* `repo.remove` in both `removeMember(id)` and `removeMemberByTeamAndUser(teamId, userId)`. `Team`'s `restrict_to_team_members` flag is intentionally excluded from `auditableFields` — it's a visibility hint, not a security boundary, and would add diff noise without compliance value. `TeamsModule` now imports `AuditModule` and registers both `'teams' → Team` and `'team-members' → TeamMember` with `AuditResourceRegistry` in `onModuleInit`, wiring the per-resource audit-history endpoint for both. Allowlist 53 → 51. Snapshot test re-recorded — picked up `Team` only; `TeamMember` is excluded from the snapshot because the snapshot scope is "entities with an `organization_id` column" (mirrors PR6's trade-off in reverse: there it was Organization that fell outside the snapshot). 16 new spec assertions across the two services (new `teams.service.spec.ts` + extended `team-members.service.spec.ts`) cover create/update/delete log invariants, including org-override resolution from the team relation and the "log fires before mutation" ordering for delete. Both `Team` and `TeamMember` are cast `as unknown as OwnedResource` at call sites (neither formally `implements OwnedResource` — Team lacks `created_by`, TeamMember lacks both `created_by` and `organization_id`); `AuditService.dispatch` only reads `id` and `organization_id` so the cast is sound. Burndown updated.

## [0.2.47.56] - 2026-05-03

### Added
- **RBAC Phase 5a — audit logging in `organizations` + `organization-members` (PR6).** Second service migration off the audit-migration allowlist. `Organization.auditableFields = ['name', 'description'] as const` and `OrganizationMember.auditableFields = ['user_id', 'roles', 'organization_id'] as const`. `OrganizationsService` injects `AuditService` and emits: `logCreate(org, { organizationIdOverride: org.id })` after persist; `logUpdate(before, after, { organizationIdOverride: id })` with a cloned pre-mutation snapshot so the diff is real (not aliased to the post-`Object.assign` row); `logDelete(org, { organizationIdOverride: id })` *before* the cascade transaction (so the audit envelope reads the still-extant entity, and the org-DELETE row precedes the cascaded raw-SQL deletions of teams/SUTs/test_runs/organization_members — which are intentionally not individually audited because they are implied by the org delete and `manager.query('DELETE …')` would not surface to the lint rule's `repo|Repository|manager.<MUTATION_METHODS>` matcher anyway). `OrganizationMembersService` injects `AuditService` and emits `logCreate(savedMember)` after `addMember` persist, `logUpdate(before, after)` on `updateMemberRoles` (with `roles` array cloned into `before` so the diff is not lost), and `logDelete(member)` *before* `repo.remove` in both `removeMember(id)` and `removeMemberByOrganizationAndUser(orgId, userId)`. `OrganizationsModule` now imports `AuditModule` and registers both `'organizations' → Organization` and `'organization-members' → OrganizationMember` with `AuditResourceRegistry` in `onModuleInit`, wiring the per-resource audit-history endpoint for both. Allowlist 55 → 53 (removed both organization-related entries). Snapshot test re-recorded — picked up `OrganizationMember` only; `Organization` is excluded because the snapshot scope is "entities with an `organization_id` column" (Organization is the root of the access-control hierarchy, so its `auditableFields` stays unpinned by that snapshot — accepted trade-off, deviation from the snapshot scope is out of PR6). 11 new spec assertions across the two services cover the create/update/delete log invariants, including the "log fires before mutation" ordering for delete and "no log on validation failures / not-found / unauthorized" guards. Both `Organization` and `OrganizationMember` are cast `as unknown as OwnedResource` at call sites — neither formally `implements OwnedResource` (Organization has no `organization_id` column at all; OrganizationMember has no `created_by`) — and `AuditService.dispatch` only reads `id` and `organization_id` so the cast is sound. Burndown updated.

## [0.2.47.55] - 2026-05-03

### Added
- **RBAC Phase 5a — audit logging in `api-keys` (PR5).** First service migration off the audit-migration allowlist. `ApiKey` now declares `static auditableFields = ['description', 'roles', 'validUntil', 'organization_id'] as const` — the bcrypt `apiKey` hash and the per-auth `lastUsed` timestamp are deliberately excluded (credential material + write-amplification noise). `ApiKeysService` injects `AuditService` and emits `logCreate(apiKey)` after persist + cache and `logDelete(apiKey)` before cache invalidation and `repo.delete`. `ApiKeysModule` imports `AuditModule` and registers `'api-keys' → ApiKey` with `AuditResourceRegistry` in `onModuleInit`, wiring the per-resource audit-history endpoint (`GET /api/audit-logs/resource/api-keys/:id`). Allowlist is now 55 entries (down from 56). Snapshot test re-recorded; 4 new spec assertions cover the create/delete log invariants (including the "log fires before mutation" ordering for delete and "no log on validation failures" for both paths). `ApiKey` does not formally `implements OwnedResource` because `created_by?` remains nullable on legacy keys — call sites cast `as unknown as OwnedResource`; `AuditService.dispatch` only reads `id` and `organization_id` so the cast is sound. The `api-key.repository.ts` data-access layer stays on the allowlist — repository-level audit migration is a separate workstream from the service-layer one. Burndown updated.

## [0.2.47.54] - 2026-05-03

### Added
- **Local pre-flight lint gate** (`npm run preflight` = `turbo run lint type-check`) wired to `git push` via `.githooks/pre-push`. The `prepare` script auto-installs the hook on `npm install` (`git config core.hooksPath .githooks`). Mirrors gstack `/ship`'s pre-flight pattern so PR-time regressions get caught locally — turbo cache typically resolves in under a second on warm trees, far faster than waiting on CI. Bypass: `git push --no-verify`.

### Fixed
- **Worker lint regression** — `apps/worker/src/schedulers/AuditPartitionManager.ts:69` had a single-line `if (!m) continue;` that violated the worker's `curly` ESLint rule. Introduced by PR2 (#230); slipped past because the dormant CI workflow didn't run. Wrapped the body in braces.
- **Web lint regression** — `app/integrations/components/IntegrationCard.test.tsx` (and other test files) were causing `@typescript-eslint/parser` to fail with a `parserOptions.project` error because the web `tsconfig.json` excludes `**/*.test.tsx`. Long-standing — undetected since PR #183. Added the standard test-file `ignorePatterns` block to `apps/web/.eslintrc.json`.

## [0.2.47.53] - 2026-05-03

### Changed
- **`AuditQueryController` migrated off `authzService.isGlobalAdmin()`** to capability-based reasoning (`Capability.SystemAuditRead`). The cross-org-vs-scoped branch in `findByFilter` now reads the user's capabilities via `authz.getCapabilities(userId, roles, null)` and checks for `SystemAuditRead` (granted only to global admins via `GLOBAL_ADMIN_CAPABILITIES`). Behavior unchanged: super-admin / system-admin / support still see cross-org rows; org-admin still scoped to accessible organizations. Restores `apps/api/.rbac-migration-allowlist.json` to empty — Phase 3c stays closed.

## [0.2.47.52] - 2026-05-03

### Added
- **RBAC Phase 5a — audit migration guard rule + drift detection (PR4).** Lays the Phase-3-style enforcement scaffolding for the upcoming service-layer audit migration:
  - **`audit-mutation-must-log` ESLint rule** (`apps/api/eslint-rules/audit-mutation-must-log.js`) — flags any service `MethodDefinition` that calls a mutation method (`save`/`delete`/`remove`/`update`/`insert`) on a `repo|Repository|manager` receiver without a paired `auditService.log{Create,Update,Delete}` call in the same method body. Mirrors the structure of `no-direct-is-global-admin`: hardcoded `INFRASTRUCTURE_FILES` (audit service+module, `AuthorizedBaseService`, `TypeOrmBaseRepository`), JSON allowlist (`apps/api/.audit-migration-allowlist.json`), per-method scan with circular-`parent`-safe AST traversal. Registered as `error` in `apps/api/.eslintrc.js`; spec/test files exempt via `overrides`.
  - **Seed allowlist (50 entries)** generated from a static scan of every service file under `apps/api/src` that mutates an `OwnedResource` entity. Six query-builder sites (`createQueryBuilder().delete()` / `.insert()`) the plan's grep regex didn't match were added after the initial lint surfaced them.
  - **`auditableFields` snapshot test** (`packages/shared/src/entities/__tests__/auditable-fields.snapshot.spec.ts`) — enumerates every TypeORM entity that owns an `organization_id` column (45 entities) and pins each one's current `auditableFields` declaration. Initially every entity maps to `null`; declarations land in PR 5+. Adding/changing a declaration surfaces as a snapshot diff and forces a deliberate "log this" or "redact" review per Q10.
  - **Allowlist JSON validity smoke test** (`apps/api/src/__tests__/audit-migration-allowlist.spec.ts`) — every CI run validates the allowlist parses cleanly, every entry resolves to an existing file under `apps/api/src`, no duplicates, POSIX paths only.
  - **Burndown audit doc** (`docs/superpowers/audits/2026-05-02-audit-phase5a-decisions.md`) — self-contained reference: spec decisions Q1–Q11, the rule's `INFRASTRUCTURE_FILES` set, seed burndown table (56 / 0 / 56), priority migration order. Update on every migration PR.
  - **Drift `/schedule` agent** (`docs/superpowers/scheduled-agents/audit-burndown-drift.md`) — every 2 weeks re-runs the discovery scan outside the allowlist and surfaces drift the lint rule missed. Stop condition: empty allowlist + 0 new sites for two consecutive runs.
  - **`apps/api/CODING_RULES.md` "Audit Logging" section** — convention for paired `auditService.log{Create,Update,Delete}` calls + per-entity `auditableFields`, with pointers to the spec/burndown/plan.

### Fixed
- **PR3 regression:** `apps/api/src/modules/audit/audit-query.controller.ts:47` calls `authzService.isGlobalAdmin(ctx.roles)` directly (the Phase 3c-deprecated pattern). The dormant `PR Quality Gate - Test Suite` workflow has not run since March, so the regression slipped through PR3's merge. Added the file to `apps/api/.rbac-migration-allowlist.json` (which Phase 3c had successfully emptied) to keep this PR scope-clean. Migrating to `getCapabilities()` / `@RequiresCapability` is Phase 3c follow-up.

## [0.2.47.51] - 2026-05-02

### Added
- **RBAC Phase 5a — audit-log read endpoints (PR3).** Two HTTP surfaces against the partitioned `audit_logs` table from PR2:
  - `GET /api/audit-logs?resourceType=&resourceId=&userId=&action=&organizationId=&startDate=&endDate=&limit=&offset=` — admin filterable search. Gated by `@Roles({ roles: ['super-admin', 'system-admin', 'support', 'org-admin'], mode: ANY })`. Super-admins see cross-org rows; org-admins are scoped to their accessible organizations via `getAccessibleOrganizations`. If a non-admin requests a specific `organizationId` they don't have access to, the endpoint returns an empty result (no information leak about whether that org exists). Pagination capped at limit ≤ 500.
  - `GET /api/audit-logs/resource/:resourceType/:resourceId` — per-resource history. RBAC follows the resource's own access semantics: controller resolves `resourceType` to its entity class via `AuditResourceRegistry`, loads the entity by `id`, then calls `authzService.canAccessResource(userId, roles, resource)`. 404 if the resource type is unregistered or the resource doesn't exist; 403 if `canAccessResource` denies. "If you can see the resource, you can see who edited it."
- **`AuditResourceRegistry` (`@Injectable()`).** Maps `resource_type` strings to entity classes for the per-resource endpoint's entity lookup. Domain modules will register their owned-resource entities in their `onModuleInit` hooks during PR5+ migration tasks. Last-write-wins for duplicate keys; `knownTypes()` returns sorted.
- **`AuditFilterDto`.** Class-validator-decorated query DTO for the admin endpoint. Uses `@Type(() => Number)` for query-string number coercion (matches existing pagination pattern in the codebase), `@IsUUID` for `organizationId`, `@IsDateString` for date bounds, `@IsIn(['CREATE','UPDATE','DELETE'])` for action (sidesteps class-transformer enum-coercion fussiness).

### Changed
- **`AuditModule` now imports `CommonModule`** (for `AuthorizationService` injection into the controller) and registers `AuditQueryController` + `AuditResourceRegistry`. Module exports `AuditService` + `AuditResourceRegistry` so domain modules can register entities in PR5+.

### Coverage
- 9 controller spec tests covering admin/non-admin scoping, org-mismatch empty-result behavior, pagination passthrough, 404 for unknown resource types, 404 for missing resources, 403 for denied access, and the happy path.
- 4 registry spec tests (register/resolve, unknown resolves to null, sorted listing, last-write-wins).
- Total audit-module test count: 30 tests across 4 suites, all passing.

## [0.2.47.50] - 2026-05-02

### Added
- **RBAC Phase 5a — partitioned `audit_logs` storage layer (PR2).** Greenfield migration drops the existing non-partitioned `audit_logs` table (scaffolding-era data with no production value, per the spec) and recreates it as a Postgres-native partitioned table (`PARTITION BY RANGE (timestamp)`) with a composite `(id, timestamp)` primary key. Five secondary indexes (timestamp DESC, user_id, organization_id partial, resource_type+id partial, action) are created at the parent and inherited automatically onto every child partition. The migration bootstraps three monthly child partitions (current month + next 2 months) via `audit_logs_YYYY_MM` naming. Retention becomes a `DROP PARTITION` operation (~instantaneous) instead of a slow `DELETE WHERE timestamp < ...`.
- **`AuditPartitionManager` daily scheduler (worker).** Runs at 03:00 UTC via `@Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: 'UTC' })`. Two responsibilities, both idempotent: (1) ensure partitions exist for the current month + next 2 months (`CREATE TABLE IF NOT EXISTS`); (2) drop partitions older than `AUDIT_RETENTION_MONTHS` (env var, default 24). Strict regex `/^audit_logs_(\d{4})_(\d{2})$/` filters out non-date-shaped tables (`audit_logs_default`, `audit_logs_archive_2023`) so only legitimate monthly partitions are eligible for drop. Errors are caught and logged at the `cron()` level so a transient DB blip never crashes the worker. Registered in `SchedulersModule` alongside `IncrementalCollectionScheduler`.

## [0.2.47.49] - 2026-05-02

### Added
- **RBAC Phase 5a — audit-completion infrastructure (PR1).** Lays the foundation for service-layer audit logging: `nestjs-cls@^6.2.0` dep, `RequestContextStore` type + `REQ_CTX` symbol, `RequestContextModule` (global ClsModule wrapper with UUIDv4 request-id generator), `AuditContextInterceptor` (replaces the legacy `AuditInterceptor` — populates `{userId, userEmail, ipAddress, userAgent, requestId, authType}` per request, emits ZERO audit rows), `AuditableEntityClass<T>` interface + `getAuditableFields()` helper on `OwnedResource` (per-entity static `auditableFields` allowlist convention; default-nothing-logged for safety), pure-function `pickAuditable / diff / truncateOversizedFields` helpers (with 4 KB per-field cap and `{truncated, originalLength}` marker), and the slim new `AuditService` API (`logCreate(entity)` / `logUpdate(before, after)` / `logDelete(entity)` + `findByFilter` / `findByResource` queries, fire-and-forget `setImmediate` insert pattern, CLS-backed actor envelope, `actorOverride` escape hatch). Phase 5a/PR1 is functionally a no-op at runtime — the infrastructure is dormant until subsequent PRs wire service-layer audit calls. Spec at `docs/superpowers/specs/2026-05-02-rbac-phase5a-audit-completion-design.md`; plan at `docs/superpowers/plans/2026-05-02-rbac-phase5a-audit-completion.md`.

### Changed
- **`AuditAction` enum trimmed** from 7 values (`CREATE | UPDATE | DELETE | ACCESS | ACCESS_DENIED | LOGIN | LOGOUT`) to 3 (`CREATE | UPDATE | DELETE`). Phase 5a's scope is mutations only; ACCESS / ACCESS_DENIED / LOGIN / LOGOUT are deferred to Phase 5c (security monitoring) when concrete monitoring requirements drive their reintroduction. Verified zero external consumers across `apps/` and `packages/` before the trim.

### Removed
- **Legacy `AuditInterceptor`** (`apps/api/src/common/interceptors/audit.interceptor.{ts,spec.ts}`). The HTTP-method-based auto-logging (`POST` → CREATE, `GET` → ACCESS, etc.) is gone — service-layer explicit `auditService.log{Create,Update,Delete}` calls (lint-enforced via the upcoming `audit-mutation-must-log` ESLint rule in PR4) replace it. `OLD AuditService` API surface (`log()`, `logAccess()`, `logAccessDenied()`, `getResourceAuditLog()`, `getUserAuditLog()`, `getOrganizationAuditLog()`, `getAccessDeniedEvents()`, `getAuditStats()`, `healthCheck()`, plus the old positional-args `logCreate/Update/Delete`) deleted from `audit.service.ts`. ~960 net lines of dead code removed across the interceptor + service.

## [0.2.47.27] - 2026-04-30

### Refactored
- **RBAC Phase 3c — `dynatrace.service.ts` partial migration (Phase C17).** Migrated the 3 per-resource sites originally classified "Leave" in C2's pilot (`findByHost` → `canAccessResource`, `update` and `delete` → `canModifyResource`). The 21 debug-log-only sites + 5 internal `isAdmin`-passing sites remain — file stays in the allowlist for now. Initial bulk-drop attempt was aborted: a perl one-shot for the debug-log pattern matched too aggressively and broke 5 sites that referenced `isAdmin` downstream (e.g. the `attachPermissions` branch at line 211, and the `requireDynatraceMutationCapability` helper that takes `isAdmin: boolean`). Reverted and re-scoped to just the 3 standard per-resource migrations. Burndown: Bucket B 13 → 16 of 17 (94.1%) — total adjusted upward by 3 to count dynatrace's per-resource sites. Allowlist unchanged at 24 files. All 114 dynatrace tests + full 4314-test API suite pass; 0 type errors; 0 lint errors. Net 0 lines (single file, +30/-30). Documented the bulk-drop cautionary tale in the audit doc as a lesson for future migrations.

## [0.2.47.26] - 2026-04-30

### Added
- **`AuthorizationService.canAdministerAnyOrganization(userId, roles)`** — new policy primitive returning `AuthorizationResult` ({ allowed, reason }) that combines global-admin bypass + `isOrgAdminInAnyOrganization` membership check. Centralizes the "global admin OR any-org admin" pattern that 3 services were re-implementing in private `requireOrgAdmin` helpers. Both shared mock factories (`createAuthorizationServiceMock` happy + `createRestrictiveAuthorizationServiceMock`) gained the method.

### Refactored
- **RBAC Phase 3c — finish bundle (Phase C16).** Largest single C-series PR: 6 files exit the lint allowlist simultaneously. `benchmark-query.service.ts` (C5 leftovers) + `grafana/application-dashboards.service.ts` (C3) + `grafana/grafana-dashboards.service.ts` (C3) + `grafana/grafana-instances.service.ts` (C3) + `pyroscope/pyroscope-instances.service.ts` (C4) + `tracing-instances/tracing-instances.service.ts` (C4) all migrated to use `canAccessResource` (per-resource read), `canModifyResource` (per-resource org-admin write — grafana-instances only), `canAdministerAnyOrganization` (new "any-org admin" gate for the requireOrgAdmin helpers in the 3 instance services), and log-tag drops (10+ debug-log-only sites). Subtle: pyroscope/tracing keep `canAccessResource` for update/remove (preserving member-level write semantics), only grafana-instances tightens to `canModifyResource` (preserving its existing org-admin role check). Files exit allowlist en masse: 8 → **14 files exited cumulatively**; allowlist 30 → **24**. Burndown: Bucket B 6 → 13 of 14 (92.9%) — Bucket B is now nearly complete, only `users.controller.ts` (privilege gate, different shape) remains. All 4314 API tests pass; 0 type errors; 0 lint errors. Net +2 lines across all 10 changed files — the new abstraction (`canAdministerAnyOrganization`) and explanatory comment blocks balance the deleted inline policy code.

## [0.2.47.25] - 2026-04-30

### Refactored
- **RBAC Phase 3c — finish `metrics-sources.service.ts` migration (Phase C15).** Second "finish PR" following the C14 precedent. C8 (PR #195) migrated the 3 Bucket A list-filter sites and left `create` (debug-log only), `update`, `delete` (per-resource throw guards). C15 closes all 3: `create` drops the `(admin)` log tag (C11 precedent), `update` and `delete` delegate to `AuthorizationService.canAccessResource`. Also fixes a latent bug in the shared `createAuthorizationServiceMock` factory: `canAccessResource` and `canModifyResource` were mocked as boolean (`mockResolvedValue(true)`) but the real methods return `AuthorizationResult` (`{ allowed, reason }`). Bug was dormant — no consumer of the shared factory had exercised these methods until now. Fix lands in this PR; all 10 consumers benefit. File exits the lint allowlist (eighth file to do so; allowlist 31 → 30). Burndown: Bucket B 4 → 6 of 14 (42.9%) — biggest single-PR Bucket B gain so far. All 34 metrics-sources tests + full 4314-test API suite pass; 0 type errors; 0 lint errors.

## [0.2.47.24] - 2026-04-30

### Refactored
- **RBAC Phase 3c — finish `events.service.ts` migration (Phase C14).** First Phase 3c PR to "finish" a file that an earlier C-series PR (C10) partially migrated. C10 migrated the 2 Bucket A list-filter sites and left 1 Bucket B per-resource guard at `findOne` line 112. C14 closes that last site via `canAccessResource` (same pattern as C12 awr-reports and C13 alert-tag-filters). Spec updated: 2 `findOne` test assertions migrated from `isOrganizationMember` to `canAccessResource`; base mock provider gained `canAccessResource: jest.fn().mockResolvedValue({ allowed: true, reason: 'mocked' })`. File exits the lint allowlist (seventh file to do so; allowlist 32 → 31). Burndown: Bucket B 3 → 4 of 14 (28.6%). Establishes the "finish PR" precedent — partially-migrated files in the allowlist are now cheap follow-up targets. All 19 events tests + full 4314-test API suite pass; 0 type errors; 0 lint errors. Net +5 lines.

## [0.2.47.23] - 2026-04-29

### Refactored
- **RBAC Phase 3c — `alert-tag-filters.service.ts` migration (Phase C13).** First Phase 3c PR to apply both migration tools (`withOrgFilter` and `canAccessResource`) to a single file. The `findAll` method (Bucket A list-filter) migrated to `withOrgFilter` + sentinel; the `findOne` method (Bucket B per-resource guard) migrated to `canAccessResource`. Demonstrates that one PR can cleanly use both tools when the file has both shapes — a useful precedent for future multi-bucket files where forcing one tool everywhere would either duplicate centralized policy (`withOrgFilter` for per-resource) or create N+1 query regressions (`canAccessResource` per-row). File exits the lint allowlist (sixth file to do so; allowlist 33 → 32). Burndown: Bucket A 40 → 41 of 127 (32.3%); Bucket B 2 → 3 of 14 (21.4%). All 4314 API tests pass; 0 type errors; 0 lint errors. Net +5 lines.

## [0.2.47.22] - 2026-04-29

### Refactored
- **RBAC Phase 3c — `awr-reports.controller.ts` migration (Phase C12).** First Phase 3c PR to migrate Bucket B (per-resource access guard) sites instead of Bucket A (list-filter) sites. Both private guards `validateTestRunAccess` and `validateReportAccess` previously inlined the admin / legacy-null-org / `isOrganizationMember` policy chain. Migrated to delegate to `AuthorizationService.canAccessResource` (same C7 pattern), which centralizes the three policy branches in one place. The resource lookups (TypeORM relation + raw SQL chain) are unchanged — only the policy decision moves out. File exits the lint allowlist (fifth file to do so since Phase 3c began; allowlist 34 → 33). Burndown: Bucket B 0 → 2 of 14 (14.3%) — first Bucket B progress. All 402 awr tests + full 4314-test API suite pass; 0 type errors; 0 lint errors. Net +5 lines (the only Phase 3c migration so far that grew the file — the growth is the explanatory comment block in front of the `canAccessResource` call).

## [0.2.47.21] - 2026-04-29

### Refactored
- **RBAC Phase 3c — `compare-presets.service.ts` migration (Phase C11).** Heterogeneous single-file migration: refactored `validateTestRunAccess(testRunId, userId, roles)` → `(testRunId, orgIds: string[] | null)` to use the C9 sentinel pattern, then migrated all 5 method-level `isGlobalAdmin` sites — 4 via `withOrgFilter` (`create`, `findAll`, `findOne`, `update`) and 1 via log-tag removal (`remove`, where `isAdmin` was used solely for ` (admin)` log decoration with no behavioral consequence). Incidental optimization: the `findAll` per-row access loop now reuses one `orgIds` value across all iterations instead of re-evaluating `isGlobalAdmin` + cache-fetching `getAccessibleOrganizations` per global preset. File exits the lint allowlist (fourth file to do so since Phase 3c began; allowlist 35 → 34). Burndown: Bucket A 35 → 40 of 127 (31.5%). All 121 compare-presets tests + full 4314-test API suite pass; 0 type errors; 0 lint errors. Net -7 lines.

## [0.2.47.20] - 2026-04-29

### Refactored
- **RBAC Phase 3c — `events.service.ts` migration (Phase C10).** Migrated 2 canonical Bucket A list-filter sites (`findAll`, `findByTestRun`) from the `if (!isAdmin) { load orgs; filter }` pattern to `withOrgFilter` + `orgIds === null` sentinel. The 1 per-resource throw guard at `findOne` (line 112) is left in place — same disposition as the C8 metrics-sources bundle. File remains in the allowlist. Burndown: Bucket A 33 → 35 of 127 (27.6%). All 19 events tests + full 4314-test API suite pass; 0 type errors; 0 lint errors.

## [0.2.47.19] - 2026-04-29

### Refactored
- **RBAC Phase 3c — `adapt.service.ts` migration (PR #198 candidate).** Multi-bucket migration: removed two trivial passthrough wrappers (`private isGlobalAdmin`, `private loadAccessibleOrganizations`), refactored `validateTestRunAccess(testRunId, isAdmin, orgIds[])` → `(testRunId, orgIds: string[] | null)` to use the `null = admin` sentinel from `withOrgFilter`, and migrated all 8 `isGlobalAdmin` call sites in `getTrackedRegressions`, `getTrackedRegressionsCount`, `resolveTrackedRegressionsByTestRun`, `resolveTrackedRegression`, `getTrackedDifferencesChart`, `getCorrelatedRegressions`, `getDsAdaptConclusion`, `getEnrichedConclusion`. File exits the lint allowlist (third file to do so since Phase 3c began; allowlist 36 → 35). Burndown: Bucket A 25 → 33 of 127 (26.0%), Local wrappers 1 → 2 of 13 (15.4%). All 93 adapt tests + full 4314-test API suite pass; 0 lint errors; 0 type errors.

## [0.2.47.18] - 2026-04-29

### Fixed
- **Creating a report template from System Under Test config returned 400 "User must belong to an organization to create report templates" even for organization admins.** `ReportTemplateController` gated `create`, `copy`, and `duplicate` on `ctx.organizationId`, but that value only populates from the JWT or API key. Keycloak JWTs don't carry org membership in this project (organizations live in the database), so every Keycloak-authenticated user — including org admins — saw `ctx.organizationId === undefined` and hit the 400. Fix injects `AuthorizationService` into the controller and falls back to `getAccessibleOrganizations(ctx.userId)` when `ctx.organizationId` is empty, matching the pattern already used in `ApiKeysController`. All 446 reports module tests pass.

## [0.2.47.15] - 2026-04-29

### Fixed
- **Empty modal when configuring sections on a new report template.** From the System Under Test config view, opening Reporting Templates → Create Template → Configure Sections rendered a blank dialog (only the title bar and Cancel button). The `GenerateReportDialog` mounted in `template-builder` mode initialized `showTemplateSelector` to `true` regardless of mode, and the template-fetch `useEffect` short-circuits in template-builder mode, so the flag never flipped. The render gates then hid both the section builder and the Save Configuration button. Fix initializes `showTemplateSelector` to `!isTemplateBuilder` at `apps/web/components/reports/report-generation/GenerateReportDialog.tsx:194` so the builder UI shows immediately when entering template-builder mode. The default report-generation flow (no `mode` prop) is unaffected. All 50 tests in `apps/web/__tests__/components/reports/GenerateReportDialog.test.tsx` pass.

## [0.2.47.14] - 2026-04-29

### Refactored
- **Phase 3c — `ReportGenerationService` fully migrated; second file to exit the allowlist.** First multi-bucket migration in the Phase 3c rollout — touches three audit categories in one PR. Migrates 4 canonical Bucket A "filter bypass" sites (`findAll`, `findByTestRunId`, `getSummary`, `getPendingReports`) to `withOrgFilter`. Removes the local `private isGlobalAdmin()` wrapper (line 138) plus its `ADMIN_ROLES` constant — first reduction of the "Local wrappers" audit counter from its 0/13 starting point. Refactors the two private per-resource ACL helpers (`isTestRunAccessible`, `isReportAccessible`) to delegate to `AuthorizationService.canAccessResource`, which already implements the admin / legacy-null-org / org-membership check. Both helpers preserve a `!userId` short-circuit so internal/system calls still bypass auth as before. `team_id` is intentionally omitted from the `OwnedResource` payload to preserve the prior behavior of not checking team membership for these resources. The existing spec needed only a one-line mock update (added `canAccessResource: jest.fn().mockResolvedValue({ allowed: true, reason: 'mocked' })` alongside the existing `isGlobalAdmin` and `getAccessibleOrganizations` mocks); 446 reports tests pass. The file now has zero direct `isGlobalAdmin` references and has been **removed from `.rbac-migration-allowlist.json`** — second file to exit the allowlist since Phase 3c began. Allowlist size: 37 → 36. Net diff: -48 lines. Audit progress: Bucket A migrated 18 → 22 of 127 (17.3%); Local wrappers migrated 0 → 1 of 13 (7.7%). See `docs/superpowers/audits/2026-04-26-audit-decisions.md` for the full per-site classification.

## [0.2.47.13] - 2026-04-29

### Refactored
- **Phase 3c — `ReportDataFetcherService` fully migrated to `withOrgFilter`; first file to exit the allowlist.** All 8 `isGlobalAdmin` sites in this 1810-line service were canonical Bucket A "filter bypass" sites — 100% canonical density, the strongest signal seen in the Phase 3c rollout. Adds a private `resolveOrgFilter(userId, roles, paramStart, alias)` helper that wraps `withOrgFilter` + the existing `buildOrganizationFilterClause`, used at 4 single-derivation sites (collapses each 11-line block to a single line). The 4 remaining sites use inline `withOrgFilter` directly: 2 share `orgIds` across multiple filter clauses (`getThroughputStats` triple-derivation, `getVirtualUserStats` double-derivation), 1 uses dynamic per-iteration paramIdx in a loop (`getMetricsTimeSeries`), 1 has a custom `EXISTS(...)` clause shape (`getAvailableMetricsPanels`). Behavior is unchanged — the `!userId` short-circuit (internal/system call bypass) is preserved everywhere. Net diff: -29 lines despite adding the new helper (76 removed, 47 added). The file now contains zero direct `isGlobalAdmin` references and has been **removed from `.rbac-migration-allowlist.json`** — first file to exit the allowlist since Phase 3c began. Allowlist size: 38 → 37. Audit progress: Bucket A migrated 10 → 18 of 127 (14.2%). See `docs/superpowers/audits/2026-04-26-audit-decisions.md` for the full per-site classification.

## [0.2.47.12] - 2026-04-29

### Refactored
- **Phase 3c — `BenchmarkQueryService` migrated to `withOrgFilter`.** Three canonical Bucket A "filter bypass" sites migrated: `findAll`, `getSystemEnvironmentsAndWorkloads`, and `getBenchmarkTagSyncStatus`. Highest density per-file in this rollout so far (3 of 5 isGlobalAdmin sites canonical, 60%). The `getBenchmarkTagSyncStatus` migration also collapsed an admin-vs-non-admin code split — both branches now share the same query path with the `orgIds === null` predicate gating org-scoped filtering. Behavior is unchanged. The per-resource guard in `findOne` and the Phase 4-stub `syncTagsWithApplicationDashboards` debug log stay inline, so the file remains in `.rbac-migration-allowlist.json`. Audit progress: Bucket A migrated 7 → 10 of 127 (7.9%). See `docs/superpowers/audits/2026-04-26-audit-decisions.md` for the full per-site classification.

## [0.2.47.11] - 2026-04-29

### Refactored
- **Phase 3c — Pyroscope + Tracing instances bundle migrated to `withOrgFilter`.** `PyroscopeInstancesService.findAll` and `TracingInstancesService.findAll` now resolve list-filter org scope via the shared `withOrgFilter` helper. Both methods previously had a 3-branch organization-filtering shape (`organizationId && !isAdmin` / `organizationId && isAdmin` / `!isAdmin`) where the first branch made an extra `getAccessibleOrganizations` call to validate the requested org. Migrating collapses this to 2 branches and eliminates the duplicate call — same input/output for all 5 call shapes (admin / non-admin × with-orgId / no-orgId / no-access-orgId). Behavior is unchanged. Audit progress: Bucket A migrated 5 → 7 of 127 (5.5%). See `docs/superpowers/audits/2026-04-26-audit-decisions.md` for the full per-site classification.

## [0.2.47.10] - 2026-04-29

### Refactored
- **Phase 3c — Grafana services bundle migrated to `withOrgFilter`.** Three services (`GrafanaInstancesService`, `GrafanaDashboardsService`, `ApplicationDashboardsService`) now resolve list-filter org scope via the shared `withOrgFilter` helper introduced in PR #175 (the dynatrace pilot). 4 canonical Bucket A sites migrated: `findAll` in all three services plus `findOne` in `ApplicationDashboardsService`. Behavior is unchanged — `orgIds === null` preserves the previous `isGlobalAdmin === true` semantics exactly, including in the existing debug logs. Per-resource throw guards, custom guard helpers (`requireOrgAdmin`, `verifyOrgAccess`), and debug-log-only `isGlobalAdmin` captures stay inline (same disposition as the dynatrace pilot). Audit progress: Bucket A migrated 1 → 5 of 127 (3.9%). See `docs/superpowers/audits/2026-04-26-audit-decisions.md` for the full per-site classification.

## [0.2.47.9] - 2026-04-29

### Fixed
- **Dynatrace query dialogs now show the permission error inline.** When a non-admin user tried to add, edit, or delete a Dynatrace query, the API correctly returned `You do not have permission to modify this Dynatrace query`, but the dialog stayed open and the error rendered in the section *behind* the dialog where the user couldn't see it. The `useDynatraceQueries` hook now tracks a separate `actionError` for create/update/delete failures and passes it into the open dialog (Add, Edit, Import, Delete, Batch Delete). The list-level `error` remains for fetch failures only. Each dialog closes with `setActionError(null)` so stale errors don't bleed across opens.

## [0.2.47.8] - 2026-04-28

### Security / Fixed
- **Authorization bypass on Dynatrace DQL queries and entity mappings (RBAC Phase 3 follow-up).** `PATCH /api/dynatrace/queries/:id`, `DELETE /api/dynatrace/queries/:id`, and `DELETE /api/dynatrace/entities/mappings/:id` had no authorization check — any authenticated user (org-member, org-viewer, even outside the parent config's org) could update or delete any DQL query or entity mapping. Confirmed in production logs: an org-member user successfully ran `[DynatraceService] Dynatrace DQL query 5715d100-… deleted successfully` against a query owned by a different ownership context. The Phase 3b pilot only covered the parent `DynatraceConfig` endpoints; the sub-resources retained stale `// Phase 4 will add organization_id` TODOs even though the columns had already been added by the broader ownership migration. **Backend change:** `updateQuery`, `deleteQuery`, `deleteEntityMapping` now load the row, verify the caller has `Capability.IntegrationDynatraceUpdate` / `IntegrationDynatraceDelete` for `existing.organizationId`, and reject pre-backfill rows (org_id IS NULL) for non-admins. Global admins still bypass via `getCapabilities` returning the global cap set. Three new regression tests in `dynatrace.service.spec.ts` cover member-deny / org-null-deny / member-deny-on-delete shapes.
- **DQL query and entity-mapping creates now persist `organization_id` / `created_by` / `updated_by`.** `createQuery`, `createQuerySmart`, `bulkImportQuery`, `createEntityMapping` previously created rows with `organization_id = NULL` (8/8 queries and 4/4 mappings in the demo DB had null org_id at fix time). New rows derive `organization_id` from the parent `DynatraceConfig` and capture the authenticated user as creator/updater. The repository surface now takes an optional `QueryOwnership` tuple and the parent-config + capability check is centralized in `DynatraceService.requireDynatraceMutationCapability` so the four create paths can't drift. Service-layer test fixtures were updated to mock the parent-config lookup; existing test coverage now asserts the ownership tuple is forwarded to the repository.
- **Backfill migration `BackfillDynatraceQueryAndMappingOwnership1777600000000`.** UPDATEs every `dynatrace_queries` and `dynatrace_entity_mappings` row that has `organization_id IS NULL`, joining on the parent config to inherit `organization_id`, `team_id`, `created_by`, `updated_by`. Without this, the new mutation guards would still let everyone touch existing rows because they're all on the legacy null-org path. Idempotent: only updates null rows. `down()` is a no-op by design — reverting would re-open the security gap; re-running `up()` after a mistaken `down` is safe.

### Notes
- The DQL query and entity-mapping DTO mappers now expose `organizationId`, `createdBy`, `updatedBy` so service-level guards can read them off the loaded row without bypassing the DTO layer. This is also a pre-requisite for the upcoming `_permissions` enrichment on these endpoints (Phase 3b extension to sub-resources, not in this release).

## [0.2.47.7] - 2026-04-28

### Changed
- **`api-keys` migrated to the capabilities API (RBAC Phase 3c, first per-service pilot).** Removed all direct `authzService.isGlobalAdmin()` calls from `apps/api/src/modules/api-keys/api-keys.service.ts` and `api-keys.controller.ts`; both files dropped from `apps/api/.rbac-migration-allowlist.json` (allowlist 40 → 38). Authorization now flows through `AuthorizationService.getCapabilities(userId, roles, organizationId)` and three new capabilities — `Capability.ApiKeyRead` / `ApiKeyCreate` / `ApiKeyDelete` — wired into `ROLE_CAPABILITIES`: org-admins get all three, org-members and org-viewers get `ApiKeyRead` only, global admins inherit everything via `GLOBAL_ADMIN_CAPABILITIES`. **Behaviour change:** create and delete are now scoped to the *target* organization (not "any org you admin"). Previously a user who was org-admin in org A but only org-member in org B could create/delete keys in B because `requireOrgAdmin` was satisfied by ANY admin role; the new `getCapabilities(userId, roles, targetOrgId)` check denies that path. Read paths return empty (not 403) when the caller lacks `ApiKeyRead` in the requested org, preserving the "don't leak org existence" property of the previous implementation. The "is global admin" check uses `Capability.SystemManageGlobalSettings` as the canonical marker — that capability is only granted via `GLOBAL_ADMIN_CAPABILITIES` so its presence is a stable proxy without re-introducing a deprecated `isGlobalAdmin()` call.
- **Privilege-escalation guard refactored.** `validateRequestedRoles(requestedRoles, creatorRoles, isGlobalAdmin)` now takes the admin bypass as an explicit pre-computed flag instead of calling `authzService.isGlobalAdmin(creatorRoles)` inline; the caller computes `isGlobalAdmin` once via `getCapabilities` and passes it down. Keeps the method synchronous and trivially testable while removing the deprecated call.
- **Default `AuthorizationService` test mock now returns `GLOBAL_ADMIN_CAPABILITIES` from `getCapabilities()`** instead of a hand-curated two-element list. Reflects the mock's stated "allows all operations" intent and means newly-migrated services get permissive defaults out of the box without per-test overrides. The restrictive mock (`createRestrictiveAuthorizationServiceMock`) still returns `[]` for capability-denial tests.

### Notes
- Migration recipe followed: bucket B sites (controller-boundary "is admin?" gates) replaced with `getCapabilities` checks scoped to the target organization. The `@RequiresCapability` decorator was evaluated for the controller layer but skipped for this pilot because most api-keys endpoints derive the org from the persisted resource (after a DB lookup), not from the request — service-layer capability checks are the correct fit for that shape. Future pilots with body/param-resolved org IDs will use the decorator.
- All 4311 api unit tests pass; 74 in `api-keys.service.spec.ts` and 59 in `api-keys.controller.spec.ts` exercised. Lint (with `no-direct-is-global-admin` enforced) clean across api-keys files.

## [0.2.47.6] - 2026-04-28

### Fixed
- **`RestoreRlsPoliciesPostTeamIdRemoval` migration failed on `url_patterns`** with `column "organization_id" does not exist`. The migration's `replacePolicies` helper hardcoded `organization_id, (created_by)::text` references on every policy expression, but `AddWorkloadToEvents` (1776148518354) had previously dropped both columns from `url_patterns` AND `generated_reports` — only `api_keys` retained them. Reworked `replacePolicies` to take per-operation SQL expressions explicitly. `api_keys` keeps the ownership-based 2-arg policies. `url_patterns` (deduplication cache, no per-row ownership) and `generated_reports` (lost ownership in AddWorkloadToEvents, pending Phase 4 restoration) both ship with permissive read/insert and admin-only update/delete: defense-in-depth without referencing columns that don't exist. Fix is forward-compatible: production envs that recorded the migration as completed (somehow) skip it; envs where it failed (the common case) re-run cleanly because every operation is `DROP POLICY IF EXISTS` + `CREATE POLICY` and `CREATE OR REPLACE FUNCTION` for the helpers.

## [0.2.47.5] - 2026-04-28

### Added
- **`@RequiresCapability` decorator + `CapabilityGuard` (RBAC Phase 3c foundation).** The decorator at `apps/api/src/common/decorators/requires-capability.decorator.ts` stores the required capability + an org-id source (`{ orgIdParam, orgIdFromBody, orgIdFromQuery }`) as Reflector metadata. The guard at `apps/api/src/common/guards/capability.guard.ts` reads the metadata, extracts userId + roles via `KeycloakEnhancedAuthGuard.getUserId/.getRoles` (auth-method-agnostic — works for both JWT and API key callers), resolves the org ID from the configured request source, calls `AuthorizationService.getCapabilities(userId, roles, orgId)`, and either grants the request or emits a structured WARN log (`Capability denied: capability=… userId=… orgId=… route=…`) and throws `ForbiddenException`. DB failures from `getCapabilities` deliberately bubble up as 500 — silent empty caps would let mutations through that should be denied. With this in place, controllers gating Bucket B sites (the 14 `if (!isGlobalAdmin) throw ForbiddenException` patterns the audit log enumerates) can now use `@RequiresCapability(Capability.X, { orgIdParam: '…' })` declaratively at the controller boundary instead of inlining the check inside the service.
- **CapabilityGuard integration test** at `apps/api/src/common/guards/capability.guard.integration.spec.ts` boots a minimal NestJS app, registers `CapabilityGuard` via `APP_GUARD`, and fires real HTTP requests through a test controller decorated with `@RequiresCapability`. Real Reflector, real metadata, real decorator, real guard, real Logger spy, real supertest. Only `AuthorizationService.getCapabilities` is mocked (its own coverage lives in the unit specs from Phase 3a). Closes the one outstanding gap from `/plan-eng-review`'s Failure modes section: the guard's full pipeline (metadata → extraction → authz → log → throw) is now end-to-end verified, not just unit-tested in isolation.

### Notes for migration
- Phase 3c per-service rollout begins after this PR. The migration recipe is in `docs-site/content/Architecture/Capabilities and RBAC.md`: Bucket A sites use `withOrgFilter`; Bucket B sites use the new `@RequiresCapability` decorator at the controller boundary; Bucket C sites consult the audit log case-by-case. The `local/no-direct-is-global-admin` lint rule still blocks new direct `isGlobalAdmin()` usage outside `INFRASTRUCTURE_FILES` and the grandfathered `apps/api/.rbac-migration-allowlist.json`.
- The audit log's "Migration progress" burndown table tracks Bucket A / Bucket B / local-wrapper progress. When a service file is migrated, remove its entry from the allowlist and update the burndown counts.
- Date-bound revisit gate is **2026-08-01**: if the burndown isn't ≥50% by then, the team explicitly re-evaluates.

## [0.2.47.4] - 2026-04-28

### Added
- **RBAC frontend pilot — closes the Dynatrace integration UX gap (RBAC Phase 3 frontend, FE.1 + FE.2 + FE.3).** New `usePermissions()` React Query hook (`apps/web/hooks/usePermissions.ts`) fetches `GET /api/users/me/permissions` once per session, caches with `staleTime: Infinity`, and exposes `can(action, ctx?)` with `resourcePermissions` precedence over capabilities. New `<RequiresPermission action orgId resourcePermissions disabledReason>` wrapper component (`apps/web/components/auth/RequiresPermission.tsx`) renders children disabled-with-tooltip when the capability check fails — the v1 ships a single render mode (the speculative hide / custom-fallback / render-prop modes were dropped per the eng-review YAGNI finding). The Configure and Delete buttons on every IntegrationCard (`apps/web/app/integrations/components/IntegrationCard.tsx`) are now wrapped: org-non-admins see disabled buttons with an "Org admin only" tooltip instead of clickable buttons that 403 on submit. **The original report — `test@perfana.io` (org-member + org-viewer) clicking Configure on a Dynatrace card and getting a silent 403 — is now closed at the UX level.** When the page-level data flow surfaces `instanceData._permissions` from the Phase 3b server hint, the wrapper picks up the per-row answer automatically (no further frontend changes needed); until then it falls back gracefully to capability-based decisions via `usePermissions().can()`. 19 new tests across the three components: 7 for `usePermissions` (3 baseline + 4 from the eng review covering resourcePermissions precedence, error-state, and org-switch React Query invalidation), 7 for `RequiresPermission`, 5 for `IntegrationCard` including the regression case for the original bug.

## [0.2.47.3] - 2026-04-28

### Added
- **Per-resource `_permissions` field on Dynatrace config responses (RBAC Phase 3b pilot).** `GET /api/dynatrace`, `GET /api/dynatrace/:id`, and `GET /api/dynatrace/host/:host` now include `_permissions: { update: boolean, delete: boolean }` on every returned config. The boolean is computed server-side from the requesting user's capability set for the config's organization (`integration:dynatrace:update` / `integration:dynatrace:delete`); legacy configs with `organization_id IS NULL` short-circuit to `update: true, delete: true` to match existing service-level behavior (the Phase-4 escape hatch closes when `organization_id` becomes NOT NULL). Capability lookups are batched per unique organization across the result set, so a `findAll` returning N configs across M unique orgs costs M Redis hits, not N. The frontend (Phase 3b consumer, FE.1/FE.2/FE.3) reads this field directly to gate Configure/Delete buttons without a round-trip to `/me/permissions`. Pilot scope: Dynatrace only — Grafana, Pyroscope, and Tracing integrations stay on the original pattern until they adopt incrementally.
- New `attachPermissions(resource | resources, permissionsMap)` serializer at `apps/api/src/common/serializers/with-permissions.serializer.ts`. Generic, supports single resource and array overloads, immutable input. Reused by every future endpoint that exposes per-row permissions.
- `_permissions` field added to `DynatraceConfigDto` with `@ApiPropertyOptional` Swagger decoration so the Swagger UI at `/api/docs` reflects the field on `GET /api/dynatrace` and `GET /api/dynatrace/:id` responses.

## [0.2.47.2] - 2026-04-28

### Added
- **Capabilities API foundation (RBAC Phase 3a).** New `Capability` enum (~30 typed string literals), `CapabilitiesService` (pure mapping from `(systemRoles, orgRoles, teamRoles)` to capability set), `AuthorizationService.getCapabilities(userId, roles, orgId, teamId?)`, and `GET /api/users/me/permissions` endpoint returning `{ userId, global: string[], byOrg: Record<orgId, string[]> }`. Capabilities are computed per `(userId, organizationId, teamId)`, cached in Redis with a versioned-key strategy (`auth:capabilities:{userId}:{orgId}:{teamId}:v{version}` plus a per-user `auth:capabilities-version:{userId}` counter), and invalidated via `INCR` on the version counter when membership changes. The versioned strategy avoids `redis.keys()` scans entirely — every prior cached entry becomes unreachable in O(1) on invalidation, then expires via TTL. Cold-path role loads are parallelized via `Promise.all` so `/me/permissions` p99 stays at one round-trip's latency regardless of org count. Auth-method-agnostic by construction: JWT (`request.user.roles` from Keycloak `realm_access` + client roles) and API key (`request.apiKey.roles`) callers flow through the same `getRoles()` unification and the same capability mapping. Closes the foundation requirement of CLAUDE.md's RBAC Phase 3.
- **RBAC migration tooling.** Custom ESLint rule `local/no-direct-is-global-admin` blocks new direct `authzService.isGlobalAdmin()` usage outside the AuthorizationService and a permanent `INFRASTRUCTURE_FILES` exemption set (which covers `authorization.service.ts`, `authorized-base.service.ts`, `with-org-filter.ts`, and `capability.guard.ts` — the helpers that legitimately encapsulate the admin-bypass check). A grandfathered `apps/api/.rbac-migration-allowlist.json` (40 files at ship time) tolerates existing sites; removing a file from the allowlist is the trigger for migrating its sites to the capabilities API. The audit log at `docs/superpowers/audits/2026-04-26-audit-decisions.md` now has a "Migration progress" burndown table; allowlist size IS the burndown. `CONTRIBUTING.md` documents the adjacent-migration rule (when you touch an allowlisted file, migrate its sites in the same PR). A drift-check `/schedule` agent at `docs/superpowers/scheduled-agents/rbac-drift-check.md` catches new sites the lint rule missed (e.g., from merge conflicts or new dependencies). The plan's date-bound revisit gate is **2026-08-01**: if the burndown isn't ≥50% migrated by then, the team explicitly re-evaluates the architecture or the priorities — preventing silent stalling.
- **Engineer-facing docs.** `docs-site/content/Architecture/Capabilities and RBAC.md` covers the two-surface authorization model (capabilities answer "can I do action X in scope Y?" — used for menu/button gating, route guards, and pre-fetch decisions; resource ACL `canAccessResource`/`canModifyResource` answer "can this user touch this specific row?" — used inside services after a resource is loaded), the current role-→-capability mapping (system, organization, team), how to add a new role or capability, and the Bucket A/B/C migration recipe. The lint rule's deprecation message now points at this page so blocked developers get a real how-to instead of an audit-log link.

### Changed
- `CLAUDE.md` "RBAC Implementation Status" table: Phase 3 row updated to "In progress (foundation shipped 2026-04-28; per-service rollout tracked in `docs/superpowers/audits/2026-04-26-audit-decisions.md` — burndown 0% / target 50% by 2026-08-01)".

## [0.2.47.1] - 2026-04-26

### Changed
- Pilot of a `withOrgFilter(userId, roles, authzService)` helper for the recurring "if global admin, return everything; else filter by accessible org IDs" pattern (`apps/api/src/common/utils/with-org-filter.ts`). Migrates one method — `DynatraceService.findAll` — as proof-of-pattern; the other Bucket A sites enumerated by the 2026-04-26 codebase audit (`docs/superpowers/audits/2026-04-26-audit-decisions.md`) stay on the original inline pattern and can adopt incrementally per-service. The audit's site re-verification on `dynatrace.service.ts` found 1 truly-canonical bypass-filter site of the 25 originally flagged; the other 24 were debug-log captures or per-resource guards left untouched. No behaviour change — debug logs preserve their `isGlobalAdmin=true/false` semantics by deriving the boolean from `orgIds === null`. Tests: 3 new helper tests cover admin/non-admin/empty-membership cases; full `apps/api` suite (4256 tests) green; type-check and lint clean.

## [0.2.47.0] - 2026-04-24

### Added
- Scenario filter above the Performance Analysis card tabs, styled to match the Grafana Dashboards tag filter. Select one or more scenarios to scope every tab (Overview, Top 10 Transactions, Top 10 Requests, Top 10 URLs, Error Analysis) to just those scenarios; empty selection is a no-op and shows everything. Chips are derived from the loaded transactions, so only scenarios that actually exist in this run appear. A "No Scenario" chip is rendered only when the run contains rows with null/empty `scenario_name`. On the Overview tab, filtering recomputes the `Overall Test Metrics` panel (weighted avg/p95/p99 response time, apdex, error rate, peak throughput, peak virtual users) from the filtered transactions and from the matching `by_scenario` entries on throughput/VU stats, so the "overall" aggregates reflect only the selected scenarios. Top 10 tabs filter samplers/transactions before aggregation into dimensions, so rankings (slowest, highest throughput, highest impact, highest error rate) recompute against the filtered pool. For Error Analysis, the five `/api/test-runs/:id/error-analysis/{summary,by-code,by-transaction,over-time,over-time-by-code}` endpoints accept an optional `scenarios` query parameter (comma-separated scenario names; the sentinel `__NO_SCENARIO__` matches `scenario_name IS NULL`) and the service applies `AND (scenario_name = ANY($list) OR scenario_name IS NULL)` to `requests_error` — and the corresponding `requests_raw` count used for the overall error rate — when the parameter is present. The frontend hook refetches when the selection changes; the details endpoint is unchanged (still keyed by transaction/sampler/url).

## [0.2.46.0] - 2026-04-24

### Added
- TimescaleDB continuous aggregates (CAGGs) over the three high-volume request hypertables: `requests_raw_{5s,1m,5m}`, `transactions_{5s,1m,5m}`, and `requests_error_{5s,1m,5m}` (migration `1777500000000-AddContinuousAggregates`). The `1m` view is hierarchical — materialized from `5s` — and `5m` is materialized from `1m`; associative aggregates (count, sum, weighted avg via `sum(x*n)/NULLIF(sum(n),0)`, min, max, and `rollup(percentile_agg)` for tdigest percentiles) make this safe. Grafana panels resolve a `cagg_suffix` template variable from `${__interval_ms}` (5s when `<= 15000`, 1m when `<= 300000`, else 5m) and query `FROM <table>_${cagg_suffix}`, cutting p50 panel latency from ~4 s (raw scan of ~12 M index entries on a 30-minute window) to under 200 ms (direct lookup on pre-bucketed rows). Each CAGG gets a refresh policy (30 s cadence on 5s, 1 min on 1m, 5 min on 5m; 1-minute `end_offset` keeps jobs out of the current chunk's write path) and a 90-day retention policy — intentionally longer than any retention on raw so long-term trend panels survive raw-data pruning. Aggregate columns were chosen from the actual panel queries: `n, n_ok, n_err, avg_rt, min_rt, max_rt, pct_agg` plus per-table extras (`avg_connect, avg_latency, bytes_in, bytes_out, avg_response_size` on `requests_raw`; `n` only on `requests_error`, which stores per-error-row data that CAGGs can't represent). The migration is idempotent (`CREATE MATERIALIZED VIEW IF NOT EXISTS` plus `if_not_exists => TRUE` on policies) and reversible (`down()` drops views in reverse hierarchy order with `CASCADE`, which also removes the associated policies). Verified under both TypeORM `migrationsTransactionMode: 'all'` (CLI) and `'each'` (production `run-migrations.ts`) — TimescaleDB 2.26.3 accepts CAGG DDL inside a transaction block, so no `transaction = false` opt-out is needed. Dashboard JSON rewrites for `template-timescaledb-jmeter`, `template-timescaledb-transaction-analysis`, and `template-timescaledb-request-analysis` ship as a companion change in the `perfana-demo` repo on branch `perfana-next-gen`. Live "now" stat panels (queries filtering `time > now() - interval '<60 seconds>'`), row-level detail panels (e.g. error-message lookup by `random_id`), and success-filtered single-number stats on the per-sampler/per-transaction drill-down dashboards stay on raw hypertables — the CAGG doesn't distinguish success from failure for response-time aggregates, and the composite index from #137 keeps those narrowly-scoped queries responsive. See `docs-site/content/Database/Continuous Aggregates.md` for the full decision record, including the aggregate-column choices, refresh-lag expectation (~60 s), and known semantic shifts on time-series response-time panels. Closes #147.

## [0.2.45.0] - 2026-04-24

### Added
- Space-partition dimension `by_hash('system_under_test', 4)` added to the `requests_raw`, `requests_error`, and `transactions` hypertables (migration `1777300000000-AddSpaceDimensionToRequestHypertables`). Scope is new-chunk behavior only — existing chunks keep their single-partition layout, so the practical win lands as traffic rolls forward and new chunks are created. The benefit is strongest on deployments with several concurrently-active SUTs: the planner can prune non-matching hash buckets on SUT-filtered queries before touching chunk data, and per-chunk decompression on aggregation queries is scoped to a single hash bucket instead of mixing rows from every SUT in the chunk. Operators wanting retroactive partitioning on existing chunks must follow the documented offline rebuild procedure (`docs-site/content/Operations/Hypertable Space Rebuild.md`); most installs can ignore the rebuild and still pick up the benefit over time. The partition count defaults to 4 and is overridable at migration time via `HYPERTABLE_SPACE_PARTITIONS` (range 1–64); adjust later with `set_number_partitions()` rather than re-running the migration. Idempotent via `if_not_exists => TRUE` plus an explicit check against `timescaledb_information.dimensions`; each table is wrapped in a savepoint so an older-TimescaleDB-version rejection on one table (e.g. compressed-chunk edge cases) doesn't abort the rest of the migration. Compression settings (segmentby `test_run_id, transaction_name`) are unaffected — space partitioning sits at chunk-boundary level and is orthogonal to per-chunk columnar layout. Closes #145.

## [0.2.44.0] - 2026-04-24

### Added
- Sortable column headers in the Anomaly Detection results table. Click Dashboard, Panel, Metric, Classification, Conclusion, Test Value, Control Group, or Difference to sort ascending; click again to reverse. Unsorted columns show a neutral indicator; the active column shows an up/down arrow. The Difference column has an extra **Abs / %** toggle so you can sort on either the raw difference or the percentage change relative to the control group (`(diff / control) * 100`). Sorting runs before pagination so page 1 always shows the top of the sort; changing sort or mode resets to page 1. Rows with missing values or a zero control group sort to the end regardless of direction. Headers are keyboard-accessible (Enter/Space), focus-visible, and carry tooltip hints.

## [0.2.43.1] - 2026-04-24

### Changed
- Per-table autovacuum tuning for `url_patterns` (migration `1777200000000-TuneAutovacuumForUrlPatterns`). Sets `autovacuum_vacuum_scale_factor=0.05`, `autovacuum_analyze_scale_factor=0.05`, and `autovacuum_vacuum_cost_limit=1000` so the table is vacuumed/analyzed sooner on smaller batches and each batch drains faster. Under global defaults (cost limit 200), a `VACUUM ANALYZE url_patterns` (~2.9 GB on busy tenants) ran long enough to overlap with autovacuum on `requests_raw` chunks, saturating disk I/O and blocking foreground dashboard queries on `IO:DataFileRead`. Shrinking the contention window avoids the storm without touching global defaults or any other table. Closes #142.

## [0.2.43.0] - 2026-04-23

### Fixed
- Creating an API key with a description that already exists no longer surfaces as an opaque 500 from the GlobalExceptionFilter (`QueryFailedError: api_keys_description_key`). New migration `1777100000000-ApiKeyDescriptionUniquePerOrg` replaces the global `UNIQUE(description)` constraint on `api_keys` with a composite `UNIQUE(organization_id, description)` so common names like `CI`, `Jenkins`, or `Grafana sync` can be reused across organizations. `ApiKeysService.createApiKey` now pre-checks for an existing key in the target organization and throws `ConflictException` (HTTP 409) with the message `An API key with description "X" already exists in this organization.`; the rare concurrent-create race that still hits the unique index is translated to the same 409 from the catch block, and `isUniqueDescriptionViolation` checks both the top-level and `driverError`-wrapped pg fields so the translation never falls through to a 500 on alternative TypeORM driver shapes. Frontend `useApiKeys` routes the 409 to the description field (`form.setError('description', ...)`) instead of the generic root alert, so the user sees exactly which field to fix. Closes #117.
- `ApiKeysService.validateApiKey` no longer rejects legitimate API keys when two organizations share a description. The previous flow cached keys by description alone and the DB fallback used `.find()` to pick the first matching row — both assumed globally-unique descriptions, which the per-org migration above invalidates. The lookup now treats the cached key as a hint (bcrypt-verified, with fall-through to DB on mismatch), and the DB fallback scans every same-description candidate with bcrypt, skipping expired rows. Without this, the per-org uniqueness change would have caused intermittent 401s on validate calls. The DTO `organizationId` field is also now `@IsUUID()` instead of `@IsString()` so non-UUID input is rejected at the validation layer rather than producing a confusing 500 from the pg type cast. Three new regression tests cover the cross-org collision and the `driverError` race translation; two pre-existing validateApiKey tests were updated to mock the DB fallback path that the new code now reaches.

## [0.2.42.0] - 2026-04-23

### Added
- Composite `(system_under_test, test_environment, scenario_name, time DESC)` indexes on the `requests_error`, `requests_raw`, and `transactions` hypertables (migration `1777000000000-AddCompositeSutEnvScenIndexes`). Grafana panels filter these tables by `system_under_test`, `test_environment`, and `scenario_name` over a bounded time window; without a matching composite, the planner fell back to a parallel index-scan on `time` followed by a row-by-row filter — measured at ~57 s to return zero rows against a 30-minute window of a ~10 M-row weekly chunk when the scenario didn't match. The indexes were applied manually on `performance-praegus` on 2026-04-19 to relieve live pain; this migration formalizes them so fresh installs and other environments get them automatically. Idempotent (`CREATE INDEX IF NOT EXISTS`); storage footprint is ~300 MB per hypertable at current production size. The original plan called for `WITH (timescaledb.transaction_per_chunk)` to keep writes flowing on other chunks during the build, but TimescaleDB rejects that option inside a transaction block and TypeORM wraps all migrations in one, so it's documented as a manual step for large pre-existing environments while production remains unaffected (indexes already in place). Closes #137.

## [0.2.41.2] - 2026-04-22

### Fixed
- Anomaly-detection trends plots and compare-runs charts no longer throw `ReferenceError: adjustedYAxesFormat is not defined` when the plotted unit triggers automatic conversion (seconds with all values under 1, or milliseconds with all values over 1000). Regression from the PR #130 lint cleanup, which prefixed the `adjustedYAxesFormat` `let` declaration with `_` but left the reassignments unprefixed — ReferenceError in strict mode. Variable was dead code (never read anywhere), so removed entirely in `trends-plot-utils.ts` and `ComparisonPlot.tsx` rather than renamed back.

## [0.2.41.1] - 2026-04-22

### Fixed
- JTL upload (and every other `INSERT … ON CONFLICT (test_run_id, key, tags_hash(tags))` upsert in `TestRunsConfigService`) no longer fails with PostgreSQL SQLSTATE 42P10 ("there is no unique or exclusion constraint matching the ON CONFLICT specification"). New migration `1776900000000-RestoreTestRunConfigsTagsHashUniqueIndex` restores the functional unique index on `test_run_configs (test_run_id, key, tags_hash(tags))` that `AddWorkloadToEvents1776148518354.up()` dropped without recreating — TypeORM's auto-generator can't represent expression-based indexes, so it silently removed it. Same migration also restores the companion `idx_dynatrace_entity_mappings_unique` on `(system_under_test_id, COALESCE(test_environment,''), COALESCE(workload,''), entity_id)` — no live `ON CONFLICT` depends on it today, but losing it removed the data-integrity guarantee against duplicate dynatrace entity mappings per SUT/env/workload. Both blocks are idempotent (`CREATE OR REPLACE` / `IF NOT EXISTS`); the dynatrace block fails loudly with the offending duplicate count if any exist. Closes the audit hole left by `AddMissingUniqueConstraints` (#125), `AddDsUniqueIndexesForUpserts` (#132), and `RequireNonNullSourceIdOnCollectionStatus` — those caught the plain-column uniques the same auto-gen pattern dropped; this one catches the two functional indexes.

## [0.2.41.0] - 2026-04-20

### Added
- Per-test-run pre-computed stats rollup. Two new tables, `test_run_transaction_stats` and `test_run_sampler_stats`, hold transaction- and sampler-level aggregates (counts, tdigest, impact score) for completed runs. Rows are keyed on `(test_run_id, transaction_name, [sampler_name,] scenario_name, ramp_up_excluded)` so both full-run and ramp-up-excluded variants are available. p95/p99 and Apdex are computed at read time via `approx_percentile` / `approx_percentile_rank` on the stored tdigest against the *current* threshold, so editing `workload_apdex_thresholds` takes effect immediately with no recompute.
- New `transaction-stats-rollup` stage in the `analyze-test` pipeline (runs after `performance-test-metrics`). Single-scan `FILTER` + `UNION ALL` computes both variants per group. The stage is soft-fail: if rollup times out or errors, ADAPT / statistics / checks continue and the dashboard falls back to live aggregation. DELETE-before-INSERT guarantees the rollup always reflects current raw data — no stale rows after ramp-up edits or raw-row changes. Statement timeout raised to 10 minutes for the initial population on large runs (the live query it replaces was measured at 135–213s).
- Backfill script `apps/worker/scripts/backfill-test-run-stats-rollup.ts`. Resumable, batched, rate-limited. Enqueues the same pipeline as the finalization stage so there is one canonical code path. Supports `--dry-run`.

### Changed
- `TestRunsPerformanceQueryService.getTransactionStats` and `getTransactionSamples` now read from the rollup when it exists, falling back to live aggregation for in-progress runs, un-backfilled runs, or `sinceMinutes` windows. No DTO change. Measured impact: the 140s `stream_download_segment` sampler query (issue #151, 11.35M rows in `requests_raw`) becomes a single rollup-row read. The Top 10 Transactions tab, Top 10 Requests tab, and Overview-row expand (all three defaulting to `excludeRampUp=true`) now serve from the rollup on completed runs.
- Editing `analysisStartOffset` on a completed run re-enqueues the rollup job with a deterministic `jobId`, so rapid successive edits coalesce into a single pending job. The pipeline re-reads the current `analysisStartOffset` at execute time, so last-write-wins is correct regardless of processing order.
- Test-run deletion now cleans up the rollup tables alongside `ds_*` and hypertables.

## [0.2.40.0] - 2026-04-19

### Fixed
- Performance-test runs no longer flip to `valid = false` with `"Data collection coverage … / failed collection ranges"` after a baseline test. Two compounding issues were causing every overlapping incremental tick of the same `test_run_id` to crash on `duplicate key value violates unique constraint "uniq_ds_metric_statistics"` (the index restored in #132): `PerformanceTestMetricsPipeline.computeAndSaveStatistics` did `DELETE` then plain `INSERT` (slow under load — a 97-second DELETE was observed in #134 — leaving a wide window for the next scheduler tick to start before the first finished), and `IncrementalCollectionScheduler` ticks for the same run were not mutually exclusive. The DELETE+INSERT is now a single `INSERT … ON CONFLICT (test_run_id, application_dashboard_id, panel_id, metric_name) DO UPDATE SET …` (idempotent, atomic, no inter-statement window), and `collectPerformanceTestMetrics` now acquires a per-`test_run_id` Redis lock (`job:lock:perf-test-metrics:<id>`, 15-minute TTL); a tick that finds the lock held returns success-with-zero-data-points so the next tick retries the same window. Affected runs now reach `valid = true` on a clean stack (#134).

### Changed
- Intra-batch metric grouping in `computeAndSaveStatistics` now truncates `metric_name` to 255 characters when forming the group key so it matches what is persisted. Previously, two metrics whose first 255 characters were identical produced two stat records that collided on the persisted unique key, which under the new upsert form would have raised Postgres's `cardinality_violation` ("ON CONFLICT DO UPDATE command cannot affect row a second time").

## [0.2.39.0] - 2026-04-19

### Fixed
- Analyze pipeline no longer aborts on SQLSTATE 42P10 (`INSERT … ON CONFLICT` without matching unique index). A new migration (`1776600000000-AddDsUniqueIndexesForUpserts`) restores the nine `ds_*` unique indexes that `AddWorkloadToEvents1776148518354.up()` dropped without recreating — covering `ds_metrics`, `ds_compare_config` (panel + metric partials), `ds_control_groups`, `ds_metric_statistics`, `ds_control_group_statistics`, `ds_adapt_results`, `ds_adapt_conclusion`, and `ds_adapt_tracked_results`. Checks, ADAPT, and stats now populate on baseline runs (#132).
- `IncrementalMetricsPipeline.execute` now propagates per-collector failures as a pipeline-level error (`INCREMENTAL_COLLECTOR_FAILED`) instead of hiding them behind an overall `success: true`. Before, a collector that caught an upsert failure internally (e.g. the 42P10 above) still let `ds_metric_collection_status` get marked `is_complete=true, total_data_points=0` — so reanalyze saw no gap and left `ds_metrics` empty forever. Affected runs now re-collect from scratch on the next analyze.

## [0.2.38.0] - 2026-04-18

### Fixed
- `config-hash.ts`: volatile field exclusion was broken by the lint cleanup pass, which prefixed `last_modified_at` and `config_hash` with underscores (ESLint unused-vars) while the actual config object uses the non-prefixed names. Hashes now correctly exclude these fields so config comparisons ignore timestamp and hash metadata.
- Anomaly detection, AWR insights, `useSystemData`: kept `as any` casts where `as unknown` (introduced by an overlapping lint pass) would prevent TypeScript from accessing properties directly — `unknown` requires explicit type narrowing before property access.

## [0.2.37.0] - 2026-04-18

### Fixed
- `POST /api/config/json`: no longer returns 404 when the test run doesn't exist yet. Configs are now stored with a string-based test run ID and associated once the test run is created — consistent with the behavior of `POST /config/key` and `POST /config/keys`. This fixes a timing window where CI/CD pipelines sending config before the test run record is written received a 404.
- Worker: resolved 92 TypeScript type errors introduced during the `any` cleanup refactor. Casts are now scoped to point-of-access rather than widening entire function signatures.
- Swagger: removed stale 404 response from `POST /config/json` — that status code is no longer returned by the endpoint.

## [0.2.36.2] - 2026-04-14

### Fixed
- `AddWorkloadToEvents` migration: drop RLS policies on `url_patterns` and `generated_reports` before removing ownership columns. PostgreSQL refuses non-CASCADE column drops when policies depend on the column (SQLSTATE 2BP01), causing the migration to fail on a fresh database.
- `chart-utils.test.ts`: update `calculateRampUpEndIndex` tests to use `analysis_start_offset` (renamed from `ramp_up` in 0.2.36.0), and update `buildChartConfig` height assertion from 500 to 600.
- `TestRunDetailsCard.test.tsx`: update mock test run to use `analysis_start_offset` instead of `ramp_up`, fixing two failing duration-formatting tests.
- `slo-renderer.ts`: `let` → `const` for `checkResults` (no reassignment).

## [0.2.36.1] - 2026-04-14

### Fixed
- `alert-tag-filters.service.ts`: wrong property name `testType` used when creating alert tag filter entities (should be `workload` after the rename in 0.2.36.0).
- `test-run-config.dto.ts`: unused `ApiPropertyOptional` import causing TypeScript build error.
- `test-runs.controller.spec.ts` / `test-runs.service.spec.ts`: `updateAdaptConfig` test assertions had wrong argument order and were missing the `mode` parameter, causing test failures after the API was extended.
- `jest.config.js`: `phase5-migration-validation.test.ts` (a DB integration test requiring a live database) was being picked up by the unit test runner, causing spurious failures in CI.

## [0.2.36.0] - 2026-04-12

### Added
- **Full report rendering pipeline with real data.** All seven report section renderers now fetch live data instead of returning stubs or mock values:
  - **SLO renderer** queries `check_results` and renders a pass/fail table with per-metric requirement vs actual values.
  - **Regressions renderer** fetches ADAPT results and renders a sorted table of regressions and improvements with conclusion icons.
  - **AWR renderer** reads parsed AWR reports and analysis insights from `awr_reports` / `awr_analysis` and renders a severity-grouped summary.
  - **Trends renderer** queries historical test runs with the same system/environment/workload and renders a sparkline-style progression table.
  - **Comparisons renderer** fetches `ds_adapt_results` and renders a side-by-side metric comparison with difference percentages.
  - **Graphs renderer** reads time-series data from `ds_metrics` and renders inline SVG charts for each panel.
  - **Header renderer** now shows real SLO pass/fail counts and regression detection status instead of placeholder badges.
- **`ReportDataFetcherService`** gains nine new methods: `getSloCheckResults`, `getSloSummary`, `getRegressionsData`, `getAnomalySummary`, `getAwrData`, `getComparisonsData`, `getTrendsData`, `getMetricsTimeSeries`, and `getAvailableMetricsPanels`. All support `userId` / `roles` parameters for org-level access filtering.
- **`getTrendsData`** and **`getMetricsTimeSeries`** auto-discover available panels from `ds_metrics` when no explicit panel selector is provided.

### Fixed
- `getTrendsData` clamps the `maxRuns` parameter to a validated integer (1–50) before interpolating into SQL, preventing runaway queries from uncapped values.

## [0.2.35.0] - 2026-04-11

### Fixed
- The `perfana-api` Docker image no longer fails with `Cannot find module 'axios'` on startup. The root cause was that npm's hoisting algorithm placed axios in `apps/api/node_modules/` instead of the root `node_modules/`, making it unreachable by `@nestjs/axios` at runtime. Adding axios as a root-level dependency forces correct hoisting. Workers, grafana-sync, and perfana-report retain their own nested `node_modules` COPY lines since they have other production packages that still require separate handling.

## [0.2.34.0] - 2026-04-09

### Added
- `POST /api/systems-under-test` lets you fully provision a System Under Test before the first load test run. Pass `name`, `organizationId`, and an optional `environments` array (each with `workloads`) to create the SUT, test environments, and workloads in a single atomic request. All subsequent configuration endpoints — ADAPT settings, tracing, Pyroscope, Dynatrace mappings — work immediately after. Re-sending the same `name` + `organizationId` is safe: returns the existing SUT with a 409 status so CI/CD scripts can call it idempotently.

## [0.2.33.1] - 2026-04-09

### Fixed
- The ADAPT Settings tab is now always visible in the system under test configuration page. When all integrations are active (Dynatrace, Distributed Tracing, Pyroscope), the 9 tabs overflowed the tab bar on smaller screens, clipping the last tab. The tab bar now scrolls horizontally with auto-shown scroll buttons.

## [0.2.33.0] - 2026-04-09

### Fixed
- `GET /api/test-runs/:id/connected-sources` now correctly returns `dynatrace.available: true` when Dynatrace is configured for a system under test. Previously, the endpoint always returned `false` because `DynatraceQuery.metricsSourceId` was never populated during query creation, leaving `ds_metrics.metrics_source_id` always NULL. Dynatrace queries now automatically upsert a `MetricsSource` row keyed by SUT, environment, workload, and config ID when created.
- Concurrent Dynatrace query creation no longer throws unique constraint violations: `ensureMetricsSourceExists` now uses a proper upsert (ON CONFLICT DO NOTHING) instead of a find-then-insert pattern.
- `GET /api/test-runs/:id/connected-sources` Dynatrace config lookup changed from N individual queries to a single `WHERE id IN (...)` batch query, eliminating an N+1 pattern.
- Bulk Dynatrace query creation now validates that all DTOs share the same config/SUT/environment/workload, preventing silent data mis-attribution on mixed-batch calls.

### Changed
- WireMock Dynatrace mock mappings (saas and managed): split the ambiguous `/api/v2/entities.*` pattern into separate exact-match list endpoint and regex single-entity endpoint, preventing incorrect response shapes for `fetchHostProperties` calls.
- Dynatrace mock entity lists now include SERVICE entities (afterburner-be, afterburner-fe) in addition to HOST entities.
- Added missing managed Dynatrace mock mappings: problems, request-attributes, entities-by-id.

## [0.2.32.3] - 2026-04-05

### Removed
- One-off debug and test scripts committed to app roots (debug-token.ts, test-preset-api.sh, monitor-db-connections.sh, monitor-pool.js, test-blocking.cjs, test-job-add.cjs, test-simple-job.cjs)

## [0.2.32.2] - 2026-04-05

### Removed
- 46 stale AI-generated report and summary markdown files across api, grafana-sync, web, worker, and docs

## [0.2.32.1] - 2026-04-05

### Fixed
- Changepoint flag now visible in test run list for BASELINE mode runs (previously hidden by mutually exclusive rendering)

## [0.2.32.0] - 2026-04-05

### Fixed
- SCALING mode test runs now correctly included in control groups after BASELINE mode rename (data migration converts existing SCALING runs)
- Data sanity check no longer falsely flags changepoint runs as missing ADAPT results

### Changed
- ControlGroupsPipeline accepts both BASELINE and SCALING modes for backward compatibility during migration rollout

## [0.2.31.0] - 2026-04-04

### Fixed
- Scaling session creation no longer fails with "User must belong to an organization" for Keycloak JWT users

### Added
- Link SLOs to scaling sessions when starting a session to define success criteria at each load level
- Scaling progression card redesigned as a selectable run list: test run ID (hover shows version + annotations), date, SLO summary, and editable comment per run
- Selecting a run shows its linked SLO results in a table matching the SLO card pattern (dashboard, metric, requirement, pass/fail)
- Anomaly detection TLDR section with SoftBadge chips per selected run, clicking deeplinks to anomaly card (new tab for different runs)
- Per-run comments stored on scaling sessions with inline editing

### Changed
- Scaling progression now uses check_results for SLO data instead of hardcoded ds_metric_statistics panels

### Removed
- Standalone scaling sessions page and sidebar link (scaling lives inside test run details)
- ADAPT conclusion from scaling progression (not meaningful in scaling context)

## [0.2.29.0] - 2026-04-04

### Fixed
- Chart PNG export now includes background, title, axes, gridlines, and legend (was transparent/invisible in dark mode, missing in light mode)
- SLO row hover no longer turns black in light mode (MUI alpha() was replacing alpha channel instead of multiplying)

## [0.2.28.0] - 2026-04-04

### Added
- Scaling sessions: group related scaling test runs with shared baseline and progression tracking
- `scaling_sessions` table with CRUD API (POST/GET/PUT /scaling-sessions)
- Progression endpoint (GET /scaling-sessions/:id/progression) returning metrics, ADAPT conclusions, and load config across all runs in a session
- Test runs with `scalingSessionId` auto-get SCALING mode and session baseline; first run auto-sets as baseline
- Scaling Progression card on test run detail page with recharts line chart, metric selector, and run status chips
- ADAPT Settings tab on system configuration page to toggle Regression/Scaling mode per workload

## [0.2.27.0] - 2026-04-04

### Added
- ADAPT SCALING mode for sizing/scaling tests: compare against a single baseline run instead of last 10 successful runs
- `adaptMode` and `baselineTestRunId` fields on POST /test for programmatic SCALING mode activation
- Workload-level ADAPT settings (GET/PUT /test-runs/workload-adapt-settings) so SCALING mode applies automatically to all new runs without plugin changes
- GET /metrics/ds-metrics/panels-by-dashboard endpoint for querying panels from ds_metric_statistics by application dashboard ID
- 7 new unit tests for SCALING mode control group selection

### Fixed
- Panel dropdown empty when selecting "Performance test metrics" dashboards in graphs, trends, and compare cards (was hitting wrong Grafana endpoint)
- Same panel dropdown bug in Add SLO and Edit SLO dialogs (fetchPerfMetricsPanels now queries ds_metric_statistics instead of Grafana)

## [0.2.26.0] - 2026-04-04

### Removed
- 37 unused source files: dead interceptors, services, DTOs, barrel exports, config files, and scripts (-7,794 lines)
- 28 unused dependencies across 7 package.json files (-106 packages from node_modules)

### Fixed
- Add missing `date-fns` dependency to web package (was only resolved via hoisting)

## [0.2.25.0] - 2026-04-04

### Added
- ~1,537 new unit tests across API, Worker, and Web packages (7,419 → 9,558 total)
- API test coverage: 45% → 53% statements, 69% → 73% branches, 57% → 61% functions
- Worker test coverage: 34% → 48% statements, 82% → 85% branches, 49% → 62% functions
- Web test coverage: 41% → 44% statements, 73% → 75% branches, 39% → 43% functions
- New test suites for: ApdexCalculator, RequirementChecker, PipelineOrchestrator, IncrementalCollectionScheduler, WorkerDatabaseService, PerformanceTestMetricsPipeline, test-runs-crud-query, data-science controller, report-data-fetcher, jtl-import, error-analysis, anomaly detection, Tempo service, deep-links, compare-presets, grafana-client, application-dashboards, grafana-dashboards, performance-query, report-html-compiler, useReports, useTemplates, usePyroscopeData, chart-utils, JobProgressIndicator

## [0.2.24.0] - 2026-04-04

### Fixed
- Fix 4 failing web tests (DashboardsSection and ServiceLevelObjectivesSection) where test assertions were out of sync with actual `authenticatedFetch` call signatures
- Fix broken web linter: update eslint-config-next from v14 to v15, replace deprecated `next lint` with direct ESLint CLI
- Fix 2 pre-existing grafana-sync lint errors (unused GrafanaInstance import and unused variable)

### Changed
- Eliminate all 289 API ESLint warnings (274 `no-explicit-any`, 7 `ban-types`, 5 `no-empty-function`, 2 `no-prototype-builtins`, 1 `no-var-requires`) with proper TypeScript types across 88 files
- Add knip dead code detection tool with workspace-aware configuration

### Added
- `knip.json` workspace configuration for dead code detection across all packages
- `npm run knip` script for running dead code analysis

## [0.2.23.1] - 2026-04-03

### Fixed
- Add ENCRYPTION_KEY validation to grafana-sync startup (prevents silent runtime crash on encrypted credentials)
- Align CORS env var: rename CORS_ORIGIN to CORS_ALLOWED_ORIGINS to match what main.ts actually reads
- Add FRONTEND_URL to API env validation schema
- Add AUTO_CONFIG_ENABLED with boolean coercion to grafana-sync validation schema
- Move class-transformer from devDependencies to dependencies in API (required at runtime by ValidationPipe)
- Align BullMQ to v5 across API and worker (was v4 in worker, causing potential job serialization mismatches)
- Fix reflect-metadata version skew in grafana-sync (0.2.x to 0.1.x to match all other packages)

### Changed
- Rename default database from `perfana_native` to `perfana` across all configs, docker-compose, and env examples
- Align DB_NAME in all .env.example files to match docker-compose POSTGRES_DB value

### Removed
- 7 unused dependencies from grafana-sync: mysql, moment, bluebird, async, semver, jsonpath-plus, lodash

## [0.2.23] - 2026-04-03

### Fixed
- Fix memory leak in job polling (monitorJobAndRefresh) that continued API calls after page navigation
- Remove Math.random() from ComparisonStatus that showed non-deterministic data to users
- Fix URL sync loop in test runs filters that could cause redundant router.replace calls
- Remove double-fetch in 4 integration hooks that duplicated the page-level data load
- Remove unused searchParams dependency in systems page that caused spurious refetches

### Changed
- Memoize AuthContext and SidebarContext provider values to prevent unnecessary re-renders across the app
- Wrap 6 derived computations in useAnomalyDetection with useMemo (filter, paginate, dropdown options)
- Replace searchParams object dependencies with primitive string extractions in useTestRunData and useRelatedTestRuns
- Remove redundant useMemo with JSON.stringify in useTestRunData (upstream equality check already prevents re-renders)

## [0.2.22] - 2026-04-03

### Fixed
- Add accessible labels and tooltips to icon-only delete buttons in profile dashboard forms and alert filters
- Wire showToast through TrackedRegressionsView so batch re-evaluation and ADAPT config updates produce user-visible feedback instead of silent no-ops
- Wrap disabled IconButtons in `<span>` for MUI Tooltip compatibility

### Removed
- 107 lines of debug `console.log` statements across 11 components (SectionConfigs, JobProgressBanner, ActionsMenu, PyroscopeSection, and others)
- Unused `components/members/` directory (4 files, 766 lines) superseded by `components/organizations/`
- Unused `OrganizationSwitcher.tsx` (178 lines) superseded by `OrganizationSelector`
- Placeholder `onLoad` console.log callbacks in ReportCard and test run page

## [0.2.21] - 2026-04-03

### Fixed
- Remove debug logging that wrote request metadata and auth config to localStorage on every API call (security)
- Remove localStorage token fallback, use sessionStorage only to prevent XSS token theft (security)
- Fix `validateApiKey` calling bare `fetch` without authentication headers
- Fix `instanceof Error` checks in GenerateReportDialog and useDeepLinksData to use safe cross-context pattern
- Fix `DeleteSystemDialog` using raw fetch instead of `authenticatedFetch` (missing 401 auto-retry)
- Fix `getPublicReport` and `buildShareUrl` bypassing runtime config (`env.API_URL`) with hardcoded `process.env`

### Changed
- Migrate 5 hooks from direct localStorage token reads to `useAuth()` context (useTrendsPresets, useComparePresets, useSLOSection, useDashboardsData)
- Remove redundant manual auth headers from hooks that already use `authenticatedFetch`
- Update CODING_RULES.md to document correct auth header pattern

### Removed
- Debug console.log statements from systems.ts, profiles.ts, reports.ts, keycloak-auth.ts
- Dead debug tools (`public/debug-logs.js`, `public/jwt-debugger.js`) that referenced removed localStorage logging
- Keycloak init session debug logging from keycloak-auth.ts

## [0.2.20] - 2026-04-03

### Fixed
- Prevent database deadlocks when bulk-deleting test runs with millions of rows in TimescaleDB hypertables
- Add deadlock retry logic (PostgreSQL 40P01) with linear backoff to deletion handler
- Set 30-second lock timeout on deletion transactions to fail fast instead of waiting indefinitely

### Added
- Bulk delete endpoint (`POST /test-runs/bulk-delete`) that queues deletions via BullMQ with concurrency 1
- Async deletion for single `DELETE /test-runs/:id` endpoint (returns 202 Accepted)
- `deletion_status` column on test runs for tracking queued/deleting/failed states
- Deletion status banner on test run detail page for other users viewing a run scheduled for deletion
- Synchronous fallback when Redis is unavailable

### Changed
- Frontend bulk delete now sends a single API call instead of N concurrent DELETE requests
- Test run list automatically filters out runs queued for deletion

## [0.2.19] - 2026-04-01

### Fixed
- Fix REEVALUATE_CHECKS stub pipeline silently returning success without doing any work (now returns failure with warning)
- Replace console.error with structured pino logger in ChecksPipeline realtime publishing
- Fix dead batch progress variables in MetricsPipeline (now actually logs batch progress)

### Removed
- Remove dead createErrorRecord/createEmptyRecord methods from MetricsPipeline
- Remove dead maybeSetAdaptDifferencesAccepted call and method from ChecksPipeline
- Remove dead getSettings method and 56-line migration guide from BasePipelineTypeORM
- Remove dead validateTestRun/hasExistingMetrics exports from worker analyze module
- Remove dead executeBatchProcessing/executeReevaluationBatch stubs from PipelineOrchestrator
- Remove unused imports from ChecksPipeline and MetricsPipeline

## [0.2.18] - 2026-03-31

### Fixed
- Fix ADAPT `computeStatus` algorithm bug where resolved regressions with non-accepted/denied resolution were incorrectly shown as UNRESOLVED
- Fix `verifyTestRunAccess` in data-science controller silently passing when test run does not exist (now throws 404)
- Add admin role check to `DELETE /data/locks` endpoint (any authenticated user could previously force-release job locks)
- Fix compare-presets admin bypass missing in `findAll` (global admins couldn't see non-global presets from other users)
- Fix `ResourceNotFoundException` being swallowed as 500 in compare-presets create/update
- Fix `ForbiddenException` being swallowed as 400 in data-science `releaseLock`
- Fix HttpException swallowing in events and alert-tag-filters controllers (NotFoundException/ForbiddenException now propagate correctly)
- Set `createdBy` field in graph-presets for RBAC Phase 2 consistency

### Removed
- Remove shipped stub endpoint `getTrackedRegressionChart` (returned wrong data with hardcoded zero percentages)
- Replace stub `getTestRunJobs` with proper 400 error (was returning fake empty data with "implementation in progress")
- Delete dead DTO files (`batch-reevaluate.dto.ts`, `batch-refresh.dto.ts`) that duplicated `batch-processing.dto.ts`
- Delete dead entity file `adapt/entities/tracked-regression.entity.ts` (real entity in packages/shared)
- Remove dead test helper and unused variables in events test suite

## [0.2.17] - 2026-03-31

### Fixed
- Fix RBAC bypass in metrics-sources write path — any authenticated user could update/delete other orgs' metrics sources
- Fix RBAC bypass in tracing-instances and pyroscope-instances — organizationId query param not validated against user's accessible orgs
- Fix Dynatrace update endpoint leaking plaintext API token in response (now masked)
- Remove Dynatrace API token prefix from debug logs (partial credential leak)
- Fix unreachable Dynatrace route caused by duplicate parameterized path (`GET :id/request-attributes`)
- Fix Grafana dashboards create endpoint blocking all JWT users (unreliable `ctx.organizationId` guard)
- Fix metrics `validateTestRunAccess` early-exit blocking access to unscoped test runs for users with no org memberships
- Replace bare `throw new Error()` with proper NestJS HTTP exceptions (ForbiddenException, BadRequestException) across 6 services
- Add `@IsUrl()` validation to Pyroscope URL generation DTOs
- Add `@IsDateString()` validation to trace-analysis time fields
- Add `@IsInt() @Min(1)` validation to Tempo search limit
- Add `@IsNotEmpty()` validation to Dynatrace entity mapping DTO fields
- Add missing `@ApiBearerAuth()` Swagger decorator to metrics and grafana/dashboards controllers

### Removed
- Remove 3 dead stub methods (findAll/findOne/create) from MetricsService and dead GET /metrics endpoint
- Remove `getFallbackValues` returning hardcoded demo data (MyAfterburner) on Grafana datasource errors
- Remove dead DTOs (DashboardRenderRequestDto, DashboardVariableValuesDto)
- Remove dead `dateToTimestamp` from PyroscopeUrlService
- Remove dead `getMaxTracesToAnalyze`/`getDefaultSearchLimit` from TraceQueryService
- Remove unused `isAdmin` assignments from TracingServicesService
- Remove orphaned JSDoc block and SQL debug logging

## [0.2.16] - 2026-03-29

### Fixed
- Resolve Next.js binary path in Docker container — start-server.js now tries workspace-level node_modules first with root fallback
- Use application_dashboard_id for ADAPT control group statistics join instead of metrics_source_id

### Added
- /auth-audit skill for multi-tenant authentication and authorization security audits

## [0.2.15] - 2026-03-28

### Changed
- Sparse data warnings no longer invalidate test runs — they are now informational "Data Notices" shown alongside results when all SLO checks completed successfully
- New `data_warnings` column on test runs separates informational warnings from hard validation errors
- Frontend shows sparse data as blue "Data Notices" section (informational) instead of orange "Data Quality Issues" (error)
- Slack and Teams notifications include data warnings as "Data Notices" with info icon

## [0.2.14] - 2026-03-28

### Fixed
- Worker now picks up Grafana instances added after startup instead of permanently caching the empty state from boot time
- Eliminated thundering herd: concurrent jobs waiting for Grafana config share a single database query via promise deduplication

## [0.2.13] - 2026-03-27

### Fixed
- Edit SLO dialog now pre-populates all fields (Source, Dashboard, Metric) from the benchmark's own data instead of relying on a fragile async fetch-and-match chain that failed for non-grafana sources and left the Save button permanently disabled
- Application dashboard API calls across SLO forms now use `?systemId=` (UUID) instead of `?system=` (name), which the backend silently ignored, causing unfiltered results
- `systemName` prop in test run SLO card now resolves to the actual system name instead of passing the UUID

### Added
- 136 unit tests for the Edit SLO form hook, validator utilities, and formatter utilities
- Generic dashboard/metric display in Edit SLO dialog for non-grafana/dynatrace sources (e.g., custom, prometheus)
- `metrics_source_id` field added to frontend Benchmark type for proper type safety
- `getSourceOption` now handles all source types (custom, prometheus, influxdb) instead of defaulting everything to "Grafana"

## [0.2.12] - 2026-03-27

### Fixed
- PostgreSQL autovacuum throttling on `ds_metrics` and `transactions` hypertables causing 68.5s query times on `transaction_buckets` CTE
- `autovacuum_vacuum_cost_delay` reduced from 20ms (set in migration 020) back to 2ms to match global default, preventing dead tuple buildup and stale visibility maps
- Added `autovacuum_analyze_scale_factor` to `transactions` table to keep planner statistics fresh
- Propagated autovacuum settings to all existing TimescaleDB chunks (parent-only ALTER TABLE does not affect existing chunks)

## [0.2.11] - 2026-03-27

### Added
- Centralized metric formatting utility (`apps/web/lib/format-units.ts`) with 11 functions: `formatDuration`, `formatDurationCompact`, `formatDurationClock`, `formatBytes`, `formatPercentage`, `formatRatioAsPercentage`, `formatChangePercentage`, `formatRate`, `formatNumber`, `formatCompactNumber`, `formatInteger`
- New `formatRate` function for rate-based metrics (req/s, ops/s, MB/s)
- 65 unit tests for centralized formatters covering all edge cases (null, undefined, NaN, negative, zero, boundaries)
- 22 unit tests for test-run-utils (formatDuration, calculateElapsedDuration, calculateProgress, isRecentlyActive)

### Changed
- AWR formatters (`awr/utils/formatters.ts`) now re-export shared functions from centralized source, eliminating 311 lines of duplication
- `test-run-utils.ts` and `test-run-formatters.ts` delegate to centralized `formatDurationClock`
- `HostPropertiesSection.tsx` uses centralized `formatBytes` instead of inline implementation

## [0.2.10] - 2026-03-26

### Fixed
- PostgreSQL write starvation prevention — reduced analyze concurrency from 5 to 2, added 120s statement timeout for analytical queries, dedicated write connection pool, backpressure via in-flight job dedup
- Prevent redundant incremental collection jobs via in-flight deduplication in scheduler
- Restore test run ID font size in collapsed card after refactor

### Changed
- Performance analysis collapsed card now shows "Ramp-up" state when test is running and still in ramp-up phase
- Add "Exclude Ramp-up" toggle to collapsed performance analysis card when in ramp-up state
- Move copy icon next to "Test Run ID" label in collapsed test run info card
- Tune PostgreSQL autovacuum for `ds_metrics` table (high-write workload)
- Worker pool size reduced from 100 to 30 connections to match reduced concurrency
- Analytical pipelines (Statistics, ControlGroups, ADAPT) use `withAnalyticsTransaction` with SET LOCAL timeout
- Metric writes (MetricsPipeline, PerformanceTestMetricsPipeline) use dedicated write connection pool

## [0.2.9] - 2026-03-25

### Added
- Copy-to-clipboard icon next to test run ID in both collapsed and expanded test run info cards
- Apdex Threshold column in performance analysis transaction tables and sampler tables
- Per-scenario transaction name filter in performance analysis overview tab
- Organization-scoped Grafana dashboard filtering — non-admin users only see dashboards from their organization's grafana instances

### Changed
- Add `organization_id` to frontend `SystemUnderTest` type for org-aware dashboard management
- Dashboard add dialog now fetches only dashboards from the system's organization grafana instances

## [0.2.8] - 2026-03-25

### Fixed
- Drop narrow unique constraints on `ds_compare_config` that blocked saving compare configs when the same dashboard+panel is used across different workloads (e.g., loadTest vs stressTest)
- Clear `setTimeout` in worker `PipelineOrchestrator.executeStage()` after `Promise.race` completes to prevent unhandled rejection crash 10 minutes after job completion

## [0.2.7] - 2026-03-25

### Fixed
- Propagate config scope (metric vs panel) through save dialog so panel-level ADAPT classification and thresholds are correctly applied

### Changed
- Disable PR Quality Gate, Claude Code Review, and Docker Build CI pipelines on pull requests (manual dispatch only)

## [0.2.6] - 2026-03-25

### Fixed
- Use fixed 1-second bucket size for incremental performance test metrics collection to prevent resolution changing mid-test (was 1s→5s after ~17 minutes)
- Delete old performance_test metrics before force re-fetch to avoid mixed-resolution data from prior incremental collection
- Add `MetricsSource` entity to grafana-sync TypeORM connection to fix startup crash (`ApplicationDashboard#metricsSource was not found`)

## [0.2.5] - 2026-03-25

### Fixed
- Propagate `metrics_source_id` through all metric pipeline paths (Grafana, performance test, incremental) to fix ADAPT regression detection failing with `NO_BASELINES_FOUND`
- Use `IS NOT DISTINCT FROM` for null-safe `metrics_source_id` join in ADAPT validator to prevent false empty control group detection

## [0.2.4] - 2026-03-25

### Fixed
- Apdex report card now uses per-transaction threshold overrides from `workload_transaction_apdex_thresholds` instead of a single default threshold
- Apdex report transactions table displays the actual threshold used per transaction
- Overall Apdex threshold display shows "varies per txn" when different transactions use different thresholds

### Removed
- Stale auto-claude artifacts (`.auto-claude-security.json`, `.auto-claude-status`, `.claude_settings.json`)
- Completed database migration consolidation docs (`database/DEPLOYMENT_CHECKLIST.md`, `MIGRATION_CONSOLIDATION.md`, `PRODUCTION_DEPLOYMENT_SUMMARY.md`)
- Unused SonarQube files (`fix-coverage-paths.sh`, `run-sonar-scan.sh`, `sonar-project.properties`)

### Changed
- Updated `.gitignore` to prevent future accumulation of tool artifacts (`.playwright-mcp/`, `.serena/`, auto-claude files)

## [0.2.3] - 2026-03-24

### Removed
- 53 obsolete files: backup files (.bak/.backup), unused Dockerfiles (optimized/security/simple/slim), superseded SQL migrations, archived TypeORM migrations, stale planning docs, one-time fix scripts, dead utilities, and build artifacts
- Old migration archives (`database/migrations/`, `database/migrations_archive/`)

### Fixed
- Exported previously inert migrations 003 (AddTagsHashUniqueIndex) and 004 (AddAlertsSupport) from `packages/shared/src/database/index.ts`

### Changed
- Upgraded vendored gstack to v0.11.15.0

## [0.2.2] - 2026-03-24

### Added
- Server-side ADAPT regression classification in MCP `get_adapt_results` tool — returns pre-classified regressions, dashboard groupings, causal chains, and hypotheses so Claude doesn't need to parse raw data
- Optional Obsidian output in perfana-report skill — user can choose between Obsidian vault or local `reports/` file

### Changed
- MCP permissions use wildcard `mcp__perfana__*` instead of individual tool entries — eliminates ~20 approval prompts per report
- Updated perfana-report skill Step 3.5 to consume pre-processed ADAPT data directly

### Fixed
- CI Docker build failures (missing curly braces for eslint, dollar escapes in schema-sql)
- Embedded schema SQL in migrations to eliminate Docker build dependency on pg_dump
- Trace and Pyroscope bugfixes from demo testing (scenario/transaction filtering, cross-source correlation)
- Data sources service resilience improvements

## [0.2.1] - 2026-03-23

### Added
- Cross-source root cause investigation in the `perfana-report` Claude Code skill — automatically fetches traces, flamegraphs, and Dynatrace problems when data sources are connected
- Investigation playbook reference mapping 15 hypothesis types to targeted MCP tool calls with evidence quality criteria
- Enhanced report template with Investigation section: distributed traces, CPU profiling hotspots, Dynatrace infrastructure problems, dashboard snapshots, evidence chain, and confidence levels
- Graceful degradation when sources are unavailable — investigation gaps are noted in the report, analysis continues

## [0.2.0] - 2026-03-23

### Added
- 8 new MCP tools for cross-source root cause analysis: `list_connected_sources`, `get_grafana_dashboard_snapshot`, `get_slow_traces`, `get_trace_detail`, `get_error_traces`, `get_flamegraph`, `get_hotspots`, `get_dynatrace_problems`
- Test-run-scoped API endpoints that resolve data source instances automatically from testRunId
- Tempo trace proxy: search slow/error traces and fetch full span breakdowns via TraceQL
- Pyroscope flamegraph proxy: fetch collapsed-stack profiles and hotspot analysis for a service
- Dynatrace problems proxy: fetch infrastructure problems detected during a test run time window
- Dashboard snapshot endpoint: aggregate min/max/avg/last stats for all panels in one call
- Connected data sources discovery: shows which Grafana, Tempo, Pyroscope, and Dynatrace instances are available for a test run
- Input validation for trace IDs (hex format) and service names (TraceQL injection prevention)
- Downstream request timeouts (10s) for all Tempo and Pyroscope proxy calls
- 16 new MCP client tests covering all new methods

## [0.1.0] - 2026-03-23

### Added
- MetricsSource entity unifying Grafana, Dynatrace, InfluxDB, and Prometheus under a single abstraction (Phase 3)
- MetricsSource 1:1 granularity eliminating synthetic GrafanaDashboard rows (Phase 3.7)
- ADAPT algorithm JOINs on `metrics_source_id` for cross-source regression detection (Phase 3.7)
- Frontend `source_type` utility for consistent metrics source display (Phase 3.7)
- Dynatrace WireMock mappings for local development (Phase 3)
- Pipeline registry pattern replacing per-source worker wrappers (Phase 4g)
- Document algorithms, extract magic numbers, and fix error logging (Phase 4a-c)
- Panels in reevaluate flow and incremental collection resilience (Phase 4e-f)
- Grouped dashboard dropdown with source badges in SLO dialog (Phase 6)
- Fetch all SLO dashboard sources on dialog open (Phase 6)
- Open source launch files: LICENSE (Apache 2.0), CONTRIBUTING.md, README, setup script
- GitHub Actions CI workflow (`pr-quality-gate.yml`)
- Dependabot configuration for automated dependency updates

### Changed
- `metrics_source_id` wired end-to-end through DynatracePipeline
- Configuration migration to reference MetricsSource instead of legacy dashboard IDs
- Filter synthetic dashboards from Add Dashboard picker using `source_type`
- Dark mode fix for Dynatrace host performance graphs

### Removed
- Dead worker code totaling ~960 lines (Phase 4d)
- Old worker wrappers replaced by pipeline registry (~1,413 lines)
- Stale Supabase references and unused dev scripts
