'use client';

import React from 'react';
import { Box, Typography, Chip } from '@mui/material';
import { CheckCircle } from '@mui/icons-material';
import type { ErrorAnalysisDisplayProps } from '../types';

/**
 * Error analysis display showing error rates and changes
 */
export function ErrorAnalysisDisplay({ errorAnalysis }: ErrorAnalysisDisplayProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Summary */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2 }}>
        <Box
          sx={{
            p: 2,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
          }}
        >
          <Typography variant="caption" color="text.secondary">
            Current Error Rate
          </Typography>
          <Typography
            variant="h6"
            sx={{
              fontFamily: 'monospace',
              color: errorAnalysis.current.errorRate > 0 ? 'error.main' : 'success.main',
            }}
          >
            {errorAnalysis.current.errorRate.toFixed(2)}%
          </Typography>
          <Typography variant="caption" color="text.secondary">
            ({errorAnalysis.current.totalErrorSpans} error spans)
          </Typography>
        </Box>
        <Box
          sx={{
            p: 2,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
          }}
        >
          <Typography variant="caption" color="text.secondary">
            Baseline Error Rate
          </Typography>
          <Typography
            variant="h6"
            sx={{
              fontFamily: 'monospace',
              color: errorAnalysis.baseline.errorRate > 0 ? 'error.main' : 'success.main',
            }}
          >
            {errorAnalysis.baseline.errorRate.toFixed(2)}%
          </Typography>
          <Typography variant="caption" color="text.secondary">
            ({errorAnalysis.baseline.totalErrorSpans} error spans)
          </Typography>
        </Box>
      </Box>

      {/* New errors */}
      {errorAnalysis.newErrors.length > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1, color: 'error.main' }}>
            New Errors
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {errorAnalysis.newErrors.map((error: string, idx: number) => (
              <Chip key={idx} label={error} size="small" color="error" />
            ))}
          </Box>
        </Box>
      )}

      {/* Resolved errors */}
      {errorAnalysis.resolvedErrors.length > 0 && (
        <Box>
          <Typography
            variant="subtitle2"
            sx={{
              mb: 1,
              color: 'success.main',
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
            }}
          >
            <CheckCircle fontSize="small" /> Resolved Errors
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {errorAnalysis.resolvedErrors.map((error: string, idx: number) => (
              <Chip key={idx} label={error} size="small" color="success" variant="outlined" />
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}
