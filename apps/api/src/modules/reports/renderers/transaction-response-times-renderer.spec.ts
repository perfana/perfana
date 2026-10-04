import { Test, TestingModule } from '@nestjs/testing';
import { TransactionResponseTimesRenderer } from './transaction-response-times-renderer';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, ScenarioData } from '../services/report-data-fetcher.service';
import { ReportSectionConfig, TestRun } from '@perfana/shared';
import { CHART_INK, CHART_SIZE, HOVER_SERIES_SLOTS, chartColor } from './chart-tokens';

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
  /**
   * The response-times chart under the Analyst standard.
   *
   * The legend is the app's series table, and its stats have one rule that is specific to
   * this chart: a bucket a transaction did not run in is written as a 0 into `dataPoints`
   * so the line has a coordinate there, and reporting that as the transaction's MINIMUM
   * would make every intermittent transaction read "min 0 ms".
   */
  describe('chart — hover', () => {
    it('pairs each legend row with its line through data-series', async () => {
      const html = await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun());

      // Both halves count: without the wrapper class the rule has nothing to scope to,
      // and without the groups there is nothing for a hovered row to dim.
      expect(html).toContain('class="chart-hover"');
      // Every index, not just 0: here the two sides come from independent index spaces —
      // `dataPoints` pushed per transaction, the table's rows mapped over the same list —
      // and nothing but this asserts they stay aligned.
      const groups = [...html.matchAll(/<g data-series="(\d+)">/g)].map((m) => m[1]);
      const rows = [...html.matchAll(/<tr style="[^"]*" data-series="(\d+)">/g)].map((m) => m[1]);
      expect(groups.length).toBeGreaterThan(1);
      expect(rows).toEqual(groups);
      // Each group closes itself, so an early return can never leave an unbalanced <g>.
      expect((html.match(/<g data-series=/g) ?? []).length)
        .toBe((html.match(/<\/g>/g) ?? []).length);
    });

    it('closes each transaction\'s group with its markers inside it', async () => {
      // This chart pushes its `<g>` open and closed as two separate strings around a loop,
      // so the balance is not something the shape of the code guarantees. An unclosed group
      // nests the next transaction inside this one and the dim rule then hides both at
      // once; markers left OUTSIDE the group stay bright while their line dims.
      const html = await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun());
      const svg = html.slice(html.indexOf('<svg'), html.indexOf('</svg>'));

      // One group per transaction in the table — the one with no buckets included, since its
      // row exists and `data-series` is matched by index.
      expect(svg.match(/<g data-series="\d+">/g) ?? []).toEqual([
        '<g data-series="0">', '<g data-series="1">',
      ]);
      expect((svg.match(/<\/g>/g) ?? []).length).toBe(2);
      // Each group holds its own path and a marker per bucket: three in the fixture.
      const first = svg.slice(svg.indexOf('<g data-series="0">'), svg.indexOf('</g>'));
      expect((first.match(/<path /g) ?? []).length).toBe(1);
      expect((first.match(/<circle /g) ?? []).length).toBe(3);
    });
  });

  describe('the transactions table IS the legend', () => {
    /** The swatch `chartSeriesTable` used to draw, now in the transaction's own row. */
    const swatches = (html: string) =>
      [...html.matchAll(/<span style="display:inline-block; width:14px; height:2px; background:(#[0-9a-f]{3,6});/g)]
        .map((m) => m[1]!);

    it('keys each row with its line colour and draws no second series table', async () => {
      const html = await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun());

      // Two swatches per transaction: one in the unfilterable key under the chart, one in
      // the table row. Both in the transaction's own colour, both in `dataPoints` order.
      expect(swatches(html)).toEqual([
        chartColor(0), chartColor(1), // the key under the chart
        chartColor(0), chartColor(1), // the table rows
      ]);
      // The swatch sits beside the name, not instead of it.
      expect(html).toMatch(/vertical-align:middle;"><\/span> Login</);
      // The separate min/mean/max legend is gone: one table cannot disagree with itself.
      expect(html).not.toContain('role="columnheader"');
      expect(html).not.toContain('>Mean<');
    });

    it('names every line in a key the row filter cannot reach', async () => {
      // `report-interactivity.ts` enhances every `.table-scroll table`, and its filter hides
      // rows with display:none while the chart keeps drawing their lines. This key is plain
      // markup outside that table, so a filtered-out transaction still has a name on the page.
      const html = await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun());
      const key = html.slice(html.indexOf('</svg>'), html.indexOf('<table'));

      expect(key).toContain('Login');
      expect(key).toContain('Search');
      // Names only — a second set of NUMBERS is what this section had before, and the two
      // disagreed. Nothing here can disagree with the table.
      expect(key).not.toContain('120.5');
      expect(key).not.toContain('Mean');
    });

    it('drops the swatches and the pairing when the section is configured without a chart', async () => {
      // A colour key with no chart to key is noise, and a `data-series` row with no <g> to
      // pair with would dim nothing while still being a hover target.
      const html = await renderer.renderTransactionResponseTimesSection(
        makeSection({ config: { includeChart: false } }),
        makeTestRun(),
      );

      expect(html).not.toContain('<svg');
      expect(swatches(html)).toEqual([]);
      expect(html).not.toContain('data-series');
    });

    it('heads the chart left-aligned and names the unit above the axis', async () => {
      const html = await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun());

      // The report's ONE heading treatment — `groupHeader`, the same <h3> with the accent
      // rule the other two charts use. A private 13px div here left this chart out of the
      // document outline and two sizes apart from its siblings.
      expect(html).toMatch(/<h3[^>]*border-left:4px solid[^>]*>Response Times Over Time/);
      expect(html).not.toContain('text-align: center; font-weight: 600;');
      // The unit is named once above the axis; the rotated titles are gone, ticks and all.
      expect(html).toMatch(/font-weight="600"[^>]*>ms</);
      expect(html).not.toContain('Response Time (ms)');
      expect(html).not.toContain('rotate(-90');
      // Fill, not frame, and the standard's hairline.
      expect(html).toContain(`fill="${CHART_INK.plotBg}"`);
      expect(html).not.toContain('stroke="#999"');
      // `markedLine`, not `line`: this chart marks every point, and the standard pairs the
      // two — a 2.5px dot on a 1.25px stroke reads as a bead chain, not a line.
      expect(html).toContain(`stroke-width="${CHART_SIZE.markedLine}"`);
    });

    it('stops tagging rows past the last hover slot, instead of dimming with no way back', async () => {
      // Mirrors chart-svg.service.spec.ts's ceiling test for the chart's own `<g>` groups:
      // a row past HOVER_SERIES_SLOTS must carry no `data-series` attribute at all, or
      // hovering it would dim the chart and highlight nothing — the inverse of the feature.
      // A JMeter scenario with 300 transactions is one row each, so this is reachable.
      const many = Array.from({ length: HOVER_SERIES_SLOTS + 6 }, (_, i) => ({
        name: `T${i}`, avgMs: 10, p95Ms: 20, p99Ms: 30, pass: 1, fail: 0, errPct: 0,
      }));
      // Each one needs a bucket: with no time series the chart is not DRAWN, and then the
      // rows carry no swatch and no pairing at all (the case below).
      dataFetcher.getScenarioDataFromDatabase.mockResolvedValue(makeScenarioData({
        transactions: many,
        timeSeries: many.map((t) => ({
          transaction_name: t.name, time_bucket: '2025-06-01T10:00:00Z', avg_response_time: '10',
        })),
      }));

      const html = await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun());
      const rows = [...html.matchAll(/<tr style="[^"]*" data-series="(\d+)">/g)].map((m) => Number(m[1]));

      expect(rows).toHaveLength(HOVER_SERIES_SLOTS);
      expect(Math.max(...rows)).toBe(HOVER_SERIES_SLOTS - 1);
      expect(html).not.toContain(`data-series="${HOVER_SERIES_SLOTS}"`);
    });

    it('drops the swatches and the hover scope when the chart asked for was not drawn', async () => {
      // `includeChart` is the request, not the outcome: with no time buckets the chart is a
      // "no time series data" card with no <svg>, so a colour key keys nothing and
      // `.chart-hover` would scope a hover that can never fire.
      dataFetcher.getScenarioDataFromDatabase.mockResolvedValue(makeScenarioData({ timeSeries: [] }));

      const html = await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun());

      expect(html).toContain('No time series data available');
      expect(swatches(html)).toEqual([]);
      expect(html).not.toContain('data-series');
      expect(html).not.toContain('chart-hover');
    });

    it('puts the no-time-series message in the standard\'s card', async () => {
      dataFetcher.getScenarioDataFromDatabase.mockResolvedValue(makeScenarioData({ timeSeries: [] }));

      const html = await renderer.renderTransactionResponseTimesSection(makeSection(), makeTestRun());

      expect(html).toContain('No time series data available');
      // The chart card, not the old grey `#f5f5f5` outer box.
      expect(html).toContain(`border-radius:${CHART_SIZE.radius}px`);
      expect(html).not.toContain('background: #f5f5f5');
      // No empty legend above it: an all-dash series table would be worse than none.
      expect(html).not.toContain('role="columnheader"');
    });
  });

});
