/**
 * Series grouping: map series whose names differ only by a generated segment (a Kubernetes pod
 * name, an IP address) onto one group name, so runs can be compared across deployments.
 *
 * This is the ONLY implementation of the rewrite. The worker uses it to build a run's membership,
 * the API for previews and suggestions, the web for the live preview in the dialog. A pattern never
 * reaches Postgres (`regexp_replace` / `~`): Postgres ARE and JavaScript regex are different dialects,
 * and a preview that disagreed with the worker would be worse than no preview.
 *
 * Design: docs/design/2026-11-01-series-grouping-design.md
 */

import { validateRegexPattern } from './safe-regex';

export type SeriesGroupingPreset = 'k8s-pod' | 'k8s-daemonset' | 'ip-port' | 'trailing-id' | 'custom';
export type SeriesGroupingBuiltinPreset = Exclude<SeriesGroupingPreset, 'custom'>;
export type SeriesGroupingAggregation = 'avg' | 'sum' | 'max';

export interface SeriesGroupingRuleSpec {
  preset: SeriesGroupingPreset;
  /** Required for `custom`; ignored for a built-in preset. */
  pattern?: string | null;
  /** `custom` only (`$1` allowed); a built-in preset carries its own. */
  replacement?: string | null;
  aggregation: SeriesGroupingAggregation;
  trackMemberCount: boolean;
}

/** Kubernetes' generated-name alphabet (`k8s.io/apimachinery/pkg/util/rand`): no vowels, no 0/1/3. */
const K8S_ALPHABET = '[bcdfghjklmnpqrstvwxz2456789]';
/** End of the name, or a character a pod name cannot contain. */
const POD_NAME_END = '(?=$|[^a-z0-9-])';

/**
 * Built-in presets. Each passes `validateRegexPattern` (pinned by the spec). The IP pattern is
 * written flat on purpose: `\d{1,3}(?:\.\d{1,3}){3}` is rejected by the guard as a ReDoS shape.
 */
export const SERIES_GROUPING_PRESETS: Readonly<
  Record<SeriesGroupingBuiltinPreset, { label: string; pattern: string; replacement: string }>
> = {
  'k8s-pod': {
    label: 'Kubernetes pod (Deployment / ReplicaSet)',
    pattern: `-${K8S_ALPHABET}{6,10}-${K8S_ALPHABET}{5}${POD_NAME_END}`,
    replacement: '',
  },
  'k8s-daemonset': {
    label: 'Kubernetes pod (DaemonSet / Job)',
    pattern: `-${K8S_ALPHABET}{5}${POD_NAME_END}`,
    replacement: '',
  },
  'ip-port': {
    label: 'IP address and port',
    pattern: String.raw`\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d{1,5})?\b`,
    replacement: '*',
  },
  'trailing-id': {
    label: 'Trailing ID',
    pattern: '[-_][a-z0-9]{4,}$',
    replacement: '',
  },
};

/** Preset order for ties and for display. */
export const SERIES_GROUPING_PRESET_ORDER: readonly SeriesGroupingBuiltinPreset[] = [
  'k8s-pod',
  'k8s-daemonset',
  'ip-port',
  'trailing-id',
];

export const MEMBER_COUNT_SUFFIX = ' (pod count)';
/** `ds_metric_statistics.metric_name` and `ds_metric_series_groups.group_name` are varchar(255). */
export const SERIES_NAME_MAX_LENGTH = 255;

/** Suggestion thresholds (design Decision 5): shipped as defaults, tuned from the suggestion logs. */
export const SUGGEST_MAX_MATCHED_BEFORE = 0.5;
export const SUGGEST_MIN_MATCHED_AFTER = 0.9;

export type CompiledSeriesGroupingRule =
  | { ok: true; regex: RegExp; replacement: string }
  | { ok: false; error: string };

export function compileSeriesGroupingRule(rule: SeriesGroupingRuleSpec): CompiledSeriesGroupingRule {
  let pattern: string;
  let replacement: string;
  if (rule.preset === 'custom') {
    if (typeof rule.pattern !== 'string' || rule.pattern.length === 0) {
      return { ok: false, error: 'A custom series grouping rule needs a pattern' };
    }
    pattern = rule.pattern;
    replacement = rule.replacement ?? '';
  } else {
    const preset = SERIES_GROUPING_PRESETS[rule.preset];
    if (!preset) return { ok: false, error: `Unknown series grouping preset: ${String(rule.preset)}` };
    pattern = preset.pattern;
    replacement = preset.replacement;
  }
  const result = validateRegexPattern(pattern, { flags: 'g' });
  if (!result.safe || !result.regex) {
    return { ok: false, error: result.error ?? 'Invalid pattern' };
  }
  return { ok: true, regex: result.regex, replacement };
}

export interface SeriesGroupingResult {
  /** Every input name -> its group name. */
  mapping: Map<string, string>;
  /** Group name -> its member names, sorted. */
  groups: Map<string, string[]>;
  /** How many inputs were renamed (group differs from the raw name). */
  renamedCount: number;
  /** Group -> member-count series name; only when tracked and the group has a renamed member. */
  memberCountNames: Map<string, string>;
}

/** Code-unit order: locale-independent, so the worker, the API and every browser agree. */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Cut to `max` UTF-16 code units without leaving a lone high surrogate at the end. */
function truncateName(name: string, max: number): string {
  if (name.length <= max) return name;
  let cut = name.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut;
}

export function memberCountSeriesName(group: string): string {
  return truncateName(group, SERIES_NAME_MAX_LENGTH - MEMBER_COUNT_SUFFIX.length) + MEMBER_COUNT_SUFFIX;
}

function groupNameFor(compiled: { regex: RegExp; replacement: string }, raw: string): string {
  // `replace` with a global regex resets lastIndex itself, so one compiled regex can be reused.
  const rewritten = raw.replace(compiled.regex, compiled.replacement);
  // A group name must never be empty: a rewrite that leaves nothing keeps the raw name.
  if (rewritten.trim().length === 0) return raw;
  return truncateName(rewritten, SERIES_NAME_MAX_LENGTH);
}

/**
 * Group `names` under `rule`. Pure and deterministic. Throws on an invalid rule: callers that hold
 * user input validate it first with `compileSeriesGroupingRule` and skip or refuse it.
 */
export function applySeriesGrouping(rule: SeriesGroupingRuleSpec, names: readonly string[]): SeriesGroupingResult {
  const compiled = compileSeriesGroupingRule(rule);
  if (!compiled.ok) throw new Error(compiled.error);

  const unique = Array.from(new Set(names)).sort(byCodeUnit);
  const mapping = new Map<string, string>();
  const members = new Map<string, string[]>();
  const renamedGroups = new Set<string>();
  let renamedCount = 0;

  for (const raw of unique) {
    const group = groupNameFor(compiled, raw);
    mapping.set(raw, group);
    if (group !== raw) {
      renamedCount += 1;
      renamedGroups.add(group);
    }
    const list = members.get(group);
    if (list) list.push(raw);
    else members.set(group, [raw]);
  }

  const groups = new Map<string, string[]>(
    Array.from(members.keys())
      
      .sort(byCodeUnit)
      .map((g) => [g, members.get(g)!]),
  );

  const memberCountNames = new Map<string, string>();
  if (rule.trackMemberCount) {
    const taken = new Set<string>([...unique, ...groups.keys()]);
    for (const group of groups.keys()) {
      if (!renamedGroups.has(group)) continue;
      const name = memberCountSeriesName(group);
      // Never emit two series under one name.
      if (taken.has(name)) continue;
      taken.add(name);
      memberCountNames.set(group, name);
    }
  }

  return { mapping, groups, renamedCount, memberCountNames };
}

/** FNV-1a 32-bit, as 8 hex characters. No crypto dependency, so the web bundle can import it. */
function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Identifies the grouping a run was computed with; a different hash means the run is stale. */
export function seriesGroupingRuleHash(rule: SeriesGroupingRuleSpec): string {
  return fnv1a32(
    [rule.preset, rule.pattern ?? '', rule.replacement ?? '', rule.aggregation, rule.trackMemberCount ? '1' : '0'].join(
      '\u0000',
    ),
  );
}

export interface PresetEvaluation {
  preset: SeriesGroupingBuiltinPreset;
  /** Fraction of the current run's raw names that also exist in the baseline. */
  matchedBefore: number;
  /** Fraction of the current run's groups that also exist in the baseline's groups. */
  matchedAfter: number;
  currentGroups: number;
}

/**
 * Score every built-in preset on how much it improves name matching between a run and its
 * baseline. Sorted by `matchedAfter` descending, then preset order. Drives the suggestions and the
 * dialog's "(detected)" preselection.
 */
export function evaluateGroupingPresets(
  current: readonly string[],
  baseline: readonly string[],
): PresetEvaluation[] {
  const currentUnique = Array.from(new Set(current));
  const baselineSet = new Set(baseline);
  const matchedBefore =
    currentUnique.length === 0 ? 0 : currentUnique.filter((n) => baselineSet.has(n)).length / currentUnique.length;

  const evaluations = SERIES_GROUPING_PRESET_ORDER.map((preset): PresetEvaluation => {
    const spec: SeriesGroupingRuleSpec = { preset, aggregation: 'avg', trackMemberCount: false };
    const currentGroups = Array.from(applySeriesGrouping(spec, currentUnique).groups.keys());
    const baselineGroups = new Set(applySeriesGrouping(spec, baseline).groups.keys());
    const matched = currentGroups.filter((g) => baselineGroups.has(g)).length;
    return {
      preset,
      matchedBefore,
      matchedAfter: currentGroups.length === 0 ? 0 : matched / currentGroups.length,
      currentGroups: currentGroups.length,
    };
  });

  return evaluations.sort(
    (a, b) =>
      b.matchedAfter - a.matchedAfter ||
      SERIES_GROUPING_PRESET_ORDER.indexOf(a.preset) - SERIES_GROUPING_PRESET_ORDER.indexOf(b.preset),
  );
}
