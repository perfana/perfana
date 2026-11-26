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
 * Profile SLOs and grouping rules look dashboards up by template uid under the owner's SUT/env, so
 * they tell the owner's own rows from a monitored combination's by the row itself
 * (`monitoredCombinationOf`), never by the entries of whichever run is being processed: a run that
 * does not declare an entry must still leave that combination's dashboards alone.
 */
import { TestRun } from '@perfana/shared/entities';
import type { AdditionalSutMonitoring } from '@perfana/shared/types';

interface MonitoringOwner {
  sutName: string;
  testEnvironment: string;
}

type MonitoringRun = TestRun & { monitoringOwner?: MonitoringOwner };

const sutNameOf = (run: TestRun): string => run.systemUnderTest?.name || run.systemUnderTestId;

/**
 * The API's rule for these names (UpdateRunningTestDto), re-checked here because the jsonb can also
 * arrive by SUT import or SQL. The names are substituted unescaped into datasource variable queries,
 * and the label suffix below is only unambiguous because they hold no spaces.
 */
const MONITORING_NAME = /^[a-zA-Z0-9._-]{1,100}$/;

/** `application_dashboards.dashboard_label` is varchar(255): Postgres counts characters, i.e. code points. */
const DASHBOARD_LABEL_MAX = 255;

// ponytail: process-lifetime set, one key per bad (run, entry); auto-config passes a run only for
// minutes after it ends, so it stays tiny. Clear it per pass if that ever changes.
const warnedInvalid = new Set<string>();

/** The run's entries, validated (jsonb is untrusted), trimmed, de-duplicated, minus the run's own pair. */
export function readAdditionalSutMonitoring(
  run: TestRun,
  warn?: (message: string) => void,
): AdditionalSutMonitoring[] {
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
    if (!MONITORING_NAME.test(sut) || !MONITORING_NAME.test(env)) {
      // Once per entry: auto-config re-reads a recent run on every 2-minute pass.
      const warnKey = `${run.testRunId}\u0000${sut}\u0000${env}`;
      // Only a call that can log marks the entry warned; a check without `warn` must not eat it.
      if (warn && !warnedInvalid.has(warnKey)) {
        warnedInvalid.add(warnKey);
        warn(
          `Additional SUT monitoring for test run ${run.testRunId}: entry skipped, names may hold only ` +
            `letters, digits, '.', '_' and '-' (at most 100): ${JSON.stringify([sut, env])}`,
        );
      }
      continue;
    }
    // The run's own pair is already monitored, and its dashboards would collide with these.
    if (sut === sutNameOf(run) && env === run.testEnvironment) continue;
    const tags = Array.isArray(e.tags)
      ? [...new Set(e.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim()))]
          .filter(Boolean)
          .sort()
      : [];
    // v0.2.97.102 took `profile`. Without tags, falling back to the run's profiles would put
    // dashboards and SLOs it never named on this system (and they stay), so skip it instead.
    if (e.profile !== undefined && !tags.length) {
      const warnKey = `${run.testRunId}\u0000${sut}\u0000${env}\u0000profile`;
      // Only a call that can log marks the entry warned; a check without `warn` must not eat it.
      if (warn && !warnedInvalid.has(warnKey)) {
        warnedInvalid.add(warnKey);
        warn(
          `Additional SUT monitoring for test run ${run.testRunId}: entry ${sut} / ${env} skipped, ` +
            `it names a profile, which is no longer read; give it tags to choose its profiles`,
        );
      }
      continue;
    }
    // Two entries for one pair may carry different tags; both apply to the same dashboards.
    const key = `${sut}\u0000${env}\u0000${tags.join('\u0000')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ systemUnderTest: sut, testEnvironment: env, ...(tags.length ? { tags } : {}) });
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
  // The suffix stays whole (monitoredCombinationOf reads it; its names are ASCII by MONITORING_NAME),
  // so a long dashboard name is shortened instead and the row still fits the column.
  const suffix = labelSuffix(sutNameOf(run), run.testEnvironment);
  const room = DASHBOARD_LABEL_MAX - suffix.length;
  const name = Array.from(label);
  return `${name.length > room ? name.slice(0, room).join('') : label}${suffix}`;
}

type DashboardRow = { dashboardLabel?: string | null; variables?: unknown };

/** The variable's value when the row stores exactly one, as auto-config writes system/environment. */
const singleValue = (variables: unknown, name: string): string | undefined => {
  if (!Array.isArray(variables)) return undefined;
  const v = variables.find(
    (x) => !!x && typeof x === 'object' && (x as { name?: unknown }).name === name,
  ) as { values?: unknown } | undefined;
  const values = v?.values;
  return Array.isArray(values) && values.length === 1 && typeof values[0] === 'string'
    ? values[0]
    : undefined;
};

/**
 * The combination a dashboard row monitors, read from the row alone: its stored
 * `system_under_test` / `test_environment` differ from the owner's and its label carries the
 * matching `ownerLabel` suffix (both written when the row is created). `null` for the owner's own.
 */
export function monitoredCombinationOf(
  dashboard: DashboardRow,
  run: TestRun,
): AdditionalSutMonitoring | null {
  const sut = singleValue(dashboard.variables, 'system_under_test');
  const env = singleValue(dashboard.variables, 'test_environment');
  if (!sut || !env) return null;
  if (sut === ownerSutName(run) && env === ownerTestEnvironment(run)) return null;
  if (!(dashboard.dashboardLabel ?? '').endsWith(labelSuffix(sut, env))) return null;
  return { systemUnderTest: sut, testEnvironment: env };
}

/**
 * Narrow the owner's dashboards of one template to one combination's: with `target`, only the rows
 * monitoring that combination; without, the owner's own rows, i.e. those monitoring none. Decided
 * per row, so it gives the same answer whichever run of the owner SUT/env is being processed.
 */
export function dashboardsForCombination<T extends DashboardRow>(
  dashboards: T[],
  run: TestRun,
  target?: AdditionalSutMonitoring,
): T[] {
  return dashboards.filter((d) => {
    const monitored = monitoredCombinationOf(d, run);
    if (!target) return !monitored;
    return (
      !!monitored &&
      monitored.systemUnderTest === target.systemUnderTest &&
      monitored.testEnvironment === target.testEnvironment
    );
  });
}
