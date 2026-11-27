# Loki log metrics — spec

Status: **implemented** in v0.2.97.108. Built for an on-prem Grafana Enterprise with Loki as a
datasource; tested against mocked Grafana responses only, never a live Loki. The model is
[[Splunk Log Metrics (spec)]] with the nouns changed; this page says where it differs and why.

## Goal

The same as Splunk's: log behaviour during a test run becomes `ds_metrics` series, so ADAPT, SLOs,
Graphs / Trends / Compare and reports cover it with no code downstream of collection. On top of
that, the run page's card shows what Loki can tell a performance engineer that a metric cannot:
the log **patterns** of the run and which ones are new, and the actual error lines.

## Reached through Grafana, never directly

A Loki connection (`loki_configs`) is a **Loki datasource on a Grafana instance** Perfana already
holds credentials for: `grafana_instance_id` + `datasource_uid`, no host or secret of its own.

| Call | Through Grafana | Loki endpoint behind it |
|---|---|---|
| metric query (collection, preview) | `POST /api/ds/query`, `queryType: 'range'`, `step: '<n>s'` | `/loki/api/v1/query_range` |
| log lines (snapshot) | `POST /api/ds/query`, `maxLines`, `direction: 'backward'` | `/loki/api/v1/query_range` |
| labels, label values | `GET /api/datasources/uid/:uid/resources/labels`, `.../label/:name/values` | `/loki/api/v1/labels`, `.../label/:name/values` |
| patterns | `GET /api/datasources/uid/:uid/resources/patterns` | `/loki/api/v1/patterns` (Loki 3 pattern ingester) |
| datasource list (dialog) | `GET /api/frontend/settings`, fallback `GET /api/datasources` | — |

Why: on-prem Loki is usually unauthenticated behind Grafana, its port is not reachable from
Perfana, and a multi-tenant Loki's `X-Scope-OrgID` lives on the datasource. All of these need
`datasources:query` only, which a **Viewer** service account holds (root CLAUDE.md, "The Grafana
service account needs Viewer"). The datasource's config is never read. Grafana's own data source
permissions and audit log cover Perfana's queries. `X-Grafana-Org-Id` is sent from
`grafana_instances.org_id` when numeric. The base URL is `server_url`, else `client_url`; the
instance's `use_proxy` picks the organization proxy, exactly as for Grafana panels.

Costs: Grafana's own query timeout sits on top of Loki's, and the patterns call needs Grafana 11+
to be proxied. Without it the snapshot falls back to clustering sampled lines (below).

One rule of the Grafana integration carries over: the connection and the Grafana instance it
queries through must be in the same organization, checked on create (the organization comes from
the instance) and again by the worker at collection (`lokiConfigBelongsTo`), fail closed.

## Schema (migration 1838)

- `loki_configs` — label, `grafana_instance_id` (FK, cascade), `datasource_uid`, `datasource_name`,
  `level_label` (default `detected_level`), `max_concurrent_queries`. Unique per instance + uid.
- `loki_stream_mappings` — Splunk's mapping table with `matchers jsonb` (`[{label, op, value}]`,
  op one of `= != =~ !~`) in place of index / sourcetype / host, and `selector`, the canonical
  `buildStreamSelector(matchers)` text, which carries the unique slot and is what the UI shows.
- `loki_queries` — Splunk's query table with `logql` in place of `spl`; default dashboard label
  `Loki logs`, artificial dashboard uid `loki-<slug>`.
- `loki_run_patterns`, `loki_run_samples` — per-run snapshots (below), varchar `test_run_id` with no
  FK (the test-run delete removes them), `system_under_test_id` FK cascade (the SUT delete does).

All five are owned resources with the four standard RLS policies; every FK has a child-side index.
All five are in the SUT export: the config by reference (and its Grafana instance through the
`grafana_instances` union), mappings and queries by SUT, snapshots by test run.

## Panels: `$entities` plus a pipeline

A panel's `logql` is `$entities` (or `$entities[tag]`) followed only by pipeline stages. Perfana
writes the rest:

```
count / bytes:   sum by (<split>) (count_over_time(<selector> <pipeline> [<bucket>s]))
sum/avg/max/min: <fn>_over_time(<selector> <pipeline> | unwrap <f> | __error__="" [<bucket>s]) by (<split>)
pNN:             quantile_over_time(0.NN, <selector> <pipeline> | unwrap <f> | __error__="" [<bucket>s]) by (<split>)
```

`validateLogqlPipeline` (shared, also run in the browser) is the boundary, quote-aware over `"…"`
and raw `` `…` `` strings: outside a string the pipeline may not contain `{ } [ ]` (another
selector, its own range), `#`, any `$` but `$testRunId`, `unwrap`/`offset`/`by`/`without`/binary
modifiers, or an aggregation function, and its parentheses must balance so it cannot close the
function wrapped around it. `buildMetricExpr` re-validates what it builds. Label values in a
selector are always escaped string literals. A mapping whose matchers all accept the empty string
is refused, as Loki refuses it.

### Several mappings: one query each

LogQL cannot OR two stream selectors, and its `or` / `+` vector operators drop or require matching
label sets. So each mapping the panel's `$entities` selects is queried separately and the same
series name is combined client-side: summed for `count`/`bytes`/`sum`, max/min for those, and kept
apart with a ` [<matchers>]` suffix for `avg` and percentiles, which cannot be combined. Two
mappings that select overlapping streams therefore double-count; map disjoint streams.

### The grid

Loki's sample at `t` covers `(t - range, t]`. Evaluation timestamps are epoch-aligned multiples of
the bucket and each sample is stored at `t - bucket`, the bucket start, so ticks re-querying
overlapping windows upsert onto the same `ds_metrics` keys. Bucket size: the perf-test tick size
from `planned_duration`, the same function as Splunk's. `count` and `bytes` are zero-filled across
the window (a bucket with no errors is 0, not missing). A request never asks for more than 10,000
points per series (Loki's ceiling is 11,000); longer windows are split.

Series cap: the top `max_series` by total; for additive aggregations the rest are summed into
`OTHER`, so totals stay right. A series whose lines lack the split label is named `(none)`.

## Collection

Every Splunk path has a Loki arm: live ticks (`IncrementalCollectionScheduler`, source type
`loki`, `LOKI_INGEST_LOOKBACK_MS` = 2 min while live), gap fill, force refetch and the
missing-data re-evaluate, and an analyze stage `loki-collection` that is never skipped by gap
filling (ingest lag, and it takes the snapshot). One predicate, `COLLECTABLE_LOKI_CONFIGS_SQL`:
an enabled panel and a mapping in scope; a source that can never return data is never registered
(root CLAUDE.md #21). A panel whose query fails keeps the tick; only a connection-level failure
fails it. A force refetch with panel errors is never marked complete. Load refusals (429, 503,
"too many outstanding requests") are retried.

## What the card shows

`GET /loki/runs/:testRunId/summary` returns, without asking Loki:

1. **Error rate vs baseline.** From the level panel (split by the connection's level label,
   aggregation `count`): error lines / all lines, where `error` is any of error, err, fatal,
   critical, crit, panic, emerg, alert, severe. The baseline is the same ratio over the run's
   control group's pooled `ds_control_group_statistics` (the group the latest ADAPT conclusion
   names). A ratio, so it compares across runs with different bucket sizes, which raw counts per
   bucket do not. The card calls it worse at 1.5x the baseline ratio and ignores differences under
   0.1 percentage point.
2. **Top log patterns**, from the snapshot, each marked `isNew` when its normalised key is in no
   baseline run's snapshot (the control group's runs, else the workload's five previous completed
   runs); `null` when no baseline run has a snapshot, so "new" is never claimed without evidence.
   Each links to Explore with Loki's pattern filter (`|> "<pattern>"`, Loki 3.1+).
3. **Latest error and warning lines**, from the snapshot.
4. **Panels** with series totals (mean × buckets for additive aggregations), share of the panel,
   peak per bucket, an Explore link and the Open in Graphs / Compare / Trends menu.

### The snapshot (`loki-insights.ts`)

Taken by `loki-collection` at analyze and by a Loki force refetch. Per collectable connection and
mapping, over the run window:

- the newest 50 error lines (`| <level_label>=~"(?i)(error|…)"`, falling back to a
  ``|~ `(?i)\b(error|exception|fatal|panic)\b` `` line filter when the label matches nothing) and 20
  warning lines;
- patterns from the patterns API, merged across mappings by key; kept: the 30 busiest plus the
  20 busiest error/warn ones not already in;
- when the patterns API is unavailable (404/400, older Grafana or no pattern ingester): up to 2,000
  sampled error/warn lines clustered by shape (`lineShape` masks timestamps, uuids, IPs, hex, long
  quoted strings and numbers), counts over the sample, `source = 'sampled'`, which the card says.

It replaces the run's rows only when it found something: re-analysing a run whose window Loki has
dropped keeps the earlier snapshot. Lines are cut to 2,000 characters, labels to 30, and NUL /
unpaired surrogates are removed (jsonb refuses them). Best-effort: errors are logged, never thrown.

## Profile SLO

`loki-panels` is `splunk-panels` with the nouns changed: no profile dashboard, `dashboard_uid` a
regex over `loki-` uids (default `^loki-`), keyed on the panel title, fanned out per workload by
grafana-sync through `loki_queries`, provisioned SLOs stored with `benchmarks.source = 'loki'`.

## Not done

- No dashboard-JSON import: Grafana dashboards with Loki panels already import through the Grafana
  integration (v0.2.97.105 made those collect).
- No direct-Loki mode. A second connection type could reuse the collector and card unchanged.
- The pattern ingester keeps hours, so a run analysed long after it ended (a worker outage) gets
  sampled patterns or none.
- Overlapping mappings double-count (see "Several mappings").
