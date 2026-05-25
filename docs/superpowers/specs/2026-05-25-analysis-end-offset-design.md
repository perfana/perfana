# Analysis End Offset — Design Spec

**Date:** 2026-05-25
**Status:** Approved for implementation

## Overview

Add `analysisEndOffset` as the symmetric counterpart to `analysisStartOffset`. It allows users to exclude a tail period at the end of a test run from all statistical analysis (ADAPT, rollups, Grafana queries). The effective analysis window becomes:

```
[startTime + analysisStartOffset, endTime − analysisEndOffset]
```

A value of `0` means no exclusion from the end (default, backward-compatible).

The frontend entry point is a new "Change analysis time range" button in the timing section of the test-run info card. It opens a dialog with a chart of the run's performance signals and a dual-handle slider for setting both offsets visually. The button is only shown for test runs with JTL/performance-test data (where time-series chart data is available).

The existing `analysisStartOffset` inline text edit is removed and replaced entirely by the dialog.

---

## Data Model

### New DB column

```sql
ALTER TABLE test_runs ADD COLUMN ramp_down INTEGER DEFAULT 0;
```

- Column name: `ramp_down` (mirrors `ramp_up` for `analysisStartOffset`)
- Entity property: `analysisEndOffset` (camelCase, per TypeORM convention)
- Nullable integer; `NULL` treated as `0` throughout the codebase
- Migration: `AddAnalysisEndOffsetToTestRuns` — adds column and backfills existing rows to `0`

### Entity update

`packages/shared/src/entities/test-run.entity.ts`:

```typescript
@Column({ name: 'ramp_down', type: 'integer', nullable: true })
analysisEndOffset?: number;
```

Add `analysisEndOffset` to `TestRun.auditableFields`.

### Shared schema

`packages/shared/src/schemas/index.ts` — add to both Zod schemas:

```typescript
analysisEndOffset: z.number().int().min(0).optional(),
```

---

## API Changes

### New mutation endpoint

**`PUT /test-runs/:id/analysis-time-range`**

```typescript
// Body
{ analysisStartOffset: number; analysisEndOffset: number }

// Response: updated TestRun
```

- Validates both values are non-negative integers
- Validates `analysisStartOffset + analysisEndOffset < testRun.duration` (warns but does not block — same philosophy as the existing start-offset validation)
- Writes both fields atomically via `UpdateAnalysisTimeRangeHandler`
- Triggers `TransactionStatsRollupPipeline` job (one job for both changes)
- Emits WebSocket `UPDATED` event
- Audit-logs both fields

**New handler:** `apps/api/src/modules/test-runs/handlers/update-analysis-time-range.handler.ts`

Follows the same pattern as `UpdateAnalysisStartOffsetHandler`: fetch pre-mutation entity, run raw UPDATE, fetch post-mutation entity, audit-log, emit gateway event.

### New query endpoint

**`GET /test-runs/:id/summary-timeseries`**

Returns time-bucketed performance data for the analysis time range dialog chart.

```typescript
// Response
{
  duration: number;           // seconds
  bucketSizeSeconds: number;
  buckets: {
    timeSeconds: number;      // seconds from startTime
    throughput: number;       // transactions per second in this bucket
    avgResponseTime: number;  // ms
    errorsPerSecond: number;
  }[];
}
```

- Queries `transactions` and `requests_error` tables (both joined to the `test_run_id`)
- Bucket size auto-calculated using the existing `calculateBucketSize` utility (targets ~100 data points)
- Returns `404` if no performance-test data exists for this run (used by frontend to hide the button)
- New service method: `TestRunsPerformanceQueryService.getSummaryTimeseries(testRunId)`
- New controller endpoint in `test-runs.controller.ts`

### Backward compatibility

- `PUT /test-runs/:id/analysis-start-offset` is **retained** for any CI scripts using it directly. It continues to write only `analysisStartOffset` and trigger a rollup. It is no longer wired to the frontend UI.

### Other files updated

| File | Change |
|------|--------|
| `commands/create-test-run.command.ts` | Accept optional `analysisEndOffset` (default `0`) |
| `dto/update-running-test.dto.ts` | Add optional `analysisEndOffset` field |
| `handlers/entity-mapper.ts` | Map `entity.analysisEndOffset → testRun.analysis_end_offset` |
| `services/test-runs-mapper.service.ts` | Include `analysisEndOffset` in mapped output |

---

## Worker Changes

### TransactionStatsRollupPipeline.ts

Currently computes a single `startCutoff` from `analysisStartOffset`. After this change it computes both boundaries:

```typescript
const rampUpSeconds  = testRun.analysisStartOffset ?? 0;
const rampDownSeconds = testRun.analysisEndOffset ?? 0;
const startCutoff = new Date(testRun.startTime.getTime() + rampUpSeconds * 1000);
const endCutoff   = new Date(testRun.endTime.getTime()  - rampDownSeconds * 1000);
```

The `ramp_up_excluded = true` SQL rows gain an additional filter:

```sql
FILTER (WHERE time >= $startCutoff AND time < $endCutoff)
```

The `ramp_up_excluded = false` (full-run) rows are unchanged — no time filter applied.

### metric-processor.ts (incremental ingestion)

Currently marks `ramp_up = true` for data points before `startCutoff`. After this change, also marks `ramp_up = true` for data points at or after `endCutoff`:

```typescript
const isExcluded =
  elapsedSeconds < startOffsetSeconds ||
  (endOffsetSeconds > 0 && elapsedSeconds >= (durationSeconds - endOffsetSeconds));
```

Same logic applied symmetrically in `grafana-collector.ts` and `dynatrace-collector.ts`.

### MetricsPipeline.ts (Grafana time-range queries)

The Grafana API query time range currently runs from `startTime + analysisStartOffset` to `endTime`. After this change it ends at `endTime − analysisEndOffset`.

### DataSanityCheckPipeline.ts

Add a data warning (not an invalidation) when the analysis window is zero or negative:

```
if (analysisStartOffset + analysisEndOffset >= duration):
    dataWarnings.push('Analysis window is zero or negative — offsets exclude the entire run')
```

---

## Frontend Changes

### TimingInformationSection.tsx

**Remove:** inline edit state, `handleAnalysisStartOffsetEdit/Save/Cancel`, the `TextField`, and the `analysisStartOffset` row as currently rendered.

**Add:**
- "Analysis Window" display row showing `formatDuration(analysisStartOffset) → formatDuration(duration − analysisEndOffset)` with effective duration in parentheses
- "Change analysis time range" button beneath the display row
- Button is conditionally rendered: `TimingInformationSection` fetches `GET .../summary-timeseries` on mount (result cached in component state). Button is hidden while the fetch is in flight and hidden permanently if the endpoint returns 404. If the fetch succeeds, the response payload is passed directly to the dialog so the dialog does not need a second fetch on open.
- Button click opens `AnalysisTimeRangeDialog`

### AnalysisTimeRangeDialog.tsx (new component)

**Location:** `apps/web/app/test-runs/[id]/components/test-run-details/components/AnalysisTimeRangeDialog.tsx`

**Props:**
```typescript
interface Props {
  open: boolean;
  testRun: TestRun;
  onClose: () => void;
  onSaved: (updatedTestRun: TestRun) => void;
}
```

**Behavior:**

1. On open, fetches `GET /test-runs/:id/summary-timeseries` (shows skeleton while loading)
2. Renders a Recharts `ComposedChart` with:
   - Throughput (transactions/s) — green filled area, left Y-axis
   - Avg response time (ms) — indigo line, right Y-axis
   - Errors/s — red filled area, left Y-axis (secondary)
   - Two amber dashed `ReferenceLine` components at the slider positions (update live as sliders move)
   - Two shaded `ReferenceArea` regions for the excluded zones (start and end)
3. MUI `Slider` in range mode:
   - `min={0}` `max={duration}` `step={1}`
   - `value={[localStartOffset, duration − localEndOffset]}`
   - Left handle → updates `localStartOffset` state
   - Right handle → updates `localEndOffset` state (derived: `duration − rightHandleValue`)
4. Displays current offsets and effective duration as text beneath the slider
5. "Save & Re-analyse" button → `PUT /test-runs/:id/analysis-time-range` → calls `onSaved(updatedTestRun)` → closes dialog → parent shows success toast
6. "Cancel" button → closes without saving

**State:**
```typescript
const [localStartOffset, setLocalStartOffset] = useState(testRun.analysis_start_offset ?? 0);
const [localEndOffset, setLocalEndOffset]     = useState(testRun.analysis_end_offset ?? 0);
const [timeseriesData, setTimeseriesData]     = useState<SummaryBucket[] | null>(null);
const [saving, setSaving]                     = useState(false);
```

### Type updates

`apps/web/types/test-runs.ts` (or wherever `TestRun` is defined for the web):
- Add `analysis_end_offset?: number`

---

## Testing

### API
- `update-analysis-time-range.handler.ts` — unit test covering: both fields updated, rollup triggered, audit logged, WebSocket emitted
- `test-runs-performance-query.service.ts` — unit test for `getSummaryTimeseries`: correct bucketing, 404 when no data
- Integration test: `PUT /test-runs/:id/analysis-time-range` round-trip

### Worker
- `TransactionStatsRollupPipeline.test.ts` — add test cases: non-zero `analysisEndOffset` excludes tail rows from `ramp_up_excluded=true` variant; full-run variant unaffected
- `metric-processor` tests — add tail-exclusion cases

### Web
- `AnalysisTimeRangeDialog` — render test: chart renders, slider moves update reference lines, save calls correct endpoint
- `TimingInformationSection` — button hidden when no perf data; dialog opens on click

---

## Out of Scope

- No change to the `analysis-start-offset` endpoint behavior (kept for backward compat)
- No migration of existing test run data (all existing rows get `ramp_down = 0`, no behavior change)
- No change to how Grafana-only runs display their timing info (button simply not shown)
- Report generation (`apps/perfana-report/`) — `analysisEndOffset` added to the report data fetch, but report template changes are a separate ticket
