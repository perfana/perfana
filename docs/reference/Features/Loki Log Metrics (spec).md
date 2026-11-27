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
  Migration 1840 adds `level_parser` (`none` | `json` | `logfmt`, default `none`, CHECK-constrained).
  See "Where the level comes from" below.
- `loki_stream_mappings` — Splunk's mapping table with `matchers jsonb` (`[{label, op, value}]`,
  op one of `= != =~ !~`) in place of index / sourcetype / host, and `selector`, the canonical
  `buildStreamSelector(matchers)` text, which carries the unique slot and is what the UI shows.
- `loki_queries` — Splunk's query table with `logql` in place of `spl`; default dashboard label
  `Loki logs`, artificial dashboard uid `perfana-loki-<slug>` (not `loki-`: the Loki mixin's real
  Grafana dashboards, `loki-reads` and so on, use that, and several places tell a placeholder by its prefix).
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

## Where the level comes from

The connection's level label is read in four places: the starter panels **Log lines by level**
and **Error lines by service**, the card's error rate (`isLevelPanel`: split by exactly that label,
aggregation `count`), the worker's per-application totals (`serviceLevelExpr`), and its error and
warning sample-line filters. `level_parser` is the stage that makes the label exist before any of
them groups or filters on it. `levelParserStage()` in `packages/shared/src/services/loki/client.ts`
turns it into ` | json`, ` | logfmt` or nothing, and every one of those four call sites applies it.
A new reader of the level label has to as well. The failure mode is silent: Loki groups the
missing label as one empty series, which the panel names `(none)`.

- **The connection test detects it.** `detectLokiLevelSource` runs one `sum by (<label>)` over
  the last hour per candidate: the configured parser and label first, then the label as-is or as
  `detected_level`, then `| json` and `| logfmt` with that label or `level`. It picks streams with
  `{<service label>=~".+"}`, or the first label Loki reports. The first candidate whose values
  include error, warn, info, debug or trace wins, and the dialog offers to apply it. Nothing is
  changed without the user.
- **The card refuses to report a 0% it cannot know.** When every series of the level panel is
  `(none)` (`levelLabelMissing`), the summary returns `levelLabelMissing: true` and no error rate.
  It does not fall back to the per-application snapshot either, because that grouped on the same
  label.
- **Existing panels keep their LogQL.** A starter panel is filled once, at creation, so changing
  the parser later needs the two level panels re-added. A run's stored series change only when
  it is re-analysed.

## What the card shows

`GET /loki/runs/:testRunId/summary[?baseline=]` returns, without asking Loki:

0. **`baseline`: what every "vs baseline" figure compared with** (`LokiService.resolveBaseline`).
   `?baseline=control-group` (`CONTROL_GROUP_BASELINE`) is the run's control group: its pooled
   `ds_control_group_statistics` for the error rate, its five newest other runs for patterns and
   applications (each reads a snapshot per run). `?baseline=<test run id>` is that one run, which
   must be in the same system, environment and workload (else 404, the same answer for a run that
   does not exist and one the caller cannot see); its error rate comes from its own level panel in
   `ds_metric_statistics`. Absent, the control group, else the workload's five previous completed
   runs (`previous-runs`, error rate pooled over their level panels), else `none`. The response
   carries `{ kind, testRunIds }`, and the card's **Baseline** picker (the Compare card's, shared as
   `BaselineTestRunSelect`) shows it and sends the pick.

1. **Error rate vs baseline.** From the level panel (split by the connection's level label,
   aggregation `count`): error lines / all lines, where `error` is any of error, err, fatal,
   critical, crit, panic, emerg, alert, severe. The baseline is the same ratio over the run's
   baseline (item 0): the control group's pooled `ds_control_group_statistics` (the group the
   latest ADAPT conclusion names), or a pinned or previous run's level panel. A ratio, so it compares across runs with different bucket sizes, which raw counts per
   bucket do not. The card calls it worse at 1.5x the baseline ratio and ignores differences under
   0.1 percentage point.
2. **Top log patterns**, from the snapshot, each marked `isNew` when its normalised key is in no
   baseline run's snapshot (item 0); `null` when no baseline run has a snapshot, so "new" is never claimed without evidence.
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

## Applications (v0.2.97.109, migration 1839)

The card's view per application, keyed on `loki_configs.service_label` (default `service_name`,
which Loki 3 derives for every stream). Independent of the panels: a snapshot, taken in the same
pass as the patterns.

- **Counts.** Per mapping, `sum by (<service_label>, <level_label>) (count_over_time(<selector>
  [<step>s]))` over the run window, summed per service and split into total / error / warn lines,
  written to `loki_run_services`. `by` reads stream labels, structured metadata and parsed labels
  alike. Lines without the label are stored as `(none)`; the card does not offer it as a scope.
- **Per-application patterns and lines** for the 20 services with most errors, then most lines
  (`LOKI_MAX_SERVICES`): lines through a label filter (`| service_name="x"`, any kind of label);
  patterns through a stream matcher, because the patterns API takes a selector only. A service
  label that is not a stream label gets no per-application patterns, and the card says so. Without
  the patterns API, the overall sampled lines are clustered per service instead. Rows carry
  `service`; NULL rows are the all-streams snapshot, unchanged.
- **Baseline per application**: the same baseline runs as the patterns; the error ratio pooled over
  their `loki_run_services` rows (`SUM(errors) / SUM(total)`). NEW is judged per scope: an
  application's patterns against that application's baseline patterns, once any baseline run has
  per-application rows; an application in none of them is itself NEW. With no per-application
  baseline at all, NEW is null rather than claimed.
- **Overall error rate** falls back to the per-application counts when the workload has no level
  panel; its baseline then weights each application's baseline ratio by its lines in this run.
- **The card**: an Applications table, worst first, with the error rate drawn against a baseline
  tick; selecting one narrows the KPIs, patterns, lines (falling back to the all-streams lines that
  carry its label) and every panel split by the service label. A comment on an application's
  pattern switches the card to that application when it is opened.

Before migration 1839 the worker writes the all-streams snapshot only and the API returns no
`services`; `loki_configs.service_label` is read through `to_jsonb` so the collector does not fail on
a database that has 1838 and not 1839.

## Profile SLO

`loki-panels` is `splunk-panels` with the nouns changed: no profile dashboard, `dashboard_uid` a
regex over `perfana-loki-` uids (default `^perfana-loki-`), keyed on the panel title, fanned out per workload by
grafana-sync through `loki_queries`, provisioned SLOs stored with `benchmarks.source = 'loki'`.

## Not done

- No dashboard-JSON import: Grafana dashboards with Loki panels already import through the Grafana
  integration (v0.2.97.105 made those collect).
- No direct-Loki mode. A second connection type could reuse the collector and card unchanged.
- The pattern ingester keeps hours, so a run analysed long after it ended (a worker outage) gets
  sampled patterns or none.
- Overlapping mappings double-count (see "Several mappings").

## ADAPT classification out of the box

`seedLokiCompareConfigs` (worker, `loki-collector.ts`) writes one panel-level `ds_compare_config`
row for the **Error lines by service** starter panel, matched by its title, on every Loki
collection: `USE_errors`, `higherIsBetter: false`, `mean`, the default thresholds,
`config_data.source = 'loki-starter'`. It is `ON CONFLICT DO NOTHING`, so a row someone saved or a
template wrote wins, and it is stamped `worker-pipeline`, like the perf-test pipeline's rows, so a
golden-path template merges into it rather than reading it as a hand edit. Lines by level and log
volume stay unclassified on purpose: the first mixes error and info lines in one panel, and the
second moves with load. Best effort: a failure logs a warning and collection goes on.
