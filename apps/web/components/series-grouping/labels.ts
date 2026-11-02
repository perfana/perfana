import {
  SERIES_GROUPING_PRESETS,
  type SeriesGroupingAggregation,
  type SeriesGroupingPreset,
} from '@perfana/shared/utils';

/** How a rule combines its members per timestamp, in the dialog's and the settings list's words. */
export const AGGREGATION_LABELS: Record<SeriesGroupingAggregation, string> = {
  avg: 'Average per pod',
  sum: 'Total',
  max: 'Highest pod',
};

export function presetLabel(preset: SeriesGroupingPreset): string {
  return preset === 'custom' ? 'Custom regex' : (SERIES_GROUPING_PRESETS[preset]?.label ?? preset);
}

/** The prefix of the artificial perf-test dashboards, which never take a rule (the API refuses them). */
export const PERF_TEST_DASHBOARD_UID_PREFIX = 'performance-test-metrics-';
