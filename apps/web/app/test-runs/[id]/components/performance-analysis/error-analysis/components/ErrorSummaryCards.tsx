'use client';

import { Box, Typography, Grid } from '@mui/material';
import { ErrorSummary } from '../types';

interface ErrorSummaryCardsProps {
  summary: ErrorSummary;
}

interface SummaryCardProps {
  value: string | number;
  label: string;
  color: string;
  bgGradient: string;
  borderColor: string;
  shadowColor: string;
}

function SummaryCard({ value, label, color, bgGradient, borderColor, shadowColor }: SummaryCardProps) {
  return (
    <Box
      sx={{
        p: 2.5,
        textAlign: 'center',
        background: bgGradient,
        border: '1.5px solid',
        borderColor: borderColor,
        borderRadius: 2,
        boxShadow: `0 2px 8px ${shadowColor}`,
        transition: 'all 0.2s ease',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: `0 4px 12px ${shadowColor.replace('0.15', '0.25')}`,
        },
      }}
    >
      <Typography
        variant="h3"
        sx={{
          fontWeight: 800,
          color: color,
          fontFamily: 'monospace',
          mb: 0.5,
        }}
      >
        {value}
      </Typography>
      <Typography
        variant="caption"
        sx={{
          display: 'block',
          fontSize: '0.75rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: 'text.secondary',
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}

export function ErrorSummaryCards({ summary }: ErrorSummaryCardsProps) {
  const hasErrors = summary.errorRate && summary.errorRate > 0;

  return (
    <Grid container spacing={2} sx={{ mb: 3, width: '100%' }}>
      {/* Error Rate Card */}
      <Grid item xs={12} sm={6} md={2.4} sx={{ flex: { md: '1 1 0' }, minWidth: 0 }}>
        <SummaryCard
          value={summary.errorRate !== undefined ? `${summary.errorRate.toFixed(2)}%` : 'N/A'}
          label="Request Error Rate"
          color={hasErrors ? '#f44336' : '#4caf50'}
          bgGradient={hasErrors
            ? 'linear-gradient(135deg, rgba(244, 67, 54, 0.12) 0%, rgba(244, 67, 54, 0.06) 100%)'
            : 'linear-gradient(135deg, rgba(76, 175, 80, 0.12) 0%, rgba(76, 175, 80, 0.06) 100%)'
          }
          borderColor={hasErrors ? 'rgba(244, 67, 54, 0.25)' : 'rgba(76, 175, 80, 0.25)'}
          shadowColor={hasErrors ? 'rgba(244, 67, 54, 0.15)' : 'rgba(76, 175, 80, 0.15)'}
        />
      </Grid>

      {/* Total Errors */}
      <Grid item xs={12} sm={6} md={2.4} sx={{ flex: { md: '1 1 0' }, minWidth: 0 }}>
        <SummaryCard
          value={summary.totalErrors.toLocaleString()}
          label="Total Errors"
          color="#f44336"
          bgGradient="linear-gradient(135deg, rgba(244, 67, 54, 0.12) 0%, rgba(244, 67, 54, 0.06) 100%)"
          borderColor="rgba(244, 67, 54, 0.25)"
          shadowColor="rgba(244, 67, 54, 0.15)"
        />
      </Grid>

      {/* Unique Error Codes */}
      <Grid item xs={12} sm={6} md={2.4} sx={{ flex: { md: '1 1 0' }, minWidth: 0 }}>
        <SummaryCard
          value={summary.uniqueResponseCodes}
          label="Unique Error Codes"
          color="#e91e63"
          bgGradient="linear-gradient(135deg, rgba(233, 30, 99, 0.12) 0%, rgba(233, 30, 99, 0.06) 100%)"
          borderColor="rgba(233, 30, 99, 0.25)"
          shadowColor="rgba(233, 30, 99, 0.15)"
        />
      </Grid>

      {/* Affected Transactions */}
      <Grid item xs={12} sm={6} md={2.4} sx={{ flex: { md: '1 1 0' }, minWidth: 0 }}>
        <SummaryCard
          value={summary.transactionsWithErrors}
          label="Affected Transactions"
          color="#9c27b0"
          bgGradient="linear-gradient(135deg, rgba(156, 39, 176, 0.12) 0%, rgba(156, 39, 176, 0.06) 100%)"
          borderColor="rgba(156, 39, 176, 0.25)"
          shadowColor="rgba(156, 39, 176, 0.15)"
        />
      </Grid>

      {/* Unique Error URLs */}
      <Grid item xs={12} sm={6} md={2.4} sx={{ flex: { md: '1 1 0' }, minWidth: 0 }}>
        <SummaryCard
          value={summary.uniqueErrorUrls}
          label="Unique Error URLs"
          color="#673ab7"
          bgGradient="linear-gradient(135deg, rgba(103, 58, 183, 0.12) 0%, rgba(103, 58, 183, 0.06) 100%)"
          borderColor="rgba(103, 58, 183, 0.25)"
          shadowColor="rgba(103, 58, 183, 0.15)"
        />
      </Grid>
    </Grid>
  );
}

export default ErrorSummaryCards;
