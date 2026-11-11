/**
 * The choices an ADAPT compare config offers, shared by the anomaly card's settings form
 * (`MetricConfigForm`) and the ADAPT template dialog, so the two cannot offer different lists.
 * `AGGREGATION_OPTIONS` mirrors `TEMPLATE_AGGREGATIONS` in
 * `apps/api/src/modules/provisioning/compare-template-codec.ts`, which refuses anything else.
 */

export const CLASSIFICATION_OPTIONS = [
  { value: 'unclassified', label: 'Unclassified' },
  { value: 'RED_duration', label: 'RED Duration' },
  { value: 'RED_rate', label: 'RED Rate' },
  { value: 'RED_errors', label: 'RED Errors' },
  { value: 'USE_saturation', label: 'USE Saturation' },
  { value: 'USE_utilization', label: 'USE Utilization' },
  { value: 'USE_errors', label: 'USE Errors' },
  { value: 'business_metric', label: 'Business Metric' },
  { value: 'infrastructure_metric', label: 'Infrastructure Metric' },
  { value: 'application_metric', label: 'Application Metric' },
  { value: 'custom', label: 'Custom' },
] as const;

export const AGGREGATION_OPTIONS = [
  { value: 'mean', label: 'Mean' },
  { value: 'median', label: 'Median' },
  { value: 'min', label: 'Minimum' },
  { value: 'max', label: 'Maximum' },
  { value: 'last', label: 'Last Value' },
  { value: 'q10', label: '10th Percentile' },
  { value: 'q25', label: '25th Percentile' },
  { value: 'q75', label: '75th Percentile' },
  { value: 'q90', label: '90th Percentile' },
  { value: 'q95', label: '95th Percentile' },
  { value: 'q99', label: '99th Percentile' },
] as const;

/** A label for a stored value, falling back to the value itself (a provisioned file may carry any text). */
export function optionLabel(options: ReadonlyArray<{ value: string; label: string }>, value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}
