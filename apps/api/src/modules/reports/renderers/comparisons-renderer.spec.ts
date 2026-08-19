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
            getBaselineRunComparison: jest.fn().mockResolvedValue(null),
            getAggregatedScalars: jest.fn(),
            getPreviousTestRun: jest.fn().mockResolvedValue(null),
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
    expect(html).toContain('without a test run');
    expect(dataFetcher.getBaselineRunComparison).not.toHaveBeenCalled();
  });

  it('renders the comparison without a comparisonMode in the config (the mode switch is gone)', async () => {
    dataFetcher.getBaselineRunComparison.mockResolvedValue({
      rows: [{ group: 'default', label: 'checkout', metrics: [{ key: 'avg', current: 60, baseline: 50, diffPercent: 20 }] }],
    } as never);

    const html = await renderer.renderComparisonsSection(
      makeSection({ title: 'Run Comparison', config: { baselineTestRunId: 'base-1' } } as never),
      makeTestRun(),
    );

    expect(html).toContain('Run Comparison');
    expect(html).toContain('checkout');
    expect(dataFetcher.getBaselineRunComparison).toHaveBeenCalledWith(
      'run-001', 'base-1', 'performance-metrics', expect.anything(),
    );
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

  it('shows empty state when baseline data is null, naming the baseline that came back empty', async () => {
    jest.spyOn(dataFetcher, 'getBaselineRunComparison').mockResolvedValue(null);
    const html = await renderer.renderComparisonsSection(
      { type: 'comparisons', order: 0, config: { comparisonMode: 'baseline_run', baselineTestRunId: 'base', source: 'grafana' } } as any,
      { testRunId: 'cur' } as any);
    expect(html).toContain('No comparison data available');
    expect(html).toContain('baseline run base returned no metrics');
    expect(html).toContain('grafana');
  });

  it('says the section has no baseline configured, rather than blaming the data', async () => {
    const spy = jest.spyOn(dataFetcher, 'getBaselineRunComparison');
    const html = await renderer.renderComparisonsSection(
      { type: 'comparisons', order: 0, config: { comparisonMode: 'baseline_run', source: 'grafana' } } as any,
      { testRunId: 'cur' } as any);
    expect(html).toContain('no baseline run is configured for this section');
    expect(spy).not.toHaveBeenCalled();
  });

  it('says the run is the first in its scope when "previous" resolves to nothing', async () => {
    jest.spyOn(dataFetcher, 'getPreviousTestRun').mockResolvedValue(null as never);
    const html = await renderer.renderComparisonsSection(
      { type: 'comparisons', order: 0, config: { comparisonMode: 'baseline_run', baselineTestRunId: 'previous', source: 'grafana' } } as any,
      { testRunId: 'cur' } as any);
    expect(html).toContain('first run for its system, environment and workload');
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

  it('reads a pre-multi-select config as a one-dashboard selection', async () => {
    const spy = jest.spyOn(dataFetcher, 'getBaselineRunComparison').mockResolvedValue(null);
    await renderer.renderComparisonsSection(
      { type: 'comparisons', order: 0, config: {
        baselineTestRunId: 'base-99', source: 'grafana',
        dashboardLabel: 'JVM Metrics',
        panels: [{ id: 3, title: 'Heap' }, { id: 7, title: 'GC Pause' }],
      } } as any,
      { testRunId: 'cur-42' } as any,
      'user-1',
      ['user'],
    );
    expect(spy.mock.calls[0]![3].selections).toEqual([
      { dashboardLabel: 'JVM Metrics', panelId: 3 },
      { dashboardLabel: 'JVM Metrics', panelId: 7 },
    ]);
  });

  it('forwards a multi-dashboard, multi-panel, multi-series selection', async () => {
    const spy = jest.spyOn(dataFetcher, 'getBaselineRunComparison').mockResolvedValue(null);
    await renderer.renderComparisonsSection(
      { type: 'comparisons', order: 0, config: {
        baselineTestRunId: 'base-99', source: 'grafana',
        dashboardLabels: ['JVM Metrics', 'Docker Metrics'],
        panels: [
          { id: 3, title: 'Heap', dashboardLabel: 'JVM Metrics' },
          { id: 7, title: 'GC Pause', dashboardLabel: 'JVM Metrics' },
        ],
        series: [
          { dashboardLabel: 'JVM Metrics', panelId: 3, metricName: 'used' },
          { dashboardLabel: 'JVM Metrics', panelId: 3, metricName: 'committed' },
        ],
      } } as any,
      { testRunId: 'cur-42' } as any,
    );
    expect(spy.mock.calls[0]![3].selections).toEqual([
      { dashboardLabel: 'JVM Metrics', panelId: 3, metricNames: ['used', 'committed'] },
      { dashboardLabel: 'JVM Metrics', panelId: 7 },
      // No panels picked on the second dashboard — every panel on it is in scope.
      { dashboardLabel: 'Docker Metrics' },
    ]);
  });

  it('sends no selection at all when no dashboard is picked', async () => {
    const spy = jest.spyOn(dataFetcher, 'getBaselineRunComparison').mockResolvedValue(null);
    await renderer.renderComparisonsSection(
      { type: 'comparisons', order: 0, config: { baselineTestRunId: 'base-99', source: 'grafana' } } as any,
      { testRunId: 'cur-42' } as any,
    );
    expect(spy.mock.calls[0]![3].selections).toEqual([]);
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

describe('ComparisonsRenderer previous-run baseline', () => {
  // A template is generated from for months, so a pinned baseline id is stale the day after it
  // is chosen and every nightly report keeps comparing against the same ageing run.
  let renderer: ComparisonsRenderer;
  let dataFetcher: jest.Mocked<ReportDataFetcherService>;

  const sectionWith = (baselineTestRunId: unknown) =>
    ({ ...makeSection(), config: { baselineTestRunId } }) as never;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComparisonsRenderer,
        ReportUtilsService,
        {
          provide: ReportDataFetcherService,
          useValue: {
            getBaselineRunComparison: jest.fn().mockResolvedValue(null),
            getAggregatedScalars: jest.fn(),
            getPreviousTestRun: jest
              .fn()
              .mockResolvedValue({ testRunId: 'EA-acc-loadtest-00019' }),
          },
        },
      ],
    }).compile();
    renderer = module.get(ComparisonsRenderer);
    dataFetcher = module.get(ReportDataFetcherService);
  });

  it('resolves "previous" against the run being reported on', async () => {
    await renderer.renderComparisonsSection(sectionWith('previous'), makeTestRun());

    expect(dataFetcher.getPreviousTestRun).toHaveBeenCalled();
    expect(dataFetcher.getBaselineRunComparison).toHaveBeenCalledWith(
      expect.anything(),
      'EA-acc-loadtest-00019',
      expect.anything(),
      expect.anything(),
    );
  });

  it('leaves a pinned baseline exactly as configured', async () => {
    await renderer.renderComparisonsSection(sectionWith('EA-acc-loadtest-00001'), makeTestRun());

    expect(dataFetcher.getPreviousTestRun).not.toHaveBeenCalled();
    expect(dataFetcher.getBaselineRunComparison).toHaveBeenCalledWith(
      expect.anything(),
      'EA-acc-loadtest-00001',
      expect.anything(),
      expect.anything(),
    );
  });

  it('compares against nothing when the run is the first in its scope', async () => {
    // Rather than falling back to comparing a run against itself.
    dataFetcher.getPreviousTestRun.mockResolvedValue(null);

    const html = await renderer.renderComparisonsSection(sectionWith('previous'), makeTestRun());

    expect(dataFetcher.getBaselineRunComparison).not.toHaveBeenCalled();
    expect(html).toContain('first run for its system, environment and workload');
  });
  it('resolves "previous" for a config that still carries the old comparisonMode key', async () => {
    // Sections saved before the mode switch was removed keep the key; it must simply be ignored.
    await renderer.renderComparisonsSection(
      { ...makeSection(), config: { comparisonMode: 'control_group', baselineTestRunId: 'previous' } } as never,
      makeTestRun(),
    );

    expect(dataFetcher.getPreviousTestRun).toHaveBeenCalled();
    const [, baselineId] = dataFetcher.getBaselineRunComparison.mock.calls[0]!;
    expect(baselineId).toBe('EA-acc-loadtest-00019');
  });

  it('treats a non-string baseline as no baseline at all', async () => {
    // Template configs are free-form JSON; a number or null must not reach the query.
    const html = await renderer.renderComparisonsSection(sectionWith(null), makeTestRun());

    expect(dataFetcher.getPreviousTestRun).not.toHaveBeenCalled();
    expect(dataFetcher.getBaselineRunComparison).not.toHaveBeenCalled();
    expect(html).toContain('no baseline run is configured for this section');
  });
});
