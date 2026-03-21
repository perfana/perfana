/**
 * AWR Insights Components
 *
 * Export barrel for AWR insight display components.
 * These components are used to display analysis insights from AWR reports
 * with severity indicators, filtering, and grouping capabilities.
 *
 * @example
 * ```tsx
 * import {
 *   InsightCard,
 *   InsightsList,
 *   SeverityBadge,
 * } from './insights';
 *
 * // Display a single insight
 * <InsightCard insight={insight} onSqlClick={handleSqlClick} />
 *
 * // Display a list of insights with grouping
 * <InsightsList
 *   insights={analysisInsights}
 *   groupBySeverity
 *   onFiltersChange={setFilters}
 * />
 *
 * // Display a severity badge
 * <SeverityBadge severity="critical" showLabel />
 * ```
 */

// ==================== Component Exports ====================

export { InsightCard, default as InsightCardDefault } from './InsightCard';
export { InsightsList, default as InsightsListDefault } from './InsightsList';
export { SeverityBadge, default as SeverityBadgeDefault } from './SeverityBadge';

// ==================== Type Re-exports ====================

// Re-export types for convenience
export type {
  InsightCardProps,
  InsightsListProps,
  SeverityBadgeProps,
  InsightFilters,
  InsightSeverity,
  InsightCategory,
  AwrInsight,
} from '../types';
