'use client';

import React from 'react';
import { Box, Typography, Chip, Tooltip, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { WarningAmber } from '@mui/icons-material';
import type { MetricSeriesStatusChipProps } from '../../types';
import { getThemedChipStyles } from '../../utils/metric-series-table-utils';

export function MetricSeriesStatusChip({
  target,
  result,
  isStale,
}: MetricSeriesStatusChipProps) {
  const theme = useTheme();

  // Handle ERROR status first
  if (target.status === 'ERROR' || result.status === 'ERROR') {
    const chip = (
      <Chip
        label="Invalid"
        sx={getThemedChipStyles('error', false, theme)}
      />
    );

    return (
      <Tooltip
        title={
          <Box sx={{ p: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1, color: 'white' }}>
              EVALUATION ERROR
            </Typography>
            <Typography variant="body2" sx={{ color: 'white' }}>
              {target.message || result.message || 'An error occurred during SLO evaluation'}
            </Typography>
          </Box>
        }
        arrow
        placement="top"
        slotProps={{
          tooltip: {
            sx: {
              backgroundColor: alpha(theme.palette.warning.main, 0.95),
              backdropFilter: 'blur(10px)',
              border: `1px solid ${alpha(theme.palette.warning.light, 0.3)}`,
              borderRadius: '8px',
              boxShadow: `0 8px 24px ${alpha(theme.palette.warning.main, 0.3)}`,
              maxWidth: 280,
            }
          },
          arrow: {
            sx: {
              color: alpha(theme.palette.warning.main, 0.95),
            }
          }
        }}
      >
        {chip}
      </Tooltip>
    );
  }

  if (target.meets_requirement === true) {
    return (
      <Chip
        label="Pass"
        icon={isStale ? <WarningAmber sx={{ fontSize: '12px' }} /> : undefined}
        sx={getThemedChipStyles('pass', isStale, theme)}
      />
    );
  }

  if (target.meets_requirement === false) {
    return (
      <Chip
        label="Fail"
        icon={isStale ? <WarningAmber sx={{ fontSize: '12px' }} /> : undefined}
        sx={getThemedChipStyles('fail', isStale, theme)}
      />
    );
  }

  return (
    <Typography variant="body2" color="text.secondary">
      -
    </Typography>
  );
}
