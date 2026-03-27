/**
 * Centralized metric formatting utilities.
 *
 * All value-to-display-string conversions live here. Domain-specific
 * formatters (AWR, performance-analysis, etc.) should delegate to
 * these functions rather than re-implementing them.
 *
 * @example
 * ```ts
 * import { formatDuration, formatBytes, formatPercentage, formatRate } from '@/lib/format-units';
 *
 * formatDuration(0.5)         // "500.00 ms"
 * formatBytes(1048576)        // "1.00 MB"
 * formatPercentage(95.5)      // "95.5%"
 * formatRate(1200, 'req/s')   // "1,200 req/s"
 * formatDurationCompact(3661) // "1h 1m 1s"
 * ```
 */

// ─── Duration ────────────────────────────────────────────────────────

/**
 * Format a duration in seconds with automatic unit selection.
 * Best for precise metric display (e.g. response times, DB wait times).
 *
 * @param seconds - Time in seconds
 * @param decimals - Decimal places (default: 2)
 *
 * @example
 * formatDuration(0.0005)  // "500.00 us"
 * formatDuration(0.5)     // "500.00 ms"
 * formatDuration(45)      // "45.00 s"
 * formatDuration(3600)    // "60.00 min"
 * formatDuration(null)    // "N/A"
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

  if (absSeconds < 0.001) {
    return `${sign}${(absSeconds * 1_000_000).toFixed(decimals)} us`;
  }
  if (absSeconds < 1) {
    return `${sign}${(absSeconds * 1000).toFixed(decimals)} ms`;
  }
  if (absSeconds < 60) {
    return `${sign}${absSeconds.toFixed(decimals)} s`;
  }
  if (absSeconds < 3600) {
    return `${sign}${(absSeconds / 60).toFixed(decimals)} min`;
  }
  if (absSeconds < 86400) {
    return `${sign}${(absSeconds / 3600).toFixed(decimals)} hr`;
  }
  return `${sign}${(absSeconds / 86400).toFixed(decimals)} days`;
}

/**
 * Format a duration as a compact human-readable string.
 * Best for test run durations and wall-clock times.
 *
 * @param seconds - Time in seconds
 *
 * @example
 * formatDurationCompact(5445)  // "1h 30m 45s"
 * formatDurationCompact(125)   // "2m 5s"
 * formatDurationCompact(0.25)  // "250.0ms"
 * formatDurationCompact(null)  // "N/A"
 */
export function formatDurationCompact(
  seconds: number | null | undefined,
): string {
  if (seconds === null || seconds === undefined || isNaN(seconds)) {
    return 'N/A';
  }

  const absSeconds = Math.abs(seconds);
  const sign = seconds < 0 ? '-' : '';

  if (absSeconds === 0) return 'N/A';

  // Sub-second
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

  // Build components
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
 * Format a duration in the simple "Xh Ym Zs" clock format.
 * Used by test run list pages and detail cards.
 *
 * @param seconds - Time in seconds
 *
 * @example
 * formatDurationClock(3661) // "1h 1m 1s"
 * formatDurationClock(154)  // "2m 34s"
 * formatDurationClock(42)   // "42s"
 * formatDurationClock(0)    // "N/A"
 */
export function formatDurationClock(seconds?: number): string {
  if (!seconds || seconds <= 0) return 'N/A';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${remainingSeconds}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    return `${remainingSeconds}s`;
  }
}

// ─── Bytes ───────────────────────────────────────────────────────────

/**
 * Format bytes with automatic unit selection (B, KB, MB, GB, TB, PB).
 *
 * @param bytes - Size in bytes
 * @param decimals - Decimal places (default: 2)
 *
 * @example
 * formatBytes(0)           // "0 B"
 * formatBytes(1536)        // "1.50 KB"
 * formatBytes(1073741824)  // "1.00 GB"
 * formatBytes(null)        // "N/A"
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

// ─── Percentage ──────────────────────────────────────────────────────

/**
 * Format a percentage value.
 *
 * @param value - Percentage on 0-100 scale
 * @param decimals - Decimal places (default: 1)
 * @param showSymbol - Include % symbol (default: true)
 *
 * @example
 * formatPercentage(95.5)      // "95.5%"
 * formatPercentage(95.567, 2) // "95.57%"
 * formatPercentage(null)      // "N/A"
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
 * Format a ratio (0-1) as percentage.
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
 * Format a change percentage with +/- sign.
 *
 * @example
 * formatChangePercentage(25.5)  // "+25.5%"
 * formatChangePercentage(-10.3) // "-10.3%"
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

// ─── Rate ────────────────────────────────────────────────────────────

/**
 * Format a rate value with a unit suffix.
 *
 * @param value - Numeric rate
 * @param unit - Unit label (e.g. 'req/s', 'ops/s', 'MB/s')
 * @param decimals - Decimal places (default: 2)
 *
 * @example
 * formatRate(1234.5, 'req/s')   // "1,234.50 req/s"
 * formatRate(0.5, 'ops/s')      // "0.50 ops/s"
 * formatRate(null, 'req/s')     // "N/A"
 */
export function formatRate(
  value: number | null | undefined,
  unit: string,
  decimals: number = 2,
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return 'N/A';
  }

  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return `${formatted} ${unit}`;
}

// ─── Numbers ─────────────────────────────────────────────────────────

/**
 * Format a number with thousand separators.
 *
 * @param value - Number to format
 * @param decimals - Maximum decimal places (default: 2)
 *
 * @example
 * formatNumber(1234567)     // "1,234,567"
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
 * Format a large number with abbreviated suffix (K, M, G, T).
 *
 * @example
 * formatCompactNumber(1500)    // "1.5K"
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

  if (absValue >= 1_000_000_000_000) return `${sign}${(absValue / 1_000_000_000_000).toFixed(decimals)}T`;
  if (absValue >= 1_000_000_000) return `${sign}${(absValue / 1_000_000_000).toFixed(decimals)}G`;
  if (absValue >= 1_000_000) return `${sign}${(absValue / 1_000_000).toFixed(decimals)}M`;
  if (absValue >= 1_000) return `${sign}${(absValue / 1_000).toFixed(decimals)}K`;
  return `${sign}${absValue.toFixed(decimals)}`;
}

/**
 * Format a number as integer (no decimals).
 */
export function formatInteger(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) {
    return 'N/A';
  }
  return Math.round(value).toLocaleString('en-US');
}
