'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Alert,
  CircularProgress,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import {
  Edit as EditIcon,
  Code as CodeIcon,
} from '@mui/icons-material';

import { DynatraceQuery, UpdateDynatraceQueryDto, DynatraceConfig, fetchDynatraceConfigs } from '../../../../../lib/dynatrace';

interface EditDynatraceQueryDialogProps {
  open: boolean;
  onClose: () => void;
  onEdit: (id: string, data: UpdateDynatraceQueryDto) => void;
  query: DynatraceQuery | null;
  loading?: boolean;
  submitError?: string | null;
}

export default function EditDynatraceQueryDialog({
  open,
  onClose,
  onEdit,
  query,
  loading = false,
  submitError = null,
}: EditDynatraceQueryDialogProps) {
  const [dynatraceConfigs, setDynatraceConfigs] = useState<DynatraceConfig[]>([]);
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const [formData, setFormData] = useState<UpdateDynatraceQueryDto>({
    dynatraceConfigId: '',
    dashboardLabel: '',
    applicationDashboardId: '',
    panelTitle: '',
    query: '',
    matchMetricPattern: '',
    omitGroupByVariableFromMetricName: [],
    templateVariables: {},
    metricUnit: 'ms',
  });

  const [detectedVariables, setDetectedVariables] = useState<string[]>([]);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // Extract variables from query in real-time
  const extractVariablesFromQuery = (query: string): string[] => {
    const variableRegex = /\$(\w+)/g;
    const variables: string[] = [];
    let match;

    while ((match = variableRegex.exec(query)) !== null) {
      const variable = match[1];
      if (!variables.includes(variable)) {
        variables.push(variable);
      }
    }

    return variables;
  };

  // Fetch Dynatrace configs when dialog opens
  useEffect(() => {
    if (open) {
      const loadConfigs = async () => {
        try {
          setLoadingConfigs(true);
          const configs = await fetchDynatraceConfigs();
          setDynatraceConfigs(configs);
        } catch (err) {
          console.error('Error fetching Dynatrace configs:', err);
          setError('Failed to load Dynatrace instances');
        } finally {
          setLoadingConfigs(false);
        }
      };
      loadConfigs();
    }
  }, [open]);

  // Initialize form data when query changes
  useEffect(() => {
    if (query && open) {
      setFormData({
        dynatraceConfigId: query.dynatraceConfigId || '',
        dashboardLabel: query.dashboardLabel || '',
        applicationDashboardId: query.applicationDashboardId || '',
        panelTitle: query.panelTitle || '',
        query: query.query || '',
        matchMetricPattern: query.matchMetricPattern || '',
        omitGroupByVariableFromMetricName: query.omitGroupByVariableFromMetricName || [],
        templateVariables: query.templateVariables || {},
        metricUnit: query.metricUnit || 'ms',
      });

      // Initialize variable values from existing data
      setVariableValues(query.templateVariables || {});
    }
  }, [query, open]);

  // Update detected variables when query changes
  useEffect(() => {
    if (formData.query) {
      const variables = extractVariablesFromQuery(formData.query);
      setDetectedVariables(variables);

      // Initialize variable values for new variables
      const newVariableValues = { ...variableValues };
      variables.forEach(variable => {
        if (!(variable in newVariableValues)) {
          newVariableValues[variable] = '';
        }
      });

      // Remove variables that are no longer in the query
      Object.keys(newVariableValues).forEach(variable => {
        if (!variables.includes(variable)) {
          delete newVariableValues[variable];
        }
      });

      setVariableValues(newVariableValues);
    } else {
      setDetectedVariables([]);
      setVariableValues({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.query]);


  const handleInputChange = (field: keyof UpdateDynatraceQueryDto, value: unknown) => {
    setFormData(prev => {
      const updated = {
        ...prev,
        [field]: value,
      };

      // Auto-generate UUID when dashboard label changes
      if (field === 'dashboardLabel') {
        updated.applicationDashboardId = crypto.randomUUID();
      }

      return updated;
    });
    setError(null);
  };

  const handleVariableValueChange = (variable: string, value: string) => {
    setVariableValues(prev => ({
      ...prev,
      [variable]: value,
    }));
  };

  const handleOmitVariableChange = (variables: string) => {
    const variableArray = variables.split(',').map(v => v.trim()).filter(v => v.length > 0);
    handleInputChange('omitGroupByVariableFromMetricName', variableArray);
  };

  const handleSubmit = () => {
    if (!query) return;

    // Validate required fields
    if (!formData.dynatraceConfigId) {
      setError('Dynatrace Instance is required');
      return;
    }
    if (!formData.dashboardLabel?.trim()) {
      setError('Dashboard Label is required');
      return;
    }
    if (!formData.applicationDashboardId?.trim()) {
      setError('Dashboard ID is required');
      return;
    }
    if (!formData.panelTitle?.trim()) {
      setError('Panel Title is required');
      return;
    }
    if (!formData.query?.trim()) {
      setError('Query is required');
      return;
    }

    // Check if all detected variables have values
    const missingVariables = detectedVariables.filter(variable => !variableValues[variable]?.trim());
    if (missingVariables.length > 0) {
      setError(`Please provide values for variables: ${missingVariables.join(', ')}`);
      return;
    }

    const submitData: UpdateDynatraceQueryDto = {
      ...formData,
      templateVariables: variableValues,
    };

    onEdit(query.id, submitData);
  };

  const handleClose = () => {
    setFormData({
      dynatraceConfigId: '',
      dashboardLabel: '',
      applicationDashboardId: '',
      panelTitle: '',
      query: '',
      matchMetricPattern: '',
      omitGroupByVariableFromMetricName: [],
      templateVariables: {},
      metricUnit: 'ms',
    });
    setDetectedVariables([]);
    setVariableValues({});
    setError(null);
    setDynatraceConfigs([]);
    onClose();
  };

  if (!query) return null;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: { minHeight: '600px' }
      }}
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <EditIcon />
          Edit Dynatrace Query
        </Box>
      </DialogTitle>

      <DialogContent>
        {(submitError || error) && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {submitError || error}
          </Alert>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Basic Information Section */}
          <Box>
            <Typography variant="h6" gutterBottom sx={{ mb: 2 }}>
              Basic Information
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <FormControl size="small" fullWidth required>
                <InputLabel>Dynatrace Instance</InputLabel>
                <Select
                  value={formData.dynatraceConfigId || ''}
                  label="Dynatrace Instance"
                  onChange={(e) => handleInputChange('dynatraceConfigId', e.target.value)}
                  disabled={loadingConfigs}
                >
                  {loadingConfigs ? (
                    <MenuItem value="" disabled>
                      <CircularProgress size={16} sx={{ mr: 1 }} /> Loading instances...
                    </MenuItem>
                  ) : dynatraceConfigs.length === 0 ? (
                    <MenuItem value="" disabled>
                      No Dynatrace instances configured
                    </MenuItem>
                  ) : (
                    dynatraceConfigs.map((config) => (
                      <MenuItem key={config.id} value={config.id}>
                        {config.label}
                      </MenuItem>
                    ))
                  )}
                </Select>
              </FormControl>
              <TextField
                label="Dashboard Label"
                value={formData.dashboardLabel}
                onChange={(e) => handleInputChange('dashboardLabel', e.target.value)}
                fullWidth
                required
                size="small"
              />
              <TextField
                label="Panel Title"
                value={formData.panelTitle}
                onChange={(e) => handleInputChange('panelTitle', e.target.value)}
                fullWidth
                required
                size="small"
                helperText="e.g., Application Response Time"
              />
              <FormControl size="small" fullWidth>
                <InputLabel>Metric Unit</InputLabel>
                <Select
                  value={formData.metricUnit || 'ms'}
                  label="Metric Unit"
                  onChange={(e) => handleInputChange('metricUnit', e.target.value)}
                >
                  <MenuItem value="ms">milliseconds (ms)</MenuItem>
                  <MenuItem value="s">seconds (s)</MenuItem>
                  <MenuItem value="ns">nanoseconds (ns)</MenuItem>
                  <MenuItem value="µs">microseconds (µs)</MenuItem>
                  <MenuItem value="m">minutes (m)</MenuItem>
                  <MenuItem value="h">hours (h)</MenuItem>
                  <MenuItem value="percent">Percent (%)</MenuItem>
                  <MenuItem value="percentunit">Percent (0.0-1.0)</MenuItem>
                  <MenuItem value="bytes">bytes (B)</MenuItem>
                  <MenuItem value="kbytes">kibibytes (KiB)</MenuItem>
                  <MenuItem value="mbytes">mebibytes (MiB)</MenuItem>
                  <MenuItem value="gbytes">gibibytes (GiB)</MenuItem>
                  <MenuItem value="Bps">bytes/sec (B/s)</MenuItem>
                  <MenuItem value="binbps">bits/sec (b/s)</MenuItem>
                  <MenuItem value="cps">counts/sec (c/s)</MenuItem>
                  <MenuItem value="ops">ops/sec (ops/s)</MenuItem>
                  <MenuItem value="reqps">requests/sec (req/s)</MenuItem>
                  <MenuItem value="rps">reads/sec (rd/s)</MenuItem>
                  <MenuItem value="wps">writes/sec (wr/s)</MenuItem>
                  <MenuItem value="iops">I/O ops/sec (io/s)</MenuItem>
                  <MenuItem value="none">None</MenuItem>
                  <MenuItem value="short">Short</MenuItem>
                </Select>
              </FormControl>
            </Box>
          </Box>

          {/* Query Section */}
          <Box>
            <Typography variant="h6" gutterBottom sx={{ mb: 2 }}>
              Query
            </Typography>
            <TextField
              label="Query"
              value={formData.query}
              onChange={(e) => handleInputChange('query', e.target.value)}
              fullWidth
              required
              multiline
              rows={4}
              size="small"
              placeholder="Enter your query here..."
              helperText="Variables like $Cluster, $Node will be automatically detected"
              sx={{
                '& .MuiInputBase-input': {
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                }
              }}
            />
          </Box>

          {/* Detected Variables Section */}
          {detectedVariables.length > 0 && (
            <Box>
              <Typography variant="h6" gutterBottom sx={{ mb: 2 }}>
                Template Variables
              </Typography>
              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Detected variables:
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                  {detectedVariables.map((variable) => (
                    <Chip
                      key={variable}
                      label={`$${variable}`}
                      size="small"
                      color="primary"
                      variant="outlined"
                    />
                  ))}
                </Box>
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {detectedVariables.map((variable) => (
                  <TextField
                    key={variable}
                    label={`$${variable}`}
                    value={variableValues[variable] || ''}
                    onChange={(e) => handleVariableValueChange(variable, e.target.value)}
                    fullWidth
                    size="small"
                    placeholder={`Enter value for $${variable}`}
                    helperText={
                      variable === 'Cluster' ? 'e.g., production-cluster' :
                      variable === 'Node' ? 'e.g., worker-node-01' :
                      variable === 'NodeID' ? 'e.g., KUBERNETES_NODE-1234567890' :
                      `Value for ${variable} variable`
                    }
                  />
                ))}
              </Box>
            </Box>
          )}

          {/* Additional Configuration Section */}
          <Box>
            <Typography variant="h6" gutterBottom sx={{ mb: 2 }}>
              Advanced Settings
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label="Match Metric Pattern"
                value={formData.matchMetricPattern}
                onChange={(e) => handleInputChange('matchMetricPattern', e.target.value)}
                fullWidth
                size="small"
                placeholder="e.g., response_time_*"
                helperText="Optional: Pattern to match metrics (supports wildcards)"
              />
              <TextField
                label="Omit Group By Variables"
                value={formData.omitGroupByVariableFromMetricName?.join(', ') || ''}
                onChange={(e) => handleOmitVariableChange(e.target.value)}
                fullWidth
                size="small"
                placeholder="e.g., service, instance"
                helperText="Optional: Comma-separated list of variables to omit from metric names"
              />
            </Box>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={loading}
          startIcon={loading ? <CircularProgress size={16} /> : <CodeIcon />}
        >
          {loading ? 'Updating...' : 'Update Query'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}