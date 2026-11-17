# Splunk log metrics — spec (step 2)

Status: **proposal**, not implemented. Nothing here has been run against a live Splunk.

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
verify_tls boolean default true     -- on-prem Splunk often runs a self-signed 8089 cert
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
search <spl>
  earliest=<from epoch> latest=<to epoch>
| timechart span=<bucket>s limit=<max_series> useother=t <aggregation> by <split_by>
```

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

All tables need: entity, migration (next number after head), RLS policy, ownership columns,
and an entry in the SUT export/import table list.

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
5. **Label it (optional):** `frontend`, `backend`, `db`. A query can then target `$entities[backend]`.
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

## Querying Splunk

One endpoint: `POST {host}/servicesNS/-/{splunk_app}/search/v2/jobs/export`, form-encoded,
with `search=...` and `output_mode=json`. It streams one JSON object per line; a timechart gives
one row per bucket: `{"result":{"_time":"…","ERROR":"12","WARN":"3","OTHER":"0"}}`.

- Parse line by line; a `{"messages":[{"type":"FATAL"|"ERROR",...}]}` line is a failed search
  and fails the range (do not record it as collected with 0 points).
- `_time` is the bucket start. Each non-`_`-prefixed key is a series; `metric_name` = the key,
  clamped through `DS_METRICS_VARCHAR_LIMITS` like every other writer.
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

**Bucket size.** Use the bucket size `ds_metrics` already gets for that run (the size the
Dynatrace collector picks from the run length), so Splunk series line up with the other panels on
the Graphs card. Minimum 5 s; Splunk's timechart enforces nothing smaller than 1 s anyway.

## Collection

### Live (incremental) ticks

- `IncrementalMetricsInput` gains `collectSplunkMetrics?: boolean` and `splunkConfigId?: string`.
- `SplunkCollector` mirrors `DynatraceCollector`: load enabled `splunk_queries` for the run's
  SUT / env / workload, run each over `[fromTime - SPLUNK_INGEST_LOOKBACK_MS, toTime]`,
  hand rows to `BatchProcessor`.
- `SPLUNK_INGEST_LOOKBACK_MS` default **5 min**: Splunk indexing lag is routinely tens of seconds
  and minutes under load, more than Dynatrace's. Re-querying overlapping buckets is safe because
  the `ds_metrics` write is an upsert on the conflict key.
- Collection status: one `ds_metric_collection_status` row per `('splunk', splunk_config_id)`;
  `getConfiguredSourceKeys` in `collectable-sources.ts` adds the Splunk configs that have an
  enabled query for the run's scope. **A disabled query must not register** (otherwise coverage
  reads 0 %, Common Issue #21).

### Analyze

- New stage `splunk-collection` next to `dynatrace-collection` in `PipelineOrchestrator`'s stage
  list, inside the set `checkAndFillMetricGaps` can skip. Gap-filling a ticked run re-queries
  only the failed ranges (`retryCollectionForRange` gets a `'splunk'` arm); never fall back to a
  full re-collection for a run that had ticks (Common Issue #25).
- A run without ticks (SUT import, Splunk added afterwards) runs one export over the whole run.
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
- `POST /splunk/configs/:id/test-connection` — `GET /services/server/info` with the auth header.
  Report 401 vs connection refused vs TLS error separately; the 8089-not-opened case on Splunk
  Cloud surfaces as a connect timeout, so say so in the message.
- `POST /splunk/queries/preview` — runs the query over the last N minutes (or a given run's
  window) and returns the first rows and series names, so a user can see the split before saving.
- Web: an Integrations card for Splunk configs, and a queries editor on the system config page
  next to the Dynatrace one. SPL is a `<textarea>`; no SPL parser.

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
- Reject `spl` containing `| sendemail`, `| outputlookup`, `| collect`, `| delete`, `| script`,
  `| run` — the commands that write or execute. A denylist is a convenience, not the boundary;
  the Splunk role is.
- No SPL reaches a URL; it goes in the POST body.

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
