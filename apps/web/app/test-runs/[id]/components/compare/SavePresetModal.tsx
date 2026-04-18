'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControlLabel,
  Typography,
  Box,
  Alert,
  Chip,
  Radio,
  RadioGroup,
  FormControl,
  FormLabel
} from '@mui/material';
import { Save } from '@mui/icons-material';
import { CompareSeriesConfig } from '@/lib/compare-presets';

/**
 * Represents a series added for comparison (matching TrendsCard pattern)
 */
export interface CompareSeries {
  id: string;
  dashboardId: string;
  dashboardLabel: string;
  panelId: number;
  panelTitle: string;
  metricName: string;
  source: 'grafana' | 'dynatrace' | 'performance-metrics';
  metricsSourceId?: string;
}

interface SavePresetModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (presetData: PresetFormData) => Promise<void>;
  currentFilters: CurrentFilterState;
  currentTestRunId?: string;
  loading?: boolean;
}

export interface CurrentFilterState {
  selectedTestRun?: {
    test_run_id: string;
  } | null;
  selectedDashboard?: {
    id: string;
    dashboard_label: string;
  } | null;
  selectedMetric?: {
    id: number;
    title: string;
    applicationDashboardId?: string; // For Dynatrace metrics
  } | null;
  seriesSearchText: string;
  showPercentiles: boolean;
  source?: 'grafana' | 'dynatrace' | 'performance-metrics';
  addedSeries?: CompareSeries[]; // Series added for comparison
}

export interface PresetFormData {
  name: string;
  description: string;
  preset_type: 'generic' | 'specific';
  series_search_text: string;
  show_percentiles: boolean;
  application_dashboard_id?: string;
  source?: string;
  dashboard_label?: string;
  panel_id?: number;
  panel_title?: string;
  baseline_test_run_id?: string;
  series_config?: CompareSeriesConfig[]; // Series to restore when applying preset
  created_for_test_run_id?: string;
  is_global: boolean;
}

export default function SavePresetModal({
  open,
  onClose,
  onSave,
  currentFilters,
  currentTestRunId,
  loading = false
}: SavePresetModalProps) {
  // Helper functions for generating suggestions
  const generatePresetName = (): string => {
    const parts: string[] = [];

    // Include series count if series are added
    const seriesCount = currentFilters.addedSeries?.length || 0;
    if (seriesCount > 0) {
      parts.push(`${seriesCount} Series`);
    } else if (currentFilters.selectedMetric?.title) {
      parts.push(currentFilters.selectedMetric.title);
    }

    if (currentFilters.seriesSearchText) {
      const searchText = currentFilters.seriesSearchText.trim();
      if (searchText.length <= 20) {
        parts.push(`"${searchText}"`);
      } else {
        parts.push('Filtered');
      }
    }

    if (currentFilters.showPercentiles) {
      parts.push('Percentiles');
    }

    const presetType = currentFilters.selectedTestRun ? 'Specific' : 'Generic';

    if (parts.length === 0) {
      return `${presetType} Preset`;
    }

    return parts.join(' - ');
  };

  const generatePresetDescription = (): string => {
    const parts: string[] = [];

    // Include series info
    const seriesCount = currentFilters.addedSeries?.length || 0;
    if (seriesCount > 0) {
      parts.push(`${seriesCount} series to compare`);
      // List first few series names
      const seriesNames = currentFilters.addedSeries?.slice(0, 3).map(s => s.metricName) || [];
      if (seriesNames.length > 0) {
        parts.push(`Series: ${seriesNames.join(', ')}${seriesCount > 3 ? '...' : ''}`);
      }
    }

    if (currentFilters.selectedDashboard?.dashboard_label) {
      parts.push(`Dashboard: ${currentFilters.selectedDashboard.dashboard_label}`);
    }

    if (currentFilters.seriesSearchText) {
      parts.push(`Filter: "${currentFilters.seriesSearchText}"`);
    }

    if (currentFilters.showPercentiles) {
      parts.push('Includes percentile metrics');
    }

    if (currentFilters.selectedTestRun) {
      parts.push(`Baseline: ${currentFilters.selectedTestRun.test_run_id}`);
    }

    return parts.join('. ');
  };

  // Convert addedSeries to series_config format
  const getSeriesToSave = (): CompareSeriesConfig[] => {
    return (currentFilters.addedSeries || []).map(series => ({
      dashboardId: series.dashboardId,
      dashboardLabel: series.dashboardLabel,
      panelId: series.panelId,
      panelTitle: series.panelTitle,
      metricName: series.metricName,
      source: series.source,
      metricsSourceId: series.metricsSourceId
    }));
  };
  
  // Determine initial preset type based on test run selection
  const getInitialPresetType = (): 'generic' | 'specific' => {
    return currentFilters.selectedTestRun ? 'specific' : 'generic';
  };
  
  const [formData, setFormData] = useState<PresetFormData>({
    name: '',
    description: '',
    preset_type: getInitialPresetType(),
    series_search_text: currentFilters.seriesSearchText || '',
    show_percentiles: currentFilters.showPercentiles || false,
    application_dashboard_id: currentFilters.selectedDashboard?.id,
    panel_id: currentFilters.selectedMetric?.id,
    panel_title: currentFilters.selectedMetric?.title,
    baseline_test_run_id: currentFilters.selectedTestRun?.test_run_id,
    series_config: getSeriesToSave(),
    created_for_test_run_id: currentTestRunId,
    is_global: true
  });

  // Auto-generate suggestions when dialog opens or filters change
  useEffect(() => {
    if (open) {
      const suggestedName = generatePresetName();
      const suggestedDescription = generatePresetDescription();
      const initialPresetType = getInitialPresetType();

      setFormData(prev => ({
        ...prev,
        name: suggestedName,
        description: suggestedDescription,
        preset_type: initialPresetType,
        series_search_text: currentFilters.seriesSearchText || '',
        show_percentiles: currentFilters.showPercentiles || false,
        application_dashboard_id: currentFilters.selectedDashboard?.id,
        panel_id: currentFilters.selectedMetric?.id,
        panel_title: currentFilters.selectedMetric?.title,
        baseline_test_run_id: currentFilters.selectedTestRun?.test_run_id,
        series_config: getSeriesToSave(),
        created_for_test_run_id: currentTestRunId
      }));
    }
  }, [open, currentFilters, currentTestRunId]);

  const [errors, setErrors] = useState<{[key: string]: string}>({});

  const handleInputChange = (field: keyof PresetFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: {[key: string]: string} = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Preset name is required';
    }

    if (formData.preset_type === 'specific' && !formData.baseline_test_run_id) {
      newErrors.preset_type = 'Test run-specific presets require a baseline test run to be selected';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      await onSave(formData);
      handleClose();
    } catch (error) {
      console.error('Failed to save preset:', error);
    }
  };

  const handleClose = () => {
    // For Dynatrace, use the metric's applicationDashboardId (UUID from query config)
    // For Grafana, use the dashboard's id
    const applicationDashboardId = currentFilters.selectedMetric?.applicationDashboardId
      || currentFilters.selectedDashboard?.id;

    setFormData({
      name: '',
      description: '',
      preset_type: getInitialPresetType(),
      series_search_text: currentFilters.seriesSearchText || '',
      show_percentiles: currentFilters.showPercentiles || false,
      application_dashboard_id: applicationDashboardId,
      source: currentFilters.source || 'grafana',
      dashboard_label: currentFilters.selectedDashboard?.dashboard_label,
      panel_id: currentFilters.selectedMetric?.id,
      panel_title: currentFilters.selectedMetric?.title,
      baseline_test_run_id: currentFilters.selectedTestRun?.test_run_id,
      series_config: getSeriesToSave(),
      created_for_test_run_id: currentTestRunId,
      is_global: true
    });
    setErrors({});
    onClose();
  };

  // Valid configuration now requires added series instead of just dashboard/metric selection
  const hasValidConfiguration =
    (currentFilters.addedSeries && currentFilters.addedSeries.length > 0);

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <Save />
          Save Filter Preset
        </Box>
      </DialogTitle>
      <DialogContent>
        {!hasValidConfiguration && (
          <Alert severity="warning" sx={{ mb: 3 }}>
            Please add at least one series to the comparison before saving a preset.
          </Alert>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 1 }}>
          {/* Basic Information */}
          <Box>
            <Typography variant="h6" gutterBottom>
              Basic Information
            </Typography>
            
            <TextField
              fullWidth
              label="Preset Name"
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              error={!!errors.name}
              helperText={errors.name}
              sx={{ mb: 2 }}
              placeholder="e.g., Response Time Analysis"
            />
            
            <TextField
              fullWidth
              label="Description (Optional)"
              multiline
              rows={2}
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              placeholder="Describe what this preset is used for..."
            />
          </Box>

          {/* Preset Type */}
          <Box>
            <FormControl component="fieldset">
              <FormLabel component="legend">
                <Typography variant="h6" gutterBottom>
                  Preset Type
                </Typography>
              </FormLabel>
              <RadioGroup
                value={formData.preset_type}
                onChange={(e) => handleInputChange('preset_type', e.target.value)}
              >
                <FormControlLabel
                  value="generic"
                  control={<Radio />}
                  label={
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Generic Preset
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Reusable preset that can be applied to any test run (user selects baseline each time)
                      </Typography>
                    </Box>
                  }
                />
                <FormControlLabel
                  value="specific"
                  control={<Radio />}
                  label={
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Save for This Test Run Only
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Locked to current baseline test run selection - not reusable for other test runs
                      </Typography>
                    </Box>
                  }
                />
              </RadioGroup>
              {errors.preset_type && (
                <Typography variant="caption" color="error" sx={{ mt: 1 }}>
                  {errors.preset_type}
                </Typography>
              )}
            </FormControl>
          </Box>

          {/* Current Configuration Preview */}
          <Box>
            <Typography variant="h6" gutterBottom>
              Configuration to Save
            </Typography>

            {/* Added Series */}
            {currentFilters.addedSeries && currentFilters.addedSeries.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600, color: 'text.secondary' }}>
                  Series to Compare ({currentFilters.addedSeries.length})
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {currentFilters.addedSeries.map((series, index) => (
                    <Chip
                      key={series.id || index}
                      label={`${series.panelTitle} → ${series.metricName}`}
                      size="small"
                      sx={{
                        background: 'linear-gradient(135deg, rgba(25, 118, 210, 0.08) 0%, rgba(30, 136, 229, 0.12) 100%)',
                        border: '1px solid rgba(25, 118, 210, 0.3)',
                        color: 'primary.dark',
                        fontSize: '0.75rem'
                      }}
                    />
                  ))}
                </Box>
              </Box>
            )}

            {/* Other Configuration Options */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
              {currentFilters.seriesSearchText && (
                <Chip
                  label={`Filter: "${currentFilters.seriesSearchText}"`}
                  sx={{
                    background: 'linear-gradient(135deg, rgba(46, 125, 50, 0.08) 0%, rgba(76, 175, 80, 0.12) 100%)',
                    border: '1px solid rgba(76, 175, 80, 0.3)',
                    color: '#2e7d32'
                  }}
                />
              )}

              {currentFilters.showPercentiles && (
                <Chip
                  label="Show Percentiles"
                  sx={{
                    background: 'linear-gradient(135deg, rgba(245, 124, 0, 0.08) 0%, rgba(255, 152, 0, 0.12) 100%)',
                    border: '1px solid rgba(255, 152, 0, 0.3)',
                    color: '#f57c00'
                  }}
                />
              )}

              {formData.preset_type === 'specific' && currentFilters.selectedTestRun && (
                <Chip
                  label={`Baseline: ${currentFilters.selectedTestRun.test_run_id}`}
                  sx={{
                    background: 'linear-gradient(135deg, rgba(244, 67, 54, 0.08) 0%, rgba(244, 67, 54, 0.12) 100%)',
                    border: '1px solid rgba(244, 67, 54, 0.3)',
                    color: 'error.dark'
                  }}
                />
              )}
            </Box>
          </Box>

        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} color="inherit">
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={loading || !hasValidConfiguration}
          startIcon={<Save />}
        >
          {loading ? 'Saving...' : 'Save Preset'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}