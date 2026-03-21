'use client';

/**
 * useSLOData - Data fetching hook for SLO section
 *
 * This hook provides the data fetching and core state management
 * for Service Level Objectives. It wraps and re-exports the main
 * useSLOSection hook for consistency with the codebase patterns.
 */

export {
  useSLOSection,
  type UseSLOSectionProps,
  type UseSLOSectionReturn,
  type RequestActionMenuData,
  type ApdexActionMenuData,
  type TransactionForApdex,
} from './useSLOSection';

// Re-export as useSLOData for pattern consistency
export { useSLOSection as useSLOData } from './useSLOSection';
