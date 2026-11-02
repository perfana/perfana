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

/**
 * The extras checkbox label, derived rather than duplicated: a second map reworded
 * independently would describe the same radio/checkbox pair two different ways, and no test or
 * type would catch it.
 */
export function extraAggregationLabel(aggregation: SeriesGroupingAggregation): string {
  // Falls back to the raw value, matching how `SeriesGroupingRulesSection` renders the PRIMARY
  // aggregation three lines away (`AGGREGATION_LABELS[rule.aggregation] ?? rule.aggregation`).
  // The settings list maps this over `rule.extraAggregations ?? []`, which is whatever the database
  // holds; an unindexed value would throw inside render and take the whole page down with it, where
  // the map this replaced could only ever have produced `undefined`. Unreachable while migration
  // 1820's CHECK holds, but the CHECK is not what render should depend on.
  return (AGGREGATION_LABELS[aggregation] ?? aggregation).toLowerCase();
}

export function presetLabel(preset: SeriesGroupingPreset): string {
  return preset === 'custom' ? 'Custom regex' : (SERIES_GROUPING_PRESETS[preset]?.label ?? preset);
}

/** The prefix of the artificial perf-test dashboards, which never take a rule (the API refuses them). */
export const PERF_TEST_DASHBOARD_UID_PREFIX = 'performance-test-metrics-';
