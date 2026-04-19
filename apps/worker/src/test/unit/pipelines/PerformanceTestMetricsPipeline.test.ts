/**
 * PerformanceTestMetricsPipeline Unit Tests
 *
 * Comprehensive test suite covering:
 * - Input validation (null, undefined, invalid types, missing fields)
 * - Full and incremental pipeline execution flows
 * - Test run metadata loading (UUID vs. name-based systemUnderTestId)
 * - Apdex threshold loading (workload, benchmark, transaction-level, with/without orgId)
 * - Metric processor orchestration (requests, transactions, errors, virtual users)
 * - saveDsMetrics: full-collection (DELETE + INSERT) vs incremental (UPSERT), batch sizing
 * - computeAndSaveStatistics: grouping, percentile math, empty/ramp-up filtering
 * - saveDsCompareConfigs / insertCompareConfigBatch: panel-level vs metric-specific splits
 * - updateDashboardPanels: no-dashboards early-exit, successful update
 * - Error handling: processor failure, DB failures, missing test run
 * - Edge cases: no metrics, partial processor results, very large metric sets
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PerformanceTestMetricsPipeline } from '../../../pipelines/PerformanceTestMetricsPipeline.js';
import type { PipelineResult } from '../../../types/pipeline.js';
import type { DsMetricsRecord, DsCompareConfigRecord } from '../../../types/performance-metrics.js';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

// Mock database-accessor so the constructor does not touch a real DB
vi.mock('../../../common/database-accessor.js', () => ({
  getDatabaseService: vi.fn(() => mockDatabaseService),
}));

// Mock the four processor helpers so we can control their output per test
vi.mock('../../../pipelines/helpers/dashboard-manager.js');
vi.mock('../../../pipelines/helpers/requests-processor.js');
vi.mock('../../../pipelines/helpers/transactions-processor.js');
vi.mock('../../../pipelines/helpers/scenario-processors.js');

import { DashboardManager } from '../../../pipelines/helpers/dashboard-manager.js';
import { RequestsProcessor } from '../../../pipelines/helpers/requests-processor.js';
import { TransactionsProcessor } from '../../../pipelines/helpers/transactions-processor.js';
import { ErrorsProcessor, VirtualUsersProcessor } from '../../../pipelines/helpers/scenario-processors.js';
import { getDatabaseService } from '../../../common/database-accessor.js';

// ---------------------------------------------------------------------------
// Shared mock objects (recreated fresh before each test via beforeEach)
// ---------------------------------------------------------------------------

// Top-level references so vi.mock factory closures can see them
let mockDataSource: any;
let mockWriteDataSource: any;
let mockDatabaseService: any;

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const createMockTestRun = (overrides: Record<string, unknown> = {}) => ({
  testRunId: 'test-run-uuid-001',
  systemUnderTestId: '11111111-1111-1111-1111-111111111111', // valid UUID
  testEnvironment: 'acc',
  workload: 'loadTest',
  startTime: new Date('2024-01-01T00:00:00Z'),
  endTime: new Date('2024-01-01T01:00:00Z'),
  analysisStartOffset: 60,
  organizationId: 'org-uuid-001',
  teamId: 'team-uuid-001',
  ...overrides,
});

const createMockMetric = (overrides: Partial<DsMetricsRecord> = {}): DsMetricsRecord => ({
  test_run_id: 'test-run-uuid-001',
  application_dashboard_id: 'app-dash-uuid-001',
  metrics_source_id: null,
  dashboard_uid: 'perf-test-dashboard',
  panel_id: 201,
  time: new Date('2024-01-01T00:01:00Z'),
  metric_name: 'checkout.response_time.avg',
  panel_title: 'Request RT Avg',
  dashboard_label: 'Load Test',
  benchmark_ids: null,
  errors: null,
  timestep: 60,
  ramp_up: false,
  value: 350,
  unit: 'ms',
  ...overrides,
});

const createMockCompareConfig = (overrides: Partial<DsCompareConfigRecord> = {}): DsCompareConfigRecord => ({
  system_under_test_id: '11111111-1111-1111-1111-111111111111',
  test_environment: 'acc',
  workload: 'loadTest',
  application_dashboard_id: 'app-dash-uuid-001',
  panel_id: 201,
  metric_name: null, // panel-level by default
  config_data: {
    metricClassification: { classification: 'RED_duration', higherIsBetter: false },
    thresholds: { aggregation: 'mean', percentageThreshold: 0.15, iqrThreshold: 2.0, absoluteThreshold: null },
    defaultValueIfControlGroupMissing: 0,
  },
  ...overrides,
});

const createProcessorResult = (
  metricCount = 0,
  compareConfigCount = 0,
  metricOverrides: Partial<DsMetricsRecord> = {}
) => ({
  metrics: Array.from({ length: metricCount }, (_, i) =>
    createMockMetric({ ...metricOverrides, panel_id: 201 + i, time: new Date(`2024-01-01T00:0${i + 1}:00Z`) })
  ),
  compareConfigs: Array.from({ length: compareConfigCount }, (_, i) =>
    createMockCompareConfig({ panel_id: 201 + i })
  ),
});

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('PerformanceTestMetricsPipeline', () => {
  let pipeline: PerformanceTestMetricsPipeline;
  let mockDashboardManagerInstance: any;
  let mockRequestsProcessorInstance: any;
  let mockTransactionsProcessorInstance: any;
  let mockErrorsProcessorInstance: any;
  let mockVirtualUsersProcessorInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset datasource mocks
    mockDataSource = {
      query: vi.fn().mockResolvedValue([]),
    };
    mockWriteDataSource = {
      query: vi.fn().mockResolvedValue([]),
    };
    mockDatabaseService = {
      dataSource: mockDataSource,
      writeDataSource: mockWriteDataSource,
      getTestRunByTestRunId: vi.fn(),
      query: vi.fn().mockResolvedValue([]),
    };

    // Ensure getDatabaseService returns our mock
    vi.mocked(getDatabaseService).mockReturnValue(mockDatabaseService);

    // Default processor mock instances
    mockDashboardManagerInstance = {};
    mockRequestsProcessorInstance = { process: vi.fn().mockResolvedValue(createProcessorResult()) };
    mockTransactionsProcessorInstance = { process: vi.fn().mockResolvedValue(createProcessorResult()) };
    mockErrorsProcessorInstance = { process: vi.fn().mockResolvedValue(createProcessorResult()) };
    mockVirtualUsersProcessorInstance = { process: vi.fn().mockResolvedValue(createProcessorResult()) };

    // Wire constructor mocks
    vi.mocked(DashboardManager as any).mockImplementation(() => mockDashboardManagerInstance);
    vi.mocked(RequestsProcessor as any).mockImplementation(() => mockRequestsProcessorInstance);
    vi.mocked(TransactionsProcessor as any).mockImplementation(() => mockTransactionsProcessorInstance);
    vi.mocked(ErrorsProcessor as any).mockImplementation(() => mockErrorsProcessorInstance);
    vi.mocked(VirtualUsersProcessor as any).mockImplementation(() => mockVirtualUsersProcessorInstance);

    pipeline = new PerformanceTestMetricsPipeline(mockLogger as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Input Validation
  // -------------------------------------------------------------------------

  describe('Input Validation', () => {
    it('should return error result when input is null', async () => {
      const result = await pipeline.execute(null);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid input');
    });

    it('should return error result when input is undefined', async () => {
      const result = await pipeline.execute(undefined);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid input');
    });

    it('should return error result when input is a string', async () => {
      const result = await pipeline.execute('test-run-id');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid input');
    });

    it('should return error result when input is a number', async () => {
      const result = await pipeline.execute(42);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid input');
    });

    it('should return error result when testRunId is missing', async () => {
      const result = await pipeline.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('testRunId');
    });

    it('should return error result when testRunId is a number instead of a string', async () => {
      const result = await pipeline.execute({ testRunId: 123 });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('testRunId');
    });

    it('should return error result when testRunId is empty string', async () => {
      const result = await pipeline.execute({ testRunId: '' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('testRunId');
    });

    it('should return error result when fromTime is an invalid date string', async () => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());

      const result = await pipeline.execute({ testRunId: 'tr-001', fromTime: 'not-a-date' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('fromTime');
    });

    it('should return error result when toTime is an invalid date string', async () => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());

      const result = await pipeline.execute({ testRunId: 'tr-001', toTime: 'not-a-date' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('toTime');
    });

    it('should accept a Date object for fromTime without error', async () => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      // All downstream queries return empty arrays — pipeline should succeed
      mockDataSource.query.mockResolvedValue([]);
      mockWriteDataSource.query.mockResolvedValue([]);

      const result = await pipeline.execute({
        testRunId: 'tr-001',
        fromTime: new Date('2024-01-01T00:10:00Z'),
        toTime: new Date('2024-01-01T00:20:00Z'),
      });

      // Validation should pass — if result has an error it must not be about fromTime
      if (!result.success && result.error?.message) {
        expect(result.error.message).not.toContain('fromTime');
      }
    });

    it('should accept a valid ISO date string for fromTime/toTime', async () => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockResolvedValue([]);
      mockWriteDataSource.query.mockResolvedValue([]);

      const result = await pipeline.execute({
        testRunId: 'tr-001',
        fromTime: '2024-01-01T00:10:00Z',
        toTime: '2024-01-01T00:20:00Z',
      });

      if (!result.success && result.error?.message) {
        expect(result.error.message).not.toContain('fromTime');
      }
    });
  });

  // -------------------------------------------------------------------------
  // 2. Test Run Metadata Loading
  // -------------------------------------------------------------------------

  describe('Test Run Metadata Loading', () => {
    it('should return failure when test run is not found', async () => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(null);

      const result = await pipeline.execute({ testRunId: 'missing-run' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Test run not found: missing-run');
    });

    it('should return failure when test run has no startTime', async () => {
      const runWithoutStart = createMockTestRun({ startTime: null });
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(runWithoutStart);

      const result = await pipeline.execute({ testRunId: 'tr-no-start' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('no start time');
    });

    it('should resolve systemUnderTestId when it is already a UUID', async () => {
      const run = createMockTestRun();
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(run);
      mockDataSource.query.mockResolvedValue([]);
      mockWriteDataSource.query.mockResolvedValue([]);

      await pipeline.execute({ testRunId: 'tr-001' });

      // When systemUnderTestId is a UUID the pipeline should NOT query the
      // system_under_test table by name (it queries by WHERE name = $1)
      const sutNameLookupCalls = mockDataSource.query.mock.calls.filter(
        (call: any[]) => String(call[0]).includes('FROM system_under_test WHERE name')
      );
      expect(sutNameLookupCalls.length).toBe(0);
    });

    it('should query system_under_test table when systemUnderTestId looks like a name', async () => {
      const run = createMockTestRun({ systemUnderTestId: 'my-app-service' }); // not a UUID
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(run);
      mockDataSource.query.mockResolvedValueOnce([{ id: 'resolved-uuid' }]); // SUT lookup
      mockDataSource.query.mockResolvedValue([]); // all other DB calls
      mockWriteDataSource.query.mockResolvedValue([]);

      await pipeline.execute({ testRunId: 'tr-name-sut' });

      const sutQueryCall = mockDataSource.query.mock.calls.find(
        (call: any[]) => String(call[0]).includes('system_under_test')
      );
      expect(sutQueryCall).toBeDefined();
      expect(sutQueryCall[1]).toContain('my-app-service');
    });

    it('should return failure when systemUnderTestId name lookup yields no results', async () => {
      const run = createMockTestRun({ systemUnderTestId: 'unknown-service' });
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(run);
      // SUT name lookup returns empty
      mockDataSource.query.mockResolvedValueOnce([]);

      const result = await pipeline.execute({ testRunId: 'tr-bad-sut' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('System under test not found');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Apdex Threshold Loading
  // -------------------------------------------------------------------------

  describe('Apdex Threshold Loading', () => {
    beforeEach(() => {
      // Happy-path test run is available
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
    });

    it('should include organization_id filter in workload threshold query when orgId is present', async () => {
      // Arrange: dataSource.query returns empty arrays for all queries
      mockDataSource.query.mockResolvedValue([]);
      mockWriteDataSource.query.mockResolvedValue([]);

      await pipeline.execute({ testRunId: 'tr-001' });

      const workloadCall = mockDataSource.query.mock.calls.find(
        (call: any[]) => String(call[0]).includes('workload_apdex_thresholds')
      );
      expect(workloadCall).toBeDefined();
      // The 4th param should be the organization ID
      expect(workloadCall[1]).toContain('org-uuid-001');
    });

    it('should NOT include organization_id filter when test run has no organizationId', async () => {
      const runNoOrg = createMockTestRun({ organizationId: null });
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(runNoOrg);
      mockDataSource.query.mockResolvedValue([]);
      mockWriteDataSource.query.mockResolvedValue([]);

      await pipeline.execute({ testRunId: 'tr-no-org' });

      const workloadCall = mockDataSource.query.mock.calls.find(
        (call: any[]) => String(call[0]).includes('workload_apdex_thresholds')
      );
      expect(workloadCall).toBeDefined();
      // Parameters array should only have 3 entries (no orgId appended)
      expect(workloadCall[1].length).toBe(3);
    });

    it('should load workload-level threshold when available', async () => {
      mockDataSource.query
        .mockResolvedValueOnce([{ apdex_threshold: 300 }]) // workload threshold
        .mockResolvedValueOnce([])                          // benchmark threshold
        .mockResolvedValueOnce([])                          // transaction thresholds
        .mockResolvedValue([]);                              // remaining queries
      mockWriteDataSource.query.mockResolvedValue([]);

      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.success).toBe(true);
      // Apdex loading is logged — verify threshold was picked up
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('workload=300')
      );
    });

    it('should load benchmark threshold as fallback when workload threshold is absent', async () => {
      mockDataSource.query
        .mockResolvedValueOnce([])                                   // workload threshold: none
        .mockResolvedValueOnce([{ apdex_threshold_ms: 400 }])        // benchmark threshold
        .mockResolvedValueOnce([])                                   // transaction thresholds
        .mockResolvedValue([]);
      mockWriteDataSource.query.mockResolvedValue([]);

      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.success).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('benchmark=400')
      );
    });

    it('should load per-transaction thresholds into the Map', async () => {
      mockDataSource.query
        .mockResolvedValueOnce([])  // workload
        .mockResolvedValueOnce([])  // benchmark
        .mockResolvedValueOnce([
          { transaction_name: 'checkout', apdex_threshold: 200 },
          { transaction_name: 'login', apdex_threshold: 150 },
        ])
        .mockResolvedValue([]);
      mockWriteDataSource.query.mockResolvedValue([]);

      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.success).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('transaction-specific=2')
      );
    });
  });

  // -------------------------------------------------------------------------
  // 4. Pipeline Execution — Happy Path (full collection)
  // -------------------------------------------------------------------------

  describe('Pipeline Execution — Happy Path (full collection)', () => {
    beforeEach(() => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockResolvedValue([]);
      mockWriteDataSource.query.mockResolvedValue([]);
    });

    it('should return success with zero metrics when all processors return empty results', async () => {
      const result: PipelineResult = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        metricsCreated: 0,
        compareConfigsCreated: 0,
        breakdown: {
          responseTimeMetrics: 0,
          transactionMetrics: 0,
          errorMetrics: 0,
          virtualUserMetrics: 0,
        },
      });
    });

    it('should aggregate metrics from all four processors into the output', async () => {
      mockRequestsProcessorInstance.process.mockResolvedValue(createProcessorResult(3, 1));
      mockTransactionsProcessorInstance.process.mockResolvedValue(createProcessorResult(2, 1));
      mockErrorsProcessorInstance.process.mockResolvedValue(createProcessorResult(1, 0));
      mockVirtualUsersProcessorInstance.process.mockResolvedValue(createProcessorResult(2, 0));

      const result: PipelineResult = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.success).toBe(true);
      expect((result.data as any).metricsCreated).toBe(8); // 3+2+1+2
      expect((result.data as any).breakdown.responseTimeMetrics).toBe(3);
      expect((result.data as any).breakdown.transactionMetrics).toBe(2);
      expect((result.data as any).breakdown.errorMetrics).toBe(1);
      expect((result.data as any).breakdown.virtualUserMetrics).toBe(2);
    });

    it('should call all four processor.process() methods with correct arguments', async () => {
      await pipeline.execute({ testRunId: 'tr-001' });

      expect(mockRequestsProcessorInstance.process).toHaveBeenCalledOnce();
      expect(mockTransactionsProcessorInstance.process).toHaveBeenCalledOnce();
      expect(mockErrorsProcessorInstance.process).toHaveBeenCalledOnce();
      expect(mockVirtualUsersProcessorInstance.process).toHaveBeenCalledOnce();

      // Errors and VU processors receive only 2 args (no apdex or bucket size)
      const errorsArgs = mockErrorsProcessorInstance.process.mock.calls[0];
      expect(errorsArgs.length).toBe(2);
      const vuArgs = mockVirtualUsersProcessorInstance.process.mock.calls[0];
      expect(vuArgs.length).toBe(2);
    });

    it('should include duration in the result', async () => {
      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should log completion message on success', async () => {
      await pipeline.execute({ testRunId: 'tr-001' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('completed')
      );
    });
  });

  // -------------------------------------------------------------------------
  // 5. Pipeline Execution — Incremental Collection
  // -------------------------------------------------------------------------

  describe('Pipeline Execution — Incremental Collection', () => {
    beforeEach(() => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockResolvedValue([]);
      mockWriteDataSource.query.mockResolvedValue([]);
    });

    it('should log incremental mode when fromTime/toTime are provided', async () => {
      await pipeline.execute({
        testRunId: 'tr-001',
        fromTime: new Date('2024-01-01T00:10:00Z'),
        toTime: new Date('2024-01-01T00:20:00Z'),
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('incremental')
      );
    });

    it('should log filter time range when incremental', async () => {
      await pipeline.execute({
        testRunId: 'tr-001',
        fromTime: new Date('2024-01-01T00:10:00Z'),
        toTime: new Date('2024-01-01T00:20:00Z'),
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Filter time range')
      );
    });

    it('should not log incremental mode when fromTime/toTime are absent', async () => {
      await pipeline.execute({ testRunId: 'tr-001' });

      const incrementalLogCalls = mockLogger.info.mock.calls.filter(
        (call: any[]) => String(call[0]).includes('incremental')
      );
      expect(incrementalLogCalls.length).toBe(0);
    });

    it('should use 1s buckets for incremental collection', async () => {
      await pipeline.execute({
        testRunId: 'tr-001',
        fromTime: new Date('2024-01-01T00:10:00Z'),
        toTime: new Date('2024-01-01T00:20:00Z'),
      });

      // The "1s buckets" log message should appear
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('1s buckets')
      );
    });
  });

  // -------------------------------------------------------------------------
  // 6. saveDsMetrics — full vs incremental modes
  // -------------------------------------------------------------------------

  describe('saveDsMetrics', () => {
    beforeEach(() => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockResolvedValue([]);
      mockWriteDataSource.query.mockResolvedValue([]);
    });

    it('should issue a DELETE before INSERT for full-collection mode', async () => {
      mockRequestsProcessorInstance.process.mockResolvedValue(createProcessorResult(1));

      await pipeline.execute({ testRunId: 'tr-001' });

      const deleteCalls = mockDataSource.query.mock.calls.filter(
        (call: any[]) => String(call[0]).includes('DELETE FROM ds_metrics')
      );
      expect(deleteCalls.length).toBe(1);
      expect(deleteCalls[0][1]).toContain('tr-001');
    });

    it('should NOT issue DELETE for incremental mode', async () => {
      mockRequestsProcessorInstance.process.mockResolvedValue(createProcessorResult(1));

      await pipeline.execute({
        testRunId: 'tr-001',
        fromTime: new Date('2024-01-01T00:10:00Z'),
        toTime: new Date('2024-01-01T00:20:00Z'),
      });

      const deleteCalls = mockDataSource.query.mock.calls.filter(
        (call: any[]) => String(call[0]).includes('DELETE FROM ds_metrics')
      );
      expect(deleteCalls.length).toBe(0);
    });

    it('should use ON CONFLICT upsert query for incremental mode', async () => {
      mockRequestsProcessorInstance.process.mockResolvedValue(createProcessorResult(1));

      await pipeline.execute({
        testRunId: 'tr-001',
        fromTime: new Date('2024-01-01T00:10:00Z'),
        toTime: new Date('2024-01-01T00:20:00Z'),
      });

      const insertCalls = mockWriteDataSource.query.mock.calls.filter(
        (call: any[]) => String(call[0]).includes('INSERT INTO ds_metrics')
      );
      expect(insertCalls.length).toBeGreaterThan(0);
      expect(String(insertCalls[0][0])).toContain('ON CONFLICT');
    });

    it('should use plain INSERT (no ON CONFLICT) for full-collection mode', async () => {
      mockRequestsProcessorInstance.process.mockResolvedValue(createProcessorResult(1));

      await pipeline.execute({ testRunId: 'tr-001' });

      const insertCalls = mockWriteDataSource.query.mock.calls.filter(
        (call: any[]) => String(call[0]).includes('INSERT INTO ds_metrics')
      );
      expect(insertCalls.length).toBeGreaterThan(0);
      expect(String(insertCalls[0][0])).not.toContain('ON CONFLICT');
    });

    it('should skip saveDsMetrics entirely when there are no metrics', async () => {
      // All processors return empty — no INSERT should run
      await pipeline.execute({ testRunId: 'tr-001' });

      const insertCalls = mockWriteDataSource.query.mock.calls.filter(
        (call: any[]) => String(call[0]).includes('INSERT INTO ds_metrics')
      );
      expect(insertCalls.length).toBe(0);
    });

    it('should return failure when a batch insert rejects', async () => {
      mockRequestsProcessorInstance.process.mockResolvedValue(createProcessorResult(1));
      // Make the actual INSERT fail
      mockWriteDataSource.query.mockRejectedValueOnce(new Error('DB write failure'));

      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Failed to save');
    });
  });

  // -------------------------------------------------------------------------
  // 7. computeAndSaveStatistics
  // -------------------------------------------------------------------------

  describe('computeAndSaveStatistics', () => {
    beforeEach(() => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockResolvedValue([]);
      mockWriteDataSource.query.mockResolvedValue([]);
    });

    it('should log skip message when all metrics have ramp_up=true', async () => {
      mockRequestsProcessorInstance.process.mockResolvedValue(
        createProcessorResult(1, 0, { ramp_up: true })
      );

      await pipeline.execute({ testRunId: 'tr-001' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('No non-ramp-up metrics')
      );
    });

    it('should compute statistics for non-ramp-up metrics', async () => {
      mockRequestsProcessorInstance.process.mockResolvedValue(
        createProcessorResult(3, 0, { ramp_up: false })
      );

      await pipeline.execute({ testRunId: 'tr-001' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Computing in-memory statistics')
      );
    });

    it('should NOT issue a DELETE before the upsert (issue #134)', async () => {
      mockRequestsProcessorInstance.process.mockResolvedValue(createProcessorResult(1));

      await pipeline.execute({ testRunId: 'tr-001' });

      const deleteStatsCalls = mockDataSource.query.mock.calls.filter(
        (call: any[]) => String(call[0]).includes('DELETE FROM ds_metric_statistics')
      );
      expect(deleteStatsCalls.length).toBe(0);
    });

    it('should UPSERT statistics with ON CONFLICT DO UPDATE on the unique key (issue #134)', async () => {
      mockRequestsProcessorInstance.process.mockResolvedValue(createProcessorResult(1));

      await pipeline.execute({ testRunId: 'tr-001' });

      const insertStatsCalls = mockDataSource.query.mock.calls.filter(
        (call: any[]) => String(call[0]).includes('INSERT INTO ds_metric_statistics')
      );
      expect(insertStatsCalls.length).toBeGreaterThan(0);

      const sql = String(insertStatsCalls[0][0]);
      // Normalize whitespace so future SQL reformatting doesn't break us.
      const normalized = sql.replace(/\s+/g, ' ');
      // Idempotent against the uniq_ds_metric_statistics index added in #132.
      expect(normalized).toContain(
        'ON CONFLICT (test_run_id, application_dashboard_id, panel_id, metric_name)'
      );
      expect(normalized).toContain('DO UPDATE SET');
      // Sanity-check that the refresh covers the volatile stat columns.
      expect(normalized).toMatch(/count\s*=\s*EXCLUDED\.count/);
      expect(normalized).toMatch(/mean\s*=\s*EXCLUDED\.mean/);
      expect(normalized).toMatch(/updated_at\s*=\s*NOW\(\)/);
      // Inverse contract: created_by must NOT be in DO UPDATE — the original
      // creator's identity is preserved across overlapping ticks. A future
      // edit that mechanically adds `created_by = EXCLUDED.created_by` would
      // silently rewrite ownership; this guard catches that regression.
      expect(normalized).not.toMatch(/created_by\s*=\s*EXCLUDED\.created_by/);
      // updated_by IS expected to refresh (records who last touched it).
      expect(normalized).toMatch(/updated_by\s*=\s*EXCLUDED\.updated_by/);
    });

    it('should group metrics by (test_run_id, application_dashboard_id, panel_id, metric_name)', async () => {
      // Two metrics with same group key → one stat record
      const sameGroupMetrics = {
        metrics: [
          createMockMetric({ metric_name: 'checkout.response_time.avg', value: 100 }),
          createMockMetric({ metric_name: 'checkout.response_time.avg', value: 200 }),
        ],
        compareConfigs: [],
      };
      mockRequestsProcessorInstance.process.mockResolvedValue(sameGroupMetrics);

      await pipeline.execute({ testRunId: 'tr-001' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('1 metric groups')
      );
    });

    it('should dedupe metric_names that collide after 255-char truncation (issue #134)', async () => {
      // Two metric names whose first 255 chars are identical but tails differ.
      // Storage truncates to 255 chars, so both would persist with the same
      // metric_name. If grouping used the raw name (untruncated), we would
      // emit two stat records with the same persisted key — and Postgres would
      // throw `cardinality_violation` on the bulk INSERT ... ON CONFLICT
      // DO UPDATE because a single statement cannot affect the same row twice.
      const prefix = 'T01_Homepage_Load.' + 'x'.repeat(240); // total 258 chars; first 255 identical
      const collidingMetrics = {
        metrics: [
          createMockMetric({ metric_name: prefix + 'A', value: 100 }),
          createMockMetric({ metric_name: prefix + 'B', value: 200 }),
        ],
        compareConfigs: [],
      };
      mockRequestsProcessorInstance.process.mockResolvedValue(collidingMetrics);

      await pipeline.execute({ testRunId: 'tr-001' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('1 metric groups')
      );
    });
  });

  // -------------------------------------------------------------------------
  // 8. saveDsCompareConfigs
  // -------------------------------------------------------------------------

  describe('saveDsCompareConfigs', () => {
    beforeEach(() => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockResolvedValue([]);
      mockWriteDataSource.query.mockResolvedValue([]);
    });

    it('should skip INSERT when there are no compare configs', async () => {
      await pipeline.execute({ testRunId: 'tr-001' });

      const insertCalls = mockDataSource.query.mock.calls.filter(
        (call: any[]) => String(call[0]).includes('INSERT INTO ds_compare_config')
      );
      expect(insertCalls.length).toBe(0);
    });

    it('should insert panel-level compare configs', async () => {
      mockRequestsProcessorInstance.process.mockResolvedValue({
        metrics: [],
        compareConfigs: [createMockCompareConfig({ metric_name: null })],
      });
      // Simulate RETURNING id for the INSERT
      mockDataSource.query
        .mockImplementation((sql: string) => {
          if (sql.includes('INSERT INTO ds_compare_config')) {
            return Promise.resolve([{ id: 'new-id-1' }]);
          }
          return Promise.resolve([]);
        });

      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.success).toBe(true);
      const insertCalls = mockDataSource.query.mock.calls.filter(
        (call: any[]) => String(call[0]).includes('INSERT INTO ds_compare_config')
      );
      expect(insertCalls.length).toBeGreaterThan(0);
      // Panel-level ON CONFLICT clause
      expect(String(insertCalls[0][0])).toContain('WHERE metric_name IS NULL');
    });

    it('should insert metric-specific compare configs with a different ON CONFLICT clause', async () => {
      mockRequestsProcessorInstance.process.mockResolvedValue({
        metrics: [],
        compareConfigs: [createMockCompareConfig({ metric_name: 'checkout.response_time.avg' })],
      });
      mockDataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO ds_compare_config')) {
          return Promise.resolve([{ id: 'new-id-1' }]);
        }
        return Promise.resolve([]);
      });

      await pipeline.execute({ testRunId: 'tr-001' });

      const insertCalls = mockDataSource.query.mock.calls.filter(
        (call: any[]) => String(call[0]).includes('INSERT INTO ds_compare_config')
      );
      expect(insertCalls.length).toBeGreaterThan(0);
      expect(String(insertCalls[0][0])).toContain('WHERE metric_name IS NOT NULL');
    });

    it('should log the number of created compare configs', async () => {
      mockRequestsProcessorInstance.process.mockResolvedValue({
        metrics: [],
        compareConfigs: [createMockCompareConfig()],
      });
      mockDataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO ds_compare_config')) {
          return Promise.resolve([{ id: 'new-id-1' }]);
        }
        return Promise.resolve([]);
      });

      await pipeline.execute({ testRunId: 'tr-001' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('ds_compare_config records')
      );
    });
  });

  // -------------------------------------------------------------------------
  // 9. updateDashboardPanels
  // -------------------------------------------------------------------------

  describe('updateDashboardPanels', () => {
    beforeEach(() => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      // Default: no metrics returned, so saveDsMetrics is skipped; but we can
      // still exercise updateDashboardPanels via spying on the private method
      mockRequestsProcessorInstance.process.mockResolvedValue(createProcessorResult(1));
    });

    it('should log skip message when no dashboards found for the test run', async () => {
      // saveDsMetrics will run (metrics present), then updateDashboardPanels queries dashboards
      mockDataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('DELETE FROM ds_metrics') || sql.includes('DELETE FROM ds_metric_statistics')) {
          return Promise.resolve([]);
        }
        if (sql.includes('SELECT DISTINCT ad.dashboard_uid')) {
          return Promise.resolve([]); // No dashboards
        }
        if (sql.includes('INSERT INTO ds_metric_statistics')) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });
      mockWriteDataSource.query.mockResolvedValue([]);

      await pipeline.execute({ testRunId: 'tr-001' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('No dashboards found')
      );
    });

    it('should update panels when dashboards are found', async () => {
      mockDataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT DISTINCT ad.dashboard_uid')) {
          return Promise.resolve([
            { dashboard_uid: 'perf-test-dashboard', grafana_dashboard_id: 'gd-uuid-001' },
          ]);
        }
        if (sql.includes('UPDATE grafana_dashboards')) {
          return Promise.resolve([{ id: 'gd-uuid-001', uid: 'perf-test-dashboard', panels: [{ id: 1 }] }]);
        }
        return Promise.resolve([]);
      });
      mockWriteDataSource.query.mockResolvedValue([]);

      await pipeline.execute({ testRunId: 'tr-001' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Updating panels for 1 dashboard')
      );
    });

    it('should not throw even when the UPDATE query fails (non-critical)', async () => {
      mockDataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT DISTINCT ad.dashboard_uid')) {
          return Promise.resolve([
            { dashboard_uid: 'perf-test-dashboard', grafana_dashboard_id: 'gd-uuid-001' },
          ]);
        }
        if (sql.includes('UPDATE grafana_dashboards')) {
          return Promise.reject(new Error('DB update failure'));
        }
        return Promise.resolve([]);
      });
      mockWriteDataSource.query.mockResolvedValue([]);

      // Pipeline should still succeed — updateDashboardPanels errors are swallowed
      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.success).toBe(true);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update dashboard panels'),
        expect.anything()
      );
    });
  });

  // -------------------------------------------------------------------------
  // 10. Error Handling
  // -------------------------------------------------------------------------

  describe('Error Handling', () => {
    it('should catch and return failure when requests processor throws', async () => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockResolvedValue([]);
      mockRequestsProcessorInstance.process.mockRejectedValue(new Error('Requests processor exploded'));

      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Requests processor exploded');
      expect(result.error?.code).toBe('PIPELINE_ERROR');
    });

    it('should catch and return failure when transactions processor throws', async () => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockResolvedValue([]);
      mockTransactionsProcessorInstance.process.mockRejectedValue(
        new Error('Transactions processor exploded')
      );

      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Transactions processor exploded');
    });

    it('should catch and return failure when errors processor throws', async () => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockResolvedValue([]);
      mockErrorsProcessorInstance.process.mockRejectedValue(new Error('Errors processor exploded'));

      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Errors processor exploded');
    });

    it('should catch and return failure when virtual users processor throws', async () => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockResolvedValue([]);
      mockVirtualUsersProcessorInstance.process.mockRejectedValue(
        new Error('VU processor exploded')
      );

      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('VU processor exploded');
    });

    it('should include error stack in details when the thrown value is an Error', async () => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockResolvedValue([]);
      mockRequestsProcessorInstance.process.mockRejectedValue(
        new Error('Stack trace error')
      );

      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.success).toBe(false);
      // details should contain stack trace
      expect(result.error?.details).toBeTruthy();
    });

    it('should handle non-Error thrown values gracefully', async () => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockResolvedValue([]);
      mockRequestsProcessorInstance.process.mockRejectedValue('plain string error');

      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('plain string error');
    });

    it('should log error when pipeline fails', async () => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockResolvedValue([]);
      mockRequestsProcessorInstance.process.mockRejectedValue(new Error('Boom'));

      await pipeline.execute({ testRunId: 'tr-001' });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.anything() }),
        expect.stringContaining('failed')
      );
    });
  });

  // -------------------------------------------------------------------------
  // 11. Processor Initialization
  // -------------------------------------------------------------------------

  describe('Processor Initialization', () => {
    it('should instantiate all processors with the dataSource', async () => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockResolvedValue([]);

      await pipeline.execute({ testRunId: 'tr-001' });

      expect(vi.mocked(DashboardManager as any)).toHaveBeenCalledWith(
        mockDataSource,
        mockLogger
      );
      expect(vi.mocked(RequestsProcessor as any)).toHaveBeenCalledWith(
        mockDataSource,
        mockDashboardManagerInstance,
        mockLogger
      );
      expect(vi.mocked(TransactionsProcessor as any)).toHaveBeenCalledWith(
        mockDataSource,
        mockDashboardManagerInstance,
        mockLogger
      );
      expect(vi.mocked(ErrorsProcessor as any)).toHaveBeenCalledWith(
        mockDataSource,
        mockDashboardManagerInstance,
        mockLogger
      );
      expect(vi.mocked(VirtualUsersProcessor as any)).toHaveBeenCalledWith(
        mockDataSource,
        mockDashboardManagerInstance,
        mockLogger
      );
    });
  });

  // -------------------------------------------------------------------------
  // 12. Bucket Size Calculation
  // -------------------------------------------------------------------------

  describe('Bucket Size Calculation', () => {
    it('should log bucket size based on elapsed time for full collection', async () => {
      // 1-hour test run → elapsed = 3600s
      const run = createMockTestRun({
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-01T01:00:00Z'),
      });
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(run);
      mockDataSource.query.mockResolvedValue([]);

      await pipeline.execute({ testRunId: 'tr-001' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/\d+s buckets for 3600s elapsed/)
      );
    });

    it('should default to 3600s elapsed time when test run has no endTime', async () => {
      const run = createMockTestRun({ endTime: null });
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(run);
      mockDataSource.query.mockResolvedValue([]);

      await pipeline.execute({ testRunId: 'tr-001' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/3600s elapsed/)
      );
    });

    it('should report 1s fixed buckets for incremental collection', async () => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockResolvedValue([]);

      await pipeline.execute({
        testRunId: 'tr-001',
        fromTime: new Date('2024-01-01T00:10:00Z'),
        toTime: new Date('2024-01-01T00:20:00Z'),
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('1s buckets')
      );
    });
  });

  // -------------------------------------------------------------------------
  // 13. Step Timing Log
  // -------------------------------------------------------------------------

  describe('Step Timing Logging', () => {
    it('should log timing for each pipeline step', async () => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockResolvedValue([]);
      mockRequestsProcessorInstance.process.mockResolvedValue(createProcessorResult(1));

      await pipeline.execute({ testRunId: 'tr-001' });

      // The timing header and at least one step row should appear
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Step Timing')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('requests-processor')
      );
    });
  });

  // -------------------------------------------------------------------------
  // 14. Edge Cases
  // -------------------------------------------------------------------------

  describe('Edge Cases', () => {
    it('should handle a test run with zero ramp_up time', async () => {
      const run = createMockTestRun({ analysisStartOffset: 0 });
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(run);
      mockDataSource.query.mockResolvedValue([]);

      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.success).toBe(true);
    });

    it('should handle a test run without organizationId and teamId', async () => {
      const run = createMockTestRun({ organizationId: null, teamId: null });
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(run);
      mockDataSource.query.mockResolvedValue([]);
      mockWriteDataSource.query.mockResolvedValue([]);
      mockRequestsProcessorInstance.process.mockResolvedValue(createProcessorResult(1));

      const result = await pipeline.execute({ testRunId: 'tr-no-org' });

      expect(result.success).toBe(true);
    });

    it('should handle metrics with null value (filtered in statistics)', async () => {
      const nullValueMetrics = {
        metrics: [
          createMockMetric({ ramp_up: false, value: null as any }),
        ],
        compareConfigs: [],
      };
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockResolvedValue([]);
      mockWriteDataSource.query.mockResolvedValue([]);
      mockRequestsProcessorInstance.process.mockResolvedValue(nullValueMetrics);

      await pipeline.execute({ testRunId: 'tr-001' });

      // null values are filtered before statistics — should skip statistics
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('No non-ramp-up metrics')
      );
    });

    it('should handle multiple compare configs that span both panel-level and metric-specific', async () => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO ds_compare_config')) {
          return Promise.resolve([{ id: 'new-id' }]);
        }
        return Promise.resolve([]);
      });
      mockWriteDataSource.query.mockResolvedValue([]);

      mockRequestsProcessorInstance.process.mockResolvedValue({
        metrics: [],
        compareConfigs: [
          createMockCompareConfig({ metric_name: null }),
          createMockCompareConfig({ metric_name: 'checkout.response_time.avg' }),
        ],
      });

      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.success).toBe(true);
      // Both panel-level and metric-specific INSERT calls should occur
      const insertCalls = mockDataSource.query.mock.calls.filter(
        (call: any[]) => String(call[0]).includes('INSERT INTO ds_compare_config')
      );
      expect(insertCalls.length).toBe(2);
    });

    it('should find the last value by time when a group has metrics with different timestamps', async () => {
      // Both metrics share the same group key but have different times.
      // The second one has a later timestamp → it should become the "last record".
      const multiTimeMetrics = {
        metrics: [
          createMockMetric({
            metric_name: 'checkout.response_time.avg',
            value: 100,
            time: new Date('2024-01-01T00:01:00Z'),
          }),
          createMockMetric({
            metric_name: 'checkout.response_time.avg',
            value: 200,
            time: new Date('2024-01-01T00:05:00Z'), // later
          }),
        ],
        compareConfigs: [],
      };
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockResolvedValue([]);
      mockWriteDataSource.query.mockResolvedValue([]);
      mockRequestsProcessorInstance.process.mockResolvedValue(multiTimeMetrics);

      const result = await pipeline.execute({ testRunId: 'tr-001' });

      // Verify the statistics INSERT was triggered (meaning last-record selection ran)
      const insertStatsCalls = mockDataSource.query.mock.calls.filter(
        (call: any[]) => String(call[0]).includes('INSERT INTO ds_metric_statistics')
      );
      expect(result.success).toBe(true);
      expect(insertStatsCalls.length).toBeGreaterThan(0);
    });

    it('should pass the testRunId as the first argument to each processor', async () => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockResolvedValue([]);

      await pipeline.execute({ testRunId: 'my-specific-run' });

      expect(mockRequestsProcessorInstance.process.mock.calls[0][0]).toBe('my-specific-run');
      expect(mockTransactionsProcessorInstance.process.mock.calls[0][0]).toBe('my-specific-run');
      expect(mockErrorsProcessorInstance.process.mock.calls[0][0]).toBe('my-specific-run');
      expect(mockVirtualUsersProcessorInstance.process.mock.calls[0][0]).toBe('my-specific-run');
    });
  });
});
