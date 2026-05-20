# Aggregated Test SLO — Design Spec

**Date:** 2026-05-20
**Status:** Approved

## Overview

Add a new SLO type — "Aggregated Test SLO" — that checks a single metric aggregated across all transactions or requests in a test run. Unlike metric SLOs (which tie to a Grafana/Dynatrace panel) or Apdex SLOs (which score response time satisfaction), aggregated SLOs operate directly on the raw JTL/request data already stored in Perfana.

---

## Supported Metrics

| Label | `aggregate_metric` value | Description |
|---|---|---|
| Aggregated transaction response times | `transaction_response_time` | Elapsed time across all transaction rows |
| Aggregated request response times | `request_response_time` | Elapsed time across all sampler/request rows |
| Aggregated error percentage | `error_percentage` | `count(error=true) / count(*) * 100` |

For response time metrics the user also picks a **statistic**: `avg`, `p50`, `p90`, `p95`, `p99`, `max`. The `error_percentage` metric has no stat selector.

---

## Data Model

### New `BenchmarkType` variant

```typescript
// packages/shared/src/entities/benchmark.entity.ts
export type BenchmarkType = 'metric' | 'apdex' | 'aggregated';

export type AggregateMetric =
  | 'transaction_response_time'
  | 'request_response_time'
  | 'error_percentage';

export type AggregateStat = 'avg' | 'p50' | 'p90' | 'p95' | 'p99' | 'max';
```

### New columns on `Benchmark` entity

```typescript
@Column({ type: 'varchar', length: 50, nullable: true })
aggregate_metric?: AggregateMetric;

@Column({ type: 'varchar', length: 20, nullable: true })
aggregate_stat?: AggregateStat;  // null for error_percentage
```

### Reused existing columns

| Column | Purpose for aggregated SLOs |
|---|---|
| `benchmark_type` | `'aggregated'` |
| `requirement_operator` | `<=`, `>=`, `<`, `>` — defaults to `<=` |
| `requirement_value` | The threshold number (ms for response times, % for error rate) |
| `exclude_ramp_up_time` | Reuses same ramp-up filtering logic as Apdex SLOs |
| `enabled` | Standard lifecycle toggle |
| `system_under_test_id`, `test_environment`, `workload` | Scope — same as all other benchmarks |

`dashboard_uid`, `panel_title`, `application_dashboard_id`, `metrics_source_id` are all left null for aggregated benchmarks.

### `auditableFields` additions

Add `aggregate_metric` and `aggregate_stat` to `Benchmark.auditableFields`.

### Migration

Generate a migration adding the two nullable columns to `benchmarks`:

```sql
ALTER TABLE benchmarks ADD COLUMN aggregate_metric VARCHAR(50);
ALTER TABLE benchmarks ADD COLUMN aggregate_stat   VARCHAR(20);
```

---

## Backend / API

### New endpoints (benchmarks module)

```
POST /benchmarks/aggregated
PUT  /benchmarks/aggregated/:id
```

Following the same pattern as `POST /benchmarks/apdex` / `PUT /benchmarks/apdex/:id`.

`GET /benchmarks?benchmarkType=aggregated&systemUnderTestId=...` — existing list endpoint already supports `benchmarkType` filtering, no changes needed.

### Evaluation (worker)

A new `AggregatedBenchmarkEvaluator` handles `benchmark_type = 'aggregated'` in the benchmark-checking pipeline:

```
1. Load all rows for the test run from `requests_raw` (same source as Apdex evaluator)
2. If exclude_ramp_up_time: apply same ramp-up filter as Apdex evaluator
3. Switch on aggregate_metric:
   - transaction_response_time → filter to transaction rows, compute aggregate_stat of elapsed
   - request_response_time    → filter to sampler/request rows, compute aggregate_stat of elapsed
   - error_percentage         → count(error=true) / count(*) * 100
4. For pXX stats: use percentile_cont(0.XX) WITHIN GROUP (ORDER BY elapsed) in SQL
5. Compare result against requirement_value using requirement_operator
6. Write pass/fail + actual value to check_results table (same schema as other checks)
```

Check results feed into the existing check results display automatically — no frontend changes needed for the results view.

---

## UI

### 1. Performance Analysis menu — new "Set SLO" item

Added to the existing Apdex actions menu (the gear button on the Performance Analysis card), between "Set Apdex SLO" and "Modify Thresholds":

```
⚙  Set Apdex Threshold
📊 Set Apdex SLO
🎯 Set SLO             ← new
📈 Modify Thresholds
```

Clicking always opens the dialog in **create mode** (no existence check — users can have multiple aggregated SLOs per workload with different metrics).

### 2. SUT Config → SLO Tab — dropdown button

The existing "Add SLO" button becomes a dropdown:

- **Primary action** (clicking the button label): "Add Metric SLO" — same behaviour as today
- **Dropdown** (`▾`): reveals two options:
  - "Add Metric SLO"
  - "Add Aggregated SLO" → opens dialog in create mode

All SLOs (metric, apdex, aggregated) are listed in a **single unified table** with a **Type** column (`metric` / `apdex` / `aggregated`). Clicking any aggregated row opens the dialog in edit mode (pre-filled).

### 3. The "Set Aggregated Test SLO" dialog

**Create mode** (triggered from Performance Analysis menu or "Add Aggregated SLO"):

- Info alert explaining what an aggregated SLO does
- **Metric** dropdown (3 options)
- **Statistic** dropdown (`avg` / `p50` / `p90` / `p95` / `p99` / `max`) — hidden when `error_percentage` selected
- **Operator** dropdown (defaults to `≤`, user can change)
- **Threshold** text field (unit label: `ms` for response times, `%` for error percentage)
- **Exclude ramp-up period** toggle (default: on)
- Scope info block (system / environment / workload)
- Actions: `Cancel` · `Create SLO`

**Edit mode** (triggered by clicking an existing aggregated SLO row in SUT config):

- Same fields, pre-filled from existing benchmark
- **Metric** field is read-only (cannot change metric after creation)
- Actions: `Disable SLO` (left, destructive secondary) · `Cancel` · `Update SLO`

---

## Component Plan

| File | Action |
|---|---|
| `packages/shared/src/entities/benchmark.entity.ts` | Add `AggregateMetric`, `AggregateStat` types; add two columns; extend `auditableFields` |
| `packages/shared/src/database/migrations/XXXXXX-AddAggregatedBenchmarkColumns.ts` | Generated migration |
| `apps/api/src/modules/benchmarks/benchmarks.controller.ts` | Add `POST /aggregated` and `PUT /aggregated/:id` routes |
| `apps/api/src/modules/benchmarks/benchmarks.service.ts` | Add create/update logic for aggregated type |
| `apps/worker/src/pipelines/ChecksPipeline.ts` | Add `aggregated` branch calling new evaluator |
| `apps/worker/src/pipelines/AggregatedBenchmarkEvaluator.ts` | New evaluator (new file) |
| `apps/web/app/test-runs/[id]/components/performance-analysis/AggregatedSloDialog.tsx` | New dialog component (new file) |
| `apps/web/app/test-runs/[id]/components/performance-analysis/components/PerformanceAnalysisMenus.tsx` | Add "Set SLO" menu item + `onOpenAggregatedSloDialog` prop |
| `apps/web/app/test-runs/[id]/components/performance-analysis/components/PerformanceAnalysisDialogs.tsx` | Mount `AggregatedSloDialog` |
| `apps/web/app/systems/[id]/config/components/SLOSection.tsx` | Dropdown button trigger |
| `apps/web/app/systems/[id]/config/components/SLOTable.tsx` | Add Type column; row click → open edit dialog |
| `apps/web/app/systems/[id]/config/components/AddSLODialog.tsx` | Rename to split-button or extract trigger |

---

## Out of Scope

- Editing the metric after an aggregated SLO is created (disable + create new instead)
- Per-transaction aggregated SLOs (aggregation is always across the full test run)
- Custom ramp-up duration (reuses existing auto-detected ramp-up logic)
