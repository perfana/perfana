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
        true,
        'user-1',
        ['user'],
      );
      expect(dataFetcher.getAvailableMetricsPanels).not.toHaveBeenCalled();
    });

    it('should auto-discover panels when none configured', async () => {
      await renderer.renderGraphsSection(makeSection(), makeTestRun(), 'user-1', ['user']);

      expect(dataFetcher.getAvailableMetricsPanels).toHaveBeenCalledWith('run-001', 'user-1', ['user']);
    });

    it('should pass excludeRampUp config', async () => {
      const section = makeSection({ config: { excludeRampUp: false } });
      await renderer.renderGraphsSection(section, makeTestRun());

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
        'run-001', 'transaction_response_time', 'avg', true, '', [],
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

      expect(html).toContain('No ds_metrics data found');
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

  describe('time range offsets', () => {
    /** A run whose points span 10:00–10:09, one per minute. */
    const spanningPanel = () => makePanel({
      dataPoints: Array.from({ length: 10 }, (_, i) => ({
        time: new Date(Date.parse('2026-08-20T10:00:00Z') + i * 60_000),
        value: 100 + i,
      })),
    });
    const runWithClock = () => makeTestRun({
      startTime: new Date('2026-08-20T10:00:00Z'),
      endTime: new Date('2026-08-20T10:09:00Z'),
    } as never);

    const pointCount = (html: string) => {
      const match = html.match(/([\d,]+) data points/);
      return match ? parseInt(match[1]!.replace(/,/g, ''), 10) : 0;
    };

    it('trims from the start of the run', async () => {
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([spanningPanel()]);

      const html = await renderer.renderGraphsSection(
        makeSection({ config: { timeRange: { startOffset: 3 } } }), runWithClock(),
      );

      // 10:03 onwards — the first three minutes are gone
      expect(pointCount(html)).toBe(7);
    });

    it('trims from the end of the run, the way the analysis time range does', async () => {
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([spanningPanel()]);

      const html = await renderer.renderGraphsSection(
        makeSection({ config: { timeRange: { endOffset: 4 } } }), runWithClock(),
      );

      // up to 10:05 — endOffset counts back from the run's end, not forward
      expect(pointCount(html)).toBe(6);
    });

    it('applies both ends at once', async () => {
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([spanningPanel()]);

      const html = await renderer.renderGraphsSection(
        makeSection({ config: { timeRange: { startOffset: 2, endOffset: 2 } } }), runWithClock(),
      );

      expect(pointCount(html)).toBe(6);
    });

    it('charts the whole run when no offset is set', async () => {
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([spanningPanel()]);

      const html = await renderer.renderGraphsSection(makeSection(), runWithClock());

      expect(pointCount(html)).toBe(10);
    });

    it('leaves the window open when the run has no clock to anchor it to', async () => {
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([spanningPanel()]);

      const html = await renderer.renderGraphsSection(
        makeSection({ config: { timeRange: { startOffset: 3 } } }),
        makeTestRun({ startTime: undefined, endTime: undefined } as never),
      );

      expect(pointCount(html)).toBe(10);
    });
  });

  describe('legend toggle', () => {
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
});
