/**
 * Which profiles a test run matches: the one rule shared by grafana-sync's auto-config (profile
 * dashboards and SLOs) and the API's golden-path applier (profile compare-config templates). The
 * rule is shared; the organization each caller passes is its own: grafana-sync passes the run's,
 * the applier the application dashboard's (NOT NULL, and the organization the templates' rows
 * belong to). The two agree whenever a run's organization is its system's.
 *
 * A profile matches a run when they share at least one tag AND both belong to the same
 * organization. It FAILS CLOSED on a missing organization, in both directions:
 *
 * - a run with no organization matches no profile;
 * - a profile with no organization matches no run.
 *
 * grafana-sync used to fail open on both (a profile with no organization matched every
 * organization's runs, and a run with no organization matched every profile). Neither can happen on
 * a real row today (`test_runs.organization_id` and `profiles.organization_id` are both NOT NULL),
 * so closing them changes nothing that works, and it means a row that ever arrives without its
 * organization cannot apply one tenant's profile to another tenant's run.
 */
export interface ProfileMatchRun {
  tags?: readonly string[] | null;
  organizationId?: string | null;
}

export interface ProfileMatchCandidate {
  tags?: readonly string[] | null;
  organizationId?: string | null;
}

export function profileMatchesRun(profile: ProfileMatchCandidate, run: ProfileMatchRun): boolean {
  if (!run.organizationId || !profile.organizationId) return false;
  if (profile.organizationId !== run.organizationId) return false;
  const runTags = run.tags ?? [];
  const profileTags = profile.tags ?? [];
  return runTags.some((tag) => profileTags.includes(tag));
}

/** The profiles a run matches, in their given order. */
export function matchProfilesForRun<P extends ProfileMatchCandidate>(run: ProfileMatchRun, profiles: readonly P[]): P[] {
  return profiles.filter((profile) => profileMatchesRun(profile, run));
}
