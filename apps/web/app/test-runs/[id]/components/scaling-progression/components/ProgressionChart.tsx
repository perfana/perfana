'use client';

import { useMemo } from 'react';
import { Box, Typography, Chip, Tooltip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { ProgressionData, ProgressionRun, SloResult } from '../types';

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

function formatSloLabel(slo: SloResult): string {
  if (slo.benchmark_type === 'apdex') {
    const txn = slo.transaction_name || 'All transactions';
    return `Apdex: ${txn}`;
  }
  return slo.label;
}

function formatSloValue(slo: SloResult): string {
  if (slo.actual_value == null) return 'N/A';
  const unit = slo.metric_unit ? ` ${slo.metric_unit}` : '';
  return `${Number(slo.actual_value).toFixed(2)}${unit}`;
}

function formatSloThreshold(slo: SloResult): string {
  if (slo.benchmark_type === 'apdex') {
    return `>= ${slo.min_apdex_score} (T=${slo.apdex_threshold_ms}ms)`;
  }
  if (slo.requirement_operator && slo.requirement_value != null) {
    const unit = slo.metric_unit ? ` ${slo.metric_unit}` : '';
    return `${slo.requirement_operator} ${slo.requirement_value}${unit}`;
  }
  return '';
}

export function ProgressionChart({ data, currentTestRunId }: Props) {
  const { session, runs } = data;
  const linkedBenchmarks = session.linked_benchmarks || [];

  // Build chart data: track SLO actual values across runs
  const chartData = useMemo(() => {
    return runs.map((run, i) => {
      const point: Record<string, any> = {
        name: getLoadLabel(run, i),
        runIndex: i,
        testRunId: run.test_run_id,
        isCurrentRun: run.test_run_id === currentTestRunId,
      };

      for (const slo of run.slo_results) {
        if (slo.actual_value != null) {
          point[slo.benchmark_id] = Number(slo.actual_value);
        }
      }

      return point;
    });
  }, [runs, currentTestRunId]);

  const currentRunIndex = runs.findIndex(r => r.test_run_id === currentTestRunId);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Linked SLO definitions */}
      {linkedBenchmarks.length > 0 && (
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
            Scaling Goals
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {linkedBenchmarks.map((b) => (
              <Tooltip
                key={b.id}
                title={b.benchmark_type === 'apdex'
                  ? `Apdex >= ${b.min_apdex_score} (T=${b.apdex_threshold_ms}ms)`
                  : `${b.requirement_operator || ''} ${b.requirement_value ?? ''}${b.metric_unit ? ` ${b.metric_unit}` : ''}`
                }
              >
                <Chip
                  label={b.label}
                  size="small"
                  variant="outlined"
                  color={b.enabled ? 'default' : 'default'}
                  sx={{ opacity: b.enabled ? 1 : 0.5 }}
                />
              </Tooltip>
            ))}
          </Box>
        </Box>
      )}

      {/* Per-run SLO results table */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {runs.map((run, i) => {
          const allPassed = run.slo_results.length > 0 && run.slo_results.every(s => s.meets_requirement === true);
          const hasFails = run.slo_results.some(s => s.meets_requirement === false);
          const isCurrent = run.test_run_id === currentTestRunId;

          return (
            <Box
              key={run.test_run_id}
              sx={{
                p: 1.5,
                borderRadius: 1,
                border: '1px solid',
                borderColor: isCurrent ? 'primary.main' : 'divider',
                bgcolor: isCurrent ? 'action.selected' : 'transparent',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: run.slo_results.length > 0 ? 1 : 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {getLoadLabel(run, i)}
                  </Typography>
                  {isCurrent && (
                    <Chip label="current" size="small" color="primary" sx={{ height: 18, fontSize: '0.65rem' }} />
                  )}
                </Box>
                {run.slo_results.length > 0 ? (
                  allPassed ? (
                    <Chip icon={<CheckCircleIcon />} label="All SLOs passed" size="small" color="success" variant="outlined" />
                  ) : hasFails ? (
                    <Chip icon={<CancelIcon />} label={`${run.slo_results.filter(s => s.meets_requirement === false).length} SLO${run.slo_results.filter(s => s.meets_requirement === false).length > 1 ? 's' : ''} failed`} size="small" color="error" variant="outlined" />
                  ) : (
                    <Chip icon={<HelpOutlineIcon />} label="Pending" size="small" variant="outlined" />
                  )
                ) : !run.completed ? (
                  <Chip label="In progress" size="small" variant="outlined" />
                ) : (
                  <Chip label="No SLO data" size="small" variant="outlined" />
                )}
              </Box>

              {/* Individual SLO results */}
              {run.slo_results.length > 0 && (
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {run.slo_results.map((slo) => (
                    <Tooltip
                      key={slo.benchmark_id}
                      title={`${formatSloLabel(slo)}: ${formatSloValue(slo)} (threshold: ${formatSloThreshold(slo)})`}
                    >
                      <Chip
                        icon={slo.meets_requirement === true ? <CheckCircleIcon /> : slo.meets_requirement === false ? <CancelIcon /> : <HelpOutlineIcon />}
                        label={`${formatSloLabel(slo)}: ${formatSloValue(slo)}`}
                        size="small"
                        color={slo.meets_requirement === true ? 'success' : slo.meets_requirement === false ? 'error' : 'default'}
                        variant="outlined"
                        sx={{ fontSize: '0.7rem' }}
                      />
                    </Tooltip>
                  ))}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Chart: SLO actual values across runs */}
      {linkedBenchmarks.length > 0 && runs.some(r => r.slo_results.length > 0) && (
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis dataKey="name" />
            <YAxis />
            <RechartsTooltip
              contentStyle={{ backgroundColor: '#1e1e1e', border: '1px solid #333' }}
              labelStyle={{ color: '#fff' }}
            />
            <Legend />
            {currentRunIndex >= 0 && (
              <ReferenceLine
                x={getLoadLabel(runs[currentRunIndex]!, currentRunIndex)}
                stroke="#1976d2"
                strokeDasharray="5 5"
                label={{ value: 'Current', position: 'top', fill: '#1976d2' }}
              />
            )}
            {linkedBenchmarks.map((b, i) => (
              <Line
                key={b.id}
                type="monotone"
                dataKey={b.id}
                name={b.label}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={2}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}

      {linkedBenchmarks.length === 0 && (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            No SLOs linked to this scaling session. Link SLOs when starting a session to track pass/fail across load levels.
          </Typography>
        </Box>
      )}
    </Box>
  );
}
