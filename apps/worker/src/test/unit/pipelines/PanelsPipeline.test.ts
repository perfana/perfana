/**
 * PanelsPipeline Unit Tests (Updated for TypeORM)
 *
 * Tests the PanelsPipeline class functionality including:
 * - Input validation
 * - Pipeline execution flow with TypeORM
 * - Panel document creation and filtering
 * - Database operations and transactions
 * - Grafana dashboard integration
 * - Error handling
 * - Edge cases (no panels, invalid panel data, missing dashboards)
 *
 * This pipeline processes Grafana panels for a test run, extracting panel
 * metadata and saving it to the database for metrics processing.
 */

import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { PanelsPipeline } from '../../../pipelines/PanelsPipeline.js';
import { EntityManager } from 'typeorm';
import type { Logger } from 'pino';

// Mock the database accessor module
vi.mock('../../../common/database-accessor.js', () => ({
  getDatabaseService: vi.fn(() => mockDatabaseService)
}));

// Mock the panels helpers module
vi.mock('../../../pipelines/panels/helpers.js', () => ({
  getApplicationDashboardsForTestRun: vi.fn(),
  getGrafanaDashboardsForApplicationDashboards: vi.fn(),
  getBenchmarksForTestRun: vi.fn(),
  createPanelDocuments: vi.fn()
}));

// Mock the Grafana config cache. Default to "configured" so existing happy-path
// tests pass; the soft-skip test overrides this to null per-test.
vi.mock('../../../config/grafana-config-cache.js', () => ({
  tryGetGrafanaConfig: vi.fn(),
  getGrafanaConfig: vi.fn(),
  getGrafanaInstanceId: vi.fn(() => 'instance-1'),
  initializeGrafanaConfig: vi.fn(),
  clearGrafanaConfigCache: vi.fn(),
}));

import {
  getApplicationDashboardsForTestRun,
  getGrafanaDashboardsForApplicationDashboards,
  getBenchmarksForTestRun,
  createPanelDocuments
} from '../../../pipelines/panels/helpers.js';
import { tryGetGrafanaConfig } from '../../../config/grafana-config-cache.js';

// Create mock database service
const mockDatabaseService = {
  transaction: vi.fn(),
  query: vi.fn(),
  getTestRunByTestRunId: vi.fn(),
  getSystemUnderTestName: vi.fn()
};

// Create mock logger
const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  silent: vi.fn(),
  child: vi.fn(() => mockLogger as any),
  level: 'info',
  isLevelEnabled: vi.fn(),
  bindings: vi.fn(),
} as any;

describe('PanelsPipeline', () => {
  let pipeline: PanelsPipeline;
  let mockEntityManager: Partial<EntityManager>;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock entity manager
    mockEntityManager = {
      query: vi.fn()
    };

    // Setup transaction to call the callback with mock entity manager
    mockDatabaseService.transaction.mockImplementation(async (callback: any) => {
      return await callback(mockEntityManager);
    });

    // Default: Grafana is configured. Soft-skip tests override to null.
    (tryGetGrafanaConfig as any).mockResolvedValue({
      url: 'http://grafana.test',
      apiKey: 'test-api-key',
      orgId: '1',
    });

    // Create pipeline instance
    pipeline = new PanelsPipeline(mockLogger);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Input Validation', () => {
    test('should validate valid input with testRunId', () => {
      const validInput = {
        testRunId: 'test-run-001',
        includeDynatrace: true
      };

      expect(pipeline.validateInput(validInput)).toBe(true);
    });

    test('should validate minimal valid input', () => {
      const minimalInput = {
        testRunId: 'test-run-001'
      };

      expect(pipeline.validateInput(minimalInput)).toBe(true);
    });

    test('should reject null input', () => {
      expect(pipeline.validateInput(null)).toBe(false);
    });

    test('should reject undefined input', () => {
      expect(pipeline.validateInput(undefined)).toBe(false);
    });

    test('should reject non-object input types', () => {
      expect(pipeline.validateInput('string')).toBe(false);
      expect(pipeline.validateInput(123)).toBe(false);
      expect(pipeline.validateInput([])).toBe(false);
    });

    test('should reject missing testRunId', () => {
      expect(pipeline.validateInput({})).toBe(false);
      expect(pipeline.validateInput({ includeDynatrace: true })).toBe(false);
    });

    test('should reject invalid testRunId types', () => {
      expect(pipeline.validateInput({ testRunId: null })).toBe(false);
      expect(pipeline.validateInput({ testRunId: 123 })).toBe(false);
      expect(pipeline.validateInput({ testRunId: '' })).toBe(false);
      expect(pipeline.validateInput({ testRunId: {} })).toBe(false);
    });
  });

  describe('Soft-skip when no Grafana configured (issue #282)', () => {
    test('returns success with skipped marker and does not touch DB or helpers', async () => {
      (tryGetGrafanaConfig as any).mockResolvedValueOnce(null);

      const result = await pipeline.execute({ testRunId: 'test-run-no-grafana' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ skipped: 'no-grafana-configured' });

      // The pipeline must short-circuit before any helper or DB call so a
      // Grafana-less stack still flows through to downstream stages cleanly.
      expect(getApplicationDashboardsForTestRun).not.toHaveBeenCalled();
      expect(getGrafanaDashboardsForApplicationDashboards).not.toHaveBeenCalled();
      expect(getBenchmarksForTestRun).not.toHaveBeenCalled();
      expect(createPanelDocuments).not.toHaveBeenCalled();
      expect(mockDatabaseService.getTestRunByTestRunId).not.toHaveBeenCalled();
      expect(mockDatabaseService.transaction).not.toHaveBeenCalled();
    });

    test('still fails (returns success: false) when Grafana row is invalid', async () => {
      (tryGetGrafanaConfig as any).mockRejectedValueOnce(
        new Error('Grafana config not available. A grafana_instances row exists but is invalid')
      );

      const result = await pipeline.execute({ testRunId: 'test-run-invalid-grafana' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('invalid');
    });
  });

  describe('Pipeline Execution - Happy Path', () => {
    test('should execute successfully with complete test scenario', async () => {
      const testRunId = 'test-run-001';

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock test run
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValueOnce({
        id: '123e4567-e89b-12d3-a456-426614174000',
        testRunId: testRunId,
        systemUnderTestId: 'system-1',
        testEnvironment: 'production',
        workload: 'load-test',
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-01T01:00:00Z')
      });

      // Mock system name
      mockDatabaseService.getSystemUnderTestName.mockResolvedValueOnce('MyApp');

      // Mock application dashboards
      (getApplicationDashboardsForTestRun as any).mockResolvedValueOnce([
        {
          id: 'app-dash-1',
          name: 'JVM Dashboard',
          system_under_test_id: 'system-1',
          test_environment: 'production',
          workload: 'load-test'
        }
      ]);

      // Mock grafana dashboards
      (getGrafanaDashboardsForApplicationDashboards as any).mockResolvedValueOnce([
        {
          id: 'grafana-dash-1',
          uid: 'jvm-metrics',
          title: 'JVM Metrics',
          dashboard: { panels: [] },
          application_dashboard_id: 'app-dash-1'
        }
      ]);

      // Mock benchmarks
      (getBenchmarksForTestRun as any).mockResolvedValueOnce([
        {
          id: 'benchmark-1',
          name: 'Response Time',
          system_under_test_id: 'system-1',
          test_environment: 'production'
        }
      ]);

      // Mock panel documents
      (createPanelDocuments as any).mockResolvedValueOnce([
        {
          test_run_id: testRunId,
          application_dashboard_id: 'app-dash-1',
          dashboard_uid: 'jvm-metrics',
          panel_id: 1,
          panel_title: 'Heap Memory',
          dashboard_label: 'JVM Metrics',
          benchmark_ids: [],
          panel: { id: 1, title: 'Heap Memory' },
          query_variables: {},
          datasource_type: 'prometheus',
          requests: [],
          errors: [],
          warnings: [],
          updated_at: new Date()
        }
      ]);

      // Mock delete query
      (mockEntityManager.query as any).mockResolvedValueOnce([[], 0]);

      // Mock insert query
      (mockEntityManager.query as any).mockResolvedValueOnce([]);

      const result = await pipeline.execute({
        testRunId,
        includeDynatrace: false
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        panelDocuments: 1,
        applicationDashboards: 1,
        grafanaDashboards: 1,
        benchmarks: 1
      });
    });

    test('should handle test run with no dashboards', async () => {
      const testRunId = 'test-run-no-dashboards';

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock test run
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValueOnce({
        id: '123e4567-e89b-12d3-a456-426614174000',
        testRunId: testRunId,
        systemUnderTestId: 'system-1',
        testEnvironment: 'production',
        workload: 'load-test',
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-01T01:00:00Z')
      });

      // Mock system name
      mockDatabaseService.getSystemUnderTestName.mockResolvedValueOnce('MyApp');

      // Mock empty results
      (getApplicationDashboardsForTestRun as any).mockResolvedValueOnce([]);
      (getGrafanaDashboardsForApplicationDashboards as any).mockResolvedValueOnce([]);
      (getBenchmarksForTestRun as any).mockResolvedValueOnce([]);
      (createPanelDocuments as any).mockResolvedValueOnce([]);

      // Mock delete query
      (mockEntityManager.query as any).mockResolvedValueOnce([[], 0]);

      const result = await pipeline.execute({
        testRunId,
        includeDynatrace: false
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        panelDocuments: 0,
        applicationDashboards: 0,
        grafanaDashboards: 0,
        benchmarks: 0
      });
    });

    test('should handle test run with multiple panels', async () => {
      const testRunId = 'test-run-multi-panels';

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock test run
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValueOnce({
        id: '123e4567-e89b-12d3-a456-426614174000',
        testRunId: testRunId,
        systemUnderTestId: 'system-1',
        testEnvironment: 'production',
        workload: 'load-test',
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-01T01:00:00Z')
      });

      // Mock system name
      mockDatabaseService.getSystemUnderTestName.mockResolvedValueOnce('MyApp');

      // Mock application dashboards
      (getApplicationDashboardsForTestRun as any).mockResolvedValueOnce([
        {
          id: 'app-dash-1',
          name: 'JVM Dashboard',
          system_under_test_id: 'system-1'
        }
      ]);

      // Mock grafana dashboards
      (getGrafanaDashboardsForApplicationDashboards as any).mockResolvedValueOnce([
        {
          id: 'grafana-dash-1',
          uid: 'jvm-metrics',
          title: 'JVM Metrics',
          dashboard: { panels: [] },
          application_dashboard_id: 'app-dash-1'
        }
      ]);

      // Mock benchmarks
      (getBenchmarksForTestRun as any).mockResolvedValueOnce([]);

      // Mock multiple panel documents
      const panelDocuments = Array.from({ length: 5 }, (_, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-1',
        dashboard_uid: 'jvm-metrics',
        panel_id: i + 1,
        panel_title: `Panel ${i + 1}`,
        dashboard_label: 'JVM Metrics',
        benchmark_ids: [],
        panel: { id: i + 1, title: `Panel ${i + 1}` },
        query_variables: {},
        datasource_type: 'prometheus',
        requests: [],
        errors: [],
        warnings: [],
        updated_at: new Date()
      }));

      (createPanelDocuments as any).mockResolvedValueOnce(panelDocuments);

      // Mock delete query
      (mockEntityManager.query as any).mockResolvedValueOnce([[], 0]);

      // Mock insert query
      (mockEntityManager.query as any).mockResolvedValueOnce([]);

      const result = await pipeline.execute({
        testRunId,
        includeDynatrace: false
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        panelDocuments: 5,
        applicationDashboards: 1,
        grafanaDashboards: 1,
        benchmarks: 0
      });
    });
  });

  describe('Error Handling', () => {
    test('should handle missing test run', async () => {
      const testRunId = 'non-existent-test-run';

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock null test run
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValueOnce(null);

      const result = await pipeline.execute({
        testRunId
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('not found');
      expect(result.error?.code).toBe('PANELS_PIPELINE_ERROR');
    });

    test('should handle database connection errors', async () => {
      const testRunId = 'test-run-001';

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock database error
      mockDatabaseService.getTestRunByTestRunId.mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      const result = await pipeline.execute({
        testRunId
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Database connection failed');
    });

    test('should handle query execution errors', async () => {
      const testRunId = 'test-run-001';

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock test run
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValueOnce({
        id: '123e4567-e89b-12d3-a456-426614174000',
        testRunId: testRunId,
        systemUnderTestId: 'system-1',
        testEnvironment: 'production',
        workload: 'load-test',
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-01T01:00:00Z')
      });

      // Mock system name
      mockDatabaseService.getSystemUnderTestName.mockResolvedValueOnce('MyApp');

      // Mock helper failure
      (getApplicationDashboardsForTestRun as any).mockRejectedValueOnce(
        new Error('Query execution failed')
      );

      const result = await pipeline.execute({
        testRunId
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Query execution failed');
    });

    test('should handle panel document creation errors', async () => {
      const testRunId = 'test-run-001';

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock test run
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValueOnce({
        id: '123e4567-e89b-12d3-a456-426614174000',
        testRunId: testRunId,
        systemUnderTestId: 'system-1',
        testEnvironment: 'production',
        workload: 'load-test',
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-01T01:00:00Z')
      });

      // Mock system name
      mockDatabaseService.getSystemUnderTestName.mockResolvedValueOnce('MyApp');

      // Mock application dashboards
      (getApplicationDashboardsForTestRun as any).mockResolvedValueOnce([
        { id: 'app-dash-1', name: 'Dashboard' }
      ]);

      // Mock grafana dashboards
      (getGrafanaDashboardsForApplicationDashboards as any).mockResolvedValueOnce([
        { id: 'grafana-dash-1', uid: 'dash-1' }
      ]);

      // Mock benchmarks
      (getBenchmarksForTestRun as any).mockResolvedValueOnce([]);

      // Mock createPanelDocuments failure
      (createPanelDocuments as any).mockRejectedValueOnce(
        new Error('Grafana API error')
      );

      const result = await pipeline.execute({
        testRunId
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Grafana API error');
    });

    test('should handle transaction rollback on insert error', async () => {
      const testRunId = 'test-run-001';

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock test run
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValueOnce({
        id: '123e4567-e89b-12d3-a456-426614174000',
        testRunId: testRunId,
        systemUnderTestId: 'system-1',
        testEnvironment: 'production',
        workload: 'load-test',
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-01T01:00:00Z')
      });

      // Mock system name
      mockDatabaseService.getSystemUnderTestName.mockResolvedValueOnce('MyApp');

      // Mock application dashboards
      (getApplicationDashboardsForTestRun as any).mockResolvedValueOnce([
        { id: 'app-dash-1', name: 'Dashboard' }
      ]);

      // Mock grafana dashboards
      (getGrafanaDashboardsForApplicationDashboards as any).mockResolvedValueOnce([
        { id: 'grafana-dash-1', uid: 'dash-1' }
      ]);

      // Mock benchmarks
      (getBenchmarksForTestRun as any).mockResolvedValueOnce([]);

      // Mock panel documents
      (createPanelDocuments as any).mockResolvedValueOnce([
        {
          test_run_id: testRunId,
          application_dashboard_id: 'app-dash-1',
          dashboard_uid: 'dash-1',
          panel_id: 1,
          panel_title: 'Panel',
          dashboard_label: 'Dashboard',
          benchmark_ids: [],
          panel: {},
          query_variables: {},
          datasource_type: 'prometheus',
          requests: [],
          errors: [],
          warnings: [],
          updated_at: new Date()
        }
      ]);

      // Mock transaction failure on insert
      mockDatabaseService.transaction.mockRejectedValueOnce(
        new Error('Insert failed')
      );

      const result = await pipeline.execute({
        testRunId
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Insert failed');
    });
  });

  describe('Database Operations', () => {
    test('should delete existing panels before inserting new ones', async () => {
      const testRunId = 'test-run-001';

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock test run
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValueOnce({
        id: '123e4567-e89b-12d3-a456-426614174000',
        testRunId: testRunId,
        systemUnderTestId: 'system-1',
        testEnvironment: 'production',
        workload: 'load-test',
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-01T01:00:00Z')
      });

      // Mock system name
      mockDatabaseService.getSystemUnderTestName.mockResolvedValueOnce('MyApp');

      // Mock application dashboards
      (getApplicationDashboardsForTestRun as any).mockResolvedValueOnce([
        { id: 'app-dash-1', name: 'Dashboard' }
      ]);

      // Mock grafana dashboards
      (getGrafanaDashboardsForApplicationDashboards as any).mockResolvedValueOnce([
        { id: 'grafana-dash-1', uid: 'dash-1' }
      ]);

      // Mock benchmarks
      (getBenchmarksForTestRun as any).mockResolvedValueOnce([]);

      // Mock panel documents
      (createPanelDocuments as any).mockResolvedValueOnce([
        {
          test_run_id: testRunId,
          application_dashboard_id: 'app-dash-1',
          dashboard_uid: 'dash-1',
          panel_id: 1,
          panel_title: 'Panel',
          dashboard_label: 'Dashboard',
          benchmark_ids: [],
          panel: {},
          query_variables: {},
          datasource_type: 'prometheus',
          requests: [],
          errors: [],
          warnings: [],
          updated_at: new Date()
        }
      ]);

      // Mock delete query - 2 existing panels deleted
      (mockEntityManager.query as any).mockResolvedValueOnce([[], 2]);

      // Mock insert query
      (mockEntityManager.query as any).mockResolvedValueOnce([]);

      await pipeline.execute({
        testRunId
      });

      // Verify delete was called
      expect(mockEntityManager.query).toHaveBeenCalledWith(
        'DELETE FROM ds_panels WHERE test_run_id = $1',
        [testRunId]
      );

      // Verify logger logged the deletion
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Deleted 2 existing panel documents')
      );
    });

    test('should insert panel documents with correct structure', async () => {
      const testRunId = 'test-run-001';

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock test run
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValueOnce({
        id: '123e4567-e89b-12d3-a456-426614174000',
        testRunId: testRunId,
        systemUnderTestId: 'system-1',
        testEnvironment: 'production',
        workload: 'load-test',
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-01T01:00:00Z')
      });

      // Mock system name
      mockDatabaseService.getSystemUnderTestName.mockResolvedValueOnce('MyApp');

      // Mock application dashboards
      (getApplicationDashboardsForTestRun as any).mockResolvedValueOnce([
        { id: 'app-dash-1', name: 'Dashboard' }
      ]);

      // Mock grafana dashboards
      (getGrafanaDashboardsForApplicationDashboards as any).mockResolvedValueOnce([
        { id: 'grafana-dash-1', uid: 'dash-1' }
      ]);

      // Mock benchmarks
      (getBenchmarksForTestRun as any).mockResolvedValueOnce([]);

      // Mock panel documents
      const panelDoc = {
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-1',
        dashboard_uid: 'dash-1',
        panel_id: 1,
        panel_title: 'Heap Memory',
        dashboard_label: 'JVM Metrics',
        benchmark_ids: ['benchmark-1'],
        panel: { id: 1, title: 'Heap Memory', type: 'timeseries' },
        query_variables: { system: 'MyApp' },
        datasource_type: 'prometheus',
        requests: [],
        errors: [],
        warnings: [],
        updated_at: new Date()
      };

      (createPanelDocuments as any).mockResolvedValueOnce([panelDoc]);

      // Mock delete query
      (mockEntityManager.query as any).mockResolvedValueOnce([[], 0]);

      // Mock insert query
      (mockEntityManager.query as any).mockResolvedValueOnce([]);

      await pipeline.execute({
        testRunId
      });

      // Verify insert was called with correct structure
      const insertCall = (mockEntityManager.query as any).mock.calls[1];
      expect(insertCall[0]).toContain('INSERT INTO ds_panels');
      expect(insertCall[0]).toContain('test_run_id');
      expect(insertCall[0]).toContain('application_dashboard_id');
      expect(insertCall[0]).toContain('dashboard_uid');
      expect(insertCall[0]).toContain('panel_id');
      expect(insertCall[0]).toContain('panel_title');
      expect(insertCall[0]).toContain('dashboard_label');
      expect(insertCall[0]).toContain('benchmark_ids');
      expect(insertCall[0]).toContain('panel');
      expect(insertCall[0]).toContain('query_variables');
      expect(insertCall[0]).toContain('datasource_type');
      expect(insertCall[0]).toContain('requests');
      expect(insertCall[0]).toContain('errors');
      expect(insertCall[0]).toContain('warnings');
    });

    test('should handle empty panel documents array gracefully', async () => {
      const testRunId = 'test-run-no-panels';

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock test run
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValueOnce({
        id: '123e4567-e89b-12d3-a456-426614174000',
        testRunId: testRunId,
        systemUnderTestId: 'system-1',
        testEnvironment: 'production',
        workload: 'load-test',
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-01T01:00:00Z')
      });

      // Mock system name
      mockDatabaseService.getSystemUnderTestName.mockResolvedValueOnce('MyApp');

      // Mock application dashboards
      (getApplicationDashboardsForTestRun as any).mockResolvedValueOnce([
        { id: 'app-dash-1', name: 'Dashboard' }
      ]);

      // Mock grafana dashboards
      (getGrafanaDashboardsForApplicationDashboards as any).mockResolvedValueOnce([
        { id: 'grafana-dash-1', uid: 'dash-1' }
      ]);

      // Mock benchmarks
      (getBenchmarksForTestRun as any).mockResolvedValueOnce([]);

      // Mock empty panel documents
      (createPanelDocuments as any).mockResolvedValueOnce([]);

      // Mock delete query
      (mockEntityManager.query as any).mockResolvedValueOnce([[], 0]);

      const result = await pipeline.execute({
        testRunId
      });

      expect(result.success).toBe(true);
      expect(result.data?.panelDocuments).toBe(0);

      // Verify insert was NOT called
      expect(mockEntityManager.query).toHaveBeenCalledTimes(1); // Only delete
    });
  });

  describe('Performance Logging', () => {
    test('should log performance metrics', async () => {
      const testRunId = 'test-run-001';

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock test run
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValueOnce({
        id: '123e4567-e89b-12d3-a456-426614174000',
        testRunId: testRunId,
        systemUnderTestId: 'system-1',
        testEnvironment: 'production',
        workload: 'load-test',
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-01T01:00:00Z')
      });

      // Mock system name
      mockDatabaseService.getSystemUnderTestName.mockResolvedValueOnce('MyApp');

      // Mock application dashboards
      (getApplicationDashboardsForTestRun as any).mockResolvedValueOnce([
        { id: 'app-dash-1', name: 'Dashboard' }
      ]);

      // Mock grafana dashboards
      (getGrafanaDashboardsForApplicationDashboards as any).mockResolvedValueOnce([
        { id: 'grafana-dash-1', uid: 'dash-1' }
      ]);

      // Mock benchmarks
      (getBenchmarksForTestRun as any).mockResolvedValueOnce([]);

      // Mock panel documents
      (createPanelDocuments as any).mockResolvedValueOnce([
        {
          test_run_id: testRunId,
          application_dashboard_id: 'app-dash-1',
          dashboard_uid: 'dash-1',
          panel_id: 1,
          panel_title: 'Panel',
          dashboard_label: 'Dashboard',
          benchmark_ids: [],
          panel: {},
          query_variables: {},
          datasource_type: 'prometheus',
          requests: [],
          errors: [],
          warnings: [],
          updated_at: new Date()
        }
      ]);

      // Mock delete and insert queries
      (mockEntityManager.query as any).mockResolvedValueOnce([[], 0]);
      (mockEntityManager.query as any).mockResolvedValueOnce([]);

      await pipeline.execute({
        testRunId
      });

      // Verify performance logging
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('PERFORMANCE SUMMARY')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('TOTAL TIME:')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('ms')
      );
    });

    test('should log individual step timings', async () => {
      const testRunId = 'test-run-001';

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock test run
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValueOnce({
        id: '123e4567-e89b-12d3-a456-426614174000',
        testRunId: testRunId,
        systemUnderTestId: 'system-1',
        testEnvironment: 'production',
        workload: 'load-test',
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-01T01:00:00Z')
      });

      // Mock system name
      mockDatabaseService.getSystemUnderTestName.mockResolvedValueOnce('MyApp');

      // Mock application dashboards
      (getApplicationDashboardsForTestRun as any).mockResolvedValueOnce([
        { id: 'app-dash-1', name: 'Dashboard' }
      ]);

      // Mock grafana dashboards
      (getGrafanaDashboardsForApplicationDashboards as any).mockResolvedValueOnce([
        { id: 'grafana-dash-1', uid: 'dash-1' }
      ]);

      // Mock benchmarks
      (getBenchmarksForTestRun as any).mockResolvedValueOnce([]);

      // Mock panel documents
      (createPanelDocuments as any).mockResolvedValueOnce([]);

      // Mock delete query
      (mockEntityManager.query as any).mockResolvedValueOnce([[], 0]);

      await pipeline.execute({
        testRunId
      });

      // Verify individual step timings
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/Test run loaded:.*ms/)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/Found.*application dashboards:.*ms/)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/Found.*grafana dashboards:.*ms/)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/Found.*benchmarks:.*ms/)
      );
    });
  });

  describe('Dynatrace Integration', () => {
    test('should log warning when Dynatrace is enabled', async () => {
      const testRunId = 'test-run-001';

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock test run
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValueOnce({
        id: '123e4567-e89b-12d3-a456-426614174000',
        testRunId: testRunId,
        systemUnderTestId: 'system-1',
        testEnvironment: 'production',
        workload: 'load-test',
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-01T01:00:00Z')
      });

      // Mock system name
      mockDatabaseService.getSystemUnderTestName.mockResolvedValueOnce('MyApp');

      // Mock application dashboards
      (getApplicationDashboardsForTestRun as any).mockResolvedValueOnce([]);
      (getGrafanaDashboardsForApplicationDashboards as any).mockResolvedValueOnce([]);
      (getBenchmarksForTestRun as any).mockResolvedValueOnce([]);
      (createPanelDocuments as any).mockResolvedValueOnce([]);

      // Mock delete query
      (mockEntityManager.query as any).mockResolvedValueOnce([[], 0]);

      await pipeline.execute({
        testRunId,
        includeDynatrace: true
      });

      // Verify Dynatrace warning
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Dynatrace processing not yet implemented')
      );
    });

    test('should not log Dynatrace warning when disabled', async () => {
      const testRunId = 'test-run-001';

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock test run
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValueOnce({
        id: '123e4567-e89b-12d3-a456-426614174000',
        testRunId: testRunId,
        systemUnderTestId: 'system-1',
        testEnvironment: 'production',
        workload: 'load-test',
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-01T01:00:00Z')
      });

      // Mock system name
      mockDatabaseService.getSystemUnderTestName.mockResolvedValueOnce('MyApp');

      // Mock application dashboards
      (getApplicationDashboardsForTestRun as any).mockResolvedValueOnce([]);
      (getGrafanaDashboardsForApplicationDashboards as any).mockResolvedValueOnce([]);
      (getBenchmarksForTestRun as any).mockResolvedValueOnce([]);
      (createPanelDocuments as any).mockResolvedValueOnce([]);

      // Mock delete query
      (mockEntityManager.query as any).mockResolvedValueOnce([[], 0]);

      await pipeline.execute({
        testRunId,
        includeDynatrace: false
      });

      // Verify no Dynatrace logs
      const dynatraceLogs = (mockLogger.info as any).mock.calls.filter(
        (call: any) => call[0] && call[0].includes('Dynatrace')
      );
      expect(dynatraceLogs).toHaveLength(0);
    });
  });

  describe('Stale Data Cleanup', () => {
    test('should clean up stale application dashboards before processing', async () => {
      const testRunId = 'test-run-001';

      // Mock cleanup query with deleted rows
      mockDatabaseService.query.mockResolvedValueOnce([[], 3]);

      // Mock test run
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValueOnce({
        id: '123e4567-e89b-12d3-a456-426614174000',
        testRunId: testRunId,
        systemUnderTestId: 'system-1',
        testEnvironment: 'production',
        workload: 'load-test',
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-01T01:00:00Z')
      });

      // Mock system name
      mockDatabaseService.getSystemUnderTestName.mockResolvedValueOnce('MyApp');

      // Mock application dashboards
      (getApplicationDashboardsForTestRun as any).mockResolvedValueOnce([]);
      (getGrafanaDashboardsForApplicationDashboards as any).mockResolvedValueOnce([]);
      (getBenchmarksForTestRun as any).mockResolvedValueOnce([]);
      (createPanelDocuments as any).mockResolvedValueOnce([]);

      // Mock delete query
      (mockEntityManager.query as any).mockResolvedValueOnce([[], 0]);

      await pipeline.execute({
        testRunId
      });

      // Verify cleanup was called
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM ds_panels')
      );
    });
  });
});
