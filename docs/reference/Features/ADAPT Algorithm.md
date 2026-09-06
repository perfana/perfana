---
aliases:
  - ADAPT
  - Regression Detection
tags:
  - feature
  - data-science
---

# ADAPT Algorithm

ADAPT (Automated Detection And Performance Testing) is Perfana's core regression detection algorithm. It statistically compares test run metrics against control groups to identify performance regressions and improvements.

## How It Works

### 1. Control Group Formation

The system groups similar historical test runs into **control groups** based on:
- Same `system_under_test_id`
- Same `test_environment`
- Same `workload`

This creates a statistical baseline of "normal" performance behavior.

### 2. Statistical Comparison

For each metric in the current test run, ADAPT compares against the control group statistics:

- **Mean comparison** — Is the current value significantly different?
- **Standard deviation** — How much variance is normal?
- **Percentile analysis** — p50, p95, p99 compared to historical distributions

### 3. Result Classification

Each metric gets classified:

| Result | Meaning |
|---|---|
| **No Change** | Within normal variance |
| **Improvement** | Statistically better than baseline |
| **Regression** | Statistically worse than baseline |
| **Inconclusive** | Not enough data for confidence |

### 4. Overall Conclusion

The test run gets an aggregate ADAPT conclusion based on all metric results.

## Pipeline Execution

ADAPT runs as **Stage 10** of the analysis pipeline (see [[Worker Overview]]):

```
Previous stages collect metrics and compute statistics
  │
  ▼
AdaptPipeline
  ├── Load control group statistics
  ├── Compare each metric against baseline
  ├── Classify changes (regression/improvement/no-change)
  ├── Store in ds_adapt_results (upsert)
  ├── Delete results whose metric no longer has statistics
  └── Generate conclusions
```

> [!info] Resource Usage
> ADAPT is the most CPU-intensive pipeline stage. Allocated 2 workers with 768MB each.

## Database Tables

| Table | Purpose |
|---|---|
| `ds_adapt_results` | Per-metric analysis results |
| `ds_adapt_conclusions` | Overall test run conclusion |
| `ds_adapt_tracked_results` | Historical tracking |
| `ds_control_groups` | Baseline test run groupings |
| `ds_control_group_statistics` | Aggregate baseline statistics |

### Unique Constraint

`ds_adapt_results` has a unique constraint on:
```sql
(test_run_id, control_group_id, application_dashboard_id, panel_id, metric_name)
```

This ensures one result row per unique combination of these five identifiers.

## Results are upserted, so stale ones have to be deleted

`ResultsProcessor.processAdaptResults` is an `INSERT … ON CONFLICT DO UPDATE` whose row source is
`ds_metric_statistics` for the run. It adds and updates, and before v0.2.94.7 nothing removed a row
it had stopped producing.

That matters because the statistics table is not append-only either. Narrowing a run's analysis time
range makes `StatisticsPipeline` delete and rewrite `ds_metric_statistics` from the new
ramp-up/ramp-down offsets, so the newly excluded metrics disappear from it. Their old results rows
stayed behind, still carrying the verdict from the **previous** window. The overall conclusion
(`buildConclusionSQL`) counts every row it finds for the run with no freshness check, so a single
leftover `regression` held the run at REGRESSION indefinitely — on a metric with no samples inside
the window at all. The API read path (`TestRunsAnomalyService.getAnomalyDetectionResults`) served
them as well.

`is_stale` is not the mechanism for this. It is set only by the `mark_results_stale_on_config_change`
trigger, and neither the conclusion SQL nor the read path consults it.

Since v0.2.94.7, `ResultsProcessor.deleteOrphanedResults()` runs from `AdaptPipeline` immediately
after the upsert, as its own `delete-orphaned-results` substage. It deletes the results for the run
whose `(application_dashboard_id, panel_id, metric_name)` has no `ds_metric_statistics` row, scoped
to the same metric filter the upsert ran under — so re-analysing one dashboard, panel or metric
cannot disturb any other.

> [!warning] The `EXISTS` guard is load-bearing
> The delete refuses to act on a run that has **no** `ds_metric_statistics` rows at all. "Every
> metric is orphaned" is never a real state: it means the statistics computation produced nothing,
> and deleting on that reading throws away comparison history that cannot be rebuilt once
> `ds_metrics` has aged out. `StatisticsPipeline` reaches exactly that state while reporting
> success — it warns `Metrics exist … but no statistics were written` when org-scoping drops every
> dashboard. Until v0.2.95.0 its own metrics probe was evaluated across the whole batch while its
> `DELETE` was too, so one live run could authorise wiping the statistics of an aged-out run beside
> it; the probe is now per run and the delete covers only the runs that passed it.
> `AdaptValidator.checkEmptyControlGroups` cannot screen those out either: it selects `FROM
> ds_metric_statistics` and groups by `test_run_id`, so a run with no rows forms no group and is
> never reported as empty.

This covers **one** class of stale result. The unique constraint above includes `control_group_id`,
and the delete deliberately ignores it — it matches on the metric's identity, not on which baseline
produced the verdict. A metric that keeps its statistics but loses its control-group row therefore
keeps its stale verdict. That is the baseline case described next, and it is unchanged.

## The analysis window has to match across the control group

ADAPT compares a run against a baseline of earlier runs, and `ds_control_group_statistics` pools
those runs' `ds_metric_statistics` — each computed under whatever ramp-up/ramp-down offsets its own
run happens to carry. Narrowing one run's analysis window in isolation therefore compares a trimmed
run against untrimmed history, and nothing reports the mismatch.

Since v0.2.95.0 the analysis time range can be applied across a whole workload in one action:
`PUT /api/test-runs/:id/analysis-time-range` accepts `applyToAll`, which writes the same offsets to
every run of the target's system / environment / workload and re-evaluates them.
`GET /api/test-runs/:id/analysis-time-range/scope` answers the same question read-only, so the
dialog can state the blast radius before anything is written.

Three kinds of run are deliberately left out, and each is reported rather than skipped silently:

| Reason | Why |
|---|---|
| `running` | `MetricsPipeline` bakes `ds_metrics.ramp_up` at ingestion, so moving the offsets mid-run leaves the run carrying rows flagged under two different settings |
| `too-short` | the two offsets together leave no analysis window in that run — see the note on offsets fitting the run in [[Worker Overview]] and CLAUDE.md |
| `not-writable` | `test_runs.team_id` is a per-row nullable column, not derived from the system under test, so a workload can span teams; the caller proved write permission on the target's organization and team only |

A bulk apply is capped at 100 runs and **refuses** past that rather than truncating: applying the
window to the first 100 runs of a workload would leave the remainder as an untrimmed baseline,
which is the comparison this feature exists to prevent. The preview reports `exceedsCap` in advance.

Two mechanics worth knowing when a bulk apply looks like it did nothing. The offsets alone change
nothing visible — they take effect only once `StatisticsPipeline` rebakes `ds_metrics.ramp_up` and
rewrites `ds_metric_statistics`, which is what the re-evaluate's `recalculateStatistics` flag runs.
And every *completed* run that was written also needs its `transaction-stats-rollup` re-enqueued,
because the rollup recomputes its ramp-up-excluded rows from the offsets and its readiness check
answers `ready` forever once the table is populated — a run that is missed serves previous-window
numbers in Performance Analysis indefinitely.

## When ADAPT cannot build a baseline

ADAPT needs `ds_control_group_statistics` — the pooled figures for the control group. When that table is empty for a group, the run is excluded and the exclusion message names the reason. Three of them look alike and are not:

| What the message says | What actually happened | What fixes it |
|---|---|---|
| The control runs contained insufficient metrics — too short or aborted | The baseline really has no per-run statistics | Run a longer baseline test |
| The runs come from different metrics sources | The baseline has statistics, but under a different `metrics_source_id` — usually different scenario/workload naming between ingestion paths | Align system-under-test / environment / workload naming |
| The runs do have metric statistics, but aggregating them failed | The pooling query failed, most often a statement timeout | Use the **Recalculate baseline statistics** button beside the message, then re-evaluate |

The third case is the one that used to be reported as the first, which sent people off to run another full-duration test that could not help.

### The `pct_agg` fast path

`ControlGroupStatisticsPipeline` pools the per-run t-digest stored in `ds_metric_statistics.pct_agg` with `rollup(pct_agg)`. Rows written before that column existed — or restored from a backup or a SUT transfer — have `pct_agg = NULL`, and the pipeline falls back to scanning `ds_metrics` raw. On a baseline holding millions of data points that scan runs out of time, so `ds_control_group_statistics` is never written and ADAPT sees no baseline.

Since v0.2.93.3 the aggregation has its own time budget, `AGGREGATION_STATEMENT_TIMEOUT_MS` (default 540s), rather than sharing `ANALYTICS_STATEMENT_TIMEOUT_MS` (default 120s) with the rest of the analytics workload. That cap exists to stop a runaway read from crowding everything else out and has to stay lowerable; the aggregation is the job's own work and a 20-million-row run needs longer. The budget is raised for the whole transaction, not just the final insert, because the step before it — refreshing each measurement's ramp-up marker — was the one most likely to exceed the old limit. 540s rather than 600s is deliberate: at 600s the database connection's own client-side timeout fires first and the connection is dropped, which loses the clean rollback and the error message that says what happened.

Since v0.2.90.0 the pipeline repairs this itself: before aggregating, it reruns `StatisticsPipeline` on any control run missing `pct_agg`, which rebuilds the sketches from `ds_metrics` already in the database. It is best-effort — if the rebuild fails, the legacy scan still runs and says so in the log.

### Recalculate baseline statistics (manual)

The same repair is available on demand, for a baseline the automatic pass could not fix:

- **UI** — a **Recalculate baseline statistics** button rendered next to the ADAPT message on the run detail page. It appears only when the conclusion's `details.cause` is `baseline-aggregation-failed`, because that is the only cause it can repair, and it posts for each run in `details.controlRuns` — so it targets the **baseline** runs and the user never has to work out that the remedy belongs elsewhere.
- **API** — `POST /api/data/recalculate-statistics/:testRunId`, which enqueues `statistics-calculation` on the `perfana-analyze` queue.

It recomputes from measurements already stored and fetches nothing from Grafana or Dynatrace, so it works on old runs whose dashboards no longer cover the time window.

## Configuration

ADAPT behavior can be configured per test run via the API:
- `POST /api/test-runs/:id/adapt-config` — Update ADAPT configuration
- `GET /api/test-runs/adapt-results` — Retrieve analysis results

## Change Point Detection

In addition to per-test-run analysis, Perfana tracks **change points** — moments when performance characteristics shift permanently:

- Stored in `ds_change_points`
- Can be marked manually via `POST /api/test-runs/:id/mark-changepoint`
- Used to reset control groups after known infrastructure changes

## Related

- [[Worker Overview]] — Pipeline execution details
- [[Data Flow]] — ADAPT in the analysis pipeline
- [[Schema Overview]] — Database tables
