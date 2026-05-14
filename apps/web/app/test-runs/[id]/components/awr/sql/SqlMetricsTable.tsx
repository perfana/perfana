'use client';

/**
 * SQL Metrics Table Component
 *
 * Displays a sortable table of SQL statements with their metrics. Supports
 * column sorting, row selection, and customizable display options.
 *
 * Features:
 * - Sortable columns for all metric fields
 * - Clickable rows for SQL selection
 * - Rank column with visual indicators for top statements
 * - DB Time percentage with color-coded highlighting
 * - Responsive design with horizontal scrolling
 * - Loading skeleton state
 *
 * @example
 * ```tsx
 * <SqlMetricsTable
 *   statements={sqlStatements}
 *   sortBy="elapsedTime"
 *   sortDirection="desc"
 *   onSortChange={(field) => handleSort(field)}
 *   onRowClick={(sqlId) => selectSql(sqlId)}
 * />
 * ```
 */

import { useCallback } from 'react';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Typography,
  Skeleton,
  Paper,
  Tooltip,
  alpha,
} from '@mui/material';
import {
  Code as SqlIcon,
  ArrowUpward as _AscIcon,
  ArrowDownward as _DescIcon,
} from '@mui/icons-material';
import type {
  SqlMetricsTableProps,
  SqlSortField,
  SortDirection,
  SqlStatementDisplay,
} from '../types';
import {
  formatDuration,
  formatNumber,
  formatCompactNumber,
  formatPercentage,
  formatSqlId,
  formatSqlPreview,
} from '../utils/formatters';

// ==================== Column Configuration ====================

interface ColumnConfig {
  id: SqlSortField | 'sqlId' | 'sqlText' | 'rank';
  label: string;
  minWidth: number;
  align: 'left' | 'right' | 'center';
  sortable: boolean;
  format?: (value: unknown, row: SqlStatementDisplay) => string;
  tooltip?: string;
}

const COLUMNS: ColumnConfig[] = [
  {
    id: 'rank',
    label: '#',
    minWidth: 40,
    align: 'center',
    sortable: false,
    tooltip: 'Rank by selected sort metric',
  },
  {
    id: 'sqlId',
    label: 'SQL ID',
    minWidth: 120,
    align: 'left',
    sortable: false,
    format: (value) => formatSqlId(value as string | undefined),
    tooltip: 'SQL statement identifier',
  },
  {
    id: 'elapsedTime',
    label: 'Elapsed',
    minWidth: 90,
    align: 'right',
    sortable: true,
    format: (value) => formatDuration(value as number | undefined, 2),
    tooltip: 'Total elapsed time',
  },
  {
    id: 'cpuTime',
    label: 'CPU',
    minWidth: 80,
    align: 'right',
    sortable: true,
    format: (value) => formatDuration(value as number | undefined, 2),
    tooltip: 'Total CPU time',
  },
  {
    id: 'bufferGets',
    label: 'Buffer Gets',
    minWidth: 100,
    align: 'right',
    sortable: true,
    format: (value) => formatCompactNumber(value as number | undefined, 1),
    tooltip: 'Total logical reads',
  },
  {
    id: 'diskReads',
    label: 'Disk Reads',
    minWidth: 100,
    align: 'right',
    sortable: true,
    format: (value) => formatCompactNumber(value as number | undefined, 1),
    tooltip: 'Total physical reads',
  },
  {
    id: 'executions',
    label: 'Executions',
    minWidth: 90,
    align: 'right',
    sortable: true,
    format: (value) => formatNumber(value as number | undefined, 0),
    tooltip: 'Number of executions',
  },
  {
    id: 'elapsedTimePerExec',
    label: 'Time/Exec',
    minWidth: 90,
    align: 'right',
    sortable: true,
    format: (value) => formatDuration(value as number | undefined, 3),
    tooltip: 'Elapsed time per execution',
  },
  {
    id: 'percentDbTime',
    label: '% DB Time',
    minWidth: 90,
    align: 'right',
    sortable: true,
    format: (value) => formatPercentage(value as number | undefined, 1),
    tooltip: 'Percentage of total database time',
  },
  {
    id: 'sqlText',
    label: 'SQL Text',
    minWidth: 400,
    align: 'left',
    sortable: false,
    format: (value) => formatSqlPreview(value as string | undefined, 150),
    tooltip: 'SQL statement text preview',
  },
];

// ==================== Loading Skeleton ====================

function TableSkeleton({ rowCount = 5 }: { rowCount?: number }): JSX.Element {
  return (
    <>
      {Array.from({ length: rowCount }).map((_, index) => (
        <TableRow key={index}>
          {COLUMNS.map((column) => (
            <TableCell key={column.id} align={column.align}>
              <Skeleton variant="text" width={column.minWidth * 0.7} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

// ==================== Empty State ====================

function EmptyState(): JSX.Element {
  return (
    <TableRow>
      <TableCell colSpan={COLUMNS.length} align="center" sx={{ py: 6 }}>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1,
            color: 'text.secondary',
          }}
        >
          <SqlIcon sx={{ fontSize: 48, opacity: 0.3 }} />
          <Typography variant="body1">No SQL statements found</Typography>
          <Typography variant="caption">
            Upload an AWR report to see top SQL statements
          </Typography>
        </Box>
      </TableCell>
    </TableRow>
  );
}

// ==================== Main Component ====================

/**
 * SQL Metrics Table Component
 *
 * Displays SQL statements in a sortable table format.
 */
export function SqlMetricsTable({
  statements,
  sortBy,
  sortDirection,
  onSortChange,
  onRowClick,
  showRank = true,
  maxRows,
  loading = false,
}: SqlMetricsTableProps): JSX.Element {
  /**
   * Handle sort click
   */
  const handleSortClick = useCallback(
    (field: SqlSortField): void => {
      if (onSortChange) {
        onSortChange(field);
      }
    },
    [onSortChange],
  );

  /**
   * Handle row click
   */
  const handleRowClick = useCallback(
    (sqlId: string): void => {
      if (onRowClick) {
        onRowClick(sqlId);
      }
    },
    [onRowClick],
  );

  // Filter columns based on showRank
  const visibleColumns = showRank
    ? COLUMNS
    : COLUMNS.filter((col) => col.id !== 'rank');

  // Limit rows if maxRows is specified
  const displayedStatements = maxRows
    ? statements.slice(0, maxRows)
    : statements;

  return (
    <TableContainer
      component={Paper}
      variant="outlined"
      sx={{
        maxHeight: 600,
        '& .MuiTable-root': {
          minWidth: 800,
        },
      }}
    >
      <Table stickyHeader size="small" aria-label="SQL statements table">
        {/* Table Header */}
        <TableHead>
          <TableRow>
            {visibleColumns.map((column) => (
              <TableCell
                key={column.id}
                align={column.align}
                style={{ minWidth: column.minWidth }}
                sx={{
                  fontWeight: 600,
                  backgroundColor: 'action.hover',
                  borderBottom: 2,
                  borderColor: 'divider',
                }}
              >
                {column.sortable && column.id !== 'rank' && column.id !== 'sqlId' && column.id !== 'sqlText' ? (
                  <Tooltip title={column.tooltip || ''}>
                    <TableSortLabel
                      active={sortBy === column.id}
                      direction={sortBy === column.id ? sortDirection : 'desc'}
                      onClick={() => handleSortClick(column.id as SqlSortField)}
                      sx={{
                        '& .MuiTableSortLabel-icon': {
                          opacity: sortBy === column.id ? 1 : 0.3,
                        },
                      }}
                    >
                      {column.label}
                    </TableSortLabel>
                  </Tooltip>
                ) : (
                  <Tooltip title={column.tooltip || ''}>
                    <span>{column.label}</span>
                  </Tooltip>
                )}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>

        {/* Table Body */}
        <TableBody>
          {loading ? (
            <TableSkeleton rowCount={5} />
          ) : displayedStatements.length === 0 ? (
            <EmptyState />
          ) : (
            displayedStatements.map((statement, index) => {
              const rank = index + 1;
              const isHighDbTime = (statement.percentDbTime ?? 0) >= 10;
              const isTopStatement = rank <= 3;

              return (
                <TableRow
                  key={statement.sqlId || index}
                  hover
                  onClick={() => statement.sqlId && handleRowClick(statement.sqlId)}
                  sx={{
                    cursor: onRowClick ? 'pointer' : 'default',
                    backgroundColor: isHighDbTime
                      ? alpha('#ff9800', 0.04)
                      : 'transparent',
                    '&:hover': {
                      backgroundColor: isHighDbTime
                        ? alpha('#ff9800', 0.08)
                        : undefined,
                    },
                  }}
                  role="row"
                  aria-label={`SQL statement ${statement.sqlId || rank}`}
                >
                  {visibleColumns.map((column) => {
                    // Rank column
                    if (column.id === 'rank') {
                      return (
                        <TableCell
                          key={column.id}
                          align={column.align}
                          sx={{ py: 1 }}
                        >
                          <Box
                            sx={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 24,
                              height: 24,
                              borderRadius: '50%',
                              backgroundColor: isTopStatement
                                ? alpha('#f44336', 0.1)
                                : alpha('#9e9e9e', 0.1),
                              color: isTopStatement ? '#f44336' : 'text.secondary',
                              fontWeight: 700,
                              fontSize: '0.75rem',
                            }}
                          >
                            {rank}
                          </Box>
                        </TableCell>
                      );
                    }

                    // SQL ID column
                    if (column.id === 'sqlId') {
                      return (
                        <TableCell key={column.id} align={column.align}>
                          <Box
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 0.5,
                            }}
                          >
                            <SqlIcon
                              sx={{
                                fontSize: 14,
                                color: 'primary.main',
                                opacity: 0.7,
                              }}
                            />
                            <Typography
                              variant="body2"
                              sx={{
                                fontFamily: 'monospace',
                                fontWeight: 500,
                                color: 'primary.main',
                                fontSize: '0.8rem',
                              }}
                            >
                              {formatSqlId(statement.sqlId)}
                            </Typography>
                          </Box>
                        </TableCell>
                      );
                    }

                    // DB Time percentage column (with highlighting)
                    if (column.id === 'percentDbTime') {
                      return (
                        <TableCell key={column.id} align={column.align}>
                          <Typography
                            variant="body2"
                            sx={{
                              fontFamily: 'monospace',
                              fontWeight: isHighDbTime ? 600 : 400,
                              color: isHighDbTime ? '#e65100' : 'text.primary',
                              fontSize: '0.8rem',
                            }}
                          >
                            {formatPercentage(statement.percentDbTime, 1)}
                          </Typography>
                        </TableCell>
                      );
                    }

                    // SQL Text column
                    if (column.id === 'sqlText') {
                      return (
                        <TableCell key={column.id} align={column.align}>
                          <Tooltip
                            title={statement.sqlText || 'SQL text not available'}
                            placement="top-start"
                            arrow
                          >
                            <Typography
                              variant="body2"
                              sx={{
                                fontFamily: 'monospace',
                                fontSize: '0.75rem',
                                color: 'text.secondary',
                                maxWidth: 300,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {formatSqlPreview(statement.sqlText, 60)}
                            </Typography>
                          </Tooltip>
                        </TableCell>
                      );
                    }

                    // Generic metric column
                    const value = statement[column.id as keyof SqlStatementDisplay];
                    const formattedValue = column.format
                      ? column.format(value, statement)
                      : String(value ?? 'N/A');

                    return (
                      <TableCell key={column.id} align={column.align}>
                        <Typography
                          variant="body2"
                          sx={{
                            fontFamily: 'monospace',
                            fontSize: '0.8rem',
                          }}
                        >
                          {formattedValue}
                        </Typography>
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      {/* Show count if truncated */}
      {maxRows && statements.length > maxRows && (
        <Box
          sx={{
            p: 1.5,
            textAlign: 'center',
            borderTop: 1,
            borderColor: 'divider',
            backgroundColor: alpha('#1976d2', 0.04),
          }}
        >
          <Typography variant="caption" color="text.secondary">
            Showing {maxRows} of {statements.length} SQL statements
          </Typography>
        </Box>
      )}
    </TableContainer>
  );
}

// Default export
export default SqlMetricsTable;
