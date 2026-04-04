'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Box,
  CircularProgress,
  Alert,
  Checkbox,
  FormControlLabel,
  Chip,
  Divider,
} from '@mui/material';
import { TrendingUp, OpenInNew } from '@mui/icons-material';
import Link from 'next/link';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';

interface Benchmark {
  id: string;
  benchmark_type: 'metric' | 'apdex';
  panel_title?: string;
  config_title?: string;
  description?: string;
  requirement_operator?: string;
  requirement_value?: number;
  metric_unit?: string;
  transaction_name?: string;
  min_apdex_score?: number;
  apdex_threshold_ms?: number;
  enabled: boolean;
}

interface StartScalingSessionDialogProps {
  open: boolean;
  onClose: () => void;
  testRun: TestRun;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onSessionCreated: () => void;
}

export default function StartScalingSessionDialog({
  open,
  onClose,
  testRun,
  onSuccess,
  onError,
  onSessionCreated,
}: StartScalingSessionDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetLoad, setTargetLoad] = useState('');
  const [saving, setSaving] = useState(false);
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([]);
  const [loadingBenchmarks, setLoadingBenchmarks] = useState(false);
  const [selectedSloIds, setSelectedSloIds] = useState<Set<string>>(new Set());

  const systemId = testRun.system_under_test_id || (testRun.systems_under_test as any)?.id;
  const systemName = testRun.systems_under_test?.name || testRun.system_under_test_id;
  const environment = testRun.test_environment;
  const workload = testRun.workload;

  // Generate default name
  useEffect(() => {
    if (open) {
      const shortSystem = systemName?.split('-')[0] || 'System';
      setName(`${shortSystem} scaling - ${new Date().toLocaleDateString()}`);
      setDescription('');
      setTargetLoad('');
      setSelectedSloIds(new Set());
    }
  }, [open, systemName]);

  // Load benchmarks (SLOs) for the scope
  const fetchBenchmarks = useCallback(async () => {
    if (!open || !systemId || !environment || !workload) return;

    setLoadingBenchmarks(true);
    try {
      const params = new URLSearchParams({
        systemUnderTestId: systemId,
        testEnvironment: environment,
        workload: workload,
        enabled: 'true',
      });
      const response = await authenticatedFetch(`/benchmarks?${params}`, { method: 'GET' });
      if (response.ok) {
        const data = await response.json();
        setBenchmarks(data);
      }
    } catch {
      // Non-critical — we just won't show SLO selection
    } finally {
      setLoadingBenchmarks(false);
    }
  }, [open, systemId, environment, workload]);

  useEffect(() => {
    fetchBenchmarks();
  }, [fetchBenchmarks]);

  const toggleSlo = (id: string) => {
    setSelectedSloIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;

    setSaving(true);
    try {
      // 1. Create the scaling session
      const createResponse = await authenticatedFetch('/scaling-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          systemUnderTestId: systemId,
          testEnvironment: environment,
          workload: workload,
          baselineTestRunId: testRun.test_run_id,
          targetLoad: targetLoad.trim() || undefined,
          linkedBenchmarkIds: selectedSloIds.size > 0 ? Array.from(selectedSloIds) : undefined,
        }),
      });

      if (!createResponse.ok) {
        const err = await createResponse.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to create scaling session');
      }

      const session = await createResponse.json();

      // 2. Add the current test run to the session
      const addResponse = await authenticatedFetch(
        `/scaling-sessions/${session.id}/runs/${testRun.test_run_id}`,
        { method: 'PUT' },
      );

      if (!addResponse.ok) {
        throw new Error('Session created but failed to associate test run');
      }

      onSuccess(`Scaling session "${name}" started. ADAPT mode set to Scaling.`);
      onSessionCreated();
      onClose();
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to create session';
      onError(msg);
    } finally {
      setSaving(false);
    }
  };

  const formatBenchmarkLabel = (b: Benchmark): string => {
    if (b.benchmark_type === 'apdex') {
      const txn = b.transaction_name || 'All transactions';
      return `Apdex: ${txn} (T=${b.apdex_threshold_ms}ms, min=${b.min_apdex_score})`;
    }
    const title = b.config_title || b.panel_title || 'Metric SLO';
    const req = b.requirement_operator && b.requirement_value != null
      ? ` ${b.requirement_operator} ${b.requirement_value}${b.metric_unit ? ` ${b.metric_unit}` : ''}`
      : '';
    return `${title}${req}`;
  };

  const sloConfigUrl = systemId ? `/systems/${systemId}/config?tab=slo&environment=${encodeURIComponent(environment)}&workload=${encodeURIComponent(workload)}` : null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <TrendingUp color="primary" />
        Start Scaling Session
      </DialogTitle>

      <DialogContent>
        {/* Context info */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2, mt: 1 }}>
          <Chip label={systemName} size="small" color="primary" variant="outlined" />
          <Chip label={environment} size="small" variant="outlined" />
          <Chip label={workload} size="small" variant="outlined" />
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          This test run will become the baseline. Future runs for this workload will automatically use ADAPT Scaling mode.
        </Typography>

        <TextField
          label="Session Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
          required
          size="small"
          sx={{ mb: 2 }}
        />

        <TextField
          label="Target Load"
          value={targetLoad}
          onChange={(e) => setTargetLoad(e.target.value)}
          fullWidth
          size="small"
          placeholder="e.g. 1000 concurrent users"
          helperText="What load level are you scaling towards?"
          sx={{ mb: 2 }}
        />

        <TextField
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          fullWidth
          size="small"
          multiline
          minRows={2}
          sx={{ mb: 2 }}
        />

        <Divider sx={{ my: 2 }} />

        {/* SLO Goal Selection */}
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
          Scaling Goals (SLOs)
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Select which SLOs define success at each load level.
        </Typography>

        {loadingBenchmarks ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={24} />
          </Box>
        ) : benchmarks.length > 0 ? (
          <Box sx={{ maxHeight: 200, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
            {benchmarks.map((b) => (
              <FormControlLabel
                key={b.id}
                control={
                  <Checkbox
                    size="small"
                    checked={selectedSloIds.has(b.id)}
                    onChange={() => toggleSlo(b.id)}
                  />
                }
                label={
                  <Typography variant="body2">
                    {formatBenchmarkLabel(b)}
                  </Typography>
                }
                sx={{ display: 'flex', mb: 0.5 }}
              />
            ))}
          </Box>
        ) : (
          <Alert severity="info" sx={{ mb: 1 }}>
            <Typography variant="body2" sx={{ mb: 1 }}>
              No SLOs configured for this workload. For meaningful scaling results, we recommend creating:
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2 }}>
              <li>
                <Typography variant="body2">
                  <strong>Apdex SLO</strong> — measures user-perceived response quality
                </Typography>
              </li>
              <li>
                <Typography variant="body2">
                  <strong>Throughput SLO</strong> — ensures the system handles the target request rate
                </Typography>
              </li>
            </Box>
            {sloConfigUrl && (
              <Button
                component={Link}
                href={sloConfigUrl}
                size="small"
                endIcon={<OpenInNew fontSize="small" />}
                sx={{ mt: 1, textTransform: 'none' }}
              >
                Configure SLOs
              </Button>
            )}
          </Alert>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={saving || !name.trim()}
          startIcon={saving ? <CircularProgress size={16} /> : <TrendingUp />}
        >
          Start Session
        </Button>
      </DialogActions>
    </Dialog>
  );
}
