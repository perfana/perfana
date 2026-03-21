'use client';

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
import { MoreVert as MoreVertIcon } from '@mui/icons-material';
import { SamplerStat } from '../types/performance-analysis.types';
import { formatNumber, formatApdex, getApdexColor, getApdexLabel } from '../utils/performance-formatters';

export interface SamplerTableProps {
  samples: SamplerStat[];
  transactionName: string;
  onOpenSamplerActionMenu: (event: React.MouseEvent<HTMLElement>, transaction: string, sampler: SamplerStat) => void;
  onOpenSamplerErrors: (transactionName: string, samplerName: string) => void;
}

export function SamplerTable({
  samples,
  transactionName,
  onOpenSamplerActionMenu,
  onOpenSamplerErrors,
}: SamplerTableProps) {
  return (
    <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid rgba(0, 0, 0, 0.08)' }}>
      <Table size="small">
        <TableHead>
          <TableRow sx={{ backgroundColor: 'rgba(0, 0, 0, 0.04)' }}>
            <TableCell sx={{ fontWeight: 700 }}>Request Name</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>Avg Response (ms)</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>95th Pct (ms)</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>99th Pct (ms)</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>Passed</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>Failed</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>Apdex Score</TableCell>
            <TableCell align="center" sx={{ fontWeight: 700 }}>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {samples.map((sampler, idx) => (
            <TableRow key={idx} sx={{
              '&:hover': { backgroundColor: 'rgba(25, 118, 210, 0.04)' },
              '&:nth-of-type(odd)': { backgroundColor: 'rgba(0, 0, 0, 0.02)' }
            }}>
              <TableCell component="th" scope="row" sx={{ fontWeight: 500 }}>
                <Box>
                  <Typography variant="body2" fontFamily="monospace">
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
                        textTransform: 'none',
                      }}
                    >
                      {sampler.url_pattern}
                    </Typography>
                  )}
                </Box>
              </TableCell>
              <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                {formatNumber(sampler.avg_response_time)}
              </TableCell>
              <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                {formatNumber(sampler.p95_response_time)}
              </TableCell>
              <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                {formatNumber(sampler.p99_response_time)}
              </TableCell>
              <TableCell align="right" sx={{
                fontFamily: 'monospace',
                color: 'success.main',
                fontWeight: 600
              }}>
                {sampler.passed_count}
              </TableCell>
              <TableCell
                align="right"
                onClick={(e) => {
                  if (sampler.failed_count > 0) {
                    e.stopPropagation();
                    onOpenSamplerErrors(transactionName, sampler.sampler_name);
                  }
                }}
                sx={{
                  fontFamily: 'monospace',
                  color: sampler.failed_count > 0 ? 'error.main' : 'text.secondary',
                  fontWeight: sampler.failed_count > 0 ? 600 : 400,
                  cursor: sampler.failed_count > 0 ? 'pointer' : 'default',
                  '&:hover': sampler.failed_count > 0 ? {
                    textDecoration: 'underline',
                    backgroundColor: 'rgba(244, 67, 54, 0.08)',
                  } : {}
                }}
              >
                {sampler.failed_count}
              </TableCell>
              <TableCell align="right">
                <Tooltip
                  title={
                    <Box sx={{ p: 0.5 }}>
                      <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, mb: 0.5 }}>
                        Apdex Score: {formatApdex(sampler.apdex_score)}
                      </Typography>
                      <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem' }}>
                        Rating: {getApdexLabel(sampler.apdex_score)}
                      </Typography>
                      <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem', mt: 0.5 }}>
                        Threshold: {sampler.active_threshold}ms
                      </Typography>
                      <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem' }}>
                        {sampler.total_count.toLocaleString()} total requests
                      </Typography>
                    </Box>
                  }
                  arrow
                  placement="top"
                >
                  <Box
                    component="span"
                    sx={{
                      fontWeight: 700,
                      color: getApdexColor(sampler.apdex_score),
                      display: 'inline-block',
                      px: 1.5,
                      py: 0.5,
                      borderRadius: 1,
                      backgroundColor: `${getApdexColor(sampler.apdex_score)}15`,
                      cursor: 'help',
                      fontSize: '0.875rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}
                  >
                    {getApdexLabel(sampler.apdex_score)}
                  </Box>
                </Tooltip>
              </TableCell>
              <TableCell align="center">
                <Tooltip title="Actions" arrow>
                  <IconButton
                    size="small"
                    onClick={(e) => onOpenSamplerActionMenu(e, transactionName, sampler)}
                    sx={{
                      color: 'secondary.main',
                      '&:hover': {
                        backgroundColor: 'rgba(156, 39, 176, 0.08)',
                      }
                    }}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
