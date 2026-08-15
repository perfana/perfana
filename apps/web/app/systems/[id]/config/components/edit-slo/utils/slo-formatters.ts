import { SloPanel } from '../types';
import { getUnit } from '@/lib/units';
import { EvaluateTypeOption, RequirementOperatorOption, SourceOption } from '../types';
import { parseValueWithUnit } from './slo-validators';

/**
 * Source options for SLO configuration
 */
export const SOURCE_OPTIONS: SourceOption[] = [
  { value: 'grafana', label: 'Grafana' },
  { value: 'dynatrace', label: 'Dynatrace' },
];

/**
 * Evaluate type options with descriptions
 */
export const EVALUATE_TYPE_OPTIONS: EvaluateTypeOption[] = [
  { value: 'avg', label: 'Average', description: 'Calculate the average value across all data points' },
  { value: 'max', label: 'Maximum', description: 'Use the maximum value observed' },
  { value: 'min', label: 'Minimum', description: 'Use the minimum value observed' },
  { value: 'last', label: 'Last Value', description: 'Use the most recent value recorded' },
  { value: 'q50', label: '50th Percentile', description: 'Median value - 50% of values are below this' },
  { value: 'q90', label: '90th Percentile', description: '90% of values are below this threshold' },
  { value: 'q95', label: '95th Percentile', description: '95% of values are below this threshold' },
  { value: 'q99', label: '99th Percentile', description: '99% of values are below this threshold' },
];

/**
 * Requirement operator options with descriptions
 */
export const REQUIREMENT_OPERATOR_OPTIONS: RequirementOperatorOption[] = [
  { value: 'lt', label: 'Less than (<)', description: 'Metric value must be below the threshold' },
  { value: 'lte', label: 'Less than or equal (≤)', description: 'Metric value must be at or below the threshold' },
  { value: 'gt', label: 'Greater than (>)', description: 'Metric value must be above the threshold' },
  { value: 'gte', label: 'Greater than or equal (≥)', description: 'Metric value must be at or above the threshold' },
  { value: 'eq', label: 'Equal to (=)', description: 'Metric value must exactly match the threshold' },
  { value: 'ne', label: 'Not equal to (≠)', description: 'Metric value must not match the threshold' },
];

/**
 * Label mappings for evaluate types
 */
export const EVALUATE_TYPE_LABELS: Record<string, string> = {
  avg: 'Average',
  max: 'Maximum',
  min: 'Minimum',
  last: 'Last Value',
  q50: '50th Percentile',
  q90: '90th Percentile',
  q95: '95th Percentile',
  q99: '99th Percentile',
};

/**
 * Description mappings for evaluate types
 */
export const EVALUATE_TYPE_DESCRIPTIONS: Record<string, string> = {
  avg: 'Calculate the average value across all data points',
  max: 'Use the maximum value observed',
  min: 'Use the minimum value observed',
  last: 'Use the most recent value recorded',
  q50: 'Median value - 50% of values are below this',
  q90: '90% of values are below this threshold',
  q95: '95% of values are below this threshold',
  q99: '99% of values are below this threshold',
};

/**
 * Label mappings for requirement operators
 */
export const REQUIREMENT_OPERATOR_LABELS: Record<string, string> = {
  lt: 'Less than (<)',
  lte: 'Less than or equal (≤)',
  gt: 'Greater than (>)',
  gte: 'Greater than or equal (≥)',
  eq: 'Equal to (=)',
  ne: 'Not equal to (≠)',
};

/**
 * Description mappings for requirement operators
 */
export const REQUIREMENT_OPERATOR_DESCRIPTIONS: Record<string, string> = {
  lt: 'Metric value must be below the threshold',
  lte: 'Metric value must be at or below the threshold',
  gt: 'Metric value must be above the threshold',
  gte: 'Metric value must be at or above the threshold',
  eq: 'Metric value must exactly match the threshold',
  ne: 'Metric value must not match the threshold',
};

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
 * Get the evaluate type option object from value
 */
export function getEvaluateTypeOption(value: string): EvaluateTypeOption {
  return {
    value,
    label: EVALUATE_TYPE_LABELS[value] || value,
    description: EVALUATE_TYPE_DESCRIPTIONS[value] || '',
  };
}

/**
 * Get the requirement operator option object from value
 */
export function getRequirementOperatorOption(value: string): RequirementOperatorOption {
  return {
    value,
    label: REQUIREMENT_OPERATOR_LABELS[value] || value,
    description: REQUIREMENT_OPERATOR_DESCRIPTIONS[value] || '',
  };
}

/**
 * Get source option object from value
 */
export function getSourceOption(value: string): SourceOption | null {
  if (!value) return null;
  const knownLabels: Record<string, string> = {
    grafana: 'Grafana',
    dynatrace: 'Dynatrace',
    custom: 'Custom',
    prometheus: 'Prometheus',
    influxdb: 'InfluxDB',
  };
  return {
    value,
    label: knownLabels[value] || value.charAt(0).toUpperCase() + value.slice(1),
  };
}

/**
 * Get placeholder text for requirement value input
 */
export function getRequirementValuePlaceholder(selectedPanel: SloPanel | null | undefined): string {
  const effectiveUnitFormat = selectedPanel?.yAxesFormat || selectedPanel?.metricUnit;
  if (effectiveUnitFormat) {
    const unit = getUnit(effectiveUnitFormat);
    return `e.g. 500${unit.format || ''}`;
  }
  return 'e.g. 500ms, 0.95%, 2GB, 50req/s';
}

/**
 * Get helper text for requirement value input
 */
export function getRequirementValueHelperText(value: string, selectedPanel: SloPanel | null | undefined): string {
  const detectedUnit = getDetectedUnit(value);
  const effectiveUnitFormat = selectedPanel?.yAxesFormat || selectedPanel?.metricUnit;
  const expectedUnit = effectiveUnitFormat ? getUnit(effectiveUnitFormat) : null;

  if (detectedUnit) {
    return `Unit: ${detectedUnit}`;
  } else if (expectedUnit?.name) {
    return `Expected unit: ${expectedUnit.name}`;
  }
  return 'Enter threshold value';
}

/**
 * Get the effective unit format from a panel
 */
export function getEffectiveUnitFormat(selectedPanel: SloPanel | null | undefined): string | undefined {
  return selectedPanel?.yAxesFormat || selectedPanel?.metricUnit;
}

/**
 * Get the unit chip label for a value
 */
export function getUnitChipLabel(value: string, selectedPanel: SloPanel | null | undefined): string | null {
  const parsed = parseValueWithUnit(value);
  const effectiveUnitFormat = getEffectiveUnitFormat(selectedPanel);
  const panelUnit = effectiveUnitFormat ? getUnit(effectiveUnitFormat) : null;

  if (parsed.unit || panelUnit?.format) {
    return parsed.unit || panelUnit?.format || '';
  }
  return null;
}

/**
 * Determine if unit chip should be primary color
 */
export function isUnitChipPrimary(value: string): boolean {
  const parsed = parseValueWithUnit(value);
  return !!parsed.unit;
}
