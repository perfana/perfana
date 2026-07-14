# Design: "All aggregated" as a per-panel metric dropdown option on the Graphs card

**Date:** 2026-07-14
**Status:** Approved (design), pending implementation plan
**Scope:** Frontend only (`apps/web`). No API or worker changes.

## Problem

The interactive Graphs card (test-run detail page) exposes the "All aggregated"
feature differently from the Trends and Compare cards:

- **Trends / Compare:** "All aggregated" is an entry in the **metric dropdown**,
  offered per aggregatable performance-test panel. Selecting it produces one
  run-wide aggregate series/row for that panel's metric type. Backed by the
  shared helper `apps/web/lib/aggregated-perf-series.ts`, which maps each perf
  panel id to a `(metric, stat)` pair (so p90/p95/p99 panels aggregate at the
  right statistic).
- **Graphs:** "All aggregated" is a standalone **toggle Switch** (shown only in
  the expanded view, only for the performance-metrics source). Toggling it on
  overlays **three fixed** run-wide series (transaction RT avg, request RT avg,
  error %) that are **not** editable and **not** savable in presets. It uses a
  private duplicate util `graphs/utils/aggregated-series.ts` that knows only
  those three avg-only specs — it ignores the panel's real statistic.

This is inconsistent UX and a duplicated, less-correct implementation.

## Goal

Make the Graphs card expose "All aggregated" the same way as Trends/Compare — as
a per-panel entry in the metric dropdown that adds a **normal, editable, savable**
series — and delete the Graphs card's private duplicate in favor of the shared
helper. This also gains correctness: aggregated series use the panel's actual
statistic (avg / p90 / p95 / p99) instead of always avg.

## Non-goals

- No backend changes. The `/test-runs/:testRunId/aggregated-metric-timeseries`
  endpoint already accepts `stat ∈ ALLOWED_STATS` (avg, p50, p90, p95, p99, max)
  and `metric ∈ ALLOWED_METRICS`; it returns `{ bucketSizeSeconds, buckets:[{time,value}] }`.
- No change to Trends/Compare behavior or to the shared helper.
- No preset schema/migration change — aggregated series round-trip through the
  existing `SeriesConfig` shape.

## Design

### Data model — unchanged

`SeriesConfig` (`graphs/types/graphs.types.ts`) already carries `panelId`,
`panelTitle`, `metricName`, `source`, `yAxisFormat`, `metricsSourceId`. An
aggregated series is a normal series where:

- `metricName = buildAggregatedMetricName(panelTitle)` → `"All aggregated — <panelTitle>"`
- `panelId` is the perf panel id (101–105, 201–205)
- `source = 'performance-metrics'`

That is sufficient to (a) render a unique legend, (b) detect the series as
aggregated on data fetch, and (c) re-derive the `(metric, stat)` spec via
`getAggregateSpec(panelId)`. Presets store `SeriesConfig`, so an aggregated
series round-trips with no schema change.

Detection convention: `series.metricName.startsWith(ALL_AGGREGATED_OPTION)`
(i.e. starts with `"All aggregated"`), mirroring `MetricsComparisonTable`'s
`c.metric_name.startsWith(...)` in the Compare card.

### Three touch points in `graphs/hooks/useGraphsData.ts`

1. **Offer the option — `fetchPanelMetrics` (~line 314).**
   After `setMetrics(metricNames)`, if
   `shouldOfferAllAggregated(selectedSource, panelId)` is true, prepend
   `ALL_AGGREGATED_OPTION` to the list so it appears first and only for
   aggregatable perf panels. `selectedSource` is available from hook state.

2. **Add the series — `handleAddSeries` (~line 428).**
   When mapping `selectedMetrics` into `SeriesConfig`s, if a selected metric
   `=== ALL_AGGREGATED_OPTION`, produce a config with:
   - `metricName = buildAggregatedMetricName(selectedPanel.title)`
   - `yAxisFormat` derived from the metric type of `getAggregateSpec(panelId)`:
     `error_percentage → 'percent'`, response-time metrics → `'ms'`.
   All other fields (dashboardId, panelId, panelTitle, source, metricsSourceId)
   are set exactly as for a normal series. Existing multi-select and dedup logic
   is unchanged — "All aggregated" can be added alongside individual transactions
   in a single Add. Dedup already keys on `metricName`, which is now unique per
   panel.

3. **Fetch the data — `fetchSeriesData` (~line 379).**
   If `series.metricName.startsWith(ALL_AGGREGATED_OPTION)` and
   `getAggregateSpec(series.panelId)` is non-null, route to
   `/test-runs/${testRunIdForQuery}/aggregated-metric-timeseries?metric=${spec.metric}&stat=${spec.stat}`
   and map the returned `buckets` to `MetricDataPoint[]`
   (`{ time, metric_name: series.metricName, value }`). Otherwise use the
   existing `/metrics/ds-metrics/...` path unchanged. On HTTP/transport error,
   return `[]` (same as the existing path).

### Deletions

- `graphs/hooks/useAggregatedGraphSeries.ts` and its test
  `graphs/hooks/__tests__/useAggregatedGraphSeries.test.ts`.
- `graphs/utils/aggregated-series.ts` and its test
  `graphs/utils/__tests__/aggregated-series.test.ts`.
- Remove the export of `useAggregatedGraphSeries` from `graphs/hooks/index.ts`.
- `GraphsExpandedContent.tsx`: remove the toggle `FormControlLabel/Switch`
  (lines ~150–161), the props `showAggregatedToggle`, `includeAggregated`,
  `onIncludeAggregatedChange`, `overlaySeries`, `overlayData`, and the overlay
  merge (lines ~102–108). The chart renders `addedSeries` + `seriesData`
  directly; aggregated series are now part of `addedSeries`.
- `GraphsCard.tsx`: remove the `useAggregatedGraphSeries` import and call
  (~line 19, 43) and the five overlay/toggle props passed to
  `GraphsExpandedContent` (~lines 294–298).

### Reuse

Import from `apps/web/lib/aggregated-perf-series.ts`:
`ALL_AGGREGATED_OPTION`, `shouldOfferAllAggregated`, `getAggregateSpec`,
`buildAggregatedMetricName`. (The `fetchAggregatedStatistics` helper is for the
single-value statistic endpoint used by Trends/Compare and is not used here —
Graphs needs the timeseries endpoint.)

## Data flow (after change)

```
select perf dashboard → select perf panel (id 202 "Request RT P90")
  → fetchPanelMetrics: metrics = ["All aggregated", <transaction names...>]
select "All aggregated" (+ optionally individual transactions) → Add Series
  → handleAddSeries: SeriesConfig{ panelId:202, metricName:"All aggregated — Request RT P90", yAxisFormat:"ms" }
  → fetchSeriesData: startsWith("All aggregated") → getAggregateSpec(202) = {request_response_time, p90}
      → GET /test-runs/:id/aggregated-metric-timeseries?metric=request_response_time&stat=p90
      → buckets → MetricDataPoint[]
  → series rendered in chart, listed in Added Series (editable unit, removable), savable as preset
load preset containing that series
  → fetchSeriesData routes it the same way via panelId → identical fetch
```

## Testing

- **New/updated unit tests** (Jest, colocated) in `graphs/`:
  - `fetchSeriesData` routing: an aggregated series (`metricName` starts with
    "All aggregated") calls the aggregated-timeseries endpoint with the spec's
    `metric` + `stat` and maps buckets; a normal series calls the ds-metrics path.
  - `fetchPanelMetrics` injection: `ALL_AGGREGATED_OPTION` is prepended for an
    aggregatable perf panel + performance-metrics source, and absent for a
    Grafana/Dynatrace panel or a non-aggregatable perf panel.
  - `handleAddSeries`: selecting `ALL_AGGREGATED_OPTION` yields a `SeriesConfig`
    with `metricName = "All aggregated — <panel>"` and the correct `yAxisFormat`.
- **Delete** `useAggregatedGraphSeries.test.ts` and `aggregated-series.test.ts`.
- Existing Graphs tests must still pass. Run: `cd apps/web && npx jest graphs`.

## Risks / edge cases

- **Legend uniqueness:** two aggregated panels added to one chart get distinct
  `metricName`s via `buildAggregatedMetricName(panelTitle)`, so legends and
  dedup don't collide.
- **Unit override:** the user can change an aggregated series' unit like any
  other; the derived default (`ms` / `percent`) is just the initial value.
- **Old presets:** none exist that reference the deleted overlay mechanism (the
  overlay was never saved to presets), so there is nothing to migrate.
- **`getAggregateSpec` returns null:** only possible if a non-aggregatable panel
  id somehow carries an "All aggregated" metricName; `fetchSeriesData` falls back
  to the normal path (returns `[]` after filtering), which is safe.
