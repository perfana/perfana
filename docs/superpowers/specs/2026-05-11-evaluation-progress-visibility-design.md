# Evaluation Progress Visibility

**Date:** 2026-05-11
**Status:** Approved

## Problem

Two gaps in the current evaluation progress UX:

1. `transaction-stats-rollup` (step 4 of the analyze pipeline) and `data-sanity-check` (the final step) are missing from the `PIPELINE_STAGES` lookup table. The `getStageName()` function falls back to the raw stage ID, so the progress banner shows `"transaction-stats-rollup"` instead of `"Transaction stats rollup"` during that step.

2. The `ResultStatusIcon` spinner in the completed test runs list only fires when `evaluatingChecks === 'IN_PROGRESS'` or `evaluatingAdapt === 'IN_PROGRESS'`. All other pipeline stages — including the transaction rollup, statistics calculation, and sanity check — produce no visible indicator in the list row, even though a job is actively running.

## Solution

### Change 1 — Add missing stages to `PIPELINE_STAGES`

**File:** `packages/shared/src/types/job-progress.types.ts`

Add two entries to the `PIPELINE_STAGES` constant to match the actual stages defined in `apps/worker/src/workers/analyze.ts`:

| Stage ID | Human-readable name |
|---|---|
| `transaction-stats-rollup` | `Transaction stats rollup` |
| `data-sanity-check` | `Data sanity check` |

Insert `transaction-stats-rollup` between `performance-test-metrics` and `metrics-collection` (matching the actual pipeline order). Append `data-sanity-check` after `adapt-analysis`.

`getStageName()` and the progress banner's stage display derive from this table, so no other backend or frontend changes are needed for this fix.

### Change 2 — Extend spinner condition in `ResultStatusIcon`

**File:** `apps/web/app/test-runs/components/ResultStatusIcon.tsx`

Add `!!status?.activeJob` as the first condition in `isInProgress`:

```typescript
const isInProgress =
  !!status?.activeJob ||
  status?.evaluatingChecks === 'IN_PROGRESS' ||
  status?.evaluatingComparisons === 'IN_PROGRESS' ||
  status?.evaluatingAdapt === 'IN_PROGRESS';
```

When the spinner is shown and `status.activeJob` is the trigger, show the current stage name in the tooltip rather than the generic "Test run evaluation in progress" message. Specifically:

- If `status.activeJob` is set: tooltip = `"${status.activeJob.stageName} in progress"` (e.g. `"Transaction stats rollup in progress"`)
- Otherwise (evaluatingChecks / evaluatingAdapt): keep existing tooltip `"Test run evaluation in progress"`

**Scope:** This only applies to the completed test runs table. The running test runs table already has a `ProgressBar` component and is unaffected.

## What is not changing

- No new status fields on `TestRunStatus`
- No worker changes
- No schema migrations
- The `JobProgressBanner` above the list (system+environment+workload scoped) already shows all stages — Change 1 just fixes the name rendering for the two missing ones

## Files touched

| File | Change |
|---|---|
| `packages/shared/src/types/job-progress.types.ts` | Add 2 entries to `PIPELINE_STAGES` |
| `apps/web/app/test-runs/components/ResultStatusIcon.tsx` | Extend `isInProgress` + contextual tooltip |
