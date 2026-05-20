'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Box, Typography, Alert, CircularProgress,
  Switch, FormControlLabel, TextField, Autocomplete,
} from '@mui/material';
import { authenticatedFetch } from '@/lib/api';

type AggregateMetric = 'transaction_response_time' | 'request_response_time' | 'error_percentage';
type AggregateStat = 'avg' | 'p50' | 'p90' | 'p95' | 'p99' | 'max';

interface WorkloadContext {
  systemUnderTestId: string;
  systemName: string;
  testEnvironment: string;
  workload: string;
}

export interface ExistingAggregatedBenchmark {
  id: string;
  aggregate_metric: AggregateMetric;
  aggregate_stat?: AggregateStat;
  requirement_operator: string;
  requirement_value: number;
  exclude_ramp_up_time: boolean;
  enabled: boolean;
}

interface AggregatedSloDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  testRunId?: string;
  systemUnderTestId?: string;
  systemName?: string;
  testEnvironment?: string;
  workload?: string;
  existingBenchmark?: ExistingAggregatedBenchmark;
}

const METRIC_OPTIONS: { value: AggregateMetric; label: string }[] = [
  { value: 'transaction_response_time', label: 'Aggregated transaction response times' },
  { value: 'request_response_time', label: 'Aggregated request response times' },
  { value: 'error_percentage', label: 'Aggregated error percentage' },
];

const STAT_OPTIONS: { value: AggregateStat; label: string }[] = [
  { value: 'avg', label: 'avg' },
  { value: 'p50', label: 'p50' },
  { value: 'p90', label: 'p90' },
  { value: 'p95', label: 'p95' },
  { value: 'p99', label: 'p99' },
  { value: 'max', label: 'max' },
];

const OPERATOR_OPTIONS = ['<=', '<', '>=', '>'];

export default function AggregatedSloDialog({
  open, onClose, onSuccess,
  testRunId,
  systemUnderTestId: propSystemId,
  systemName: propSystemName,
  testEnvironment: propEnv,
  workload: propWorkload,
  existingBenchmark,
}: AggregatedSloDialogProps) {
  const isEditMode = !!existingBenchmark;

  const [ctx, setCtx] = useState<WorkloadContext | null>(null);
  const [loadingCtx, setLoadingCtx] = useState(false);

  const [metric, setMetric] = useState<AggregateMetric>('transaction_response_time');
  const [stat, setStat] = useState<AggregateStat>('p95');
  const [operator, setOperator] = useState('<=');
  const [threshold, setThreshold] = useState<string>('2000');
  const [excludeRampUp, setExcludeRampUp] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSuccess(false);

    if (existingBenchmark) {
      setMetric(existingBenchmark.aggregate_metric);
      setStat((existingBenchmark.aggregate_stat as AggregateStat) ?? 'p95');
      setOperator(existingBenchmark.requirement_operator);
      setThreshold(String(existingBenchmark.requirement_value));
      setExcludeRampUp(existingBenchmark.exclude_ramp_up_time);
    } else {
      setMetric('transaction_response_time');
      setStat('p95');
      setOperator('<=');
      setThreshold('2000');
      setExcludeRampUp(true);
    }

    if (propSystemId && propEnv && propWorkload) {
      setCtx({
        systemUnderTestId: propSystemId,
        systemName: propSystemName ?? propSystemId,
        testEnvironment: propEnv,
        workload: propWorkload,
      });
    } else if (testRunId) {
      fetchCtxFromTestRun(testRunId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fetchCtxFromTestRun = async (id: string) => {
    try {
      setLoadingCtx(true);
      const res = await authenticatedFetch(`/test-runs/${id}`);
      if (!res.ok) throw new Error('Failed to load test run');
      const data = await res.json();
      setCtx({
        systemUnderTestId: data.system_under_test_id,
        systemName: data.system_name ?? data.systems_under_test?.name ?? data.system_under_test_id,
        testEnvironment: data.test_environment,
        workload: data.workload,
      });
    } catch {
      setError('Failed to load test run details');
    } finally {
      setLoadingCtx(false);
    }
  };

  const thresholdUnit = metric === 'error_percentage' ? '%' : 'ms';
  const showStat = metric !== 'error_percentage';

  const isValid = () => {
    if (!ctx) return false;
    const val = parseFloat(threshold);
    if (isNaN(val)) return false;
    if (showStat && !stat) return false;
    return true;
  };

  const handleSave = async () => {
    if (!ctx || !isValid()) return;
    try {
      setLoading(true);
      setError(null);

      let res: Response;
      if (isEditMode && existingBenchmark) {
        res = await authenticatedFetch(`/benchmarks/aggregated/${existingBenchmark.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            aggregateStat: showStat ? stat : undefined,
            requirementOperator: operator,
            requirementValue: parseFloat(threshold),
            excludeRampUpTime: excludeRampUp,
          }),
        });
      } else {
        res = await authenticatedFetch('/benchmarks/aggregated', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemUnderTestId: ctx.systemUnderTestId,
            testEnvironment: ctx.testEnvironment,
            workload: ctx.workload,
            aggregateMetric: metric,
            aggregateStat: showStat ? stat : undefined,
            requirementOperator: operator,
            requirementValue: parseFloat(threshold),
            excludeRampUpTime: excludeRampUp,
          }),
        });
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error((errData as { message?: string }).message ?? 'Failed to save SLO');
      }

      setSuccess(true);
      setTimeout(() => { onSuccess(); onClose(); }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save SLO');
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    if (!existingBenchmark) return;
    try {
      setLoading(true);
      setError(null);
      const res = await authenticatedFetch(`/benchmarks/aggregated/${existingBenchmark.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      if (!res.ok) throw new Error('Failed to disable SLO');
      setSuccess(true);
      setTimeout(() => { onSuccess(); onClose(); }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disable SLO');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Set Aggregated Test SLO</DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {loadingCtx && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">Loading...</Typography>
            </Box>
          )}

          <Alert severity="info">
            <Typography variant="body2">
              <strong>Aggregated Test SLO</strong> checks a single metric aggregated across all
              {metric !== 'error_percentage' ? ' transactions or requests' : ' requests'} in the test run.
            </Typography>
          </Alert>

          <Autocomplete
            options={METRIC_OPTIONS}
            getOptionLabel={(o) => o.label}
            isOptionEqualToValue={(o, v) => o.value === v.value}
            value={METRIC_OPTIONS.find(o => o.value === metric) ?? null}
            onChange={(_, v) => { if (v) setMetric(v.value); }}
            disabled={isEditMode || loading}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Metric"
                required
                helperText={isEditMode ? 'Metric cannot be changed after creation' : undefined}
              />
            )}
          />

          <Box sx={{ display: 'grid', gridTemplateColumns: showStat ? '1fr 80px 1fr' : '80px 1fr', gap: 1.5 }}>
            {showStat && (
              <Autocomplete
                options={STAT_OPTIONS}
                getOptionLabel={(o) => o.label}
                isOptionEqualToValue={(o, v) => o.value === v.value}
                value={STAT_OPTIONS.find(o => o.value === stat) ?? null}
                onChange={(_, v) => { if (v) setStat(v.value); }}
                disabled={loading}
                renderInput={(params) => <TextField {...params} label="Statistic" required />}
              />
            )}
            <Autocomplete
              options={OPERATOR_OPTIONS}
              value={operator}
              onChange={(_, v) => { if (v) setOperator(v); }}
              disabled={loading}
              renderInput={(params) => <TextField {...params} label="Operator" />}
            />
            <TextField
              label={`Threshold (${thresholdUnit})`}
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              disabled={loading}
              required
            />
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={excludeRampUp}
                  onChange={(e) => setExcludeRampUp(e.target.checked)}
                  disabled={loading}
                  size="small"
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight={500}>Exclude ramp-up period</Typography>
                  <Typography variant="caption" color="text.secondary">Requests during ramp-up phase are excluded</Typography>
                </Box>
              }
            />
          </Box>

          {ctx && (
            <Box sx={{ bgcolor: 'grey.50', borderRadius: 1, p: 1.5, fontSize: 12, color: 'text.secondary' }}>
              Applies to all future test runs matching:<br />
              • System: <strong>{ctx.systemName}</strong> · Environment: <strong>{ctx.testEnvironment}</strong> · Workload: <strong>{ctx.workload}</strong>
            </Box>
          )}

          {error && <Alert severity="error">{error}</Alert>}
          {success && <Alert severity="success">SLO saved successfully!</Alert>}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, justifyContent: isEditMode ? 'space-between' : 'flex-end' }}>
        {isEditMode && (
          <Button onClick={handleDisable} color="error" disabled={loading}>
            Disable SLO
          </Button>
        )}
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={onClose} disabled={loading}>Cancel</Button>
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={loading || success || !isValid() || loadingCtx}
            startIcon={loading ? <CircularProgress size={16} /> : null}
          >
            {loading ? 'Saving...' : isEditMode ? 'Update SLO' : 'Create SLO'}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
