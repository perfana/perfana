'use client';

import React from 'react';
import { Box, Typography, Chip, IconButton, Tooltip, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  CheckCircle,
  Error as ErrorIcon,
  ExpandMore,
  ExpandLess,
  MoreVert,
} from '@mui/icons-material';
import { getApdexScoreColor, formatApdexScore } from '../../utils/slo-formatters';
import type { ApdexTransactionRowProps } from '../../types';

export function ApdexTransactionRow({
  target,
  transactionKey,
  isExpanded,
  isLastRow,
  isEvenRow,
  defaultThreshold,
  onToggle,
  onOpenActionMenu,
}: ApdexTransactionRowProps) {
  const theme = useTheme();
  const transactionName = target.transaction_name || target.target || `Transaction`;
  const threshold = target.threshold_ms || defaultThreshold;
  const apdexScore = target.apdex_score ?? target.value;

  // Common cell styles with right border (theme-aware)
  const cellWithBorderSx = {
    borderRight: '1px solid',
    borderColor: alpha(theme.palette.primary.main, 0.15),
    pr: 1,
    display: 'flex',
    alignItems: 'center'
  };

  return (
    <Box
      onClick={onToggle}
      sx={{
        display: 'grid',
        gridTemplateColumns: '2fr 80px 80px 80px 80px 32px 40px',
        gap: 1.5,
        p: 2,
        borderLeft: '1px solid',
        borderRight: '1px solid',
        borderBottom: isExpanded ? 'none' : '1px solid',
        borderColor: alpha(theme.palette.primary.main, 0.12),
        borderRadius: isLastRow && !isExpanded ? '0 0 8px 8px' : '0',
        backgroundColor: isEvenRow ? 'background.paper' : 'action.hover',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        '&:hover': {
          backgroundColor: alpha(theme.palette.primary.main, 0.04),
        }
      }}
    >
      {/* Transaction Name */}
      <Box sx={cellWithBorderSx}>
        <Typography variant="body2" sx={{ fontWeight: 500, fontSize: '0.8rem' }}>
          {transactionName}
        </Typography>
      </Box>

      {/* Threshold */}
      <Box sx={cellWithBorderSx}>
        <Typography variant="body2" sx={{
          fontFamily: 'monospace',
          color: 'text.secondary',
          fontSize: '0.75rem'
        }}>
          {threshold}ms
        </Typography>
      </Box>

      {/* Avg Response Time */}
      <Box sx={cellWithBorderSx}>
        <Typography variant="body2" sx={{
          fontFamily: 'monospace',
          color: 'text.secondary',
          fontSize: '0.75rem'
        }}>
          {target.avg_response_time_ms != null
            ? `${Math.round(target.avg_response_time_ms)}ms`
            : '-'}
        </Typography>
      </Box>

      {/* Apdex Score */}
      <Box sx={cellWithBorderSx}>
        <Typography variant="body2" sx={{
          fontFamily: 'monospace',
          fontWeight: 600,
          color: getApdexScoreColor(apdexScore),
          fontSize: '0.75rem'
        }}>
          {formatApdexScore(apdexScore)}
        </Typography>
      </Box>

      {/* Result */}
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <ResultChip meetsRequirement={target.meets_requirement} />
      </Box>

      {/* Actions Menu Icon */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Tooltip title="Actions">
          <IconButton
            size="small"
            sx={{ p: 0.5 }}
            onClick={(e) => {
              e.stopPropagation();
              onOpenActionMenu(e);
            }}
          >
            <MoreVert sx={{ fontSize: '1rem', color: 'text.secondary' }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Expand Icon */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <IconButton size="small" sx={{ p: 0.5 }}>
          {isExpanded ? (
            <ExpandLess sx={{ fontSize: '1.2rem', color: 'text.secondary' }} />
          ) : (
            <ExpandMore sx={{ fontSize: '1.2rem', color: 'text.secondary' }} />
          )}
        </IconButton>
      </Box>
    </Box>
  );
}

// Result chip component
function ResultChip({ meetsRequirement }: { meetsRequirement?: boolean }) {
  const theme = useTheme();

  if (meetsRequirement === true) {
    return (
      <Chip
        label="Pass"
        size="small"
        icon={<CheckCircle sx={{ fontSize: '12px !important' }} />}
        sx={{
          backgroundColor: alpha(theme.palette.success.main, 0.1),
          color: 'success.main',
          fontWeight: 600,
          fontSize: '0.7rem',
          height: '22px',
          '& .MuiChip-icon': { color: theme.palette.success.main }
        }}
      />
    );
  }

  if (meetsRequirement === false) {
    return (
      <Chip
        label="Fail"
        size="small"
        icon={<ErrorIcon sx={{ fontSize: '12px !important' }} />}
        sx={{
          backgroundColor: alpha(theme.palette.error.main, 0.1),
          color: 'error.main',
          fontWeight: 600,
          fontSize: '0.7rem',
          height: '22px',
          '& .MuiChip-icon': { color: theme.palette.error.main }
        }}
      />
    );
  }

  return (
    <Chip
      label="N/A"
      size="small"
      sx={{
        backgroundColor: 'action.hover',
        color: 'text.secondary',
        fontWeight: 500,
        fontSize: '0.7rem',
        height: '22px'
      }}
    />
  );
}
