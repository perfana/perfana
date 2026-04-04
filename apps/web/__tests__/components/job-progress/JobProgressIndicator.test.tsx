/**
 * Unit tests for JobProgressIndicator Component
 *
 * Tests the component's rendering across all variants and states:
 * - Compact, Detailed, and Modal variants
 * - Active, completed, failed, stuck, and blocked job states
 * - Progress bar and percentage display
 * - Stage/step information rendering
 * - Elapsed time display
 * - Stuck job indicator with release lock action
 * - Blocked job indicator with dismiss and release lock actions
 * - Callback invocations (onCompleted, onFailed, onLockReleased)
 * - Null/empty state rendering (returns null when no active job)
 * - Edge cases: unknown job type, zero progress, 100% progress
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { JobProgressIndicator } from '@/components/job-progress/JobProgressIndicator';
import type { JobProgress, JobBlockedInfo, JobLockInfo } from '@perfana/shared/types';

// ---------------------------------------------------------------------------
// Mock the useJobProgress hook entirely so we can control all hook state.
// This isolates the component rendering logic from WebSocket / polling code.
// ---------------------------------------------------------------------------

const mockReleaseLock = jest.fn();

// Default return value — "no active job" state
const defaultHookReturn = {
  progress: null,
  isRunning: false,
  isBlocked: false,
  isStuck: false,
  blockingInfo: null,
  lockInfo: null,
  error: null,
  loading: false,
  releaseLock: mockReleaseLock,
};

// Mutable ref that each test can override via setHookState()
let currentHookState = { ...defaultHookReturn };

jest.mock('@/hooks/useJobProgress', () => ({
  useJobProgress: jest.fn(() => currentHookState),
}));

// Mock socket.io-client to avoid real network connections (hook imports it)
jest.mock('socket.io-client', () => ({
  io: jest.fn(() => ({
    on: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  })),
}));

// Mock keycloak-js
jest.mock('keycloak-js', () =>
  jest.fn(() => ({
    init: jest.fn().mockResolvedValue(true),
    login: jest.fn(),
    logout: jest.fn(),
    updateToken: jest.fn().mockResolvedValue(true),
    hasRealmRole: jest.fn().mockReturnValue(false),
    createAccountUrl: jest.fn().mockReturnValue(''),
    token: 'mock-token',
    refreshToken: 'mock-refresh-token',
    authenticated: true,
    subject: 'user-123',
    tokenParsed: { sub: 'user-123', email: 'test@example.com' },
  }))
);

// Mock authenticatedFetch (used by the hook internally)
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Override the hook return value for a specific test */
function setHookState(overrides: Partial<typeof defaultHookReturn>) {
  currentHookState = { ...defaultHookReturn, ...overrides };
  // Also update the mock implementation so any re-render picks up the new state
  const { useJobProgress } = jest.requireMock('@/hooks/useJobProgress');
  (useJobProgress as jest.Mock).mockImplementation(() => currentHookState);
}

/** Build a realistic JobProgress object for use in tests */
function makeProgress(overrides: Partial<JobProgress> = {}): JobProgress {
  return {
    jobId: 'job-abc-123',
    testRunId: 'test-run-001',
    systemUnderTestId: 'system-123',
    testEnvironment: 'production',
    workload: 'load-test-1',
    jobType: 'analyze',
    stage: 'statistics-calculation',
    stageName: 'Statistics calculation',
    stageIndex: 3,
    totalStages: 9,
    stageProgress: 43,
    overallProgress: 30,
    message: 'Statistics calculation - 30%',
    startedAt: new Date(Date.now() - 62000).toISOString(), // 62 seconds ago
    lastProgressAt: new Date().toISOString(),
    status: 'active',
    ...overrides,
  };
}

/** Build a realistic JobBlockedInfo object */
function makeBlockingInfo(overrides: Partial<JobBlockedInfo> = {}): JobBlockedInfo {
  return {
    blocked: true,
    reason: 'Another job is already processing this scope.',
    existingJobId: 'job-existing-456',
    existingJobProgress: makeProgress({ jobId: 'job-existing-456', jobType: 'refresh' }),
    scopeKey: 'job:lock:system-123:production:load-test-1',
    ...overrides,
  };
}

/** Build a JobLockInfo object */
function makeLockInfo(overrides: Partial<JobLockInfo> = {}): JobLockInfo {
  return {
    locked: true,
    jobId: 'job-existing-456',
    testRunId: 'test-run-001',
    jobType: 'refresh',
    acquiredAt: new Date(Date.now() - 30000).toISOString(),
    expiresAt: new Date(Date.now() + 270000).toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('JobProgressIndicator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReleaseLock.mockResolvedValue({ success: true, message: 'Lock released' });
    setHookState(defaultHookReturn);
  });

  // -------------------------------------------------------------------------
  // Null / empty state
  // -------------------------------------------------------------------------

  describe('Null / empty state', () => {
    it('should render nothing when there is no active job', () => {
      const { container } = render(
        <JobProgressIndicator systemUnderTestId="system-123" testEnvironment="production" workload="load-test-1" />
      );
      expect(container.firstChild).toBeNull();
    });

    it('should render nothing when progress is null and isRunning is false', () => {
      setHookState({ progress: null, isRunning: false });
      const { container } = render(
        <JobProgressIndicator testRunId="test-run-001" />
      );
      expect(container.firstChild).toBeNull();
    });

    it('should render nothing when there is an error and job is not stuck', () => {
      // error without stuck = return null (error display is delegated to parent)
      setHookState({
        progress: makeProgress({ status: 'failed' }),
        isRunning: true,
        error: 'Something went wrong',
        isStuck: false,
      });
      const { container } = render(
        <JobProgressIndicator testRunId="test-run-001" />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Compact variant
  // -------------------------------------------------------------------------

  describe('Compact variant', () => {
    const activeProgress = makeProgress({ overallProgress: 45 });

    beforeEach(() => {
      setHookState({ progress: activeProgress, isRunning: true });
    });

    it('should render a LinearProgress bar', () => {
      const { container } = render(
        <JobProgressIndicator
          testRunId="test-run-001"
          variant="compact"
        />
      );
      expect(container.querySelector('.MuiLinearProgress-root')).toBeInTheDocument();
    });

    it('should display the percentage rounded to nearest integer', () => {
      render(
        <JobProgressIndicator
          testRunId="test-run-001"
          variant="compact"
        />
      );
      expect(screen.getByText('45%')).toBeInTheDocument();
    });

    it('should display 0% when overallProgress is 0', () => {
      setHookState({ progress: makeProgress({ overallProgress: 0 }), isRunning: true });
      render(<JobProgressIndicator testRunId="test-run-001" variant="compact" />);
      expect(screen.getByText('0%')).toBeInTheDocument();
    });

    it('should display 100% when overallProgress is 100', () => {
      setHookState({ progress: makeProgress({ overallProgress: 100, status: 'completed' }), isRunning: true });
      render(<JobProgressIndicator testRunId="test-run-001" variant="compact" />);
      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('should round fractional percentages', () => {
      setHookState({ progress: makeProgress({ overallProgress: 33.6 }), isRunning: true });
      render(<JobProgressIndicator testRunId="test-run-001" variant="compact" />);
      expect(screen.getByText('34%')).toBeInTheDocument();
    });

    it('should not render the stuck indicator for compact variant', () => {
      setHookState({
        progress: makeProgress({ status: 'stuck' }),
        isRunning: false,
        isStuck: true,
      });
      // Compact variant does NOT show stuck/blocked sub-components
      const { container } = render(
        <JobProgressIndicator testRunId="test-run-001" variant="compact" />
      );
      expect(screen.queryByText('Job Appears Stuck')).not.toBeInTheDocument();
      // It still renders the compact bar because isRunning might be false — expect null
      expect(container.firstChild).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Detailed variant
  // -------------------------------------------------------------------------

  describe('Detailed variant', () => {
    const activeProgress = makeProgress();

    beforeEach(() => {
      setHookState({ progress: activeProgress, isRunning: true });
    });

    it('should render "Analyzing Test Run" title for analyze job type', () => {
      render(
        <JobProgressIndicator
          testRunId="test-run-001"
          variant="detailed"
        />
      );
      expect(screen.getByText('Analyzing Test Run')).toBeInTheDocument();
    });

    it('should render "Refreshing Data" title for refresh job type', () => {
      setHookState({ progress: makeProgress({ jobType: 'refresh' }), isRunning: true });
      render(<JobProgressIndicator testRunId="test-run-001" variant="detailed" />);
      expect(screen.getByText('Refreshing Data')).toBeInTheDocument();
    });

    it('should render "Re-evaluating Test Run" title for reevaluate job type', () => {
      setHookState({ progress: makeProgress({ jobType: 'reevaluate' }), isRunning: true });
      render(<JobProgressIndicator testRunId="test-run-001" variant="detailed" />);
      expect(screen.getByText('Re-evaluating Test Run')).toBeInTheDocument();
    });

    it('should display stage index and total stages', () => {
      render(
        <JobProgressIndicator
          testRunId="test-run-001"
          variant="detailed"
        />
      );
      expect(screen.getByText(/Stage 3 of 9/)).toBeInTheDocument();
    });

    it('should display the stage name', () => {
      render(
        <JobProgressIndicator
          testRunId="test-run-001"
          variant="detailed"
        />
      );
      // Multiple elements may contain "Statistics calculation" (stage row + message).
      // We only need at least one match.
      expect(screen.getAllByText(/Statistics calculation/).length).toBeGreaterThanOrEqual(1);
    });

    it('should display the progress message', () => {
      render(
        <JobProgressIndicator
          testRunId="test-run-001"
          variant="detailed"
        />
      );
      expect(screen.getByText('Statistics calculation - 30%')).toBeInTheDocument();
    });

    it('should display the overall percentage', () => {
      render(
        <JobProgressIndicator
          testRunId="test-run-001"
          variant="detailed"
        />
      );
      expect(screen.getByText('30%')).toBeInTheDocument();
    });

    it('should display elapsed time chip', () => {
      render(
        <JobProgressIndicator
          testRunId="test-run-001"
          variant="detailed"
        />
      );
      // startedAt is 62s ago → "1m 2s" format
      expect(screen.getByText(/Elapsed:/)).toBeInTheDocument();
    });

    it('should render a LinearProgress bar', () => {
      const { container } = render(
        <JobProgressIndicator testRunId="test-run-001" variant="detailed" />
      );
      expect(container.querySelector('.MuiLinearProgress-root')).toBeInTheDocument();
    });

    it('should render Paper wrapper with elevated styling', () => {
      const { container } = render(
        <JobProgressIndicator testRunId="test-run-001" variant="detailed" />
      );
      expect(container.querySelector('.MuiPaper-root')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Modal variant (default)
  // -------------------------------------------------------------------------

  describe('Modal variant (default)', () => {
    const activeProgress = makeProgress({ overallProgress: 55 });

    beforeEach(() => {
      setHookState({ progress: activeProgress, isRunning: true });
    });

    it('should render a Dialog element', () => {
      render(<JobProgressIndicator testRunId="test-run-001" />);
      // MUI Dialog renders a role="dialog"
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should render the circular progress percentage', () => {
      render(<JobProgressIndicator testRunId="test-run-001" />);
      expect(screen.getByText('55%')).toBeInTheDocument();
    });

    it('should render "Analyzing Test Run" for analyze job type', () => {
      render(<JobProgressIndicator testRunId="test-run-001" />);
      expect(screen.getAllByText('Analyzing Test Run').length).toBeGreaterThanOrEqual(1);
    });

    it('should render "Refreshing Data" for refresh job type', () => {
      setHookState({ progress: makeProgress({ jobType: 'refresh' }), isRunning: true });
      render(<JobProgressIndicator testRunId="test-run-001" />);
      expect(screen.getAllByText('Refreshing Data').length).toBeGreaterThanOrEqual(1);
    });

    it('should render "Re-evaluating Test Run" for reevaluate job type', () => {
      setHookState({ progress: makeProgress({ jobType: 'reevaluate' }), isRunning: true });
      render(<JobProgressIndicator testRunId="test-run-001" />);
      expect(screen.getAllByText('Re-evaluating Test Run').length).toBeGreaterThanOrEqual(1);
    });

    it('should render "Processing" for an unknown job type', () => {
      // Force an unknown job type by casting
      setHookState({
        progress: makeProgress({ jobType: 'unknown' as 'analyze' }),
        isRunning: true,
      });
      render(<JobProgressIndicator testRunId="test-run-001" />);
      expect(screen.getAllByText('Processing').length).toBeGreaterThanOrEqual(1);
    });

    it('should render stage index and total stages', () => {
      render(<JobProgressIndicator testRunId="test-run-001" />);
      expect(screen.getByText(/Stage 3 of 9/)).toBeInTheDocument();
    });

    it('should render stage name', () => {
      render(<JobProgressIndicator testRunId="test-run-001" />);
      expect(screen.getByText('Statistics calculation')).toBeInTheDocument();
    });

    it('should render elapsed time chip', () => {
      render(<JobProgressIndicator testRunId="test-run-001" />);
      expect(screen.getByText(/Elapsed:/)).toBeInTheDocument();
    });

    it('should render a LinearProgress bar inside the dialog', () => {
      // MUI Dialog renders in a portal outside the React root container,
      // so we query the global document body instead.
      render(<JobProgressIndicator testRunId="test-run-001" />);
      expect(document.querySelector('.MuiLinearProgress-root')).toBeInTheDocument();
    });

    it('should use modal variant when no variant prop is given', () => {
      render(<JobProgressIndicator testRunId="test-run-001" />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Stuck job indicator
  // -------------------------------------------------------------------------

  describe('Stuck job indicator', () => {
    it('should render the stuck indicator for detailed variant when job is stuck', () => {
      setHookState({
        progress: makeProgress({ status: 'stuck' }),
        isRunning: false,
        isStuck: true,
      });
      render(
        <JobProgressIndicator
          testRunId="test-run-001"
          variant="detailed"
        />
      );
      expect(screen.getByText('Job Appears Stuck')).toBeInTheDocument();
    });

    it('should render the stuck indicator for modal variant when job is stuck', () => {
      setHookState({
        progress: makeProgress({ status: 'stuck' }),
        isRunning: false,
        isStuck: true,
      });
      render(
        <JobProgressIndicator testRunId="test-run-001" variant="modal" />
      );
      expect(screen.getByText('Job Appears Stuck')).toBeInTheDocument();
    });

    it('should show last known stage in stuck indicator', () => {
      setHookState({
        progress: makeProgress({ stageName: 'ADAPT analysis', stageIndex: 7, totalStages: 9, overallProgress: 70 }),
        isRunning: false,
        isStuck: true,
      });
      render(
        <JobProgressIndicator testRunId="test-run-001" variant="detailed" />
      );
      expect(screen.getByText(/ADAPT analysis/)).toBeInTheDocument();
      expect(screen.getByText(/70%/)).toBeInTheDocument();
    });

    it('should show elapsed time in stuck indicator', () => {
      setHookState({
        progress: makeProgress(),
        isRunning: false,
        isStuck: true,
      });
      render(<JobProgressIndicator testRunId="test-run-001" variant="detailed" />);
      expect(screen.getByText(/Elapsed:/)).toBeInTheDocument();
    });

    it('should show "Manual Intervention Required" alert title', () => {
      setHookState({
        progress: makeProgress(),
        isRunning: false,
        isStuck: true,
      });
      render(<JobProgressIndicator testRunId="test-run-001" variant="detailed" />);
      expect(screen.getByText('Manual Intervention Required')).toBeInTheDocument();
    });

    it('should render "Release Lock" button in stuck indicator', () => {
      setHookState({
        progress: makeProgress(),
        isRunning: false,
        isStuck: true,
      });
      render(<JobProgressIndicator testRunId="test-run-001" variant="detailed" />);
      expect(screen.getByRole('button', { name: /release lock/i })).toBeInTheDocument();
    });

    it('should call releaseLock and trigger onLockReleased when Release Lock is clicked and succeeds', async () => {
      const onLockReleased = jest.fn();
      mockReleaseLock.mockResolvedValue({ success: true, message: 'Lock released' });

      setHookState({
        progress: makeProgress(),
        isRunning: false,
        isStuck: true,
      });

      render(
        <JobProgressIndicator
          testRunId="test-run-001"
          variant="detailed"
          onLockReleased={onLockReleased}
        />
      );

      const releaseButton = screen.getByRole('button', { name: /release lock/i });
      fireEvent.click(releaseButton);

      await waitFor(() => {
        expect(mockReleaseLock).toHaveBeenCalledTimes(1);
        expect(onLockReleased).toHaveBeenCalledTimes(1);
      });
    });

    it('should show "Releasing..." while lock release is in progress', async () => {
      // Mock releaseLock to hang indefinitely so we can observe the loading state
      let resolveRelease: (val: { success: boolean; message: string }) => void;
      const hangingPromise = new Promise<{ success: boolean; message: string }>((resolve) => {
        resolveRelease = resolve;
      });
      mockReleaseLock.mockReturnValue(hangingPromise);

      setHookState({ progress: makeProgress(), isRunning: false, isStuck: true });

      render(
        <JobProgressIndicator testRunId="test-run-001" variant="detailed" />
      );

      const releaseButton = screen.getByRole('button', { name: /release lock/i });
      fireEvent.click(releaseButton);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /releasing/i })).toBeDisabled();
      });

      // Clean up the hanging promise
      act(() => { resolveRelease!({ success: false, message: 'done' }); });
    });

    it('should not call onLockReleased when releaseLock returns success: false', async () => {
      const onLockReleased = jest.fn();
      mockReleaseLock.mockResolvedValue({ success: false, message: 'Cannot release' });

      setHookState({ progress: makeProgress(), isRunning: false, isStuck: true });

      render(
        <JobProgressIndicator
          testRunId="test-run-001"
          variant="detailed"
          onLockReleased={onLockReleased}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /release lock/i }));

      await waitFor(() => {
        expect(mockReleaseLock).toHaveBeenCalledTimes(1);
      });

      expect(onLockReleased).not.toHaveBeenCalled();
    });

    it('should render stuck indicator without progress info when progress is null', () => {
      setHookState({
        progress: null,
        isRunning: false,
        isStuck: true,
      });
      render(<JobProgressIndicator testRunId="test-run-001" variant="detailed" />);
      expect(screen.getByText('Job Appears Stuck')).toBeInTheDocument();
      // "Last known stage" section should not appear when progress is null
      expect(screen.queryByText(/Last known stage/)).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Blocked job indicator
  // -------------------------------------------------------------------------

  describe('Blocked job indicator', () => {
    const blockingInfo = makeBlockingInfo();
    const lockInfo = makeLockInfo();

    beforeEach(() => {
      setHookState({
        progress: null,
        isRunning: false,
        isBlocked: true,
        blockingInfo,
        lockInfo,
      });
    });

    it('should render "Job Blocked" header for detailed variant', () => {
      render(
        <JobProgressIndicator
          systemUnderTestId="system-123"
          testEnvironment="production"
          workload="load-test-1"
          variant="detailed"
        />
      );
      expect(screen.getByText('Job Blocked')).toBeInTheDocument();
    });

    it('should render "Job Blocked" header for modal variant', () => {
      render(
        <JobProgressIndicator
          systemUnderTestId="system-123"
          testEnvironment="production"
          workload="load-test-1"
          variant="modal"
        />
      );
      expect(screen.getByText('Job Blocked')).toBeInTheDocument();
    });

    it('should NOT render blocked indicator for compact variant', () => {
      const { container } = render(
        <JobProgressIndicator
          systemUnderTestId="system-123"
          testEnvironment="production"
          workload="load-test-1"
          variant="compact"
        />
      );
      expect(screen.queryByText('Job Blocked')).not.toBeInTheDocument();
      // compact with isBlocked and no isRunning should render nothing
      expect(container.firstChild).toBeNull();
    });

    it('should display the blocking reason', () => {
      render(
        <JobProgressIndicator
          systemUnderTestId="system-123"
          testEnvironment="production"
          workload="load-test-1"
          variant="detailed"
        />
      );
      expect(screen.getByText('Another job is already processing this scope.')).toBeInTheDocument();
    });

    it('should display the blocking job ID', () => {
      render(
        <JobProgressIndicator
          systemUnderTestId="system-123"
          testEnvironment="production"
          workload="load-test-1"
          variant="detailed"
        />
      );
      expect(screen.getByText(/job-existing-456/)).toBeInTheDocument();
    });

    it('should display the blocking job type', () => {
      render(
        <JobProgressIndicator
          systemUnderTestId="system-123"
          testEnvironment="production"
          workload="load-test-1"
          variant="detailed"
        />
      );
      expect(screen.getByText(/refresh/)).toBeInTheDocument();
    });

    it('should display the lock acquiredAt time', () => {
      render(
        <JobProgressIndicator
          systemUnderTestId="system-123"
          testEnvironment="production"
          workload="load-test-1"
          variant="detailed"
        />
      );
      expect(screen.getByText(/Started:/)).toBeInTheDocument();
    });

    it('should render "Release Lock" button in blocked indicator', () => {
      render(
        <JobProgressIndicator
          systemUnderTestId="system-123"
          testEnvironment="production"
          workload="load-test-1"
          variant="detailed"
        />
      );
      expect(screen.getByRole('button', { name: /release lock/i })).toBeInTheDocument();
    });

    it('should render a "Dismiss" button', () => {
      render(
        <JobProgressIndicator
          systemUnderTestId="system-123"
          testEnvironment="production"
          workload="load-test-1"
          variant="detailed"
        />
      );
      expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
    });

    it('should dismiss the blocked indicator when "Dismiss" is clicked', async () => {
      render(
        <JobProgressIndicator
          systemUnderTestId="system-123"
          testEnvironment="production"
          workload="load-test-1"
          variant="detailed"
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

      await waitFor(() => {
        expect(screen.queryByText('Job Blocked')).not.toBeInTheDocument();
      });
    });

    it('should re-show blocked indicator when isBlocked changes to true again after dismiss', async () => {
      const { rerender } = render(
        <JobProgressIndicator
          systemUnderTestId="system-123"
          testEnvironment="production"
          workload="load-test-1"
          variant="detailed"
        />
      );

      // Dismiss the indicator
      fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
      await waitFor(() => {
        expect(screen.queryByText('Job Blocked')).not.toBeInTheDocument();
      });

      // Simulate a new blocking event by updating hook state with a different blockingInfo
      const newBlockingInfo = makeBlockingInfo({ existingJobId: 'job-new-789' });
      setHookState({
        progress: null,
        isRunning: false,
        isBlocked: true,
        blockingInfo: newBlockingInfo,
        lockInfo,
      });

      rerender(
        <JobProgressIndicator
          systemUnderTestId="system-123"
          testEnvironment="production"
          workload="load-test-1"
          variant="detailed"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Job Blocked')).toBeInTheDocument();
      });
    });

    it('should call releaseLock and onLockReleased when Release Lock succeeds in blocked state', async () => {
      const onLockReleased = jest.fn();
      mockReleaseLock.mockResolvedValue({ success: true, message: 'Lock released' });

      render(
        <JobProgressIndicator
          systemUnderTestId="system-123"
          testEnvironment="production"
          workload="load-test-1"
          variant="detailed"
          onLockReleased={onLockReleased}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /release lock/i }));

      await waitFor(() => {
        expect(mockReleaseLock).toHaveBeenCalledTimes(1);
        expect(onLockReleased).toHaveBeenCalledTimes(1);
      });

      // Blocked indicator should be dismissed after successful release
      await waitFor(() => {
        expect(screen.queryByText('Job Blocked')).not.toBeInTheDocument();
      });
    });

    it('should render blocked indicator without lock details when lockInfo is null', () => {
      setHookState({
        progress: null,
        isRunning: false,
        isBlocked: true,
        blockingInfo,
        lockInfo: null,
      });
      render(
        <JobProgressIndicator
          systemUnderTestId="system-123"
          testEnvironment="production"
          workload="load-test-1"
          variant="detailed"
        />
      );
      expect(screen.getByText('Job Blocked')).toBeInTheDocument();
      expect(screen.queryByText(/Started:/)).not.toBeInTheDocument();
    });

    it('should render with default reason when blockingInfo has no reason', () => {
      setHookState({
        progress: null,
        isRunning: false,
        isBlocked: true,
        blockingInfo: makeBlockingInfo({ reason: undefined }),
        lockInfo: null,
      });
      render(
        <JobProgressIndicator
          systemUnderTestId="system-123"
          testEnvironment="production"
          workload="load-test-1"
          variant="detailed"
        />
      );
      expect(screen.getByText('Another job is already processing this scope.')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Progress bar color based on status
  // -------------------------------------------------------------------------

  describe('Progress bar color', () => {
    it('should use primary color for active status in detailed variant', () => {
      setHookState({ progress: makeProgress({ status: 'active' }), isRunning: true });
      const { container } = render(
        <JobProgressIndicator testRunId="test-run-001" variant="detailed" />
      );
      const bar = container.querySelector('.MuiLinearProgress-colorPrimary');
      expect(bar).toBeInTheDocument();
    });

    it('should use error color for failed status in detailed variant', () => {
      setHookState({
        progress: makeProgress({ status: 'failed', overallProgress: 50 }),
        isRunning: true,
      });
      const { container } = render(
        <JobProgressIndicator testRunId="test-run-001" variant="detailed" />
      );
      const bar = container.querySelector('.MuiLinearProgress-colorError');
      expect(bar).toBeInTheDocument();
    });

    it('should use warning color for stuck status in compact variant', () => {
      // For compact, we need isRunning: true so the compact bar renders
      setHookState({
        progress: makeProgress({ status: 'stuck', overallProgress: 40 }),
        isRunning: true,
      });
      const { container } = render(
        <JobProgressIndicator testRunId="test-run-001" variant="compact" />
      );
      const bar = container.querySelector('.MuiLinearProgress-colorWarning');
      expect(bar).toBeInTheDocument();
    });

    it('should use success color for completed status in compact variant', () => {
      setHookState({
        progress: makeProgress({ status: 'completed', overallProgress: 100 }),
        isRunning: true,
      });
      const { container } = render(
        <JobProgressIndicator testRunId="test-run-001" variant="compact" />
      );
      const bar = container.querySelector('.MuiLinearProgress-colorSuccess');
      expect(bar).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Elapsed time display
  // -------------------------------------------------------------------------

  describe('Elapsed time formatting', () => {
    it('should display seconds-only format for short elapsed time', () => {
      const progress = makeProgress({
        startedAt: new Date(Date.now() - 45000).toISOString(), // 45 seconds ago
      });
      setHookState({ progress, isRunning: true });
      render(<JobProgressIndicator testRunId="test-run-001" variant="detailed" />);
      expect(screen.getByText(/Elapsed: 45s/)).toBeInTheDocument();
    });

    it('should display minutes and seconds format', () => {
      const progress = makeProgress({
        startedAt: new Date(Date.now() - 125000).toISOString(), // 2m 5s ago
      });
      setHookState({ progress, isRunning: true });
      render(<JobProgressIndicator testRunId="test-run-001" variant="detailed" />);
      expect(screen.getByText(/Elapsed: 2m 5s/)).toBeInTheDocument();
    });

    it('should display hours, minutes, and seconds format', () => {
      const progress = makeProgress({
        startedAt: new Date(Date.now() - 3725000).toISOString(), // 1h 2m 5s ago
      });
      setHookState({ progress, isRunning: true });
      render(<JobProgressIndicator testRunId="test-run-001" variant="detailed" />);
      expect(screen.getByText(/Elapsed: 1h 2m 5s/)).toBeInTheDocument();
    });

    it('should update elapsed time every second using setInterval', () => {
      jest.useFakeTimers();

      const startedAt = new Date(Date.now() - 10000).toISOString(); // 10s ago
      setHookState({ progress: makeProgress({ startedAt }), isRunning: true });

      render(<JobProgressIndicator testRunId="test-run-001" variant="detailed" />);

      // Initially shows ~10s
      expect(screen.getByText(/Elapsed: 10s/)).toBeInTheDocument();

      // After 5 more simulated seconds
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      expect(screen.getByText(/Elapsed: 15s/)).toBeInTheDocument();

      jest.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // Callback props
  // -------------------------------------------------------------------------

  describe('Callback props forwarded to useJobProgress', () => {
    it('should forward onCompleted callback to the hook', () => {
      const onCompleted = jest.fn();
      const { useJobProgress } = jest.requireMock('@/hooks/useJobProgress');

      setHookState({ progress: makeProgress(), isRunning: true });
      render(
        <JobProgressIndicator
          testRunId="test-run-001"
          variant="detailed"
          onCompleted={onCompleted}
        />
      );

      // Verify the hook was called with the onCompleted callback
      expect(useJobProgress).toHaveBeenCalledWith(
        expect.objectContaining({ onCompleted })
      );
    });

    it('should forward onFailed callback to the hook', () => {
      const onFailed = jest.fn();
      const { useJobProgress } = jest.requireMock('@/hooks/useJobProgress');

      setHookState({ progress: makeProgress(), isRunning: true });
      render(
        <JobProgressIndicator
          testRunId="test-run-001"
          variant="detailed"
          onFailed={onFailed}
        />
      );

      expect(useJobProgress).toHaveBeenCalledWith(
        expect.objectContaining({ onFailed })
      );
    });

    it('should forward filter props to the hook', () => {
      const { useJobProgress } = jest.requireMock('@/hooks/useJobProgress');

      setHookState({ progress: makeProgress(), isRunning: true });
      render(
        <JobProgressIndicator
          testRunId="test-run-001"
          systemUnderTestId="system-abc"
          testEnvironment="staging"
          workload="stress-test"
          variant="detailed"
        />
      );

      expect(useJobProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          testRunId: 'test-run-001',
          systemUnderTestId: 'system-abc',
          testEnvironment: 'staging',
          workload: 'stress-test',
        })
      );
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('Edge cases', () => {
    it('should render nothing when isRunning is true but progress is null', () => {
      setHookState({ progress: null, isRunning: true });
      const { container } = render(
        <JobProgressIndicator testRunId="test-run-001" />
      );
      expect(container.firstChild).toBeNull();
    });

    it('should handle overallProgress of exactly 0 without errors', () => {
      setHookState({ progress: makeProgress({ overallProgress: 0 }), isRunning: true });
      expect(() =>
        render(<JobProgressIndicator testRunId="test-run-001" variant="modal" />)
      ).not.toThrow();
      expect(screen.getAllByText('0%').length).toBeGreaterThanOrEqual(1);
    });

    it('should handle overallProgress of exactly 100 without errors', () => {
      setHookState({
        progress: makeProgress({ overallProgress: 100, status: 'completed' }),
        isRunning: true,
      });
      expect(() =>
        render(<JobProgressIndicator testRunId="test-run-001" variant="modal" />)
      ).not.toThrow();
      expect(screen.getAllByText('100%').length).toBeGreaterThanOrEqual(1);
    });

    it('should handle stage 1 of 1 without errors', () => {
      setHookState({
        progress: makeProgress({ stageIndex: 1, totalStages: 1, stageName: 'Solo stage' }),
        isRunning: true,
      });
      render(<JobProgressIndicator testRunId="test-run-001" variant="detailed" />);
      expect(screen.getByText(/Stage 1 of 1/)).toBeInTheDocument();
    });

    it('should not render blocked indicator when isBlocked is true but blockingInfo is null', () => {
      setHookState({
        progress: null,
        isRunning: false,
        isBlocked: true,
        blockingInfo: null, // edge case: isBlocked but no info
      });
      const { container } = render(
        <JobProgressIndicator
          testRunId="test-run-001"
          variant="detailed"
        />
      );
      // No BlockedJobIndicator because blockingInfo is null
      expect(screen.queryByText('Job Blocked')).not.toBeInTheDocument();
      expect(container.firstChild).toBeNull();
    });

    it('should not render blocked indicator when it has been dismissed', async () => {
      const blockingInfo = makeBlockingInfo();
      setHookState({
        progress: null,
        isRunning: false,
        isBlocked: true,
        blockingInfo,
        lockInfo: null,
      });

      render(
        <JobProgressIndicator
          testRunId="test-run-001"
          variant="detailed"
        />
      );

      expect(screen.getByText('Job Blocked')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

      await waitFor(() => {
        expect(screen.queryByText('Job Blocked')).not.toBeInTheDocument();
      });
    });

    it('should prefer stuck indicator over running indicator when isStuck is true', () => {
      // Even if progress is set and status is active, isStuck overrides
      setHookState({
        progress: makeProgress({ status: 'active' }),
        isRunning: true,
        isStuck: true,
      });
      render(
        <JobProgressIndicator testRunId="test-run-001" variant="detailed" />
      );
      expect(screen.getByText('Job Appears Stuck')).toBeInTheDocument();
      expect(screen.queryByText('Analyzing Test Run')).not.toBeInTheDocument();
    });

    it('should prefer blocked indicator over stuck/running when isBlocked is true and not dismissed', () => {
      const blockingInfo = makeBlockingInfo();
      setHookState({
        progress: makeProgress({ status: 'stuck' }),
        isRunning: false,
        isBlocked: true,
        isStuck: true,
        blockingInfo,
        lockInfo: null,
      });
      render(
        <JobProgressIndicator
          testRunId="test-run-001"
          variant="detailed"
        />
      );
      expect(screen.getByText('Job Blocked')).toBeInTheDocument();
      expect(screen.queryByText('Job Appears Stuck')).not.toBeInTheDocument();
    });
  });
});
