'use client';

import { Fragment } from 'react';
import {
  Box,
  Typography,
  IconButton,
  TableCell,
  TableRow,
  Tooltip,
  Collapse,
  CircularProgress,
  Alert,
} from '@mui/material';
import {
  KeyboardArrowDown,
  KeyboardArrowUp,
  MoreVert as MoreVertIcon,
} from '@mui/icons-material';
import { TransactionStat, SamplerStat } from '../types/performance-analysis.types';
import { formatNumber, formatApdex, getApdexColor, getApdexLabel } from '../utils/performance-formatters';
import { SamplerTable } from './SamplerTable';

export interface TransactionRowProps {
  transaction: TransactionStat;
  index: number;
  isExpanded: boolean;
  samples: SamplerStat[];
  isLoading: boolean;
  error: string | undefined;
  onRowClick: (transactionName: string) => void;
  onOpenActionMenu: (event: React.MouseEvent<HTMLElement>, transactionName: string) => void;
  onOpenTransactionErrors: (transactionName: string) => void;
  onOpenSamplerActionMenu: (event: React.MouseEvent<HTMLElement>, transaction: string, sampler: SamplerStat) => void;
  onOpenSamplerErrors: (transactionName: string, samplerName: string) => void;
}

export function TransactionRow({
  transaction,
  index,
  isExpanded,
  samples,
  isLoading,
  error,
  onRowClick,
  onOpenActionMenu,
  onOpenTransactionErrors,
  onOpenSamplerActionMenu,
  onOpenSamplerErrors,
}: TransactionRowProps) {
  const errorRate = transaction.total_count > 0
    ? (transaction.failed_count / transaction.total_count) * 100
    : 0;

  return (
    <Fragment key={`${transaction.transaction_name}-${index}`}>
      <TableRow
        sx={{
          cursor: 'pointer',
          '&:nth-of-type(odd)': {
            backgroundColor: 'rgba(0, 0, 0, 0.02)',
          },
          '&:hover': {
            backgroundColor: 'rgba(25, 118, 210, 0.08)',
          },
        }}
        onClick={() => onRowClick(transaction.transaction_name)}
      >
        <TableCell>
          <IconButton size="small">
            {isExpanded ? <KeyboardArrowUp /> : <KeyboardArrowDown />}
          </IconButton>
        </TableCell>
        <TableCell
          component="th"
          scope="row"
          sx={{ fontWeight: 500 }}
        >
          {transaction.transaction_name}
        </TableCell>
        <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
          {formatNumber(transaction.avg_response_time)}
        </TableCell>
        <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
          {formatNumber(transaction.p95_response_time)}
        </TableCell>
        <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
          {formatNumber(transaction.p99_response_time)}
        </TableCell>
        <TableCell align="right" sx={{
          fontFamily: 'monospace',
          color: 'success.main',
          fontWeight: 600
        }}>
          {transaction.passed_count}
        </TableCell>
        <TableCell
          align="right"
          onClick={(e) => {
            if (transaction.failed_count > 0) {
              e.stopPropagation();
              onOpenTransactionErrors(transaction.transaction_name);
            }
          }}
          sx={{
            fontFamily: 'monospace',
            color: transaction.failed_count > 0 ? 'error.main' : 'text.secondary',
            fontWeight: transaction.failed_count > 0 ? 600 : 400,
            cursor: transaction.failed_count > 0 ? 'pointer' : 'default',
            '&:hover': transaction.failed_count > 0 ? {
              textDecoration: 'underline',
              backgroundColor: 'rgba(244, 67, 54, 0.08)',
            } : {}
          }}
        >
          {transaction.failed_count}
        </TableCell>
        <TableCell align="right" sx={{
          fontFamily: 'monospace',
          fontWeight: 600,
          color: errorRate > 5 ? 'error.main' : errorRate > 1 ? 'warning.main' : 'success.main'
        }}>
          {errorRate.toFixed(2)}%
        </TableCell>
        <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
          {transaction.active_threshold}ms
        </TableCell>
        <TableCell align="right">
          <Tooltip
            title={
              <Box sx={{ p: 0.5 }}>
                <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, mb: 0.5 }}>
                  Apdex Score: {formatApdex(transaction.apdex_score)}
                </Typography>
                <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem' }}>
                  Rating: {getApdexLabel(transaction.apdex_score)}
                </Typography>
                <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem', mt: 0.5 }}>
                  Threshold: {transaction.active_threshold}ms
                </Typography>
                <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem' }}>
                  {transaction.total_count.toLocaleString()} total requests
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
                color: getApdexColor(transaction.apdex_score),
                display: 'inline-block',
                px: 1.5,
                py: 0.5,
                borderRadius: 1,
                backgroundColor: `${getApdexColor(transaction.apdex_score)}15`,
                cursor: 'help',
                fontSize: '0.875rem',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}
            >
              {getApdexLabel(transaction.apdex_score)}
            </Box>
          </Tooltip>
        </TableCell>
        <TableCell align="center">
          <Tooltip title="Actions" arrow>
            <IconButton
              size="small"
              onClick={(e) => onOpenActionMenu(e, transaction.transaction_name)}
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

      {/* Expandable sub-row */}
      <TableRow>
        <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={11}>
          <Collapse in={isExpanded} timeout="auto" unmountOnExit>
            <Box sx={{ margin: 2, backgroundColor: 'rgba(0, 0, 0, 0.02)', borderRadius: 2, p: 2 }}>
              {isLoading && (
                <Box display="flex" justifyContent="center" alignItems="center" py={3}>
                  <CircularProgress size={24} sx={{ mr: 2 }} />
                  <Typography variant="body2" color="text.secondary">
                    Loading request statistics...
                  </Typography>
                </Box>
              )}

              {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {error}
                </Alert>
              )}

              {!isLoading && !error && samples.length === 0 && (
                <Alert severity="info">
                  No requests found for this transaction.
                </Alert>
              )}

              {!isLoading && !error && samples.length > 0 && (
                <SamplerTable
                  samples={samples}
                  transactionName={transaction.transaction_name}
                  onOpenSamplerActionMenu={onOpenSamplerActionMenu}
                  onOpenSamplerErrors={onOpenSamplerErrors}
                />
              )}
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </Fragment>
  );
}
