/**
 * Top10ListsTable - Refactored to modular structure
 *
 * This file now re-exports from the top-10-lists-table module.
 * The component has been split into:
 * - types/: Type definitions (Top10TransactionItem, Top10TableDimension, etc.)
 * - utils/: Utility functions (formatNumber, prepareTop10TransactionData, sortTransactionData, etc.)
 * - hooks/: Custom hook for data fetching and state management (useTop10TableData)
 * - components/: UI components (Top10TransactionDimensionCard, Top10TransactionTableRow, Top10TransactionActionMenu, etc.)
 */
export { default } from './top-10-lists-table';
export * from './top-10-lists-table/types';
