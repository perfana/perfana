'use client';

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormHelperText,
  TextField,
  Chip,
} from '@mui/material';
import { Save as SaveIcon } from '@mui/icons-material';
import { Autocomplete } from '@mui/material';
import {
  TracingInstance,
  TracingServiceFormData,
  ConfigLevel,
} from '../types';

interface TracingServiceDialogProps {
  open: boolean;
  isEdit: boolean;
  formData: TracingServiceFormData;
  saving: boolean;
  tracingInstances: TracingInstance[];
  availableEnvironments: string[];
  availableWorkloads: string[];
  onFormChange: (field: keyof TracingServiceFormData, value: unknown) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export function TracingServiceDialog({
  open,
  isEdit,
  formData,
  saving,
  tracingInstances,
  availableEnvironments,
  availableWorkloads,
  onFormChange,
  onClose,
  onSubmit,
}: TracingServiceDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {isEdit ? 'Edit Tracing Service' : 'Add Tracing Service'}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 2 }}>
          {/* Level Selector */}
          <FormControl fullWidth>
            <InputLabel>Configuration Level</InputLabel>
            <Select
              value={formData.level}
              label="Configuration Level"
              onChange={(e) => onFormChange('level', e.target.value as ConfigLevel)}
              disabled={saving}
            >
              <MenuItem value="system">System</MenuItem>
              <MenuItem value="environment">Environment</MenuItem>
              <MenuItem value="workload">Workload</MenuItem>
            </Select>
            <FormHelperText>
              System applies to all environments, Environment to all workloads,
              Workload is specific
            </FormHelperText>
          </FormControl>

          {/* Environment Selector */}
          {formData.level !== 'system' && (
            <FormControl fullWidth>
              <InputLabel>Environment</InputLabel>
              <Select
                value={formData.environment}
                label="Environment"
                onChange={(e) => onFormChange('environment', e.target.value)}
                disabled={saving}
              >
                {availableEnvironments.map((env) => (
                  <MenuItem key={env} value={env}>
                    {env}
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>Select the test environment</FormHelperText>
            </FormControl>
          )}

          {/* Workload Selector */}
          {formData.level === 'workload' && (
            <FormControl fullWidth>
              <InputLabel>Workload</InputLabel>
              <Select
                value={formData.workload}
                label="Workload"
                onChange={(e) => onFormChange('workload', e.target.value)}
                disabled={saving}
              >
                {availableWorkloads.map((workload) => (
                  <MenuItem key={workload} value={workload}>
                    {workload}
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>Select the workload</FormHelperText>
            </FormControl>
          )}

          {/* Tracing Instance Selector */}
          <FormControl fullWidth>
            <InputLabel>Tracing Instance</InputLabel>
            <Select
              value={formData.tracing_instance_id}
              label="Tracing Instance"
              onChange={(e) => onFormChange('tracing_instance_id', e.target.value)}
              disabled={saving}
            >
              {tracingInstances.length === 0 ? (
                <MenuItem disabled value="">
                  No tracing instances available - configure in Settings
                </MenuItem>
              ) : (
                tracingInstances.map((instance) => (
                  <MenuItem key={instance.id} value={instance.id}>
                    {instance.label} ({instance.tracing_ui.toUpperCase()})
                  </MenuItem>
                ))
              )}
            </Select>
            <FormHelperText>
              Select a tracing instance configured in Settings → Integrations
            </FormHelperText>
          </FormControl>

          {/* Service Names Input */}
          <Autocomplete
            multiple
            freeSolo
            options={[]}
            value={formData.service_names}
            onChange={(_, newValue) => {
              onFormChange('service_names', newValue);
            }}
            disabled={saving}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => (
                <Chip
                  variant="outlined"
                  label={option}
                  {...getTagProps({ index })}
                  key={index}
                />
              ))
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="Service Names"
                placeholder="Type a service name and press Enter"
                helperText="Add service names to trace (e.g., user-service, order-service). Press Enter after each name."
              />
            )}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          onClick={onSubmit}
          variant="contained"
          startIcon={<SaveIcon />}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
