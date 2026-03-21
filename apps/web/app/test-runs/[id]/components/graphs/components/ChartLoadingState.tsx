'use client';

import React from 'react';
import { Box, CircularProgress } from '@mui/material';
import { ChartLoadingStateProps } from '../types';

/**
 * Loading state component for GraphsChart
 * Displays a centered loading spinner in a styled container
 */
export function ChartLoadingState({ height = 500 }: ChartLoadingStateProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height,
        backgroundColor: 'background.paper',
        borderRadius: 2
      }}
    >
      <CircularProgress />
    </Box>
  );
}
