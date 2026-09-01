'use client';

import {
  Box,
  Typography,
  Button,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  CircularProgress,
  FormControl,
  FormControlLabel,
  Switch,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { UseFormReturn } from 'react-hook-form';
import { DynatraceConfig, DynatraceRequestAttribute } from '@/lib/dynatrace';
import { CreateDynatraceConfigFormData, CreateDynatraceConfigFormInput } from '@/lib/validations';

interface DynatraceFormDialogProps {
  open: boolean;
  isEdit: boolean;
  // Mirrors useDynatraceIntegration's useForm: the schema's `.default('saas')` splits
  // zod's input and output types, so the field values are the input shape.
  form: UseFormReturn<CreateDynatraceConfigFormInput, unknown, CreateDynatraceConfigFormData>;
  testingConnection: boolean;
  requestAttributes: DynatraceRequestAttribute[];
  loadingAttributes: boolean;
  selectedTestRunIdAttribute: string;
  selectedRequestNameAttribute: string;
  proxyConfigured: boolean;
  onClose: () => void;
  onSubmit: (data: CreateDynatraceConfigFormData) => void;
  onTestConnection: (data: CreateDynatraceConfigFormData) => void;
  onTestRunIdAttributeChange: (value: string) => void;
  onRequestNameAttributeChange: (value: string) => void;
}

export function DynatraceFormDialog({
  open,
  isEdit,
  form,
  testingConnection,
  requestAttributes,
  loadingAttributes,
  selectedTestRunIdAttribute,
  selectedRequestNameAttribute,
  proxyConfigured,
  onClose,
  onSubmit,
  onTestConnection,
  onTestRunIdAttributeChange,
  onRequestNameAttributeChange,
}: DynatraceFormDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <form onSubmit={form.handleSubmit(onSubmit)} autoComplete="off">
        <DialogTitle>
          {isEdit ? 'Edit Dynatrace Configuration' : 'Configure Dynatrace'}
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
              placeholder="Production Dynatrace"
              fullWidth
              variant="outlined"
              autoComplete="off"
              sx={{ mb: 2 }}
              {...form.register('label')}
              error={!!form.formState.errors.label}
              helperText={form.formState.errors.label?.message || "A friendly name for this Dynatrace configuration"}
            />
            <TextField
              label="Server URL"
              placeholder="https://your-tenant.dynatrace.com"
              fullWidth
              variant="outlined"
              autoComplete="off"
              sx={{ mb: 2 }}
              // readOnly, not disabled: the value stays legible and focusable,
              // and the helper text explaining the lock stays readable too.
              InputProps={{ readOnly: isEdit }}
              {...form.register('host')}
              error={!!form.formState.errors.host}
              helperText={form.formState.errors.host?.message || (isEdit
                ? 'The server URL cannot be changed after creation'
                : 'URL used by server-side components to reach Dynatrace')}
            />
            <TextField
              label="Client URL (Optional)"
              placeholder="https://dynatrace.corp.example.com"
              fullWidth
              variant="outlined"
              autoComplete="off"
              sx={{ mb: 2 }}
              {...form.register('clientUrl')}
              error={!!form.formState.errors.clientUrl}
              helperText={form.formState.errors.clientUrl?.message || (form.watch('dynatraceType') === 'managed'
                ? 'URL used by browser clients for deep links, environment path included (…/e/<env-id>)'
                : 'URL used by browser clients for deep links (if different from server URL)')}
            />
            <TextField
              label="API Token"
              placeholder={isEdit ? 'Leave blank to keep existing' : 'dt0c01.XXXXXXXXXXXX.YYYYYYYYYYYY'}
              fullWidth
              variant="outlined"
              type="password"
              autoComplete="new-password"
              sx={{ mb: 2 }}
              {...form.register('apiToken')}
              error={!!form.formState.errors.apiToken}
              helperText={form.formState.errors.apiToken?.message || (isEdit ? 'Leave blank to keep the existing token' : 'Dynatrace API token with required permissions')}
            />
            {form.watch('dynatraceType') === 'saas' && (
              <TextField
                label="Platform API Token (Optional)"
                placeholder={isEdit ? 'Leave blank to keep existing' : 'dt0s16.XXXXXXXXXXXX.YYYYYYYYYYYY'}
                fullWidth
                variant="outlined"
                type="password"
                autoComplete="new-password"
                sx={{ mb: 2 }}
                {...form.register('platformApiToken')}
                error={!!form.formState.errors.platformApiToken}
                helperText={form.formState.errors.platformApiToken?.message || (isEdit ? 'Leave blank to keep the existing token' : 'OAuth client token for DQL queries (Grail Platform API)')}
              />
            )}
            <TextField
              select
              label="Deployment Type"
              fullWidth
              variant="outlined"
              defaultValue="saas"
              {...form.register('dynatraceType')}
              error={!!form.formState.errors.dynatraceType}
              helperText={form.formState.errors.dynatraceType?.message || "Select SaaS for cloud or Managed for on-premise"}
            >
              <MenuItem value="saas">SaaS (Cloud)</MenuItem>
              <MenuItem value="managed">Managed (On-Premise)</MenuItem>
            </TextField>

            {/* Proxy Section */}
            <FormControlLabel
              sx={{ mt: 1 }}
              control={
                <Switch
                  checked={form.watch('useProxy') ?? false}
                  onChange={(e) => form.setValue('useProxy', e.target.checked)}
                  disabled={!proxyConfigured}
                />
              }
              label="Use proxy"
            />
            {!proxyConfigured && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                Configure a proxy under Settings first
              </Typography>
            )}

            {/* Request Attributes Section */}
            {(loadingAttributes || requestAttributes.length > 0) && (
              <>
                <Typography variant="subtitle2" gutterBottom sx={{ mt: 3, mb: 1 }}>
                  Request Attributes (Optional)
                </Typography>
                <Divider sx={{ mb: 2 }} />

                {loadingAttributes ? (
                  <Box display="flex" alignItems="center" py={2}>
                    <CircularProgress size={20} sx={{ mr: 1 }} />
                    <Typography variant="body2">Loading request attributes...</Typography>
                  </Box>
                ) : requestAttributes.length === 0 ? (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    Test the connection to load available request attributes.
                  </Alert>
                ) : (
                  <>
                    <FormControl fullWidth sx={{ mb: 2 }}>
                      <InputLabel>Test Run ID Attribute</InputLabel>
                      <Select
                        label="Test Run ID Attribute"
                        value={selectedTestRunIdAttribute}
                        onChange={(e) => onTestRunIdAttributeChange(e.target.value)}
                      >
                        <MenuItem value="">
                          <em>None</em>
                        </MenuItem>
                        {requestAttributes.map((attr) => (
                          <MenuItem key={attr.id} value={attr.id}>
                            {attr.name} ({attr.id})
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>

                    <FormControl fullWidth>
                      <InputLabel>Request Name Attribute</InputLabel>
                      <Select
                        label="Request Name Attribute"
                        value={selectedRequestNameAttribute}
                        onChange={(e) => onRequestNameAttributeChange(e.target.value)}
                      >
                        <MenuItem value="">
                          <em>None</em>
                        </MenuItem>
                        {requestAttributes.map((attr) => (
                          <MenuItem key={attr.id} value={attr.id}>
                            {attr.name} ({attr.id})
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </>
                )}
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          {!isEdit && (
            <Button
              onClick={form.handleSubmit(onTestConnection)}
              variant="outlined"
              disabled={testingConnection || form.formState.isSubmitting}
              startIcon={testingConnection ? <CircularProgress size={16} /> : undefined}
            >
              {testingConnection ? 'Testing...' : 'Test Connection'}
            </Button>
          )}
          <Button
            type="submit"
            variant="contained"
            disabled={form.formState.isSubmitting || testingConnection}
          >
            {form.formState.isSubmitting
              ? (isEdit ? 'Updating...' : 'Configuring...')
              : (isEdit ? 'Update' : 'Configure')
            }
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

interface DynatraceDeleteDialogProps {
  open: boolean;
  config: DynatraceConfig | null;
  onClose: () => void;
  onConfirm: (configId: string) => void;
}

export function DynatraceDeleteDialog({
  open,
  config,
  onClose,
  onConfirm,
}: DynatraceDeleteDialogProps) {
  const hostname = config ? (() => {
    try {
      return new URL(config.host).hostname;
    } catch {
      return config.host;
    }
  })() : '';

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Delete Dynatrace Configuration</DialogTitle>
      <DialogContent>
        <Typography>
          {`Are you sure you want to delete the Dynatrace configuration for "${hostname}"? This action cannot be undone.`}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={() => config && onConfirm(config.id)}
          color="error"
          variant="contained"
        >
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  );
}
