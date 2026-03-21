'use client';

import { Box, Typography, useTheme } from '@mui/material';

export function ChartEmptyState() {
  const theme = useTheme();

  return (
    <Box
      sx={{
        textAlign: 'center',
        py: 4,
        backgroundColor: theme.palette.mode === 'dark' ? 'transparent' : theme.palette.grey[50],
        borderRadius: 1,
        border: `1px solid ${theme.palette.divider}`,
      }}
    >
      <Typography variant="body2" color="text.secondary">
        No current test run data available for this metric
      </Typography>
    </Box>
  );
}
