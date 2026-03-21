'use client';

import React from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { MetricSeriesTableRowProps } from '../../types';
import { formatMetricValue } from '../../utils/metric-series-table-utils';
import { getApdexScoreColor, isApdexResult } from '../../utils/slo-formatters';
import { MetricSeriesStatusChip } from './MetricSeriesStatusChip';

export function MetricSeriesTableRow({
  target,
  sortedIndex,
  totalCount,
  isSelected,
  result,
  isStale,
  onClick,
}: MetricSeriesTableRowProps) {
  const theme = useTheme();
  const isLastRow = sortedIndex === totalCount - 1;

  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr 1fr',
        gap: 2,
        p: 2.5,
        borderLeft: '1px solid',
        borderRight: '1px solid',
        borderBottom: '1px solid',
        borderTop: sortedIndex === 0 ? 'none' : '1px solid',
        borderColor: alpha(theme.palette.primary.main, 0.12),
        borderLeftColor: isSelected ? 'primary.main' : alpha(theme.palette.primary.main, 0.12),
        borderLeftWidth: isSelected ? 4 : 1,
        borderRadius: isLastRow ? '0 0 8px 8px' : '0',
        backgroundColor: isSelected
          ? alpha(theme.palette.primary.main, 0.06)
          : sortedIndex % 2 === 0
            ? 'background.paper'
            : alpha(theme.palette.action.hover, 0.3),
        cursor: 'pointer',
        position: 'relative',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        backdropFilter: 'blur(8px)',
        '&:hover': {
          backgroundColor: isSelected
            ? alpha(theme.palette.primary.main, 0.1)
            : alpha(theme.palette.primary.main, 0.04),
          transform: 'translateY(-2px)',
          boxShadow: `0 4px 20px ${alpha(theme.palette.primary.main, 0.15)}, 0 2px 8px ${alpha(theme.palette.text.primary, 0.08)}`,
          borderColor: alpha(theme.palette.primary.main, 0.2),
          zIndex: 1
        }
      }}
    >
      {/* Series */}
      <Box sx={{
        borderRight: '1px solid',
        borderColor: alpha(theme.palette.primary.main, 0.15),
        pr: 2.5,
        display: 'flex',
        alignItems: 'center',
        minHeight: '32px'
      }}>
        <Typography variant="body2" sx={{
          fontWeight: isSelected ? 600 : 500,
          color: isSelected ? 'primary.dark' : 'text.primary',
          fontSize: '0.875rem',
          lineHeight: 1.4
        }}>
          {target.target || 'Series ' + (sortedIndex + 1)}
        </Typography>
      </Box>

      {/* Value */}
      <Box sx={{
        borderRight: '1px solid',
        borderColor: alpha(theme.palette.primary.main, 0.15),
        pr: 2.5,
        display: 'flex',
        alignItems: 'center',
        minHeight: '32px'
      }}>
        <Box sx={{
          backgroundColor: alpha(theme.palette.primary.main, 0.04),
          px: 1.5,
          py: 0.5,
          borderRadius: '6px',
          border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
          backdropFilter: 'blur(4px)'
        }}>
          <Typography variant="body2" sx={{
            fontFamily: 'monospace',
            fontWeight: 600,
            color: isApdexResult(result) ? getApdexScoreColor(target.value) : 'primary.dark',
            fontSize: '0.8rem'
          }}>
            {formatMetricValue(target, result)}
          </Typography>
        </Box>
      </Box>

      {/* Result */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        minHeight: '32px',
        justifyContent: 'flex-start'
      }}>
        <MetricSeriesStatusChip
          target={target}
          result={result}
          isStale={isStale}
        />
      </Box>
    </Box>
  );
}
