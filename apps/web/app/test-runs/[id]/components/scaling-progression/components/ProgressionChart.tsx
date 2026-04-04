'use client';

import { useMemo, useState } from 'react';
import { Box, Typography, FormControl, InputLabel, Select, MenuItem, Chip } from '@mui/material';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { ProgressionData, ProgressionRun } from '../types';

interface Props {
  data: ProgressionData;
  currentTestRunId: string;
}

const COLORS = ['#1976d2', '#9c27b0', '#4caf50', '#ff9800', '#f44336', '#00bcd4', '#795548', '#607d8b'];

function getLoadLabel(run: ProgressionRun, index: number): string {
  const load = run.load_config?.targetConcurrency
    || run.load_config?.target_concurrency
    || run.load_config?.threads
    || run.load_config?.vusers
    || run.load_config?.loadLevel;
  return load || `Run ${index + 1}`;
}

export function ProgressionChart({ data, currentTestRunId }: Props) {
  const { runs } = data;

  // Collect all unique panel+metric combinations across runs
  const availableMetrics = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ panel: string; metric: string; key: string }> = [];
    for (const run of runs) {
      for (const m of run.metrics) {
        const key = `${m.panel}::${m.metric}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push({ panel: m.panel, metric: m.metric, key });
        }
      }
    }
    return result;
  }, [runs]);

  // Default: select first 3 metrics
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(() =>
    availableMetrics.slice(0, 3).map(m => m.key)
  );

  // Build chart data: one data point per run, one field per metric
  const chartData = useMemo(() => {
    return runs.map((run, i) => {
      const point: Record<string, any> = {
        name: getLoadLabel(run, i),
        runIndex: i,
        testRunId: run.test_run_id,
        isCurrentRun: run.test_run_id === currentTestRunId,
        adaptConclusion: run.adapt_conclusion,
      };

      for (const m of run.metrics) {
        const key = `${m.panel}::${m.metric}`;
        if (selectedMetrics.includes(key)) {
          point[key] = m.p95 ?? m.median ?? m.mean;
        }
      }

      return point;
    });
  }, [runs, selectedMetrics, currentTestRunId]);

  const currentRunIndex = runs.findIndex(r => r.test_run_id === currentTestRunId);

  if (availableMetrics.length === 0) {
    return (
      <Box sx={{ py: 4, textAlign: 'center' }}>
        <Typography color="text.secondary">No metrics data available for this scaling session yet.</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Metric selector */}
      <FormControl size="small" sx={{ minWidth: 300 }}>
        <InputLabel>Metrics</InputLabel>
        <Select
          multiple
          value={selectedMetrics}
          onChange={(e) => setSelectedMetrics(typeof e.target.value === 'string' ? [e.target.value] : e.target.value)}
          label="Metrics"
          renderValue={(selected) => (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {selected.map((key) => {
                const m = availableMetrics.find(am => am.key === key);
                return <Chip key={key} label={m?.metric || key} size="small" />;
              })}
            </Box>
          )}
        >
          {availableMetrics.map((m) => (
            <MenuItem key={m.key} value={m.key}>
              {m.panel} / {m.metric}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Run status chips */}
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        {runs.map((run, i) => (
          <Chip
            key={run.test_run_id}
            label={getLoadLabel(run, i)}
            size="small"
            color={
              run.test_run_id === currentTestRunId ? 'primary' :
              run.adapt_conclusion === 'REGRESSION' ? 'error' :
              run.adapt_ok ? 'success' : 'default'
            }
            variant={run.test_run_id === currentTestRunId ? 'filled' : 'outlined'}
          />
        ))}
      </Box>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip
            contentStyle={{ backgroundColor: '#1e1e1e', border: '1px solid #333' }}
            labelStyle={{ color: '#fff' }}
          />
          <Legend />
          {currentRunIndex >= 0 && (
            <ReferenceLine
              x={getLoadLabel(runs[currentRunIndex], currentRunIndex)}
              stroke="#1976d2"
              strokeDasharray="5 5"
              label={{ value: 'Current', position: 'top', fill: '#1976d2' }}
            />
          )}
          {selectedMetrics.map((key, i) => {
            const m = availableMetrics.find(am => am.key === key);
            return (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={m?.metric || key}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={2}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
                connectNulls
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
}
