import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  Typography,
  FormControlLabel,
  RadioGroup,
  Radio,
  CircularProgress,
} from '@mui/material';
import { PresetType } from '@/lib/trends-presets';
import { DataSource } from './types';

export interface CurrentFilterState {
  selectedDashboard: {
    id: string;
    dashboard_label: string;
  } | null;
  selectedMetric: {
    id: number;
    title: string;
    applicationDashboardId?: string; // For Dynatrace metrics
  } | null;
  evaluateType: string;
  source?: DataSource;
}

export interface PresetFormData {
  name: string;
  description: string;
  preset_type: string;
  application_dashboard_id?: string;
  panel_id?: number;
  panel_title?: string;
  evaluate_type?: string;
  source?: string;
  dashboard_label?: string;
  created_for_test_run_id: string;
  is_global: boolean;
}

interface SaveTrendsPresetModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: PresetFormData) => Promise<void>;
  loading: boolean;
  currentTestRunId: string;
  currentFilters: CurrentFilterState;
}

export default function SaveTrendsPresetModal({
  open,
  onClose,
  onSave,
  loading,
  currentTestRunId,
  currentFilters
}: SaveTrendsPresetModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [presetType, setPresetType] = useState<PresetType>(PresetType.GENERIC);
  const [errors, setErrors] = useState<{ name?: string }>({});

  // Prefill name and description when modal opens
  useEffect(() => {
    if (open && currentFilters.selectedMetric && currentFilters.selectedDashboard) {
      // Set both name and description to "dashboard_label | panel_title"
      const prefillValue = `${currentFilters.selectedDashboard.dashboard_label} | ${currentFilters.selectedMetric.title}`;
      setName(prefillValue);
      setDescription(prefillValue);
    }
  }, [open, currentFilters]);

  const handleSave = async () => {
    // Validate
    const newErrors: { name?: string } = {};
    if (!name.trim()) {
      newErrors.name = 'Name is required';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Prepare data
    // For Dynatrace, use the metric's applicationDashboardId (UUID from query config)
    // For Grafana, use the dashboard's id
    const applicationDashboardId = currentFilters.selectedMetric?.applicationDashboardId
      || currentFilters.selectedDashboard?.id;

    const presetData: PresetFormData = {
      name: name.trim(),
      description: description.trim(),
      preset_type: presetType,
      application_dashboard_id: applicationDashboardId,
      panel_id: currentFilters.selectedMetric?.id,
      panel_title: currentFilters.selectedMetric?.title,
      evaluate_type: currentFilters.evaluateType,
      source: currentFilters.source || 'grafana',
      dashboard_label: currentFilters.selectedDashboard?.dashboard_label,
      created_for_test_run_id: currentTestRunId,
      is_global: true
    };

    try {
      await onSave(presetData);
      // Reset form
      setName('');
      setDescription('');
      setPresetType(PresetType.GENERIC);
      setErrors({});
      onClose();
    } catch (error) {
      console.error('Error saving preset:', error);
    }
  };

  const handleClose = () => {
    if (!loading) {
      // Reset form
      setName('');
      setDescription('');
      setPresetType(PresetType.GENERIC);
      setErrors({});
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Save Trends Filter Preset</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
          {/* Current Selection Summary */}
          <Box sx={{
            p: 2,
            backgroundColor: 'action.hover',
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider'
          }}>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
              Current Filter Settings
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Source: {currentFilters.source === 'dynatrace' ? 'Dynatrace' : currentFilters.source === 'performance-metrics' ? 'Performance Metrics' : 'Grafana'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Dashboard: {currentFilters.selectedDashboard?.dashboard_label || 'None'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Metric: {currentFilters.selectedMetric?.title || 'None'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Aggregation: {currentFilters.evaluateType || 'avg'}
            </Typography>
          </Box>

          {/* Preset Name */}
          <TextField
            label="Preset Name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (errors.name) {
                setErrors({ ...errors, name: undefined });
              }
            }}
            error={!!errors.name}
            helperText={errors.name}
            fullWidth
            required
            disabled={loading}
            placeholder="e.g., 'Response Time Trends' or 'CPU Usage Analysis'"
          />

          {/* Description */}
          <TextField
            label="Description (Optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={2}
            disabled={loading}
            placeholder="Brief description of what this preset is for"
          />

          {/* Preset Type */}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
              Preset Type
            </Typography>
            <RadioGroup
              value={presetType}
              onChange={(e) => setPresetType(e.target.value as PresetType)}
            >
              <FormControlLabel
                value={PresetType.GENERIC}
                control={<Radio size="small" />}
                label={
                  <Box>
                    <Typography variant="body2">Generic</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Can be applied to any test run with similar metrics
                    </Typography>
                  </Box>
                }
                disabled={loading}
              />
              <FormControlLabel
                value={PresetType.SPECIFIC}
                control={<Radio size="small" />}
                label={
                  <Box>
                    <Typography variant="body2">Test Run Specific</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Optimized for this particular test run
                    </Typography>
                  </Box>
                }
                disabled={loading}
              />
            </RadioGroup>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={loading || !currentFilters.selectedDashboard || !currentFilters.selectedMetric}
          startIcon={loading ? <CircularProgress size={20} /> : null}
        >
          {loading ? 'Saving...' : 'Save Preset'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}