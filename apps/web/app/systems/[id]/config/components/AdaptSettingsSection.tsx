'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, FormControl, InputLabel, Select, MenuItem, Button,
  CircularProgress, Alert, Paper, TextField,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import { authenticatedFetch } from '@/lib/api';

interface Props {
  systemId: string;
  selectedEnvironment: string;
  selectedWorkload: string;
}

export default function AdaptSettingsSection({ systemId, selectedEnvironment, selectedWorkload }: Props) {
  const [adaptMode, setAdaptMode] = useState<string>('DEFAULT');
  const [baselineTestRunId, setBaselineTestRunId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!systemId || !selectedEnvironment || !selectedWorkload) return;

    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        systemUnderTestId: systemId,
        testEnvironment: selectedEnvironment,
        workload: selectedWorkload,
      });
      const response = await authenticatedFetch(
        `/test-runs/workload-adapt-settings?${params}`,
        { headers: { 'Content-Type': 'application/json' } }
      );

      if (response.ok) {
        const data = await response.json();
        setAdaptMode(data.adaptMode || 'DEFAULT');
        setBaselineTestRunId(data.baselineTestRunId || '');
      }
    } catch (err) {
      setError('Failed to load ADAPT settings');
    } finally {
      setLoading(false);
    }
  }, [systemId, selectedEnvironment, selectedWorkload]);

  useEffect(() => {
    fetchSettings();
    setSuccess(false);
  }, [fetchSettings]);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(false);

      const response = await authenticatedFetch('/test-runs/workload-adapt-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemUnderTestId: systemId,
          testEnvironment: selectedEnvironment,
          workload: selectedWorkload,
          adaptMode,
          ...(adaptMode === 'SCALING' && baselineTestRunId ? { baselineTestRunId } : {}),
        }),
      });

      if (response.ok) {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } else {
        const data = await response.json();
        setError(data.message || 'Failed to save settings');
      }
    } catch (err) {
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (!selectedEnvironment || !selectedWorkload) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">Select an environment and workload to configure ADAPT settings.</Typography>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>ADAPT Mode</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Controls how performance comparisons work for new test runs in this workload.
        <strong> Regression</strong> mode compares against the last 10 successful runs (default).
        <strong> Scaling</strong> mode compares against a single baseline run, for sizing/scaling tests where load increases between runs.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>Settings saved.</Alert>}

      <Paper variant="outlined" sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 500 }}>
        <FormControl fullWidth>
          <InputLabel>ADAPT Mode</InputLabel>
          <Select
            value={adaptMode}
            label="ADAPT Mode"
            onChange={(e) => {
              setAdaptMode(e.target.value);
              if (e.target.value === 'DEFAULT') setBaselineTestRunId('');
            }}
          >
            <MenuItem value="DEFAULT">Regression (compare against last 10 successful runs)</MenuItem>
            <MenuItem value="SCALING">Scaling (compare against single baseline run)</MenuItem>
          </Select>
        </FormControl>

        {adaptMode === 'SCALING' && (
          <TextField
            label="Baseline Test Run ID (optional)"
            value={baselineTestRunId}
            onChange={(e) => setBaselineTestRunId(e.target.value)}
            placeholder="e.g. PaymentService-prod-loadTest-100users"
            helperText="If empty, each run compares against the most recent prior run. Set this to always compare against a specific low-load baseline."
            fullWidth
          />
        )}

        <Button
          variant="contained"
          startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
          onClick={handleSave}
          disabled={saving}
          sx={{ alignSelf: 'flex-start' }}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </Paper>
    </Box>
  );
}
