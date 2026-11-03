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
/** `count` is the number of members reporting at a timestamp — the old `track_member_count`. */
export type SeriesGroupingAggregation = 'avg' | 'sum' | 'max' | 'count';

export interface SeriesGroupingRuleSpec {
  preset: SeriesGroupingPreset;
  /** Required for `custom`; ignored for a built-in preset. */
  pattern?: string | null;
  /** `custom` only (`$1` allowed); a built-in preset carries its own. */
  replacement?: string | null;
  /**
   * Which series a renamed group emits, one each, named `<group> (avg)` / `(sum)` / `(max)` /
   * `(count)`. At least one; order is irrelevant (`normalizeAggregations` canonicalises it).
   *
   * **Every one is suffixed and none keeps the bare group name**, which is what makes a rule
   * edit purely additive: ticking or unticking a box adds or removes a series and never changes
   * what an existing one measures. The first design kept one "primary" unsuffixed so that
   * baselines, SLOs and compare configs stored against the bare name went on matching — a
   * constraint that only exists where such rows already exist, and that bought a three-way UI
   * (Combine / Also add / Also track), two name builders, a rename warning and a primary-takeover
   * prune. This feature ships greenfield, so none of it is needed.
   */
  aggregations: readonly SeriesGroupingAggregation[];
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

/** `ds_metric_statistics.metric_name` and `ds_metric_series_groups.group_name` are varchar(255). */
export const SERIES_NAME_MAX_LENGTH = 255;

/** Canonical order, for the CHECK constraint, the DTO, the UI and the hash. */
export const SERIES_GROUPING_AGGREGATIONS: readonly SeriesGroupingAggregation[] = ['avg', 'sum', 'max', 'count'];

/**
 * The aggregations that scale with the number of members, so a scale-out moves them on its own:
 * double the pods and `sum` doubles, `count` doubles, while `avg` and `max` do not.
 *
 * This is what decides which derived series get an UNCLASSIFIED `ds_compare_config` row. Everything
 * in `ds_metric_statistics` reaches `ds_adapt_results` and `buildConclusionSQL` flips a run on
 * `regression_count > 0`, so without it a scale-out would be reported as a regression — the exact
 * case this feature exists to let a reader rule out. `avg` and `max` deliberately get no such row
 * and inherit the panel's classification, because a genuine regression in either SHOULD flag.
 */
export const MEMBER_COUNT_DEPENDENT_AGGREGATIONS: readonly SeriesGroupingAggregation[] = ['sum', 'count'];

/**
 * The series name an aggregation emits for a renamed group. The worker's grouped statement rebuilds
 * it as `group_name || ' (' || agg || ')'`, so this concatenation and that one must stay identical.
 *
 * The suffix is the stored aggregation verbatim, including `count` — so the member count reads
 * `api (count)` rather than the old `api (pod count)`. One rule with no lookup table beats a nicer
 * word that has to be mapped identically in JS and in SQL, and "pod" was wrong anyway for the
 * IP-and-port and trailing-id presets. The dialog still labels it "Number of pods".
 */
export function groupSeriesName(group: string, aggregation: SeriesGroupingAggregation): string {
  return `${group} (${aggregation})`;
}

/**
 * Known values only, de-duplicated, in canonical order. Order is canonicalised because the rule
 * hash is taken over it, and the hash decides whether a run reads as stale — so the order the
 * checkboxes happened to be ticked in must not change it.
 *
 * An empty result is possible (a stored row holding only junk) and is NOT defaulted: the DTO's
 * `@ArrayNotEmpty` and the CHECK refuse it on the way in, and a rule that somehow emits nothing is
 * skipped with a warning rather than silently treated as `avg`.
 */
export function normalizeAggregations(
  aggregations: readonly SeriesGroupingAggregation[] | null | undefined,
): SeriesGroupingAggregation[] {
  const requested = new Set(aggregations ?? []);
  return SERIES_GROUPING_AGGREGATIONS.filter((a) => requested.has(a));
}

/** Suggestion thresholds (design Decision 5): shipped as defaults, tuned from the suggestion logs. */
export const SUGGEST_MAX_MATCHED_BEFORE = 0.5;
export const SUGGEST_MIN_MATCHED_AFTER = 0.9;

/**
 * One flat shape rather than a discriminated union on purpose: the API's test tsconfig runs with
 * `strictNullChecks: false`, where narrowing on a boolean discriminant does not work, and every
 * consumer of this type would then fail to type-check there. Check `ok`; `regex` is set exactly
 * when it is true, `error` exactly when it is false.
 */
export interface CompiledSeriesGroupingRule {
  ok: boolean;
  regex: RegExp | null;
  replacement: string;
  error: string | null;
}

const refused = (error: string): CompiledSeriesGroupingRule => ({ ok: false, regex: null, replacement: '', error });

export function compileSeriesGroupingRule(rule: SeriesGroupingRuleSpec): CompiledSeriesGroupingRule {
  let pattern: string;
  let replacement: string;
  if (rule.preset === 'custom') {
    if (typeof rule.pattern !== 'string' || rule.pattern.length === 0) {
      return refused('A custom series grouping rule needs a pattern');
    }
    pattern = rule.pattern;
    replacement = rule.replacement ?? '';
  } else {
    const preset = SERIES_GROUPING_PRESETS[rule.preset];
    if (!preset) return refused(`Unknown series grouping preset: ${String(rule.preset)}`);
    pattern = preset.pattern;
    replacement = preset.replacement;
  }
  const result = validateRegexPattern(pattern, { flags: 'g' });
  if (!result.safe || !result.regex) {
    return refused(result.error ?? 'Invalid pattern');
  }
  return { ok: true, regex: result.regex, replacement, error: null };
}

export interface SeriesGroupingResult {
  /** Every input name -> its group name. */
  mapping: Map<string, string>;
  /** Group name -> its member names, sorted. */
  groups: Map<string, string[]>;
  /** How many inputs were renamed (group differs from the raw name). */
  renamedCount: number;
  /**
   * Group -> the aggregations it actually emits, in canonical order, each as `<group> (agg)`.
   *
   * **Only RENAMED groups appear here.** A series the rule left alone is a group of one whose
   * group name IS its raw name; it passes through under that name untouched, exactly as before
   * this feature existed. Suffixing it would rename a series the rule was never meant to touch,
   * and all four aggregations of a single member are the same number anyway (bar `count`, which
   * would be a constant 1). `isRenamed` is how a caller tells the two apart.
   */
  seriesAggregations: Map<string, SeriesGroupingAggregation[]>;
  /** Group -> whether the rule renamed it. False means it passes through under its own name. */
  isRenamed: Map<string, boolean>;
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
  if (!compiled.ok || !compiled.regex) throw new Error(compiled.error ?? 'Invalid series grouping rule');
  const rewrite = { regex: compiled.regex, replacement: compiled.replacement };

  const unique = Array.from(new Set(names)).sort(byCodeUnit);
  const mapping = new Map<string, string>();
  const members = new Map<string, string[]>();
  const renamedGroups = new Set<string>();
  let renamedCount = 0;

  for (const raw of unique) {
    const group = groupNameFor(rewrite, raw);
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

  // Every name already spoken for. A derived series must never collide with one of them: the
  // statistics insert would then carry two rows for one metric_name.
  const taken = new Set<string>([...unique, ...groups.keys()]);

  const isRenamed = new Map<string, boolean>();
  const seriesAggregations = new Map<string, SeriesGroupingAggregation[]>();
  const aggregations = normalizeAggregations(rule.aggregations);

  for (const group of groups.keys()) {
    const renamed = renamedGroups.has(group);
    isRenamed.set(group, renamed);
    if (!renamed) continue;
    const kept: SeriesGroupingAggregation[] = [];
    for (const aggregation of aggregations) {
      const name = groupSeriesName(group, aggregation);
      // Dropped rather than truncated: the worker rebuilds this name by concatenation in SQL,
      // where a truncated one would not match. A group within 8 characters of the column limit
      // is pathological; losing a series beats emitting a name that disagrees with the SQL.
      if (name.length > SERIES_NAME_MAX_LENGTH || taken.has(name)) continue;
      taken.add(name);
      kept.push(aggregation);
    }
    if (kept.length > 0) seriesAggregations.set(group, kept);
  }

  return { mapping, groups, renamedCount, seriesAggregations, isRenamed };
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
  // Canonicalised first, so ticking the same boxes in a different order is the same rule and the
  // insights page does not report every grouped run as stale for a change that is not one.
  const parts = [
    rule.preset,
    rule.pattern ?? '',
    rule.replacement ?? '',
    normalizeAggregations(rule.aggregations).join(','),
  ];
  return fnv1a32(parts.join('\u0000'));
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
    // Only the rewrite matters here; which series a group emits does not affect preset scoring.
    const spec: SeriesGroupingRuleSpec = { preset, aggregations: ['avg'] };
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
