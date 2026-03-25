'use client';

import { Fragment, useState } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Paper,
  TextField,
  InputAdornment,
} from '@mui/material';
import {
  KeyboardArrowDown,
  KeyboardArrowUp,
  FilterList,
  Clear,
} from '@mui/icons-material';
import {
  TransactionStat,
  SamplerStat,
  VirtualUserStats,
  ThroughputStats,
  SortField,
  SortOrder,
} from '../types/performance-analysis.types';
import { calculateScenarioMetrics } from '../utils/performance-formatters';

// Sub-components
import { TransactionsTableHeader } from './TransactionsTableHeader';
import { ScenarioMetricsRow } from './ScenarioMetricsRow';
import { TransactionRow } from './TransactionRow';

export interface TransactionsTableProps {
  // Data
  scenarioGroups: [string, TransactionStat[]][];
  transactions: TransactionStat[];
  throughputStats: ThroughputStats | null;
  virtualUserStats: VirtualUserStats | null;

  // Sorting
  sortField: SortField;
  sortOrder: SortOrder;
  onSort: (field: SortField) => void;

  // Expandable rows
  expandedRows: Set<string>;
  rowSamples: Record<string, SamplerStat[]>;
  loadingSamples: Record<string, boolean>;
  samplesError: Record<string, string>;
  onRowClick: (transactionName: string) => void;

  // Scenario expansion
  expandedScenarios: Set<string>;
  onToggleScenario: (scenarioName: string) => void;

  // Actions
  onOpenActionMenu: (event: React.MouseEvent<HTMLElement>, transactionName: string) => void;
  onOpenTransactionErrors: (transactionName: string) => void;
  onOpenSamplerActionMenu: (event: React.MouseEvent<HTMLElement>, transaction: string, sampler: SamplerStat) => void;
  onOpenSamplerErrors: (transactionName: string, samplerName: string) => void;
}

export function TransactionsTable({
  scenarioGroups,
  throughputStats,
  virtualUserStats,
  sortField,
  sortOrder,
  onSort,
  expandedRows,
  rowSamples,
  loadingSamples,
  samplesError,
  onRowClick,
  expandedScenarios,
  onToggleScenario,
  onOpenActionMenu,
  onOpenTransactionErrors,
  onOpenSamplerActionMenu,
  onOpenSamplerErrors,
}: TransactionsTableProps) {
  const [transactionFilters, setTransactionFilters] = useState<Record<string, string>>({});

  return (
    <>
      {/* Scenarios section header */}
      <Box sx={{ mb: 3, mt: 2 }}>
        <Typography
          variant="subtitle2"
          sx={{
            fontWeight: 700,
            fontSize: '0.9rem',
            color: 'text.secondary',
            mb: 2,
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}
        >
          Scenarios
        </Typography>
      </Box>

      <TableContainer component={Paper} elevation={0} sx={{
        border: '1px solid rgba(0, 0, 0, 0.08)',
        borderRadius: 2
      }}>
        <Table sx={{ minWidth: 800 }}>
          <TableBody>
            {scenarioGroups.map(([scenarioName, scenarioTransactions], index) => {
              const scenarioMetrics = calculateScenarioMetrics(scenarioTransactions);
              const isScenarioExpanded = expandedScenarios.has(scenarioName);

              return (
                <Fragment key={scenarioName}>
                  {/* Spacer row between scenario blocks */}
                  {index > 0 && (
                    <TableRow>
                      <TableCell colSpan={11} sx={{ py: 2, border: 'none' }} />
                    </TableRow>
                  )}

                  {/* Scenario header row - Clickable */}
                  <TableRow
                    onClick={() => onToggleScenario(scenarioName)}
                    sx={{
                      cursor: 'pointer',
                      '&:hover': {
                        backgroundColor: 'rgba(25, 118, 210, 0.12)',
                      }
                    }}
                  >
                    <TableCell colSpan={11} sx={{
                      backgroundColor: 'rgba(25, 118, 210, 0.06)',
                      fontWeight: 700,
                      fontSize: '0.9rem',
                      py: 1.5,
                      color: 'primary.dark',
                      borderTop: '2px solid rgba(25, 118, 210, 0.2)',
                      borderBottom: '1px solid rgba(25, 118, 210, 0.1)'
                    }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <IconButton size="small" sx={{ p: 0 }}>
                          {isScenarioExpanded ? <KeyboardArrowUp /> : <KeyboardArrowDown />}
                        </IconButton>
                        <Typography variant="inherit">
                          {scenarioName}
                        </Typography>
                      </Box>
                    </TableCell>
                  </TableRow>

                  {/* Scenario-level aggregated metrics row */}
                  <ScenarioMetricsRow
                    scenarioName={scenarioName}
                    metrics={scenarioMetrics}
                    throughputStats={throughputStats}
                    virtualUserStats={virtualUserStats}
                    onToggleScenario={onToggleScenario}
                  />

                  {/* Transaction rows for this scenario - Only show when expanded */}
                  {isScenarioExpanded && (
                    <>
                      {/* Transaction filter */}
                      <TableRow>
                        <TableCell colSpan={11} sx={{ py: 1, px: 2, border: 'none', backgroundColor: 'rgba(0, 0, 0, 0.02)' }}>
                          <TextField
                            size="small"
                            placeholder="Filter transactions..."
                            value={transactionFilters[scenarioName] || ''}
                            onChange={(e) => setTransactionFilters(prev => ({ ...prev, [scenarioName]: e.target.value }))}
                            onClick={(e) => e.stopPropagation()}
                            InputProps={{
                              startAdornment: (
                                <InputAdornment position="start">
                                  <FilterList sx={{ fontSize: 18, color: 'text.secondary' }} />
                                </InputAdornment>
                              ),
                              endAdornment: transactionFilters[scenarioName] ? (
                                <InputAdornment position="end">
                                  <IconButton
                                    size="small"
                                    onClick={() => setTransactionFilters(prev => ({ ...prev, [scenarioName]: '' }))}
                                  >
                                    <Clear sx={{ fontSize: 16 }} />
                                  </IconButton>
                                </InputAdornment>
                              ) : null,
                            }}
                            sx={{ width: 300, backgroundColor: 'background.paper', borderRadius: 1 }}
                          />
                        </TableCell>
                      </TableRow>

                      {/* Table header row */}
                      <TransactionsTableHeader
                        sortField={sortField}
                        sortOrder={sortOrder}
                        onSort={onSort}
                      />

                      {/* Transaction data rows */}
                      {scenarioTransactions
                        .filter(t => {
                          const filter = transactionFilters[scenarioName]?.toLowerCase();
                          return !filter || t.transaction_name.toLowerCase().includes(filter);
                        })
                        .map((transaction, txIndex) => (
                          <TransactionRow
                            key={`${transaction.transaction_name}-${txIndex}`}
                            transaction={transaction}
                            index={txIndex}
                            isExpanded={expandedRows.has(transaction.transaction_name)}
                            samples={rowSamples[transaction.transaction_name] || []}
                            isLoading={loadingSamples[transaction.transaction_name] || false}
                            error={samplesError[transaction.transaction_name]}
                            onRowClick={onRowClick}
                            onOpenActionMenu={onOpenActionMenu}
                            onOpenTransactionErrors={onOpenTransactionErrors}
                            onOpenSamplerActionMenu={onOpenSamplerActionMenu}
                            onOpenSamplerErrors={onOpenSamplerErrors}
                          />
                        ))}
                    </>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}
