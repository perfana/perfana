// Perfana's color system - error-focused palette
export const CHART_COLORS = [
  '#f44336',  // Red
  '#e91e63',  // Pink
  '#9c27b0',  // Purple
  '#673ab7',  // Deep Purple
  '#3f51b5',  // Indigo
  '#2196f3',  // Blue
  '#03a9f4',  // Light Blue
  '#00bcd4',  // Cyan
  '#009688',  // Teal
  '#4caf50',  // Green
  '#ff9800',  // Orange
  '#ff5722',  // Deep Orange
];

/**
 * Map error codes to specific colors for consistency
 * Uses a simple hash function to consistently assign colors
 */
export const getColorForErrorCode = (code: string): string => {
  const hash = code.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return CHART_COLORS[hash % CHART_COLORS.length];
};

/**
 * Truncate URL to specified max length with ellipsis
 */
export const truncateUrl = (url: string | null | undefined, maxLength = 50): string => {
  if (!url) return 'N/A';
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength) + '...';
};

/**
 * Format JSON string for display with proper indentation
 */
export const formatJson = (jsonString: string): string => {
  try {
    const parsed = JSON.parse(jsonString);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return jsonString;
  }
};

/**
 * Calculate percentage of errors
 */
export const calculateErrorPercentage = (errorCount: number, totalErrors: number): number => {
  return totalErrors > 0 ? (errorCount / totalErrors) * 100 : 0;
};

/**
 * Group flat error-by-transaction rows into parent groups by (transactionName, samplerName).
 * Each group aggregates error counts, computes a weighted average response time,
 * collects unique response codes, and attaches the original rows as children.
 * Result is sorted by total error count descending.
 */
import type { ErrorByTransaction, ErrorByTransactionGroup } from '../types';

export const groupErrorsByTransactionSampler = (
  errors: ErrorByTransaction[],
): ErrorByTransactionGroup[] => {
  const map = new Map<string, ErrorByTransactionGroup>();

  for (const row of errors) {
    const key = `${row.transactionName}\0${row.samplerName}`;
    let group = map.get(key);
    if (!group) {
      group = {
        transactionName: row.transactionName,
        samplerName: row.samplerName,
        totalErrorCount: 0,
        avgResponseTime: 0,
        responseCodes: [],
        urlCount: 0,
        children: [],
      };
      map.set(key, group);
    }
    group.children.push(row);
    group.totalErrorCount += row.errorCount;
  }

  for (const group of map.values()) {
    // Weighted average response time
    const totalWeight = group.children.reduce((sum, c) => sum + c.errorCount, 0);
    group.avgResponseTime =
      totalWeight > 0
        ? group.children.reduce((sum, c) => sum + c.avgResponseTime * c.errorCount, 0) / totalWeight
        : 0;

    // Unique response codes
    const codes = new Set<string>();
    const urls = new Set<string>();
    for (const c of group.children) {
      if (c.responseCode) codes.add(c.responseCode);
      if (c.url) urls.add(c.url);
    }
    group.responseCodes = Array.from(codes).sort();
    group.urlCount = urls.size;

    // Sort children by error count descending
    group.children.sort((a, b) => b.errorCount - a.errorCount);
  }

  return Array.from(map.values()).sort((a, b) => b.totalErrorCount - a.totalErrorCount);
};
