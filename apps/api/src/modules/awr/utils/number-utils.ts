/**
 * Number Parsing Utilities for AWR Reports
 *
 * Utility functions for parsing various number formats found in Oracle AWR reports.
 * AWR reports use different number formats including:
 * - Comma-separated thousands (1,234.56)
 * - Abbreviated numbers (1.2K, 3.5M, 2.1G, 1.5T)
 * - Scientific notation (1.23E+06)
 * - Percentage values (95.5%)
 * - Special values (N/A, null, empty)
 */

// ==================== Types ====================

/**
 * Result of parsing a number, includes metadata about the parse
 */
export interface ParsedNumber {
  /** The parsed numeric value */
  value: number;
  /** Whether the parse was successful */
  success: boolean;
  /** Original string that was parsed */
  original: string;
  /** Whether the value had a unit suffix */
  hadSuffix?: boolean;
  /** The unit suffix if present */
  suffix?: string;
}

/**
 * Options for number parsing
 */
export interface NumberParseOptions {
  /** Default value if parsing fails (default: 0) */
  defaultValue?: number;
  /** Allow negative numbers (default: true) */
  allowNegative?: boolean;
  /** Treat empty strings as null instead of default (default: false) */
  nullOnEmpty?: boolean;
}

// ==================== Core Parsing Functions ====================

/**
 * Parse a number string from AWR report format
 * Handles commas, abbreviated suffixes (K, M, G, T), and special values
 *
 * @param value - String value to parse
 * @param options - Parsing options
 * @returns Parsed number or default value
 *
 * @example
 * parseAwrNumber('1,234.56') // 1234.56
 * parseAwrNumber('1.5K') // 1500
 * parseAwrNumber('3.2M') // 3200000
 * parseAwrNumber('N/A') // 0
 */
export function parseAwrNumber(
  value: string | null | undefined,
  options: NumberParseOptions = {},
): number {
  const { defaultValue = 0, allowNegative = true, nullOnEmpty = false } = options;

  // Handle null/undefined
  if (value === null || value === undefined) {
    return defaultValue;
  }

  // Clean and normalize the string
  const cleaned = value.toString().trim();

  // Handle empty strings
  if (cleaned === '') {
    return nullOnEmpty ? NaN : defaultValue;
  }

  // Handle special AWR values
  if (isSpecialValue(cleaned)) {
    return defaultValue;
  }

  // Check for negative sign
  let isNegative = false;
  let workingValue = cleaned;
  if (workingValue.startsWith('-')) {
    isNegative = true;
    workingValue = workingValue.substring(1);
  } else if (workingValue.startsWith('(') && workingValue.endsWith(')')) {
    // Accounting format for negative: (1,234.56)
    isNegative = true;
    workingValue = workingValue.slice(1, -1);
  }

  // Parse the number with suffix detection
  const parsed = parseWithSuffix(workingValue);

  if (isNaN(parsed)) {
    return defaultValue;
  }

  // Apply negative sign if allowed
  const result = isNegative && allowNegative ? -parsed : parsed;

  return result;
}

/**
 * Parse a number that may have a suffix (K, M, G, T, B)
 *
 * @param value - Cleaned string value
 * @returns Parsed number
 */
function parseWithSuffix(value: string): number {
  // Remove commas and spaces
  const noCommas = value.replace(/,/g, '').replace(/\s/g, '');

  // Check for suffixes (case insensitive)
  const suffixMatch = noCommas.match(/^([\d.]+)\s*([KMGTB])$/i);
  if (suffixMatch && suffixMatch[1] && suffixMatch[2]) {
    const numPart = parseFloat(suffixMatch[1]);
    const suffix = suffixMatch[2].toUpperCase();
    return applyMultiplier(numPart, suffix);
  }

  // Check for scientific notation
  if (noCommas.includes('E') || noCommas.includes('e')) {
    return parseFloat(noCommas);
  }

  // Standard number parsing
  return parseFloat(noCommas);
}

/**
 * Apply size multiplier based on suffix
 *
 * @param value - Base numeric value
 * @param suffix - Unit suffix (K, M, G, T, B)
 * @returns Multiplied value
 */
function applyMultiplier(value: number, suffix: string): number {
  const multipliers: Record<string, number> = {
    K: 1_000,
    M: 1_000_000,
    G: 1_000_000_000,
    T: 1_000_000_000_000,
    B: 1_000_000_000, // Billion (sometimes used)
  };

  const multiplier = multipliers[suffix.toUpperCase()] || 1;
  return value * multiplier;
}

/**
 * Check if a value is a special AWR null/empty indicator
 *
 * @param value - String to check
 * @returns True if value represents null/empty
 */
export function isSpecialValue(value: string): boolean {
  const specialValues = [
    'n/a',
    'na',
    'null',
    '-',
    '--',
    '---',
    'none',
    'unknown',
    '.',
    '*',
    '#',
  ];

  const lower = value.toLowerCase().trim();
  return specialValues.includes(lower);
}

// ==================== Percentage Parsing ====================

/**
 * Parse a percentage value from AWR format
 *
 * @param value - String value (may include % symbol)
 * @param options - Parsing options
 * @returns Percentage as decimal (e.g., 95.5 for "95.5%")
 *
 * @example
 * parsePercentage('95.5%') // 95.5
 * parsePercentage('0.955') // 95.5 (if detected as ratio)
 * parsePercentage('.98') // 98
 */
export function parsePercentage(
  value: string | null | undefined,
  options: NumberParseOptions = {},
): number {
  const { defaultValue = 0 } = options;

  if (value === null || value === undefined) {
    return defaultValue;
  }

  const cleaned = value.toString().trim();

  if (cleaned === '' || isSpecialValue(cleaned)) {
    return defaultValue;
  }

  // Remove percentage sign if present
  const withoutPercent = cleaned.replace(/%/g, '').trim();

  // Parse the number
  const parsed = parseAwrNumber(withoutPercent, options);

  return parsed;
}

// ==================== Bytes/Size Parsing ====================

/**
 * Size unit multipliers in bytes
 */
const BYTE_MULTIPLIERS: Record<string, number> = {
  B: 1,
  KB: 1_024,
  K: 1_024,
  MB: 1_048_576,
  M: 1_048_576,
  GB: 1_073_741_824,
  G: 1_073_741_824,
  TB: 1_099_511_627_776,
  T: 1_099_511_627_776,
  PB: 1_125_899_906_842_624,
  P: 1_125_899_906_842_624,
};

/**
 * Parse a byte size value with unit suffix
 *
 * @param value - String value with optional size unit
 * @param defaultUnit - Default unit if none specified (default: 'B')
 * @returns Size in bytes
 *
 * @example
 * parseBytes('1.5 GB') // 1610612736
 * parseBytes('512M') // 536870912
 * parseBytes('1024', 'KB') // 1048576
 */
export function parseBytes(
  value: string | null | undefined,
  defaultUnit: string = 'B',
): number {
  if (value === null || value === undefined) {
    return 0;
  }

  const cleaned = value.toString().trim().toUpperCase();

  if (cleaned === '' || isSpecialValue(cleaned)) {
    return 0;
  }

  // Match number and optional unit
  const match = cleaned.match(/^([\d,.]+)\s*([A-Z]*B?)?$/);
  if (!match) {
    return 0;
  }

  const numPart = parseAwrNumber(match[1]);
  const unit = match[2] || defaultUnit.toUpperCase();

  const multiplier = BYTE_MULTIPLIERS[unit] || 1;
  return numPart * multiplier;
}

/**
 * Convert bytes to megabytes
 *
 * @param bytes - Byte count
 * @returns Megabytes (decimal)
 */
export function bytesToMb(bytes: number): number {
  return bytes / 1_048_576;
}

/**
 * Convert bytes to gigabytes
 *
 * @param bytes - Byte count
 * @returns Gigabytes (decimal)
 */
export function bytesToGb(bytes: number): number {
  return bytes / 1_073_741_824;
}

// ==================== Integer Parsing ====================

/**
 * Parse a value as integer, truncating any decimal portion
 *
 * @param value - String value to parse
 * @param defaultValue - Default if parsing fails (default: 0)
 * @returns Integer value
 */
export function parseInteger(
  value: string | null | undefined,
  defaultValue: number = 0,
): number {
  const parsed = parseAwrNumber(value, { defaultValue });
  return Math.floor(parsed);
}

/**
 * Parse a value as integer, rounding any decimal portion
 *
 * @param value - String value to parse
 * @param defaultValue - Default if parsing fails (default: 0)
 * @returns Rounded integer value
 */
export function parseIntegerRounded(
  value: string | null | undefined,
  defaultValue: number = 0,
): number {
  const parsed = parseAwrNumber(value, { defaultValue });
  return Math.round(parsed);
}

// ==================== Ratio/Decimal Parsing ====================

/**
 * Parse a ratio value (expected range 0-1 or 0-100)
 *
 * @param value - String value
 * @param asPercentage - If true, convert to 0-100 range (default: false)
 * @returns Ratio value
 */
export function parseRatio(
  value: string | null | undefined,
  asPercentage: boolean = false,
): number {
  const parsed = parseAwrNumber(value);

  if (isNaN(parsed)) {
    return 0;
  }

  // If value > 1 and we want ratio, convert from percentage
  if (!asPercentage && parsed > 1 && parsed <= 100) {
    return parsed / 100;
  }

  // If value <= 1 and we want percentage, convert to percentage
  if (asPercentage && parsed <= 1) {
    return parsed * 100;
  }

  return parsed;
}

// ==================== Formatting Functions ====================

/**
 * Format a number with thousands separators
 *
 * @param value - Number to format
 * @param decimals - Decimal places (default: 2)
 * @returns Formatted string
 */
export function formatNumber(value: number, decimals: number = 2): string {
  if (isNaN(value)) {
    return 'N/A';
  }

  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format a large number with abbreviated suffix
 *
 * @param value - Number to format
 * @param decimals - Decimal places (default: 1)
 * @returns Abbreviated string (e.g., "1.5M")
 */
export function formatAbbreviated(value: number, decimals: number = 1): string {
  if (isNaN(value)) {
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
 * Format a percentage value
 *
 * @param value - Percentage value (0-100)
 * @param decimals - Decimal places (default: 1)
 * @returns Formatted percentage string
 */
export function formatPercentage(value: number, decimals: number = 1): string {
  if (isNaN(value)) {
    return 'N/A';
  }

  return `${value.toFixed(decimals)}%`;
}

// ==================== Validation Functions ====================

/**
 * Check if a parsed number is valid (not NaN or Infinity)
 *
 * @param value - Number to check
 * @returns True if valid
 */
export function isValidNumber(value: number): boolean {
  return !isNaN(value) && isFinite(value);
}

/**
 * Clamp a number to a specified range
 *
 * @param value - Number to clamp
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns Clamped value
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Safe division that returns 0 for division by zero
 *
 * @param numerator - Numerator
 * @param denominator - Denominator
 * @param defaultValue - Value to return for division by zero (default: 0)
 * @returns Division result or default
 */
export function safeDivide(
  numerator: number,
  denominator: number,
  defaultValue: number = 0,
): number {
  if (denominator === 0 || isNaN(denominator)) {
    return defaultValue;
  }
  return numerator / denominator;
}
