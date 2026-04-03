'use client';

import { useState } from 'react';
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
} from '@mui/material';
import { MoreVert } from '@mui/icons-material';
import { TestRun } from '@/types/test-runs';
import { authenticatedFetch } from '@/lib/api';
import { RefreshMissingDataDialog, RefreshSources } from '@/components/dialogs/RefreshSourcesDialog';
import { AvailableSources, fetchAvailableSources, getTestRunScope } from '@/lib/refresh-sources';

interface ActionsMenuProps {
  testRun: TestRun;
  onDelete: (id: string) => void;
  showToast: (message: string) => void;
  onRefresh: () => void;
}

export function ActionsMenu({ testRun, onDelete, showToast, onRefresh }: ActionsMenuProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [refreshDialogOpen, setRefreshDialogOpen] = useState(false);
  const [availableSources, setAvailableSources] = useState<AvailableSources | undefined>(undefined);
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleReEvaluate = async () => {
    try {
      const response = await authenticatedFetch('/data/reevaluate/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          testRunIds: [testRun.test_run_id],
          checks: true,
          adapt: true
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start re-evaluation');
      }

      const result = await response.json();
      showToast('Re-evaluation started successfully');
    } catch (err) {
      console.error('Failed to start re-evaluation:', err);
      showToast('Failed to start re-evaluation');
    }
    handleClose();
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
      const response = await authenticatedFetch('/data/refresh/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          testRunIds: [testRun.test_run_id],
          sources,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start re-fetch');
      }

      const result = await response.json();
      showToast('Re-fetch missing data started');
    } catch (err) {
      console.error('Failed to start re-fetch:', err);
      showToast('Failed to start re-fetch');
    }
    setRefreshDialogOpen(false);
    setAvailableSources(undefined);
  };

  const monitorJobAndRefresh = async (jobId: string) => {
    const estimatedJobTime = 30 * 1000; // 30 seconds estimated time
    const maxWaitTime = 2 * 60 * 1000; // 2 minutes max wait
    const checkInterval = 10 * 1000; // Check every 10 seconds
    const startTime = Date.now();

    // Add initial delay to give job time to start
    await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay

    const checkJobStatusWithFallback = async (): Promise<boolean> => {
      try {
        const response = await authenticatedFetch(`/data/jobs/${jobId}/status`);

        if (response.ok) {
          const jobStatus = await response.json();
          const isCompleted = jobStatus.status === 'completed' ||
                             jobStatus.status === 'failed' ||
                             jobStatus.finished;

          if (isCompleted) {
            if (jobStatus.status === 'failed') {
              showToast('Re-evaluation job failed');
            } else {
              showToast('Re-evaluation completed, refreshing view...');
            }
            onRefresh();
            return true;
          }
        } else {
          const elapsedTime = Date.now() - startTime;
          if (elapsedTime >= estimatedJobTime) {
            showToast('Re-evaluation likely completed, refreshing view...');
            onRefresh();
            return true;
          }
        }

        return false;
      } catch (error) {
        console.error('Error checking job status, using fallback timing:', error);

        const elapsedTime = Date.now() - startTime;
        if (elapsedTime >= estimatedJobTime) {
          showToast('Re-evaluation likely completed, refreshing view...');
          onRefresh();
          return true;
        }

        return false;
      }
    };

    const poll = async () => {
      const isCompleted = await checkJobStatusWithFallback();

      if (isCompleted) {
        return;
      }

      if (Date.now() - startTime > maxWaitTime) {
        showToast('Re-evaluation is taking longer than expected, refreshing view...');
        onRefresh();
        return;
      }

      setTimeout(poll, checkInterval);
    };

    poll();
  };

  const handleMarkAsChangepoint = async () => {
    try {
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
      showToast(result.message || 'Test run marked as changepoint successfully');

      if (result.jobId) {
        showToast('Monitoring re-evaluation jobs...');
        monitorJobAndRefresh(result.jobId);
      } else {
        setTimeout(() => {
          onRefresh();
        }, 2000);
      }
    } catch (err) {
      console.error('Failed to mark as changepoint:', err);
      showToast('Failed to mark test run as changepoint');
    }
    handleClose();
  };

  const handleRemoveChangepoint = async () => {
    try {
      const response = await authenticatedFetch('/test-runs/remove-changepoint', {
        method: 'DELETE',
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
      showToast(result.message || 'Changepoint removed successfully');

      if (result.jobId) {
        showToast('Monitoring re-evaluation jobs...');
        monitorJobAndRefresh(result.jobId);
      } else {
        setTimeout(() => {
          onRefresh();
        }, 2000);
      }
    } catch (err) {
      console.error('Failed to remove changepoint:', err);
      showToast('Failed to remove changepoint');
    }
    handleClose();
  };

  const handleDeleteClick = () => {
    setDeleteDialogOpen(true);
    handleClose();
  };

  const handleDeleteConfirm = () => {
    onDelete(testRun.id);
    setDeleteDialogOpen(false);
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
  };

  return (
    <>
      <IconButton
        size="small"
        onClick={handleClick}
        aria-label="actions"
        aria-controls={open ? 'actions-menu' : undefined}
        aria-haspopup="true"
        aria-expanded={open ? 'true' : undefined}
      >
        <MoreVert />
      </IconButton>
      <Menu
        id="actions-menu"
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
        <MenuItem onClick={handleReEvaluate}>Re-evaluate</MenuItem>
        <MenuItem onClick={handleRefreshClick}>Re-fetch</MenuItem>
        {testRun.is_changepoint ? (
          <MenuItem onClick={handleRemoveChangepoint}>Remove changepoint</MenuItem>
        ) : (
          <MenuItem onClick={handleMarkAsChangepoint}>Mark as Changepoint</MenuItem>
        )}
        <MenuItem onClick={handleDeleteClick}>Delete</MenuItem>
      </Menu>

      <Dialog open={deleteDialogOpen} onClose={handleDeleteCancel}>
        <DialogTitle>Delete Test Run</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete test run "{testRun.test_run_id}"? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel}>Cancel</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">
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
