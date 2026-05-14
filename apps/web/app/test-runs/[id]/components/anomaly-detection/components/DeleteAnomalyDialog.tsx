import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Typography,
  Box,
  Divider
} from '@mui/material';
import { AnomalyData } from '../types';

export interface DeleteOptions {
  scope: 'metric' | 'panel';
  range: 'current-test-run' | 'all-test-runs';
}

interface DeleteAnomalyDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (options: DeleteOptions) => void;
  anomalyData: AnomalyData | null;
  loading?: boolean;
}

export default function DeleteAnomalyDialog({
  open,
  onClose,
  onConfirm,
  anomalyData,
  loading = false
}: DeleteAnomalyDialogProps) {
  const [scope, setScope] = useState<'metric' | 'panel'>('metric');
  const [range, setRange] = useState<'current-test-run' | 'all-test-runs'>('current-test-run');

  const handleConfirm = () => {
    onConfirm({ scope, range });
  };

  const handleClose = () => {
    if (!loading) {
      onClose();
    }
  };

  if (!anomalyData) return null;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>
        <Typography variant="h6" component="div">
          Delete Anomaly Data
        </Typography>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            <strong>Dashboard:</strong> {anomalyData.dashboard_label}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            <strong>Panel:</strong> {anomalyData.panel_title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            <strong>Metric:</strong> {anomalyData.metric_name}
          </Typography>
        </Box>

        <Divider sx={{ my: 3 }} />

        <FormControl component="fieldset" sx={{ mb: 3, width: '100%' }}>
          <FormLabel component="legend" sx={{ mb: 2, color: 'text.primary', fontWeight: 600 }}>
            What to delete?
          </FormLabel>
          <RadioGroup
            value={scope}
            onChange={(e) => setScope(e.target.value as 'metric' | 'panel')}
          >
            <FormControlLabel
              value="metric"
              control={<Radio />}
              label={
                <Box>
                  <Typography variant="body2" fontWeight={500}>
                    Delete this metric only
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {`Remove only "${anomalyData.metric_name}" from this panel`}
                  </Typography>
                </Box>
              }
            />
            <FormControlLabel
              value="panel"
              control={<Radio />}
              label={
                <Box>
                  <Typography variant="body2" fontWeight={500}>
                    Delete all metrics in this panel
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {`Remove all metrics from "${anomalyData.panel_title}"`}
                  </Typography>
                </Box>
              }
            />
          </RadioGroup>
        </FormControl>

        <FormControl component="fieldset" sx={{ width: '100%' }}>
          <FormLabel component="legend" sx={{ mb: 2, color: 'text.primary', fontWeight: 600 }}>
            Delete for which test runs?
          </FormLabel>
          <RadioGroup
            value={range}
            onChange={(e) => setRange(e.target.value as 'current-test-run' | 'all-test-runs')}
          >
            <FormControlLabel
              value="current-test-run"
              control={<Radio />}
              label={
                <Box>
                  <Typography variant="body2" fontWeight={500}>
                    Delete for this test run only
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Remove data only from the current test run
                  </Typography>
                </Box>
              }
            />
            <FormControlLabel
              value="all-test-runs"
              control={<Radio />}
              label={
                <Box>
                  <Typography variant="body2" fontWeight={500}>
                    Delete for all test runs
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Remove data from all test runs (permanent deletion)
                  </Typography>
                </Box>
              }
            />
          </RadioGroup>
        </FormControl>

        <Box sx={{ mt: 3, p: 2, bgcolor: 'warning.light', borderRadius: 1 }}>
          <Typography variant="body2" color="white">
            <strong>Warning:</strong> This action cannot be undone.
            {range === 'all-test-runs' && ' Deleting for all test runs will permanently remove this data from your entire system.'}
          </Typography>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          onClick={handleClose}
          disabled={loading}
          color="inherit"
        >
          Cancel
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          color="error"
          disabled={loading}
        >
          {loading ? 'Deleting...' : 'Delete'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}