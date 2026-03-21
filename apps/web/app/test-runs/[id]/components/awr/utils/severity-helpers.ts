/**
 * AWR Severity Helpers
 *
 * Utility functions for working with insight severity levels, categories,
 * and comparison change directions. These helpers provide consistent styling,
 * sorting, filtering, and display logic for AWR analysis results.
 *
 * @example
 * ```tsx
 * import {
 *   getSeverityColor,
 *   sortBySeverity,
 *   filterInsightsBySeverity,
 * } from './utils/severity-helpers';
 *
 * const color = getSeverityColor(insight.severity);
 * const sorted = sortBySeverity(insights);
 * ```
 */

import type {
  InsightSeverity,
  InsightCategory,
  AwrInsight,
  ChangeDirection,
  SeveritySummary,
} from '@/lib/api/awr-reports';

import {
  SEVERITY_COLORS,
  CHANGE_DIRECTION_COLORS,
  CATEGORY_CONFIGS,
  type SeverityColors,
  type CategoryDisplayConfig,
} from '../types';

// ==================== Severity Colors & Styling ====================

/**
 * Get color configuration for a severity level
 *
 * @param severity - Severity level
 * @returns SeverityColors configuration
 */
export function getSeverityColors(severity: InsightSeverity): SeverityColors {
  return SEVERITY_COLORS[severity] || SEVERITY_COLORS.info;
}

/**
 * Get the primary color for a severity level
 *
 * @param severity - Severity level
 * @returns Hex color string
 */
export function getSeverityColor(severity: InsightSeverity): string {
  return getSeverityColors(severity).text;
}

/**
 * Get the background color for a severity level
 *
 * @param severity - Severity level
 * @returns RGBA color string
 */
export function getSeverityBackgroundColor(severity: InsightSeverity): string {
  return getSeverityColors(severity).background;
}

/**
 * Get the border color for a severity level
 *
 * @param severity - Severity level
 * @returns RGBA color string
 */
export function getSeverityBorderColor(severity: InsightSeverity): string {
  return getSeverityColors(severity).border;
}

/**
 * Get the MUI color name for a severity level
 *
 * @param severity - Severity level
 * @returns MUI color name for use in components
 */
export function getSeverityMuiColor(
  severity: InsightSeverity,
): 'error' | 'warning' | 'info' | 'success' {
  const colorMap: Record<InsightSeverity, 'error' | 'warning' | 'info'> = {
    critical: 'error',
    warning: 'warning',
    info: 'info',
  };
  return colorMap[severity] || 'info';
}

/**
 * Get the icon name for a severity level
 *
 * @param severity - Severity level
 * @returns MUI icon name
 */
export function getSeverityIcon(severity: InsightSeverity): string {
  const iconMap: Record<InsightSeverity, string> = {
    critical: 'Error',
    warning: 'Warning',
    info: 'Info',
  };
  return iconMap[severity] || 'Info';
}

/**
 * Get the display label for a severity level
 *
 * @param severity - Severity level
 * @param uppercase - Whether to uppercase (default: false)
 * @returns Display label
 */
export function getSeverityLabel(
  severity: InsightSeverity,
  uppercase: boolean = false,
): string {
  const labels: Record<InsightSeverity, string> = {
    critical: 'Critical',
    warning: 'Warning',
    info: 'Info',
  };
  const label = labels[severity] || 'Unknown';
  return uppercase ? label.toUpperCase() : label;
}

// ==================== Severity Ordering & Sorting ====================

/**
 * Severity priority order (higher number = higher priority)
 */
export const SEVERITY_PRIORITY: Record<InsightSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

/**
 * Get the priority value for a severity level
 *
 * @param severity - Severity level
 * @returns Priority value (higher = more severe)
 */
export function getSeverityPriority(severity: InsightSeverity): number {
  return SEVERITY_PRIORITY[severity] || 0;
}

/**
 * Compare two severity levels
 *
 * @param a - First severity
 * @param b - Second severity
 * @returns Comparison result (-1, 0, 1)
 */
export function compareSeverity(
  a: InsightSeverity,
  b: InsightSeverity,
): number {
  return getSeverityPriority(b) - getSeverityPriority(a);
}

/**
 * Sort insights by severity (critical first)
 *
 * @param insights - Array of insights to sort
 * @returns New sorted array
 */
export function sortBySeverity<T extends { severity: InsightSeverity }>(
  insights: T[],
): T[] {
  return [...insights].sort((a, b) => compareSeverity(a.severity, b.severity));
}

/**
 * Sort insights by severity then by impact score
 *
 * @param insights - Array of insights to sort
 * @returns New sorted array
 */
export function sortBySeverityAndImpact(insights: AwrInsight[]): AwrInsight[] {
  return [...insights].sort((a, b) => {
    const severityDiff = compareSeverity(a.severity, b.severity);
    if (severityDiff !== 0) return severityDiff;
    return (b.impactScore || 0) - (a.impactScore || 0);
  });
}

/**
 * Get the highest severity from a list of insights
 *
 * @param insights - Array of insights
 * @returns Highest severity level or null if empty
 */
export function getHighestSeverity(
  insights: AwrInsight[],
): InsightSeverity | null {
  if (insights.length === 0) return null;

  return insights.reduce(
    (highest, insight) =>
      getSeverityPriority(insight.severity) > getSeverityPriority(highest)
        ? insight.severity
        : highest,
    insights[0].severity,
  );
}

// ==================== Severity Filtering ====================

/**
 * Filter insights by severity levels
 *
 * @param insights - Array of insights
 * @param severities - Severity levels to include
 * @returns Filtered array
 */
export function filterBySeverity(
  insights: AwrInsight[],
  severities: InsightSeverity[],
): AwrInsight[] {
  if (severities.length === 0) return insights;
  return insights.filter((insight) => severities.includes(insight.severity));
}

/**
 * Filter insights by minimum severity
 *
 * @param insights - Array of insights
 * @param minSeverity - Minimum severity to include
 * @returns Filtered array
 */
export function filterByMinSeverity(
  insights: AwrInsight[],
  minSeverity: InsightSeverity,
): AwrInsight[] {
  const minPriority = getSeverityPriority(minSeverity);
  return insights.filter(
    (insight) => getSeverityPriority(insight.severity) >= minPriority,
  );
}

/**
 * Get insights with critical severity only
 *
 * @param insights - Array of insights
 * @returns Critical insights only
 */
export function getCriticalInsights(insights: AwrInsight[]): AwrInsight[] {
  return insights.filter((insight) => insight.severity === 'critical');
}

/**
 * Get insights with warning severity only
 *
 * @param insights - Array of insights
 * @returns Warning insights only
 */
export function getWarningInsights(insights: AwrInsight[]): AwrInsight[] {
  return insights.filter((insight) => insight.severity === 'warning');
}

/**
 * Get insights with info severity only
 *
 * @param insights - Array of insights
 * @returns Info insights only
 */
export function getInfoInsights(insights: AwrInsight[]): AwrInsight[] {
  return insights.filter((insight) => insight.severity === 'info');
}

// ==================== Severity Summary ====================

/**
 * Calculate severity summary from insights
 *
 * @param insights - Array of insights
 * @returns Severity summary with counts
 */
export function calculateSeveritySummary(
  insights: AwrInsight[],
): SeveritySummary {
  const critical = insights.filter((i) => i.severity === 'critical').length;
  const warning = insights.filter((i) => i.severity === 'warning').length;
  const info = insights.filter((i) => i.severity === 'info').length;

  return {
    critical,
    warning,
    info,
    total: critical + warning + info,
  };
}

/**
 * Check if severity summary has any critical issues
 *
 * @param summary - Severity summary
 * @returns True if has critical issues
 */
export function hasCriticalIssues(summary: SeveritySummary): boolean {
  return summary.critical > 0;
}

/**
 * Check if severity summary has any issues (critical or warning)
 *
 * @param summary - Severity summary
 * @returns True if has any issues
 */
export function hasIssues(summary: SeveritySummary): boolean {
  return summary.critical > 0 || summary.warning > 0;
}

/**
 * Get total count from severity summary
 *
 * @param summary - Severity summary
 * @returns Total count
 */
export function getTotalFromSummary(summary: SeveritySummary): number {
  return summary.critical + summary.warning + summary.info;
}

/**
 * Get the overall status from severity summary
 *
 * @param summary - Severity summary
 * @returns Overall status
 */
export function getOverallStatus(
  summary: SeveritySummary,
): 'critical' | 'warning' | 'ok' {
  if (summary.critical > 0) return 'critical';
  if (summary.warning > 0) return 'warning';
  return 'ok';
}

// ==================== Category Helpers ====================

/**
 * Get display configuration for a category
 *
 * @param category - Insight category
 * @returns Category display configuration or undefined
 */
export function getCategoryConfig(
  category: InsightCategory,
): CategoryDisplayConfig | undefined {
  return CATEGORY_CONFIGS.find((config) => config.id === category);
}

/**
 * Get the display label for a category
 *
 * @param category - Insight category
 * @returns Display label
 */
export function getCategoryLabel(category: InsightCategory): string {
  return getCategoryConfig(category)?.label || category;
}

/**
 * Get the icon name for a category
 *
 * @param category - Insight category
 * @returns MUI icon name
 */
export function getCategoryIcon(category: InsightCategory): string {
  return getCategoryConfig(category)?.icon || 'Category';
}

/**
 * Get the color for a category
 *
 * @param category - Insight category
 * @returns Hex color string
 */
export function getCategoryColor(category: InsightCategory): string {
  return getCategoryConfig(category)?.color || '#9e9e9e';
}

/**
 * Group insights by category
 *
 * @param insights - Array of insights
 * @returns Map of category to insights
 */
export function groupByCategory(
  insights: AwrInsight[],
): Map<InsightCategory, AwrInsight[]> {
  const grouped = new Map<InsightCategory, AwrInsight[]>();

  for (const insight of insights) {
    const category = insight.category;
    const existing = grouped.get(category) || [];
    existing.push(insight);
    grouped.set(category, existing);
  }

  return grouped;
}

/**
 * Group insights by severity
 *
 * @param insights - Array of insights
 * @returns Map of severity to insights
 */
export function groupBySeverity(
  insights: AwrInsight[],
): Map<InsightSeverity, AwrInsight[]> {
  const grouped = new Map<InsightSeverity, AwrInsight[]>();

  // Initialize in priority order
  grouped.set('critical', []);
  grouped.set('warning', []);
  grouped.set('info', []);

  for (const insight of insights) {
    const existing = grouped.get(insight.severity) || [];
    existing.push(insight);
    grouped.set(insight.severity, existing);
  }

  return grouped;
}

/**
 * Filter insights by category
 *
 * @param insights - Array of insights
 * @param categories - Categories to include
 * @returns Filtered array
 */
export function filterByCategory(
  insights: AwrInsight[],
  categories: InsightCategory[],
): AwrInsight[] {
  if (categories.length === 0) return insights;
  return insights.filter((insight) => categories.includes(insight.category));
}

// ==================== Change Direction Helpers ====================

/**
 * Get color for change direction
 *
 * @param direction - Change direction
 * @returns Hex color string
 */
export function getChangeDirectionColor(direction: ChangeDirection): string {
  return CHANGE_DIRECTION_COLORS[direction] || '#9e9e9e';
}

/**
 * Get icon name for change direction
 *
 * @param direction - Change direction
 * @returns MUI icon name
 */
export function getChangeDirectionIcon(direction: ChangeDirection): string {
  const iconMap: Record<ChangeDirection, string> = {
    improved: 'TrendingDown',
    regressed: 'TrendingUp',
    unchanged: 'TrendingFlat',
    new: 'Add',
    removed: 'Remove',
  };
  return iconMap[direction] || 'HelpOutline';
}

/**
 * Get label for change direction
 *
 * @param direction - Change direction
 * @returns Display label
 */
export function getChangeDirectionLabel(direction: ChangeDirection): string {
  const labelMap: Record<ChangeDirection, string> = {
    improved: 'Improved',
    regressed: 'Regressed',
    unchanged: 'Unchanged',
    new: 'New',
    removed: 'Removed',
  };
  return labelMap[direction] || direction;
}

/**
 * Determine change direction from percentage change
 *
 * @param changePercent - Percentage change value
 * @param threshold - Threshold for considering a change significant (default: 5)
 * @param higherIsBetter - Whether higher values are better (default: false, lower is better for performance)
 * @returns Change direction
 */
export function determineChangeDirection(
  changePercent: number | null | undefined,
  threshold: number = 5,
  higherIsBetter: boolean = false,
): ChangeDirection {
  if (changePercent === null || changePercent === undefined) {
    return 'unchanged';
  }

  const absChange = Math.abs(changePercent);

  if (absChange < threshold) {
    return 'unchanged';
  }

  // For metrics where lower is better (like execution time, wait time)
  if (!higherIsBetter) {
    return changePercent > 0 ? 'regressed' : 'improved';
  }

  // For metrics where higher is better (like throughput)
  return changePercent > 0 ? 'improved' : 'regressed';
}

/**
 * Check if a change direction indicates a problem
 *
 * @param direction - Change direction
 * @returns True if direction indicates a problem
 */
export function isProblematicChange(direction: ChangeDirection): boolean {
  return direction === 'regressed' || direction === 'new';
}

/**
 * Check if a change direction indicates an improvement
 *
 * @param direction - Change direction
 * @returns True if direction indicates improvement
 */
export function isPositiveChange(direction: ChangeDirection): boolean {
  return direction === 'improved' || direction === 'removed';
}

// ==================== Impact Score Helpers ====================

/**
 * Get color for impact score
 *
 * @param score - Impact score (0-100)
 * @returns Hex color string
 */
export function getImpactScoreColor(score: number | null | undefined): string {
  if (score === null || score === undefined) {
    return '#9e9e9e';
  }

  if (score >= 80) return '#d32f2f'; // Critical/Red
  if (score >= 50) return '#ed6c02'; // Warning/Orange
  if (score >= 20) return '#0288d1'; // Info/Blue
  return '#4caf50'; // Low/Green
}

/**
 * Get label for impact score
 *
 * @param score - Impact score (0-100)
 * @returns Impact level label
 */
export function getImpactScoreLabel(
  score: number | null | undefined,
): string {
  if (score === null || score === undefined) {
    return 'Unknown';
  }

  if (score >= 80) return 'Critical Impact';
  if (score >= 50) return 'High Impact';
  if (score >= 20) return 'Medium Impact';
  return 'Low Impact';
}

/**
 * Filter insights by minimum impact score
 *
 * @param insights - Array of insights
 * @param minScore - Minimum impact score (0-100)
 * @returns Filtered array
 */
export function filterByMinImpactScore(
  insights: AwrInsight[],
  minScore: number,
): AwrInsight[] {
  return insights.filter((insight) => (insight.impactScore || 0) >= minScore);
}

/**
 * Sort insights by impact score (highest first)
 *
 * @param insights - Array of insights
 * @returns Sorted array
 */
export function sortByImpactScore(insights: AwrInsight[]): AwrInsight[] {
  return [...insights].sort(
    (a, b) => (b.impactScore || 0) - (a.impactScore || 0),
  );
}

// ==================== Combined Helpers ====================

/**
 * Apply all filters to insights
 *
 * @param insights - Array of insights
 * @param options - Filter options
 * @returns Filtered and sorted array
 */
export function applyInsightFilters(
  insights: AwrInsight[],
  options: {
    severities?: InsightSeverity[];
    categories?: InsightCategory[];
    minImpactScore?: number;
    searchText?: string;
    sortBy?: 'severity' | 'impact' | 'category';
  } = {},
): AwrInsight[] {
  let result = [...insights];

  // Filter by severity
  if (options.severities && options.severities.length > 0) {
    result = filterBySeverity(result, options.severities);
  }

  // Filter by category
  if (options.categories && options.categories.length > 0) {
    result = filterByCategory(result, options.categories);
  }

  // Filter by minimum impact score
  if (options.minImpactScore !== undefined && options.minImpactScore > 0) {
    result = filterByMinImpactScore(result, options.minImpactScore);
  }

  // Filter by search text
  if (options.searchText && options.searchText.trim()) {
    const searchLower = options.searchText.toLowerCase();
    result = result.filter(
      (insight) =>
        insight.title.toLowerCase().includes(searchLower) ||
        insight.description.toLowerCase().includes(searchLower) ||
        (insight.recommendation &&
          insight.recommendation.toLowerCase().includes(searchLower)) ||
        (insight.sqlId && insight.sqlId.toLowerCase().includes(searchLower)),
    );
  }

  // Sort
  switch (options.sortBy) {
    case 'impact':
      result = sortByImpactScore(result);
      break;
    case 'severity':
    default:
      result = sortBySeverityAndImpact(result);
      break;
  }

  return result;
}

/**
 * Get a summary string for insights
 *
 * @param insights - Array of insights
 * @returns Summary string (e.g., "3 Critical, 5 Warning, 2 Info")
 */
export function getInsightsSummaryText(insights: AwrInsight[]): string {
  const summary = calculateSeveritySummary(insights);
  const parts: string[] = [];

  if (summary.critical > 0) {
    parts.push(`${summary.critical} Critical`);
  }
  if (summary.warning > 0) {
    parts.push(`${summary.warning} Warning`);
  }
  if (summary.info > 0) {
    parts.push(`${summary.info} Info`);
  }

  return parts.length > 0 ? parts.join(', ') : 'No insights';
}

/**
 * Check if there are any insights worth alerting about
 *
 * @param insights - Array of insights
 * @returns True if there are critical or high-impact insights
 */
export function hasAlertableInsights(insights: AwrInsight[]): boolean {
  return insights.some(
    (insight) =>
      insight.severity === 'critical' ||
      (insight.impactScore !== undefined && insight.impactScore >= 80),
  );
}
