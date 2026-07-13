# Compare card → baseline-report table UI

**Date:** 2026-07-13
**Area:** `apps/web` (frontend), small `apps/api` + `packages/shared` change for preset persistence

## Goal

Replace the current Compare-card comparison table (test-run detail → Compare card,
expanded view) with the visual model used by the test-run **comparison report HTML in
baseline mode**: metrics grouped by **dashboard → panel**, one dense row per metric,
threshold-banded delta chips + magnitude bars, and configurable warning/regression/absolute
thresholds and percentile columns. Each row expands to show the existing per-metric compare
graph. Config persists in saved presets.

## Non-goals

- No new metrics API endpoint. The Compare card's existing `/metrics/ds-metric-statistics`
  already returns `avg` + `q90/q95/q99` for every source, which map to AVG/P90/P95/P99.
- No sharing of the server-side HTML renderer (`apps/api/.../report-style.ts`,
  `comparison-bands.ts`) across the package boundary — those emit HTML strings. We port the
  ~40 lines of pure band logic into a frontend util instead.
- Collapsed mini-card, the dashboard/panel/metric picker, "All aggregated", and the
  `ComparisonPlot` graph component are untouched.

## Existing pieces (reused)

| Piece | File | Use |
|---|---|---|
| Data build | `apps/web/.../compare/hooks/useCompareData.ts` `fetchMetricsComparison` | Already produces `MetricComparison` per evaluate type. Filter to `avg/q90/q95/q99`; thread dashboard-label + panel-title onto rows for grouping. |
| Graph | `apps/web/.../compare/components/ComparisonPlot.tsx` | Unchanged. Rendered inline under an expanded row. |
| Graph fetch | `apps/web/.../compare/hooks/useCompareHandlers.ts` `fetchGraphData`/`toggleGraph` | Unchanged; re-key the graph map by `dashboardId+panelId+metricName` so rows are unique across panels. |
| Report band logic (reference) | `apps/api/.../renderers/comparison-bands.ts`, `report-style.ts` | Source of truth to port: `bandColor`, `gatedDiffPercent`, `worstRank`, delta chip + magnitude bar. |
| Presets | `useComparePresets.ts`, `apps/web/lib/compare-presets.ts`, `apps/api/src/modules/compare-presets/*`, `packages/shared/.../compare-filter-preset.entity.ts` | Extend to carry display config. |

## Design

### 1. Table (`MetricsComparisonTable.tsx`, rewritten)

- Group rows by **Dashboard** then **Panel** (group headers). One **row per metric** replaces
  today's per-metric table with 3 stacked rows.
- Columns: label column (`Metric`) + `AVG` (always) + `P90`/`P95`/`P99` per the toggles.
- Cell (ported from `report-style.ts` `renderCell`): current value · `vs baseline` · banded
  delta chip · centered horizontal magnitude bar (regression fills right). Diff gated through
  `gatedDiffPercent(minAbsolute)`.
- Row left border colored by **worst-of-row** band. Each panel group header shows
  **reg / warn / ok** count chips.
- A threshold legend (band colors + minAbsolute note) above the table, matching the report.

### 2. Config (`CompareDiffTable.tsx` toolbar → small popover)

Replaces today's lone "Show Percentiles" switch with:
- P90 / P95 / P99 column toggles — default **P95 + P99 on, P90 off**.
- Regression threshold % — default **50**.
- Warning threshold % — default **10**.
- Absolute threshold (`minAbsolute`, min abs change gate) — default **off / 0**.

Held as component state (`displayConfig`), threaded down to the table. Defaults live in one
`DEFAULT_DISPLAY_CONFIG` const in `compare-utils.ts`.

### 3. Graph per metric (expandable row)

Chevron on each row toggles an inline `ComparisonPlot` beneath it. Lazy-loaded via existing
`toggleGraph`; **one open at a time**. Graph map keyed by `dashboardId+panelId+metricName`.

### 4. Band logic port (`utils/compare-bands.ts`, new)

Pure functions ported from `comparison-bands.ts`:
```
type DiffThresholds = { good: number; warning: number; minAbsolute?: number };
bandColor(diffPercent, thresholds): 'good' | 'warn' | 'bad'   // ≤0 or ≤good → good; ≤warning → warn; else bad
gatedDiffPercent(diffPercent, current, baseline, minAbsolute): number  // 0 when abs change < minAbsolute
worstRank(rowDiffs, thresholds): band + counts                // for left border + group summary
```
Note field naming: report uses `{ good, warning }`; the config UI labels them
"Warning" (=good band ceiling) and "Regression" (=warning band ceiling). Keep the UI labels;
map to `{ good, warning }` at the boundary. Leave a `// ponytail:` comment on the port noting
the source file it mirrors.

One runnable check: `utils/__tests__/compare-bands.test.ts` — asserts band selection at the
good/warning boundaries, the ≤0 = good rule, and that `minAbsolute` gates small changes to 0.

### 5. Preset persistence

Add **one** nullable `jsonb` column `display_config` to the preset (not five scalars):

```jsonc
display_config: {
  warningThreshold: number,      // good band ceiling %
  regressionThreshold: number,   // warning band ceiling %
  minAbsolute: number,
  percentiles: { p90: boolean, p95: boolean, p99: boolean }
}
```

Touch points:
- `packages/shared/.../compare-filter-preset.entity.ts` — add `displayConfig?: Record<string,unknown>` (`@Column({ name:'display_config', type:'jsonb', nullable:true })`); add `'displayConfig'` to `auditableFields`.
- Migration in `packages/shared/src/database/migrations/` — `ADD COLUMN display_config jsonb`. Per project convention, also fold into the consolidated greenfield migration.
- `apps/api/.../dto/create-compare-preset.dto.ts` + `compare-preset-response.dto.ts` — add optional `display_config`.
- `apps/web/lib/compare-presets.ts` — add `display_config?` to `ComparePreset` / `CreateComparePresetRequest`.
- `useComparePresets.ts` — `savePreset` writes current `displayConfig`; `applyPreset` restores it (falling back to `DEFAULT_DISPLAY_CONFIG`). `SavePresetModal` / `PresetFormData` carry it through.
- Back-compat: existing presets have `display_config = null` → apply defaults. Existing
  `show_percentiles` boolean stays as-is (drives nothing new; percentile toggles are the source
  of truth), or seed the toggles from it on apply — decide in plan; default is ignore it.

## Files

**New:** `utils/compare-bands.ts`, `utils/__tests__/compare-bands.test.ts`
**Rewritten:** `components/MetricsComparisonTable.tsx`
**Edited (web):** `components/CompareDiffTable.tsx`, `utils/compare-utils.ts`, `hooks/useCompareData.ts`, `hooks/useCompareHandlers.ts`, `hooks/useComparePresets.ts`, `components/SavePresetModal.tsx`, `types/compare.types.ts`, `lib/compare-presets.ts`
**Edited (api/shared):** `compare-filter-preset.entity.ts`, `create-compare-preset.dto.ts`, `compare-preset-response.dto.ts`, `compare-presets.service.ts` (pass field through), new migration

## Risks / notes

- `apps/web` type-check gate excludes `app/test-runs/**` (see memory) — verify these files with
  a filtered full `tsc -p tsconfig.json`, not just the build tsconfig.
- Grafana/Dynatrace panels may lack real percentile data; missing metric → render an em-dash
  cell, no chip/bar (report does the same).
- `noUncheckedIndexedAccess` is on in `apps/api`; the DTO/service edits are index-light but keep it in mind.
