'use client';

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
} from '@mui/material';
import { ApiKey } from '@/lib/api-keys';

interface ApiKeyDeleteDialogProps {
  open: boolean;
  apiKey: ApiKey | null;
  onClose: () => void;
  onConfirm: (keyId: string) => Promise<void>;
}

export function ApiKeyDeleteDialog({
  open,
  apiKey,
  onClose,
  onConfirm,
}: ApiKeyDeleteDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          borderRadius: '12px',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)',
        },
      }}
    >
      <DialogTitle sx={{ fontWeight: 600, fontSize: '1.25rem', pb: 1 }}>
        Delete API Key
      </DialogTitle>
      <DialogContent>
        <Typography>
          Are you sure you want to delete the API key &quot;{apiKey?.description}&quot;?
          This action cannot be undone.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button
          onClick={onClose}
          sx={{
            textTransform: 'none',
            fontWeight: 600,
            color: 'text.secondary',
          }}
        >
          Cancel
        </Button>
        <Button
          onClick={() => apiKey && onConfirm(apiKey.id)}
          variant="contained"
          sx={{
            background: 'linear-gradient(135deg, #f44336 0%, #ef5350 100%)',
            boxShadow: '0 2px 8px rgba(244, 67, 54, 0.3)',
            textTransform: 'none',
            fontWeight: 600,
            '&:hover': {
              background: 'linear-gradient(135deg, #d32f2f 0%, #f44336 100%)',
              boxShadow: '0 4px 12px rgba(244, 67, 54, 0.4)',
            },
          }}
        >
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  );
}
