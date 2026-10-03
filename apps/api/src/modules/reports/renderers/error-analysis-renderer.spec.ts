import { Test, TestingModule } from '@nestjs/testing';
import { ErrorAnalysisRenderer } from './error-analysis-renderer';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, ReportErrorAnalysis } from '../services/report-data-fetcher.service';
import { ReportSectionConfig, TestRun } from '@perfana/shared';
import { REPORT_COLORS } from './report-style';
import { CHART_INK, CHART_SIZE, chartColor } from './chart-tokens';

const makeSection = (overrides?: Partial<ReportSectionConfig>): ReportSectionConfig => ({
  type: 'error_analysis',
  order: 4,
  ...overrides,
});

const makeTestRun = (): TestRun =>
  ({ id: 'uuid-1', testRunId: 'run-001', startTime: new Date('2026-08-20T10:00:00Z') }) as TestRun;

const makeData = (overrides?: Partial<ReportErrorAnalysis>): ReportErrorAnalysis => ({
  totalErrors: 383,
  errorRate: 2.1,
  totalRequests: 18238,
  uniqueResponseCodes: 3,
  transactionsWithErrors: 2,
  byCode: [
    { responseCode: '500', errorCount: 291, share: 76, avgResponseTime: 1204, minResponseTime: 890, maxResponseTime: 4102 },
    { responseCode: '404', errorCount: 64, share: 16.7, avgResponseTime: 95, minResponseTime: 80, maxResponseTime: 120 },
    { responseCode: 'Assertion failed', errorCount: 28, share: 7.3, avgResponseTime: 210, minResponseTime: 180, maxResponseTime: 402 },
  ],
  byTransaction: [
    { transactionName: 'T03_Checkout', samplerName: 'pay_api', url: '/api/pay', responseCode: '500', errorCount: 201, share: 52.5, avgResponseTime: 1310 },
    { transactionName: 'T01_Homepage', samplerName: 'assets', url: null, responseCode: '404', errorCount: 64, share: 16.7, avgResponseTime: 95 },
  ],
  overTime: [
    { time: new Date('2026-08-20T10:00:00Z'), countsByCode: { '500': 4, '404': 1 } },
    { time: new Date('2026-08-20T10:01:00Z'), countsByCode: { '500': 12 } },
    { time: new Date('2026-08-20T10:02:00Z'), countsByCode: { '500': 2, '404': 3 } },
  ],
  ...overrides,
});

describe('ErrorAnalysisRenderer', () => {
  let renderer: ErrorAnalysisRenderer;
  let dataFetcher: jest.Mocked<ReportDataFetcherService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ErrorAnalysisRenderer,
        ReportUtilsService,
        {
          provide: ReportDataFetcherService,
          useValue: { getErrorAnalysis: jest.fn().mockResolvedValue(makeData()) },
        },
      ],
    }).compile();

    renderer = module.get(ErrorAnalysisRenderer);
    dataFetcher = module.get(ReportDataFetcherService);
  });

  describe('summary', () => {
    it('renders the four headline numbers', async () => {
      const html = await renderer.renderErrorAnalysisSection(makeSection(), makeTestRun());

      expect(html).toContain('Total errors');
      expect(html).toContain('383');
      expect(html).toContain('Error rate');
      expect(html).toContain('2.1%');
      expect(html).toContain('of 18,238 requests');
      expect(html).toContain('Transactions affected');
    });

    it('says so plainly when the run had no errors', async () => {
      dataFetcher.getErrorAnalysis.mockResolvedValue(
        makeData({ totalErrors: 0, byCode: [], byTransaction: [], overTime: [] }),
      );

      const html = await renderer.renderErrorAnalysisSection(makeSection(), makeTestRun());

      expect(html).toContain('No errors were recorded');
      expect(html).toContain('No errors'); // the good chip
      // Four zeroes and three empty tables would be worse than one sentence
      expect(html).not.toContain('By response code');
    });
  });

  describe('by response code', () => {
    it('colours a code by its HTTP class', async () => {
      const html = await renderer.renderErrorAnalysisSection(makeSection(), makeTestRun());

      // 5xx is the server's problem (bad), 4xx usually the test's (warn)
      expect(html).toMatch(/#fbe6e4[^>]*>500|500[^<]*<\/span>/);
      expect(html).toContain('500');
      expect(html).toContain('404');
      // A non-numeric code is neutral rather than forced into a class
      expect(html).toContain('Assertion failed');
    });

    it('shows each code\'s share of all errors', async () => {
      const html = await renderer.renderErrorAnalysisSection(makeSection(), makeTestRun());

      expect(html).toContain('76.0%');
    });
  });

  describe('by transaction', () => {
    it('lists the failing requests with their URL', async () => {
      const html = await renderer.renderErrorAnalysisSection(makeSection(), makeTestRun());

      expect(html).toContain('T03_Checkout');
      expect(html).toContain('pay_api');
      expect(html).toContain('/api/pay');
    });

    it('caps the table and says how many were dropped', async () => {
      dataFetcher.getErrorAnalysis.mockResolvedValue(makeData({
        byTransaction: Array.from({ length: 30 }, (_, i) => ({
          transactionName: `T${i}`, samplerName: 's', url: null, responseCode: '500',
          errorCount: 30 - i, share: 1, avgResponseTime: 100,
        })),
      }));

      const html = await renderer.renderErrorAnalysisSection(
        makeSection({ config: { topN: 5 } }), makeTestRun(),
      );

      expect(html).toContain('and 25 more failing requests');
      expect(html).toContain('T0');
      expect(html).not.toContain('>T29<');
    });
  });

  describe('errors over time', () => {
    it('draws one line per response code', async () => {
      const html = await renderer.renderErrorAnalysisSection(makeSection(), makeTestRun());

      expect(html).toContain('Errors over time');
      expect((html.match(/<path d=/g) ?? []).length).toBe(2); // 500 and 404
    });

    it('can be turned off', async () => {
      const html = await renderer.renderErrorAnalysisSection(
        makeSection({ config: { includeChart: false } }), makeTestRun(),
      );

      expect(html).not.toContain('Errors over time');
      expect(html).toContain('By response code');
    });

    it('omits the chart when there is only one bucket to draw', async () => {
      dataFetcher.getErrorAnalysis.mockResolvedValue(makeData({
        overTime: [{ time: new Date('2026-08-20T10:00:00Z'), countsByCode: { '500': 4 } }],
      }));

      const html = await renderer.renderErrorAnalysisSection(makeSection(), makeTestRun());

      expect(html).not.toContain('Errors over time');
    });
  });

  describe('configuration', () => {
    it('passes the selected scenarios and analysis window to the fetcher', async () => {
      await renderer.renderErrorAnalysisSection(
        makeSection({ config: { scenarios: ['Checkout'], excludeRampUp: false } }),
        makeTestRun(), 'user-1', ['user'],
      );

      expect(dataFetcher.getErrorAnalysis).toHaveBeenCalledWith(
        expect.anything(), ['Checkout'], false, 'user-1', ['user'],
      );
    });

    it('defaults to all scenarios inside the analysis window', async () => {
      await renderer.renderErrorAnalysisSection(makeSection(), makeTestRun());

      expect(dataFetcher.getErrorAnalysis).toHaveBeenCalledWith(
        expect.anything(), [], true, '', [],
      );
    });

    it('renders a fallback when there is no test run', async () => {
      const html = await renderer.renderErrorAnalysisSection(makeSection(), null);

      expect(html).toContain('No test run data available');
      expect(dataFetcher.getErrorAnalysis).not.toHaveBeenCalled();
    });
  });

  describe('privacy', () => {
    it('never carries response bodies or headers', async () => {
      // The section is aggregates-only by design: a generated report is
      // downloadable and shareable over an unauthenticated link.
      const html = await renderer.renderErrorAnalysisSection(makeSection(), makeTestRun());

      expect(html).not.toContain('response_data');
      expect(html).not.toContain('request_headers');
      expect(html).not.toContain('response_headers');
      expect(html).not.toContain('Set-Cookie');
    });
  });

  describe('errors over time — hover', () => {
    it('pairs each legend row with its line through data-series', async () => {
      const html = await renderer.renderErrorAnalysisSection(makeSection(), makeTestRun());

      // Both halves count: without the wrapper class the rule has nothing to scope to,
      // and without the groups there is nothing for a hovered row to dim.
      expect(html).toContain('class="chart-hover"');
      // Every index, not just 0 — index 0 matches under any ordering, so a drift at N>0
      // would pass. The sequences have to be identical, in order.
      const groups = [...html.matchAll(/<g data-series="(\d+)">/g)].map((m) => m[1]);
      const rows = [...html.matchAll(/role="row" data-series="(\d+)"/g)].map((m) => m[1]);
      expect(groups.length).toBeGreaterThan(1);
      expect(rows).toEqual(groups);
    });

    it('indexes each group like its legend row, which is all the pairing is', async () => {
      // `data-series` is an INDEX, matched by equality — nothing else ties a row to a line.
      // So the Nth group and the Nth row have to be the same response code, and the only
      // evidence of that in the markup is their colour: the chart draws 5xx red and 4xx
      // amber (`codeColor`), and a legend ordered differently from `lines` would pair the
      // reader's hover with the other code's line while looking perfectly correct.
      const html = await renderer.renderErrorAnalysisSection(makeSection(), makeTestRun());

      // Two codes have over-time rows (500 and 404); the third has none and is not a line.
      const groups = [...html.matchAll(/<g data-series="(\d+)"><path [^>]*stroke="([^"]+)"/g)]
        .map((m) => ({ index: m[1]!, color: m[2]! }));
      const swatches = [...html.matchAll(/role="row" data-series="(\d+)"[\s\S]*?background:([^;]+);/g)]
        .map((m) => ({ index: m[1]!, color: m[2]! }));

      expect(groups.map((g) => g.index)).toEqual(['0', '1']);
      expect(swatches.map((s) => s.index)).toEqual(['0', '1']);
      expect(groups.map((g) => g.color)).toEqual(swatches.map((s) => s.color));
      // And the two are genuinely different colours, or the assertion above proves nothing.
      expect(groups[0]!.color).not.toBe(groups[1]!.color);
    });
  });

  /**
   * The errors-over-time chart's legend, which is now the app's series table.
   *
   * The chart has no cursor readout (only the shared `chart-svg.service.ts` charts do), so
   * these three numbers per code are the only way a reader gets a value off it. The reading
   * they have to agree with is the LINE's: a bucket with no row for a code had no errors of
   * that code, which is a zero and not a gap — so a code that was quiet for a minute must report a min of 0, not a min of its
   * smallest non-zero minute.
   */
  describe('errors over time — the series table', () => {
    /**
     * The legend FOLLOWS the chart card, so everything after the SVG is it. Throws rather
     * than slicing from -1, which would return the document's last character and make every
     * matcher below report `[]` for the wrong reason.
     */
    const legendOf = (html: string) => {
      const at = html.indexOf('</svg>');
      if (at < 0) throw new Error('no chart in output — legendOf has nothing to slice');
      return html.slice(at);
    };
    const legendStats = (html: string) =>
      [...legendOf(html).matchAll(/role="cell" style="[^"]*text-align:right;[^"]*">([^<]*)</g)]
        .map((m) => m[1]!);
    const legendNames = (html: string) =>
      [...legendOf(html).matchAll(/margin-left:8px;">([^<]*)</g)].map((m) => m[1]!);

    it('carries each code\'s per-bucket min, mean and max', async () => {
      const html = await renderer.renderErrorAnalysisSection(makeSection(), makeTestRun());

      // 500 is in every bucket: 4, 12, 2. 404 is missing from the middle one, which is a
      // zero — so its min is 0 and its mean is (1 + 0 + 3) / 3, not (1 + 3) / 2.
      expect(legendNames(html)).toEqual(['500', '404']);
      expect(legendStats(html)).toEqual(['2', '6', '12', '0', '1.33', '3']);
    });

    it('names the unit so a bare count is not read as a rate', async () => {
      const html = await renderer.renderErrorAnalysisSection(makeSection(), makeTestRun());

      // Once in each row's unit column — the axis caption is inside the SVG, above.
      expect((legendOf(html).match(/>errors</g) ?? []).length).toBe(2);
      expect(html).toMatch(/font-weight="600"[^>]*>errors</);
    });

    it('lists the codes worst-first, and gives a non-numeric code a palette slot', async () => {
      dataFetcher.getErrorAnalysis.mockResolvedValue(makeData({
        overTime: [
          { time: new Date('2026-08-20T10:00:00Z'), countsByCode: { '500': 10, 'Assertion failed': 1 } },
          { time: new Date('2026-08-20T10:01:00Z'), countsByCode: { '500': 20, 'Assertion failed': 3 } },
        ],
      }));

      const html = await renderer.renderErrorAnalysisSection(makeSection(), makeTestRun());

      // Ordered by total volume, so the busiest code reads first in the legend.
      expect(legendNames(html)).toEqual(['500', 'Assertion failed']);
      // A 5xx keeps its HTTP-class red; a code with no class takes the Analyst slot for its
      // position, which used to be a four-colour list of its own.
      expect(html).toContain(`stroke="${REPORT_COLORS.dot.bad}"`);
      expect(html).toContain(`stroke="${chartColor(1)}"`);
    });

    it('fills the plot area instead of framing it, and rotates no axis title', async () => {
      const html = await renderer.renderErrorAnalysisSection(makeSection(), makeTestRun());

      expect(html).toContain(`fill="${CHART_INK.plotBg}"`);
      expect(html).not.toContain('stroke="#999"');
      expect(html).not.toContain('rotate(-90');
      // The line is the standard's hairline, not the old 2px.
      expect(html).toContain(`stroke-width="${CHART_SIZE.line}"`);
    });
  });

});
