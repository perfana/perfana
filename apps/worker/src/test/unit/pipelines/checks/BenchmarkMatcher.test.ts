import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BenchmarkMatcher, withColumnMatchPattern } from '../../../../pipelines/checks/BenchmarkMatcher.js';
import { BenchmarkNotFoundError } from '../../../../pipelines/checks/BaseCheckService.js';
import type { EntityManager } from 'typeorm';

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

describe('BenchmarkMatcher', () => {
  let matcher: BenchmarkMatcher;
  let mockManager: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock EntityManager
    mockManager = {
      query: vi.fn(),
    };

    matcher = new BenchmarkMatcher(mockLogger as any, mockManager as EntityManager);
  });

  describe('findMatchingBenchmarks', () => {
    it('should find matching benchmarks for test run', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      };

      const mockBenchmarks = [
        {
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
          evaluate_type: 'avg',
          metric_unit: 'percent',
          valid: true,
          enabled: true,
        },
        {
          id: 'benchmark-2',
          system_under_test_id: 'sut-1',
          test_environment: 'production',
          workload: 'load-test',
          dashboard_uid: 'dash-1',
          dashboard_label: 'metrics',
          application_dashboard_id: 'app-dash-1',
          configuration: { id: 2 },
          requirement_operator: 'lte',
          requirement_value: 500,
          validate_with_default_if_no_data: false,
          validate_with_default_if_no_data_value: null,
          average_all: true,
          exclude_ramp_up_time: false,
          panel_title: 'Response Time',
          evaluate_type: 'p95',
          metric_unit: 'ms',
          valid: true,
          enabled: true,
        },
      ];

      mockManager.query.mockResolvedValue(mockBenchmarks);

      // Act
      const result = await matcher.findMatchingBenchmarks(testRun);

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('benchmark-1');
      expect(result[1].id).toBe('benchmark-2');
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['sut-1', 'production', 'load-test']
      );
    });

    it('should filter benchmarks by application dashboard ID', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      };

      const metricFilter = {
        applicationDashboardId: 'app-dash-specific',
      };

      const mockBenchmarks = [
        {
          id: 'benchmark-1',
          system_under_test_id: 'sut-1',
          test_environment: 'production',
          workload: 'load-test',
          dashboard_uid: 'dash-1',
          dashboard_label: 'metrics',
          application_dashboard_id: 'app-dash-specific',
          configuration: { id: 1 },
          requirement_operator: 'gte',
          requirement_value: 100,
          validate_with_default_if_no_data: false,
          validate_with_default_if_no_data_value: null,
          average_all: false,
          exclude_ramp_up_time: true,
          panel_title: 'CPU Usage',
          evaluate_type: 'avg',
          metric_unit: 'percent',
          valid: true,
          enabled: true,
        },
      ];

      mockManager.query.mockResolvedValue(mockBenchmarks);

      // Act
      const result = await matcher.findMatchingBenchmarks(testRun, metricFilter);

      // Assert
      expect(result).toHaveLength(1);
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('application_dashboard_id = $4'),
        ['sut-1', 'production', 'load-test', 'app-dash-specific']
      );
    });

    it('should filter benchmarks by panel ID', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      };

      const metricFilter = {
        panelId: 42,
      };

      const mockBenchmarks = [
        {
          id: 'benchmark-1',
          system_under_test_id: 'sut-1',
          test_environment: 'production',
          workload: 'load-test',
          dashboard_uid: 'dash-1',
          dashboard_label: 'metrics',
          application_dashboard_id: 'app-dash-1',
          configuration: { id: 42 },
          requirement_operator: 'gte',
          requirement_value: 100,
          validate_with_default_if_no_data: false,
          validate_with_default_if_no_data_value: null,
          average_all: false,
          exclude_ramp_up_time: true,
          panel_title: 'CPU Usage',
          evaluate_type: 'avg',
          metric_unit: 'percent',
          valid: true,
          enabled: true,
        },
      ];

      mockManager.query.mockResolvedValue(mockBenchmarks);

      // Act
      const result = await matcher.findMatchingBenchmarks(testRun, metricFilter);

      // Assert
      expect(result).toHaveLength(1);
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining("(configuration->>'id')::int = $4"),
        ['sut-1', 'production', 'load-test', 42]
      );
    });

    it('should filter by both application dashboard ID and panel ID', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      };

      const metricFilter = {
        applicationDashboardId: 'app-dash-1',
        panelId: 42,
      };

      const mockBenchmarks = [];
      mockManager.query.mockResolvedValue(mockBenchmarks);

      // Act & Assert
      await expect(matcher.findMatchingBenchmarks(testRun, metricFilter)).rejects.toThrow(
        BenchmarkNotFoundError
      );
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('application_dashboard_id = $4'),
        ['sut-1', 'production', 'load-test', 'app-dash-1', 42]
      );
    });

    it('should throw BenchmarkNotFoundError when no benchmarks found', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      };

      mockManager.query.mockResolvedValue([]);

      // Act & Assert
      await expect(matcher.findMatchingBenchmarks(testRun)).rejects.toThrow(
        BenchmarkNotFoundError
      );
      await expect(matcher.findMatchingBenchmarks(testRun)).rejects.toThrow(
        'No benchmarks found for SUT=sut-1, testEnvironment=production, workload=load-test'
      );
    });

    it('should filter out invalid benchmarks', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      };

      const mockBenchmarks = [
        {
          id: 'benchmark-valid',
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
          evaluate_type: 'avg',
          metric_unit: 'percent',
          valid: true,
          enabled: true,
        },
        {
          id: 'benchmark-invalid',
          system_under_test_id: 'sut-1',
          test_environment: 'production',
          workload: 'load-test',
          dashboard_uid: 'dash-1',
          dashboard_label: 'metrics',
          application_dashboard_id: 'app-dash-1',
          configuration: { id: 2 },
          requirement_operator: null,
          requirement_value: null,
          validate_with_default_if_no_data: false,
          validate_with_default_if_no_data_value: null,
          average_all: false,
          exclude_ramp_up_time: true,
          panel_title: 'Invalid',
          evaluate_type: 'avg',
          metric_unit: 'percent',
          valid: true,
          enabled: true,
        },
        {
          id: 'benchmark-marked-invalid',
          system_under_test_id: 'sut-1',
          test_environment: 'production',
          workload: 'load-test',
          dashboard_uid: 'dash-1',
          dashboard_label: 'metrics',
          application_dashboard_id: 'app-dash-1',
          configuration: { id: 3 },
          requirement_operator: 'gte',
          requirement_value: 50,
          validate_with_default_if_no_data: false,
          validate_with_default_if_no_data_value: null,
          average_all: false,
          exclude_ramp_up_time: true,
          panel_title: 'Marked Invalid',
          evaluate_type: 'avg',
          metric_unit: 'percent',
          valid: false, // Explicitly marked invalid
          enabled: true,
        },
      ];

      mockManager.query.mockResolvedValue(mockBenchmarks);

      // Act
      const result = await matcher.findMatchingBenchmarks(testRun);

      // Assert
      expect(result).toHaveLength(1); // Only the valid benchmark
      expect(result[0].id).toBe('benchmark-valid');
    });

    it('should apply default values for boolean fields', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      };

      const mockBenchmarks = [
        {
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
          validate_with_default_if_no_data: null, // Should default to false
          validate_with_default_if_no_data_value: null,
          average_all: null, // Should default to false
          exclude_ramp_up_time: null, // Should default to true
          panel_title: 'CPU Usage',
          evaluate_type: 'avg',
          metric_unit: 'percent',
          valid: null, // Should default to true
          enabled: null, // Should default to true
        },
      ];

      mockManager.query.mockResolvedValue(mockBenchmarks);

      // Act
      const result = await matcher.findMatchingBenchmarks(testRun);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].validate_with_default_if_no_data).toBe(false);
      expect(result[0].average_all).toBe(false);
      expect(result[0].exclude_ramp_up_time).toBe(true);
      expect(result[0].valid).toBe(true);
      expect(result[0].enabled).toBe(true);
    });

    it('maps apdex_min_samples from the row and defaults it to 50 when the column is null', async () => {
      // Arrange — one row carries the column, one predates it (null); Postgres may hand back a string
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      };
      const base = {
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
        benchmark_type: 'apdex',
        min_apdex_score: '0.8',
        configuration: { type: 'apdex' },
        valid: true,
        enabled: true,
      };
      mockManager.query.mockResolvedValue([
        { ...base, id: 'apdex-explicit', apdex_min_samples: '25' },
        { ...base, id: 'apdex-legacy', apdex_min_samples: null },
      ]);

      // Act
      const result = await matcher.findMatchingBenchmarks(testRun);

      // Assert
      const sql = mockManager.query.mock.calls[0][0] as string;
      expect(sql).toContain('COALESCE(apdex_min_samples, 50) as apdex_min_samples');
      expect(result.find((b) => b.id === 'apdex-explicit')!.apdex_min_samples).toBe(25);
      expect(result.find((b) => b.id === 'apdex-legacy')!.apdex_min_samples).toBe(50);
    });

    it('should log metric filter information', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      };

      const metricFilter = {
        applicationDashboardId: 'app-dash-1',
        panelId: 42,
        metricName: 'cpu_usage',
      };

      const mockBenchmarks = [
        {
          id: 'benchmark-1',
          system_under_test_id: 'sut-1',
          test_environment: 'production',
          workload: 'load-test',
          dashboard_uid: 'dash-1',
          dashboard_label: 'metrics',
          application_dashboard_id: 'app-dash-1',
          configuration: { id: 42 },
          requirement_operator: 'gte',
          requirement_value: 100,
          validate_with_default_if_no_data: false,
          validate_with_default_if_no_data_value: null,
          average_all: false,
          exclude_ramp_up_time: true,
          panel_title: 'CPU Usage',
          evaluate_type: 'avg',
          metric_unit: 'percent',
          valid: true,
          enabled: true,
        },
      ];

      mockManager.query.mockResolvedValue(mockBenchmarks);

      // Act
      await matcher.findMatchingBenchmarks(testRun, metricFilter);

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('with metric filter: dashboard=app-dash-1, panel=42, metric=cpu_usage')
      );
    });
  });

  describe('findBenchmarkById', () => {
    it('should find benchmark by ID', async () => {
      // Arrange
      const benchmarkId = 'benchmark-123';
      const mockBenchmark = {
        id: benchmarkId,
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
        evaluate_type: 'avg',
        metric_unit: 'percent',
        valid: true,
        enabled: true,
      };

      mockManager.query.mockResolvedValue([mockBenchmark]);

      // Act
      const result = await matcher.findBenchmarkById(benchmarkId);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.id).toBe(benchmarkId);
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1'),
        [benchmarkId]
      );
    });

    it('should return null when benchmark not found', async () => {
      // Arrange
      const benchmarkId = 'non-existent';
      mockManager.query.mockResolvedValue([]);

      // Act
      const result = await matcher.findBenchmarkById(benchmarkId);

      // Assert
      expect(result).toBeNull();
    });

    it('should apply default values when finding by ID', async () => {
      // Arrange
      const benchmarkId = 'benchmark-123';
      const mockBenchmark = {
        id: benchmarkId,
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
        dashboard_uid: 'dash-1',
        dashboard_label: 'metrics',
        application_dashboard_id: 'app-dash-1',
        configuration: { id: 1 },
        requirement_operator: 'gte',
        requirement_value: 100,
        validate_with_default_if_no_data: null,
        validate_with_default_if_no_data_value: null,
        average_all: null,
        exclude_ramp_up_time: null,
        panel_title: 'CPU Usage',
        evaluate_type: 'avg',
        metric_unit: 'percent',
        valid: null,
        enabled: null,
      };

      mockManager.query.mockResolvedValue([mockBenchmark]);

      // Act
      const result = await matcher.findBenchmarkById(benchmarkId);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.exclude_ramp_up_time).toBe(true);
      expect(result!.valid).toBe(true);
      expect(result!.enabled).toBe(true);
    });
  });

  describe('findBenchmarkById — apdex_min_samples', () => {
    const apdexRow = (overrides: Record<string, unknown>) => ({
      id: 'apdex-1',
      system_under_test_id: 'sut-1',
      test_environment: 'production',
      workload: 'load-test',
      benchmark_type: 'apdex',
      min_apdex_score: '0.8',
      configuration: { type: 'apdex' },
      valid: true,
      enabled: true,
      ...overrides,
    });

    it('maps apdex_min_samples from the row', async () => {
      mockManager.query.mockResolvedValue([apdexRow({ apdex_min_samples: 10 })]);

      const result = await matcher.findBenchmarkById('apdex-1');

      const sql = mockManager.query.mock.calls[0][0] as string;
      expect(sql).toContain('COALESCE(apdex_min_samples, 50) as apdex_min_samples');
      expect(result!.apdex_min_samples).toBe(10);
    });

    it('defaults apdex_min_samples to 50 when the row has none', async () => {
      mockManager.query.mockResolvedValue([apdexRow({ apdex_min_samples: undefined })]);

      const result = await matcher.findBenchmarkById('apdex-1');

      expect(result!.apdex_min_samples).toBe(50);
    });
  });

  describe('Benchmark Validation (isBenchmarkValid)', () => {
    it('should validate benchmark with requirement configuration', () => {
      // Arrange
      const benchmark = {
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
        evaluate_type: 'avg',
        metric_unit: 'percent',
        valid: true,
        enabled: true,
      };

      // Act
      const result = (matcher as any).isBenchmarkValid(benchmark);

      // Assert
      expect(result).toBe(true);
    });

    it('should reject benchmark marked as invalid', () => {
      // Arrange
      const benchmark = {
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
        evaluate_type: 'avg',
        metric_unit: 'percent',
        valid: false, // Marked invalid
        enabled: true,
      };

      // Act
      const result = (matcher as any).isBenchmarkValid(benchmark);

      // Assert
      expect(result).toBe(false);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('marked as invalid')
      );
    });

    it('should reject benchmark without requirement configuration', () => {
      // Arrange
      const benchmark = {
        id: 'benchmark-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
        dashboard_uid: 'dash-1',
        dashboard_label: 'metrics',
        application_dashboard_id: 'app-dash-1',
        configuration: { id: 1 },
        requirement_operator: null, // No requirement
        requirement_value: null,
        validate_with_default_if_no_data: false,
        validate_with_default_if_no_data_value: null,
        average_all: false,
        exclude_ramp_up_time: true,
        panel_title: 'CPU Usage',
        evaluate_type: 'avg',
        metric_unit: 'percent',
        valid: true,
        enabled: true,
      };

      // Act
      const result = (matcher as any).isBenchmarkValid(benchmark);

      // Assert
      expect(result).toBe(false);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('missing requirement configuration')
      );
    });

    it('should validate benchmark with only requirement_value (no operator)', () => {
      // Arrange
      const benchmark = {
        id: 'benchmark-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
        dashboard_uid: 'dash-1',
        dashboard_label: 'metrics',
        application_dashboard_id: 'app-dash-1',
        configuration: { id: 1 },
        requirement_operator: null,
        requirement_value: 100, // Has value
        validate_with_default_if_no_data: false,
        validate_with_default_if_no_data_value: null,
        average_all: false,
        exclude_ramp_up_time: true,
        panel_title: 'CPU Usage',
        evaluate_type: 'avg',
        metric_unit: 'percent',
        valid: true,
        enabled: true,
      };

      // Act
      const result = (matcher as any).isBenchmarkValid(benchmark);

      // Assert
      expect(result).toBe(true);
    });

    it('should validate benchmark with only requirement_operator (no value)', () => {
      // Arrange
      const benchmark = {
        id: 'benchmark-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
        dashboard_uid: 'dash-1',
        dashboard_label: 'metrics',
        application_dashboard_id: 'app-dash-1',
        configuration: { id: 1 },
        requirement_operator: 'gte', // Has operator
        requirement_value: null,
        validate_with_default_if_no_data: false,
        validate_with_default_if_no_data_value: null,
        average_all: false,
        exclude_ramp_up_time: true,
        panel_title: 'CPU Usage',
        evaluate_type: 'avg',
        metric_unit: 'percent',
        valid: true,
        enabled: true,
      };

      // Act
      const result = (matcher as any).isBenchmarkValid(benchmark);

      // Assert
      expect(result).toBe(true);
    });

    it('should validate aggregated benchmark with aggregate_metric and requirement_value', () => {
      const benchmark = {
        id: 'agg-1',
        benchmark_type: 'aggregated',
        aggregate_metric: 'transaction_response_time',
        aggregate_stat: 'p95',
        requirement_operator: '<=',
        requirement_value: 2000,
        exclude_ramp_up_time: true,
      };
      const result = (matcher as any).isBenchmarkValid(benchmark);
      expect(result).toBe(true);
    });

    it('should reject aggregated benchmark missing aggregate_metric', () => {
      const benchmark = {
        id: 'agg-2',
        benchmark_type: 'aggregated',
        aggregate_metric: undefined,
        requirement_value: 2000,
      };
      const result = (matcher as any).isBenchmarkValid(benchmark);
      expect(result).toBe(false);
    });

    it('should reject aggregated benchmark missing requirement_value', () => {
      const benchmark = {
        id: 'agg-3',
        benchmark_type: 'aggregated',
        aggregate_metric: 'transaction_response_time',
        requirement_value: undefined,
      };
      const result = (matcher as any).isBenchmarkValid(benchmark);
      expect(result).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle database query errors', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      };

      mockManager.query.mockRejectedValue(new Error('Database connection error'));

      // Act & Assert
      await expect(matcher.findMatchingBenchmarks(testRun)).rejects.toThrow('Database connection error');
    });

    it('should handle malformed benchmark data', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      };

      const mockBenchmarks = [
        {
          // Incomplete benchmark data - missing requirement config
          id: 'benchmark-1',
          system_under_test_id: 'sut-1',
          test_environment: 'production',
          workload: 'load-test',
          dashboard_uid: 'dash-1',
          dashboard_label: 'metrics',
          application_dashboard_id: 'app-dash-1',
          configuration: { id: 1 },
          requirement_operator: null, // No requirement
          requirement_value: null,
          validate_with_default_if_no_data: false,
          validate_with_default_if_no_data_value: null,
          average_all: false,
          exclude_ramp_up_time: true,
          panel_title: 'Incomplete',
          evaluate_type: 'avg',
          metric_unit: 'percent',
          valid: true,
          enabled: true,
        },
      ];

      mockManager.query.mockResolvedValue(mockBenchmarks as any);

      // Act
      const result = await matcher.findMatchingBenchmarks(testRun);

      // Assert - Should be filtered out as invalid due to missing requirement
      expect(result).toHaveLength(0);
    });

    it('should handle empty string values in test run', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: '',
        test_environment: '',
        workload: '',
      };

      mockManager.query.mockResolvedValue([]);

      // Act & Assert
      await expect(matcher.findMatchingBenchmarks(testRun)).rejects.toThrow(BenchmarkNotFoundError);
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.any(String),
        ['', '', '']
      );
    });
  });
});

// ─── column → configuration fold ───────────────────────────────────────────────
describe('withColumnMatchPattern', () => {
  it('folds a column-only pattern (profile-stamped benchmark) into configuration', () => {
    expect(withColumnMatchPattern({ configuration: { id: 1 }, match_pattern: 'heap.*' }))
      .toEqual({ id: 1, matchPattern: 'heap.*' });
  });

  it('leaves configuration alone when it already has a pattern or the column is empty', () => {
    const cfg = { id: 1, matchPattern: '^cpu' };
    expect(withColumnMatchPattern({ configuration: cfg, match_pattern: 'heap.*' })).toBe(cfg);
    expect(withColumnMatchPattern({ configuration: cfg, match_pattern: null })).toBe(cfg);
    expect(withColumnMatchPattern({ configuration: { id: 1 }, match_pattern: '' })).toEqual({ id: 1 });
  });
});
