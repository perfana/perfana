/**
 * PerformanceTestMetricsPipeline Unit Tests
 *
 * Comprehensive test suite covering:
 * - Input validation (null, undefined, invalid types, missing fields)
 * - Full and incremental pipeline execution flows
 * - Test run metadata loading (UUID vs. name-based systemUnderTestId)
 * - Apdex threshold loading (workload, benchmark, transaction-level, with/without orgId)
 * - Metric processor orchestration (requests, transactions, errors, virtual users)
 * - saveDsMetrics: scenario-level records only; requests/transactions insert in SQL
 * - statistics upsert: SQL scoping, grouping key, ramp-up/null filtering, ON CONFLICT
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
const mockLock = { acquireKeyLock: vi.fn(async () => true), releaseKeyLock: vi.fn(async () => true) };
vi.mock('../../../config/redis-pool.js', () => ({
  acquireRedisConnection: vi.fn(async () => ({})),
  releaseRedisConnection: vi.fn(),
}));
vi.mock('../../../services/JobLockService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/JobLockService.js')>()),
  JobLockService: vi.fn(() => mockLock),
}));

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

/**
 * The requests and transactions processors write ds_metrics themselves with one
 * INSERT ... SELECT, so they report a row count instead of returning records.
 */
const createSqlProcessorResult = (rowsInserted = 0, compareConfigCount = 0) => ({
  rowsInserted,
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
      getRunMetricsSourceTypes: vi.fn().mockResolvedValue(['performance_test']),
      deletePerfTestMetricsForRun: vi.fn().mockResolvedValue({ deleted: 0, restored: 0 }),
      getCollectionStatus: vi.fn().mockResolvedValue(null),
      updateCollectedRanges: vi.fn().mockResolvedValue(undefined),
      decompressChunksForRange: vi.fn().mockResolvedValue(undefined),
      resetCollectionStatus: vi.fn().mockResolvedValue(undefined),
      markCollectionComplete: vi.fn().mockResolvedValue(undefined),
    };

    // Ensure getDatabaseService returns our mock
    vi.mocked(getDatabaseService).mockReturnValue(mockDatabaseService);

    // Default processor mock instances
    mockDashboardManagerInstance = { getResolvedDashboardIds: vi.fn(() => ['dash-1']) };
    mockRequestsProcessorInstance = { process: vi.fn().mockResolvedValue(createSqlProcessorResult()) };
    mockTransactionsProcessorInstance = { process: vi.fn().mockResolvedValue(createSqlProcessorResult()) };
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

    it('should not query the systems_under_test table for SUT id (uuid is taken from testRun)', async () => {
      const run = createMockTestRun();
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(run);
      mockDataSource.query.mockResolvedValue([]);
      mockWriteDataSource.query.mockResolvedValue([]);

      await pipeline.execute({ testRunId: 'tr-001' });

      const sutLookupCalls = mockDataSource.query.mock.calls.filter(
        (call: any[]) => /FROM\s+systems?_under_test\b/.test(String(call[0]))
      );
      expect(sutLookupCalls.length).toBe(0);
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
      mockRequestsProcessorInstance.process.mockResolvedValue(createSqlProcessorResult(3, 1));
      mockTransactionsProcessorInstance.process.mockResolvedValue(createSqlProcessorResult(2, 1));
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

      // Requests/transactions need isIncremental too: it selects INSERT vs upsert.
      expect(mockRequestsProcessorInstance.process.mock.calls[0].length).toBe(5);
      expect(mockTransactionsProcessorInstance.process.mock.calls[0]!.at(-1)).toBe(false);

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

    it('sizes a live tick from the planned duration, not from the tick window', async () => {
      // A 3 h plan calls for 60 s buckets; the ~60 s tick window used to resolve to 1 s.
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(
        createMockTestRun({ plannedDuration: 10800, completed: false })
      );

      await pipeline.execute({
        testRunId: 'tr-001',
        fromTime: new Date('2024-01-01T00:10:00Z'),
        toTime: new Date('2024-01-01T00:11:00Z'),
      });

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('60s buckets'));
      expect(mockLogger.info).not.toHaveBeenCalledWith(expect.stringContaining('1s buckets'));
    });

    it('should not use 1s buckets when the "increment" spans the whole run', async () => {
      // A force-refetch reevaluate calls the incremental path with the run's full
      // range (simple-orchestrate-reevaluate-batch.ts). 1s buckets over 3h produced
      // ~30x the rows of the full path and OOM'd the worker.
      // A completed run sizes from its actual length (3 h → 60 s), whatever it planned.
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(
        createMockTestRun({
          startTime: new Date('2024-01-01T00:00:00Z'),
          endTime: new Date('2024-01-01T03:00:00Z'),
          completed: true,
          plannedDuration: 600, // would be 5 s ticks
        })
      );

      await pipeline.execute({
        testRunId: 'tr-001',
        fromTime: new Date('2024-01-01T00:00:00Z'),
        toTime: new Date('2024-01-01T03:00:00Z'),
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('60s buckets for a 10800s window')
      );
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('5s buckets')
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

    it('should delete the run\'s perf-test rows, preserving other sources, for full-collection mode', async () => {
      mockErrorsProcessorInstance.process.mockResolvedValue(createProcessorResult(1));
      mockDatabaseService.getRunMetricsSourceTypes.mockResolvedValue(['performance_test', 'grafana']);

      await pipeline.execute({ testRunId: 'tr-001' });

      // Never the bare wholesale DELETE: this stage also runs beside gap-filled Grafana/
      // Dynatrace rows that nothing re-collects.
      expect(mockDatabaseService.deletePerfTestMetricsForRun).toHaveBeenCalledWith('tr-001', ['performance_test', 'grafana']);
      expect(mockDataSource.query.mock.calls.some((c: any[]) => String(c[0]).includes('DELETE FROM ds_metrics'))).toBe(false);
    });

    it('keeps the existing rows when there is nothing to rebuild from (SUT import without raw data)', async () => {
      mockDataSource.query.mockImplementation((sql: string) =>
        Promise.resolve(sql.includes('requests_raw') && sql.includes('EXISTS') ? [{ has_rows: false }] : [])
      );

      const result = await pipeline.execute({ testRunId: 'tr-imported' });

      expect(result.success).toBe(true);
      expect(mockDatabaseService.deletePerfTestMetricsForRun).not.toHaveBeenCalled();
      expect(mockRequestsProcessorInstance.process).not.toHaveBeenCalled();
    });

    it('should NOT delete anything for incremental mode', async () => {
      mockErrorsProcessorInstance.process.mockResolvedValue(createProcessorResult(1));

      await pipeline.execute({
        testRunId: 'tr-001',
        fromTime: new Date('2024-01-01T00:10:00Z'),
        toTime: new Date('2024-01-01T00:20:00Z'),
      });

      expect(mockDatabaseService.deletePerfTestMetricsForRun).not.toHaveBeenCalled();
    });

    it('should use ON CONFLICT upsert query for incremental mode', async () => {
      mockErrorsProcessorInstance.process.mockResolvedValue(createProcessorResult(1));

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
      mockErrorsProcessorInstance.process.mockResolvedValue(createProcessorResult(1));

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
      mockErrorsProcessorInstance.process.mockResolvedValue(createProcessorResult(1));
      // Make the actual INSERT fail
      mockWriteDataSource.query.mockRejectedValueOnce(new Error('DB write failure'));

      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Failed to save');
    });
  });

  // -------------------------------------------------------------------------
  // 7. upsertPerfTestStatistics
  // -------------------------------------------------------------------------

  describe('full-collection DELETE ordering', () => {
    beforeEach(() => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockResolvedValue([]);
      mockWriteDataSource.query.mockResolvedValue([]);
    });

    it('should delete the run\'s metrics BEFORE the processors insert', async () => {
      // The processors write as they aggregate now, so a DELETE that ran after them —
      // where it used to live, inside saveDsMetrics — would take their own rows with it.
      await pipeline.execute({ testRunId: 'tr-001' });

      expect(mockDatabaseService.deletePerfTestMetricsForRun).toHaveBeenCalledTimes(1);
      expect(mockDatabaseService.deletePerfTestMetricsForRun.mock.invocationCallOrder[0]).toBeLessThan(
        mockRequestsProcessorInstance.process.mock.invocationCallOrder[0]
      );
    });

    it('should not delete anything on an incremental tick', async () => {
      await pipeline.execute({
        testRunId: 'tr-001',
        fromTime: new Date('2024-01-01T00:10:00Z'),
        toTime: new Date('2024-01-01T00:11:00Z'),
      });

      expect(mockDatabaseService.deletePerfTestMetricsForRun).not.toHaveBeenCalled();
    });

    it('should pass isIncremental through so the processors pick INSERT vs upsert', async () => {
      await pipeline.execute({
        testRunId: 'tr-001',
        fromTime: new Date('2024-01-01T00:10:00Z'),
        toTime: new Date('2024-01-01T00:11:00Z'),
      });

      expect(mockRequestsProcessorInstance.process.mock.calls[0]!.at(-1)).toBe(true);
      expect(mockTransactionsProcessorInstance.process.mock.calls[0]!.at(-1)).toBe(true);
    });
  });

  describe('statistics upsert', () => {
    beforeEach(() => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockResolvedValue([]);
      mockWriteDataSource.query.mockResolvedValue([]);
    });

    /** The one INSERT INTO ds_metric_statistics the run issues, whitespace-normalised. */
    const statisticsSql = (): string => {
      const calls = mockDataSource.query.mock.calls.filter(
        (call: any[]) => String(call[0]).includes('INSERT INTO ds_metric_statistics')
      );
      expect(calls.length).toBe(1);
      return String(calls[0][0]).replace(/\s+/g, ' ');
    };

    it('should skip the statistics pass entirely when nothing was written', async () => {
      await pipeline.execute({ testRunId: 'tr-001' });

      const insertStatsCalls = mockDataSource.query.mock.calls.filter(
        (call: any[]) => String(call[0]).includes('INSERT INTO ds_metric_statistics')
      );
      expect(insertStatsCalls.length).toBe(0);
    });

    it('should recompute from the rows just written, scoped to this run and its dashboards', async () => {
      mockRequestsProcessorInstance.process.mockResolvedValue(createSqlProcessorResult(3));

      await pipeline.execute({ testRunId: 'tr-001' });

      const sql = statisticsSql();
      expect(sql).toContain('FROM ds_metrics m');
      expect(sql).toContain('WHERE m.test_run_id = $1');
      expect(sql).toContain('AND m.application_dashboard_id = ANY($2::uuid[])');

      const params = mockDataSource.query.mock.calls.find(
        (call: any[]) => String(call[0]).includes('INSERT INTO ds_metric_statistics')
      )![1];
      expect(params[0]).toBe('tr-001');
      expect(params[1]).toEqual(['dash-1']);
    });

    it('should exclude ramp-up and null samples, as the in-memory pass did', async () => {
      mockRequestsProcessorInstance.process.mockResolvedValue(createSqlProcessorResult(1));

      await pipeline.execute({ testRunId: 'tr-001' });

      expect(statisticsSql()).toContain('AND m.ramp_up = false AND m.value IS NOT NULL');
    });

    it('should group on the TRUNCATED metric name (issue #134)', async () => {
      // Two names whose first 255 chars match persist under the same metric_name, so
      // grouping on the raw name would emit two rows for one key and Postgres would
      // throw cardinality_violation — a single statement cannot affect a row twice.
      mockRequestsProcessorInstance.process.mockResolvedValue(createSqlProcessorResult(1));

      await pipeline.execute({ testRunId: 'tr-001' });

      expect(statisticsSql()).toContain(
        'GROUP BY m.application_dashboard_id, m.panel_id, left(m.metric_name, 255)'
      );
    });

    it('should NOT issue a DELETE before the upsert (issue #134)', async () => {
      mockRequestsProcessorInstance.process.mockResolvedValue(createSqlProcessorResult(1));

      await pipeline.execute({ testRunId: 'tr-001' });

      const deleteStatsCalls = mockDataSource.query.mock.calls.filter(
        (call: any[]) => String(call[0]).includes('DELETE FROM ds_metric_statistics')
      );
      expect(deleteStatsCalls.length).toBe(0);
    });

    it('should UPSERT statistics with ON CONFLICT DO UPDATE on the unique key (issue #134)', async () => {
      mockRequestsProcessorInstance.process.mockResolvedValue(createSqlProcessorResult(1));

      await pipeline.execute({ testRunId: 'tr-001' });

      const normalized = statisticsSql();
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

    it('should write pct_agg, which the in-memory pass left NULL', async () => {
      // ControlGroupStatisticsPipeline pools these sketches; a NULL forces the slow
      // raw-scan path and ends in ADAPT reporting INSUFFICIENT_DATA.
      mockRequestsProcessorInstance.process.mockResolvedValue(createSqlProcessorResult(1));

      await pipeline.execute({ testRunId: 'tr-001' });

      const sql = statisticsSql();
      expect(sql).toContain('percentile_agg(m.value) AS pct_agg');
      expect(sql).toMatch(/pct_agg\s*=\s*EXCLUDED\.pct_agg/);
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
      mockErrorsProcessorInstance.process.mockResolvedValue({
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
      mockErrorsProcessorInstance.process.mockResolvedValue({
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
      mockErrorsProcessorInstance.process.mockResolvedValue({
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
      mockErrorsProcessorInstance.process.mockResolvedValue(createProcessorResult(1));
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
    it('sizes a rebuild from the completed run\'s actual length', async () => {
      // 1-hour test run → 3600 s / 250 points → 15 s buckets
      const run = createMockTestRun({
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-01T01:00:00Z'),
        completed: true,
      });
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(run);
      mockDataSource.query.mockResolvedValue([]);

      await pipeline.execute({ testRunId: 'tr-001' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/15s buckets for a 3600s window/)
      );
    });

    it('falls back to 60 s buckets on a live tick when the test posted no planned duration', async () => {
      // end_time is set on a live run too (the keep-alive moves it), so it must not be used.
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(
        createMockTestRun({ completed: false, plannedDuration: undefined })
      );
      mockDataSource.query.mockResolvedValue([]);

      await pipeline.execute({
        testRunId: 'tr-001',
        fromTime: new Date('2024-01-01T00:10:00Z'),
        toTime: new Date('2024-01-01T00:11:00Z'),
      });

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('60s buckets'));
    });

    it('re-aggregates a trailing window aligned to the bucket grid on a tick', async () => {
      // 3 h plan → 60 s buckets. Tick from 00:10:30 minus 60 s overlap = 00:09:30, aligned
      // down to 00:09:00: the straddling bucket and the one before it are recomputed.
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(
        createMockTestRun({ plannedDuration: 10800, completed: false })
      );
      mockDataSource.query.mockResolvedValue([]);

      await pipeline.execute({
        testRunId: 'tr-001',
        fromTime: new Date('2024-01-01T00:10:30Z'),
        toTime: new Date('2024-01-01T00:11:30Z'),
      });

      const testRunArg = mockRequestsProcessorInstance.process.mock.calls[0][1];
      expect(testRunArg.filter_from_time).toEqual(new Date('2024-01-01T00:09:00Z'));
      expect(testRunArg.filter_to_time).toEqual(new Date('2024-01-01T00:11:30Z'));
      expect(mockRequestsProcessorInstance.process.mock.calls[0][4]).toBe(true); // upsert
    });

    it('does not widen below start_time on a full-range force re-fetch', async () => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(
        createMockTestRun({ plannedDuration: 3600, completed: true })
      );
      mockDataSource.query.mockResolvedValue([]);

      await pipeline.execute({
        testRunId: 'tr-001',
        fromTime: new Date('2024-01-01T00:00:00Z'),
        toTime: new Date('2024-01-01T01:00:00Z'),
      });

      const testRunArg = mockRequestsProcessorInstance.process.mock.calls[0][1];
      expect(testRunArg.filter_from_time).toEqual(new Date('2024-01-01T00:00:00Z'));
    });
  });

  // -------------------------------------------------------------------------
  // 12b. Full collection on a run the ticks already wrote
  // -------------------------------------------------------------------------

  describe('Full collection after live ticks', () => {
    // 1 h run with a 1 h plan: tick and final both resolve to 15 s.
    const tickedRun = () =>
      createMockTestRun({
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-01T01:00:00Z'),
        plannedDuration: 3600,
        completed: true,
      });
    const status = (lastTo: string, is_complete = false) => ({
      collected_ranges: [{ from: '2024-01-01T00:00:00Z', to: lastTo }],
      is_complete,
    });
    // Answer the grid probe; everything else (thresholds, deletes) gets an empty result.
    const onGrid = (value: boolean) =>
      mockDataSource.query.mockImplementation(async (sql: string) =>
        sql.includes('AS on_grid') ? [{ on_grid: value }] : []
      );

    beforeEach(() => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(tickedRun());
    });

    it('aggregates only the tail after the last tick and finalises the rows', async () => {
      mockDatabaseService.getCollectionStatus.mockResolvedValue(status('2024-01-01T00:58:40Z'));
      onGrid(true);
      mockErrorsProcessorInstance.process.mockResolvedValue(createProcessorResult(1));

      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.success).toBe(true);
      expect(mockDatabaseService.deletePerfTestMetricsForRun).not.toHaveBeenCalled();
      // Tail from 00:58:40 - 60 s overlap, aligned down to the 15 s grid → 00:57:30, to end_time.
      const testRunArg = mockRequestsProcessorInstance.process.mock.calls[0][1];
      expect(testRunArg.filter_from_time).toEqual(new Date('2024-01-01T00:57:30Z'));
      expect(testRunArg.filter_to_time).toEqual(new Date('2024-01-01T01:00:00Z'));
      expect(mockRequestsProcessorInstance.process.mock.calls[0][4]).toBe(true); // upsert
      // The tail's upserts and delete carry non-segmentby predicates: a late first analysis
      // on a compressed chunk would hit the DML decompression limit without this.
      expect(mockDatabaseService.decompressChunksForRange).toHaveBeenCalledWith(
        'ds_metrics', new Date('2024-01-01T00:57:30Z'), new Date('2024-01-01T01:00:00Z')
      );
      // The ticks' interim scenario-level points at start_time are dropped — after the
      // end_time points were saved, so a failed save leaves the interim point, not none.
      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM ds_metrics'),
        ['tr-001', new Date('2024-01-01T00:00:00Z'), [301, 302, 303]]
      );
      const deleteCall = mockDataSource.query.mock.calls.findIndex((c: unknown[]) => String(c[0]).includes('DELETE FROM ds_metrics'));
      const deleteOrder = mockDataSource.query.mock.invocationCallOrder[deleteCall];
      const saveOrder = mockWriteDataSource.query.mock.invocationCallOrder[0];
      expect(deleteOrder).toBeGreaterThan(saveOrder);
      // The ticks ran statistics and the panel update every minute, and statistics-calculation
      // follows in the same analyze: the tail does not re-read the whole run for either.
      expect(mockDataSource.query).not.toHaveBeenCalledWith(expect.stringContaining('ds_metric_statistics'), expect.anything());
      // The range is recorded to end_time and the run marked final so the next analyze skips.
      expect(mockDatabaseService.updateCollectedRanges).toHaveBeenCalledWith(
        'tr-001', 'performance_test', null,
        { from: new Date('2024-01-01T00:57:30Z'), to: new Date('2024-01-01T01:00:00Z') }
      );
      expect(mockDatabaseService.markCollectionComplete).toHaveBeenCalledWith('tr-001', 'performance_test', null);
      // Held the tick's key lock for the pass, so an in-flight tick cannot land after it.
      expect(mockLock.acquireKeyLock).toHaveBeenCalledWith('job:lock:perf-test-metrics:tr-001', expect.any(String), 900);
      expect(mockLock.releaseKeyLock).toHaveBeenCalled();
    });

    it('tails, not skips, when the ticks ran past end_time but nothing finalised the run', async () => {
      // A stale-closed run's end_time is its last heartbeat; the scheduler ticks on for ~30 s.
      // The recorded range therefore reaches past end_time while the scenario points are
      // still interim at start_time. Only is_complete says a full pass moved them.
      mockDatabaseService.getCollectionStatus.mockResolvedValue(status('2024-01-01T01:00:25Z'));
      onGrid(true);
      mockErrorsProcessorInstance.process.mockResolvedValue(createProcessorResult(1));

      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.data).not.toMatchObject({ skipped: 'ticks-final' });
      // Tail from end_time (clamped) minus the overlap, aligned: 00:59:00.
      const testRunArg = mockRequestsProcessorInstance.process.mock.calls[0][1];
      expect(testRunArg.filter_from_time).toEqual(new Date('2024-01-01T00:59:00Z'));
      expect(mockDataSource.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM ds_metrics'), expect.anything());
      expect(mockDatabaseService.markCollectionComplete).toHaveBeenCalled();
    });

    it('does not certify a pass that wrote nothing', async () => {
      mockDatabaseService.getCollectionStatus.mockResolvedValue(status('2024-01-01T00:58:40Z'));
      onGrid(true);

      await pipeline.execute({ testRunId: 'tr-001' });

      expect(mockDatabaseService.updateCollectedRanges).not.toHaveBeenCalled();
      expect(mockDatabaseService.markCollectionComplete).not.toHaveBeenCalled();
    });

    it('fails rather than emptying a run whose end_time is not after its start', async () => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(
        createMockTestRun({ ...tickedRun(), endTime: new Date('2024-01-01T00:00:00Z') })
      );

      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.success).toBe(false);
      expect(mockDatabaseService.deletePerfTestMetricsForRun).not.toHaveBeenCalled();
    });

    it('skips entirely when a full pass already finalised the run', async () => {
      mockDatabaseService.getCollectionStatus.mockResolvedValue(status('2024-01-01T01:00:00Z', true));
      onGrid(true);

      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ skipped: 'ticks-final' });
      expect(mockRequestsProcessorInstance.process).not.toHaveBeenCalled();
      expect(mockDatabaseService.deletePerfTestMetricsForRun).not.toHaveBeenCalled();
    });

    it('rebuilds when the ticks sized from a planned duration the run did not honour', async () => {
      // Planned 3 h (60 s ticks), aborted after 1 h (15 s final).
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(
        createMockTestRun({ ...tickedRun(), plannedDuration: 10800 })
      );
      mockDatabaseService.getCollectionStatus.mockResolvedValue(status('2024-01-01T00:58:40Z'));
      onGrid(true);
      mockErrorsProcessorInstance.process.mockResolvedValue(createProcessorResult(1));

      await pipeline.execute({ testRunId: 'tr-001' });

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('ticks wrote 60s buckets, run needs 15s'));
      expect(mockDatabaseService.deletePerfTestMetricsForRun).toHaveBeenCalled();
      // The rebuild's DELETE drops whole segments; nothing to decompress.
      expect(mockDatabaseService.decompressChunksForRange).not.toHaveBeenCalled();
      // The ticks' ranges are cleared before the DELETE, so a rebuild that dies half-way is
      // rebuilt (or tailed from start_time) next time, never tailed from the last tick.
      expect(mockDatabaseService.resetCollectionStatus).toHaveBeenCalledWith('tr-001', 'performance_test', null);
      const resetOrder = mockDatabaseService.resetCollectionStatus.mock.invocationCallOrder[0];
      const deleteOrder = mockDatabaseService.deletePerfTestMetricsForRun.mock.invocationCallOrder[0];
      expect(resetOrder).toBeLessThan(deleteOrder);
      expect(mockRequestsProcessorInstance.process.mock.calls[0][4]).toBe(false); // plain insert
      // A rebuild on a ticked run records its range too, so a re-analyse can skip.
      expect(mockDatabaseService.updateCollectedRanges).toHaveBeenCalledWith(
        'tr-001', 'performance_test', null,
        { from: new Date('2024-01-01T00:00:00Z'), to: new Date('2024-01-01T01:00:00Z') }
      );
    });

    it('rebuilds when the existing rows are off the final grid (ticks from before this rule)', async () => {
      mockDatabaseService.getCollectionStatus.mockResolvedValue(status('2024-01-01T00:58:40Z'));
      onGrid(false);

      await pipeline.execute({ testRunId: 'tr-001' });

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('not on the 15s grid'));
      expect(mockDatabaseService.deletePerfTestMetricsForRun).toHaveBeenCalled();
    });

    it('rebuilds, and records nothing, when the run was never ticked', async () => {
      mockDatabaseService.getCollectionStatus.mockResolvedValue(null);
      mockDataSource.query.mockResolvedValue([]);

      await pipeline.execute({ testRunId: 'tr-001' });

      expect(mockDatabaseService.deletePerfTestMetricsForRun).toHaveBeenCalled();
      // Creating the status row would make the orchestrator skip Grafana/Dynatrace next time.
      expect(mockDatabaseService.updateCollectedRanges).not.toHaveBeenCalled();
    });

    it('tails from start_time when the status row holds no ranges yet', async () => {
      // Registered by the scheduler but never ticked to completion: nothing to skip past,
      // so the whole run is aggregated as an upsert and recorded from its start.
      mockDatabaseService.getCollectionStatus.mockResolvedValue({ collected_ranges: [] });
      onGrid(true);

      mockErrorsProcessorInstance.process.mockResolvedValue(createProcessorResult(1));
      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.success).toBe(true);
      expect(mockDatabaseService.deletePerfTestMetricsForRun).not.toHaveBeenCalled();
      const testRunArg = mockRequestsProcessorInstance.process.mock.calls[0][1];
      expect(testRunArg.filter_from_time).toEqual(new Date('2024-01-01T00:00:00Z'));
      expect(testRunArg.filter_to_time).toEqual(new Date('2024-01-01T01:00:00Z'));
      expect(mockRequestsProcessorInstance.process.mock.calls[0][4]).toBe(true);
      expect(mockDatabaseService.updateCollectedRanges).toHaveBeenCalledWith(
        'tr-001', 'performance_test', null,
        { from: new Date('2024-01-01T00:00:00Z'), to: new Date('2024-01-01T01:00:00Z') }
      );
    });

    it('skips a re-analyse of an aborted run once its rebuild recorded the range', async () => {
      // Planned 3 h (60 s ticks), ran 1 h (15 s final): the first analyze rebuilt and
      // marked the run final. The tick/final mismatch must not force a second rebuild —
      // the rows are on the 15 s grid, so is_complete is what decides.
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(
        createMockTestRun({ ...tickedRun(), plannedDuration: 10800 })
      );
      mockDatabaseService.getCollectionStatus.mockResolvedValue(status('2024-01-01T01:00:00Z', true));
      onGrid(true);

      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.data).toMatchObject({ skipped: 'ticks-final' });
      expect(mockDatabaseService.deletePerfTestMetricsForRun).not.toHaveBeenCalled();
      expect(mockRequestsProcessorInstance.process).not.toHaveBeenCalled();
    });

    it('probes the grid with the run start, the scenario panels and the final bucket size', async () => {
      mockDatabaseService.getCollectionStatus.mockResolvedValue(status('2024-01-01T00:58:40Z'));
      onGrid(true);

      await pipeline.execute({ testRunId: 'tr-001' });

      const probe = mockDataSource.query.mock.calls.find((c: any[]) => String(c[0]).includes('AS on_grid'));
      expect(probe).toBeDefined();
      // Filters on the loaded run's canonical test_run_id (the interim DELETE and the
      // collected-range write use the job's input id; callers pass the canonical id).
      expect(probe![1]).toEqual(['test-run-uuid-001', new Date('2024-01-01T00:00:00Z'), [301, 302, 303], 15]);
      // The scenario-level panels are exempt: their single point is not on the grid by design.
      expect(String(probe![0])).toContain('m.panel_id <> ALL($3::int[])');
    });

    it('falls to a rebuild when the grid probe answers nothing (fails closed)', async () => {
      mockDatabaseService.getCollectionStatus.mockResolvedValue(status('2024-01-01T00:58:40Z'));
      mockDataSource.query.mockResolvedValue([]);

      await pipeline.execute({ testRunId: 'tr-001' });

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('not on the 15s grid'));
      expect(mockDatabaseService.deletePerfTestMetricsForRun).toHaveBeenCalled();
      expect(mockRequestsProcessorInstance.process.mock.calls[0][4]).toBe(false);
    });

    it('rebuilds without consulting the status row when the run is not completed', async () => {
      // An analyze on a run that was never marked completed (aborted, stale-closed) has no
      // final bucket size, so the ticks cannot be certified; the status row is not even read.
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(
        createMockTestRun({ ...tickedRun(), completed: false })
      );
      mockDatabaseService.getCollectionStatus.mockResolvedValue(status('2024-01-01T00:58:40Z'));
      mockDataSource.query.mockResolvedValue([]);

      await pipeline.execute({ testRunId: 'tr-001' });

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('run not completed'));
      expect(mockDatabaseService.getCollectionStatus).not.toHaveBeenCalled();
      expect(mockDatabaseService.deletePerfTestMetricsForRun).toHaveBeenCalled();
      expect(mockRequestsProcessorInstance.process.mock.calls[0][4]).toBe(false);
      // Nothing is certified: the next analyze has to decide again.
      expect(mockDatabaseService.updateCollectedRanges).not.toHaveBeenCalled();
    });

    it('sizes an uncompleted run without an end_time from the tick rule', async () => {
      // No planned duration and no end_time: 60 s fallback, window measured to now.
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(
        createMockTestRun({ endTime: null, completed: false, plannedDuration: null })
      );
      mockDataSource.query.mockResolvedValue([]);

      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.success).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('run not completed'));
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('60s buckets'));
    });
  });

  // -------------------------------------------------------------------------
  // 12c. Incremental tick and force re-fetch contracts
  // -------------------------------------------------------------------------

  describe('Incremental tick and force re-fetch', () => {
    beforeEach(() => {
      mockDataSource.query.mockResolvedValue([]);
      mockWriteDataSource.query.mockResolvedValue([]);
    });

    it('does not read or record the collection status on a live tick', async () => {
      // The scheduler records the tick's range itself; recording it here too would
      // certify the run as final before its end_time is known.
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(
        createMockTestRun({ plannedDuration: 3600, completed: false })
      );
      mockDatabaseService.getCollectionStatus.mockResolvedValue({
        collected_ranges: [{ from: '2024-01-01T00:00:00Z', to: '2024-01-01T00:10:00Z' }],
      });

      await pipeline.execute({
        testRunId: 'tr-001',
        fromTime: new Date('2024-01-01T00:10:00Z'),
        toTime: new Date('2024-01-01T00:11:00Z'),
      });

      expect(mockDatabaseService.getCollectionStatus).not.toHaveBeenCalled();
      expect(mockDatabaseService.updateCollectedRanges).not.toHaveBeenCalled();
    });

    it('does not drop the interim scenario points on a tick', async () => {
      // Only the final pass moves them to end_time; a tick upserts over the same
      // start_time row and must leave it in place.
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(
        createMockTestRun({ plannedDuration: 3600, completed: false })
      );
      mockErrorsProcessorInstance.process.mockResolvedValue(createProcessorResult(1));

      await pipeline.execute({
        testRunId: 'tr-001',
        fromTime: new Date('2024-01-01T00:10:00Z'),
        toTime: new Date('2024-01-01T00:11:00Z'),
      });

      expect(
        mockDataSource.query.mock.calls.some((c: any[]) => String(c[0]).includes('DELETE FROM ds_metrics'))
      ).toBe(false);
    });

    it('hands the scenario processors a completed run on a force re-fetch, so they write at end_time', async () => {
      // A force re-fetch is an "incremental" call over the whole run. The processors are
      // mocked here; what matters is that `completed` reaches them, since that is what
      // scenarioMetricTime keys on, and that the window is the whole run.
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(
        createMockTestRun({ plannedDuration: 3600, completed: true })
      );

      await pipeline.execute({
        testRunId: 'tr-001',
        fromTime: new Date('2024-01-01T00:00:00Z'),
        toTime: new Date('2024-01-01T01:00:00Z'),
      });

      for (const instance of [mockErrorsProcessorInstance, mockVirtualUsersProcessorInstance]) {
        const testRunArg = instance.process.mock.calls[0][1];
        expect(testRunArg.completed).toBe(true);
        expect(testRunArg.end_time).toEqual(new Date('2024-01-01T01:00:00Z'));
        expect(testRunArg.filter_from_time).toEqual(new Date('2024-01-01T00:00:00Z'));
        expect(testRunArg.filter_to_time).toEqual(new Date('2024-01-01T01:00:00Z'));
      }
      // Rows for the window already exist, so this is an upsert, never a delete.
      expect(mockDatabaseService.deletePerfTestMetricsForRun).not.toHaveBeenCalled();
      expect(mockRequestsProcessorInstance.process.mock.calls[0][4]).toBe(true);
      expect(mockDatabaseService.updateCollectedRanges).not.toHaveBeenCalled();
    });

    it('hands the scenario processors a live run on a tick, so they write at start_time', async () => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(
        createMockTestRun({ plannedDuration: 3600, completed: false })
      );

      await pipeline.execute({
        testRunId: 'tr-001',
        fromTime: new Date('2024-01-01T00:10:00Z'),
        toTime: new Date('2024-01-01T00:11:00Z'),
      });

      const testRunArg = mockVirtualUsersProcessorInstance.process.mock.calls[0][1];
      expect(testRunArg.completed).toBe(false);
      expect(testRunArg.start_time).toEqual(new Date('2024-01-01T00:00:00Z'));
    });
  });

  // -------------------------------------------------------------------------
  // 13. Step Timing Log
  // -------------------------------------------------------------------------

  describe('Step Timing Logging', () => {
    it('should log timing for each pipeline step', async () => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockResolvedValue([]);
      mockErrorsProcessorInstance.process.mockResolvedValue(createProcessorResult(1));

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
      mockErrorsProcessorInstance.process.mockResolvedValue(createProcessorResult(1));

      const result = await pipeline.execute({ testRunId: 'tr-no-org' });

      expect(result.success).toBe(true);
    });

    it('should still write a metric whose value is null', async () => {
      // The row is stored; the statistics pass excludes it in SQL rather than in JS.
      const nullValueMetrics = {
        metrics: [
          createMockMetric({ ramp_up: false, value: null as any }),
        ],
        compareConfigs: [],
      };
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockResolvedValue([]);
      mockWriteDataSource.query.mockResolvedValue([]);
      mockErrorsProcessorInstance.process.mockResolvedValue(nullValueMetrics);

      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.success).toBe(true);
      const statsSql = String(
        mockDataSource.query.mock.calls.find(
          (call: any[]) => String(call[0]).includes('INSERT INTO ds_metric_statistics')
        )![0]
      ).replace(/\s+/g, ' ');
      expect(statsSql).toContain('m.value IS NOT NULL');
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

      mockErrorsProcessorInstance.process.mockResolvedValue({
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

    it('should take the last value by time from the aggregate, not a lateral probe', async () => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
      mockDataSource.query.mockResolvedValue([]);
      mockWriteDataSource.query.mockResolvedValue([]);
      mockErrorsProcessorInstance.process.mockResolvedValue(createProcessorResult(2));

      const result = await pipeline.execute({ testRunId: 'tr-001' });

      expect(result.success).toBe(true);
      const statsSql = String(
        mockDataSource.query.mock.calls.find(
          (call: any[]) => String(call[0]).includes('INSERT INTO ds_metric_statistics')
        )![0]
      ).replace(/\s+/g, ' ');
      // The FILTER is load-bearing: unlike every other aggregate, last() returns the
      // value AT the greatest time even when that value is NULL.
      expect(statsSql).toContain('last(m.value, m.time) FILTER (WHERE m.value IS NOT NULL)');
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
