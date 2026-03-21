'use client';

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
} from '@mui/material';
import { TracingService } from '../types';

interface TracingDeleteDialogProps {
  open: boolean;
  service: TracingService | null;
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function TracingDeleteDialog({
  open,
  service,
  saving,
  onClose,
  onConfirm,
}: TracingDeleteDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm">
      <DialogTitle>Delete Tracing Service</DialogTitle>
      <DialogContent>
        <Typography>
          Are you sure you want to delete this tracing service configuration? This
          action cannot be undone.
        </Typography>
        {service && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" color="text.secondary">
              <strong>Instance:</strong>{' '}
              {service.tracingInstance
                ? service.tracingInstance.label
                : `ID: ${service.tracingInstanceId}`}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              <strong>Services:</strong> {service.serviceNames.join(', ')}
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          onClick={onConfirm}
          color="error"
          variant="contained"
          disabled={saving}
        >
          {saving ? 'Deleting...' : 'Delete'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
