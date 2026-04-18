import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Switch,
  FormControlLabel,
  RadioGroup,
  Radio,
  Button,
  Alert,
  CircularProgress,
  Divider,
  Paper,
  Grid
} from '@mui/material';
import { authenticatedFetch } from '@/lib/api';

export interface MetricConfigData {
  rowKey: string;
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
  applicationDashboardId: string;
  panelId: string;
  panelTitle: string;
  metricName: string | null;
  dashboardLabel: string;
  currentConfig?: {
    ignore?: boolean;
    metricClassification?: {
      classification: string;
      higherIsBetter: boolean;
    };
    thresholds?: {
      aggregation: string;
      percentageThreshold: number | null;
      iqrThreshold: number | null;
      absoluteThreshold: number | null;
    };
    configSource?: string;
  };
}

interface MetricConfigFormProps {
  configData: MetricConfigData;
  onSave: (
    rowKey: string,
    config: {
      metricClassification?: {
        classification: string;
        higherIsBetter: boolean;
      };
      thresholds?: {
        aggregation: string;
        percentageThreshold: number | null;
        iqrThreshold: number | null;
        absoluteThreshold: number | null;
      };
    },
    scope: 'metric' | 'panel'
  ) => Promise<void>;
  onCancel: () => void;
}

const classificationOptions = [
  { value: 'unclassified', label: 'Unclassified' },
  { value: 'RED_duration', label: 'RED Duration' },
  { value: 'RED_rate', label: 'RED Rate' },
  { value: 'RED_errors', label: 'RED Errors' },
  { value: 'USE_saturation', label: 'USE Saturation' },
  { value: 'USE_utilization', label: 'USE Utilization' },
  { value: 'USE_errors', label: 'USE Errors' },
  { value: 'business_metric', label: 'Business Metric' },
  { value: 'infrastructure_metric', label: 'Infrastructure Metric' },
  { value: 'application_metric', label: 'Application Metric' },
  { value: 'custom', label: 'Custom' },
];

const aggregationOptions = [
  { value: 'mean', label: 'Mean' },
  { value: 'median', label: 'Median' },
  { value: 'min', label: 'Minimum' },
  { value: 'max', label: 'Maximum' },
  { value: 'last', label: 'Last Value' },
  { value: 'q10', label: '10th Percentile' },
  { value: 'q25', label: '25th Percentile' },
  { value: 'q75', label: '75th Percentile' },
  { value: 'q90', label: '90th Percentile' },
  { value: 'q95', label: '95th Percentile' },
  { value: 'q99', label: '99th Percentile' },
];


export default function MetricConfigForm({
  configData,
  onSave,
  onCancel,
}: MetricConfigFormProps) {
  // Form state - determine scope based on existing config source or metricName availability
  const [scope, setScope] = useState<'metric' | 'panel'>(() => {
    // If we have existing config, use its source to determine scope
    // The stored values are 'metric' or 'panel' directly
    const configSource = configData?.currentConfig?.configSource;
    if (configSource === 'metric') {
      return 'metric';
    } else if (configSource === 'panel') {
      return 'panel';
    }
    // Otherwise, default based on whether we can configure at metric level
    return configData?.metricName && configData.metricName !== null ? 'metric' : 'panel';
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ignore toggle state
  const [ignore, setIgnore] = useState<boolean>(false);

  // Metric Classification state
  const [classification, setClassification] = useState<string>('unclassified');
  const [higherIsBetter, setHigherIsBetter] = useState<boolean>(false);

  // Thresholds state
  const [aggregation, setAggregation] = useState<string>('mean');
  const [percentageThreshold, setPercentageThreshold] = useState<string>('');
  const [iqrThreshold, setIqrThreshold] = useState<string>('');
  const [absoluteThreshold, setAbsoluteThreshold] = useState<string>('');

  // Initialize form state from current config
  useEffect(() => {
    if (configData) {
      const config = configData.currentConfig || {
        metricClassification: {
          classification: 'unclassified',
          higherIsBetter: false
        },
        thresholds: {
          aggregation: 'mean',
          percentageThreshold: 15,
          iqrThreshold: 2,
          absoluteThreshold: null
        },
        ignore: false
      };

      // Reset and initialize ignore state from existing config
      setIgnore(configData.currentConfig?.ignore || false);

      // Reset and initialize metric classification
      setClassification(config.metricClassification?.classification || 'unclassified');
      setHigherIsBetter(config.metricClassification?.higherIsBetter || false);

      // Reset and initialize thresholds
      setAggregation(config.thresholds?.aggregation || 'mean');
      setPercentageThreshold(config.thresholds?.percentageThreshold?.toString() || '');
      setIqrThreshold(config.thresholds?.iqrThreshold?.toString() || '');
      setAbsoluteThreshold(config.thresholds?.absoluteThreshold?.toString() || '');


      // Determine scope based on existing config source or metric availability
      // The stored values are 'metric' or 'panel' directly
      if (config.configSource === 'metric') {
        setScope('metric');
      } else if (config.configSource === 'panel') {
        setScope('panel');
      } else {
        // Default based on whether we can configure at metric level
        setScope(configData?.metricName && configData.metricName !== null ? 'metric' : 'panel');
      }
    }
  }, [configData?.rowKey]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const config = {
        ignore,
        metricClassification: {
          classification,
          higherIsBetter,
        },
        thresholds: {
          aggregation,
          percentageThreshold: percentageThreshold ? parseFloat(percentageThreshold) : null,
          iqrThreshold: iqrThreshold ? parseFloat(iqrThreshold) : null,
          absoluteThreshold: absoluteThreshold ? parseFloat(absoluteThreshold) : null,
        },
      };

      await onSave(configData?.rowKey || '', config, scope);
    } catch (err) {
      setError(err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  // If no configData, return early
  if (!configData) {
    return <Typography>No data available</Typography>;
  }

  // Use defaults for currentConfig if not available
  const effectiveConfig = configData.currentConfig || {
    metricClassification: {
      classification: 'unclassified',
      higherIsBetter: false
    },
    thresholds: {
      aggregation: 'mean',
      percentageThreshold: 15,
      iqrThreshold: 2,
      absoluteThreshold: null
    }
  };


  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Scope Selection */}
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>
          Configuration Scope
        </Typography>
        <FormControl component="fieldset">
          <RadioGroup
            value={scope}
            onChange={(e) => setScope(e.target.value as 'metric' | 'panel')}
          >
            <FormControlLabel
              value="metric"
              control={<Radio size="small" />}
              label={
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    Single Metric
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Apply to: {configData?.metricName || 'N/A'}
                  </Typography>
                </Box>
              }
              disabled={!configData?.metricName}
            />
            <FormControlLabel
              value="panel"
              control={<Radio size="small" />}
              label={
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    Entire Panel
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Apply to all metrics in: {configData?.panelTitle}
                  </Typography>
                </Box>
              }
            />
          </RadioGroup>
        </FormControl>
      </Paper>

      {/* Ignore Metric Toggle */}
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>
          Metric Control
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={ignore}
              onChange={(e) => setIgnore(e.target.checked)}
              color="warning"
            />
          }
          label={
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                Ignore Metric
              </Typography>
              <Typography variant="caption" color="text.secondary">
                When enabled, this metric will be excluded from anomaly detection analysis
              </Typography>
            </Box>
          }
        />
      </Paper>

      {/* Metric Classification Section */}
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>
          Metric Classification
        </Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 8 }}>
            <FormControl fullWidth>
              <InputLabel>Classification Category</InputLabel>
              <Select
                value={classification}
                onChange={(e) => setClassification(e.target.value)}
                label="Classification Category"
                size="small"
              >
                {classificationOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={higherIsBetter}
                  onChange={(e) => setHigherIsBetter(e.target.checked)}
                />
              }
              label="Higher is Better"
              sx={{ mt: 0.5 }}
            />
          </Grid>
        </Grid>
      </Paper>

      {/* Thresholds Configuration Section */}
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>
          Anomaly Detection Thresholds
        </Typography>

        {/* Aggregation Method */}
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>Aggregation Method</InputLabel>
          <Select
            value={aggregation}
            onChange={(e) => setAggregation(e.target.value)}
            label="Aggregation Method"
            size="small"
          >
            {aggregationOptions.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Threshold Values */}
        <Grid container spacing={1.5}>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              fullWidth
              label="Percentage Threshold (%)"
              type="number"
              size="small"
              value={percentageThreshold}
              onChange={(e) => setPercentageThreshold(e.target.value)}
              placeholder="e.g., 10"
              helperText="Percentage change threshold"
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              fullWidth
              label="IQR Threshold"
              type="number"
              size="small"
              value={iqrThreshold}
              onChange={(e) => setIqrThreshold(e.target.value)}
              placeholder="e.g., 1.5"
              helperText="Interquartile range multiplier"
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              fullWidth
              label="Absolute Threshold"
              type="number"
              size="small"
              value={absoluteThreshold}
              onChange={(e) => setAbsoluteThreshold(e.target.value)}
              placeholder="e.g., 100"
              helperText="Absolute value threshold"
            />
          </Grid>
        </Grid>
      </Paper>

      {/* Action Buttons */}
      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end', pt: 1 }}>
        <Button
          variant="outlined"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} /> : null}
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </Button>
      </Box>
    </Box>
  );
}