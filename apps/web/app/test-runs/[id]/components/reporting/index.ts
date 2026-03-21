/**
 * Reporting Components Barrel Export
 *
 * This file exports all reporting-related components, hooks, and types
 * for use in the test run details view.
 *
 * @example
 * ```tsx
 * import {
 *   ReportCard,
 *   ReportList,
 *   type ReportCardProps,
 *   type ReportTestRunInfo,
 *   type ReportListProps,
 * } from './components/reporting';
 * ```
 */

// ==================== Main Components ====================

export { ReportCard, default as ReportCardDefault } from './ReportCard';
export { ReportList } from './ReportList';

// ==================== Types ====================

export type {
  ReportCardProps,
  ReportTestRunInfo,
} from './ReportCard';

export type {
  ReportListProps,
} from './ReportList';
