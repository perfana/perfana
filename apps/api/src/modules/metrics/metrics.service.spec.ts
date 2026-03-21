import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { MetricsService, MetricDataPoint } from './metrics.service';
import {
  DsMetrics,
  DsMetricStatistics,
  DsControlGroups,
  DsChangePoints,
  DsAdaptResults,
  TestRun as TestRunEntity
} from '../../entities';
import { AuthorizationService } from '../../common/services/authorization.service';
import { createAuthorizationServiceMock } from '../../../test/mocks/authorization-service.mock';

describe('MetricsService', () => {
  let service: MetricsService;
  let metricsRepo: jest.Mocked<Repository<DsMetrics>>;
  let metricStatisticsRepo: jest.Mocked<Repository<DsMetricStatistics>>;
  let controlGroupsRepo: jest.Mocked<Repository<DsControlGroups>>;
  let changePointsRepo: jest.Mocked<Repository<DsChangePoints>>;
  let adaptResultsRepo: jest.Mocked<Repository<DsAdaptResults>>;
  let testRunRepo: jest.Mocked<Repository<TestRunEntity>>;

  const createMockRepository = () => ({
    find: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    query: jest.fn(),
    createQueryBuilder: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsService,
        {
          provide: getRepositoryToken(DsMetrics),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(DsMetricStatistics),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(DsControlGroups),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(DsChangePoints),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(DsAdaptResults),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(TestRunEntity),
          useValue: createMockRepository(),
        },
        {
          provide: AuthorizationService,
          useValue: createAuthorizationServiceMock(),
        },
      ],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
    metricsRepo = module.get(getRepositoryToken(DsMetrics));
    metricStatisticsRepo = module.get(getRepositoryToken(DsMetricStatistics));
    controlGroupsRepo = module.get(getRepositoryToken(DsControlGroups));
    changePointsRepo = module.get(getRepositoryToken(DsChangePoints));
    adaptResultsRepo = module.get(getRepositoryToken(DsAdaptResults));
    testRunRepo = module.get(getRepositoryToken(TestRunEntity));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return empty array (TODO implementation)', async () => {
      // Arrange - No setup needed for TODO method

      // Act
      const result = await service.findAll();

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('should return null (TODO implementation)', async () => {
      // Arrange - No setup needed for TODO method

      // Act
      const result = await service.findOne('test-id');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should return null (TODO implementation)', async () => {
      // Arrange
      const createDto: Partial<MetricDataPoint> = {
        time: new Date(),
        metric_name: 'test_metric',
        value: 100,
      };

      // Act
      const result = await service.create(createDto);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findDSMetricsForPanel', () => {
    const testRunId = 'test-run-123';
    const panelId = 1;
    const applicationDashboardId = 'dashboard-456';

    describe('Happy Path Scenarios', () => {
      it('should return metrics for a panel with application_dashboard_id', async () => {
        // Arrange
        const mockMetrics: MetricDataPoint[] = [
          {
            time: new Date('2024-01-01T10:00:00Z'),
            metric_name: 'response_time',
            value: 100,
            timestep: 1,
            ramp_up: false,
          },
          {
            time: new Date('2024-01-01T10:01:00Z'),
            metric_name: 'response_time',
            value: 105,
            timestep: 2,
            ramp_up: false,
          },
        ];

        // Mock existence check to indicate no downsampling needed
        metricsRepo.query.mockResolvedValue([{ needs_downsampling: false }]);
        metricsRepo.find.mockResolvedValue(mockMetrics as any);

        // Act
        const result = await service.findDSMetricsForPanel(testRunId, panelId, applicationDashboardId);

        // Assert
        expect(result).toEqual(mockMetrics);
        expect(metricsRepo.query).toHaveBeenCalled();
        expect(metricsRepo.find).toHaveBeenCalled();
      });

      it('should auto-discover application_dashboard_id when not provided', async () => {
        // Arrange
        const mockMetrics: MetricDataPoint[] = [
          {
            time: new Date('2024-01-01T10:00:00Z'),
            metric_name: 'cpu_usage',
            value: 50,
            timestep: 1,
            ramp_up: false,
          },
        ];

        metricsRepo.findOne.mockResolvedValue({
          application_dashboard_id: 'discovered-dashboard-123',
        } as any);
        // Mock existence check to indicate no downsampling needed
        metricsRepo.query.mockResolvedValue([{ needs_downsampling: false }]);
        metricsRepo.find.mockResolvedValue(mockMetrics as any);

        // Act
        const result = await service.findDSMetricsForPanel(testRunId, panelId);

        // Assert
        expect(result).toEqual(mockMetrics);
        expect(metricsRepo.findOne).toHaveBeenCalledWith({
          where: {
            test_run_id: testRunId,
            panel_id: panelId,
          },
          select: ['application_dashboard_id'],
        });
      });

      it('should downsample when data points exceed 4000 threshold', async () => {
        // Arrange - Mock LTTB downsampled results
        const downsampledMetrics: MetricDataPoint[] = Array.from({ length: 2000 }, (_, i) => ({
          time: new Date('2024-01-01T10:00:00Z').getTime() + i * 2000,
          metric_name: 'response_time',
          value: 100 + Math.random() * 50,
          timestep: i + 1,
          ramp_up: i < 50,
        }));

        // Mock existence check to indicate downsampling IS needed
        metricsRepo.query.mockImplementation((sql: string) => {
          if (sql.includes('needs_downsampling')) {
            return Promise.resolve([{ needs_downsampling: true }]);
          }
          // LTTB query returns downsampled results
          return Promise.resolve(downsampledMetrics);
        });

        // Act
        const result = await service.findDSMetricsForPanel(testRunId, panelId, applicationDashboardId);

        // Assert
        expect(result).not.toBeNull();
        expect(result!.length).toBeLessThanOrEqual(4000);
      });

      it('should downsample multiple metrics separately and distribute points evenly', async () => {
        // Arrange - Mock LTTB downsampled results with multiple metrics
        const downsampledMetrics: MetricDataPoint[] = [
          ...Array.from({ length: 1500 }, (_, i) => ({
            time: new Date('2024-01-01T10:00:00Z').getTime() + i * 2000,
            metric_name: 'response_time',
            value: 100 + i,
            timestep: i + 1,
            ramp_up: false,
          })),
          ...Array.from({ length: 1000 }, (_, i) => ({
            time: new Date('2024-01-01T10:00:00Z').getTime() + i * 2000,
            metric_name: 'cpu_usage',
            value: 50 + i,
            timestep: i + 1,
            ramp_up: false,
          })),
        ];

        // Mock existence check to indicate downsampling IS needed
        metricsRepo.query.mockImplementation((sql: string) => {
          if (sql.includes('needs_downsampling')) {
            return Promise.resolve([{ needs_downsampling: true }]);
          }
          // LTTB query returns downsampled results
          return Promise.resolve(downsampledMetrics);
        });

        // Act
        const result = await service.findDSMetricsForPanel(testRunId, panelId, applicationDashboardId);

        // Assert
        expect(result).not.toBeNull();
        expect(result!.length).toBeLessThanOrEqual(4000);

        // Verify both metrics are present in results
        const responseTimeCount = result!.filter(m => m.metric_name === 'response_time').length;
        const cpuUsageCount = result!.filter(m => m.metric_name === 'cpu_usage').length;
        expect(responseTimeCount).toBeGreaterThan(0);
        expect(cpuUsageCount).toBeGreaterThan(0);
      });
    });

    describe('Edge Cases', () => {
      it('should return null when no metrics found', async () => {
        // Arrange
        metricsRepo.query.mockResolvedValue([{ needs_downsampling: false }]);
        metricsRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.findDSMetricsForPanel(testRunId, panelId, applicationDashboardId);

        // Assert
        expect(result).toBeNull();
      });

      it('should handle panel with no application_dashboard_id discovered', async () => {
        // Arrange
        metricsRepo.findOne.mockResolvedValue(null);
        metricsRepo.query.mockResolvedValue([{ needs_downsampling: false }]);
        metricsRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.findDSMetricsForPanel(testRunId, panelId);

        // Assert
        expect(result).toBeNull();
        expect(metricsRepo.findOne).toHaveBeenCalled();
      });

      it('should handle metrics with undefined metric_name by grouping as unknown', async () => {
        // Arrange - LTTB downsampling handles undefined metric_name via SQL
        const downsampledMetrics: MetricDataPoint[] = Array.from({ length: 2000 }, (_, i) => ({
          time: new Date('2024-01-01T10:00:00Z').getTime() + i * 2000,
          metric_name: undefined,
          value: 100 + i,
          timestep: i + 1,
          ramp_up: false,
        }));

        metricsRepo.query.mockImplementation((sql: string) => {
          if (sql.includes('needs_downsampling')) {
            return Promise.resolve([{ needs_downsampling: true }]);
          }
          return Promise.resolve(downsampledMetrics);
        });

        // Act
        const result = await service.findDSMetricsForPanel(testRunId, panelId, applicationDashboardId);

        // Assert
        expect(result).not.toBeNull();
        expect(result!.length).toBeLessThanOrEqual(4000);
      });
    });

    describe('Error Scenarios', () => {
      it('should return null and log error when existence check fails', async () => {
        // Arrange
        const error = new Error('Database connection error');
        metricsRepo.query.mockRejectedValue(error);

        // Act
        const result = await service.findDSMetricsForPanel(testRunId, panelId, applicationDashboardId);

        // Assert
        expect(result).toBeNull();
      });

      it('should return null when regular query returns no data', async () => {
        // Arrange
        metricsRepo.query.mockResolvedValue([{ needs_downsampling: false }]);
        metricsRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.findDSMetricsForPanel(testRunId, panelId, applicationDashboardId);

        // Assert
        expect(result).toBeNull();
      });

      it('should handle downsampling returning empty results', async () => {
        // Arrange - LTTB query returns empty
        metricsRepo.query.mockImplementation((sql: string) => {
          if (sql.includes('needs_downsampling')) {
            return Promise.resolve([{ needs_downsampling: true }]);
          }
          return Promise.resolve([]);
        });

        // Act
        const result = await service.findDSMetricsForPanel(testRunId, panelId, applicationDashboardId);

        // Assert
        expect(result).toBeNull();
      });
    });
  });

  describe('findDSMetricStatisticsMultiple', () => {
    const baseParams = {
      applicationDashboardId: 'dashboard-123',
      panelId: 1,
      evaluateTypes: ['avg', 'max', 'min', 'count'],
      from: '2024-01-01T00:00:00Z',
      to: '2024-01-02T00:00:00Z',
      system: 'MyApp',
      environment: 'prod',
      workload: 'loadTest',
    };

    describe('Happy Path Scenarios', () => {
      it('should return metrics with statistics object for multiple evaluate types', async () => {
        // Arrange
        const mockTestRuns = [
          {
            id: 'uuid-1',
            testRunId: 'test-001',
            systemUnderTestId: 'system-1',
            testEnvironment: 'prod',
            workload: 'loadTest',
            startTime: new Date('2024-01-01T10:00:00Z'),
            applicationRelease: '1.0.0',
            annotations: ['test', 'run'],
            consolidatedResult: 'PASSED',
            systemUnderTest: { name: 'MyApp' },
          },
        ];

        const mockStatistics = [
          {
            test_run_id: 'test-001',
            panel_id: 1,
            metric_name: 'response_time',
            mean: 250.5,
            max_value: 400.0,
            min_value: 100.0,
            last_value: 275.0,
            count: 1000,
            median: 240.0,
            percentiles: { p90: 380.0, p95: 390.0, p99: 395.0 },
            updated_at: new Date('2024-01-01T10:05:00Z'),
          },
        ];

        const queryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue(mockTestRuns),
        };

        testRunRepo.createQueryBuilder.mockReturnValue(queryBuilder as any);
        metricStatisticsRepo.find.mockResolvedValue(mockStatistics as any);
        changePointsRepo.findOne.mockResolvedValue(null);

        // Act
        const result = await service.findDSMetricStatisticsMultiple(
          baseParams.applicationDashboardId,
          baseParams.panelId,
          baseParams.evaluateTypes,
          baseParams.from,
          baseParams.to,
          baseParams.system,
          baseParams.environment,
          baseParams.workload
        );

        // Assert
        expect(result).toHaveLength(1);
        expect(result[0]).toHaveProperty('statistics');
        expect(result[0]).not.toHaveProperty('value');
        expect(result[0]!.statistics).toMatchObject({
          avg: 250.5,
          max: 400.0,
          min: 100.0,
          count: 1000,
        });
        expect(result[0]).toMatchObject({
          test_run_id: 'test-001',
          panel_title: 'Panel 1',
          metric_name: 'response_time',
          version: '1.0.0',
          annotations: 'test, run',
          is_changepoint: false,
          consolidated_result: 'PASSED',
        });
      });

      it('should handle all evaluate types including percentiles', async () => {
        // Arrange
        const allEvaluateTypes = ['avg', 'max', 'min', 'last', 'count', 'q50', 'q90', 'q95', 'q99'];

        const mockTestRuns = [{
          id: 'uuid-1',
          testRunId: 'test-001',
          systemUnderTestId: 'system-1',
          testEnvironment: 'prod',
          workload: 'loadTest',
          startTime: new Date('2024-01-01T10:00:00Z'),
          applicationRelease: null,
          annotations: null,
          consolidatedResult: null,
          systemUnderTest: { name: 'MyApp' },
        }];

        const mockStatistics = [{
          test_run_id: 'test-001',
          panel_id: 1,
          metric_name: 'response_time',
          mean: 250.5,
          max_value: 400.0,
          min_value: 100.0,
          last_value: 275.0,
          count: 1000,
          median: 240.0,
          percentiles: { p90: 380.0, p95: 390.0, p99: 395.0 },
          updated_at: new Date('2024-01-01T10:05:00Z'),
        }];

        const queryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue(mockTestRuns),
        };

        testRunRepo.createQueryBuilder.mockReturnValue(queryBuilder as any);
        metricStatisticsRepo.find.mockResolvedValue(mockStatistics as any);
        changePointsRepo.findOne.mockResolvedValue(null);

        // Act
        const result = await service.findDSMetricStatisticsMultiple(
          baseParams.applicationDashboardId,
          baseParams.panelId,
          allEvaluateTypes,
          baseParams.from,
          baseParams.to,
          baseParams.system,
          baseParams.environment,
          baseParams.workload
        );

        // Assert
        expect(result[0]!.statistics).toMatchObject({
          avg: 250.5,
          max: 400.0,
          min: 100.0,
          last: 275.0,
          count: 1000,
          q50: 240.0,
          q90: 380.0,
          q95: 390.0,
          q99: 395.0,
        });
      });

      it('should mark test runs as changepoints when found in ds_changepoints', async () => {
        // Arrange
        const mockTestRuns = [{
          id: 'uuid-1',
          testRunId: 'test-001',
          systemUnderTestId: 'system-1',
          testEnvironment: 'prod',
          workload: 'loadTest',
          startTime: new Date('2024-01-01T10:00:00Z'),
          applicationRelease: '1.0.0',
          annotations: null,
          consolidatedResult: null,
          systemUnderTest: { name: 'MyApp' },
        }];

        const mockStatistics = [{
          test_run_id: 'test-001',
          panel_id: 1,
          metric_name: 'response_time',
          mean: 250.5,
          max_value: 400.0,
          min_value: 100.0,
          last_value: 275.0,
          count: 1000,
          median: 240.0,
          percentiles: null,
          updated_at: new Date('2024-01-01T10:05:00Z'),
        }];

        const queryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue(mockTestRuns),
        };

        testRunRepo.createQueryBuilder.mockReturnValue(queryBuilder as any);
        metricStatisticsRepo.find.mockResolvedValue(mockStatistics as any);

        // Mock batchCheckChangepoints via createQueryBuilder on changePointsRepo
        const changepointQueryBuilder = {
          select: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getRawMany: jest.fn().mockResolvedValue([{ test_run_id: 'test-001' }]),
        };
        changePointsRepo.createQueryBuilder.mockReturnValue(changepointQueryBuilder as any);

        // Act
        const result = await service.findDSMetricStatisticsMultiple(
          baseParams.applicationDashboardId,
          baseParams.panelId,
          baseParams.evaluateTypes,
          baseParams.from,
          baseParams.to,
          baseParams.system,
          baseParams.environment,
          baseParams.workload
        );

        // Assert
        expect(result[0]!.is_changepoint).toBe(true);
      });

      it('should handle annotations as array and convert to comma-separated string', async () => {
        // Arrange
        const mockTestRuns = [{
          id: 'uuid-1',
          testRunId: 'test-001',
          systemUnderTestId: 'system-1',
          testEnvironment: 'prod',
          workload: 'loadTest',
          startTime: new Date('2024-01-01T10:00:00Z'),
          applicationRelease: '1.0.0',
          annotations: ['annotation1', 'annotation2', 'annotation3'],
          consolidatedResult: null,
          systemUnderTest: { name: 'MyApp' },
        }];

        const mockStatistics = [{
          test_run_id: 'test-001',
          panel_id: 1,
          metric_name: 'response_time',
          mean: 250.5,
          max_value: null,
          min_value: null,
          last_value: null,
          count: null,
          median: null,
          percentiles: null,
          updated_at: new Date('2024-01-01T10:05:00Z'),
        }];

        const queryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue(mockTestRuns),
        };

        testRunRepo.createQueryBuilder.mockReturnValue(queryBuilder as any);
        metricStatisticsRepo.find.mockResolvedValue(mockStatistics as any);
        changePointsRepo.findOne.mockResolvedValue(null);

        // Act
        const result = await service.findDSMetricStatisticsMultiple(
          baseParams.applicationDashboardId,
          baseParams.panelId,
          ['avg'],
          baseParams.from,
          baseParams.to,
          baseParams.system,
          baseParams.environment,
          baseParams.workload
        );

        // Assert
        expect(result[0]!.annotations).toBe('annotation1, annotation2, annotation3');
      });
    });

    describe('Edge Cases', () => {
      it('should return empty array when no test runs found', async () => {
        // Arrange
        const queryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        };

        testRunRepo.createQueryBuilder.mockReturnValue(queryBuilder as any);

        // Act
        const result = await service.findDSMetricStatisticsMultiple(
          baseParams.applicationDashboardId,
          baseParams.panelId,
          baseParams.evaluateTypes,
          baseParams.from,
          baseParams.to,
          baseParams.system,
          baseParams.environment,
          baseParams.workload
        );

        // Assert
        expect(result).toEqual([]);
      });

      it('should handle null values in statistics gracefully', async () => {
        // Arrange
        const mockTestRuns = [{
          id: 'uuid-1',
          testRunId: 'test-001',
          systemUnderTestId: 'system-1',
          testEnvironment: 'prod',
          workload: 'loadTest',
          startTime: new Date('2024-01-01T10:00:00Z'),
          applicationRelease: null,
          annotations: null,
          consolidatedResult: null,
          systemUnderTest: { name: 'MyApp' },
        }];

        const mockStatistics = [{
          test_run_id: 'test-001',
          panel_id: 1,
          metric_name: 'response_time',
          mean: null,
          max_value: null,
          min_value: null,
          last_value: null,
          count: null,
          median: null,
          percentiles: null,
          updated_at: new Date('2024-01-01T10:05:00Z'),
        }];

        const queryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue(mockTestRuns),
        };

        testRunRepo.createQueryBuilder.mockReturnValue(queryBuilder as any);
        metricStatisticsRepo.find.mockResolvedValue(mockStatistics as any);
        changePointsRepo.findOne.mockResolvedValue(null);

        // Act
        const result = await service.findDSMetricStatisticsMultiple(
          baseParams.applicationDashboardId,
          baseParams.panelId,
          baseParams.evaluateTypes,
          baseParams.from,
          baseParams.to,
          baseParams.system,
          baseParams.environment,
          baseParams.workload
        );

        // Assert
        expect(result[0]!.statistics).toMatchObject({
          avg: null,
          max: null,
          min: null,
          count: null,
        });
      });

      it('should handle unknown evaluate types by returning null', async () => {
        // Arrange
        const mockTestRuns = [{
          id: 'uuid-1',
          testRunId: 'test-001',
          systemUnderTestId: 'system-1',
          testEnvironment: 'prod',
          workload: 'loadTest',
          startTime: new Date('2024-01-01T10:00:00Z'),
          applicationRelease: null,
          annotations: null,
          consolidatedResult: null,
          systemUnderTest: { name: 'MyApp' },
        }];

        const mockStatistics = [{
          test_run_id: 'test-001',
          panel_id: 1,
          metric_name: 'response_time',
          mean: 250.5,
          max_value: null,
          min_value: null,
          last_value: null,
          count: null,
          median: null,
          percentiles: null,
          updated_at: new Date('2024-01-01T10:05:00Z'),
        }];

        const queryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue(mockTestRuns),
        };

        testRunRepo.createQueryBuilder.mockReturnValue(queryBuilder as any);
        metricStatisticsRepo.find.mockResolvedValue(mockStatistics as any);
        changePointsRepo.findOne.mockResolvedValue(null);

        // Act
        const result = await service.findDSMetricStatisticsMultiple(
          baseParams.applicationDashboardId,
          baseParams.panelId,
          ['unknown_type'],
          baseParams.from,
          baseParams.to,
          baseParams.system,
          baseParams.environment,
          baseParams.workload
        );

        // Assert
        expect(result[0]!.statistics!.unknown_type).toBeNull();
      });
    });

    describe('Filtering Logic', () => {
      it('should apply system filter when provided', async () => {
        // Arrange
        const queryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        };

        testRunRepo.createQueryBuilder.mockReturnValue(queryBuilder as any);

        // Act
        await service.findDSMetricStatisticsMultiple(
          baseParams.applicationDashboardId,
          baseParams.panelId,
          baseParams.evaluateTypes,
          baseParams.from,
          baseParams.to,
          'CustomSystem',
          undefined,
          undefined
        );

        // Assert
        expect(queryBuilder.andWhere).toHaveBeenCalledWith('sut.name = :system', { system: 'CustomSystem' });
      });

      it('should apply environment filter when provided', async () => {
        // Arrange
        const queryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        };

        testRunRepo.createQueryBuilder.mockReturnValue(queryBuilder as any);

        // Act
        await service.findDSMetricStatisticsMultiple(
          baseParams.applicationDashboardId,
          baseParams.panelId,
          baseParams.evaluateTypes,
          baseParams.from,
          baseParams.to,
          undefined,
          'staging',
          undefined
        );

        // Assert
        expect(queryBuilder.andWhere).toHaveBeenCalledWith('testRun.testEnvironment = :environment', { environment: 'staging' });
      });

      it('should apply workload filter when provided', async () => {
        // Arrange
        const queryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        };

        testRunRepo.createQueryBuilder.mockReturnValue(queryBuilder as any);

        // Act
        await service.findDSMetricStatisticsMultiple(
          baseParams.applicationDashboardId,
          baseParams.panelId,
          baseParams.evaluateTypes,
          baseParams.from,
          baseParams.to,
          undefined,
          undefined,
          'stressTest'
        );

        // Assert
        expect(queryBuilder.andWhere).toHaveBeenCalledWith('testRun.workload = :workload', { workload: 'stressTest' });
      });

      it('should apply time range filters when provided', async () => {
        // Arrange
        const queryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        };

        testRunRepo.createQueryBuilder.mockReturnValue(queryBuilder as any);

        // Act
        await service.findDSMetricStatisticsMultiple(
          baseParams.applicationDashboardId,
          baseParams.panelId,
          baseParams.evaluateTypes,
          '2024-01-01T00:00:00Z',
          '2024-01-31T23:59:59Z',
          undefined,
          undefined,
          undefined
        );

        // Assert
        expect(queryBuilder.andWhere).toHaveBeenCalledWith('testRun.startTime >= :from', { from: '2024-01-01T00:00:00Z' });
        expect(queryBuilder.andWhere).toHaveBeenCalledWith('testRun.startTime <= :to', { to: '2024-01-31T23:59:59Z' });
      });
    });

    describe('Error Scenarios', () => {
      it('should throw error when test run query fails', async () => {
        // Arrange
        const error = new Error('Database connection error');
        const queryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockRejectedValue(error),
        };

        testRunRepo.createQueryBuilder.mockReturnValue(queryBuilder as any);

        // Act & Assert
        await expect(service.findDSMetricStatisticsMultiple(
          baseParams.applicationDashboardId,
          baseParams.panelId,
          baseParams.evaluateTypes,
          baseParams.from,
          baseParams.to,
          baseParams.system,
          baseParams.environment,
          baseParams.workload
        )).rejects.toThrow('Database connection error');
      });

      it('should throw error when statistics query fails', async () => {
        // Arrange
        const mockTestRuns = [{
          id: 'uuid-1',
          testRunId: 'test-001',
          systemUnderTestId: 'system-1',
          testEnvironment: 'prod',
          workload: 'loadTest',
          startTime: new Date('2024-01-01T10:00:00Z'),
          applicationRelease: null,
          annotations: null,
          consolidatedResult: null,
          systemUnderTest: { name: 'MyApp' },
        }];

        const queryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue(mockTestRuns),
        };

        const error = new Error('Query timeout');
        testRunRepo.createQueryBuilder.mockReturnValue(queryBuilder as any);
        metricStatisticsRepo.find.mockRejectedValue(error);

        // Act & Assert
        await expect(service.findDSMetricStatisticsMultiple(
          baseParams.applicationDashboardId,
          baseParams.panelId,
          baseParams.evaluateTypes,
          baseParams.from,
          baseParams.to,
          baseParams.system,
          baseParams.environment,
          baseParams.workload
        )).rejects.toThrow('Query timeout');
      });
    });
  });

  describe('findDSMetricStatistics', () => {
    const baseParams = {
      applicationDashboardId: 'dashboard-123',
      panelId: 1,
      evaluateType: 'avg',
      from: '2024-01-01T00:00:00Z',
      to: '2024-01-02T00:00:00Z',
      system: 'MyApp',
      environment: 'prod',
      workload: 'loadTest',
    };

    describe('Happy Path Scenarios', () => {
      it('should return metrics with value property for single evaluate type', async () => {
        // Arrange
        const mockTestRuns = [{
          id: 'uuid-1',
          testRunId: 'test-001',
          systemUnderTestId: 'system-1',
          testEnvironment: 'prod',
          workload: 'loadTest',
          startTime: new Date('2024-01-01T10:00:00Z'),
          applicationRelease: '1.0.0',
          annotations: ['test', 'run'],
          consolidatedResult: 'PASSED',
          systemUnderTest: { name: 'MyApp' },
        }];

        const mockStatistics = [{
          test_run_id: 'test-001',
          panel_id: 1,
          metric_name: 'response_time',
          mean: 250.5,
          updated_at: new Date('2024-01-01T10:05:00Z'),
        }];

        const queryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue(mockTestRuns),
        };

        testRunRepo.createQueryBuilder.mockReturnValue(queryBuilder as any);
        metricStatisticsRepo.find.mockResolvedValue(mockStatistics as any);
        changePointsRepo.findOne.mockResolvedValue(null);

        // Act
        const result = await service.findDSMetricStatistics(
          baseParams.applicationDashboardId,
          baseParams.panelId,
          baseParams.evaluateType,
          baseParams.from,
          baseParams.to,
          baseParams.system,
          baseParams.environment,
          baseParams.workload
        );

        // Assert
        expect(result).toHaveLength(1);
        expect(result[0]).toHaveProperty('value', 250.5);
        expect(result[0]).not.toHaveProperty('statistics');
        expect(result[0]).toMatchObject({
          test_run_id: 'test-001',
          panel_title: 'Panel 1',
          metric_name: 'response_time',
          value: 250.5,
          version: '1.0.0',
          annotations: 'test, run',
          is_changepoint: false,
          consolidated_result: 'PASSED',
        });
      });

      it('should handle different evaluate types correctly', async () => {
        // Arrange
        const evaluateTypes = [
          { type: 'avg', column: 'mean', value: 250.5 },
          { type: 'max', column: 'max_value', value: 400.0 },
          { type: 'min', column: 'min_value', value: 100.0 },
          { type: 'last', column: 'last_value', value: 275.0 },
          { type: 'count', column: 'count', value: 1000 },
          { type: 'q50', column: 'median', value: 240.0 },
        ];

        for (const evalType of evaluateTypes) {
          const mockTestRuns = [{
            id: 'uuid-1',
            testRunId: 'test-001',
            systemUnderTestId: 'system-1',
            testEnvironment: 'prod',
            workload: 'loadTest',
            startTime: new Date('2024-01-01T10:00:00Z'),
            applicationRelease: null,
            annotations: null,
            consolidatedResult: null,
            systemUnderTest: { name: 'MyApp' },
          }];

          const mockStatistics = [{
            test_run_id: 'test-001',
            panel_id: 1,
            metric_name: 'test_metric',
            [evalType.column]: evalType.value,
            updated_at: new Date('2024-01-01T10:05:00Z'),
          }];

          const queryBuilder = {
            leftJoinAndSelect: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            getMany: jest.fn().mockResolvedValue(mockTestRuns),
          };

          testRunRepo.createQueryBuilder.mockReturnValue(queryBuilder as any);
          metricStatisticsRepo.find.mockResolvedValue(mockStatistics as any);
          changePointsRepo.findOne.mockResolvedValue(null);

          // Act
          const result = await service.findDSMetricStatistics(
            baseParams.applicationDashboardId,
            baseParams.panelId,
            evalType.type,
            baseParams.from,
            baseParams.to,
            baseParams.system,
            baseParams.environment,
            baseParams.workload
          );

          // Assert
          expect(result[0]).toHaveProperty('value', evalType.value);
          expect(result[0]).not.toHaveProperty('statistics');

          jest.clearAllMocks();
        }
      });

      it('should handle percentile evaluate types', async () => {
        // Arrange
        const percentileTypes = [
          { type: 'q90', key: 'p90', value: 380.0 },
          { type: 'q95', key: 'p95', value: 390.0 },
          { type: 'q99', key: 'p99', value: 395.0 },
        ];

        for (const percentileType of percentileTypes) {
          const mockTestRuns = [{
            id: 'uuid-1',
            testRunId: 'test-001',
            systemUnderTestId: 'system-1',
            testEnvironment: 'prod',
            workload: 'loadTest',
            startTime: new Date('2024-01-01T10:00:00Z'),
            applicationRelease: null,
            annotations: null,
            consolidatedResult: null,
            systemUnderTest: { name: 'MyApp' },
          }];

          const mockStatistics = [{
            test_run_id: 'test-001',
            panel_id: 1,
            metric_name: 'test_metric',
            percentiles: {
              p90: 380.0,
              p95: 390.0,
              p99: 395.0,
            },
            updated_at: new Date('2024-01-01T10:05:00Z'),
          }];

          const queryBuilder = {
            leftJoinAndSelect: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            getMany: jest.fn().mockResolvedValue(mockTestRuns),
          };

          testRunRepo.createQueryBuilder.mockReturnValue(queryBuilder as any);
          metricStatisticsRepo.find.mockResolvedValue(mockStatistics as any);
          changePointsRepo.findOne.mockResolvedValue(null);

          // Act
          const result = await service.findDSMetricStatistics(
            baseParams.applicationDashboardId,
            baseParams.panelId,
            percentileType.type,
            baseParams.from,
            baseParams.to,
            baseParams.system,
            baseParams.environment,
            baseParams.workload
          );

          // Assert
          expect(result[0]).toHaveProperty('value', percentileType.value);
          expect(result[0]).not.toHaveProperty('statistics');

          jest.clearAllMocks();
        }
      });
    });

    describe('Edge Cases', () => {
      it('should return empty array when no test runs found', async () => {
        // Arrange
        const queryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        };

        testRunRepo.createQueryBuilder.mockReturnValue(queryBuilder as any);

        // Act
        const result = await service.findDSMetricStatistics(
          baseParams.applicationDashboardId,
          baseParams.panelId,
          baseParams.evaluateType,
          baseParams.from,
          baseParams.to,
          baseParams.system,
          baseParams.environment,
          baseParams.workload
        );

        // Assert
        expect(result).toEqual([]);
      });

      it('should handle null percentiles gracefully', async () => {
        // Arrange
        const mockTestRuns = [{
          id: 'uuid-1',
          testRunId: 'test-001',
          systemUnderTestId: 'system-1',
          testEnvironment: 'prod',
          workload: 'loadTest',
          startTime: new Date('2024-01-01T10:00:00Z'),
          applicationRelease: null,
          annotations: null,
          consolidatedResult: null,
          systemUnderTest: { name: 'MyApp' },
        }];

        const mockStatistics = [{
          test_run_id: 'test-001',
          panel_id: 1,
          metric_name: 'test_metric',
          percentiles: null,
          updated_at: new Date('2024-01-01T10:05:00Z'),
        }];

        const queryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue(mockTestRuns),
        };

        testRunRepo.createQueryBuilder.mockReturnValue(queryBuilder as any);
        metricStatisticsRepo.find.mockResolvedValue(mockStatistics as any);
        changePointsRepo.findOne.mockResolvedValue(null);

        // Act
        const result = await service.findDSMetricStatistics(
          baseParams.applicationDashboardId,
          baseParams.panelId,
          'q90',
          baseParams.from,
          baseParams.to,
          baseParams.system,
          baseParams.environment,
          baseParams.workload
        );

        // Assert
        expect(result[0]!.value).toBeNull();
      });
    });

    describe('Error Scenarios', () => {
      it('should throw error when query fails', async () => {
        // Arrange
        const error = new Error('Database error');
        const queryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockRejectedValue(error),
        };

        testRunRepo.createQueryBuilder.mockReturnValue(queryBuilder as any);

        // Act & Assert
        await expect(service.findDSMetricStatistics(
          baseParams.applicationDashboardId,
          baseParams.panelId,
          baseParams.evaluateType,
          baseParams.from,
          baseParams.to,
          baseParams.system,
          baseParams.environment,
          baseParams.workload
        )).rejects.toThrow('Database error');
      });
    });
  });

  describe('getStatisticColumn', () => {
    it('should map evaluate types to correct database columns', () => {
      // Arrange & Act & Assert
      expect((service as any).getStatisticColumn('avg')).toBe('mean');
      expect((service as any).getStatisticColumn('max')).toBe('max_value');
      expect((service as any).getStatisticColumn('min')).toBe('min_value');
      expect((service as any).getStatisticColumn('last')).toBe('last_value');
      expect((service as any).getStatisticColumn('count')).toBe('count');
      expect((service as any).getStatisticColumn('q50')).toBe('median');
      expect((service as any).getStatisticColumn('q90')).toBe('percentiles');
      expect((service as any).getStatisticColumn('q95')).toBe('percentiles');
      expect((service as any).getStatisticColumn('q99')).toBe('percentiles');
    });

    it('should return mean as default for unknown evaluate types', () => {
      // Arrange & Act & Assert
      expect((service as any).getStatisticColumn('unknown')).toBe('mean');
      expect((service as any).getStatisticColumn('')).toBe('mean');
      expect((service as any).getStatisticColumn(null)).toBe('mean');
    });
  });

  describe('findControlGroupTrends', () => {
    const testRunId = 'test-run-123';
    const applicationDashboardId = 'dashboard-456';
    const panelId = '1';
    const metricName = 'response_time';

    describe('Happy Path Scenarios', () => {
      it('should return control group trends with current test run', async () => {
        // Arrange
        const mockControlGroup = {
          control_group_id: testRunId,
          test_runs: ['test-run-001', 'test-run-002'],
        };

        const mockTestRuns = [
          {
            id: 'uuid-1',
            testRunId: 'test-run-001',
            startTime: new Date('2024-01-01T10:00:00Z'),
            applicationRelease: '1.0.0',
            annotations: ['baseline'],
          },
          {
            id: 'uuid-2',
            testRunId: 'test-run-002',
            startTime: new Date('2024-01-02T10:00:00Z'),
            applicationRelease: '1.0.1',
            annotations: ['candidate'],
          },
          {
            id: 'uuid-3',
            testRunId: 'test-run-123',
            startTime: new Date('2024-01-03T10:00:00Z'),
            applicationRelease: '1.1.0',
            annotations: null,
          },
        ];

        const mockAdaptResults = [
          {
            test_run_id: 'test-run-001',
            test_run_start: new Date('2024-01-01T10:00:00Z'),
            dashboard_label: 'Performance',
            panel_title: 'Response Time',
            metric_name: 'response_time',
            unit: 'ms',
            statistic: { test: 250.5 },
            thresholds: { lower: { overall: 200 }, upper: { overall: 300 } },
            conclusion: { label: 'no difference' },
          },
          {
            test_run_id: 'test-run-002',
            test_run_start: new Date('2024-01-02T10:00:00Z'),
            dashboard_label: 'Performance',
            panel_title: 'Response Time',
            metric_name: 'response_time',
            unit: 'ms',
            statistic: { test: 260.0 },
            thresholds: { lower: { overall: 200 }, upper: { overall: 300 } },
            conclusion: { label: 'no difference' },
          },
        ];

        const mockCurrentTestRunResult = {
          test_run_id: 'test-run-123',
          test_run_start: new Date('2024-01-03T10:00:00Z'),
          dashboard_label: 'Performance',
          panel_title: 'Response Time',
          metric_name: 'response_time',
          unit: 'ms',
          statistic: { test: 270.0 },
          thresholds: { lower: { overall: 200 }, upper: { overall: 300 } },
          conclusion: { label: 'faster' },
        };

        controlGroupsRepo.findOne.mockResolvedValue(mockControlGroup as any);
        testRunRepo.find.mockResolvedValue(mockTestRuns as any);
        adaptResultsRepo.find.mockResolvedValue(mockAdaptResults as any);
        adaptResultsRepo.findOne.mockResolvedValue(mockCurrentTestRunResult as any);

        // Act
        const result = await service.findControlGroupTrends(
          testRunId,
          applicationDashboardId,
          panelId,
          metricName
        );

        // Assert
        expect(result).toHaveLength(3);
        expect(result[0]).toMatchObject({
          test_run_id: 'test-run-001',
          metric_name: 'response_time',
          unit: 'ms',
          mean: 250.5,
          value: 250.5,
          conclusion_label: 'no difference',
          version: '1.0.0',
          annotations: 'baseline',
        });
        expect(result[2]).toMatchObject({
          test_run_id: 'test-run-123',
          conclusion_label: 'faster',
          version: '1.1.0',
          annotations: null,
        });
      });

      it('should handle fallback to ds_metric_statistics for missing adapt results', async () => {
        // Arrange
        const mockControlGroup = {
          control_group_id: testRunId,
          test_runs: ['test-run-001', 'test-run-002'],
        };

        const mockTestRuns = [
          {
            id: 'uuid-1',
            testRunId: 'test-run-001',
            startTime: new Date('2024-01-01T10:00:00Z'),
            applicationRelease: '1.0.0',
            annotations: null,
          },
          {
            id: 'uuid-2',
            testRunId: 'test-run-002',
            startTime: new Date('2024-01-02T10:00:00Z'),
            applicationRelease: '1.0.1',
            annotations: null,
          },
        ];

        const mockAdaptResults = [
          {
            test_run_id: 'test-run-001',
            test_run_start: new Date('2024-01-01T10:00:00Z'),
            dashboard_label: 'Performance',
            panel_title: 'Response Time',
            metric_name: 'response_time',
            unit: 'ms',
            statistic: { test: 250.5 },
            thresholds: { lower: { overall: 200 }, upper: { overall: 300 } },
            conclusion: { label: 'no difference' },
          },
        ];

        const mockFallbackData = [
          {
            test_run_id: 'test-run-002',
            test_run_start: new Date('2024-01-02T10:00:00Z'),
            dashboard_label: 'Performance',
            panel_title: 'Response Time',
            metric_name: 'response_time',
            unit: 'ms',
            mean: 260.0,
          },
        ];

        controlGroupsRepo.findOne.mockResolvedValue(mockControlGroup as any);
        testRunRepo.find.mockResolvedValue(mockTestRuns as any);
        adaptResultsRepo.find.mockResolvedValue(mockAdaptResults as any);
        adaptResultsRepo.findOne.mockResolvedValue(null);
        metricStatisticsRepo.find.mockResolvedValue(mockFallbackData as any);

        // Act
        const result = await service.findControlGroupTrends(
          testRunId,
          applicationDashboardId,
          panelId,
          metricName
        );

        // Assert
        expect(result).toHaveLength(2);
        expect(result[1]).toMatchObject({
          test_run_id: 'test-run-002',
          mean: 260.0,
          value: 260.0,
          conclusion_label: 'no difference', // Default for fallback data
        });
        expect(metricStatisticsRepo.find).toHaveBeenCalledWith({
          where: {
            application_dashboard_id: applicationDashboardId,
            panel_id: parseInt(panelId),
            metric_name: metricName,
            test_run_id: In(['test-run-002', testRunId]),
          },
          select: [
            'test_run_id',
            'test_run_start',
            'dashboard_label',
            'panel_title',
            'metric_name',
            'unit',
            'mean',
          ],
          order: { test_run_start: 'ASC' },
        });
      });

      it('should handle statistic.test as string and convert to number', async () => {
        // Arrange
        const mockControlGroup = {
          control_group_id: testRunId,
          test_runs: ['test-run-001'],
        };

        const mockTestRuns = [{
          id: 'uuid-1',
          testRunId: 'test-run-001',
          startTime: new Date('2024-01-01T10:00:00Z'),
          applicationRelease: null,
          annotations: null,
        }];

        const mockAdaptResults = [{
          test_run_id: 'test-run-001',
          test_run_start: new Date('2024-01-01T10:00:00Z'),
          dashboard_label: 'Performance',
          panel_title: 'Response Time',
          metric_name: 'response_time',
          unit: 'ms',
          statistic: { test: '250.5' }, // String value
          thresholds: { lower: { overall: 200 }, upper: { overall: 300 } },
          conclusion: { label: 'no difference' },
        }];

        controlGroupsRepo.findOne.mockResolvedValue(mockControlGroup as any);
        testRunRepo.find.mockResolvedValue(mockTestRuns as any);
        adaptResultsRepo.find.mockResolvedValue(mockAdaptResults as any);
        adaptResultsRepo.findOne.mockResolvedValue(null);

        // Act
        const result = await service.findControlGroupTrends(
          testRunId,
          applicationDashboardId,
          panelId,
          metricName
        );

        // Assert
        expect(result[0]!.value).toBe(250.5);
        expect(typeof result[0]!.value).toBe('number');
      });

      it('should use thresholds from next available test run for fallback data', async () => {
        // Arrange
        const mockControlGroup = {
          control_group_id: testRunId,
          test_runs: ['test-run-001', 'test-run-002', 'test-run-003'],
        };

        const mockTestRuns = [
          {
            id: 'uuid-1',
            testRunId: 'test-run-001',
            startTime: new Date('2024-01-01T10:00:00Z'),
            applicationRelease: null,
            annotations: null,
          },
          {
            id: 'uuid-2',
            testRunId: 'test-run-002',
            startTime: new Date('2024-01-02T10:00:00Z'),
            applicationRelease: null,
            annotations: null,
          },
          {
            id: 'uuid-3',
            testRunId: 'test-run-003',
            startTime: new Date('2024-01-03T10:00:00Z'),
            applicationRelease: null,
            annotations: null,
          },
        ];

        const mockAdaptResults = [
          {
            test_run_id: 'test-run-003',
            test_run_start: new Date('2024-01-03T10:00:00Z'),
            dashboard_label: 'Performance',
            panel_title: 'Response Time',
            metric_name: 'response_time',
            unit: 'ms',
            statistic: { test: 270.0 },
            thresholds: { lower: { overall: 250 }, upper: { overall: 350 } },
            conclusion: { label: 'no difference' },
          },
        ];

        const mockFallbackData = [
          {
            test_run_id: 'test-run-001',
            test_run_start: new Date('2024-01-01T10:00:00Z'),
            dashboard_label: 'Performance',
            panel_title: 'Response Time',
            metric_name: 'response_time',
            unit: 'ms',
            mean: 250.0,
          },
          {
            test_run_id: 'test-run-002',
            test_run_start: new Date('2024-01-02T10:00:00Z'),
            dashboard_label: 'Performance',
            panel_title: 'Response Time',
            metric_name: 'response_time',
            unit: 'ms',
            mean: 260.0,
          },
        ];

        controlGroupsRepo.findOne.mockResolvedValue(mockControlGroup as any);
        testRunRepo.find.mockResolvedValue(mockTestRuns as any);
        adaptResultsRepo.find.mockResolvedValue(mockAdaptResults as any);
        adaptResultsRepo.findOne.mockResolvedValue(null);
        metricStatisticsRepo.find.mockResolvedValue(mockFallbackData as any);

        // Act
        const result = await service.findControlGroupTrends(
          testRunId,
          applicationDashboardId,
          panelId,
          metricName
        );

        // Assert
        // Both fallback items should use thresholds from test-run-003 (next available)
        expect(result[0]!.thresholds).toEqual({ lower: { overall: 250 }, upper: { overall: 350 } });
        expect(result[1]!.thresholds).toEqual({ lower: { overall: 250 }, upper: { overall: 350 } });
      });
    });

    describe('Edge Cases', () => {
      it('should return empty array when no control group found', async () => {
        // Arrange
        controlGroupsRepo.findOne.mockResolvedValue(null);

        // Act
        const result = await service.findControlGroupTrends(
          testRunId,
          applicationDashboardId,
          panelId,
          metricName
        );

        // Assert
        expect(result).toEqual([]);
      });

      it('should return empty array when control group has no test runs', async () => {
        // Arrange
        const mockControlGroup = {
          control_group_id: testRunId,
          test_runs: [],
        };

        controlGroupsRepo.findOne.mockResolvedValue(mockControlGroup as any);

        // Act
        const result = await service.findControlGroupTrends(
          testRunId,
          applicationDashboardId,
          panelId,
          metricName
        );

        // Assert
        expect(result).toEqual([]);
      });

      it('should return empty array when no adapt results found', async () => {
        // Arrange
        const mockControlGroup = {
          control_group_id: testRunId,
          test_runs: ['test-run-001'],
        };

        const mockTestRuns = [{
          id: 'uuid-1',
          testRunId: 'test-run-001',
          startTime: new Date('2024-01-01T10:00:00Z'),
          applicationRelease: null,
          annotations: null,
        }];

        controlGroupsRepo.findOne.mockResolvedValue(mockControlGroup as any);
        testRunRepo.find.mockResolvedValue(mockTestRuns as any);
        adaptResultsRepo.find.mockResolvedValue([]);
        adaptResultsRepo.findOne.mockResolvedValue(null);
        metricStatisticsRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.findControlGroupTrends(
          testRunId,
          applicationDashboardId,
          panelId,
          metricName
        );

        // Assert
        expect(result).toEqual([]);
      });

      it('should filter out results with missing required fields', async () => {
        // Arrange
        const mockControlGroup = {
          control_group_id: testRunId,
          test_runs: ['test-run-001', 'test-run-002'],
        };

        const mockTestRuns = [
          {
            id: 'uuid-1',
            testRunId: 'test-run-001',
            startTime: new Date('2024-01-01T10:00:00Z'),
            applicationRelease: null,
            annotations: null,
          },
          {
            id: 'uuid-2',
            testRunId: 'test-run-002',
            startTime: new Date('2024-01-02T10:00:00Z'),
            applicationRelease: null,
            annotations: null,
          },
        ];

        const mockAdaptResults = [
          {
            test_run_id: null, // Missing test_run_id
            test_run_start: new Date('2024-01-01T10:00:00Z'),
            dashboard_label: 'Performance',
            panel_title: 'Response Time',
            metric_name: 'response_time',
            unit: 'ms',
            statistic: { test: 250.5 },
            thresholds: { lower: { overall: 200 }, upper: { overall: 300 } },
            conclusion: { label: 'no difference' },
          },
          {
            test_run_id: 'test-run-002',
            test_run_start: new Date('2024-01-02T10:00:00Z'),
            dashboard_label: 'Performance',
            panel_title: 'Response Time',
            metric_name: 'response_time',
            unit: 'ms',
            statistic: { test: 260.0 },
            thresholds: { lower: { overall: 200 }, upper: { overall: 300 } },
            conclusion: { label: 'no difference' },
          },
        ];

        controlGroupsRepo.findOne.mockResolvedValue(mockControlGroup as any);
        testRunRepo.find.mockResolvedValue(mockTestRuns as any);
        adaptResultsRepo.find.mockResolvedValue(mockAdaptResults as any);
        adaptResultsRepo.findOne.mockResolvedValue(null);

        // Act
        const result = await service.findControlGroupTrends(
          testRunId,
          applicationDashboardId,
          panelId,
          metricName
        );

        // Assert
        expect(result).toHaveLength(1);
        expect(result[0]!.test_run_id).toBe('test-run-002');
      });

      it('should handle null or empty string units', async () => {
        // Arrange
        const mockControlGroup = {
          control_group_id: testRunId,
          test_runs: ['test-run-001'],
        };

        const mockTestRuns = [{
          id: 'uuid-1',
          testRunId: 'test-run-001',
          startTime: new Date('2024-01-01T10:00:00Z'),
          applicationRelease: null,
          annotations: null,
        }];

        const mockAdaptResults = [{
          test_run_id: 'test-run-001',
          test_run_start: new Date('2024-01-01T10:00:00Z'),
          dashboard_label: 'Performance',
          panel_title: 'Response Time',
          metric_name: 'response_time',
          unit: '', // Empty string unit
          statistic: { test: 250.5 },
          thresholds: { lower: { overall: 200 }, upper: { overall: 300 } },
          conclusion: { label: 'no difference' },
        }];

        controlGroupsRepo.findOne.mockResolvedValue(mockControlGroup as any);
        testRunRepo.find.mockResolvedValue(mockTestRuns as any);
        adaptResultsRepo.find.mockResolvedValue(mockAdaptResults as any);
        adaptResultsRepo.findOne.mockResolvedValue(null);

        // Act
        const result = await service.findControlGroupTrends(
          testRunId,
          applicationDashboardId,
          panelId,
          metricName
        );

        // Assert
        expect(result).toHaveLength(1);
        expect(result[0]!.unit).toBe('');
      });

      it('should handle missing statistic.test value', async () => {
        // Arrange
        const mockControlGroup = {
          control_group_id: testRunId,
          test_runs: ['test-run-001'],
        };

        const mockTestRuns = [{
          id: 'uuid-1',
          testRunId: 'test-run-001',
          startTime: new Date('2024-01-01T10:00:00Z'),
          applicationRelease: null,
          annotations: null,
        }];

        const mockAdaptResults = [{
          test_run_id: 'test-run-001',
          test_run_start: new Date('2024-01-01T10:00:00Z'),
          dashboard_label: 'Performance',
          panel_title: 'Response Time',
          metric_name: 'response_time',
          unit: 'ms',
          statistic: null, // Missing statistic
          thresholds: { lower: { overall: 200 }, upper: { overall: 300 } },
          conclusion: { label: 'no difference' },
        }];

        controlGroupsRepo.findOne.mockResolvedValue(mockControlGroup as any);
        testRunRepo.find.mockResolvedValue(mockTestRuns as any);
        adaptResultsRepo.find.mockResolvedValue(mockAdaptResults as any);
        adaptResultsRepo.findOne.mockResolvedValue(null);

        // Act
        const result = await service.findControlGroupTrends(
          testRunId,
          applicationDashboardId,
          panelId,
          metricName
        );

        // Assert
        expect(result[0]!.value).toBe(0);
        expect(result[0]!.mean).toBe(0);
      });
    });

    describe('Error Scenarios', () => {
      it('should return empty array and log error when control group query fails', async () => {
        // Arrange
        const error = new Error('Database error');
        controlGroupsRepo.findOne.mockRejectedValue(error);

        // Act
        const result = await service.findControlGroupTrends(
          testRunId,
          applicationDashboardId,
          panelId,
          metricName
        );

        // Assert
        expect(result).toEqual([]);
      });

      it('should return empty array when test run query fails', async () => {
        // Arrange
        const mockControlGroup = {
          control_group_id: testRunId,
          test_runs: ['test-run-001'],
        };

        controlGroupsRepo.findOne.mockResolvedValue(mockControlGroup as any);
        testRunRepo.find.mockRejectedValue(new Error('Query error'));

        // Act
        const result = await service.findControlGroupTrends(
          testRunId,
          applicationDashboardId,
          panelId,
          metricName
        );

        // Assert
        expect(result).toEqual([]);
      });
    });
  });

  describe('batchCheckChangepoints (private method)', () => {
    it('should return true for test runs with changepoints', async () => {
      // Arrange
      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([{ test_run_id: 'test-run-123' }]),
      };
      changePointsRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      const result = await (service as any).batchCheckChangepoints(['test-run-123', 'test-run-456']);

      // Assert
      expect(result.get('test-run-123')).toBe(true);
      expect(result.get('test-run-456')).toBe(false);
    });

    it('should return empty map for empty input', async () => {
      // Act
      const result = await (service as any).batchCheckChangepoints([]);

      // Assert
      expect(result.size).toBe(0);
    });

    it('should return false for all and log error when query fails', async () => {
      // Arrange
      const error = new Error('Database error');
      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockRejectedValue(error),
      };
      changePointsRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      const result = await (service as any).batchCheckChangepoints(['test-run-123']);

      // Assert
      expect(result.get('test-run-123')).toBe(false);
    });
  });
});
