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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { UseFormReturn } from 'react-hook-form';
import { TracingInstance } from '@/lib/distributed-tracing';
import { CreateTracingInstanceFormData } from '@/lib/validations';

interface TracingFormDialogProps {
  open: boolean;
  isEdit: boolean;
  form: UseFormReturn<CreateTracingInstanceFormData>;
  testingConnection: boolean;
  onClose: () => void;
  onSubmit: (data: CreateTracingInstanceFormData) => void;
  onTestConnection: (data: CreateTracingInstanceFormData) => void;
}

export function TracingFormDialog({
  open,
  isEdit,
  form,
  testingConnection,
  onClose,
  onSubmit,
  onTestConnection,
}: TracingFormDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <DialogTitle>
          {isEdit ? 'Edit Tracing Instance' : 'Add Tracing Instance'}
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
              placeholder="e.g., Production Tempo"
              fullWidth
              variant="outlined"
              sx={{ mb: 2 }}
              {...form.register('label')}
              error={!!form.formState.errors.label}
              helperText={form.formState.errors.label?.message}
            />
            <TextField
              label="Tracing URL"
              placeholder="https://tempo.example.com"
              fullWidth
              variant="outlined"
              sx={{ mb: 2 }}
              {...form.register('tracingUrl')}
              error={!!form.formState.errors.tracingUrl}
              helperText={form.formState.errors.tracingUrl?.message || "URL to your tracing instance"}
            />
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Tracing UI Type</InputLabel>
              <Select
                value={form.watch('tracingUi')}
                label="Tracing UI Type"
                onChange={(e) => form.setValue('tracingUi', e.target.value as 'tempo' | 'jaeger' | 'elastic')}
              >
                <MenuItem value="tempo">Grafana Tempo</MenuItem>
                <MenuItem value="jaeger">Jaeger</MenuItem>
                <MenuItem value="elastic">Elastic APM</MenuItem>
              </Select>
            </FormControl>
            {form.watch('tracingUi') === 'tempo' && (
              <TextField
                label="Backend API URL (Optional)"
                placeholder="http://tempo-api.internal:3200"
                fullWidth
                variant="outlined"
                sx={{ mb: 2 }}
                {...form.register('tracingApiUrl')}
                error={!!form.formState.errors.tracingApiUrl}
                helperText={form.formState.errors.tracingApiUrl?.message || "Internal API URL for server-side Tempo queries (e.g., for trace analysis). Leave empty to use the same URL as above."}
              />
            )}
            <FormControlLabel
              control={
                <Switch
                  checked={form.watch('tracingIframeAllowed')}
                  onChange={(e) => form.setValue('tracingIframeAllowed', e.target.checked)}
                />
              }
              label="Allow Iframe Embedding"
              sx={{ mb: 1 }}
            />
            <Typography variant="caption" color="text.secondary" display="block">
              Enable to embed the tracing UI directly in Perfana (requires CORS configuration on the tracing server)
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

interface TracingDeleteDialogProps {
  open: boolean;
  instance: TracingInstance | null;
  onClose: () => void;
  onConfirm: (instanceId: string) => void;
}

export function TracingDeleteDialog({
  open,
  instance,
  onClose,
  onConfirm,
}: TracingDeleteDialogProps) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Delete Tracing Instance</DialogTitle>
      <DialogContent>
        <Typography>
          Are you sure you want to delete the tracing instance "{instance?.label}"? This action cannot be undone.
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
