/**
 * Additional SUT monitoring: `test_runs.additional_sut_monitoring` (migration 1837) names extra
 * system-under-test / test-environment combinations whose profile dashboards, SLOs and series
 * grouping rules are added to the run's own ("owner") system and environment. No system or
 * environment is created for them.
 *
 * The run's SUT/env does two jobs in auto-config, and this splits them:
 * - what is MONITORED: the `system_under_test` / `test_environment` template variables, the
 *   datasource check, and the Grafana dashboard uid and title. A monitoring run carries the extra
 *   combination here, so that code is unchanged.
 * - who OWNS the result: the `application_dashboards` row. Those sites read `ownerSutName` /
 *   `ownerTestEnvironment`, and label the row with `ownerLabel`, which suffixes the monitored
 *   combination so it cannot collide with the owner's own copy of the same template
 *   (`uq_application_dashboards_unique` is sut, env, grafana, uid, label).
 *
 * That label suffix is also how profile SLOs and grouping rules, which look dashboards up by
 * template uid under the owner's SUT/env, keep each combination's dashboards to its own profiles.
 */
import { TestRun } from '@perfana/shared/entities';
import type { AdditionalSutMonitoring } from '@perfana/shared/types';

interface MonitoringOwner {
  sutName: string;
  testEnvironment: string;
}

type MonitoringRun = TestRun & { monitoringOwner?: MonitoringOwner };

const sutNameOf = (run: TestRun): string => run.systemUnderTest?.name || run.systemUnderTestId;

/** The run's entries, validated (jsonb is untrusted), trimmed, de-duplicated, minus the run's own pair. */
export function readAdditionalSutMonitoring(run: TestRun): AdditionalSutMonitoring[] {
  const raw: unknown = run.additionalSutMonitoring;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: AdditionalSutMonitoring[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const sut = typeof e.systemUnderTest === 'string' ? e.systemUnderTest.trim() : '';
    const env = typeof e.testEnvironment === 'string' ? e.testEnvironment.trim() : '';
    if (!sut || !env) continue;
    // The run's own pair is already monitored, and its dashboards would collide with these.
    if (sut === sutNameOf(run) && env === run.testEnvironment) continue;
    const profile =
      typeof e.profile === 'string' && e.profile.trim() ? e.profile.trim() : undefined;
    // Two entries for one pair may name different profiles; both apply to the same dashboards.
    const key = `${sut}\u0000${env}\u0000${profile ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ systemUnderTest: sut, testEnvironment: env, ...(profile ? { profile } : {}) });
  }
  return result;
}

/**
 * A view of `run` that monitors `target` while its results stay owned by the run's own SUT/env.
 * A copy: the original entity is never mutated.
 */
export function asMonitoringRun(run: TestRun, target: AdditionalSutMonitoring): TestRun {
  const copy: MonitoringRun = Object.assign(Object.create(Object.getPrototypeOf(run)), run, {
    systemUnderTest: { ...(run.systemUnderTest ?? {}), name: target.systemUnderTest },
    testEnvironment: target.testEnvironment,
    monitoringOwner: { sutName: sutNameOf(run), testEnvironment: run.testEnvironment },
  });
  return copy;
}

export const ownerSutName = (run: TestRun): string =>
  (run as MonitoringRun).monitoringOwner?.sutName ?? sutNameOf(run);

export const ownerTestEnvironment = (run: TestRun): string =>
  (run as MonitoringRun).monitoringOwner?.testEnvironment ?? run.testEnvironment;

const labelSuffix = (sut: string, env: string): string => ` - ${sut} ${env}`;

/** The application-dashboard label: unchanged for the run itself, suffixed for a monitored combination. */
export function ownerLabel(run: TestRun, label: string): string {
  if (!(run as MonitoringRun).monitoringOwner) return label;
  return `${label}${labelSuffix(sutNameOf(run), run.testEnvironment)}`;
}

/**
 * Narrow the owner's dashboards of one template to one combination's: with `target`, only that
 * combination's (labelled by `ownerLabel`); without, the owner's own, i.e. none labelled for any
 * of the run's entries.
 *
 * ponytail: keyed on the label suffix. A dashboard left from an entry later removed from
 * perfana.yaml no longer matches any entry and so counts as the owner's own again; add a stored
 * marker if that ever matters.
 */
export function dashboardsForCombination<T extends { dashboardLabel?: string | null }>(
  dashboards: T[],
  run: TestRun,
  target?: AdditionalSutMonitoring,
): T[] {
  const endsWith = (d: T, t: AdditionalSutMonitoring) =>
    (d.dashboardLabel ?? '').endsWith(labelSuffix(t.systemUnderTest, t.testEnvironment));
  if (target) return dashboards.filter((d) => endsWith(d, target));
  const entries = readAdditionalSutMonitoring(run);
  return dashboards.filter((d) => !entries.some((t) => endsWith(d, t)));
}
