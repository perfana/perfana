import { profileMatchesRun } from '@perfana/shared/utils/profile-match';
import type { CompareTemplateDefinition } from '@/lib/compare-templates';
import type { CopyTarget } from '@/app/settings/profiles/adapt-templates/components/CopyTemplateDialog';

/**
 * "Save as template" on the anomaly card's row settings form (design §6, PR 3): turns the row being
 * tuned into an ADAPT template. The row itself is not touched, so it stays a hand edit and the
 * workload it came from keeps exactly the config the user saved.
 */

/** The row the template is promoted from. */
export interface PromoteSource {
  dashboardUid?: string | null;
  dashboardLabel?: string;
  panelId: string | number;
  panelTitle: string;
  metricName: string | null;
}

/** The form's values, as the form holds them: the percentage is a percent (15), not a fraction. */
export interface PromotedConfig {
  ignore: boolean;
  classification: string;
  higherIsBetter: boolean;
  aggregation: string;
  percentageThreshold: number | null;
  iqrThreshold: number | null;
  absoluteThreshold: number | null;
  defaultValueIfControlGroupMissing: number | null;
}

/**
 * `uid`: this dashboard only (its exact uid, with the panel id). `title`: every dashboard carrying a
 * panel of this title, with no uid, which is what a Dynatrace host or perf-test scenario dashboard
 * needs: those have one uid per host or per scenario.
 */
export type PromoteDashboardScope = 'uid' | 'title';

/**
 * Dashboards whose uid is per host or per scenario, so "this dashboard" is almost never what the
 * user means there and "every dashboard with this panel title" is the default.
 */
const PER_ENTITY_UID = /^(dynatrace-|performance-test-metrics-)/;

export function defaultDashboardScope(source: PromoteSource, formScope: string): PromoteDashboardScope {
  if (!source.dashboardUid) return 'title';
  if (formScope === 'all-dashboards') return 'title';
  return PER_ENTITY_UID.test(source.dashboardUid) ? 'title' : 'uid';
}

/**
 * The template definition for a promoted row. A template forces every field it names, so it names
 * what the form shows a value for: classification, direction, aggregation, the thresholds that are
 * set, and `absThreshold: null` when the row has none (no absolute threshold IS the tuned value).
 * `ignore` is named only when on, and the no-baseline value only when set: the form cannot tell
 * "off" from "not chosen" for those, and forcing them off would override other panels' own setting.
 */
export function buildPromotedDefinition(
  source: PromoteSource,
  config: PromotedConfig,
  options: { dashboard: PromoteDashboardScope; metric: boolean },
): CompareTemplateDefinition {
  const panelId = Number(source.panelId);
  const byUid = options.dashboard === 'uid' && !!source.dashboardUid;
  const definition: CompareTemplateDefinition = { metricClassification: config.classification };

  if (byUid) {
    definition.dashboardUid = source.dashboardUid!;
    if (source.dashboardLabel) definition.dashboardLabel = source.dashboardLabel;
  }
  // A panel id is unique only within one dashboard, so it identifies the panel only beside a uid;
  // across dashboards the title is the identity. Beside an id the title is just a label.
  if (byUid && Number.isInteger(panelId)) definition.panelId = panelId;
  definition.panelTitle = source.panelTitle;
  if (options.metric && source.metricName) definition.metricName = source.metricName;

  definition.higherIsBetter = config.higherIsBetter;
  definition.aggregation = config.aggregation;
  if (config.percentageThreshold !== null) definition.percentageThreshold = config.percentageThreshold / 100;
  if (config.iqrThreshold !== null) definition.iqrThreshold = config.iqrThreshold;
  definition.absThreshold = config.absoluteThreshold;
  if (config.ignore) definition.ignore = true;
  if (config.defaultValueIfControlGroupMissing !== null) {
    definition.defaultValueIfControlGroupMissing = config.defaultValueIfControlGroupMissing;
  }
  return definition;
}

/**
 * Where a promoted template can go: the profiles this run matches (by name), "All runs in" the run's
 * organization, and, for a global admin, the install. `profiles` must be the run's organization's
 * (`fetchProfiles(organizationId)`), which is why each is matched as belonging to it; the match
 * itself is the applier's, so a profile offered here is one whose templates would reach this run.
 */
export function buildPromoteTargets(
  run: { organizationId?: string | null; tags?: readonly string[] | null },
  organizations: ReadonlyArray<{ id: string; name: string }>,
  profiles: ReadonlyArray<{ id: string; name: string; tags?: string[] }>,
  isAdmin: boolean,
): CopyTarget[] {
  const organizationId = run.organizationId ?? null;
  const targets: CopyTarget[] = [];
  if (organizationId) {
    const matching = profiles
      .filter((p) => profileMatchesRun({ tags: p.tags, organizationId }, { tags: run.tags, organizationId }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const p of matching) {
      targets.push({ key: `profile:${p.id}`, label: `Profile ${p.name}`, scope: { kind: 'profile', profileId: p.id } });
    }
    const name = organizations.find((o) => o.id === organizationId)?.name ?? 'this organization';
    targets.push({ key: organizationId, label: `All runs in ${name}`, scope: { kind: 'organization', organizationId } });
  }
  if (isAdmin) targets.push({ key: 'install', label: 'All runs on this install', scope: { kind: 'install' } });
  return targets;
}
