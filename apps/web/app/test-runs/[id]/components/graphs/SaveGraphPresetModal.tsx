'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Box,
  Alert,
  Chip,
  Radio,
  RadioGroup,
  FormControl,
  FormLabel,
  FormControlLabel
} from '@mui/material';
import { Save } from '@mui/icons-material';
import type { SeriesConfig } from '@/lib/graph-presets';
import { GraphPresetUtils } from '@/lib/graph-presets';

interface SaveGraphPresetModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (presetData: GraphPresetFormData) => Promise<void>;
  currentTestRunId?: string;
  currentSeriesConfig: SeriesConfig[];
  loading?: boolean;
  defaultName?: string;
}

export interface GraphPresetFormData {
  name: string;
  description: string;
  series_config: SeriesConfig[];
  test_run_id?: string;
  is_global: boolean;
}

/**
 * SaveGraphPresetModal component for saving custom graph configurations
 *
 * Features:
 * - Auto-generated preset name suggestions based on series configuration
 * - Description field with auto-generated suggestions
 * - Scope selection (test run-specific or global)
 * - Preview section showing series count and details
 * - Validation for required fields
 * - Loading state during save operation
 *
 * Design follows SavePresetModal pattern from CompareCard with enhancements
 * for graph-specific use cases.
 */
export default function SaveGraphPresetModal({
  open,
  onClose,
  onSave,
  currentTestRunId,
  currentSeriesConfig,
  loading = false,
  defaultName
}: SaveGraphPresetModalProps) {
  const [formData, setFormData] = useState<GraphPresetFormData>({
    name: '',
    description: '',
    series_config: [],
    test_run_id: undefined,
    is_global: true
  });

  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  // Auto-generate suggestions when dialog opens or series config changes
  useEffect(() => {
    if (open) {
      // Use defaultName if provided, otherwise auto-generate from series config
      const suggestedName = defaultName || GraphPresetUtils.generatePresetName(currentSeriesConfig);
      const suggestedDescription = GraphPresetUtils.generateDescription(currentSeriesConfig);

      setFormData({
        name: suggestedName,
        description: suggestedDescription,
        series_config: currentSeriesConfig,
        test_run_id: undefined,
        is_global: true
      });
    }
  }, [open, currentSeriesConfig, defaultName]);

  const handleInputChange = (field: keyof GraphPresetFormData, value: unknown) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleScopeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const isTestRunSpecific = event.target.value === 'test_run';
    setFormData(prev => ({
      ...prev,
      test_run_id: isTestRunSpecific ? currentTestRunId : undefined,
      is_global: !isTestRunSpecific
    }));
  };

  const validateForm = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Preset name is required';
    }

    if (formData.series_config.length === 0) {
      newErrors.series_config = 'At least one metric series is required';
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
    setFormData({
      name: '',
      description: '',
      series_config: [],
      test_run_id: undefined,
      is_global: true
    });
    setErrors({});
    onClose();
  };

  const hasValidConfiguration = currentSeriesConfig.length > 0;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <Save />
          Save Graph Preset
        </Box>
      </DialogTitle>
      <DialogContent>
        {!hasValidConfiguration && (
          <Alert severity="warning" sx={{ mb: 3 }}>
            Please add at least one metric series to your graph before saving a preset.
          </Alert>
        )}

        {errors.series_config && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {errors.series_config}
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
              rows={3}
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              placeholder="Describe what this graph preset is used for..."
            />
          </Box>

          {/* Scope Selection */}
          <Box>
            <FormControl component="fieldset">
              <FormLabel component="legend">
                <Typography variant="h6" gutterBottom>
                  Preset Scope
                </Typography>
              </FormLabel>
              <RadioGroup
                value={formData.test_run_id ? 'test_run' : 'global'}
                onChange={handleScopeChange}
              >
                <FormControlLabel
                  value="global"
                  control={<Radio />}
                  label={
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Global
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Available for all test runs - reusable across your entire project
                      </Typography>
                    </Box>
                  }
                />
                <FormControlLabel
                  value="test_run"
                  control={<Radio />}
                  label={
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Test Run Specific
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Saved for current test run only - useful for test-specific analysis
                      </Typography>
                    </Box>
                  }
                  disabled={!currentTestRunId}
                />
              </RadioGroup>
            </FormControl>
          </Box>

          {/* Configuration Preview */}
          <Box>
            <Typography variant="h6" gutterBottom>
              Configuration to Save
            </Typography>

            <Box sx={{
              p: 2,
              backgroundColor: 'rgba(25, 118, 210, 0.04)',
              borderRadius: 1,
              border: '1px solid rgba(25, 118, 210, 0.08)',
              mb: 2
            }}>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                {currentSeriesConfig.length} metric {currentSeriesConfig.length === 1 ? 'series' : 'series'}
              </Typography>

              {currentSeriesConfig.length > 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 2 }}>
                  {currentSeriesConfig.map((config, index) => (
                    <Box
                      key={index}
                      sx={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 1,
                        alignItems: 'center'
                      }}
                    >
                      <Chip
                        label={`#${index + 1}`}
                        size="small"
                        sx={{
                          backgroundColor: 'rgba(25, 118, 210, 0.12)',
                          color: 'primary.dark',
                          fontWeight: 600,
                          minWidth: 40
                        }}
                      />
                      <Chip
                        label={config.dashboardLabel || 'Dashboard'}
                        size="small"
                        sx={{
                          background: 'linear-gradient(135deg, rgba(25, 118, 210, 0.08) 0%, rgba(30, 136, 229, 0.12) 100%)',
                          border: '1px solid rgba(25, 118, 210, 0.3)',
                          color: 'primary.dark'
                        }}
                      />
                      <Chip
                        label={config.panelTitle}
                        size="small"
                        sx={{
                          background: 'linear-gradient(135deg, rgba(156, 39, 176, 0.08) 0%, rgba(171, 71, 188, 0.12) 100%)',
                          border: '1px solid rgba(156, 39, 176, 0.3)',
                          color: '#9c27b0'
                        }}
                      />
                      {config.metricName && (
                        <Chip
                          label={`Metric: "${config.metricName}"`}
                          size="small"
                          sx={{
                            background: 'linear-gradient(135deg, rgba(46, 125, 50, 0.08) 0%, rgba(76, 175, 80, 0.12) 100%)',
                            border: '1px solid rgba(76, 175, 80, 0.3)',
                            color: '#2e7d32'
                          }}
                        />
                      )}
                      {config.source && (
                        <Chip
                          label={config.source}
                          size="small"
                          sx={{
                            background: 'linear-gradient(135deg, rgba(245, 124, 0, 0.08) 0%, rgba(255, 152, 0, 0.12) 100%)',
                            border: '1px solid rgba(255, 152, 0, 0.3)',
                            color: '#f57c00',
                            textTransform: 'capitalize'
                          }}
                        />
                      )}
                    </Box>
                  ))}
                </Box>
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
