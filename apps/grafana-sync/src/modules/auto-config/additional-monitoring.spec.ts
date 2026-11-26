import { TestRun } from '@perfana/shared/entities';
import {
  asMonitoringRun,
  dashboardsForCombination,
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
          { systemUnderTest: 'foo', testEnvironment: 'bar', profile: 'k8s' },
          { systemUnderTest: 'shop', testEnvironment: 'acc' },
          { systemUnderTest: '', testEnvironment: 'x' },
          { systemUnderTest: 'acme', testEnvironment: 7 },
          null,
          { systemUnderTest: 'acme', testEnvironment: 'test', profile: '  ' },
        ]),
      ),
    ).toEqual([
      { systemUnderTest: 'foo', testEnvironment: 'bar' },
      { systemUnderTest: 'foo', testEnvironment: 'bar', profile: 'k8s' },
      { systemUnderTest: 'acme', testEnvironment: 'test' },
    ]);
    expect(readAdditionalSutMonitoring(run(null))).toEqual([]);
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

  it('gives each pass only its own dashboards of a template', () => {
    const r = run([
      { systemUnderTest: 'foo', testEnvironment: 'bar' },
      { systemUnderTest: 'acme', testEnvironment: 'test' },
    ]);
    const dashboards = [
      { dashboardLabel: 'Pods' },
      { dashboardLabel: 'Pods - foo bar' },
      { dashboardLabel: 'Pods api - foo bar' },
      { dashboardLabel: 'Pods - acme test' },
    ];

    expect(dashboardsForCombination(dashboards, r)).toEqual([{ dashboardLabel: 'Pods' }]);
    expect(
      dashboardsForCombination(dashboards, r, { systemUnderTest: 'foo', testEnvironment: 'bar' }),
    ).toEqual([{ dashboardLabel: 'Pods - foo bar' }, { dashboardLabel: 'Pods api - foo bar' }]);
    // A run with no entries keeps every dashboard, as before this feature.
    expect(dashboardsForCombination(dashboards, run(null))).toHaveLength(4);
  });
});
