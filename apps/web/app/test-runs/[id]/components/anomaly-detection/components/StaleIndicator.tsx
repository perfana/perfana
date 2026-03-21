import React from 'react';
import {
  Chip,
  Tooltip,
  Box,
  IconButton,
  Alert,
  AlertTitle,
  Button
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import RefreshIcon from '@mui/icons-material/Refresh';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

interface StaleIndicatorProps {
  isStale?: boolean;
  staleReason?: string;
  onReanalyze?: () => void;
  variant?: 'chip' | 'banner' | 'inline';
  size?: 'small' | 'medium';
}

export function StaleIndicator({
  isStale = false,
  staleReason = 'Configuration changed',
  onReanalyze,
  variant = 'chip',
  size = 'small'
}: StaleIndicatorProps) {
  if (!isStale) return null;

  if (variant === 'chip') {
    return (
      <Tooltip title={`${staleReason} - Click to re-analyze`}>
        <Chip
          icon={<RefreshIcon sx={{ fontSize: size === 'small' ? 14 : 16 }} />}
          label="Outdated"
          color="warning"
          size={size}
          variant="outlined"
          onClick={onReanalyze}
          sx={(theme) => ({
            cursor: onReanalyze ? 'pointer' : 'default',
            '&:hover': onReanalyze ? {
              backgroundColor: alpha(theme.palette.warning.main, 0.08)
            } : {}
          })}
        />
      </Tooltip>
    );
  }

  if (variant === 'banner') {
    return (
      <Alert
        severity="warning"
        icon={<WarningAmberIcon />}
        action={
          onReanalyze && (
            <Button
              size="small"
              color="warning"
              onClick={onReanalyze}
              startIcon={<RefreshIcon />}
            >
              Re-analyze
            </Button>
          )
        }
        sx={{ mb: 2 }}
      >
        <AlertTitle>Outdated Results</AlertTitle>
        {staleReason}. These results may not reflect the current configuration.
      </Alert>
    );
  }

  // Inline variant
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        color: 'warning.main'
      }}
    >
      <Tooltip title={staleReason}>
        <InfoOutlinedIcon sx={{ fontSize: 16 }} />
      </Tooltip>
      {onReanalyze && (
        <Tooltip title="Re-analyze with current configuration">
          <IconButton
            size="small"
            color="warning"
            onClick={onReanalyze}
            sx={{ p: 0.25 }}
          >
            <RefreshIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}

interface BatchStaleIndicatorProps {
  staleCount: number;
  totalCount: number;
  onReanalyzeAll?: () => void;
  onDismiss?: () => void;
}

export function BatchStaleIndicator({
  staleCount,
  totalCount,
  onReanalyzeAll,
  onDismiss
}: BatchStaleIndicatorProps) {
  if (staleCount === 0) return null;

  const percentage = Math.round((staleCount / totalCount) * 100);

  return (
    <Alert
      severity="warning"
      action={
        <Box sx={{ display: 'flex', gap: 1 }}>
          {onReanalyzeAll && (
            <Button
              size="small"
              color="warning"
              onClick={onReanalyzeAll}
              startIcon={<RefreshIcon />}
            >
              Re-analyze All ({staleCount})
            </Button>
          )}
          {onDismiss && (
            <Button size="small" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </Box>
      }
      sx={{ mb: 2 }}
    >
      <AlertTitle>Configuration Changes Detected</AlertTitle>
      {staleCount} of {totalCount} results ({percentage}%) are outdated due to configuration changes.
      Re-analysis is recommended for accurate results.
    </Alert>
  );
}