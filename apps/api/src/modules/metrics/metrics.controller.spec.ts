import { Test, TestingModule } from '@nestjs/testing';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Benchmark } from '../../entities';

// TODO: This test needs to be rewritten for the new service architecture
// MetricsController now uses TypeORM repositories instead of DatabaseService
describe.skip('MetricsController', () => {
  let controller: MetricsController;

  const mockMetricsService = {
    findAll: jest.fn(),
    findDSMetricStatistics: jest.fn(),
    findDSMetricStatisticsMultiple: jest.fn(),
    findDSMetricsForPanel: jest.fn(),
  };

  const mockBenchmarkRepository = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        {
          provide: MetricsService,
          useValue: mockMetricsService,
        },
        {
          provide: getRepositoryToken(Benchmark),
          useValue: mockBenchmarkRepository,
        },
      ],
    }).compile();

    controller = module.get<MetricsController>(MetricsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getDSMetricStatistics', () => {
    const baseParams = {
      applicationDashboardId: 'dashboard-123',
      panelId: '1',
      from: '2024-01-01T00:00:00Z',
      to: '2024-01-02T00:00:00Z',
      system: 'MyApp',
      environment: 'prod',
      workload: 'loadTest',
    };

    describe('Single evaluateType parameter (TrendsCard compatibility)', () => {
      it('should call findDSMetricStatistics for single evaluateType', async () => {
        const singleEvaluateTypeResult = [
          {
            test_run_id: 'test-001',
            panel_title: 'Panel 1',
            metric_name: 'response_time',
            value: 250,
            created_at: '2024-01-01T10:00:00Z',
            version: '1.0.0',
            annotations: 'test run',
          },
        ];

        mockMetricsService.findDSMetricStatistics.mockResolvedValue(singleEvaluateTypeResult);

        const result = await controller.getDSMetricStatistics(
          baseParams.applicationDashboardId,
          baseParams.panelId,
          'avg',
          undefined,
          baseParams.from,
          baseParams.to,
          baseParams.system,
          baseParams.environment,
          baseParams.workload
        );

        expect(mockMetricsService.findDSMetricStatistics).toHaveBeenCalledWith(
          baseParams.applicationDashboardId,
          1,
          'avg',
          baseParams.from,
          baseParams.to,
          baseParams.system,
          baseParams.environment,
          baseParams.workload
        );
        expect(mockMetricsService.findDSMetricStatisticsMultiple).not.toHaveBeenCalled();
        expect(result).toEqual(singleEvaluateTypeResult);
      });

      it('should handle different single evaluate types', async () => {
        const evaluateTypes = ['avg', 'max', 'min', 'q50', 'q90', 'q95', 'q99'];

        for (const evaluateType of evaluateTypes) {
          mockMetricsService.findDSMetricStatistics.mockResolvedValue([{
            test_run_id: 'test-001',
            panel_title: 'Panel 1',
            metric_name: 'metric',
            value: 100,
            created_at: '2024-01-01T10:00:00Z',
            version: null,
            annotations: null,
          }]);

          await controller.getDSMetricStatistics(
            baseParams.applicationDashboardId,
            baseParams.panelId,
            evaluateType,
            undefined,
            baseParams.from,
            baseParams.to,
            baseParams.system,
            baseParams.environment,
            baseParams.workload
          );

          expect(mockMetricsService.findDSMetricStatistics).toHaveBeenCalledWith(
            baseParams.applicationDashboardId,
            1,
            evaluateType,
            baseParams.from,
            baseParams.to,
            baseParams.system,
            baseParams.environment,
            baseParams.workload
          );
        }
      });
    });

    describe('Multiple evaluateTypes parameter (CompareCard compatibility)', () => {
      it('should call findDSMetricStatisticsMultiple for comma-separated evaluateTypes', async () => {
        const multipleEvaluateTypesResult = [
          {
            test_run_id: 'test-001',
            panel_title: 'Panel 1',
            metric_name: 'response_time',
            created_at: '2024-01-01T10:00:00Z',
            version: '1.0.0',
            annotations: 'test run',
            statistics: {
              avg: 250,
              max: 400,
              min: 100,
              count: 1000,
            },
          },
        ];

        mockMetricsService.findDSMetricStatisticsMultiple.mockResolvedValue(multipleEvaluateTypesResult);

        const result = await controller.getDSMetricStatistics(
          baseParams.applicationDashboardId,
          baseParams.panelId,
          undefined,
          'avg,max,min,count',
          baseParams.from,
          baseParams.to,
          baseParams.system,
          baseParams.environment,
          baseParams.workload
        );

        expect(mockMetricsService.findDSMetricStatisticsMultiple).toHaveBeenCalledWith(
          baseParams.applicationDashboardId,
          1,
          ['avg', 'max', 'min', 'count'],
          baseParams.from,
          baseParams.to,
          baseParams.system,
          baseParams.environment,
          baseParams.workload
        );
        expect(mockMetricsService.findDSMetricStatistics).not.toHaveBeenCalled();
        expect(result).toEqual(multipleEvaluateTypesResult);
      });

      it('should handle whitespace in comma-separated evaluateTypes', async () => {
        mockMetricsService.findDSMetricStatisticsMultiple.mockResolvedValue([]);

        await controller.getDSMetricStatistics(
          baseParams.applicationDashboardId,
          baseParams.panelId,
          undefined,
          ' avg , max , min ',
          baseParams.from,
          baseParams.to,
          baseParams.system,
          baseParams.environment,
          baseParams.workload
        );

        expect(mockMetricsService.findDSMetricStatisticsMultiple).toHaveBeenCalledWith(
          baseParams.applicationDashboardId,
          1,
          ['avg', 'max', 'min'],
          baseParams.from,
          baseParams.to,
          baseParams.system,
          baseParams.environment,
          baseParams.workload
        );
      });
    });

    describe('No evaluate types specified (default behavior)', () => {
      it('should call findDSMetricStatisticsMultiple with all evaluate types when none specified', async () => {
        const defaultResult = [
          {
            test_run_id: 'test-001',
            panel_title: 'Panel 1',
            metric_name: 'response_time',
            created_at: '2024-01-01T10:00:00Z',
            version: '1.0.0',
            annotations: 'test run',
            statistics: {
              avg: 250,
              max: 400,
              min: 100,
              last: 275,
              count: 1000,
              q50: 240,
              q90: 380,
              q95: 390,
              q99: 395,
            },
          },
        ];

        mockMetricsService.findDSMetricStatisticsMultiple.mockResolvedValue(defaultResult);

        const result = await controller.getDSMetricStatistics(
          baseParams.applicationDashboardId,
          baseParams.panelId,
          undefined,
          undefined,
          baseParams.from,
          baseParams.to,
          baseParams.system,
          baseParams.environment,
          baseParams.workload
        );

        expect(mockMetricsService.findDSMetricStatisticsMultiple).toHaveBeenCalledWith(
          baseParams.applicationDashboardId,
          1,
          ['avg', 'max', 'min', 'last', 'count', 'q50', 'q90', 'q95', 'q99'],
          baseParams.from,
          baseParams.to,
          baseParams.system,
          baseParams.environment,
          baseParams.workload
        );
        expect(mockMetricsService.findDSMetricStatistics).not.toHaveBeenCalled();
        expect(result).toEqual(defaultResult);
      });
    });

    describe('Parameter validation', () => {
      it('should throw error for missing applicationDashboardId', async () => {
        await expect(
          controller.getDSMetricStatistics(
            '',
            baseParams.panelId,
            'avg',
            undefined,
            baseParams.from,
            baseParams.to,
            baseParams.system,
            baseParams.environment,
            baseParams.workload
          )
        ).rejects.toThrow('applicationDashboardId and panelId are required');
      });

      it('should throw error for missing panelId', async () => {
        await expect(
          controller.getDSMetricStatistics(
            baseParams.applicationDashboardId,
            '',
            'avg',
            undefined,
            baseParams.from,
            baseParams.to,
            baseParams.system,
            baseParams.environment,
            baseParams.workload
          )
        ).rejects.toThrow('applicationDashboardId and panelId are required');
      });

      it('should throw error for invalid panelId', async () => {
        await expect(
          controller.getDSMetricStatistics(
            baseParams.applicationDashboardId,
            'invalid',
            'avg',
            undefined,
            baseParams.from,
            baseParams.to,
            baseParams.system,
            baseParams.environment,
            baseParams.workload
          )
        ).rejects.toThrow('Invalid panel ID');
      });
    });

    describe('Backward compatibility regression test', () => {
      it('should prevent regression where single evaluateType uses wrong method', async () => {
        const trendsCardCall = async () => {
          await controller.getDSMetricStatistics(
            baseParams.applicationDashboardId,
            baseParams.panelId,
            'avg',
            undefined,
            baseParams.from,
            baseParams.to,
            baseParams.system,
            baseParams.environment,
            baseParams.workload
          );
        };

        const compareCardCall = async () => {
          await controller.getDSMetricStatistics(
            baseParams.applicationDashboardId,
            baseParams.panelId,
            undefined,
            undefined,
            baseParams.from,
            baseParams.to,
            baseParams.system,
            baseParams.environment,
            baseParams.workload
          );
        };

        mockMetricsService.findDSMetricStatistics.mockResolvedValue([]);
        mockMetricsService.findDSMetricStatisticsMultiple.mockResolvedValue([]);

        await trendsCardCall();
        await compareCardCall();

        expect(mockMetricsService.findDSMetricStatistics).toHaveBeenCalledTimes(1);
        expect(mockMetricsService.findDSMetricStatisticsMultiple).toHaveBeenCalledTimes(1);
      });
    });
  });
});
