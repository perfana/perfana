'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
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
  ThemeProvider,
  createTheme,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
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
  DrillDownFilters,
} from '../types/performance-analysis.types';
import { calculateScenarioMetrics } from '../utils/performance-formatters';

// Sub-components
import { TransactionsTableHeader } from './TransactionsTableHeader';
import { ScenarioMetricsRow } from './ScenarioMetricsRow';
import { TransactionRow } from './TransactionRow';
import { scenarioFilterKey } from '../utils/scenario-filter';

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

  /** Drill-down target: seeds that scenario's transaction filter with the transaction name. */
  initialTransactionFilters?: DrillDownFilters;
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
  initialTransactionFilters,
}: TransactionsTableProps) {
  // 8px instead of MUI's 16px per side. Across eleven columns that is 176px of the width
  // this table needs back. A styleOverride is ordered below `sx`, so a cell that states its
  // own padding still wins — unlike the descendant selector this replaced.
  const tightCellPadding = useMemo(
    () => (outer: Theme) =>
      createTheme(outer, {
        components: {
          MuiTableCell: { styleOverrides: { root: { paddingLeft: 8, paddingRight: 8 } } },
        },
      }),
    [],
  );

  const [transactionFilters, setTransactionFilters] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!initialTransactionFilters?.transaction) return;
    const key = scenarioFilterKey(initialTransactionFilters.scenario);
    setTransactionFilters(prev => ({ ...prev, [key]: initialTransactionFilters.transaction! }));
  }, [initialTransactionFilters]);

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
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2
      }}>
        {/* No `minWidth`. 800px sat BELOW this table's real min-content width once a scenario
            is expanded, so it never prevented a scrollbar — it only stopped the collapsed
            table from shrinking. The width is won back by the wrapped header labels plus the
            halved cell padding below; the measurements live in apps/web/CLAUDE.md, "The
            Scenarios table earns its width back from the header labels".

            The padding is applied as a THEME DEFAULT rather than `sx={{ '& .MuiTableCell-root': … }}`.
            That descendant selector compiles to two class names (0,2,0) and so outranks every
            per-cell `sx` (0,1,0) beneath it — it silently defeated the filter row's `px: 2` and
            the nested request table's `pr: 2`. A styleOverride is ordered BELOW sx, so the 8px
            is a default each cell can still override, and it still reaches SamplerTable, which
            needs it to fit. */}
        <ThemeProvider theme={tightCellPadding}>
        <Table>
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
                        backgroundColor: 'action.hover',
                      }
                    }}
                  >
                    {/* Theme tokens, not hardcoded rgba: a black-alpha fill is invisible on a
                        dark surface and `primary.dark` is mode-blind — it resolves to the same
                        hex in both themes and fades into a dark background. Same class swept
                        across the SLO and anomaly tables in v0.2.96.14. */}
                    <TableCell colSpan={11} sx={{
                      backgroundColor: 'action.selected',
                      fontWeight: 700,
                      fontSize: '0.9rem',
                      py: 1.5,
                      color: 'readable.primary',
                      borderTop: '2px solid',
                      borderBottom: '1px solid',
                      borderTopColor: 'primary.main',
                      borderBottomColor: 'divider',
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
                        <TableCell colSpan={11} sx={{ py: 1, px: 2, border: 'none', backgroundColor: 'action.hover' }}>
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
        </ThemeProvider>
      </TableContainer>
    </>
  );
}
