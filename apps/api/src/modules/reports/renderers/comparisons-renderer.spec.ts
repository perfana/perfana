import { Test, TestingModule } from '@nestjs/testing';
import { ComparisonsRenderer } from './comparisons-renderer';
import { ReportUtilsService } from '../services/report-utils.service';
import {
  ReportDataFetcherService,
  ComparisonsData,
  ComparisonMetric,
} from '../services/report-data-fetcher.service';
import type { ReportSectionConfig, TestRun } from '@perfana/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSection = (
  overrides?: Partial<ReportSectionConfig>,
): ReportSectionConfig => ({
  type: 'comparisons',
  order: 6,
  ...overrides,
});

const makeTestRun = (overrides?: Partial<TestRun>): TestRun =>
  ({
    id: 'uuid-current',
    testRunId: 'run-003',
    testEnvironment: 'staging',
    workload: 'load-test',
    systemUnderTestId: 'my-system',
    applicationRelease: 'v3.0.0',
    startTime: new Date('2025-06-03T10:00:00Z'),
    endTime: new Date('2025-06-03T11:00:00Z'),
    duration: 3600,
    completed: true,
    ...overrides,
  }) as TestRun;

const makeMetric = (overrides?: Partial<ComparisonMetric>): ComparisonMetric => ({
  dashboardLabel: 'Response Times',
  panelTitle: 'Login API',
  metricName: 'avg_response_time',
  unit: 'ms',
  currentValue: 150.0,
  baselineValue: 120.0,
  difference: 30.0,
  differencePercent: 25.0,
  conclusion: 'regression',
  ...overrides,
});

const makeComparisonsData = (overrides?: Partial<ComparisonsData>): ComparisonsData => ({
  metrics: [
    makeMetric(),
    makeMetric({
      panelTitle: 'Search API',
      metricName: 'p95_response_time',
      currentValue: 80.0,
      baselineValue: 100.0,
      difference: -20.0,
      differencePercent: -20.0,
      conclusion: 'improvement',
    }),
    makeMetric({
      dashboardLabel: 'Throughput',
      panelTitle: 'Orders',
      metricName: 'requests_per_sec',
      unit: null,
      currentValue: 500.0,
      baselineValue: 498.0,
      difference: 2.0,
      differencePercent: 0.4,
      conclusion: 'no_difference',
    }),
  ],
  regressionCount: 1,
  improvementCount: 1,
  noDifferenceCount: 1,
  totalMetrics: 3,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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
            getComparisonsData: jest.fn(),
          },
        },
      ],
    }).compile();

    renderer = module.get(ComparisonsRenderer);
    dataFetcher = module.get(ReportDataFetcherService);
  });

  // -----------------------------------------------------------------------
  // Empty / null states
  // -----------------------------------------------------------------------

  describe('empty states', () => {
    it('should render placeholder when testRun is null', async () => {
      const html = await renderer.renderComparisonsSection(makeSection(), null);
      expect(html).toContain('No comparison data available');
      expect(html).toContain('Comparisons');
    });

    it('should render placeholder when data has no metrics', async () => {
      dataFetcher.getComparisonsData.mockResolvedValue(
        makeComparisonsData({ metrics: [], totalMetrics: 0 }),
      );
      const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());
      expect(html).toContain('No comparison data available');
    });

    it('should render placeholder when fetcher returns null', async () => {
      dataFetcher.getComparisonsData.mockResolvedValue(null as any);
      const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());
      expect(html).toContain('No comparison data available');
    });
  });

  // -----------------------------------------------------------------------
  // Section header & comment
  // -----------------------------------------------------------------------

  describe('section header', () => {
    it('should use custom title from section config', async () => {
      dataFetcher.getComparisonsData.mockResolvedValue(makeComparisonsData());
      const html = await renderer.renderComparisonsSection(
        makeSection({ title: 'Baseline Comparison' }),
        makeTestRun(),
      );
      expect(html).toContain('Baseline Comparison');
    });

    it('should use default title when none provided', async () => {
      dataFetcher.getComparisonsData.mockResolvedValue(makeComparisonsData());
      const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());
      expect(html).toContain('Comparisons');
    });

    it('should render section comment when provided', async () => {
      dataFetcher.getComparisonsData.mockResolvedValue(makeComparisonsData());
      const html = await renderer.renderComparisonsSection(
        makeSection({ comment: 'Review regressions carefully' }),
        makeTestRun(),
      );
      expect(html).toContain('Review regressions carefully');
    });
  });

  // -----------------------------------------------------------------------
  // Summary badges
  // -----------------------------------------------------------------------

  describe('summary badges', () => {
    it('should render regression, improvement, no difference, and total counts', async () => {
      dataFetcher.getComparisonsData.mockResolvedValue(makeComparisonsData());
      const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());
      expect(html).toContain('>1</div>'); // regressionCount or improvementCount
      expect(html).toContain('>3</div>'); // totalMetrics
      expect(html).toContain('Regressions');
      expect(html).toContain('Improvements');
      expect(html).toContain('No Difference');
      expect(html).toContain('Total Metrics');
    });
  });

  // -----------------------------------------------------------------------
  // Grouping by dashboard
  // -----------------------------------------------------------------------

  describe('dashboard grouping', () => {
    it('should group metrics by dashboard label', async () => {
      dataFetcher.getComparisonsData.mockResolvedValue(makeComparisonsData());
      const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());
      expect(html).toContain('Response Times (2 metrics)');
      expect(html).toContain('Throughput (1 metrics)');
    });
  });

  // -----------------------------------------------------------------------
  // Comparison table content
  // -----------------------------------------------------------------------

  describe('comparison table', () => {
    it('should render metric values with formatting', async () => {
      dataFetcher.getComparisonsData.mockResolvedValue(makeComparisonsData());
      const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());
      expect(html).toContain('150.0 ms'); // current value
      expect(html).toContain('120.0 ms'); // baseline value
      expect(html).toContain('30.0 ms');  // difference
      expect(html).toContain('+25.0%');   // difference percent
    });

    it('should render improvement with negative percent', async () => {
      dataFetcher.getComparisonsData.mockResolvedValue(makeComparisonsData());
      const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());
      expect(html).toContain('-20.0%');
    });

    it('should render conclusion badges', async () => {
      dataFetcher.getComparisonsData.mockResolvedValue(makeComparisonsData());
      const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());
      expect(html).toContain('regression');
      expect(html).toContain('improvement');
      expect(html).toContain('no difference');
    });

    it('should handle null values with dashes', async () => {
      dataFetcher.getComparisonsData.mockResolvedValue(
        makeComparisonsData({
          metrics: [
            makeMetric({
              currentValue: null,
              baselineValue: null,
              difference: null,
              differencePercent: null,
            }),
          ],
          totalMetrics: 1,
          regressionCount: 0,
          improvementCount: 0,
          noDifferenceCount: 1,
        }),
      );
      const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());
      // The dash character for null values (current, baseline, diff = 3 dashes; diff% shows "—" inline)
      const dashCount = (html.match(/\u2014/g) || []).length;
      expect(dashCount).toBeGreaterThanOrEqual(4); // current, baseline, diff, diff%
    });
  });

  // -----------------------------------------------------------------------
  // Config: baselineTestRunId
  // -----------------------------------------------------------------------

  describe('baselineTestRunId config', () => {
    it('should pass baselineTestRunId to data fetcher when provided', async () => {
      dataFetcher.getComparisonsData.mockResolvedValue(makeComparisonsData());
      await renderer.renderComparisonsSection(
        makeSection({ config: { baselineTestRunId: 'run-001' } }),
        makeTestRun(),
      );
      expect(dataFetcher.getComparisonsData).toHaveBeenCalledWith('run-003', 'run-001');
    });

    it('should pass undefined when no baselineTestRunId', async () => {
      dataFetcher.getComparisonsData.mockResolvedValue(makeComparisonsData());
      await renderer.renderComparisonsSection(makeSection(), makeTestRun());
      expect(dataFetcher.getComparisonsData).toHaveBeenCalledWith('run-003', undefined);
    });
  });

  // -----------------------------------------------------------------------
  // XSS protection
  // -----------------------------------------------------------------------

  describe('XSS protection', () => {
    it('should escape HTML in title', async () => {
      dataFetcher.getComparisonsData.mockResolvedValue(makeComparisonsData());
      const html = await renderer.renderComparisonsSection(
        makeSection({ title: '<script>alert("xss")</script>' }),
        makeTestRun(),
      );
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should escape HTML in metric names', async () => {
      dataFetcher.getComparisonsData.mockResolvedValue(
        makeComparisonsData({
          metrics: [makeMetric({ metricName: '<img onerror=alert(1)>' })],
          totalMetrics: 1,
        }),
      );
      const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());
      expect(html).not.toContain('<img');
    });
  });
});
