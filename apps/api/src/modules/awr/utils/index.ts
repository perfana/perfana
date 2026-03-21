/**
 * AWR Utility Functions
 *
 * Barrel export for all AWR report parsing utilities.
 * These utilities handle HTML parsing, number formats, and time values
 * commonly found in Oracle AWR HTML reports.
 *
 * @module awr/utils
 */

// HTML parsing utilities
export {
  // Core functions
  loadHtml,
  extractText,
  findTableByIdentifier,
  findSectionHeading,
  getSectionContent,
  // Table parsing
  extractTableHeaders,
  parseTableRowToArray,
  parseTableToObjects,
  parseTableToArray,
  // AWR-specific helpers
  extractLabeledValue,
  isAwrReport,
  getTablesInSection,
  // Types
  type TableRow,
  type TableParseOptions,
} from './html-utils';

// Number parsing utilities
export {
  // Core parsing
  parseAwrNumber,
  isSpecialValue,
  parsePercentage,
  parseBytes,
  parseInteger,
  parseIntegerRounded,
  parseRatio,
  // Byte conversions
  bytesToMb,
  bytesToGb,
  // Formatting
  formatNumber,
  formatAbbreviated,
  formatPercentage,
  // Validation
  isValidNumber,
  clamp,
  safeDivide,
  // Types
  type ParsedNumber,
  type NumberParseOptions,
} from './number-utils';

// Time parsing utilities
export {
  // Core parsing
  parseTimeToSeconds,
  parseAwrTimestamp,
  calculateElapsedMinutes,
  // Conversions
  convertFromSeconds,
  convertTime,
  secondsToMs,
  msToSeconds,
  secondsToMinutes,
  minutesToSeconds,
  secondsToHours,
  centisecondsToSeconds,
  // Formatting
  formatDuration,
  formatTimeAuto,
  formatMs,
  // Validation
  isValidTime,
  ensurePositiveTime,
  // Types
  type TimeUnit,
  type ParsedTime,
  type TimeParseOptions,
} from './time-utils';
