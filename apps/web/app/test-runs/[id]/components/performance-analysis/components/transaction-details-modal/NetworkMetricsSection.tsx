'use client';

import { Grid, Paper, Typography } from '@mui/material';
import { NetworkCheck as NetworkCheckIcon } from '@mui/icons-material';
import { SamplerStat } from '../../types/performance-analysis.types';
import { formatNumber } from '../../utils/performance-formatters';
import { MetricCard } from './MetricCard';

interface NetworkMetricsSectionProps {
  samplers: SamplerStat[];
}

export function NetworkMetricsSection({ samplers }: NetworkMetricsSectionProps) {
  if (samplers.length === 0) {
    return null;
  }

  const totalRequestSize = samplers.reduce((sum, s) => sum + s.total_request_size, 0);
  const totalResponseSize = samplers.reduce((sum, s) => sum + s.total_response_size, 0);
  const avgLatency = samplers.reduce((sum, s) => sum + s.avg_latency, 0) / samplers.length;
  const avgConnectTime = samplers.reduce((sum, s) => sum + s.avg_connect_time, 0) / samplers.length;

  return (
    <Paper sx={{ p: 3 }}>
      <Typography
        variant="h6"
        component="h3"
        gutterBottom
        sx={{
          fontWeight: 700,
          color: 'info.main',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          mb: 3,
        }}
      >
        <NetworkCheckIcon />
        Network & Connection Metrics
      </Typography>
      <Grid container spacing={2}>
        <Grid size={6}>
          <MetricCard
            label="Request Size"
            value={(totalRequestSize / 1024 / 1024).toFixed(2)}
            unit="MB"
            color="info.main"
            borderColor="rgba(0, 188, 212, 0.3)"
          />
        </Grid>
        <Grid size={6}>
          <MetricCard
            label="Response Size"
            value={(totalResponseSize / 1024 / 1024).toFixed(2)}
            unit="MB"
            color="info.main"
            borderColor="rgba(0, 188, 212, 0.3)"
          />
        </Grid>
        <Grid size={6}>
          <MetricCard
            label="Avg Latency"
            value={formatNumber(avgLatency)}
            unit="ms"
            color="info.main"
            borderColor="rgba(0, 188, 212, 0.3)"
          />
        </Grid>
        <Grid size={6}>
          <MetricCard
            label="Avg Connect Time"
            value={formatNumber(avgConnectTime)}
            unit="ms"
            color="info.main"
            borderColor="rgba(0, 188, 212, 0.3)"
          />
        </Grid>
      </Grid>
    </Paper>
  );
}
