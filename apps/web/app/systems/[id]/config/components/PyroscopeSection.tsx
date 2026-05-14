'use client';

import { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  TextField,
  IconButton,
  FormHelperText,
  Snackbar,
  Autocomplete,
} from '@mui/material';
import {
  Save as SaveIcon,
  Cancel as CancelIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { SystemUnderTest, PyroscopeConfiguration } from '@/types/test-runs';
import { fetchPyroscopeInstances, fetchProfilerTypes, PyroscopeInstance, ProfilerType } from '@/lib/pyroscope';
import { updateSystemPyroscopeConfig } from '@/lib/systems';

interface PyroscopeSectionProps {
  systemId: string;
  systemUnderTest: SystemUnderTest;
  onUpdate?: (updatedSystem: SystemUnderTest) => void;
}

export default function PyroscopeSection({
  systemId,
  systemUnderTest,
  onUpdate,
}: PyroscopeSectionProps) {
  // Form state
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>(
    systemUnderTest.pyroscope_instance_id || ''
  );
  const [configurations, setConfigurations] = useState<PyroscopeConfiguration[]>(
    systemUnderTest.pyroscope_configurations || []
  );

  // Data loading state
  const [pyroscopeInstances, setPyroscopeInstances] = useState<PyroscopeInstance[]>([]);
  const [profilerTypes, setProfilerTypes] = useState<ProfilerType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSuccessOpen] = useState(false);

  // Load Pyroscope instances and profiler types
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [instancesData, profilerTypesData] = await Promise.all([
          fetchPyroscopeInstances(),
          fetchProfilerTypes(),
        ]);

        setPyroscopeInstances(instancesData);
        setProfilerTypes(profilerTypesData);
      } catch (err) {
        console.error('Error loading Pyroscope data:', err);
        setError(
          err && typeof err === 'object' && 'message' in err
            ? (err as Error).message
            : 'Failed to load Pyroscope configuration data'
        );
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  // Track form changes
  useEffect(() => {
    const hasChanges =
      selectedInstanceId !== (systemUnderTest.pyroscope_instance_id || '') ||
      JSON.stringify(configurations) !== JSON.stringify(systemUnderTest.pyroscope_configurations || []);

    setIsDirty(hasChanges);
  }, [selectedInstanceId, configurations, systemUnderTest]);

  const handleInstanceChange = (event: unknown) => {
    setSelectedInstanceId(event.target.value);
  };

  const handleAddCombination = () => {
    setConfigurations([...configurations, { application: '', profiler: '' }]);
  };

  const handleRemoveCombination = (index: number) => {
    setConfigurations(configurations.filter((_, i) => i !== index));
  };

  const handleApplicationChange = (index: number, value: string) => {
    const newConfigurations = [...configurations];
    newConfigurations[index] = { ...newConfigurations[index], application: value };
    setConfigurations(newConfigurations);
  };

  const handleProfilerChange = (index: number, value: string) => {
    const newConfigurations = [...configurations];
    newConfigurations[index] = { ...newConfigurations[index], profiler: value };
    setConfigurations(newConfigurations);
  };

  const handleSave = async () => {
    // Validation
    if (selectedInstanceId && configurations.length === 0) {
      setSaveError('At least one application+profiler combination is required when a Pyroscope instance is selected');
      return;
    }

    // Validate each combination has both fields filled
    if (selectedInstanceId) {
      const invalidCombinations = configurations.filter(
        (config) => !config.application.trim() || !config.profiler.trim()
      );
      if (invalidCombinations.length > 0) {
        setSaveError('All combinations must have both application name and profiler type selected');
        return;
      }
    }

    try {
      setSaving(true);
      setSaveError(null);

      const config = {
        pyroscope_instance_id: selectedInstanceId || null,
        pyroscope_configurations: selectedInstanceId ? configurations : [],
      };

      const updatedSystem = await updateSystemPyroscopeConfig(systemId, config);

      // Update parent component
      if (onUpdate) {
        onUpdate(updatedSystem);
      }

      setIsDirty(false);
      setSuccessOpen(true);
    } catch (err) {
      console.error('❌ Error saving Pyroscope configuration:', err);
      console.error('Error details:', {
        message: err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Unknown error',
        stack: err && typeof err === 'object' && 'stack' in err ? (err as Error).stack : 'No stack trace',
      });
      setSaveError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to save Pyroscope configuration'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    // Reset to original values
    setSelectedInstanceId(systemUnderTest.pyroscope_instance_id || '');
    setConfigurations(systemUnderTest.pyroscope_configurations || []);
    setIsDirty(false);
    setSaveError(null);
  };

  if (loading) {
    return (
      <Paper sx={{ p: 3, mb: 3, mx: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 3, mb: 3, mx: 3 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Pyroscope Profiling Configuration
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Configure continuous profiling for {systemUnderTest.name}
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {saveError && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setSaveError(null)}>
          {saveError}
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {/* Pyroscope Instance Selector */}
        <FormControl fullWidth>
          <InputLabel id="pyroscope-instance-label">Pyroscope Instance</InputLabel>
          <Select
            labelId="pyroscope-instance-label"
            id="pyroscope-instance-select"
            value={selectedInstanceId}
            label="Pyroscope Instance"
            onChange={handleInstanceChange}
            disabled={saving}
          >
            <MenuItem value="">
              <em>None (Disable Pyroscope)</em>
            </MenuItem>
            {pyroscopeInstances.map((instance) => (
              <MenuItem key={instance.id} value={instance.id}>
                {instance.label}
              </MenuItem>
            ))}
          </Select>
          <FormHelperText>
            Select the Pyroscope instance to use for continuous profiling
          </FormHelperText>
        </FormControl>

        {/* Combinations Configuration */}
        {selectedInstanceId && (
          <>
            <Box>
              <Typography variant="subtitle2" gutterBottom sx={{ mb: 2 }}>
                Application + Profiler Combinations
              </Typography>

              {configurations.length === 0 && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  No combinations configured. Click &quot;Add Combination&quot; to add your first application+profiler pair.
                </Alert>
              )}

              {configurations.map((config, index) => (
                <Box
                  key={index}
                  sx={{
                    display: 'flex',
                    gap: 2,
                    mb: 2,
                    alignItems: 'flex-start',
                  }}
                >
                  {/* Application Input */}
                  <TextField
                    label="Application Name"
                    placeholder="e.g., payment-service"
                    value={config.application}
                    onChange={(e) => handleApplicationChange(index, e.target.value)}
                    disabled={saving}
                    fullWidth
                    sx={{ flex: 1 }}
                  />

                  {/* Profiler Selector */}
                  <Autocomplete
                    options={profilerTypes}
                    getOptionLabel={(option) => option.label}
                    value={profilerTypes.find((pt) => pt.value === config.profiler) || null}
                    onChange={(_, newValue) => handleProfilerChange(index, newValue?.value || '')}
                    disabled={saving}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Profiler Type"
                        placeholder="Select profiler"
                      />
                    )}
                    sx={{ flex: 1 }}
                  />

                  {/* Remove Button */}
                  <IconButton
                    color="error"
                    onClick={() => handleRemoveCombination(index)}
                    disabled={saving}
                    aria-label="Remove combination"
                    sx={{ mt: 1 }}
                  >
                    <DeleteIcon />
                  </IconButton>
                </Box>
              ))}

              {/* Add Combination Button */}
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={handleAddCombination}
                disabled={saving}
                sx={{ mt: 1 }}
              >
                Add Combination
              </Button>
            </Box>

            {/* Info about recommended profilers */}
            <Alert severity="info">
              <Typography variant="body2" fontWeight="medium" gutterBottom>
                Recommended Profilers:
              </Typography>
              <Typography variant="body2">
                - <strong>process_cpu / cpu</strong>: CPU usage profiling
                <br />
                - <strong>memory / alloc_in_new_tlab_bytes</strong>: Memory allocation profiling
                <br />
                <br />
                <strong>Example combinations:</strong>
                <br />
                • payment-service + process_cpu/cpu
                <br />
                • payment-service + memory/alloc_in_new_tlab_bytes
                <br />
                • user-api + process_cpu/cpu
              </Typography>
            </Alert>
          </>
        )}

        {/* Action Buttons */}
        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end', pt: 2 }}>
          <Button
            variant="outlined"
            startIcon={<CancelIcon />}
            onClick={handleCancel}
            disabled={!isDirty || saving}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={handleSave}
            disabled={!isDirty || saving}
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </Button>
        </Box>
      </Box>

      {/* Success Snackbar */}
      <Snackbar
        open={saveSuccess}
        autoHideDuration={4000}
        onClose={() => setSuccessOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setSuccessOpen(false)}
          severity="success"
          sx={{ width: '100%' }}
        >
          Pyroscope configuration saved successfully!
        </Alert>
      </Snackbar>
    </Paper>
  );
}
