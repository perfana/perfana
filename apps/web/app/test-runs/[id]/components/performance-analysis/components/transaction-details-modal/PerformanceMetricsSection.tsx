'use client';

import { Grid, Paper, Typography } from '@mui/material';
import { ShowChart as ShowChartIcon } from '@mui/icons-material';
import { TransactionStat, SamplerStat } from '../../types/performance-analysis.types';
import { formatNumber } from '../../utils/performance-formatters';
import { MetricCard } from './MetricCard';

interface PerformanceMetricsSectionProps {
  transaction: TransactionStat;
  samplers: SamplerStat[];
}

export function PerformanceMetricsSection({ transaction, samplers }: PerformanceMetricsSectionProps) {
  const minResponseTime = samplers.length > 0
    ? Math.min(...samplers.map(s => s.min_response_time))
    : undefined;

  const maxResponseTime = samplers.length > 0
    ? Math.max(...samplers.map(s => s.max_response_time))
    : undefined;

  return (
    <Paper sx={{ p: 3 }}>
      <Typography
        variant="h6"
        component="h3"
        gutterBottom
        sx={{
          fontWeight: 700,
          color: 'primary.main',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          mb: 3,
        }}
      >
        <ShowChartIcon />
        Performance Metrics
      </Typography>
      <Grid container spacing={2}>
        <Grid size={{ xs: 6, sm: 4 }}>
          <MetricCard
            label="Avg Response"
            value={formatNumber(transaction.avg_response_time)}
            unit="ms"
            color="primary.main"
            borderColor="rgba(25, 118, 210, 0.15)"
            hoverEffect
          />
        </Grid>

        <Grid size={{ xs: 6, sm: 4 }}>
          <MetricCard
            label="P95 Response"
            value={formatNumber(transaction.p95_response_time)}
            unit="ms"
            color="warning.main"
            borderColor="rgba(255, 152, 0, 0.3)"
            hoverEffect
          />
        </Grid>

        <Grid size={{ xs: 6, sm: 4 }}>
          <MetricCard
            label="P99 Response"
            value={formatNumber(transaction.p99_response_time)}
            unit="ms"
            color="error.main"
            borderColor="rgba(244, 67, 54, 0.3)"
            hoverEffect
          />
        </Grid>

        {samplers.length > 0 && minResponseTime !== undefined && maxResponseTime !== undefined && (
          <>
            <Grid size={{ xs: 6, sm: 4 }}>
              <MetricCard
                label="Min Response"
                value={formatNumber(minResponseTime)}
                unit="ms"
                color="success.main"
                borderColor="rgba(76, 175, 80, 0.3)"
                hoverEffect
              />
            </Grid>

            <Grid size={{ xs: 6, sm: 4 }}>
              <MetricCard
                label="Max Response"
                value={formatNumber(maxResponseTime)}
                unit="ms"
                color="error.main"
                borderColor="rgba(244, 67, 54, 0.3)"
                hoverEffect
              />
            </Grid>
          </>
        )}
      </Grid>
    </Paper>
  );
}
