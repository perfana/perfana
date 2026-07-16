# Report Section: Top 10 Lists

**Date:** 2026-07-16
**Status:** Approved design, ready for implementation plan

## Goal

Add a new report section, `top_10_lists`, that reproduces the Performance
Analysis "Top 10 lists" in generated reports: dimension cards ranking the
worst/highest transactions, requests, or URLs. Uses the standard section
scaffolding (comment box + Preview), report style guide, and follows the
existing `transaction_response_times` section end-to-end.

## Scope model (decided)

**One scope per section.** A single `top_10_lists` section renders exactly one
scope. A user who wants transactions + requests + URLs adds three sections.
This mirrors every existing section (single purpose, own comment, reorderable)
and keeps the renderer and config UI minimal.

## The four dimension lists (decided)

All four are selectable, all on by default — same as Performance Analysis:

1. **Slowest Average Response Times** — sort by `avgResponseTime` desc, `ms`
2. **Highest Throughput** — sort by `throughput` (callCount / testDuration) desc, `/s`
3. **Highest Performance Impact** — sort by `impact` (avgResponseTime × callCount) desc
4. **Highest Error Rate** — sort by `errorRate` (failed/total) desc, `%`, shows error count

Each list shows the top 10 rows for the chosen scope.

## Config (`section.config`)

```ts
interface Top10ListsConfig {
  scope?: 'transactions' | 'requests' | 'urls';   // default 'transactions'
  lists?: Array<'slowest' | 'throughput' | 'impact' | 'error_rate'>; // default all four
  scenarios?: string[];        // [] or omitted = all scenarios
  excludeRampUp?: boolean;     // default true (matches perf analysis / other sections)
  includeUrl?: boolean;        // requests scope only; default false
  comment?: string;            // standard stakeholder comment
}
```

- `lists` empty/omitted → render all four (never render zero).
- `includeUrl` is ignored unless `scope === 'requests'`.

## Data source (server-side, no N+1)

The Performance Analysis UI fetches samplers with an N+1 loop
(`/transactions/:name/samples` per transaction). The renderer must NOT do that.
It queries the aggregate stat tables directly, matching how
`ReportDataFetcherService` already queries `transactions`:

- **transactions** → `test_run_transaction_stats`
  (columns: `transaction_name`, `scenario_name`, `total_count`, `failed_count`,
  `avg_response_time`, `ramp_up_excluded`).
- **requests** → `test_run_sampler_stats` grouped by `sampler_name`
  (also has `url_pattern`, `transaction_name`, `scenario_name`, `total_count`,
  `failed_count`, `avg_response_time`, `ramp_up_excluded`).
- **urls** → `test_run_sampler_stats` grouped by `url_pattern`.

Derived per row (same formulas as `prepareTop10Data` /
`prepareTop10TransactionData`):
- `errorRate = total_count > 0 ? failed_count / total_count * 100 : 0`
- `throughput = testDuration > 0 ? total_count / testDuration : 0`
- `impact = avg_response_time * total_count`

`excludeRampUp` maps to the `ramp_up_excluded` flag / duration used by the
existing fetchers. Scenario filtering: `WHERE scenario_name = ANY($scenarios)`
when non-empty, else no scenario filter. All queries go through the existing
org-filter / `withRequestEm` pattern used elsewhere in
`ReportDataFetcherService` (see `getScenarioDataFromDatabase`).

Two new methods on `ReportDataFetcherService`:
- `getTop10TransactionRows(testRun, scenarios, excludeRampUp, userId, roles)`
- `getTop10SamplerRows(testRun, scenarios, excludeRampUp, groupBy: 'sampler' | 'url', userId, roles)`

Both return a common `Top10Row { label, secondaryLabel?, scenarioName,
avgResponseTime, callCount, errorCount, errorRate, throughput, impact }`.
For requests scope, `secondaryLabel = url_pattern` (rendered when
`includeUrl`). Mock fallback (no testRun) mirrors the other renderers'
`getMock*` methods.

## Rendering (report style guide)

New `top-10-lists-renderer.ts` using `report-style` helpers
(`sectionHeader`, `commentBlock`, `TH_TEXT`, `TH_NUM`, `THEAD_ROW`,
`formatInt`, `formatNum`, `formatPercent`, `emptyState`, `REPORT_COLORS`).

Layout: section header + comment block, then one table per selected list
(dimension title as a `groupHeader`), each with up to 10 rows:

| Column | transactions | requests | urls |
|---|---|---|---|
| Name | transaction | request (sampler); URL on a second muted line if `includeUrl` | url_pattern |
| Scenario | ✓ | ✓ | ✓ |
| Value | dimension's value (RT/throughput/impact/error%) | " | " |
| Count / Errors | call count; error count shown for the Error Rate list | " | " |

`includeUrl` on the requests scope renders the URL exactly like the Compare
card's Added-Series URL rows: request name as the primary label, `url_pattern`
as a smaller secondary line beneath it (reuse the same muted-secondary styling,
not a separate column).

Empty scope → `emptyState('No <scope> data available for this test run.')`.

## Touch points (each mirrors `transaction_response_times`)

1. **Section type registration**
   - `packages/shared/src/entities/report-template.entity.ts` — add `'top_10_lists'` to `ReportSectionType`.
   - `packages/shared/src/types/reports.types.ts` — add to `REPORT_SECTION_TYPES` and `SECTION_TYPE_LABELS` ("Top 10 Lists"). It is commentable (not header/text_block), so `CommentableSectionType` picks it up automatically.
   - `apps/api/src/modules/reports/dto/create-report.dto.ts` — add `'top_10_lists'` to the DTO's `REPORT_SECTION_TYPES`.
2. **Renderer** — `apps/api/src/modules/reports/renderers/top-10-lists-renderer.ts` (+ `.spec.ts`). `@Injectable`, ctor `(utils: ReportUtilsService, dataFetcher: ReportDataFetcherService)`.
3. **Data fetcher** — add the two methods above to `report-data-fetcher.service.ts`.
4. **Dispatch + DI** — `report-html-compiler.service.ts` (import, inject, `case 'top_10_lists'`) and `reports.module.ts` provider list.
5. **Config form** — `SectionConfigs.tsx`: export `Top10ListsConfig` + `Top10ListsConfigForm`, wrapped in `SectionConfigShell` (`previewType="top_10_lists"`, comment box, Preview). Controls: scope `Select`; lists multi-select (`Select multiple` or checkbox group); scenarios multi-select using the existing `/test-runs/:id/transactions` scenario-fetch pattern; `includeUrl` `Switch` shown only when `scope === 'requests'` (label style like the perf-analysis "Show URL" switch).
6. **Palette + dispatch** — `GenerateReportDialog.tsx`: add `top_10_lists` to `SECTION_CONFIG` (icon/label/description/color) and a `case 'top_10_lists'` in `renderConfigForm`.
7. **Collapsed summary** — `section-summary.ts`: `case 'top_10_lists'` → e.g. `"Requests · 4 lists"` (scope label + count), falling back to comment.

## Testing

- Renderer `.spec.ts`: all-lists default, subset of lists, each scope, `includeUrl` on/off (requests), scenario filter, empty/mock data. Assert HTML contains dimension titles, escaped labels, correct row counts (≤10).
- Data fetcher: query shape for each scope with/without scenario filter (follow existing fetcher spec patterns).
- `SectionConfigs.spec.tsx` / `section-summary.spec.ts`: config form renders, `includeUrl` gated on requests scope, summary string.

## Non-goals (YAGNI)

- No drill-down / action menus (report is static HTML).
- No per-list row-count config (fixed top 10).
- No multi-scope-in-one-section.
- No new API endpoint — reuses the existing preview/generate flow and stat tables.
