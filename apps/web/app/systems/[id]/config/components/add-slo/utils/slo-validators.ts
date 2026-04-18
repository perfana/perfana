import { getUnit } from '@/lib/units';
import { SLOFormData, ValidationErrors, ParsedValueWithUnit } from '../types';

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
 * Get detected unit from a value string
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
    const parsedValue = parseValueWithUnit(sloFormData.requirementValue);
    if (!parsedValue.value || isNaN(Number(parsedValue.value))) {
      errors.requirementValue = 'Requirement value must be a valid number';
    }
  }

  // Validate default value if validateWithDefaultIfNoData is enabled
  if (sloFormData.validateWithDefaultIfNoData) {
    if (!sloFormData.validateWithDefaultIfNoDataValue || sloFormData.validateWithDefaultIfNoDataValue.trim() === '') {
      errors.validateWithDefaultIfNoDataValue = 'Default value is required when "Use Default If No Data" is enabled';
    } else {
      // Validate that default value is also numeric if it contains a value
      const parsedDefaultValue = parseValueWithUnit(sloFormData.validateWithDefaultIfNoDataValue);
      if (!parsedDefaultValue.value || isNaN(Number(parsedDefaultValue.value))) {
        errors.validateWithDefaultIfNoDataValue = 'Default value must be a valid number';
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
 * Process requirement value for percentunit format
 * Converts percentage to decimal (e.g., 95 -> 0.95)
 */
export function processPercentunitValue(value: string, unitFormat: string | undefined): string {
  if (unitFormat !== 'percentunit') {
    return value;
  }

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
 * Get the effective unit format from a panel
 */
export function getEffectiveUnitFormat(selectedPanel: unknown): string | undefined {
  return selectedPanel?.yAxesFormat || selectedPanel?.metricUnit;
}
