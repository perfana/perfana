'use client';

import { Box, Typography } from '@mui/material';
import { ShowChart as ShowChartIcon } from '@mui/icons-material';

export function ChartEmptyState() {
  return (
    <Box sx={{ textAlign: 'center', py: 8 }}>
      <ShowChartIcon
        sx={{
          fontSize: 64,
          color: 'action.disabled',
          mb: 2,
        }}
      />
      <Typography variant="h6" color="text.secondary" gutterBottom>
        No Data Available
      </Typography>
      <Typography variant="body2" color="text.secondary">
        No time-series data found for this transaction
      </Typography>
    </Box>
  );
}
