'use client';

import React, { useState } from 'react';
import {
  IconButton,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Tooltip,
  Divider,
} from '@mui/material';
import { MoreVert, Sync, PlaylistAddCheck, Delete as DeleteIcon, Flag, LayersClear } from '@mui/icons-material';
import { useRouter } from 'next/navigation';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';
import { useJobProgress } from '@/hooks/useJobProgress';
import { RefreshMissingDataDialog, RefreshSources } from '@/components/dialogs/RefreshSourcesDialog';
import { AvailableSources, fetchAvailableSources, getTestRunScope } from '@/lib/refresh-sources';

interface TestRunActionsMenuProps {
  testRun: TestRun;
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
  onDeleted?: () => void;
  onRefresh?: () => void;
  /** Called when a job is triggered (Re-evaluate, Refresh) */
  onJobTriggered?: () => void;
}

export default function TestRunActionsMenu({
  testRun,
  onSuccess,
  onError,
  onDeleted,
  onRefresh,
  onJobTriggered,
}: TestRunActionsMenuProps) {
  const router = useRouter();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [refreshDialogOpen, setRefreshDialogOpen] = useState(false);
  const [availableSources, setAvailableSources] = useState<AvailableSources | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const open = Boolean(anchorEl);

  // Check for active jobs that would block actions
  const { isRunning, isBlocked, isStuck, blockingInfo, progress } = useJobProgress({
    testRunId: testRun.test_run_id,
    systemUnderTestId: testRun.system_under_test_id || (testRun.systems_under_test as any)?.id,
    testEnvironment: testRun.test_environment,
    workload: testRun.workload,
  });

  // Determine if actions should be disabled
  const actionsDisabled = isLoading || isRunning || isBlocked || isStuck;

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleReEvaluate = async () => {
    try {
      setIsLoading(true);
      const response = await authenticatedFetch('/data/reevaluate/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          testRunIds: [testRun.test_run_id],
          checks: true,
          adapt: true,
        }),
      });

      // Handle 409 Conflict (job blocked)
      if (response.status === 409) {
        const errorData = await response.json();
        onError?.(
          errorData.message || 'Another job is already running for this test run scope'
        );
        handleClose();
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to start re-evaluation');
      }

      const _result = await response.json();
      onJobTriggered?.();
      onSuccess?.('Re-evaluation started successfully');
    } catch (err) {
      console.error('Failed to start re-evaluation:', err);
      onError?.('Failed to start re-evaluation');
    } finally {
      setIsLoading(false);
      handleClose();
    }
  };

  const handleRefreshClick = async () => {
    handleClose();
    const scopes = [getTestRunScope(testRun)];
    const sources = await fetchAvailableSources(scopes);

    if (!sources.grafana && !sources.dynatrace) {
      // Only performance metrics — skip dialog, refresh immediately
      handleRefreshConfirm({ grafana: false, dynatrace: false, performanceMetrics: true });
      return;
    }

    setAvailableSources(sources);
    setRefreshDialogOpen(true);
  };

  const handleRefreshConfirm = async (sources: RefreshSources) => {
    try {
      setIsLoading(true);
      const response = await authenticatedFetch('/data/refresh/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          testRunIds: [testRun.test_run_id],
          sources,
          forceRefetch: sources.forceRefetch,
        }),
      });

      // Handle 409 Conflict (job blocked)
      if (response.status === 409) {
        const errorData = await response.json();
        onError?.(
          errorData.message || 'Another job is already running for this test run scope'
        );
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to start re-fetch');
      }

      const _result = await response.json();
      onJobTriggered?.();
      onSuccess?.('Re-fetch missing data started');
      onRefresh?.();
    } catch (err) {
      console.error('Failed to start re-fetch:', err);
      onError?.('Failed to start re-fetch');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMarkAsChangepoint = async () => {
    try {
      setIsLoading(true);
      const response = await authenticatedFetch('/test-runs/mark-changepoint', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemUnderTestId: testRun.system_under_test_id || (testRun.systems_under_test as any)?.id,
          testEnvironment: testRun.test_environment,
          workload: testRun.workload,
          testRunId: testRun.test_run_id,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to mark test run as changepoint');
      }

      const result = await response.json();
      onSuccess?.(result.message || 'Test run marked as changepoint successfully');
      onRefresh?.();
    } catch (err) {
      console.error('Failed to mark as changepoint:', err);
      onError?.('Failed to mark test run as changepoint');
    } finally {
      setIsLoading(false);
      handleClose();
    }
  };

  const handleRemoveChangepoint = async () => {
    try {
      setIsLoading(true);
      const response = await authenticatedFetch('/test-runs/remove-changepoint', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemUnderTestId: testRun.system_under_test_id || (testRun.systems_under_test as any)?.id,
          testEnvironment: testRun.test_environment,
          workload: testRun.workload,
          testRunId: testRun.test_run_id,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to remove changepoint');
      }

      const result = await response.json();
      onSuccess?.(result.message || 'Changepoint removed successfully');
      onRefresh?.();
    } catch (err) {
      console.error('Failed to remove changepoint:', err);
      onError?.('Failed to remove changepoint');
    } finally {
      setIsLoading(false);
      handleClose();
    }
  };

  const handleDisableBaselineMode = async () => {
    handleClose();
    try {
      setIsLoading(true);
      const queryParams = new URLSearchParams();
      if (testRun.system_under_test_id) queryParams.set('systemUnderTestId', testRun.system_under_test_id);
      if (testRun.test_environment) queryParams.set('environment', testRun.test_environment);
      if (testRun.workload) queryParams.set('workload', testRun.workload);

      const response = await authenticatedFetch(
        `/test-runs/${testRun.test_run_id}/adapt-config?${queryParams.toString()}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ differencesAccepted: 'TBD', mode: 'DEFAULT' }),
        },
      );
      if (!response.ok) throw new Error('Failed to update');
      onSuccess?.('Switched to regression mode');
      onRefresh?.();
    } catch (err) {
      onError?.('Failed to disable baseline mode');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteClick = () => {
    setDeleteDialogOpen(true);
    handleClose();
  };

  const handleDeleteConfirm = async () => {
    try {
      setIsLoading(true);
      const response = await authenticatedFetch(`/test-runs/${testRun.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete test run');
      }

      onSuccess?.('Test run deleted successfully');
      setDeleteDialogOpen(false);

      // Navigate back to test runs list after deletion
      if (onDeleted) {
        onDeleted();
      } else {
        router.push('/test-runs');
      }
    } catch (err) {
      console.error('Failed to delete test run:', err);
      onError?.('Failed to delete test run');
      setDeleteDialogOpen(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
  };

  return (
    <>
      <Tooltip title="Actions">
        <IconButton
          size="small"
          onClick={handleClick}
          disabled={isLoading}
          aria-label="actions"
          aria-controls={open ? 'test-run-actions-menu' : undefined}
          aria-haspopup="true"
          aria-expanded={open ? 'true' : undefined}
          sx={{
            color: 'text.secondary',
            '&:hover': {
              backgroundColor: 'action.hover',
              color: 'primary.main',
            },
          }}
        >
          <MoreVert />
        </IconButton>
      </Tooltip>

      <Menu
        id="test-run-actions-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        MenuListProps={{
          'aria-labelledby': 'actions-button',
        }}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
      >
        <Tooltip
          title={
            isStuck
              ? 'Job is stuck - release the lock from the progress indicator to retry'
              : isRunning && progress
              ? `Job in progress: ${progress.stageName} - ${progress.overallProgress}%`
              : isBlocked && blockingInfo
              ? blockingInfo.reason || 'Blocked by another job'
              : ''
          }
          placement="left"
          arrow
        >
          <span>
            <MenuItem onClick={handleReEvaluate} disabled={actionsDisabled}>
              <PlaylistAddCheck sx={{ mr: 1.5, fontSize: '1.2rem' }} />
              Re-evaluate
            </MenuItem>
          </span>
        </Tooltip>
        <Tooltip
          title={
            isStuck
              ? 'Job is stuck - release the lock from the progress indicator to retry'
              : isRunning && progress
              ? `Job in progress: ${progress.stageName} - ${progress.overallProgress}%`
              : isBlocked && blockingInfo
              ? blockingInfo.reason || 'Blocked by another job'
              : ''
          }
          placement="left"
          arrow
        >
          <span>
            <MenuItem onClick={handleRefreshClick} disabled={actionsDisabled}>
              <Sync sx={{ mr: 1.5, fontSize: '1.2rem' }} />
              Re-fetch
            </MenuItem>
          </span>
        </Tooltip>
        <Divider />
        <Tooltip
          title={
            isStuck
              ? 'Job is stuck - release the lock from the progress indicator to retry'
              : isRunning && progress
              ? `Job in progress: ${progress.stageName} - ${progress.overallProgress}%`
              : isBlocked && blockingInfo
              ? blockingInfo.reason || 'Blocked by another job'
              : ''
          }
          placement="left"
          arrow
        >
          <span>
            {testRun.is_changepoint ? (
              <MenuItem onClick={handleRemoveChangepoint} disabled={actionsDisabled}>
                <Flag sx={{ mr: 1.5, fontSize: '1.2rem', color: 'warning.main' }} />
                Remove Changepoint
              </MenuItem>
            ) : (
              <MenuItem onClick={handleMarkAsChangepoint} disabled={actionsDisabled}>
                <Flag sx={{ mr: 1.5, fontSize: '1.2rem' }} />
                Mark as Changepoint
              </MenuItem>
            )}
          </span>
        </Tooltip>
        {testRun.adapt_config?.mode === 'BASELINE' && (
          <>
            <Divider />
            <MenuItem onClick={handleDisableBaselineMode} disabled={isLoading}>
              <LayersClear sx={{ mr: 1.5, fontSize: '1.2rem' }} />
              Disable Baseline Mode
            </MenuItem>
          </>
        )}
        <Divider />
        <MenuItem onClick={handleDeleteClick} disabled={isLoading} sx={{ color: 'error.main' }}>
          <DeleteIcon sx={{ mr: 1.5, fontSize: '1.2rem' }} />
          Delete
        </MenuItem>
      </Menu>

      <Dialog open={deleteDialogOpen} onClose={handleDeleteCancel}>
        <DialogTitle>Delete Test Run</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete test run "<strong>{testRun.test_run_id}</strong>"?
            This action cannot be undone and will remove all associated data.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            color="error"
            variant="contained"
            disabled={isLoading}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <RefreshMissingDataDialog
        open={refreshDialogOpen}
        onClose={() => { setRefreshDialogOpen(false); setAvailableSources(undefined); }}
        onConfirm={handleRefreshConfirm}
        availableSources={availableSources}
      />

    </>
  );
}
