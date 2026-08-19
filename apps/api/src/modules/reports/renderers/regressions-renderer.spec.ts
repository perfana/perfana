import { Test, TestingModule } from '@nestjs/testing';
import { RegressionsRenderer } from './regressions-renderer';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService } from '../services/report-data-fetcher.service';
import { ReportSectionConfig, TestRun } from '@perfana/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSection = (
  overrides?: Partial<ReportSectionConfig>,
): ReportSectionConfig => ({ type: 'regressions', order: 0, ...overrides });

const makeTestRun = (overrides?: Partial<TestRun>): TestRun =>
  ({
    id: 'uuid-1',
    testRunId: 'run-001',
    testEnvironment: 'staging',
    workload: 'load-test',
    systemUnderTestId: 'system-1',
    ...overrides,
  }) as TestRun;

const makeRegressionsData = (overrides?: Record<string, unknown>) => ({
  conclusion: 'no_difference',
  regressionCount: 0,
  improvementCount: 0,
  totalMetrics: 10,
  regressions: [],
  improvements: [],
  ...overrides,
});

const makeControlGroup = (overrides?: Record<string, unknown>) => ({
  id: 'cg-1',
  testRuns: ['run-a', 'run-b', 'run-c', 'run-d'],
  nTestRuns: 4,
  firstDatetime: '2026-08-01T10:00:00.000Z',
  lastDatetime: '2026-08-04T10:00:00.000Z',
  ...overrides,
});

const makeMetric = (overrides?: Record<string, unknown>) => ({
  dashboardLabel: 'API Dashboard',
  panelTitle: 'Response Time',
  metricName: 'avg',
  testValue: 120,
  controlValue: 100,
  difference: 20,
  differencePercent: 20.0,
  unit: 'ms',
  conclusionLabel: 'regression',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RegressionsRenderer', () => {
  let renderer: RegressionsRenderer;
  let dataFetcher: jest.Mocked<ReportDataFetcherService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegressionsRenderer,
        ReportUtilsService,
        {
          provide: ReportDataFetcherService,
          useValue: {
            getRegressionsData: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    renderer = module.get(RegressionsRenderer);
    dataFetcher = module.get(ReportDataFetcherService);
  });

  it('should render placeholder when testRun is null', async () => {
    const html = await renderer.renderRegressionsSection(makeSection(), null);

    expect(html).toContain('regressions-section');
    expect(html).toContain('No ADAPT anomaly detection data available');
    expect(dataFetcher.getRegressionsData).not.toHaveBeenCalled();
  });

  it('should render placeholder when no data returned', async () => {
    dataFetcher.getRegressionsData.mockResolvedValue(null);

    const html = await renderer.renderRegressionsSection(makeSection(), makeTestRun());

    expect(html).toContain('No ADAPT anomaly detection data available');
  });

  it('should render summary chips with counts in the section header', async () => {
    dataFetcher.getRegressionsData.mockResolvedValue(
      makeRegressionsData({
        regressionCount: 3,
        improvementCount: 2,
        totalMetrics: 15,
        controlGroup: makeControlGroup(),
      }),
    );

    const html = await renderer.renderRegressionsSection(makeSection(), makeTestRun());

    expect(html).toContain('3 regressions');
    expect(html).toContain('2 improvements');
    expect(html).toContain('control group: 4 runs');
    // The total-metric count counted every ADAPT result and matched nothing in the section.
    expect(html).not.toContain('15 metrics');
  });

  it('names the runs in the control group and the window they span', async () => {
    dataFetcher.getRegressionsData.mockResolvedValue(
      makeRegressionsData({ controlGroup: makeControlGroup() }),
    );

    const html = await renderer.renderRegressionsSection(makeSection(), makeTestRun());

    expect(html).toContain('Compared against 4 previous runs');
    expect(html).toContain('run-a');
    expect(html).toContain('run-d');
    expect(html).toMatch(/Aug 1, 2026.*Aug 4, 2026/s);
  });

  it('truncates a long control group instead of filling the page with ids', async () => {
    dataFetcher.getRegressionsData.mockResolvedValue(
      makeRegressionsData({
        controlGroup: makeControlGroup({
          nTestRuns: 20,
          testRuns: Array.from({ length: 20 }, (_, i) => `run-${i}`),
        }),
      }),
    );

    const html = await renderer.renderRegressionsSection(makeSection(), makeTestRun());

    expect(html).toContain('Compared against 20 previous runs');
    expect(html).toContain('and 8 more');
    expect(html).not.toContain('run-19');
  });

  it('says nothing about a control group when ADAPT recorded none', async () => {
    dataFetcher.getRegressionsData.mockResolvedValue(makeRegressionsData());

    const html = await renderer.renderRegressionsSection(makeSection(), makeTestRun());

    expect(html).not.toContain('control group');
    expect(html).not.toContain('Compared against');
  });

  it('drops the overall status pill — the counts beside it already say the verdict', async () => {
    dataFetcher.getRegressionsData.mockResolvedValue(
      makeRegressionsData({ conclusion: 'regression', regressionCount: 3 }),
    );

    const html = await renderer.renderRegressionsSection(makeSection(), makeTestRun());

    expect(html).toContain('3 regressions');
    expect(html).not.toContain('>REGRESSION</span>');
  });

  it('says "no anomalies" when a decided run has neither regressions nor improvements', async () => {
    dataFetcher.getRegressionsData.mockResolvedValue(
      makeRegressionsData({ conclusion: 'no_difference' }),
    );

    const html = await renderer.renderRegressionsSection(makeSection(), makeTestRun());

    expect(html).toContain('no anomalies');
    expect(html).not.toContain('>OK</span>');
  });

  it('should append a neutral reason chip when the conclusion collapses to N/A', async () => {
    dataFetcher.getRegressionsData.mockResolvedValue(
      makeRegressionsData({ conclusion: 'INSUFFICIENT_DATA' }),
    );

    const html = await renderer.renderRegressionsSection(makeSection(), makeTestRun());

    expect(html).toContain('>N/A</span>');
    expect(html).toContain('>insufficient data</span>'); // human-readable reason chip
  });

  it('should show a skipped reason chip next to the N/A pill', async () => {
    dataFetcher.getRegressionsData.mockResolvedValue(
      makeRegressionsData({ conclusion: 'SKIPPED' }),
    );

    const html = await renderer.renderRegressionsSection(makeSection(), makeTestRun());

    expect(html).toContain('>N/A</span>');
    expect(html).toContain('>skipped</span>');
  });

  it('should not show a reason chip when the conclusion has a verdict', async () => {
    dataFetcher.getRegressionsData.mockResolvedValue(
      makeRegressionsData({ conclusion: 'regression', regressionCount: 1 }),
    );

    const html = await renderer.renderRegressionsSection(makeSection(), makeTestRun());

    expect(html).not.toContain('>N/A</span>');
    expect(html).not.toContain('>regression</span>'); // no lowercase raw-label chip
  });

  it('should render regression metrics table with delta arrow bound to the value', async () => {
    dataFetcher.getRegressionsData.mockResolvedValue(
      makeRegressionsData({
        regressionCount: 1,
        regressions: [makeMetric()],
      }),
    );

    const html = await renderer.renderRegressionsSection(makeSection(), makeTestRun());

    expect(html).toContain('API Dashboard');
    expect(html).toContain('Response Time');
    expect(html).toContain('+20.0%');
    expect(html).toContain('▲'); // arrow tracks the positive diff (rule 02)
  });

  it('collapses raw conclusion labels onto the five-state scale (rule 01)', async () => {
    dataFetcher.getRegressionsData.mockResolvedValue(
      makeRegressionsData({
        conclusion: 'REGRESSION',
        regressionCount: 3,
        regressions: [
          makeMetric({ conclusionLabel: 'regression' }),
          makeMetric({ panelTitle: 'P1', conclusionLabel: 'increase' }),
          makeMetric({ panelTitle: 'P2', conclusionLabel: 'partial increase', differencePercent: 12 }),
          makeMetric({ panelTitle: 'P3', conclusionLabel: 'incomparable', testValue: null, controlValue: null, differencePercent: null }),
        ],
      }),
    );

    const html = await renderer.renderRegressionsSection(makeSection(), makeTestRun());

    // Five-state labels present
    expect(html).toContain('>REGRESSION</span>');
    expect(html).toContain('>WARNING</span>');
    expect(html).toContain('>N/A</span>');
    // Old labels gone
    expect(html).not.toContain('>INCREASE<');
    expect(html).not.toContain('>increase<');
    expect(html).not.toMatch(/partial/i);
    expect(html).not.toMatch(/incomparable/i);
    // Generic minus / old emoji icons gone (rule 02/04)
    expect(html).not.toContain('➖');
    expect(html).not.toContain('&#x2796;');
    expect(html).not.toContain('&#x2714;');
    expect(html).not.toContain('&#x2753;');
  });

  it('should not show improvements by default', async () => {
    dataFetcher.getRegressionsData.mockResolvedValue(
      makeRegressionsData({
        improvementCount: 1,
        improvements: [makeMetric({ conclusionLabel: 'improvement' })],
      }),
    );

    const html = await renderer.renderRegressionsSection(makeSection(), makeTestRun());

    // The improvements table (group header) should not be rendered by default
    expect(html).not.toContain('>Improvements</h3>');
  });

  it('should show improvements when config.showImprovements is true', async () => {
    dataFetcher.getRegressionsData.mockResolvedValue(
      makeRegressionsData({
        improvementCount: 1,
        improvements: [makeMetric({ conclusionLabel: 'improvement' })],
      }),
    );

    const html = await renderer.renderRegressionsSection(
      makeSection({ config: { showImprovements: true } }),
      makeTestRun(),
    );

    expect(html).toContain('>Improvements</h3>');
    expect(html).toContain('1 metrics');
    expect(html).toContain('>IMPROVEMENT</span>');
  });

  it('caps the table at config.maxItems', async () => {
    dataFetcher.getRegressionsData.mockResolvedValue(
      makeRegressionsData({
        regressionCount: 3,
        regressions: [
          makeMetric({ panelTitle: 'P1' }),
          makeMetric({ panelTitle: 'P2' }),
          makeMetric({ panelTitle: 'P3' }),
        ],
      }),
    );

    const html = await renderer.renderRegressionsSection(
      makeSection({ config: { maxItems: 2 } }),
      makeTestRun(),
    );

    expect(html).toContain('P1');
    expect(html).toContain('P2');
    expect(html).not.toContain('P3');
  });

  it('should render custom title', async () => {
    dataFetcher.getRegressionsData.mockResolvedValue(makeRegressionsData());

    const html = await renderer.renderRegressionsSection(
      makeSection({ title: 'ADAPT Analysis' }),
      makeTestRun(),
    );

    expect(html).toContain('ADAPT Analysis');
  });

  it('should render comment when provided', async () => {
    dataFetcher.getRegressionsData.mockResolvedValue(makeRegressionsData());

    const html = await renderer.renderRegressionsSection(
      makeSection({ comment: 'Check with team lead' }),
      makeTestRun(),
    );

    expect(html).toContain('Check with team lead');
    expect(html).toContain('section-text');
  });

  it('should escape HTML in metric names', async () => {
    dataFetcher.getRegressionsData.mockResolvedValue(
      makeRegressionsData({
        regressionCount: 1,
        regressions: [makeMetric({ panelTitle: '<script>xss</script>' })],
      }),
    );

    const html = await renderer.renderRegressionsSection(makeSection(), makeTestRun());

    expect(html).not.toContain('<script>xss</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
