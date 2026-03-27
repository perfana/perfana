/**
 * AWR Frontend Formatters
 *
 * Re-exports shared formatters from @/lib/format-units and adds
 * AWR-specific formatting (DB time, SQL IDs, Oracle versions, etc.).
 *
 * @example
 * ```tsx
 * import { formatDbTime, formatNumber, formatPercentage } from './utils/formatters';
 *
 * <div>{formatDbTime(report.elapsedTime)}</div>
 * <div>{formatPercentage(insight.percentDbTime)}</div>
 * ```
 */

// Import for local use by AWR-specific functions
import {
  formatDuration as _formatDuration,
  formatCompactNumber as _formatCompactNumber,
} from '@/lib/format-units';

// Re-export shared formatters from centralized source
export {
  formatNumber,
  formatCompactNumber,
  formatInteger,
  formatPercentage,
  formatRatioAsPercentage,
  formatChangePercentage,
  formatDuration,
  formatDurationCompact as formatCompactDuration,
  formatBytes,
  formatRate,
} from '@/lib/format-units';

/**
 * Format DB time in minutes with unit
 *
 * @param minutes - DB time in minutes
 * @param decimals - Decimal places (default: 2)
 * @returns Formatted string
 *
 * @example
 * formatDbTime(236.65) // "236.65 min"
 * formatDbTime(1440) // "24.00 hr"
 */
export function formatDbTime(
  minutes: number | null | undefined,
  decimals: number = 2,
): string {
  if (minutes === null || minutes === undefined || isNaN(minutes)) {
    return 'N/A';
  }

  // Convert to hours if >= 120 minutes (2 hours)
  if (Math.abs(minutes) >= 120) {
    return `${(minutes / 60).toFixed(decimals)} hr`;
  }

  return `${minutes.toFixed(decimals)} min`;
}

/**
 * Format elapsed per execution time (AWR-specific convenience wrapper)
 */
export function formatElapsedPerExec(
  seconds: number | null | undefined,
  decimals: number = 3,
): string {
  return _formatDuration(seconds, decimals);
}

/**
 * Format buffer gets (blocks) with appropriate unit
 *
 * @param blocks - Number of blocks
 * @param decimals - Decimal places (default: 1)
 * @returns Formatted string
 *
 * @example
 * formatBlocks(1500000) // "1.5M blocks"
 * formatBlocks(500) // "500 blocks"
 */
export function formatBlocks(
  blocks: number | null | undefined,
  decimals: number = 1,
): string {
  if (blocks === null || blocks === undefined || isNaN(blocks)) {
    return 'N/A';
  }

  const formatted = _formatCompactNumber(blocks, decimals);
  // Don't add suffix if formatCompactNumber returned N/A
  return formatted === 'N/A' ? formatted : `${formatted} blocks`;
}

// ==================== SQL ID Formatting ====================

/**
 * Format SQL ID for display (truncate if needed)
 *
 * @param sqlId - SQL ID string
 * @param maxLength - Maximum length (default: 13)
 * @returns Formatted SQL ID
 *
 * @example
 * formatSqlId('1mkvp4m5tz0yt') // "1mkvp4m5tz0yt"
 * formatSqlId('abcdefghijklmnop', 10) // "abcdefg..."
 */
export function formatSqlId(
  sqlId: string | null | undefined,
  maxLength: number = 13,
): string {
  if (!sqlId) {
    return 'N/A';
  }

  if (sqlId.length <= maxLength) {
    return sqlId;
  }

  return `${sqlId.substring(0, maxLength - 3)}...`;
}

/**
 * Format SQL text for preview (truncate and clean)
 *
 * @param sqlText - Full SQL text
 * @param maxLength - Maximum length (default: 100)
 * @returns Truncated and cleaned SQL text
 */
export function formatSqlPreview(
  sqlText: string | null | undefined,
  maxLength: number = 100,
): string {
  if (!sqlText) {
    return 'SQL text not available';
  }

  // Clean whitespace
  const cleaned = sqlText.replace(/\s+/g, ' ').trim();

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return `${cleaned.substring(0, maxLength - 3)}...`;
}

// ==================== Date/Timestamp Formatting ====================

/**
 * Format a date for display
 *
 * @param date - Date object or ISO string
 * @param includeTime - Whether to include time (default: true)
 * @returns Formatted date string
 *
 * @example
 * formatDate(new Date()) // "Jan 20, 2026 14:30"
 * formatDate(new Date(), false) // "Jan 20, 2026"
 */
export function formatDate(
  date: Date | string | null | undefined,
  includeTime: boolean = true,
): string {
  if (!date) {
    return 'N/A';
  }

  const dateObj = typeof date === 'string' ? new Date(date) : date;

  if (isNaN(dateObj.getTime())) {
    return 'Invalid date';
  }

  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(includeTime && { hour: '2-digit', minute: '2-digit' }),
  };

  return dateObj.toLocaleDateString('en-US', options);
}

/**
 * Format a snapshot time range
 *
 * @param beginTime - Start timestamp
 * @param endTime - End timestamp
 * @returns Formatted range string
 *
 * @example
 * formatSnapshotRange(startDate, endDate) // "Jan 20, 14:00 - 15:00"
 */
export function formatSnapshotRange(
  beginTime: Date | string | null | undefined,
  endTime: Date | string | null | undefined,
): string {
  if (!beginTime || !endTime) {
    return 'N/A';
  }

  const begin = typeof beginTime === 'string' ? new Date(beginTime) : beginTime;
  const end = typeof endTime === 'string' ? new Date(endTime) : endTime;

  if (isNaN(begin.getTime()) || isNaN(end.getTime())) {
    return 'Invalid date range';
  }

  // If same day, show abbreviated format
  if (begin.toDateString() === end.toDateString()) {
    const datePart = begin.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const startTime = begin.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const endTime = end.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return `${datePart}, ${startTime} - ${endTime}`;
  }

  // Different days
  return `${formatDate(begin)} - ${formatDate(end)}`;
}

/**
 * Format snapshot ID range
 *
 * @param beginId - Start snapshot ID
 * @param endId - End snapshot ID
 * @returns Formatted range string
 *
 * @example
 * formatSnapshotIdRange(25982, 25983) // "25982 - 25983"
 */
export function formatSnapshotIdRange(
  beginId: number | null | undefined,
  endId: number | null | undefined,
): string {
  if (beginId === null || beginId === undefined) {
    return 'N/A';
  }

  if (endId === null || endId === undefined) {
    return String(beginId);
  }

  return `${beginId} - ${endId}`;
}

// ==================== Database Info Formatting ====================

/**
 * Format Oracle release version
 *
 * @param release - Oracle release string (e.g., "19.27.0.0.0")
 * @param short - Whether to use short format (default: false)
 * @returns Formatted version string
 *
 * @example
 * formatOracleVersion('19.27.0.0.0') // "19.27.0.0.0"
 * formatOracleVersion('19.27.0.0.0', true) // "19c"
 */
export function formatOracleVersion(
  release: string | null | undefined,
  short: boolean = false,
): string {
  if (!release) {
    return 'N/A';
  }

  if (!short) {
    return release;
  }

  // Extract major version
  const major = release.split('.')[0];
  const majorNum = parseInt(major, 10);

  // Oracle 12c+, 18c, 19c, 21c, etc.
  if (majorNum >= 12) {
    return `${majorNum}c`;
  }

  return release;
}

/**
 * Format database edition
 *
 * @param edition - Edition code (e.g., "EE", "SE")
 * @returns Full edition name
 *
 * @example
 * formatDbEdition('EE') // "Enterprise Edition"
 * formatDbEdition('SE') // "Standard Edition"
 */
export function formatDbEdition(edition: string | null | undefined): string {
  if (!edition) {
    return 'N/A';
  }

  const editionMap: Record<string, string> = {
    EE: 'Enterprise Edition',
    SE: 'Standard Edition',
    SE1: 'Standard Edition One',
    SE2: 'Standard Edition 2',
    PE: 'Personal Edition',
    XE: 'Express Edition',
  };

  return editionMap[edition.toUpperCase()] || edition;
}

/**
 * Format host information
 *
 * @param cpus - Number of CPUs
 * @param cores - Number of cores
 * @param sockets - Number of sockets
 * @returns Formatted CPU info string
 *
 * @example
 * formatHostCpuInfo(8, 4, 1) // "8 CPUs / 4 cores / 1 socket"
 */
export function formatHostCpuInfo(
  cpus: number | null | undefined,
  cores: number | null | undefined,
  sockets: number | null | undefined,
): string {
  const parts: string[] = [];

  if (cpus !== null && cpus !== undefined) {
    parts.push(`${cpus} CPU${cpus !== 1 ? 's' : ''}`);
  }
  if (cores !== null && cores !== undefined) {
    parts.push(`${cores} core${cores !== 1 ? 's' : ''}`);
  }
  if (sockets !== null && sockets !== undefined) {
    parts.push(`${sockets} socket${sockets !== 1 ? 's' : ''}`);
  }

  return parts.length > 0 ? parts.join(' / ') : 'N/A';
}

/**
 * Format memory size in GB
 *
 * @param memoryGb - Memory in GB
 * @param decimals - Decimal places (default: 1)
 * @returns Formatted memory string
 *
 * @example
 * formatMemoryGb(64.5) // "64.5 GB"
 */
export function formatMemoryGb(
  memoryGb: number | null | undefined,
  decimals: number = 1,
): string {
  if (memoryGb === null || memoryGb === undefined || isNaN(memoryGb)) {
    return 'N/A';
  }

  return `${memoryGb.toFixed(decimals)} GB`;
}

// ==================== Utility Functions ====================

/**
 * Safe value display - returns default if value is null/undefined/NaN
 *
 * @param value - Value to check
 * @param defaultValue - Default string to return (default: 'N/A')
 * @returns Value string or default
 */
export function safeValue(
  value: unknown,
  defaultValue: string = 'N/A',
): string {
  if (value === null || value === undefined) {
    return defaultValue;
  }

  if (typeof value === 'number' && isNaN(value)) {
    return defaultValue;
  }

  return String(value);
}

/**
 * Format a value with a fallback
 *
 * @param value - Value to format
 * @param formatter - Formatter function to apply
 * @param fallback - Fallback string if value is invalid
 * @returns Formatted value or fallback
 */
export function formatWithFallback<T>(
  value: T | null | undefined,
  formatter: (v: T) => string,
  fallback: string = 'N/A',
): string {
  if (value === null || value === undefined) {
    return fallback;
  }

  try {
    return formatter(value);
  } catch {
    return fallback;
  }
}

/**
 * Truncate a string with ellipsis
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum length
 * @param suffix - Suffix to append (default: '...')
 * @returns Truncated string
 */
export function truncate(
  text: string | null | undefined,
  maxLength: number,
  suffix: string = '...',
): string {
  if (!text) {
    return '';
  }

  if (text.length <= maxLength) {
    return text;
  }

  return text.substring(0, maxLength - suffix.length) + suffix;
}
