# Splunk log metrics — spec (step 2)

Status: **implemented** in v0.2.97.72 (PR #742), tested against a Splunk mock only, never a live
Splunk. Written as a proposal; the sections below are updated where the implementation differs.
Deferred items are under "Splunk integration" in `TODOS.md`.

## Goal

Turn Splunk log events into time series stored in `ds_metrics`, so that log behaviour during a
test run (error volume, warnings per host, exceptions of one kind) gets everything a Dynatrace
metric already gets, without new code downstream of collection:

- ADAPT regression detection against the baseline ("ERROR count +300 %")
- SLOs (`ERROR count < 10 in the analysis window`)
- Graphs / Trends / Compare cards
- Reports — the existing Graphs, SLO and Regressions sections

Out of scope: storing raw log lines, a log viewer, the "Top log errors" report section (step 3),
the "Open in Splunk" deep link (step 1 — trivial, can ship with this).

## Model: copy Dynatrace, rename the nouns

Dynatrace is already a non-Grafana source that writes into `ds_metrics` through an artificial
dashboard. Splunk takes the same path; where this spec says "as Dynatrace", copy that code.

| Dynatrace | Splunk |
|---|---|
| `dynatrace_configs` | `splunk_configs` |
| `dynatrace_queries` | `splunk_queries` |
| `DynatracePipeline` (`dynatrace-collection` stage) | `SplunkPipeline` (`splunk-collection` stage) |
| `helpers/incremental/dynatrace-collector.ts` | `helpers/incremental/splunk-collector.ts` |
| `helpers/dynatrace-dashboard-manager.ts` | generalise it (see "Artificial dashboard" below) |
| `metrics_sources.source_type = 'dynatrace'` | `'splunk'` |
| `DYNATRACE_INGEST_LOOKBACK_MS` | `SPLUNK_INGEST_LOOKBACK_MS` |

## Schema

### `splunk_configs` — one per Splunk deployment, org-owned

```
id uuid pk
label varchar(255) not null
host varchar(500) not null          -- https://splunk.example.com:8089 (management port, not 8000)
client_url varchar(500)             -- browser-facing Splunk Web, for deep links; falls back to host
api_token text                      -- Splunk authentication token -> "Authorization: Bearer"
username varchar(255)               -- basic auth when api_token is blank (same rule as grafanaAuthHeader)
password text
splunk_app varchar(100) default 'search'   -- namespace: /servicesNS/-/<app>/search/v2/jobs/export
verify_tls boolean default true     -- stored but not enforced yet (TODOS.md, Splunk review polish)
use_proxy boolean default false
max_concurrent_searches int default 2
organization_id uuid not null, team_id uuid, created_by, updated_by, created_at, updated_at
```

Credentials are encrypted and masked like `dynatrace_configs.api_token`. `host` goes through
`normalizeUrl` (SSRF guard); `client_url` follows the Dynatrace `client_url` rules
(http/https only, `require_protocol: true`).

### `splunk_queries` — one per panel, scoped to SUT / environment / workload

```
id uuid pk
splunk_config_id uuid not null fk
system_under_test_id uuid not null, test_environment varchar(255) not null, workload varchar(255) not null
dashboard_label varchar(500) not null     -- e.g. "Splunk logs"
application_dashboard_id uuid             -- artificial dashboard, filled on first collection
metrics_source_id uuid
panel_title varchar(500) not null         -- e.g. "Log events by level"
panel_id integer not null
spl text not null                         -- search body WITHOUT time bounds or timechart (see below)
split_by varchar(255)                     -- field to split series on, e.g. log_level, host; null = one series
aggregation varchar(20) default 'count'   -- count | dc(<field>) | avg(<field>) | p95(<field>) ...
metric_unit varchar(50) default 'short'
max_series int default 20
enabled boolean default true
organization_id uuid not null, team_id uuid, ...
```

`spl` may contain `$entities`, which expands to the scope's entity mappings (next section). The
starter panels are just `$entities` plus a level filter, so most users never write SPL.

Users write the filter. Perfana owns the time bounds and the bucketing, so a query cannot
accidentally read outside the run or at the wrong resolution. Perfana sends:

```
search=search <mapped sources> | search <spl, expanded>
       | timechart span=<bucket>s <aggregation> by <split_by> limit=<max_series> useother=t
earliest_time=<from epoch>  latest_time=<to epoch>  output_time_format=%s
```

The mapped sources run first as their own search and the user's filter is piped after it, so a
filter can only narrow the search (`$entities OR index=_audit` still reads only mapped sources).
The time range travels as the export endpoint's `earliest_time` / `latest_time` form parameters,
never inline in the search text (v0.2.97.80): against a real Splunk an inline
`earliest=<epoch> latest=<epoch>` returned no rows for a window that the same search showed in
Splunk Web, where the range sits in the time picker. The mock in `perfana-demo` reads both shapes.

`limit` + `useother=t` caps the number of series (log levels and hosts are free text, the same
problem as `requests_error.response_code` / `MAX_CODE_SERIES`). The `OTHER` series is kept, so
totals stay correct.

### `splunk_entity_mappings` — which log sources belong to a system

Same shape and semantics as `dynatrace_entity_mappings`:

```
id uuid pk
splunk_config_id uuid not null fk
system_under_test_id uuid not null
test_environment varchar(255)      -- NULL at level 'sut'
workload varchar(255)              -- NULL at levels 'sut' and 'environment'
level varchar(50) not null         -- 'sut' | 'environment' | 'workload'
index_name varchar(255) not null
sourcetype varchar(255)            -- NULL = any sourcetype in the index
host_pattern varchar(500)          -- exact host or Splunk wildcard (app-*); NULL = any host
labels text[] default '{}'         -- e.g. {frontend}, {db}; queries can target a label
organization_id uuid not null, team_id uuid, ...
```

All tables have an entity, RLS policy and ownership columns (migration 1825), and all three are in
the SUT export/import (`sut-resource-graph.ts`): `splunk_configs` by reference (the configs the
SUT's mappings or queries point at, credentials still encrypted, as `dynatrace_configs`),
`splunk_entity_mappings` and `splunk_queries` by SUT.

## Selecting Splunk entities

The user never picks Splunk sources per test run. As with Dynatrace, entities are mapped to the
system under test at a **level**, and a run uses every mapping that matches its scope:
the system's `sut` mappings, plus its environment's, plus its workload's. A new run of an existing
workload needs no setup.

### Where in the UI

System config page → **Splunk** tab, next to the Dynatrace one:

1. **Pick a Splunk config** (from the Integrations page).
2. **Browse what Splunk has.** Perfana runs one discovery search over the last 24 h:

   ```
   | tstats count where index=* by index, sourcetype, host
   ```

   `tstats` reads index-time metadata only, so it answers in seconds without scanning raw events,
   and it sees only the indexes the token's role is allowed to search. The UI shows it as a tree:
   index → sourcetype → host, each with its event count, plus a text filter.
3. **Select.** Ticking a node creates a mapping: a whole index, an index + sourcetype, or
   individual hosts. A **pattern** field accepts `host_pattern` directly (`app-*`, `*-perf-*`),
   which is what Kubernetes and autoscaled hosts need. Pod names change every deploy, so an exact
   host picked from the discovery list is wrong by the next test.
4. **Choose the level:** this system, this environment or this workload. Default: environment,
   because test environments usually have their own hosts and workloads share them.
5. **Label it (optional):** `frontend`, `backend`, `db`. A query can then target `$entities[backend]`
   (outside quotes; the validator does not read its brackets as a subsearch).
6. **Preview.** Shows the starter panels over the last hour (or over a chosen past test run's
   window) for the selection, so the user sees "ERROR 12, WARN 340, INFO 51k" before saving.
   An empty preview with a non-empty discovery count means the level field is named differently.
   The preview lists the candidate fields (`level`, `log_level`, `severity`, `loglevel`) found by
   `| fieldsummary maxvals=10` on a sample, and the user picks which one the panels split on.

Copying to another workload or environment reuses the Dynatrace copy endpoint's shape
(`POST /splunk/entities/mappings/copy`), keeping each mapping's level.

### How `$entities` expands

Mappings for the run's scope, grouped by index, OR-ed together:

```
(index=web sourcetype=nginx host=app-*) OR (index=java host IN ("svc-01","svc-02"))
```

`$entities[backend]` keeps only mappings with that label. Every value is escaped as an SPL string
literal. With no mapping in scope, the query is not run and the collection-status row is not
registered (otherwise coverage reads 0 %, Common Issue #21).

### Why discovery is a search, not REST metadata

`/services/data/indexes` lists indexes but not hosts or sourcetypes, and `| metadata type=hosts`
returns one dimension at a time. `tstats … by index, sourcetype, host` gives the whole tree in one
call. Cache the result per config for 10 minutes; discovery counts against the same
concurrent-search limit as collection.

### On the test run page

The run's Splunk card lists the mappings in effect for that run (read from the run's scope, never
from the first mapping row — Common Issue #42) and an **Open in Splunk** link with the run's
`$entities` filter and time window.

Each panel with series also carries the shared **Open in Graphs / Compare / Trends** menu
(`OpenInCardMenuItems`, v0.2.97.86). It sends a panel-wide link with no `metric`, so the card adds
every series on that panel. The run summary (`GET /splunk/runs/:testRunId/summary`) returns each
panel's `dashboardLabel` for this: the artificial dashboard its series are stored under in
`ds_metrics`.

## Querying Splunk

One endpoint: `POST {host}/servicesNS/-/{splunk_app}/search/v2/jobs/export`, form-encoded,
with `search=...`, `output_mode=json` and `output_time_format=%s`. It streams one JSON object per
line; a timechart gives one row per bucket: `{"result":{"_time":"1795007100","ERROR":"12","WARN":"3","OTHER":"0"}}`.

- Parse line by line; a `{"messages":[{"type":"FATAL"|"ERROR",...}]}` line is a failed search
  and fails that panel (see "Live (incremental) ticks" for what that does to the tick). A row with
  `"preview": true` is an interim result set and is skipped; counting it doubles the totals.
- `_time` is the bucket start. Each non-`_`-prefixed key is a series; `metric_name` = the key,
  clamped through `DS_METRICS_VARCHAR_LIMITS` like every other writer.
- `_time` arrives as epoch seconds because every export sends `output_time_format=%s`
  (v0.2.97.85). Before that, `_time` was read in whatever format Splunk sent, and a row whose
  `_time` `Date` could not parse was dropped silently. Rows came back with value columns and no
  point was collected. The format that Splunk sent was never captured, so the cause is inferred:
  a non-ISO format such as a locale display string (`2026-11-18 14:05:30.000 CET`) or bare epoch
  digits. Asking for `%s` takes the format out of Splunk's hands either way. `parseSplunkTime`
  reads epoch seconds and still accepts ISO; a row whose `_time` it cannot read is skipped.
- An empty bucket comes back as `0` from timechart, so zero-filling is free. Do not convert
  `0` to null — "zero errors" is the value an SLO wants.
- Timeout: `AbortSignal.timeout(SPLUNK_SEARCH_TIMEOUT_MS)`, default 120 s.
- Auth header: one helper, `splunkAuthHeader(config)`, token wins over basic, same contract as
  `grafanaAuthHeader`. Every call site uses it.

**Search concurrency.** Splunk caps concurrent searches per user and per role. A rejected search
answers 503 / "maximum number of concurrent searches", which reads like an outage. Run at most
`max_concurrent_searches` per config at once (a per-config semaphore inside the worker process is
enough to start with; ticks for one run already serialise). Treat that error as retryable, not as
a failed range.

**Bucket size.** The perf-test tick size from `planned_duration` (`perfTestBucketSizes().tick`,
60 s when the run has none), on every path: live tick, gap fill, full path and force refetch. Never
derive it from `end_time`: the keep-alive moves that during a live run, the size would step up, and
because `time` is in the `ds_metrics` conflict key the old buckets would stay beside the new ones.
Values are per bucket, not per second, so runs of one workload with different planned durations
compare counts over different spans (TODOS.md).

## Collection

### Live (incremental) ticks

- `IncrementalMetricsInput` gains `collectSplunkMetrics?: boolean` and `splunkConfigId?: string`.
- `SplunkCollector` mirrors `DynatraceCollector`: load enabled `splunk_queries` for the run's
  SUT / env / workload, run each over `[fromTime - SPLUNK_INGEST_LOOKBACK_MS, toTime]`,
  hand rows to `BatchProcessor`.
- A panel whose search errors keeps its error in the result and the rest of the tick stands, as
  `GrafanaCollector` does; failing the range on one broken panel would re-search the whole run
  every minute. Only a connection-level failure fails the tick: the config row is missing, it
  belongs to another organization, the run has no organization (fail closed), or loading or
  writing threw.
- `SPLUNK_INGEST_LOOKBACK_MS` default **5 min**: Splunk indexing lag is routinely tens of seconds
  and minutes under load, more than Dynatrace's. Re-querying overlapping buckets is safe because
  the `ds_metrics` write is an upsert on the conflict key.
- Collection status: one `ds_metric_collection_status` row per `('splunk', splunk_config_id)`.
  One predicate, `COLLECTABLE_SPLUNK_CONFIGS_SQL` in `collectable-sources.ts`, decides which
  configs collect: an enabled query and a mapping in the run's scope. The scheduler and
  force-refetch discovery use `getCollectableSplunkConfigIds` (never throws); the orphan sweep in
  `getConfiguredSourceKeys` uses `loadCollectableSplunkConfigIds`, which throws on a query error so
  a transient error does not delete a live row. **A disabled query must not register** (otherwise
  coverage reads 0 %, Common Issue #21).

### Analyze

- New stage `splunk-collection` next to `dynatrace-collection` in `PipelineOrchestrator`'s stage
  list, inside the set `checkAndFillMetricGaps` can skip. Gap-filling a ticked run re-queries
  only the failed ranges (`retryCollectionForRange` gets a `'splunk'` arm); never fall back to a
  full re-collection for a run that had ticks (Common Issue #25).
- A run without ticks (SUT import, Splunk added afterwards) runs one export over the whole run.
  The stage is soft-failed: a Splunk error is logged and the analysis continues, because analyze
  runs with `errorHandling: 'abort'`. It records a collected range only when the run already has
  status rows; writing the first row would make the next analyze treat the run as incrementally
  collected and skip its Grafana and Dynatrace stages.
- Force refetch (re-evaluate) uses the same no-first-row guard, and refuses to mark the source
  complete if any panel errored, because "complete" is sticky and suppresses re-collection.
- Delete-before-write on that path uses `DELETE FROM ds_metrics WHERE test_run_id = $1 AND
  metrics_source_id = $2` **only if** that shape is proven segment-friendly; otherwise follow
  whatever `DynatracePipeline` does today (Common Issue #23 explains why a non-`test_run_id`
  predicate on the hypertable is expensive).

### Artificial dashboard

`dynatrace-dashboard-manager.ts` creates the `application_dashboards` + `grafana_dashboards` +
`metrics_sources` rows Dynatrace hangs its panels on. Generalise it to take a `sourceType` and a
uuid namespace rather than copying it; rules that carry over unchanged:

- `grafana_json` NULL on the artificial `grafana_dashboards` row — that is how every reader
  tells it apart (never by `grafana_id` range).
- `grafana_instance_id` NULL on the `application_dashboards` row (Common Issue #41).
- Deterministic id per (SUT, env, workload, dashboard_label), scoped lookups (Common Issue #44).
- `organizationId` camelCase in `repo.create`.
- `filterCollectableGrafanaDashboards` must not register a Grafana source for it.

## API + UI

- `apps/api/src/modules/splunk/`: CRUD for configs and queries (copy the Dynatrace controller
  shape and its org scoping: 404 outside the caller's orgs, `withOrgFilter`, system-call arm).
  A query's `dashboard_label` is fixed at create: it is hashed into the artificial dashboard's id,
  so PATCH does not accept it (a rename would collect under the new label against the old one).
- Re-fetch Missing Data: the refresh dialog has a Splunk checkbox, and
  `POST /data/refresh/available-sources` returns `splunk`.
- `POST /splunk/configs/:id/test-connection` — `GET /services/server/info` with the auth header.
  Report 401 vs connection refused vs TLS error separately; the 8089-not-opened case on Splunk
  Cloud surfaces as a connect timeout, so say so in the message.
- `POST /splunk/queries/preview` — runs the query over the last N minutes (or a given run's
  window) and returns the first rows and series names, so a user can see the split before saving.
- Web: an Integrations card for Splunk configs, and a queries editor on the system config page
  next to the Dynatrace one. SPL is a `<textarea>`; no SPL parser.

## Importing a Splunk dashboard

The Splunk tab's **Import dashboard JSON** (`ImportSplunkDashboardDialog.tsx`) converts an
exported Dashboard Studio definition into panels for the selected workload. The conversion is
client-side and pure (`apps/web/lib/splunk-dashboard-import.ts`); each panel is then created
through the ordinary `POST /splunk/queries`, one at a time because `nextPanelId` is `MAX + 1`.
No API change was needed beyond letting the client send `dashboardLabel`, which the import
sets to the Splunk dashboard's title.

A dashboard search is a whole pipeline, a Perfana panel is a filter plus one aggregation, so a
search is cut into leading terms (`index=` replaced by `$entities`; `earliest`/`latest` and
`$token$` terms dropped), the allowed streaming commands, and one reporting command (`timechart`,
`stats`, `top`/`rare`, `chart … over _time`) whose first aggregation and single `by` field become
`aggregation` and `split_by`. Only display commands (`fields`, `table`, `rename`, `sort`,
`head`, `tail`, `fillnull`) may follow it; anything else, a generating command, a subsearch, a
macro or a saved search is reported as not imported with the reason. `ds.chain` data sources are
followed to their base. Identical conversions are imported once.

The allowlist and the final check are the API's own: the converter imports
`ALLOWED_SPL_COMMANDS` and `validateSplFilter` from `@perfana/shared/services/splunk/client`
(a module with no imports, so it bundles into the browser), and a converted filter that
`validateSplFilter(spl, { timeModifiers: true })` refuses is listed as not imported rather than
offered and then rejected by the API. The tests convert a real exported dashboard
(`apps/web/__tests__/lib/fixtures/splunk-studio-dashboard.json`).

## Starter queries (seeded as a profile, editable)

| Panel | `spl` | `split_by` | `aggregation` |
|---|---|---|---|
| Log events by level | `$entities` | `log_level` | `count` |
| Errors by host | `$entities log_level=ERROR` | `host` | `count` |
| Exceptions by type | `$entities "Exception" \| rex "(?<exception>\w+Exception)"` | `exception` | `count` |

Field names (`log_level`, `level`, `severity`) differ per customer; the field picked in the
entity preview replaces `log_level` in the seeded panels.
If the SUT logs the `perfana-test-run-id` request header, a query may add
`perfana_test_run_id=$testRunId` — `$testRunId` is the only template variable Perfana substitutes
(escaped as an SPL string literal).

Compare config for these panels: `higherIsBetter = false`, and a small absolute floor
(`minSampleCount` does not apply — a count series has one point per bucket). Error-count panels
are exactly where a relative change on a near-zero baseline is noise: 1 → 3 errors is +200 %.
Set the compare config's existing `absoluteThreshold` in the template (e.g. 10 events per bucket),
or ADAPT will flag every run.

## Security

- SPL is user-authored and runs with the token's Splunk permissions. Document that the token
  should belong to a dedicated Splunk role with `search` on the relevant indexes only, and a
  `srchJobsQuota` sized for `max_concurrent_searches`.
- `validateSplFilter` allowlists the commands a filter may pipe through (`ALLOWED_SPL_COMMANDS`:
  search, where, rex, eval, fields, rename, regex, spath, fillnull) and refuses subsearches and
  macros. It is quote-aware: inside double quotes `|`, `[` and backticks are literal; a
  single-quoted field name may not contain quotes, pipes, brackets, backticks, `$` or backslashes,
  so it cannot desynchronise the tokenizer and hide a pipe. Placeholders belong outside quotes.
  With `timeModifiers: true` (the API's save and preview check) it also refuses time modifiers in
  search segments (the leading terms and `| search`): `earliest`, `latest`,
  `_index_earliest`/`_index_latest`, `starttime`/`endtime` (and the `u` forms), and the deprecated
  `*ago` / `searchtimespan*` spellings (v0.2.97.80), naming the one it found. Double-quoted text is
  a literal and is skipped; single-quoted names are checked; dotted or `$` names (`json.latest=`)
  and `| eval endtime=...` are fields and are allowed. The send path (`buildTimechartSearch`,
  `splunkFieldSummary`) runs the validator without that option: there the filter sits after
  Perfana's own `<sources> | search`, where a modifier cannot widen the window, and refusing it
  would stop a saved panel from collecting. Before v0.2.97.80 the save check refused only
  `earliest`/`latest`, anywhere in the filter. It is a convenience, not the
  boundary; the Splunk role is.
- No SPL reaches a URL; it goes in the POST body.
- A failed connection answers with the network error code and a fixed hint only
  (`describeFetchError`). The raw cause carries the resolved IP and port, so it goes to the
  server log alone (`SplunkError.detail`, built from structured fields, never message text), or
  test connection becomes a map of the internal network. Logged hosts go through `hostForLog`,
  which drops `user:password@`.

## Troubleshooting the connection

The management URL is splunkd's REST port, `https://<search-head>:8089` on-prem and
`https://<stack>.splunkcloud.com:8089` on Splunk Cloud — not Splunk Web (8000) and not HEC (8088).
A failed test logs `WARN [SplunkService] Splunk connection test to <host> failed: … | cause: …` in
perfana-api, and the dialog shows the code:

| Code | Meaning |
|---|---|
| `ENOTFOUND` / `EAI_AGAIN` | The API container cannot resolve the hostname. Usually an internal name tested from outside that network. |
| `ECONNREFUSED` | The host is up but nothing listens on that port. |
| `ETIMEDOUT` / `UND_ERR_CONNECT_TIMEOUT` | Dropped by a firewall or allow list, or a proxy is needed (**Use proxy**). On Splunk Cloud, 8089 opens through a support case and the `search-api` IP allow list starts closed. |
| a certificate code | 8089 usually serves Splunk's self-signed certificate. Add the issuing CA through `NODE_EXTRA_CA_CERTS` on api and worker; `verify_tls` is not enforced yet. |
| `ERR_SSL_WRONG_VERSION_NUMBER` | The port does not speak TLS; check http vs https. |

"has neither a token nor a username and password" is raised before any network call, so a typo in
the host only shows up once credentials are filled in.

## Troubleshooting empty panels

With `LOG_LEVEL=debug` the worker logs every search it sends and what came back:
`Splunk panel "<title>" search (<ms>ms, <n> lines, <n> final rows, <n> preview rows, columns <cols>): <SPL> [earliest_time=<epoch> latest_time=<epoch>]`.
Paste the SPL into Splunk Web and set the bracketed range in the time picker to compare: since
v0.2.97.80 the range is sent as parameters, not as part of the search text. `0 lines` means Splunk returned nothing for that window;
`used last preview set` means the export sent no final rows (handled since v0.2.97.75). A panel
whose search returns no points also logs its window and SPL at info level.

Rows with no points is a different case (v0.2.97.82). A timechart `by <field>` over events that
lack the field returns one row per bucket carrying only `_time`/`_span`, so a panel can get
hundreds of final rows and plot nothing. The worker then logs at **warn**, naming the field and the
columns, and the Splunk tab preview shows the same text. The usual causes are a field named
differently (`level`, `severity`) or a search-time extraction that lives in another app than the
connection's **App**; a filter such as `log_level=ERROR` on the same field returns no rows at all.

Rows with value columns and still no points has two causes (v0.2.97.85). Either `_time` failed to
parse, or every cell is empty, which a non-`count` aggregation such as `avg(<field>)` returns for
buckets with no events. Before that version a panel could return hundreds of rows this way and log
only `returned no data`, most likely because `_time` came back in a format `Date` cannot parse.
Since the export asks for epoch seconds, an unreadable `_time` should only recur on a Splunk that
ignores `output_time_format`. When the first row's `_time` (`ExportStats.firstTime`) does not
parse, the warn line and the preview quote it and say Perfana cannot read it; empty cells under a
readable `_time` still log only `returned no data` at info. A run that collected nothing because of
`_time` needs a force re-fetch while Splunk still holds the window.

The card-level **Open in Splunk** link searches only the mapped sources. Each panel's own link runs
that panel's search, so use it to check a filter.

Analysis re-reads Splunk once for a run collected live, if the run ended in the last 24 hours, to
pick up events Splunk indexed after the live ticks' 5-minute lookback. Recover an older run with a
force re-fetch.

## Docs

- `docs-user/docs/integrations/connect-splunk.md`: token creation, the Splunk role, Splunk Cloud
  prerequisites (paid stack, support case to open 8089, add Perfana's egress IP to the
  `search-api` allow list via ACS — closed by default), field-name mapping.
- `docs/reference/Features/Integrations.md`: add Splunk to the source table.

## Tests that matter

- Export-stream parser: timechart rows, `OTHER`, a FATAL message line, a truncated last line.
- Concurrency error is retried, not recorded as collected.
- A disabled query does not create a collection-status row.
- Artificial dashboard: second workload in the same environment gets its own row (Issue #41 regression).
- Org scoping: config and queries 404 across orgs.

## Open questions

1. Splunk Cloud only, or on-prem Enterprise too? Changes how much TLS / proxy work is needed.
2. Does any customer already log `perfana-test-run-id`? If so, that filter becomes the default.
3. What `absoluteThreshold` default suits an error-count panel? Pick it from a real run's
   baseline once one exists.
