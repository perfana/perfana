# Abort Running Test — Design Spec

**Date**: 2026-05-17  
**Status**: Approved

## Overview

Add an "Abort" button that allows users to manually signal a running test to stop. The action sets `test_run.abort = true` and `test_run.abortMessage = "Aborted manually by <user>"`, is protected by a confirm dialog, and produces an audit log event.

## Context

The `TestRun` entity already has `abort: boolean` and `abortMessage: string` (DB column `abort_message`). No migration is required. The existing `POST /test` endpoint is designed for load test agent traffic and is not appropriate for UI-driven abort actions — a dedicated endpoint is needed.

## Backend

### New endpoint: `PATCH /test-runs/:id/abort`

- **File**: `apps/api/src/modules/test-runs/controllers/test-runs.controller.ts`
- **Auth**: existing `KeycloakEnhancedAuthGuard` (already applied module-wide)
- **Path param**: `:id` — the UUID primary key of the test run
- **Request body**: none
- **Response**: the updated `TestRun` entity

**Logic** (in new `abortTestRun` method in `test-runs-mutation.service.ts`):
1. Load the test run by UUID, verify access via `verifyTestRunAccess(id, userId, roles)`
2. If `testRun.completed === true`: throw `BadRequestException('Test run is already completed')`
3. If `testRun.abort === true`: throw `BadRequestException('Test run is already aborted')`
4. Capture `before` snapshot
5. Set `abort = true`, `abortMessage = "Aborted manually by <email ?? userId>"`
6. Save and return updated entity
7. Call `auditService.logUpdate(before, after)` — TestRun is already registered as `'test-runs'` in the audit registry

### User identity in the message

`UserContext.email` is populated for Keycloak JWT auth; `UserContext.userId` is always present (Keycloak sub or `api-key:{id}`). The message uses `ctx.email ?? ctx.userId`.

## Frontend

### New component: `AbortTestRunButton`

- **File**: `apps/web/app/test-runs/components/AbortTestRunButton.tsx`
- **Props**:
  ```ts
  interface AbortTestRunButtonProps {
    testRun: TestRun;
    onAborted: () => void;
    showToast: (message: string) => void;
    variant?: 'icon' | 'button'; // icon = table row, button = detail header
  }
  ```
- **Render condition**: only when `!testRun.completed && !testRun.abort`
- **Icon variant** (list row): small `IconButton` with `Stop` icon, color `error`, tooltip "Abort test run"
- **Button variant** (detail header): outlined `Button` with `Stop` icon, color `error`, label "Abort"
- **On click**: opens MUI `Dialog` confirm:
  - Title: "Abort Test Run"
  - Body: `Are you sure you want to abort "${testRun.test_run_id}"? This will signal the running test to stop.`
  - Actions: Cancel | Abort (contained, error color)
- **On confirm**: `PATCH /test-runs/<testRun.id>/abort` via `authenticatedFetch`, then calls `onAborted()` and shows toast
- **Error handling**: shows toast with error message, does not call `onAborted()`

### Running list (TestRunsTable, variant='running')

- Add `actions` column to `runningColumns` array (right-most position)
- `width: 60`, `sortable: false`, no header label
- Renders `<AbortTestRunButton variant="icon" testRun={row} onAborted={onRefresh} showToast={showToast} />`
- Thread `showToast` and `onRefresh` props down from `TestRunsTableProps`

### Test run detail header (TestRunHeader)

- Add `<AbortTestRunButton variant="button" testRun={testRun} onAborted={onRefresh} showToast={onSuccess} />` alongside existing buttons
- Visible only when `!testRun.completed && !testRun.abort` (handled internally by the component)

## Audit event

The `TestRun` entity is already registered in the audit registry (`'test-runs'`). Calling `auditService.logUpdate(before, after)` in the service will produce a diff-based audit log showing `abort: false → true` and `abortMessage: null → "Aborted manually by …"`.

## Error states

| Condition | HTTP status | Frontend behaviour |
|---|---|---|
| Test run not found | 404 | Toast: "Test run not found" |
| Already completed | 400 | Toast: "Test run is already completed" |
| Already aborted | 400 | Toast: "Test run is already aborted" |
| No access | 403 | Toast: "Not authorized" |

## Out of scope

- Worker-side abort propagation (the `abort` flag signals the agent; the agent's own poll-and-stop logic is pre-existing)
- Abort from the batch actions toolbar (only applies to running tests; toolbar is for completed tests)
