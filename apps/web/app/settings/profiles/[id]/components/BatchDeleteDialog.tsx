import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from '@mui/material';

interface BatchDeleteDialogProps {
  open: boolean;
  itemCount: number;
  itemType: 'dashboard' | 'SLO';
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * Reusable batch delete confirmation dialog
 */
export function BatchDeleteDialog({
  open,
  itemCount,
  itemType,
  onClose,
  onConfirm,
}: BatchDeleteDialogProps) {
  const pluralSuffix = itemCount > 1 ? 's' : '';
  const itemLabel = itemType === 'dashboard' ? 'Dashboard' : 'SLO';

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Delete Multiple {itemLabel}s</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Are you sure you want to delete {itemCount} {itemType}{pluralSuffix} from this profile?
          This action cannot be undone.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={onConfirm} color="error" variant="contained">
          Delete {itemCount} {itemLabel}{pluralSuffix}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
