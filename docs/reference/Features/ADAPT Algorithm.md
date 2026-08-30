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
  ├── Generate conclusions
  └── Store in ds_adapt_results
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

## When ADAPT cannot build a baseline

ADAPT needs `ds_control_group_statistics` — the pooled figures for the control group. When that table is empty for a group, the run is excluded and the exclusion message names the reason. Three of them look alike and are not:

| What the message says | What actually happened | What fixes it |
|---|---|---|
| The control runs contained insufficient metrics — too short or aborted | The baseline really has no per-run statistics | Run a longer baseline test |
| The runs come from different metrics sources | The baseline has statistics, but under a different `metrics_source_id` — usually different scenario/workload naming between ingestion paths | Align system-under-test / environment / workload naming |
| The runs do have metric statistics, but aggregating them failed | The pooling query failed, most often a statement timeout | Use the **Recalculate baseline statistics** button beside the message, then re-evaluate |

The third case is the one that used to be reported as the first, which sent people off to run another full-duration test that could not help.

### The `pct_agg` fast path

`ControlGroupStatisticsPipeline` pools the per-run t-digest stored in `ds_metric_statistics.pct_agg` with `rollup(pct_agg)`. Rows written before that column existed — or restored from a backup or a SUT transfer — have `pct_agg = NULL`, and the pipeline falls back to scanning `ds_metrics` raw. On a baseline holding millions of data points that scan exceeds `ANALYTICS_STATEMENT_TIMEOUT_MS` (default 120s), so `ds_control_group_statistics` is never written and ADAPT sees no baseline.

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
