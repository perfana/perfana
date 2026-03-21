'use client';

import {
  Box,
  Typography,
  Grid,
  Button,
  IconButton,
  Chip,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  FormControl,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  Storage,
} from '@mui/icons-material';
import { UseFormReturn } from 'react-hook-form';
import { GrafanaInstance } from '@/lib/grafana-instances';
import { CreateGrafanaInstanceFormData } from '@/lib/validations';

interface GrafanaFormDialogProps {
  open: boolean;
  isEdit: boolean;
  form: UseFormReturn<CreateGrafanaInstanceFormData>;
  visiblePasswords: Set<string>;
  testingConnection: boolean;
  onClose: () => void;
  onSubmit: (data: CreateGrafanaInstanceFormData) => void;
  onTestConnection: (data: CreateGrafanaInstanceFormData) => void;
  onTogglePasswordVisibility: (id: string) => void;
}

export function GrafanaFormDialog({
  open,
  isEdit,
  form,
  visiblePasswords,
  testingConnection,
  onClose,
  onSubmit,
  onTestConnection,
  onTogglePasswordVisibility,
}: GrafanaFormDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <DialogTitle>
          {isEdit ? 'Edit Grafana Instance' : 'Add Grafana Instance'}
        </DialogTitle>
        <DialogContent>
          {form.formState.errors.root && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {form.formState.errors.root.message}
            </Alert>
          )}
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 12, sm: 6 }} key="label-field">
              <TextField
                autoFocus
                label="Label"
                placeholder="e.g., Production Grafana"
                fullWidth
                variant="outlined"
                {...form.register('label')}
                error={!!form.formState.errors.label}
                helperText={form.formState.errors.label?.message}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }} key="orgid-field">
              <TextField
                label="Organization ID"
                placeholder="1"
                fullWidth
                variant="outlined"
                {...form.register('orgId')}
                error={!!form.formState.errors.orgId}
                helperText={form.formState.errors.orgId?.message}
              />
            </Grid>
            <Grid size={{ xs: 12 }} key="clienturl-field">
              <TextField
                label="Client URL"
                placeholder="https://grafana.example.com"
                fullWidth
                variant="outlined"
                {...form.register('clientUrl')}
                error={!!form.formState.errors.clientUrl}
                helperText={form.formState.errors.clientUrl?.message || "URL used by browser clients to access Grafana"}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Server URL (Optional)"
                placeholder="http://grafana-internal:3000"
                fullWidth
                variant="outlined"
                {...form.register('serverUrl')}
                error={!!form.formState.errors.serverUrl}
                helperText={form.formState.errors.serverUrl?.message || "URL used by server-side components (if different from client URL)"}
              />
            </Grid>

            <Grid size={{ xs: 12 }}>
              <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>
                Authentication
              </Typography>
              <Divider sx={{ mb: 2 }} />
            </Grid>

            <Grid size={{ xs: 12 }}>
              <TextField
                label="API Key (Optional)"
                placeholder="glsa_..."
                fullWidth
                variant="outlined"
                {...form.register('apiKey')}
                error={!!form.formState.errors.apiKey}
                helperText={form.formState.errors.apiKey?.message || "Grafana Service Account token (recommended)"}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Username (Optional)"
                fullWidth
                variant="outlined"
                {...form.register('username')}
                error={!!form.formState.errors.username}
                helperText={form.formState.errors.username?.message || "For basic authentication"}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Password (Optional)"
                type={visiblePasswords.has('form') ? 'text' : 'password'}
                fullWidth
                variant="outlined"
                {...form.register('password')}
                error={!!form.formState.errors.password}
                helperText={form.formState.errors.password?.message || "For basic authentication"}
                InputProps={{
                  endAdornment: (
                    <IconButton
                      onClick={() => onTogglePasswordVisibility('form')}
                      edge="end"
                      size="small"
                    >
                      {visiblePasswords.has('form') ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  ),
                }}
              />
            </Grid>

            <Grid size={{ xs: 12 }}>
              <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>
                Instance Type
              </Typography>
              <Divider sx={{ mb: 2 }} />
            </Grid>

            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl>
                <Box display="flex" alignItems="center" gap={2}>
                  <Chip
                    icon={<Storage />}
                    label="Snapshot Instance"
                    clickable
                    color={form.watch('snapshotInstance') ? 'primary' : 'default'}
                    onClick={() => form.setValue('snapshotInstance', !form.watch('snapshotInstance'))}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Use for storing snapshots
                  </Typography>
                </Box>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl>
              </FormControl>
            </Grid>
          </Grid>
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

interface GrafanaDeleteDialogProps {
  open: boolean;
  instance: GrafanaInstance | null;
  onClose: () => void;
  onConfirm: (instanceId: string) => void;
}

export function GrafanaDeleteDialog({
  open,
  instance,
  onClose,
  onConfirm,
}: GrafanaDeleteDialogProps) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Delete Grafana Instance</DialogTitle>
      <DialogContent>
        <Typography>
          Are you sure you want to delete the Grafana instance "{instance?.label}"? This action cannot be undone.
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
