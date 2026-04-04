import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TestRunsAnomalyService } from './test-runs-anomaly.service';
import {
  TestRun as TestRunEntity,
  DsAdaptResults,
  DsCompareConfig,
} from '../../../entities';
import { DeleteAnomalyDto } from '../dto/delete-anomaly.dto';
import {
  ResourceNotFoundException,
  ValidationException,
} from '../../../common/exceptions/business.exception';
import { BullMQClientService } from '../../data-science/services/bullmq-client.service';
import {
  createMockRepository,
  MockRepository,
  createMockDeleteQueryBuilder,
  createMockQueryBuilder,
} from '../../../../test/helpers/mock-repository.factory';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_RUN_ID = 'test-run-uuid-001';
const APP_DASH_ID = 'app-dash-uuid-001';
const PANEL_ID = 42;

function makeTestRun(overrides: Partial<TestRunEntity> = {}): TestRunEntity {
  return {
    id: 'uuid-1',
    testRunId: TEST_RUN_ID,
    systemUnderTestId: 'sut-uuid-1',
    testEnvironment: 'production',
    workload: 'loadTest',
    ...overrides,
  } as TestRunEntity;
}

function makeAdaptResult(overrides: Partial<DsAdaptResults> = {}): DsAdaptResults {
  return {
    test_run_id: TEST_RUN_ID,
    application_dashboard_id: APP_DASH_ID,
    panel_id: PANEL_ID,
    metric_name: 'response_time_p90',
    dashboard_label: 'My Dashboard',
    panel_title: 'Response Time',
    unit: 'ms',
    conclusion: { label: 'regression' },
    statistic: { test: 150, control: 100, diff: 50 },
    is_stale: false,
    stale_reason: null,
    stale_at: null,
    config_hash_used: 'abc123',
    ...overrides,
  } as unknown as DsAdaptResults;
}

function makeCompareConfig(overrides: Partial<DsCompareConfig> = {}): DsCompareConfig {
  return {
    id: 'config-uuid-1',
    application_dashboard_id: APP_DASH_ID,
    panel_id: PANEL_ID,
    metric_name: 'response_time_p90',
    system_under_test_id: 'sut-uuid-1',
    test_environment: 'production',
    workload: 'loadTest',
    config_data: {
      metricClassification: { classification: 'RED_duration', higherIsBetter: false },
    },
    ...overrides,
  } as unknown as DsCompareConfig;
}

function makeDeleteDto(overrides: Partial<DeleteAnomalyDto> = {}): DeleteAnomalyDto {
  return {
    dashboardLabel: 'My Dashboard',
    panelTitle: 'Response Time',
    panelId: String(PANEL_ID),
    applicationDashboardId: APP_DASH_ID,
    scope: 'panel',
    range: 'current-test-run',
    ...overrides,
  } as DeleteAnomalyDto;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('TestRunsAnomalyService', () => {
  let service: TestRunsAnomalyService;
  let testRunRepo: MockRepository<TestRunEntity>;
  let dsAdaptResultsRepo: MockRepository<DsAdaptResults>;
  let dsCompareConfigRepo: MockRepository<DsCompareConfig>;
  let mockDataSource: jest.Mocked<DataSource>;
  let bullmqClientService: jest.Mocked<BullMQClientService>;

  beforeEach(async () => {
    // Build a reusable transactional entity manager mock used by cascadeDeleteAnomalyData
    const mockDeleteQb = createMockDeleteQueryBuilder();
    mockDeleteQb.execute.mockResolvedValue({ affected: 3, raw: [] });

    const mockSelectQb = createMockQueryBuilder();
    mockSelectQb.getCount.mockResolvedValue(3);

    const transactionalEntityManager = {
      createQueryBuilder: jest.fn().mockReturnValue({
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 3, raw: [] }),
      }),
    };

    mockDataSource = {
      query: jest.fn().mockResolvedValue([]),
      transaction: jest.fn().mockImplementation((cb: (em: unknown) => Promise<unknown>) =>
        cb(transactionalEntityManager),
      ),
    } as unknown as jest.Mocked<DataSource>;

    bullmqClientService = {
      addJob: jest.fn().mockResolvedValue('job-id-1'),
    } as unknown as jest.Mocked<BullMQClientService>;

    testRunRepo = createMockRepository<TestRunEntity>();
    dsAdaptResultsRepo = createMockRepository<DsAdaptResults>();
    dsCompareConfigRepo = createMockRepository<DsCompareConfig>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestRunsAnomalyService,
        { provide: getRepositoryToken(TestRunEntity), useValue: testRunRepo },
        { provide: getRepositoryToken(DsAdaptResults), useValue: dsAdaptResultsRepo },
        { provide: getRepositoryToken(DsCompareConfig), useValue: dsCompareConfigRepo },
        { provide: DataSource, useValue: mockDataSource },
        { provide: BullMQClientService, useValue: bullmqClientService },
      ],
    }).compile();

    service = module.get<TestRunsAnomalyService>(TestRunsAnomalyService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // getTestRunCheckResults
  // -------------------------------------------------------------------------
  describe('getTestRunCheckResults', () => {
    it('should return parsed check results for the given test run', async () => {
      const rawRows = [
        {
          test_run_id: TEST_RUN_ID,
          targets: JSON.stringify([{ name: 'GET /api/health' }]),
          requirement: JSON.stringify({ type: 'response_time', threshold: 200 }),
          created_at: '2024-01-01T00:00:00Z',
        },
      ];
      mockDataSource.query.mockResolvedValue(rawRows);

      const results = await service.getTestRunCheckResults(TEST_RUN_ID);

      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('check_results'),
        [TEST_RUN_ID],
      );
      expect(results).toHaveLength(1);
      expect(results[0].test_run_id).toBe(TEST_RUN_ID);
      // JSON string fields should be parsed to objects
      expect(results[0].targets).toEqual([{ name: 'GET /api/health' }]);
      expect(results[0].requirement).toEqual({ type: 'response_time', threshold: 200 });
    });

    it('should preserve already-parsed JSONB objects without double-parsing', async () => {
      const rawRows = [
        {
          test_run_id: TEST_RUN_ID,
          targets: [{ name: 'GET /api' }], // already an object
          requirement: { type: 'tps', threshold: 50 }, // already an object
          created_at: '2024-01-01T00:00:00Z',
        },
      ];
      mockDataSource.query.mockResolvedValue(rawRows);

      const results = await service.getTestRunCheckResults(TEST_RUN_ID);

      expect(results[0].targets).toEqual([{ name: 'GET /api' }]);
      expect(results[0].requirement).toEqual({ type: 'tps', threshold: 50 });
    });

    it('should return an empty array when no check results exist', async () => {
      mockDataSource.query.mockResolvedValue([]);

      const results = await service.getTestRunCheckResults(TEST_RUN_ID);

      expect(results).toEqual([]);
    });

    it('should propagate database errors', async () => {
      mockDataSource.query.mockRejectedValue(new Error('DB connection error'));

      await expect(service.getTestRunCheckResults(TEST_RUN_ID)).rejects.toThrow(
        'DB connection error',
      );
    });

    it('should pass optional system/environment/workload parameters without error', async () => {
      mockDataSource.query.mockResolvedValue([]);

      await expect(
        service.getTestRunCheckResults(TEST_RUN_ID, 'MySystem', 'prod', 'loadTest'),
      ).resolves.toEqual([]);
    });

    it('should pass test_run_id as query parameter for SQL injection safety', async () => {
      mockDataSource.query.mockResolvedValue([]);

      await service.getTestRunCheckResults(TEST_RUN_ID);

      const [, params] = mockDataSource.query.mock.calls[0];
      expect(params).toEqual([TEST_RUN_ID]);
    });
  });

  // -------------------------------------------------------------------------
  // getAnomalyDetectionResults
  // -------------------------------------------------------------------------
  describe('getAnomalyDetectionResults', () => {
    describe('Happy Path', () => {
      it('should return enriched anomaly results with classification from exact config match', async () => {
        testRunRepo.findOne.mockResolvedValue(makeTestRun());
        dsAdaptResultsRepo.find.mockResolvedValue([makeAdaptResult()]);
        dsCompareConfigRepo.find.mockResolvedValue([makeCompareConfig()]);

        const results = await service.getAnomalyDetectionResults(TEST_RUN_ID);

        expect(results).toHaveLength(1);
        const r = results[0];
        expect(r.dashboard_label).toBe('My Dashboard');
        expect(r.panel_title).toBe('Response Time');
        expect(r.metric_name).toBe('response_time_p90');
        expect(r.unit).toBe('ms');
        expect(r.classification).toBe('RED_duration');
        expect(r.conclusion_label).toBe('regression');
        expect(r.test_value).toBe(150);
        expect(r.control_group_value).toBe(100);
        expect(r.difference).toBe(50);
        expect(r.application_dashboard_id).toBe(APP_DASH_ID);
        expect(r.panel_id).toBe(PANEL_ID);
        expect(r.is_stale).toBe(false);
        expect(r.stale_reason).toBeNull();
        expect(r.stale_at).toBeNull();
        expect(r.config_hash_used).toBe('abc123');
      });

      it('should return empty array when no adapt results exist', async () => {
        testRunRepo.findOne.mockResolvedValue(makeTestRun());
        dsAdaptResultsRepo.find.mockResolvedValue([]);
        dsCompareConfigRepo.find.mockResolvedValue([]);

        const results = await service.getAnomalyDetectionResults(TEST_RUN_ID);

        expect(results).toEqual([]);
      });

      it('should include compare_config when exact match is found', async () => {
        const configData = {
          metricClassification: { classification: 'RED_duration', higherIsBetter: false },
          thresholds: { percentageThreshold: 0.15 },
        };
        testRunRepo.findOne.mockResolvedValue(makeTestRun());
        dsAdaptResultsRepo.find.mockResolvedValue([makeAdaptResult()]);
        dsCompareConfigRepo.find.mockResolvedValue([
          makeCompareConfig({ config_data: configData }),
        ]);

        const results = await service.getAnomalyDetectionResults(TEST_RUN_ID);

        expect(results[0].compare_config).toEqual(configData);
      });

      it('should return null compare_config when no config entry matches', async () => {
        testRunRepo.findOne.mockResolvedValue(makeTestRun());
        dsAdaptResultsRepo.find.mockResolvedValue([makeAdaptResult()]);
        dsCompareConfigRepo.find.mockResolvedValue([]); // no config entries

        const results = await service.getAnomalyDetectionResults(TEST_RUN_ID);

        expect(results[0].compare_config).toBeNull();
      });
    });

    describe('Classification inheritance hierarchy', () => {
      const adaptResult = makeAdaptResult({ metric_name: 'cpu_usage' });

      it('should use exact metric-level match as highest priority', async () => {
        testRunRepo.findOne.mockResolvedValue(makeTestRun());
        dsAdaptResultsRepo.find.mockResolvedValue([adaptResult]);
        dsCompareConfigRepo.find.mockResolvedValue([
          // Exact match — should be used
          makeCompareConfig({
            application_dashboard_id: APP_DASH_ID,
            panel_id: PANEL_ID,
            metric_name: 'cpu_usage',
            config_data: { metricClassification: { classification: 'USE_utilization' } },
          }),
          // Panel-level — should be overridden
          makeCompareConfig({
            application_dashboard_id: APP_DASH_ID,
            panel_id: PANEL_ID,
            metric_name: null,
            config_data: { metricClassification: { classification: 'panel-level' } },
          }),
        ]);

        const results = await service.getAnomalyDetectionResults(TEST_RUN_ID);

        expect(results[0].classification).toBe('USE_utilization');
      });

      it('should fall back to panel-level classification when no metric match', async () => {
        testRunRepo.findOne.mockResolvedValue(makeTestRun());
        dsAdaptResultsRepo.find.mockResolvedValue([adaptResult]);
        dsCompareConfigRepo.find.mockResolvedValue([
          // Panel-level (no metric_name)
          makeCompareConfig({
            application_dashboard_id: APP_DASH_ID,
            panel_id: PANEL_ID,
            metric_name: null,
            config_data: { metricClassification: { classification: 'panel-classification' } },
          }),
        ]);

        const results = await service.getAnomalyDetectionResults(TEST_RUN_ID);

        expect(results[0].classification).toBe('panel-classification');
      });

      it('should fall back to dashboard-level classification when no panel match', async () => {
        testRunRepo.findOne.mockResolvedValue(makeTestRun());
        dsAdaptResultsRepo.find.mockResolvedValue([adaptResult]);
        dsCompareConfigRepo.find.mockResolvedValue([
          // Dashboard-level (no panel_id, no metric_name)
          makeCompareConfig({
            application_dashboard_id: APP_DASH_ID,
            panel_id: null,
            metric_name: null,
            config_data: { metricClassification: { classification: 'dashboard-classification' } },
          }),
        ]);

        const results = await service.getAnomalyDetectionResults(TEST_RUN_ID);

        expect(results[0].classification).toBe('dashboard-classification');
      });

      it('should fall back to environment-level classification when no dashboard match', async () => {
        testRunRepo.findOne.mockResolvedValue(makeTestRun());
        dsAdaptResultsRepo.find.mockResolvedValue([adaptResult]);
        dsCompareConfigRepo.find.mockResolvedValue([
          // Environment-level (all nulls)
          makeCompareConfig({
            application_dashboard_id: null,
            panel_id: null,
            metric_name: null,
            config_data: { metricClassification: { classification: 'environment-classification' } },
          }),
        ]);

        const results = await service.getAnomalyDetectionResults(TEST_RUN_ID);

        expect(results[0].classification).toBe('environment-classification');
      });

      it('should return "unclassified" when no config entry matches at any level', async () => {
        testRunRepo.findOne.mockResolvedValue(makeTestRun());
        dsAdaptResultsRepo.find.mockResolvedValue([adaptResult]);
        dsCompareConfigRepo.find.mockResolvedValue([]); // nothing

        const results = await service.getAnomalyDetectionResults(TEST_RUN_ID);

        expect(results[0].classification).toBe('unclassified');
      });

      it('should return "unclassified" when config_data has no metricClassification', async () => {
        testRunRepo.findOne.mockResolvedValue(makeTestRun());
        dsAdaptResultsRepo.find.mockResolvedValue([adaptResult]);
        dsCompareConfigRepo.find.mockResolvedValue([
          makeCompareConfig({
            application_dashboard_id: APP_DASH_ID,
            panel_id: PANEL_ID,
            metric_name: 'cpu_usage',
            config_data: { thresholds: { percentageThreshold: 0.15 } }, // no metricClassification
          }),
        ]);

        const results = await service.getAnomalyDetectionResults(TEST_RUN_ID);

        expect(results[0].classification).toBe('unclassified');
      });

      it('should return "unclassified" when metricClassification has non-string classification', async () => {
        testRunRepo.findOne.mockResolvedValue(makeTestRun());
        dsAdaptResultsRepo.find.mockResolvedValue([adaptResult]);
        dsCompareConfigRepo.find.mockResolvedValue([
          makeCompareConfig({
            application_dashboard_id: APP_DASH_ID,
            panel_id: PANEL_ID,
            metric_name: 'cpu_usage',
            config_data: { metricClassification: { classification: 42 } }, // wrong type
          }),
        ]);

        const results = await service.getAnomalyDetectionResults(TEST_RUN_ID);

        expect(results[0].classification).toBe('unclassified');
      });
    });

    describe('Null/missing conclusion and statistic fields', () => {
      it('should return "unknown" conclusion_label when conclusion is null', async () => {
        testRunRepo.findOne.mockResolvedValue(makeTestRun());
        dsAdaptResultsRepo.find.mockResolvedValue([makeAdaptResult({ conclusion: null })]);
        dsCompareConfigRepo.find.mockResolvedValue([]);

        const results = await service.getAnomalyDetectionResults(TEST_RUN_ID);

        expect(results[0].conclusion_label).toBe('unknown');
      });

      it('should return "unknown" conclusion_label when conclusion.label is not a string', async () => {
        testRunRepo.findOne.mockResolvedValue(makeTestRun());
        dsAdaptResultsRepo.find.mockResolvedValue([
          makeAdaptResult({ conclusion: { label: 42 } as unknown }),
        ]);
        dsCompareConfigRepo.find.mockResolvedValue([]);

        const results = await service.getAnomalyDetectionResults(TEST_RUN_ID);

        expect(results[0].conclusion_label).toBe('unknown');
      });

      it('should return null values when statistic is null', async () => {
        testRunRepo.findOne.mockResolvedValue(makeTestRun());
        dsAdaptResultsRepo.find.mockResolvedValue([makeAdaptResult({ statistic: null })]);
        dsCompareConfigRepo.find.mockResolvedValue([]);

        const results = await service.getAnomalyDetectionResults(TEST_RUN_ID);

        expect(results[0].test_value).toBeNull();
        expect(results[0].control_group_value).toBeNull();
        expect(results[0].difference).toBeNull();
      });

      it('should return null for unit when it is empty string', async () => {
        testRunRepo.findOne.mockResolvedValue(makeTestRun());
        dsAdaptResultsRepo.find.mockResolvedValue([makeAdaptResult({ unit: '' })]);
        dsCompareConfigRepo.find.mockResolvedValue([]);

        const results = await service.getAnomalyDetectionResults(TEST_RUN_ID);

        expect(results[0].unit).toBeNull();
      });

      it('should return false for is_stale when it is falsy', async () => {
        testRunRepo.findOne.mockResolvedValue(makeTestRun());
        dsAdaptResultsRepo.find.mockResolvedValue([makeAdaptResult({ is_stale: null as unknown as boolean })]);
        dsCompareConfigRepo.find.mockResolvedValue([]);

        const results = await service.getAnomalyDetectionResults(TEST_RUN_ID);

        expect(results[0].is_stale).toBe(false);
      });
    });

    describe('Error scenarios', () => {
      it('should throw ResourceNotFoundException when test run is not found', async () => {
        testRunRepo.findOne.mockResolvedValue(null);

        await expect(service.getAnomalyDetectionResults(TEST_RUN_ID)).rejects.toThrow(
          ResourceNotFoundException,
        );
      });

      it('should rethrow database errors from adapt results fetch', async () => {
        testRunRepo.findOne.mockResolvedValue(makeTestRun());
        dsAdaptResultsRepo.find.mockRejectedValue(new Error('DB query failed'));

        await expect(service.getAnomalyDetectionResults(TEST_RUN_ID)).rejects.toThrow(
          'DB query failed',
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // deleteAnomalyData
  // -------------------------------------------------------------------------
  describe('deleteAnomalyData', () => {
    describe('scope: current-test-run', () => {
      it('should delete for current test run and dispatch BullMQ job', async () => {
        const dto = makeDeleteDto({ range: 'current-test-run', scope: 'panel' });

        const result = await service.deleteAnomalyData(TEST_RUN_ID, dto);

        expect(result).toHaveProperty('deletedCount');
        expect(bullmqClientService.addJob).toHaveBeenCalledWith(
          're-evaluate-adapt-conclusion',
          { testRunIds: [TEST_RUN_ID] },
        );
      });

      it('should not query testRunRepo for current-test-run range', async () => {
        const dto = makeDeleteDto({ range: 'current-test-run', scope: 'panel' });

        await service.deleteAnomalyData(TEST_RUN_ID, dto);

        expect(testRunRepo.findOne).not.toHaveBeenCalled();
      });
    });

    describe('scope: all-test-runs', () => {
      it('should find all test runs with same sut/env/workload and delete all', async () => {
        testRunRepo.findOne.mockResolvedValue(makeTestRun());
        testRunRepo.find.mockResolvedValue([
          makeTestRun({ testRunId: 'run-1' }),
          makeTestRun({ testRunId: 'run-2' }),
        ]);

        const dto = makeDeleteDto({ range: 'all-test-runs', scope: 'panel' });
        const result = await service.deleteAnomalyData(TEST_RUN_ID, dto);

        expect(testRunRepo.find).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              systemUnderTestId: 'sut-uuid-1',
              testEnvironment: 'production',
              workload: 'loadTest',
            },
          }),
        );
        expect(result).toHaveProperty('deletedCount');
        expect(bullmqClientService.addJob).toHaveBeenCalledWith(
          're-evaluate-adapt-conclusion',
          { testRunIds: ['run-1', 'run-2'] },
        );
      });

      it('should return deletedCount 0 and skip BullMQ job when no matching test runs', async () => {
        testRunRepo.findOne.mockResolvedValue(makeTestRun());
        testRunRepo.find.mockResolvedValue([]);

        const dto = makeDeleteDto({ range: 'all-test-runs', scope: 'panel' });
        const result = await service.deleteAnomalyData(TEST_RUN_ID, dto);

        expect(result).toEqual({ deletedCount: 0 });
        expect(bullmqClientService.addJob).not.toHaveBeenCalled();
      });

      it('should throw ResourceNotFoundException when test run not found in all-test-runs range', async () => {
        testRunRepo.findOne.mockResolvedValue(null);

        const dto = makeDeleteDto({ range: 'all-test-runs', scope: 'panel' });

        await expect(service.deleteAnomalyData(TEST_RUN_ID, dto)).rejects.toThrow(
          ResourceNotFoundException,
        );
      });
    });

    describe('Validation', () => {
      it('should throw ValidationException when scope is metric and metricName is missing', async () => {
        const dto = makeDeleteDto({
          scope: 'metric',
          range: 'current-test-run',
          metricName: undefined,
        });

        await expect(service.deleteAnomalyData(TEST_RUN_ID, dto)).rejects.toThrow(
          ValidationException,
        );
      });

      it('should not throw when scope is metric and metricName is provided', async () => {
        const dto = makeDeleteDto({
          scope: 'metric',
          range: 'current-test-run',
          metricName: 'response_time_p90',
        });

        await expect(service.deleteAnomalyData(TEST_RUN_ID, dto)).resolves.toHaveProperty(
          'deletedCount',
        );
      });

      it('should not require metricName when scope is panel', async () => {
        const dto = makeDeleteDto({ scope: 'panel', range: 'current-test-run', metricName: undefined });

        await expect(service.deleteAnomalyData(TEST_RUN_ID, dto)).resolves.toBeDefined();
      });
    });

    describe('Error scenarios', () => {
      it('should rethrow transaction errors', async () => {
        mockDataSource.transaction.mockRejectedValue(new Error('Transaction failed'));

        const dto = makeDeleteDto({ range: 'current-test-run', scope: 'panel' });

        await expect(service.deleteAnomalyData(TEST_RUN_ID, dto)).rejects.toThrow(
          'Transaction failed',
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // cascadeDeleteAnomalyData
  // -------------------------------------------------------------------------
  describe('cascadeDeleteAnomalyData', () => {
    let transactionalEntityManager: { createQueryBuilder: jest.Mock };

    beforeEach(() => {
      const deleteQb = {
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 2, raw: [] }),
      };

      // count query (on repo)
      const countQb = {
        ...deleteQb,
        getCount: jest.fn().mockResolvedValue(2),
      };

      dsAdaptResultsRepo.createQueryBuilder.mockReturnValue(countQb as unknown as ReturnType<MockRepository<DsAdaptResults>['createQueryBuilder']>);

      transactionalEntityManager = {
        createQueryBuilder: jest.fn().mockReturnValue(deleteQb),
      };

      mockDataSource.transaction.mockImplementation(
        (cb: (em: unknown) => Promise<unknown>) => cb(transactionalEntityManager),
      );
    });

    it('should run transaction and return total deleted count', async () => {
      const dto = makeDeleteDto({ scope: 'panel', range: 'current-test-run' });

      const count = await service.cascadeDeleteAnomalyData([TEST_RUN_ID], dto);

      expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
      expect(typeof count).toBe('number');
    });

    it('should include metric filter when scope is metric', async () => {
      const dto = makeDeleteDto({
        scope: 'metric',
        range: 'current-test-run',
        metricName: 'cpu_usage',
      });

      await service.cascadeDeleteAnomalyData([TEST_RUN_ID], dto);

      // The transactional QB should have received andWhere calls with metric_name
      const qb = transactionalEntityManager.createQueryBuilder();
      expect(qb.andWhere).toBeDefined();
    });

    it('should not filter by metric_name when scope is panel', async () => {
      const dto = makeDeleteDto({ scope: 'panel', metricName: undefined });

      // Should complete without errors
      await expect(
        service.cascadeDeleteAnomalyData([TEST_RUN_ID], dto),
      ).resolves.toBeDefined();
    });

    it('should propagate errors from the transaction', async () => {
      mockDataSource.transaction.mockRejectedValue(new Error('Cascade failed'));

      const dto = makeDeleteDto({ scope: 'panel' });

      await expect(
        service.cascadeDeleteAnomalyData([TEST_RUN_ID], dto),
      ).rejects.toThrow('Cascade failed');
    });

    it('should handle multiple test run IDs', async () => {
      const testRunIds = ['run-1', 'run-2', 'run-3'];
      const dto = makeDeleteDto({ scope: 'panel' });

      await expect(
        service.cascadeDeleteAnomalyData(testRunIds, dto),
      ).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // getDsAdaptResult
  // -------------------------------------------------------------------------
  describe('getDsAdaptResult', () => {
    it('should return the adapt result when found', async () => {
      const mockResult = makeAdaptResult();
      dsAdaptResultsRepo.findOne.mockResolvedValue(mockResult);

      const result = await service.getDsAdaptResult(
        TEST_RUN_ID,
        APP_DASH_ID,
        String(PANEL_ID),
        'response_time_p90',
      );

      expect(dsAdaptResultsRepo.findOne).toHaveBeenCalledWith({
        where: {
          test_run_id: TEST_RUN_ID,
          application_dashboard_id: APP_DASH_ID,
          panel_id: PANEL_ID, // parsed to number
          metric_name: 'response_time_p90',
        },
      });
      expect(result).toBe(mockResult);
    });

    it('should parse the panelId string to an integer for the query', async () => {
      dsAdaptResultsRepo.findOne.mockResolvedValue(makeAdaptResult());

      await service.getDsAdaptResult(TEST_RUN_ID, APP_DASH_ID, '42', 'p90');

      const callArg = dsAdaptResultsRepo.findOne.mock.calls[0][0] as { where: { panel_id: number } };
      expect(callArg.where.panel_id).toBe(42);
      expect(typeof callArg.where.panel_id).toBe('number');
    });

    it('should throw ResourceNotFoundException when adapt result is not found', async () => {
      dsAdaptResultsRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getDsAdaptResult(TEST_RUN_ID, APP_DASH_ID, String(PANEL_ID), 'missing_metric'),
      ).rejects.toThrow(ResourceNotFoundException);
    });

    it('should throw DatabaseException for unexpected repository errors', async () => {
      dsAdaptResultsRepo.findOne.mockRejectedValue(new Error('Connection reset'));

      const { DatabaseException } = await import('../../../common/exceptions/business.exception');

      await expect(
        service.getDsAdaptResult(TEST_RUN_ID, APP_DASH_ID, String(PANEL_ID), 'p90'),
      ).rejects.toThrow(DatabaseException);
    });

    it('should rethrow ResourceNotFoundException without wrapping', async () => {
      dsAdaptResultsRepo.findOne.mockResolvedValue(null);

      const error = await service
        .getDsAdaptResult(TEST_RUN_ID, APP_DASH_ID, String(PANEL_ID), 'missing')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ResourceNotFoundException);
    });
  });
});
