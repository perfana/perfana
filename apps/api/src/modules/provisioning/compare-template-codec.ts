import * as yaml from 'js-yaml';
import { validateRegexPattern } from '@perfana/shared/utils';

/**
 * One file format for compare-config templates, read by provisioning and written by the exporter.
 *
 * Both directions live here so they cannot drift: a field the reader accepts and the writer drops
 * would be pruned on the next boot after an export is committed. `compare-template-codec.spec.ts`
 * round-trips a canonical file through both.
 */

/** The values the anomaly card's aggregation select offers (`MetricConfigForm.tsx`). */
export const TEMPLATE_AGGREGATIONS = [
  'mean', 'median', 'min', 'max', 'last', 'q10', 'q25', 'q75', 'q90', 'q95', 'q99',
] as const;

/**
 * Fields a template forces onto a `ds_compare_config` row, in export order. They are stored in
 * `config_overrides` only when the item names them, explicit `null` included, because presence is
 * what makes a template force a value rather than leave the row's own.
 */
export const OVERRIDE_KEYS = [
  'higherIsBetter',
  'absThreshold',
  'ignore',
  'ignoreMeanDiffSmallerThan',
  'percentageThreshold',
  'iqrThreshold',
  'aggregation',
  'minSampleCount',
  'defaultValueIfControlGroupMissing',
] as const;
export type OverrideKey = (typeof OVERRIDE_KEYS)[number];

export interface MetricClassificationYaml {
  /** Overrides the file-level `organizationId`. `null` means install-wide. */
  organizationId?: string | null;
  /**
   * A profile's name: the template applies only to runs whose tags match that profile, in its
   * organization. Resolved by name, like `profile_benchmarks.yaml`. The organization is the
   * profile's; an `organizationId` that names another one (on the item or the file) skips the item.
   * The export names it on the item in a file spanning several organizations, so a profile name
   * another organization takes later cannot claim the template. `profileId`, `profileName` and
   * `profiles` are refused, not ignored.
   */
  profile?: string;
  /** Omit to apply the template to every dashboard carrying the panel. */
  dashboardUid?: string;
  /** `true`: `dashboardUid` and `panelTitle` are regular expressions. */
  regex?: boolean;
  /** Descriptive only; not part of the template's identity. */
  dashboardLabel?: string;
  /** Omit to select panels by `panelTitle` instead, resolved per dashboard from its collected panels. */
  panelId?: number;
  /** Descriptive beside `panelId`; the matching key when `panelId` is omitted. */
  panelTitle?: string;
  /** Omit for a panel-level template. A metric-level template only reaches rows of that metric. */
  metricName?: string;
  metricClassification: string;
  /** `null` forces "no direction", which no regression can fail a run on. */
  higherIsBetter?: boolean | null;
  absThreshold?: number | null;
  ignore?: boolean;
  ignoreMeanDiffSmallerThan?: number;
  /** A fraction, as stored: 0.15 is 15 %. */
  percentageThreshold?: number;
  iqrThreshold?: number;
  aggregation?: (typeof TEMPLATE_AGGREGATIONS)[number];
  /** Floored, and clamped to at least 1, the way the worker reads it. */
  minSampleCount?: number;
  defaultValueIfControlGroupMissing?: number;
}

/** The template-table columns the file decides. */
export interface TemplateColumns {
  /** A profile template's organization is a copy of its profile's, for the audit log; never key. */
  organization_id: string | null;
  profile_id: string | null;
  dashboard_uid: string | null;
  regex: boolean;
  dashboard_label: string | null;
  panel_id: number | null;
  panel_title: string | null;
  metric_name: string | null;
  metric_classification: string;
  higher_is_better: boolean | null;
  config_overrides: Record<string, unknown>;
}

type KeyColumns = Partial<
  Pick<
    TemplateColumns,
    'organization_id' | 'profile_id' | 'dashboard_uid' | 'regex' | 'panel_id' | 'panel_title' | 'metric_name'
  >
> & {
  /** A profile template's profile name: orders profiles in the export (names are unique). Not key. */
  profile_name?: string | null;
};

/**
 * A template's identity: the same five terms as `COMPARE_TEMPLATE_KEY_SQL` in migration 1823, whose
 * unique index enforces it. A profile template's scope is its profile alone; everything else is
 * scoped by organization, or install-wide. Encoded as JSON so a `|` inside a uid cannot make two
 * keys collide.
 */
export function templateKey(row: KeyColumns): string {
  return JSON.stringify([
    row.profile_id ? `profile:${row.profile_id}` : `org:${row.organization_id ?? 'install'}`,
    row.dashboard_uid ?? '',
    row.regex ?? false,
    row.panel_id != null ? String(row.panel_id) : `title:${row.panel_title}`,
    row.metric_name ?? '',
  ]);
}

export type ParsedTemplateItem =
  | { ok: true; key: string; values: TemplateColumns; warnings: string[] }
  /**
   * `key` is null when the item's identity could not be read, so nothing it names is declared.
   * `unresolvedProfile` names a profile that does not exist: such an item has no key either (a
   * profile template's key is its profile's id), so provisioning protects from the prune the
   * templates of every profile no resolved item reaches. A misspelt `profile` key has no key and no
   * `unresolvedProfile`, so it counts as unidentified and nothing is pruned that boot.
   * `profileMismatch` names a profile item whose organization is not its profile's: it
   * keeps its key, and provisioning protects that name's templates the same way.
   */
  | { ok: false; key: string | null; error: string; unresolvedProfile?: string; profileMismatch?: string };

/** A profile as the parser needs it. */
export interface TemplateProfileRef {
  id: string;
  organizationId: string;
}

export interface ParseTemplateOptions {
  /** Resolves an item's `profile` by name. Without it, an item naming a profile fails. */
  resolveProfile?: (name: string) => TemplateProfileRef | null | undefined;
}

/** Every key an item may carry. Anything else is reported: a misspelt override forces nothing. */
const KNOWN_KEYS = new Set<string>([
  'organizationId', 'profile', 'dashboardUid', 'regex', 'dashboardLabel', 'panelId', 'panelTitle', 'metricName',
  'metricClassification', ...OVERRIDE_KEYS,
]);
/** The config_data spellings an operator copies from a stored row, mapped to the file's own. */
const NEAR_MISSES: Record<string, string> = { absoluteThreshold: 'absThreshold', higherIsbetter: 'higherIsBetter' };
/**
 * Misspellings of `profile`, two of them the API response's own field names. Unlike a misspelt
 * override, which forces nothing, ignoring one of these WIDENS the template from a profile to its
 * organization or the whole install, so the item is refused rather than warned about.
 */
const SCOPE_NEAR_MISSES = ['profileId', 'profileName', 'profiles'] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * An organization id as Postgres returns it: lowercase, hyphenated. It is part of the template's
 * key, so a spelling the database would store differently (upper case, braces) never matches its
 * own row: the insert collides and the prune deletes the stored row, on every other boot. A value
 * that is not a uuid at all would fail every insert while the prune deleted every stored template.
 */
const canonicalOrganizationId = (v: unknown): string | null | Error => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && UUID.test(v.trim())) return v.trim().toLowerCase();
  return new Error('organizationId must be a uuid or null');
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Optional text field: absent is fine, present must be non-empty text. */
const optionalText = (item: Record<string, unknown>, field: string): string | null | Error => {
  if (!(field in item) || item[field] === undefined) return null;
  return isText(item[field]) ? (item[field] as string) : new Error(`${field} must be a non-empty string`);
};

/**
 * Reads one item of `template_ds_compare_configs.yaml`. The file is operator-written, so every
 * field is checked: a wrong type, a non-finite number or an unknown aggregation fails the item.
 * Identity is read first, so an item failing on any other field still declares its key and the
 * template it already provisioned survives the prune.
 */
export function parseTemplateItem(
  item: unknown,
  fileOrganizationId: string | null,
  options: ParseTemplateOptions = {},
): ParsedTemplateItem {
  if (!isObject(item)) return { ok: false, key: null, error: 'item is not a mapping' };
  // No key and no `unresolvedProfile`: an item whose scope cannot be read is unidentified, so nothing is
  // pruned that boot. Reporting it as an unresolved profile would spare only unreached profiles, and a
  // misspelt `profileName: jvm` beside correctly spelt `jvm` items would then prune its own template.
  const scopeMiss = SCOPE_NEAR_MISSES.find((k) => k in item);
  if (scopeMiss) {
    return {
      ok: false,
      key: null,
      error:
        `unknown field "${scopeMiss}": a template's profile is named with "profile" in the file, or by the ` +
        `/profiles/:id route in the API. Refused rather than ignored: ignoring it would widen the template ` +
        `to its organization or the install`,
    };
  }

  // ---- identity
  const statedOrganization = 'organizationId' in item || fileOrganizationId != null;
  let organizationId = canonicalOrganizationId('organizationId' in item ? item.organizationId : fileOrganizationId);
  if (organizationId instanceof Error) return { ok: false, key: null, error: organizationId.message };
  let profile: TemplateProfileRef | null = null;
  if ('profile' in item && item.profile !== undefined) {
    if (!isText(item.profile)) return { ok: false, key: null, error: 'profile must be a non-empty string' };
    if (!options.resolveProfile) return { ok: false, key: null, error: 'profile is not accepted here' };
    profile = options.resolveProfile(item.profile) ?? null;
    if (!profile) {
      return { ok: false, key: null, error: `profile "${item.profile}" not found`, unresolvedProfile: item.profile };
    }
  }
  const dashboardUid = optionalText(item, 'dashboardUid');
  const panelTitle = optionalText(item, 'panelTitle');
  const metricName = optionalText(item, 'metricName');
  for (const v of [dashboardUid, panelTitle, metricName]) {
    if (v instanceof Error) return { ok: false, key: null, error: v.message };
  }
  if (item.regex !== undefined && typeof item.regex !== 'boolean') {
    return { ok: false, key: null, error: 'regex must be true or false' };
  }
  if (item.panelId !== undefined && !Number.isInteger(item.panelId)) {
    return { ok: false, key: null, error: 'panelId must be an integer' };
  }
  const panelId = (item.panelId as number | undefined) ?? null;
  if (panelId == null && panelTitle == null) {
    return { ok: false, key: null, error: 'panelId or panelTitle is required' };
  }
  // A profile template's organization is its profile's. A stated one that differs is a contradiction
  // the file cannot mean (the template would never reach the runs it names), so the item is skipped;
  // its key is still declared below, so the template it already provisioned is not pruned.
  let organizationMismatch: string | null = null;
  if (profile) {
    const profileOrganization = profile.organizationId.toLowerCase();
    if (statedOrganization && organizationId !== profileOrganization) {
      organizationMismatch = `organizationId ${organizationId ?? 'null (install-wide)'} is not the organization of profile "${item.profile as string}" (${profileOrganization})`;
    }
    organizationId = profileOrganization;
  }
  const identity = {
    organization_id: organizationId,
    profile_id: profile?.id ?? null,
    dashboard_uid: dashboardUid as string | null,
    regex: (item.regex as boolean | undefined) ?? false,
    panel_id: panelId,
    panel_title: panelTitle as string | null,
    metric_name: metricName as string | null,
  };
  const key = templateKey(identity);
  const fail = (error: string): ParsedTemplateItem => ({ ok: false, key, error });
  // The profile the file means (this name, in that organization) is not there: a renamed profile
  // whose name another organization now holds reads exactly like this, so provisioning protects
  // that name's templates from the prune as it does for a profile that is not found.
  if (organizationMismatch) return { ok: false, key, error: organizationMismatch, profileMismatch: item.profile as string };

  // ---- attributes
  const dashboardLabel = optionalText(item, 'dashboardLabel');
  if (dashboardLabel instanceof Error) return fail(dashboardLabel.message);
  if (!isText(item.metricClassification)) return fail('metricClassification is required');
  // A regex template runs on the event loop inside the completion request, against uids and titles
  // Grafana editors control; the same guard the profile benchmarks use. The pattern is part of the
  // key, so a refused item never replaces a stored row: the applier runs the same check on what is
  // stored and skips the template. The title is a pattern only when there is no panelId.
  if (identity.regex) {
    const patterns = [['dashboardUid', identity.dashboard_uid], ['panelTitle', panelId == null ? identity.panel_title : null]] as const;
    for (const [field, pattern] of patterns) {
      if (pattern == null) continue;
      const check = validateRegexPattern(pattern, { maxLength: 255 });
      if (!check.safe) return fail(`${field} is not a usable regular expression: ${check.error}`);
    }
  }

  const overrides: Record<string, unknown> = {};
  const warnings: string[] = Object.keys(item)
    .filter((k) => !KNOWN_KEYS.has(k))
    .map((k) => `unknown field "${k}" ignored${Object.hasOwn(NEAR_MISSES, k) ? ` (did you mean "${NEAR_MISSES[k]}"?)` : ''}`);
  for (const field of OVERRIDE_KEYS) {
    if (!(field in item) || item[field] === undefined) continue;
    const v = item[field];
    switch (field) {
      case 'higherIsBetter':
      case 'ignore':
        if (typeof v !== 'boolean' && !(field === 'higherIsBetter' && v === null)) {
          return fail(`${field} must be ${field === 'higherIsBetter' ? 'true, false or null' : 'true or false'}`);
        }
        break;
      case 'absThreshold':
        if (v !== null && !(isFiniteNumber(v) && v >= 0)) return fail('absThreshold must be a number of at least 0, or null');
        break;
      case 'percentageThreshold':
        // A fraction, as stored. `15` meaning 15 % would read as 1500 % and never flag a regression.
        if (!isFiniteNumber(v) || v < 0 || v > 1) return fail('percentageThreshold must be a fraction from 0 to 1 (0.15 is 15 %)');
        break;
      case 'iqrThreshold':
      case 'ignoreMeanDiffSmallerThan':
        if (!isFiniteNumber(v) || v < 0) return fail(`${field} must be a number of at least 0`);
        break;
      case 'aggregation':
        if (!(TEMPLATE_AGGREGATIONS as readonly unknown[]).includes(v)) {
          return fail(`aggregation must be one of ${TEMPLATE_AGGREGATIONS.join(', ')}`);
        }
        break;
      case 'minSampleCount':
        // The worker's untrusted rule (root CLAUDE.md, ADAPT_MIN_SAMPLE_COUNT): a non-number is
        // ignored, a fraction floored, anything below 1 clamped to 1. Store what it will read.
        if (!isFiniteNumber(v)) {
          warnings.push('minSampleCount is not a number and was ignored');
          continue;
        }
        overrides.minSampleCount = Math.max(1, Math.floor(v));
        continue;
      default:
        if (!isFiniteNumber(v)) return fail(`${field} must be a finite number`);
    }
    overrides[field] = v;
  }

  return {
    ok: true,
    key,
    warnings,
    values: {
      ...identity,
      dashboard_label: dashboardLabel as string | null,
      metric_classification: item.metricClassification,
      higher_is_better: 'higherIsBetter' in overrides ? (overrides.higherIsBetter as boolean | null) : null,
      config_overrides: overrides,
    },
  };
}

/** A row as the exporter reads it: the columns, plus a profile template's profile name. */
export type ExportRow = Partial<TemplateColumns> & { profile_name?: string | null };

/**
 * Row -> item. A key is written exactly when it is present on the row, never dropped for equalling a
 * default. A profile template names its profile, and in a file spanning several organizations also
 * its profile's organization: profile names are one install-wide namespace, so without it a name
 * another organization later takes would claim the template on the next boot. With it, that item
 * fails the organization check instead (and an older API that ignores `profile` widens it only to
 * that organization, never to the install).
 */
export function rowToItem(row: ExportRow, withOrganization: boolean): MetricClassificationYaml {
  const item: Record<string, unknown> = {};
  if (withOrganization) item.organizationId = row.organization_id ?? null;
  if (row.profile_id) item.profile = row.profile_name ?? row.profile_id;
  if (row.dashboard_uid != null) item.dashboardUid = row.dashboard_uid;
  if (row.regex) item.regex = true;
  if (row.dashboard_label != null) item.dashboardLabel = row.dashboard_label;
  if (row.panel_id != null) item.panelId = row.panel_id;
  if (row.panel_title != null) item.panelTitle = row.panel_title;
  if (row.metric_name != null) item.metricName = row.metric_name;
  item.metricClassification = row.metric_classification;
  const overrides = row.config_overrides ?? {};
  for (const field of OVERRIDE_KEYS) {
    if (field in overrides) item[field] = overrides[field];
    // An older API strips the key and keeps the column; the applier reads it the same way
    // (namedHigherIsBetter), so an export must not drop the direction.
    else if (field === 'higherIsBetter' && row.higher_is_better != null) item.higherIsBetter = row.higher_is_better;
  }
  return item as unknown as MetricClassificationYaml;
}

const byText = (a: string | null | undefined, b: string | null | undefined): number => {
  if (a == null || b == null) return Number(a != null) - Number(b != null); // absent first
  return a < b ? -1 : a > b ? 1 : 0; // code-unit order: locale-independent, so byte-stable
};

/** 0 install-wide, 1 organization, 2 profile. */
const scopeRank = (r: KeyColumns): number => (r.profile_id ? 2 : r.organization_id ? 1 : 0);

/**
 * The export's total order over the key: scope (install-wide, then organizations by id, then
 * profiles by name), uid (absent first), regex (false first), panel (ids ascending before titles),
 * metric (absent first).
 */
export function compareTemplateRows(a: KeyColumns, b: KeyColumns): number {
  const scope = scopeRank(a) - scopeRank(b);
  if (scope !== 0) return scope;
  return (
    (a.profile_id
      ? byText(a.profile_name ?? a.profile_id, b.profile_name ?? b.profile_id) || byText(a.profile_id, b.profile_id)
      : byText(a.organization_id, b.organization_id)) ||
    byText(a.dashboard_uid, b.dashboard_uid) ||
    Number(a.regex ?? false) - Number(b.regex ?? false) ||
    Number(a.panel_id == null) - Number(b.panel_id == null) ||
    // Beside an id the title is descriptive, not key, so it must not order two id items.
    (a.panel_id != null && b.panel_id != null ? a.panel_id - b.panel_id : byText(a.panel_title, b.panel_title)) ||
    byText(a.metric_name, b.metric_name)
  );
}

/**
 * The whole `template_ds_compare_configs.yaml`, ready to commit in place of the installed one. Its
 * caller is `GET /provisioning/compare-templates/export` (`CompareTemplatesService.exportYaml`).
 * When every row shares one organization the file carries it once (and an install-wide file carries
 * none); otherwise each organization or install-wide item names its own, `null` for install-wide.
 * A profile template's row must carry its profile's CURRENT organization (the caller joins it): it
 * counts towards that decision, because a file-level organizationId the profile is not in would
 * skip the item on the next boot, and in a mixed file the item names it beside its profile.
 */
export function serializeTemplates(rows: ExportRow[]): string {
  const sorted = [...rows].sort(compareTemplateRows);
  const scopes = new Set(sorted.map((r) => r.organization_id ?? null));
  const mixed = scopes.size > 1;
  const doc: Record<string, unknown> = {};
  const fileOrganizationId = mixed ? null : (sorted[0]?.organization_id ?? null);
  if (fileOrganizationId) doc.organizationId = fileOrganizationId;
  doc.items = sorted.map((r) => rowToItem(r, mixed));
  return yaml.dump(doc, { lineWidth: -1, noRefs: true });
}
