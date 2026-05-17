# Abort Running Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Abort button to running test rows (list view) and the test run detail header that sets `abort=true` and `abortMessage="Aborted manually by <user>"`, with a confirm dialog and audit event.

**Architecture:** New `PATCH /test-runs/:id/abort` endpoint backed by a method added to `TestRunsMutationService` (which gains `AuditService` injection). A shared `AbortTestRunButton` React component handles dialog + API call for both placements.

**Tech Stack:** NestJS / TypeORM / AuditService (backend), React / MUI / authenticatedFetch (frontend), Jest (API tests).

---

### File Map

| Action | File |
|--------|------|
| Modify | `apps/api/src/modules/test-runs/handlers/entity-mapper.ts` |
| Modify | `apps/web/types/test-runs.ts` |
| Modify | `apps/api/src/modules/test-runs/services/test-runs-mutation.service.ts` |
| Modify | `apps/api/src/modules/test-runs/services/test-runs-mutation.service.spec.ts` |
| Modify | `apps/api/src/modules/test-runs/test-runs.service.ts` |
| Modify | `apps/api/src/modules/test-runs/controllers/test-runs.controller.ts` |
| Modify | `apps/api/src/modules/test-runs/test-runs.controller.spec.ts` |
| Create | `apps/web/app/test-runs/components/AbortTestRunButton.tsx` |
| Modify | `apps/web/app/test-runs/components/index.ts` |
| Modify | `apps/web/app/test-runs/components/TestRunsTable.tsx` |
| Modify | `apps/web/app/test-runs/page.tsx` |
| Modify | `apps/web/app/test-runs/[id]/components/header/TestRunHeader.tsx` |

---

### Task 1: Extend entity mapper and frontend type with `abort_message`

**Files:**
- Modify: `apps/api/src/modules/test-runs/handlers/entity-mapper.ts`
- Modify: `apps/web/types/test-runs.ts`

- [ ] **Step 1: Add `abort_message` to entity mapper**

  In `apps/api/src/modules/test-runs/handlers/entity-mapper.ts`, find the line:
  ```ts
      abort: entity.abort,
  ```
  Change it to:
  ```ts
      abort: entity.abort,
      abort_message: entity.abortMessage,
  ```

- [ ] **Step 2: Add `abort_message` to frontend TestRun type**

  In `apps/web/types/test-runs.ts`, find:
  ```ts
    abort?: boolean;
  ```
  Change it to:
  ```ts
    abort?: boolean;
    abort_message?: string;
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add apps/api/src/modules/test-runs/handlers/entity-mapper.ts apps/web/types/test-runs.ts
  git commit -m "feat(test-runs): expose abort_message in entity mapper and frontend type"
  ```

---

### Task 2: Backend `abortTestRun` service method

**Files:**
- Modify: `apps/api/src/modules/test-runs/services/test-runs-mutation.service.ts`
- Modify: `apps/api/src/modules/test-runs/services/test-runs-mutation.service.spec.ts`
- Modify: `apps/api/src/modules/test-runs/test-runs.service.ts`

- [ ] **Step 1: Write the failing tests**

  Open `apps/api/src/modules/test-runs/services/test-runs-mutation.service.spec.ts`.

  Add `AuditService` to the imports at the top of the file (alongside existing imports):
  ```ts
  import { AuditService } from '../../audit/audit.service';
  ```

  Add `NotFoundException, BadRequestException` to the imports from `@nestjs/common` if not present:
  ```ts
  import { NotFoundException, BadRequestException } from '@nestjs/common';
  ```

  In the `describe('TestRunsMutationService', () => {` block, add a declaration:
  ```ts
  let auditService: jest.Mocked<AuditService>;
  ```

  In the `beforeEach` provider list, add:
  ```ts
  {
    provide: AuditService,
    useValue: { logUpdate: jest.fn(), logCreate: jest.fn(), logDelete: jest.fn() },
  },
  ```

  Add `auditService = module.get(AuditService);` after the existing `service = module.get(...)` lines.

  Add the following test block at the end of the describe:
  ```ts
  describe('abortTestRun', () => {
    const userId = 'user-uuid-123';
    const userIdentifier = 'test@example.com';

    it('should abort a running test run', async () => {
      const entity = createMockTestRunEntity({ completed: false, abort: false });
      testRunRepo.findOne.mockResolvedValue(entity);
      testRunRepo.save.mockResolvedValue({ ...entity, abort: true, abortMessage: `Aborted manually by ${userIdentifier}` });

      const result = await service.abortTestRun(entity.id, userId, [], userIdentifier);

      expect(testRunRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ abort: true, abortMessage: `Aborted manually by ${userIdentifier}`, updatedBy: userId }),
      );
      expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
      expect(result.abort).toBe(true);
    });

    it('should throw NotFoundException when test run does not exist', async () => {
      testRunRepo.findOne.mockResolvedValue(null);

      await expect(service.abortTestRun('no-such-id', userId, [], userIdentifier))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when test run is already completed', async () => {
      const entity = createMockTestRunEntity({ completed: true, abort: false });
      testRunRepo.findOne.mockResolvedValue(entity);

      await expect(service.abortTestRun(entity.id, userId, [], userIdentifier))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when test run is already aborted', async () => {
      const entity = createMockTestRunEntity({ completed: false, abort: true });
      testRunRepo.findOne.mockResolvedValue(entity);

      await expect(service.abortTestRun(entity.id, userId, [], userIdentifier))
        .rejects.toThrow(BadRequestException);
    });
  });
  ```

- [ ] **Step 2: Run the failing tests**

  ```bash
  cd apps/api && npx jest test-runs-mutation.service.spec.ts --no-coverage 2>&1 | tail -20
  ```
  Expected: tests fail with "service.abortTestRun is not a function".

- [ ] **Step 3: Implement `abortTestRun` in the mutation service**

  In `apps/api/src/modules/test-runs/services/test-runs-mutation.service.ts`:

  Add to the imports at the top:
  ```ts
  import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
  import { OwnedResource } from '../../../common/interfaces/owned-resource.interface';
  import { AuditService } from '../../audit/audit.service';
  ```

  Add `AuditService` to the constructor (after `metricsService`):
  ```ts
  private readonly auditService: AuditService,
  ```

  Add the `abortTestRun` method after `updateRunningTest`:
  ```ts
  async abortTestRun(id: string, userId: string, _roles: string[], userIdentifier: string): Promise<TestRun> {
    const entity = await withRequestEm(this.testRunRepo).findOne({ where: { id } });

    if (!entity) {
      throw new NotFoundException(`Test run not found: ${id}`);
    }

    if (entity.completed) {
      throw new BadRequestException('Test run is already completed');
    }

    if (entity.abort) {
      throw new BadRequestException('Test run is already aborted');
    }

    const before = { ...entity };

    entity.abort = true;
    entity.abortMessage = `Aborted manually by ${userIdentifier}`;
    entity.updatedBy = userId;

    await withRequestEm(this.testRunRepo).save(entity);

    this.auditService.logUpdate(
      before as unknown as OwnedResource,
      entity as unknown as OwnedResource,
      { organizationIdOverride: entity.organizationId },
    );

    return mapEntityToTestRun(entity);
  }
  ```

- [ ] **Step 4: Check the import for `OwnedResource`**

  Run:
  ```bash
  grep -r "OwnedResource" apps/api/src/common/interfaces/ --include="*.ts" | head -3
  ```
  If the path differs, adjust the import accordingly. Typical: `import { OwnedResource } from '@perfana/shared/entities';`

  Try the shared import if the common/interfaces path doesn't exist:
  ```ts
  import { OwnedResource } from '@perfana/shared/entities';
  ```

- [ ] **Step 5: Add facade delegation in `test-runs.service.ts`**

  In `apps/api/src/modules/test-runs/test-runs.service.ts`, find the block near `updateTags`:
  ```ts
  async updateTags(id: string, tags: string[], userId: string, roles: string[]): Promise<TestRun> {
    return this.mutationService.updateTags(id, tags, userId, roles);
  }
  ```

  Add before it:
  ```ts
  async abortTestRun(id: string, userId: string, roles: string[], userIdentifier: string): Promise<TestRun> {
    return this.mutationService.abortTestRun(id, userId, roles, userIdentifier);
  }
  ```

- [ ] **Step 6: Run tests to verify they pass**

  ```bash
  cd apps/api && npx jest test-runs-mutation.service.spec.ts --no-coverage 2>&1 | tail -20
  ```
  Expected: all 4 new tests PASS.

- [ ] **Step 7: Commit**

  ```bash
  git add apps/api/src/modules/test-runs/services/test-runs-mutation.service.ts \
          apps/api/src/modules/test-runs/services/test-runs-mutation.service.spec.ts \
          apps/api/src/modules/test-runs/test-runs.service.ts
  git commit -m "feat(test-runs): add abortTestRun service method with audit logging"
  ```

---

### Task 3: Backend `PATCH /test-runs/:id/abort` endpoint

**Files:**
- Modify: `apps/api/src/modules/test-runs/controllers/test-runs.controller.ts`
- Modify: `apps/api/src/modules/test-runs/test-runs.controller.spec.ts`

- [ ] **Step 1: Write the failing controller test**

  Open `apps/api/src/modules/test-runs/test-runs.controller.spec.ts`.

  Find the existing mock of `testRunsService` and add `abortTestRun: jest.fn()` to the mock object.

  Add this test block near the end (or alongside other PATCH/DELETE tests):
  ```ts
  describe('PATCH /test-runs/:id/abort', () => {
    it('should abort a running test run', async () => {
      const mockResult = { id: 'uuid-123', test_run_id: 'run-001', abort: true, abort_message: 'Aborted manually by test@example.com', completed: false };
      jest.spyOn(testRunsService, 'abortTestRun').mockResolvedValue(mockResult as any);

      const ctx = { userId: 'user-1', roles: [], email: 'test@example.com', organizationId: 'org-1', teamId: null };
      const result = await controller.abortTestRun('uuid-123', ctx as any);

      expect(testRunsService.abortTestRun).toHaveBeenCalledWith('uuid-123', 'user-1', [], 'test@example.com');
      expect(result).toEqual(mockResult);
    });

    it('should fall back to userId when email is not present', async () => {
      const mockResult = { id: 'uuid-123', abort: true, abort_message: 'Aborted manually by user-1', completed: false };
      jest.spyOn(testRunsService, 'abortTestRun').mockResolvedValue(mockResult as any);

      const ctx = { userId: 'user-1', roles: [], email: undefined, organizationId: 'org-1', teamId: null };
      await controller.abortTestRun('uuid-123', ctx as any);

      expect(testRunsService.abortTestRun).toHaveBeenCalledWith('uuid-123', 'user-1', [], 'user-1');
    });
  });
  ```

- [ ] **Step 2: Run the failing test**

  ```bash
  cd apps/api && npx jest test-runs.controller.spec.ts --no-coverage 2>&1 | tail -20
  ```
  Expected: FAIL — "controller.abortTestRun is not a function".

- [ ] **Step 3: Add the endpoint to the controller**

  In `apps/api/src/modules/test-runs/controllers/test-runs.controller.ts`:

  Add `Patch` to the import from `@nestjs/common`:
  ```ts
  import { Controller, Get, Delete, Post, Put, Patch, Param, Query, Body, ParseUUIDPipe, HttpCode, HttpStatus, Logger } from '@nestjs/common';
  ```

  Add the endpoint before the `@Delete(':id')` endpoint:
  ```ts
  @Patch(':id/abort')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Abort a running test run', description: 'Sets abort=true and records who triggered it. Rejected if already completed or aborted.' })
  @ApiParam({ name: 'id', description: 'Test run UUID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @ApiResponse({ status: 200, description: 'Test run aborted successfully' })
  @ApiResponse({ status: 400, description: 'Test run already completed or already aborted' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async abortTestRun(
    @Param('id', ParseUUIDPipe) id: string,
    @UserCtx() ctx: UserContext,
  ) {
    const userIdentifier = ctx.email ?? ctx.userId;
    return this.testRunsService.abortTestRun(id, ctx.userId, ctx.roles, userIdentifier);
  }
  ```

- [ ] **Step 4: Run tests to verify they pass**

  ```bash
  cd apps/api && npx jest test-runs.controller.spec.ts --no-coverage 2>&1 | tail -20
  ```
  Expected: all tests PASS.

- [ ] **Step 5: Type-check the API**

  ```bash
  cd apps/api && npx tsc --noEmit 2>&1 | head -30
  ```
  Expected: no errors.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/api/src/modules/test-runs/controllers/test-runs.controller.ts \
          apps/api/src/modules/test-runs/test-runs.controller.spec.ts
  git commit -m "feat(test-runs): add PATCH /test-runs/:id/abort endpoint"
  ```

---

### Task 4: `AbortTestRunButton` React component

**Files:**
- Create: `apps/web/app/test-runs/components/AbortTestRunButton.tsx`
- Modify: `apps/web/app/test-runs/components/index.ts`

- [ ] **Step 1: Create the component**

  Create `apps/web/app/test-runs/components/AbortTestRunButton.tsx`:
  ```tsx
  'use client';

  import { useState } from 'react';
  import {
    Button,
    IconButton,
    Tooltip,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
  } from '@mui/material';
  import { Stop } from '@mui/icons-material';
  import { TestRun } from '@/types/test-runs';
  import { authenticatedFetch } from '@/lib/api';

  interface AbortTestRunButtonProps {
    testRun: TestRun;
    onAborted: () => void;
    showToast: (message: string) => void;
    variant?: 'icon' | 'button';
  }

  export function AbortTestRunButton({ testRun, onAborted, showToast, variant = 'icon' }: AbortTestRunButtonProps) {
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    if (testRun.completed || testRun.abort) return null;

    const handleAbort = async () => {
      setLoading(true);
      try {
        const response = await authenticatedFetch(`/test-runs/${testRun.id}/abort`, { method: 'PATCH' });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error((data as { message?: string }).message || 'Failed to abort test run');
        }
        showToast('Test run aborted successfully');
        onAborted();
      } catch (err) {
        const msg = err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to abort test run';
        showToast(msg);
      } finally {
        setLoading(false);
        setConfirmOpen(false);
      }
    };

    const trigger = variant === 'button' ? (
      <Button
        variant="outlined"
        color="error"
        size="small"
        startIcon={<Stop />}
        onClick={() => setConfirmOpen(true)}
        disabled={loading}
      >
        Abort
      </Button>
    ) : (
      <Tooltip title="Abort test run">
        <IconButton
          size="small"
          color="error"
          onClick={(e) => { e.stopPropagation(); setConfirmOpen(true); }}
          disabled={loading}
          aria-label="abort test run"
        >
          <Stop />
        </IconButton>
      </Tooltip>
    );

    return (
      <>
        {trigger}
        <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
          <DialogTitle>Abort Test Run</DialogTitle>
          <DialogContent>
            <DialogContentText>
              {`Are you sure you want to abort "${testRun.test_run_id}"? This will signal the running test to stop.`}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmOpen(false)} disabled={loading}>Cancel</Button>
            <Button onClick={handleAbort} color="error" variant="contained" disabled={loading}>
              Abort
            </Button>
          </DialogActions>
        </Dialog>
      </>
    );
  }
  ```

- [ ] **Step 2: Add to barrel export**

  In `apps/web/app/test-runs/components/index.ts`, add at the end:
  ```ts
  export { AbortTestRunButton } from './AbortTestRunButton';
  ```

- [ ] **Step 3: Type-check the frontend**

  ```bash
  cd apps/web && npx tsc --noEmit 2>&1 | head -30
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/web/app/test-runs/components/AbortTestRunButton.tsx \
          apps/web/app/test-runs/components/index.ts
  git commit -m "feat(test-runs): add AbortTestRunButton component"
  ```

---

### Task 5: Wire abort button into running test list

**Files:**
- Modify: `apps/web/app/test-runs/components/TestRunsTable.tsx`
- Modify: `apps/web/app/test-runs/page.tsx`

- [ ] **Step 1: Add `showToast` and `onRefresh` props to `TestRunsTable`**

  In `apps/web/app/test-runs/components/TestRunsTable.tsx`:

  Add to `TestRunsTableProps` interface (after `pageLoading?: boolean`):
  ```ts
  showToast?: (message: string) => void;
  onRefresh?: () => void;
  ```

  Add to the destructured props in the function signature:
  ```ts
  showToast,
  onRefresh,
  ```

- [ ] **Step 2: Add `AbortTestRunButton` import**

  In the existing imports at the top of `TestRunsTable.tsx`, add `AbortTestRunButton` to the local component import:
  ```ts
  import {
    TestRunStatusChip,
    ProgressBar,
    ResultStatusIcon,
    AbortTestRunButton,
  } from './index';
  ```

- [ ] **Step 3: Add `actions` column to `runningColumns`**

  In the `runningColumns` `useMemo`, add an `actions` column at the end of the `allColumns` array (just before the closing bracket of the array), after the `progress` column:
  ```ts
  {
    field: 'actions',
    headerName: '',
    width: 60,
    sortable: false,
    disableColumnMenu: true,
    renderCell: (params) => (
      <AbortTestRunButton
        testRun={params.row}
        onAborted={onRefresh ?? (() => {})}
        showToast={showToast ?? (() => {})}
        variant="icon"
      />
    ),
  },
  ```

  Also add `showToast` and `onRefresh` to the `useMemo` dependency array (they are stable function refs from the page):
  ```ts
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemFilter, environmentFilter, workloadFilter, currentTime, showToast, onRefresh]);
  ```

- [ ] **Step 4: Pass `showToast` and `onRefresh` from the page**

  In `apps/web/app/test-runs/page.tsx`, find the running `TestRunsTable` invocation:
  ```tsx
  <TestRunsTable
    testRuns={runningTestRuns}
    selectedTestRunIds={selectedTestRunIds}
    currentTime={currentTime}
    systemFilter={systemFilter}
    environmentFilter={environmentFilter}
    workloadFilter={workloadFilter}
    variant="running"
    onSelectAll={() => handleSelectAll(testRuns)}
    onSelectOne={handleSelectOne}
  />
  ```

  Change it to:
  ```tsx
  <TestRunsTable
    testRuns={runningTestRuns}
    selectedTestRunIds={selectedTestRunIds}
    currentTime={currentTime}
    systemFilter={systemFilter}
    environmentFilter={environmentFilter}
    workloadFilter={workloadFilter}
    variant="running"
    onSelectAll={() => handleSelectAll(testRuns)}
    onSelectOne={handleSelectOne}
    showToast={(msg) => handleSnackbar({ open: true, message: msg })}
    onRefresh={loadTestRuns}
  />
  ```

- [ ] **Step 5: Type-check the frontend**

  ```bash
  cd apps/web && npx tsc --noEmit 2>&1 | head -30
  ```
  Expected: no errors.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/web/app/test-runs/components/TestRunsTable.tsx \
          apps/web/app/test-runs/page.tsx
  git commit -m "feat(test-runs): add abort button to running test list rows"
  ```

---

### Task 6: Wire abort button into test run detail header

**Files:**
- Modify: `apps/web/app/test-runs/[id]/components/header/TestRunHeader.tsx`

- [ ] **Step 1: Import `AbortTestRunButton`**

  In `apps/web/app/test-runs/[id]/components/header/TestRunHeader.tsx`, add to the imports:
  ```ts
  import { AbortTestRunButton } from '../../components/AbortTestRunButton';
  ```

- [ ] **Step 2: Add `AbortTestRunButton` to the header actions area**

  Find the JSX block that renders `TestRunActionsMenu`:
  ```tsx
  {testRun && (
    <>
      <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />
      <TestRunActionsMenu
        testRun={testRun}
        onSuccess={onSuccess}
        onError={onError}
        onRefresh={onRefresh}
        onDeleted={() => router.push('/test-runs')}
        onJobTriggered={onJobTriggered}
      />
    </>
  )}
  ```

  Change it to:
  ```tsx
  {testRun && (
    <>
      <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />
      <AbortTestRunButton
        testRun={testRun}
        onAborted={onRefresh ?? (() => {})}
        showToast={onSuccess ?? (() => {})}
        variant="button"
      />
      <TestRunActionsMenu
        testRun={testRun}
        onSuccess={onSuccess}
        onError={onError}
        onRefresh={onRefresh}
        onDeleted={() => router.push('/test-runs')}
        onJobTriggered={onJobTriggered}
      />
    </>
  )}
  ```

  The component renders nothing when `testRun.completed || testRun.abort`, so no conditional wrapper is needed.

- [ ] **Step 3: Type-check the frontend**

  ```bash
  cd apps/web && npx tsc --noEmit 2>&1 | head -30
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/web/app/test-runs/\[id\]/components/header/TestRunHeader.tsx
  git commit -m "feat(test-runs): add abort button to test run detail header"
  ```

---

### Task 7: Run full test suite and preflight

- [ ] **Step 1: Run API tests**

  ```bash
  cd apps/api && npx jest --no-coverage 2>&1 | tail -20
  ```
  Expected: all tests pass.

- [ ] **Step 2: Run preflight**

  ```bash
  npm run preflight 2>&1 | tail -30
  ```
  Expected: lint + type-check pass with no errors.
