/**
 * MetricsPipeline Unit Tests
 *
 * Tests the MetricsPipeline class functionality including:
 * - Pipeline execution flow
 * - Input validation and parsing
 * - Grafana client initialization and querying
 * - Panel filtering (benchmarksOnly flag)
 * - Metrics transformation and flattening
 * - Database operations (batch inserts, UPSERT)
 * - Error handling
 * - Stale data cleanup
 */

import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { MetricsPipeline } from '../../../pipelines/MetricsPipeline.js';
import { PanelDocument, PanelMetricsDocument } from '../../../types/pipeline.js';
import { getLogger } from '../../../lib/utils/logger.js';
import * as grafanaConfigCache from '../../../config/grafana-config-cache.js';
import * as grafanaClientFactory from '../../../config/grafana-client-factory.js';
import * as databaseAccessor from '../../../common/database-accessor.js';
import { EntityManager } from 'typeorm';

// Mock dependencies
vi.mock('../../../lib/utils/logger.js');
vi.mock('../../../config/grafana-config-cache.js');
vi.mock('../../../config/grafana-client-factory.js');
vi.mock('../../../common/database-accessor.js');
vi.mock('@perfana/shared/services/grafana', () => ({
  GrafanaClient: vi.fn()
}));

describe('MetricsPipeline', () => {
  let pipeline: MetricsPipeline;
  let mockLogger: any;
  let mockDb: any;
  let mockGrafanaClient: any;
  let mockEntityManager: any;

  const createMockTestRun = () => ({
    id: 'test-uuid-123',
    testRunId: 'test-run-001',
    systemUnderTestId: 'system-001',
    workload: 'load-test',
    testEnvironment: 'production',
    startTime: new Date('2024-01-01T00:00:00Z'),
    endTime: new Date('2024-01-01T01:00:00Z'),
    createdAt: new Date(),
    updatedAt: new Date()
  });

  const createMockPanel = (overrides?: Partial<PanelDocument>): PanelDocument => ({
    test_run_id: 'test-run-001',
    application_dashboard_id: 'app-dash-001',
    dashboard_uid: 'dash-uid-001',
    panel_id: 1,
    panel_title: 'Test Panel',
    dashboard_label: 'Test Dashboard',
    benchmark_ids: null,
    panel: { id: 1, title: 'Test Panel' },
    errors: null,
    requests: [],
    updated_at: new Date(),
    ...overrides
  });

  const createMockMetricsDocument = (overrides?: Partial<PanelMetricsDocument>): PanelMetricsDocument => ({
    test_run_id: 'test-run-001',
    application_dashboard_id: 'app-dash-001',
    dashboard_uid: 'dash-uid-001',
    panel_id: 1,
    panel_title: 'Test Panel',
    dashboard_label: 'Test Dashboard',
    benchmark_ids: null,
    errors: null,
    data: [
      {
        metric_name: 'test_metric',
        time: new Date('2024-01-01T00:00:00Z'),
        timestep: 0,
        ramp_up: false,
        value: 100,
        unit: 'ms'
      }
    ],
    updated_at: new Date(),
    ...overrides
  });

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Setup mock logger
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    };
    vi.mocked(getLogger).mockReturnValue(mockLogger as any);

    // Setup mock Grafana config
    vi.mocked(grafanaConfigCache.getGrafanaConfig).mockResolvedValue({
      url: 'http://grafana.test',
      apiKey: 'test-api-key',
      orgId: '1'
    });
    // Default: Grafana is configured. The soft-skip test (issue #282) overrides
    // this to null per-test.
    vi.mocked(grafanaConfigCache.tryGetGrafanaConfig).mockResolvedValue({
      url: 'http://grafana.test',
      apiKey: 'test-api-key',
      orgId: '1'
    });

    // Setup mock Grafana client
    mockGrafanaClient = {
      queryPanelData: vi.fn().mockResolvedValue([])
    };

    // Mock GrafanaClient constructor
    const { GrafanaClient } = vi.mocked(await import('@perfana/shared/services/grafana'));
    GrafanaClient.mockImplementation(() => mockGrafanaClient);

    // Route per-instance grouping to the single mock client (one default-instance group).
    vi.mocked(grafanaClientFactory.groupPanelsByGrafanaInstance).mockImplementation(
      async (_db, panels) => panels.length
        ? [{ instanceId: null, client: mockGrafanaClient, panels }]
        : []
    );

    // Setup mock entity manager
    mockEntityManager = {
      query: vi.fn().mockResolvedValue([])
    };

    // Setup mock database service
    mockDb = {
      getTestRunByTestRunId: vi.fn(),
      getDsPanelsByTestRun: vi.fn(),
      transaction: vi.fn((fn) => fn(mockEntityManager)),
      writeTransaction: vi.fn((fn) => fn(mockEntityManager)),
      query: vi.fn().mockResolvedValue([undefined, 0]) // Mock cleanup query
    };

    vi.mocked(databaseAccessor.getDatabaseService).mockReturnValue(mockDb as any);

    // Create pipeline instance
    pipeline = new MetricsPipeline(mockLogger);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Input Validation', () => {
    test('should validate valid input with testRunId', async () => {
      mockDb.getTestRunByTestRunId.mockResolvedValue(null); // Will fail but validation passes

      const result = await pipeline.execute({
        testRunId: 'test-run-001'
      });

      expect(result.success).toBe(false); // Fails because test run not found
      expect(result.error?.message).toContain('Test run not found');
    });

    test('should validate input with benchmarksOnly flag', async () => {
      mockDb.getTestRunByTestRunId.mockResolvedValue(null);

      const result = await pipeline.execute({
        testRunId: 'test-run-001',
        benchmarksOnly: true
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Test run not found');
    });

    test('should validate input with panelDocuments', async () => {
      mockDb.getTestRunByTestRunId.mockResolvedValue(null);

      const result = await pipeline.execute({
        testRunId: 'test-run-001',
        panelDocuments: [createMockPanel()]
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Test run not found');
    });

    test('should reject null input', async () => {
      const result = await pipeline.execute(null);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid input: must be an object');
    });

    test('should reject undefined input', async () => {
      const result = await pipeline.execute(undefined);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid input: must be an object');
    });

    test('should reject non-object input', async () => {
      const result = await pipeline.execute('string-input');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid input: must be an object');
    });

    test('should reject input without testRunId', async () => {
      const result = await pipeline.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('testRunId is required');
    });

    test('should reject input with invalid testRunId type', async () => {
      const result = await pipeline.execute({ testRunId: 123 });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('testRunId is required and must be a string');
    });

    test('should reject input with empty testRunId', async () => {
      const result = await pipeline.execute({ testRunId: '' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('testRunId is required and must be a string');
    });

    test('should convert benchmarksOnly to boolean', async () => {
      const mockTestRun = createMockTestRun();
      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue([]);

      await pipeline.execute({
        testRunId: 'test-run-001',
        benchmarksOnly: 'true' as any // String should be converted to boolean
      });

      expect(mockDb.getDsPanelsByTestRun).toHaveBeenCalled();
    });
  });

  describe('Soft-skip when no Grafana configured (issue #282)', () => {
    test('returns success with skipped marker and does not query Grafana or DB', async () => {
      vi.mocked(grafanaConfigCache.tryGetGrafanaConfig).mockResolvedValueOnce(null);

      const result = await pipeline.execute({ testRunId: 'test-run-no-grafana' });

      expect(result.success).toBe(true);
      expect((result.data as any)?.skipped).toBe('no-grafana-configured');

      // Must short-circuit before client init, panel load, and Grafana queries
      // — otherwise downstream stages get aborted on stacks with no Grafana.
      expect(grafanaConfigCache.getGrafanaConfig).not.toHaveBeenCalled();
      expect(mockDb.getTestRunByTestRunId).not.toHaveBeenCalled();
      expect(mockDb.getDsPanelsByTestRun).not.toHaveBeenCalled();
      expect(mockGrafanaClient.queryPanelData).not.toHaveBeenCalled();
    });

    test('still fails (returns error result) when Grafana row is invalid', async () => {
      vi.mocked(grafanaConfigCache.tryGetGrafanaConfig).mockRejectedValueOnce(
        new Error('Grafana config not available. A grafana_instances row exists but is invalid')
      );

      const result = await pipeline.execute({ testRunId: 'test-run-invalid-grafana' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/invalid/i);
    });
  });

  describe('Pipeline Execution - Happy Path', () => {
    test('should execute successfully with panels', async () => {
      const mockTestRun = createMockTestRun();
      const mockPanels = [createMockPanel()];
      const mockMetricsDoc = createMockMetricsDocument();

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);
      mockGrafanaClient.queryPanelData.mockResolvedValue([mockMetricsDoc]);

      const result = await pipeline.execute({
        testRunId: 'test-run-001'
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        testRunId: 'test-run-001',
        metricsCollected: 1,
        dataPoints: 1,
        panels: 1,
        processedPanels: 1,
        benchmarksOnly: false
      });
    });

    test('should execute successfully with benchmark-only panels', async () => {
      const mockTestRun = createMockTestRun();
      const mockPanels = [
        createMockPanel({ benchmark_ids: ['benchmark-001'] }),
        createMockPanel({ benchmark_ids: null })
      ];
      const mockMetricsDoc = createMockMetricsDocument();

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);
      mockGrafanaClient.queryPanelData.mockResolvedValue([mockMetricsDoc]);

      const result = await pipeline.execute({
        testRunId: 'test-run-001',
        benchmarksOnly: true
      });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        panels: 2,
        processedPanels: 1, // Only one has benchmark_ids
        benchmarksOnly: true
      });
    });

    test('should use provided panelDocuments instead of loading from DB', async () => {
      const mockTestRun = createMockTestRun();
      const providedPanels = [createMockPanel()];
      const mockMetricsDoc = createMockMetricsDocument();

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockGrafanaClient.queryPanelData.mockResolvedValue([mockMetricsDoc]);

      await pipeline.execute({
        testRunId: 'test-run-001',
        panelDocuments: providedPanels
      });

      expect(mockDb.getDsPanelsByTestRun).not.toHaveBeenCalled();
      expect(mockGrafanaClient.queryPanelData).toHaveBeenCalled();
    });

    test('should handle multiple data points in metrics', async () => {
      const mockTestRun = createMockTestRun();
      const mockPanels = [createMockPanel()];
      const mockMetricsDoc = createMockMetricsDocument({
        data: [
          { metric_name: 'm1', time: new Date(), timestep: 0, ramp_up: false, value: 100, unit: 'ms' },
          { metric_name: 'm2', time: new Date(), timestep: 1, ramp_up: false, value: 200, unit: 'ms' },
          { metric_name: 'm3', time: new Date(), timestep: 2, ramp_up: false, value: 300, unit: 'ms' }
        ]
      });

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);
      mockGrafanaClient.queryPanelData.mockResolvedValue([mockMetricsDoc]);

      const result = await pipeline.execute({
        testRunId: 'test-run-001'
      });

      expect(result.success).toBe(true);
      expect(result.data?.dataPoints).toBe(3);
    });
  });

  describe('Pipeline Execution - Edge Cases', () => {
    test('should handle test run not found', async () => {
      mockDb.getTestRunByTestRunId.mockResolvedValue(null);

      const result = await pipeline.execute({
        testRunId: 'non-existent-test-run'
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Test run not found');
      expect(result.error?.code).toBe('METRICS_COLLECTION_ERROR');
    });

    test('should handle no panels found', async () => {
      const mockTestRun = createMockTestRun();
      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue([]);

      const result = await pipeline.execute({
        testRunId: 'test-run-001'
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        testRunId: 'test-run-001',
        metricsCollected: 0,
        panels: 0
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No panel documents found')
      );
    });

    test('should handle benchmarksOnly with no matching panels', async () => {
      const mockTestRun = createMockTestRun();
      const mockPanels = [
        createMockPanel({ benchmark_ids: null }),
        createMockPanel({ benchmark_ids: undefined })
      ];

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);

      const result = await pipeline.execute({
        testRunId: 'test-run-001',
        benchmarksOnly: true
      });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        testRunId: 'test-run-001',
        metricsCollected: 0,
        dataPoints: 0,
        panels: 2,
        processedPanels: 0
      });
    });

    test('should handle panels with errors from previous runs', async () => {
      const mockTestRun = createMockTestRun();
      const mockPanels = [
        createMockPanel({
          errors: [{ target_index: 0, message: 'Previous error', type: 'query_error' }]
        })
      ];

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);

      const result = await pipeline.execute({
        testRunId: 'test-run-001'
      });

      expect(result.success).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Skipping storage for 1 panels with existing errors')
      );
    });

    test('should handle metrics document with errors', async () => {
      const mockTestRun = createMockTestRun();
      const mockPanels = [createMockPanel()];
      const mockMetricsDoc = createMockMetricsDocument({
        errors: [{ target_index: 0, message: 'Grafana error', type: 'api_error' }]
      });

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);
      mockGrafanaClient.queryPanelData.mockResolvedValue([mockMetricsDoc]);

      const result = await pipeline.execute({
        testRunId: 'test-run-001'
      });

      expect(result.success).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Skipping storage for panel')
      );
    });

    test('should handle empty metrics data', async () => {
      const mockTestRun = createMockTestRun();
      const mockPanels = [createMockPanel()];
      const mockMetricsDoc = createMockMetricsDocument({ data: [] });

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);
      mockGrafanaClient.queryPanelData.mockResolvedValue([mockMetricsDoc]);

      const result = await pipeline.execute({
        testRunId: 'test-run-001'
      });

      expect(result.success).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('query returned empty results'),
        expect.any(Object)
      );
    });

    test('should handle panels with null/undefined fields', async () => {
      const mockTestRun = createMockTestRun();
      const dbPanels = [
        {
          test_run_id: 'test-run-001',
          application_dashboard_id: 'app-dash-001',
          dashboard_uid: null,
          panel_id: null,
          panel_title: null,
          dashboard_label: null,
          benchmark_ids: null,
          panel: { id: 1 },
          errors: null,
          requests: null,
          updated_at: new Date()
        }
      ];

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(dbPanels);
      mockGrafanaClient.queryPanelData.mockResolvedValue([]);

      const result = await pipeline.execute({
        testRunId: 'test-run-001'
      });

      expect(result.success).toBe(true);
      // Verify defaults are applied
      expect(mockGrafanaClient.queryPanelData).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            dashboard_uid: '',
            panel_id: 0,
            panel_title: '',
            dashboard_label: '',
            requests: []
          })
        ]),
        expect.any(Object)
      );
    });
  });

  describe('Grafana Client Operations', () => {
    test('groups panels by Grafana instance before querying', async () => {
      const mockTestRun = createMockTestRun();
      const mockPanels = [createMockPanel()];

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);
      mockGrafanaClient.queryPanelData.mockResolvedValue([]);

      await pipeline.execute({ testRunId: 'test-run-001' });

      // Client is resolved per instance via the factory, not a single process-wide client.
      expect(grafanaClientFactory.groupPanelsByGrafanaInstance).toHaveBeenCalled();
      expect(mockGrafanaClient.queryPanelData).toHaveBeenCalled();
    });

    test('should handle Grafana client not initialized', async () => {
      const mockTestRun = createMockTestRun();
      const mockPanels = [createMockPanel()];

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);

      // Force Grafana client to be null
      mockGrafanaClient.queryPanelData.mockRejectedValue(new Error('Grafana client not initialized'));

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      expect(result.success).toBe(true); // Pipeline continues, just logs error
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should handle Grafana API timeout', async () => {
      const mockTestRun = createMockTestRun();
      const mockPanels = [createMockPanel()];

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);
      mockGrafanaClient.queryPanelData.mockRejectedValue(new Error('Request timeout'));

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      expect(result.success).toBe(true);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Grafana query failed'),
        expect.any(Error)
      );
    });

    test('should handle Grafana API network error', async () => {
      const mockTestRun = createMockTestRun();
      const mockPanels = [createMockPanel()];

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);
      mockGrafanaClient.queryPanelData.mockRejectedValue(new Error('Network error'));

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      expect(result.success).toBe(true);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Grafana query failed'),
        expect.any(Error)
      );
    });
  });

  describe('Database Operations', () => {
    test('should save metrics to database with batch insert', async () => {
      const mockTestRun = createMockTestRun();
      const mockPanels = [createMockPanel()];
      const mockMetricsDoc = createMockMetricsDocument();

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);
      mockGrafanaClient.queryPanelData.mockResolvedValue([mockMetricsDoc]);

      await pipeline.execute({ testRunId: 'test-run-001' });

      expect(mockDb.writeTransaction).toHaveBeenCalled();
      expect(mockEntityManager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ds_metrics'),
        expect.any(Array)
      );
    });

    test('should use UPSERT pattern for duplicate metrics', async () => {
      const mockTestRun = createMockTestRun();
      const mockPanels = [createMockPanel()];
      const mockMetricsDoc = createMockMetricsDocument();

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);
      mockGrafanaClient.queryPanelData.mockResolvedValue([mockMetricsDoc]);

      await pipeline.execute({ testRunId: 'test-run-001' });

      expect(mockEntityManager.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT'),
        expect.any(Array)
      );
      expect(mockEntityManager.query).toHaveBeenCalledWith(
        expect.stringContaining('DO UPDATE SET'),
        expect.any(Array)
      );
    });

    test('should batch large metric sets', async () => {
      const mockTestRun = createMockTestRun();
      const mockPanels = [createMockPanel()];

      // Create 250 metrics to trigger batching (batch size is 200)
      const largeMetricsData = Array.from({ length: 250 }, (_, i) => ({
        metric_name: `metric_${i}`,
        time: new Date(),
        timestep: i,
        ramp_up: false,
        value: i * 10,
        unit: 'ms'
      }));

      const mockMetricsDoc = createMockMetricsDocument({ data: largeMetricsData });

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);
      mockGrafanaClient.queryPanelData.mockResolvedValue([mockMetricsDoc]);

      await pipeline.execute({ testRunId: 'test-run-001' });

      // Should call query twice (batch 1: 200 records, batch 2: 50 records)
      expect(mockEntityManager.query).toHaveBeenCalledTimes(2);
    });

    test('should clean up stale application dashboards', async () => {
      const mockTestRun = createMockTestRun();
      const mockPanels = [createMockPanel()];

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);
      mockDb.query.mockResolvedValue([undefined, 5]); // 5 rows deleted

      await pipeline.execute({ testRunId: 'test-run-001' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM ds_metrics')
      );
    });

    test('should handle database insert error', async () => {
      const mockTestRun = createMockTestRun();
      const mockPanels = [createMockPanel()];
      const mockMetricsDoc = createMockMetricsDocument();

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);
      mockGrafanaClient.queryPanelData.mockResolvedValue([mockMetricsDoc]);
      mockEntityManager.query.mockRejectedValue(new Error('Database insert failed'));

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Database insert failed');
    });

    test('should rollback transaction on error', async () => {
      const mockTestRun = createMockTestRun();
      const mockPanels = [createMockPanel()];
      const mockMetricsDoc = createMockMetricsDocument();

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);
      mockGrafanaClient.queryPanelData.mockResolvedValue([mockMetricsDoc]);

      // Mock writeTransaction to actually call the callback
      mockDb.writeTransaction.mockImplementation(async (fn) => {
        try {
          return await fn(mockEntityManager);
        } catch (error) {
          // Transaction should rollback automatically
          throw error;
        }
      });

      mockEntityManager.query.mockRejectedValue(new Error('Insert failed'));

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      expect(result.success).toBe(false);
      expect(mockDb.writeTransaction).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    test('should provide detailed error information', async () => {
      mockDb.getTestRunByTestRunId.mockRejectedValue(new Error('Database connection failed'));

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      expect(result.success).toBe(false);
      expect(result.error).toEqual({
        message: 'Database connection failed',
        code: 'METRICS_COLLECTION_ERROR',
        details: { testRunId: 'test-run-001' }
      });
    });

    test('should log errors with context', async () => {
      mockDb.getTestRunByTestRunId.mockRejectedValue(new Error('Test error'));

      await pipeline.execute({ testRunId: 'test-run-001' });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Metrics collection failed')
      );
    });

    test('should handle unexpected errors gracefully', async () => {
      mockDb.getTestRunByTestRunId.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Unexpected error');
    });

    test('should handle non-Error exceptions', async () => {
      mockDb.getTestRunByTestRunId.mockRejectedValue('String error');

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Performance and Logging', () => {
    test('should log performance metrics', async () => {
      const mockTestRun = createMockTestRun();
      const mockPanels = [createMockPanel()];
      const mockMetricsDoc = createMockMetricsDocument();

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);
      mockGrafanaClient.queryPanelData.mockResolvedValue([mockMetricsDoc]);

      await pipeline.execute({ testRunId: 'test-run-001' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Starting metrics collection')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Metrics collection completed')
      );
    });

    test('should include duration in result', async () => {
      const mockTestRun = createMockTestRun();
      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue([]);

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      // Duration is set by BasePipelineTypeORM, which is mocked in these tests
      expect(result.success).toBe(true);
    });

    test('should log panel processing counts', async () => {
      const mockTestRun = createMockTestRun();
      const mockPanels = [createMockPanel(), createMockPanel({ panel_id: 2 })];

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);
      mockGrafanaClient.queryPanelData.mockResolvedValue([]);

      await pipeline.execute({ testRunId: 'test-run-001' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Processing 2 panels')
      );
    });

    test('should log metrics saved count', async () => {
      const mockTestRun = createMockTestRun();
      const mockPanels = [createMockPanel()];
      const mockMetricsDoc = createMockMetricsDocument({
        data: [
          { metric_name: 'm1', time: new Date(), timestep: 0, ramp_up: false, value: 100, unit: 'ms' },
          { metric_name: 'm2', time: new Date(), timestep: 1, ramp_up: false, value: 200, unit: 'ms' }
        ]
      });

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);
      mockGrafanaClient.queryPanelData.mockResolvedValue([mockMetricsDoc]);

      await pipeline.execute({ testRunId: 'test-run-001' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Saved 2 metric records')
      );
    });
  });

  describe('effectiveEndTime / ramp_down end-exclusion (analysisEndOffset)', () => {
    test('when ramp_down > 0, Grafana query end_time is clipped by rampDownSeconds', async () => {
      // testRun: 60-minute window, 5-minute (300s) ramp_down
      const mockTestRun = {
        ...createMockTestRun(),
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime:   new Date('2024-01-01T01:00:00Z'),
        analysisEndOffset: 300, // 5 minutes
      };
      const mockPanels = [createMockPanel()];

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);
      mockGrafanaClient.queryPanelData.mockResolvedValue([]);

      await pipeline.execute({ testRunId: 'test-run-001' });

      // The end_time passed to queryPanelData must be 5 minutes before the real endTime
      const expectedClippedEnd = new Date('2024-01-01T00:55:00Z');
      expect(mockGrafanaClient.queryPanelData).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          end_time: expectedClippedEnd,
          ramp_down: 300,
        }),
      );
    });

    test('when ramp_down = 0, end_time is unchanged', async () => {
      const mockTestRun = {
        ...createMockTestRun(),
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime:   new Date('2024-01-01T01:00:00Z'),
        analysisEndOffset: 0,
      };
      const mockPanels = [createMockPanel()];

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);
      mockGrafanaClient.queryPanelData.mockResolvedValue([]);

      await pipeline.execute({ testRunId: 'test-run-001' });

      expect(mockGrafanaClient.queryPanelData).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          end_time: new Date('2024-01-01T01:00:00Z'),
          ramp_down: 0,
        }),
      );
    });

    test('data points in the tail (after effectiveEndTime) are marked ramp_up = true in flattened records', async () => {
      // 60-minute test run, 5-minute ramp_down → effectiveEndTime = T+55min
      // Data point at T+57min (3420s) is in the tail → ramp_up should be true
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime   = new Date('2024-01-01T01:00:00Z');
      const mockTestRun = {
        ...createMockTestRun(),
        startTime,
        endTime,
        analysisEndOffset: 300, // 5 minutes
        analysisStartOffset: 0,
      };
      const mockPanels = [createMockPanel()];

      // Data point at T+57min → inside the ramp_down tail
      const tailTime = new Date(startTime.getTime() + 57 * 60 * 1000);
      // Data point at T+30min → within analysis window
      const midTime  = new Date(startTime.getTime() + 30 * 60 * 1000);

      const mockMetricsDoc = createMockMetricsDocument({
        data: [
          { metric_name: 'tail_metric', time: tailTime, timestep: 3420, ramp_up: false, value: 99, unit: 'ms' },
          { metric_name: 'mid_metric',  time: midTime,  timestep: 1800, ramp_up: false, value: 42, unit: 'ms' },
        ],
      });

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);
      mockGrafanaClient.queryPanelData.mockResolvedValue([mockMetricsDoc]);

      await pipeline.execute({ testRunId: 'test-run-001' });

      // The INSERT call should have the tail metric with ramp_up = true
      // and the mid metric with ramp_up = false
      const insertCalls = mockEntityManager.query.mock.calls as any[][];
      expect(insertCalls.length).toBeGreaterThan(0);

      // Flatten all params and look for our metric names + ramp_up values
      const allParams = insertCalls.flatMap(call => call[1] as unknown[]);

      // Find ramp_up flag for tail_metric:
      // params are positional: [..., metric_name, time, timestep, ramp_up, value, unit, ...]
      // Column order from insertBatch: test_run_id, application_dashboard_id, metrics_source_id,
      //   dashboard_uid, panel_id, panel_title, dashboard_label, benchmark_ids, errors,
      //   metric_name(9), time(10), timestep(11), ramp_up(12), value(13), unit(14), ...
      // (0-indexed within one record block of 21 params)
      const colCount = 21;
      const metricNameIdx = 9;  // 0-indexed column position within one record
      const rampUpIdx     = 12;

      const tailRecordStart = allParams.findIndex((p, i) =>
        p === 'tail_metric' && i % colCount === metricNameIdx
      );
      const midRecordStart  = allParams.findIndex((p, i) =>
        p === 'mid_metric' && i % colCount === metricNameIdx
      );

      expect(tailRecordStart).toBeGreaterThanOrEqual(0);
      expect(midRecordStart).toBeGreaterThanOrEqual(0);

      const tailBlock  = Math.floor(tailRecordStart / colCount) * colCount;
      const midBlock   = Math.floor(midRecordStart  / colCount) * colCount;

      expect(allParams[tailBlock + rampUpIdx]).toBe(true);  // tail is excluded
      expect(allParams[midBlock  + rampUpIdx]).toBe(false); // mid is in analysis window
    });
  });

  describe('Data Transformation', () => {
    test('should flatten metrics document correctly', async () => {
      const mockTestRun = createMockTestRun();
      const mockPanels = [createMockPanel()];
      const mockMetricsDoc = createMockMetricsDocument({
        data: [
          { metric_name: 'cpu_usage', time: new Date('2024-01-01T00:00:00Z'), timestep: 0, ramp_up: false, value: 75.5, unit: '%' },
          { metric_name: 'memory_usage', time: new Date('2024-01-01T00:00:01Z'), timestep: 1, ramp_up: false, value: 512, unit: 'MB' }
        ]
      });

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);
      mockGrafanaClient.queryPanelData.mockResolvedValue([mockMetricsDoc]);

      await pipeline.execute({ testRunId: 'test-run-001' });

      // Verify flattened records were passed to database
      expect(mockEntityManager.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          'test-run-001', // test_run_id
          'app-dash-001', // application_dashboard_id
          expect.any(String), // dashboard_uid
          expect.any(Number), // panel_id
          expect.any(String), // panel_title
          expect.any(String), // dashboard_label
          null, // benchmark_ids
          null, // errors
          'cpu_usage', // metric_name
          expect.any(Date), // time
          0, // timestep
          false, // ramp_up
          75.5, // value
          '%', // unit
          expect.any(Date), // updated_at
          expect.any(Date) // created_at
        ])
      );
    });

    test('should handle null unit in metrics', async () => {
      const mockTestRun = createMockTestRun();
      const mockPanels = [createMockPanel()];
      const mockMetricsDoc = createMockMetricsDocument({
        data: [{ metric_name: 'counter', time: new Date(), timestep: 0, ramp_up: false, value: 42, unit: undefined }]
      });

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);
      mockGrafanaClient.queryPanelData.mockResolvedValue([mockMetricsDoc]);

      const result = await pipeline.execute({ testRunId: 'test-run-001' });

      expect(result.success).toBe(true);
    });

    test('should preserve benchmark IDs in flattened records', async () => {
      const mockTestRun = createMockTestRun();
      const mockPanels = [createMockPanel({ benchmark_ids: ['bench-001', 'bench-002'] })];
      const mockMetricsDoc = createMockMetricsDocument({
        benchmark_ids: ['bench-001', 'bench-002']
      });

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);
      mockGrafanaClient.queryPanelData.mockResolvedValue([mockMetricsDoc]);

      await pipeline.execute({ testRunId: 'test-run-001' });

      expect(mockEntityManager.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          expect.arrayContaining(['bench-001', 'bench-002'])
        ])
      );
    });

    test('should convert test run to snake_case adapter', async () => {
      const mockTestRun = createMockTestRun();
      const mockPanels = [createMockPanel()];

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockDb.getDsPanelsByTestRun.mockResolvedValue(mockPanels);
      mockGrafanaClient.queryPanelData.mockResolvedValue([]);

      await pipeline.execute({ testRunId: 'test-run-001' });

      expect(mockGrafanaClient.queryPanelData).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          test_run_id: 'test-run-001',
          system_under_test_id: 'system-001',
          workload: 'load-test',
          test_environment: 'production',
          start_time: expect.any(Date),
          end_time: expect.any(Date)
        })
      );
    });
  });
});
