'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Tooltip,
  Collapse,
} from '@mui/material';
import {
  Error as ErrorIcon,
  FilterList as FilterListIcon,
  InfoOutlined as InfoIcon,
  KeyboardArrowDown,
  KeyboardArrowUp,
  VpnKeyOutlined as SessionVariablesIcon,
} from '@mui/icons-material';
import FancyChip from '../../../shared/FancyChip';
import { ErrorByTransaction, ErrorByTransactionGroup } from '../types';
import { groupErrorsByTransactionSampler } from '../utils/error-formatters';
import { ClippedUrl } from '@/components/ui/clipped-url';

interface ErrorsTableProps {
  errorsByTransaction: ErrorByTransaction[];
  onViewDetails: (transaction: ErrorByTransaction) => void;
}

function GroupRow({
  group,
  onViewDetails,
}: {
  group: ErrorByTransactionGroup;
  onViewDetails: (transaction: ErrorByTransaction) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Parent row */}
      <TableRow
        hover
        sx={{
          cursor: 'pointer',
          '& > *': { borderBottom: open ? 'none' : undefined },
        }}
        onClick={() => setOpen(!open)}
      >
        <TableCell sx={{ width: 40, px: 1 }}>
          <IconButton size="small" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
            {open ? <KeyboardArrowUp /> : <KeyboardArrowDown />}
          </IconButton>
        </TableCell>
        <TableCell sx={{ fontWeight: 600 }}>{group.transactionName}</TableCell>
        <TableCell>
          <FancyChip label={group.samplerName} colorTheme="blue" />
        </TableCell>
        <TableCell align="right">
          <Typography
            variant="body2"
            sx={{ fontWeight: 700, color: 'error.main', fontFamily: 'monospace' }}
          >
            {group.totalErrorCount}
          </Typography>
        </TableCell>
        <TableCell>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {group.responseCodes.map((code) => (
              <FancyChip key={code} label={code} colorTheme="red" />
            ))}
          </Box>
        </TableCell>
        <TableCell align="right">
          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
            {Math.round(group.avgResponseTime)}
          </Typography>
        </TableCell>
      </TableRow>

      {/* Expanded child rows */}
      <TableRow>
        <TableCell colSpan={6} sx={{ py: 0, px: 0, border: 'none' }}>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box sx={{ mx: 2, mb: 2, mt: 0 }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ backgroundColor: 'action.hover' }}>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary' }}>
                      Response Code
                    </TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary' }}>
                      URL
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary' }}>
                      Error Count
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary' }}>
                      Avg Response Time (ms)
                    </TableCell>
                    <TableCell align="center" sx={{ fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary' }}>
                      Actions
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {group.children.map((child, idx) => (
                    <TableRow key={idx} hover>
                      <TableCell>
                        <FancyChip label={child.responseCode || 'N/A'} colorTheme="red" />
                      </TableCell>
                      <TableCell sx={{ maxWidth: 320 }}>
                        {child.url ? (
                          <ClippedUrl url={child.url} variant="body2" sx={{ fontSize: '0.75rem' }} />
                        ) : (
                          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'text.secondary' }}>
                            N/A
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <Typography
                          variant="body2"
                          sx={{ fontWeight: 700, color: 'error.main', fontFamily: 'monospace' }}
                        >
                          {child.errorCount}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                          {Math.round(child.avgResponseTime)}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                          {child.hasSessionVariables && (
                            <Tooltip title="Session variables captured" arrow>
                              <SessionVariablesIcon
                                fontSize="small"
                                sx={{ color: 'text.secondary' }}
                              />
                            </Tooltip>
                          )}
                          <Tooltip title="View Error Details" arrow>
                            <IconButton
                              size="small"
                              onClick={() => onViewDetails(child)}
                              sx={{
                                color: 'primary.main',
                                '&:hover': { backgroundColor: 'action.hover' },
                              }}
                            >
                              <InfoIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

export function ErrorsTable({ errorsByTransaction, onViewDetails }: ErrorsTableProps) {
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());

  // All unique response codes across the dataset (sorted)
  const allCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const row of errorsByTransaction) {
      if (row.responseCode) codes.add(row.responseCode);
    }
    return Array.from(codes).sort();
  }, [errorsByTransaction]);

  const toggleCode = useCallback((code: string) => {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  }, []);

  const clearFilter = useCallback(() => setSelectedCodes(new Set()), []);

  // Filter rows first, then group
  const groups = useMemo(() => {
    const filtered =
      selectedCodes.size === 0
        ? errorsByTransaction
        : errorsByTransaction.filter((r) => r.responseCode && selectedCodes.has(r.responseCode));
    return groupErrorsByTransactionSampler(filtered);
  }, [errorsByTransaction, selectedCodes]);

  const hasFilter = selectedCodes.size > 0;

  return (
    <Paper
      sx={{
        borderRadius: 3,
        backgroundColor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        overflow: 'hidden',
      }}
    >
      <Box sx={{ p: 3, pb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <ErrorIcon sx={{ mr: 1.5, color: 'error.main', fontSize: 28 }} />
            <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary' }}>
              Error Details
            </Typography>
          </Box>
          {hasFilter && (
            <Typography
              variant="body2"
              sx={{ color: 'text.secondary', cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
              onClick={clearFilter}
            >
              Clear filter
            </Typography>
          )}
        </Box>

        {/* Status code filter chips */}
        {allCodes.length > 1 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
            <FilterListIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
            <Typography variant="caption" sx={{ color: 'text.secondary', mr: 0.5 }}>
              Status:
            </Typography>
            {allCodes.map((code) => {
              const active = selectedCodes.has(code);
              return (
                <FancyChip
                  key={code}
                  label={code}
                  colorTheme="red"
                  onClick={() => toggleCode(code)}
                  sx={{
                    cursor: 'pointer',
                    opacity: hasFilter && !active ? 0.4 : 1,
                    outline: active ? '2px solid' : 'none',
                    outlineColor: 'error.main',
                    outlineOffset: '1px',
                  }}
                />
              );
            })}
          </Box>
        )}
      </Box>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ backgroundColor: 'action.hover' }}>
              <TableCell sx={{ width: 40, px: 1 }} />
              <TableCell sx={{ fontWeight: 700, color: 'primary.main' }}>Transaction</TableCell>
              <TableCell sx={{ fontWeight: 700, color: 'primary.main' }}>Sampler</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, color: 'primary.main' }}>
                Error Count
              </TableCell>
              <TableCell sx={{ fontWeight: 700, color: 'primary.main' }}>Response Codes</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, color: 'primary.main' }}>
                Avg Response Time (ms)
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {groups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                  <Typography variant="body2" color="text.secondary">
                    No errors match the selected filter.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              groups.map((group) => (
                <GroupRow
                  key={`${group.transactionName}\0${group.samplerName}`}
                  group={group}
                  onViewDetails={onViewDetails}
                />
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

export default ErrorsTable;
