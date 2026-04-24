'use client';

import React from 'react';
import {
  Box,
  Typography,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Tooltip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { MoreVert } from '@mui/icons-material';
import type { RequestsBreakdownTableProps } from '../../types';

export function RequestsBreakdownTable({
  samples,
  transactionName,
  scenarioName,
  hasDistributedTracing,
  hasDynatrace,
  excludeRampUp,
  onOpenRequestActionMenu,
}: RequestsBreakdownTableProps) {
  const showActionsColumn = hasDistributedTracing || hasDynatrace;

  return (
    <>
      {excludeRampUp && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mb: 0.5, fontStyle: 'italic' }}
        >
          Ramp-up period excluded (matches Apdex SLO configuration)
        </Typography>
      )}
      <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
      <Table size="small">
        <TableHead>
          <TableRow sx={{ backgroundColor: 'action.hover' }}>
            <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Request Name</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Avg Response (ms)</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.75rem' }}>95th Pct (ms)</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.75rem' }}>99th Pct (ms)</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Passed</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Failed</TableCell>
            {showActionsColumn && (
              <TableCell align="center" sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Actions</TableCell>
            )}
          </TableRow>
        </TableHead>
        <TableBody>
          {samples.map((sampler, samplerIdx) => (
            <TableRow
              key={samplerIdx}
              sx={(theme) => ({
                '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.04) },
                '&:nth-of-type(odd)': { backgroundColor: alpha(theme.palette.text.primary, 0.02) }
              })}
            >
              <TableCell component="th" scope="row">
                <Box>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    {sampler.sampler_name}
                  </Typography>
                  {sampler.url_pattern && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        fontFamily: 'monospace',
                        fontSize: '0.65rem',
                        display: 'block',
                        mt: 0.5,
                      }}
                    >
                      {sampler.url_pattern}
                    </Typography>
                  )}
                </Box>
              </TableCell>
              <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                {sampler.avg_response_time?.toFixed(2) || '-'}
              </TableCell>
              <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                {sampler.p95_response_time?.toFixed(2) || '-'}
              </TableCell>
              <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                {sampler.p99_response_time?.toFixed(2) || '-'}
              </TableCell>
              <TableCell align="right" sx={{
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                color: 'success.main',
                fontWeight: 600
              }}>
                {sampler.passed_count}
              </TableCell>
              <TableCell align="right" sx={{
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                color: sampler.failed_count > 0 ? 'error.main' : 'text.secondary',
                fontWeight: sampler.failed_count > 0 ? 600 : 400
              }}>
                {sampler.failed_count}
              </TableCell>
              {showActionsColumn && (
                <TableCell align="center">
                  <Tooltip title="Actions" arrow>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenRequestActionMenu(
                          e,
                          transactionName,
                          scenarioName,
                          sampler.sampler_name
                        );
                      }}
                      sx={(theme) => ({
                        color: 'secondary.main',
                        p: 0.5,
                        '&:hover': {
                          backgroundColor: alpha(theme.palette.secondary.main, 0.08),
                        }
                      })}
                    >
                      <MoreVert sx={{ fontSize: '1rem' }} />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
    </>
  );
}
