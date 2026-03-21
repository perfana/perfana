/**
 * AWR Utils - Barrel Export
 *
 * Utility functions for AWR (Automatic Workload Repository)
 * frontend components, including formatters and severity helpers.
 *
 * @example
 * ```tsx
 * import {
 *   // Formatters
 *   formatNumber,
 *   formatPercentage,
 *   formatDuration,
 *   formatDbTime,
 *   formatCompactNumber,
 *   formatBytes,
 *   formatDate,
 *   formatSqlId,
 *
 *   // Severity helpers
 *   getSeverityColor,
 *   getSeverityLabel,
 *   sortBySeverity,
 *   filterBySeverity,
 *   calculateSeveritySummary,
 *
 *   // Category helpers
 *   getCategoryLabel,
 *   getCategoryColor,
 *   groupByCategory,
 *
 *   // Change direction helpers
 *   getChangeDirectionColor,
 *   determineChangeDirection,
 * } from './utils';
 * ```
 */

// ==================== Formatters ====================

export {
  // Number formatting
  formatNumber,
  formatCompactNumber,
  formatInteger,

  // Percentage formatting
  formatPercentage,
  formatRatioAsPercentage,
  formatChangePercentage,

  // Time/Duration formatting
  formatDuration,
  formatDbTime,
  formatCompactDuration,
  formatElapsedPerExec,

  // Size/Byte formatting
  formatBytes,
  formatBlocks,

  // SQL formatting
  formatSqlId,
  formatSqlPreview,

  // Date/Timestamp formatting
  formatDate,
  formatSnapshotRange,
  formatSnapshotIdRange,

  // Database info formatting
  formatOracleVersion,
  formatDbEdition,
  formatHostCpuInfo,
  formatMemoryGb,

  // Utility functions
  safeValue,
  formatWithFallback,
  truncate,
} from './formatters';

// ==================== Severity Helpers ====================

export {
  // Severity colors & styling
  getSeverityColors,
  getSeverityColor,
  getSeverityBackgroundColor,
  getSeverityBorderColor,
  getSeverityMuiColor,
  getSeverityIcon,
  getSeverityLabel,

  // Severity ordering & sorting
  SEVERITY_PRIORITY,
  getSeverityPriority,
  compareSeverity,
  sortBySeverity,
  sortBySeverityAndImpact,
  getHighestSeverity,

  // Severity filtering
  filterBySeverity,
  filterByMinSeverity,
  getCriticalInsights,
  getWarningInsights,
  getInfoInsights,

  // Severity summary
  calculateSeveritySummary,
  hasCriticalIssues,
  hasIssues,
  getTotalFromSummary,
  getOverallStatus,

  // Category helpers
  getCategoryConfig,
  getCategoryLabel,
  getCategoryIcon,
  getCategoryColor,
  groupByCategory,
  groupBySeverity,
  filterByCategory,

  // Change direction helpers
  getChangeDirectionColor,
  getChangeDirectionIcon,
  getChangeDirectionLabel,
  determineChangeDirection,
  isProblematicChange,
  isPositiveChange,

  // Impact score helpers
  getImpactScoreColor,
  getImpactScoreLabel,
  filterByMinImpactScore,
  sortByImpactScore,

  // Combined helpers
  applyInsightFilters,
  getInsightsSummaryText,
  hasAlertableInsights,
} from './severity-helpers';
