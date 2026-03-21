'use client';

import React from 'react';
import {
  Box,
  Typography,
  Chip,
  Tooltip,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';
import { Warning, ZoomIn } from '@mui/icons-material';
import type { SamplerBreakdownTableProps } from '../types';
import { getSamplerChangeColor, getContributionColor, getSamplerRowBackgroundColor } from '../utils/trace-formatters';

/**
 * Sampler breakdown table with drill-down support
 */
export function SamplerBreakdownTable({ samplers, onDrillDown }: SamplerBreakdownTableProps) {
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Request Name</TableCell>
            <TableCell align="right">Current (ms)</TableCell>
            <TableCell align="right">Baseline (ms)</TableCell>
            <TableCell align="right">Change</TableCell>
            <TableCell align="right">Contribution</TableCell>
            <TableCell>Recommendation</TableCell>
            {onDrillDown && <TableCell align="center">Action</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {samplers.map((sampler, idx) => (
            <TableRow
              key={idx}
              sx={{
                backgroundColor: getSamplerRowBackgroundColor(
                  sampler.isLikelyProblem,
                  sampler.currentTraceCount,
                  sampler.baselineTraceCount
                ),
                '&:hover': onDrillDown
                  ? {
                      backgroundColor: 'action.hover',
                      cursor: 'pointer',
                    }
                  : {},
              }}
              onClick={onDrillDown ? () => onDrillDown(sampler.samplerName) : undefined}
            >
              <TableCell>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {sampler.isLikelyProblem && (
                    <Warning sx={{ color: 'warning.main', fontSize: 18 }} />
                  )}
                  {sampler.currentTraceCount === 0 && (
                    <Chip
                      label="MISSING"
                      size="small"
                      color="error"
                      sx={{ fontSize: '0.65rem', height: 18 }}
                    />
                  )}
                  {sampler.baselineTraceCount === 0 && sampler.currentTraceCount > 0 && (
                    <Chip
                      label="NEW"
                      size="small"
                      color="primary"
                      sx={{ fontSize: '0.65rem', height: 18 }}
                    />
                  )}
                  <Tooltip
                    title={`Traces: ${sampler.currentTraceCount} current / ${sampler.baselineTraceCount} baseline`}
                  >
                    <Typography
                      variant="body2"
                      sx={{
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                        fontWeight: sampler.isLikelyProblem ? 600 : 400,
                        maxWidth: 200,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {sampler.samplerName}
                    </Typography>
                  </Tooltip>
                </Box>
              </TableCell>
              <TableCell align="right">
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                  {sampler.currentAvgDuration.toFixed(2)}
                </Typography>
              </TableCell>
              <TableCell align="right">
                <Typography
                  variant="body2"
                  sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'text.secondary' }}
                >
                  {sampler.baselineAvgDuration.toFixed(2)}
                </Typography>
              </TableCell>
              <TableCell align="right">
                <Typography
                  variant="body2"
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: getSamplerChangeColor(sampler.durationChangePercent),
                  }}
                >
                  {sampler.durationChange > 0 ? '+' : ''}
                  {sampler.durationChange.toFixed(2)}ms
                  {sampler.baselineTraceCount > 0 &&
                    ` (${sampler.durationChangePercent > 0 ? '+' : ''}${sampler.durationChangePercent.toFixed(1)}%)`}
                </Typography>
              </TableCell>
              <TableCell align="right">
                <Typography
                  variant="body2"
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: '0.75rem',
                    fontWeight: sampler.contributionToSlowdown > 25 ? 600 : 400,
                    color: getContributionColor(sampler.contributionToSlowdown),
                  }}
                >
                  {sampler.contributionToSlowdown > 0
                    ? sampler.contributionToSlowdown.toFixed(1)
                    : '-'}
                  %
                </Typography>
              </TableCell>
              <TableCell>
                <Typography
                  variant="body2"
                  sx={{
                    fontSize: '0.7rem',
                    color: sampler.isLikelyProblem ? 'warning.dark' : 'text.secondary',
                    maxWidth: 200,
                  }}
                >
                  {sampler.recommendation}
                </Typography>
              </TableCell>
              {onDrillDown && (
                <TableCell align="center">
                  <Tooltip title={`Drill down into ${sampler.samplerName}`}>
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDrillDown(sampler.samplerName);
                      }}
                      sx={{
                        '&:hover': {
                          backgroundColor: 'primary.main',
                          color: 'primary.contrastText',
                        },
                      }}
                    >
                      <ZoomIn fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
