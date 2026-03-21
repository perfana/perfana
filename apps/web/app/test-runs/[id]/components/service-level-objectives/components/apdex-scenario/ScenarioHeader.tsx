'use client';

import React from 'react';
import { Box, Typography, Chip, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { CheckCircle, Error as ErrorIcon } from '@mui/icons-material';
import type { ScenarioHeaderProps } from '../../types';

export function ScenarioHeader({ scenario, transactionCount, failedCount }: ScenarioHeaderProps) {
  const theme = useTheme();
  const hasFailed = failedCount > 0;

  return (
    <Box sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      mb: 1,
      px: 1
    }}>
      <Typography variant="subtitle1" sx={{
        fontWeight: 700,
        color: 'secondary.dark',
        fontSize: '0.9rem',
        letterSpacing: '0.3px',
      }}>
        {scenario}
      </Typography>
      <Chip
        label={`${transactionCount} transaction${transactionCount !== 1 ? 's' : ''}`}
        size="small"
        sx={{
          backgroundColor: alpha(theme.palette.secondary.main, 0.1),
          color: 'secondary.main',
          fontWeight: 500,
          fontSize: '0.7rem',
          height: '20px',
        }}
      />
      {hasFailed ? (
        <Chip
          icon={<ErrorIcon sx={{ fontSize: '12px !important' }} />}
          label={`${failedCount} failed`}
          size="small"
          sx={{
            backgroundColor: alpha(theme.palette.error.main, 0.1),
            color: 'error.main',
            fontWeight: 600,
            fontSize: '0.7rem',
            height: '20px',
            '& .MuiChip-icon': { color: theme.palette.error.main }
          }}
        />
      ) : (
        <Chip
          icon={<CheckCircle sx={{ fontSize: '12px !important' }} />}
          label="All passed"
          size="small"
          sx={{
            backgroundColor: alpha(theme.palette.success.main, 0.1),
            color: 'success.main',
            fontWeight: 600,
            fontSize: '0.7rem',
            height: '20px',
            '& .MuiChip-icon': { color: theme.palette.success.main }
          }}
        />
      )}
    </Box>
  );
}
