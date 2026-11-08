/**
 * A run's control group as a comparison baseline.
 *
 * The control group is the set of earlier runs anomaly detection (ADAPT) judges a run
 * against. Its pooled statistics are the "control" values the anomaly-detection card shows.
 * The Compare card offers it in its baseline picker next to the single runs, and the report's
 * Comparisons section offers it in `BaselineRunSelect`; both store the same sentinel,
 * `CONTROL_GROUP_BASELINE`, shared with the API through `@perfana/shared/types` so a rename
 * is a compile error rather than a baseline that silently stops resolving.
 *
 * The sentinel is NOT a run id. Anything that would look it up as a run (a time series, an
 * access check, a run's release or annotations) has to branch on `isControlGroupBaseline`.
 */

import { CONTROL_GROUP_BASELINE } from '@perfana/shared/types';
import { authenticatedFetch } from './api';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export { CONTROL_GROUP_BASELINE };

/** `GET /metrics/control-group/:testRunId`. */
export interface ControlGroup {
  control_group_id: string;
  test_runs: string[];
  n_test_runs: number;
  first_datetime: string | null;
  last_datetime: string | null;
}

/**
 * `GET /metrics/control-group-statistics/:testRunId` — one series pooled over the group,
 * `statistics` keyed like `/metrics/ds-metric-statistics` (`avg`, `q90`, `q95`, `q99`, …).
 */
export interface ControlGroupStatistic {
  control_group_id: string;
  application_dashboard_id: string;
  panel_id: number;
  panel_title: string;
  metric_name: string;
  unit: string | null;
  metrics_source_id: string | null;
  statistics: Record<string, number | null>;
}

export const isControlGroupBaseline = (id: string | null | undefined): boolean =>
  id === CONTROL_GROUP_BASELINE;

/** How many runs the group counts. ADAPT's own count, which `test_runs` can lag. */
export const controlGroupRunCount = (group: Pick<ControlGroup, 'n_test_runs' | 'test_runs'>): number =>
  group.n_test_runs || group.test_runs.length;

/** "3 runs" / "1 run". */
export const formatRunCount = (n: number): string => `${n} ${n === 1 ? 'run' : 'runs'}`;

/** The group's run ids for a caption, folded past `max` into "+N more". */
export function summariseControlGroupRuns(testRuns: string[], max = 5): string {
  if (testRuns.length <= max) return testRuns.join(', ');
  return `${testRuns.slice(0, max).join(', ')} (+${testRuns.length - max} more)`;
}

/**
 * The run's control group, or null when it has none — a first run, a run ADAPT has not
 * analysed yet, or one the caller cannot see. A failure reads as "none" too: the picker then
 * simply does not offer the option, which is what the user can act on.
 */
export async function fetchControlGroup(testRunId: string): Promise<ControlGroup | null> {
  try {
    const res = await authenticatedFetch(`/metrics/control-group/${encodeURIComponent(testRunId)}`);
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    const body = JSON.parse(text) as ControlGroup | null;
    return body && Array.isArray(body.test_runs) ? body : null;
  } catch (err) {
    console.error('Failed to fetch the control group:', err);
    return null;
  }
}

/**
 * One panel's pooled statistics over the run's control group. Empty when the run has no
 * group, and for series ADAPT does not pool — the synthetic "All aggregated" series and the
 * URL panels — which a caller must show without a baseline rather than inventing one.
 */
export async function fetchControlGroupStatistics(
  testRunId: string,
  scope: { applicationDashboardId?: string; metricsSourceId?: string; panelId: number },
): Promise<ControlGroupStatistic[]> {
  try {
    const params = new URLSearchParams({ panelId: String(scope.panelId) });
    // Both ids narrow server-side: one metrics source can back several dashboards, and pairing
    // by series name would otherwise take whichever dashboard's row came first. A non-uuid
    // dashboard id (a synthetic list entry) names no dashboard and would be refused with a 400.
    if (scope.metricsSourceId) params.set('metricsSourceId', scope.metricsSourceId);
    if (scope.applicationDashboardId && UUID_RE.test(scope.applicationDashboardId)) {
      params.set('applicationDashboardId', scope.applicationDashboardId);
    }
    const res = await authenticatedFetch(
      `/metrics/control-group-statistics/${encodeURIComponent(testRunId)}?${params.toString()}`,
    );
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body) ? body : [];
  } catch (err) {
    console.error('Failed to fetch control group statistics:', err);
    return [];
  }
}
