'use client';

import { Box, CircularProgress, Typography } from '@mui/material';

export function ChartLoadingState() {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '500px',
        gap: 2,
      }}
    >
      <CircularProgress size={48} thickness={4} />
      <Typography variant="body2" color="text.secondary">
        Loading performance data...
      </Typography>
    </Box>
  );
}
