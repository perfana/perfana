import { SloPanel } from '../types';
import { getUnit, unitLabel } from '@/lib/units';
import { EvaluateTypeOption, RequirementOperatorOption, SourceOption, DataSourceAvailability } from '../types';
import { parseValueWithUnit, getEffectiveUnitFormat, convertThresholdInput } from './slo-validators';

/**
 * Get dynamic source options based on data availability
 */
export function getSourceOptions(dataSourceAvailability: DataSourceAvailability): SourceOption[] {
  const options: SourceOption[] = [];

  // Always include Grafana
  options.push({ value: 'grafana', label: 'Grafana' });

  // Include Dynatrace only if data exists
  if (dataSourceAvailability.hasDynatraceData) {
    options.push({ value: 'dynatrace', label: 'Dynatrace' });
  }

  // Include Performance metrics only if data exists
  if (dataSourceAvailability.hasPerfMetricsData) {
    options.push({ value: 'performance-metrics', label: 'Performance metrics' });
  }

  return options;
}

/**
 * Evaluate type options with descriptions
 */
export const EVALUATE_TYPE_OPTIONS: EvaluateTypeOption[] = [
  { value: 'avg', label: 'Average', description: 'Calculate the average value across all data points' },
  { value: 'max', label: 'Maximum', description: 'Use the maximum value observed' },
  { value: 'min', label: 'Minimum', description: 'Use the minimum value observed' },
  { value: 'last', label: 'Last Value', description: 'Use the most recent value recorded' },
  { value: 'trend', label: 'Trend', description: 'Drift over the analysis window as % of the series mean per hour; positive means rising' },
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
  trend: 'Trend',
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
  trend: 'Drift over the analysis window as % of the series mean per hour; positive means rising',
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
  const labels: Record<string, string> = {
    grafana: 'Grafana',
    dynatrace: 'Dynatrace',
    'performance-metrics': 'Performance metrics',
  };
  return {
    value,
    label: labels[value] || value,
  };
}

/**
 * Get placeholder text for requirement value input
 */
/** A realistic threshold per panel unit; '500 s' or '500 %' on a 0-1 panel suggested nonsense (#721). */
const PLACEHOLDER_VALUES: Record<string, string> = {
  ns: '500000', 'µs': '500', ms: '500', dtdurationms: '500', s: '0.5', dtdurations: '0.5', m: '5', h: '1', d: '1',
  percent: '90', percentunit: '90',
  bytes: '1048576', decbytes: '1000000', kbytes: '512', deckbytes: '500', mbytes: '512', decmbytes: '500',
  gbytes: '2', decgbytes: '2',
};

export function getRequirementValuePlaceholder(selectedPanel: SloPanel | null | undefined): string {
  const effectiveUnitFormat = selectedPanel?.yAxesFormat || selectedPanel?.metricUnit;
  if (effectiveUnitFormat) {
    return `e.g. ${PLACEHOLDER_VALUES[effectiveUnitFormat] ?? '100'} ${unitLabel(effectiveUnitFormat)}`.trim();
  }
  return 'e.g. 500ms, 95%, 2GB, 50req/s';
}

/**
 * Get helper text for requirement value input
 */
export function getRequirementValueHelperText(
  value: string,
  selectedPanel: SloPanel | null | undefined,
  evaluateType?: string
): string {
  const effectiveUnitFormat = selectedPanel?.yAxesFormat || selectedPanel?.metricUnit;
  // Say what will be stored when the typed unit differs from the panel's, or why it can't be.
  const result = convertThresholdInput(value, evaluateType === 'trend' ? undefined : effectiveUnitFormat);
  if (result && 'error' in result) return result.error;
  if (result?.from && result.to && unitLabel(result.from) !== unitLabel(result.to)) {
    return `${parseValueWithUnit(value.trim()).value} ${unitLabel(result.from)} = ${result.value} ${unitLabel(result.to)}`;
  }
  const detectedUnit = getDetectedUnit(value);
  const expectedUnit = effectiveUnitFormat ? getUnit(effectiveUnitFormat) : null;

  if (detectedUnit) {
    return `Unit: ${detectedUnit}`;
  } else if (expectedUnit?.name) {
    return `Expected unit: ${expectedUnit.name}`;
  }
  return 'Enter threshold value';
}

/**
 * Get the unit chip label for a value
 */
export function getUnitChipLabel(value: string, selectedPanel: SloPanel | null | undefined, evaluateType?: string): string | null {
  // A trend is % of the series mean per hour regardless of what the panel measures.
  if (evaluateType === 'trend') return '%/h';
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
