'use client';

import { Box, Grid, Paper, Typography } from '@mui/material';
import { Assessment as AssessmentIcon } from '@mui/icons-material';
import { TransactionStat } from '../../types/performance-analysis.types';
import { getApdexColor, getApdexLabel } from '../../utils/performance-formatters';
import { MetricCard } from './MetricCard';

interface ApdexInfoSectionProps {
  transaction: TransactionStat;
}

export function ApdexInfoSection({ transaction }: ApdexInfoSectionProps) {
  const apdexColor = getApdexColor(transaction.apdex_score);

  return (
    <Paper sx={{ p: 3 }}>
      <Typography
        variant="h6"
        component="h3"
        gutterBottom
        sx={{
          fontWeight: 700,
          color: 'secondary.main',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          mb: 3,
        }}
      >
        <AssessmentIcon />
        Apdex Information
      </Typography>
      <Grid container spacing={2} justifyContent="flex-start">
        <Grid size={{ xs: 6, sm: 4, md: 3 }}>
          <Box
            sx={{
              p: 2,
              borderRadius: 2,
              background: 'rgba(255, 255, 255, 0.7)',
              border: `2px solid ${apdexColor}`,
              textAlign: 'center',
            }}
          >
            <Typography
              variant="caption"
              sx={{
                color: 'text.secondary',
                fontWeight: 700,
                textTransform: 'uppercase',
                display: 'block',
                mb: 1,
              }}
            >
              Apdex Score
            </Typography>
            <Typography
              variant="h4"
              sx={{
                fontFamily: 'monospace',
                fontWeight: 700,
                color: apdexColor,
                mb: 0.5,
              }}
            >
              {transaction.apdex_score.toFixed(3)}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: apdexColor,
                fontWeight: 700,
                textTransform: 'uppercase',
              }}
            >
              {getApdexLabel(transaction.apdex_score)}
            </Typography>
          </Box>
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 3 }}>
          <MetricCard
            label="Active Threshold"
            value={transaction.active_threshold}
            unit="ms"
            color="secondary.main"
            borderColor="rgba(156, 39, 176, 0.3)"
          />
        </Grid>
      </Grid>
    </Paper>
  );
}
