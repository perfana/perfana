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

    expect(html).toContain('border-left:4px solid #1976d2');
    expect(html).toContain('Service Level Objectives');
    expect(html).toContain('1/1 passed');
  });

  it('should render check results table with PASS/FAIL badges', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([
      makeSloResult({ meets_requirement: true, metric_name: 'Latency p95' }),
      makeSloResult({ meets_requirement: false, metric_name: 'Error Rate' }),
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
    expect(html).toContain('section-comment');
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

  it('should escape HTML in metric names', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([
      makeSloResult({ metric_name: '<img src=x onerror=alert(1)>' }),
    ]);

    const html = await renderer.renderSloSection(makeSection(), makeTestRun());

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
