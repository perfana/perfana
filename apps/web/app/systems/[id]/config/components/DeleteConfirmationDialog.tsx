import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  CircularProgress,
  FormControlLabel,
  Checkbox,
  Alert,
  Box,
} from '@mui/material';

export interface GrafanaDeleteOption {
  canDeleteFromGrafana: boolean;
  grafanaDashboardName: string;
  grafanaDashboardUid: string;
  deleteFromGrafana: boolean;
  onDeleteFromGrafanaChange: (checked: boolean) => void;
}

interface DeleteConfirmationDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  title: string;
  message: string;
  itemName?: string;
  loading?: boolean;
  grafanaOption?: GrafanaDeleteOption;
}

export default function DeleteConfirmationDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  itemName,
  loading = false,
  grafanaOption,
}: DeleteConfirmationDialogProps) {
  const handleConfirm = async () => {
    await onConfirm();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography>
          {message}
        </Typography>
        {itemName && (
          <Typography variant="body2" sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
            <strong>{itemName}</strong>
          </Typography>
        )}
        {grafanaOption?.canDeleteFromGrafana && (
          <Box sx={{ mt: 2 }}>
            <Alert severity="warning" sx={{ mb: 2 }}>
              This dashboard is not used by any other system. You can optionally delete it from Grafana as well.
            </Alert>
            <FormControlLabel
              control={
                <Checkbox
                  checked={grafanaOption.deleteFromGrafana}
                  onChange={(e) => grafanaOption.onDeleteFromGrafanaChange(e.target.checked)}
                  color="error"
                />
              }
              label={
                <Typography variant="body2">
                  Also delete <strong>{grafanaOption.grafanaDashboardName}</strong> from Grafana
                </Typography>
              }
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          color="error"
          disabled={loading}
          startIcon={loading ? <CircularProgress size={16} /> : null}
        >
          {loading ? 'Deleting...' : 'Delete'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}