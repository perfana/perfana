# Job Progress Indicator System

This directory contains the frontend implementation of the job progress tracking system (Phase 4).

## Overview

The job progress indicator system provides real-time feedback to users about background jobs (analyze, refresh, re-evaluate) running for test runs. It uses WebSocket events for real-time updates and falls back to polling when WebSocket is unavailable.

## Components

### `useJobProgress` Hook

Located at: `/apps/web/hooks/useJobProgress.ts`

**Purpose**: React hook that tracks job progress via WebSocket events and REST API fallback.

**Features**:
- Real-time progress updates via Socket.IO
- Polling fallback when WebSocket unavailable
- Loading states and error handling
- Completion/failure callbacks
- Job blocking detection

**Usage**:
```typescript
import { useJobProgress } from '@/hooks/useJobProgress';

const { progress, isRunning, isBlocked, blockingInfo, error, loading } = useJobProgress({
  testRunId: 'my-test-run-id',
  systemUnderTestId: 'my-system-id',
  testEnvironment: 'production',
  workload: 'load-test',
  onCompleted: () => console.log('Job completed!'),
  onFailed: (error) => console.error('Job failed:', error),
});
```

**Options**:
- `testRunId` (optional): Filter by test run ID
- `systemUnderTestId` (optional): Filter by system under test ID
- `testEnvironment` (optional): Filter by test environment
- `workload` (optional): Filter by workload
- `onCompleted` (optional): Callback when job completes
- `onFailed` (optional): Callback when job fails
- `enablePolling` (optional): Enable polling fallback (default: true)
- `pollingInterval` (optional): Polling interval in ms (default: 3000)

**Return Value**:
- `progress`: Current job progress object (null if no active job)
- `isRunning`: Whether a job is currently running
- `isBlocked`: Whether the job is blocked by another job
- `blockingInfo`: Information about the blocking job
- `error`: Error message if job failed
- `loading`: Whether the hook is loading initial data

### `JobProgressIndicator` Component

Located at: `/apps/web/components/job-progress/JobProgressIndicator.tsx`

**Purpose**: Material-UI component that displays job progress with stage information and progress bar.

**Variants**:

1. **Compact** (for list views):
   - Progress bar with percentage
   - Tooltip with full details
   - Minimal space usage

2. **Detailed** (for detail views):
   - Full stage breakdown
   - Job type label
   - Elapsed time chip
   - Progress bar with percentage
   - Stage information
   - Progress message

**Usage**:
```typescript
import { JobProgressIndicator } from '@/components/job-progress';

// Compact variant (list view)
<JobProgressIndicator
  testRunId={testRun.test_run_id}
  systemUnderTestId={testRun.system_under_test_id}
  testEnvironment={testRun.test_environment}
  workload={testRun.workload}
  variant="compact"
/>

// Detailed variant (detail view)
<JobProgressIndicator
  testRunId={testRun.test_run_id}
  systemUnderTestId={testRun.system_under_test_id}
  testEnvironment={testRun.test_environment}
  workload={testRun.workload}
  variant="detailed"
  onCompleted={refreshData}
  onFailed={(error) => showToast(`Job failed: ${error}`)}
/>
```

**Props**:
- `testRunId` (optional): Filter by test run ID
- `systemUnderTestId` (optional): Filter by system under test ID
- `testEnvironment` (optional): Filter by test environment
- `workload` (optional): Filter by workload
- `variant` (optional): Display variant ('compact' | 'detailed', default: 'detailed')
- `onCompleted` (optional): Callback when job completes
- `onFailed` (optional): Callback when job fails

## Integration Points

### 1. Test Runs List Page

**File**: `/apps/web/app/test-runs/page.tsx`

**Integration**: The compact progress indicator replaces the generic CircularProgress in the "Running Tests" section's progress column.

**Behavior**:
- Shows job progress if a job is active for the test run's scope
- Falls back to test run progress bar if no job is active
- Updates in real-time via WebSocket

### 2. Test Run Details Page

**File**: `/apps/web/app/test-runs/[id]/page.tsx`

**Integration**: A prominent progress banner appears at the top of the page when a job is active.

**Behavior**:
- Shows detailed progress with stage breakdown
- Auto-refreshes page data when job completes
- Displays error toast if job fails
- Automatically hides when no job is active

### 3. TestRunActionsMenu

**File**: `/apps/web/app/test-runs/[id]/components/header/TestRunActionsMenu.tsx`

**Integration**: Menu items are disabled when a job is running, with helpful tooltips explaining why.

**Features**:
- Checks for active jobs using `useJobProgress` hook
- Disables "Re-evaluate" and "Refresh" buttons when blocked
- Shows tooltip with current job progress (e.g., "Job in progress: Statistics calculation - 67%")
- Handles 409 Conflict responses gracefully with user-friendly message
- Prevents users from starting conflicting jobs

**Behavior**:
```typescript
// Menu items are disabled when isRunning or isBlocked is true
<MenuItem
  onClick={handleReEvaluate}
  disabled={isLoading || isRunning || isBlocked}
>
  Re-evaluate
</MenuItem>

// Tooltip shows progress or blocking info
<Tooltip
  title={
    isRunning && progress
      ? `Job in progress: ${progress.stageName} - ${progress.overallProgress}%`
      : isBlocked && blockingInfo
      ? blockingInfo.reason || 'Blocked by another job'
      : ''
  }
>
```

## WebSocket Events

The system subscribes to the following Socket.IO events:

- `job:progress` - Real-time progress updates
- `job:completed` - Job completion notification
- `job:failed` - Job failure notification
- `job:blocked` - Job blocking notification
- `job:stuck` - Stuck job detection

### `job:completed` is terminal (contract for producers)

On `job:completed`, `useJobProgress` clears `progress` and adds the job id to
`completedJobsRef` for 30 seconds, which makes the hook ignore both later `job:progress` events
and stale polling responses for that job. This exists to stop the polling fallback resurrecting a
finished job — but it means **any stage a worker reports after publishing the terminal event is
silently dropped**.

`job:failed` clears `progress` too but does *not* populate `completedJobsRef`, so later progress
events for a failed job are still accepted. Treat that as incidental rather than a guarantee.

Workers that do more work after their orchestrator returns must therefore publish `complete()` /
`fail()` last. `analyzeTestWorker` passes `finalizeProgress: false` to
`PipelineOrchestrator.executeSequentialPipeline` and publishes the terminal event itself once the
data sanity check has run; before v0.2.74.0 it did not, and the progress bar's final frame was
"Stage 10 of 11 — 91%" with the sanity stage never appearing.

## REST API Endpoints

Fallback polling uses these endpoints:

- `GET /data/jobs/active/:systemId/:env/:workload` - Get active job for scope
- `GET /data/jobs/:jobId/progress` - Get progress for specific job

## Error Handling

### 409 Conflict Response

When a user tries to start a job while another is running:

```json
{
  "statusCode": 409,
  "message": "Another job is already running for this scope: analyze job in progress (Statistics calculation - 67%)",
  "blocked": true,
  "existingJobId": "12345",
  "existingJobProgress": { ... }
}
```

The UI displays a user-friendly error message and prevents the action.

### Job Failures

When a job fails, the `onFailed` callback is triggered with the error message, allowing the parent component to display appropriate feedback.

## Design Patterns

### Safe Error Handling

All error handling follows the project's safe error checking pattern:

```typescript
catch (err) {
  setError(
    err && typeof err === 'object' && 'message' in err
      ? (err as Error).message
      : 'Default error message'
  );
}
```

### Authentication

All API calls use `authenticatedFetch` from `/apps/web/lib/api.ts` for automatic authentication header injection.

### Material-UI Styling

Components follow the project's Material-UI styling standards:
- Theme spacing units
- Theme palette colors
- Responsive design with breakpoints
- Accessibility with ARIA labels

## Future Enhancements

Potential improvements for future iterations:

1. **Progress History**: Show historical job progress for completed jobs
2. **Job Cancellation**: Allow users to cancel running jobs
3. **Priority Queue**: Display queue position when job is waiting
4. **Estimated Time Remaining**: Calculate and show ETA based on stage progress
5. **Notifications**: Browser notifications for job completion/failure

## Dependencies

### External
- `@mui/material` - Material-UI components
- `socket.io-client` - WebSocket client
- `@perfana/shared/types` - Shared TypeScript types

### Internal
- `/apps/web/lib/socket.ts` - Socket.IO connection manager
- `/apps/web/lib/api.ts` - Authenticated fetch wrapper
- `/apps/web/hooks/useJobProgress.ts` - Job progress hook

## Testing Considerations

When testing this system:

1. Test WebSocket connection failure scenarios
2. Test polling fallback behavior
3. Test job blocking scenarios (409 responses)
4. Test real-time updates with multiple concurrent jobs
5. Test error handling for failed jobs
6. Test UI responsiveness during long-running jobs
7. Test accessibility (keyboard navigation, screen readers)

## Troubleshooting

### Progress not updating

1. Check WebSocket connection status (see browser console)
2. Verify polling is enabled (`enablePolling: true`)
3. Check API endpoint availability
4. Verify scope parameters match (system/environment/workload)

### Actions not blocked

1. Verify `useJobProgress` hook is called in TestRunActionsMenu
2. Check that `isRunning` or `isBlocked` flags are true
3. Verify scope parameters are correctly passed

### Tooltips not showing

1. Ensure menu items are wrapped in `<Tooltip>` and `<span>`
2. Verify `progress` or `blockingInfo` data is available
3. Check Material-UI theme configuration
