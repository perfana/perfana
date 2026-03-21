'use client';

import { Box, Paper, Typography } from '@mui/material';
import { EmojiEvents as EmojiEventsIcon } from '@mui/icons-material';
import { TransactionStat } from '../../types/performance-analysis.types';

interface ErrorRateSectionProps {
  transaction: TransactionStat;
}

export function ErrorRateSection({ transaction }: ErrorRateSectionProps) {
  const errorRate = transaction.total_count > 0
    ? ((transaction.failed_count / transaction.total_count) * 100).toFixed(2)
    : '0.00';

  return (
    <Paper sx={{ p: 3 }}>
      <Typography
        variant="h6"
        component="h3"
        gutterBottom
        sx={{
          fontWeight: 700,
          color: 'error.main',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          mb: 3,
        }}
      >
        <EmojiEventsIcon />
        Error Rate
      </Typography>
      <Box
        sx={{
          p: 3,
          borderRadius: 2,
          background: 'rgba(255, 255, 255, 0.7)',
          border: '2px solid rgba(244, 67, 54, 0.3)',
          textAlign: 'center',
        }}
      >
        <Typography
          variant="h3"
          sx={{
            fontFamily: 'monospace',
            fontWeight: 700,
            color: 'error.main',
            mb: 1,
          }}
        >
          {errorRate}%
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
          Percentage of failed requests out of {transaction.total_count.toLocaleString()} total
        </Typography>
      </Box>
    </Paper>
  );
}
