'use client';

import React from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { ArrowUpward, ArrowDownward } from '@mui/icons-material';
import type { MetricSeriesTableHeaderProps, SortConfig } from '../../types';
import { headerTextSx } from '../../utils/metric-series-table-utils';
import type { SortField } from '../../types/slo.types';

interface SortIndicatorProps {
  sortConfig: Map<string, SortConfig>;
  resultKey: string;
  field: SortField;
}

function SortIndicator({ sortConfig, resultKey, field }: SortIndicatorProps) {
  const config = sortConfig.get(resultKey);
  if (config?.field !== field) return null;

  return config.direction === 'asc'
    ? <ArrowUpward fontSize="small" sx={{ ml: 0.5 }} />
    : <ArrowDownward fontSize="small" sx={{ ml: 0.5 }} />;
}

export function MetricSeriesTableHeader({
  resultKey,
  sortConfig,
  onSort,
}: MetricSeriesTableHeaderProps) {
  const theme = useTheme();

  const sortableColumnSx = {
    display: 'flex',
    alignItems: 'center',
    cursor: 'pointer',
    borderRight: '1px solid',
    borderColor: alpha(theme.palette.primary.main, 0.2),
    pr: 1,
    transition: 'all 0.2s ease',
    '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.06) }
  };

  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: '2fr 1fr 1fr',
      gap: 2,
      p: 2.5,
      background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)} 0%, ${alpha(theme.palette.primary.main, 0.06)} 50%, ${alpha(theme.palette.primary.main, 0.04)} 100%)`,
      borderRadius: '8px 8px 0 0',
      border: '1px solid',
      borderColor: alpha(theme.palette.primary.main, 0.15),
      borderBottom: 'none',
      boxShadow: theme.palette.mode === 'dark'
        ? `0 1px 3px ${alpha(theme.palette.common.black, 0.3)}`
        : `0 1px 3px ${alpha(theme.palette.common.black, 0.08)}`,
      backdropFilter: 'blur(8px)'
    }}>
      {/* Series Column Header */}
      <Box
        onClick={() => onSort(resultKey, 'series')}
        sx={{
          ...sortableColumnSx,
          borderRadius: '6px 0 0 0',
        }}
      >
        <Typography variant="subtitle2" sx={headerTextSx}>Series</Typography>
        <SortIndicator sortConfig={sortConfig} resultKey={resultKey} field="series" />
      </Box>

      {/* Value Column Header */}
      <Box
        onClick={() => onSort(resultKey, 'value')}
        sx={sortableColumnSx}
      >
        <Typography variant="subtitle2" sx={headerTextSx}>Value</Typography>
        <SortIndicator sortConfig={sortConfig} resultKey={resultKey} field="value" />
      </Box>

      {/* Result Column Header */}
      <Box
        onClick={() => onSort(resultKey, 'result')}
        sx={{
          ...sortableColumnSx,
          borderRight: 'none',
          borderRadius: '0 6px 0 0',
        }}
      >
        <Typography variant="subtitle2" sx={headerTextSx}>Result</Typography>
        <SortIndicator sortConfig={sortConfig} resultKey={resultKey} field="result" />
      </Box>
    </Box>
  );
}
