'use client';

import React from 'react';
import {
  Box,
  Typography,
  IconButton,
  Chip,
  Tooltip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  ExpandLess,
  ExpandMore,
  WarningAmber,
  Refresh,
  MoreVert as MoreVertIcon,
} from '@mui/icons-material';
import { AnomalyData } from '../../types';
import { formatValueWithUnit } from '@/lib/units';
import { getConclusionColor, getClassificationDisplayInfo } from '../../helpers';
import { formatDifference} from '../utils';
import StaleTooltipContent from '../StaleTooltipContent';

interface AnomalyTableRowProps {
  row: AnomalyData;
  rowKey: string;
  index: number;
  isExpanded: boolean;
  isLast: boolean;
  testRunId: string;
  drawerData: Record<string, unknown>;
  onToggleExpanded: () => void;
  onOpenActionMenu: (event: React.MouseEvent<HTMLElement>) => void;
  onStaleChipClick: () => void;
  hasActionMenu: boolean;
}

export function AnomalyTableRow({
  row,
  rowKey: _rowKey,
  index,
  isExpanded,
  isLast,
  testRunId,
  drawerData,
  onToggleExpanded,
  onOpenActionMenu,
  onStaleChipClick,
  hasActionMenu,
}: AnomalyTableRowProps) {
  const classification = row.classification || 'unclassified';
  const displayInfo = getClassificationDisplayInfo(classification);

  return (
    <Box
      sx={(theme) => ({
        display: 'grid',
        gridTemplateColumns: '40px minmax(200px, 1fr) minmax(180px, 1fr) minmax(160px, 1fr) minmax(120px, 0.8fr) minmax(100px, 0.7fr) minmax(100px, 0.6fr) minmax(100px, 0.6fr) minmax(120px, 0.7fr) 50px',
        gap: 1,
        px: 2,
        py: 2,
        borderLeft: '1px solid',
        borderRight: '1px solid',
        borderBottom: isExpanded ? 'none' : '1px solid',
        borderTop: index === 0 ? 'none' : '1px solid',
        borderColor: row.is_stale ? alpha(theme.palette.warning.main, 0.3) : alpha(theme.palette.primary.main, 0.12),
        borderRadius: (!isExpanded && isLast) ? '0 0 8px 8px' : '0',
        backgroundColor: row.is_stale
          ? alpha(theme.palette.warning.main, 0.04)
          : (isExpanded
              ? undefined
              : index % 2 === 0
                ? theme.palette.background.paper
                : undefined),
        background: row.is_stale
          ? undefined
          : (isExpanded
              ? `linear-gradient(135deg, ${alpha(theme.palette.action.hover, 0.2)} 0%, ${alpha(theme.palette.action.hover, 0.3)} 100%)`
              : index % 2 === 0
                ? undefined
                : `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)} 0%, ${alpha(theme.palette.primary.main, 0.04)} 100%)`),
        minWidth: '1000px',
        cursor: 'pointer',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        backdropFilter: 'blur(8px)',
        '&:hover': {
          background: isExpanded
            ? `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.12)} 0%, ${alpha(theme.palette.primary.main, 0.08)} 100%)`
            : `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.04)} 0%, ${alpha(theme.palette.primary.main, 0.02)} 100%)`,
          transform: 'translateY(-2px)',
          boxShadow: `0 4px 20px ${alpha(theme.palette.primary.main, 0.15)}, 0 2px 8px ${alpha(theme.palette.text.primary, 0.08)}`,
          borderColor: alpha(theme.palette.primary.main, 0.2),
          zIndex: 1
        }
      })}
      onClick={onToggleExpanded}
    >
      {/* Expand/Collapse Button */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '32px'
      }}>
        <IconButton
          size="small"
          sx={{
            color: 'primary.main',
            padding: '4px',
            minWidth: '24px',
            height: '24px',
            '&:hover': {
              backgroundColor: 'primary.main',
              color: 'white'
            }
          }}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpanded();
          }}
        >
          {isExpanded ? <ExpandLess /> : <ExpandMore />}
        </IconButton>
      </Box>

      {/* Dashboard */}
      <Typography variant="body2" sx={{
        fontSize: '0.875rem',
        lineHeight: 1.4,
        color: 'text.primary'
      }}>
        {row.dashboard_label}
      </Typography>

      {/* Panel */}
      <Typography variant="body2" sx={{
        fontSize: '0.875rem',
        lineHeight: 1.4,
        color: 'text.primary'
      }}>
        {row.panel_title}
      </Typography>

      {/* Metric */}
      <Typography variant="body2" sx={{
        fontSize: '0.875rem',
        lineHeight: 1.4,
        color: 'text.primary',
        fontFamily: 'monospace',
        wordBreak: 'break-word',
        overflowWrap: 'anywhere'
      }}>
        {row.metric_name || '-'}
      </Typography>

      {/* Classification */}
      <Chip
        label={displayInfo.label}
        color={displayInfo.color}
        size="small"
        variant="outlined"
        sx={{
          fontSize: '0.7rem',
          height: '24px',
          minWidth: 'auto',
          '& .MuiChip-label': {
            paddingLeft: '6px',
            paddingRight: '6px',
            fontSize: '0.7rem'
          }
        }}
      />

      {/* Conclusion */}
      <Tooltip
        title={row.is_stale ? (
          <StaleTooltipContent
            row={row}
            testRunId={testRunId}
            drawerData={drawerData}
            rowIndex={index}
          />
        ) : row.conclusion_label}
        arrow
        placement="top"
        componentsProps={{
          tooltip: {
            sx: {
              maxWidth: 450,
              fontSize: '0.75rem'
            }
          }
        }}
      >
        <Chip
          label={row.conclusion_label}
          size="small"
          color={getConclusionColor(row.conclusion_label) as unknown}
          variant="filled"
          icon={row.is_stale ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
              <WarningAmber sx={{ fontSize: '12px' }} />
              <Refresh sx={{ fontSize: '12px' }} />
            </Box>
          ) : undefined}
          onClick={row.is_stale ? (e) => {
            e.stopPropagation();
            onStaleChipClick();
          } : undefined}
          sx={{
            height: '24px',
            fontSize: '0.7rem',
            cursor: row.is_stale ? 'pointer' : 'default',
            '&:hover': row.is_stale ? {
              opacity: 0.8,
              transform: 'scale(1.02)'
            } : {}
          }}
        />
      </Tooltip>

      {/* Test Value */}
      <Typography variant="body2" sx={{
        fontSize: '0.875rem',
        lineHeight: 1.4,
        color: 'text.primary',
        fontFamily: 'monospace'
      }}>
        {row.test_value ? formatValueWithUnit(parseFloat(row.test_value), row.unit || undefined) : '-'}
      </Typography>

      {/* Control Group Value */}
      <Typography variant="body2" sx={{
        fontSize: '0.875rem',
        lineHeight: 1.4,
        color: 'text.primary',
        fontFamily: 'monospace'
      }}>
        {row.control_group_value ? formatValueWithUnit(parseFloat(row.control_group_value), row.unit || undefined) : '-'}
      </Typography>

      {/* Difference */}
      <Typography variant="body2" sx={{
        fontSize: '0.875rem',
        lineHeight: 1.4,
        color: row.difference && parseFloat(row.difference) > 0 ? 'error.main' :
               row.difference && parseFloat(row.difference) < 0 ? 'success.main' : 'text.primary',
        fontFamily: 'monospace',
        fontWeight: row.difference && parseFloat(row.difference) !== 0 ? 600 : 400
      }}>
        {formatDifference(row.test_value, row.control_group_value, row.difference ?? '', row.unit ?? undefined)}
      </Typography>

      {/* Action Menu */}
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        {hasActionMenu && (
          <IconButton
            onClick={(e) => {
              e.stopPropagation();
              onOpenActionMenu(e);
            }}
            size="small"
            sx={{
              backgroundColor: 'action.hover',
              '&:hover': {
                backgroundColor: 'action.selected',
                transform: 'scale(1.1)',
              },
              transition: 'all 0.2s ease-in-out',
              width: 28,
              height: 28,
            }}
            aria-label="actions"
          >
            <MoreVertIcon sx={{ fontSize: 16 }} />
          </IconButton>
        )}
      </Box>
    </Box>
  );
}
