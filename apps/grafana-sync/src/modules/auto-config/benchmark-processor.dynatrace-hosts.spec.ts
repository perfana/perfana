/**
 * A `dynatrace-hosts` profile benchmark is the Dynatrace twin of a perf-test one: it fans out
 * over every host dashboard whose uid matches its regex. Unlike perf-test the panel id differs
 * per host, so the stored synthetic id is mapped to its title and each host's real panel id
 * comes back from the finder and must reach the inserted SLO.
 */
import { BenchmarkProcessorService } from './benchmark-processor.service';

const testRun: any = {
  testRunId: 'SHOP-00042',
  systemUnderTest: { name: 'SHOP' },
  testEnvironment: 'acceptatie',
  workload: 'loadtest',
  organizationId: 'org-1',
};

function build(hostPanels: Array<{ applicationDashboard: { id: string }; panelId: number }>) {
  const finder = {
    findApplicationDashboardsByTemplateDashboardUid: jest.fn(),
    findApplicationDashboardsByUidPattern: jest.fn(),
    findDynatraceHostPanelsByUidPattern: jest.fn().mockResolvedValue(hostPanels),
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
  return { service, finder, updates, testRunFinder };
}

const pb = (over: Record<string, unknown> = {}): any => ({
  id: 'pb-dt',
  profile: { name: 'dynatrace' },
  source: 'dynatrace-hosts',
  workload_pattern: '.*',
  panel_id: 1,
  panel_title: 'CPU Usage',
  ...over,
});

it("fans out over every host dashboard, each SLO on that host's own panel id", async () => {
  const { service, finder, updates } = build([
    { applicationDashboard: { id: 'ad-host-a' }, panelId: 41234 },
    { applicationDashboard: { id: 'ad-host-b' }, panelId: 98765 },
  ]);

  await service.processProfileBenchmarks(testRun, ['dynatrace'], [pb()]);

  expect(finder.findDynatraceHostPanelsByUidPattern).toHaveBeenCalledWith(
    '^dynatrace-dynatrace-host-metrics-',
    'CPU Usage',
    'SHOP',
    'acceptatie',
    'loadtest',
    'org-1',
  );
  expect(finder.findApplicationDashboardsByUidPattern).not.toHaveBeenCalled();
  expect(finder.findApplicationDashboardsByTemplateDashboardUid).not.toHaveBeenCalled();
  expect(
    updates.insertBenchmarkBasedOnProfileBenchmark.mock.calls.map((c: any[]) => [c[2].id, c[3]]),
  ).toEqual([
    ['ad-host-a', { panelId: 41234, panelTitle: 'CPU Usage' }],
    ['ad-host-b', { panelId: 98765, panelTitle: 'CPU Usage' }],
  ]);
});

it('takes the panel title from the synthetic id, not from a stale stored title', async () => {
  const { service, finder } = build([]);

  await service.processProfileBenchmarks(
    testRun,
    ['dynatrace'],
    [pb({ panel_id: 4, panel_title: 'renamed' })],
  );

  expect(finder.findDynatraceHostPanelsByUidPattern.mock.calls[0][1]).toBe('Disk Write Latency');
});

it('passes a stored uid regex through instead of the default', async () => {
  const { service, finder } = build([]);

  await service.processProfileBenchmarks(
    testRun,
    ['dynatrace'],
    [pb({ dashboard_uid: '^dynatrace-dynatrace-host-metrics-web-' })],
  );

  expect(finder.findDynatraceHostPanelsByUidPattern.mock.calls[0][0]).toBe(
    '^dynatrace-dynatrace-host-metrics-web-',
  );
});

it('refuses an invalid uid regex before it reaches Postgres', async () => {
  const { service, finder, updates } = build([]);

  await service.processProfileBenchmarks(testRun, ['dynatrace'], [pb({ dashboard_uid: '([' })]);

  expect(finder.findDynatraceHostPanelsByUidPattern).not.toHaveBeenCalled();
  expect(updates.insertBenchmarkBasedOnProfileBenchmark).not.toHaveBeenCalled();
});

it('skips a benchmark that names no host panel', async () => {
  const { service, finder } = build([]);

  await service.processProfileBenchmarks(
    testRun,
    ['dynatrace'],
    [pb({ panel_id: 999, panel_title: undefined })],
  );

  expect(finder.findDynatraceHostPanelsByUidPattern).not.toHaveBeenCalled();
});

it('keeps provisioning the other hosts when one insert fails', async () => {
  const { service, updates } = build([
    { applicationDashboard: { id: 'ad-host-a' }, panelId: 1 },
    { applicationDashboard: { id: 'ad-host-b' }, panelId: 2 },
  ]);
  updates.insertBenchmarkBasedOnProfileBenchmark.mockRejectedValueOnce(new Error('boom'));

  await service.processProfileBenchmarks(testRun, ['dynatrace'], [pb()]);

  expect(updates.insertBenchmarkBasedOnProfileBenchmark).toHaveBeenCalledTimes(2);
});
