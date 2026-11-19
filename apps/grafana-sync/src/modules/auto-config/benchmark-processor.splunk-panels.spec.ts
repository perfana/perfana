/**
 * A `splunk-panels` profile benchmark is the Splunk twin of a `dynatrace-hosts` one: it fans out
 * over every Splunk dashboard whose uid matches its regex. Splunk panels are user-authored and
 * their ids are assigned per workload, so the benchmark is keyed on its panel TITLE and each
 * dashboard's real panel id comes back from the finder and must reach the inserted SLO.
 */
import { BenchmarkProcessorService } from './benchmark-processor.service';

const testRun: any = {
  testRunId: 'SHOP-00042',
  systemUnderTest: { name: 'SHOP' },
  testEnvironment: 'acceptatie',
  workload: 'loadtest',
  organizationId: 'org-1',
};

function build(panels: Array<{ applicationDashboard: { id: string }; panelId: number }>) {
  const finder = {
    findApplicationDashboardsByTemplateDashboardUid: jest.fn(),
    findApplicationDashboardsByUidPattern: jest.fn(),
    findDynatraceHostPanelsByUidPattern: jest.fn(),
    findSplunkPanelsByUidPattern: jest.fn().mockResolvedValue(panels),
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

const pb = (over: Record<string, unknown> = {}): any => ({
  id: 'pb-splunk',
  profile: { name: 'splunk' },
  source: 'splunk-panels',
  workload_pattern: '.*',
  panel_id: null,
  panel_title: 'Errors by host',
  ...over,
});

it("fans out over every Splunk dashboard, each SLO on that workload's own panel id", async () => {
  const { service, finder, updates } = build([
    { applicationDashboard: { id: 'ad-splunk-logs' }, panelId: 2 },
    { applicationDashboard: { id: 'ad-splunk-audit' }, panelId: 7 },
  ]);

  await service.processProfileBenchmarks(testRun, ['splunk'], [pb()]);

  expect(finder.findSplunkPanelsByUidPattern).toHaveBeenCalledWith(
    '^splunk-',
    'Errors by host',
    'SHOP',
    'acceptatie',
    'loadtest',
    'org-1',
  );
  expect(finder.findDynatraceHostPanelsByUidPattern).not.toHaveBeenCalled();
  expect(finder.findApplicationDashboardsByUidPattern).not.toHaveBeenCalled();
  expect(
    updates.insertBenchmarkBasedOnProfileBenchmark.mock.calls.map((c: any[]) => [c[2].id, c[3]]),
  ).toEqual([
    ['ad-splunk-logs', { panelId: 2, panelTitle: 'Errors by host' }],
    ['ad-splunk-audit', { panelId: 7, panelTitle: 'Errors by host' }],
  ]);
});

it('uses the stored title even when a panel id happens to match a synthetic Dynatrace host id', async () => {
  const { service, finder } = build([]);

  await service.processProfileBenchmarks(testRun, ['splunk'], [pb({ panel_id: 1 })]);

  expect(finder.findSplunkPanelsByUidPattern.mock.calls[0][1]).toBe('Errors by host');
});

it('refuses an invalid uid regex before it reaches Postgres', async () => {
  const { service, finder } = build([]);

  await service.processProfileBenchmarks(testRun, ['splunk'], [pb({ dashboard_uid: '([' })]);

  expect(finder.findSplunkPanelsByUidPattern).not.toHaveBeenCalled();
});

it('skips a benchmark with no panel title', async () => {
  const { service, finder } = build([]);

  await service.processProfileBenchmarks(testRun, ['splunk'], [pb({ panel_title: '' })]);

  expect(finder.findSplunkPanelsByUidPattern).not.toHaveBeenCalled();
});
