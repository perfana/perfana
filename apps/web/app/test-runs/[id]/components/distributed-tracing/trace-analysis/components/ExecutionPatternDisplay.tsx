'use client';

import React from 'react';
import { Box, Typography } from '@mui/material';
import type { ExecutionPatternDisplayProps } from '../types';

/**
 * Execution pattern display showing pattern comparison
 */
export function ExecutionPatternDisplay({ patterns }: ExecutionPatternDisplayProps) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 3 }}>
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Current Pattern
        </Typography>
        <Typography variant="body2">
          Type: <strong>{patterns.current.isSequential ? 'Sequential' : 'Parallel'}</strong>
        </Typography>
        <Typography variant="body2">
          Parallelism Ratio: <strong>{patterns.current.parallelismRatio}</strong>
        </Typography>
        <Typography variant="body2">
          Max Concurrent: <strong>{patterns.current.maxConcurrentSpans}</strong>
        </Typography>
      </Box>
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Baseline Pattern
        </Typography>
        <Typography variant="body2">
          Type: <strong>{patterns.baseline.isSequential ? 'Sequential' : 'Parallel'}</strong>
        </Typography>
        <Typography variant="body2">
          Parallelism Ratio: <strong>{patterns.baseline.parallelismRatio}</strong>
        </Typography>
        <Typography variant="body2">
          Max Concurrent: <strong>{patterns.baseline.maxConcurrentSpans}</strong>
        </Typography>
      </Box>
    </Box>
  );
}
