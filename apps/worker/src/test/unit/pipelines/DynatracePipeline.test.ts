/**
 * DynatracePipeline Unit Tests
 *
 * Comprehensive test suite for DynatracePipeline including:
 * - Input validation
 * - Pipeline execution flow
 * - API integration with DynatraceAPIClient
 * - Query construction and execution
 * - Data processing and transformation
 * - Database operations (metrics storage)
 * - Error handling and recovery
 * - Multi-instance support
 * - Stale data cleanup
 *
 * Target Coverage: 90%+ for all metrics
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DynatracePipeline } from '../../../pipelines/DynatracePipeline.js';
import { PipelineResult } from '../../../types/pipeline.js';
import { EntityManager } from 'typeorm';

// Mock dependencies
vi.mock('../../../common/database-accessor.js', () => ({
  getDatabaseService: vi.fn(() => mockDatabaseService),
}));

vi.mock('../../../config/environment.js', () => ({
  getConfig: vi.fn(() => ({
    DYNATRACE_API_TOKEN: 'env-api-token',
    DYNATRACE_PLATFORM_TOKEN: 'env-platform-token',
  })),
}));

vi.mock('../../../services/dynatrace/DynatraceAPIClient.js');
vi.mock('../../../services/dynatrace/DynatraceRepository.js');
vi.mock('../../../services/dynatrace/QueryConstructor.js');
vi.mock('../../../services/dynatrace/DataProcessor.js');

// Import mocked classes
import { DynatraceAPIClient } from '../../../services/dynatrace/DynatraceAPIClient.js';
import { DynatraceRepository } from '../../../services/dynatrace/DynatraceRepository.js';
import { QueryConstructor } from '../../../services/dynatrace/QueryConstructor.js';
import { DataProcessor } from '../../../services/dynatrace/DataProcessor.js';

// Mock database service
const mockDatabaseService = {
  query: vi.fn(),
  getTestRunByTestRunId: vi.fn(),
  transaction: vi.fn(),
};

// Mock logger
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
};

// Test fixtures
const createMockTestRun = (overrides = {}) => ({
  testRunId: 'test-run-123',
  systemUnderTestId: 'ecommerce',
  testEnvironment: 'acc',
  workload: 'loadTest',
  startTime: new Date('2024-01-01T00:00:00Z'),
  endTime: new Date('2024-01-01T01:00:00Z'),
  ...overrides,
});

const createMockDynatraceConfig = (overrides = {}) => ({
  id: 'dynatrace-config-uuid',
  host: 'https://tenant.live.dynatrace.com',
  label: 'Production Dynatrace',
  dynatraceType: 'saas',
  apiToken: 'dt0c01.ABC123',
  platformApiToken: 'dt0s02.XYZ789',
  perfanaTestRunIdAttribute: 'test_run_id',
  perfanaRequestNameAttribute: 'request_name',
  ...overrides,
});

const createMockQuery = (overrides = {}) => ({
  dynatraceConfigId: 'dynatrace-config-uuid',
  applicationDashboardId: 'app-dash-uuid',
  panelId: 1,
  query: 'timeseries avg = avg(dt.service.response_time) by: { service.name }',
  visualization: 'line',
  dashboardLabel: 'Response Time',
  matchMetricPattern: '.*response.*',
  omitGroupByVariableFromMetricName: [],
  ...overrides,
});

const createMockQueryResult = (overrides = {}) => ({
  tileId: 'tile-1',
  tileTitle: 'Response Time',
  visualization: 'line',
  query: 'timeseries avg = avg(dt.service.response_time)',
  applicationDashboardId: 'app-dash-uuid',
  panelId: 1,
  dashboardLabel: 'Response Time',
  matchMetricPattern: null,
  omitGroupByVariableFromMetricName: [],
  result: {
    records: [
      {
        'avg': [100, 120, 110],
        'interval': [60000, 60000, 60000],
        'timeframe': {
          start: '2024-01-01T00:00:00Z',
          end: '2024-01-01T01:00:00Z',
        },
      },
    ],
  },
  error: null,
  ...overrides,
});

const createMockMetricsDocument = (overrides = {}) => ({
  testRunId: 'test-run-123',
  applicationDashboardId: 'app-dash-uuid',
  dashboardUid: 'dynatrace-dql',
  panelId: 1,
  panelTitle: 'Response Time',
  dashboardLabel: 'Response Time',
  benchmarkIds: [],
  errors: null,
  data: [
    {
      metricName: 'avg_response_time',
      time: new Date('2024-01-01T00:00:00Z'),
      timestep: 60,
      rampUp: false,
      value: 100,
      unit: 'ms',
    },
  ],
  ...overrides,
});

describe('DynatracePipeline', () => {
  let pipeline: DynatracePipeline;
  let mockRepository: any;
  let mockQueryConstructor: any;
  let mockDataProcessor: any;
  let mockAPIClient: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock instances
    mockRepository = {
      getDynatraceConfigById: vi.fn(),
      getQueriesForTestRun: vi.fn(),
    };

    mockQueryConstructor = {
      constructQueriesFromDatabase: vi.fn(),
    };

    mockDataProcessor = {
      processDynatraceResults: vi.fn(),
    };

    mockAPIClient = {
      executeBatchQueries: vi.fn(),
      close: vi.fn(),
    };

    // Mock constructors
    vi.mocked(DynatraceRepository).mockImplementation(() => mockRepository);
    vi.mocked(QueryConstructor).mockImplementation(() => mockQueryConstructor);
    vi.mocked(DataProcessor).mockImplementation(() => mockDataProcessor);
    vi.mocked(DynatraceAPIClient).mockImplementation(() => mockAPIClient);

    // Setup default database service behaviors
    mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());
    mockDatabaseService.query.mockResolvedValue([]);
    mockDatabaseService.transaction.mockImplementation(async (callback) => {
      const mockManager = {
        query: vi.fn().mockResolvedValue([]),
      } as unknown as EntityManager;
      return callback(mockManager);
    });

    pipeline = new DynatracePipeline(mockLogger);

    // Mock base class methods
    vi.spyOn(pipeline as any, 'cleanupStaleApplicationDashboards').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Input Validation', () => {
    it('should validate correct input with testRunIds array', () => {
      // Arrange
      const validInput = {
        testRunIds: ['test-run-1', 'test-run-2'],
      };

      // Act
      const result = pipeline.validateInput(validInput);

      // Assert
      expect(result).toBe(true);
    });

    it('should validate input with single testRunId', () => {
      // Arrange
      const validInput = {
        testRunIds: ['test-run-1'],
      };

      // Act
      const result = pipeline.validateInput(validInput);

      // Assert
      expect(result).toBe(true);
    });

    it('should reject null or undefined input', () => {
      // Act & Assert
      expect(pipeline.validateInput(null)).toBe(false);
      expect(pipeline.validateInput(undefined)).toBe(false);
    });

    it('should reject non-object input', () => {
      // Act & Assert
      expect(pipeline.validateInput('string')).toBe(false);
      expect(pipeline.validateInput(123)).toBe(false);
      expect(pipeline.validateInput([])).toBe(false);
    });

    it('should reject input without testRunIds', () => {
      // Act & Assert
      expect(pipeline.validateInput({})).toBe(false);
      expect(pipeline.validateInput({ other: 'field' })).toBe(false);
    });

    it('should reject input with empty testRunIds array', () => {
      // Act & Assert
      expect(pipeline.validateInput({ testRunIds: [] })).toBe(false);
    });

    it('should reject input with non-string testRunIds', () => {
      // Act & Assert
      expect(pipeline.validateInput({ testRunIds: [123, 456] })).toBe(false);
      expect(pipeline.validateInput({ testRunIds: ['valid', 123] })).toBe(false);
      expect(pipeline.validateInput({ testRunIds: [null] })).toBe(false);
    });
  });

  describe('Pipeline Execution - Happy Path', () => {
    it('should execute successfully with single test run', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const mockQueries = [createMockQuery()];
      const mockDynatraceConfig = createMockDynatraceConfig();
      const mockAPIResults = [
        {
          tileId: 'tile-1',
          tileTitle: 'Response Time',
          result: { records: [] },
          error: null,
        },
      ];
      const mockMetricsDoc = createMockMetricsDocument();

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById.mockResolvedValue(mockDynatraceConfig);
      mockAPIClient.executeBatchQueries.mockResolvedValue(mockAPIResults);
      mockDataProcessor.processDynatraceResults.mockResolvedValue({
        panelDocuments: [],
        metricsDocuments: [mockMetricsDoc],
      });

      // Act
      const result: PipelineResult = await pipeline.execute(input);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        testRunCount: 1,
        totalQueries: 1,
        totalPanels: 0,
        totalMetrics: 1,
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Starting Dynatrace DQL metrics collection')
      );
    });

    it('should execute successfully with multiple test runs', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-1', 'test-run-2'] };
      const mockQueries = [createMockQuery(), createMockQuery({ panelId: 2 })];
      const mockDynatraceConfig = createMockDynatraceConfig();
      const mockAPIResults = [
        { tileId: 'tile-1', tileTitle: 'Panel 1', result: { records: [] }, error: null },
        { tileId: 'tile-2', tileTitle: 'Panel 2', result: { records: [] }, error: null },
      ];
      const mockMetricsDoc1 = createMockMetricsDocument();
      const mockMetricsDoc2 = createMockMetricsDocument({ panelId: 2 });

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById.mockResolvedValue(mockDynatraceConfig);
      mockAPIClient.executeBatchQueries.mockResolvedValue(mockAPIResults);
      mockDataProcessor.processDynatraceResults.mockResolvedValue({
        panelDocuments: [],
        metricsDocuments: [mockMetricsDoc1, mockMetricsDoc2],
      });

      // Act
      const result: PipelineResult = await pipeline.execute(input);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        testRunCount: 2,
        totalQueries: 4, // 2 queries × 2 test runs
        totalPanels: 0,
        totalMetrics: 4, // 2 metrics × 2 test runs
      });
    });

    it('should cleanup stale data before processing', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const cleanupSpy = vi.spyOn(pipeline as any, 'cleanupStaleApplicationDashboards')
        .mockResolvedValue(undefined);

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue([]);

      // Act
      await pipeline.execute(input);

      // Assert
      expect(cleanupSpy).toHaveBeenCalledWith(['ds_panels']);
    });

    it('should call storeMetricsDocuments with correct data', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const mockQueries = [createMockQuery()];
      const mockMetricsDoc = createMockMetricsDocument();
      const storeSpy = vi.spyOn(pipeline as any, 'storeMetricsDocuments')
        .mockResolvedValue(undefined);

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById.mockResolvedValue(createMockDynatraceConfig());
      mockAPIClient.executeBatchQueries.mockResolvedValue([
        { tileId: 'tile-1', tileTitle: 'Panel', result: { records: [] }, error: null },
      ]);
      mockDataProcessor.processDynatraceResults.mockResolvedValue({
        panelDocuments: [],
        metricsDocuments: [mockMetricsDoc],
      });

      // Act
      await pipeline.execute(input);

      // Assert
      expect(storeSpy).toHaveBeenCalledWith([mockMetricsDoc], 'test-run-123', expect.anything());
    });
  });

  describe('Query Construction and Execution', () => {
    it('should construct queries with correct test run parameters', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const testRun = createMockTestRun();

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue([]);
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(testRun);

      // Act
      await pipeline.execute(input);

      // Assert
      expect(mockQueryConstructor.constructQueriesFromDatabase).toHaveBeenCalledWith({
        testRunId: testRun.testRunId,
        systemUnderTestId: testRun.systemUnderTestId,
        testEnvironment: testRun.testEnvironment,
        workload: testRun.workload,
        start: testRun.startTime,
        end: testRun.endTime,
      });
    });

    it('should skip processing when no queries are configured', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue([]);

      // Act
      const result = await pipeline.execute(input);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        testRunCount: 1,
        totalQueries: 0,
        totalPanels: 0,
        totalMetrics: 0,
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('No Dynatrace queries configured')
      );
      expect(mockRepository.getDynatraceConfigById).not.toHaveBeenCalled();
    });

    it('should group queries by dynatraceConfigId', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const mockQueries = [
        createMockQuery({ dynatraceConfigId: 'config-1', panelId: 1 }),
        createMockQuery({ dynatraceConfigId: 'config-1', panelId: 2 }),
        createMockQuery({ dynatraceConfigId: 'config-2', panelId: 3 }),
      ];

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById
        .mockResolvedValueOnce(createMockDynatraceConfig({ id: 'config-1' }))
        .mockResolvedValueOnce(createMockDynatraceConfig({ id: 'config-2' }));
      mockAPIClient.executeBatchQueries.mockResolvedValue([]);
      mockDataProcessor.processDynatraceResults.mockResolvedValue({
        panelDocuments: [],
        metricsDocuments: [],
      });

      // Act
      await pipeline.execute(input);

      // Assert
      expect(mockRepository.getDynatraceConfigById).toHaveBeenCalledTimes(2);
      expect(mockRepository.getDynatraceConfigById).toHaveBeenCalledWith('config-1');
      expect(mockRepository.getDynatraceConfigById).toHaveBeenCalledWith('config-2');
      expect(mockLogger.info).toHaveBeenCalledWith('Found 2 Dynatrace instance(s) to query');
    });

    it('should execute queries via DynatraceAPIClient', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const testRun = createMockTestRun();
      const mockQueries = [createMockQuery()];
      const mockAPIResults = [
        { tileId: 'tile-1', tileTitle: 'Panel', result: { records: [] }, error: null },
      ];

      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(testRun);
      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById.mockResolvedValue(createMockDynatraceConfig());
      mockAPIClient.executeBatchQueries.mockResolvedValue(mockAPIResults);
      mockDataProcessor.processDynatraceResults.mockResolvedValue({
        panelDocuments: [],
        metricsDocuments: [],
      });

      // Act
      await pipeline.execute(input);

      // Assert
      expect(mockAPIClient.executeBatchQueries).toHaveBeenCalledWith(
        mockQueries,
        testRun.startTime,
        testRun.endTime
      );
    });

    it('should close API client after query execution', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const mockQueries = [createMockQuery()];

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById.mockResolvedValue(createMockDynatraceConfig());
      mockAPIClient.executeBatchQueries.mockResolvedValue([
        { tileId: 'tile-1', tileTitle: 'Panel', result: { records: [] }, error: null },
      ]);
      mockDataProcessor.processDynatraceResults.mockResolvedValue({
        panelDocuments: [],
        metricsDocuments: [],
      });

      // Act
      await pipeline.execute(input);

      // Assert
      expect(mockAPIClient.close).toHaveBeenCalled();
    });

    it('should close API client even when query execution fails', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const mockQueries = [createMockQuery()];

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById.mockResolvedValue(createMockDynatraceConfig());
      mockAPIClient.executeBatchQueries.mockRejectedValue(new Error('API error'));

      // Act
      await pipeline.execute(input);

      // Assert
      expect(mockAPIClient.close).toHaveBeenCalled();
    });
  });

  describe('Multi-Instance Support', () => {
    it('should support multiple Dynatrace instances per test run', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const mockQueries = [
        createMockQuery({ dynatraceConfigId: 'saas-instance', panelId: 1 }),
        createMockQuery({ dynatraceConfigId: 'managed-instance', panelId: 2 }),
      ];
      const saasConfig = createMockDynatraceConfig({
        id: 'saas-instance',
        dynatraceType: 'saas',
      });
      const managedConfig = createMockDynatraceConfig({
        id: 'managed-instance',
        dynatraceType: 'managed',
      });

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById
        .mockResolvedValueOnce(saasConfig)
        .mockResolvedValueOnce(managedConfig);
      mockAPIClient.executeBatchQueries.mockResolvedValue([]);
      mockDataProcessor.processDynatraceResults.mockResolvedValue({
        panelDocuments: [],
        metricsDocuments: [],
      });

      // Act
      await pipeline.execute(input);

      // Assert
      expect(DynatraceAPIClient).toHaveBeenCalledTimes(2);
      expect(mockAPIClient.close).toHaveBeenCalledTimes(2);
    });

    it('should use config tokens with fallback to environment variables', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const mockQueries = [createMockQuery()];
      const configWithoutTokens = createMockDynatraceConfig({
        apiToken: null,
        platformApiToken: null,
      });

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById.mockResolvedValue(configWithoutTokens);
      mockAPIClient.executeBatchQueries.mockResolvedValue([]);
      mockDataProcessor.processDynatraceResults.mockResolvedValue({
        panelDocuments: [],
        metricsDocuments: [],
      });

      // Act
      await pipeline.execute(input);

      // Assert - Should use environment variables as fallback
      expect(DynatraceAPIClient).toHaveBeenCalledWith(
        expect.objectContaining({
          apiToken: 'env-api-token',
          platformToken: 'env-platform-token',
        })
      );
    });

    it('should skip queries when Dynatrace config is not found', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const mockQueries = [createMockQuery()];

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById.mockResolvedValue(null);
      mockDataProcessor.processDynatraceResults.mockResolvedValue({
        panelDocuments: [],
        metricsDocuments: [],
      });

      // Act
      const result = await pipeline.execute(input);

      // Assert
      expect(result.success).toBe(true);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('configuration not found')
      );
      expect(mockAPIClient.executeBatchQueries).not.toHaveBeenCalled();
    });
  });

  describe('Token Validation', () => {
    it('should skip queries when API token is missing', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const mockQueries = [createMockQuery()];
      const configWithoutApiToken = createMockDynatraceConfig({
        apiToken: null,
        platformApiToken: 'has-platform-token',
      });

      // Override environment config to also have no API token
      const { getConfig } = await import('../../../config/environment.js');
      vi.mocked(getConfig).mockReturnValue({
        DYNATRACE_API_TOKEN: undefined,
        DYNATRACE_PLATFORM_TOKEN: 'env-platform-token',
      } as any);

      // Create new pipeline instance with updated config
      const testPipeline = new DynatracePipeline(mockLogger);
      vi.spyOn(testPipeline as any, 'cleanupStaleApplicationDashboards').mockResolvedValue(undefined);

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById.mockResolvedValue(configWithoutApiToken);
      mockDataProcessor.processDynatraceResults.mockResolvedValue({
        panelDocuments: [],
        metricsDocuments: [],
      });

      // Act
      await testPipeline.execute(input);

      // Assert
      const errorCalls = mockLogger.error.mock.calls.map(call => call[0]);
      const hasApiTokenError = errorCalls.some((msg: string) =>
        msg && typeof msg === 'string' && msg.includes('API token not found')
      );
      expect(hasApiTokenError).toBe(true);
      expect(mockAPIClient.executeBatchQueries).not.toHaveBeenCalled();
    });

    it('should skip SaaS queries when platform token is missing', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const mockQueries = [createMockQuery()];
      const saasConfigWithoutPlatformToken = createMockDynatraceConfig({
        dynatraceType: 'saas',
        apiToken: 'has-api-token',
        platformApiToken: null,
      });

      // Override environment config to also have no platform token
      const { getConfig } = await import('../../../config/environment.js');
      vi.mocked(getConfig).mockReturnValue({
        DYNATRACE_API_TOKEN: 'env-api-token',
        DYNATRACE_PLATFORM_TOKEN: undefined,
      } as any);

      // Create new pipeline instance with updated config
      const testPipeline = new DynatracePipeline(mockLogger);
      vi.spyOn(testPipeline as any, 'cleanupStaleApplicationDashboards').mockResolvedValue(undefined);

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById.mockResolvedValue(saasConfigWithoutPlatformToken);
      mockDataProcessor.processDynatraceResults.mockResolvedValue({
        panelDocuments: [],
        metricsDocuments: [],
      });

      // Act
      await testPipeline.execute(input);

      // Assert
      const errorCalls = mockLogger.error.mock.calls.map(call => call[0]);
      const hasPlatformTokenError = errorCalls.some((msg: string) =>
        msg && typeof msg === 'string' && msg.includes('Platform API token required for SaaS')
      );
      expect(hasPlatformTokenError).toBe(true);
      expect(mockAPIClient.executeBatchQueries).not.toHaveBeenCalled();
    });

    it('should allow managed instances without platform token', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const mockQueries = [createMockQuery()];
      const managedConfig = createMockDynatraceConfig({
        dynatraceType: 'managed',
        apiToken: 'managed-api-token',
        platformApiToken: null,
      });

      // Override environment config to have no platform token for managed instances
      const { getConfig } = await import('../../../config/environment.js');
      vi.mocked(getConfig).mockReturnValue({
        DYNATRACE_API_TOKEN: 'env-api-token',
        DYNATRACE_PLATFORM_TOKEN: undefined,
      } as any);

      // Create new pipeline instance with updated config
      const testPipeline = new DynatracePipeline(mockLogger);
      vi.spyOn(testPipeline as any, 'cleanupStaleApplicationDashboards').mockResolvedValue(undefined);

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById.mockResolvedValue(managedConfig);
      mockAPIClient.executeBatchQueries.mockResolvedValue([
        { tileId: 'tile-1', tileTitle: 'Panel', result: { records: [] }, error: null },
      ]);
      mockDataProcessor.processDynatraceResults.mockResolvedValue({
        panelDocuments: [],
        metricsDocuments: [],
      });

      // Act
      await testPipeline.execute(input);

      // Assert
      // Check that API client was called for managed instances (platform token not required)
      const calls = vi.mocked(DynatraceAPIClient).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const firstCall = calls[0][0];
      expect(firstCall.dynatraceType).toBe('managed');
      expect(firstCall.platformToken).toBe(''); // Empty string for managed instances when no token available
      expect(mockAPIClient.executeBatchQueries).toHaveBeenCalled();
    });
  });

  describe('Data Processing and Storage', () => {
    it('should process query results into panel and metrics documents', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const testRun = createMockTestRun();
      const mockQueries = [createMockQuery()];
      const mockAPIResults = [createMockQueryResult()];

      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(testRun);
      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById.mockResolvedValue(createMockDynatraceConfig());
      mockAPIClient.executeBatchQueries.mockResolvedValue(mockAPIResults);
      mockDataProcessor.processDynatraceResults.mockResolvedValue({
        panelDocuments: [],
        metricsDocuments: [createMockMetricsDocument()],
      });

      // Act
      await pipeline.execute(input);

      // Assert
      expect(mockDataProcessor.processDynatraceResults).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            tileId: 'tile-1',
            tileTitle: 'Response Time',
          }),
        ]),
        'test-run-123',
        testRun.endTime,
        testRun
      );
    });

    it('should skip storage when no metrics are returned', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const mockQueries = [createMockQuery()];
      const storeSpy = vi.spyOn(pipeline as any, 'storeMetricsDocuments');

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById.mockResolvedValue(createMockDynatraceConfig());
      mockAPIClient.executeBatchQueries.mockResolvedValue([
        { tileId: 'tile-1', tileTitle: 'Panel', result: { records: [] }, error: null },
      ]);
      mockDataProcessor.processDynatraceResults.mockResolvedValue({
        panelDocuments: [],
        metricsDocuments: [], // Empty
      });

      // Act
      const result = await pipeline.execute(input);

      // Assert
      expect(result.success).toBe(true);
      expect(storeSpy).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('No Dynatrace metrics found')
      );
    });

    it('should store metrics with correct conflict handling', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const mockQueries = [createMockQuery()];
      const mockMetricsDoc = createMockMetricsDocument({
        data: [
          {
            metricName: 'response_time',
            time: new Date('2024-01-01T00:00:00Z'),
            timestep: 60,
            rampUp: false,
            value: 100,
            unit: 'ms',
          },
        ],
      });

      let querySQL = '';
      const mockManager = {
        query: vi.fn((sql: string) => {
          querySQL = sql;
          return Promise.resolve({ rows: [] });
        }),
      } as unknown as EntityManager;

      mockDatabaseService.transaction.mockImplementation(async (callback) => {
        return callback(mockManager);
      });

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById.mockResolvedValue(createMockDynatraceConfig());
      mockAPIClient.executeBatchQueries.mockResolvedValue([
        { tileId: 'tile-1', tileTitle: 'Panel', result: { records: [] }, error: null },
      ]);
      mockDataProcessor.processDynatraceResults.mockResolvedValue({
        panelDocuments: [],
        metricsDocuments: [mockMetricsDoc],
      });

      // Act
      await pipeline.execute(input);

      // Assert
      expect(querySQL).toContain('ON CONFLICT');
      expect(querySQL).toContain('DO UPDATE SET');
    });
  });

  describe('Error Handling', () => {
    it('should return error result when input validation fails', async () => {
      // Arrange
      const invalidInput = { testRunIds: [] };

      // Act
      const result: PipelineResult = await pipeline.execute(invalidInput);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error.message).toContain('Invalid input');
      expect(result.error.code).toBe('INVALID_INPUT');
    });

    it('should handle test run loading errors', async () => {
      // Arrange
      const input = { testRunIds: ['non-existent'] };
      mockDatabaseService.getTestRunByTestRunId.mockRejectedValue(
        new Error('Test run not found')
      );

      // Act
      const result: PipelineResult = await pipeline.execute(input);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error.message).toContain('Test run not found');
      expect(result.error.code).toBe('DYNATRACE_DQL_COLLECTION_FAILED');
    });

    it('should handle query construction errors', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      mockQueryConstructor.constructQueriesFromDatabase.mockRejectedValue(
        new Error('Query construction failed')
      );

      // Act
      const result: PipelineResult = await pipeline.execute(input);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error.message).toContain('Query construction failed');
    });

    it('should handle API execution errors gracefully', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const mockQueries = [createMockQuery()];

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById.mockResolvedValue(createMockDynatraceConfig());
      mockAPIClient.executeBatchQueries.mockRejectedValue(new Error('API request failed'));

      // Act
      const result: PipelineResult = await pipeline.execute(input);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error.message).toContain('API request failed');
      expect(mockAPIClient.close).toHaveBeenCalled(); // Should still close client
    });

    it('should handle data processing errors', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const mockQueries = [createMockQuery()];

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById.mockResolvedValue(createMockDynatraceConfig());
      mockAPIClient.executeBatchQueries.mockResolvedValue([
        { tileId: 'tile-1', tileTitle: 'Panel', result: { records: [] }, error: null },
      ]);
      mockDataProcessor.processDynatraceResults.mockRejectedValue(
        new Error('Data processing failed')
      );

      // Act
      const result: PipelineResult = await pipeline.execute(input);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error.message).toContain('Data processing failed');
    });

    it('should handle database storage errors', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const mockQueries = [createMockQuery()];
      const mockMetricsDoc = createMockMetricsDocument();

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById.mockResolvedValue(createMockDynatraceConfig());
      mockAPIClient.executeBatchQueries.mockResolvedValue([
        { tileId: 'tile-1', tileTitle: 'Panel', result: { records: [] }, error: null },
      ]);
      mockDataProcessor.processDynatraceResults.mockResolvedValue({
        panelDocuments: [],
        metricsDocuments: [mockMetricsDoc],
      });

      mockDatabaseService.transaction.mockRejectedValue(
        new Error('Database insert failed')
      );

      // Act
      const result: PipelineResult = await pipeline.execute(input);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error.message).toContain('Database insert failed');
    });

    it('should log errors with context', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const error = new Error('Pipeline failure');

      // Mock the loadTestRun to throw an error (which happens in collectDynatraceMetrics)
      mockDatabaseService.getTestRunByTestRunId.mockRejectedValue(error);

      // Act
      const result = await pipeline.execute(input);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error.message).toContain('Pipeline failure');
    });
  });

  describe('Performance Logging', () => {
    it('should log performance metrics after execution', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue([]);

      // Act
      await pipeline.execute(input);

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Dynatrace DQL metrics collection')
      );
    });

    it('should include duration in result', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue([]);
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(createMockTestRun());

      // Act
      const result = await pipeline.execute(input);

      // Assert
      // Duration is set by BasePipelineTypeORM, which is mocked in these tests
      expect(result.success).toBe(true);
    });

    it('should log summary with query and metrics counts', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const mockQueries = [createMockQuery()];
      const mockMetricsDoc = createMockMetricsDocument();

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById.mockResolvedValue(createMockDynatraceConfig());
      mockAPIClient.executeBatchQueries.mockResolvedValue([
        { tileId: 'tile-1', tileTitle: 'Panel', result: { records: [] }, error: null },
      ]);
      mockDataProcessor.processDynatraceResults.mockResolvedValue({
        panelDocuments: [],
        metricsDocuments: [mockMetricsDoc],
      });

      // Act
      await pipeline.execute(input);

      // Assert
      const logCalls = mockLogger.info.mock.calls.map(call => call[0]);
      const hasCompletedLog = logCalls.some((msg: string) =>
        msg && typeof msg === 'string' &&
        msg.includes('Completed') &&
        msg.includes('Dynatrace queries')
      );
      expect(hasCompletedLog).toBe(true);
    });
  });

  describe('MetricsSource Behavior', () => {
    it('should include metrics_source_id in ds_metrics INSERT statements', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const mockQueries = [createMockQuery()];
      const mockMetricsDoc = createMockMetricsDocument({
        metricsSourceId: 'ms-uuid-123',
        data: [
          {
            metricName: 'response_time',
            time: new Date('2024-01-01T00:00:00Z'),
            timestep: 60,
            rampUp: false,
            value: 100,
            unit: 'ms',
          },
        ],
      });

      const capturedParams: any[][] = [];
      const mockManager = {
        query: vi.fn((sql: string, params: any[]) => {
          capturedParams.push(params);
          return Promise.resolve({ rows: [] });
        }),
      } as unknown as EntityManager;

      mockDatabaseService.transaction.mockImplementation(async (callback) => {
        return callback(mockManager);
      });

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById.mockResolvedValue(createMockDynatraceConfig());
      mockAPIClient.executeBatchQueries.mockResolvedValue([
        { tileId: 'tile-1', tileTitle: 'Panel', result: { records: [] }, error: null },
      ]);
      mockDataProcessor.processDynatraceResults.mockResolvedValue({
        panelDocuments: [],
        metricsDocuments: [mockMetricsDoc],
      });

      // Act
      await pipeline.execute(input);

      // Assert - metrics_source_id is the 3rd parameter ($3) in the ds_metrics INSERT
      expect(capturedParams.length).toBeGreaterThan(0);
      expect(capturedParams[0][2]).toBe('ms-uuid-123');
    });

    it('should pass null metrics_source_id when not provided', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const mockQueries = [createMockQuery()];
      const mockMetricsDoc = createMockMetricsDocument({
        metricsSourceId: undefined,
        data: [
          {
            metricName: 'response_time',
            time: new Date('2024-01-01T00:00:00Z'),
            timestep: 60,
            rampUp: false,
            value: 100,
            unit: 'ms',
          },
        ],
      });

      const capturedParams: any[][] = [];
      const mockManager = {
        query: vi.fn((sql: string, params: any[]) => {
          capturedParams.push(params);
          return Promise.resolve({ rows: [] });
        }),
      } as unknown as EntityManager;

      mockDatabaseService.transaction.mockImplementation(async (callback) => {
        return callback(mockManager);
      });

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById.mockResolvedValue(createMockDynatraceConfig());
      mockAPIClient.executeBatchQueries.mockResolvedValue([
        { tileId: 'tile-1', tileTitle: 'Panel', result: { records: [] }, error: null },
      ]);
      mockDataProcessor.processDynatraceResults.mockResolvedValue({
        panelDocuments: [],
        metricsDocuments: [mockMetricsDoc],
      });

      // Act
      await pipeline.execute(input);

      // Assert - metrics_source_id should be null when not provided
      expect(capturedParams.length).toBeGreaterThan(0);
      expect(capturedParams[0][2]).toBeNull();
    });

    it('should include metrics_source_id in ds_panels INSERT statements', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const mockQueries = [createMockQuery()];

      // Spy on storePanelDocuments to capture the SQL
      const capturedSQL: string[] = [];
      const capturedParams: any[][] = [];
      const mockManager = {
        query: vi.fn((sql: string, params: any[]) => {
          capturedSQL.push(sql);
          capturedParams.push(params);
          return Promise.resolve({ rows: [] });
        }),
      } as unknown as EntityManager;

      mockDatabaseService.transaction.mockImplementation(async (callback) => {
        return callback(mockManager);
      });

      // Call storePanelDocuments directly since execute() calls storeMetricsDocuments
      const panelDoc = {
        test_run_id: 'test-run-123',
        application_dashboard_id: 'app-dash-uuid',
        metrics_source_id: 'ms-uuid-456',
        dashboard_uid: 'dynatrace-dql',
        panel_id: 1,
        panel_title: 'Response Time',
        dashboard_label: 'Response Time',
        panel: {},
        query_variables: {},
        datasource_type: 'dynatrace',
        benchmark_ids: [],
        requests: [],
        errors: null,
        warnings: null,
      };

      const testRun = createMockTestRun();

      // Access private method
      await (pipeline as any).storePanelDocuments([panelDoc], 'test-run-123', testRun);

      // Assert - ds_panels INSERT should include metrics_source_id
      const panelInsertSQL = capturedSQL.find(sql => sql.includes('ds_panels'));
      expect(panelInsertSQL).toBeDefined();
      expect(panelInsertSQL).toContain('metrics_source_id');
      // metrics_source_id is the 3rd parameter ($3) in the ds_panels INSERT
      const panelParams = capturedParams[0];
      expect(panelParams[2]).toBe('ms-uuid-456');
    });

    it('should include metrics_source_id column in ds_metrics ON CONFLICT update', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const mockQueries = [createMockQuery()];
      const mockMetricsDoc = createMockMetricsDocument({
        metricsSourceId: 'ms-uuid-789',
        data: [
          {
            metricName: 'response_time',
            time: new Date('2024-01-01T00:00:00Z'),
            timestep: 60,
            rampUp: false,
            value: 100,
            unit: 'ms',
          },
        ],
      });

      let capturedSQL = '';
      const mockManager = {
        query: vi.fn((sql: string) => {
          capturedSQL = sql;
          return Promise.resolve({ rows: [] });
        }),
      } as unknown as EntityManager;

      mockDatabaseService.transaction.mockImplementation(async (callback) => {
        return callback(mockManager);
      });

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById.mockResolvedValue(createMockDynatraceConfig());
      mockAPIClient.executeBatchQueries.mockResolvedValue([
        { tileId: 'tile-1', tileTitle: 'Panel', result: { records: [] }, error: null },
      ]);
      mockDataProcessor.processDynatraceResults.mockResolvedValue({
        panelDocuments: [],
        metricsDocuments: [mockMetricsDoc],
      });

      // Act
      await pipeline.execute(input);

      // Assert - ON CONFLICT clause should update metrics_source_id with COALESCE
      expect(capturedSQL).toContain('metrics_source_id = COALESCE(EXCLUDED.metrics_source_id, ds_metrics.metrics_source_id)');
    });
  });

  describe('API Client Configuration', () => {
    it('should create API client with correct SaaS configuration', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const mockQueries = [createMockQuery()];
      const saasConfig = createMockDynatraceConfig({
        dynatraceType: 'saas',
        host: 'tenant.live.dynatrace.com',
        apiToken: 'api-token',
        platformApiToken: 'platform-token',
      });

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById.mockResolvedValue(saasConfig);
      mockAPIClient.executeBatchQueries.mockResolvedValue([]);
      mockDataProcessor.processDynatraceResults.mockResolvedValue({
        panelDocuments: [],
        metricsDocuments: [],
      });

      // Act
      await pipeline.execute(input);

      // Assert
      expect(DynatraceAPIClient).toHaveBeenCalledWith({
        host: saasConfig.host,
        apiToken: 'api-token',
        platformToken: 'platform-token',
        dynatraceType: 'saas',
        maxConcurrent: 5,
      });
    });

    it('should create API client with maxConcurrent limit', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-123'] };
      const mockQueries = [createMockQuery()];

      mockQueryConstructor.constructQueriesFromDatabase.mockResolvedValue(mockQueries);
      mockRepository.getDynatraceConfigById.mockResolvedValue(createMockDynatraceConfig());
      mockAPIClient.executeBatchQueries.mockResolvedValue([]);
      mockDataProcessor.processDynatraceResults.mockResolvedValue({
        panelDocuments: [],
        metricsDocuments: [],
      });

      // Act
      await pipeline.execute(input);

      // Assert
      expect(DynatraceAPIClient).toHaveBeenCalledWith(
        expect.objectContaining({
          maxConcurrent: 5,
        })
      );
    });
  });
});

describe('DynatraceDashboardManager - MetricsSource', () => {
  let manager: any;
  let mockDataSource: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockDataSource = {
      query: vi.fn(),
    };

    // Dynamically import to avoid hoisted mock conflicts
    const { DynatraceDashboardManager } = await import(
      '../../../pipelines/helpers/dynatrace-dashboard-manager.js'
    );
    manager = new DynatraceDashboardManager(mockDataSource, mockLogger);
  });

  it('should return metricsSourceId in DashboardMetadata from getOrCreateDynatraceDashboard', async () => {
    // Arrange
    // 1st query: check if application_dashboard exists -> not found
    mockDataSource.query
      .mockResolvedValueOnce([]) // SELECT id FROM application_dashboards
      .mockResolvedValueOnce([]) // INSERT INTO application_dashboards (no grafana refs)
      .mockResolvedValueOnce([{ id: 'metrics-source-uuid-1' }]); // INSERT INTO metrics_sources RETURNING id

    // Act
    const metadata = await manager.getOrCreateDynatraceDashboard(
      'Response Time',
      'ecommerce',
      'acc',
      'loadTest'
    );

    // Assert
    expect(metadata.metricsSourceId).toBe('metrics-source-uuid-1');
    expect(metadata.dashboardLabel).toBe('Response Time');
    expect(metadata.dashboardId).toBeDefined();
    expect(metadata.dashboardUid).toBeDefined();
  });

  it('should continue without metricsSourceId when upsertMetricsSource fails (non-blocking)', async () => {
    // Arrange
    mockDataSource.query
      .mockResolvedValueOnce([]) // SELECT id FROM application_dashboards
      .mockResolvedValueOnce([]) // INSERT INTO application_dashboards (no grafana refs)
      .mockRejectedValueOnce(new Error('metrics_sources table does not exist')); // INSERT INTO metrics_sources FAILS

    // Act
    const metadata = await manager.getOrCreateDynatraceDashboard(
      'Response Time',
      'ecommerce',
      'acc',
      'loadTest'
    );

    // Assert - should succeed but metricsSourceId should be undefined
    expect(metadata.metricsSourceId).toBeUndefined();
    expect(metadata.dashboardLabel).toBe('Response Time');
    expect(metadata.dashboardId).toBeDefined();
    // Should have logged the error (non-blocking)
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('MetricsSource dual-write failed')
    );
  });

  it('should return cached metricsSourceId on subsequent calls', async () => {
    // Arrange - first call creates the dashboard
    mockDataSource.query
      .mockResolvedValueOnce([]) // SELECT id FROM application_dashboards
      .mockResolvedValueOnce([]) // INSERT INTO application_dashboards (no grafana refs)
      .mockResolvedValueOnce([{ id: 'metrics-source-uuid-cached' }]); // INSERT INTO metrics_sources RETURNING id

    // Act - first call populates cache
    const metadata1 = await manager.getOrCreateDynatraceDashboard(
      'Response Time',
      'ecommerce',
      'acc',
      'loadTest'
    );

    // Act - second call should hit cache
    const metadata2 = await manager.getOrCreateDynatraceDashboard(
      'Response Time',
      'ecommerce',
      'acc',
      'loadTest'
    );

    // Assert
    expect(metadata1.metricsSourceId).toBe('metrics-source-uuid-cached');
    expect(metadata2.metricsSourceId).toBe('metrics-source-uuid-cached');
    // The dataSource.query should only be called for the first invocation (3 calls), not again
    expect(mockDataSource.query).toHaveBeenCalledTimes(3);
  });
});
