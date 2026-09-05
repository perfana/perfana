'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Slider, Typography, Box, CircularProgress, Alert, useTheme,
  Checkbox, FormControlLabel,
} from '@mui/material';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer, Legend,
} from 'recharts';
import { TestRun } from '@/types/test-runs';
import { authenticatedFetch } from '@/lib/api';

interface SummaryBucket {
  timeSeconds: number;
  throughput: number;
  avgResponseTime: number;
  errorsPerSecond: number;
}

interface SummaryTimeseriesResponse {
  duration: number;
  bucketSizeSeconds: number;
  buckets: SummaryBucket[];
}

interface Props {
  open: boolean;
  testRun: TestRun;
  timeseriesData: SummaryTimeseriesResponse;
  onClose: () => void;
  onSaved: (updated: TestRun) => void;
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

export function AnalysisTimeRangeDialog({ open, testRun, timeseriesData, onClose, onSaved }: Props) {
  const theme = useTheme();
  const duration = timeseriesData.duration;

  const [localStart, setLocalStart] = useState(testRun.analysis_start_offset ?? 0);
  const [localEnd, setLocalEnd]     = useState(testRun.analysis_end_offset ?? 0);
  const [saving, setSaving]         = useState(false);
  const [saveError, setSaveError]   = useState<string | null>(null);
  const [applyToAll, setApplyToAll] = useState(false);

  // Slider value: [startOffset, duration - endOffset]
  const sliderValue: [number, number] = [localStart, duration - localEnd];

  const handleSliderChange = useCallback((_: Event, value: number | number[]) => {
    const [left, right] = value as [number, number];
    setLocalStart(Math.max(0, left));
    setLocalEnd(Math.max(0, duration - right));
  }, [duration]);

  const effectiveDuration = Math.max(0, duration - localStart - localEnd);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await authenticatedFetch(`/test-runs/${testRun.id}/analysis-time-range`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisStartOffset: localStart, analysisEndOffset: localEnd, applyToAll }),
      });
      if (!res.ok) throw new Error(`Failed to save analysis time range (HTTP ${res.status})`);
      const updated: TestRun = await res.json();
      onSaved(updated);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save — please try again');
    } finally {
      setSaving(false);
    }
  };

  const chartData = useMemo(() => timeseriesData.buckets.map(b => ({
    ...b,
    name: formatSeconds(b.timeSeconds),
  })), [timeseriesData.buckets]);

  // Snap to nearest bucket name for ReferenceArea/ReferenceLine —
  // Recharts categorical x-axis requires exact data key matches.
  const snapToNearest = useCallback((targetSeconds: number) => {
    if (chartData.length === 0) return '';
    return chartData.reduce((prev, curr) =>
      Math.abs(curr.timeSeconds - targetSeconds) < Math.abs(prev.timeSeconds - targetSeconds) ? curr : prev
    ).name;
  }, [chartData]);

  const startLine = snapToNearest(localStart);
  const endLine   = snapToNearest(duration - localEnd);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Change Analysis Time Range</DialogTitle>

      <DialogContent sx={{ pb: 0 }}>
        {/* Chart */}
        <Box sx={{ height: 220, mb: 2, background: theme.palette.mode === 'dark' ? '#0f172a' : '#f8fafc', borderRadius: 1, p: 1 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.mode === 'dark' ? '#1e293b' : '#e2e8f0'} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} interval={0} />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: 'none', borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />

              {/* Excluded start region */}
              {localStart > 0 && (
                <ReferenceArea yAxisId="left" x1={chartData[0]?.name} x2={startLine} fill="rgba(0,0,0,0.35)" />
              )}
              {/* Excluded end region */}
              {localEnd > 0 && (
                <ReferenceArea yAxisId="left" x1={endLine} x2={chartData[chartData.length - 1]?.name} fill="rgba(0,0,0,0.35)" />
              )}

              <Area yAxisId="left" type="monotone" dataKey="throughput" name="Throughput (tx/s)" fill="rgba(16,185,129,0.15)" stroke="#10b981" strokeWidth={1.5} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="avgResponseTime" name="Avg RT (ms)" stroke="#6366f1" strokeWidth={1.5} dot={false} />
              <Area yAxisId="left" type="monotone" dataKey="errorsPerSecond" name="Errors/s" fill="rgba(239,68,68,0.15)" stroke="#ef4444" strokeWidth={1} dot={false} />

              {/* Boundary lines */}
              <ReferenceLine yAxisId="left" x={startLine} stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 3" />
              <ReferenceLine yAxisId="left" x={endLine} stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </Box>

        {/* Slider */}
        <Box sx={{ px: 2, pb: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
            <Typography variant="caption" color="text.secondary">0s</Typography>
            <Typography variant="caption" color="text.secondary">{formatSeconds(duration)}</Typography>
          </Box>
          <Slider
            value={sliderValue}
            onChange={handleSliderChange}
            min={0}
            max={duration}
            step={1}
            sx={{ color: '#6366f1', '& .MuiSlider-thumb': { backgroundColor: '#f59e0b' } }}
          />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
            <Typography variant="caption">
              <span style={{ color: '#94a3b8' }}>Start offset: </span>
              <strong>{formatSeconds(localStart)}</strong>
            </Typography>
            <Typography variant="caption" color="success.main">
              Effective: <strong>{formatSeconds(effectiveDuration)}</strong>
            </Typography>
            <Typography variant="caption">
              <span style={{ color: '#94a3b8' }}>End offset: </span>
              <strong>{formatSeconds(localEnd)}</strong>
            </Typography>
          </Box>
        </Box>
      </DialogContent>

      {saveError && (
        <Box sx={{ px: 3, pb: 1 }}>
          <Alert severity="error" onClose={() => setSaveError(null)}>{saveError}</Alert>
        </Box>
      )}

      <Box sx={{ px: 3, pb: 0.5 }}>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={applyToAll}
              onChange={(e) => setApplyToAll(e.target.checked)}
              disabled={saving}
            />
          }
          label={
            <Typography variant="body2">
              Apply to all test runs of this workload
            </Typography>
          }
        />
        <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4, mt: -0.5 }}>
          {applyToAll
            ? `Every run of ${testRun.test_environment} / ${testRun.workload} gets these offsets and is re-evaluated. ADAPT compares a run against a baseline of other runs, so they only stay comparable while they share the same analysis window.`
            : 'Only this run changes. Its baseline runs keep their current analysis window, so the comparison spans two different windows.'}
        </Typography>
      </Box>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSave} variant="contained" disabled={saving} startIcon={saving ? <CircularProgress size={16} /> : undefined}>
          Save &amp; Re-analyse
        </Button>
      </DialogActions>
    </Dialog>
  );
}
