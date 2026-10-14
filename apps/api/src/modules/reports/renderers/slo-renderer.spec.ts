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
      threshold_ms: 800,
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

  it('names the statistic the check evaluates, not just the threshold', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([
      makeSloResult({ evaluate_type: 'max', requirement_operator: 'gt', requirement_value: 0.9, metric_unit: 'percentunit' }),
      makeSloResult({ evaluate_type: 'mean', requirement_operator: 'lte', requirement_value: 1000, metric_unit: 'ms' }),
      makeSloResult({ evaluate_type: 'q95', requirement_operator: 'lt', requirement_value: 500, metric_unit: 'ms' }),
      // A statistic the map does not know still reads as a sentence
      makeSloResult({ evaluate_type: 'whatever', requirement_operator: 'lt', requirement_value: 5, metric_unit: 'ms' }),
    ]);

    const html = await renderer.renderSloSection(makeSection(), makeTestRun());

    expect(html).toContain('Maximum value should be greater than 90%');
    expect(html).toContain('Average value should be less than or equal to 1000 ms');
    expect(html).toContain('95th percentile should be less than 500 ms');
    expect(html).toContain('Value should be less than 5 ms');
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
    expect(html).toContain('greater than 90%');
    expect(html).toContain('85%');
    // short: unitless number, no ".00" padding
    expect(html).toContain('less than 70');
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

  it('states an apdex requirement as a minimum score for every transaction, not "No requirement"', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([makeApdexResult()]);

    const html = await renderer.renderSloSection(makeSection(), makeTestRun());

    expect(html).toContain('≥ 0.85 Apdex for all transactions');
    expect(html).not.toContain('No requirement');
    // The raw unit code is not printable
    expect(html).not.toContain('apdex_score');
    // The requirement no longer names one threshold — the transaction rows carry their own
    expect(html).not.toContain('at 500 ms');
  });

  it('gives the apdex table the SLO card\'s columns and no Actual column', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([makeApdexResult()]);

    const html = await renderer.renderSloSection(makeSection(), makeTestRun());

    expect(html).toContain('>Dashboard</th>');
    expect(html).toContain('>Metric Name</th>');
    expect(html).toContain('>Requirement</th>');
    expect(html).not.toContain('>Actual</th>');
    // The card names these two the same way
    expect(html).toContain('Apdex SLO');
    expect(html).toContain('Apdex Score');
    // A run-wide 0.94 says nothing the transactions below do not say better
    expect(html).not.toContain('0.94');
  });

  it('flags each failing apdex transaction and gives it its own threshold', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([makeApdexResult()]);

    const html = await renderer.renderSloSection(makeSection(), makeTestRun());

    expect(html).toContain('>Threshold</th>');
    expect(html).toContain('800 ms'); // this transaction's own threshold, not the section default
    expect(html).toContain('>FAIL</span>');
  });

  it('tables each source separately, apdex apart from the grafana checks it is stored under', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([
      makeApdexResult(),
      makeSloResult({ source: 'grafana', benchmark_source: 'grafana', panel_title: 'CPU' }),
      makeSloResult({ source: 'dynatrace', benchmark_source: 'dynatrace', panel_title: 'Memory' }),
    ]);

    const html = await renderer.renderSloSection(makeSection(), makeTestRun());

    expect(html).toContain('>Apdex</h3>');
    expect(html).toContain('>Grafana</h3>');
    expect(html).toContain('>Dynatrace</h3>');
    // Grouping replaced the column that repeated one value down the whole table
    expect(html).not.toContain('>Source</th>');
    expect(html).not.toContain('>Type</th>');
  });

  it('follows the benchmark for the source, not the grafana stamp every check result carries', async () => {
    dataFetcher.getSloCheckResults.mockResolvedValue([
      // The checker writes source: 'grafana' on every row; the benchmark knows better.
      makeSloResult({ source: 'grafana', benchmark_source: 'performance-metrics', panel_title: 'Transaction RT Avg' }),
      makeSloResult({ source: 'grafana', benchmark_source: 'custom', panel_title: 'P95 Transaction Response Times' }),
      makeSloResult({ source: 'grafana', benchmark_source: 'grafana', panel_title: 'CPU' }),
    ]);

    const html = await renderer.renderSloSection(makeSection(), makeTestRun());

    expect(html).toContain('>Performance metrics</h3>');
    expect(html).toContain('>Grafana</h3>');
    // 'custom' is what the SLO card labels performance-metrics, so it groups with it
    expect(html).toContain('2 checks');
    expect(html).toContain('1 checks');
  });

  it('lists the failing series of a metric check only when the section asks for details', async () => {
    const failing = makeSloResult({
      meets_requirement: false,
      panel_title: 'CPU',
      message: '2 of 3 targets failed',
      targets: [
        { target: 'host-a', value: 95, meets_requirement: false },
        { target: 'host-b', value: 12, meets_requirement: true },
      ],
    });
    dataFetcher.getSloCheckResults.mockResolvedValue([failing]);

    const off = await renderer.renderSloSection(makeSection(), makeTestRun());
    expect(off).not.toContain('host-a');

    const on = await renderer.renderSloSection(
      makeSection({ config: { showFailureDetails: true } }),
      makeTestRun(),
    );
    expect(on).toContain('host-a');
    // Counted from the rows shown, not quoted from a message that can disagree with them
    expect(on).toContain('1 of 2 targets failed');
    expect(on).toContain('>FAIL</span>');
    // Passing series are not the finding
    expect(on).not.toContain('host-b');
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

    expect(html).toContain('P95 should be less than or equal to 2000 ms');
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
  describe('the ACTUAL column of a per-target check', () => {
    // `average_all: false` judges every transaction separately, so there is no single actual
    // value. `DataAggregator` still fills `panel_average` with `values[0]` — the FIRST target —
    // which produced a report reading "0" beside a FAIL caused by two other transactions.
    const perTarget = (overrides?: Record<string, unknown>) =>
      makeSloResult({
        panel_title: 'Performance test metrics BrowseAndSearch',
        metric_name: 'Transaction Error Rate',
        requirement_operator: 'lt',
        requirement_value: 2,
        metric_unit: '',
        average_all: false,
        meets_requirement: false,
        panel_average: 0,
        targets: [
          { target: 'T01_Homepage_Load', value: 0, meets_requirement: true },
          { target: 'T03_Search_Products', value: 4.92, meets_requirement: false },
          { target: 'T07_Product_Assets', value: 6.56, meets_requirement: false },
        ],
        ...overrides,
      });

    const actualCells = (html: string) =>
      Array.from(html.matchAll(/text-align: right;[^>]*>([^<]*)</g)).map((m) => m[1]!.trim());

    it('shows the value that produced the verdict, not the first target', async () => {
      dataFetcher.getSloCheckResults.mockResolvedValue([perTarget()]);

      const html = await renderer.renderSloSection(makeSection(), makeTestRun());

      expect(actualCells(html)).toContain('6.56');
      expect(actualCells(html)).not.toContain('0');
    });

    it('shows the target closest to the limit when every target passed', async () => {
      dataFetcher.getSloCheckResults.mockResolvedValue([
        perTarget({
          meets_requirement: true,
          targets: [
            { target: 'T01', value: 0, meets_requirement: true },
            { target: 'T03', value: 1.8, meets_requirement: true },
          ],
        }),
      ]);

      const html = await renderer.renderSloSection(makeSection(), makeTestRun());

      expect(actualCells(html)).toContain('1.8');
    });

    it('takes the MINIMUM when the requirement points the other way', async () => {
      // `gt`: higher is better, so the worst target is the smallest one.
      dataFetcher.getSloCheckResults.mockResolvedValue([
        perTarget({
          requirement_operator: 'gt',
          requirement_value: 95,
          targets: [
            { target: 'T01', value: 99.9, meets_requirement: true },
            { target: 'T03', value: 91.2, meets_requirement: false },
          ],
        }),
      ]);

      const html = await renderer.renderSloSection(makeSection(), makeTestRun());

      expect(actualCells(html)).toContain('91.2');
    });

    it('shows the failing target of an AVERAGED check too, not its passing mean', async () => {
      // `RequirementChecker` fails the whole check on any failing target and does not consult
      // `average_all` to do it — the panel-average comparison is only an extra failure source.
      // So an averaged check can carry a FAIL that its own comfortably-passing mean does not
      // explain, and printing the mean there is the same contradiction in the other half of
      // the table: "1.5" beside "Average value should be less than 2" and a red FAIL.
      dataFetcher.getSloCheckResults.mockResolvedValue([
        perTarget({
          average_all: true,
          panel_average: 1.5,
          targets: [
            { target: 'T01', value: 0, meets_requirement: true },
            { target: 'T03', value: 7.4, meets_requirement: false },
          ],
        }),
      ]);

      const html = await renderer.renderSloSection(makeSection(), makeTestRun());

      expect(actualCells(html)).toContain('7.4');
      expect(actualCells(html)).not.toContain('1.5');
    });

    it('keeps the mean when the AVERAGE itself is what failed', async () => {
      // No target failed, so the verdict came from the panel-average comparison and the mean
      // is exactly the number that produced it.
      dataFetcher.getSloCheckResults.mockResolvedValue([
        perTarget({
          average_all: true,
          panel_average: 3.7,
          targets: [
            { target: 'T01', value: 3.2, meets_requirement: true },
            { target: 'T03', value: 4.1, meets_requirement: true },
          ],
        }),
      ]);

      const html = await renderer.renderSloSection(makeSection(), makeTestRun());

      expect(actualCells(html)).toContain('3.7');
      expect(actualCells(html)).not.toContain('4.1');
    });

    it('keeps using panel_average for a PASSING averaged check, where it IS the actual value', async () => {
      dataFetcher.getSloCheckResults.mockResolvedValue([
        perTarget({
          average_all: true,
          meets_requirement: true,
          panel_average: 3.7,
          targets: [
            { target: 'T01', value: 0, meets_requirement: true },
            { target: 'T03', value: 7.4, meets_requirement: true },
          ],
        }),
      ]);

      const html = await renderer.renderSloSection(makeSection(), makeTestRun());

      expect(actualCells(html)).toContain('3.7');
      expect(actualCells(html)).not.toContain('7.4');
    });

    it.each([
      ['NULL', null],
      ['missing', undefined],
    ])('treats a %s average_all as averaged on the passing side', async (_label, averageAll) => {
      // The column is NOT NULL in the DDL, so these shapes mean the fetcher's SELECT stopped
      // carrying `cr.average_all`. On a passing check that must degrade to the old behaviour
      // rather than to a "closest to the limit" value the reader cannot account for. A FAILED
      // check does not consult the column at all, so the fix survives that regression.
      dataFetcher.getSloCheckResults.mockResolvedValue([
        perTarget({ average_all: averageAll, meets_requirement: true, panel_average: 3.7 }),
      ]);

      const html = await renderer.renderSloSection(makeSection(), makeTestRun());

      expect(actualCells(html)).toContain('3.7');
      expect(actualCells(html)).not.toContain('6.56');
    });

    it.each(['<', 'le', 'lte', '<='])(
      'reads %s as lower-is-better and takes the maximum',
      async (operator) => {
        dataFetcher.getSloCheckResults.mockResolvedValue([
          perTarget({ requirement_operator: operator }),
        ]);

        const html = await renderer.renderSloSection(makeSection(), makeTestRun());

        expect(actualCells(html)).toContain('6.56');
      },
    );

    it.each(['>', 'ge', 'gte', '>='])(
      'reads %s as higher-is-better and takes the minimum',
      async (operator) => {
        dataFetcher.getSloCheckResults.mockResolvedValue([
          perTarget({
            requirement_operator: operator,
            requirement_value: 95,
            targets: [
              { target: 'T01', value: 99.9, meets_requirement: true },
              { target: 'T03', value: 91.2, meets_requirement: false },
            ],
          }),
        ]);

        const html = await renderer.renderSloSection(makeSection(), makeTestRun());

        expect(actualCells(html)).toContain('91.2');
      },
    );

    it.each(['eq', '=', '==', 'ne', '!=', '<>', 'wat'])(
      'falls back to panel_average on a PASSING check for %s, which orders nothing',
      async (operator) => {
        // Nothing failed and the operator implies no ordering, so there is no "closest to the
        // limit" either — picking among equals would just reinvent the arbitrary values[0].
        dataFetcher.getSloCheckResults.mockResolvedValue([
          perTarget({ requirement_operator: operator, meets_requirement: true, panel_average: 3.7 }),
        ]);

        const html = await renderer.renderSloSection(makeSection(), makeTestRun());

        expect(actualCells(html)).toContain('3.7');
        expect(actualCells(html)).not.toContain('6.56');
      },
    );

    it.each(['eq', 'ne', '!=', 'wat'])(
      'shows a FAILING target for %s, where the arbitrary mean would say nothing',
      async (operator) => {
        // An "≠ 26.25" check that failed did so AT 26.25. The operator gives no ordering, but
        // a target the checker actually failed is still an honest answer.
        dataFetcher.getSloCheckResults.mockResolvedValue([
          perTarget({
            requirement_operator: operator,
            requirement_value: 26.25,
            panel_average: 3.7,
            targets: [
              { target: 'T01', value: 1.11, meets_requirement: true },
              { target: 'T03', value: 26.25, meets_requirement: false },
            ],
          }),
        ]);

        const html = await renderer.renderSloSection(makeSection(), makeTestRun());

        expect(actualCells(html)).toContain('26.25');
        expect(actualCells(html)).not.toContain('3.7');
      },
    );

    it('falls back to panel_average when a passing check carries no operator', async () => {
      dataFetcher.getSloCheckResults.mockResolvedValue([
        perTarget({
          requirement_operator: null,
          requirement_value: null,
          meets_requirement: true,
          panel_average: 3.7,
        }),
      ]);

      const html = await renderer.renderSloSection(makeSection(), makeTestRun());

      expect(actualCells(html)).toContain('3.7');
      expect(actualCells(html)).not.toContain('6.56');
    });

    it.each([
      ['no targets array', null],
      ['an empty targets array', []],
      ['targets whose values are all null', [{ target: 'T01', value: null, meets_requirement: null }]],
    ])('falls back to panel_average with %s', async (_label, targets) => {
      dataFetcher.getSloCheckResults.mockResolvedValue([
        perTarget({ targets, panel_average: 3.7 }),
      ]);

      const html = await renderer.renderSloSection(makeSection(), makeTestRun());

      expect(actualCells(html)).toContain('3.7');
    });

    it('ignores a target with no value and takes the worst of the rest', async () => {
      dataFetcher.getSloCheckResults.mockResolvedValue([
        perTarget({
          panel_average: 99,
          targets: [
            { target: 'T01', value: null, meets_requirement: null },
            { target: 'T03', value: 4.92, meets_requirement: false },
            { target: 'T07', value: null, meets_requirement: null },
          ],
        }),
      ]);

      const html = await renderer.renderSloSection(makeSection(), makeTestRun());

      expect(actualCells(html)).toContain('4.92');
      expect(actualCells(html)).not.toContain('99');
    });

    it('prints a worst value of 0 rather than falling back to panel_average', async () => {
      // `?? `, not `||`: a check whose every target measured zero has 0 as its honest
      // actual value, and `||` would reach past it for whatever `values[0]` happened to be.
      dataFetcher.getSloCheckResults.mockResolvedValue([
        perTarget({
          meets_requirement: true,
          panel_average: 99,
          targets: [
            { target: 'T01', value: 0, meets_requirement: true },
            { target: 'T03', value: 0, meets_requirement: true },
          ],
        }),
      ]);

      const html = await renderer.renderSloSection(makeSection(), makeTestRun());

      expect(actualCells(html)).toContain('0');
      expect(actualCells(html)).not.toContain('99');
    });

    it('scales the worst target through its unit, as the requirement is scaled', async () => {
      // percentunit is stored 0.0-1.0 and always read as 0-100%, so the Actual column has
      // to go through the same formatter the requirement does — not print a bare 0.912.
      dataFetcher.getSloCheckResults.mockResolvedValue([
        perTarget({
          metric_name: 'Success rate',
          requirement_operator: 'gt',
          requirement_value: 0.95,
          metric_unit: 'percentunit',
          targets: [
            { target: 'T01', value: 0.999, meets_requirement: true },
            { target: 'T03', value: 0.912, meets_requirement: false },
          ],
        }),
      ]);

      const html = await renderer.renderSloSection(makeSection(), makeTestRun());

      expect(actualCells(html)).toContain('91.2%');
      expect(html).not.toContain('percentunit');
    });

    describe('only targets the checker actually judged', () => {
      it('ignores a series the SLO match_pattern excluded', async () => {
        // `RequirementChecker` reports a pattern-excluded series with meets_requirement NULL.
        // It keeps its real value, so an unfiltered max prints the worst series on the panel
        // for a check that deliberately left it out.
        dataFetcher.getSloCheckResults.mockResolvedValue([
          perTarget({
            meets_requirement: true,
            panel_average: 1.1,
            targets: [
              { target: 'T03_Search_Products', value: 1.1, meets_requirement: true },
              { target: 'T99_Excluded', value: 97.3, meets_requirement: null },
            ],
          }),
        ]);

        const html = await renderer.renderSloSection(makeSection(), makeTestRun());

        expect(actualCells(html)).toContain('1.1');
        expect(actualCells(html)).not.toContain('97.3');
      });

      it('ignores a weak-trend series, which the pipeline left out of the average too', async () => {
        // A Trend SLO below the correlation floor passes on the grounds that the slope is
        // meaningless, and `DataAggregator` keeps it out of `values`. Printing it would put a
        // steep %/h figure beside a PASS — the same contradiction, inverted.
        dataFetcher.getSloCheckResults.mockResolvedValue([
          perTarget({
            requirement_value: 5,
            meets_requirement: true,
            panel_average: 0.4,
            targets: [
              { target: 'T01', value: 0.4, meets_requirement: true },
              { target: 'T99_Noise', value: 48.2, meets_requirement: true, weak_trend: true, trend_corr: 0.11 },
            ],
          }),
        ]);

        const html = await renderer.renderSloSection(makeSection(), makeTestRun());

        expect(actualCells(html)).toContain('0.4');
        expect(actualCells(html)).not.toContain('48.2');
      });

      it('keeps an is_artificial target, because the aggregator averages those', async () => {
        // `is_artificial` is `stat.is_constant`, which also matches a real series that never
        // varied. Excluding it here would invent a divergence from `panel_average`, not close one.
        dataFetcher.getSloCheckResults.mockResolvedValue([
          perTarget({
            targets: [
              { target: 'T01', value: 1.0, meets_requirement: true },
              { target: 'T02_Flat', value: 7.7, meets_requirement: false, is_artificial: true },
            ],
          }),
        ]);

        const html = await renderer.renderSloSection(makeSection(), makeTestRun());

        expect(actualCells(html)).toContain('7.7');
      });

      it('falls back to panel_average when nothing was judged', async () => {
        dataFetcher.getSloCheckResults.mockResolvedValue([
          perTarget({
            panel_average: 3.3,
            targets: [
              { target: 'T01', value: 11.1, meets_requirement: null },
              { target: 'T02', value: 22.2, meets_requirement: null },
            ],
          }),
        ]);

        const html = await renderer.renderSloSection(makeSection(), makeTestRun());

        expect(actualCells(html)).toContain('3.3');
        expect(actualCells(html)).not.toContain('22.2');
      });
    });

    it('reads a target value stored as a jsonb string', async () => {
      // `Number.isFinite('4.92')` is false, but the breakdown's sort coerces and
      // formatValueWithUnit parseFloats it — a strict check here made the three layers
      // disagree and sent the row back to the arbitrary panel_average while the breakdown
      // printed the real numbers underneath it.
      dataFetcher.getSloCheckResults.mockResolvedValue([
        perTarget({
          panel_average: 0,
          targets: [
            { target: 'T01', value: '0' as never, meets_requirement: true },
            { target: 'T03', value: '4.92' as never, meets_requirement: false },
            { target: 'T07', value: '6.56' as never, meets_requirement: false },
          ],
        }),
      ]);

      const html = await renderer.renderSloSection(makeSection(), makeTestRun());

      expect(actualCells(html)).toContain('6.56');
      expect(actualCells(html)).not.toContain('0');
    });

    it('ignores a target whose meets_requirement key is absent entirely', async () => {
      // jsonb is not type-checked at the boundary. `!== null` would read a missing key as
      // judged on the passing side while the failing side's `=== false` never admits it.
      dataFetcher.getSloCheckResults.mockResolvedValue([
        perTarget({
          meets_requirement: true,
          panel_average: 1.2,
          targets: [
            { target: 'T01', value: 1.2, meets_requirement: true },
            { target: 'T99_Unjudged', value: 88.8 } as never,
          ],
        }),
      ]);

      const html = await renderer.renderSloSection(makeSection(), makeTestRun());

      expect(actualCells(html)).toContain('1.2');
      expect(actualCells(html)).not.toContain('88.8');
    });

    it('picks the failing value furthest from the requirement for eq', async () => {
      // `eq`'s failing targets are every value that is NOT the threshold, and they differ
      // arbitrarily — taking the first would be the same defect as panel_average.
      dataFetcher.getSloCheckResults.mockResolvedValue([
        perTarget({
          requirement_operator: 'eq',
          requirement_value: 100,
          panel_average: 3.7,
          targets: [
            { target: 'T01_Near', value: 99, meets_requirement: false },
            { target: 'T03_Far', value: 12, meets_requirement: false },
          ],
        }),
      ]);

      const html = await renderer.renderSloSection(makeSection(), makeTestRun());

      expect(actualCells(html)).toContain('12');
      expect(actualCells(html)).not.toContain('99');
    });

    it('counts only judged targets in the breakdown caption', async () => {
      // "2 of 7 targets failed" when 5 were pattern-excluded is the dishonest count the
      // caption exists to replace.
      dataFetcher.getSloCheckResults.mockResolvedValue([
        perTarget({
          targets: [
            { target: 'T01', value: 4.92, meets_requirement: false },
            { target: 'T02', value: 6.56, meets_requirement: false },
            { target: 'X01', value: 9.9, meets_requirement: null },
            { target: 'X02', value: 9.9, meets_requirement: null },
          ],
        }),
      ]);

      const html = await renderer.renderSloSection(
        makeSection({ config: { showFailureDetails: true } }),
        makeTestRun(),
      );

      expect(html).toContain('2 of 2 targets failed');
      expect(html).not.toContain('2 of 4 targets failed');
    });

    it('renders a non-string target name instead of throwing away the section', async () => {
      // escapeHtml calls .replace on it, and the sort can now surface a malformed target
      // that previously sat in the truncated tail. A throw here costs the whole SLO section.
      dataFetcher.getSloCheckResults.mockResolvedValue([
        perTarget({
          targets: [{ target: 12345 as never, value: 6.56, meets_requirement: false }],
        }),
      ]);

      const html = await renderer.renderSloSection(
        makeSection({ config: { showFailureDetails: true } }),
        makeTestRun(),
      );

      expect(html).toContain('12345');
      expect(html).not.toContain('Failed to render');
    });

    it('sinks a null-valued failing target to the end of the breakdown', async () => {
      // The comparator has to be a total order: `null - null` is NaN, which V8 leaves unsorted.
      dataFetcher.getSloCheckResults.mockResolvedValue([
        perTarget({
          targets: [
            { target: 'T01_NoValue', value: null, meets_requirement: false },
            { target: 'T03_Worst', value: 9.1, meets_requirement: false },
          ],
        }),
      ]);

      const html = await renderer.renderSloSection(
        makeSection({ config: { showFailureDetails: true } }),
        makeTestRun(),
      );

      expect(actualCells(html)).toContain('9.1');
      expect(html.indexOf('T03_Worst')).toBeLessThan(html.indexOf('T01_NoValue'));
    });

    it('survives a targets value that is not an array', async () => {
      // `targets` is jsonb and this path now runs for passing rows too, where the old code
      // never touched it. An unguarded .filter throws into the compiler's per-section catch,
      // which replaces the whole SLO section with an error placeholder.
      dataFetcher.getSloCheckResults.mockResolvedValue([
        perTarget({ panel_average: 2.5, targets: { 'T01': 4.92 } as never }),
      ]);

      const html = await renderer.renderSloSection(makeSection(), makeTestRun());

      expect(actualCells(html)).toContain('2.5');
      expect(html).toContain('SLO Results');
    });

    it('lists the failing targets worst first, so the actual value is row one', async () => {
      // The breakdown is capped at 20 rows. Unsorted, the value the ACTUAL column prints can
      // land in the "and N more" tail, and a reader cannot tell a truncated list from a wrong one.
      dataFetcher.getSloCheckResults.mockResolvedValue([
        perTarget({
          targets: [
            { target: 'T01_Mild', value: 2.5, meets_requirement: false },
            { target: 'T03_Worst', value: 9.1, meets_requirement: false },
            { target: 'T07_Middle', value: 4.4, meets_requirement: false },
          ],
        }),
      ]);

      const html = await renderer.renderSloSection(
        makeSection({ config: { showFailureDetails: true } }),
        makeTestRun(),
      );

      expect(actualCells(html)).toContain('9.1');
      expect(html.indexOf('T03_Worst')).toBeLessThan(html.indexOf('T07_Middle'));
      expect(html.indexOf('T07_Middle')).toBeLessThan(html.indexOf('T01_Mild'));
    });

    it('lists failing targets lowest first when higher is better', async () => {
      dataFetcher.getSloCheckResults.mockResolvedValue([
        perTarget({
          requirement_operator: 'gte',
          requirement_value: 95,
          targets: [
            { target: 'T01_Near', value: 94, meets_requirement: false },
            { target: 'T03_Worst', value: 11, meets_requirement: false },
          ],
        }),
      ]);

      const html = await renderer.renderSloSection(
        makeSection({ config: { showFailureDetails: true } }),
        makeTestRun(),
      );

      expect(actualCells(html)).toContain('11');
      expect(html.indexOf('T03_Worst')).toBeLessThan(html.indexOf('T01_Near'));
    });

    it.each([['LT'], [' lt '], ['LTE'], ['\tLt\n']])(
      'normalises the operator spelling %j the way the worker does',
      async (operator) => {
        // `benchmarks.requirement_operator` is free text with no CHECK constraint and no DTO
        // allowlist, and `evaluateRequirement` trims and lowercases before matching — so the
        // worker judges these and this column must not silently fall back to panel_average.
        dataFetcher.getSloCheckResults.mockResolvedValue([perTarget({ requirement_operator: operator })]);

        const html = await renderer.renderSloSection(makeSection(), makeTestRun());

        expect(actualCells(html)).toContain('6.56');
        expect(actualCells(html)).not.toContain('0');
      },
    );
  });

  it('warns rather than reporting an all-clear when the SLO query failed', async () => {
    // null is not []: an empty array draws the green "no checks" card, which reads as
    // "everything passed" and is then stored permanently.
    dataFetcher.getSloCheckResults.mockResolvedValue(null);

    const html = await renderer.renderSloSection(makeSection(), makeTestRun());

    expect(html).toContain('SLO results could not be loaded');
    expect(html).toContain('it does not mean the SLOs passed');
    expect(html).not.toContain('No SLO check results available');
    expect(html).not.toContain('Total Checks');
  });
});
