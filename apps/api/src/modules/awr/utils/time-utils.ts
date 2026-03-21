/**
 * Time Value Parsing Utilities for AWR Reports
 *
 * Utility functions for parsing various time formats found in Oracle AWR reports.
 * AWR reports express time values in multiple formats:
 * - Seconds with decimals (1234.56)
 * - Microseconds (1234us)
 * - Milliseconds (1234ms)
 * - Minutes/hours/days with units
 * - Duration strings (1h 23m 45s)
 * - Timestamps (DD-MON-YY HH:MI:SS)
 */

import { parseAwrNumber, isSpecialValue } from './number-utils';

// ==================== Types ====================

/**
 * Time unit enumeration
 */
export type TimeUnit =
  | 'nanoseconds'
  | 'microseconds'
  | 'milliseconds'
  | 'seconds'
  | 'minutes'
  | 'hours'
  | 'days';

/**
 * Parsed time value with metadata
 */
export interface ParsedTime {
  /** Time value in seconds (canonical unit) */
  seconds: number;
  /** Original value as parsed */
  originalValue: number;
  /** Original unit detected */
  originalUnit: TimeUnit;
  /** Whether parse was successful */
  success: boolean;
}

/**
 * Options for time parsing
 */
export interface TimeParseOptions {
  /** Default unit if none detected (default: 'seconds') */
  defaultUnit?: TimeUnit;
  /** Default value if parsing fails (default: 0) */
  defaultValue?: number;
}

// ==================== Time Unit Conversions ====================

/**
 * Conversion factors to seconds
 */
const TO_SECONDS: Record<TimeUnit, number> = {
  nanoseconds: 1 / 1_000_000_000,
  microseconds: 1 / 1_000_000,
  milliseconds: 1 / 1_000,
  seconds: 1,
  minutes: 60,
  hours: 3_600,
  days: 86_400,
};

/**
 * Unit abbreviation mappings (case insensitive)
 */
const UNIT_ALIASES: Record<string, TimeUnit> = {
  ns: 'nanoseconds',
  nsec: 'nanoseconds',
  nanosecond: 'nanoseconds',
  nanoseconds: 'nanoseconds',
  us: 'microseconds',
  usec: 'microseconds',
  microsecond: 'microseconds',
  microseconds: 'microseconds',
  '\u00b5s': 'microseconds', // Greek mu
  ms: 'milliseconds',
  msec: 'milliseconds',
  millisecond: 'milliseconds',
  milliseconds: 'milliseconds',
  s: 'seconds',
  sec: 'seconds',
  secs: 'seconds',
  second: 'seconds',
  seconds: 'seconds',
  m: 'minutes',
  min: 'minutes',
  mins: 'minutes',
  minute: 'minutes',
  minutes: 'minutes',
  h: 'hours',
  hr: 'hours',
  hrs: 'hours',
  hour: 'hours',
  hours: 'hours',
  d: 'days',
  day: 'days',
  days: 'days',
};

// ==================== Core Parsing Functions ====================

/**
 * Parse a time value from AWR format to seconds
 *
 * @param value - String value with optional time unit
 * @param options - Parsing options
 * @returns Time value in seconds
 *
 * @example
 * parseTimeToSeconds('1234.56') // 1234.56 (assumes seconds)
 * parseTimeToSeconds('500ms') // 0.5
 * parseTimeToSeconds('2.5 minutes') // 150
 * parseTimeToSeconds('1h 30m') // 5400
 */
export function parseTimeToSeconds(
  value: string | null | undefined,
  options: TimeParseOptions = {},
): number {
  const { defaultUnit = 'seconds', defaultValue = 0 } = options;

  if (value === null || value === undefined) {
    return defaultValue;
  }

  const cleaned = value.toString().trim();

  if (cleaned === '' || isSpecialValue(cleaned)) {
    return defaultValue;
  }

  // Try parsing as duration string first (e.g., "1h 30m 45s")
  const durationResult = parseDurationString(cleaned);
  if (durationResult !== null) {
    return durationResult;
  }

  // Try parsing as value with unit
  const parsed = parseValueWithUnit(cleaned, defaultUnit);

  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse a value with unit suffix
 *
 * @param value - Cleaned string value
 * @param defaultUnit - Default unit if none found
 * @returns Time in seconds
 */
function parseValueWithUnit(value: string, defaultUnit: TimeUnit): number {
  // Match number followed by optional unit
  const match = value.match(/^([\d,.]+)\s*([a-z\u00b5]+)?$/i);
  if (!match) {
    return NaN;
  }

  const numPart = parseAwrNumber(match[1]);
  const unitPart = match[2]?.toLowerCase() || '';

  // Determine unit
  const unit = unitPart ? (UNIT_ALIASES[unitPart] || defaultUnit) : defaultUnit;

  // Convert to seconds
  return numPart * TO_SECONDS[unit];
}

/**
 * Parse a duration string like "1h 30m 45s" or "01:30:45"
 *
 * @param value - Duration string
 * @returns Total seconds or null if not a duration format
 */
function parseDurationString(value: string): number | null {
  // Try HH:MM:SS format
  const timeMatch = value.match(/^(\d+):(\d+):(\d+)(?:\.(\d+))?$/);
  if (timeMatch && timeMatch[1] && timeMatch[2] && timeMatch[3]) {
    const hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    const seconds = parseInt(timeMatch[3], 10);
    const fraction = timeMatch[4] ? parseFloat(`0.${timeMatch[4]}`) : 0;
    return hours * 3600 + minutes * 60 + seconds + fraction;
  }

  // Try MM:SS format
  const shortTimeMatch = value.match(/^(\d+):(\d+)(?:\.(\d+))?$/);
  if (shortTimeMatch && shortTimeMatch[1] && shortTimeMatch[2]) {
    const minutes = parseInt(shortTimeMatch[1], 10);
    const seconds = parseInt(shortTimeMatch[2], 10);
    const fraction = shortTimeMatch[3] ? parseFloat(`0.${shortTimeMatch[3]}`) : 0;
    return minutes * 60 + seconds + fraction;
  }

  // Try "Xh Ym Zs" format - more strict pattern to avoid matching "500ms" as minutes
  // Require explicit unit suffixes (min/minute/minutes for minutes, not just "m")
  // or require spaces between components for multi-unit strings
  const durationMatch = value.match(
    /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)(?:\s+(?:(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?)?)?(?:\s+(?:(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?)?)?$/i,
  );
  if (durationMatch && durationMatch[1]) {
    const hours = parseFloat(durationMatch[1] || '0');
    const minutes = parseFloat(durationMatch[2] || '0');
    const seconds = parseFloat(durationMatch[3] || '0');
    return hours * 3600 + minutes * 60 + seconds;
  }

  // Try standalone minutes (Xmin, X minutes, etc.) - require longer form
  const minutesMatch = value.match(/^(\d+(?:\.\d+)?)\s*(min(?:utes?)?)\s*(?:(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?)?$/i);
  if (minutesMatch && minutesMatch[1]) {
    const minutes = parseFloat(minutesMatch[1] || '0');
    const seconds = parseFloat(minutesMatch[3] || '0');
    return minutes * 60 + seconds;
  }

  return null;
}

// ==================== Conversion Functions ====================

/**
 * Convert seconds to another time unit
 *
 * @param seconds - Time in seconds
 * @param targetUnit - Target unit
 * @returns Converted value
 */
export function convertFromSeconds(
  seconds: number,
  targetUnit: TimeUnit,
): number {
  return seconds / TO_SECONDS[targetUnit];
}

/**
 * Convert between any two time units
 *
 * @param value - Time value
 * @param fromUnit - Source unit
 * @param toUnit - Target unit
 * @returns Converted value
 */
export function convertTime(
  value: number,
  fromUnit: TimeUnit,
  toUnit: TimeUnit,
): number {
  const inSeconds = value * TO_SECONDS[fromUnit];
  return inSeconds / TO_SECONDS[toUnit];
}

/**
 * Convert seconds to milliseconds
 *
 * @param seconds - Time in seconds
 * @returns Time in milliseconds
 */
export function secondsToMs(seconds: number): number {
  return seconds * 1000;
}

/**
 * Convert milliseconds to seconds
 *
 * @param ms - Time in milliseconds
 * @returns Time in seconds
 */
export function msToSeconds(ms: number): number {
  return ms / 1000;
}

/**
 * Convert seconds to minutes
 *
 * @param seconds - Time in seconds
 * @returns Time in minutes
 */
export function secondsToMinutes(seconds: number): number {
  return seconds / 60;
}

/**
 * Convert minutes to seconds
 *
 * @param minutes - Time in minutes
 * @returns Time in seconds
 */
export function minutesToSeconds(minutes: number): number {
  return minutes * 60;
}

/**
 * Convert seconds to hours
 *
 * @param seconds - Time in seconds
 * @returns Time in hours
 */
export function secondsToHours(seconds: number): number {
  return seconds / 3600;
}

/**
 * Convert centiseconds (1/100th sec) to seconds
 *
 * @param centiseconds - Time in centiseconds
 * @returns Time in seconds
 */
export function centisecondsToSeconds(centiseconds: number): number {
  return centiseconds / 100;
}

// ==================== Timestamp Parsing ====================

/**
 * Parse an Oracle AWR timestamp format
 * Common formats: "DD-MON-YY HH:MI:SS", "DD-MON-YYYY HH24:MI:SS"
 *
 * @param value - Timestamp string
 * @returns Date object or null if parsing fails
 *
 * @example
 * parseAwrTimestamp('15-JAN-24 10:30:45') // Date object
 * parseAwrTimestamp('15-JAN-2024 10:30:45') // Date object
 */
export function parseAwrTimestamp(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const cleaned = value.trim();

  // Try Oracle format: DD-MON-YY HH:MI:SS or DD-MON-YYYY HH:MI:SS
  const oracleMatch = cleaned.match(
    /^(\d{1,2})-([A-Z]{3})-(\d{2,4})\s+(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?$/i,
  );
  if (oracleMatch && oracleMatch[1] && oracleMatch[2] && oracleMatch[3] && oracleMatch[4] && oracleMatch[5] && oracleMatch[6]) {
    const day = parseInt(oracleMatch[1], 10);
    const monthStr = oracleMatch[2].toUpperCase();
    let year = parseInt(oracleMatch[3], 10);
    const hour = parseInt(oracleMatch[4], 10);
    const minute = parseInt(oracleMatch[5], 10);
    const second = parseInt(oracleMatch[6], 10);

    // Convert 2-digit year
    if (year < 100) {
      year += year < 50 ? 2000 : 1900;
    }

    const month = MONTH_MAP[monthStr];
    if (month !== undefined) {
      return new Date(year, month, day, hour, minute, second);
    }
  }

  // Try ISO format fallback
  const isoDate = new Date(cleaned);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }

  return null;
}

/**
 * Month name to number mapping
 */
const MONTH_MAP: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/**
 * Calculate elapsed time between two timestamps in minutes
 *
 * @param start - Start timestamp
 * @param end - End timestamp
 * @returns Elapsed minutes
 */
export function calculateElapsedMinutes(
  start: Date | string | null,
  end: Date | string | null,
): number {
  const startDate = typeof start === 'string' ? parseAwrTimestamp(start) : start;
  const endDate = typeof end === 'string' ? parseAwrTimestamp(end) : end;

  if (!startDate || !endDate) {
    return 0;
  }

  const diffMs = endDate.getTime() - startDate.getTime();
  return diffMs / (1000 * 60);
}

// ==================== Formatting Functions ====================

/**
 * Format seconds as a human-readable duration string
 *
 * @param seconds - Time in seconds
 * @param compact - Use compact format (1h 30m vs 1 hour 30 minutes)
 * @returns Formatted duration string
 *
 * @example
 * formatDuration(5400) // "1h 30m"
 * formatDuration(45) // "45s"
 * formatDuration(0.5) // "500ms"
 */
export function formatDuration(seconds: number, compact: boolean = true): string {
  if (isNaN(seconds) || !isFinite(seconds)) {
    return 'N/A';
  }

  const absSeconds = Math.abs(seconds);
  const sign = seconds < 0 ? '-' : '';

  // Sub-second values
  if (absSeconds < 1) {
    const ms = absSeconds * 1000;
    if (ms < 1) {
      const us = ms * 1000;
      return `${sign}${us.toFixed(0)}${compact ? 'us' : ' microseconds'}`;
    }
    return `${sign}${ms.toFixed(1)}${compact ? 'ms' : ' milliseconds'}`;
  }

  // Less than a minute
  if (absSeconds < 60) {
    return `${sign}${absSeconds.toFixed(1)}${compact ? 's' : ' seconds'}`;
  }

  // Calculate components
  const days = Math.floor(absSeconds / 86400);
  const hours = Math.floor((absSeconds % 86400) / 3600);
  const minutes = Math.floor((absSeconds % 3600) / 60);
  const secs = Math.floor(absSeconds % 60);

  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days}${compact ? 'd' : ' day' + (days > 1 ? 's' : '')}`);
  }
  if (hours > 0) {
    parts.push(`${hours}${compact ? 'h' : ' hour' + (hours > 1 ? 's' : '')}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}${compact ? 'm' : ' minute' + (minutes > 1 ? 's' : '')}`);
  }
  if (secs > 0) {
    parts.push(`${secs}${compact ? 's' : ' second' + (secs > 1 ? 's' : '')}`);
  }

  return sign + parts.join(compact ? ' ' : ', ');
}

/**
 * Format time value with automatic unit selection
 *
 * @param seconds - Time in seconds
 * @param decimals - Decimal places (default: 2)
 * @returns Formatted string with appropriate unit
 */
export function formatTimeAuto(seconds: number, decimals: number = 2): string {
  if (isNaN(seconds) || !isFinite(seconds)) {
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
 * Format milliseconds with appropriate unit
 *
 * @param ms - Time in milliseconds
 * @param decimals - Decimal places
 * @returns Formatted string
 */
export function formatMs(ms: number, decimals: number = 2): string {
  return formatTimeAuto(ms / 1000, decimals);
}

// ==================== Validation Functions ====================

/**
 * Check if a time value is valid (non-negative finite number)
 *
 * @param seconds - Time value
 * @returns True if valid
 */
export function isValidTime(seconds: number): boolean {
  return !isNaN(seconds) && isFinite(seconds) && seconds >= 0;
}

/**
 * Ensure time value is non-negative
 *
 * @param seconds - Time value
 * @returns Non-negative value (0 if negative)
 */
export function ensurePositiveTime(seconds: number): number {
  return Math.max(0, seconds);
}
