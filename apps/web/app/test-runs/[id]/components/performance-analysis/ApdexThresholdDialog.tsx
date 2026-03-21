'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Alert,
  CircularProgress,
  InputAdornment,
} from '@mui/material';
import { authenticatedFetch } from '@/lib/api';

interface ApdexThresholdDialogProps {
  open: boolean;
  onClose: () => void;
  testRunId: string;
  transactionName?: string; // If provided, configure transaction-level; otherwise test-level
  currentThreshold?: number;
  onSuccess: () => void;
}

/**
 * Dialog for configuring Apdex threshold (T value) at test-level or transaction-level.
 * Extracted from the combined ApdexConfigDialog for single-purpose use.
 */
export default function ApdexThresholdDialog({
  open,
  onClose,
  testRunId,
  transactionName,
  currentThreshold,
  onSuccess,
}: ApdexThresholdDialogProps) {
  const [threshold, setThreshold] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isTransactionLevel = !!transactionName;
  const title = isTransactionLevel
    ? `Set Apdex Threshold: ${transactionName}`
    : 'Set Apdex Threshold';

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setThreshold(currentThreshold?.toString() || '500');
      setError(null);
      setSuccess(false);
    }
  }, [open, currentThreshold]);

  const handleSave = async () => {
    const thresholdValue = parseInt(threshold, 10);

    // Validation
    if (isNaN(thresholdValue) || thresholdValue < 1 || thresholdValue > 60000) {
      setError('Threshold must be between 1 and 60,000 milliseconds');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Save threshold
      const thresholdUrl = isTransactionLevel
        ? `/test-runs/${testRunId}/transactions/${encodeURIComponent(transactionName!)}/apdex-threshold`
        : `/test-runs/${testRunId}/apdex-threshold`;

      const thresholdResponse = await authenticatedFetch(thresholdUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ apdex_threshold: thresholdValue }),
      });

      if (!thresholdResponse.ok) {
        const errorData = await thresholdResponse.json();
        throw new Error(errorData.message || 'Failed to update threshold');
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
    } catch (err) {
      console.error('Error saving threshold:', err);
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to save threshold'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!isTransactionLevel) return;

    try {
      setLoading(true);
      setError(null);

      const url = `/test-runs/${testRunId}/transactions/${encodeURIComponent(transactionName!)}/apdex-threshold`;

      const response = await authenticatedFetch(url, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to delete threshold');
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
    } catch (err) {
      console.error('Error deleting threshold:', err);
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to delete threshold'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 2 }}>
          {/* Info section */}
          <Alert severity="info" sx={{ mb: 3 }}>
            <Typography variant="body2" gutterBottom>
              <strong>Apdex Threshold (T)</strong> defines the response time boundary for satisfied users.
            </Typography>
            <Typography variant="body2" sx={{ mt: 1, fontSize: '0.85rem' }}>
              • Satisfied: ≤ T<br />
              • Tolerating: &gt; T and ≤ 4T<br />
              • Frustrated: &gt; 4T
            </Typography>
          </Alert>

          {isTransactionLevel && (
            <Alert severity="warning" sx={{ mb: 3 }}>
              This will override the test-level default threshold for this specific transaction only.
            </Alert>
          )}

          <TextField
            label="Apdex Threshold (milliseconds)"
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            fullWidth
            InputProps={{
              endAdornment: <InputAdornment position="end">ms</InputAdornment>,
            }}
            inputProps={{
              min: 1,
              max: 60000,
              step: 50,
            }}
            helperText="Valid range: 1-60,000 milliseconds"
            disabled={loading}
            sx={{ mb: 3 }}
          />

          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}

          {success && (
            <Alert severity="success" sx={{ mt: 2 }}>
              Threshold saved successfully!
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {isTransactionLevel && (
          <Button
            onClick={handleDelete}
            color="error"
            variant="outlined"
            disabled={loading}
            sx={{ mr: 'auto' }}
          >
            Reset to Test Default
          </Button>
        )}
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={loading || success}
          startIcon={loading && <CircularProgress size={16} />}
        >
          {loading ? 'Saving...' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
