'use client';

import { Box, Typography, useTheme, alpha } from '@mui/material';

interface ChartErrorStateProps {
  error: string;
}

export function ChartErrorState({ error }: ChartErrorStateProps) {
  const theme = useTheme();

  return (
    <Box
      sx={{
        textAlign: 'center',
        py: 4,
        backgroundColor: alpha(theme.palette.error.main, 0.05),
        borderRadius: 1,
        border: `1px solid ${alpha(theme.palette.error.main, 0.2)}`,
      }}
    >
      <Typography variant="body2" color="error">
        Error loading current test run chart: {error}
      </Typography>
    </Box>
  );
}
