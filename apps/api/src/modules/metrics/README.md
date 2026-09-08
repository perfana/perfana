# Metrics Module

Read API over the collected measurement data: the raw time series in `ds_metrics`, the per-run
aggregates in `ds_metric_statistics`, and the control-group/changepoint tables that ADAPT writes.
Everything here is a read — collection is the worker's job
(`apps/worker/src/pipelines/MetricsPipeline.ts`, `DynatracePipeline.ts`,
`PerformanceTestMetricsPipeline.ts`).

## Key Files

| File | Purpose |
|---|---|
| `metrics.module.ts` | Module definition |
| `metrics.service.ts` | All query logic — panel lists, time series, statistics, comparisons, trends |
| `metrics.controller.ts` | REST endpoints under `/metrics` |

## Endpoints

| Route | Service method | Serves |
|---|---|---|
| `GET ds-metrics/available/:testRunId` | `getAvailableDashboards` | Panel dropdown in the trends, compare and graphs cards; MCP `get_available_metrics` |
| `GET ds-metrics/time-series/:testRunId` | `getMetricTimeSeries` | Chart data for a single metric |
| `GET ds-metrics/:testRunId/:panelId` | `findDSMetricsForPanel` | Panel chart data (LTTB-downsampled above a threshold) |
| `GET ds-metric-statistics` | `findDSMetricStatistics(Multiple)` | Per-metric aggregates for a run |
| `GET ds-metrics-comparison` | comparison query | Run-vs-run metric comparison |
| `GET control-group-trends/:testRunId` | `findControlGroupTrends` | Baseline trend series |
| `GET ds-metrics/panels-by-dashboard` | `getPanelsByApplicationDashboard` | Panel list for one application dashboard |
| `GET ds-metrics/distinct-names` | `getDistinctMetricNames` | Metric-name dropdown |

## Two things to know before writing a query here

### `ds_metric_statistics` is not a faster `ds_metrics`

It is tempting: pre-aggregated, one row per `(test_run_id, application_dashboard_id, panel_id,
metric_name)`, and the panel-dropdown query reads it in 59 ms against 2035 ms over `ds_metrics`. It
is the wrong source for anything that feeds a chart, and both failure modes are silent — the
endpoint returns a plausible, shorter list rather than an error.

- **Two writers on different schedules.** `StatisticsPipeline.aggregateMetricStatistics` writes the
  Grafana and Dynatrace panels atomically at analyze time.
  `PerformanceTestMetricsPipeline.computeAndSaveStatistics` writes 500-row autocommit batches on
  every incremental tick of a **live** run. So during a running test the table holds performance-test
  rows only, and a read that treats "non-empty" as "ready" omits every Grafana and Dynatrace
  dashboard for that run. The result is not empty, so a fall-back-when-empty guard never fires.
- **It is filtered.** Rows exist only for `ramp_up = false AND value IS NOT NULL AND
  application_dashboard_id IN (allowed_dashboards)` (`StatisticsPipeline.ts:439-442`). A metric that
  reports solely during ramp-up, or is all-NULL, or sits on an out-of-org-scope dashboard, has no row
  — while `getMetricTimeSeries` still plots its points, because `excludeRampUp` defaults to `false`.

`ds_metric_statistics` answers "what did analysis measure"; `ds_metrics` answers "what did the run
record". A picker wants the second.

### Aggregate distinct tuples, not raw points

`ds_metrics` is physically organised by `test_run_id` and `time`, so a `GROUP BY` on anything else
reads the whole run. `getAvailableDashboards` used to run `COUNT(DISTINCT metric_name)` plus
`ARRAY_AGG(DISTINCT metric_name)` grouped by four panel columns, which walked every data point:
2035 ms on a 12.8 M-row run to describe 381 panels. It now reduces to distinct
`(dashboard_label, panel_title, panel_id, unit, metric_name)` tuples in a subquery and aggregates
those — 927 ms, byte-identical output, index-only over `idx_ds_metrics_panel_lookup`, which carries
exactly those columns after `test_run_id`. `metric_count` stays a bigint so the response contract is
unchanged.

Do not generalise that into "DISTINCT on `ds_metrics` is slow". A *single-column* `SELECT DISTINCT`
with the leading index columns fixed gets a native TimescaleDB `Custom Scan (SkipScan)`: 3.9 ms,
`Heap Fetches: 0`, 81 names out of 75,026 points. EXPLAIN before optimising, and do not hand-roll a
recursive-CTE loose index scan — besides duplicating the engine, row comparison `(a,b,c) > (x,y,z)`
returns NULL at the deciding column and silently truncates the result, and `ds_metrics.unit` is NULL
on tens of thousands of rows.

## Authorization

`getAvailableDashboards`, `findDSMetricsForPanel` and the statistics queries take `(userId, roles)`
and go through the private `validateTestRunAccess`, returning `[]` / `null` on refusal rather than
throwing. `getDistinctMetricNames` currently does **not** — see the open P0 in `TODOS.md` under
"Metrics dropdowns". Neither `ds_metrics` nor `ds_metric_statistics` has an RLS policy, so the
service layer is the only control on these tables.

## Related

- Worker pipelines: `apps/worker/src/pipelines/{MetricsPipeline,StatisticsPipeline,PerformanceTestMetricsPipeline}.ts`
- CLAUDE.md: "ADAPT's baseline depends on the `pct_agg` sketch" (item 7) and
  "`ds_metric_statistics` is not a faster `ds_metrics`"
