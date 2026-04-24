'use client';

import React from 'react';
import { Box, Typography, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { ArrowUpward, ArrowDownward, UnfoldMore } from '@mui/icons-material';
import type {
  AnomalySortKey,
  SortDirection,
  DiffSortMode,
} from '../../hooks/useAnomalyDetection';

type HeaderColumn = {
  label: string;
  sortKey: AnomalySortKey | null;
  textAlign?: 'left' | 'center' | 'right';
};

const HEADER_COLUMNS: HeaderColumn[] = [
  { label: 'Dashboard', sortKey: 'dashboard_label' },
  { label: 'Panel', sortKey: 'panel_title' },
  { label: 'Metric', sortKey: 'metric_name' },
  { label: 'Classification', sortKey: 'classification' },
  { label: 'Conclusion', sortKey: 'conclusion_label' },
  { label: 'Test Value', sortKey: 'test_value' },
  { label: 'Control Group', sortKey: 'control_group_value' },
  { label: 'Difference', sortKey: 'difference' },
  { label: 'Actions', sortKey: null, textAlign: 'center' },
];

const headerTextStyles = {
  fontWeight: 700,
  color: 'primary.dark',
  fontSize: '0.85rem',
  letterSpacing: '0.5px',
  textTransform: 'uppercase' as const,
};

interface AnomalyTableHeaderProps {
  sortBy: AnomalySortKey | null;
  sortDirection: SortDirection;
  diffSortMode: DiffSortMode;
  onSortChange: (key: AnomalySortKey) => void;
  onDiffSortModeChange: (mode: DiffSortMode) => void;
}

function SortIndicator({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) {
    return <UnfoldMore sx={{ fontSize: 14, opacity: 0.35, color: 'primary.dark' }} />;
  }
  return direction === 'asc'
    ? <ArrowUpward sx={{ fontSize: 14, color: 'primary.dark' }} />
    : <ArrowDownward sx={{ fontSize: 14, color: 'primary.dark' }} />;
}

export function AnomalyTableHeader({
  sortBy,
  sortDirection,
  diffSortMode,
  onSortChange,
  onDiffSortModeChange,
}: AnomalyTableHeaderProps) {
  const handleDiffModeChange = (_e: React.MouseEvent<HTMLElement>, value: DiffSortMode | null) => {
    if (value !== null) onDiffSortModeChange(value);
  };

  return (
    <Box sx={(theme) => ({
      display: 'grid',
      gridTemplateColumns: '40px minmax(200px, 1fr) minmax(180px, 1fr) minmax(160px, 1fr) minmax(120px, 0.8fr) minmax(100px, 0.7fr) minmax(100px, 0.6fr) minmax(100px, 0.6fr) minmax(120px, 0.7fr) 50px',
      gap: 1,
      px: 2,
      py: 2,
      background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)} 0%, ${alpha(theme.palette.primary.main, 0.06)} 50%, ${alpha(theme.palette.primary.main, 0.04)} 100%)`,
      borderRadius: '8px 8px 0 0',
      border: '1px solid',
      borderColor: alpha(theme.palette.primary.main, 0.15),
      borderBottom: 'none',
      boxShadow: `0 1px 3px ${alpha(theme.palette.text.primary, 0.08)}`,
      backdropFilter: 'blur(8px)',
      minWidth: '1000px'
    })}>
      <Box />
      {HEADER_COLUMNS.map((col) => {
        const isSortable = col.sortKey !== null;
        const isActive = isSortable && sortBy === col.sortKey;
        const isDifference = col.sortKey === 'difference';

        if (!isSortable) {
          return (
            <Typography
              key={col.label}
              variant="subtitle2"
              sx={{ ...headerTextStyles, textAlign: col.textAlign || 'left' }}
            >
              {col.label}
            </Typography>
          );
        }

        return (
          <Box
            key={col.label}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              flexWrap: 'wrap',
            }}
          >
            <Tooltip
              title={isActive
                ? `Sort ${sortDirection === 'asc' ? 'descending' : 'ascending'}`
                : `Sort by ${col.label}`}
              arrow
              placement="top"
            >
              <Box
                role="button"
                tabIndex={0}
                onClick={() => onSortChange(col.sortKey!)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSortChange(col.sortKey!);
                  }
                }}
                sx={(theme) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  cursor: 'pointer',
                  userSelect: 'none',
                  borderRadius: '4px',
                  px: 0.5,
                  py: 0.25,
                  transition: 'background-color 0.15s ease-in-out',
                  '&:hover': {
                    backgroundColor: alpha(theme.palette.primary.main, 0.08),
                  },
                  '&:focus-visible': {
                    outline: `2px solid ${theme.palette.primary.main}`,
                    outlineOffset: '1px',
                  },
                })}
              >
                <Typography variant="subtitle2" sx={headerTextStyles}>
                  {col.label}
                </Typography>
                <SortIndicator active={isActive} direction={sortDirection} />
              </Box>
            </Tooltip>

            {isDifference && (
              <ToggleButtonGroup
                size="small"
                value={diffSortMode}
                exclusive
                onChange={handleDiffModeChange}
                aria-label="Difference sort mode"
                sx={(theme) => ({
                  '& .MuiToggleButton-root': {
                    py: 0,
                    px: 0.75,
                    fontSize: '0.65rem',
                    fontWeight: 600,
                    lineHeight: 1.4,
                    minHeight: '20px',
                    color: alpha(theme.palette.primary.dark, 0.7),
                    borderColor: alpha(theme.palette.primary.main, 0.25),
                    textTransform: 'none',
                    '&.Mui-selected': {
                      backgroundColor: alpha(theme.palette.primary.main, 0.15),
                      color: theme.palette.primary.dark,
                      '&:hover': {
                        backgroundColor: alpha(theme.palette.primary.main, 0.22),
                      },
                    },
                  },
                })}
              >
                <ToggleButton value="absolute" aria-label="Sort by absolute difference">
                  Abs
                </ToggleButton>
                <ToggleButton value="percentage" aria-label="Sort by percentage difference">
                  %
                </ToggleButton>
              </ToggleButtonGroup>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
