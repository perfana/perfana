/**
 * Which compare-config template wins a `ds_compare_config` row, and what that row's configuration
 * becomes. Pure: `applyGoldenPathClassifications` does the matching and the I/O.
 */

export interface GoldenPathTemplate {
  id: string;
  organization_id?: string | null;
  /** Set on a profile template; the applier only passes one whose profile matches the run. */
  profile_id?: string | null;
  /** The profile's name, joined in by the applier: precedence step 4. */
  profile_name?: string | null;
  dashboard_uid?: string | null;
  regex: boolean;
  panel_id?: number | null;
  panel_title?: string | null;
  metric_name?: string | null;
  metric_classification?: string | null;
  higher_is_better?: boolean | null;
  config_overrides?: Record<string, unknown> | null;
}

/** 0 exact uid, 1 regex uid, 2 wildcard (no uid). */
export const dashboardTier = (t: GoldenPathTemplate): number => (!t.dashboard_uid ? 2 : t.regex ? 1 : 0);
/** 0 panel id, 1 literal title, 2 regex title. */
export const panelTier = (t: GoldenPathTemplate): number => (t.panel_id != null ? 0 : t.regex ? 2 : 1);
/** 0 profile, 1 organization, 2 install-wide. */
export const scopeTier = (t: GoldenPathTemplate): number => (t.profile_id ? 0 : t.organization_id ? 1 : 2);

const rank = (t: GoldenPathTemplate): number[] => [dashboardTier(t), scopeTier(t), panelTier(t)];

/**
 * The most specific candidate, by dashboard match, then scope (profile, organization, install-wide),
 * then panel match, then profile name, then template id. Two candidates still level after the panel
 * step tie: the profile name (two profiles the run matches) or the id decides them, stable but
 * arbitrary, so the tie is returned for the run's summary line. Overlapping regexes (`^jvm-.*`,
 * `^jvm-prod.*`) and a run tagged for two profiles are the usual ways to get one.
 *
 * Callers pass only templates whose `metric_name` equals the row's (NULL to NULL): a panel template
 * must never claim a series-grouping derived row like `api (sum)`, which is unclassified on purpose.
 */
export function selectWinner(candidates: GoldenPathTemplate[]): {
  winner: GoldenPathTemplate | undefined;
  tiedWith: GoldenPathTemplate | undefined;
} {
  const sorted = [...candidates].sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i]! - rb[i]!;
    const [na, nb] = [a.profile_name ?? '', b.profile_name ?? ''];
    if (na !== nb) return na < nb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const [winner, next] = sorted;
  const tied = winner && next && rank(winner).every((r, i) => r === rank(next)[i]);
  return { winner, tiedWith: tied ? next : undefined };
}

/**
 * Whether the template forces a direction. Presence in `config_overrides` is the rule. The column
 * counts too when it is set, which is what migration 1822's backfill writes into the overrides
 * anyway, so the two readings agree on every migrated row.
 */
const namedHigherIsBetter = (t: GoldenPathTemplate): { named: boolean; value: boolean | null } => {
  const overrides = t.config_overrides ?? {};
  if ('higherIsBetter' in overrides) return { named: true, value: (overrides.higherIsBetter as boolean | null) ?? null };
  if (t.higher_is_better != null) return { named: true, value: t.higher_is_better };
  return { named: false, value: null };
};

/** Template override key -> `config_data.thresholds` key. */
const THRESHOLD_FIELDS: Record<string, string> = {
  absThreshold: 'absoluteThreshold',
  percentageThreshold: 'percentageThreshold',
  iqrThreshold: 'iqrThreshold',
  aggregation: 'aggregation',
  minSampleCount: 'minSampleCount',
};
/** Template override keys stored at the top level of `config_data`. */
const TOP_LEVEL_FIELDS = ['ignore', 'defaultValueIfControlGroupMissing'];

/**
 * A deep copy of a jsonb value. Not `structuredClone`: under Jest that returns objects from Node's
 * outer realm, whose prototypes `isDeepStrictEqual` then refuses to match against the spec's own,
 * and every comparison reads as "changed".
 */
export const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const asObject = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * `base` plus the fields the template names, and nothing else. A field the template does not name
 * comes from the base, so dropping it from a template reverts the row on its next re-merge. With no
 * template the row is the base.
 */
export function rebuildConfig(
  base: Record<string, unknown>,
  template: GoldenPathTemplate | undefined,
): Record<string, unknown> {
  const out = cloneJson(base);
  if (!template) return out;

  const direction = namedHigherIsBetter(template);
  const previous = asObject(out.metricClassification);
  out.metricClassification = {
    ...previous,
    classification: template.metric_classification ?? 'none',
    higherIsBetter: direction.named ? direction.value : (previous.higherIsBetter ?? null),
  };

  const overrides = template.config_overrides ?? {};
  const thresholdKeys = Object.keys(THRESHOLD_FIELDS).filter((k) => k in overrides);
  if (thresholdKeys.length > 0) {
    const thresholds = { ...asObject(out.thresholds) };
    for (const k of thresholdKeys) thresholds[THRESHOLD_FIELDS[k]!] = overrides[k];
    out.thresholds = thresholds;
  }
  for (const k of TOP_LEVEL_FIELDS) if (k in overrides) out[k] = overrides[k];
  return out;
}

/**
 * What a row the applier inserts starts from: the defaults the insert has always written. Stored as
 * the row's `template_base`, so a row whose template is removed reverts to exactly this.
 */
export const INSERT_BASE: Readonly<Record<string, unknown>> = Object.freeze({
  thresholds: { aggregation: 'mean', iqrThreshold: 2, absoluteThreshold: null, percentageThreshold: 0.15 },
  metricClassification: { classification: 'none', higherIsBetter: null },
  // No defaultValueIfControlGroupMissing: ADAPT reads it since v0.2.97.66, so absent means "off".
  // Migration 1824 stripped the 0 earlier versions stored here and in config_data.
});
