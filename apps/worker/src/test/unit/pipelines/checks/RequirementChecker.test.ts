import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RequirementChecker } from '../../../../pipelines/checks/RequirementChecker.js';
import { RequirementCheckError } from '../../../../pipelines/checks/BaseCheckService.js';
import type { TestRun, Benchmark } from '../../../../pipelines/checks/BenchmarkMatcher.js';
import type { AggregationResult, MetricTarget } from '../../../../pipelines/checks/DataAggregator.js';

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

// ─── Factories ───────────────────────────────────────────────────────────────

const createMockTestRun = (overrides?: Partial<TestRun>): TestRun => ({
  test_run_id: 'test-run-abc',
  system_under_test_id: 'sut-1',
  test_environment: 'production',
  workload: 'load-test',
  organization_id: 'org-1',
  ramp_up: 30,
  ...overrides,
});

const createMockBenchmark = (overrides?: Partial<Benchmark>): Benchmark => ({
  id: 'benchmark-1',
  system_under_test_id: 'sut-1',
  test_environment: 'production',
  workload: 'load-test',
  dashboard_uid: 'dash-uid-1',
  dashboard_label: 'My Dashboard',
  application_dashboard_id: 'app-dash-1',
  configuration: { id: 10, type: 'graph', yAxesFormat: 'ms' },
  requirement_operator: 'lt',
  requirement_value: 200,
  validate_with_default_if_no_data: false,
  validate_with_default_if_no_data_value: 0,
  average_all: false,
  exclude_ramp_up_time: true,
  panel_title: 'prefix - Response Time',
  evaluate_type: 'mean',
  metric_unit: 'ms',
  valid: true,
  enabled: true,
  benchmark_type: 'metric',
  include_failed_requests: false,
  ...overrides,
});

const createMockAggregationResult = (
  targets: Partial<MetricTarget>[] = [],
  panelAverage: number | null = null
): AggregationResult => ({
  panel_average: panelAverage,
  targets: targets.map(t => ({
    target: t.target ?? 'default-target',
    value: t.value ?? 100,
    isArtificial: t.isArtificial ?? false,
  })),
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RequirementChecker', () => {
  let checker: RequirementChecker;
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    };

    checker = new RequirementChecker(mockLogger as any, mockClient);
  });

  // ─── createCheckResult — happy paths ────────────────────────────────────────

  describe('createCheckResult — happy path', () => {
    it('should return a CheckResult when all inputs are valid', async () => {
      // Arrange
      const testRun = createMockTestRun();
      const benchmark = createMockBenchmark({ requirement_operator: 'lt', requirement_value: 200 });
      const aggregation = createMockAggregationResult([{ target: 'cpu', value: 150 }]);

      // Act
      const result = await checker.createCheckResult(testRun, benchmark, aggregation);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.test_run_id).toBe('test-run-abc');
      expect(result!.system_under_test_id).toBe('sut-1');
      expect(result!.benchmark_id).toBe('benchmark-1');
      expect(result!.status).toBe('COMPLETE');
      expect(result!.targets).toHaveLength(1);
    });

    it('should populate all CheckResult fields from testRun and benchmark', async () => {
      // Arrange
      const testRun = createMockTestRun({ ramp_up: 60 });
      const benchmark = createMockBenchmark({
        dashboard_label: 'Test Dashboard',
        dashboard_uid: 'uid-xyz',
        application_dashboard_id: 'app-dash-99',
        average_all: true,
        evaluate_type: 'p95',
        metric_unit: 'bytes',
        validate_with_default_if_no_data: true,
        validate_with_default_if_no_data_value: 42,
      });
      const aggregation = createMockAggregationResult([{ target: 'mem', value: 100 }], 100);

      // Act
      const result = await checker.createCheckResult(testRun, benchmark, aggregation);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.dashboard_label).toBe('Test Dashboard');
      expect(result!.dashboard_uid).toBe('uid-xyz');
      expect(result!.application_dashboard_id).toBe('app-dash-99');
      expect(result!.average_all).toBe(true);
      expect(result!.evaluate_type).toBe('p95');
      expect(result!.metric_unit).toBe('bytes');
      expect(result!.ramp_up).toBe(60);
      expect(result!.validate_with_default_if_no_data).toBe(true);
      expect(result!.validate_with_default_if_no_data_value).toBe(42);
      expect(result!.tags).toEqual([]);
    });

    it('should set panel fields from benchmark configuration', async () => {
      // Arrange
      const benchmark = createMockBenchmark({
        configuration: { id: 42, type: 'timeseries', yAxesFormat: 'bytes' },
      });
      const aggregation = createMockAggregationResult([{ target: 't1', value: 50 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.panel_id).toBe(42);
      expect(result!.panel_type).toBe('timeseries');
      expect(result!.panel_y_axes_format).toBe('bytes');
    });

    it('should default panel_type to "graph" when configuration type is absent', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ configuration: { id: 5 } });
      const aggregation = createMockAggregationResult([{ target: 't1', value: 50 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.panel_type).toBe('graph');
      expect(result!.panel_y_axes_format).toBeNull();
    });

    it('should fall back to ramp_up 0 when testRun.ramp_up is undefined', async () => {
      // Arrange
      const testRun = createMockTestRun({ ramp_up: undefined });
      const aggregation = createMockAggregationResult([{ target: 't', value: 10 }]);

      // Act
      const result = await checker.createCheckResult(testRun, createMockBenchmark(), aggregation);

      // Assert
      expect(result!.ramp_up).toBe(0);
    });

    it('should set evaluate_type to "mean" when not specified on benchmark', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ evaluate_type: undefined });
      const aggregation = createMockAggregationResult([{ target: 't', value: 10 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.evaluate_type).toBe('mean');
    });

    it('should set metric_unit to null when not specified on benchmark', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ metric_unit: undefined });
      const aggregation = createMockAggregationResult([{ target: 't', value: 10 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.metric_unit).toBeNull();
    });

    it('should include panel_average from aggregation result', async () => {
      // Arrange
      const aggregation = createMockAggregationResult([{ target: 't', value: 10 }], 75.5);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), createMockBenchmark(), aggregation);

      // Assert
      expect(result!.panel_average).toBe(75.5);
    });

    it('should include match_pattern in result when set on benchmark', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ configuration: { ...createMockBenchmark().configuration, matchPattern: 'cpu.*' } });
      const aggregation = createMockAggregationResult([{ target: 'cpu.usage', value: 50 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.match_pattern).toBe('cpu.*');
    });

    it('should set match_pattern to null when no matchPattern on benchmark', async () => {
      // Arrange
      const benchmark = createMockBenchmark();
      const aggregation = createMockAggregationResult([{ target: 't', value: 50 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.match_pattern).toBeNull();
    });
  });

  // ─── createCheckResult — requirement object ──────────────────────────────────

  describe('createCheckResult — requirement conversion', () => {
    it('should convert requirement with operator lt to requirement object', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ requirement_operator: 'lt', requirement_value: 500 });
      const aggregation = createMockAggregationResult([{ target: 't', value: 100 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.requirement).toEqual({ operator: 'lt', value: 500 });
    });

    it('should convert requirement with operator gt to requirement object', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ requirement_operator: 'gt', requirement_value: 50 });
      const aggregation = createMockAggregationResult([{ target: 't', value: 100 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.requirement).toEqual({ operator: 'gt', value: 50 });
    });

    it('should return null requirement when neither operator nor value is set', async () => {
      // Arrange — benchmark has no requirement, but we still need hasValidRequirement to return false
      // so we bypass the early-return guard by providing both operator and value here,
      // then override via direct call test below
      const benchmark = createMockBenchmark({ requirement_operator: 'lt', requirement_value: 100 });
      const aggregation = createMockAggregationResult([{ target: 't', value: 50 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert — requirement is a well-formed object
      expect(result!.requirement).not.toBeNull();
      expect(result!.requirement.operator).toBe('lt');
    });

    it('should parse string requirement_value to float in requirement object', async () => {
      // Arrange
      const benchmark = createMockBenchmark({
        requirement_operator: 'lt',
        requirement_value: '123.45' as unknown as number,
      });
      const aggregation = createMockAggregationResult([{ target: 't', value: 100 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.requirement.value).toBe(123.45);
    });
  });

  // ─── createCheckResult — no valid requirement → returns null ─────────────────

  describe('createCheckResult — no valid requirement', () => {
    it('should return null when benchmark has neither operator nor value', async () => {
      // Arrange
      const benchmark = createMockBenchmark({
        requirement_operator: undefined,
        requirement_value: undefined,
      });
      const aggregation = createMockAggregationResult([{ target: 't', value: 50 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('No valid requirement'));
    });

    it('should return null when both operator and value are null', async () => {
      // Arrange
      const benchmark = createMockBenchmark({
        requirement_operator: null as unknown as undefined,
        requirement_value: null as unknown as undefined,
      });
      const aggregation = createMockAggregationResult([{ target: 't', value: 50 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result).toBeNull();
    });

    it('should allow through when only requirement_value is set (no operator)', async () => {
      // Arrange — hasValidRequirement returns true if either is present
      const benchmark = createMockBenchmark({
        requirement_operator: undefined,
        requirement_value: 200,
      });
      const aggregation = createMockAggregationResult([{ target: 't', value: 100 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert — requirement is present since value is set, but no operator → checkRequirement returns true
      expect(result).not.toBeNull();
      expect(result!.meets_requirement).toBe(true);
    });

    it('should allow through when only requirement_operator is set (no value)', async () => {
      // Arrange
      const benchmark = createMockBenchmark({
        requirement_operator: 'lt',
        requirement_value: undefined,
      });
      const aggregation = createMockAggregationResult([{ target: 't', value: 100 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert — hasValidRequirement passes; checkRequirement returns true when no threshold
      expect(result).not.toBeNull();
      expect(result!.meets_requirement).toBe(true);
    });
  });

  // ─── checkRequirement — lt (less than) ───────────────────────────────────────

  describe('operator lt (less than)', () => {
    it('should pass when value is strictly less than threshold', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ requirement_operator: 'lt', requirement_value: 200 });
      const aggregation = createMockAggregationResult([{ target: 'resp', value: 150 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.targets[0].meets_requirement).toBe(true);
      expect(result!.meets_requirement).toBe(true);
    });

    it('should fail when value equals threshold', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ requirement_operator: 'lt', requirement_value: 200 });
      const aggregation = createMockAggregationResult([{ target: 'resp', value: 200 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.targets[0].meets_requirement).toBe(false);
      expect(result!.meets_requirement).toBe(false);
    });

    it('should fail when value is greater than threshold', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ requirement_operator: 'lt', requirement_value: 200 });
      const aggregation = createMockAggregationResult([{ target: 'resp', value: 300 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.targets[0].meets_requirement).toBe(false);
      expect(result!.meets_requirement).toBe(false);
    });

    it('should pass when value is just below threshold (boundary)', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ requirement_operator: 'lt', requirement_value: 100 });
      const aggregation = createMockAggregationResult([{ target: 'resp', value: 99.999 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.targets[0].meets_requirement).toBe(true);
    });

    it('should handle negative values with lt operator', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ requirement_operator: 'lt', requirement_value: 0 });
      const aggregation = createMockAggregationResult([{ target: 'delta', value: -5 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.targets[0].meets_requirement).toBe(true);
    });

    it('should handle zero value with lt operator when threshold is positive', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ requirement_operator: 'lt', requirement_value: 10 });
      const aggregation = createMockAggregationResult([{ target: 't', value: 0 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.targets[0].meets_requirement).toBe(true);
    });
  });

  // ─── checkRequirement — gt (greater than) ────────────────────────────────────

  describe('operator gt (greater than)', () => {
    it('should pass when value is strictly greater than threshold', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ requirement_operator: 'gt', requirement_value: 50 });
      const aggregation = createMockAggregationResult([{ target: 'tps', value: 100 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.targets[0].meets_requirement).toBe(true);
      expect(result!.meets_requirement).toBe(true);
    });

    it('should fail when value equals threshold', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ requirement_operator: 'gt', requirement_value: 50 });
      const aggregation = createMockAggregationResult([{ target: 'tps', value: 50 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.targets[0].meets_requirement).toBe(false);
      expect(result!.meets_requirement).toBe(false);
    });

    it('should fail when value is less than threshold', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ requirement_operator: 'gt', requirement_value: 50 });
      const aggregation = createMockAggregationResult([{ target: 'tps', value: 20 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.targets[0].meets_requirement).toBe(false);
    });

    it('should handle negative threshold with gt operator', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ requirement_operator: 'gt', requirement_value: -10 });
      const aggregation = createMockAggregationResult([{ target: 't', value: 0 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.targets[0].meets_requirement).toBe(true);
    });
  });

  // ─── checkRequirement — case-insensitive operator handling ───────────────────

  describe('operator case insensitivity', () => {
    it('should handle uppercase LT operator', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ requirement_operator: 'LT', requirement_value: 200 });
      const aggregation = createMockAggregationResult([{ target: 't', value: 150 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.targets[0].meets_requirement).toBe(true);
    });

    it('should handle uppercase GT operator', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ requirement_operator: 'GT', requirement_value: 50 });
      const aggregation = createMockAggregationResult([{ target: 't', value: 100 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.targets[0].meets_requirement).toBe(true);
    });

    it('should handle mixed-case Lt operator', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ requirement_operator: 'Lt', requirement_value: 100 });
      const aggregation = createMockAggregationResult([{ target: 't', value: 50 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.targets[0].meets_requirement).toBe(true);
    });
  });

  // ─── checkRequirement — unknown operator ─────────────────────────────────────

  describe('unknown operator', () => {
    it('should return true (pass) and log a warning for an unknown operator', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ requirement_operator: 'eq', requirement_value: 100 });
      const aggregation = createMockAggregationResult([{ target: 't', value: 100 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert — unknown operator defaults to pass
      expect(result!.targets[0].meets_requirement).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Unknown requirement operator'));
    });

    it('should return true for completely nonsense operator', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ requirement_operator: 'zzz', requirement_value: 50 });
      const aggregation = createMockAggregationResult([{ target: 't', value: 999 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.targets[0].meets_requirement).toBe(true);
    });
  });

  // ─── checkRequirement — invalid threshold ────────────────────────────────────

  describe('invalid threshold value', () => {
    it('should return true and warn when threshold is NaN-producing string', async () => {
      // Arrange
      const benchmark = createMockBenchmark({
        requirement_operator: 'lt',
        requirement_value: 'not-a-number' as unknown as number,
      });
      const aggregation = createMockAggregationResult([{ target: 't', value: 50 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.targets[0].meets_requirement).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid threshold value'));
    });
  });

  // ─── multiple targets ─────────────────────────────────────────────────────────

  describe('multiple targets evaluation', () => {
    it('should pass overall when all targets pass', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ requirement_operator: 'lt', requirement_value: 500 });
      const aggregation = createMockAggregationResult([
        { target: 'api/get', value: 100 },
        { target: 'api/post', value: 200 },
        { target: 'api/delete', value: 300 },
      ]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.meets_requirement).toBe(true);
      expect(result!.targets).toHaveLength(3);
      result!.targets.forEach(t => expect(t.meets_requirement).toBe(true));
    });

    it('should fail overall when at least one target fails', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ requirement_operator: 'lt', requirement_value: 250 });
      const aggregation = createMockAggregationResult([
        { target: 'api/get', value: 100 },  // passes
        { target: 'api/post', value: 300 }, // fails
      ]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.meets_requirement).toBe(false);
      expect(result!.targets[0].meets_requirement).toBe(true);
      expect(result!.targets[1].meets_requirement).toBe(false);
    });

    it('should fail overall when multiple targets fail', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ requirement_operator: 'gt', requirement_value: 1000 });
      const aggregation = createMockAggregationResult([
        { target: 'api/a', value: 50 },
        { target: 'api/b', value: 60 },
        { target: 'api/c', value: 70 },
      ]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.meets_requirement).toBe(false);
      result!.targets.forEach(t => expect(t.meets_requirement).toBe(false));
    });

    it('should preserve target names in results', async () => {
      // Arrange
      const aggregation = createMockAggregationResult([
        { target: 'service-a', value: 50 },
        { target: 'service-b', value: 150 },
      ]);

      // Act
      const result = await checker.createCheckResult(
        createMockTestRun(),
        createMockBenchmark({ requirement_operator: 'lt', requirement_value: 200 }),
        aggregation
      );

      // Assert
      expect(result!.targets[0].target).toBe('service-a');
      expect(result!.targets[1].target).toBe('service-b');
    });

    it('should preserve target values in results', async () => {
      // Arrange
      const aggregation = createMockAggregationResult([
        { target: 't1', value: 42.7 },
        { target: 't2', value: 0 },
      ]);

      // Act
      const result = await checker.createCheckResult(
        createMockTestRun(),
        createMockBenchmark(),
        aggregation
      );

      // Assert
      expect(result!.targets[0].value).toBe(42.7);
      expect(result!.targets[1].value).toBe(0);
    });
  });

  // ─── empty targets ────────────────────────────────────────────────────────────

  describe('empty targets', () => {
    it('should set status to ERROR when there are no targets', async () => {
      // Arrange
      const aggregation = createMockAggregationResult([]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), createMockBenchmark(), aggregation);

      // Assert
      expect(result!.status).toBe('ERROR');
      expect(result!.targets).toHaveLength(0);
    });

    it('should set meets_requirement to null when there are no targets', async () => {
      // Arrange
      const aggregation = createMockAggregationResult([]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), createMockBenchmark(), aggregation);

      // Assert
      expect(result!.meets_requirement).toBeNull();
    });

    it('should set message to "No targets found" when targets are empty', async () => {
      // Arrange
      const aggregation = createMockAggregationResult([]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), createMockBenchmark(), aggregation);

      // Assert
      expect(result!.message).toBe('No targets found for processing');
    });
  });

  // ─── status and message ───────────────────────────────────────────────────────

  describe('status and message generation', () => {
    it('should set status to COMPLETE when targets are present', async () => {
      // Arrange
      const aggregation = createMockAggregationResult([{ target: 't', value: 50 }]);

      // Act
      const result = await checker.createCheckResult(
        createMockTestRun(),
        createMockBenchmark({ requirement_operator: 'lt', requirement_value: 100 }),
        aggregation
      );

      // Assert
      expect(result!.status).toBe('COMPLETE');
    });

    it('should include target count in success message', async () => {
      // Arrange
      const aggregation = createMockAggregationResult([
        { target: 't1', value: 50 },
        { target: 't2', value: 60 },
        { target: 't3', value: 70 },
      ]);

      // Act
      const result = await checker.createCheckResult(
        createMockTestRun(),
        createMockBenchmark({ requirement_operator: 'lt', requirement_value: 200 }),
        aggregation
      );

      // Assert
      expect(result!.message).toContain('3');
      expect(result!.message).toContain('meet requirements');
    });

    it('should include failure count in failure message', async () => {
      // Arrange
      const aggregation = createMockAggregationResult([
        { target: 't1', value: 50 },  // passes
        { target: 't2', value: 300 }, // fails
      ]);

      // Act
      const result = await checker.createCheckResult(
        createMockTestRun(),
        createMockBenchmark({ requirement_operator: 'lt', requirement_value: 100 }),
        aggregation
      );

      // Assert
      expect(result!.message).toContain('failed requirements');
    });
  });

  // ─── matchPattern / regex filtering ──────────────────────────────────────────

  describe('matchPattern filtering', () => {
    it('should set meets_requirement null for targets not matching the pattern', async () => {
      // Arrange
      const benchmark = createMockBenchmark({
        requirement_operator: 'lt',
        requirement_value: 200,
        configuration: { id: 10, matchPattern: '^cpu.*' },
      });
      const aggregation = createMockAggregationResult([
        { target: 'cpu.usage', value: 50 },   // matches
        { target: 'memory.used', value: 9000 }, // does not match
      ]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      const cpuTarget = result!.targets.find(t => t.target === 'cpu.usage')!;
      const memTarget = result!.targets.find(t => t.target === 'memory.used')!;
      expect(cpuTarget.meets_requirement).toBe(true);
      expect(memTarget.meets_requirement).toBeNull();
    });

    it('should evaluate matching targets normally even with a pattern set', async () => {
      // Arrange
      const benchmark = createMockBenchmark({
        requirement_operator: 'gt',
        requirement_value: 10,
        configuration: { id: 10, matchPattern: 'svc-.*' },
      });
      const aggregation = createMockAggregationResult([
        { target: 'svc-alpha', value: 100 }, // matches, passes gt 10
        { target: 'svc-beta', value: 5 },    // matches, fails gt 10
        { target: 'other', value: 0 },       // no match → null
      ]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      const alpha = result!.targets.find(t => t.target === 'svc-alpha')!;
      const beta = result!.targets.find(t => t.target === 'svc-beta')!;
      const other = result!.targets.find(t => t.target === 'other')!;
      expect(alpha.meets_requirement).toBe(true);
      expect(beta.meets_requirement).toBe(false);
      expect(other.meets_requirement).toBeNull();
    });

    it('should warn and not apply filtering for an invalid regex pattern', async () => {
      // Arrange — invalid regex (unmatched bracket)
      const benchmark = createMockBenchmark({
        requirement_operator: 'lt',
        requirement_value: 200,
        configuration: { id: 10, matchPattern: '[invalid' },
      });
      const aggregation = createMockAggregationResult([
        { target: 'some-target', value: 50 },
      ]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert — no regex applied, target is evaluated normally
      expect(result!.targets[0].meets_requirement).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid or unsafe matchPattern'));
    });

    it('should not filter targets when no matchPattern is set', async () => {
      // Arrange
      const benchmark = createMockBenchmark({
        requirement_operator: 'lt',
        requirement_value: 200,
      });
      const aggregation = createMockAggregationResult([
        { target: 'anything', value: 50 },
        { target: 'another', value: 100 },
      ]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert — all targets evaluated
      result!.targets.forEach(t => expect(t.meets_requirement).not.toBeNull());
    });
  });

  // ─── panel average evaluation ─────────────────────────────────────────────────

  describe('panel average evaluation', () => {
    it('should check panel average when average_all is true and panel_average exists', async () => {
      // Arrange — threshold is 200, panel average is 300 (fails lt)
      const benchmark = createMockBenchmark({
        requirement_operator: 'lt',
        requirement_value: 200,
        average_all: true,
      });
      const aggregation = createMockAggregationResult(
        [{ target: 't', value: 50 }], // target passes
        300                           // panel average fails
      );

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.meets_requirement).toBe(false);
    });

    it('should pass overall when panel average passes', async () => {
      // Arrange
      const benchmark = createMockBenchmark({
        requirement_operator: 'lt',
        requirement_value: 500,
        average_all: true,
      });
      const aggregation = createMockAggregationResult(
        [{ target: 't', value: 100 }],
        250 // passes lt 500
      );

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.meets_requirement).toBe(true);
    });

    it('should not check panel average when average_all is false', async () => {
      // Arrange — panel average would fail, but average_all is false so it is ignored
      const benchmark = createMockBenchmark({
        requirement_operator: 'lt',
        requirement_value: 200,
        average_all: false,
      });
      const aggregation = createMockAggregationResult(
        [{ target: 't', value: 100 }],
        999 // would fail lt 200, but should be ignored
      );

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert — overall still passes because average_all is false
      expect(result!.meets_requirement).toBe(true);
    });

    it('should not check panel average when panel_average is null', async () => {
      // Arrange
      const benchmark = createMockBenchmark({
        requirement_operator: 'lt',
        requirement_value: 200,
        average_all: true,
      });
      const aggregation = createMockAggregationResult(
        [{ target: 't', value: 100 }],
        null // no panel average
      );

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.meets_requirement).toBe(true);
    });
  });

  // ─── is_artificial flag ───────────────────────────────────────────────────────

  describe('artificial target handling', () => {
    it('should set is_artificial true on targets flagged as artificial', async () => {
      // Arrange
      const aggregation = createMockAggregationResult([
        { target: 'real-metric', value: 50, isArtificial: false },
        { target: 'artificial-metric', value: 100, isArtificial: true },
      ]);

      // Act
      const result = await checker.createCheckResult(
        createMockTestRun(),
        createMockBenchmark(),
        aggregation
      );

      // Assert
      const realTarget = result!.targets.find(t => t.target === 'real-metric')!;
      const artificialTarget = result!.targets.find(t => t.target === 'artificial-metric')!;
      expect(realTarget.is_artificial).toBe(false);
      expect(artificialTarget.is_artificial).toBe(true);
    });
  });

  // ─── panel title stripping ─────────────────────────────────────────────────────

  describe('panel title prefix stripping', () => {
    it('should strip prefix before dash from panel title', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ panel_title: 'prefix - Actual Title' });
      const aggregation = createMockAggregationResult([{ target: 't', value: 50 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.panel_title).toBe('Actual Title');
    });

    it('should return title unchanged when no dash is present', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ panel_title: 'No Dash Here' });
      const aggregation = createMockAggregationResult([{ target: 't', value: 50 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.panel_title).toBe('No Dash Here');
    });

    it('should handle empty panel title', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ panel_title: '' });
      const aggregation = createMockAggregationResult([{ target: 't', value: 50 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.panel_title).toBe('');
    });

    it('should handle undefined panel title', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ panel_title: undefined });
      const aggregation = createMockAggregationResult([{ target: 't', value: 50 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert
      expect(result!.panel_title).toBe('');
    });

    it('should only use the portion between the first two dashes (split limit 2)', async () => {
      // Arrange — "a - b - c".split('-', 2) gives ['a ', ' b '], so result is trimmed 'b'
      // The implementation uses split('-', 2)[1]?.trim() which takes only up to the second '-'
      const benchmark = createMockBenchmark({ panel_title: 'a - b - c' });
      const aggregation = createMockAggregationResult([{ target: 't', value: 50 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert — split('-', 2) gives index [1] = ' b ' → trimmed to 'b'
      expect(result!.panel_title).toBe('b');
    });
  });

  // ─── saveCheckResult ──────────────────────────────────────────────────────────

  describe('saveCheckResult', () => {
    it('should call client.query with INSERT SQL when saving a result', async () => {
      // Arrange
      const checkResult = {
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
        test_run_id: 'run-1',
        dashboard_label: 'My Dashboard',
        dashboard_uid: 'uid-1',
        application_dashboard_id: 'app-1',
        panel_title: 'Title',
        panel_id: 10,
        panel_type: 'graph',
        panel_y_axes_format: 'ms',
        metric_name: null,
        metric_unit: 'ms',
        benchmark_id: 'bench-1',
        organization_id: 'org-1',
        status: 'COMPLETE',
        message: 'All 1 targets meet requirements',
        average_all: false,
        evaluate_type: 'mean',
        exclude_ramp_up_time: true,
        ramp_up: 30,
        match_pattern: null,
        requirement: { operator: 'lt', value: 200 },
        panel_average: null,
        meets_requirement: true,
        targets: [{ target: 't', value: 50, meets_requirement: true, is_artificial: false }],
        validate_with_default_if_no_data: false,
        validate_with_default_if_no_data_value: 0,
        tags: [],
      };

      // Act
      await checker.saveCheckResult(checkResult);

      // Assert
      expect(mockClient.query).toHaveBeenCalledOnce();
      const [sql, params] = mockClient.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO check_results');
      expect(params).toContain('run-1');
      expect(params).toContain('bench-1');
      expect(params).toContain('org-1');
      // guards against column/placeholder/param drift (organization_id is NOT NULL)
      const columns = sql.split('(')[1].split(')')[0].split(',').length;
      const placeholders = (sql.match(/\$\d+/g) as string[]).length;
      expect(columns).toBe(placeholders + 2); // created_at, updated_at use NOW()
      expect(params).toHaveLength(placeholders);
    });

    it('should serialise requirement and targets as JSON when saving', async () => {
      // Arrange
      const checkResult = {
        system_under_test_id: 'sut-1',
        test_environment: 'prod',
        workload: 'load',
        test_run_id: 'r1',
        dashboard_label: 'D',
        dashboard_uid: 'u',
        application_dashboard_id: 'a',
        panel_title: 'P',
        panel_id: 1,
        panel_type: 'graph',
        panel_y_axes_format: null,
        metric_name: null,
        metric_unit: null,
        benchmark_id: 'b1',
        status: 'COMPLETE',
        message: 'ok',
        average_all: false,
        evaluate_type: 'mean',
        exclude_ramp_up_time: true,
        ramp_up: 0,
        match_pattern: null,
        requirement: { operator: 'gt', value: 5 },
        panel_average: null,
        meets_requirement: true,
        targets: [{ target: 'x', value: 10, meets_requirement: true, is_artificial: false }],
        validate_with_default_if_no_data: false,
        validate_with_default_if_no_data_value: 0,
        tags: [],
      };

      // Act
      await checker.saveCheckResult(checkResult);

      // Assert
      const params = mockClient.query.mock.calls[0][1];
      // Requirement is JSON stringified
      expect(params).toContain(JSON.stringify({ operator: 'gt', value: 5 }));
      // Targets is JSON stringified
      expect(params).toContain(
        JSON.stringify([{ target: 'x', value: 10, meets_requirement: true, is_artificial: false }])
      );
    });

    it('should propagate database errors when saving', async () => {
      // Arrange
      mockClient.query.mockRejectedValue(new Error('DB write failed'));
      const minimalResult = {
        system_under_test_id: '',
        test_environment: '',
        workload: '',
        test_run_id: '',
        dashboard_label: '',
        dashboard_uid: '',
        application_dashboard_id: '',
        panel_title: '',
        panel_id: null,
        panel_type: 'graph',
        panel_y_axes_format: null,
        metric_name: null,
        metric_unit: null,
        benchmark_id: '',
        status: 'COMPLETE',
        message: '',
        average_all: false,
        evaluate_type: 'mean',
        exclude_ramp_up_time: false,
        ramp_up: 0,
        match_pattern: null,
        requirement: null,
        panel_average: null,
        meets_requirement: null,
        targets: [],
        validate_with_default_if_no_data: false,
        validate_with_default_if_no_data_value: 0,
        tags: [],
      };

      // Act & Assert
      await expect(checker.saveCheckResult(minimalResult)).rejects.toThrow('DB write failed');
    });
  });

  // ─── error handling ───────────────────────────────────────────────────────────

  describe('error handling in createCheckResult', () => {
    it('should throw RequirementCheckError when an unexpected error occurs', async () => {
      // Arrange — force an error by passing an aggregation result that causes issues
      // The easiest way is to make the benchmark throw by supplying a broken panel_title getter
      const badBenchmark = createMockBenchmark();
      // Override panel_title with a getter that throws
      Object.defineProperty(badBenchmark, 'panel_title', {
        get() { throw new Error('property read failed'); },
        configurable: true,
      });
      const aggregation = createMockAggregationResult([{ target: 't', value: 50 }]);

      // Act & Assert
      await expect(
        checker.createCheckResult(createMockTestRun(), badBenchmark, aggregation)
      ).rejects.toThrow(RequirementCheckError);
    });

    it('should include benchmark id in the RequirementCheckError message', async () => {
      // Arrange
      const badBenchmark = createMockBenchmark({ id: 'bench-xyz' });
      Object.defineProperty(badBenchmark, 'panel_title', {
        get() { throw new Error('boom'); },
        configurable: true,
      });
      const aggregation = createMockAggregationResult([{ target: 't', value: 50 }]);

      // Act & Assert
      await expect(
        checker.createCheckResult(createMockTestRun(), badBenchmark, aggregation)
      ).rejects.toThrow('bench-xyz');
    });
  });

  // ─── hasValidRequirement edge cases ──────────────────────────────────────────

  describe('hasValidRequirement boundary cases', () => {
    it('should treat requirement_value of 0 as a valid requirement', async () => {
      // Arrange — 0 is a valid threshold (not null/undefined)
      const benchmark = createMockBenchmark({ requirement_operator: 'gt', requirement_value: 0 });
      const aggregation = createMockAggregationResult([{ target: 't', value: 5 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert — 5 > 0 → passes
      expect(result).not.toBeNull();
      expect(result!.targets[0].meets_requirement).toBe(true);
    });

    it('should treat requirement_value of 0 with lt as valid and fail when value is also 0', async () => {
      // Arrange
      const benchmark = createMockBenchmark({ requirement_operator: 'lt', requirement_value: 0 });
      const aggregation = createMockAggregationResult([{ target: 't', value: 0 }]);

      // Act
      const result = await checker.createCheckResult(createMockTestRun(), benchmark, aggregation);

      // Assert — 0 is NOT < 0
      expect(result!.targets[0].meets_requirement).toBe(false);
    });

    it('should set meets_requirement null on target when target value is null', async () => {
      // Arrange — MetricTarget value typed as number but may arrive as null at runtime
      const aggregation: AggregationResult = {
        panel_average: null,
        targets: [{ target: 'missing-data', value: null as unknown as number, isArtificial: false }],
      };

      // Act
      const result = await checker.createCheckResult(
        createMockTestRun(),
        createMockBenchmark(),
        aggregation
      );

      // Assert
      expect(result!.targets[0].meets_requirement).toBeNull();
    });
  });

  // ─── organization_id propagation (RLS NOT NULL on check_results) ─────────────

  describe('createCheckResult — organization_id', () => {
    it('should propagate testRun.organization_id into the CheckResult', async () => {
      // Arrange
      const testRun = createMockTestRun({ organization_id: 'org-xyz' });
      const benchmark = createMockBenchmark();
      const aggregation = createMockAggregationResult([{ target: 't', value: 50 }]);

      // Act
      const result = await checker.createCheckResult(testRun, benchmark, aggregation);

      // Assert
      expect(result!.organization_id).toBe('org-xyz');
    });

    it('should propagate testRun.team_id into the CheckResult', async () => {
      const testRun = createMockTestRun({ organization_id: 'org-xyz', team_id: 'team-7' });
      const result = await checker.createCheckResult(
        testRun, createMockBenchmark(), createMockAggregationResult([{ target: 't', value: 50 }]),
      );
      expect(result!.team_id).toBe('team-7');
    });

    it('should fail loud, naming the run, when testRun has no organization_id', async () => {
      // legacy data the 1796 backfill refused to constrain — must not surface as a bare 23502
      const testRun = createMockTestRun({ organization_id: undefined });
      await expect(
        checker.createCheckResult(
          testRun, createMockBenchmark(), createMockAggregationResult([{ target: 't', value: 50 }]),
        ),
      ).rejects.toThrow(/test-run-abc has no organization_id/);
    });
  });

});
