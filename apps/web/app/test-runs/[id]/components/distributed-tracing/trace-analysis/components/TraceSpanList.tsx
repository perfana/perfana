'use client';

import React from 'react';
import {
  Box,
  Typography,
  Chip,
  Tooltip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';
import type { SpanComparisonTableProps } from '../types';
import {
  getDurationChangeColor,
  getSpanRowBackgroundColor,
  calculateMaxWidth,
} from '../utils/trace-formatters';

/**
 * Generate tree connector prefix for hierarchy visualization
 */
function getTreePrefix(depth: number, hasChildren: boolean): React.ReactNode {
  if (depth === 0) return null;

  const connectors: React.ReactNode[] = [];
  // Add indentation for each level
  for (let i = 0; i < depth - 1; i++) {
    connectors.push(
      <Box
        key={`indent-${i}`}
        component="span"
        sx={{
          display: 'inline-block',
          width: 16,
          color: 'text.disabled',
        }}
      >
        |
      </Box>
    );
  }
  // Add the connector for the current level
  connectors.push(
    <Box
      key="connector"
      component="span"
      sx={{
        display: 'inline-block',
        width: 16,
        color: 'text.disabled',
      }}
    >
      {hasChildren ? '|' : '└'}-
    </Box>
  );

  return <>{connectors}</>;
}

/**
 * Span comparison table with hierarchy visualization
 */
export function TraceSpanList({ spans }: SpanComparisonTableProps) {
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Span Name</TableCell>
            <TableCell align="right">Current (ms)</TableCell>
            <TableCell align="right">Baseline (ms)</TableCell>
            <TableCell align="right">Change</TableCell>
            <TableCell align="right">Calls</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {spans.map((span, idx) => (
            <TableRow
              key={idx}
              sx={{
                backgroundColor: getSpanRowBackgroundColor(
                  span.isNewSpan,
                  span.isMissingSpan,
                  span.depth
                ),
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
                    {getTreePrefix(span.depth, span.hasChildren)}
                  </Box>
                  {span.isNewSpan && (
                    <Chip
                      label="NEW"
                      size="small"
                      color="primary"
                      sx={{ fontSize: '0.65rem', height: 18 }}
                    />
                  )}
                  {span.isMissingSpan && (
                    <Chip
                      label="MISSING"
                      size="small"
                      color="error"
                      sx={{ fontSize: '0.65rem', height: 18 }}
                    />
                  )}
                  <Tooltip
                    title={
                      <Box>
                        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                          {span.serviceName}::{span.spanName}
                        </Typography>
                        {span.parentSpanName && (
                          <Typography
                            variant="caption"
                            display="block"
                            sx={{ mt: 0.5, color: 'grey.400' }}
                          >
                            Parent: {span.parentSpanName}
                          </Typography>
                        )}
                        <Typography variant="caption" display="block" sx={{ color: 'grey.400' }}>
                          Depth: {span.depth}
                        </Typography>
                      </Box>
                    }
                  >
                    <Typography
                      variant="body2"
                      sx={{
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                        maxWidth: calculateMaxWidth(300, span.depth),
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontWeight: span.depth === 0 ? 600 : 400,
                      }}
                    >
                      {span.spanName}
                    </Typography>
                  </Tooltip>
                </Box>
              </TableCell>
              <TableCell align="right">
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                  {span.currentAvgDuration.toFixed(2)}
                </Typography>
              </TableCell>
              <TableCell align="right">
                <Typography
                  variant="body2"
                  sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'text.secondary' }}
                >
                  {span.baselineAvgDuration.toFixed(2)}
                </Typography>
              </TableCell>
              <TableCell align="right">
                <Typography
                  variant="body2"
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: getDurationChangeColor(span.durationChangePercent),
                  }}
                >
                  {span.durationChange > 0 ? '+' : ''}
                  {span.durationChange.toFixed(2)}ms ({span.durationChangePercent > 0 ? '+' : ''}
                  {span.durationChangePercent.toFixed(1)}%)
                </Typography>
              </TableCell>
              <TableCell align="right">
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                  {span.currentCallCount} / {span.baselineCallCount}
                </Typography>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
