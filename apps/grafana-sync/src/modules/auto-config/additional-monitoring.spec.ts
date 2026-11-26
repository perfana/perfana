import { TestRun } from '@perfana/shared/entities';
import {
  asMonitoringRun,
  dashboardsForCombination,
  monitoredCombinationOf,
  ownerLabel,
  ownerSutName,
  ownerTestEnvironment,
  readAdditionalSutMonitoring,
} from './additional-monitoring';

const run = (additionalSutMonitoring: unknown): TestRun =>
  ({
    testRunId: 'r1',
    systemUnderTestId: 'sut-id',
    systemUnderTest: { name: 'shop' },
    testEnvironment: 'acc',
    organizationId: 'org-1',
    additionalSutMonitoring,
  }) as unknown as TestRun;

describe('additional SUT monitoring', () => {
  it('reads valid entries only, trimmed, without duplicates or the run own pair', () => {
    expect(
      readAdditionalSutMonitoring(
        run([
          { systemUnderTest: ' foo ', testEnvironment: 'bar' },
          { systemUnderTest: 'foo', testEnvironment: 'bar' },
          { systemUnderTest: 'foo', testEnvironment: 'bar', tags: [' k8s', 'jvm', 'k8s', 7] },
          { systemUnderTest: 'foo', testEnvironment: 'bar', tags: ['jvm', 'k8s'] },
          { systemUnderTest: 'shop', testEnvironment: 'acc' },
          { systemUnderTest: '', testEnvironment: 'x' },
          { systemUnderTest: 'acme', testEnvironment: 7 },
          null,
          { systemUnderTest: 'acme', testEnvironment: 'test', tags: ['  '] },
        ]),
      ),
    ).toEqual([
      { systemUnderTest: 'foo', testEnvironment: 'bar' },
      { systemUnderTest: 'foo', testEnvironment: 'bar', tags: ['jvm', 'k8s'] },
      { systemUnderTest: 'acme', testEnvironment: 'test' },
    ]);
    expect(readAdditionalSutMonitoring(run(null))).toEqual([]);
  });

  // Value: protects=a stored v0.2.97.102 entry with the retired profile key is reported, not silently given the run's profiles; fails_when=the profile check is removed; why_new=profile was replaced by tags in this change; seam=none; no_claim=API-side stripping (whitelist pipe)
  it('warns once about an entry that still names the retired profile', () => {
    const warn = jest.fn();
    const legacy = run([{ systemUnderTest: 'kafka', testEnvironment: 'acc', profile: 'k8s' }]);
    expect(readAdditionalSutMonitoring(legacy, warn)).toEqual([
      { systemUnderTest: 'kafka', testEnvironment: 'acc' },
    ]);
    readAdditionalSutMonitoring(legacy, warn);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no longer read'));
    expect(readAdditionalSutMonitoring(run({ systemUnderTest: 'foo' }))).toEqual([]);
  });

  it('monitors the target while the run keeps owning the result', () => {
    const original = run([]);
    const monitoring = asMonitoringRun(original, {
      systemUnderTest: 'foo',
      testEnvironment: 'bar',
    });

    expect(monitoring.systemUnderTest?.name).toBe('foo');
    expect(monitoring.testEnvironment).toBe('bar');
    expect(monitoring.organizationId).toBe('org-1');
    expect(ownerSutName(monitoring)).toBe('shop');
    expect(ownerTestEnvironment(monitoring)).toBe('acc');
    expect(ownerLabel(monitoring, 'Pods')).toBe('Pods - foo bar');

    // The run itself is untouched and unlabelled.
    expect(original.systemUnderTest?.name).toBe('shop');
    expect(original.testEnvironment).toBe('acc');
    expect(ownerSutName(original)).toBe('shop');
    expect(ownerLabel(original, 'Pods')).toBe('Pods');
  });

  // Value: protects=combination scoping is read from the dashboard row (stored variables + matching label suffix), not from the run's entries; fails_when=scoping goes back to the run's entries (a run without entries hands monitored rows to the owner's SLOs) or to a bare label match; why_new=replaces the label-only case after review finding red-team#1; seam=none; no_claim=rows written by hand
  it('gives each pass only its own dashboards of a template, whichever run is processed', () => {
    const vars = (sut: string, env: string) => [
      { name: 'system_under_test', values: [sut] },
      { name: 'test_environment', values: [env] },
    ];
    const own = { dashboardLabel: 'Pods', variables: vars('shop', 'acc') };
    const legacy = { dashboardLabel: 'Pods' }; // no stored variables: the owner's
    const foo = { dashboardLabel: 'Pods - foo bar', variables: vars('foo', 'bar') };
    const fooSeparate = { dashboardLabel: 'Pods api - foo bar', variables: vars('foo', 'bar') };
    const acme = { dashboardLabel: 'Pods - acme test', variables: vars('acme', 'test') };
    // A suffix that does not match the row's own variables is not a monitored row.
    const lookalike = { dashboardLabel: 'Pods - foo bar', variables: vars('shop', 'acc') };
    const dashboards = [own, legacy, foo, fooSeparate, acme, lookalike];
    const withEntries = run([
      { systemUnderTest: 'foo', testEnvironment: 'bar' },
      { systemUnderTest: 'acme', testEnvironment: 'test' },
    ]);

    expect(dashboardsForCombination(dashboards, withEntries)).toEqual([own, legacy, lookalike]);
    expect(
      dashboardsForCombination(dashboards, withEntries, {
        systemUnderTest: 'foo',
        testEnvironment: 'bar',
      }),
    ).toEqual([foo, fooSeparate]);
    // A run of the same SUT/env that declares no entries still leaves the monitored rows alone.
    expect(dashboardsForCombination(dashboards, run(null))).toEqual([own, legacy, lookalike]);
    expect(monitoredCombinationOf(acme, run(null))).toEqual({
      systemUnderTest: 'acme',
      testEnvironment: 'test',
    });
  });

  // Value: protects=a monitored row's label fits dashboard_label varchar(255) with its suffix whole; fails_when=ownerLabel stops clamping, or clamps the suffix (monitoredCombinationOf then no longer recognises the row); why_new=review finding adversarial-native#1; seam=none; no_claim=Postgres character counting (asserted in code points here)
  it('shortens a long dashboard name so the label fits 255 characters with the suffix whole', () => {
    const sut = 'a'.repeat(100);
    const env = 'b'.repeat(100);
    const monitoring = asMonitoringRun(run([]), { systemUnderTest: sut, testEnvironment: env });
    const suffix = ` - ${sut} ${env}`;
    const label = ownerLabel(monitoring, '\u{1F4CA}'.repeat(200));
    expect(Array.from(label)).toHaveLength(255);
    expect(label.endsWith(suffix)).toBe(true);
    expect(
      monitoredCombinationOf(
        {
          dashboardLabel: label,
          variables: [
            { name: 'system_under_test', values: [sut] },
            { name: 'test_environment', values: [env] },
          ],
        },
        run(null),
      ),
    ).toEqual({ systemUnderTest: sut, testEnvironment: env });
    // A short name is left alone.
    expect(ownerLabel(monitoring, 'Pods')).toBe(`Pods${suffix}`);
  });

  // Value: protects=an invalid stored entry is warned about once, not on every 2-minute auto-config pass; fails_when=the warned-entry set is removed; why_new=review finding adversarial-native#3; seam=none; no_claim=process restarts (the set is per process)
  it('warns about an invalid entry once, however often the run is re-read', () => {
    const warn = jest.fn();
    const bad = {
      ...run([{ systemUnderTest: 'db"}', testEnvironment: 'acc' }]),
      testRunId: 'r-warn-once',
    } as unknown as TestRun;
    expect(readAdditionalSutMonitoring(bad, warn)).toEqual([]);
    expect(readAdditionalSutMonitoring(bad, warn)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  // Value: protects=entries whose names break the API's character rule are dropped with a warning before they reach datasource queries; fails_when=MONITORING_NAME check removed or loosened; why_new=the jsonb can arrive by SUT import or SQL, bypassing the DTO; seam=none; no_claim=DTO validation (update-running-test.dto.spec)
  it('drops entries whose names break the character rule, with a warning', () => {
    const warn = jest.fn();
    expect(
      readAdditionalSutMonitoring(
        run([
          { systemUnderTest: 'db"}', testEnvironment: 'acc' },
          { systemUnderTest: 'a b', testEnvironment: 'c' },
          { systemUnderTest: 'x'.repeat(101), testEnvironment: 'acc' },
          { systemUnderTest: 'payment-db', testEnvironment: 'acc.v2' },
        ]),
        warn,
      ),
    ).toEqual([{ systemUnderTest: 'payment-db', testEnvironment: 'acc.v2' }]);
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
