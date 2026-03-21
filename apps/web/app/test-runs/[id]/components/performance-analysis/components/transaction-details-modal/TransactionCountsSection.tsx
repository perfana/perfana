'use client';

import { Grid, Paper, Typography } from '@mui/material';
import { TrendingUp as TrendingUpIcon } from '@mui/icons-material';
import { TransactionStat } from '../../types/performance-analysis.types';
import { MetricCard } from './MetricCard';

interface TransactionCountsSectionProps {
  transaction: TransactionStat;
}

export function TransactionCountsSection({ transaction }: TransactionCountsSectionProps) {
  return (
    <Paper sx={{ p: 3 }}>
      <Typography
        variant="h6"
        component="h3"
        gutterBottom
        sx={{
          fontWeight: 700,
          color: 'success.main',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          mb: 3,
        }}
      >
        <TrendingUpIcon />
        Transaction Counts
      </Typography>
      <Grid container spacing={2}>
        <Grid size={{ xs: 6, sm: 4 }}>
          <MetricCard
            label="Passed"
            value={transaction.passed_count.toLocaleString()}
            color="success.main"
            borderColor="rgba(76, 175, 80, 0.3)"
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4 }}>
          <MetricCard
            label="Failed"
            value={transaction.failed_count.toLocaleString()}
            color="error.main"
            borderColor="rgba(244, 67, 54, 0.3)"
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4 }}>
          <MetricCard
            label="Total"
            value={transaction.total_count.toLocaleString()}
            borderColor="rgba(0, 0, 0, 0.15)"
          />
        </Grid>
      </Grid>
    </Paper>
  );
}
