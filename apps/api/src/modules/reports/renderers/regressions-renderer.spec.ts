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
    expect(html).toContain('No ADAPT regression analysis data available');
    expect(dataFetcher.getRegressionsData).not.toHaveBeenCalled();
  });

  it('should render placeholder when no data returned', async () => {
    dataFetcher.getRegressionsData.mockResolvedValue(null);

    const html = await renderer.renderRegressionsSection(makeSection(), makeTestRun());

    expect(html).toContain('No ADAPT regression analysis data available');
  });

  it('should render summary badges with counts', async () => {
    dataFetcher.getRegressionsData.mockResolvedValue(
      makeRegressionsData({
        regressionCount: 3,
        improvementCount: 2,
        totalMetrics: 15,
      }),
    );

    const html = await renderer.renderRegressionsSection(makeSection(), makeTestRun());

    expect(html).toContain('>3<');
    expect(html).toContain('>2<');
    expect(html).toContain('>15<');
    expect(html).toContain('Regressions');
    expect(html).toContain('Improvements');
    expect(html).toContain('Total Metrics');
  });

  it('should render regression conclusion banner', async () => {
    dataFetcher.getRegressionsData.mockResolvedValue(
      makeRegressionsData({ conclusion: 'regression' }),
    );

    const html = await renderer.renderRegressionsSection(makeSection(), makeTestRun());

    expect(html).toContain('Regression Detected');
  });

  it('should render no_difference conclusion', async () => {
    dataFetcher.getRegressionsData.mockResolvedValue(
      makeRegressionsData({ conclusion: 'no_difference' }),
    );

    const html = await renderer.renderRegressionsSection(makeSection(), makeTestRun());

    expect(html).toContain('No Difference');
  });

  it('should render regression metrics table', async () => {
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
  });

  it('should not show improvements by default', async () => {
    dataFetcher.getRegressionsData.mockResolvedValue(
      makeRegressionsData({
        improvementCount: 1,
        improvements: [makeMetric({ conclusionLabel: 'improvement' })],
      }),
    );

    const html = await renderer.renderRegressionsSection(makeSection(), makeTestRun());

    // The improvements table should not be rendered by default
    const improvementsTableMatches = html.match(/Improvements \(\d+\)/g);
    expect(improvementsTableMatches).toBeNull();
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

    expect(html).toContain('Improvements (1)');
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
    expect(html).toContain('section-comment');
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
