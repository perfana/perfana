'use client';

import React from 'react';
import { Box, Chip, Tooltip, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { WarningAmber, Refresh } from '@mui/icons-material';
import { isCheckResultStale } from '../utils/slo-formatters';

export interface SLOStatusChipProps {
  result: {
    benchmark_id?: string;
    panel_id?: number;
    status?: string;
    meets_requirement?: boolean;
    message?: string;
    created_at?: string;
  };
  benchmark?: {
    id?: string;
    application_dashboard_id?: string;
    updated_at?: string;
  };
  onReEvaluate?: (panelId: number, applicationDashboardId?: string) => void;
}

export default function SLOStatusChip({
  result,
  benchmark,
  onReEvaluate,
}: SLOStatusChipProps) {
  const theme = useTheme();
  const isStale = isCheckResultStale(result, benchmark);

  // Handle ERROR status first
  if (result.status === 'ERROR') {
    const chip = (
      <Chip
        label="⚠ Invalid"
        sx={{
          height: '28px',
          fontWeight: 700,
          backdropFilter: 'blur(12px)',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          background: `linear-gradient(135deg, ${alpha(theme.palette.warning.main, 0.1)} 0%, ${alpha(theme.palette.warning.main, 0.08)} 50%, ${alpha(theme.palette.warning.main, 0.06)} 100%)`,
          border: `1px solid ${alpha(theme.palette.warning.main, 0.3)}`,
          color: 'warning.dark',
          boxShadow: `0 2px 8px ${alpha(theme.palette.warning.main, 0.15)}`,
          cursor: 'help',
          '&:hover': {
            transform: 'translateY(-1px) scale(1.02)',
            boxShadow: `0 6px 20px ${alpha(theme.palette.warning.main, 0.25)}, 0 2px 8px ${alpha(theme.palette.warning.main, 0.15)}`,
            border: `1px solid ${alpha(theme.palette.warning.main, 0.5)}`,
            background: `linear-gradient(135deg, ${alpha(theme.palette.warning.main, 0.15)} 0%, ${alpha(theme.palette.warning.main, 0.12)} 50%, ${alpha(theme.palette.warning.main, 0.1)} 100%)`,
          },
          '& .MuiChip-label': {
            px: 1.5,
            py: 0.5,
            fontSize: '0.75rem',
            letterSpacing: '0.5px'
          }
        }}
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
              {result.message || 'An error occurred during SLO evaluation'}
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

  if (result.meets_requirement === true) {
    const chip = (
      <Chip
        label="Pass"
        icon={isStale ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
            <WarningAmber sx={{ fontSize: '12px' }} />
            <Refresh sx={{ fontSize: '12px' }} />
          </Box>
        ) : undefined}
        onClick={isStale ? (e) => {
          e.stopPropagation();
          const applicationDashboardId = benchmark?.application_dashboard_id;
          if (onReEvaluate && result.panel_id !== undefined) {
            onReEvaluate(result.panel_id, applicationDashboardId);
          }
        } : undefined}
        sx={{
          height: '28px',
          fontWeight: 700,
          backdropFilter: 'blur(12px)',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          background: isStale
            ? `linear-gradient(135deg, ${alpha(theme.palette.warning.main, 0.1)} 0%, ${alpha(theme.palette.warning.main, 0.08)} 50%, ${alpha(theme.palette.warning.main, 0.06)} 100%)`
            : `linear-gradient(135deg, ${alpha(theme.palette.success.main, 0.1)} 0%, ${alpha(theme.palette.success.main, 0.08)} 50%, ${alpha(theme.palette.success.light, 0.06)} 100%)`,
          border: isStale
            ? `1px solid ${alpha(theme.palette.warning.main, 0.3)}`
            : `1px solid ${alpha(theme.palette.success.main, 0.3)}`,
          color: isStale ? theme.palette.text.primary : theme.palette.success.dark,
          boxShadow: isStale
            ? `0 2px 8px ${alpha(theme.palette.warning.main, 0.15)}`
            : `0 2px 8px ${alpha(theme.palette.success.main, 0.15)}`,
          cursor: isStale ? 'pointer' : 'default',
          '&:hover': {
            transform: 'translateY(-1px) scale(1.02)',
            boxShadow: isStale
              ? `0 6px 20px ${alpha(theme.palette.warning.main, 0.25)}, 0 2px 8px ${alpha(theme.palette.warning.main, 0.15)}`
              : `0 6px 20px ${alpha(theme.palette.success.main, 0.25)}, 0 2px 8px ${alpha(theme.palette.success.main, 0.15)}`,
            border: isStale
              ? `1px solid ${alpha(theme.palette.warning.main, 0.5)}`
              : `1px solid ${alpha(theme.palette.success.main, 0.5)}`,
            background: isStale
              ? `linear-gradient(135deg, ${alpha(theme.palette.warning.main, 0.15)} 0%, ${alpha(theme.palette.warning.main, 0.12)} 50%, ${alpha(theme.palette.warning.main, 0.1)} 100%)`
              : `linear-gradient(135deg, ${alpha(theme.palette.success.main, 0.15)} 0%, ${alpha(theme.palette.success.main, 0.12)} 50%, ${alpha(theme.palette.success.light, 0.1)} 100%)`,
          },
          '& .MuiChip-label': {
            px: 1.5,
            py: 0.5,
            fontSize: '0.75rem',
            letterSpacing: '0.5px'
          }
        }}
      />
    );

    return isStale ? (
      <Tooltip
        title={
          <Box sx={{ p: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1, color: 'white' }}>
              OUTDATED RESULT
            </Typography>
            <Typography variant="body2" sx={{ mb: 1, color: 'white' }}>
              SLO configuration changed after this result was generated
            </Typography>
            <Typography variant="body2" sx={{ color: 'white', fontSize: '0.75rem' }}>
              Click to re-evaluate with current configuration
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
    ) : chip;
  }

  if (result.meets_requirement === false) {
    const chip = (
      <Chip
        label="Fail"
        icon={isStale ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
            <WarningAmber sx={{ fontSize: '12px' }} />
            <Refresh sx={{ fontSize: '12px' }} />
          </Box>
        ) : undefined}
        onClick={isStale ? (e) => {
          e.stopPropagation();
          const applicationDashboardId = benchmark?.application_dashboard_id;
          if (onReEvaluate && result.panel_id !== undefined) {
            onReEvaluate(result.panel_id, applicationDashboardId);
          }
        } : undefined}
        sx={{
          height: '28px',
          fontWeight: 700,
          backdropFilter: 'blur(12px)',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          background: isStale
            ? `linear-gradient(135deg, ${alpha(theme.palette.warning.main, 0.1)} 0%, ${alpha(theme.palette.warning.main, 0.08)} 50%, ${alpha(theme.palette.warning.main, 0.06)} 100%)`
            : `linear-gradient(135deg, ${alpha(theme.palette.error.main, 0.1)} 0%, ${alpha(theme.palette.error.main, 0.08)} 50%, ${alpha(theme.palette.error.light, 0.06)} 100%)`,
          border: isStale
            ? `1px solid ${alpha(theme.palette.warning.main, 0.3)}`
            : `1px solid ${alpha(theme.palette.error.main, 0.3)}`,
          color: isStale ? theme.palette.text.primary : theme.palette.error.main,
          boxShadow: isStale
            ? `0 2px 8px ${alpha(theme.palette.warning.main, 0.15)}`
            : `0 2px 8px ${alpha(theme.palette.error.main, 0.15)}`,
          cursor: isStale ? 'pointer' : 'default',
          '&:hover': {
            transform: 'translateY(-1px) scale(1.02)',
            boxShadow: isStale
              ? `0 6px 20px ${alpha(theme.palette.warning.main, 0.25)}, 0 2px 8px ${alpha(theme.palette.warning.main, 0.15)}`
              : `0 6px 20px ${alpha(theme.palette.error.main, 0.25)}, 0 2px 8px ${alpha(theme.palette.error.main, 0.15)}`,
            border: isStale
              ? `1px solid ${alpha(theme.palette.warning.main, 0.5)}`
              : `1px solid ${alpha(theme.palette.error.main, 0.5)}`,
            background: isStale
              ? `linear-gradient(135deg, ${alpha(theme.palette.warning.main, 0.15)} 0%, ${alpha(theme.palette.warning.main, 0.12)} 50%, ${alpha(theme.palette.warning.main, 0.1)} 100%)`
              : `linear-gradient(135deg, ${alpha(theme.palette.error.main, 0.15)} 0%, ${alpha(theme.palette.error.main, 0.12)} 50%, ${alpha(theme.palette.error.light, 0.1)} 100%)`,
          },
          '& .MuiChip-label': {
            px: 1.5,
            py: 0.5,
            fontSize: '0.75rem',
            letterSpacing: '0.5px'
          }
        }}
      />
    );

    return isStale ? (
      <Tooltip
        title={
          <Box sx={{ p: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1, color: 'white' }}>
              OUTDATED RESULT
            </Typography>
            <Typography variant="body2" sx={{ mb: 1, color: 'white' }}>
              SLO configuration changed after this result was generated
            </Typography>
            <Typography variant="body2" sx={{ color: 'white', fontSize: '0.75rem' }}>
              Click to re-evaluate with current configuration
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
    ) : chip;
  }

  // Unknown status
  return (
    <Typography variant="body2" color="text.secondary">
      -
    </Typography>
  );
}
