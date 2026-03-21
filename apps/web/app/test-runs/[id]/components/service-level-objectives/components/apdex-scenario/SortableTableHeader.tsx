'use client';

import React from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { ArrowUpward, ArrowDownward } from '@mui/icons-material';
import type { SortableTableHeaderProps, ApdexScenarioSortConfig } from '../../types';

interface SortIndicatorProps {
  sortConfig: Map<string, ApdexScenarioSortConfig>;
  resultKey: string;
  field: ApdexScenarioSortConfig['field'];
}

function SortIndicator({ sortConfig, resultKey, field }: SortIndicatorProps) {
  const config = sortConfig.get(resultKey);
  if (config?.field !== field) return null;

  return config.direction === 'asc'
    ? <ArrowUpward fontSize="small" sx={{ ml: 0.5 }} />
    : <ArrowDownward fontSize="small" sx={{ ml: 0.5 }} />;
}

export function SortableTableHeader({ resultKey, sortConfig, onSort }: SortableTableHeaderProps) {
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

  const headerTextSx = {
    fontWeight: 700,
    color: 'primary.dark',
    fontSize: '0.75rem',
    letterSpacing: '0.5px',
    textTransform: 'uppercase' as const
  };

  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: '2fr 80px 80px 80px 80px 32px 40px',
      gap: 1.5,
      p: 2,
      background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)} 0%, ${alpha(theme.palette.primary.main, 0.06)} 50%, ${alpha(theme.palette.primary.main, 0.04)} 100%)`,
      borderBottom: '1px solid',
      borderColor: alpha(theme.palette.primary.main, 0.15),
      position: 'sticky',
      top: 0,
      zIndex: 1,
      backdropFilter: 'blur(8px)',
    }}>
      {/* Transaction column */}
      <Box onClick={() => onSort(resultKey, 'series')} sx={sortableColumnSx}>
        <Typography variant="subtitle2" sx={headerTextSx}>Transaction</Typography>
        <SortIndicator sortConfig={sortConfig} resultKey={resultKey} field="series" />
      </Box>

      {/* Threshold column */}
      <Box onClick={() => onSort(resultKey, 'threshold')} sx={sortableColumnSx}>
        <Typography variant="subtitle2" sx={headerTextSx}>Threshold</Typography>
        <SortIndicator sortConfig={sortConfig} resultKey={resultKey} field="threshold" />
      </Box>

      {/* Avg RT column */}
      <Box onClick={() => onSort(resultKey, 'avgResponseTime')} sx={sortableColumnSx}>
        <Typography variant="subtitle2" sx={headerTextSx}>Avg RT</Typography>
        <SortIndicator sortConfig={sortConfig} resultKey={resultKey} field="avgResponseTime" />
      </Box>

      {/* Apdex column */}
      <Box onClick={() => onSort(resultKey, 'value')} sx={sortableColumnSx}>
        <Typography variant="subtitle2" sx={headerTextSx}>Apdex</Typography>
        <SortIndicator sortConfig={sortConfig} resultKey={resultKey} field="value" />
      </Box>

      {/* Result column */}
      <Box
        onClick={() => onSort(resultKey, 'result')}
        sx={{
          ...sortableColumnSx,
          borderRight: 'none'
        }}
      >
        <Typography variant="subtitle2" sx={headerTextSx}>Result</Typography>
        <SortIndicator sortConfig={sortConfig} resultKey={resultKey} field="result" />
      </Box>

      {/* Settings column header (empty) */}
      <Box />

      {/* Expand column header (empty) */}
      <Box />
    </Box>
  );
}
