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

ADAPT runs as **Stage 9** of the analysis pipeline (see [[Worker Overview]]):

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
