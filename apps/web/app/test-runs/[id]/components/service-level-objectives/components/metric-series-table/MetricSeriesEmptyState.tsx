'use client';

import React from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import type { MetricSeriesEmptyStateProps } from '../../types';

export function MetricSeriesEmptyState({
  message = 'No values available for this SLO'
}: MetricSeriesEmptyStateProps) {
  const theme = useTheme();

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: '1fr',
        p: 4,
        border: '1px solid',
        borderColor: theme.palette.divider,
        borderTop: 'none',
        borderRadius: '0 0 4px 4px',
        backgroundColor: theme.palette.action.hover,
        textAlign: 'center'
      }}
    >
      <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
        {message}
      </Typography>
    </Box>
  );
}
