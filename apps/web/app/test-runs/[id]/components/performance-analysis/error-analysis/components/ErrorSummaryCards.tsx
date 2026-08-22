'use client';

import { Box, Typography } from '@mui/material';
import { ErrorSummary } from '../types';

interface ErrorSummaryCardsProps {
  summary: ErrorSummary;
}

interface MetricTileProps {
  value: string | number;
  label: string;
  /** MUI palette path, e.g. 'error.main' */
  color: string;
  /** rgb triple of the same color, used for the 4%/12% tint pair */
  rgb: string;
  caption?: string;
}

function MetricTile({ value, label, color, rgb, caption }: MetricTileProps) {
  return (
    <Box
      sx={{
        p: 2,
        backgroundColor: `rgba(${rgb}, 0.04)`,
        borderRadius: 2,
        border: `1px solid rgba(${rgb}, 0.12)`,
      }}
    >
      <Typography
        variant="caption"
        sx={{ color: 'text.secondary', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase' }}
      >
        {label}
      </Typography>
      <Typography variant="h6" sx={{ fontFamily: 'monospace', fontWeight: 700, color }}>
        {value}
      </Typography>
      {caption && (
        <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
          {caption}
        </Typography>
      )}
    </Box>
  );
}

export function ErrorSummaryCards({ summary }: ErrorSummaryCardsProps) {
  const hasErrors = !!summary.errorRate && summary.errorRate > 0;

  return (
    <Box sx={{ mb: 3 }}>
      <Typography
        variant="subtitle2"
        sx={{
          fontWeight: 700,
          fontSize: '0.9rem',
          color: 'text.secondary',
          mb: 2,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        Error Summary
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(5, 1fr)' },
          gap: 2,
        }}
      >
        <MetricTile
          label="Request Error Rate"
          value={summary.errorRate !== undefined ? `${summary.errorRate.toFixed(2)}%` : 'N/A'}
          color={hasErrors ? 'error.main' : 'success.main'}
          rgb={hasErrors ? '244, 67, 54' : '76, 175, 80'}
          caption={summary.totalRequests ? `of ${summary.totalRequests.toLocaleString()} requests` : undefined}
        />
        <MetricTile
          label="Total Errors"
          value={summary.totalErrors.toLocaleString()}
          color="error.main"
          rgb="244, 67, 54"
        />
        <MetricTile
          label="Unique Error Codes"
          value={summary.uniqueResponseCodes}
          color="secondary.main"
          rgb="156, 39, 176"
        />
        <MetricTile
          label="Affected Transactions"
          value={summary.transactionsWithErrors}
          color="warning.main"
          rgb="255, 152, 0"
        />
        <MetricTile
          label="Unique Error URLs"
          value={summary.uniqueErrorUrls}
          color="info.main"
          rgb="33, 150, 243"
        />
      </Box>
    </Box>
  );
}

export default ErrorSummaryCards;
