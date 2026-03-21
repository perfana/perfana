'use client';

import { Box, Typography } from '@mui/material';

/**
 * Empty state component displayed when no dashboards are found
 */
export function EmptyState() {
  return (
    <Box
      sx={{
        textAlign: 'center',
        py: 8,
        backgroundColor: 'background.paper',
        borderRadius: 1,
        border: '1px dashed',
        borderColor: 'divider',
      }}
    >
      <Typography variant="h6" color="text.secondary" gutterBottom>
        No Dashboards Found
      </Typography>
      <Typography variant="body2" color="text.secondary">
        This profile does not have any auto-configuration dashboards associated with it.
      </Typography>
    </Box>
  );
}
