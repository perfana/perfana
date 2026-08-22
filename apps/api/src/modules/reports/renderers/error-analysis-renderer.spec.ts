import { Test, TestingModule } from '@nestjs/testing';
import { ErrorAnalysisRenderer } from './error-analysis-renderer';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, ReportErrorAnalysis } from '../services/report-data-fetcher.service';
import { ReportSectionConfig, TestRun } from '@perfana/shared';

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
});
