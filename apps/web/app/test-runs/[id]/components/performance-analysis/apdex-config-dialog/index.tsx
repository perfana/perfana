'use client';

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
  Divider,
} from '@mui/material';
import { ApdexConfigDialogProps } from './types';
import { useApdexConfigDialog } from './hooks/useApdexConfigDialog';
import { SloConfigurationSection } from './components/SloConfigurationSection';

export default function ApdexConfigDialog({
  open,
  onClose,
  testRunId,
  transactionName,
  currentThreshold,
  onSuccess,
}: ApdexConfigDialogProps) {
  const {
    threshold,
    loading,
    error,
    success,
    enableSlo,
    minApdexScore,
    includeFailedRequests,
    testRunDetails,
    loadingTestRun,
    existingSlo,
    loadingSlo,
    setThreshold,
    setEnableSlo,
    setMinApdexScore,
    setIncludeFailedRequests,
    handleSave,
    handleDelete,
  } = useApdexConfigDialog({
    open,
    testRunId,
    transactionName,
    currentThreshold,
    onSuccess,
    onClose,
  });

  const isTransactionLevel = !!transactionName;
  const title = isTransactionLevel
    ? `Configure Apdex: ${transactionName}`
    : 'Configure Test-Level Apdex';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 2 }}>
          <Alert severity="info" sx={{ mb: 3 }}>
            <Typography variant="body2" gutterBottom>
              <strong>Apdex Threshold (T)</strong> defines the response time boundary for satisfied
              users.
            </Typography>
            <Typography variant="body2" sx={{ mt: 1, fontSize: '0.85rem' }}>
              • Satisfied: &le; T
              <br />
              • Tolerating: &gt; T and &le; 4T
              <br />• Frustrated: &gt; 4T
            </Typography>
          </Alert>

          {isTransactionLevel && (
            <Alert severity="warning" sx={{ mb: 3 }}>
              This will override the test-level default threshold for this specific transaction
              only.
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
            inputProps={{ min: 1, max: 60000, step: 50 }}
            helperText="Valid range: 1-60,000 milliseconds"
            disabled={loading}
            sx={{ mb: 3 }}
          />

          {!isTransactionLevel && (
            <>
              <Divider sx={{ my: 2 }} />
              <SloConfigurationSection
                enableSlo={enableSlo}
                setEnableSlo={setEnableSlo}
                minApdexScore={minApdexScore}
                setMinApdexScore={setMinApdexScore}
                includeFailedRequests={includeFailedRequests}
                setIncludeFailedRequests={setIncludeFailedRequests}
                loading={loading}
                loadingTestRun={loadingTestRun}
                loadingSlo={loadingSlo}
                testRunDetails={testRunDetails}
                existingSlo={existingSlo}
              />
            </>
          )}

          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}

          {success && (
            <Alert severity="success" sx={{ mt: 2 }}>
              Configuration saved successfully!
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

export type { ApdexConfigDialogProps } from './types';
