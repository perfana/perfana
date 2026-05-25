'use client';

import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Autocomplete,
  Box,
  Typography,
  Alert,
  CircularProgress,
  IconButton,
  Chip,
  Checkbox,
  FormControlLabel,
} from '@mui/material';
import { CloudUpload, Close, Add, Delete } from '@mui/icons-material';
import { authenticatedFetch } from '@/lib/api';
import { FilterOptions } from '@/app/test-runs/types';

interface ConfigPair {
  key: string;
  value: string;
}

interface JtlUploadDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  filterOptions: FilterOptions;
}

export function JtlUploadDialog({
  open,
  onClose,
  onSuccess,
  filterOptions,
}: JtlUploadDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [systemUnderTest, setSystemUnderTest] = useState<string>('');
  const [testEnvironment, setTestEnvironment] = useState<string>('');
  const [workload, setWorkload] = useState<string>('');
  const [analysisStartOffset, setAnalysisStartOffset] = useState<string>('');
  const [configs, setConfigs] = useState<ConfigPair[]>([]);
  const [includeSubTransactions, setIncludeSubTransactions] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; testRunId?: string } | null>(null);

  const resetForm = useCallback(() => {
    setFile(null);
    setSystemUnderTest('');
    setTestEnvironment('');
    setWorkload('');
    setAnalysisStartOffset('');
    setConfigs([]);
    setIncludeSubTransactions(false);
    setResult(null);
  }, []);

  const handleClose = () => {
    if (!uploading) {
      resetForm();
      onClose();
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (selected) {
      if (!selected.name.toLowerCase().endsWith('.zip')) {
        setResult({ success: false, message: 'Please select a .zip file' });
        return;
      }
      setFile(selected);
      setResult(null);
    }
  };

  const handleAddConfig = () => {
    setConfigs([...configs, { key: '', value: '' }]);
  };

  const handleRemoveConfig = (index: number) => {
    setConfigs(configs.filter((_, i) => i !== index));
  };

  const handleConfigChange = (index: number, field: 'key' | 'value', val: string) => {
    const updated = [...configs];
    updated[index] = { ...updated[index]!, [field]: val };
    setConfigs(updated);
  };

  const canSubmit =
    file && systemUnderTest.trim() && testEnvironment.trim() && workload.trim() && !uploading;

  const handleUpload = async () => {
    if (!canSubmit) return;

    setUploading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('systemUnderTest', systemUnderTest.trim());
      formData.append('testEnvironment', testEnvironment.trim());
      formData.append('workload', workload.trim());

      if (analysisStartOffset.trim()) {
        formData.append('analysisStartOffset', analysisStartOffset.trim());
      }

      const validConfigs = configs.filter((c) => c.key.trim() && c.value.trim());
      if (validConfigs.length > 0) {
        formData.append('configs', JSON.stringify(validConfigs));
      }

      if (includeSubTransactions) {
        formData.append('includeSubTransactions', 'true');
      }

      const response = await authenticatedFetch('test-runs/jtl-upload', {
        method: 'POST',
        body: formData,
        // No Content-Type header — browser sets multipart boundary
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(
          errorData?.message || `Upload failed with status ${response.status}`,
        );
      }

      const data = await response.json();
      setResult({
        success: true,
        message: data.message || `Imported ${data.scenarioCount} scenario(s)`,
        testRunId: data.testRunId,
      });
      onSuccess();
    } catch (err) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Upload failed';
      setResult({ success: false, message });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        Upload JTL Results
        <IconButton onClick={handleClose} disabled={uploading} size="small">
          <Close />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {/* File Input */}
          <Box>
            <Button
              variant="outlined"
              component="label"
              startIcon={<CloudUpload />}
              fullWidth
              disabled={uploading}
            >
              {file ? file.name : 'Select .zip file'}
              <input
                type="file"
                accept=".zip"
                hidden
                onChange={handleFileChange}
              />
            </Button>
            {file && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                {(file.size / 1024 / 1024).toFixed(1)} MB
              </Typography>
            )}
          </Box>

          {/* System Under Test */}
          <Autocomplete
            freeSolo
            options={filterOptions.systems}
            value={systemUnderTest}
            onInputChange={(_, val) => setSystemUnderTest(val)}
            disabled={uploading}
            renderInput={(params) => (
              <TextField {...params} label="System Under Test" required size="small" />
            )}
          />

          {/* Test Environment */}
          <Autocomplete
            freeSolo
            options={filterOptions.environments}
            value={testEnvironment}
            onInputChange={(_, val) => setTestEnvironment(val)}
            disabled={uploading}
            renderInput={(params) => (
              <TextField {...params} label="Test Environment" required size="small" />
            )}
          />

          {/* Workload */}
          <Autocomplete
            freeSolo
            options={filterOptions.workloads}
            value={workload}
            onInputChange={(_, val) => setWorkload(val)}
            disabled={uploading}
            renderInput={(params) => (
              <TextField {...params} label="Workload" required size="small" />
            )}
          />

          {/* Analysis Start Offset */}
          <TextField
            label="Analysis start offset (seconds)"
            type="number"
            size="small"
            value={analysisStartOffset}
            onChange={(e) => setAnalysisStartOffset(e.target.value)}
            disabled={uploading}
            helperText="Excluded from performance analysis"
            slotProps={{ htmlInput: { min: 0 } }}
          />

          {/* Sub-transaction rows */}
          <FormControlLabel
            control={
              <Checkbox
                checked={includeSubTransactions}
                onChange={(e) => setIncludeSubTransactions(e.target.checked)}
                disabled={uploading}
                size="small"
              />
            }
            label={
              <Box>
                <Typography variant="body2">Include sub-transaction rows</Typography>
                <Typography variant="caption" color="text.secondary">
                  By default, Parallel Controller sub-requests are excluded. Enable only if your test plan uses Parallel Controllers and you need the sub-sampler data.
                </Typography>
              </Box>
            }
          />

          {/* Config Key-Value Pairs */}
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="subtitle2" color="text.secondary">
                Configuration (optional)
              </Typography>
              <Button
                size="small"
                startIcon={<Add />}
                onClick={handleAddConfig}
                disabled={uploading}
              >
                Add
              </Button>
            </Box>
            {configs.map((config, index) => (
              <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1 }}>
                <TextField
                  size="small"
                  label="Key"
                  value={config.key}
                  onChange={(e) => handleConfigChange(index, 'key', e.target.value)}
                  disabled={uploading}
                  sx={{ flex: 1 }}
                />
                <TextField
                  size="small"
                  label="Value"
                  value={config.value}
                  onChange={(e) => handleConfigChange(index, 'value', e.target.value)}
                  disabled={uploading}
                  sx={{ flex: 1 }}
                />
                <IconButton
                  size="small"
                  onClick={() => handleRemoveConfig(index)}
                  disabled={uploading}
                >
                  <Delete fontSize="small" />
                </IconButton>
              </Box>
            ))}
          </Box>

          {/* Result / Error Alert */}
          {result && (
            <Alert severity={result.success ? 'success' : 'error'}>
              {result.message}
              {result.testRunId && (
                <Box sx={{ mt: 1 }}>
                  <Chip label={result.testRunId} size="small" variant="outlined" />
                </Box>
              )}
            </Alert>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={uploading}>
          {result?.success ? 'Close' : 'Cancel'}
        </Button>
        {!result?.success && (
          <Button
            variant="contained"
            onClick={handleUpload}
            disabled={!canSubmit}
            startIcon={uploading ? <CircularProgress size={18} /> : <CloudUpload />}
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
