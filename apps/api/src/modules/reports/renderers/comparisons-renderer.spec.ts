import { Test, TestingModule } from '@nestjs/testing';
import { ComparisonsRenderer } from './comparisons-renderer';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService } from '../services/report-data-fetcher.service';
import { ReportSectionConfig, TestRun } from '@perfana/shared';

const makeSection = (
  overrides?: Partial<ReportSectionConfig>,
): ReportSectionConfig => ({ type: 'comparisons', order: 0, ...overrides });

const makeTestRun = (overrides?: Partial<TestRun>): TestRun =>
  ({
    id: 'uuid-1',
    testRunId: 'run-001',
    testEnvironment: 'staging',
    workload: 'load-test',
    systemUnderTestId: 'system-1',
    ...overrides,
  }) as TestRun;

const makeMetric = (overrides?: Record<string, unknown>) => ({
  dashboardLabel: 'API Dashboard',
  panelTitle: 'Response Time',
  metricName: 'avg',
  unit: 'ms',
  currentValue: 120,
  baselineValue: 100,
  difference: 20,
  differencePercent: 20.0,
  conclusion: 'regression',
  ...overrides,
});

const makeComparisonsData = (overrides?: Record<string, unknown>) => ({
  metrics: [
    makeMetric(),
    makeMetric({
      panelTitle: 'Throughput',
      metricName: 'req/s',
      unit: null,
      currentValue: 500,
      baselineValue: 450,
      difference: 50,
      differencePercent: 11.1,
      conclusion: 'improvement',
    }),
    makeMetric({
      panelTitle: 'Error Rate',
      metricName: 'pct',
      unit: '%',
      currentValue: 0.5,
      baselineValue: 0.5,
      difference: 0,
      differencePercent: 0,
      conclusion: 'no_difference',
    }),
  ],
  regressionCount: 1,
  improvementCount: 1,
  noDifferenceCount: 1,
  totalMetrics: 3,
  ...overrides,
});

describe('ComparisonsRenderer', () => {
  let renderer: ComparisonsRenderer;
  let dataFetcher: jest.Mocked<ReportDataFetcherService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComparisonsRenderer,
        ReportUtilsService,
        {
          provide: ReportDataFetcherService,
          useValue: {
            getComparisonsData: jest.fn().mockResolvedValue(null),
            getBaselineRunComparison: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    renderer = module.get(ComparisonsRenderer);
    dataFetcher = module.get(ReportDataFetcherService);
  });

  it('should render placeholder when testRun is null', async () => {
    const html = await renderer.renderComparisonsSection(makeSection(), null);

    expect(html).toContain('comparisons-section');
    expect(html).toContain('No comparison data available');
    expect(dataFetcher.getComparisonsData).not.toHaveBeenCalled();
  });

  it('should render placeholder when no data returned', async () => {
    dataFetcher.getComparisonsData.mockResolvedValue(null);

    const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());

    expect(html).toContain('No comparison data available');
  });

  it('should render summary badges with counts', async () => {
    dataFetcher.getComparisonsData.mockResolvedValue(makeComparisonsData() as any);

    const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());

    expect(html).toContain('Regressions');
    expect(html).toContain('Improvements');
    expect(html).toContain('No Difference');
    expect(html).toContain('Total Metrics');
    expect(html).toContain('3 metrics compared');
  });

  it('should render comparison table grouped by dashboard', async () => {
    dataFetcher.getComparisonsData.mockResolvedValue(makeComparisonsData() as any);

    const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());

    expect(html).toContain('API Dashboard');
    expect(html).toContain('Response Time');
    expect(html).toContain('Throughput');
    expect(html).toContain('Error Rate');
    expect(html).toContain('120.0 ms');
    expect(html).toContain('100.0 ms');
    expect(html).toContain('+20.0%');
  });

  it('should render conclusion badges per metric', async () => {
    dataFetcher.getComparisonsData.mockResolvedValue(makeComparisonsData() as any);

    const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());

    expect(html).toContain('regression');
    expect(html).toContain('improvement');
    expect(html).toContain('no difference');
  });

  it('should render custom title and comment', async () => {
    dataFetcher.getComparisonsData.mockResolvedValue(makeComparisonsData() as any);

    const html = await renderer.renderComparisonsSection(
      makeSection({ title: 'Run Comparison', comment: 'vs baseline run' }),
      makeTestRun(),
    );

    expect(html).toContain('Run Comparison');
    expect(html).toContain('vs baseline run');
  });

  it('should pass baselineTestRunId from config', async () => {
    dataFetcher.getComparisonsData.mockResolvedValue(makeComparisonsData() as any);

    await renderer.renderComparisonsSection(
      makeSection({ config: { baselineTestRunId: 'baseline-run-123' } }),
      makeTestRun(),
    );

    expect(dataFetcher.getComparisonsData).toHaveBeenCalledWith('run-001', 'baseline-run-123');
  });

  it('should group metrics by dashboard', async () => {
    const data = makeComparisonsData({
      metrics: [
        makeMetric({ dashboardLabel: 'Dashboard A', panelTitle: 'Panel 1' }),
        makeMetric({ dashboardLabel: 'Dashboard A', panelTitle: 'Panel 2' }),
        makeMetric({ dashboardLabel: 'Dashboard B', panelTitle: 'Panel 3' }),
      ],
    });

    dataFetcher.getComparisonsData.mockResolvedValue(data as any);

    const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());

    expect(html).toContain('Dashboard A (2 metrics)');
    expect(html).toContain('Dashboard B (1 metrics)');
  });

  it('should handle empty metrics gracefully', async () => {
    dataFetcher.getComparisonsData.mockResolvedValue(
      makeComparisonsData({ metrics: [], totalMetrics: 0 }) as any,
    );

    const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());

    expect(html).toContain('No comparison data available');
  });

  it('should format different unit types', async () => {
    const data = makeComparisonsData({
      metrics: [
        makeMetric({ unit: 'ms', currentValue: 250.6 }),
        makeMetric({ panelTitle: 'CPU', metricName: 'usage', unit: '%', currentValue: 75.3 }),
        makeMetric({ panelTitle: 'Memory', metricName: 'used', unit: 'bytes', currentValue: 1073741824 }),
      ],
    });

    dataFetcher.getComparisonsData.mockResolvedValue(data as any);

    const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());

    expect(html).toContain('250.6 ms');
    expect(html).toContain('75.3%');
    expect(html).toContain('1.0 GB');
  });

  it('renders baseline_run mode grouped by scenario with band colors', async () => {
    const data = { source: 'performance-metrics', rows: [
      { group: 'checkout', label: 'login', metrics: [
        { key: 'avg', current: 110, baseline: 100, diffPercent: 10 },
        { key: 'p95', current: 220, baseline: 200, diffPercent: 10 },
      ] },
    ] };
    jest.spyOn(dataFetcher, 'getBaselineRunComparison').mockResolvedValue(data as any);
    const html = await renderer.renderComparisonsSection(
      { type: 'comparisons', order: 0, config: {
        comparisonMode: 'baseline_run', baselineTestRunId: 'base', source: 'performance-metrics',
        metrics: ['avg','p95'], thresholds: { good: 10, warning: 50 } } } as any,
      { testRunId: 'cur' } as any,
    );
    expect(html).toContain('checkout');
    expect(html).toContain('login');
    expect(html).toContain('#f59e0b'); // 10% == not < good(10) => amber band
  });

  it('renders dynatrace as ONE merged table: host folded into heading, id prefix stripped, 2dp values', async () => {
    const data = { source: 'dynatrace', rows: [
      { group: 'HOST-123', label: 'HOST-123_afterburner-be_Memory Usage', metrics: [
        { key: 'avg', current: 74.005882, baseline: 70, diffPercent: 5.7 },
      ] },
      { group: 'HOST-123', label: 'HOST-123_afterburner-be_CPU Usage', metrics: [
        { key: 'avg', current: 25.5, baseline: 20, diffPercent: 27.5 },
      ] },
    ] };
    jest.spyOn(dataFetcher, 'getBaselineRunComparison').mockResolvedValue(data as any);
    const html = await renderer.renderComparisonsSection(
      { type: 'comparisons', order: 0, config: {
        comparisonMode: 'baseline_run', baselineTestRunId: 'base', source: 'dynatrace',
        metrics: ['avg'], thresholds: { good: 10, warning: 50 } } } as any,
      { testRunId: 'cur' } as any,
    );
    expect(html).toContain('Dynatrace · afterburner-be'); // host name folded into the heading
    expect(html).toContain('Memory Usage');               // id prefix stripped from the metric
    expect(html).not.toContain('HOST-123_');              // raw entity-id label never shown
    expect(html).toContain('74.01');                      // rounded to 2 dp
    expect(html).toContain('>Metric</th>');               // single Metric column
  });

  it('renders grafana as ONE merged table with a Grafana heading and labels as-is', async () => {
    const data = { source: 'grafana', rows: [
      { group: 'JVM / Heap', label: 'heap used', metrics: [
        { key: 'avg', current: 1200.456, baseline: 1000, diffPercent: 20 },
      ] },
    ] };
    jest.spyOn(dataFetcher, 'getBaselineRunComparison').mockResolvedValue(data as any);
    const html = await renderer.renderComparisonsSection(
      { type: 'comparisons', order: 0, config: {
        comparisonMode: 'baseline_run', baselineTestRunId: 'base', source: 'grafana',
        metrics: ['avg'], thresholds: { good: 10, warning: 50 } } } as any,
      { testRunId: 'cur' } as any,
    );
    expect(html).toContain('>Grafana</h3>');
    expect(html).toContain('heap used');
    expect(html).toContain('1,200.46'); // thousands-grouped, 2 dp
  });

  it('shows empty state when baseline data is null', async () => {
    jest.spyOn(dataFetcher, 'getBaselineRunComparison').mockResolvedValue(null);
    const html = await renderer.renderComparisonsSection(
      { type: 'comparisons', order: 0, config: { comparisonMode: 'baseline_run', baselineTestRunId: 'base', source: 'grafana' } } as any,
      { testRunId: 'cur' } as any);
    expect(html).toContain('No comparison data available for the selected baseline run');
  });

  it('seam: forwards userId and roles into getBaselineRunComparison opts (regression guard)', async () => {
    const spy = jest.spyOn(dataFetcher, 'getBaselineRunComparison').mockResolvedValue(null);
    await renderer.renderComparisonsSection(
      { type: 'comparisons', order: 0, config: {
        comparisonMode: 'baseline_run', baselineTestRunId: 'base-99', source: 'performance-metrics',
        metrics: ['avg', 'p95'], thresholds: { good: 5, warning: 20 },
      } } as any,
      { testRunId: 'cur-42' } as any,
      'user-1',
      ['user'],
    );
    expect(spy).toHaveBeenCalledTimes(1);
    const optsArg = spy.mock.calls[0]![3];
    expect(optsArg.userId).toBe('user-1');
    expect(optsArg.roles).toEqual(['user']);
  });

  it('forwards dashboardLabel and panel ids from the config into the fetcher opts', async () => {
    const spy = jest.spyOn(dataFetcher, 'getBaselineRunComparison').mockResolvedValue(null);
    await renderer.renderComparisonsSection(
      { type: 'comparisons', order: 0, config: {
        comparisonMode: 'baseline_run', baselineTestRunId: 'base-99', source: 'grafana',
        dashboardLabel: 'JVM Metrics',
        panels: [{ id: 3, title: 'Heap' }, { id: 7, title: 'GC Pause' }],
      } } as any,
      { testRunId: 'cur-42' } as any,
      'user-1',
      ['user'],
    );
    const optsArg = spy.mock.calls[0]![3];
    expect(optsArg.dashboardLabel).toBe('JVM Metrics');
    expect(optsArg.panelIds).toEqual([3, 7]);
  });
});
