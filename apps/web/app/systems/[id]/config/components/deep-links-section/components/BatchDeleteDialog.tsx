'use client';

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from '@mui/material';
import { BatchDeleteDialogProps } from '../types';

export function BatchDeleteDialog({
  open,
  selectedCount,
  loading,
  onConfirm,
  onCancel,
}: BatchDeleteDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogTitle>Delete Multiple Deep Links</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Are you sure you want to delete {selectedCount} deep link{selectedCount > 1 ? 's' : ''}? This action cannot be undone.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button onClick={onConfirm} color="error" variant="contained" disabled={loading}>
          Delete {selectedCount} Deep Link{selectedCount > 1 ? 's' : ''}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
