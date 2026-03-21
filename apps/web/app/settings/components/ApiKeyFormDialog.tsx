'use client';

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Typography,
} from '@mui/material';
import { UseFormReturn } from 'react-hook-form';
import { CreateApiKeyFormData } from '@/lib/validations';
import { TTL_OPTIONS } from '../types';
import { Organization } from '@/lib/api/organizations';

interface ApiKeyFormDialogProps {
  open: boolean;
  form: UseFormReturn<CreateApiKeyFormData>;
  organizations: Organization[];
  onClose: () => void;
  onSubmit: (data: CreateApiKeyFormData) => Promise<void>;
}

export function ApiKeyFormDialog({
  open,
  form,
  organizations,
  onClose,
  onSubmit,
}: ApiKeyFormDialogProps) {
  const handleClose = () => {
    onClose();
    form.reset();
  };

  // Show organization selector only if user belongs to multiple organizations
  const showOrganizationSelector = organizations.length > 1;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: '12px',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)',
        },
      }}
    >
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <DialogTitle sx={{ fontWeight: 600, fontSize: '1.25rem', pb: 1 }}>
          Create New API Key
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Make sure to copy your API key after creation. You won&apos;t be able to see it
            again!
          </Alert>

          {form.formState.errors.root && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {form.formState.errors.root.message}
            </Alert>
          )}

          <TextField
            autoFocus
            margin="dense"
            label="Description"
            placeholder="e.g., CI/CD Pipeline, Development Testing"
            fullWidth
            variant="outlined"
            {...form.register('description')}
            error={!!form.formState.errors.description}
            helperText={form.formState.errors.description?.message}
            sx={{ mb: 2 }}
          />

          <FormControl
            fullWidth
            variant="outlined"
            error={!!form.formState.errors.ttl}
            sx={{ mb: 2 }}
          >
            <InputLabel>Time to Live (TTL)</InputLabel>
            <Select
              {...form.register('ttl')}
              value={form.watch('ttl')}
              onChange={(e) => form.setValue('ttl', e.target.value)}
              label="Time to Live (TTL)"
            >
              {TTL_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
            {form.formState.errors.ttl && (
              <Typography variant="caption" color="error" sx={{ mt: 1 }}>
                {form.formState.errors.ttl.message}
              </Typography>
            )}
          </FormControl>

          {/* Organization Selector - shown only for multi-org users */}
          {showOrganizationSelector && (
            <FormControl
              fullWidth
              variant="outlined"
              error={!!form.formState.errors.organizationId}
            >
              <InputLabel>Organization</InputLabel>
              <Select
                {...form.register('organizationId')}
                value={form.watch('organizationId') || ''}
                onChange={(e) => form.setValue('organizationId', e.target.value || undefined)}
                label="Organization"
              >
                {organizations.map((org) => (
                  <MenuItem key={org.id} value={org.id}>
                    {org.name}
                  </MenuItem>
                ))}
              </Select>
              {form.formState.errors.organizationId && (
                <Typography variant="caption" color="error" sx={{ mt: 1 }}>
                  {form.formState.errors.organizationId.message}
                </Typography>
              )}
            </FormControl>
          )}

          {/* Info message for single-org users */}
          {!showOrganizationSelector && organizations.length === 1 && (
            <Alert severity="info" sx={{ mt: 2 }}>
              This API key will be created for organization: <strong>{organizations[0].name}</strong>
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button
            onClick={handleClose}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              color: 'text.secondary',
            }}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={form.formState.isSubmitting}
            sx={{
              background:
                'linear-gradient(135deg, rgba(25, 118, 210, 1) 0%, rgba(30, 136, 229, 1) 100%)',
              boxShadow: '0 2px 8px rgba(25, 118, 210, 0.3)',
              textTransform: 'none',
              fontWeight: 600,
              '&:hover': {
                background:
                  'linear-gradient(135deg, rgba(21, 101, 192, 1) 0%, rgba(25, 118, 210, 1) 100%)',
                boxShadow: '0 4px 12px rgba(25, 118, 210, 0.4)',
              },
              '&:disabled': {
                background: 'rgba(0, 0, 0, 0.12)',
              },
            }}
          >
            {form.formState.isSubmitting ? 'Creating...' : 'Create Key'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
