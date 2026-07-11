import { Test, TestingModule } from '@nestjs/testing';
import { ApdexRenderer } from './apdex-renderer';
import { ReportUtilsService } from '../services/report-utils.service';
import {
  ReportDataFetcherService,
  ApdexData,
  ApdexTransaction,
} from '../services/report-data-fetcher.service';
import { ReportSectionConfig, TestRun } from '@perfana/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSection = (
  overrides?: Partial<ReportSectionConfig>,
): ReportSectionConfig => ({ type: 'apdex', order: 0, ...overrides });

const makeTestRun = (overrides?: Partial<TestRun>): TestRun =>
  ({
    id: 'uuid-1',
    testRunId: 'run-001',
    testEnvironment: 'staging',
    workload: 'load-test',
    systemUnderTestId: 'system-1',
    ...overrides,
  }) as TestRun;

const makeTransaction = (
  overrides?: Partial<ApdexTransaction>,
): ApdexTransaction => ({
  name: 'GET /home',
  avgMs: 120.5,
  p95Ms: 340.2,
  p99Ms: 610.8,
  pass: 1000,
  fail: 0,
  errPct: 0,
  apdex: 0.97,
  threshold: 500,
  ...overrides,
});

const makeApdexData = (overrides?: Partial<ApdexData>): ApdexData => ({
  overall: {
    peakTxnsPerSec: 42.5,
    peakReqsPerSec: 120.3,
    peakActiveUsers: 50,
    avgActiveUsers: 35,
    errorRate: 0.5,
    failedCount: 12,
    avgMs: 150.25,
    p95Ms: 420.6,
    p99Ms: 780.1,
    apdex: 0.96,
    threshold: 500,
    thresholdVaries: false,
  },
  scenarios: {
    checkout: {
      scenario: 'checkout',
      summary: {
        peakTxnsPerSec: 10.2,
        peakReqsPerSec: 30.4,
        peakVu: 25,
        errors: 0,
        avgMs: 130.7,
        p95Ms: 350.1,
        p99Ms: 620.9,
        apdex: 0.88,
      },
      transactions: [makeTransaction()],
    },
  },
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ApdexRenderer', () => {
  let renderer: ApdexRenderer;
  let dataFetcher: jest.Mocked<ReportDataFetcherService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApdexRenderer,
        ReportUtilsService,
        {
          provide: ReportDataFetcherService,
          useValue: {
            getApdexDataFromDatabase: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    renderer = module.get(ApdexRenderer);
    dataFetcher = module.get(ReportDataFetcherService);
  });

  it('should render fallback when testRun is null', async () => {
    const html = await renderer.renderApdexSection(makeSection(), null);

    expect(html).toContain('apdex-section');
    expect(html).toContain('No test run data available');
    expect(dataFetcher.getApdexDataFromDatabase).not.toHaveBeenCalled();
  });

  it('should render empty state when no apdex data is available', async () => {
    dataFetcher.getApdexDataFromDatabase.mockResolvedValue(null);

    const html = await renderer.renderApdexSection(makeSection(), makeTestRun());

    expect(html).toContain('apdex-section');
    expect(html).toContain('No transaction data available for Apdex calculation');
  });

  it('should render section header via the shared pattern (accent + kicker, no emoji)', async () => {
    dataFetcher.getApdexDataFromDatabase.mockResolvedValue(makeApdexData());

    const html = await renderer.renderApdexSection(
      makeSection({ title: 'Apdex Overview' }),
      makeTestRun(),
    );

    expect(html).toContain('Apdex Overview');
    expect(html).toContain('border-left:4px solid var(--primary-color, #1976d2)');
    expect(html).toContain('Application Performance Index');
    // Rule 04: no emoji / gradient icon boxes
    expect(html).not.toContain('⭐');
    expect(html).not.toContain('linear-gradient');
    // Summary chip with the overall score in the header
    expect(html).toContain('Apdex 0.960');
  });

  it('should render rating pills for overall, scenario, and transaction scores', async () => {
    dataFetcher.getApdexDataFromDatabase.mockResolvedValue(
      makeApdexData({
        scenarios: {
          checkout: {
            scenario: 'checkout',
            summary: {
              peakTxnsPerSec: 10.2,
              peakReqsPerSec: 30.4,
              peakVu: 25,
              errors: 0,
              avgMs: 130.7,
              p95Ms: 350.1,
              p99Ms: 620.9,
              apdex: 0.75, // Fair
            },
            transactions: [
              makeTransaction({ apdex: 0.97 }), // Excellent
              makeTransaction({ name: 'POST /pay', apdex: 0.4 }), // Unacceptable
            ],
          },
        },
      }),
    );

    const html = await renderer.renderApdexSection(makeSection(), makeTestRun());

    // Rule 06: rating words rendered as pills (Title Case labels, CSS uppercases)
    expect(html).toContain('Excellent'); // overall 0.96 + txn 0.97
    expect(html).toContain('Fair'); // scenario 0.75
    expect(html).toContain('Unacceptable'); // txn 0.4
    expect(html).toContain('text-transform:uppercase');
    // Kind mapping: Fair → warn fill, Unacceptable → bad fill, Excellent → good fill
    expect(html).toContain('background:#fdf0dd');
    expect(html).toContain('background:#fbe6e4');
    expect(html).toContain('background:#e7f4ea');
  });

  it('should render comment via the shared comment block when provided', async () => {
    dataFetcher.getApdexDataFromDatabase.mockResolvedValue(makeApdexData());

    const html = await renderer.renderApdexSection(
      makeSection({ comment: 'Discuss with the team' }),
      makeTestRun(),
    );

    expect(html).toContain('section-comment');
    expect(html).toContain('Discuss with the team');
  });

  it('should omit the comment block when no comment is set', async () => {
    dataFetcher.getApdexDataFromDatabase.mockResolvedValue(makeApdexData());

    const html = await renderer.renderApdexSection(makeSection(), makeTestRun());

    expect(html).not.toContain('section-comment');
  });

  it('should escape HTML in scenario and transaction names', async () => {
    dataFetcher.getApdexDataFromDatabase.mockResolvedValue(
      makeApdexData({
        scenarios: {
          '<script>alert(1)</script>': {
            scenario: '<script>alert(1)</script>',
            summary: {
              peakTxnsPerSec: 1,
              peakReqsPerSec: 1,
              peakVu: 1,
              errors: 0,
              avgMs: 100,
              p95Ms: 200,
              p99Ms: 300,
              apdex: 0.9,
            },
            transactions: [
              makeTransaction({ name: '<img src=x onerror=alert(1)>' }),
            ],
          },
        },
      }),
    );

    const html = await renderer.renderApdexSection(makeSection(), makeTestRun());

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
  });

  it('should render a not-found notice for scenarios missing from the data', async () => {
    dataFetcher.getApdexDataFromDatabase.mockResolvedValue(makeApdexData());

    const html = await renderer.renderApdexSection(
      makeSection({ config: { scenarios: ['nonexistent'] } }),
      makeTestRun(),
    );

    // Rendered through emptyState(), which escapes the message (quotes → &quot;)
    expect(html).toContain('Scenario &quot;nonexistent&quot; not found');
    expect(html).toContain('background:#f5f5f5');
  });

  it('should color the overall Apdex score by its rating, not hardcoded green', async () => {
    // Fair overall score → warn dot color on the big number
    dataFetcher.getApdexDataFromDatabase.mockResolvedValue(
      makeApdexData({
        overall: { ...makeApdexData().overall, apdex: 0.75 },
      }),
    );

    const html = await renderer.renderApdexSection(makeSection(), makeTestRun());

    expect(html).toContain('color: #f59e0b;">0.750</span>');
    expect(html).not.toContain('color: #43a047;">0.750</span>');
  });

  it('should render summary metrics as shared stat cards', async () => {
    dataFetcher.getApdexDataFromDatabase.mockResolvedValue(makeApdexData());

    const html = await renderer.renderApdexSection(makeSection(), makeTestRun());

    // statCard() markup: card background/border + uppercase label treatment
    expect(html).toContain('background:#f8f9fa; border:1px solid #e9ecef');
    expect(html).toContain('Peak Transactions / Second');
    // Good overall score (0.96) → good dot color
    expect(html).toContain('color: #43a047;">0.960</span>');
  });

  it('should hide overall metrics when showOverallMetrics is false', async () => {
    dataFetcher.getApdexDataFromDatabase.mockResolvedValue(makeApdexData());

    const html = await renderer.renderApdexSection(
      makeSection({ config: { showOverallMetrics: false } }),
      makeTestRun(),
    );

    expect(html).not.toContain('Peak Transactions / Second');
    expect(html).toContain('Scenarios');
  });
});
