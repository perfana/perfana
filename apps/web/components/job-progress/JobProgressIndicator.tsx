/**
 * JobProgressIndicator Component
 *
 * Displays job progress with stage information and progress bar.
 * Supports three variants:
 * - Compact: Minimal display for list views (progress bar with tooltip)
 * - Detailed: Full stage breakdown for detail views (banner with all info)
 * - Modal: Centered modal dialog with progress info
 */

'use client';

import React, { useMemo, useEffect, useState } from 'react';
import {
  Box,
  LinearProgress,
  Typography,
  Chip,
  Tooltip,
  Paper,
  Stack,
  Dialog,
  DialogContent,
  DialogActions,
  CircularProgress,
  Button,
  Alert,
  AlertTitle,
} from '@mui/material';
import { AccessTime, CheckCircle, Error as ErrorIcon, LockOpen, Warning } from '@mui/icons-material';
import { useJobProgress } from '@/hooks/useJobProgress';
import type { JobProgress } from '@perfana/shared/types';

/**
 * Props for JobProgressIndicator component
 */
export interface JobProgressIndicatorProps {
  /** Filter by test run ID */
  testRunId?: string;
  /** Filter by system under test ID */
  systemUnderTestId?: string;
  /** Filter by test environment */
  testEnvironment?: string;
  /** Filter by workload */
  workload?: string;
  /** Display variant (default: modal) */
  variant?: 'compact' | 'detailed' | 'modal';
  /** Callback when job completes */
  onCompleted?: () => void;
  /** Callback when job fails */
  onFailed?: (error: string) => void;
  /** Callback when lock is released (user can retry action) */
  onLockReleased?: () => void;
}

/**
 * Format elapsed time from ISO timestamp
 */
function formatElapsedTime(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const elapsed = Math.floor((now - start) / 1000); // seconds

  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Get progress bar color based on job status
 */
function getProgressColor(progress: JobProgress): 'primary' | 'success' | 'error' | 'warning' {
  if (progress.status === 'failed') return 'error';
  if (progress.status === 'stuck') return 'warning';
  if (progress.status === 'completed') return 'success';
  return 'primary';
}

/**
 * Compact variant - minimal progress bar with tooltip
 */
function CompactProgressIndicator({ progress }: { progress: JobProgress }): JSX.Element {
  const [elapsed, setElapsed] = useState(formatElapsedTime(progress.startedAt));

  // Update elapsed time every second
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(formatElapsedTime(progress.startedAt));
    }, 1000);

    return () => clearInterval(interval);
  }, [progress.startedAt]);

  const tooltipContent = (
    <Box sx={{ p: 1 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'white', mb: 1 }}>
        Job Progress
      </Typography>
      <Typography variant="body2" sx={{ color: 'white', fontSize: '0.75rem', mb: 0.5 }}>
        Stage {progress.stageIndex}/{progress.totalStages}: {progress.stageName}
      </Typography>
      <Typography variant="body2" sx={{ color: 'white', fontSize: '0.75rem', mb: 0.5 }}>
        Overall: {progress.overallProgress}%
      </Typography>
      <Typography variant="body2" sx={{ color: 'white', fontSize: '0.75rem' }}>
        Elapsed: {elapsed}
      </Typography>
    </Box>
  );

  return (
    <Tooltip
      title={tooltipContent}
      arrow
      placement="top"
      sx={{
        '& .MuiTooltip-tooltip': {
          backgroundColor: 'rgba(33, 33, 33, 0.95)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
          maxWidth: 280,
        },
        '& .MuiTooltip-arrow': {
          color: 'rgba(33, 33, 33, 0.95)',
        },
      }}
    >
      <Box
        sx={{
          width: 100,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          height: '100%',
        }}
      >
        <LinearProgress
          variant="determinate"
          value={progress.overallProgress}
          color={getProgressColor(progress)}
          sx={{ height: 8, borderRadius: 4 }}
        />
        <Typography variant="caption" color="text.secondary" align="center" display="block">
          {Math.round(progress.overallProgress)}%
        </Typography>
      </Box>
    </Tooltip>
  );
}

/**
 * Detailed variant - full stage breakdown banner
 */
function DetailedProgressIndicator({ progress }: { progress: JobProgress }): JSX.Element {
  const [elapsed, setElapsed] = useState(formatElapsedTime(progress.startedAt));

  // Update elapsed time every second
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(formatElapsedTime(progress.startedAt));
    }, 1000);

    return () => clearInterval(interval);
  }, [progress.startedAt]);

  const statusIcon = useMemo(() => {
    if (progress.status === 'completed') {
      return <CheckCircle sx={{ color: 'success.main', fontSize: '1.25rem' }} />;
    }
    if (progress.status === 'failed' || progress.status === 'stuck') {
      return <ErrorIcon sx={{ color: 'error.main', fontSize: '1.25rem' }} />;
    }
    return <AccessTime sx={{ color: 'primary.main', fontSize: '1.25rem' }} />;
  }, [progress.status]);

  return (
    <Paper
      elevation={2}
      sx={{
        p: 2,
        mb: 3,
        backgroundColor: 'rgba(25, 118, 210, 0.04)',
        borderLeft: '4px solid',
        borderColor: getProgressColor(progress) === 'error' ? 'error.main' : 'primary.main',
      }}
    >
      <Stack spacing={2}>
        {/* Header Row */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {statusIcon}
            <Typography variant="h6" component="div">
              {progress.jobType === 'analyze' && 'Analyzing Test Run'}
              {progress.jobType === 'refresh' && 'Refreshing Data'}
              {progress.jobType === 'reevaluate' && 'Re-evaluating Test Run'}
            </Typography>
          </Box>
          <Chip
            label={`Elapsed: ${elapsed}`}
            size="small"
            variant="outlined"
            sx={{ fontFamily: 'monospace' }}
          />
        </Box>

        {/* Stage Information */}
        <Box>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Stage {progress.stageIndex} of {progress.totalStages}: {progress.stageName}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
            <LinearProgress
              variant="determinate"
              value={progress.overallProgress}
              color={getProgressColor(progress)}
              sx={{
                flex: 1,
                height: 10,
                borderRadius: 5,
                backgroundColor: 'rgba(0, 0, 0, 0.08)',
              }}
            />
            <Typography
              variant="body2"
              sx={{ fontWeight: 600, minWidth: '50px', textAlign: 'right' }}
            >
              {Math.round(progress.overallProgress)}%
            </Typography>
          </Box>
        </Box>

        {/* Progress Message */}
        <Typography variant="caption" color="text.secondary">
          {progress.message}
        </Typography>
      </Stack>
    </Paper>
  );
}

/**
 * Modal variant - centered modal dialog with progress
 */
function ModalProgressIndicator({ progress }: { progress: JobProgress }): JSX.Element {
  const [elapsed, setElapsed] = useState(formatElapsedTime(progress.startedAt));

  // Update elapsed time every second
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(formatElapsedTime(progress.startedAt));
    }, 1000);

    return () => clearInterval(interval);
  }, [progress.startedAt]);

  const getJobTitle = () => {
    switch (progress.jobType) {
      case 'analyze': return 'Analyzing Test Run';
      case 'refresh': return 'Refreshing Data';
      case 'reevaluate': return 'Re-evaluating Test Run';
      default: return 'Processing';
    }
  };

  return (
    <Dialog
      open={true}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          background: 'linear-gradient(135deg, rgba(25, 118, 210, 0.02) 0%, rgba(25, 118, 210, 0.08) 100%)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(25, 118, 210, 0.2)',
        },
      }}
    >
      <DialogContent sx={{ py: 4, px: 4 }}>
        <Stack spacing={3} alignItems="center">
          {/* Spinning indicator */}
          <Box sx={{ position: 'relative', display: 'inline-flex' }}>
            <CircularProgress
              variant="determinate"
              value={progress.overallProgress}
              size={100}
              thickness={4}
              sx={{
                color: 'primary.main',
                '& .MuiCircularProgress-circle': {
                  strokeLinecap: 'round',
                },
              }}
            />
            <Box
              sx={{
                top: 0,
                left: 0,
                bottom: 0,
                right: 0,
                position: 'absolute',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Typography
                variant="h5"
                component="div"
                sx={{ fontWeight: 700, color: 'primary.main' }}
              >
                {Math.round(progress.overallProgress)}%
              </Typography>
            </Box>
          </Box>

          {/* Title */}
          <Typography variant="h5" component="div" sx={{ fontWeight: 600, textAlign: 'center' }}>
            {getJobTitle()}
          </Typography>

          {/* Stage info */}
          <Box sx={{ width: '100%', textAlign: 'center' }}>
            <Typography variant="body1" color="text.secondary" gutterBottom>
              Stage {progress.stageIndex} of {progress.totalStages}
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 500, color: 'primary.main' }}>
              {progress.stageName}
            </Typography>
          </Box>

          {/* Linear progress bar */}
          <Box sx={{ width: '100%' }}>
            <LinearProgress
              variant="determinate"
              value={progress.overallProgress}
              sx={{
                height: 8,
                borderRadius: 4,
                backgroundColor: 'rgba(25, 118, 210, 0.1)',
                '& .MuiLinearProgress-bar': {
                  borderRadius: 4,
                  background: 'linear-gradient(90deg, #1976d2 0%, #42a5f5 100%)',
                },
              }}
            />
          </Box>

          {/* Elapsed time */}
          <Chip
            icon={<AccessTime sx={{ fontSize: '1rem' }} />}
            label={`Elapsed: ${elapsed}`}
            size="small"
            variant="outlined"
            sx={{ fontFamily: 'monospace' }}
          />
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Stuck Job Indicator - shown when a job is stuck and needs manual intervention
 */
function StuckJobIndicator({
  progress,
  onReleaseLock,
  isReleasing,
}: {
  progress: JobProgress | null;
  onReleaseLock: () => void;
  isReleasing: boolean;
}): JSX.Element {
  const [elapsed, setElapsed] = useState(
    progress?.startedAt ? formatElapsedTime(progress.startedAt) : '0s'
  );

  useEffect(() => {
    if (!progress?.startedAt) return;

    const interval = setInterval(() => {
      setElapsed(formatElapsedTime(progress.startedAt));
    }, 1000);

    return () => clearInterval(interval);
  }, [progress?.startedAt]);

  return (
    <Paper
      elevation={2}
      sx={{
        p: 2,
        mb: 3,
        backgroundColor: 'rgba(255, 152, 0, 0.08)',
        borderLeft: '4px solid',
        borderColor: 'warning.main',
      }}
    >
      <Stack spacing={2}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Warning sx={{ color: 'warning.main', fontSize: '1.5rem' }} />
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" component="div" sx={{ color: 'warning.dark' }}>
              Job Appears Stuck
            </Typography>
            <Typography variant="body2" color="text.secondary">
              No progress updates received for an extended period
            </Typography>
          </Box>
          <Chip
            label={`Elapsed: ${elapsed}`}
            size="small"
            variant="outlined"
            color="warning"
            sx={{ fontFamily: 'monospace' }}
          />
        </Box>

        {/* Progress info if available */}
        {progress && (
          <Box sx={{ pl: 4.5 }}>
            <Typography variant="body2" color="text.secondary">
              Last known stage: <strong>{progress.stageName}</strong> ({progress.stageIndex}/{progress.totalStages})
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Progress: <strong>{progress.overallProgress}%</strong>
            </Typography>
          </Box>
        )}

        {/* Alert with action */}
        <Alert
          severity="warning"
          sx={{ mt: 1 }}
          action={
            <Button
              color="warning"
              size="small"
              variant="outlined"
              startIcon={isReleasing ? <CircularProgress size={16} color="inherit" /> : <LockOpen />}
              onClick={onReleaseLock}
              disabled={isReleasing}
              sx={{ whiteSpace: 'nowrap' }}
            >
              {isReleasing ? 'Releasing...' : 'Release Lock'}
            </Button>
          }
        >
          <AlertTitle>Manual Intervention Required</AlertTitle>
          You can release the lock to unblock this scope and retry your operation.
        </Alert>
      </Stack>
    </Paper>
  );
}

/**
 * Blocked Job Indicator - shown when a job was blocked by an existing lock.
 * Shows the blocking job details and provides a manual release option.
 */
function BlockedJobIndicator({
  blockingInfo,
  lockInfo,
  onReleaseLock,
  isReleasing,
  onDismiss,
}: {
  blockingInfo: import('@perfana/shared/types').JobBlockedInfo;
  lockInfo: import('@perfana/shared/types').JobLockInfo | null;
  onReleaseLock: () => void;
  isReleasing: boolean;
  onDismiss: () => void;
}): JSX.Element {
  const existingProgress = blockingInfo.existingJobProgress;
  const acquiredAt = lockInfo?.acquiredAt;

  return (
    <Paper
      elevation={2}
      sx={{
        p: 2,
        mb: 3,
        backgroundColor: 'rgba(255, 152, 0, 0.08)',
        borderLeft: '4px solid',
        borderColor: 'warning.main',
      }}
    >
      <Stack spacing={1.5}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <Warning sx={{ color: 'warning.main', fontSize: '1.5rem', mt: 0.25 }} />
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'warning.dark' }}>
              Job Blocked
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {blockingInfo.reason || 'Another job is already processing this scope.'}
            </Typography>
          </Box>
          <Button size="small" onClick={onDismiss} sx={{ color: 'text.secondary', minWidth: 'auto' }}>
            Dismiss
          </Button>
        </Box>

        {/* Blocking job details */}
        {(blockingInfo.existingJobId || existingProgress || acquiredAt) && (
          <Box
            sx={{
              ml: 4.5,
              p: 1.5,
              borderRadius: 1,
              backgroundColor: 'action.hover',
              fontFamily: 'monospace',
              fontSize: '0.8rem',
            }}
          >
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', display: 'block', mb: 0.5 }}>
              Lock held by:
            </Typography>
            {existingProgress?.jobType && (
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                Type: <strong>{existingProgress.jobType}</strong>
              </Typography>
            )}
            {blockingInfo.existingJobId && (
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                Job ID: {blockingInfo.existingJobId}
              </Typography>
            )}
            {existingProgress?.testRunId && (
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                Test Run: {existingProgress.testRunId}
              </Typography>
            )}
            {acquiredAt && (
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                Started: {new Date(acquiredAt).toLocaleString()}
              </Typography>
            )}
            {existingProgress && (
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                Progress: {existingProgress.stageName} ({existingProgress.overallProgress}%)
              </Typography>
            )}
          </Box>
        )}

        {/* Release lock action */}
        <Alert
          severity="warning"
          sx={{ ml: 4.5 }}
          action={
            <Button
              color="warning"
              size="small"
              variant="outlined"
              startIcon={isReleasing ? <CircularProgress size={16} color="inherit" /> : <LockOpen />}
              onClick={onReleaseLock}
              disabled={isReleasing}
              sx={{ whiteSpace: 'nowrap' }}
            >
              {isReleasing ? 'Releasing...' : 'Release Lock'}
            </Button>
          }
        >
          If the blocking job is stuck or no longer running, you can release the lock to retry.
        </Alert>
      </Stack>
    </Paper>
  );
}

/**
 * JobProgressIndicator Component
 *
 * Main component that wraps useJobProgress hook and renders appropriate variant.
 */
export function JobProgressIndicator({
  testRunId,
  systemUnderTestId,
  testEnvironment,
  workload,
  variant = 'modal',
  onCompleted,
  onFailed,
  onLockReleased,
}: JobProgressIndicatorProps): JSX.Element | null {
  const { progress, isRunning, isBlocked, isStuck, blockingInfo, lockInfo, error, releaseLock } = useJobProgress({
    testRunId,
    systemUnderTestId,
    testEnvironment,
    workload,
    onCompleted,
    onFailed,
  });

  const [isReleasing, setIsReleasing] = useState(false);
  const [blockedDismissed, setBlockedDismissed] = useState(false);

  // Reset dismissed state when a new blocked event comes in
  useEffect(() => {
    if (isBlocked) setBlockedDismissed(false);
  }, [isBlocked, blockingInfo]);

  const handleReleaseLock = async () => {
    setIsReleasing(true);
    try {
      const result = await releaseLock();
      if (result.success) {
        setBlockedDismissed(true);
        onLockReleased?.();
      }
    } finally {
      setIsReleasing(false);
    }
  };

  // Show blocked indicator when job is blocked (detailed/modal variants only)
  if (isBlocked && blockingInfo && !blockedDismissed && (variant === 'detailed' || variant === 'modal')) {
    return (
      <BlockedJobIndicator
        blockingInfo={blockingInfo}
        lockInfo={lockInfo}
        onReleaseLock={handleReleaseLock}
        isReleasing={isReleasing}
        onDismiss={() => setBlockedDismissed(true)}
      />
    );
  }

  // Show stuck indicator if job is stuck (even if not technically "running")
  if (isStuck && (variant === 'detailed' || variant === 'modal')) {
    return (
      <StuckJobIndicator
        progress={progress}
        onReleaseLock={handleReleaseLock}
        isReleasing={isReleasing}
      />
    );
  }

  // Don't render if no active job
  if (!isRunning || !progress) {
    return null;
  }

  // Don't render if there's an error (let parent handle error display)
  if (error && !isStuck) {
    return null;
  }

  // Render appropriate variant
  if (variant === 'compact') {
    return <CompactProgressIndicator progress={progress} />;
  }

  if (variant === 'detailed') {
    return <DetailedProgressIndicator progress={progress} />;
  }

  // Default: modal variant
  return <ModalProgressIndicator progress={progress} />;
}
