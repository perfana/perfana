# Evaluation Progress Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the transaction-stats-rollup stage show its human-readable name in the evaluation progress banner, and display a spinner in the completed test runs list during any active job stage.

**Architecture:** Two independent changes: (1) add two missing stage ID→name mappings to the shared `PIPELINE_STAGES` lookup constant so `getStageName()` returns a proper label; (2) extend the `isInProgress` condition in `ResultStatusIcon` to also fire when `status.activeJob` is non-null, covering all pipeline stages beyond just checks/adapt.

**Tech Stack:** TypeScript, React, MUI, React Testing Library (Jest/jsdom for web), ts-jest (shared package)

---

## Files

| File | Action | Purpose |
|---|---|---|
| `packages/shared/src/types/job-progress.types.ts` | Modify | Add `transaction-stats-rollup` and `data-sanity-check` to `PIPELINE_STAGES` |
| `packages/shared/src/types/job-progress.types.spec.ts` | Create | Unit tests for `getStageName()` covering the two new entries |
| `apps/web/app/test-runs/components/ResultStatusIcon.tsx` | Modify | Extend `isInProgress` + contextual tooltip |
| `apps/web/app/test-runs/components/ResultStatusIcon.test.tsx` | Create | React Testing Library tests for new spinner condition |

---

### Task 1: Test `getStageName` for missing stages

**Files:**
- Create: `packages/shared/src/types/job-progress.types.spec.ts`

- [ ] **Step 1: Create the test file**

```typescript
import { getStageName, PIPELINE_STAGES } from './job-progress.types';

describe('getStageName', () => {
  it('returns human-readable name for transaction-stats-rollup', () => {
    expect(getStageName('transaction-stats-rollup')).toBe('Transaction stats rollup');
  });

  it('returns human-readable name for data-sanity-check', () => {
    expect(getStageName('data-sanity-check')).toBe('Data sanity check');
  });

  it('falls back to the raw id for unknown stages', () => {
    expect(getStageName('unknown-stage')).toBe('unknown-stage');
  });

  it('transaction-stats-rollup appears between performance-test-metrics and metrics-collection', () => {
    const ids = PIPELINE_STAGES.map((s) => s.id);
    const perfIdx = ids.indexOf('performance-test-metrics');
    const rollupIdx = ids.indexOf('transaction-stats-rollup');
    const metricsIdx = ids.indexOf('metrics-collection');
    expect(rollupIdx).toBeGreaterThan(perfIdx);
    expect(rollupIdx).toBeLessThan(metricsIdx);
  });

  it('data-sanity-check appears after adapt-analysis', () => {
    const ids = PIPELINE_STAGES.map((s) => s.id);
    const adaptIdx = ids.indexOf('adapt-analysis');
    const sanityIdx = ids.indexOf('data-sanity-check');
    expect(sanityIdx).toBeGreaterThan(adaptIdx);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/shared && npx jest src/types/job-progress.types.spec.ts --no-coverage
```

Expected: 4 failures — `getStageName('transaction-stats-rollup')` returns `'transaction-stats-rollup'` (fallback), `getStageName('data-sanity-check')` returns `'data-sanity-check'`, ordering assertions fail because entries don't exist.

---

### Task 2: Add missing stages to `PIPELINE_STAGES`

**Files:**
- Modify: `packages/shared/src/types/job-progress.types.ts` (around line 270)

- [ ] **Step 1: Update `PIPELINE_STAGES`**

Find the existing array (line ~270) and add the two missing entries. The full updated array:

```typescript
export const PIPELINE_STAGES = [
  { id: 'dynatrace-collection', name: 'Dynatrace collection' },
  { id: 'panels-processing', name: 'Panels processing' },
  { id: 'performance-test-metrics', name: 'Performance test metrics' },
  { id: 'transaction-stats-rollup', name: 'Transaction stats rollup' },
  { id: 'metrics-collection', name: 'Metrics collection' },
  { id: 'statistics-calculation', name: 'Statistics calculation' },
  { id: 'checks-evaluation', name: 'Checks evaluation' },
  { id: 'control-groups-creation', name: 'Control groups creation' },
  { id: 'control-group-statistics', name: 'Control group statistics' },
  { id: 'adapt-analysis', name: 'ADAPT analysis' },
  { id: 'data-sanity-check', name: 'Data sanity check' },
] as const;
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd packages/shared && npx jest src/types/job-progress.types.spec.ts --no-coverage
```

Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/job-progress.types.ts \
        packages/shared/src/types/job-progress.types.spec.ts
git commit -m "feat(shared): add transaction-stats-rollup and data-sanity-check to PIPELINE_STAGES"
```

---

### Task 3: Test `ResultStatusIcon` spinner for `activeJob`

**Files:**
- Create: `apps/web/app/test-runs/components/ResultStatusIcon.test.tsx`

The web Jest environment is jsdom with `@testing-library/jest-dom` pre-configured. MUI components render to the DOM normally; `CircularProgress` renders with `role="progressbar"`.

- [ ] **Step 1: Create the test file**

```typescript
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ResultStatusIcon } from './ResultStatusIcon';
import type { TestRun } from '@/types/test-runs';

const baseTestRun: TestRun = {
  id: 'tr-1',
  test_run_id: 'run-001',
  system_under_test_id: 'sut-1',
  test_environment: 'production',
  workload: 'load-test',
  completed: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const activeJobFixture = {
  jobId: 'job-1',
  jobType: 'analyze',
  stage: 'transaction-stats-rollup',
  stageName: 'Transaction stats rollup',
  stageIndex: 4,
  totalStages: 10,
  stageProgress: 50,
  overallProgress: 35,
  startedAt: '2026-01-01T00:00:00Z',
  lastProgressAt: '2026-01-01T00:00:05Z',
};

describe('ResultStatusIcon', () => {
  it('shows spinner when activeJob is set on a completed test run', () => {
    const testRun = {
      ...baseTestRun,
      status: { phase: 'completed' as const, activeJob: activeJobFixture },
      consolidated_result: { passed: true, overall: true },
    } as TestRun;

    render(<ResultStatusIcon testRun={testRun} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('still shows spinner when evaluatingChecks is IN_PROGRESS and activeJob is absent', () => {
    const testRun = {
      ...baseTestRun,
      status: { phase: 'running' as const, evaluatingChecks: 'IN_PROGRESS' as const },
      consolidated_result: { passed: false, overall: false },
    } as TestRun;

    render(<ResultStatusIcon testRun={testRun} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('does NOT show spinner when activeJob is null and no evaluation flags are set', () => {
    const testRun = {
      ...baseTestRun,
      status: { phase: 'completed' as const, activeJob: null },
      consolidated_result: { passed: true, overall: true },
    } as TestRun;

    render(<ResultStatusIcon testRun={testRun} />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx jest app/test-runs/components/ResultStatusIcon.test.tsx --no-coverage
```

Expected: test 1 fails — spinner is not shown when `activeJob` is set because the component doesn't check that field yet. Tests 2 and 3 should pass (existing behaviour).

---

### Task 4: Extend `ResultStatusIcon` spinner condition

**Files:**
- Modify: `apps/web/app/test-runs/components/ResultStatusIcon.tsx`

- [ ] **Step 1: Update `isInProgress` and tooltip**

Replace the block at the top of the component body (lines 12–16 and 19–35) with:

```typescript
const status = testRun.status as unknown;
const statusObj = status as {
  activeJob?: { stageName?: string } | null;
  evaluatingChecks?: string;
  evaluatingComparisons?: string;
  evaluatingAdapt?: string;
} | undefined;

const activeJob = statusObj?.activeJob;
const isInProgress =
  !!activeJob ||
  statusObj?.evaluatingChecks === 'IN_PROGRESS' ||
  statusObj?.evaluatingComparisons === 'IN_PROGRESS' ||
  statusObj?.evaluatingAdapt === 'IN_PROGRESS';

const spinnerTooltip = activeJob?.stageName
  ? `${activeJob.stageName} in progress`
  : 'Test run evaluation in progress';

if (isInProgress) {
  return (
    <Tooltip
      title={spinnerTooltip}
      arrow
      placement="top"
    >
      <CircularProgress
        size={20}
        thickness={4}
        sx={{
          color: '#1976d2',
        }}
      />
    </Tooltip>
  );
}
```

Keep everything else in the component unchanged.

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd apps/web && npx jest app/test-runs/components/ResultStatusIcon.test.tsx --no-coverage
```

Expected: all 4 tests pass.

- [ ] **Step 3: Run the full web test suite to check for regressions**

```bash
cd apps/web && npx jest --no-coverage 2>&1 | tail -20
```

Expected: no new failures.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/test-runs/components/ResultStatusIcon.tsx \
        apps/web/app/test-runs/components/ResultStatusIcon.test.tsx
git commit -m "feat(web): show spinner in completed test run list during any active job stage"
```

---

### Task 5: Type-check and preflight

- [ ] **Step 1: Run type-check across the monorepo**

```bash
cd /path/to/repo && npm run type-check 2>&1 | tail -30
```

Expected: no new type errors.

- [ ] **Step 2: Run preflight**

```bash
npm run preflight
```

Expected: passes.
