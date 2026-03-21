import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataAggregator } from '../../../../pipelines/checks/DataAggregator.js';
import { DataAggregationError } from '../../../../pipelines/checks/BaseCheckService.js';
import type { EntityManager } from 'typeorm';
import type { TestRun, Benchmark } from '../../../../pipelines/checks/BenchmarkMatcher.js';

// Mock logger
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock('../../../../lib/utils/logger.js', () => ({
  getLogger: vi.fn(() => mockLogger),
}));

describe('DataAggregator', () => {
  let aggregator: DataAggregator;
  let mockManager: any;

  const createMockTestRun = (overrides?: Partial<TestRun>): TestRun => ({
    test_run_id: 'test-run-1',
    system_under_test_id: 'sut-1',
    test_environment: 'production',
    workload: 'load-test',
    start_time: new Date('2024-01-01T12:00:00Z'),
    end_time: new Date('2024-01-01T13:00:00Z'),
    ramp_up: 60,
    ...overrides,
  });

  const createMockBenchmark = (overrides?: Partial<Benchmark>): Benchmark => ({
    id: 'benchmark-1',
    system_under_test_id: 'sut-1',
    test_environment: 'production',
    workload: 'load-test',
    dashboard_uid: 'dash-1',
    dashboard_label: 'metrics',
    application_dashboard_id: 'app-dash-1',
    configuration: { id: 1 },
    requirement_operator: 'gte',
    requirement_value: 100,
    validate_with_default_if_no_data: false,
    validate_with_default_if_no_data_value: null,
    average_all: false,
    exclude_ramp_up_time: true,
    panel_title: 'CPU Usage',
    evaluate_type: 'mean',
    metric_unit: 'percent',
    valid: true,
    enabled: true,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock EntityManager
    mockManager = {
      query: vi.fn(),
    };

    aggregator = new DataAggregator(mockLogger as any, mockManager as EntityManager);
  });

  describe('aggregateMetricsForBenchmark', () => {
    it('should aggregate metrics using mean evaluation type', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark({ evaluate_type: 'mean' });

      const mockMetricStats = [
        {
          metric_name: 'cpu_usage',
          mean: 75.5,
          median: 74.0,
          min_value: 50.0,
          max_value: 95.0,
          std_dev: 10.2,
          q10: 60.0,
          q25: 68.0,
          q75: 82.0,
          q90: 88.0,
          q95: 91.0,
          q99: 94.0,
          last_value: 76.0,
          count: 100,
          is_constant: false,
          all_missing: false,
          pct_missing: 0.0,
        },
      ];

      mockManager.query.mockResolvedValue(mockMetricStats);

      // Act
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark);

      // Assert
      expect(result.panel_average).toBe(75.5);
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0]).toMatchObject({
        target: 'cpu_usage',
        value: 75.5,
        isArtificial: false,
      });
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM ds_metric_statistics'),
        ['test-run-1', 'app-dash-1', 1]
      );
    });

    it('should aggregate metrics using p95 evaluation type', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark({ evaluate_type: 'q95' });

      const mockMetricStats = [
        {
          metric_name: 'response_time',
          mean: 250.0,
          median: 240.0,
          min_value: 100.0,
          max_value: 500.0,
          std_dev: 50.0,
          q10: 180.0,
          q25: 210.0,
          q75: 280.0,
          q90: 320.0,
          q95: 400.0,
          q99: 480.0,
          last_value: 260.0,
          count: 200,
          is_constant: false,
          all_missing: false,
          pct_missing: 0.0,
        },
      ];

      mockManager.query.mockResolvedValue(mockMetricStats);

      // Act
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark);

      // Assert
      expect(result.panel_average).toBe(400.0);
      expect(result.targets[0].value).toBe(400.0);
    });

    it('should average all metrics when average_all is true', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark({ average_all: true });

      const mockMetricStats = [
        {
          metric_name: 'cpu_usage_host1',
          mean: 70.0,
          median: 70.0,
          min_value: 50.0,
          max_value: 90.0,
          std_dev: 10.0,
          q10: 60.0,
          q25: 65.0,
          q75: 75.0,
          q90: 80.0,
          q95: 85.0,
          q99: 88.0,
          last_value: 71.0,
          count: 100,
          is_constant: false,
          all_missing: false,
          pct_missing: 0.0,
        },
        {
          metric_name: 'cpu_usage_host2',
          mean: 80.0,
          median: 80.0,
          min_value: 60.0,
          max_value: 95.0,
          std_dev: 8.0,
          q10: 70.0,
          q25: 75.0,
          q75: 85.0,
          q90: 88.0,
          q95: 90.0,
          q99: 93.0,
          last_value: 82.0,
          count: 100,
          is_constant: false,
          all_missing: false,
          pct_missing: 0.0,
        },
      ];

      mockManager.query.mockResolvedValue(mockMetricStats);

      // Act
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark);

      // Assert
      expect(result.panel_average).toBe(75.0); // Average of 70 and 80
      expect(result.targets).toHaveLength(2);
    });

    it('should use first value when average_all is false', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark({ average_all: false });

      const mockMetricStats = [
        {
          metric_name: 'metric1',
          mean: 100.0,
          median: 100.0,
          min_value: 80.0,
          max_value: 120.0,
          std_dev: 10.0,
          q10: 85.0,
          q25: 90.0,
          q75: 110.0,
          q90: 115.0,
          q95: 118.0,
          q99: 119.0,
          last_value: 101.0,
          count: 50,
          is_constant: false,
          all_missing: false,
          pct_missing: 0.0,
        },
        {
          metric_name: 'metric2',
          mean: 200.0,
          median: 200.0,
          min_value: 180.0,
          max_value: 220.0,
          std_dev: 12.0,
          q10: 185.0,
          q25: 190.0,
          q75: 210.0,
          q90: 215.0,
          q95: 218.0,
          q99: 219.0,
          last_value: 202.0,
          count: 50,
          is_constant: false,
          all_missing: false,
          pct_missing: 0.0,
        },
      ];

      mockManager.query.mockResolvedValue(mockMetricStats);

      // Act
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark);

      // Assert
      expect(result.panel_average).toBe(100.0); // First value
      expect(result.targets).toHaveLength(2);
    });

    it('should handle metric name filter', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark();
      const metricNameFilter = 'cpu_usage_specific';

      const mockMetricStats = [
        {
          metric_name: 'cpu_usage_specific',
          mean: 65.0,
          median: 65.0,
          min_value: 50.0,
          max_value: 80.0,
          std_dev: 8.0,
          q10: 55.0,
          q25: 60.0,
          q75: 70.0,
          q90: 75.0,
          q95: 78.0,
          q99: 79.0,
          last_value: 66.0,
          count: 80,
          is_constant: false,
          all_missing: false,
          pct_missing: 0.0,
        },
      ];

      mockManager.query.mockResolvedValue(mockMetricStats);

      // Act
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark, metricNameFilter);

      // Assert
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].target).toBe('cpu_usage_specific');
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('metric_name = $4'),
        ['test-run-1', 'app-dash-1', 1, 'cpu_usage_specific']
      );
    });

    it('should return null when no metrics found and validate_with_default_if_no_data is false', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark({ validate_with_default_if_no_data: false });

      mockManager.query.mockResolvedValue([]);

      // Act
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark);

      // Assert
      expect(result.panel_average).toBeNull();
      expect(result.targets).toHaveLength(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No metrics data found')
      );
    });

    it('should create artificial metric when validate_with_default_if_no_data is true', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark({
        validate_with_default_if_no_data: true,
        validate_with_default_if_no_data_value: 50.0,
      });

      mockManager.query.mockResolvedValue([]);

      // Act
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark);

      // Assert
      expect(result.panel_average).toBe(50.0);
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0]).toMatchObject({
        target: 'default',
        value: 50.0,
        isArtificial: true,
      });
      expect(mockManager.query).toHaveBeenCalledTimes(2); // 1 for select, 1 for insert
      expect(mockManager.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO ds_metric_statistics'),
        expect.arrayContaining(['test-run-1', 'app-dash-1', 'dash-1', 1, 'CPU Usage', 'metrics', 'default', 50.0])
      );
    });

    it('should use default value of 0 when no default value specified', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark({
        validate_with_default_if_no_data: true,
        validate_with_default_if_no_data_value: null,
      });

      mockManager.query.mockResolvedValue([]);

      // Act
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark);

      // Assert
      expect(result.panel_average).toBe(0.0);
      expect(result.targets[0].value).toBe(0.0);
    });

    it('should detect and handle artificial metrics from constant statistics', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark();

      const mockMetricStats = [
        {
          metric_name: 'default',
          mean: 50.0,
          median: 50.0,
          min_value: 50.0,
          max_value: 50.0,
          std_dev: 0.0,
          q10: 50.0,
          q25: 50.0,
          q75: 50.0,
          q90: 50.0,
          q95: 50.0,
          q99: 50.0,
          last_value: 50.0,
          count: 1,
          is_constant: true, // Artificial metric
          all_missing: false,
          pct_missing: 0.0,
        },
      ];

      mockManager.query.mockResolvedValue(mockMetricStats);

      // Act
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark);

      // Assert
      expect(result.panel_average).toBe(50.0);
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].isArtificial).toBe(true);
    });

    it('should throw error when benchmark has no panel ID', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark({ configuration: null });

      // Act & Assert
      await expect(aggregator.aggregateMetricsForBenchmark(testRun, benchmark)).rejects.toThrow(
        DataAggregationError
      );
      await expect(aggregator.aggregateMetricsForBenchmark(testRun, benchmark)).rejects.toThrow(
        'No panel ID found in benchmark'
      );
    });

    it('should throw error on database query failure', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark();

      mockManager.query.mockRejectedValue(new Error('Database connection error'));

      // Act & Assert
      await expect(aggregator.aggregateMetricsForBenchmark(testRun, benchmark)).rejects.toThrow(
        DataAggregationError
      );
      await expect(aggregator.aggregateMetricsForBenchmark(testRun, benchmark)).rejects.toThrow(
        'Failed to aggregate metrics'
      );
    });

    it('should return empty result when no valid metric values', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark();

      const mockMetricStats = [
        {
          metric_name: null, // Invalid metric name
          mean: 75.0,
          median: 74.0,
          min_value: 50.0,
          max_value: 95.0,
          std_dev: 10.0,
          q10: 60.0,
          q25: 68.0,
          q75: 82.0,
          q90: 88.0,
          q95: 91.0,
          q99: 94.0,
          last_value: 76.0,
          count: 100,
          is_constant: false,
          all_missing: false,
          pct_missing: 0.0,
        },
      ];

      mockManager.query.mockResolvedValue(mockMetricStats);

      // Act
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark);

      // Assert
      expect(result.panel_average).toBeNull();
      expect(result.targets).toHaveLength(0);
    });
  });

  describe('Field Mapping and Value Extraction', () => {
    it('should correctly map aggregation types to field names', () => {
      // Arrange
      const mappings = [
        { type: 'mean', expected: 'mean' },
        { type: 'median', expected: 'median' },
        { type: 'min', expected: 'min_value' },
        { type: 'max', expected: 'max_value' },
        { type: 'q90', expected: 'q90' },
        { type: 'q95', expected: 'q95' },
        { type: 'q99', expected: 'q99' },
        { type: 'last', expected: 'last_value' },
        { type: 'std', expected: 'std_dev' },
      ];

      // Act & Assert
      for (const { type, expected } of mappings) {
        const result = (aggregator as any).mapAggregationTypeToField(type);
        expect(result).toBe(expected);
      }
    });

    it('should default to mean for unknown aggregation type', () => {
      // Act
      const result = (aggregator as any).mapAggregationTypeToField('unknown_type');

      // Assert
      expect(result).toBe('mean');
    });

    it('should handle case-insensitive aggregation types', () => {
      // Act
      const result1 = (aggregator as any).mapAggregationTypeToField('MEAN');
      const result2 = (aggregator as any).mapAggregationTypeToField('Q95');

      // Assert
      expect(result1).toBe('mean');
      expect(result2).toBe('q95');
    });

    it('should extract correct field values from metric statistics', () => {
      // Arrange
      const mockStat = {
        metric_name: 'test_metric',
        mean: 100.0,
        median: 95.0,
        min_value: 50.0,
        max_value: 150.0,
        std_dev: 20.0,
        q10: 60.0,
        q25: 75.0,
        q75: 125.0,
        q90: 140.0,
        q95: 145.0,
        q99: 148.0,
        last_value: 102.0,
        count: 200,
        is_constant: false,
        all_missing: false,
        pct_missing: 0.0,
      };

      // Act & Assert
      expect((aggregator as any).getFieldValue(mockStat, 'mean')).toBe(100.0);
      expect((aggregator as any).getFieldValue(mockStat, 'median')).toBe(95.0);
      expect((aggregator as any).getFieldValue(mockStat, 'min_value')).toBe(50.0);
      expect((aggregator as any).getFieldValue(mockStat, 'max_value')).toBe(150.0);
      expect((aggregator as any).getFieldValue(mockStat, 'q95')).toBe(145.0);
      expect((aggregator as any).getFieldValue(mockStat, 'last_value')).toBe(102.0);
      expect((aggregator as any).getFieldValue(mockStat, 'std_dev')).toBe(20.0);
    });

    it('should default to mean for unknown field name', () => {
      // Arrange
      const mockStat = {
        metric_name: 'test_metric',
        mean: 100.0,
        median: 95.0,
        min_value: 50.0,
        max_value: 150.0,
        std_dev: 20.0,
        q10: 60.0,
        q25: 75.0,
        q75: 125.0,
        q90: 140.0,
        q95: 145.0,
        q99: 148.0,
        last_value: 102.0,
        count: 200,
        is_constant: false,
        all_missing: false,
        pct_missing: 0.0,
      };

      // Act
      const result = (aggregator as any).getFieldValue(mockStat, 'unknown_field');

      // Assert
      expect(result).toBe(100.0); // Defaults to mean
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty panel configuration object', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark({ configuration: {} as any });

      // Act & Assert
      await expect(aggregator.aggregateMetricsForBenchmark(testRun, benchmark)).rejects.toThrow(
        DataAggregationError
      );
    });

    it('should handle metrics with null values gracefully', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark();

      const mockMetricStats = [
        {
          metric_name: 'metric_with_null',
          mean: null, // Null value
          median: null,
          min_value: null,
          max_value: null,
          std_dev: null,
          q10: null,
          q25: null,
          q75: null,
          q90: null,
          q95: null,
          q99: null,
          last_value: null,
          count: 0,
          is_constant: false,
          all_missing: true,
          pct_missing: 100.0,
        },
      ];

      mockManager.query.mockResolvedValue(mockMetricStats);

      // Act
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark);

      // Assert
      expect(result.panel_average).toBeNull();
      expect(result.targets).toHaveLength(0);
    });

    it('should handle multiple metrics with mixed validity', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark({ average_all: true });

      const mockMetricStats = [
        {
          metric_name: 'valid_metric',
          mean: 100.0,
          median: 100.0,
          min_value: 80.0,
          max_value: 120.0,
          std_dev: 10.0,
          q10: 85.0,
          q25: 90.0,
          q75: 110.0,
          q90: 115.0,
          q95: 118.0,
          q99: 119.0,
          last_value: 101.0,
          count: 50,
          is_constant: false,
          all_missing: false,
          pct_missing: 0.0,
        },
        {
          metric_name: null, // Invalid - null name
          mean: 200.0,
          median: 200.0,
          min_value: 180.0,
          max_value: 220.0,
          std_dev: 12.0,
          q10: 185.0,
          q25: 190.0,
          q75: 210.0,
          q90: 215.0,
          q95: 218.0,
          q99: 219.0,
          last_value: 202.0,
          count: 50,
          is_constant: false,
          all_missing: false,
          pct_missing: 0.0,
        },
      ];

      mockManager.query.mockResolvedValue(mockMetricStats);

      // Act
      const result = await aggregator.aggregateMetricsForBenchmark(testRun, benchmark);

      // Assert
      expect(result.targets).toHaveLength(1); // Only the valid metric
      expect(result.panel_average).toBe(100.0);
    });
  });
});
