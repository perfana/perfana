import { Test, TestingModule } from '@nestjs/testing';
import { SloRenderer } from './slo-renderer';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService } from '../services/report-data-fetcher.service';
import { ReportSectionConfig, TestRun } from '@perfana/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSection = (
  overrides?: Partial<ReportSectionConfig>,
): ReportSectionConfig => ({ type: 'slo', order: 0, ...overrides });

const makeTestRun = (overrides?: Partial<TestRun>): TestRun =>
  ({
    id: 'uuid-1',
    testRunId: 'run-001',
    testEnvironment: 'staging',
    workload: 'load-test',
    systemUnderTestId: 'system-1',
    ...overrides,
  }) as TestRun;

const makeSloResult = (overrides?: Record<string, unknown>) => ({
  metric_name: 'Response Time p95',
  panel_title: 'API Latency',
  benchmark_id: 'bench-1',
  evaluate_type: 'metric',
  source: 'grafana',
  requirement_operator: 'lt',
  requirement_value: 500,
  metric_unit: 'ms',
  panel_average: 320,
  meets_requirement: true,
  ...overrides,
});

const makeApdexResult = (overrides?: Record<string, unknown>) => makeSloResult({
  panel_title: 'Workload Apdex',
  metric_name: null,
  evaluate_type: 'apdex',
  metric_unit: 'apdex_score',
  requirement_operator: null,
  requirement_value: null,
  requirement: { type: 'apdex', min_score: 0.85, threshold_ms: 500 },
  panel_average: 0.939,
  meets_requirement: false,
  message: '2 of 15 transactions below minimum Apdex 0.85: T04_Payment_Processing, T05_Order_Confirmation',
  targets: [
    { target: 'T01_Homepage_Load', value: 1, meets_requirement: true, scenario_name: 'Browse' },
    {
      target: 'T04_Payment_Processing', value: 0.62, meets_requirement: false, scenario_name: 'Checkout',
      avg_response_time_ms: 812.4, satisfied_count: 20, tolerating_count: 15, frustrated_count: 25, total_count: 60,
    },
  ],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SloRenderer', () => {
  let renderer: SloRenderer;
  let dataFetcher: jest.Mocked<ReportDataFetcherService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SloRenderer,
        ReportUtilsService,
        {
          provide: ReportDataFetcherService,
          useValue: {
            getSloCheckResults: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    renderer = module.get(SloRenderer);
    dataFetcher = module.get(ReportDataFetcherService);
  });

  it('should render preview fallback when testRun is null', async () => {
    const html = await renderer.renderSloSection(makeSection(), null);

    expect(html).toContain('slo-section');
    expect(html).toContain('No test run data available');
    expect(dataFetcher.getSloCheckResults).not.toHaveBeenCalled();
  });

  it('should render empty state when no check results', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([]);

    const html = await renderer.renderSloSection(makeSection(), makeTestRun());

    expect(html).toContain('No SLO check results available');
    expect(html).toContain('slo-section');
  });

  it('should render pass/fail counts', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([
      makeSloResult({ meets_requirement: true }),
      makeSloResult({ meets_requirement: true }),
      makeSloResult({ meets_requirement: false, panel_average: 600 }),
    ]);

    const html = await renderer.renderSloSection(makeSection(), makeTestRun());

    expect(html).toContain('2/3 passed');
    expect(html).toContain('1 failed');
    // Rule 04: no emoji / gradient icon boxes — pass/fail conveyed via chips
    expect(html).not.toContain('✓');
    expect(html).not.toContain('✗');
    expect(html).not.toContain('linear-gradient');
  });

  it('should render the shared section header with a left accent and kicker', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([makeSloResult()]);

    const html = await renderer.renderSloSection(makeSection(), makeTestRun());

    expect(html).toContain('border-left:4px solid var(--primary-color, #1976d2)');
    expect(html).toContain('Service Level Objectives');
    expect(html).toContain('1/1 passed');
  });

  it('should render summary counts as shared stat cards and empty states via emptyState', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([
      makeSloResult({ meets_requirement: true }),
      makeSloResult({ meets_requirement: false, panel_average: 600 }),
    ]);

    const html = await renderer.renderSloSection(makeSection(), makeTestRun());

    // statCard() markup
    expect(html).toContain('background:#f8f9fa; border:1px solid #e9ecef');
    expect(html).toContain('Total Checks');
    expect(html).toContain('color: #e04944;">1</span>'); // failed > 0 → bad dot

    // Empty branch goes through the shared emptyState treatment
    dataFetcher.getSloCheckResults.mockResolvedValue([]);
    const emptyHtml = await renderer.renderSloSection(makeSection(), makeTestRun());
    expect(emptyHtml).toContain('background:#f5f5f5');
    expect(emptyHtml).toContain('No SLO check results available');
    expect(emptyHtml).not.toContain('placeholder-message');
  });

  it('should render check results table with PASS/FAIL badges', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([
      makeSloResult({ meets_requirement: true, panel_title: 'Latency p95' }),
      makeSloResult({ meets_requirement: false, panel_title: 'Error Rate' }),
    ]);

    const html = await renderer.renderSloSection(makeSection(), makeTestRun());

    expect(html).toContain('Latency p95');
    expect(html).toContain('Error Rate');
    expect(html).toContain('PASS');
    expect(html).toContain('FAIL');
  });

  it('should render custom title', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([makeSloResult()]);

    const html = await renderer.renderSloSection(
      makeSection({ title: 'Custom SLO Title' }),
      makeTestRun(),
    );

    expect(html).toContain('Custom SLO Title');
  });

  it('should render comment when provided', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([makeSloResult()]);

    const html = await renderer.renderSloSection(
      makeSection({ comment: 'Review with PM' }),
      makeTestRun(),
    );

    expect(html).toContain('Review with PM');
    expect(html).toContain('section-text');
  });

  it('should filter by evaluate_type when filterType is set', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([
      makeSloResult({ evaluate_type: 'metric', metric_name: 'Latency' }),
      makeSloResult({ evaluate_type: 'apdex', metric_name: 'Apdex Score' }),
    ]);

    const html = await renderer.renderSloSection(
      makeSection({ config: { filterType: 'metric' } }),
      makeTestRun(),
    );

    expect(html).toContain('Latency');
    expect(html).not.toContain('Apdex Score');
  });

  it('should format requirement operators correctly', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([
      makeSloResult({ requirement_operator: 'lte', requirement_value: 1000, metric_unit: 'ms' }),
    ]);

    const html = await renderer.renderSloSection(makeSection(), makeTestRun());

    expect(html).toContain('≤');
    expect(html).toContain('1000 ms');
  });

  it('should render human-readable units instead of raw Grafana unit codes', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([
      makeSloResult({
        metric_name: 'Success rate',
        requirement_operator: 'gt',
        requirement_value: 0.9,
        metric_unit: 'percentunit',
        panel_average: 0.85,
      }),
      makeSloResult({
        metric_name: 'Throughput',
        requirement_operator: 'lt',
        requirement_value: 70,
        metric_unit: 'short',
        panel_average: 63.5,
      }),
    ]);

    const html = await renderer.renderSloSection(makeSection(), makeTestRun());

    // percentunit: stored 0.0-1.0, displayed as 0-100%
    expect(html).toContain('&gt; 90%');
    expect(html).toContain('85%');
    // short: unitless number, no ".00" padding
    expect(html).toContain('&lt; 70');
    expect(html).toContain('63.5');
    // the pre-fix artifacts never reach the report
    expect(html).not.toContain('percentunit');
    expect(html).not.toContain('70.00 short');
    expect(html).not.toContain('63.50 short');
  });

  it('should escape HTML in check names', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([
      makeSloResult({ panel_title: '<img src=x onerror=alert(1)>' }),
    ]);

    const html = await renderer.renderSloSection(makeSection(), makeTestRun());

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
  it('shows the dashboard a check came from', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([
      makeSloResult({ dashboard_label: 'JVM memory management G1GC afterburner-be' }),
    ]);

    const html = await renderer.renderSloSection(makeSection(), makeTestRun());

    expect(html).toContain('>Dashboard</th>');
    expect(html).toContain('JVM memory management G1GC afterburner-be');
  });

  it('names the transactions that failed an apdex check', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([makeApdexResult()]);

    const html = await renderer.renderSloSection(makeSection(), makeTestRun());

    expect(html).toContain('T04_Payment_Processing');
    expect(html).toContain('Checkout');
    expect(html).toContain('0.62');
    expect(html).toContain('812 ms');
    expect(html).toContain('2 of 15 transactions below minimum Apdex 0.85');
    // Passing transactions are not the finding
    expect(html).not.toContain('T01_Homepage_Load');
  });

  it('states an apdex requirement as a minimum score at a threshold, not "No requirement"', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([makeApdexResult()]);

    const html = await renderer.renderSloSection(makeSection(), makeTestRun());

    expect(html).toContain('≥ 0.85 Apdex at 500 ms');
    expect(html).not.toContain('No requirement');
    // The raw unit code is not printable
    expect(html).not.toContain('apdex_score');
    expect(html).toContain('0.94');
  });

  it('names the statistic an aggregated check evaluates', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([
      makeSloResult({
        evaluate_type: 'aggregated',
        panel_title: 'P95 Transaction Response Times',
        requirement_operator: '<=',
        requirement_value: 2000,
        requirement: { type: 'aggregated', aggregate_stat: 'p95', aggregate_metric: 'transaction_response_time', operator: '<=', value: 2000 },
        panel_average: 702.4,
      }),
    ]);

    const html = await renderer.renderSloSection(makeSection(), makeTestRun());

    expect(html).toContain('P95 ≤ 2000 ms');
  });

  it('does not list targets for a check that passed', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([
      makeApdexResult({ meets_requirement: true }),
    ]);

    const html = await renderer.renderSloSection(makeSection(), makeTestRun());

    expect(html).not.toContain('T04_Payment_Processing');
  });

  it('caps the table at config.maxItems', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([
      makeSloResult({ panel_title: 'C1' }),
      makeSloResult({ panel_title: 'C2' }),
      makeSloResult({ panel_title: 'C3' }),
    ]);

    const html = await renderer.renderSloSection(
      makeSection({ config: { maxItems: 2 } }),
      makeTestRun(),
    );

    expect(html).toContain('C1');
    expect(html).toContain('C2');
    expect(html).not.toContain('C3');
  });

  it('gives the summary-card grid columns a zero floor', async () => {
    // Same blowout as the Apdex cards: repeat(3, 1fr) floors each column at its content width,
    // so one long count pushed the row wider than the page.
    dataFetcher.getSloCheckResults.mockResolvedValue([makeSloResult()]);

    const html = await renderer.renderSloSection(makeSection(), makeTestRun());

    expect(html).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    expect(html).not.toContain('grid-template-columns: repeat(3, 1fr)');
  });
});
