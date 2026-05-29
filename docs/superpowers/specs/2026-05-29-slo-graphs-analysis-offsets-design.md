# SLO Graphs: Aggregated SLO Charts + Analysis Offset Regions

**Date:** 2026-05-29  
**Status:** Approved

---

## Overview

Two related improvements to SLO result visualisation:

1. **Aggregated SLO graphs** — expand an aggregated SLO row and see a rolling-stat timeseries chart (currently renders nothing).
2. **Analysis offset regions** — all SLO charts show both start and end excluded regions (currently only the start ramp-up period is shown, and only as a faint grey background).

---

## Feature A: Aggregated SLO graphs

### Problem

In `SLOList.tsx` the expanded content for `evaluate_type === 'aggregated'` renders `null`. All other SLO types show a `SLOMetricsChart`. Aggregated SLOs show only the metric value table with no visual context.

### Solution

Add a new API endpoint that returns the chosen aggregation stat bucketed over the test run duration. Render it with a new `AggregatedSloChart` component that reuses the existing Plotly infrastructure.

### New API endpoint

```
GET /api/test-runs/:id/aggregated-metric-timeseries
  ?metric=transaction_response_time|request_response_time|error_percentage
  &stat=avg|p50|p90|p95|p99|max
  &applyAnalysisWindow=true|false   (default: false)
```

**Response:**
```json
{
  "bucketSizeSeconds": 60,
  "buckets": [
    { "time": "2024-01-01T10:00:00Z", "value": 1823.4 },
    { "time": "2024-01-01T10:01:00Z", "value": 1791.2 }
  ]
}
```

**Backend behaviour:**
- `metric=transaction_response_time` or `request_response_time`: queries `transactions` or `requests_raw` respectively, computing the requested percentile/stat in 60-second time buckets using `date_trunc` or equivalent.
- `metric=error_percentage`: queries `requests_raw`, computing `COUNT(*) FILTER (WHERE success = false) / COUNT(*) * 100` per bucket.
- `applyAnalysisWindow=true`: clips the time range using `analysis_start_offset` and `analysis_end_offset` from the test run record (the backend reads these from the DB — the client does not pass the offset values).
- When `end_time` is absent (running test): uses current wall-clock time as the upper bound.
- Returns 400 if `metric` or `stat` is not in the allowed set.
- Note: `applyAnalysisWindow` is used only on this new endpoint. Existing endpoints retain their `excludeRampUp` parameter unchanged (no rename in this PR).

### New frontend component: `AggregatedSloChart.tsx`

Location: `apps/web/app/test-runs/[id]/components/service-level-objectives/AggregatedSloChart.tsx`

**Props:**
```ts
interface AggregatedSloChartProps {
  testRunId: string;
  checkResult: CheckResult;   // evaluate_type === 'aggregated'
  testRun?: TestRunInfo;
  isVisible?: boolean;
}
```

**Behaviour:**
- Reads `aggregate_metric` and `aggregate_stat` from `checkResult.requirement` (stored as `{ type: 'aggregated', aggregate_metric, aggregate_stat, operator, value }`).
- Fetches the new endpoint with `applyAnalysisWindow=true`.
- Builds traces using existing `buildLineTrace` + `buildRequirementTrace` from `slo-chart-utils.ts`.
- Calls `buildChartLayout` (updated — see Feature B) passing `analysis_start_offset` and `analysis_end_offset`.
- Renders via the same `<Plot>` wrapper as `SLOMetricsChart`.
- Uses existing `<ChartLoadingState />`, `<ChartErrorState />`, `<ChartEmptyState />` sub-components.

### `SLOList.tsx` change

The branch that currently renders `null`:
```tsx
} : result.evaluate_type !== 'aggregated' ? (
  <SLOMetricsChart ... />
) : null}
```

Becomes:
```tsx
} : result.evaluate_type !== 'aggregated' ? (
  <SLOMetricsChart ... />
) : (
  <AggregatedSloChart ... />
)}
```

---

## Feature B: Analysis offset regions in SLO charts

### Problem

`buildChartLayout()` in `slo-chart-utils.ts` renders one faint grey `rect` shape spanning `testRunStart → lastRampUpTimestamp` (derived from `ramp_up_seconds`). The end offset is never shown. The styling (faint info-blue tint) does not clearly communicate excluded vs included regions.

### Solution

Replace the single grey rect with:
- Two dark overlay rects (one for start exclusion, one for end exclusion) — rendered only when the corresponding offset is `> 0`.
- Two amber dashed vertical boundary lines — rendered whenever the corresponding offset field is **defined** on the test run (including when `=== 0`), marking the exact edges of the analysis window.

### Visual spec

| Element | Dark theme | Light theme |
|---------|-----------|-------------|
| Excluded region rect | `rgba(0,0,0,0.35)` | `rgba(0,0,0,0.12)` |
| Boundary line colour | `#f59e0b` (amber) | `#f59e0b` (amber) |
| Boundary line style | `dash: 'dash'`, `width: 1.5` | same |

Boundary line positions:
- Start boundary: `testRunStart + analysis_start_offset seconds`
- End boundary: `testRunEnd - analysis_end_offset seconds`

### `buildChartLayout` signature change

```ts
// Before
export function buildChartLayout(
  hasTimeSeriesData: boolean,
  testRunStart: Date,
  testRunEnd: Date,
  lastRampUpTimestamp: Date,   // ← removed
  yAxisLabel: string,
  colors: ChartThemeColors,
  fontFamily: string
): Record<string, unknown>

// After
export function buildChartLayout(
  hasTimeSeriesData: boolean,
  testRunStart: Date,
  testRunEnd: Date,
  analysisStartOffset: number | undefined,   // seconds
  analysisEndOffset: number | undefined,     // seconds
  yAxisLabel: string,
  colors: ChartThemeColors,
  fontFamily: string
): Record<string, unknown>
```

The function computes boundary timestamps internally:
- `startBoundary = testRunStart + (analysisStartOffset ?? 0) seconds`
- `endBoundary = testRunEnd - (analysisEndOffset ?? 0) seconds`

Shape/line rendering rules:
- Start dark rect: only when `analysisStartOffset !== undefined && analysisStartOffset > 0`
- Start amber line: only when `analysisStartOffset !== undefined`
- End dark rect: only when `analysisEndOffset !== undefined && analysisEndOffset > 0`
- End amber line: only when `analysisEndOffset !== undefined`

### `TestRunInfo` interface change

```ts
// Before
export interface TestRunInfo {
  start_time: string;
  end_time?: string;
  ramp_up_seconds?: number;
}

// After
export interface TestRunInfo {
  start_time: string;
  end_time?: string;
  ramp_up_seconds?: number;        // kept — used as fallback elsewhere
  analysis_start_offset?: number;  // seconds; preferred over ramp_up_seconds for chart overlays
  analysis_end_offset?: number;    // seconds
}
```

### Callers to update

`useSLOMetricsChart.ts` — currently computes `lastRampUpTimestamp` from `ramp_up_seconds` and passes it to `buildChartLayout`. After this change it passes `testRun.analysis_start_offset` and `testRun.analysis_end_offset` directly. The `lastRampUpTimestamp` local variable is removed.

`AggregatedSloChart` (new) — passes the same fields from its `testRun` prop.

---

## Scope boundaries

- The `GraphsChart` component (`apps/web/app/test-runs/[id]/components/graphs/`) has its own separate `buildChartLayout` utility in `graphs/utils/` — **not changed in this PR**.
- Existing API query params named `excludeRampUp` are **not renamed** in this PR.
- No database migrations required.
- No changes to the worker or shared entities.

---

## Files touched

### New
- `apps/web/app/test-runs/[id]/components/service-level-objectives/AggregatedSloChart.tsx`
- `apps/api/src/modules/test-runs/controllers/test-runs-aggregated-timeseries.controller.ts` — route handler for `GET /test-runs/:id/aggregated-metric-timeseries`
- Corresponding service method added to `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts`

### Modified
- `apps/web/app/test-runs/[id]/components/service-level-objectives/utils/slo-chart-utils.ts` — `buildChartLayout` signature + shapes/lines logic
- `apps/web/app/test-runs/[id]/components/service-level-objectives/hooks/useSLOMetricsChart.ts` — pass offset fields, remove `lastRampUpTimestamp`
- `apps/web/app/test-runs/[id]/components/service-level-objectives/types/slo-metrics-chart.types.ts` — extend `TestRunInfo`
- `apps/web/app/test-runs/[id]/components/service-level-objectives/components/SLOList.tsx` — render `AggregatedSloChart` for aggregated results
- `apps/api/src/modules/test-runs/test-runs.module.ts` — register new controller
