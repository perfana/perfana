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
 * The unit the threshold field is converted against: the form's one `thresholdUnit`, except
 * for a trend, which is %/h whatever the panel measures and so has nothing to convert against.
 */
export function thresholdUnitFormat(sloFormData: Pick<SLOFormData, 'thresholdUnit' | 'evaluateType'>): string | undefined {
  if (sloFormData.evaluateType === 'trend') return undefined;
  return sloFormData.thresholdUnit || undefined;
}

const DECIMAL = /^-?(\d+(\.\d*)?|\.\d+)$/;

/** Parse "500ms" and convert it to `unitFormat`; null when the input is not a number. */
export function convertThresholdInput(value: string, unitFormat: string | undefined): ThresholdConversion | null {
  const parsed = parseValueWithUnit(value.trim());
  // A plain decimal only: Number() also takes '0x10', '1e3' and 'Infinity' (#721).
  if (!DECIMAL.test(parsed.value)) return null;
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

/** `metric_unit` of a trend SLO (benchmark-mutation.service.ts): a label, not a unit. */
const TREND_UNIT = '%/h';

/**
 * The unit an existing SLO's threshold is stored in, read from its own record: Edit's
 * `thresholdUnit` at open (#719 — display and save once read different fields and a
 * percentunit SLO shrank 100x per save). '%/h' is skipped per candidate: it is the label the
 * API writes into `metric_unit` for a trend, never a unit a value can be converted to, and a
 * former trend keeps it after being edited to avg. The evaluate type is not consulted here;
 * `thresholdUnitFormat` drops the unit for a trend.
 */
export function storedThresholdUnit(benchmark: {
  metric_unit?: string;
  configuration?: { yAxesFormat?: string; metricUnit?: string } | null;
}): string | undefined {
  return [benchmark.configuration?.yAxesFormat, benchmark.configuration?.metricUnit, benchmark.metric_unit]
    .find((unit) => unit && unit !== TREND_UNIT) || undefined;
}

/**
 * Take the live panel's (or Dynatrace metric's) unit as `thresholdUnit` when the record had
 * none: a perf-test SLO saved before v0.2.97.58, a former trend. A record WITH a unit keeps it,
 * even when the panel's has changed since: the number on screen and in the database is in the
 * record's unit (the dialog warns about the difference instead of relabelling it).
 *
 * The one unit that changes how the value is shown is percentunit (0-1 stored, 0-100 shown).
 * The field was filled showing the raw stored number, so it is re-shown scaled — but only while
 * it still holds exactly that, and only when the record is not a trend (a trend's number is %/h,
 * not a panel value). If the user already typed over it, the unit is not adopted: their bare
 * number was entered against no unit and is saved as typed (#719, never scaled twice).
 */
export function adoptPanelUnit(
  prev: SLOFormData,
  liveUnit: string | undefined,
  benchmark: {
    evaluate_type?: string;
    requirement_value?: number | string;
    configuration?: { validateWithDefaultIfNoDataValue?: number | string | null } | null;
  },
): SLOFormData {
  if (prev.thresholdUnit || !liveUnit || liveUnit === TREND_UNIT) return prev;
  if (liveUnit !== 'percentunit' || benchmark.evaluate_type === 'trend') return { ...prev, thresholdUnit: liveUnit };
  // Per field: still the raw stored number -> re-show it scaled; a typed suffix ("90%") is
  // unambiguous and converts under the adopted unit as typed; a typed bare number blocks adoption.
  const rescale = (shown: string, stored: number | string | undefined): string | null => {
    if (shown === convertDecimalToPercentageForDisplay(stored, undefined)) {
      return convertDecimalToPercentageForDisplay(stored, liveUnit);
    }
    return parseValueWithUnit(shown.trim()).unitId ? shown : null;
  };
  const requirementValue = rescale(prev.requirementValue, benchmark.requirement_value);
  const validateWithDefaultIfNoDataValue = rescale(
    prev.validateWithDefaultIfNoDataValue,
    benchmark.configuration?.validateWithDefaultIfNoDataValue ?? undefined,
  );
  if (requirementValue === null || validateWithDefaultIfNoDataValue === null) return prev;
  return { ...prev, thresholdUnit: liveUnit, requirementValue, validateWithDefaultIfNoDataValue };
}

/**
 * Convert a stored percentunit decimal to the percentage the user edits (0.95 -> 95), the
 * inverse of toStoredThresholdValue. Every value is scaled, 1 (100%) and above included:
 * the checks compare the panel's 0-1 values against it, so nothing is stored as 0-100.
 */
export function convertDecimalToPercentageForDisplay(
  value: number | string | undefined,
  unitFormat: string | undefined
): string {
  if (unitFormat !== 'percentunit' || value === undefined) {
    return value?.toString() || '';
  }

  const numValue = Number(value);
  if (!Number.isFinite(numValue)) return value.toString();
  // toPrecision drops float noise: 0.009 * 100 is 0.8999999999999999.
  return String(Number((numValue * 100).toPrecision(12)));
}
