'use client';

import { Box, CircularProgress, Typography, useTheme } from '@mui/material';
import { DEFAULT_CHART_HEIGHT } from '../utils';

export function ChartLoadingState() {
  const theme = useTheme();

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: DEFAULT_CHART_HEIGHT,
        backgroundColor: theme.palette.mode === 'dark' ? 'transparent' : theme.palette.grey[50],
        borderRadius: 1,
      }}
    >
      <Box sx={{ textAlign: 'center' }}>
        <CircularProgress size={24} sx={{ mb: 1 }} />
        <Typography variant="body2" color="text.secondary">
          Loading current test run chart...
        </Typography>
      </Box>
    </Box>
  );
}
