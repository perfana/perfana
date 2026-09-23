'use client';

import React, { useState } from 'react';
import { Box, IconButton, Menu, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { MoreVert } from '@mui/icons-material';
import { OpenInCardMenuItems, ViewInPerformanceAnalysisMenuItem, perfDrillDownFilters } from '../../../shared/metric-card-links';
import type { MetricSeriesTableRowProps } from '../../types';
import { formatMetricValue, readableShade } from '../../utils/metric-series-table-utils';
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
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const closeMenu = () => setMenuAnchor(null);
  const series = result.dashboard_label && result.panel_id != null && target.target && !result.is_artificial
    ? { dashboardLabel: result.dashboard_label, panelId: result.panel_id, metricName: target.target }
    : null;
  const perfFilters = series
    ? perfDrillDownFilters({ dashboard_label: result.dashboard_label, panel_title: result.panel_title, metric_name: target.target })
    : null;

  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr 1fr 32px',
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
          ? alpha(theme.palette.primary.main, 0.12)
          : sortedIndex % 2 === 0
            ? 'background.paper'
            // action.hover is ALREADY an rgba; MUI's alpha() replaces the
            // channel rather than multiplying it, so alpha(..., 0.3) was a
            // 30% black (or white) band, not a 1.2% tint.
            : theme.palette.action.hover,
        cursor: 'pointer',
        position: 'relative',
        transition: 'background-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease',
        '&:hover': {
          // Stronger than either parity's resting background, so hover always reads as
          // "darker" (light mode) regardless of which stripe the row sits on.
          backgroundColor: isSelected
            ? alpha(theme.palette.primary.main, 0.16)
            : alpha(theme.palette.primary.main, 0.08),
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
          color: isSelected ? readableShade(theme, 'primary') : 'text.primary',
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
          border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`
        }}>
          <Typography variant="body2" sx={{
            fontFamily: 'monospace',
            fontWeight: 600,
            color: isApdexResult(result) ? getApdexScoreColor(target.value, theme) : readableShade(theme, 'primary'),
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

      {/* Actions */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {series && (
          <IconButton size="small" aria-label="Actions" onClick={(e) => { e.stopPropagation(); setMenuAnchor(e.currentTarget); }}>
            <MoreVert sx={{ fontSize: '1rem', color: 'text.secondary' }} />
          </IconButton>
        )}
        {/* Mounted only while open: one Popover per row adds up on a many-series SLO. */}
        {menuAnchor && (
          <Menu
            anchorEl={menuAnchor}
            open
            onClose={closeMenu}
            onClick={(e) => e.stopPropagation()}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            <OpenInCardMenuItems series={series} onClose={closeMenu} />
            <ViewInPerformanceAnalysisMenuItem filters={perfFilters} onClose={closeMenu} />
          </Menu>
        )}
      </Box>
    </Box>
  );
}
