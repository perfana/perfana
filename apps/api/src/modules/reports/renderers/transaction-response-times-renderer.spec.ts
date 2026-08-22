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
            listScenarioNames: jest.fn().mockResolvedValue(['checkout']),
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

  describe('section text', () => {
    it('should render the accompanying text when provided', async () => {
      const section = makeSection({ comment: 'Peak-hour scenario only' });
      const html = await renderer.renderTransactionResponseTimesSection(section, makeTestRun());

      expect(html).toContain('Peak-hour scenario only');
      expect(html).toContain('section-text');
    });

    it('should omit the section-text block entirely when absent', async () => {
      const html = await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun());

      expect(html).not.toContain('section-text');
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
        false,
      );
      expect(dataFetcher.getMockScenarioData).not.toHaveBeenCalled();
      // A named scenario is the selection; the run's scenario list is not needed
      expect(dataFetcher.listScenarioNames).not.toHaveBeenCalled();
    });

    it('fetches one block per selected scenario', async () => {
      dataFetcher.getScenarioDataFromDatabase
        .mockResolvedValueOnce(makeScenarioData({ scenario: 'checkout' }))
        .mockResolvedValueOnce(makeScenarioData({ scenario: 'browse' }));
      const section = makeSection({ config: { scenarios: ['checkout', 'browse'] } });

      const html = await renderer.renderTransactionResponseTimesSection(section, makeTestRun());

      expect(dataFetcher.getScenarioDataFromDatabase).toHaveBeenCalledTimes(2);
      // Each scenario heads its own block once there is more than one
      expect(html).toContain('>checkout</h3>');
      expect(html).toContain('>browse</h3>');
      expect(html).toContain('checkout, browse'); // both named in the header kicker
    });

    it('falls back to every scenario in the run when none is selected', async () => {
      dataFetcher.listScenarioNames.mockResolvedValue(['checkout', 'browse']);

      await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun());

      expect(dataFetcher.listScenarioNames).toHaveBeenCalled();
      expect(dataFetcher.getScenarioDataFromDatabase).toHaveBeenCalledTimes(2);
    });

    it('treats a legacy scenario:"all" the same as no selection', async () => {
      dataFetcher.listScenarioNames.mockResolvedValue(['checkout']);
      const section = makeSection({ config: { scenario: 'all' } });

      await renderer.renderTransactionResponseTimesSection(section, makeTestRun());

      // Never queried for a scenario literally named "all", which matches no row
      expect(dataFetcher.listScenarioNames).toHaveBeenCalled();
      expect(dataFetcher.getScenarioDataFromDatabase).toHaveBeenCalledWith(
        expect.anything(), 'checkout', '', [], false,
      );
    });

    it('asks for child requests only when the toggle is on', async () => {
      const section = makeSection({ config: { scenario: 'checkout', includeChildRequests: true } });

      await renderer.renderTransactionResponseTimesSection(section, makeTestRun());

      expect(dataFetcher.getScenarioDataFromDatabase).toHaveBeenCalledWith(
        expect.anything(), 'checkout', '', [], true,
      );
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

  describe('child requests', () => {
    it('renders a request table attached to its transaction', async () => {
      dataFetcher.getScenarioDataFromDatabase.mockResolvedValue(makeScenarioData({
        transactions: [
          {
            name: 'Login', avgMs: 120, p95Ms: 250, p99Ms: 400, pass: 100, fail: 0, errPct: 0,
            children: [
              { name: 'POST /auth', avgMs: 80, p95Ms: 160, p99Ms: 240, pass: 100, fail: 0, errPct: 0 },
              { name: 'GET /profile', avgMs: 40, p95Ms: 90, p99Ms: 160, pass: 99, fail: 1, errPct: 1 },
            ],
          },
        ],
      }));

      const html = await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun());

      expect(html).toContain('POST /auth');
      expect(html).toContain('GET /profile');
      expect(html).toContain('2 requests');
      // A single-cell colspan row is what keeps the requests attached to their
      // transaction when the report's table script sorts or filters.
      expect(html).toContain('colspan="7"');
      expect(html).toContain('>Request</th>');
    });

    it('bands requests under the controllers they ran in', async () => {
      const PARALLEL = 'org.apache.jmeter.control.ParallelController';
      const LOOP = 'org.apache.jmeter.control.LoopController';
      dataFetcher.getScenarioDataFromDatabase.mockResolvedValue(makeScenarioData({
        transactions: [
          {
            name: 'Login', avgMs: 120, p95Ms: 250, p99Ms: 400, pass: 100, fail: 0, errPct: 0,
            children: [
              {
                name: 'GET /assets', avgMs: 10, p95Ms: 20, p99Ms: 30, pass: 100, fail: 0, errPct: 0,
                firstSeen: 1,
                parentControllers: [
                  { name: 'Thread Group', class: 'org.apache.jmeter.threads.ThreadGroup' },
                  { name: 'Assets', class: PARALLEL },
                ],
              },
              {
                name: 'GET /icons', avgMs: 12, p95Ms: 22, p99Ms: 33, pass: 100, fail: 0, errPct: 0,
                firstSeen: 2,
                parentControllers: [
                  { name: 'Thread Group', class: 'org.apache.jmeter.threads.ThreadGroup' },
                  { name: 'Assets', class: PARALLEL },
                ],
              },
              {
                name: 'POST /auth', avgMs: 80, p95Ms: 160, p99Ms: 240, pass: 300, fail: 0, errPct: 0,
                firstSeen: 3,
                parentControllers: [{ name: 'Retry', class: LOOP }],
              },
            ],
          },
        ],
      }));

      const html = await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun());

      // The band the two concurrent requests share, labelled by what it does
      expect(html).toContain('Assets');
      expect(html).toContain('parallel');
      // A loop band survives around a single request — "this repeats" is still true
      expect(html).toContain('Retry');
      expect(html).toContain('loop');
      // The Thread Group is the same for every row in the run and carries nothing here
      expect(html).not.toContain('Thread Group');
    });

    it('drops a parallel band that would wrap a single request', async () => {
      dataFetcher.getScenarioDataFromDatabase.mockResolvedValue(makeScenarioData({
        transactions: [
          {
            name: 'Login', avgMs: 120, p95Ms: 250, p99Ms: 400, pass: 100, fail: 0, errPct: 0,
            children: [
              {
                name: 'GET /solo', avgMs: 10, p95Ms: 20, p99Ms: 30, pass: 100, fail: 0, errPct: 0,
                firstSeen: 1,
                parentControllers: [{ name: 'Lonely', class: 'org.apache.jmeter.control.ParallelController' }],
              },
            ],
          },
        ],
      }));

      const html = await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun());

      expect(html).toContain('GET /solo');
      expect(html).not.toContain('Lonely');
    });

    it('renders a flat request table when the run records no controllers', async () => {
      dataFetcher.getScenarioDataFromDatabase.mockResolvedValue(makeScenarioData({
        transactions: [
          {
            name: 'Login', avgMs: 120, p95Ms: 250, p99Ms: 400, pass: 100, fail: 0, errPct: 0,
            children: [
              { name: 'POST /auth', avgMs: 80, p95Ms: 160, p99Ms: 240, pass: 100, fail: 0, errPct: 0 },
              { name: 'GET /profile', avgMs: 40, p95Ms: 90, p99Ms: 160, pass: 99, fail: 1, errPct: 1 },
            ],
          },
        ],
      }));

      const html = await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun());

      expect(html).toContain('POST /auth');
      expect(html).toContain('GET /profile');
      // One colspan row only: the detail row itself, no bands inside it
      expect((html.match(/colspan="7"/g) ?? []).length).toBe(1);
    });

    it('renders no detail row when a transaction has no children', async () => {
      const html = await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun());

      expect(html).not.toContain('colspan="7"');
      expect(html).not.toContain('requests</div>');
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
      expect(dataFetcher.getAggregatedSeries).not.toHaveBeenCalled();
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
