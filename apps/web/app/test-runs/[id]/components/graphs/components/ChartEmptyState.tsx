'use client';

import React from 'react';
import { Box, Typography } from '@mui/material';
import { ChartEmptyStateProps } from '../types';

/**
 * Empty state messages for different variants
 */
const EMPTY_STATE_MESSAGES = {
  'no-series': 'Add series to view chart',
  'no-data': 'No data available'
} as const;

/**
 * Empty state component for GraphsChart
 * Displays appropriate message when no series are configured or no data is available
 */
export function ChartEmptyState({
  variant,
  height = 500
}: ChartEmptyStateProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height,
        backgroundColor: 'background.paper',
        borderRadius: 2,
        border: '1px dashed',
        borderColor: 'divider'
      }}
    >
      <Typography variant="body1" color="text.secondary">
        {EMPTY_STATE_MESSAGES[variant]}
      </Typography>
    </Box>
  );
}
