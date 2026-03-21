'use client';

import { Box, Typography, useTheme } from '@mui/material';

export function ChartEmptyState() {
  const theme = useTheme();

  return (
    <Box
      sx={{
        textAlign: 'center',
        py: 4,
        backgroundColor: 'action.hover',
        borderRadius: 1,
        border: `1px solid ${theme.palette.divider}`,
      }}
    >
      <Typography variant="body2" color="text.secondary">
        No metrics data available for this panel
      </Typography>
    </Box>
  );
}
