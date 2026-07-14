# Graphs "All aggregated" Dropdown Option — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Graphs card's standalone "All aggregated" toggle (3 fixed, non-savable overlay series, avg-only) with a per-panel entry in the metric dropdown that adds a normal, editable, savable aggregated series — matching the Trends/Compare cards.

**Architecture:** All aggregated logic moves into small, pure/near-pure functions in `graphs/utils/aggregated-series.ts` (repurposing the file we're replacing), reusing the shared `apps/web/lib/aggregated-perf-series.ts` helper. `useGraphsData` delegates to them in three thin spots (offer option, build series, fetch data). The old overlay hook, toggle UI, and their wiring are deleted.

**Tech Stack:** Next.js (App Router), React hooks, TypeScript, Jest + `@testing-library/react`, MUI.

## Global Constraints

- Frontend only. **No** API or worker changes. The `/test-runs/:testRunId/aggregated-metric-timeseries?metric=&stat=` endpoint already exists and accepts `stat ∈ {avg,p50,p90,p95,p99,max}` and `metric ∈ {transaction_response_time,request_response_time,error_percentage}`; it returns `{ bucketSizeSeconds, buckets: [{ time, value }] }`.
- Reuse the shared helper `@/lib/aggregated-perf-series` (`ALL_AGGREGATED_OPTION`, `shouldOfferAllAggregated`, `getAggregateSpec`, `buildAggregatedMetricName`). Do **not** duplicate panel→spec mappings.
- Aggregated-series detection convention: `series.metricName.startsWith(ALL_AGGREGATED_OPTION)` (mirrors the Compare card).
- `apps/web/app/test-runs/**` is excluded from the type-check gate — every task that touches those files MUST run the targeted `tsc` command shown in its steps; Jest alone will not catch type errors there.
- Run Jest from `apps/web` (repo-root `npx jest` uses the wrong config). All commands below assume `cd /Users/daniel/workspace/perfana/apps/web` first.
- Working branch: `feat/graphs-all-aggregated-dropdown` (already created; the spec commit is on it).

---

### Task 1: Aggregated-series utility module (pure + fetch helper)

Replace the private overlay util with focused functions that own all aggregated logic. This is where the real logic and its tests live; later tasks just wire these in.

**Files:**
- Rewrite: `apps/web/app/test-runs/[id]/components/graphs/utils/aggregated-series.ts` (currently exports `AggregatedBucket`, `AggregatedMetricSpec`, `AGGREGATED_METRIC_SPECS`, `buildAggregatedMetricSeries` — all removed)
- Rewrite: `apps/web/app/test-runs/[id]/components/graphs/utils/__tests__/aggregated-series.test.ts`

**Interfaces:**
- Consumes: `@/lib/aggregated-perf-series` → `ALL_AGGREGATED_OPTION: string`, `shouldOfferAllAggregated(source: string, panelId: number): boolean`, `getAggregateSpec(panelId: number): { metric: string; stat: string } | null`. `@/lib/api` → `authenticatedFetch`. `../types` → `MetricDataPoint`, `SeriesConfig`.
- Produces (used by Task 2):
  - `bucketsToDataPoints(buckets: AggregatedBucket[], metricName: string): MetricDataPoint[]`
  - `aggregatedYAxisFormat(metric: string): string`
  - `offerAggregatedOption(source: string, panelId: number, metricNames: string[]): string[]`
  - `fetchAggregatedSeriesData(testRunIdForQuery: string, series: SeriesConfig): Promise<MetricDataPoint[]>`
  - `interface AggregatedBucket { time: string; value: number }`

- [ ] **Step 1: Write the failing tests**

Overwrite `apps/web/app/test-runs/[id]/components/graphs/utils/__tests__/aggregated-series.test.ts` with:

```ts
import {
  bucketsToDataPoints,
  aggregatedYAxisFormat,
  offerAggregatedOption,
  fetchAggregatedSeriesData,
} from '../aggregated-series';
import { authenticatedFetch } from '@/lib/api';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;
const okJson = (body: unknown): Response => ({ ok: true, json: async () => body } as unknown as Response);

const aggSeries = {
  id: 's1', dashboardId: 'd', dashboardLabel: 'L', panelId: 202,
  panelTitle: 'Request RT P90', metricName: 'All aggregated — Request RT P90',
  source: 'performance-metrics' as const,
};

describe('bucketsToDataPoints', () => {
  it('maps buckets to data points with sequential timestep and the given metric name', () => {
    expect(bucketsToDataPoints(
      [{ time: '2026-07-14T10:00:00.000Z', value: 12.5 }, { time: '2026-07-14T10:01:00.000Z', value: 13 }],
      'All aggregated — Request RT P90',
    )).toEqual([
      { time: '2026-07-14T10:00:00.000Z', metric_name: 'All aggregated — Request RT P90', value: 12.5, timestep: 0 },
      { time: '2026-07-14T10:01:00.000Z', metric_name: 'All aggregated — Request RT P90', value: 13, timestep: 1 },
    ]);
  });
  it('returns [] for empty buckets', () => {
    expect(bucketsToDataPoints([], 'x')).toEqual([]);
  });
});

describe('aggregatedYAxisFormat', () => {
  it('is percent for error_percentage and ms otherwise', () => {
    expect(aggregatedYAxisFormat('error_percentage')).toBe('percent');
    expect(aggregatedYAxisFormat('request_response_time')).toBe('ms');
    expect(aggregatedYAxisFormat('transaction_response_time')).toBe('ms');
  });
});

describe('offerAggregatedOption', () => {
  it('prepends the option for an aggregatable perf panel', () => {
    expect(offerAggregatedOption('performance-metrics', 202, ['T01.a', 'T02.b']))
      .toEqual(['All aggregated', 'T01.a', 'T02.b']);
  });
  it('leaves the list untouched for a non-perf source', () => {
    expect(offerAggregatedOption('grafana', 202, ['cpu'])).toEqual(['cpu']);
  });
  it('leaves the list untouched for a non-aggregatable perf panel', () => {
    expect(offerAggregatedOption('performance-metrics', 999, ['x'])).toEqual(['x']);
  });
});

describe('fetchAggregatedSeriesData', () => {
  beforeEach(() => mockFetch.mockReset());

  it('calls the timeseries endpoint with the panel spec and maps buckets', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ bucketSizeSeconds: 60, buckets: [{ time: '2026-07-14T10:00:00.000Z', value: 42 }] }));
    const data = await fetchAggregatedSeriesData('run-1', aggSeries);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/test-runs/run-1/aggregated-metric-timeseries');
    expect(url).toContain('metric=request_response_time');
    expect(url).toContain('stat=p90');
    expect(data).toEqual([{ time: '2026-07-14T10:00:00.000Z', metric_name: 'All aggregated — Request RT P90', value: 42, timestep: 0 }]);
  });

  it('returns [] when the panel has no aggregate spec', async () => {
    const data = await fetchAggregatedSeriesData('run-1', { ...aggSeries, panelId: 999 });
    expect(data).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns [] on a non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, statusText: 'Bad' } as unknown as Response);
    expect(await fetchAggregatedSeriesData('run-1', aggSeries)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/daniel/workspace/perfana/apps/web && npx jest graphs/utils/__tests__/aggregated-series`
Expected: FAIL — the new exports don't exist yet (old file exports `buildAggregatedMetricSeries`, not these).

- [ ] **Step 3: Rewrite the utility module**

Overwrite `apps/web/app/test-runs/[id]/components/graphs/utils/aggregated-series.ts` with:

```ts
import { authenticatedFetch } from '@/lib/api';
import {
  ALL_AGGREGATED_OPTION,
  shouldOfferAllAggregated,
  getAggregateSpec,
} from '@/lib/aggregated-perf-series';
import { MetricDataPoint, SeriesConfig } from '../types';

/** One point of the /aggregated-metric-timeseries response `buckets` array. */
export interface AggregatedBucket {
  time: string;
  value: number;
}

/** Shape aggregated-timeseries buckets into the chart's data-point model. */
export function bucketsToDataPoints(
  buckets: AggregatedBucket[],
  metricName: string,
): MetricDataPoint[] {
  return buckets.map((b, i) => ({
    time: b.time,
    metric_name: metricName,
    value: b.value,
    timestep: i,
  }));
}

/** Default Y-axis unit for an aggregated perf metric. */
export function aggregatedYAxisFormat(metric: string): string {
  return metric === 'error_percentage' ? 'percent' : 'ms';
}

/** Prepend the "All aggregated" dropdown entry for aggregatable perf panels. */
export function offerAggregatedOption(
  source: string,
  panelId: number,
  metricNames: string[],
): string[] {
  return shouldOfferAllAggregated(source, panelId)
    ? [ALL_AGGREGATED_OPTION, ...metricNames]
    : metricNames;
}

/**
 * Fetch one panel's run-wide aggregate as a chart series' data. Routes to the
 * aggregated-timeseries endpoint using the panel's (metric, stat) spec.
 * Returns [] when the panel isn't aggregatable or on any HTTP/transport error.
 */
export async function fetchAggregatedSeriesData(
  testRunIdForQuery: string,
  series: SeriesConfig,
): Promise<MetricDataPoint[]> {
  const spec = getAggregateSpec(series.panelId);
  if (!spec) return [];
  try {
    const res = await authenticatedFetch(
      `/test-runs/${testRunIdForQuery}/aggregated-metric-timeseries?metric=${spec.metric}&stat=${spec.stat}`,
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (!res.ok) {
      console.warn(`Failed to fetch aggregated data for series ${series.id}:`, res.statusText);
      return [];
    }
    const body: { buckets?: AggregatedBucket[] } = await res.json();
    return bucketsToDataPoints(body.buckets ?? [], series.metricName);
  } catch (err) {
    console.error(`Error fetching aggregated data for series ${series.id}:`, err);
    return [];
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/daniel/workspace/perfana/apps/web && npx jest graphs/utils/__tests__/aggregated-series`
Expected: PASS — all cases green.

- [ ] **Step 5: Confirm nothing else imported the old exports**

Run: `cd /Users/daniel/workspace/perfana/apps/web && grep -rn "AGGREGATED_METRIC_SPECS\|buildAggregatedMetricSeries\|AggregatedMetricSpec" "app/test-runs/[id]/components/graphs" ; grep -rn "aggregated-series" "app/test-runs/[id]/components/graphs/utils/index.ts" 2>/dev/null`
Expected: the only remaining hit for the first grep is inside `useAggregatedGraphSeries.ts` (deleted in Task 3). If `utils/index.ts` re-exports `aggregated-series`, note it — reconcile in Task 3. No other consumers.

- [ ] **Step 6: Commit**

```bash
cd /Users/daniel/workspace/perfana && git checkout -- CLAUDE.md AGENTS.md 2>/dev/null; \
git add "apps/web/app/test-runs/[id]/components/graphs/utils/aggregated-series.ts" \
        "apps/web/app/test-runs/[id]/components/graphs/utils/__tests__/aggregated-series.test.ts" && \
git commit -m "feat(graphs): aggregated-series utils (buckets map, option offer, fetch)"
```

---

### Task 2: Wire the option into `useGraphsData`

Delegate to Task 1's helpers in three spots. Thin edits — no new logic.

**Files:**
- Modify: `apps/web/app/test-runs/[id]/components/graphs/hooks/useGraphsData.ts` (imports; `fetchPanelMetrics` ~290-325; `fetchSeriesData` ~379-413; `handleAddSeries` ~428-438)

**Interfaces:**
- Consumes: from `@/lib/aggregated-perf-series` → `ALL_AGGREGATED_OPTION`, `getAggregateSpec`, `buildAggregatedMetricName`; from `../utils/aggregated-series` → `offerAggregatedOption`, `aggregatedYAxisFormat`, `fetchAggregatedSeriesData`.
- Produces: no signature changes to the hook's return. Behavior change only.

- [ ] **Step 1: Add imports**

At the top of `useGraphsData.ts`, after the existing `import { getFilteredDashboards, computeAvailableSources, determineSource } from '../utils';` line, add:

```ts
import {
  ALL_AGGREGATED_OPTION,
  getAggregateSpec,
  buildAggregatedMetricName,
} from '@/lib/aggregated-perf-series';
import {
  offerAggregatedOption,
  aggregatedYAxisFormat,
  fetchAggregatedSeriesData,
} from '../utils/aggregated-series';
```

- [ ] **Step 2: Offer the option in `fetchPanelMetrics`**

In `fetchPanelMetrics`, replace:

```ts
      if (response.ok) {
        const metricNames = await response.json();
        setMetrics(metricNames as string[]);
      } else {
```

with:

```ts
      if (response.ok) {
        const metricNames = await response.json();
        setMetrics(offerAggregatedOption(selectedSource, panelId, metricNames as string[]));
      } else {
```

Then add `selectedSource` to the `fetchPanelMetrics` `useCallback` dependency array (change `}, [testRun]);` at the end of `fetchPanelMetrics` to `}, [testRun, selectedSource]);`).

- [ ] **Step 3: Route aggregated series in `fetchSeriesData`**

In `fetchSeriesData`, make the aggregated branch the first statement of the function body (immediately after `const fetchSeriesData = useCallback(async (series: SeriesConfig): Promise<MetricDataPoint[]> => {`):

```ts
    if (series.metricName.startsWith(ALL_AGGREGATED_OPTION)) {
      return fetchAggregatedSeriesData(testRun?.test_run_id || testRunId, series);
    }
```

Leave the rest of `fetchSeriesData` unchanged.

- [ ] **Step 4: Build the aggregated series in `handleAddSeries`**

Replace the `newSeriesList` construction:

```ts
    const newSeriesList: SeriesConfig[] = selectedMetrics.map(metricName => ({
      id: `${applicationDashboardId}-${selectedPanel.id}-${metricName}-${Date.now()}-${Math.random()}`,
      dashboardId: applicationDashboardId,
      dashboardLabel: selectedDashboard.dashboard_label,
      panelId: selectedPanel.id,
      panelTitle: selectedPanel.title,
      metricName: metricName,
      source: source,
      yAxisFormat: selectedPanel.yAxesFormat,
      metricsSourceId: metricsSourceId
    }));
```

with:

```ts
    const newSeriesList: SeriesConfig[] = selectedMetrics.map(metricName => {
      const isAggregated = metricName === ALL_AGGREGATED_OPTION;
      const spec = isAggregated ? getAggregateSpec(selectedPanel.id) : null;
      return {
        id: `${applicationDashboardId}-${selectedPanel.id}-${isAggregated ? 'aggregated' : metricName}-${Date.now()}-${Math.random()}`,
        dashboardId: applicationDashboardId,
        dashboardLabel: selectedDashboard.dashboard_label,
        panelId: selectedPanel.id,
        panelTitle: selectedPanel.title,
        metricName: isAggregated ? buildAggregatedMetricName(selectedPanel.title) : metricName,
        source: source,
        yAxisFormat: isAggregated && spec ? aggregatedYAxisFormat(spec.metric) : selectedPanel.yAxesFormat,
        metricsSourceId: metricsSourceId
      };
    });
```

- [ ] **Step 5: Type-check the touched file**

Run: `cd /Users/daniel/workspace/perfana/apps/web && npx tsc -p tsconfig.json --noEmit 2>&1 | grep "components/graphs" || echo "no graphs type errors"`
Expected: `no graphs type errors`.

- [ ] **Step 6: Run the graphs test suite**

Run: `cd /Users/daniel/workspace/perfana/apps/web && npx jest graphs`
Expected: PASS. (The old `useAggregatedGraphSeries` overlay test is still present and still green here — it is removed in Task 3.)

- [ ] **Step 7: Commit**

```bash
cd /Users/daniel/workspace/perfana && git checkout -- CLAUDE.md AGENTS.md 2>/dev/null; \
git add "apps/web/app/test-runs/[id]/components/graphs/hooks/useGraphsData.ts" && \
git commit -m "feat(graphs): offer 'All aggregated' in metric dropdown and route its fetch"
```

---

### Task 3: Remove the old toggle, overlay wiring, and dead hook

With the dropdown path live, delete the standalone toggle mechanism.

**Files:**
- Delete: `apps/web/app/test-runs/[id]/components/graphs/hooks/useAggregatedGraphSeries.ts`
- Delete: `apps/web/app/test-runs/[id]/components/graphs/hooks/__tests__/useAggregatedGraphSeries.test.ts`
- Modify: `apps/web/app/test-runs/[id]/components/graphs/hooks/index.ts`
- Modify: `apps/web/app/test-runs/[id]/components/graphs/GraphsCard.tsx`
- Modify: `apps/web/app/test-runs/[id]/components/graphs/components/GraphsExpandedContent.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `GraphsExpandedContent` no longer accepts `overlaySeries`, `overlayData`, `showAggregatedToggle`, `includeAggregated`, `onIncludeAggregatedChange`.

- [ ] **Step 1: Delete the dead hook and its test**

```bash
cd /Users/daniel/workspace/perfana && \
git rm "apps/web/app/test-runs/[id]/components/graphs/hooks/useAggregatedGraphSeries.ts" \
       "apps/web/app/test-runs/[id]/components/graphs/hooks/__tests__/useAggregatedGraphSeries.test.ts"
```

- [ ] **Step 2: Drop the barrel export**

In `apps/web/app/test-runs/[id]/components/graphs/hooks/index.ts`, delete the line:

```ts
export { useAggregatedGraphSeries } from './useAggregatedGraphSeries';
```

(If Task 1 Step 5 found `utils/index.ts` re-exporting the old `aggregated-series` symbols, update that export list now to the new names or remove stale ones.)

- [ ] **Step 3: Remove the hook usage in `GraphsCard.tsx`**

Change the import on line 19 from:

```ts
import { useGraphsData, useGraphsPresets, useAggregatedGraphSeries } from './hooks';
```

to:

```ts
import { useGraphsData, useGraphsPresets } from './hooks';
```

Delete the block (lines ~42-47):

```ts
  // Aggregated overlay hook
  const aggregated = useAggregatedGraphSeries({
    testRun,
    testRunId,
    selectedSource: graphsData.selectedSource,
  });
```

Remove the five overlay/toggle props passed to `GraphsExpandedContent` (lines ~294-298):

```ts
              overlaySeries={aggregated.aggregatedSeries}
              overlayData={aggregated.aggregatedData}
              showAggregatedToggle={aggregated.showAggregatedToggle}
              includeAggregated={aggregated.includeAggregated}
              onIncludeAggregatedChange={aggregated.setIncludeAggregated}
```

And change the next line from:

```ts
              chartDataLoading={graphsData.chartDataLoading || aggregated.aggregatedLoading}
```

to:

```ts
              chartDataLoading={graphsData.chartDataLoading}
```

- [ ] **Step 4: Strip the toggle and overlay merge from `GraphsExpandedContent.tsx`**

In the `@mui/material` import block, remove `Switch,` and `FormControlLabel,` (no longer used).

In the `GraphsExpandedContentProps` interface, delete these five lines:

```ts
  overlaySeries?: SeriesConfig[];
  overlayData?: Map<string, MetricDataPoint[]>;
  showAggregatedToggle?: boolean;
  includeAggregated?: boolean;
  onIncludeAggregatedChange?: (value: boolean) => void;
```

In the destructured params, delete:

```ts
  overlaySeries = [],
  overlayData,
  showAggregatedToggle = false,
  includeAggregated = false,
  onIncludeAggregatedChange,
```

Replace the overlay-merge block:

```ts
  // Overlay series render in the chart only — never in the editable Added
  // Series list and never saved as a preset.
  const chartSeries = [...addedSeries, ...overlaySeries];
  const chartData = new Map(seriesData);
  if (overlayData) {
    overlayData.forEach((points, id) => chartData.set(id, points));
  }
```

with:

```ts
  const chartSeries = addedSeries;
  const chartData = seriesData;
```

Delete the toggle JSX block entirely:

```tsx
      {showAggregatedToggle && (
        <FormControlLabel
          sx={{ mb: 2 }}
          control={
            <Switch
              checked={includeAggregated}
              onChange={(e) => onIncludeAggregatedChange?.(e.target.checked)}
            />
          }
          label="Include 'All aggregated' series (performance test metrics)"
        />
      )}
```

If `MetricDataPoint` is now unused in this file's imports after removing `overlayData`, leave the import as-is only if still referenced; otherwise remove `MetricDataPoint` from the `../types` import line. (Check: `seriesData: Map<string, MetricDataPoint[]>` prop still uses it — so keep it.)

- [ ] **Step 5: Verify no dangling references**

Run: `cd /Users/daniel/workspace/perfana/apps/web && grep -rn "useAggregatedGraphSeries\|showAggregatedToggle\|overlaySeries\|overlayData\|includeAggregated" "app/test-runs/[id]/components/graphs"`
Expected: no output.

- [ ] **Step 6: Type-check and run the full graphs suite**

Run: `cd /Users/daniel/workspace/perfana/apps/web && npx tsc -p tsconfig.json --noEmit 2>&1 | grep "components/graphs" || echo "no graphs type errors"`
Expected: `no graphs type errors`.

Run: `cd /Users/daniel/workspace/perfana/apps/web && npx jest graphs`
Expected: PASS. The deleted overlay test is gone; the new `aggregated-series` tests remain.

- [ ] **Step 7: Commit**

```bash
cd /Users/daniel/workspace/perfana && git checkout -- CLAUDE.md AGENTS.md 2>/dev/null; \
git add -A "apps/web/app/test-runs/[id]/components/graphs" && \
git commit -m "refactor(graphs): remove standalone 'All aggregated' toggle + overlay hook"
```

---

### Task 4: Manual verification, changelog, version bump

**Files:**
- Modify: `VERSION`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Manual smoke test (dev server)**

Start the app if not running (`npm run dev` from repo root), open a test run with performance-test metrics, expand the Graphs card, and verify:
1. Selecting a performance-test dashboard + an aggregatable panel (e.g. *Request RT P90*) shows **"All aggregated"** as the first entry in the metric dropdown.
2. Selecting it and clicking **Add Series** adds one series named *"All aggregated — <panel>"*, plotted on the chart, listed in **Added Series** (removable, unit editable).
3. A non-perf dashboard (Grafana/Dynatrace) shows **no** "All aggregated" entry and no toggle anywhere.
4. Saving a preset with the aggregated series, reloading it, re-plots the same series.

Note any deviation; if something fails, fix in the relevant task before continuing.

- [ ] **Step 2: Bump VERSION**

Read the current `VERSION`, increment the patch segment (e.g. `0.2.61.59` → `0.2.61.60`), and write it back.

- [ ] **Step 3: Add a changelog entry**

Add under the top of `CHANGELOG.md` (above the most recent entry), using the bumped version and today's date `2026-07-14`:

```markdown
## [<bumped version>] - 2026-07-14

### Changed
- **Graphs card "All aggregated" is now a metric-dropdown option, matching Trends/Compare.** Replaced the standalone toggle (which overlaid three fixed, non-savable avg-only run-wide series) with a per-panel **"All aggregated"** entry in the metric dropdown, offered for aggregatable performance-test panels. Selecting it adds a normal, editable, savable series that uses the panel's actual statistic (avg/p90/p95/p99) via the shared `aggregated-perf-series` helper. Removed the Graphs card's private duplicate aggregation util and the overlay hook. Frontend-only.
```

- [ ] **Step 4: Commit**

```bash
cd /Users/daniel/workspace/perfana && git checkout -- CLAUDE.md AGENTS.md 2>/dev/null; \
git add VERSION CHANGELOG.md && \
git commit -m "chore: bump version and changelog (graphs 'All aggregated' dropdown)"
```

- [ ] **Step 5: Full preflight before PR**

Run: `cd /Users/daniel/workspace/perfana && npm run preflight`
Expected: PASS (lint + type-check + RLS suite). Then the change is ready to `/ship`.

---

## Self-Review

**Spec coverage:**
- Data model unchanged (SeriesConfig round-trips) → Task 2 Step 4 (metricName/panelId) + presets need no code → covered.
- Offer option (`fetchPanelMetrics`) → Task 2 Step 2 (+ Task 1 `offerAggregatedOption`). ✓
- Add series (`handleAddSeries`, name + yAxisFormat) → Task 2 Step 4 (+ Task 1 `aggregatedYAxisFormat`). ✓
- Fetch routing (`fetchSeriesData` → timeseries endpoint) → Task 2 Step 3 (+ Task 1 `fetchAggregatedSeriesData`, `bucketsToDataPoints`). ✓
- Deletions (hook, util, toggle UI, GraphsCard wiring, barrel export) → Task 3. ✓
- Reuse shared helper → Task 1 imports. ✓
- Testing (routing + injection + build) → Task 1 unit tests; Task 2/3 tsc + `jest graphs`. ✓
- Risks (legend uniqueness, unit override, null spec) → `buildAggregatedMetricName` (unique names), `handleUpdateSeriesUnit` unchanged, `getAggregateSpec` null → `fetchAggregatedSeriesData` returns []. ✓

**Placeholder scan:** none — every code/edit step shows concrete code and exact commands.

**Type consistency:** `bucketsToDataPoints`, `aggregatedYAxisFormat`, `offerAggregatedOption`, `fetchAggregatedSeriesData` signatures are identical in the Task 1 interface block, the implementation, and the Task 2 call sites. `MetricDataPoint` shape (`time, metric_name, value, timestep`) matches the type in `graphs.types.ts`. `getAggregateSpec` return `{ metric, stat }` used consistently.
