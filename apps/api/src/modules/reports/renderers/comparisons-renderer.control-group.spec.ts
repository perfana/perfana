import { Test, TestingModule } from '@nestjs/testing';
import { ReportSectionConfig, TestRun } from '@perfana/shared';
import { CONTROL_GROUP_BASELINE } from '@perfana/shared/types';
import { ComparisonsRenderer } from './comparisons-renderer';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService } from '../services/report-data-fetcher.service';
// The real chart builder: the SVG assertions below are what prove a graph was drawn.
import { ChartSvgService } from './chart-svg.service';

const section = (config: Record<string, unknown>): ReportSectionConfig =>
  ({ type: 'comparisons', order: 0, config }) as ReportSectionConfig;

const testRun = { id: 'uuid-7', testRunId: 'run-7', testEnvironment: 'acc', workload: 'load' } as TestRun;

const group = {
  id: 'run-7',
  testRuns: ['run-2', 'run-3', 'run-4'],
  nTestRuns: 3,
  firstDatetime: '2026-11-01T10:00:00.000Z',
  lastDatetime: '2026-11-04T10:00:00.000Z',
};

const cpuRow = {
  group: 'Kubernetes / CPU',
  label: 'api',
  dashboardLabel: 'Kubernetes',
  panelId: 4,
  panelTitle: 'CPU',
  unit: 'percent',
  metrics: [{ key: 'avg' as const, current: 75, baseline: 50, diffPercent: 50 }],
};

describe('ComparisonsRenderer — control group baseline', () => {
  let renderer: ComparisonsRenderer;
  let dataFetcher: jest.Mocked<ReportDataFetcherService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComparisonsRenderer,
        ChartSvgService,
        ReportUtilsService,
        {
          provide: ReportDataFetcherService,
          useValue: {
            getBaselineRunComparison: jest.fn().mockResolvedValue(null),
            getControlGroupComparison: jest.fn().mockResolvedValue(null),
            getControlGroupForRun: jest.fn().mockResolvedValue(group),
            getDynatraceHostLabels: jest.fn().mockResolvedValue({}),
            getPreviousTestRun: jest.fn(),
            previousRunSloMiss: jest.fn(),
            getMetricsTimeSeries: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    renderer = module.get(ComparisonsRenderer);
    dataFetcher = module.get(ReportDataFetcherService);
  });

  it('compares against the control group\'s statistics and never looks the sentinel up as a run', async () => {
    dataFetcher.getControlGroupComparison.mockResolvedValue({ source: 'grafana', rows: [cpuRow] });

    const html = await renderer.renderComparisonsSection(
      section({
        baselineTestRunId: CONTROL_GROUP_BASELINE,
        source: 'grafana',
        metrics: ['avg'],
        // Meaningless for a control group (same environment, paired by dashboard id).
        dashboardMap: [{ current: 'Kubernetes', baseline: 'Kubernetes prod' }],
      }),
      testRun,
      'user-1',
      ['user'],
    );

    expect(dataFetcher.getControlGroupForRun).toHaveBeenCalledWith('run-7');
    expect(dataFetcher.getControlGroupComparison).toHaveBeenCalledWith(
      'run-7', 'run-7', 'grafana', expect.objectContaining({ metrics: ['avg'], userId: 'user-1', roles: ['user'] }),
    );
    expect(dataFetcher.getControlGroupComparison.mock.calls[0]![3]).not.toHaveProperty('dashboardMap');
    expect(dataFetcher.getBaselineRunComparison).not.toHaveBeenCalled();
    expect(dataFetcher.getPreviousTestRun).not.toHaveBeenCalled();

    // Names what it compared against, and which runs that was, so a stored report stays readable.
    expect(html).toContain('against its control group');
    expect(html).toContain('3 earlier runs');
    expect(html).toContain('run-2, run-3, run-4');
    expect(html).not.toContain('against baseline run');
    expect(html).toContain('vs control group');
    // The mapping caption is for a differently named baseline dashboard; there is none here.
    expect(html).not.toContain('Kubernetes prod');
  });

  it('folds a long control group into "+N more"', async () => {
    dataFetcher.getControlGroupForRun.mockResolvedValue({
      ...group,
      testRuns: Array.from({ length: 11 }, (_, i) => `run-${i}`),
      nTestRuns: 11,
    });
    dataFetcher.getControlGroupComparison.mockResolvedValue({ source: 'grafana', rows: [cpuRow] });

    const html = await renderer.renderComparisonsSection(
      section({ baselineTestRunId: CONTROL_GROUP_BASELINE, source: 'grafana', metrics: ['avg'] }), testRun);

    expect(html).toContain('run-7 (+3 more)');
    expect(html).not.toContain('run-8');
  });

  it('says why when the run has no control group, instead of an empty section', async () => {
    dataFetcher.getControlGroupForRun.mockResolvedValue(null);

    const html = await renderer.renderComparisonsSection(
      section({ baselineTestRunId: CONTROL_GROUP_BASELINE, source: 'grafana' }), testRun);

    expect(html).toContain('this run has no control group yet');
    expect(dataFetcher.getControlGroupComparison).not.toHaveBeenCalled();
  });

  it('says why when the control group has nothing comparable', async () => {
    const html = await renderer.renderComparisonsSection(
      section({ baselineTestRunId: CONTROL_GROUP_BASELINE, source: 'dynatrace' }), testRun);

    expect(html).toContain('its control group (3 runs) has no dynatrace statistics comparable with this run');
  });

  it('draws the control-group mean as a flat dashed line on a row graph, fetching only the current run', async () => {
    dataFetcher.getControlGroupComparison.mockResolvedValue({ source: 'grafana', rows: [cpuRow] });
    dataFetcher.getMetricsTimeSeries.mockResolvedValue([{
      panelTitle: 'CPU',
      dashboardLabel: 'Kubernetes',
      metricName: 'api',
      unit: 'percent',
      key: 'Kubernetes\u00004\u0000api',
      dataPoints: [0, 1, 2, 3].map((i) => ({ time: new Date(Date.UTC(2026, 10, 7, 10, i)), value: 70 + i })),
    }]);

    const html = await renderer.renderComparisonsSection(
      section({ baselineTestRunId: CONTROL_GROUP_BASELINE, source: 'grafana', metrics: ['avg'], showRowGraphs: true }),
      testRun,
    );

    expect(dataFetcher.getMetricsTimeSeries).toHaveBeenCalledTimes(1);
    expect(dataFetcher.getMetricsTimeSeries.mock.calls[0]![0]).toBe('run-7');
    expect(html).toContain('current solid, control-group mean dashed');
    expect(html).toContain('Control group mean');
    expect(html).toContain('stroke-dasharray');
  });

  it('draws no baseline line when the section did not ask for the mean', async () => {
    dataFetcher.getControlGroupComparison.mockResolvedValue({
      source: 'grafana',
      rows: [{ ...cpuRow, metrics: [{ key: 'p95' as const, current: 90, baseline: 60, diffPercent: 50 }] }],
    });
    dataFetcher.getMetricsTimeSeries.mockResolvedValue([{
      panelTitle: 'CPU',
      dashboardLabel: 'Kubernetes',
      metricName: 'api',
      unit: 'percent',
      key: 'Kubernetes\u00004\u0000api',
      dataPoints: [0, 1].map((i) => ({ time: new Date(Date.UTC(2026, 10, 7, 10, i)), value: 80 })),
    }]);

    const html = await renderer.renderComparisonsSection(
      section({ baselineTestRunId: CONTROL_GROUP_BASELINE, source: 'grafana', metrics: ['p95'], showRowGraphs: true }),
      testRun,
    );

    expect(html).toContain('the control group has no mean for this metric');
    expect(html).not.toContain('Control group mean');
  });
});
