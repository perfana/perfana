import { Test, TestingModule } from '@nestjs/testing';
import { TrendsRenderer } from './trends-renderer';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, TrendsData, TrendRunSummary } from '../services/report-data-fetcher.service';
import { ReportSectionConfig, TestRun } from '@perfana/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSection = (
  overrides?: Partial<ReportSectionConfig>,
): ReportSectionConfig => ({
  type: 'trends',
  order: 5,
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

const makeRunSummary = (overrides?: Partial<TrendRunSummary>): TrendRunSummary => ({
  testRunId: 'run-001',
  startTime: new Date('2025-06-01T10:00:00Z'),
  applicationRelease: 'v1.0.0',
  duration: 3600,
  avgMs: 120.5,
  p95Ms: 250.0,
  p99Ms: 400.0,
  errorRate: 0.5,
  totalTransactions: 10000,
  consolidatedResult: null,
  ...overrides,
});

const makeTrendsData = (overrides?: Partial<TrendsData>): TrendsData => ({
  currentRun: makeRunSummary({
    testRunId: 'run-003',
    startTime: new Date('2025-06-03T10:00:00Z'),
    applicationRelease: 'v3.0.0',
    avgMs: 95.0,
    p95Ms: 200.0,
    p99Ms: 350.0,
    errorRate: 0.2,
    totalTransactions: 12000,
  }),
  previousRuns: [
    makeRunSummary({
      testRunId: 'run-002',
      startTime: new Date('2025-06-02T10:00:00Z'),
      applicationRelease: 'v2.0.0',
      avgMs: 110.0,
      p95Ms: 230.0,
      p99Ms: 380.0,
      errorRate: 0.4,
      totalTransactions: 11000,
    }),
    makeRunSummary({
      testRunId: 'run-001',
      startTime: new Date('2025-06-01T10:00:00Z'),
      applicationRelease: 'v1.0.0',
      avgMs: 120.5,
      p95Ms: 250.0,
      p99Ms: 400.0,
      errorRate: 0.5,
      totalTransactions: 10000,
    }),
  ],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('TrendsRenderer', () => {
  let renderer: TrendsRenderer;
  let dataFetcher: jest.Mocked<ReportDataFetcherService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrendsRenderer,
        ReportUtilsService,
        {
          provide: ReportDataFetcherService,
          useValue: {
            getTrendsData: jest.fn().mockResolvedValue(makeTrendsData()),
            getMetricTrends: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    renderer = module.get(TrendsRenderer);
    dataFetcher = module.get(ReportDataFetcherService);
  });

  describe('section header', () => {
    it('should render with default title', async () => {
      const html = await renderer.renderTrendsSection(makeSection(), makeTestRun());

      expect(html).toContain('Performance Trends');
      expect(html).toContain('3 runs compared'); // natural case — the kicker CSS uppercases
    });

    it('should use custom title', async () => {
      const section = makeSection({ title: 'Weekly Trend Report' });
      const html = await renderer.renderTrendsSection(section, makeTestRun());

      expect(html).toContain('Weekly Trend Report');
    });

    it('should render comment when provided', async () => {
      const section = makeSection({ comment: 'Comparing last 3 sprint runs' });
      const html = await renderer.renderTrendsSection(section, makeTestRun());

      expect(html).toContain('Comparing last 3 sprint runs');
      expect(html).toContain('section-text');
    });
  });

  describe('trend summary cards', () => {
    it('should show current run metrics', async () => {
      const html = await renderer.renderTrendsSection(makeSection(), makeTestRun());

      expect(html).toContain('95 ms'); // avg
      expect(html).toContain('200 ms'); // p95
      expect(html).toContain('0.2%'); // error rate
      expect(html).toContain('12,000'); // total transactions (grouped)
    });

    it('should show delta percentages vs previous run', async () => {
      const html = await renderer.renderTrendsSection(makeSection(), makeTestRun());

      // Avg went from 110 to 95 = -13.6% (improvement for lower-is-better)
      expect(html).toContain('vs previous');
    });
  });

  describe('run history table', () => {
    it('should render all runs in chronological order', async () => {
      const html = await renderer.renderTrendsSection(makeSection(), makeTestRun());

      expect(html).toContain('Run History');
      expect(html).toContain('data-table');
      // Check all releases are present
      expect(html).toContain('v1.0.0');
      expect(html).toContain('v2.0.0');
      expect(html).toContain('v3.0.0');
    });

    it('should highlight current run with a compact marker chip', async () => {
      const html = await renderer.renderTrendsSection(makeSection(), makeTestRun());

      // markerChip('Current','info'): natural-case label, CSS uppercases; compact table sizing
      expect(html).toContain('>Current</span>');
      expect(html).toContain('padding:2px 8px');
      expect(html).toContain('#e3f2fd'); // highlight color
    });

    it('should show response time metrics for each run', async () => {
      const html = await renderer.renderTrendsSection(makeSection(), makeTestRun());

      // Check run-001 metrics (formatNum: grouped, max 2 decimals)
      expect(html).toContain('120.5');
      expect(html).toContain('250');
      expect(html).toContain('400');
    });
  });

  describe('no data states', () => {
    it('should render fallback when testRun is null', async () => {
      const html = await renderer.renderTrendsSection(makeSection(), null);

      expect(html).toContain('No test run data available');
      expect(dataFetcher.getTrendsData).not.toHaveBeenCalled();
    });

    it('should render fallback when no previous runs exist', async () => {
      dataFetcher.getTrendsData.mockResolvedValue({
        currentRun: makeRunSummary({ testRunId: 'run-003' }),
        previousRuns: [],
      });

      const html = await renderer.renderTrendsSection(makeSection(), makeTestRun());

      expect(html).toContain('No previous runs found');
    });

    it('should render fallback when getTrendsData returns null', async () => {
      dataFetcher.getTrendsData.mockResolvedValue(null);

      const html = await renderer.renderTrendsSection(makeSection(), makeTestRun());

      expect(html).toContain('No previous runs found');
    });
  });

  describe('config options', () => {
    it('leads with the aggregated trend even when nothing is selected', async () => {
      const html = await renderer.renderTrendsSection(makeSection(), makeTestRun());

      expect(html).toContain('Aggregated Performance Trends');
      expect(html).toContain('Run History');
      expect(dataFetcher.getMetricTrends).not.toHaveBeenCalled();
    });

    it('renders one table per selected dashboard, a row per series and a column per run', async () => {
      dataFetcher.getMetricTrends.mockResolvedValue([
        {
          dashboardLabel: 'JVM', panelTitle: 'Heap', metricName: 'used', unit: 'bytes',
          valuesByRun: { 'run-001': 100, 'run-002': 110, 'run-003': 150 },
        },
        {
          dashboardLabel: 'Docker', panelTitle: 'CPU', metricName: 'cpu', unit: 'percent',
          valuesByRun: { 'run-001': 20, 'run-003': 10 },
        },
      ]);

      const html = await renderer.renderTrendsSection(
        makeSection({ config: { dashboardLabels: ['JVM', 'Docker'] } }),
        makeTestRun(),
      );

      // Selection reaches the fetcher as scopes, with the runs of the window
      expect(dataFetcher.getMetricTrends).toHaveBeenCalledWith(
        ['run-001', 'run-002', 'run-003'],
        [{ dashboardLabel: 'JVM' }, { dashboardLabel: 'Docker' }],
      );
      // A table per dashboard, keyed by its own group header
      expect(html).toContain('>JVM</h3>');
      expect(html).toContain('>Docker</h3>');
      expect(html).toContain('used');
      expect(html).toContain('cpu');
      // Change across the window: 100 -> 150
      expect(html).toContain('+50.0%');
      // A run with no value for a series is an em-dash, not a zero
      expect(html).toContain('—');
    });

    it('reads the run count the config form writes', async () => {
      await renderer.renderTrendsSection(
        makeSection({ config: { timeRange: { runCount: 7 } } }),
        makeTestRun(),
        'user-1',
        ['user'],
      );

      expect(dataFetcher.getTrendsData).toHaveBeenCalledWith(expect.anything(), 7, 'user-1', ['user']);
    });

    it('should pass maxRuns config to data fetcher', async () => {
      const section = makeSection({ config: { maxRuns: 5 } });
      await renderer.renderTrendsSection(section, makeTestRun(), 'user-1', ['user']);

      expect(dataFetcher.getTrendsData).toHaveBeenCalledWith(
        expect.anything(),
        5,
        'user-1',
        ['user'],
      );
    });

    it('should default maxRuns to 10', async () => {
      await renderer.renderTrendsSection(makeSection(), makeTestRun());

      expect(dataFetcher.getTrendsData).toHaveBeenCalledWith(
        expect.anything(),
        10,
        '',
        [],
      );
    });
  });

  describe('HTML escaping', () => {
    it('should escape HTML in title', async () => {
      const section = makeSection({ title: '<script>xss</script>' });
      const html = await renderer.renderTrendsSection(section, makeTestRun());

      expect(html).not.toContain('<script>xss</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should escape HTML in release names', async () => {
      dataFetcher.getTrendsData.mockResolvedValue(makeTrendsData({
        currentRun: makeRunSummary({
          testRunId: 'run-003',
          applicationRelease: '<img onerror=alert(1)>',
        }),
        previousRuns: [
          makeRunSummary({ testRunId: 'run-002' }),
        ],
      }));

      const html = await renderer.renderTrendsSection(makeSection(), makeTestRun());

      expect(html).not.toContain('<img onerror');
      expect(html).toContain('&lt;img onerror');
    });
  });

  describe('trend direction', () => {
    it('should show improvement when response time decreases', async () => {
      dataFetcher.getTrendsData.mockResolvedValue(makeTrendsData({
        currentRun: makeRunSummary({ testRunId: 'run-003', avgMs: 50 }),
        previousRuns: [makeRunSummary({ testRunId: 'run-002', avgMs: 100 })],
      }));

      const html = await renderer.renderTrendsSection(makeSection(), makeTestRun());

      // Lower avg is better: arrow tracks the value, chip colored as improvement (info)
      expect(html).toContain('▼');
      expect(html).toContain('-50.0%');
      expect(html).toContain('#2b64b3'); // info fg for improvement
    });

    it('should show degradation when response time increases', async () => {
      dataFetcher.getTrendsData.mockResolvedValue(makeTrendsData({
        currentRun: makeRunSummary({ testRunId: 'run-003', avgMs: 200 }),
        previousRuns: [makeRunSummary({ testRunId: 'run-002', avgMs: 100 })],
      }));

      const html = await renderer.renderTrendsSection(makeSection(), makeTestRun());

      // Higher avg is worse: arrow up, chip colored as regression (bad)
      expect(html).toContain('▲');
      expect(html).toContain('+100.0%');
      expect(html).toContain('#c1362f'); // bad fg for regression
    });

    it('should render a flat delta as a single neutral em-dash chip', async () => {
      dataFetcher.getTrendsData.mockResolvedValue(makeTrendsData({
        currentRun: makeRunSummary({ testRunId: 'run-003', avgMs: 100, p95Ms: 200, p99Ms: 300, errorRate: 0.5, totalTransactions: 10000 }),
        previousRuns: [makeRunSummary({ testRunId: 'run-002', avgMs: 100, p95Ms: 200, p99Ms: 300, errorRate: 0.5, totalTransactions: 10000 })],
      }));

      const html = await renderer.renderTrendsSection(makeSection(), makeTestRun());

      // deltaChip(0) → neutral '—' chip, no arrow, no signed zero percentage
      expect(html).toContain('background:#f1f1f3; color:#7a828b;">—</span>');
      expect(html).not.toContain('+0.0%');
      expect(html).not.toContain('-0.0%');
    });
  });

  describe('empty state', () => {
    it('should route no-data branches through the shared emptyState treatment', async () => {
      dataFetcher.getTrendsData.mockResolvedValue(null);

      const html = await renderer.renderTrendsSection(makeSection(), makeTestRun());

      expect(html).toContain('background:#f5f5f5');
      expect(html).toContain('No previous runs found');
      expect(html).not.toContain('#fff3e0'); // old orange box gone
      expect(html).not.toContain('#ff9800');
    });
  });
  describe('trend card grid', () => {
    it('gives the four trend-card columns a zero floor', async () => {
      // repeat(4, 1fr) floors each column at its content width, so one long value widened the
      // row past the page and the trailing card was clipped out of the PDF.
      dataFetcher.getTrendsData.mockResolvedValue(makeTrendsData());

      const html = await renderer.renderTrendsSection(makeSection(), makeTestRun());

      expect(html).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))');
      expect(html).not.toContain('grid-template-columns: repeat(4, 1fr)');
    });
  });
});
