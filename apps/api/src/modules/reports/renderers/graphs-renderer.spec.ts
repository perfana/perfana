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
      expect(html).toContain('1 PANEL');
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
      expect(html).toContain('section-comment');
    });

    it('should pluralize panel count', async () => {
      dataFetcher.getMetricsTimeSeries.mockResolvedValue([makePanel(), makePanel({ panelTitle: 'Memory' })]);
      const html = await renderer.renderGraphsSection(makeSection(), makeTestRun());

      expect(html).toContain('2 PANELS');
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
});
