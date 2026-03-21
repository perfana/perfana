'use client';

import React from 'react';
import { Box, Typography } from '@mui/material';
import { TrendingUp, TrendingDown, TrendingFlat } from '@mui/icons-material';
import type { SummaryCardProps } from '../types';
import { formatValue, getChangeColor } from '../utils/trace-formatters';

/**
 * Summary card component displaying metric values with change indicators
 */
export function SummaryCard({
  label,
  current,
  baseline,
  change,
  changePercent,
  format = 'number',
  invertColors = false,
  isStatus = false,
  isRegression = false,
  isImprovement = false,
}: SummaryCardProps) {
  if (isStatus) {
    return (
      <Box
        sx={{
          p: 2,
          border: '1px solid',
          borderColor: isRegression ? 'error.light' : isImprovement ? 'success.light' : 'divider',
          borderRadius: 2,
          backgroundColor: isRegression
            ? 'rgba(211, 47, 47, 0.05)'
            : isImprovement
            ? 'rgba(76, 175, 80, 0.05)'
            : 'transparent',
          textAlign: 'center',
        }}
      >
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mt: 1 }}>
          {isRegression ? (
            <TrendingUp sx={{ color: 'error.main' }} />
          ) : isImprovement ? (
            <TrendingDown sx={{ color: 'success.main' }} />
          ) : (
            <TrendingFlat sx={{ color: 'text.secondary' }} />
          )}
          <Typography
            variant="h6"
            sx={{
              fontFamily: 'monospace',
              color: isRegression ? 'error.main' : isImprovement ? 'success.main' : 'text.primary',
            }}
          >
            {isRegression ? 'Slower' : isImprovement ? 'Faster' : 'Stable'}
          </Typography>
        </Box>
        {changePercent !== undefined && (
          <Typography variant="caption" color="text.secondary">
            {changePercent > 0 ? '+' : ''}
            {changePercent.toFixed(1)}%
          </Typography>
        )}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        p: 2,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        textAlign: 'center',
      }}
    >
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, mt: 1 }}>
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
            Current
          </Typography>
          <Typography variant="h6" sx={{ fontFamily: 'monospace' }}>
            {current !== undefined ? formatValue(current, format) : '-'}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
            Baseline
          </Typography>
          <Typography variant="h6" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
            {baseline !== undefined ? formatValue(baseline, format) : '-'}
          </Typography>
        </Box>
      </Box>
      {change !== undefined && changePercent !== undefined && (
        <Typography
          variant="caption"
          sx={{ color: getChangeColor(changePercent, invertColors), fontWeight: 600 }}
        >
          {change > 0 ? '+' : ''}
          {formatValue(change, format)} ({changePercent > 0 ? '+' : ''}
          {changePercent.toFixed(1)}%)
        </Typography>
      )}
    </Box>
  );
}
