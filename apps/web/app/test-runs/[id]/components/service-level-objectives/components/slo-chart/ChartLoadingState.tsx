'use client';

import { Box, CircularProgress, Typography, useTheme } from '@mui/material';
import { DEFAULT_CHART_HEIGHT } from '../../utils/slo-chart-utils';

export function ChartLoadingState() {
  const _theme = useTheme();

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: DEFAULT_CHART_HEIGHT,
        backgroundColor: 'action.hover',
        borderRadius: 1,
      }}
    >
      <Box sx={{ textAlign: 'center' }}>
        <CircularProgress size={24} sx={{ mb: 1 }} />
        <Typography variant="body2" color="text.secondary">
          Loading metrics chart...
        </Typography>
      </Box>
    </Box>
  );
}
