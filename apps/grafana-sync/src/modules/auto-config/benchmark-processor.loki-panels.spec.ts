/**
 * A `loki-panels` profile benchmark is the Loki twin of `splunk-panels`: it fans out over every Loki
 * dashboard whose uid matches its regex, keyed on the panel TITLE, with each dashboard's real panel
 * id coming back from the finder and reaching the inserted SLO.
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
    findSplunkPanelsByUidPattern: jest.fn(),
    findLokiPanelsByUidPattern: jest.fn().mockResolvedValue(panels),
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
  id: 'pb-loki',
  profile: { name: 'loki' },
  source: 'loki-panels',
  workload_pattern: '.*',
  panel_id: null,
  panel_title: 'Error lines by service',
  ...over,
});

it("fans out over every Loki dashboard, each SLO on that workload's own panel id", async () => {
  const { service, finder, updates } = build([
    { applicationDashboard: { id: 'ad-loki-logs' }, panelId: 2 },
    { applicationDashboard: { id: 'ad-loki-audit' }, panelId: 5 },
  ]);

  await service.processProfileBenchmarks(testRun, ['loki'], [pb()]);

  expect(finder.findLokiPanelsByUidPattern).toHaveBeenCalledWith(
    '^perfana-loki-',
    'Error lines by service',
    'SHOP',
    'acceptatie',
    'loadtest',
    'org-1',
  );
  expect(finder.findSplunkPanelsByUidPattern).not.toHaveBeenCalled();
  const panelArgs = updates.insertBenchmarkBasedOnProfileBenchmark.mock.calls.map(
    (c: any[]) => c[c.length - 1],
  );
  expect(panelArgs).toEqual([
    { panelId: 2, panelTitle: 'Error lines by service' },
    { panelId: 5, panelTitle: 'Error lines by service' },
  ]);
});

it('skips a Loki benchmark that names no panel', async () => {
  const { service, finder } = build([]);
  await service.processProfileBenchmarks(testRun, ['loki'], [pb({ panel_title: null })]);
  expect(finder.findLokiPanelsByUidPattern).not.toHaveBeenCalled();
});
