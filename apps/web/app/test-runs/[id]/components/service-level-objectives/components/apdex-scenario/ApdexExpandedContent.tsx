'use client';

import React from 'react';
import { Box, Typography, CircularProgress, Alert, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { ApdexExpandedContentProps } from '../../types';
import { RequestsBreakdownTable } from './RequestsBreakdownTable';

// Stat card component for S/T/F breakdown
interface StatCardProps {
  count: number;
  label: string;
  description: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

function StatCard({ count, label, description, color, bgColor, borderColor }: StatCardProps) {
  return (
    <Box sx={{
      p: 1.5,
      borderRadius: 1.5,
      backgroundColor: bgColor,
      border: `1px solid ${borderColor}`,
      textAlign: 'center'
    }}>
      <Typography variant="h6" sx={{ fontWeight: 700, color, fontSize: '1.1rem' }}>
        {count}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
        {label} ({description})
      </Typography>
    </Box>
  );
}

function ThemeAwareStatCards({ target }: { target: any }) {
  const theme = useTheme();
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2 }}>
      <StatCard
        count={target.satisfied_count || 0}
        label="Satisfied"
        description={"\u2264T"}
        color={theme.palette.success.main}
        bgColor={alpha(theme.palette.success.main, 0.08)}
        borderColor={alpha(theme.palette.success.main, 0.2)}
      />
      <StatCard
        count={target.tolerating_count || 0}
        label="Tolerating"
        description={"\u22644T"}
        color={theme.palette.warning.main}
        bgColor={alpha(theme.palette.warning.main, 0.08)}
        borderColor={alpha(theme.palette.warning.main, 0.2)}
      />
      <StatCard
        count={target.frustrated_count || 0}
        label="Frustrated"
        description=">4T"
        color={theme.palette.error.main}
        bgColor={alpha(theme.palette.error.main, 0.08)}
        borderColor={alpha(theme.palette.error.main, 0.2)}
      />
      <StatCard
        count={target.total_count || 0}
        label="Total"
        description="all"
        color={theme.palette.primary.main}
        bgColor={alpha(theme.palette.primary.main, 0.08)}
        borderColor={alpha(theme.palette.primary.main, 0.2)}
      />
    </Box>
  );
}

export function ApdexExpandedContent({
  target,
  transactionKey,
  isLastRow,
  scenario,
  transactionSamples,
  isLoading,
  error,
  hasDistributedTracing,
  hasDynatrace,
  onOpenRequestActionMenu,
}: ApdexExpandedContentProps) {
  const transactionName = target.transaction_name || target.target || '';

  return (
    <Box sx={(theme) => ({
      borderLeft: '1px solid',
      borderRight: '1px solid',
      borderBottom: '1px solid',
      borderColor: alpha(theme.palette.primary.main, 0.12),
      borderRadius: isLastRow ? '0 0 8px 8px' : '0',
      backgroundColor: alpha(theme.palette.primary.main, 0.02),
      p: 2,
    })}>
      {/* S/T/F Breakdown Grid */}
      <ThemeAwareStatCards target={target} />

      {/* Requests Breakdown Section */}
      <Box sx={{ mt: 2 }}>
        <Typography variant="subtitle2" sx={{
          fontWeight: 600,
          color: 'text.primary',
          fontSize: '0.8rem',
          mb: 1.5,
          display: 'flex',
          alignItems: 'center',
          gap: 1
        }}>
          Requests Breakdown
        </Typography>

        {isLoading && (
          <Box display="flex" justifyContent="center" alignItems="center" py={2}>
            <CircularProgress size={20} sx={{ mr: 1 }} />
            <Typography variant="body2" color="text.secondary">
              Loading requests...
            </Typography>
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {error}
          </Alert>
        )}

        {!isLoading && !error && transactionSamples?.length === 0 && (
          <Alert severity="info" sx={{ py: 0.5 }}>
            No requests found for this transaction.
          </Alert>
        )}

        {!isLoading && !error && transactionSamples?.length > 0 && (
          <RequestsBreakdownTable
            samples={transactionSamples}
            transactionName={transactionName}
            scenarioName={scenario}
            hasDistributedTracing={hasDistributedTracing}
            hasDynatrace={hasDynatrace}
            onOpenRequestActionMenu={onOpenRequestActionMenu}
          />
        )}
      </Box>
    </Box>
  );
}
