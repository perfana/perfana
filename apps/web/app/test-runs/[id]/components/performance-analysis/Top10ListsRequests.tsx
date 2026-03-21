/**
 * Top10ListsRequests - Refactored to modular structure
 *
 * This file now re-exports from the top-10-lists-requests module.
 * The component has been split into:
 * - types/: Type definitions (Top10Item, Top10Dimension, etc.)
 * - utils/: Utility functions (formatNumber, prepareTop10Data, sortData, etc.)
 * - hooks/: Custom hook for data fetching and state management (useTop10Data)
 * - components/: UI components (Top10DimensionCard, Top10TableRow, Top10ActionMenu, etc.)
 */
export { default } from './top-10-lists-requests';
export * from './top-10-lists-requests/types';
