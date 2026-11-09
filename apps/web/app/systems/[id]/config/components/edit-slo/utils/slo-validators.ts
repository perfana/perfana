import { SLOFormData, ValidationErrors, ParsedValueWithUnit } from '../types';
import { convertThresholdToPanelUnit, type ThresholdConversion } from '@/lib/units';

/**
 * Unit parsing patterns for recognizing values with units
 */
const UNIT_PATTERNS = [
  { regex: /^(\d+(?:\.\d+)?)\s*(ms|milliseconds?)$/i, unitId: 'ms' },
  { regex: /^(\d+(?:\.\d+)?)\s*(s|seconds?)$/i, unitId: 's' },
  { regex: /^(\d+(?:\.\d+)?)\s*(m|minutes?)$/i, unitId: 'm' },
  { regex: /^(\d+(?:\.\d+)?)\s*(h|hours?)$/i, unitId: 'h' },
  { regex: /^(\d+(?:\.\d+)?)\s*(%|percent)$/i, unitId: 'percent' },
  { regex: /^(\d+(?:\.\d+)?)\s*(b|bytes?)$/i, unitId: 'bytes' },
  { regex: /^(\d+(?:\.\d+)?)\s*(kb|kilobytes?)$/i, unitId: 'kb' },
  { regex: /^(\d+(?:\.\d+)?)\s*(mb|megabytes?)$/i, unitId: 'mb' },
  { regex: /^(\d+(?:\.\d+)?)\s*(gb|gigabytes?)$/i, unitId: 'gb' },
  { regex: /^(\d+(?:\.\d+)?)\s*(req\/s|requests?\s*per\s*second)$/i, unitId: 'req_per_s' },
  { regex: /^(\d+(?:\.\d+)?)\s*(ops\/s|operations?\s*per\s*second)$/i, unitId: 'ops_per_s' },
];

/**
 * Supported Grafana panel types for SLO configuration
 */
export const SUPPORTED_PANEL_TYPES = ['graph', 'timeseries', 'stat', 'singlestat', 'flamegraph'];

/**
 * Parse a value string to extract numeric value and unit
 */
export function parseValueWithUnit(input: string): ParsedValueWithUnit {
  for (const pattern of UNIT_PATTERNS) {
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
 * Validate the SLO form data and return validation errors
 */
export function validateSLOForm(sloFormData: SLOFormData): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!sloFormData.selectedDashboard) {
    errors.selectedDashboard = 'Dashboard is required';
  }

  if (!sloFormData.selectedPanel) {
    errors.selectedPanel = 'Metric is required';
  }

  if (!sloFormData.requirementValue || sloFormData.requirementValue.trim() === '') {
    errors.requirementValue = 'Requirement value is required';
  } else {
    // Validate requirement value is numeric (with optional unit)
    const result = convertThresholdInput(sloFormData.requirementValue, thresholdUnitFormat(sloFormData));
    if (!result) {
      errors.requirementValue = 'Requirement value must be a valid number';
    } else if ('error' in result) {
      errors.requirementValue = result.error;
    }
  }

  // Validate default value if validateWithDefaultIfNoData is enabled
  if (sloFormData.validateWithDefaultIfNoData) {
    if (!sloFormData.validateWithDefaultIfNoDataValue || sloFormData.validateWithDefaultIfNoDataValue.trim() === '') {
      errors.validateWithDefaultIfNoDataValue = 'Default value is required when "Use Default If No Data" is enabled';
    } else {
      // Validate that default value is also numeric if it contains a value
      const result = convertThresholdInput(sloFormData.validateWithDefaultIfNoDataValue, thresholdUnitFormat(sloFormData));
      if (!result) {
        errors.validateWithDefaultIfNoDataValue = 'Default value must be a valid number';
      } else if ('error' in result) {
        errors.validateWithDefaultIfNoDataValue = result.error;
      }
    }
  }

  return errors;
}

/**
 * Check if the form is valid for submission
 */
export function isFormValid(
  systemId: string,
  environment: string,
  workload: string,
  sloFormData: SLOFormData
): boolean {
  return (
    !!systemId &&
    !!environment &&
    !!workload &&
    !!sloFormData.selectedDashboard &&
    !!sloFormData.selectedPanel &&
    !!sloFormData.requirementValue &&
    sloFormData.requirementValue.trim() !== '' &&
    (!sloFormData.validateWithDefaultIfNoData ||
      (!!sloFormData.validateWithDefaultIfNoDataValue &&
        sloFormData.validateWithDefaultIfNoDataValue.trim() !== ''))
  );
}

/**
 * The unit an SLO's threshold is stored in: the panel's, except for a trend, which is
 * %/h whatever the panel measures and so has nothing to convert against.
 */
export function thresholdUnitFormat(sloFormData: Pick<SLOFormData, 'selectedPanel' | 'evaluateType'>): string | undefined {
  if (sloFormData.evaluateType === 'trend') return undefined;
  return sloFormData.selectedPanel?.yAxesFormat || sloFormData.selectedPanel?.metricUnit || undefined;
}

/** Parse "500ms" and convert it to `unitFormat`; null when the input is not a number. */
export function convertThresholdInput(value: string, unitFormat: string | undefined): ThresholdConversion | null {
  const parsed = parseValueWithUnit(value.trim());
  if (parsed.value === '' || !Number.isFinite(Number(parsed.value))) return null;
  return convertThresholdToPanelUnit(Number(parsed.value), parsed.unitId, unitFormat);
}

/**
 * Turn what the user typed into the number the API stores: the suffix is stripped (the API
 * coerces with Number(), so "500ms" used to be saved as NaN, #717) and converted to the
 * panel's unit (#718), so "500ms" on a seconds panel is stored as 0.5 and 95 on a
 * percentunit panel as 0.95. Input that is not a number, or whose unit cannot be converted,
 * is returned unchanged for validation and the API to reject.
 */
export function toStoredThresholdValue(value: string, unitFormat: string | undefined): string {
  const result = convertThresholdInput(value, unitFormat);
  return result && !('error' in result) ? String(result.value) : value;
}

/**
 * Convert decimal to percentage for display (e.g., 0.95 -> 95)
 */
export function convertDecimalToPercentageForDisplay(
  value: number | string | undefined,
  unitFormat: string | undefined
): string {
  if (unitFormat !== 'percentunit' || value === undefined) {
    return value?.toString() || '';
  }

  const numValue = Number(value);
  if (!isNaN(numValue) && numValue < 1) {
    return (numValue * 100).toString();
  }
  return value.toString();
}
