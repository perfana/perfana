/**
 * AWR SQL Components
 *
 * Export barrel for AWR SQL display components.
 * These components are used to display SQL statements from AWR reports
 * with metrics, syntax highlighting, and comparison capabilities.
 *
 * @example
 * ```tsx
 * import {
 *   SqlStatementCard,
 *   SqlMetricsTable,
 *   SqlTextViewer,
 * } from './sql';
 *
 * // Display a single SQL statement with metrics
 * <SqlStatementCard
 *   statement={sqlStatement}
 *   rank={1}
 *   onExpandToggle={() => toggleExpand()}
 * />
 *
 * // Display SQL statements in a table
 * <SqlMetricsTable
 *   statements={topSqlStatements}
 *   sortBy="elapsedTime"
 *   sortDirection="desc"
 *   onSortChange={handleSort}
 * />
 *
 * // Display SQL text with syntax highlighting
 * <SqlTextViewer
 *   sqlText={sqlStatement.sqlText}
 *   sqlId={sqlStatement.sqlId}
 *   showCopyButton
 * />
 * ```
 */

// ==================== Component Exports ====================

export { SqlStatementCard, default as SqlStatementCardDefault } from './SqlStatementCard';
export { SqlMetricsTable, default as SqlMetricsTableDefault } from './SqlMetricsTable';
export { SqlTextViewer, default as SqlTextViewerDefault } from './SqlTextViewer';

// ==================== Type Re-exports ====================

// Re-export types for convenience
export type {
  SqlStatementCardProps,
  SqlMetricsTableProps,
  SqlTextViewerProps,
  SqlStatementDisplay,
  SqlStatementMetrics,
  SqlSortField,
  SortDirection,
  SqlFilters,
  SnackbarSeverity,
  SnackbarCallback,
} from '../types';
