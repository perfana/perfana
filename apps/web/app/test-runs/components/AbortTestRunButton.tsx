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
  onAborted?: () => void;
  showToast?: (message: string) => void;
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
      showToast?.('Test run aborted successfully');
      onAborted?.();
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message
        : 'Failed to abort test run';
      showToast?.(msg);
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
          <Button onClick={handleAbort} color="error" variant="contained" disabled={loading} data-testid="confirm-abort">
            Abort
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
