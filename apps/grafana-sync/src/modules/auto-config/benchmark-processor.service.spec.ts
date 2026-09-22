/**
 * A `performance-metrics` profile benchmark has no Grafana template: it must resolve its
 * application dashboards by uid regex (every scenario dashboard of the SUT), while a
 * Grafana one keeps matching on `template_dashboard_uid`.
 */
import { BenchmarkProcessorService } from './benchmark-processor.service';

const testRun: any = {
  testRunId: 'WERKNL-00011',
  systemUnderTest: { name: 'WERKNL' },
  testEnvironment: 'acceptatie',
  workload: 'loadtest_perfana',
  organizationId: 'org-1',
};

function build() {
  const finder = {
    findApplicationDashboardsByTemplateDashboardUid: jest
      .fn()
      .mockResolvedValue([{ id: 'grafana-ad' }]),
    findApplicationDashboardsByUidPattern: jest
      .fn()
      .mockResolvedValue([{ id: 'ad-scen-1' }, { id: 'ad-scen-2' }]),
  };
  const testRunFinder = {
    findBenchmarkForApplicationDashboardOrNull: jest.fn().mockResolvedValue(null),
  };
  const updates = {
    insertBenchmarkBasedOnProfileBenchmark: jest.fn().mockResolvedValue({ insertedId: 'b' }),
  };
  const service = new BenchmarkProcessorService(
    testRunFinder as any,
    finder as any,
    updates as any,
  );
  return { service, finder, updates };
}

it('fans a perf-test profile benchmark out over every uid-matching scenario dashboard', async () => {
  const { service, finder, updates } = build();
  const pb: any = {
    id: 'pb-1',
    profile: { name: 'jmeter' },
    source: 'performance-metrics',
    workload_pattern: '.*',
    panel_id: 105,
  };

  await service.processProfileBenchmarks(testRun, ['jmeter'], [pb]);

  expect(finder.findApplicationDashboardsByUidPattern).toHaveBeenCalledWith(
    '^performance-test-metrics-(?!all-aggregated$|default$)',
    'WERKNL',
    'acceptatie',
    'org-1',
  );
  expect(finder.findApplicationDashboardsByTemplateDashboardUid).not.toHaveBeenCalled();
  expect(updates.insertBenchmarkBasedOnProfileBenchmark).toHaveBeenCalledTimes(2);
});

it('passes a stored uid regex through instead of the default', async () => {
  const { service, finder } = build();
  const pb: any = {
    id: 'pb-1',
    profile: { name: 'jmeter' },
    source: 'performance-metrics',
    workload_pattern: '.*',
    dashboard_uid: '^performance-test-metrics-t-wm-',
  };

  await service.processProfileBenchmarks(testRun, ['jmeter'], [pb]);

  expect(finder.findApplicationDashboardsByUidPattern.mock.calls[0][0]).toBe(
    '^performance-test-metrics-t-wm-',
  );
});

it('keeps a Grafana profile benchmark on the template-uid lookup', async () => {
  const { service, finder } = build();
  const pb: any = {
    id: 'pb-2',
    profile: { name: 'jmeter' },
    source: 'grafana',
    workload_pattern: '.*',
    dashboard_uid: 'jmeter-timescaledb-dashboard',
  };

  await service.processProfileBenchmarks(testRun, ['jmeter'], [pb]);

  expect(finder.findApplicationDashboardsByTemplateDashboardUid).toHaveBeenCalledWith(
    'jmeter-timescaledb-dashboard',
    'WERKNL',
    'acceptatie',
    'org-1',
  );
  expect(finder.findApplicationDashboardsByUidPattern).not.toHaveBeenCalled();
});

it('does not re-insert a scenario SLO that already exists for the run', async () => {
  const { service, updates } = build();
  const testRunFinder = (service as any).testRunFinderService;
  testRunFinder.findBenchmarkForApplicationDashboardOrNull
    .mockResolvedValueOnce({ id: 'existing' })
    .mockResolvedValueOnce(null);
  const pb: any = {
    id: 'pb-1',
    profile: { name: 'jmeter' },
    source: 'performance-metrics',
    workload_pattern: '.*',
  };

  await service.processProfileBenchmarks(testRun, ['jmeter'], [pb]);

  // Two scenario dashboards matched; only the one without a benchmark is inserted.
  expect(updates.insertBenchmarkBasedOnProfileBenchmark).toHaveBeenCalledTimes(1);
  expect(updates.insertBenchmarkBasedOnProfileBenchmark.mock.calls[0][2]).toEqual({
    id: 'ad-scen-2',
  });
});

it('refuses an invalid perf-test uid regex before it reaches Postgres, and keeps going', async () => {
  const { service, finder, updates } = build();
  const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  // Rows written before the API validated the pattern (or by SQL) can still carry one.
  const bad: any = {
    id: 'pb-bad',
    profile: { name: 'jmeter' },
    source: 'performance-metrics',
    workload_pattern: '.*',
    dashboard_uid: '^performance-test-metrics-(',
  };
  const good: any = {
    id: 'pb-good',
    profile: { name: 'jmeter' },
    source: 'grafana',
    workload_pattern: '.*',
    dashboard_uid: 'jmeter-timescaledb-dashboard',
  };

  await expect(
    service.processProfileBenchmarks(testRun, ['jmeter'], [bad, good]),
  ).resolves.toBeUndefined();

  expect(finder.findApplicationDashboardsByUidPattern).not.toHaveBeenCalled();
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('pb-bad'));
  // The refusal is per profile benchmark: the Grafana one after it is still provisioned.
  expect(finder.findApplicationDashboardsByTemplateDashboardUid).toHaveBeenCalledTimes(1);
  expect(updates.insertBenchmarkBasedOnProfileBenchmark).toHaveBeenCalledTimes(1);
});

it('refuses a ReDoS-prone perf-test uid regex the same way', async () => {
  const { service, finder, updates } = build();
  jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  const pb: any = {
    id: 'pb-redos',
    profile: { name: 'jmeter' },
    source: 'performance-metrics',
    workload_pattern: '.*',
    dashboard_uid: '^(a+)+$',
  };

  await service.processProfileBenchmarks(testRun, ['jmeter'], [pb]);

  expect(finder.findApplicationDashboardsByUidPattern).not.toHaveBeenCalled();
  expect(updates.insertBenchmarkBasedOnProfileBenchmark).not.toHaveBeenCalled();
});

it('logs a finder failure and moves on to the next profile benchmark', async () => {
  const { service, finder, updates } = build();
  finder.findApplicationDashboardsByUidPattern.mockRejectedValue(new Error('connection reset'));
  const errorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
  const perfTest: any = {
    id: 'pb-perf',
    profile: { name: 'jmeter' },
    source: 'performance-metrics',
    workload_pattern: '.*',
  };
  const grafana: any = {
    id: 'pb-grafana',
    profile: { name: 'jmeter' },
    source: 'grafana',
    workload_pattern: '.*',
    dashboard_uid: 'jmeter-timescaledb-dashboard',
  };

  await expect(
    service.processProfileBenchmarks(testRun, ['jmeter'], [perfTest, grafana]),
  ).resolves.toBeUndefined();

  expect(errorSpy).toHaveBeenCalledWith(
    expect.stringContaining('pb-perf'),
    expect.stringContaining('connection reset'),
  );
  expect(updates.insertBenchmarkBasedOnProfileBenchmark).toHaveBeenCalledTimes(1);
});

it('skips a perf-test benchmark whose workload pattern does not match, before any lookup', async () => {
  const { service, finder, updates } = build();
  const pb: any = {
    id: 'pb-1',
    profile: { name: 'jmeter' },
    source: 'performance-metrics',
    workload_pattern: '^stress$',
  };

  await service.processProfileBenchmarks(testRun, ['jmeter'], [pb]);

  expect(finder.findApplicationDashboardsByUidPattern).not.toHaveBeenCalled();
  expect(updates.insertBenchmarkBasedOnProfileBenchmark).not.toHaveBeenCalled();
});
