'use client';

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  CircularProgress,
} from '@mui/material';
import { NotificationChannel } from '../types';

interface DeleteChannelDialogProps {
  open: boolean;
  channel: NotificationChannel | null;
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteChannelDialog({
  open,
  channel,
  saving,
  onClose,
  onConfirm,
}: DeleteChannelDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete Notification Channel</DialogTitle>
      <DialogContent>
        <Typography>
          Are you sure you want to delete the notification channel &quot;{channel?.name}&quot;?
          This action cannot be undone.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color="error"
          onClick={onConfirm}
          disabled={saving}
        >
          {saving ? <CircularProgress size={24} /> : 'Delete'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
