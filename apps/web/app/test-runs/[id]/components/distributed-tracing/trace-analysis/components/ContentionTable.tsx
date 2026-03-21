'use client';

import React from 'react';
import {
  Box,
  Typography,
  Tooltip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';
import type { ContentionTableProps } from '../types';
import { getContentionBackgroundColor, calculateMaxWidth } from '../utils/trace-formatters';

/**
 * Generate tree prefix for depth visualization
 */
function getTreePrefix(depth: number): React.ReactNode {
  if (depth === 0) return null;
  const connectors: React.ReactNode[] = [];
  for (let i = 0; i < depth; i++) {
    connectors.push(
      <Box
        key={`indent-${i}`}
        component="span"
        sx={{
          display: 'inline-block',
          width: 12,
          color: 'text.disabled',
          fontFamily: 'monospace',
          fontSize: '0.7rem',
        }}
      >
        {i < depth - 1 ? '|' : '└'}
      </Box>
    );
  }
  return <>{connectors}</>;
}

/**
 * Contention table with hierarchy visualization
 */
export function ContentionTable({ contentions }: ContentionTableProps) {
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Span</TableCell>
            <TableCell>Parent</TableCell>
            <TableCell align="right">Current Delay</TableCell>
            <TableCell align="right">Baseline Delay</TableCell>
            <TableCell align="right">Increase</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {contentions.map((c, idx) => (
            <TableRow
              key={idx}
              sx={{
                backgroundColor: getContentionBackgroundColor(c.isContentionIndicator, c.depth),
              }}
            >
              <TableCell>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {/* Tree structure visualization */}
                  <Box
                    component="span"
                    sx={{
                      fontFamily: 'monospace',
                      fontSize: '0.7rem',
                      whiteSpace: 'pre',
                      color: 'text.disabled',
                      userSelect: 'none',
                    }}
                  >
                    {getTreePrefix(c.depth)}
                  </Box>
                  <Tooltip
                    title={
                      <Box>
                        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                          {c.spanName}
                        </Typography>
                        <Typography
                          variant="caption"
                          display="block"
                          sx={{ mt: 0.5, color: 'grey.400' }}
                        >
                          Parent: {c.parentSpanName}
                        </Typography>
                        <Typography variant="caption" display="block" sx={{ color: 'grey.400' }}>
                          Depth: {c.depth}
                        </Typography>
                      </Box>
                    }
                  >
                    <Typography
                      variant="body2"
                      sx={{
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                        fontWeight: c.depth === 0 ? 600 : 400,
                        maxWidth: calculateMaxWidth(180, c.depth, 12),
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {c.spanName}
                    </Typography>
                  </Tooltip>
                </Box>
              </TableCell>
              <TableCell>
                <Typography
                  variant="body2"
                  sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'text.secondary' }}
                >
                  {c.parentSpanName}
                </Typography>
              </TableCell>
              <TableCell align="right">
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                  {c.currentStartDelay.toFixed(2)}ms
                </Typography>
              </TableCell>
              <TableCell align="right">
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                  {c.baselineStartDelay.toFixed(2)}ms
                </Typography>
              </TableCell>
              <TableCell align="right">
                <Typography
                  variant="body2"
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: c.isContentionIndicator ? 'warning.main' : 'text.primary',
                  }}
                >
                  +{c.startDelayIncrease.toFixed(2)}ms
                </Typography>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
