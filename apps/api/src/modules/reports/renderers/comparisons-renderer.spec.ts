import { Test, TestingModule } from '@nestjs/testing';
import { ComparisonsRenderer } from './comparisons-renderer';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService } from '../services/report-data-fetcher.service';
import { ReportSectionConfig, TestRun } from '@perfana/shared';

const makeSection = (
  overrides?: Partial<ReportSectionConfig>,
): ReportSectionConfig => ({ type: 'comparisons', order: 0, ...overrides });

const makeTestRun = (overrides?: Partial<TestRun>): TestRun =>
  ({
    id: 'uuid-1',
    testRunId: 'run-001',
    testEnvironment: 'staging',
    workload: 'load-test',
    systemUnderTestId: 'system-1',
    ...overrides,
  }) as TestRun;

const makeMetric = (overrides?: Record<string, unknown>) => ({
  dashboardLabel: 'API Dashboard',
  panelTitle: 'Response Time',
  metricName: 'avg',
  unit: 'ms',
  currentValue: 120,
  baselineValue: 100,
  difference: 20,
  differencePercent: 20.0,
  conclusion: 'regression',
  ...overrides,
});

const makeComparisonsData = (overrides?: Record<string, unknown>) => ({
  metrics: [
    makeMetric(),
    makeMetric({
      panelTitle: 'Throughput',
      metricName: 'req/s',
      unit: null,
      currentValue: 500,
      baselineValue: 450,
      difference: 50,
      differencePercent: 11.1,
      conclusion: 'improvement',
    }),
    makeMetric({
      panelTitle: 'Error Rate',
      metricName: 'pct',
      unit: '%',
      currentValue: 0.5,
      baselineValue: 0.5,
      difference: 0,
      differencePercent: 0,
      conclusion: 'no_difference',
    }),
  ],
  regressionCount: 1,
  improvementCount: 1,
  noDifferenceCount: 1,
  totalMetrics: 3,
  ...overrides,
});

describe('ComparisonsRenderer', () => {
  let renderer: ComparisonsRenderer;
  let dataFetcher: jest.Mocked<ReportDataFetcherService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComparisonsRenderer,
        ReportUtilsService,
        {
          provide: ReportDataFetcherService,
          useValue: {
            getComparisonsData: jest.fn().mockResolvedValue(null),
            getBaselineRunComparison: jest.fn().mockResolvedValue(null),
            getAggregatedScalars: jest.fn(),
          },
        },
      ],
    }).compile();

    renderer = module.get(ComparisonsRenderer);
    dataFetcher = module.get(ReportDataFetcherService);
  });

  it('should render placeholder when testRun is null', async () => {
    const html = await renderer.renderComparisonsSection(makeSection(), null);

    expect(html).toContain('comparisons-section');
    expect(html).toContain('No comparison data available');
    expect(dataFetcher.getComparisonsData).not.toHaveBeenCalled();
  });

  it('should render placeholder when no data returned', async () => {
    dataFetcher.getComparisonsData.mockResolvedValue(null);

    const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());

    expect(html).toContain('No comparison data available');
  });

  it('should render right-aligned summary chips in the section header (rule 04)', async () => {
    dataFetcher.getComparisonsData.mockResolvedValue(makeComparisonsData() as any);

    const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());

    expect(html).toContain('1 regressions');
    expect(html).toContain('1 improvements');
    expect(html).toContain('1 within range');
    expect(html).toContain('3 metrics compared');
    // Old badge/label vocabulary is gone (rule 01/04)
    expect(html).not.toContain('Total Metrics');
    expect(html).not.toContain('No Difference');
    expect(html).not.toContain('&#x2194;'); // section emoji icon removed
  });

  it('should render comparison table grouped by dashboard', async () => {
    dataFetcher.getComparisonsData.mockResolvedValue(makeComparisonsData() as any);

    const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());

    expect(html).toContain('API Dashboard');
    expect(html).toContain('Response Time');
    expect(html).toContain('Throughput');
    expect(html).toContain('Error Rate');
    expect(html).toContain('120 ms');
    expect(html).toContain('100 ms');
    expect(html).toContain('+20.0%');
    expect(html).toContain('▲'); // arrow bound to positive diff (rule 02)
  });

  it('should render five-state status pills per metric (rule 01)', async () => {
    dataFetcher.getComparisonsData.mockResolvedValue(makeComparisonsData() as any);

    const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());

    expect(html).toContain('>REGRESSION</span>');
    expect(html).toContain('>IMPROVEMENT</span>');
    expect(html).toContain('>OK</span>');
    // Old conclusion labels no longer rendered as-is
    expect(html).not.toMatch(/no difference/i);
    expect(html).not.toContain('>regression</span>');
    // Generic minus arrow is gone (rule 02)
    expect(html).not.toContain('&#x2796;');
    expect(html).not.toContain('➖');
  });

  it('collapses raw increase/partial/incomparable labels to the five states', async () => {
    const data = makeComparisonsData({
      metrics: [
        makeMetric({ conclusion: 'regression' }),
        // increase/decrease/partial variants are only emitted when the metric
        // direction is unclassified — they map to WARNING, never REGRESSION.
        makeMetric({ panelTitle: 'P2', conclusion: 'increase', differencePercent: 12 }),
        makeMetric({ panelTitle: 'P3', conclusion: 'partial increase', differencePercent: 12 }),
        makeMetric({ panelTitle: 'P4', conclusion: 'decrease', differencePercent: -12 }),
        makeMetric({ panelTitle: 'P5', conclusion: 'partial improvement', differencePercent: -12 }),
        makeMetric({ panelTitle: 'P6', conclusion: 'incomparable', currentValue: null, baselineValue: null, difference: null, differencePercent: null }),
      ],
    });
    dataFetcher.getComparisonsData.mockResolvedValue(data as any);

    const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());

    expect(html).toContain('>REGRESSION</span>');
    expect(html).toContain('>WARNING</span>');
    expect(html).toContain('>IMPROVEMENT</span>');
    expect(html).toContain('>N/A</span>');
    expect(html).not.toContain('>INCREASE<');
    expect(html).not.toContain('>increase<');
    expect(html).not.toContain('>DECREASE<');
    expect(html).not.toMatch(/partial/i);
    expect(html).not.toMatch(/incomparable/i);
  });

  it('maps an increase row to WARNING, not REGRESSION (unclassified direction)', async () => {
    const data = makeComparisonsData({
      metrics: [makeMetric({ conclusion: 'increase', differencePercent: 30 })],
    });
    dataFetcher.getComparisonsData.mockResolvedValue(data as any);

    const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());

    expect(html).toContain('>WARNING</span>');
    expect(html).not.toContain('>REGRESSION</span>');
  });

  it('should render custom title and comment', async () => {
    dataFetcher.getComparisonsData.mockResolvedValue(makeComparisonsData() as any);

    const html = await renderer.renderComparisonsSection(
      makeSection({ title: 'Run Comparison', comment: 'vs baseline run' }),
      makeTestRun(),
    );

    expect(html).toContain('Run Comparison');
    expect(html).toContain('vs baseline run');
    expect(html).toContain('section-comment');
  });

  it('should pass baselineTestRunId from config', async () => {
    dataFetcher.getComparisonsData.mockResolvedValue(makeComparisonsData() as any);

    await renderer.renderComparisonsSection(
      makeSection({ config: { baselineTestRunId: 'baseline-run-123' } }),
      makeTestRun(),
    );

    expect(dataFetcher.getComparisonsData).toHaveBeenCalledWith('run-001', 'baseline-run-123');
  });

  it('should group metrics by dashboard with metric-count chips (rule 05)', async () => {
    const data = makeComparisonsData({
      metrics: [
        makeMetric({ dashboardLabel: 'Dashboard A', panelTitle: 'Panel 1' }),
        makeMetric({ dashboardLabel: 'Dashboard A', panelTitle: 'Panel 2' }),
        makeMetric({ dashboardLabel: 'Dashboard B', panelTitle: 'Panel 3' }),
      ],
    });

    dataFetcher.getComparisonsData.mockResolvedValue(data as any);

    const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());

    expect(html).toContain('>Dashboard A</h3>');
    expect(html).toContain('>Dashboard B</h3>');
    expect(html).toContain('2 metrics');
    expect(html).toContain('1 metrics');
  });

  it('should handle empty metrics gracefully', async () => {
    dataFetcher.getComparisonsData.mockResolvedValue(
      makeComparisonsData({ metrics: [], totalMetrics: 0 }) as any,
    );

    const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());

    expect(html).toContain('No comparison data available');
  });

  it('should format different unit types', async () => {
    const data = makeComparisonsData({
      metrics: [
        makeMetric({ unit: 'ms', currentValue: 250.6 }),
        makeMetric({ panelTitle: 'CPU', metricName: 'usage', unit: '%', currentValue: 75.3 }),
        makeMetric({ panelTitle: 'Memory', metricName: 'used', unit: 'bytes', currentValue: 1073741824 }),
      ],
    });

    dataFetcher.getComparisonsData.mockResolvedValue(data as any);

    const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());

    expect(html).toContain('250.6 ms');
    expect(html).toContain('75.3 %'); // '%' falls through unit-format's generic "value + unit" path
    expect(html).toContain('1 GB');
  });

  it('keeps small non-zero values from collapsing to 0 (rule 03 precision)', async () => {
    const data = makeComparisonsData({
      metrics: [
        makeMetric({ panelTitle: 'Tiny', metricName: 'ratio', unit: null, currentValue: 0.0042, baselineValue: 0.004, difference: 0.0002, differencePercent: 5 }),
      ],
    });

    dataFetcher.getComparisonsData.mockResolvedValue(data as any);

    const html = await renderer.renderComparisonsSection(makeSection(), makeTestRun());

    expect(html).toContain('0.0042');
    expect(html).not.toContain('>0<'); // never rendered as a bare zero
  });

  it('renders baseline_run mode grouped by scenario with band colors', async () => {
    const data = { source: 'performance-metrics', rows: [
      { group: 'checkout', label: 'login', metrics: [
        { key: 'avg', current: 110, baseline: 100, diffPercent: 10 },
        { key: 'p95', current: 220, baseline: 200, diffPercent: 10 },
      ] },
    ] };
    jest.spyOn(dataFetcher, 'getBaselineRunComparison').mockResolvedValue(data as any);
    const html = await renderer.renderComparisonsSection(
      { type: 'comparisons', order: 0, config: {
        comparisonMode: 'baseline_run', baselineTestRunId: 'base', source: 'performance-metrics',
        metrics: ['avg','p95'], thresholds: { good: 10, warning: 50 } } } as any,
      { testRunId: 'cur' } as any,
    );
    expect(html).toContain('checkout');
    expect(html).toContain('login');
    expect(html).toContain('#43a047'); // 10% == good threshold (inclusive) => green band on the magnitude bar
    expect(html).not.toContain('➖');
  });

  it('agrees between deltaChip and bandColor at diffPercent exactly = thresholds.good', async () => {
    // Boundary semantics are inclusive on BOTH paths: ≤ good = good. A diff of
    // exactly 10% with good=10 must render a good delta chip AND a good band bar.
    const data = { source: 'performance-metrics', rows: [
      { group: 'checkout', label: 'login', metrics: [
        { key: 'avg', current: 110, baseline: 100, diffPercent: 10 },
      ] },
    ] };
    jest.spyOn(dataFetcher, 'getBaselineRunComparison').mockResolvedValue(data as any);
    const html = await renderer.renderComparisonsSection(
      { type: 'comparisons', order: 0, config: {
        comparisonMode: 'baseline_run', baselineTestRunId: 'base', source: 'performance-metrics',
        metrics: ['avg'], thresholds: { good: 10, warning: 50 } } } as any,
      { testRunId: 'cur' } as any,
    );
    // deltaChip: good status → good pill fill
    expect(html).toContain('background:#e7f4ea; color:#2e7d32;');
    expect(html).toContain('+10.0%');
    // bandColor: good dot on the magnitude bar + good row accent (band paths agree)
    expect(html).toContain('background:#43a047');
    expect(html).toContain('border-left:3px solid #43a047');
    // Neither band path may disagree with amber/red at the boundary
    expect(html).not.toContain('border-left:3px solid #f59e0b');
    expect(html).not.toContain('background:#fdf0dd; color:#9a5b00;'); // no warn delta chip
    // Row counted as "within range" in the summary chips
    expect(html).toContain('1 within range');
  });

  it('whitelists config.metrics and coerces config.thresholds (hostile config)', async () => {
    const data = { source: 'performance-metrics', rows: [
      { group: 'checkout', label: 'login', metrics: [
        { key: 'avg', current: 110, baseline: 100, diffPercent: 10 },
      ] },
    ] };
    const spy = jest.spyOn(dataFetcher, 'getBaselineRunComparison').mockResolvedValue(data as any);
    const html = await renderer.renderComparisonsSection(
      { type: 'comparisons', order: 0, config: {
        comparisonMode: 'baseline_run', baselineTestRunId: 'base', source: 'performance-metrics',
        metrics: ['avg', '"><script>alert(1)</script>', 'p95'],
        thresholds: { good: '<img onerror=x>', warning: 50 },
      } } as any,
      { testRunId: 'cur' } as any,
    );
    // Injected metric key never reaches the fetcher or the markup
    expect(spy.mock.calls[0]![3].metrics).toEqual(['avg', 'p95']);
    expect(html).not.toContain('<script>alert(1)</script>');
    // Non-numeric thresholds fall back to the defaults (good=10 → boundary is green)
    expect(html).toContain('&#8804; 10%');
    expect(html).not.toContain('<img onerror');
  });

  it('defaults to avg/p95/p99 when config.metrics has no valid entries', async () => {
    const spy = jest.spyOn(dataFetcher, 'getBaselineRunComparison').mockResolvedValue(null);
    await renderer.renderComparisonsSection(
      { type: 'comparisons', order: 0, config: {
        comparisonMode: 'baseline_run', baselineTestRunId: 'base', source: 'performance-metrics',
        metrics: ['bogus'],
      } } as any,
      { testRunId: 'cur' } as any,
    );
    expect(spy.mock.calls[0]![3].metrics).toEqual(['avg', 'p95', 'p99']);
  });

  it('renders dynatrace as ONE merged table: host as chip, id prefix stripped, 2dp values', async () => {
    const data = { source: 'dynatrace', rows: [
      { group: 'HOST-123', label: 'HOST-123_afterburner-be_Memory Usage', metrics: [
        { key: 'avg', current: 74.005882, baseline: 70, diffPercent: 5.7 },
      ] },
      { group: 'HOST-123', label: 'HOST-123_afterburner-be_CPU Usage', metrics: [
        { key: 'avg', current: 25.5, baseline: 20, diffPercent: 27.5 },
      ] },
    ] };
    jest.spyOn(dataFetcher, 'getBaselineRunComparison').mockResolvedValue(data as any);
    const html = await renderer.renderComparisonsSection(
      { type: 'comparisons', order: 0, config: {
        comparisonMode: 'baseline_run', baselineTestRunId: 'base', source: 'dynatrace',
        metrics: ['avg'], thresholds: { good: 10, warning: 50 } } } as any,
      { testRunId: 'cur' } as any,
    );
    expect(html).toContain('>Dynatrace</h3>');            // group header via shared groupHeader
    expect(html).toContain('afterburner-be');             // host name shown as a chip
    expect(html).toContain('2 metrics');                  // metric-count chip
    expect(html).toContain('Memory Usage');               // id prefix stripped from the metric
    expect(html).not.toContain('HOST-123_');              // raw entity-id label never shown
    expect(html).toContain('74.01');                      // rounded to 2 dp
    expect(html).toContain('>Metric</th>');               // single Metric column
  });

  it('renders grafana as ONE merged table with a Grafana heading and labels as-is', async () => {
    const data = { source: 'grafana', rows: [
      { group: 'JVM / Heap', label: 'heap used', metrics: [
        { key: 'avg', current: 1200.456, baseline: 1000, diffPercent: 20 },
      ] },
    ] };
    jest.spyOn(dataFetcher, 'getBaselineRunComparison').mockResolvedValue(data as any);
    const html = await renderer.renderComparisonsSection(
      { type: 'comparisons', order: 0, config: {
        comparisonMode: 'baseline_run', baselineTestRunId: 'base', source: 'grafana',
        metrics: ['avg'], thresholds: { good: 10, warning: 50 } } } as any,
      { testRunId: 'cur' } as any,
    );
    expect(html).toContain('>Grafana</h3>');
    expect(html).toContain('heap used');
    expect(html).toContain('1,200.46'); // thousands-grouped, 2 dp
    expect(html).toContain('1 warnings'); // shared summary chip
  });

  it('shows a Current → Baseline caption when a dashboard mapping is in effect', async () => {
    const data = { source: 'grafana', rows: [
      { group: 'JVM (acc) / Heap', label: 'heap used', metrics: [
        { key: 'avg', current: 110, baseline: 100, diffPercent: 10 },
      ] },
    ] };
    jest.spyOn(dataFetcher, 'getBaselineRunComparison').mockResolvedValue(data as any);
    const html = await renderer.renderComparisonsSection(
      { type: 'comparisons', order: 0, config: {
        comparisonMode: 'baseline_run', baselineTestRunId: 'base', source: 'grafana',
        metrics: ['avg'], thresholds: { good: 10, warning: 50 },
        dashboardLabel: 'JVM (acc)',
        dashboardMap: [
          { current: 'JVM (acc)', baseline: 'JVM (prod)' },
          { current: 'Other dash', baseline: 'Other dash prod' }, // not selected — not shown
        ],
      } } as any,
      { testRunId: 'cur' } as any,
    );
    expect(html).toContain('>Current</span>');
    expect(html).toContain('JVM (acc)');
    expect(html).toContain('>Baseline</span>');
    expect(html).toContain('JVM (prod)');
    expect(html).toContain('&rarr;');
    expect(html).not.toContain('Other dash prod'); // scoped to the selected dashboard's pair
  });

  it('shows no mapping caption without a dashboardMap or for identity pairs', async () => {
    const data = { source: 'dynatrace', rows: [
      { group: 'HOST-123', label: 'HOST-123_afterburner-be_CPU Usage', metrics: [
        { key: 'avg', current: 60, baseline: 50, diffPercent: 20 },
      ] },
    ] };
    jest.spyOn(dataFetcher, 'getBaselineRunComparison').mockResolvedValue(data as any);
    const html = await renderer.renderComparisonsSection(
      { type: 'comparisons', order: 0, config: {
        comparisonMode: 'baseline_run', baselineTestRunId: 'base', source: 'dynatrace',
        metrics: ['avg'], thresholds: { good: 10, warning: 50 },
        dashboardMap: [{ current: 'Hosts', baseline: 'Hosts' }], // identity — no caption
      } } as any,
      { testRunId: 'cur' } as any,
    );
    expect(html).not.toContain('>Current</span>');
    expect(html).toContain('>Dynatrace</h3>');   // heading unchanged
    expect(html).toContain('afterburner-be');    // host chip unchanged
  });

  it('shows empty state when baseline data is null', async () => {
    jest.spyOn(dataFetcher, 'getBaselineRunComparison').mockResolvedValue(null);
    const html = await renderer.renderComparisonsSection(
      { type: 'comparisons', order: 0, config: { comparisonMode: 'baseline_run', baselineTestRunId: 'base', source: 'grafana' } } as any,
      { testRunId: 'cur' } as any);
    expect(html).toContain('No comparison data available for the selected baseline run');
  });

  it('seam: forwards userId and roles into getBaselineRunComparison opts (regression guard)', async () => {
    const spy = jest.spyOn(dataFetcher, 'getBaselineRunComparison').mockResolvedValue(null);
    await renderer.renderComparisonsSection(
      { type: 'comparisons', order: 0, config: {
        comparisonMode: 'baseline_run', baselineTestRunId: 'base-99', source: 'performance-metrics',
        metrics: ['avg', 'p95'], thresholds: { good: 5, warning: 20 },
      } } as any,
      { testRunId: 'cur-42' } as any,
      'user-1',
      ['user'],
    );
    expect(spy).toHaveBeenCalledTimes(1);
    const optsArg = spy.mock.calls[0]![3];
    expect(optsArg.userId).toBe('user-1');
    expect(optsArg.roles).toEqual(['user']);
  });

  it('forwards dashboardLabel and panel ids from the config into the fetcher opts', async () => {
    const spy = jest.spyOn(dataFetcher, 'getBaselineRunComparison').mockResolvedValue(null);
    await renderer.renderComparisonsSection(
      { type: 'comparisons', order: 0, config: {
        comparisonMode: 'baseline_run', baselineTestRunId: 'base-99', source: 'grafana',
        dashboardLabel: 'JVM Metrics',
        panels: [{ id: 3, title: 'Heap' }, { id: 7, title: 'GC Pause' }],
      } } as any,
      { testRunId: 'cur-42' } as any,
      'user-1',
      ['user'],
    );
    const optsArg = spy.mock.calls[0]![3];
    expect(optsArg.dashboardLabel).toBe('JVM Metrics');
    expect(optsArg.panelIds).toEqual([3, 7]);
  });

  describe('All aggregated (performance-metrics baseline)', () => {
    it('prepends an All aggregated row when includeAggregated is set', async () => {
      dataFetcher.getBaselineRunComparison.mockResolvedValue({
        source: 'performance-metrics',
        rows: [{
          group: 'checkout', label: 'login',
          metrics: [{ key: 'avg', current: 110, baseline: 100, diffPercent: 10 }],
        }],
      } as any);
      (dataFetcher.getAggregatedScalars as jest.Mock)
        .mockResolvedValueOnce({ avg: 150, p95: 250, p99: 300, pass: 0, fail: 0 })  // current
        .mockResolvedValueOnce({ avg: 120, p95: 200, p99: 250, pass: 0, fail: 0 }); // baseline

      const section = makeSection({
        config: {
          comparisonMode: 'baseline_run', source: 'performance-metrics',
          baselineTestRunId: 'base-1', metrics: ['avg'], includeAggregated: true,
        },
      });
      const html = await renderer.renderComparisonsSection(section, makeTestRun(), 'u', ['user']);

      expect(html).toContain('All aggregated');
      expect(dataFetcher.getAggregatedScalars).toHaveBeenCalledTimes(2);
      // Guard against a percentDiff sign/arg-order regression: the aggregated row's
      // rendered cell must show the current value (150) and "vs <baseline>" (120).
      expect(html).toContain('>150<');
      expect(html).toContain('vs 120');
    });
  });
});
