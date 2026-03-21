'use client';

/**
 * AWR Parsing Status Component
 *
 * Displays the parsing status of an AWR (Automatic Workload Repository) report
 * with visual progress indication, status messages, and error handling.
 *
 * Features:
 * - Visual status indicators (pending, parsing, completed, failed)
 * - Optional progress percentage display
 * - Error message display with retry functionality
 * - Compact mode for inline display
 * - Accessible with proper ARIA labels
 *
 * @example
 * ```tsx
 * <AwrParsingStatus
 *   status="parsing"
 *   progress={45}
 *   onRetry={() => handleRetry()}
 * />
 * ```
 */

import { Box, Typography, LinearProgress, CircularProgress, Button, alpha } from '@mui/material';
import {
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  HourglassEmpty as PendingIcon,
  Refresh as RetryIcon,
  Analytics as ParsingIcon,
} from '@mui/icons-material';
import type { AwrParsingStatusProps, ParseStatus } from './types';

// ==================== Constants ====================

/**
 * Status configuration for each parse state
 */
interface StatusConfig {
  icon: JSX.Element;
  color: string;
  backgroundColor: string;
  borderColor: string;
  message: string;
  subMessage?: string;
}

/**
 * Get status configuration based on parse status
 */
function getStatusConfig(status: ParseStatus, error?: string): StatusConfig {
  switch (status) {
    case 'pending':
      return {
        icon: <PendingIcon sx={{ fontSize: 24, color: '#ff9800' }} />,
        color: '#ff9800',
        backgroundColor: alpha('#ff9800', 0.08),
        borderColor: alpha('#ff9800', 0.3),
        message: 'Waiting to parse',
        subMessage: 'The AWR report is queued for parsing',
      };
    case 'parsing':
      return {
        icon: <ParsingIcon sx={{ fontSize: 24, color: '#1976d2' }} />,
        color: '#1976d2',
        backgroundColor: alpha('#1976d2', 0.08),
        borderColor: alpha('#1976d2', 0.3),
        message: 'Parsing report',
        subMessage: 'Extracting metrics and analyzing data...',
      };
    case 'completed':
      return {
        icon: <SuccessIcon sx={{ fontSize: 24, color: '#4caf50' }} />,
        color: '#4caf50',
        backgroundColor: alpha('#4caf50', 0.08),
        borderColor: alpha('#4caf50', 0.3),
        message: 'Parsing complete',
        subMessage: 'AWR report has been successfully parsed',
      };
    case 'failed':
      return {
        icon: <ErrorIcon sx={{ fontSize: 24, color: '#f44336' }} />,
        color: '#f44336',
        backgroundColor: alpha('#f44336', 0.08),
        borderColor: alpha('#f44336', 0.3),
        message: 'Parsing failed',
        subMessage: error || 'An error occurred while parsing the report',
      };
    default:
      return {
        icon: <PendingIcon sx={{ fontSize: 24, color: '#9e9e9e' }} />,
        color: '#9e9e9e',
        backgroundColor: alpha('#9e9e9e', 0.08),
        borderColor: alpha('#9e9e9e', 0.3),
        message: 'Unknown status',
        subMessage: undefined,
      };
  }
}

/**
 * Format progress percentage for display
 */
function formatProgress(progress: number): string {
  return `${Math.round(Math.min(100, Math.max(0, progress)))}%`;
}

// ==================== Component ====================

/**
 * AWR Parsing Status Component
 *
 * Displays the current parsing status of an AWR report with visual indicators
 * and optional progress information.
 */
export default function AwrParsingStatus({
  status,
  progress,
  error,
  onRetry,
  compact = false,
}: AwrParsingStatusProps): JSX.Element {
  const config = getStatusConfig(status, error);
  const hasProgress = typeof progress === 'number' && status === 'parsing';
  const showRetry = status === 'failed' && onRetry;

  // Compact mode renders minimal inline status
  if (compact) {
    return (
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1,
        }}
        role="status"
        aria-label={`Parse status: ${status}`}
      >
        {status === 'parsing' ? (
          <CircularProgress
            size={16}
            sx={{ color: config.color }}
            aria-label="Parsing in progress"
          />
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            {config.icon}
          </Box>
        )}
        <Typography
          variant="body2"
          sx={{
            color: config.color,
            fontWeight: 500,
          }}
        >
          {config.message}
          {hasProgress && ` (${formatProgress(progress)})`}
        </Typography>
        {showRetry && (
          <Button
            size="small"
            variant="text"
            onClick={onRetry}
            sx={{
              minWidth: 'auto',
              p: 0.5,
              color: config.color,
              textTransform: 'none',
            }}
            aria-label="Retry parsing"
          >
            Retry
          </Button>
        )}
      </Box>
    );
  }

  // Full mode renders a card-like status display
  return (
    <Box
      sx={{
        p: 2,
        borderRadius: 1,
        backgroundColor: config.backgroundColor,
        border: `1px solid ${config.borderColor}`,
      }}
      role="status"
      aria-label={`Parse status: ${status}`}
      aria-describedby={config.subMessage ? 'parsing-status-description' : undefined}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
        {/* Status icon */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 40,
            height: 40,
            borderRadius: '50%',
            backgroundColor: alpha(config.color, 0.1),
            flexShrink: 0,
          }}
        >
          {status === 'parsing' ? (
            <CircularProgress
              size={24}
              sx={{ color: config.color }}
              aria-label="Parsing in progress"
            />
          ) : (
            config.icon
          )}
        </Box>

        {/* Status text and progress */}
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography
            variant="subtitle2"
            sx={{
              color: config.color,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
            }}
          >
            {config.message}
            {hasProgress && (
              <Typography
                component="span"
                variant="body2"
                sx={{ color: 'text.secondary', fontWeight: 400 }}
              >
                — {formatProgress(progress)}
              </Typography>
            )}
          </Typography>

          {config.subMessage && (
            <Typography
              id="parsing-status-description"
              variant="body2"
              sx={{
                color: 'text.secondary',
                mt: 0.5,
                wordBreak: 'break-word',
              }}
            >
              {config.subMessage}
            </Typography>
          )}

          {/* Progress bar for parsing state */}
          {status === 'parsing' && (
            <Box sx={{ mt: 1.5 }}>
              {hasProgress ? (
                <LinearProgress
                  variant="determinate"
                  value={progress}
                  sx={{
                    height: 6,
                    borderRadius: 1,
                    backgroundColor: alpha(config.color, 0.2),
                    '& .MuiLinearProgress-bar': {
                      borderRadius: 1,
                      backgroundColor: config.color,
                    },
                  }}
                  aria-label={`Parsing progress: ${formatProgress(progress)}`}
                />
              ) : (
                <LinearProgress
                  variant="indeterminate"
                  sx={{
                    height: 6,
                    borderRadius: 1,
                    backgroundColor: alpha(config.color, 0.2),
                    '& .MuiLinearProgress-bar': {
                      borderRadius: 1,
                      backgroundColor: config.color,
                    },
                  }}
                  aria-label="Parsing in progress"
                />
              )}
            </Box>
          )}

          {/* Retry button for failed state */}
          {showRetry && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<RetryIcon />}
              onClick={onRetry}
              sx={{
                mt: 1.5,
                textTransform: 'none',
                borderColor: config.color,
                color: config.color,
                '&:hover': {
                  borderColor: config.color,
                  backgroundColor: alpha(config.color, 0.08),
                },
              }}
              aria-label="Retry parsing the AWR report"
            >
              Retry Parsing
            </Button>
          )}
        </Box>
      </Box>
    </Box>
  );
}

// Named export for flexibility
export { AwrParsingStatus };
