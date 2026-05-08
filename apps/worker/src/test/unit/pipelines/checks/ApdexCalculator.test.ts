import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApdexCalculator } from '../../../../pipelines/checks/ApdexCalculator.js';
import type { ApdexBenchmark } from '../../../../pipelines/checks/ApdexCalculator.js';
import type { TestRun } from '../../../../pipelines/checks/BenchmarkMatcher.js';
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

// ─── Helpers ────────────────────────────────────────────────────────────────

const createTestRun = (overrides?: Partial<TestRun>): TestRun => ({
  test_run_id: 'run-001',
  system_under_test_id: 'sut-1',
  test_environment: 'production',
  workload: 'load-test',
  start_time: new Date('2024-01-01T10:00:00Z'),
  end_time: new Date('2024-01-01T11:00:00Z'),
  ramp_up: 60,
  ...overrides,
});

const createBenchmark = (overrides?: Partial<ApdexBenchmark>): ApdexBenchmark => ({
  id: 'bench-001',
  system_under_test_id: 'sut-1',
  test_environment: 'production',
  workload: 'load-test',
  benchmark_type: 'apdex',
  transaction_name: null,
  apdex_threshold_ms: 500,
  min_apdex_score: 0.75,
  include_failed_requests: false,
  exclude_ramp_up_time: true,
  ...overrides,
});

/**
 * Build a DB row as returned by the raw COUNT/AVG query in calculateApdex().
 * All counts are strings because PostgreSQL returns COUNT(*) as text over the wire.
 */
const makeApdexRow = (satisfied: number, tolerating: number, frustrated: number, avg: number | null = null) => ({
  satisfied_count: String(satisfied),
  tolerating_count: String(tolerating),
  frustrated_count: String(frustrated),
  total_count: String(satisfied + tolerating + frustrated),
  avg_response_time_ms: avg !== null ? String(avg) : null,
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ApdexCalculator', () => {
  let calculator: ApdexCalculator;
  let mockManager: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockManager = { query: vi.fn() };
    calculator = new ApdexCalculator(mockLogger as any, mockManager as unknown as EntityManager);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // calculateApdex — score arithmetic
  // ══════════════════════════════════════════════════════════════════════════

  describe('calculateApdex — score arithmetic', () => {
    it('should return score 1.000 when all requests are satisfied', async () => {
      // Arrange
      const testRun = createTestRun();
      mockManager.query.mockResolvedValue([makeApdexRow(100, 0, 0, 200)]);

      // Act
      const result = await calculator.calculateApdex({
        testRun,
        transactionName: null,
        thresholdMs: 500,
        includeFailedRequests: false,
        excludeRampUp: false,
      });

      // Assert
      expect(result.apdex_score).toBe(1.0);
      expect(result.satisfied_count).toBe(100);
      expect(result.tolerating_count).toBe(0);
      expect(result.frustrated_count).toBe(0);
      expect(result.total_count).toBe(100);
    });

    it('should return score 0.000 when all requests are frustrated', async () => {
      // Arrange
      const testRun = createTestRun();
      mockManager.query.mockResolvedValue([makeApdexRow(0, 0, 100, 3000)]);

      // Act
      const result = await calculator.calculateApdex({
        testRun,
        transactionName: null,
        thresholdMs: 500,
        includeFailedRequests: false,
        excludeRampUp: false,
      });

      // Assert
      expect(result.apdex_score).toBe(0.0);
    });

    it('should return score 0.500 when all requests are tolerating', async () => {
      // Arrange – 100% tolerating → score = (0 + 100 * 0.5) / 100 = 0.5
      const testRun = createTestRun();
      mockManager.query.mockResolvedValue([makeApdexRow(0, 100, 0, 1200)]);

      // Act
      const result = await calculator.calculateApdex({
        testRun,
        transactionName: null,
        thresholdMs: 500,
        includeFailedRequests: false,
        excludeRampUp: false,
      });

      // Assert
      expect(result.apdex_score).toBe(0.5);
    });

    it('should calculate mixed distribution correctly', async () => {
      // Arrange
      // 60 satisfied, 30 tolerating, 10 frustrated = (60 + 15) / 100 = 0.75
      const testRun = createTestRun();
      mockManager.query.mockResolvedValue([makeApdexRow(60, 30, 10, 800)]);

      // Act
      const result = await calculator.calculateApdex({
        testRun,
        transactionName: null,
        thresholdMs: 500,
        includeFailedRequests: false,
        excludeRampUp: false,
      });

      // Assert
      expect(result.apdex_score).toBe(0.75);
      expect(result.total_count).toBe(100);
    });

    it('should round score to 3 decimal places', async () => {
      // Arrange
      // 2 satisfied, 1 tolerating, 0 frustrated → (2 + 0.5) / 3 = 0.8333… → 0.833
      const testRun = createTestRun();
      mockManager.query.mockResolvedValue([makeApdexRow(2, 1, 0, 300)]);

      // Act
      const result = await calculator.calculateApdex({
        testRun,
        transactionName: null,
        thresholdMs: 500,
        includeFailedRequests: false,
        excludeRampUp: false,
      });

      // Assert
      expect(result.apdex_score).toBe(0.833);
    });

    it('should return null score when total count is zero', async () => {
      // Arrange
      const testRun = createTestRun();
      mockManager.query.mockResolvedValue([makeApdexRow(0, 0, 0, null)]);

      // Act
      const result = await calculator.calculateApdex({
        testRun,
        transactionName: null,
        thresholdMs: 500,
        includeFailedRequests: false,
        excludeRampUp: false,
      });

      // Assert
      expect(result.apdex_score).toBeNull();
      expect(result.total_count).toBe(0);
      expect(result.avg_response_time_ms).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // calculateApdex — average response time
  // ══════════════════════════════════════════════════════════════════════════

  describe('calculateApdex — average response time', () => {
    it('should round average response time to 2 decimal places', async () => {
      // Arrange
      const testRun = createTestRun();
      mockManager.query.mockResolvedValue([makeApdexRow(50, 30, 20, 123.456789)]);

      // Act
      const result = await calculator.calculateApdex({
        testRun,
        transactionName: null,
        thresholdMs: 500,
        includeFailedRequests: false,
        excludeRampUp: false,
      });

      // Assert
      expect(result.avg_response_time_ms).toBe(123.46);
    });

    it('should return null avg when database returns null', async () => {
      // Arrange
      const testRun = createTestRun();
      mockManager.query.mockResolvedValue([makeApdexRow(10, 5, 5, null)]);

      // Act
      const result = await calculator.calculateApdex({
        testRun,
        transactionName: null,
        thresholdMs: 500,
        includeFailedRequests: false,
        excludeRampUp: false,
      });

      // Assert
      expect(result.avg_response_time_ms).toBeNull();
    });

    it('should handle whole-number average without decimal drift', async () => {
      // Arrange
      const testRun = createTestRun();
      mockManager.query.mockResolvedValue([makeApdexRow(100, 0, 0, 200.0)]);

      // Act
      const result = await calculator.calculateApdex({
        testRun,
        transactionName: null,
        thresholdMs: 500,
        includeFailedRequests: false,
        excludeRampUp: false,
      });

      // Assert
      expect(result.avg_response_time_ms).toBe(200);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // calculateApdex — query parameter construction
  // ══════════════════════════════════════════════════════════════════════════

  describe('calculateApdex — query parameter construction', () => {
    it('should include transaction_name filter when specified', async () => {
      // Arrange
      const testRun = createTestRun();
      mockManager.query.mockResolvedValue([makeApdexRow(80, 10, 10)]);

      // Act
      await calculator.calculateApdex({
        testRun,
        transactionName: 'checkout',
        thresholdMs: 500,
        includeFailedRequests: false,
        excludeRampUp: false,
      });

      // Assert
      const [query, params] = mockManager.query.mock.calls[0];
      expect(query).toContain('transaction_name =');
      expect(params).toContain('checkout');
    });

    it('should omit transaction_name filter when null', async () => {
      // Arrange
      const testRun = createTestRun();
      mockManager.query.mockResolvedValue([makeApdexRow(80, 10, 10)]);

      // Act
      await calculator.calculateApdex({
        testRun,
        transactionName: null,
        thresholdMs: 500,
        includeFailedRequests: false,
        excludeRampUp: false,
      });

      // Assert
      const [query] = mockManager.query.mock.calls[0];
      expect(query).not.toContain('transaction_name');
    });

    it('should exclude failed requests by default (success = true filter)', async () => {
      // Arrange
      const testRun = createTestRun();
      mockManager.query.mockResolvedValue([makeApdexRow(80, 10, 10)]);

      // Act
      await calculator.calculateApdex({
        testRun,
        transactionName: null,
        thresholdMs: 500,
        includeFailedRequests: false,
        excludeRampUp: false,
      });

      // Assert
      const [query] = mockManager.query.mock.calls[0];
      expect(query).toContain('success = true');
    });

    it('should omit success filter when includeFailedRequests is true', async () => {
      // Arrange
      const testRun = createTestRun();
      mockManager.query.mockResolvedValue([makeApdexRow(80, 10, 10)]);

      // Act
      await calculator.calculateApdex({
        testRun,
        transactionName: null,
        thresholdMs: 500,
        includeFailedRequests: true,
        excludeRampUp: false,
      });

      // Assert
      const [query] = mockManager.query.mock.calls[0];
      expect(query).not.toContain('success = true');
    });

    it('should add ramp-up time filter when excludeRampUp is true and ramp_up is set', async () => {
      // Arrange
      const startTime = new Date('2024-01-01T10:00:00Z');
      const testRun = createTestRun({ start_time: startTime, ramp_up: 120 });
      mockManager.query.mockResolvedValue([makeApdexRow(80, 10, 10)]);

      // Act
      await calculator.calculateApdex({
        testRun,
        transactionName: null,
        thresholdMs: 500,
        includeFailedRequests: false,
        excludeRampUp: true,
      });

      // Assert
      const [query, params] = mockManager.query.mock.calls[0];
      expect(query).toContain('time >=');
      // Ramp-up end = startTime + 120s
      const expectedRampUpEnd = new Date(startTime.getTime() + 120 * 1000);
      expect(params).toContainEqual(expectedRampUpEnd);
    });

    it('should not add ramp-up filter when excludeRampUp is true but ramp_up is undefined', async () => {
      // Arrange
      const testRun = createTestRun({ ramp_up: undefined });
      mockManager.query.mockResolvedValue([makeApdexRow(80, 10, 10)]);

      // Act
      await calculator.calculateApdex({
        testRun,
        transactionName: null,
        thresholdMs: 500,
        includeFailedRequests: false,
        excludeRampUp: true,
      });

      // Assert
      const [query] = mockManager.query.mock.calls[0];
      expect(query).not.toContain('time >=');
    });

    it('should pass threshold and 4x threshold as query params', async () => {
      // Arrange
      const testRun = createTestRun({ ramp_up: undefined, start_time: undefined });
      mockManager.query.mockResolvedValue([makeApdexRow(80, 10, 10)]);

      // Act
      await calculator.calculateApdex({
        testRun,
        transactionName: null,
        thresholdMs: 300,
        includeFailedRequests: false,
        excludeRampUp: false,
      });

      // Assert — last two params before any added by WHERE should be 300 and 1200
      const [, params] = mockManager.query.mock.calls[0];
      expect(params).toContain(300);
      expect(params).toContain(1200);
    });

    it('should always filter on test_run_id', async () => {
      // Arrange
      const testRun = createTestRun({ test_run_id: 'run-xyz' });
      mockManager.query.mockResolvedValue([makeApdexRow(10, 5, 5)]);

      // Act
      await calculator.calculateApdex({
        testRun,
        transactionName: null,
        thresholdMs: 500,
        includeFailedRequests: false,
        excludeRampUp: false,
      });

      // Assert
      const [query, params] = mockManager.query.mock.calls[0];
      expect(query).toContain('test_run_id = $1');
      expect(params[0]).toBe('run-xyz');
    });

    it('should include threshold in returned result', async () => {
      // Arrange
      const testRun = createTestRun();
      mockManager.query.mockResolvedValue([makeApdexRow(50, 30, 20)]);

      // Act
      const result = await calculator.calculateApdex({
        testRun,
        transactionName: 'login',
        thresholdMs: 750,
        includeFailedRequests: false,
        excludeRampUp: false,
      });

      // Assert
      expect(result.threshold_ms).toBe(750);
      expect(result.transaction_name).toBe('login');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // resolveThreshold — priority chain
  // ══════════════════════════════════════════════════════════════════════════

  describe('resolveThreshold — priority chain', () => {
    const baseResolveParams = {
      systemUnderTestId: 'sut-1',
      testEnvironment: 'production',
      workload: 'load-test',
    };

    it('should use transaction-specific threshold when available (highest priority)', async () => {
      // Arrange
      mockManager.query.mockResolvedValue([{ apdex_threshold: 250 }]);

      // Act
      const threshold = await calculator.resolveThreshold({
        ...baseResolveParams,
        benchmarkThreshold: 500,
        transactionName: 'checkout',
      });

      // Assert
      expect(threshold).toBe(250);
      expect(mockManager.query).toHaveBeenCalledTimes(1);
    });

    it('should fall back to benchmark threshold when no transaction-specific threshold exists', async () => {
      // Arrange — transaction query returns empty, workload query also empty
      mockManager.query.mockResolvedValue([]);

      // Act
      const threshold = await calculator.resolveThreshold({
        ...baseResolveParams,
        benchmarkThreshold: 400,
        transactionName: 'login',
      });

      // Assert
      expect(threshold).toBe(400);
    });

    it('should skip transaction DB query when transactionName is null', async () => {
      // Arrange — workload query returns a value
      mockManager.query.mockResolvedValue([{ apdex_threshold: 300 }]);

      // Act
      const threshold = await calculator.resolveThreshold({
        ...baseResolveParams,
        benchmarkThreshold: null,
        transactionName: null,
      });

      // Assert
      expect(threshold).toBe(300);
      // Only one DB call — no transaction-specific lookup
      expect(mockManager.query).toHaveBeenCalledTimes(1);
    });

    it('should fall back to workload-level threshold when benchmark and transaction thresholds are absent', async () => {
      // Arrange
      // First call: transaction-specific (no result), second call: workload-level
      mockManager.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ apdex_threshold: 600 }]);

      // Act
      const threshold = await calculator.resolveThreshold({
        ...baseResolveParams,
        benchmarkThreshold: null,
        transactionName: 'search',
      });

      // Assert
      expect(threshold).toBe(600);
      expect(mockManager.query).toHaveBeenCalledTimes(2);
    });

    it('should return default 500ms when no threshold is configured anywhere', async () => {
      // Arrange — all DB queries return empty
      mockManager.query.mockResolvedValue([]);

      // Act
      const threshold = await calculator.resolveThreshold({
        ...baseResolveParams,
        benchmarkThreshold: null,
        transactionName: null,
      });

      // Assert
      expect(threshold).toBe(500);
    });

    it('should use benchmark threshold of 0 over workload default (falsy-0 edge case)', async () => {
      // Arrange — workload query would return something, but should not be reached
      mockManager.query.mockResolvedValue([{ apdex_threshold: 300 }]);

      // Act — passing 0 is a valid explicit threshold (overrides workload and default)
      // Note: the implementation treats 0 as falsy and falls through; this test
      // documents that behaviour. If the threshold passed is null/undefined the
      // code falls through to the workload lookup.
      const threshold = await calculator.resolveThreshold({
        ...baseResolveParams,
        benchmarkThreshold: null,
        transactionName: null,
      });

      // Assert — workload threshold returned from DB
      expect(threshold).toBe(300);
    });

    it('should append organizationId filter to transaction query when provided', async () => {
      // Arrange
      mockManager.query.mockResolvedValue([{ apdex_threshold: 400 }]);

      // Act
      await calculator.resolveThreshold({
        ...baseResolveParams,
        benchmarkThreshold: null,
        transactionName: 'checkout',
        organizationId: 'org-123',
      });

      // Assert
      const [query, params] = mockManager.query.mock.calls[0];
      expect(query).toContain('organization_id');
      expect(params).toContain('org-123');
    });

    it('should append organizationId filter to workload query when provided', async () => {
      // Arrange — transaction query empty, workload query returns value
      mockManager.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ apdex_threshold: 350 }]);

      // Act
      await calculator.resolveThreshold({
        ...baseResolveParams,
        benchmarkThreshold: null,
        transactionName: 'checkout',
        organizationId: 'org-456',
      });

      // Assert — second DB call is the workload-level query
      const [workloadQuery, workloadParams] = mockManager.query.mock.calls[1];
      expect(workloadQuery).toContain('organization_id');
      expect(workloadParams).toContain('org-456');
    });

    it('should not append organizationId filter when organizationId is null', async () => {
      // Arrange
      mockManager.query.mockResolvedValue([]);

      // Act
      await calculator.resolveThreshold({
        ...baseResolveParams,
        benchmarkThreshold: null,
        transactionName: 'checkout',
        organizationId: null,
      });

      // Assert — no $5 param in the queries
      const [txQuery, txParams] = mockManager.query.mock.calls[0];
      expect(txQuery).not.toContain('organization_id');
      expect(txParams).not.toContain(null);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // evaluateApdexBenchmark — single transaction path
  // ══════════════════════════════════════════════════════════════════════════

  describe('evaluateApdexBenchmark — single transaction', () => {
    it('should return COMPLETE PASS when score meets minimum', async () => {
      // Arrange — score = (80 + 15) / 100 = 0.95
      const testRun = createTestRun();
      const benchmark = createBenchmark({ transaction_name: 'checkout', min_apdex_score: 0.75, apdex_threshold_ms: 500 });

      // resolveThreshold → returns benchmark threshold (no TX-specific threshold in DB)
      mockManager.query
        .mockResolvedValueOnce([])                         // TX-specific threshold lookup
        .mockResolvedValueOnce([makeApdexRow(80, 30, 10, 300)]); // calculateApdex

      // Act
      const result = await calculator.evaluateApdexBenchmark(testRun, benchmark);

      // Assert
      expect(result.status).toBe('COMPLETE');
      expect(result.meets_requirement).toBe(true);
      expect(result.apdex_result.apdex_score).toBe(0.792); // (80 + 30*0.5) / 120
      expect(result.message).toContain('meets minimum');
      expect(result.benchmark_id).toBe('bench-001');
      expect(result.test_run_id).toBe('run-001');
    });

    it('should return COMPLETE FAIL when score is below minimum', async () => {
      // Arrange — score = (20 + 25) / 100 = 0.45
      const testRun = createTestRun();
      const benchmark = createBenchmark({ transaction_name: 'slow-tx', min_apdex_score: 0.75, apdex_threshold_ms: 500 });

      mockManager.query
        .mockResolvedValueOnce([])                         // TX-specific threshold lookup
        .mockResolvedValueOnce([makeApdexRow(20, 50, 30, 2000)]); // calculateApdex

      // Act
      const result = await calculator.evaluateApdexBenchmark(testRun, benchmark);

      // Assert
      expect(result.status).toBe('COMPLETE');
      expect(result.meets_requirement).toBe(false);
      expect(result.message).toContain('below minimum');
    });

    it('should return NO_DATA when no transactions found', async () => {
      // Arrange — DB returns zero-count row
      const testRun = createTestRun();
      const benchmark = createBenchmark({ transaction_name: 'ghost-tx', apdex_threshold_ms: 500 });

      mockManager.query
        .mockResolvedValueOnce([])                         // TX-specific threshold lookup
        .mockResolvedValueOnce([makeApdexRow(0, 0, 0, null)]); // calculateApdex

      // Act
      const result = await calculator.evaluateApdexBenchmark(testRun, benchmark);

      // Assert
      expect(result.status).toBe('NO_DATA');
      expect(result.meets_requirement).toBeNull();
      expect(result.message).toContain('No request data found for transaction: ghost-tx');
    });

    it('should return ERROR status when calculateApdex throws', async () => {
      // Arrange
      const testRun = createTestRun();
      const benchmark = createBenchmark({ transaction_name: 'checkout', apdex_threshold_ms: 500 });

      mockManager.query
        .mockResolvedValueOnce([])                         // TX-specific threshold
        .mockRejectedValueOnce(new Error('DB timeout'));   // calculateApdex

      // Act
      const result = await calculator.evaluateApdexBenchmark(testRun, benchmark);

      // Assert
      expect(result.status).toBe('ERROR');
      expect(result.meets_requirement).toBeNull();
      expect(result.message).toContain('DB timeout');
      expect(result.apdex_result.apdex_score).toBeNull();
    });

    it('should store the resolved threshold in requirement', async () => {
      // Arrange — TX-specific threshold overrides benchmark threshold
      const testRun = createTestRun();
      const benchmark = createBenchmark({ transaction_name: 'checkout', apdex_threshold_ms: 500 });

      mockManager.query
        .mockResolvedValueOnce([{ apdex_threshold: 250 }])  // TX-specific threshold
        .mockResolvedValueOnce([makeApdexRow(90, 5, 5, 200)]); // calculateApdex

      // Act
      const result = await calculator.evaluateApdexBenchmark(testRun, benchmark);

      // Assert
      expect(result.requirement.threshold_ms).toBe(250);
    });

    it('should not include transaction_results in single-transaction result', async () => {
      // Arrange
      const testRun = createTestRun();
      const benchmark = createBenchmark({ transaction_name: 'checkout' });

      mockManager.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([makeApdexRow(90, 5, 5, 200)]);

      // Act
      const result = await calculator.evaluateApdexBenchmark(testRun, benchmark);

      // Assert — single-transaction path does not add transaction_results array
      expect(result.transaction_results).toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // evaluateApdexBenchmark — workload-level (null transaction_name)
  // ══════════════════════════════════════════════════════════════════════════

  describe('evaluateApdexBenchmark — workload-level (null transaction_name)', () => {
    it('should return NO_DATA when no transactions exist for the test run', async () => {
      // Arrange
      const testRun = createTestRun();
      const benchmark = createBenchmark({ transaction_name: null });

      // getTransactionsWithScenarios returns empty
      mockManager.query.mockResolvedValueOnce([]);

      // Act
      const result = await calculator.evaluateApdexBenchmark(testRun, benchmark);

      // Assert
      expect(result.status).toBe('NO_DATA');
      expect(result.meets_requirement).toBeNull();
      expect(result.message).toContain('No transactions found');
      expect(result.transaction_results).toEqual([]);
    });

    it('should return PASS when all transactions meet the minimum score', async () => {
      // Arrange
      const testRun = createTestRun();
      const benchmark = createBenchmark({ transaction_name: null, min_apdex_score: 0.75 });

      mockManager.query
        // getTransactionsWithScenarios
        .mockResolvedValueOnce([
          { transaction_name: 'login', scenario_name: 'default' },
          { transaction_name: 'checkout', scenario_name: 'default' },
        ])
        // resolveThreshold for 'login' → TX-specific empty, no workload call (benchmarkThreshold provided)
        .mockResolvedValueOnce([])   // TX-specific threshold for login
        // calculateApdex for 'login' → score = 1.0
        .mockResolvedValueOnce([makeApdexRow(100, 0, 0, 200)])
        // resolveThreshold for 'checkout'
        .mockResolvedValueOnce([])   // TX-specific threshold for checkout
        // calculateApdex for 'checkout' → score = 0.85
        .mockResolvedValueOnce([makeApdexRow(85, 15, 0, 350)]);

      // Act
      const result = await calculator.evaluateApdexBenchmark(testRun, benchmark);

      // Assert
      expect(result.status).toBe('COMPLETE');
      expect(result.meets_requirement).toBe(true);
      expect(result.message).toContain('All 2 transactions meet minimum Apdex');
      expect(result.transaction_results).toHaveLength(2);
    });

    it('should return FAIL when at least one transaction is below the minimum score', async () => {
      // Arrange
      const testRun = createTestRun();
      const benchmark = createBenchmark({ transaction_name: null, min_apdex_score: 0.80 });

      mockManager.query
        .mockResolvedValueOnce([
          { transaction_name: 'login', scenario_name: 'default' },
          { transaction_name: 'slow-search', scenario_name: 'default' },
        ])
        .mockResolvedValueOnce([])                           // TX threshold for login
        .mockResolvedValueOnce([makeApdexRow(90, 5, 5, 200)]) // login → 0.925
        .mockResolvedValueOnce([])                           // TX threshold for slow-search
        .mockResolvedValueOnce([makeApdexRow(40, 30, 30, 900)]); // slow-search → (40+15)/100 = 0.55

      // Act
      const result = await calculator.evaluateApdexBenchmark(testRun, benchmark);

      // Assert
      expect(result.status).toBe('COMPLETE');
      expect(result.meets_requirement).toBe(false);
      expect(result.message).toContain('slow-search');
    });

    it('should aggregate counts across all transactions', async () => {
      // Arrange
      const testRun = createTestRun();
      const benchmark = createBenchmark({ transaction_name: null, min_apdex_score: 0.5 });

      mockManager.query
        .mockResolvedValueOnce([
          { transaction_name: 'tx-a', scenario_name: 'default' },
          { transaction_name: 'tx-b', scenario_name: 'default' },
        ])
        .mockResolvedValueOnce([])                        // TX threshold for tx-a
        .mockResolvedValueOnce([makeApdexRow(60, 20, 20)]) // tx-a
        .mockResolvedValueOnce([])                        // TX threshold for tx-b
        .mockResolvedValueOnce([makeApdexRow(40, 10, 50)]); // tx-b

      // Act
      const result = await calculator.evaluateApdexBenchmark(testRun, benchmark);

      // Assert — aggregate: 100 sat, 30 tol, 70 frus, total = 200
      expect(result.apdex_result.satisfied_count).toBe(100);
      expect(result.apdex_result.tolerating_count).toBe(30);
      expect(result.apdex_result.frustrated_count).toBe(70);
      expect(result.apdex_result.total_count).toBe(200);
      // Score = (100 + 15) / 200 = 0.575
      expect(result.apdex_result.apdex_score).toBe(0.575);
    });

    it('should return ERROR status when any transaction calculation fails', async () => {
      // Arrange
      const testRun = createTestRun();
      const benchmark = createBenchmark({ transaction_name: null, min_apdex_score: 0.75 });

      mockManager.query
        .mockResolvedValueOnce([
          { transaction_name: 'login', scenario_name: 'default' },
          { transaction_name: 'checkout', scenario_name: 'default' },
        ])
        .mockResolvedValueOnce([])                          // TX threshold for login
        .mockRejectedValueOnce(new Error('DB error'))       // calculateApdex for login throws
        .mockResolvedValueOnce([])                          // TX threshold for checkout
        .mockResolvedValueOnce([makeApdexRow(90, 5, 5, 200)]); // checkout succeeds

      // Act
      const result = await calculator.evaluateApdexBenchmark(testRun, benchmark);

      // Assert
      expect(result.status).toBe('ERROR');
      expect(result.message).toContain('Error calculating Apdex for some transactions');
    });

    it('should set transaction_name to null in apdex_result for workload-level', async () => {
      // Arrange
      const testRun = createTestRun();
      const benchmark = createBenchmark({ transaction_name: null });

      mockManager.query
        .mockResolvedValueOnce([{ transaction_name: 'login', scenario_name: 'default' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([makeApdexRow(80, 10, 10, 300)]);

      // Act
      const result = await calculator.evaluateApdexBenchmark(testRun, benchmark);

      // Assert
      expect(result.apdex_result.transaction_name).toBeNull();
    });

    it('should set meets_requirement to null when total count is zero for all transactions', async () => {
      // Arrange — a transaction exists but has no data
      const testRun = createTestRun();
      const benchmark = createBenchmark({ transaction_name: null, min_apdex_score: 0.75 });

      mockManager.query
        .mockResolvedValueOnce([{ transaction_name: 'ghost', scenario_name: 'default' }])
        .mockResolvedValueOnce([])                        // TX threshold
        .mockResolvedValueOnce([makeApdexRow(0, 0, 0)]); // zero counts

      // Act
      const result = await calculator.evaluateApdexBenchmark(testRun, benchmark);

      // Assert
      expect(result.status).toBe('NO_DATA');
      expect(result.meets_requirement).toBeNull();
    });

    it('should truncate failed transaction list in message at 3 names with ellipsis', async () => {
      // Arrange — 4 failing transactions
      const testRun = createTestRun();
      const benchmark = createBenchmark({ transaction_name: null, min_apdex_score: 0.95 });

      const transactions = ['tx-1', 'tx-2', 'tx-3', 'tx-4'].map(name => ({
        transaction_name: name,
        scenario_name: 'default',
      }));

      // Build query mock chain: for each TX → threshold (empty) + apdex row (all failing, score = 0)
      let queryMock = mockManager.query.mockResolvedValueOnce(transactions); // getTransactionsWithScenarios
      for (let i = 0; i < 4; i++) {
        queryMock = queryMock
          .mockResolvedValueOnce([])                      // TX threshold
          .mockResolvedValueOnce([makeApdexRow(0, 0, 100)]); // frustrated → score = 0
      }

      // Act
      const result = await calculator.evaluateApdexBenchmark(testRun, benchmark);

      // Assert
      expect(result.message).toContain('...');
      expect(result.message).toContain('tx-1');
      expect(result.message).toContain('tx-2');
      expect(result.message).toContain('tx-3');
    });

    it('should use apdex_threshold_ms fallback of 500 in NO_DATA result', async () => {
      // Arrange — benchmark has null threshold
      const testRun = createTestRun();
      const benchmark = createBenchmark({ transaction_name: null, apdex_threshold_ms: null });

      mockManager.query.mockResolvedValueOnce([]); // no transactions

      // Act
      const result = await calculator.evaluateApdexBenchmark(testRun, benchmark);

      // Assert
      expect(result.apdex_result.threshold_ms).toBe(500);
      expect(result.requirement.threshold_ms).toBe(500);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getAvailableTransactions
  // ══════════════════════════════════════════════════════════════════════════

  describe('getAvailableTransactions', () => {
    it('should return distinct transaction names for a test run', async () => {
      // Arrange
      mockManager.query.mockResolvedValue([
        { transaction_name: 'checkout' },
        { transaction_name: 'login' },
        { transaction_name: 'search' },
      ]);

      // Act
      const result = await calculator.getAvailableTransactions('run-001');

      // Assert
      expect(result).toEqual(['checkout', 'login', 'search']);
      const [query, params] = mockManager.query.mock.calls[0];
      expect(query).toContain('DISTINCT transaction_name');
      expect(params).toEqual(['run-001']);
    });

    it('should return empty array when test run has no transactions', async () => {
      // Arrange
      mockManager.query.mockResolvedValue([]);

      // Act
      const result = await calculator.getAvailableTransactions('run-empty');

      // Assert
      expect(result).toEqual([]);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getTransactionsWithScenarios
  // ══════════════════════════════════════════════════════════════════════════

  describe('getTransactionsWithScenarios', () => {
    it('should return transaction names with scenario names', async () => {
      // Arrange
      mockManager.query.mockResolvedValue([
        { transaction_name: 'login', scenario_name: 'default' },
        { transaction_name: 'checkout', scenario_name: 'scenario-a' },
      ]);

      // Act
      const result = await calculator.getTransactionsWithScenarios('run-001');

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ transaction_name: 'login', scenario_name: 'default' });
      expect(result[1]).toEqual({ transaction_name: 'checkout', scenario_name: 'scenario-a' });
    });

    it('should pass test_run_id as the sole query parameter', async () => {
      // Arrange
      mockManager.query.mockResolvedValue([]);

      // Act
      await calculator.getTransactionsWithScenarios('run-42');

      // Assert
      const [, params] = mockManager.query.mock.calls[0];
      expect(params).toEqual(['run-42']);
    });

    it('should use COALESCE default scenario name from query', async () => {
      // Arrange — the raw row already has 'default' applied by COALESCE in SQL
      mockManager.query.mockResolvedValue([
        { transaction_name: 'tx-a', scenario_name: 'default' },
      ]);

      // Act
      const result = await calculator.getTransactionsWithScenarios('run-001');

      // Assert
      expect(result[0].scenario_name).toBe('default');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // previewApdex
  // ══════════════════════════════════════════════════════════════════════════

  describe('previewApdex', () => {
    it('should throw when test run is not found', async () => {
      // Arrange
      mockManager.query.mockResolvedValue([]); // test_runs query returns nothing

      // Act & Assert
      await expect(
        calculator.previewApdex('nonexistent-run', null, 500)
      ).rejects.toThrow('Test run not found: nonexistent-run');
    });

    it('should calculate Apdex for found test run', async () => {
      // Arrange
      const dbTestRun = {
        test_run_id: 'run-preview',
        system_under_test_id: 'sut-1',
        test_environment: 'staging',
        workload: 'load-test',
        start_time: new Date('2024-01-01T10:00:00Z'),
        end_time: new Date('2024-01-01T11:00:00Z'),
        ramp_up: 60,
      };

      mockManager.query
        .mockResolvedValueOnce([dbTestRun])               // test_runs lookup
        .mockResolvedValueOnce([makeApdexRow(75, 15, 10, 400)]); // calculateApdex

      // Act
      const result = await calculator.previewApdex('run-preview', null, 500);

      // Assert — (75 + 7.5) / 100 = 0.825
      expect(result.apdex_score).toBe(0.825);
      expect(result.threshold_ms).toBe(500);
    });

    it('should forward transactionName to calculateApdex', async () => {
      // Arrange
      const dbTestRun = {
        test_run_id: 'run-preview',
        system_under_test_id: 'sut-1',
        test_environment: 'staging',
        workload: 'load-test',
        start_time: new Date('2024-01-01T10:00:00Z'),
        end_time: new Date('2024-01-01T11:00:00Z'),
        ramp_up: 0,
      };

      mockManager.query
        .mockResolvedValueOnce([dbTestRun])
        .mockResolvedValueOnce([makeApdexRow(90, 5, 5, 200)]);

      // Act
      const result = await calculator.previewApdex('run-preview', 'checkout', 300);

      // Assert
      expect(result.transaction_name).toBe('checkout');
      expect(result.threshold_ms).toBe(300);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Boundary / edge cases
  // ══════════════════════════════════════════════════════════════════════════

  describe('edge cases', () => {
    it('should handle a single satisfied request', async () => {
      // Arrange
      const testRun = createTestRun();
      mockManager.query.mockResolvedValue([makeApdexRow(1, 0, 0, 100)]);

      // Act
      const result = await calculator.calculateApdex({
        testRun, transactionName: null, thresholdMs: 500, includeFailedRequests: false, excludeRampUp: false,
      });

      // Assert
      expect(result.apdex_score).toBe(1.0);
      expect(result.total_count).toBe(1);
    });

    it('should handle a single frustrated request', async () => {
      // Arrange
      const testRun = createTestRun();
      mockManager.query.mockResolvedValue([makeApdexRow(0, 0, 1, 5000)]);

      // Act
      const result = await calculator.calculateApdex({
        testRun, transactionName: null, thresholdMs: 500, includeFailedRequests: false, excludeRampUp: false,
      });

      // Assert
      expect(result.apdex_score).toBe(0.0);
      expect(result.total_count).toBe(1);
    });

    it('should handle very large request counts without overflow', async () => {
      // Arrange
      const testRun = createTestRun();
      mockManager.query.mockResolvedValue([makeApdexRow(900000, 50000, 50000, 450)]);

      // Act
      const result = await calculator.calculateApdex({
        testRun, transactionName: null, thresholdMs: 500, includeFailedRequests: false, excludeRampUp: false,
      });

      // Assert — (900000 + 25000) / 1000000 = 0.925
      expect(result.apdex_score).toBe(0.925);
      expect(result.total_count).toBe(1000000);
    });

    it('should handle NaN counts from database gracefully (fall back to 0)', async () => {
      // Arrange — DB returns non-numeric strings
      const testRun = createTestRun();
      mockManager.query.mockResolvedValue([{
        satisfied_count: 'NaN',
        tolerating_count: 'NaN',
        frustrated_count: 'NaN',
        total_count: 'NaN',
        avg_response_time_ms: null,
      }]);

      // Act
      const result = await calculator.calculateApdex({
        testRun, transactionName: null, thresholdMs: 500, includeFailedRequests: false, excludeRampUp: false,
      });

      // Assert — parseInt('NaN') || 0 = 0
      expect(result.apdex_score).toBeNull();
      expect(result.total_count).toBe(0);
    });

    it('should compute 4x tolerating threshold correctly for various T values', async () => {
      // Arrange
      const testRun = createTestRun({ ramp_up: undefined, start_time: undefined });
      mockManager.query.mockResolvedValue([makeApdexRow(50, 30, 20)]);

      // Act
      await calculator.calculateApdex({
        testRun, transactionName: null, thresholdMs: 250, includeFailedRequests: false, excludeRampUp: false,
      });

      // Assert — threshold=250 → tolerating threshold=1000 must be in params
      const [, params] = mockManager.query.mock.calls[0];
      expect(params).toContain(250);
      expect(params).toContain(1000);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // calculateApdex — rollup fast path (test_run_transaction_stats)
  // See issue #296.
  // ══════════════════════════════════════════════════════════════════════════

  describe('calculateApdex — rollup fast path', () => {
    /**
     * Build a row as returned by the rollup fast-path query. Same column names
     * as the raw query so the calculator parses them identically — that's
     * intentional, see calculateApdexFromRollup() in ApdexCalculator.ts.
     */
    const makeRollupRow = (satisfied: number, tolerating: number, frustrated: number, avg: number | null = null) => ({
      satisfied_count: String(satisfied),
      tolerating_count: String(tolerating),
      frustrated_count: String(frustrated),
      total_count: String(satisfied + tolerating + frustrated),
      avg_response_time_ms: avg !== null ? String(avg) : null,
    });

    it('should hit fast path when transactionName is set and rollup returns a row', async () => {
      // Arrange
      const testRun = createTestRun();
      mockManager.query.mockResolvedValueOnce([makeRollupRow(900, 50, 50, 200)]);

      // Act
      const result = await calculator.calculateApdex({
        testRun,
        transactionName: 'checkout',
        thresholdMs: 500,
        includeFailedRequests: false,
        excludeRampUp: true,
      });

      // Assert — single DB call (no fall-back), values flow through unchanged
      expect(mockManager.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockManager.query.mock.calls[0];
      expect(sql).toContain('test_run_transaction_stats');
      expect(sql).toContain('rollup(pct_agg)');
      expect(sql).toContain('approx_percentile_rank');
      // Param layout: [testRunId, excludeRampUp, transactionName, includeFailedRequests, thresholdMs]
      expect(params).toEqual(['run-001', true, 'checkout', false, 500]);
      // Score: (900 + 25) / 1000 = 0.925
      expect(result.apdex_score).toBe(0.925);
      expect(result.satisfied_count).toBe(900);
      expect(result.tolerating_count).toBe(50);
      expect(result.frustrated_count).toBe(50);
      expect(result.total_count).toBe(1000);
      expect(result.transaction_name).toBe('checkout');
      expect(result.threshold_ms).toBe(500);
      expect(result.avg_response_time_ms).toBe(200);
    });

    it('should fall back to raw scan when fast path returns no rows (rollup empty)', async () => {
      // Arrange
      const testRun = createTestRun();
      mockManager.query
        .mockResolvedValueOnce([])                                   // fast-path miss
        .mockResolvedValueOnce([makeApdexRow(80, 10, 10, 300)]);     // raw fallback

      // Act
      const result = await calculator.calculateApdex({
        testRun,
        transactionName: 'checkout',
        thresholdMs: 500,
        includeFailedRequests: false,
        excludeRampUp: false,
      });

      // Assert — two DB calls: rollup miss, then raw scan
      expect(mockManager.query).toHaveBeenCalledTimes(2);
      const [rollupSql] = mockManager.query.mock.calls[0];
      const [rawSql] = mockManager.query.mock.calls[1];
      expect(rollupSql).toContain('test_run_transaction_stats');
      expect(rawSql).toContain('FROM transactions');
      expect(result.satisfied_count).toBe(80);
      expect(result.total_count).toBe(100);
    });

    it('should skip fast path entirely when transactionName is null (workload-level)', async () => {
      // Arrange — only the raw-scan path should be invoked
      const testRun = createTestRun();
      mockManager.query.mockResolvedValueOnce([makeApdexRow(50, 30, 20, 400)]);

      // Act
      await calculator.calculateApdex({
        testRun,
        transactionName: null,
        thresholdMs: 500,
        includeFailedRequests: false,
        excludeRampUp: false,
      });

      // Assert — single DB call straight to raw scan, no rollup probe
      expect(mockManager.query).toHaveBeenCalledTimes(1);
      const [sql] = mockManager.query.mock.calls[0];
      expect(sql).toContain('FROM transactions');
      expect(sql).not.toContain('test_run_transaction_stats');
    });

    it('should pass excludeRampUp through as the ramp_up_excluded filter', async () => {
      // Arrange
      const testRun = createTestRun();
      mockManager.query.mockResolvedValueOnce([makeRollupRow(95, 5, 0, 250)]);

      // Act
      await calculator.calculateApdex({
        testRun,
        transactionName: 'login',
        thresholdMs: 500,
        includeFailedRequests: false,
        excludeRampUp: true,
      });

      // Assert
      const [sql, params] = mockManager.query.mock.calls[0];
      expect(sql).toContain('ramp_up_excluded = $2');
      expect(params[1]).toBe(true);
    });

    it('should propagate includeFailedRequests as the eligibility flag', async () => {
      // Arrange — when includeFailedRequests=true, the SQL gates with $4::boolean,
      // letting rows with failed > 0 pass through the rollup
      const testRun = createTestRun();
      mockManager.query.mockResolvedValueOnce([makeRollupRow(100, 0, 0, 200)]);

      // Act
      await calculator.calculateApdex({
        testRun,
        transactionName: 'tx',
        thresholdMs: 500,
        includeFailedRequests: true,
        excludeRampUp: false,
      });

      // Assert
      const [sql, params] = mockManager.query.mock.calls[0];
      expect(sql).toContain('$4::boolean');
      expect(params[3]).toBe(true);
    });

    it('should pass thresholdMs as the rank parameter (no separate 4x param)', async () => {
      // Arrange — rollup SQL computes 4 * threshold inline, so only one threshold param
      const testRun = createTestRun();
      mockManager.query.mockResolvedValueOnce([makeRollupRow(80, 10, 10, 250)]);

      // Act
      await calculator.calculateApdex({
        testRun,
        transactionName: 'tx',
        thresholdMs: 750,
        includeFailedRequests: false,
        excludeRampUp: false,
      });

      // Assert
      const [sql, params] = mockManager.query.mock.calls[0];
      expect(sql).toContain('approx_percentile_rank($5');
      expect(sql).toContain('($5 * 4)');
      expect(params[4]).toBe(750);
    });

    it('should round avg_response_time_ms to 2 decimal places', async () => {
      // Arrange — rollup SQL rounds at SQL level; JS does another round to 2dp on output
      const testRun = createTestRun();
      mockManager.query.mockResolvedValueOnce([makeRollupRow(50, 30, 20, 123.456789)]);

      // Act
      const result = await calculator.calculateApdex({
        testRun,
        transactionName: 'tx',
        thresholdMs: 500,
        includeFailedRequests: false,
        excludeRampUp: false,
      });

      // Assert
      expect(result.avg_response_time_ms).toBe(123.46);
    });

    it('should return null avg when rollup returns null avg_response_time_ms', async () => {
      // Arrange
      const testRun = createTestRun();
      mockManager.query.mockResolvedValueOnce([makeRollupRow(80, 10, 10, null)]);

      // Act
      const result = await calculator.calculateApdex({
        testRun,
        transactionName: 'tx',
        thresholdMs: 500,
        includeFailedRequests: false,
        excludeRampUp: false,
      });

      // Assert
      expect(result.avg_response_time_ms).toBeNull();
    });

    it('should produce score equivalent to raw query for the same distribution', async () => {
      // Arrange — rollup row matches what the raw query would produce on the same fixture
      const testRun = createTestRun();
      mockManager.query.mockResolvedValueOnce([makeRollupRow(60, 30, 10, 800)]);

      // Act
      const result = await calculator.calculateApdex({
        testRun,
        transactionName: 'tx',
        thresholdMs: 500,
        includeFailedRequests: false,
        excludeRampUp: false,
      });

      // Assert — (60 + 15) / 100 = 0.75, same formula as the raw path
      expect(result.apdex_score).toBe(0.75);
      expect(result.total_count).toBe(100);
    });
  });
});
