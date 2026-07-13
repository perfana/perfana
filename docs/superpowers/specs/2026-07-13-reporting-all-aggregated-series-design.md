# "All aggregated" series in Reporting — Design

**Date:** 2026-07-13
**Status:** Approved, ready for implementation plan

## Problem

In test-run details → **Reporting**, when a report section covers **performance-test
metrics**, there is no way to include the *run-wide aggregate across all transactions*.
Renderers only show per-transaction breakdowns (or, for Graphs, auto-discovered
`ds_metrics` panels). The aggregate-across-all-transactions data already exists as an
API endpoint (`GET /test-runs/:id/aggregated-metric-timeseries`) but no report renderer
consumes it.

## Goal

Add an **"Include 'All aggregated' series"** toggle to each performance-test report
section. When enabled, the rendered section includes one extra series/row = the run-wide
aggregate across all transactions — the same math as
`TestRunsPerformanceQueryService.getAggregatedMetricTimeseries` (no
`GROUP BY transaction_name`).

**Chosen approach:** minimal toggle (no dashboard/panel/series picker). Applied to **all
three** performance-test sections. The full Compare-style Dashboard→Panel→Series picker
is explicitly **out of scope** — add later only if per-panel aggregate scoping is
requested.

## Scope — three sections

Each renderer produces a different output shape, so "aggregated" maps differently:

| Section | Renderer | Toggle adds… | Metrics / stats |
|---|---|---|---|
| **Graphs** | `graphs-renderer.ts` | One aggregated line chart per metric type | `transaction_response_time`, `request_response_time`, `error_percentage`; `avg` stat |
| **Transaction Response Times** | `transaction-response-times-renderer.ts` | One extra "All aggregated" line on the chart + one table row | `transaction_response_time`; existing `avg/p95/p99` columns |
| **Comparisons** (baseline-run mode, `source: 'performance-metrics'`) | `comparisons-renderer.ts` | One synthetic "All aggregated" row: current vs baseline | reuses the section's `metrics` (`avg/p95/p99`) columns |

Notes:
- The **Graphs** section today renders `ds_metrics` (Grafana-style) panels. The aggregated
  line is a *separate* data path (reads `transactions`/`requests_raw`), rendered as an
  additional chart using the existing SVG line drawing — it does not depend on any
  selected panel.
- **Comparisons** aggregated row appears only in `baseline_run` mode with
  `source === 'performance-metrics'`; it needs the aggregate for both the current run and
  `config.baselineTestRunId`.

## Data layer (API)

Add one method to `apps/api/src/modules/reports/services/report-data-fetcher.service.ts`:

```ts
getAggregatedSeries(
  testRunId: string,
  metric: 'transaction_response_time' | 'request_response_time' | 'error_percentage',
  stat: 'avg' | 'p50' | 'p90' | 'p95' | 'p99' | 'max',
  applyAnalysisWindow: boolean,
): Promise<{ time: Date; value: number }[]>
```

- Copy the SQL from `TestRunsPerformanceQueryService.getAggregatedMetricTimeseries`
  (`apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts:2479-2565`):
  bucket by minute over `transactions` (response-time metrics) or `requests_raw`
  (`request_response_time`, `error_percentage`), **no** `GROUP BY transaction_name`.
  `statExpr`: `avg` → `ROUND(AVG(response_time),2)`; percentiles → TimescaleDB
  `approx_percentile(... percentile_agg(response_time))`; `max` → `MAX(response_time)`;
  `error_percentage` → `COUNT(*) FILTER (WHERE NOT r.success)/NULLIF(COUNT(*),0)*100`.
- `ReportDataFetcherService` already injects `DataSource`, `AuthorizationService`, and the
  `TestRun` repo (constructor ~line 354-359) and already resolves analysis bounds and
  org-filter — reuse those. **No cross-module import** of the test-runs module.
- Rationale for copying ~40 lines of SQL rather than importing
  `TestRunsPerformanceQueryService`: that service carries heavy deps; the reports data
  fetcher is deliberately lean (repo + authz + DataSource). Copying keeps the module
  boundary clean. `// ponytail: SQL copied from getAggregatedMetricTimeseries — keep in
  sync if the aggregate definition changes.`

Adapt `{time,value}[]` into the shapes each renderer needs:
- Graphs → `MetricsTimeSeriesPanel` (`{panelTitle, dashboardLabel, metricName, unit,
  dataPoints:[{time,value}]}`, type at `report-data-fetcher.service.ts:302-309`) so
  `renderPanelChart` draws it unchanged.
- **Unit gap:** aggregated data has no unit. Supply `ms` for `*_response_time`,
  `%` for `error_percentage` (the Graphs Y-axis formatting reads `MetricsTimeSeriesPanel.unit`).

## Config layer

Add an optional flag to the three section config interfaces. `config` is stored as
`Record<string, unknown>` on `ReportSectionConfig`
(`packages/shared/src/entities/report-template.entity.ts`), so **no DB migration**.

- `apps/web/components/reports/report-generation/SectionConfigs.tsx`:
  - `GraphsConfig` (~line 651): add `includeAggregated?: boolean`.
  - `TransactionResponseTimesConfig` (~line 433): add `includeAggregated?: boolean`.
  - `ComparisonsConfig` (~line 888): add `includeAggregated?: boolean`.
- Mirror the documentary option interfaces in
  `packages/shared/src/types/reports.types.ts` (`GraphsSectionOptions` ~171,
  `ComparisonsSectionOptions` ~157, and the transaction-response-times options if present).

## UI layer

One `<Switch>` (MUI `FormControlLabel`) labelled **"Include 'All aggregated' series"** in
each of the three config forms (`GraphsConfigForm`, `TransactionResponseTimesConfigForm`,
`ComparisonsConfigForm`). For Comparisons, gate it to appear only in `baseline_run` mode
with `source === 'performance-metrics'` (mirror the existing conditional blocks).

## Renderer layer

In each renderer, when `config.includeAggregated` is truthy:
- **Graphs** (`graphs-renderer.ts`): after the existing panels, fetch the three metric
  aggregates and render each as an additional `renderPanelChart` SVG (titled e.g.
  "All aggregated — Transaction response time (avg)"). Skip a metric whose series is empty.
- **Transaction Response Times** (`transaction-response-times-renderer.ts`): fetch
  `transaction_response_time` aggregate, add it as one extra line on the existing SVG and
  one "All aggregated" row (avg/p95/p99) at the top of the table.
- **Comparisons** (`comparisons-renderer.ts`, baseline-run/performance-metrics branch):
  fetch the aggregate for current + baseline run, emit one synthetic
  `BaselineComparisonRow` labelled "All aggregated" with the same delta/threshold logic as
  the per-transaction rows.

The section preview endpoint (`POST /reports/preview-section`) runs the same renderers, so
preview works with no extra wiring.

## Testing

- **API:** unit test for `getAggregatedSeries` — asserts single-series shape (no
  per-transaction grouping) for at least `transaction_response_time/avg` and
  `error_percentage`. Follow existing report data-fetcher / renderer test patterns.
- **Renderers:** one test per section asserting the aggregated line/row **appears** when
  `includeAggregated: true` and is **absent** when false/undefined.
- Health gates: `npm run type-check` and `npm run lint` (API has
  `noUncheckedIndexedAccess` — index-heavy SQL result handling needs an explicit tsc pass).

## Out of scope

- Full Dashboard → Panel → Series picker in reporting (Compare-style).
- Per-panel or per-scenario aggregate scoping.
- Configurable aggregated stat in the Graphs section (fixed to `avg` for v1).
- Any DB migration (config is schemaless JSON).
