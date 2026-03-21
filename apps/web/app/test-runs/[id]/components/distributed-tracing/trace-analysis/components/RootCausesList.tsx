'use client';

import React from 'react';
import { Box, Typography, Chip, Tooltip } from '@mui/material';
import { Warning } from '@mui/icons-material';
import type { RootCausesListProps } from '../types';
import { getConfidenceColor, getRootCauseBackgroundColor, calculateMaxWidth } from '../utils/trace-formatters';

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
 * Root causes list with hierarchy visualization
 */
export function RootCausesList({ rootCauses }: RootCausesListProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {rootCauses.map((cause, idx) => (
        <Box
          key={idx}
          sx={{
            p: 2,
            pl: 2 + cause.depth * 1.5, // Increase left padding based on depth
            border: '1px solid',
            borderColor: cause.isLikelyRootCause ? 'error.light' : 'divider',
            borderRadius: 2,
            backgroundColor: getRootCauseBackgroundColor(cause.isLikelyRootCause, cause.depth),
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              {/* Depth visualization */}
              {getTreePrefix(cause.depth)}
              {cause.isLikelyRootCause && <Warning sx={{ color: 'error.main', fontSize: 18 }} />}
              <Tooltip
                title={
                  <Box>
                    <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                      {cause.serviceName}::{cause.spanName}
                    </Typography>
                    {cause.parentSpanName && (
                      <Typography
                        variant="caption"
                        display="block"
                        sx={{ mt: 0.5, color: 'grey.400' }}
                      >
                        Parent: {cause.parentSpanName}
                      </Typography>
                    )}
                    <Typography variant="caption" display="block" sx={{ color: 'grey.400' }}>
                      Depth: {cause.depth}
                    </Typography>
                  </Box>
                }
              >
                <Typography
                  variant="body2"
                  sx={{
                    fontFamily: 'monospace',
                    fontWeight: cause.depth === 0 ? 700 : 600,
                    maxWidth: calculateMaxWidth(400, cause.depth, 12),
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {cause.spanName}
                </Typography>
              </Tooltip>
            </Box>
            <Chip
              label={cause.confidence}
              size="small"
              color={getConfidenceColor(cause.confidence)}
              sx={{ fontSize: '0.65rem', height: 20 }}
            />
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1, fontSize: '0.8rem' }}>
            {cause.explanation}
          </Typography>
          <Box sx={{ display: 'flex', gap: 3, fontSize: '0.75rem', flexWrap: 'wrap' }}>
            <Typography variant="caption">
              Duration: <strong>+{cause.durationIncrease.toFixed(2)}ms</strong> (+
              {cause.percentIncrease.toFixed(1)}%)
            </Typography>
            <Typography variant="caption">
              Self time: <strong>+{cause.selfDurationIncrease.toFixed(2)}ms</strong> (+
              {cause.selfPercentIncrease.toFixed(1)}%)
            </Typography>
            <Typography variant="caption">
              Contribution: <strong>{cause.contributionToTotalIncrease.toFixed(1)}%</strong>
            </Typography>
          </Box>
        </Box>
      ))}
    </Box>
  );
}
