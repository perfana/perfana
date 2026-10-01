'use client';

import { Box, Typography, useTheme } from '@mui/material';

/**
 * `detail` is the pipeline's own words (e.g. "No targets found for processing") — kept
 * as supporting text rather than the headline, so the user reads a sentence written for
 * them first and the internal vocabulary second.
 */
export function ChartEmptyState({
  message = 'No metrics data available for this panel',
  detail,
}: { message?: string; detail?: string } = {}) {
  const theme = useTheme();

  return (
    <Box
      sx={{
        textAlign: 'center',
        py: 4,
        px: 2,
        backgroundColor: 'action.hover',
        borderRadius: 1,
        border: `1px solid ${theme.palette.divider}`,
      }}
    >
      {/* maxWidth keeps an arbitrary-length pipeline message at a readable measure
          instead of setting it as one centred line across the whole chart width. */}
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: '60ch', mx: 'auto' }}>
        {message}
      </Typography>
      {detail && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: 0.5, maxWidth: '60ch', mx: 'auto', opacity: 0.8 }}
        >
          {detail}
        </Typography>
      )}
    </Box>
  );
}
