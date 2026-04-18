'use client';

/**
 * TopSqlTab Component
 *
 * Displays the top SQL statements from an AWR report with metrics,
 * sorting, filtering, and expandable SQL text viewing.
 *
 * @example
 * ```tsx
 * <TopSqlTab
 *   reportId="report-uuid"
 *   testRunId="test-run-uuid"
 *   maxStatements={20}
 *   onSnackbar={(msg, sev) => showSnackbar(msg, sev)}
 * />
 * ```
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Tabs,
  Tab,
  TextField,
  InputAdornment,
  Skeleton,
  useTheme,
  alpha,
  Tooltip,
  IconButton,
  Badge,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from '@mui/material';
import {
  Search as SearchIcon,
  Info as InfoIcon,
  FilterList as FilterListIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { getAwrReport } from '@/lib/api/awr-reports';
import type {
  TopSqlTabProps,
  SqlStatementDisplay,
  SqlSortField,
  SortDirection,
  SnackbarSeverity,
} from '../types';
import { SqlMetricsTable, SqlTextViewer } from '../sql';
import { formatSqlId } from '../utils';

// ==================== Constants ====================

const DEFAULT_MAX_STATEMENTS = 25;
const DEFAULT_SORT_FIELD: SqlSortField = 'elapsedTime';

const SORT_TABS: { value: SqlSortField; label: string }[] = [
  { value: 'elapsedTime', label: 'Elapsed Time' },
  { value: 'cpuTime', label: 'CPU Time' },
  { value: 'bufferGets', label: 'Buffer Gets' },
  { value: 'diskReads', label: 'Disk Reads' },
  { value: 'executions', label: 'Executions' },
];

// ==================== Helper Functions ====================

/**
 * Extract SQL statements from AWR report parsed data
 */
function extractSqlStatements(report: {
  parsedData?: {
    topSql?: {
      byElapsedTime?: Array<{
        sqlId: string;
        sqlText?: string;
        fullSqlText?: string;
        elapsedTime?: number;
        elapsedTimePerExec?: number;
        cpuTime?: number;
        cpuTimePerExec?: number;
        bufferGets?: number;
        bufferGetsPerExec?: number;
        diskReads?: number;
        diskReadsPerExec?: number;
        executions?: number;
        rowsProcessed?: number;
        percentDbTime?: number;
        module?: string;
        parsingSchemaName?: string;
        planHashValue?: number;
      }>;
      byCpuTime?: Array<{
        sqlId: string;
        [key: string]: unknown;
      }>;
      byBufferGets?: Array<{
        sqlId: string;
        [key: string]: unknown;
      }>;
      byDiskReads?: Array<{
        sqlId: string;
        [key: string]: unknown;
      }>;
      byExecutions?: Array<{
        sqlId: string;
        [key: string]: unknown;
      }>;
      sqlTextById?: Record<string, string>;
      sqlTexts?: Record<string, string>;
    };
  };
}): Map<string, SqlStatementDisplay> {
  const statementsMap = new Map<string, SqlStatementDisplay>();
  const sql = report.parsedData?.topSql;

  if (!sql) return statementsMap;

  // Helper to add/merge SQL statement
  const addStatement = (stmt: {
    sqlId: string;
    sqlText?: string;
    fullSqlText?: string;
    elapsedTime?: number;
    elapsedTimePerExec?: number;
    cpuTime?: number;
    cpuTimePerExec?: number;
    bufferGets?: number;
    bufferGetsPerExec?: number;
    diskReads?: number;
    diskReadsPerExec?: number;
    executions?: number;
    rowsProcessed?: number;
    percentDbTime?: number;
    module?: string;
    parsingSchemaName?: string;
    planHashValue?: number;
  }) => {
    const existing = statementsMap.get(stmt.sqlId);
    // Prefer fullSqlText over sqlText
    const sqlText = stmt.fullSqlText || stmt.sqlText;

    if (existing) {
      // Merge metrics
      statementsMap.set(stmt.sqlId, {
        ...existing,
        elapsedTime: stmt.elapsedTime ?? existing.elapsedTime,
        cpuTime: stmt.cpuTime ?? existing.cpuTime,
        bufferGets: stmt.bufferGets ?? existing.bufferGets,
        diskReads: stmt.diskReads ?? existing.diskReads,
        executions: stmt.executions ?? existing.executions,
        rowsProcessed: stmt.rowsProcessed ?? existing.rowsProcessed,
        percentDbTime: stmt.percentDbTime ?? existing.percentDbTime,
        sqlText: sqlText ?? existing.sqlText,
      });
    } else {
      statementsMap.set(stmt.sqlId, {
        sqlId: stmt.sqlId,
        sqlText: sqlText,
        elapsedTime: stmt.elapsedTime,
        elapsedTimePerExec: stmt.elapsedTimePerExec,
        cpuTime: stmt.cpuTime,
        cpuTimePerExec: stmt.cpuTimePerExec,
        bufferGets: stmt.bufferGets,
        bufferGetsPerExec: stmt.bufferGetsPerExec,
        diskReads: stmt.diskReads,
        diskReadsPerExec: stmt.diskReadsPerExec,
        executions: stmt.executions,
        rowsProcessed: stmt.rowsProcessed,
        percentDbTime: stmt.percentDbTime,
        module: stmt.module,
        parsingSchemaName: stmt.parsingSchemaName,
        planHashValue: stmt.planHashValue,
      });
    }
  };

  // Process all SQL lists
  sql.byElapsedTime?.forEach(addStatement);
  sql.byCpuTime?.forEach(addStatement as (stmt: { sqlId: string; [key: string]: unknown }) => void);
  sql.byBufferGets?.forEach(addStatement as (stmt: { sqlId: string; [key: string]: unknown }) => void);
  sql.byDiskReads?.forEach(addStatement as (stmt: { sqlId: string; [key: string]: unknown }) => void);
  sql.byExecutions?.forEach(addStatement as (stmt: { sqlId: string; [key: string]: unknown }) => void);

  // Enrich with SQL texts (try both field names)
  const sqlTexts = sql.sqlTextById ?? sql.sqlTexts;
  if (sqlTexts) {
    for (const [sqlId, text] of Object.entries(sqlTexts)) {
      const stmt = statementsMap.get(sqlId);
      if (stmt && !stmt.sqlText) {
        statementsMap.set(sqlId, { ...stmt, sqlText: text });
      }
    }
  }

  return statementsMap;
}

/**
 * Sort SQL statements by field
 */
function sortStatements(
  statements: SqlStatementDisplay[],
  sortBy: SqlSortField,
  direction: SortDirection
): SqlStatementDisplay[] {
  return [...statements].sort((a, b) => {
    let aVal: number;
    let bVal: number;

    switch (sortBy) {
      case 'elapsedTime':
        aVal = a.elapsedTime ?? 0;
        bVal = b.elapsedTime ?? 0;
        break;
      case 'cpuTime':
        aVal = a.cpuTime ?? 0;
        bVal = b.cpuTime ?? 0;
        break;
      case 'bufferGets':
        aVal = a.bufferGets ?? 0;
        bVal = b.bufferGets ?? 0;
        break;
      case 'diskReads':
        aVal = a.diskReads ?? 0;
        bVal = b.diskReads ?? 0;
        break;
      case 'executions':
        aVal = a.executions ?? 0;
        bVal = b.executions ?? 0;
        break;
      case 'percentDbTime':
        aVal = a.percentDbTime ?? 0;
        bVal = b.percentDbTime ?? 0;
        break;
      case 'elapsedTimePerExec':
        aVal = a.elapsedTimePerExec ?? 0;
        bVal = b.elapsedTimePerExec ?? 0;
        break;
      default:
        aVal = a.elapsedTime ?? 0;
        bVal = b.elapsedTime ?? 0;
    }

    return direction === 'desc' ? bVal - aVal : aVal - bVal;
  });
}

/**
 * Filter SQL statements by search text
 */
function filterStatements(
  statements: SqlStatementDisplay[],
  searchText: string
): SqlStatementDisplay[] {
  if (!searchText.trim()) return statements;

  const search = searchText.toLowerCase().trim();
  return statements.filter(
    (stmt) =>
      stmt.sqlId.toLowerCase().includes(search) ||
      stmt.sqlText?.toLowerCase().includes(search) ||
      stmt.module?.toLowerCase().includes(search) ||
      stmt.parsingSchemaName?.toLowerCase().includes(search)
  );
}

// ==================== Sub-Components ====================

function LoadingState() {
  return (
    <Box sx={{ p: 2 }}>
      <Skeleton variant="rectangular" height={48} sx={{ mb: 2, borderRadius: 1 }} />
      <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 1 }} />
    </Box>
  );
}

interface ErrorStateProps {
  message: string;
}

function ErrorState({ message }: ErrorStateProps) {
  const theme = useTheme();

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 6,
        px: 3,
        backgroundColor: alpha(theme.palette.error.main, 0.04),
        borderRadius: 2,
      }}
    >
      <InfoIcon sx={{ fontSize: 48, color: theme.palette.error.main, mb: 2 }} />
      <Typography variant="h6" color="error" gutterBottom>
        Failed to load SQL data
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {message}
      </Typography>
    </Box>
  );
}

function EmptyState() {
  const theme = useTheme();

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 6,
        px: 3,
        backgroundColor: alpha(theme.palette.info.main, 0.04),
        borderRadius: 2,
      }}
    >
      <InfoIcon sx={{ fontSize: 48, color: theme.palette.info.main, mb: 2 }} />
      <Typography variant="h6" color="text.secondary" gutterBottom>
        No SQL statements found
      </Typography>
      <Typography variant="body2" color="text.secondary">
        The AWR report does not contain any top SQL data.
      </Typography>
    </Box>
  );
}

// ==================== Main Component ====================

/**
 * TopSqlTab - Displays top SQL statements from AWR report
 * with sorting, filtering, and multiple view modes.
 */
export function TopSqlTab({
  reportId,
  testRunId,
  maxStatements = DEFAULT_MAX_STATEMENTS,
  defaultSortBy = DEFAULT_SORT_FIELD,
  expandableSqlText = true,
  onSnackbar,
}: TopSqlTabProps) {
  const theme = useTheme();

  // State
  const [sortBy, setSortBy] = useState<SqlSortField>(defaultSortBy);
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [searchText, setSearchText] = useState('');
  const [sqlModalOpen, setSqlModalOpen] = useState(false);
  const [selectedSql, setSelectedSql] = useState<SqlStatementDisplay | null>(null);

  // Fetch report data
  const { data: report, isLoading, error } = useQuery({
    queryKey: ['awr-report', reportId],
    queryFn: () => getAwrReport(reportId),
    enabled: !!reportId,
    staleTime: 60000,
  });

  // Extract and process SQL statements
  const { statements, filteredStatements, sortedStatements } = useMemo(() => {
    if (!report) {
      return { statements: [], filteredStatements: [], sortedStatements: [] };
    }

    const statementsMap = extractSqlStatements(report as Parameters<typeof extractSqlStatements>[0]);
    const allStatements = Array.from(statementsMap.values());
    const filtered = filterStatements(allStatements, searchText);
    const sorted = sortStatements(filtered, sortBy, sortDirection);
    const limited = sorted.slice(0, maxStatements);

    return {
      statements: allStatements,
      filteredStatements: filtered,
      sortedStatements: limited,
    };
  }, [report, searchText, sortBy, sortDirection, maxStatements]);

  // Handlers
  const handleSortChange = useCallback((_: React.SyntheticEvent, newValue: SqlSortField) => {
    if (newValue !== null) {
      setSortBy(newValue);
    }
  }, []);

  const handleSortFieldClick = useCallback((field: SqlSortField) => {
    if (field === sortBy) {
      setSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(field);
      setSortDirection('desc');
    }
  }, [sortBy]);

  const handleSearchChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setSearchText(event.target.value);
    },
    []
  );

  const handleSqlClick = useCallback((sqlId: string) => {
    const statement = statements.find(s => s.sqlId === sqlId);
    if (statement) {
      setSelectedSql(statement);
      setSqlModalOpen(true);
    }
  }, [statements]);

  const handleModalClose = useCallback(() => {
    setSqlModalOpen(false);
    setSelectedSql(null);
  }, []);

  // Loading state
  if (isLoading) {
    return <LoadingState />;
  }

  // Error state
  if (error) {
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as Error).message
      : 'An unexpected error occurred';
    return <ErrorState message={errorMessage} />;
  }

  // Empty state
  if (statements.length === 0) {
    return <EmptyState />;
  }

  return (
    <Box sx={{ p: 2 }}>
      {/* Toolbar */}
      <Paper
        elevation={0}
        sx={{
          p: 2,
          mb: 2,
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 2,
        }}
      >
        {/* Sort Tabs */}
        <Tabs
          value={sortBy}
          onChange={handleSortChange}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            mb: 2,
            '& .MuiTab-root': {
              textTransform: 'none',
              minWidth: 100,
            },
          }}
        >
          {SORT_TABS.map((tab) => (
            <Tab
              key={tab.value}
              value={tab.value}
              label={tab.label}
            />
          ))}
        </Tabs>

        {/* Search and View Controls */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            flexWrap: 'wrap',
          }}
        >
          <TextField
            placeholder="Search SQL ID, text, module..."
            value={searchText}
            onChange={handleSearchChange}
            size="small"
            sx={{ flexGrow: 1, minWidth: 200 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" color="action" />
                </InputAdornment>
              ),
            }}
          />

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {filteredStatements.length !== statements.length
                ? `${filteredStatements.length} of ${statements.length}`
                : `${statements.length}`}
              {' statements'}
            </Typography>
          </Box>
        </Box>
      </Paper>

      {/* Content */}
      {sortedStatements.length === 0 ? (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            py: 6,
            backgroundColor: alpha(theme.palette.grey[500], 0.04),
            borderRadius: 2,
          }}
        >
          <Typography variant="body2" color="text.secondary">
            No SQL statements match your search criteria
          </Typography>
        </Box>
      ) : (
        <SqlMetricsTable
          statements={sortedStatements}
          sortBy={sortBy}
          sortDirection={sortDirection}
          onSortChange={handleSortFieldClick}
          onRowClick={handleSqlClick}
          showRank
          maxRows={maxStatements}
        />
      )}

      {/* Truncation Notice */}
      {sortedStatements.length === maxStatements && filteredStatements.length > maxStatements && (
        <Box
          sx={{
            mt: 2,
            p: 1.5,
            backgroundColor: alpha(theme.palette.info.main, 0.08),
            borderRadius: 1,
            textAlign: 'center',
          }}
        >
          <Typography variant="body2" color="text.secondary">
            Showing top {maxStatements} of {filteredStatements.length} SQL statements.
            Use the search filter to find specific queries.
          </Typography>
        </Box>
      )}

      {/* SQL Text Modal */}
      <Dialog
        open={sqlModalOpen}
        onClose={handleModalClose}
        maxWidth="lg"
        fullWidth
        aria-labelledby="sql-text-dialog-title"
      >
        <DialogTitle
          id="sql-text-dialog-title"
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            pb: 1,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="h6" component="span">
              SQL Statement
            </Typography>
            {selectedSql && (
              <Typography
                variant="body2"
                sx={{
                  fontFamily: 'monospace',
                  color: 'primary.main',
                  fontWeight: 600,
                }}
              >
                {formatSqlId(selectedSql.sqlId)}
              </Typography>
            )}
          </Box>
          <IconButton
            edge="end"
            color="inherit"
            onClick={handleModalClose}
            aria-label="close"
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {selectedSql?.sqlText ? (
            <SqlTextViewer
              sqlText={selectedSql.sqlText}
              sqlId={selectedSql.sqlId}
              maxHeight={600}
              showCopyButton
              showExpandButton
              onSnackbar={onSnackbar}
            />
          ) : (
            <Typography color="text.secondary">
              SQL text not available for this statement
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleModalClose}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default TopSqlTab;
