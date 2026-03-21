'use client';

import React from 'react';
import { Box, Typography, alpha, useTheme } from '@mui/material';
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
        borderColor: alpha(theme.palette.divider, 0.6),
        borderTop: 'none',
        borderRadius: '0 0 4px 4px',
        backgroundColor: alpha(theme.palette.action.hover, 0.3),
        textAlign: 'center'
      }}
    >
      <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
        {message}
      </Typography>
    </Box>
  );
}
