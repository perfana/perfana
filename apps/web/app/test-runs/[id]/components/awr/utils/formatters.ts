/**
 * AWR Frontend Formatters
 *
 * Display formatting utilities for AWR (Automatic Workload Repository)
 * data visualization in React components. These formatters are optimized
 * for user-friendly display rather than data parsing.
 *
 * @example
 * ```tsx
 * import { formatDbTime, formatNumber, formatPercentage } from './utils/formatters';
 *
 * <div>{formatDbTime(report.elapsedTime)}</div>
 * <div>{formatPercentage(insight.percentDbTime)}</div>
 * ```
 */

// ==================== Number Formatting ====================

/**
 * Format a number with thousand separators
 *
 * @param value - Number to format
 * @param decimals - Maximum decimal places (default: 2)
 * @returns Formatted string
 *
 * @example
 * formatNumber(1234567) // "1,234,567"
 * formatNumber(1234.567, 1) // "1,234.6"
 */
export function formatNumber(
  value: number | null | undefined,
  decimals: number = 2,
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return 'N/A';
  }

  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format a large number with abbreviated suffix (K, M, G, T)
 *
 * @param value - Number to format
 * @param decimals - Decimal places (default: 1)
 * @returns Abbreviated string
 *
 * @example
 * formatCompactNumber(1500) // "1.5K"
 * formatCompactNumber(2500000) // "2.5M"
 */
export function formatCompactNumber(
  value: number | null | undefined,
  decimals: number = 1,
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return 'N/A';
  }

  const absValue = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (absValue >= 1_000_000_000_000) {
    return `${sign}${(absValue / 1_000_000_000_000).toFixed(decimals)}T`;
  }
  if (absValue >= 1_000_000_000) {
    return `${sign}${(absValue / 1_000_000_000).toFixed(decimals)}G`;
  }
  if (absValue >= 1_000_000) {
    return `${sign}${(absValue / 1_000_000).toFixed(decimals)}M`;
  }
  if (absValue >= 1_000) {
    return `${sign}${(absValue / 1_000).toFixed(decimals)}K`;
  }

  return `${sign}${absValue.toFixed(decimals)}`;
}

/**
 * Format a number as integer (no decimals)
 *
 * @param value - Number to format
 * @returns Formatted integer string
 */
export function formatInteger(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) {
    return 'N/A';
  }

  return Math.round(value).toLocaleString('en-US');
}

// ==================== Percentage Formatting ====================

/**
 * Format a percentage value
 *
 * @param value - Percentage value (0-100 scale)
 * @param decimals - Decimal places (default: 1)
 * @param showSymbol - Whether to include % symbol (default: true)
 * @returns Formatted percentage string
 *
 * @example
 * formatPercentage(95.5) // "95.5%"
 * formatPercentage(95.567, 2) // "95.57%"
 */
export function formatPercentage(
  value: number | null | undefined,
  decimals: number = 1,
  showSymbol: boolean = true,
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return 'N/A';
  }

  const formatted = value.toFixed(decimals);
  return showSymbol ? `${formatted}%` : formatted;
}

/**
 * Format a ratio (0-1) as percentage
 *
 * @param ratio - Ratio value (0-1 scale)
 * @param decimals - Decimal places (default: 1)
 * @returns Formatted percentage string
 *
 * @example
 * formatRatioAsPercentage(0.955) // "95.5%"
 */
export function formatRatioAsPercentage(
  ratio: number | null | undefined,
  decimals: number = 1,
): string {
  if (ratio === null || ratio === undefined || isNaN(ratio)) {
    return 'N/A';
  }

  return formatPercentage(ratio * 100, decimals);
}

/**
 * Format a change percentage with sign indicator
 *
 * @param value - Change percentage (can be negative)
 * @param decimals - Decimal places (default: 1)
 * @returns Formatted string with +/- sign
 *
 * @example
 * formatChangePercentage(25.5) // "+25.5%"
 * formatChangePercentage(-10.3) // "-10.3%"
 * formatChangePercentage(0) // "0%"
 */
export function formatChangePercentage(
  value: number | null | undefined,
  decimals: number = 1,
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return 'N/A';
  }

  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

// ==================== Time Formatting ====================

/**
 * Format a duration in seconds with automatic unit selection
 *
 * @param seconds - Time in seconds
 * @param decimals - Decimal places (default: 2)
 * @returns Formatted string with appropriate unit
 *
 * @example
 * formatDuration(0.0005) // "500 us"
 * formatDuration(0.5) // "500 ms"
 * formatDuration(45) // "45.00 s"
 * formatDuration(3600) // "60.00 min"
 */
export function formatDuration(
  seconds: number | null | undefined,
  decimals: number = 2,
): string {
  if (seconds === null || seconds === undefined || isNaN(seconds)) {
    return 'N/A';
  }

  const absSeconds = Math.abs(seconds);
  const sign = seconds < 0 ? '-' : '';

  // Microseconds
  if (absSeconds < 0.001) {
    const us = absSeconds * 1_000_000;
    return `${sign}${us.toFixed(decimals)} us`;
  }

  // Milliseconds
  if (absSeconds < 1) {
    const ms = absSeconds * 1000;
    return `${sign}${ms.toFixed(decimals)} ms`;
  }

  // Seconds
  if (absSeconds < 60) {
    return `${sign}${absSeconds.toFixed(decimals)} s`;
  }

  // Minutes
  if (absSeconds < 3600) {
    return `${sign}${(absSeconds / 60).toFixed(decimals)} min`;
  }

  // Hours
  if (absSeconds < 86400) {
    return `${sign}${(absSeconds / 3600).toFixed(decimals)} hr`;
  }

  // Days
  return `${sign}${(absSeconds / 86400).toFixed(decimals)} days`;
}

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
 * Format a compact duration string (e.g., "1h 30m 45s")
 *
 * @param seconds - Time in seconds
 * @returns Compact duration string
 *
 * @example
 * formatCompactDuration(5445) // "1h 30m 45s"
 * formatCompactDuration(125) // "2m 5s"
 */
export function formatCompactDuration(
  seconds: number | null | undefined,
): string {
  if (seconds === null || seconds === undefined || isNaN(seconds)) {
    return 'N/A';
  }

  const absSeconds = Math.abs(seconds);
  const sign = seconds < 0 ? '-' : '';

  // Sub-second values
  if (absSeconds < 1) {
    const ms = absSeconds * 1000;
    if (ms < 1) {
      return `${sign}${(ms * 1000).toFixed(0)}us`;
    }
    return `${sign}${ms.toFixed(1)}ms`;
  }

  // Less than a minute
  if (absSeconds < 60) {
    return `${sign}${absSeconds.toFixed(1)}s`;
  }

  // Calculate components
  const days = Math.floor(absSeconds / 86400);
  const hours = Math.floor((absSeconds % 86400) / 3600);
  const mins = Math.floor((absSeconds % 3600) / 60);
  const secs = Math.floor(absSeconds % 60);

  const parts: string[] = [];

  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  if (secs > 0 && days === 0) parts.push(`${secs}s`);

  return sign + parts.join(' ');
}

/**
 * Format elapsed per execution time
 *
 * @param seconds - Time in seconds per execution
 * @param decimals - Decimal places (default: 3)
 * @returns Formatted string
 *
 * @example
 * formatElapsedPerExec(0.00234) // "2.34 ms"
 * formatElapsedPerExec(1.5) // "1.500 s"
 */
export function formatElapsedPerExec(
  seconds: number | null | undefined,
  decimals: number = 3,
): string {
  return formatDuration(seconds, decimals);
}

// ==================== Size/Byte Formatting ====================

/**
 * Format bytes with appropriate unit (KB, MB, GB, TB)
 *
 * @param bytes - Size in bytes
 * @param decimals - Decimal places (default: 2)
 * @returns Formatted size string
 *
 * @example
 * formatBytes(1536) // "1.50 KB"
 * formatBytes(1073741824) // "1.00 GB"
 */
export function formatBytes(
  bytes: number | null | undefined,
  decimals: number = 2,
): string {
  if (bytes === null || bytes === undefined || isNaN(bytes)) {
    return 'N/A';
  }

  if (bytes === 0) return '0 B';

  const absBytes = Math.abs(bytes);
  const sign = bytes < 0 ? '-' : '';

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const index = Math.min(
    Math.floor(Math.log(absBytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = absBytes / Math.pow(1024, index);

  return `${sign}${value.toFixed(decimals)} ${units[index]}`;
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

  const formatted = formatCompactNumber(blocks, decimals);
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
