'use client';

import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Switch,
  FormControlLabel,
} from '@mui/material';
import { UseFormReturn } from 'react-hook-form';
import { PyroscopeInstance } from '@/lib/pyroscope';
import { CreatePyroscopeInstanceFormData } from '@/lib/validations';

interface PyroscopeFormDialogProps {
  open: boolean;
  isEdit: boolean;
  form: UseFormReturn<CreatePyroscopeInstanceFormData>;
  testingConnection: boolean;
  onClose: () => void;
  onSubmit: (data: CreatePyroscopeInstanceFormData) => void;
  onTestConnection: (data: CreatePyroscopeInstanceFormData) => void;
}

export function PyroscopeFormDialog({
  open,
  isEdit,
  form,
  testingConnection,
  onClose,
  onSubmit,
  onTestConnection,
}: PyroscopeFormDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <DialogTitle>
          {isEdit ? 'Edit Pyroscope Instance' : 'Add Pyroscope Instance'}
        </DialogTitle>
        <DialogContent>
          {form.formState.errors.root && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {form.formState.errors.root.message}
            </Alert>
          )}
          <Box sx={{ mt: 1 }}>
            <TextField
              autoFocus
              label="Label"
              placeholder="e.g., Production Pyroscope"
              fullWidth
              variant="outlined"
              sx={{ mb: 2 }}
              {...form.register('label')}
              error={!!form.formState.errors.label}
              helperText={form.formState.errors.label?.message}
            />
            <TextField
              label="Pyroscope URL"
              placeholder="https://pyroscope.example.com"
              fullWidth
              variant="outlined"
              sx={{ mb: 2 }}
              {...form.register('pyroscopeUrl')}
              error={!!form.formState.errors.pyroscopeUrl}
              helperText={form.formState.errors.pyroscopeUrl?.message || "URL to your Pyroscope instance"}
            />
            <TextField
              label="Backend API URL (Optional)"
              placeholder="http://localhost:4040"
              fullWidth
              variant="outlined"
              sx={{ mb: 2 }}
              {...form.register('backendUrl')}
              error={!!form.formState.errors.backendUrl}
              helperText={form.formState.errors.backendUrl?.message || "API URL for programmatic access (e.g., standalone Pyroscope). Leave empty to use the same URL as above."}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={form.watch('pyroscopeStandAlone')}
                  onChange={(e) => form.setValue('pyroscopeStandAlone', e.target.checked)}
                />
              }
              label="Standalone Mode"
              sx={{ mb: 1 }}
            />
            <Typography variant="caption" color="text.secondary" display="block">
              Enable if Pyroscope is running in standalone mode (not integrated with Grafana)
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          {!isEdit && (
            <Button
              onClick={form.handleSubmit(onTestConnection)}
              variant="outlined"
              disabled={testingConnection}
            >
              {testingConnection ? 'Testing...' : 'Test Connection'}
            </Button>
          )}
          <Button
            type="submit"
            variant="contained"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting
              ? (isEdit ? 'Updating...' : 'Adding...')
              : `${isEdit ? 'Update' : 'Add'} Instance`
            }
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

interface PyroscopeDeleteDialogProps {
  open: boolean;
  instance: PyroscopeInstance | null;
  onClose: () => void;
  onConfirm: (instanceId: string) => void;
}

export function PyroscopeDeleteDialog({
  open,
  instance,
  onClose,
  onConfirm,
}: PyroscopeDeleteDialogProps) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Delete Pyroscope Instance</DialogTitle>
      <DialogContent>
        <Typography>
          Are you sure you want to delete the Pyroscope instance "{instance?.label}"? This action cannot be undone.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={() => instance && onConfirm(instance.id)}
          color="error"
          variant="contained"
        >
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  );
}
