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
  Paper,
  Grid
} from '@mui/material';
import {} from '@/lib/api';
import { AGGREGATION_OPTIONS, CLASSIFICATION_OPTIONS } from '@/lib/compare-config-options';
import type { ConfigScope } from '../anomaly-detection/types';
import { PromoteTemplateDialog } from './PromoteTemplateDialog';
import type { PromotedConfig } from './promote-template';

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
  /** The row's dashboard uid (from its ADAPT result); without it a template can only match by panel title. */
  dashboardUid?: string | null;
  /** The run's organization and tags: they decide which profiles "Save as template" offers. */
  organizationId?: string | null;
  runTags?: string[];
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
    /** Absent or null: off, the series reads incomparable when the baseline has no row for it. */
    defaultValueIfControlGroupMissing?: number | null;
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
      defaultValueIfControlGroupMissing: number | null;
    },
    scope: ConfigScope
  ) => Promise<void>;
  onCancel: () => void;
  /** Shows "Save as template" when given; called with a confirmation once one is created. */
  onTemplateSaved?: (message: string) => void;
}

// Shared with the ADAPT template dialog (settings/profiles/adapt-templates), so both offer one list.
const classificationOptions = CLASSIFICATION_OPTIONS;
const aggregationOptions = AGGREGATION_OPTIONS;


export default function MetricConfigForm({
  configData,
  onSave,
  onCancel,
  onTemplateSaved,
}: MetricConfigFormProps) {
  // Form state - determine scope based on existing config source or metricName availability
  const [scope, setScope] = useState<ConfigScope>(() => {
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
  // The form values "Save as template" was opened with; null while its dialog is closed.
  const [promoting, setPromoting] = useState<PromotedConfig | null>(null);

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
  // Text, so an empty field means "off" and a typed 0 means "compare against 0".
  const [defaultValue, setDefaultValue] = useState<string>('');

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
      const storedDefault = configData.currentConfig?.defaultValueIfControlGroupMissing;
      setDefaultValue(typeof storedDefault === 'number' ? String(storedDefault) : '');


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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configData?.rowKey]);

  /** The form's values, or null (with the error shown) when the no-baseline value is not a number. */
  const readValues = (): PromotedConfig | null => {
    const trimmedDefault = defaultValue.trim();
    const parsedDefault = trimmedDefault === '' ? null : Number(trimmedDefault);
    if (parsedDefault !== null && !Number.isFinite(parsedDefault)) {
      setError('The value to compare against without a baseline must be a number, or empty to leave it off.');
      return null;
    }
    return {
      ignore,
      classification,
      higherIsBetter,
      aggregation,
      percentageThreshold: percentageThreshold ? parseFloat(percentageThreshold) : null,
      iqrThreshold: iqrThreshold ? parseFloat(iqrThreshold) : null,
      absoluteThreshold: absoluteThreshold ? parseFloat(absoluteThreshold) : null,
      defaultValueIfControlGroupMissing: parsedDefault,
    };
  };

  const handlePromote = () => {
    const values = readValues();
    if (!values) return;
    setError(null);
    setPromoting(values);
  };

  const handleSave = async () => {
    const values = readValues();
    if (!values) return;

    setSaving(true);
    setError(null);

    try {
      const config = {
        ignore: values.ignore,
        metricClassification: {
          classification: values.classification,
          higherIsBetter: values.higherIsBetter,
        },
        thresholds: {
          aggregation: values.aggregation,
          percentageThreshold: values.percentageThreshold,
          iqrThreshold: values.iqrThreshold,
          absoluteThreshold: values.absoluteThreshold,
        },
        defaultValueIfControlGroupMissing: values.defaultValueIfControlGroupMissing,
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
  const _effectiveConfig = configData.currentConfig || {
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
            onChange={(e) => setScope(e.target.value as ConfigScope)}
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
            <FormControlLabel
              value="all-dashboards"
              control={<Radio size="small" />}
              label={
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    This Panel On All Dashboards
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Apply to all metrics in: {configData?.panelTitle}, on every dashboard of this workload
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

      {/* No baseline */}
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
          When the baseline has no data
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          A series with no data in any baseline run is reported as incomparable. Enter a value to compare it
          against instead, for example 0 for an error count that should stay at zero. The thresholds above
          apply, except the IQR threshold, which needs a baseline. A baseline with too few samples is still
          reported as incomparable.
        </Typography>
        <TextField
          label="Compare against"
          type="number"
          size="small"
          value={defaultValue}
          onChange={(e) => setDefaultValue(e.target.value)}
          placeholder="Off"
          helperText="Leave empty to report incomparable"
          sx={{ maxWidth: 260 }}
        />
      </Paper>

      {/* Action Buttons */}
      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end', pt: 1 }}>
        {onTemplateSaved && (
          <Button
            variant="text"
            onClick={handlePromote}
            disabled={saving}
            sx={{ mr: 'auto' }}
            title="Make these settings a template for other workloads; this row is not changed"
          >
            Save as template
          </Button>
        )}
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

      {onTemplateSaved && promoting && (
        <PromoteTemplateDialog
          open
          source={{
            dashboardUid: configData.dashboardUid,
            dashboardLabel: configData.dashboardLabel,
            panelId: configData.panelId,
            panelTitle: configData.panelTitle,
            metricName: configData.metricName,
          }}
          config={promoting}
          formScope={scope}
          run={{ organizationId: configData.organizationId, tags: configData.runTags }}
          onClose={() => setPromoting(null)}
          onSaved={(label) => {
            setPromoting(null);
            onTemplateSaved(`Saved as an ADAPT template in ${label}. It applies from the next completed run.`);
          }}
        />
      )}
    </Box>
  );
}