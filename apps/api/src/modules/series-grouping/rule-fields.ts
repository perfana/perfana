import { BadRequestException } from '@nestjs/common';
import {
  compileSeriesGroupingRule,
  normalizeAggregations,
  type SeriesGroupingAggregation,
  type SeriesGroupingPreset,
} from '@perfana/shared/utils';

/** What makes a rule a rule: everything a recalculation depends on. */
export interface RuleFields {
  preset: SeriesGroupingPreset;
  pattern: string | null;
  replacement: string;
  aggregations: SeriesGroupingAggregation[];
}

/**
 * Normalise and validate the rule fields. Shared by workload rules and profile rules, so a profile
 * rule is stored exactly as the workload rule it provisions would be.
 *
 * A built-in preset carries its own regex, so a pattern or replacement sent with one is dropped
 * (`ck_series_grouping_rules_custom_pattern` requires the pattern to be NULL there). A custom
 * pattern must pass the same ReDoS guard the worker applies, or the worker would skip the rule with
 * a warning nobody reads. Aggregations are canonicalised rather than stored as sent: the rule hash
 * is taken over this list and decides whether a run reads as stale, so the order the checkboxes
 * happened to be ticked in must not change it.
 */
export function normalizeRuleFields(
  preset: SeriesGroupingPreset,
  pattern: string | null,
  replacement: string | null,
  aggregations: SeriesGroupingAggregation[],
): RuleFields {
  const canonical = normalizeAggregations(aggregations);
  if (canonical.length === 0) throw new BadRequestException('A series grouping rule needs at least one aggregation');
  const fields: RuleFields =
    preset === 'custom'
      ? { preset, pattern: pattern || null, replacement: replacement ?? '', aggregations: canonical }
      : { preset, pattern: null, replacement: '', aggregations: canonical };
  const compiled = compileSeriesGroupingRule(fields);
  if (!compiled.ok) throw new BadRequestException(compiled.error ?? 'Invalid series grouping rule');
  return fields;
}
