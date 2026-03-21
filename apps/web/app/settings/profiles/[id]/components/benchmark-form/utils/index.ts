import { getUnit } from '@/lib/units';
import { ParsedValue } from '../types';

/**
 * Pattern definitions for parsing values with units
 */
const VALUE_PATTERNS = [
  { regex: /^(\d+(?:\.\d+)?)\s*(ms|milliseconds?)$/i, unitId: 'ms' },
  { regex: /^(\d+(?:\.\d+)?)\s*(s|seconds?)$/i, unitId: 's' },
  { regex: /^(\d+(?:\.\d+)?)\s*(m|minutes?)$/i, unitId: 'm' },
  { regex: /^(\d+(?:\.\d+)?)\s*(h|hours?)$/i, unitId: 'h' },
  { regex: /^(\d+(?:\.\d+)?)\s*(%|percent)$/i, unitId: 'percent' },
  { regex: /^(\d+(?:\.\d+)?)\s*(b|bytes?)$/i, unitId: 'bytes' },
  { regex: /^(\d+(?:\.\d+)?)\s*(kb|kilobytes?)$/i, unitId: 'kbytes' },
  { regex: /^(\d+(?:\.\d+)?)\s*(mb|megabytes?)$/i, unitId: 'mbytes' },
  { regex: /^(\d+(?:\.\d+)?)\s*(gb|gigabytes?)$/i, unitId: 'gbytes' },
  { regex: /^(\d+(?:\.\d+)?)\s*(req\/s|requests?\s*per\s*second)$/i, unitId: 'reqps' },
  { regex: /^(\d+(?:\.\d+)?)\s*(ops\/s|operations?\s*per\s*second)$/i, unitId: 'ops' },
];

/**
 * Parse a value string to extract the numeric value and unit
 */
export function parseValueWithUnit(input: string): ParsedValue {
  for (const pattern of VALUE_PATTERNS) {
    const match = input.match(pattern.regex);
    if (match) {
      return {
        value: match[1],
        unit: match[2],
        unitId: pattern.unitId,
      };
    }
  }
  return { value: input, unit: '', unitId: '' };
}

/**
 * Get the detected unit name from a value string
 */
export function getDetectedUnit(value: string): string {
  const parsed = parseValueWithUnit(value);
  if (parsed.unitId) {
    const unit = getUnit(parsed.unitId);
    return unit.name || '';
  }
  return '';
}

/**
 * Process a requirement value for percentunit conversion
 */
export function processPercentUnitValue(value: string, isPercentUnit: boolean): string {
  if (!isPercentUnit) return value;

  const parsedValue = parseValueWithUnit(value);
  if (parsedValue.value && !isNaN(Number(parsedValue.value))) {
    // Convert percentage (e.g., 95) to decimal (e.g., 0.95) for percentunit
    let processedValue = String(Number(parsedValue.value) / 100);
    if (parsedValue.unit) {
      processedValue += parsedValue.unit;
    }
    return processedValue;
  }
  return value;
}

/**
 * Validate that a value is a valid number (with optional unit)
 */
export function isValidNumericValue(value: string): boolean {
  const parsed = parseValueWithUnit(value);
  return !!parsed.value && !isNaN(Number(parsed.value));
}

/**
 * Get helper text for requirement value field
 */
export function getRequirementValueHelperText(
  value: string,
  panelFormat: string | null | undefined,
  validationError?: string
): string {
  if (validationError) return validationError;

  const detectedUnit = getDetectedUnit(value);
  const expectedUnit = panelFormat ? getUnit(panelFormat) : null;

  if (detectedUnit) {
    return `Unit: ${detectedUnit}`;
  } else if (expectedUnit?.name) {
    return `Expected unit: ${expectedUnit.name}`;
  }
  return 'Enter threshold value';
}

/**
 * Get placeholder text for requirement value field
 */
export function getRequirementValuePlaceholder(panelFormat: string | null | undefined): string {
  if (panelFormat) {
    const unit = getUnit(panelFormat);
    return `e.g. 500${unit.format || ''}`;
  }
  return 'e.g. 500ms, 0.95%, 2GB, 50req/s';
}
