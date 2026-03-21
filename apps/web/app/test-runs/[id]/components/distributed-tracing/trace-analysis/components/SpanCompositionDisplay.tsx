'use client';

import React from 'react';
import { Box, Typography, Chip } from '@mui/material';
import { NewReleases, Error as ErrorIcon } from '@mui/icons-material';
import type { SpanCompositionDisplayProps } from '../types';

/**
 * Span composition display showing new and missing spans
 */
export function SpanCompositionDisplay({ composition }: SpanCompositionDisplayProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {composition.newSpans.length > 0 && (
        <Box>
          <Typography
            variant="subtitle2"
            sx={{
              mb: 1,
              color: 'primary.main',
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
            }}
          >
            <NewReleases fontSize="small" /> New Spans ({composition.newSpans.length})
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {composition.newSpans.map((span, idx) => (
              <Chip key={idx} label={span} size="small" color="primary" variant="outlined" />
            ))}
          </Box>
        </Box>
      )}
      {composition.missingSpans.length > 0 && (
        <Box>
          <Typography
            variant="subtitle2"
            sx={{
              mb: 1,
              color: 'error.main',
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
            }}
          >
            <ErrorIcon fontSize="small" /> Missing Spans ({composition.missingSpans.length})
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {composition.missingSpans.map((span, idx) => (
              <Chip key={idx} label={span} size="small" color="error" variant="outlined" />
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}
