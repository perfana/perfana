# Compare card → baseline-report table UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Compare-card comparison table (test-run detail → Compare card, expanded) with the baseline comparison-report visual model: metrics grouped by dashboard → panel, one dense row per metric with threshold-banded delta chips + magnitude bars, configurable warning/regression/absolute thresholds and percentile columns, and an expandable per-metric compare graph. Config persists in saved presets.

**Architecture:** Pure frontend re-skin reusing the existing `/metrics/ds-metric-statistics` data path (already returns `avg` + `q90/q95/q99`) and the existing `ComparisonPlot` graph. The report's server-side band logic (`apps/api/.../comparison-bands.ts`) is ported as ~40 lines of pure functions to a new frontend util. One new `jsonb` column persists thresholds + percentile toggles on the preset.

**Tech Stack:** Next.js (App Router, client components), MUI, TypeScript, TypeORM/Postgres (preset entity), Jest (web + api tests).

## Global Constraints

- All frontend fetches use `authenticatedFetch` from `@/lib/api` (already the case in these hooks).
- `apps/web` type-check build gate **excludes** `app/test-runs/**` — verify touched web files with `cd apps/web && npx tsc -p tsconfig.json --noEmit` (full config), not the build tsconfig. (See project memory.)
- `apps/api` has `noUncheckedIndexedAccess` — index access must be guarded.
- Report threshold naming: the pure band logic uses `{ good, warning }` where `good` = lower band ceiling and `warning` = upper band ceiling. The UI labels these **"Warning threshold"** (= `good`) and **"Regression threshold"** (= `warning`). Map at the boundary via `toDiffThresholds()`. Never rename the band-logic fields.
- Band boundaries are inclusive and any diff ≤ 0 is "good" (faster/lower = better). Copy verbatim from `apps/api/.../comparison-bands.ts`.
- Defaults: warningThreshold = 10, regressionThreshold = 50, minAbsolute = 0 (off), percentiles = { p90:false, p95:true, p99:true }.
- Do NOT push to `main`; work stays on branch `feat/compare-card-baseline-report-ui`. Bump `VERSION` (patch) as the final step before the PR.

## File Structure

**New (web):**
- `apps/web/app/test-runs/[id]/components/compare/utils/compare-bands.ts` — ported pure band logic.
- `apps/web/app/test-runs/[id]/components/compare/utils/__tests__/compare-bands.test.ts` — band logic test.

**Modified (web):**
- `utils/compare-utils.ts` — `DisplayConfig` type, `DEFAULT_DISPLAY_CONFIG`, `toDiffThresholds`, `getMetricColumns`, `METRIC_COLUMN_LABELS`, `graphKeyOf`.
- `utils/__tests__/` — extend with column-selection test (in the compare-bands test file or a sibling).
- `types/compare.types.ts` — extend `MetricComparison` (grouping fields) and `CompareSeries` (`yAxesFormat`), add `DisplayConfig` re-export usage, update `MetricsComparisonTableProps`.
- `hooks/useCompareData.ts` — rewrite `fetchMetricsComparison` grouping/columns; add `displayConfig` state + setter.
- `hooks/useCompareHandlers.ts` — composite graph key in `fetchGraphData`/`toggleGraph`; store `yAxesFormat` in `handleAddSeries`.
- `hooks/useComparePresets.ts` — save/apply `displayConfig`.
- `components/MetricsComparisonTable.tsx` — full rewrite (grouped report-style table + expandable graph).
- `components/CompareDiffTable.tsx` — replace the "Show Percentiles" switch with a config popover; thread `displayConfig`.
- `components/CompareExpandedContent.tsx` — thread `displayConfig`/`setDisplayConfig` props (wiring).
- `SavePresetModal.tsx` — carry `display_config` in `PresetFormData` + `CurrentFilterState`.
- `apps/web/lib/compare-presets.ts` — add `display_config` to preset interfaces + `CompareSeriesConfig.yAxesFormat`.

**Modified (api / shared):**
- `packages/shared/src/entities/compare-filter-preset.entity.ts` — `displayConfig` column + auditableFields.
- `packages/shared/src/database/migrations/schema-sql.ts` — add column to consolidated `CREATE TABLE`.
- `packages/shared/src/database/migrations/<ts>-AddComparePresetDisplayConfig.ts` — new migration (ALTER TABLE for existing DBs).
- `apps/api/src/modules/compare-presets/dto/create-compare-preset.dto.ts` + `compare-preset-response.dto.ts` — optional `display_config`.
- `apps/api/src/modules/compare-presets/compare-presets.service.ts` — pass `display_config` ↔ `displayConfig` through create/response mapping.

---

### Task 1: Frontend band-logic util (`compare-bands.ts`)

Pure port of `apps/api/src/modules/reports/renderers/comparison-bands.ts` band logic + the `REPORT_COLORS.dot` palette. No React, no imports.

**Files:**
- Create: `apps/web/app/test-runs/[id]/components/compare/utils/compare-bands.ts`
- Test: `apps/web/app/test-runs/[id]/components/compare/utils/__tests__/compare-bands.test.ts`

**Interfaces:**
- Produces: `DiffThresholds { good: number; warning: number; minAbsolute?: number }`, `BAND_COLORS` (record), `Band = 'good'|'warn'|'bad'|'neutral'`, `gatedDiffPercent(current, baseline, diffPercent, minAbsolute?) => number|null`, `bandOf(diffPercent, thresholds) => Band`, `rankOf(band) => 0|1|2`, `worstBand(diffPercents, thresholds) => Band`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/test-runs/[id]/components/compare/utils/__tests__/compare-bands.test.ts
import { bandOf, rankOf, worstBand, gatedDiffPercent, DiffThresholds } from '../compare-bands';

const T: DiffThresholds = { good: 10, warning: 50 };

describe('compare-bands', () => {
  it('treats any diff <= 0 as good (faster/lower is better)', () => {
    expect(bandOf(-80, T)).toBe('good');
    expect(bandOf(0, T)).toBe('good');
  });
  it('uses inclusive band boundaries', () => {
    expect(bandOf(10, T)).toBe('good');   // <= good
    expect(bandOf(10.01, T)).toBe('warn');
    expect(bandOf(50, T)).toBe('warn');   // <= warning
    expect(bandOf(50.01, T)).toBe('bad');
  });
  it('returns neutral for null diff', () => {
    expect(bandOf(null, T)).toBe('neutral');
  });
  it('gates small absolute changes to 0', () => {
    // 1 -> 2 is +100% but only 1 absolute; minAbsolute 5 suppresses it
    expect(gatedDiffPercent(2, 1, 100, 5)).toBe(0);
    expect(gatedDiffPercent(20, 10, 100, 5)).toBe(100); // 10 absolute >= 5, keep
    expect(gatedDiffPercent(2, 1, 100, undefined)).toBe(100); // no gate
  });
  it('worstBand picks the most severe of a row', () => {
    expect(worstBand([2, 60, -5], T)).toBe('bad');
    expect(worstBand([2, 20], T)).toBe('warn');
    expect(worstBand([2, -30], T)).toBe('good');
    expect(rankOf('bad')).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx jest 'app/test-runs/\[id\]/components/compare/utils/__tests__/compare-bands.test.ts'`
Expected: FAIL — `Cannot find module '../compare-bands'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/app/test-runs/[id]/components/compare/utils/compare-bands.ts
// ponytail: pure port of apps/api/src/modules/reports/renderers/comparison-bands.ts
// (bandColor/gatedDiffPercent) + REPORT_COLORS.dot palette. Keep in sync if the
// report's band semantics change.

export interface DiffThresholds {
  good: number;
  warning: number;
  /** Min absolute change before a cell is flagged; |current-baseline| below this = "no difference". */
  minAbsolute?: number;
}

export type Band = 'good' | 'warn' | 'bad' | 'neutral';

export const BAND_COLORS: Record<Band, string> = {
  good: '#43a047',
  warn: '#f59e0b',
  bad: '#e04944',
  neutral: '#bdbdbd',
};

/** If |current-baseline| < minAbsolute, collapse the percentage to 0. */
export function gatedDiffPercent(
  current: number | null,
  baseline: number | null,
  diffPercent: number | null,
  minAbsolute?: number,
): number | null {
  if (minAbsolute != null && minAbsolute > 0 && current != null && baseline != null
      && Math.abs(current - baseline) < minAbsolute) {
    return 0;
  }
  return diffPercent;
}

/** Band for a percentage diff. Any diff <= 0 is "good" (lower/faster is better). Inclusive boundaries. */
export function bandOf(diffPercent: number | null | undefined, thresholds: DiffThresholds): Band {
  if (diffPercent == null) return 'neutral';
  if (diffPercent <= 0) return 'good';
  const abs = Math.abs(diffPercent);
  if (abs <= thresholds.good) return 'good';
  if (abs <= thresholds.warning) return 'warn';
  return 'bad';
}

export function rankOf(band: Band): 0 | 1 | 2 {
  return band === 'bad' ? 2 : band === 'warn' ? 1 : 0;
}

/** Worst band across a row's diffs (drives row accent + group summary counts). */
export function worstBand(diffPercents: (number | null | undefined)[], thresholds: DiffThresholds): Band {
  let worst: Band = 'good';
  for (const d of diffPercents) {
    const b = bandOf(d, thresholds);
    if (rankOf(b) > rankOf(worst)) worst = b;
  }
  return worst;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx jest 'app/test-runs/\[id\]/components/compare/utils/__tests__/compare-bands.test.ts'`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/test-runs/[id]/components/compare/utils/compare-bands.ts" "apps/web/app/test-runs/[id]/components/compare/utils/__tests__/compare-bands.test.ts"
git commit -m "feat(compare): port report band logic to frontend compare-bands util"
```

---

### Task 2: Display-config model + column helpers (`compare-utils.ts`)

**Files:**
- Modify: `apps/web/app/test-runs/[id]/components/compare/utils/compare-utils.ts`
- Test: add cases to `apps/web/app/test-runs/[id]/components/compare/utils/__tests__/compare-bands.test.ts` (or a sibling `compare-utils.test.ts`)

**Interfaces:**
- Consumes: `DiffThresholds` from `./compare-bands`.
- Produces: `DisplayConfig`, `DEFAULT_DISPLAY_CONFIG`, `toDiffThresholds(cfg) => DiffThresholds`, `getMetricColumns(cfg) => string[]`, `METRIC_COLUMN_LABELS`, `graphKeyOf(dashboardId, panelId, metricName) => string`.

- [ ] **Step 1: Write the failing test**

```ts
// append to compare-bands.test.ts
import { DEFAULT_DISPLAY_CONFIG, getMetricColumns, toDiffThresholds, graphKeyOf } from '../compare-utils';

describe('display-config helpers', () => {
  it('default columns are avg + p95 + p99 (p90 off)', () => {
    expect(getMetricColumns(DEFAULT_DISPLAY_CONFIG)).toEqual(['avg', 'q95', 'q99']);
  });
  it('enabling p90 inserts it before p95/p99', () => {
    const cfg = { ...DEFAULT_DISPLAY_CONFIG, percentiles: { p90: true, p95: true, p99: true } };
    expect(getMetricColumns(cfg)).toEqual(['avg', 'q90', 'q95', 'q99']);
  });
  it('maps UI thresholds onto band-logic fields', () => {
    const t = toDiffThresholds({ ...DEFAULT_DISPLAY_CONFIG, warningThreshold: 10, regressionThreshold: 50, minAbsolute: 0 });
    expect(t).toEqual({ good: 10, warning: 50, minAbsolute: undefined });
    expect(toDiffThresholds({ ...DEFAULT_DISPLAY_CONFIG, minAbsolute: 5 }).minAbsolute).toBe(5);
  });
  it('graphKeyOf is unique per dashboard+panel+metric', () => {
    expect(graphKeyOf('d1', 3, 'cpu')).toBe('d1::3::cpu');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx jest 'app/test-runs/\[id\]/components/compare/utils/__tests__/compare-bands.test.ts'`
Expected: FAIL — exports not found.

- [ ] **Step 3: Add the implementation to `compare-utils.ts`**

Add an import at the top (after the existing import line):

```ts
import { DiffThresholds } from './compare-bands';
```

Append at the end of the file:

```ts
/** Per-view display config for the baseline-style compare table. Persisted in presets. */
export interface DisplayConfig {
  /** Good→warn band ceiling %, shown as "Warning threshold" in the UI. */
  warningThreshold: number;
  /** Warn→bad band ceiling %, shown as "Regression threshold" in the UI. */
  regressionThreshold: number;
  /** Min absolute change gate; 0 = off. */
  minAbsolute: number;
  percentiles: { p90: boolean; p95: boolean; p99: boolean };
}

export const DEFAULT_DISPLAY_CONFIG: DisplayConfig = {
  warningThreshold: 10,
  regressionThreshold: 50,
  minAbsolute: 0,
  percentiles: { p90: false, p95: true, p99: true },
};

/** Map the UI's warning/regression labels onto the band-logic good/warning fields. */
export function toDiffThresholds(cfg: DisplayConfig): DiffThresholds {
  return {
    good: cfg.warningThreshold,
    warning: cfg.regressionThreshold,
    minAbsolute: cfg.minAbsolute > 0 ? cfg.minAbsolute : undefined,
  };
}

/** Ordered evaluate-type columns: avg always, then the enabled percentiles. */
export function getMetricColumns(cfg: DisplayConfig): string[] {
  const cols = ['avg'];
  if (cfg.percentiles.p90) cols.push('q90');
  if (cfg.percentiles.p95) cols.push('q95');
  if (cfg.percentiles.p99) cols.push('q99');
  return cols;
}

/** Report-style column headers. */
export const METRIC_COLUMN_LABELS: Record<string, string> = {
  avg: 'AVG',
  q90: 'P90',
  q95: 'P95',
  q99: 'P99',
};

/** Stable per-row key for graph state maps (rows are unique by dashboard+panel+metric). */
export const graphKeyOf = (dashboardId: string, panelId: number, metricName: string): string =>
  `${dashboardId}::${panelId}::${metricName}`;
```

> Note: leave the existing `getVisibleColumns`/`getGridTemplateColumns`/`COLUMN_LABELS`/`getDiffColor` exports in place for now — the rewritten table stops importing them, and a later cleanup pass (or knip) removes the dead ones. Do not delete them in this task (other files may still import `getDiffColor`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx jest 'app/test-runs/\[id\]/components/compare/utils/__tests__/compare-bands.test.ts'`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/test-runs/[id]/components/compare/utils/compare-utils.ts" "apps/web/app/test-runs/[id]/components/compare/utils/__tests__/compare-bands.test.ts"
git commit -m "feat(compare): add DisplayConfig model + column/threshold helpers"
```

---

### Task 3: Data plumbing — grouping fields, columns, composite graph key

Attach dashboard/panel/yAxesFormat onto each comparison so the table can group by dashboard → panel; reduce computed columns to `avg/q90/q95/q99`; key graph state by dashboard+panel+metric.

**Files:**
- Modify: `apps/web/app/test-runs/[id]/components/compare/types/compare.types.ts`
- Modify: `apps/web/app/test-runs/[id]/components/compare/hooks/useCompareData.ts:284-391` (`fetchMetricsComparison`) and the returned state (add `displayConfig`)
- Modify: `apps/web/app/test-runs/[id]/components/compare/hooks/useCompareHandlers.ts` (`handleAddSeries`, `fetchGraphData`, `toggleGraph`)

**Interfaces:**
- Consumes: `graphKeyOf`, `getMetricColumns`, `DEFAULT_DISPLAY_CONFIG`, `DisplayConfig` from `../utils/compare-utils`.
- Produces: `MetricComparison` with optional `dashboard_label`, `panel_title`, `dashboardId`, `panelId`, `yAxesFormat`; `CompareSeries.yAxesFormat`; `useCompareData` returns `displayConfig`/`setDisplayConfig`; `onToggleGraph(row: { dashboardId: string; panelId: number; metricName: string }) => void`.

- [ ] **Step 1: Extend types in `compare.types.ts`**

Replace the `MetricComparison` interface:

```ts
export interface MetricComparison {
  metric_name: string;
  evaluate_type: string;
  current_value: number | null;
  selected_value: number | null;
  percentage_difference: number | null;
  // Grouping + display context (attached in fetchMetricsComparison).
  dashboard_label?: string;
  panel_title?: string;
  dashboardId?: string;
  panelId?: number;
  yAxesFormat?: string;
}
```

Add `yAxesFormat` to `CompareSeries` (after `metricsSourceId`):

```ts
  metricsSourceId?: string;
  /** Panel value format (e.g. 'percentunit', 's', 'ms') for unit-correct display. */
  yAxesFormat?: string;
```

- [ ] **Step 2: Store `yAxesFormat` when adding series (`useCompareHandlers.ts` `handleAddSeries`)**

In the `newSeries` map object (around line 194), add `yAxesFormat`:

```ts
        return {
          id: `${selectedDashboard.id}-${selectedMetric.id}-${metricName}-${Date.now()}`,
          dashboardId,
          dashboardLabel: selectedDashboard.dashboard_label,
          panelId: selectedMetric.id,
          panelTitle: selectedMetric.title,
          metricName: isAggregated ? buildAggregatedMetricName(selectedMetric.title) : metricName,
          source: selectedSource,
          metricsSourceId: selectedMetric.metricsSourceId || selectedDashboard.metrics_source_id,
          yAxesFormat: selectedMetric.yAxesFormat,
          isAggregated,
        };
```

- [ ] **Step 3: Composite graph key (`useCompareHandlers.ts` `fetchGraphData`/`toggleGraph`)**

Add the import near the top:

```ts
import { graphKeyOf } from '../utils/compare-utils';
```

Replace `fetchGraphData` and `toggleGraph` (lines 247-293) with row-identity versions:

```ts
  // Fetch graph data for a specific row (dashboard+panel+metric).
  const fetchGraphData = useCallback(async (row: { dashboardId: string; panelId: number; metricName: string }) => {
    if (!selectedTestRun) return;
    const graphKey = graphKeyOf(row.dashboardId, row.panelId, row.metricName);
    setGraphLoading(prev => ({ ...prev, [graphKey]: true }));

    try {
      const params = new URLSearchParams({
        currentTestRunId: testRun?.test_run_id || testRunId,
        baselineTestRunId: selectedTestRun.test_run_id,
        applicationDashboardId: row.dashboardId,
        panelId: row.panelId.toString(),
        metricName: row.metricName,
      });

      const response = await authenticatedFetch(`/metrics/ds-metrics-comparison?${params.toString()}`);
      if (response.ok) {
        const data: GraphData = await response.json();
        setGraphData(prev => ({ ...prev, [graphKey]: data }));
      } else {
        showToast('Failed to load graph data');
      }
    } catch (error) {
      console.error('Error fetching graph data:', error);
      showToast('Error loading graph data');
    } finally {
      setGraphLoading(prev => ({ ...prev, [graphKey]: false }));
    }
  }, [selectedTestRun, testRun?.test_run_id, testRunId, showToast, setGraphLoading, setGraphData]);

  // Toggle graph visibility for a row.
  const toggleGraph = useCallback(async (row: { dashboardId: string; panelId: number; metricName: string }) => {
    const graphKey = graphKeyOf(row.dashboardId, row.panelId, row.metricName);
    const isCurrentlyShown = showGraphs[graphKey];
    if (!isCurrentlyShown) {
      await fetchGraphData(row);
    }
    setShowGraphs(prev => ({ ...prev, [graphKey]: !isCurrentlyShown }));
  }, [showGraphs, fetchGraphData, setShowGraphs]);
```

> `addedSeries` is no longer read by `fetchGraphData` (it received the row directly). Remove `addedSeries` from that callback's dep array (done above). Leave the `addedSeries` prop on the hook — other handlers use it.

- [ ] **Step 4: Rewrite `fetchMetricsComparison` (`useCompareData.ts`)**

Add the import near the top of the file (with the other util imports):

```ts
import { DEFAULT_DISPLAY_CONFIG, DisplayConfig } from '../utils/compare-utils';
```

Add state near the other filter state (e.g. next to `showPercentiles`):

```ts
  const [displayConfig, setDisplayConfig] = useState<DisplayConfig>(DEFAULT_DISPLAY_CONFIG);
```

Replace the body of `fetchMetricsComparison` (lines 284-391) with a per-group build that attaches grouping context and computes only `avg/q90/q95/q99`:

```ts
  const fetchMetricsComparison = useCallback(async () => {
    if (!selectedTestRun || !testRun || addedSeries.length === 0) return;

    try {
      setMetricsLoading(true);

      // Group non-aggregated series by dashboard+panel to batch API calls.
      const seriesGroups = new Map<string, {
        dashboardId: string; panelId: number; metricsSourceId?: string;
        dashboardLabel: string; panelTitle: string; yAxesFormat?: string; metricNames: string[];
      }>();
      for (const series of addedSeries.filter(s => !s.isAggregated)) {
        const key = `${series.dashboardId}-${series.panelId}`;
        if (!seriesGroups.has(key)) {
          seriesGroups.set(key, {
            dashboardId: series.dashboardId, panelId: series.panelId,
            metricsSourceId: series.metricsSourceId, dashboardLabel: series.dashboardLabel,
            panelTitle: series.panelTitle, yAxesFormat: series.yAxesFormat, metricNames: [],
          });
        }
        seriesGroups.get(key)!.metricNames.push(series.metricName);
      }

      const allCurrentMetrics: MetricStatistic[] = [];
      const allSelectedMetrics: MetricStatistic[] = [];
      const allComparisons: MetricComparison[] = [];
      const evaluateTypes = ['avg', 'q90', 'q95', 'q99'];

      for (const [, group] of seriesGroups) {
        const params = new URLSearchParams({
          applicationDashboardId: group.dashboardId,
          panelId: group.panelId.toString(),
          system: testRun.systems_under_test?.name || '',
          environment: testRun.test_environment || '',
          workload: testRun.workload || '',
        });
        if (group.metricsSourceId) params.set('metricsSourceId', group.metricsSourceId);

        const response = await authenticatedFetch(
          `/metrics/ds-metric-statistics?${params.toString()}`,
          { headers: { 'Content-Type': 'application/json' } },
        );
        if (!response.ok) continue;

        const allData: MetricStatistic[] = await response.json();
        const relevant = new Set(group.metricNames);
        const filtered = allData.filter(item => relevant.has(item.metric_name));
        const currentData = filtered.filter(item => item.test_run_id === testRun.test_run_id);
        const selectedData = filtered.filter(item => item.test_run_id === selectedTestRun.test_run_id);
        allCurrentMetrics.push(...currentData);
        allSelectedMetrics.push(...selectedData);

        for (const metricName of new Set(group.metricNames)) {
          const currentMetric = currentData.find(m => m.metric_name === metricName);
          const baselineMetric = selectedData.find(m => m.metric_name === metricName);
          for (const evaluateType of evaluateTypes) {
            const currentValue = currentMetric?.statistics[evaluateType as keyof typeof currentMetric.statistics] ?? null;
            const selectedValue = baselineMetric?.statistics[evaluateType as keyof typeof baselineMetric.statistics] ?? null;
            allComparisons.push({
              metric_name: metricName,
              evaluate_type: evaluateType,
              current_value: currentValue,
              selected_value: selectedValue,
              percentage_difference: calculatePercentageDifference(currentValue, selectedValue),
              dashboard_label: group.dashboardLabel,
              panel_title: group.panelTitle,
              dashboardId: group.dashboardId,
              panelId: group.panelId,
              yAxesFormat: group.yAxesFormat,
            });
          }
        }
      }

      // Aggregated series: one batch call each for [current, baseline], single stat row.
      const aggregatedSeries = addedSeries.filter(s => s.isAggregated);
      for (const series of aggregatedSeries) {
        const spec = getAggregateSpec(series.panelId);
        if (!spec) continue;
        const values = await fetchAggregatedStatistics(
          testRun.test_run_id,
          [testRun.test_run_id, selectedTestRun.test_run_id],
          spec,
        );
        const byId = new Map(values.map(v => [v.testRunId, v.value]));
        allComparisons.push({
          ...buildAggregatedComparison(
            series,
            byId.get(testRun.test_run_id) ?? null,
            byId.get(selectedTestRun.test_run_id) ?? null,
            spec.stat,
          ),
          dashboard_label: series.dashboardLabel,
          panel_title: series.panelTitle,
          dashboardId: series.dashboardId,
          panelId: series.panelId,
          yAxesFormat: series.yAxesFormat,
        });
      }

      setCurrentMetrics(allCurrentMetrics);
      setSelectedMetrics(allSelectedMetrics);
      setMetricComparisons(allComparisons);
    } catch (error) {
      console.error('Error fetching metrics comparison:', error);
      setCurrentMetrics([]);
      setSelectedMetrics([]);
      setMetricComparisons([]);
    } finally {
      setMetricsLoading(false);
    }
  }, [selectedTestRun, testRun, addedSeries]);
```

Add `displayConfig`, `setDisplayConfig` to the hook's returned object (alongside `showPercentiles`, `setShowPercentiles`):

```ts
    showPercentiles,
    displayConfig,
    ...
    setShowPercentiles,
    setDisplayConfig,
```

- [ ] **Step 5: Verify types compile**

Run: `cd apps/web && npx tsc -p tsconfig.json --noEmit 2>&1 | grep -E 'compare/(hooks|utils|types)' || echo "no compare errors"`
Expected: `no compare errors` (unrelated pre-existing errors elsewhere are fine; the table still references old props and is rewritten in Task 4 — if `MetricsComparisonTable.tsx` errors here, that is expected and resolved in Task 4).

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/test-runs/[id]/components/compare/types/compare.types.ts" "apps/web/app/test-runs/[id]/components/compare/hooks/useCompareData.ts" "apps/web/app/test-runs/[id]/components/compare/hooks/useCompareHandlers.ts"
git commit -m "feat(compare): group comparisons by dashboard/panel, composite graph key, displayConfig state"
```

---

### Task 4: Rewrite `MetricsComparisonTable.tsx` (grouped report-style table)

Full rewrite. Groups by dashboard → panel; one row per metric; report-style cells (current · vs baseline · banded delta chip · magnitude bar); worst-of-row left accent; per-panel reg/warn/ok summary chips; threshold legend; expandable inline `ComparisonPlot` (one open at a time, lazy).

**Files:**
- Rewrite: `apps/web/app/test-runs/[id]/components/compare/components/MetricsComparisonTable.tsx`

**Interfaces:**
- Consumes: `DisplayConfig`, `toDiffThresholds`, `getMetricColumns`, `METRIC_COLUMN_LABELS`, `graphKeyOf`, `formatCompareNumber`, `applyUnitConversion` from `../utils/compare-utils`; `bandOf`, `worstBand`, `rankOf`, `BAND_COLORS`, `Band`, `DiffThresholds` from `../utils/compare-bands`; `gatedDiffPercent` from `../utils/compare-bands`; `ComparisonPlot`.
- Produces: props interface below (replaces the one in `types/compare.types.ts` usage — update the call site in Task 5).

- [ ] **Step 1: Replace the whole file**

```tsx
'use client';

import React from 'react';
import { Box, Typography, Chip, Collapse, CircularProgress, IconButton } from '@mui/material';
import { ExpandMore, ExpandLess, BarChart } from '@mui/icons-material';
import {
  MetricComparison,
  RelatedTestRun,
  Panel,
  ApplicationDashboard,
  GraphData,
  CompareSeries,
} from '../types/compare.types';
import {
  DisplayConfig,
  toDiffThresholds,
  getMetricColumns,
  METRIC_COLUMN_LABELS,
  graphKeyOf,
  formatCompareNumber,
  applyUnitConversion,
} from '../utils/compare-utils';
import {
  bandOf,
  worstBand,
  gatedDiffPercent,
  BAND_COLORS,
  Band,
  DiffThresholds,
} from '../utils/compare-bands';
import ComparisonPlot from './ComparisonPlot';
import { TestRun } from '@/types/test-runs';
import { ALL_AGGREGATED_OPTION } from '@/lib/aggregated-perf-series';

interface MetricRow {
  metricName: string;
  dashboardId: string;
  panelId: number;
  yAxesFormat?: string;
  isAggregated: boolean;
  byColumn: Record<string, MetricComparison>;
}

interface MetricsComparisonTableProps {
  metricComparisons: MetricComparison[];
  selectedTestRun: RelatedTestRun;
  testRunId: string;
  displayConfig: DisplayConfig;
  seriesSearchText: string;
  selectedMetric: Panel | null;
  selectedDashboard: ApplicationDashboard | null;
  showGraphs: Record<string, boolean>;
  graphData: Record<string, GraphData>;
  graphLoading: Record<string, boolean>;
  onToggleGraph: (row: { dashboardId: string; panelId: number; metricName: string }) => void;
  testRun: TestRun | null;
  relatedTestRuns: RelatedTestRun[];
  showToast: (message: string) => void;
  addedSeries: CompareSeries[];
}

const fmt = (v: number | null | undefined, unit?: string): string =>
  v == null ? '—' : formatCompareNumber(v, unit);

function DeltaChip({ diff, thresholds }: { diff: number | null; thresholds: DiffThresholds }) {
  if (diff == null || diff === 0) {
    return (
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', px: 1, py: 0.25,
        borderRadius: '999px', bgcolor: 'rgba(0,0,0,0.06)', color: 'text.secondary',
        fontSize: '0.72rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>—</Box>
    );
  }
  const band = bandOf(diff, thresholds);
  const color = BAND_COLORS[band];
  const arrow = diff > 0 ? '▲' : '▼';
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25,
      borderRadius: '999px', bgcolor: `${color}22`, color, fontSize: '0.72rem', fontWeight: 700,
      fontVariantNumeric: 'tabular-nums' }}>
      {arrow} {diff > 0 ? '+' : ''}{diff.toFixed(1)}%
    </Box>
  );
}

function MagnitudeBar({ diff, band }: { diff: number | null; band: Band }) {
  let left = 50, width = 0;
  if (diff != null) {
    const mag = Math.min(Math.abs(diff), 100) / 2; // 100% fills half the track
    if (diff >= 0) { left = 50; width = mag; } else { width = mag; left = 50 - mag; }
  }
  return (
    <Box sx={{ position: 'relative', width: 110, height: 4, borderRadius: 2, bgcolor: '#edf0f3' }}>
      <Box sx={{ position: 'absolute', left: '50%', top: -2, width: '1px', height: 8, bgcolor: '#ccd0d6' }} />
      <Box sx={{ position: 'absolute', top: 0, height: '100%', borderRadius: 2,
        left: `${left}%`, width: `${width}%`, bgcolor: BAND_COLORS[band] }} />
    </Box>
  );
}

function Cell({ c, thresholds }: { c: MetricComparison | undefined; thresholds: DiffThresholds }) {
  if (!c) return <Box sx={{ px: 2, py: 1.5, textAlign: 'right', color: 'text.secondary' }}>—</Box>;
  const d = gatedDiffPercent(c.current_value, c.selected_value, c.percentage_difference, thresholds.minAbsolute);
  const band = bandOf(d, thresholds);
  return (
    <Box sx={{ px: 2, py: 1.5, display: 'flex', flexDirection: 'column', gap: 0.75, alignItems: 'flex-end' }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
        <Typography component="span" sx={{ fontSize: '0.9rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {fmt(c.current_value, c.yAxesFormat)}
        </Typography>
        <Typography component="span" sx={{ fontSize: '0.72rem', fontWeight: 600, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
          vs {fmt(c.selected_value, c.yAxesFormat)}
        </Typography>
      </Box>
      <DeltaChip diff={d} thresholds={thresholds} />
      <MagnitudeBar diff={d} band={band} />
    </Box>
  );
}

export default function MetricsComparisonTable({
  metricComparisons,
  selectedTestRun,
  displayConfig,
  seriesSearchText,
  selectedMetric,
  showGraphs,
  graphData,
  graphLoading,
  onToggleGraph,
  testRun,
  relatedTestRuns,
  showToast,
}: MetricsComparisonTableProps) {
  const thresholds = toDiffThresholds(displayConfig);
  const columns = getMetricColumns(displayConfig);
  const gridTemplateColumns = `minmax(180px, 2fr) ${columns.map(() => 'minmax(150px, 1fr)').join(' ')} 44px`;

  // Build rows, grouped dashboard -> panel -> metric.
  const search = seriesSearchText.trim().toLowerCase();
  const dashboards = new Map<string, Map<string, MetricRow[]>>();
  const rowsByMetric = new Map<string, MetricRow>();

  for (const c of metricComparisons) {
    if (search && !c.metric_name.toLowerCase().includes(search)) continue;
    const dashboardId = c.dashboardId ?? 'unknown';
    const panelId = c.panelId ?? 0;
    const rowKey = graphKeyOf(dashboardId, panelId, c.metric_name);
    let row = rowsByMetric.get(rowKey);
    if (!row) {
      row = {
        metricName: c.metric_name,
        dashboardId,
        panelId,
        yAxesFormat: c.yAxesFormat,
        isAggregated: c.metric_name.startsWith(`${ALL_AGGREGATED_OPTION} — `),
        byColumn: {},
      };
      rowsByMetric.set(rowKey, row);
      const dashLabel = c.dashboard_label ?? 'Metrics';
      const panelLabel = c.panel_title ?? '';
      if (!dashboards.has(dashLabel)) dashboards.set(dashLabel, new Map());
      const panels = dashboards.get(dashLabel)!;
      if (!panels.has(panelLabel)) panels.set(panelLabel, []);
      panels.get(panelLabel)!.push(row);
    }
    row.byColumn[c.evaluate_type] = c;
  }

  const rowDiffs = (row: MetricRow): (number | null)[] =>
    columns.map((col) => {
      const c = row.byColumn[col];
      return c ? gatedDiffPercent(c.current_value, c.selected_value, c.percentage_difference, thresholds.minAbsolute) : null;
    });

  const legendDot = (color: string, label: string) => (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      <Box component="span" sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: color }} /> {label}
    </Box>
  );

  return (
    <Box>
      {/* Legend */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2.5, mb: 3,
        color: 'text.secondary', fontSize: '0.78rem' }}>
        <span>Each cell: <strong>current</strong> · vs baseline · Δ%. Bar shows regression magnitude.</span>
        {legendDot(BAND_COLORS.good, `≤ ${displayConfig.warningThreshold}%`)}
        {legendDot(BAND_COLORS.warn, `${displayConfig.warningThreshold}–${displayConfig.regressionThreshold}%`)}
        {legendDot(BAND_COLORS.bad, `> ${displayConfig.regressionThreshold}%`)}
        {displayConfig.minAbsolute > 0 && <span>changes &lt; {displayConfig.minAbsolute} treated as none</span>}
        <Box component="span" sx={{ ml: 'auto', color: 'text.disabled' }}>
          baseline: {selectedTestRun.test_run_id}
        </Box>
      </Box>

      {Array.from(dashboards.entries()).map(([dashLabel, panels]) => (
        <Box key={dashLabel} sx={{ mb: 4 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5, pl: 1.5,
            borderLeft: '4px solid', borderColor: 'primary.main' }}>
            {dashLabel}
          </Typography>

          {Array.from(panels.entries()).map(([panelLabel, rows]) => {
            let reg = 0, warn = 0, ok = 0;
            rows.forEach((row) => {
              const b = worstBand(rowDiffs(row), thresholds);
              if (b === 'bad') reg++; else if (b === 'warn') warn++; else ok++;
            });
            return (
              <Box key={panelLabel} sx={{ mb: 2.5, border: '1px solid', borderColor: 'divider',
                borderRadius: 1, overflow: 'hidden' }}>
                {/* Panel header */}
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 1, px: 2, py: 1.25, bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{panelLabel || 'Metrics'}</Typography>
                  <Box sx={{ display: 'flex', gap: 0.75 }}>
                    {reg > 0 && <Chip size="small" label={`${reg} regressions`} sx={{ bgcolor: `${BAND_COLORS.bad}22`, color: BAND_COLORS.bad, fontWeight: 700 }} />}
                    {warn > 0 && <Chip size="small" label={`${warn} warnings`} sx={{ bgcolor: `${BAND_COLORS.warn}22`, color: BAND_COLORS.warn, fontWeight: 700 }} />}
                    {ok > 0 && <Chip size="small" label={`${ok} within range`} sx={{ bgcolor: `${BAND_COLORS.good}22`, color: BAND_COLORS.good, fontWeight: 700 }} />}
                  </Box>
                </Box>

                {/* Column header */}
                <Box sx={{ display: 'grid', gridTemplateColumns, alignItems: 'center',
                  borderBottom: '2px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
                  <Box sx={{ px: 2, py: 1 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary' }}>Metric</Typography>
                  </Box>
                  {columns.map((col) => (
                    <Box key={col} sx={{ px: 2, py: 1, textAlign: 'right' }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary' }}>
                        {METRIC_COLUMN_LABELS[col] ?? col.toUpperCase()}
                      </Typography>
                    </Box>
                  ))}
                  <Box />
                </Box>

                {/* Metric rows */}
                {rows.map((row) => {
                  const band = worstBand(rowDiffs(row), thresholds);
                  const gKey = graphKeyOf(row.dashboardId, row.panelId, row.metricName);
                  const open = !!showGraphs[gKey];
                  const loading = !!graphLoading[gKey];
                  return (
                    <Box key={gKey}>
                      <Box sx={{ display: 'grid', gridTemplateColumns, alignItems: 'stretch',
                        borderBottom: '1px solid', borderColor: 'divider',
                        borderLeft: '3px solid', borderLeftColor: BAND_COLORS[band] }}>
                        <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center' }}>
                          <Typography variant="body2" sx={{ fontWeight: 500, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                            {row.metricName}
                          </Typography>
                        </Box>
                        {columns.map((col) => (
                          <Cell key={col} c={row.byColumn[col]} thresholds={thresholds} />
                        ))}
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {!row.isAggregated && (
                            <IconButton size="small" onClick={() => onToggleGraph(row)} disabled={loading}
                              aria-label={open ? 'Hide graph' : 'Show graph'}>
                              {loading ? <CircularProgress size={16} /> : open ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                            </IconButton>
                          )}
                        </Box>
                      </Box>
                      <Collapse in={open} unmountOnExit>
                        <Box sx={{ p: 2, bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: 'divider' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, color: 'text.secondary' }}>
                            <BarChart fontSize="small" />
                            <Typography variant="caption">{row.metricName}</Typography>
                          </Box>
                          <ComparisonPlot
                            metricName={row.metricName}
                            graphData={graphData[gKey]}
                            graphLoading={loading}
                            selectedMetric={selectedMetric}
                            testRun={testRun}
                            relatedTestRuns={relatedTestRuns}
                            showToast={showToast}
                          />
                        </Box>
                      </Collapse>
                    </Box>
                  );
                })}
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
```

> `ComparisonPlot`'s props include `graphData?: GraphData | undefined` and `graphLoading` (per discovery). `applyUnitConversion` is imported for parity but the cell uses `formatCompareNumber` (which applies conversion internally); if lint flags `applyUnitConversion` as unused, drop it from the import.

- [ ] **Step 2: Verify types compile (file references new props; call site fixed in Task 5)**

Run: `cd apps/web && npx tsc -p tsconfig.json --noEmit 2>&1 | grep 'MetricsComparisonTable' || echo "no table errors"`
Expected: the only remaining error (if any) is at the **call site** in `CompareDiffTable.tsx` (old props) — resolved in Task 5. No errors inside `MetricsComparisonTable.tsx` itself.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/test-runs/[id]/components/compare/components/MetricsComparisonTable.tsx"
git commit -m "feat(compare): rewrite comparison table with baseline-report grouped UI"
```

---

### Task 5: Config popover + thread `displayConfig` through the tree

Replace the "Show Percentiles" switch in `CompareDiffTable` with a config popover (P90/P95/P99 toggles + warning/regression/absolute inputs), and thread `displayConfig`/`setDisplayConfig` from `useCompareData` down through `CompareExpandedContent` → `CompareDiffTable` → `MetricsComparisonTable`.

**Files:**
- Modify: `apps/web/app/test-runs/[id]/components/compare/components/CompareDiffTable.tsx`
- Modify: `apps/web/app/test-runs/[id]/components/compare/components/CompareExpandedContent.tsx`

**Interfaces:**
- Consumes: `DisplayConfig`, `DEFAULT_DISPLAY_CONFIG` from `../utils/compare-utils`; `displayConfig`/`setDisplayConfig` from `useCompareData`; new `onToggleGraph(row)` shape.

- [ ] **Step 1: Inspect the wiring layer**

Run: `sed -n '1,60p' "apps/web/app/test-runs/[id]/components/compare/components/CompareExpandedContent.tsx"; grep -n "showPercentiles\|onShowPercentilesChange\|onToggleGraph\|CompareDiffTable\|displayConfig" "apps/web/app/test-runs/[id]/components/compare/components/CompareExpandedContent.tsx"`
Expected: shows where `CompareDiffTable` is rendered and how `showPercentiles`/`toggleGraph` are passed. (Read the whole file before editing — its exact prop-passing must be preserved.)

- [ ] **Step 2: Rewrite `CompareDiffTable.tsx` toolbar + props**

Replace the props interface fields `showPercentiles` / `onShowPercentilesChange` with `displayConfig` / `onDisplayConfigChange`, remove `onGraphDataChange`/`onGraphLoadingChange`/`onShowGraphsChange` from what is forwarded to the table (the rewritten table no longer takes them), and change `onToggleGraph` to the row shape. Full replacement:

```tsx
'use client';

import React from 'react';
import {
  Box, Typography, TextField, IconButton, Button, CircularProgress,
  Popover, FormControlLabel, Checkbox, Stack, Divider,
} from '@mui/material';
import { Close, BookmarkBorder, Tune } from '@mui/icons-material';
import {
  MetricComparison, ApplicationDashboard, Panel, CompareSeries, GraphData, RelatedTestRun,
} from '../types';
import { DisplayConfig } from '../utils/compare-utils';
import { MetricsComparisonTable } from './index';
import { TestRun } from '@/types/test-runs';

interface CompareDiffTableProps {
  metricComparisons: MetricComparison[];
  addedSeries: CompareSeries[];
  metricsLoading: boolean;
  seriesSearchText: string;
  onSeriesSearchChange: (text: string) => void;
  displayConfig: DisplayConfig;
  onDisplayConfigChange: (cfg: DisplayConfig) => void;
  selectedDashboard: ApplicationDashboard | null;
  selectedMetric: Panel | null;
  onSavePresetClick: () => void;
  showGraphs: Record<string, boolean>;
  graphData: Record<string, GraphData>;
  graphLoading: Record<string, boolean>;
  onToggleGraph: (row: { dashboardId: string; panelId: number; metricName: string }) => void;
  testRun: TestRun | null;
  testRunId: string;
  selectedTestRun: RelatedTestRun;
  relatedTestRuns: RelatedTestRun[];
  showToast: (message: string) => void;
}

export function CompareDiffTable({
  metricComparisons, addedSeries, metricsLoading, seriesSearchText, onSeriesSearchChange,
  displayConfig, onDisplayConfigChange, selectedDashboard, selectedMetric, onSavePresetClick,
  showGraphs, graphData, graphLoading, onToggleGraph, testRun, testRunId, selectedTestRun,
  relatedTestRuns, showToast,
}: CompareDiffTableProps) {
  const [cfgAnchor, setCfgAnchor] = React.useState<HTMLElement | null>(null);
  const uniqueSeriesNames = Array.from(new Set(metricComparisons.map(m => m.metric_name)));
  const shouldShowSeriesSearch = uniqueSeriesNames.length > 1;

  const setPct = (key: 'p90' | 'p95' | 'p99', v: boolean) =>
    onDisplayConfigChange({ ...displayConfig, percentiles: { ...displayConfig.percentiles, [key]: v } });
  const setNum = (key: 'warningThreshold' | 'regressionThreshold' | 'minAbsolute', v: number) =>
    onDisplayConfigChange({ ...displayConfig, [key]: Number.isFinite(v) && v >= 0 ? v : 0 });

  if (metricsLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>Loading metrics comparison...</Typography>
      </Box>
    );
  }
  if (metricComparisons.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="text.secondary">No metrics data available for the selected combination</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: shouldShowSeriesSearch ? 'flex-end' : 'center', gap: 2, mb: 3 }}>
        {shouldShowSeriesSearch && (
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>Search Series</Typography>
            <TextField fullWidth size="small" placeholder="Search series by metric name..."
              value={seriesSearchText} onChange={(e) => onSeriesSearchChange(e.target.value)}
              InputProps={{ endAdornment: seriesSearchText && (
                <IconButton size="small" onClick={() => onSeriesSearchChange('')} sx={{ mr: -1 }}>
                  <Close fontSize="small" />
                </IconButton>) }} />
          </Box>
        )}
        <Button variant="outlined" size="small" startIcon={<Tune />} onClick={(e) => setCfgAnchor(e.currentTarget)}
          sx={{ height: 32, flexShrink: 0 }}>
          Columns & thresholds
        </Button>
        <Button variant="outlined" size="small" startIcon={<BookmarkBorder />} onClick={onSavePresetClick}
          disabled={!selectedDashboard || !selectedMetric} sx={{ height: 32, flexShrink: 0 }}>
          Save Preset
        </Button>
      </Box>

      <Popover open={!!cfgAnchor} anchorEl={cfgAnchor} onClose={() => setCfgAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <Box sx={{ p: 2, width: 260 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary' }}>Percentile columns</Typography>
          <Stack>
            <FormControlLabel control={<Checkbox size="small" checked={displayConfig.percentiles.p90} onChange={(e) => setPct('p90', e.target.checked)} />} label="P90" />
            <FormControlLabel control={<Checkbox size="small" checked={displayConfig.percentiles.p95} onChange={(e) => setPct('p95', e.target.checked)} />} label="P95" />
            <FormControlLabel control={<Checkbox size="small" checked={displayConfig.percentiles.p99} onChange={(e) => setPct('p99', e.target.checked)} />} label="P99" />
          </Stack>
          <Divider sx={{ my: 1.5 }} />
          <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary' }}>Thresholds</Typography>
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            <TextField size="small" type="number" label="Warning threshold (%)" value={displayConfig.warningThreshold}
              onChange={(e) => setNum('warningThreshold', Number(e.target.value))} />
            <TextField size="small" type="number" label="Regression threshold (%)" value={displayConfig.regressionThreshold}
              onChange={(e) => setNum('regressionThreshold', Number(e.target.value))} />
            <TextField size="small" type="number" label="Absolute threshold (min change)" value={displayConfig.minAbsolute}
              onChange={(e) => setNum('minAbsolute', Number(e.target.value))} helperText="0 = off" />
          </Stack>
        </Box>
      </Popover>

      <MetricsComparisonTable
        metricComparisons={metricComparisons}
        selectedTestRun={selectedTestRun}
        testRunId={testRunId}
        displayConfig={displayConfig}
        seriesSearchText={seriesSearchText}
        selectedMetric={selectedMetric}
        selectedDashboard={selectedDashboard}
        showGraphs={showGraphs}
        graphData={graphData}
        graphLoading={graphLoading}
        onToggleGraph={onToggleGraph}
        testRun={testRun}
        relatedTestRuns={relatedTestRuns}
        showToast={showToast}
        addedSeries={addedSeries}
      />
    </Box>
  );
}

export default CompareDiffTable;
```

- [ ] **Step 3: Update `CompareExpandedContent.tsx` wiring**

Based on Step 1's output, change the `CompareDiffTable` render to pass `displayConfig={displayConfig}` and `onDisplayConfigChange={setDisplayConfig}` instead of `showPercentiles`/`onShowPercentilesChange`, and ensure `onToggleGraph={toggleGraph}` (the toggleGraph now takes a row object — no signature change needed at this call site since it's passed by reference). Pull `displayConfig`/`setDisplayConfig` from the `useCompareData` hook return where the other data-hook values are destructured. Remove the now-unused `onShowGraphsChange`/`onGraphDataChange`/`onGraphLoadingChange` props from the `CompareDiffTable` invocation (the rewritten `CompareDiffTable` no longer declares them). If `showPercentiles`/`setShowPercentiles` become unused in this file, remove those references too.

> Do not change how `SavePresetModal` receives data here yet — that is Task 6.

- [ ] **Step 4: Verify web types + lint**

Run: `cd apps/web && npx tsc -p tsconfig.json --noEmit 2>&1 | grep -E 'compare/' || echo "no compare errors"`
Expected: `no compare errors`.
Run: `cd apps/web && npx eslint "app/test-runs/[id]/components/compare/**/*.{ts,tsx}"`
Expected: no errors (fix any unused-import warnings, e.g. drop `applyUnitConversion` if unused).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/test-runs/[id]/components/compare/components/CompareDiffTable.tsx" "apps/web/app/test-runs/[id]/components/compare/components/CompareExpandedContent.tsx"
git commit -m "feat(compare): config popover for thresholds + percentile columns, thread displayConfig"
```

---

### Task 6: Persist `displayConfig` in saved presets

One nullable `jsonb display_config` column carries `{ warningThreshold, regressionThreshold, minAbsolute, percentiles }`. Also persist `yAxesFormat` in `series_config` (jsonb — no column change).

**Files:**
- Modify: `packages/shared/src/entities/compare-filter-preset.entity.ts`
- Modify: `packages/shared/src/database/migrations/schema-sql.ts:1444-1467`
- Create: `packages/shared/src/database/migrations/1789000000000-AddComparePresetDisplayConfig.ts`
- Modify: `apps/api/src/modules/compare-presets/dto/create-compare-preset.dto.ts`
- Modify: `apps/api/src/modules/compare-presets/dto/compare-preset-response.dto.ts`
- Modify: `apps/api/src/modules/compare-presets/compare-presets.service.ts`
- Modify: `apps/web/lib/compare-presets.ts`
- Modify: `apps/web/app/test-runs/[id]/components/compare/SavePresetModal.tsx`
- Modify: `apps/web/app/test-runs/[id]/components/compare/hooks/useComparePresets.ts`

**Interfaces:**
- Produces: entity `displayConfig?: Record<string, unknown>`; DTO/lib field `display_config?: DisplayConfigDto`; `PresetFormData.display_config`; hook `applyPreset` restores `setDisplayConfig`, `savePreset` writes it.

- [ ] **Step 1: Entity column**

In `compare-filter-preset.entity.ts`, add to `auditableFields` (after `'seriesConfig'`): `'displayConfig',`. Add the column after `seriesConfig`:

```ts
  @Column({ name: 'display_config', type: 'jsonb', nullable: true })
  displayConfig?: Record<string, unknown>;
```

- [ ] **Step 2: Consolidated schema (`schema-sql.ts`)**

In the `CREATE TABLE public.compare_filter_presets` block, add after the `series_config jsonb,` line:

```sql
    display_config jsonb,
```

- [ ] **Step 3: Migration for existing DBs**

Create `packages/shared/src/database/migrations/1789000000000-AddComparePresetDisplayConfig.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddComparePresetDisplayConfig1789000000000 implements MigrationInterface {
  name = 'AddComparePresetDisplayConfig1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "compare_filter_presets" ADD COLUMN IF NOT EXISTS "display_config" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "compare_filter_presets" DROP COLUMN IF EXISTS "display_config"`,
    );
  }
}
```

> Register it wherever migrations are listed if the project uses an explicit array (check `packages/shared/src/database` for a migrations index; if migrations are auto-globbed, no registration needed). Apply locally per project convention (migration:run is broken — apply via docker psql): `docker compose -f docker-compose.infra.yml exec -T postgres psql -U <user> -d perfana -c 'ALTER TABLE compare_filter_presets ADD COLUMN IF NOT EXISTS display_config jsonb;'`

- [ ] **Step 4: API DTOs**

In `create-compare-preset.dto.ts`, add an optional property (match the file's existing validation style — likely `class-validator`):

```ts
  @IsOptional()
  @IsObject()
  display_config?: {
    warningThreshold: number;
    regressionThreshold: number;
    minAbsolute: number;
    percentiles: { p90: boolean; p95: boolean; p99: boolean };
  };
```

(Add `IsObject` to the `class-validator` import if not present.)

In `compare-preset-response.dto.ts`, add the same optional `display_config` field to the response shape (mirroring how `series_config` is exposed).

- [ ] **Step 5: Service mapping**

In `compare-presets.service.ts`, wherever the create request is mapped to the entity (mirroring `seriesConfig`), add `displayConfig: dto.display_config`. Wherever the entity is mapped to the response DTO (mirroring `series_config: entity.seriesConfig`), add `display_config: entity.displayConfig`.

Run to find the exact lines: `grep -n "seriesConfig\|series_config" apps/api/src/modules/compare-presets/compare-presets.service.ts`

- [ ] **Step 6: Frontend lib types (`apps/web/lib/compare-presets.ts`)**

Add `yAxesFormat?: string;` to `CompareSeriesConfig`. Add to both `ComparePreset` and `CreateComparePresetRequest`:

```ts
  display_config?: {
    warningThreshold: number;
    regressionThreshold: number;
    minAbsolute: number;
    percentiles: { p90: boolean; p95: boolean; p99: boolean };
  };
```

- [ ] **Step 7: SavePresetModal carries display_config**

In `SavePresetModal.tsx`: add `display_config?` (same shape) to `PresetFormData` and add `displayConfig?: DisplayConfig` to `CurrentFilterState` (import `DisplayConfig` from `./utils/compare-utils`). In the modal's `formData` initialization and in the `onSave` payload build, include `display_config: currentFilters.displayConfig`. Also include `yAxesFormat` when building `series_config` entries from `addedSeries` (map `s.yAxesFormat`).

- [ ] **Step 8: Hook save/apply (`useComparePresets.ts`)**

Add `setDisplayConfig` to the hook's props (alongside `setShowPercentiles`) and thread it from the caller. In `applyPreset`, after `setShowPercentiles(...)`:

```ts
      setDisplayConfig(preset.display_config ?? DEFAULT_DISPLAY_CONFIG);
```

In `savePreset`'s `createRequest`, add:

```ts
        display_config: presetData.display_config,
```

Import `DEFAULT_DISPLAY_CONFIG` from `../utils/compare-utils`. Thread `currentFilters.displayConfig` from the `SavePresetModal` invocation (in `CompareExpandedContent`/`CompareCard`) and pass `setDisplayConfig` (from `useCompareData`) into `useComparePresets`.

- [ ] **Step 9: Verify api + shared types and existing preset tests**

Run: `cd apps/api && npx tsc -p tsconfig.json --noEmit 2>&1 | grep -i compare-preset || echo "no api preset errors"`
Run: `cd apps/api && npx jest compare-presets`
Expected: existing preset service/controller specs pass (they don't assert on `display_config`; new optional field is additive).
Run: `cd apps/web && npx tsc -p tsconfig.json --noEmit 2>&1 | grep -E 'compare/|lib/compare-presets' || echo "no web errors"`
Expected: `no web errors`.

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/entities/compare-filter-preset.entity.ts packages/shared/src/database/migrations/ apps/api/src/modules/compare-presets/ apps/web/lib/compare-presets.ts "apps/web/app/test-runs/[id]/components/compare/SavePresetModal.tsx" "apps/web/app/test-runs/[id]/components/compare/hooks/useComparePresets.ts"
git commit -m "feat(compare): persist thresholds + percentile columns in saved presets"
```

---

### Task 7: End-to-end verification + version bump

**Files:**
- Modify: `VERSION`

- [ ] **Step 1: Monorepo type-check + lint**

Run: `npm run type-check 2>&1 | tail -30`
Run: `npm run lint 2>&1 | tail -30`
Expected: both pass. (Remember the web build gate excludes `app/test-runs/**`; the manual `tsc -p tsconfig.json` runs in earlier tasks already covered those files.)

- [ ] **Step 2: Targeted unit tests**

Run: `cd apps/web && npx jest 'app/test-runs/\[id\]/components/compare/utils'`
Run: `cd apps/api && npx jest compare-presets`
Expected: all pass.

- [ ] **Step 3: Manual smoke (real app)**

Start the app (`lsof -ti:3001,3002,4001 | xargs kill -9; npm run dev`), open a test run with a baseline available → Compare card → expand. Verify:
  - metrics group under Dashboard → Panel headers, one row per metric;
  - AVG always shown; toggling P90/P95/P99 in "Columns & thresholds" adds/removes columns;
  - changing Warning/Regression/Absolute thresholds recolors chips, bars, row accents, and the legend live;
  - a row's chevron expands the `ComparisonPlot` inline, only one open at a time, lazy-loaded;
  - Save Preset then re-apply restores columns + thresholds.
Use the `/run` or browser tooling; capture one screenshot of the expanded table.

- [ ] **Step 4: Bump VERSION**

Set `VERSION` to `0.2.61.54` (patch increment from `0.2.61.53`).

- [ ] **Step 5: Commit**

```bash
git add VERSION
git commit -m "chore: bump version to 0.2.61.54"
```

---

## Self-Review

**Spec coverage:**
- Baseline-report UI in the compare card → Tasks 1, 4 (band logic + grouped table with chips/bars). ✓
- Config: warning/regression/absolute thresholds + percentile columns → Tasks 2, 5 (`DisplayConfig` + popover). ✓
- Group by dashboard and panel → Task 3 (grouping fields) + Task 4 (grouped render). ✓
- Elegant per-metric compare graph → Task 4 (expandable row, lazy, one-at-a-time). ✓
- Persist thresholds in presets → Task 6. ✓
- Reuse existing data path + graph, no new endpoint → Tasks 3/4 use `/metrics/ds-metric-statistics` + `ComparisonPlot`. ✓

**Placeholder scan:** No TBD/TODO; Task 5 Step 3 and Task 6 Steps 4/5/7/8 describe edits against files whose exact surrounding lines the implementer must read first (grep/sed commands provided) — the required change and its literal content are fully specified.

**Type consistency:** `DisplayConfig`, `toDiffThresholds`, `getMetricColumns`, `graphKeyOf`, `MetricComparison` grouping fields, `onToggleGraph(row)` shape, and the `display_config` object shape are identical across Tasks 2–6. `fetchGraphData`/`toggleGraph` both take `{ dashboardId, panelId, metricName }`. Graph state maps keyed by `graphKeyOf(...)` in both the handlers and the table.
