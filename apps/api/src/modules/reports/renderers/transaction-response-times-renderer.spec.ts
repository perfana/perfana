import { Test, TestingModule } from '@nestjs/testing';
import { TransactionResponseTimesRenderer } from './transaction-response-times-renderer';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, ScenarioData } from '../services/report-data-fetcher.service';
import { ReportSectionConfig, TestRun } from '@perfana/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSection = (
  overrides?: Partial<ReportSectionConfig>,
): ReportSectionConfig => ({
  type: 'transaction_response_times',
  order: 3,
  ...overrides,
});

const makeTestRun = (overrides?: Partial<TestRun>): TestRun =>
  ({
    id: 'uuid-1',
    testRunId: 'run-001',
    testEnvironment: 'staging',
    workload: 'load-test',
    systemUnderTestId: 'my-system',
    startTime: new Date('2025-06-01T10:00:00Z'),
    completed: true,
    ...overrides,
  }) as TestRun;

const makeScenarioData = (overrides?: Partial<ScenarioData>): ScenarioData => ({
  scenario: 'checkout',
  transactions: [
    { name: 'Login', avgMs: 120.5, p95Ms: 250, p99Ms: 400, pass: 12345, fail: 0, errPct: 0 },
    { name: 'Search', avgMs: 85.25, p95Ms: 150, p99Ms: 300, pass: 5000, fail: 76, errPct: 1.5 },
  ],
  timeSeries: [
    { transaction_name: 'Login', time_bucket: '2025-06-01T10:00:00Z', avg_response_time: '100.5' },
    { transaction_name: 'Login', time_bucket: '2025-06-01T10:01:00Z', avg_response_time: '110.2' },
    { transaction_name: 'Login', time_bucket: '2025-06-01T10:02:00Z', avg_response_time: '95.8' },
  ],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('TransactionResponseTimesRenderer', () => {
  let renderer: TransactionResponseTimesRenderer;
  let dataFetcher: jest.Mocked<ReportDataFetcherService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionResponseTimesRenderer,
        ReportUtilsService,
        {
          provide: ReportDataFetcherService,
          useValue: {
            getScenarioDataFromDatabase: jest.fn().mockResolvedValue(makeScenarioData()),
            getMockScenarioData: jest.fn().mockReturnValue(makeScenarioData()),
            getAggregatedSeries: jest.fn().mockResolvedValue([]),
            getAggregatedScalars: jest.fn().mockResolvedValue({ avg: null, p95: null, p99: null, pass: 0, fail: 0 }),
          },
        },
      ],
    }).compile();

    renderer = module.get(TransactionResponseTimesRenderer);
    dataFetcher = module.get(ReportDataFetcherService);
  });

  describe('section header', () => {
    it('should render with default title and shared header pattern', async () => {
      const html = await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun());

      expect(html).toContain('Transaction Response Times');
      expect(html).toContain('border-left:4px solid var(--primary-color, #1976d2)'); // rule 04 accent
      expect(html).not.toContain('📈'); // no emoji in header
      expect(html).not.toContain('linear-gradient'); // no gradient icon box / thead
    });

    it('should render the shared light thead with single-line P95/P99 headers', async () => {
      const html = await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun());

      expect(html).toContain('border-bottom:2px solid #e6e8ec'); // THEAD_ROW
      expect(html).toContain('>P95 (ms)</th>');
      expect(html).toContain('>P99 (ms)</th>');
      expect(html).not.toContain('95TH<br/>');
      expect(html).not.toContain('99TH<br/>');
      expect(html).not.toContain('background: #1976d2; color: white'); // dark thead gone
      expect(html).not.toContain('box-shadow');
      expect(html).not.toContain('#e0e0e0;">'); // row borders now REPORT_COLORS.rowBorder
    });

    it('should use custom title', async () => {
      const section = makeSection({ title: 'Checkout Timings' });
      const html = await renderer.renderTransactionResponseTimesSection(section, makeTestRun());

      expect(html).toContain('Checkout Timings');
    });

    it('should show scenario name as kicker', async () => {
      const html = await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun());

      expect(html).toContain('checkout');
    });
  });

  describe('section comment', () => {
    it('should render comment block when provided', async () => {
      const section = makeSection({ comment: 'Peak-hour scenario only' });
      const html = await renderer.renderTransactionResponseTimesSection(section, makeTestRun());

      expect(html).toContain('Peak-hour scenario only');
      expect(html).toContain('section-comment');
    });

    it('should omit comment block entirely when absent', async () => {
      const html = await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun());

      expect(html).not.toContain('section-comment');
    });
  });

  describe('transactions table', () => {
    it('should render normalized numbers with tabular-nums', async () => {
      const html = await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun());

      expect(html).toContain('Login');
      expect(html).toContain('120.5'); // avg, formatNum
      expect(html).toContain('85.25'); // avg, formatNum keeps 2 decimals
      expect(html).toContain('12,345'); // pass count grouped
      expect(html).toContain('1.5%'); // errPct via formatPercent
      expect(html).toContain('font-variant-numeric: tabular-nums');
    });
  });

  describe('chart rendering', () => {
    it('should render SVG chart from time series data', async () => {
      const html = await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun());

      expect(html).toContain('<svg');
      expect(html).toContain('Response Times Over Time');
    });

    it('should skip chart when includeChart is false', async () => {
      const section = makeSection({ config: { includeChart: false } });
      const html = await renderer.renderTransactionResponseTimesSection(section, makeTestRun());

      expect(html).not.toContain('<svg');
    });

    it('should show message when no time series data', async () => {
      dataFetcher.getScenarioDataFromDatabase.mockResolvedValue(makeScenarioData({ timeSeries: [] }));
      const html = await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun());

      expect(html).toContain('No time series data available');
    });
  });

  describe('data fetching', () => {
    it('should fetch scenario data from database for real test run', async () => {
      const section = makeSection({ config: { scenario: 'checkout' } });
      await renderer.renderTransactionResponseTimesSection(section, makeTestRun(), 'user-1', ['user']);

      expect(dataFetcher.getScenarioDataFromDatabase).toHaveBeenCalledWith(
        expect.anything(),
        'checkout',
        'user-1',
        ['user'],
      );
      expect(dataFetcher.getMockScenarioData).not.toHaveBeenCalled();
    });

    it('should fall back to mock data when testRun is null', async () => {
      await renderer.renderTransactionResponseTimesSection(makeSection(), null);

      expect(dataFetcher.getMockScenarioData).toHaveBeenCalledWith('all');
      expect(dataFetcher.getScenarioDataFromDatabase).not.toHaveBeenCalled();
    });

    it('should render fallback when scenario not found', async () => {
      dataFetcher.getScenarioDataFromDatabase.mockResolvedValue(null);
      const section = makeSection({ config: { scenario: 'missing-scenario' } });

      const html = await renderer.renderTransactionResponseTimesSection(section, makeTestRun());

      expect(html).toContain('not found');
      expect(html).toContain('missing-scenario');
      expect(html).toContain('response-times-section');
    });
  });

  describe('All aggregated', () => {
    it('prepends an All aggregated row + line when includeAggregated is set', async () => {
      dataFetcher.getScenarioDataFromDatabase.mockResolvedValue({
        scenario: 'all',
        transactions: [{ name: 'login', avgMs: 100, p95Ms: 200, p99Ms: 300, pass: 50, fail: 0, errPct: 0 }],
        timeSeries: [{ transaction_name: 'login', time_bucket: '2025-06-01T10:00:00Z', avg_response_time: '100' }],
      });
      (dataFetcher.getAggregatedSeries as jest.Mock).mockResolvedValue([
        { time: new Date('2025-06-01T10:00:00Z'), value: 150 },
      ]);
      (dataFetcher.getAggregatedScalars as jest.Mock).mockResolvedValue({
        avg: 150, p95: 250, p99: 300, pass: 980, fail: 20,
      });

      const html = await renderer.renderTransactionResponseTimesSection(
        makeSection({ config: { includeAggregated: true } }), makeTestRun(), 'u', ['user'],
      );

      expect(html).toContain('All aggregated');
    });

    it('does not fetch aggregated data when the flag is off', async () => {
      dataFetcher.getScenarioDataFromDatabase.mockResolvedValue({
        scenario: 'all', transactions: [], timeSeries: [],
      });
      await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun(), 'u', ['user']);
      expect(dataFetcher.getAggregatedScalars).not.toHaveBeenCalled();
    });
  });

  describe('HTML escaping', () => {
    it('should escape HTML in title', async () => {
      const section = makeSection({ title: '<script>xss</script>' });
      const html = await renderer.renderTransactionResponseTimesSection(section, makeTestRun());

      expect(html).not.toContain('<script>xss</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should escape HTML in transaction names', async () => {
      dataFetcher.getScenarioDataFromDatabase.mockResolvedValue(makeScenarioData({
        transactions: [
          { name: '<img onerror=alert(1)>', avgMs: 10, p95Ms: 20, p99Ms: 30, pass: 1, fail: 0, errPct: 0 },
        ],
        timeSeries: [],
      }));

      const html = await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun());

      expect(html).not.toContain('<img onerror');
      expect(html).toContain('&lt;img onerror');
    });

    it('should escape HTML in comment', async () => {
      const section = makeSection({ comment: '<b>bold</b>' });
      const html = await renderer.renderTransactionResponseTimesSection(section, makeTestRun());

      expect(html).not.toContain('<b>bold</b>');
      expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
    });
  });
});
