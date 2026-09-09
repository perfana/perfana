import { Test, TestingModule } from '@nestjs/testing';
import { GraphsRenderer } from './graphs-renderer';
import { ReportUtilsService } from '../services/report-utils.service';
import {
  ReportDataFetcherService,
  MetricsTimeSeriesPanel,
  MetricsPanelSelector,
} from '../services/report-data-fetcher.service';
import { ReportSectionConfig, TestRun } from '@perfana/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSection = (
  overrides?: Partial<ReportSectionConfig>,
): ReportSectionConfig => ({
  type: 'graphs',
  order: 7,
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

const makePanel = (overrides?: Partial<MetricsTimeSeriesPanel>): MetricsTimeSeriesPanel => ({
  panelTitle: 'CPU Usage',
  dashboardLabel: 'System Metrics',
  metricName: 'cpu_usage_percent',
  unit: '%',
  dataPoints: [
    { time: new Date('2025-06-01T10:00:00Z'), value: 25.3 },
    { time: new Date('2025-06-01T10:01:00Z'), value: 42.1 },
    { time: new Date('2025-06-01T10:02:00Z'), value: 38.7 },
    { time: new Date('2025-06-01T10:03:00Z'), value: 55.2 },
    { time: new Date('2025-06-01T10:04:00Z'), value: 31.9 },
  ],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('GraphsRenderer', () => {
  let renderer: GraphsRenderer;
  let dataFetcher: jest.Mocked<ReportDataFetcherService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GraphsRenderer,
        ReportUtilsService,
        {
          provide: ReportDataFetcherService,
          useValue: {
            getMetricsTimeSeries: jest.fn().mockResolvedValue([makePanel()]),
            getDynatraceHostLabels: jest.fn().mockResolvedValue({}),
            getAvailableMetricsPanels: jest.fn().mockResolvedValue([
              { dashboardLabel: 'System Metrics', panelTitle: 'CPU Usage', metricName: 'cpu_usage_percent' },
            ] as MetricsPanelSelector[]),
            getAggregatedSeries: jest.fn().mockResolvedValue([]),
            getGraphPresetPanels: jest.fn().mockResolvedValue({ presets: [], foundIds: [] }),
          },
        },
      ],
    }).compile();

    renderer = module.get(GraphsRenderer);
    dataFetcher = module.get(ReportDataFetcherService);
  });

  describe('section header', () => {
    it('should render with default title', async () => {
      const html = await renderer.renderGraphsSection(makeSection(), makeTestRun());

      expect(html).toContain('Custom Graphs');
      expect(html).toContain('1 panel'); // natural case in source — the kicker CSS uppercases
    });

    it('should use custom title', async () => {
      const section = makeSection({ title: 'Infrastructure Metrics' });
      const html = await renderer.renderGraphsSection(section, makeTestRun());

      expect(html).toContain('Infrastructure Metrics');
    });

    it('should render comment when provided', async () => {
      const section = makeSection({ comment: 'Collected from Grafana' });
      const html = await renderer.renderGraphsSection(section, makeTestRun());

      expect(html).toContain('Collected from Grafana');
      expect(html).toContain('section-text');
    });

    it('should pluralize panel count', async () => {
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([makePanel(), makePanel({ panelTitle: 'Memory' })]);
      const html = await renderer.renderGraphsSection(makeSection(), makeTestRun());

      expect(html).toContain('2 panels');
    });
  });

  describe('SVG chart rendering', () => {
    it('should render SVG chart for panel', async () => {
      const html = await renderer.renderGraphsSection(makeSection(), makeTestRun());

      expect(html).toContain('<svg');
      expect(html).toContain('viewBox');
      expect(html).toContain('<path');
    });

    it('should show panel title and metric name', async () => {
      const html = await renderer.renderGraphsSection(makeSection(), makeTestRun());

      expect(html).toContain('System Metrics');
      expect(html).toContain('CPU Usage');
      expect(html).toContain('cpu_usage_percent');
    });

    it('should show unit and data point count', async () => {
      const html = await renderer.renderGraphsSection(makeSection(), makeTestRun());

      expect(html).toContain('(%)');
      expect(html).toContain('5 data points');
    });

    it('should render data point circles when <= 50 points', async () => {
      const html = await renderer.renderGraphsSection(makeSection(), makeTestRun());

      expect(html).toContain('<circle');
    });

    it('formats ms axis labels through formatValueWithUnit', async () => {
      // min 0, max 500 → yPadding 50, yMin 0, yMax 550 → grid values
      // 550/440/330/220/110/0, each labeled via formatValueWithUnit(v, 'ms')
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([
        makePanel({
          unit: 'ms',
          dataPoints: [
            { time: new Date('2025-06-01T10:00:00Z'), value: 0 },
            { time: new Date('2025-06-01T10:01:00Z'), value: 500 },
          ],
        }),
      ]);

      const html = await renderer.renderGraphsSection(makeSection(), makeTestRun());

      expect(html).toContain('550 ms');
      expect(html).toContain('110 ms');
      expect(html).toContain('0 ms');
      expect(html).not.toContain('550.00'); // no trailing-zero padding
    });

    it('keeps small second values readable on the axis (0.0044 s, not 0 s)', async () => {
      // min 0, max 0.02 → yMax 0.022 → grid step 0.0044; the small-value path
      // in formatValueWithUnit keeps up to 5 decimals instead of collapsing to 0
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([
        makePanel({
          unit: 's',
          dataPoints: [
            { time: new Date('2025-06-01T10:00:00Z'), value: 0 },
            { time: new Date('2025-06-01T10:01:00Z'), value: 0.02 },
          ],
        }),
      ]);

      const html = await renderer.renderGraphsSection(makeSection(), makeTestRun());

      expect(html).toContain('0.0044 s');
      expect(html).toContain('0.0088 s');
    });

    it('should skip data point circles when > 50 points', async () => {
      const manyPoints = Array.from({ length: 60 }, (_, i) => ({
        time: new Date(`2025-06-01T10:${String(i).padStart(2, '0')}:00Z`),
        value: Math.random() * 100,
      }));
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([makePanel({ dataPoints: manyPoints })]);

      const html = await renderer.renderGraphsSection(makeSection(), makeTestRun());

      expect(html).not.toContain('<circle');
    });
  });

  describe('panel selection', () => {
    it('should use explicit panels from config', async () => {
      const section = makeSection({
        config: {
          panels: [
            { dashboardLabel: 'DB', panelTitle: 'Queries', metricName: 'query_count' },
          ],
        },
      });

      await renderer.renderGraphsSection(section, makeTestRun(), 'user-1', ['user']);

      expect(dataFetcher.getMetricsTimeSeries).toHaveBeenCalledWith(
        'run-001',
        [{ dashboardLabel: 'DB', panelTitle: 'Queries', metricName: 'query_count' }],
        false,
        'user-1',
        ['user'],
      );
      expect(dataFetcher.getAvailableMetricsPanels).not.toHaveBeenCalled();
    });

    it('should auto-discover panels when none configured', async () => {
      await renderer.renderGraphsSection(makeSection(), makeTestRun(), 'user-1', ['user']);

      expect(dataFetcher.getAvailableMetricsPanels).toHaveBeenCalledWith('run-001', 'user-1', ['user']);
    });

    it('always charts the whole run, so the analysis window has something to shade', async () => {
      await renderer.renderGraphsSection(makeSection({ config: { excludeRampUp: true } }), makeTestRun());

      expect(dataFetcher.getMetricsTimeSeries).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        false,
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('All aggregated', () => {
    it('appends aggregated panels when includeAggregated is set, even with no ds_metrics panels', async () => {
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([]);
      dataFetcher.getAvailableMetricsPanels.mockResolvedValue([]);
      (dataFetcher.getAggregatedSeries as jest.Mock).mockResolvedValue([
        { time: new Date('2025-06-01T10:00:00Z'), value: 120 },
        { time: new Date('2025-06-01T10:01:00Z'), value: 130 },
      ]);

      const html = await renderer.renderGraphsSection(
        makeSection({ config: { includeAggregated: true } }), makeTestRun(),
      );

      expect(html).toContain('All aggregated');
      expect(html).toContain('Transaction response time');
      expect(dataFetcher.getAggregatedSeries).toHaveBeenCalledWith(
        'run-001', 'transaction_response_time', 'avg', false, '', [],
      );
    });

    it('does not fetch aggregated series when the flag is off', async () => {
      await renderer.renderGraphsSection(makeSection(), makeTestRun());
      expect(dataFetcher.getAggregatedSeries).not.toHaveBeenCalled();
    });
  });

  describe('no data states', () => {
    it('should render fallback when testRun is null', async () => {
      const html = await renderer.renderGraphsSection(makeSection(), null);

      expect(html).toContain('No test run data available');
      expect(dataFetcher.getMetricsTimeSeries).not.toHaveBeenCalled();
    });

    it('should render fallback when no panels discovered', async () => {
      dataFetcher.getAvailableMetricsPanels.mockResolvedValue([]);
      const html = await renderer.renderGraphsSection(makeSection(), makeTestRun());

      expect(html).toContain('No metric panels configured or discovered');
    });

    it('should render fallback when time series returns empty', async () => {
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([]);
      const html = await renderer.renderGraphsSection(makeSection(), makeTestRun());

      expect(html).toContain('No metrics data found');
    });

    it('should render per-panel fallback when all values are null', async () => {
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([
        makePanel({
          dataPoints: [
            { time: new Date(), value: null },
            { time: new Date(), value: null },
          ],
        }),
      ]);
      const html = await renderer.renderGraphsSection(makeSection(), makeTestRun());

      expect(html).toContain('No data points available');
    });
  });

  describe('HTML escaping', () => {
    it('should escape HTML in title', async () => {
      const section = makeSection({ title: '<script>xss</script>' });
      const html = await renderer.renderGraphsSection(section, makeTestRun());

      expect(html).not.toContain('<script>xss</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should escape HTML in panel title', async () => {
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([
        makePanel({ panelTitle: '<img onerror=alert(1)>' }),
      ]);
      const html = await renderer.renderGraphsSection(makeSection(), makeTestRun());

      expect(html).not.toContain('<img onerror');
      expect(html).toContain('&lt;img onerror');
    });
  });

  describe('graph presets', () => {
    const PRESET_PANELS: MetricsPanelSelector[] = [
      { dashboardLabel: 'JVM', panelTitle: 'Heap', metricName: 'heap_used' },
    ];

    it('renders the series a selected preset names', async () => {
      dataFetcher.getGraphPresetPanels.mockResolvedValue({
        presets: [{ id: 'p1', name: 'JVM overview', panels: PRESET_PANELS }],
        foundIds: ['p1'],
      });
      const section = makeSection({ config: { graphPresetIds: ['p1'] } });

      const html = await renderer.renderGraphsSection(section, makeTestRun(), 'user-1', ['user']);

      expect(dataFetcher.getGraphPresetPanels).toHaveBeenCalledWith(['p1'], 'user-1', ['user']);
      expect(dataFetcher.getMetricsTimeSeries).toHaveBeenCalledWith(
        expect.anything(), PRESET_PANELS, expect.anything(), 'user-1', ['user'],
      );
      // The chart is titled by the preset, not by one of its panels
      expect(html).toContain('JVM overview');
      // Presets replace discovery, they do not merely seed it
      expect(dataFetcher.getAvailableMetricsPanels).not.toHaveBeenCalled();
    });

    it('computes a preset series that names the synthetic run-wide aggregate', async () => {
      // The bug this guards: the graphs card's "All aggregated" option has no
      // ds_metrics rows, so the report queried a metric name nobody ever wrote
      // and rendered an empty section for a preset that draws fine in the UI.
      dataFetcher.getGraphPresetPanels.mockResolvedValue({
        presets: [{
          id: 'p1',
          name: 'Run-wide RT',
          panels: [{
            dashboardLabel: 'Performance test metrics BrowseAndSearch',
            panelTitle: 'Transaction RT P95',
            metricName: 'All aggregated — Transaction RT P95',
            aggregate: { metric: 'transaction_response_time', stat: 'p95', unit: 'ms' },
          }],
        }],
        foundIds: ['p1'],
      });
      dataFetcher.getAggregatedSeries.mockResolvedValue([
        { time: new Date('2026-08-30T18:21:00Z'), value: 120 },
        { time: new Date('2026-08-30T18:22:00Z'), value: 140 },
      ]);
      const section = makeSection({ config: { graphPresetIds: ['p1'] } });

      const html = await renderer.renderGraphsSection(section, makeTestRun(), 'user-1', ['user']);

      expect(dataFetcher.getAggregatedSeries).toHaveBeenCalledWith(
        expect.anything(), 'transaction_response_time', 'p95', expect.anything(), 'user-1', ['user'],
      );
      // The aggregate is not a ds_metrics series, so it must not be queried as one
      expect(dataFetcher.getMetricsTimeSeries).not.toHaveBeenCalled();
      expect(html).toContain('Run-wide RT');
      expect(html).not.toContain('No metrics data found');
    });

    it('draws a preset that mixes a stored series with the aggregate on ONE chart', async () => {
      // The bug this guards: the aggregate has to be split out of the preset's panel
      // list before the ds_metrics query and joined back on afterwards. Sending it
      // along asks for a metric name nobody wrote; dropping it loses half the chart.
      dataFetcher.getGraphPresetPanels.mockResolvedValue({
        presets: [{
          id: 'p1',
          name: 'Heap vs run-wide RT',
          panels: [
            { dashboardLabel: 'JVM', panelTitle: 'Heap', metricName: 'heap_used' },
            {
              dashboardLabel: 'Performance test metrics BrowseAndSearch',
              panelTitle: 'Transaction RT Avg',
              metricName: 'All aggregated — Transaction RT Avg',
              aggregate: { metric: 'transaction_response_time', stat: 'avg', unit: 'ms' },
            },
          ],
        }],
        foundIds: ['p1'],
      });
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([
        makePanel({ panelTitle: 'Heap', metricName: 'heap_used' }),
      ]);
      dataFetcher.getAggregatedSeries.mockResolvedValue([
        { time: new Date('2025-06-01T10:00:00Z'), value: 120 },
        { time: new Date('2025-06-01T10:01:00Z'), value: 140 },
      ]);

      const html = await renderer.renderGraphsSection(
        makeSection({ config: { graphPresetIds: ['p1'] } }), makeTestRun(),
      );

      // Only the stored half is asked for as a ds_metrics series
      expect(dataFetcher.getMetricsTimeSeries).toHaveBeenCalledWith(
        expect.anything(),
        [{ dashboardLabel: 'JVM', panelTitle: 'Heap', metricName: 'heap_used' }],
        expect.anything(), expect.anything(), expect.anything(),
      );
      // ...and both halves end up on the same set of axes
      expect((html.match(/<svg /g) ?? []).length).toBe(1);
      expect((html.match(/<path d=/g) ?? []).length).toBe(2);
      expect(html).toContain('2 series');
      expect(html).toContain('heap_used');
      expect(html).toContain('All aggregated — Transaction RT Avg');
    });

    it('leaves a preset empty when its aggregate has nothing to compute from', async () => {
      // A run with no transactions returns an empty aggregate. That preset must be
      // reported as empty rather than drawn as a chart with no line — and it must
      // not take the presets that do have data down with it.
      dataFetcher.getGraphPresetPanels.mockResolvedValue({
        presets: [
          { id: 'p1', name: 'JVM overview', panels: PRESET_PANELS },
          {
            id: 'p2',
            name: 'Run-wide RT',
            panels: [{
              dashboardLabel: 'Performance test metrics BrowseAndSearch',
              panelTitle: 'Transaction RT P95',
              metricName: 'All aggregated — Transaction RT P95',
              aggregate: { metric: 'transaction_response_time', stat: 'p95', unit: 'ms' },
            }],
          },
        ],
        foundIds: ['p1', 'p2'],
      });
      dataFetcher.getAggregatedSeries.mockResolvedValue([]);

      const html = await renderer.renderGraphsSection(
        makeSection({ config: { graphPresetIds: ['p1', 'p2'] } }), makeTestRun(),
      );

      expect(html).toContain('No metrics data found for this preset in this test run.');
      expect(html).not.toContain('No data points available');
      // The preset that does have data still renders, and it is the only chart
      expect((html.match(/<svg /g) ?? []).length).toBe(1);
      expect(html).toContain('JVM overview');
    });

    it('keeps a preset that combines panels on ONE chart', async () => {
      // The bug this guards: a preset drawing from two panels used to be
      // flattened into two selectors and rendered as two separate charts.
      const twoPanels: MetricsPanelSelector[] = [
        { dashboardLabel: 'JVM', panelTitle: 'Heap', metricName: 'heap_used' },
        { dashboardLabel: 'Docker', panelTitle: 'CPU', metricName: 'cpu_usage' },
      ];
      dataFetcher.getGraphPresetPanels.mockResolvedValue({
        presets: [{ id: 'p1', name: 'Heap vs CPU', panels: twoPanels }],
        foundIds: ['p1'],
      });
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([
        makePanel({ panelTitle: 'Heap', metricName: 'heap_used' }),
        makePanel({ panelTitle: 'CPU', metricName: 'cpu_usage' }),
      ]);

      const html = await renderer.renderGraphsSection(
        makeSection({ config: { graphPresetIds: ['p1'] } }), makeTestRun(),
      );

      // One <svg>, two <path> lines, and a legend naming both series
      expect((html.match(/<svg /g) ?? []).length).toBe(1);
      expect((html.match(/<path d=/g) ?? []).length).toBe(2);
      expect(html).toContain('2 series');
      expect(html).toContain('heap_used');
      expect(html).toContain('cpu_usage');
    });

    it('gives a second unit its own axis', async () => {
      // ms and a bare count share no range: one scale flattens whichever is
      // smaller into the axis line.
      dataFetcher.getGraphPresetPanels.mockResolvedValue({
        presets: [{ id: 'p1', name: 'Latency vs threads', panels: PRESET_PANELS }],
        foundIds: ['p1'],
      });
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([
        makePanel({ panelTitle: 'Latency', metricName: 'p95', unit: 'ms' }),
        makePanel({ panelTitle: 'Threads', metricName: 'thread_count', unit: 'short' }),
      ]);

      const html = await renderer.renderGraphsSection(
        makeSection({ config: { graphPresetIds: ['p1'] } }), makeTestRun(),
      );

      // One plot area, one right-hand spine for the second unit
      expect((html.match(/<svg /g) ?? []).length).toBe(1);
      expect(html).toContain('text-anchor="start"'); // right-hand axis labels
      // Both units are named — on the axis and in the legend
      expect(html).toContain('ms');
      expect(html).toContain('short');
    });

    it('keeps one axis when every series shares a unit', async () => {
      dataFetcher.getGraphPresetPanels.mockResolvedValue({
        presets: [{ id: 'p1', name: 'Two latencies', panels: PRESET_PANELS }],
        foundIds: ['p1'],
      });
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([
        makePanel({ panelTitle: 'A', metricName: 'p95', unit: 'ms' }),
        makePanel({ panelTitle: 'B', metricName: 'p99', unit: 'ms' }),
      ]);

      const html = await renderer.renderGraphsSection(
        makeSection({ config: { graphPresetIds: ['p1'] } }), makeTestRun(),
      );

      // No right-hand axis: nothing to scale differently
      expect(html).not.toContain('text-anchor="start"');
    });

    it('gives each preset its own chart', async () => {
      dataFetcher.getGraphPresetPanels.mockResolvedValue({
        presets: [
          { id: 'p1', name: 'First preset', panels: PRESET_PANELS },
          { id: 'p2', name: 'Second preset', panels: PRESET_PANELS },
        ],
        foundIds: ['p1', 'p2'],
      });

      const html = await renderer.renderGraphsSection(
        makeSection({ config: { graphPresetIds: ['p1', 'p2'] } }), makeTestRun(),
      );

      expect((html.match(/<svg /g) ?? []).length).toBe(2);
      expect(html).toContain('First preset');
      expect(html).toContain('Second preset');
      expect(html).toContain('2 presets');
    });

    it('warns instead of auto-discovering when every selected preset is gone', async () => {
      dataFetcher.getGraphPresetPanels.mockResolvedValue({ presets: [], foundIds: [] });
      const section = makeSection({ config: { graphPresetIds: ['gone-1', 'gone-2'] } });

      const html = await renderer.renderGraphsSection(section, makeTestRun());

      expect(html).toContain('Section incomplete.');
      expect(html).toContain('2 graph presets');
      // The dangerous fallback: rendering every panel in the run instead
      expect(dataFetcher.getAvailableMetricsPanels).not.toHaveBeenCalled();
      expect(dataFetcher.getMetricsTimeSeries).not.toHaveBeenCalled();
    });

    it('still renders the presets that do exist', async () => {
      dataFetcher.getGraphPresetPanels.mockResolvedValue({
        presets: [{ id: 'p1', name: 'JVM overview', panels: PRESET_PANELS }],
        foundIds: ['p1'],
      });
      const section = makeSection({ config: { graphPresetIds: ['p1', 'gone'] } });

      const html = await renderer.renderGraphsSection(section, makeTestRun());

      expect(html).not.toContain('Section incomplete.');
      expect(dataFetcher.getMetricsTimeSeries).toHaveBeenCalled();
    });

    it('falls back to discovery when no preset is selected', async () => {
      await renderer.renderGraphsSection(makeSection(), makeTestRun());

      expect(dataFetcher.getGraphPresetPanels).not.toHaveBeenCalled();
      expect(dataFetcher.getAvailableMetricsPanels).toHaveBeenCalled();
    });
  });

  describe('analysis time range', () => {
    /** A run whose points span 10:00–10:09, one per minute. */
    const spanningPanel = () => makePanel({
      dataPoints: Array.from({ length: 10 }, (_, i) => ({
        time: new Date(Date.parse('2026-08-20T10:00:00Z') + i * 60_000),
        value: 100 + i,
      })),
    });
    const runWithClock = (overrides?: Partial<TestRun>) => makeTestRun({
      startTime: new Date('2026-08-20T10:00:00Z'),
      endTime: new Date('2026-08-20T10:09:00Z'),
      ...overrides,
    } as never);

    const pointCount = (html: string) => {
      const match = html.match(/([\d,]+) data points/);
      return match ? parseInt(match[1]!.replace(/,/g, ''), 10) : 0;
    };
    /** The amber dashed boundary lines the overlay draws. */
    const boundaries = (html: string) => (html.match(/stroke="#f59e0b"/g) ?? []).length;

    beforeEach(() => {
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([spanningPanel()]);
    });

    it('marks both ends from the run\'s own offsets, without dropping data', async () => {
      const html = await renderer.renderGraphsSection(
        makeSection(),
        runWithClock({ analysisStartOffset: 180, analysisEndOffset: 120 }),
      );

      expect(boundaries(html)).toBe(2);
      expect(html).toContain('opacity="0.18"');
      expect(pointCount(html)).toBe(10);
    });

    it('marks only the end that has an offset', async () => {
      const html = await renderer.renderGraphsSection(
        makeSection(), runWithClock({ analysisStartOffset: 180 }),
      );

      expect(boundaries(html)).toBe(1);
    });

    it('marks nothing when the run has no offsets', async () => {
      const html = await renderer.renderGraphsSection(makeSection(), runWithClock());

      expect(boundaries(html)).toBe(0);
      expect(pointCount(html)).toBe(10);
    });

    it('marks nothing when the run has no clock to anchor the offsets to', async () => {
      const html = await renderer.renderGraphsSection(
        makeSection(),
        makeTestRun({
          startTime: undefined, endTime: undefined,
          analysisStartOffset: 180, analysisEndOffset: 120,
        } as never),
      );

      expect(boundaries(html)).toBe(0);
    });
  });

  describe('legend toggle', () => {
    it('shows a legend for a single series when the toggle is on', async () => {
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([makePanel({ metricName: 'cpu_usage_percent' })]);

      const withLegend = await renderer.renderGraphsSection(makeSection(), makeTestRun());
      const without = await renderer.renderGraphsSection(
        makeSection({ config: { showLegends: false } }), makeTestRun(),
      );

      expect(withLegend).toContain('CPU Usage · cpu_usage_percent');
      expect(without).not.toContain('CPU Usage · cpu_usage_percent');
    });

    it('hides the legend when showLegends is off', async () => {
      dataFetcher.getGraphPresetPanels.mockResolvedValue({
        presets: [{ id: 'p1', name: 'Two series', panels: [
          { dashboardLabel: 'JVM', panelTitle: 'Heap', metricName: 'heap_used' },
        ] }],
        foundIds: ['p1'],
      });
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([
        makePanel({ panelTitle: 'A', metricName: 'p95', unit: 'ms' }),
        makePanel({ panelTitle: 'B', metricName: 'p99', unit: 'ms' }),
      ]);

      const withLegend = await renderer.renderGraphsSection(
        makeSection({ config: { graphPresetIds: ['p1'] } }), makeTestRun(),
      );
      const without = await renderer.renderGraphsSection(
        makeSection({ config: { graphPresetIds: ['p1'], showLegends: false } }), makeTestRun(),
      );

      expect(withLegend).toContain('p95');
      expect(without).not.toContain('· p95');
    });
  });

  describe('quality', () => {
    const viewBox = (html: string) => (html.match(/viewBox="0 0 (\d+) (\d+)"/) ?? []).slice(1).join('x');

    it('sizes the chart by the quality setting', async () => {
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([makePanel()]);

      expect(viewBox(await renderer.renderGraphsSection(
        makeSection({ config: { quality: 'low' } }), makeTestRun()))).toBe('700x240');
      expect(viewBox(await renderer.renderGraphsSection(
        makeSection({ config: { quality: 'high' } }), makeTestRun()))).toBe('1400x460');
      expect(viewBox(await renderer.renderGraphsSection(
        makeSection(), makeTestRun()))).toBe('1000x320');
    });

    it('lets an explicit size win over quality', async () => {
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([makePanel()]);

      const html = await renderer.renderGraphsSection(
        makeSection({ config: { quality: 'low', chartWidth: 1200, chartHeight: 400 } }), makeTestRun(),
      );

      expect(viewBox(html)).toBe('1200x400');
    });
  });

  describe('analysis time range only', () => {
    // A 5-minute run whose analysis window is 10:01-10:03. The 10:00 point (25.3)
    // and the 10:04 point (31.9) are outside it; 55.2 at 10:03 is the in-window max.
    const windowedRun = () =>
      makeTestRun({
        startTime: new Date('2025-06-01T10:00:00Z'),
        endTime: new Date('2025-06-01T10:04:00Z'),
        analysisStartOffset: 60,
        analysisEndOffset: 60,
      } as Partial<TestRun>);

    // The out-of-window points are the EXTREMES here, so if the axis is scaled on
    // the whole run its labels differ from the in-window scaling. 900 is a spike in
    // the ramp-up that the reader cannot even see once the view is narrowed.
    const spikyPanel = () =>
      makePanel({
        dataPoints: [
          { time: new Date('2025-06-01T10:00:00Z'), value: 900 },
          { time: new Date('2025-06-01T10:01:00Z'), value: 40 },
          { time: new Date('2025-06-01T10:02:00Z'), value: 50 },
          { time: new Date('2025-06-01T10:03:00Z'), value: 60 },
          { time: new Date('2025-06-01T10:04:00Z'), value: 800 },
        ],
      });

    /** The numeric labels on the left Y axis, biggest first. */
    const yAxisLabels = (html: string): number[] =>
      [...html.matchAll(/font-size="9" fill="#666">([^<]+)</g)]
        .map((m) => m[1]!)
        .filter((t) => !t.includes(':')) // drop the x-axis clock labels
        .map((t) => Number(t.replace(/[^0-9.-]/g, '')))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => b - a);

    it('scales the Y axis on the in-window data, not the whole run', async () => {
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([spikyPanel()]);
      const on = await renderer.renderGraphsSection(
        makeSection({ config: { analysisRangeOnly: true } } as any),
        windowedRun(),
      );
      const off = await renderer.renderGraphsSection(
        makeSection({ config: { analysisRangeOnly: false } } as any),
        windowedRun(),
      );

      // Whole-run scaling has to reach the 900 spike; in-window scaling tops out
      // just above the in-window max of 60.
      expect(yAxisLabels(off)[0]).toBeGreaterThan(800);
      expect(yAxisLabels(on)[0]).toBeLessThan(100);
      expect(yAxisLabels(on)[0]).toBeGreaterThanOrEqual(60);
    });

    it('clips the series so out-of-window points cannot draw over the axes', async () => {
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([spikyPanel()]);
      const html = await renderer.renderGraphsSection(
        makeSection({ config: { analysisRangeOnly: true } } as any),
        windowedRun(),
      );
      expect(html).toContain('<clipPath id="plot-clip-');
      expect(html).toMatch(/<g clip-path="url\(#plot-clip-/);
    });

    it('keeps both boundary lines on the chart, inside the margin', async () => {
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([spikyPanel()]);
      const html = await renderer.renderGraphsSection(
        makeSection({ config: { analysisRangeOnly: true } } as any),
        windowedRun(),
      );
      // Two amber dashed boundaries — the margin is what leaves room for them.
      const boundaries = html.match(/stroke="#f59e0b"/g) ?? [];
      expect(boundaries).toHaveLength(2);
    });

    it('falls back to the full run when the run carries no analysis offsets', async () => {
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([spikyPanel()]);
      const html = await renderer.renderGraphsSection(
        makeSection({ config: { analysisRangeOnly: true } } as any),
        makeTestRun(), // no offsets -> no window to zoom to
      );
      expect(yAxisLabels(html)[0]).toBeGreaterThan(800);
    });

    it('is off by default', async () => {
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([spikyPanel()]);
      const html = await renderer.renderGraphsSection(makeSection(), windowedRun());
      expect(yAxisLabels(html)[0]).toBeGreaterThan(800);
    });
  });
});
