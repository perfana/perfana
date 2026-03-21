import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { BenchmarksController } from './benchmarks.controller';
import { BenchmarksService } from './benchmarks.service';
import { Benchmark } from '../../entities';
import { UserContext } from '../../common/decorators/user-context.decorator';

describe('BenchmarksController', () => {
  let controller: BenchmarksController;
  let service: jest.Mocked<BenchmarksService>;

  const mockUserContext: UserContext = {
    userId: 'test-user-123',
    roles: ['user'],
    organizations: ['org-123'],
    teams: ['team-456'],
    organizationId: 'org-123',
    teamId: 'team-456',
  };

  const mockDate = new Date('2024-01-15T10:00:00.000Z');

  // Mock data fixtures
  const mockBenchmark = {
    id: 'benchmark-uuid-1',
    system_under_test_id: 'system-uuid',
    test_environment: 'production',
    workload: 'load-test',
    source: 'grafana',
    grafana_instance: 'grafana-prod',
    dashboard_label: 'Response Time Dashboard',
    dashboard_id: 1,
    dashboard_uid: 'dashboard-uid-1',
    application_dashboard_id: 'app-dashboard-uuid',
    config_title: 'Response Time P95',
    panel_title: 'Response Time',
    evaluate_type: 'mean',
    requirement_operator: '<',
    requirement_value: 100,
    enabled: true,
    valid: true,
    description: 'Response time should be under 100ms',
    tags: ['performance', 'response-time'],
    configuration: {
      title: 'Response Time P95',
      type: 'grafana',
      evaluateType: 'mean',
      requirement: {
        operator: '<',
        value: 100,
      },
    },
    created_at: mockDate,
    updated_at: mockDate,
    average_all: false,
    validate_with_default_if_no_data: false,
    exclude_ramp_up_time: true,
    alert_on_breach: false,
    alert_channels: [],
    metadata: {},
  } as any as Benchmark;

  const mockBenchmark2 = {
    id: 'benchmark-uuid-2',
    system_under_test_id: 'system-uuid',
    test_environment: 'staging',
    workload: 'stress-test',
    source: 'grafana',
    grafana_instance: 'grafana-staging',
    dashboard_label: 'Throughput Dashboard',
    dashboard_id: 2,
    dashboard_uid: 'dashboard-uid-2',
    application_dashboard_id: 'app-dashboard-uuid-2',
    config_title: 'Throughput',
    panel_title: 'Requests per Second',
    evaluate_type: 'max',
    requirement_operator: '>',
    requirement_value: 1000,
    enabled: false,
    valid: false,
    description: 'Throughput should exceed 1000 rps',
    tags: ['performance', 'throughput'],
    configuration: {
      title: 'Throughput',
      type: 'grafana',
      evaluateType: 'max',
      requirement: {
        operator: '>',
        value: 1000,
      },
    },
    created_at: mockDate,
    updated_at: mockDate,
    average_all: false,
    validate_with_default_if_no_data: false,
    exclude_ramp_up_time: true,
    alert_on_breach: false,
    alert_channels: [],
    metadata: {},
  } as any as Benchmark;

  const mockSystemConfigOptions = {
    environments: ['production', 'staging', 'development'],
    workloads: ['load-test', 'stress-test', 'soak-test'],
  };

  const mockTagSyncStatus = [
    {
      benchmark_id: 'benchmark-uuid-1',
      system_name: 'Test System',
      dashboard_label: 'Response Time Dashboard',
      config_title: 'Response Time P95',
      benchmark_tags: ['performance', 'response-time'],
      dashboard_tags: ['performance', 'response-time', 'monitoring'],
      tags_match: false,
    },
    {
      benchmark_id: 'benchmark-uuid-2',
      system_name: 'Test System',
      dashboard_label: 'Throughput Dashboard',
      config_title: 'Throughput',
      benchmark_tags: ['performance', 'throughput'],
      dashboard_tags: ['performance', 'throughput'],
      tags_match: true,
    },
  ];

  const mockServiceFactory = () => ({
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    syncTagsWithApplicationDashboards: jest.fn(),
    getBenchmarkTagSyncStatus: jest.fn(),
    getSystemEnvironmentsAndWorkloads: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BenchmarksController],
      providers: [
        {
          provide: BenchmarksService,
          useValue: mockServiceFactory(),
        },
      ],
    }).compile();

    controller = module.get<BenchmarksController>(BenchmarksController);
    service = module.get(BenchmarksService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Happy Path - GET Endpoints', () => {
    describe('findAll', () => {
      it('should return all benchmarks without filters', async () => {
        // Arrange
        const benchmarks = [mockBenchmark, mockBenchmark2];
        service.findAll.mockResolvedValue(benchmarks as any);

        // Act
        const result = await controller.findAll(mockUserContext, {});

        // Assert
        expect(result).toEqual(benchmarks);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, {});
        expect(service.findAll).toHaveBeenCalledTimes(1);
      });

      it('should return benchmarks filtered by systemUnderTestId', async () => {
        // Arrange
        const query = { systemUnderTestId: 'system-uuid' };
        const benchmarks = [mockBenchmark, mockBenchmark2];
        service.findAll.mockResolvedValue(benchmarks as any as any);

        // Act
        const result = await controller.findAll(mockUserContext, query);

        // Assert
        expect(result).toEqual(benchmarks);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
        expect(result).toHaveLength(2);
        expect(result[0]?.system_under_test_id).toBe('system-uuid');
      });

      it('should return benchmarks filtered by testEnvironment', async () => {
        // Arrange
        const query = { testEnvironment: 'production' };
        const benchmarks = [mockBenchmark];
        service.findAll.mockResolvedValue(benchmarks as any);

        // Act
        const result = await controller.findAll(mockUserContext, query);

        // Assert
        expect(result).toEqual(benchmarks);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
        expect(result).toHaveLength(1);
        expect(result[0]?.test_environment).toBe('production');
      });

      it('should return benchmarks filtered by workload', async () => {
        // Arrange
        const query = { workload: 'load-test' };
        const benchmarks = [mockBenchmark];
        service.findAll.mockResolvedValue(benchmarks as any);

        // Act
        const result = await controller.findAll(mockUserContext, query);

        // Assert
        expect(result).toEqual(benchmarks);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
        expect(result).toHaveLength(1);
        expect(result[0]?.workload).toBe('load-test');
      });

      it('should return benchmarks filtered by enabled status', async () => {
        // Arrange
        const query = { enabled: 'true' };
        const benchmarks = [mockBenchmark];
        service.findAll.mockResolvedValue(benchmarks as any);

        // Act
        const result = await controller.findAll(mockUserContext, query);

        // Assert
        expect(result).toEqual(benchmarks);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
        expect(result[0]?.enabled).toBe(true);
      });

      it('should return benchmarks filtered by valid status', async () => {
        // Arrange
        const query = { valid: 'false' };
        const benchmarks = [mockBenchmark2];
        service.findAll.mockResolvedValue(benchmarks as any);

        // Act
        const result = await controller.findAll(mockUserContext, query);

        // Assert
        expect(result).toEqual(benchmarks);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
        expect(result[0]?.valid).toBe(false);
      });

      it('should return benchmarks with multiple filters combined', async () => {
        // Arrange
        const query = {
          systemUnderTestId: 'system-uuid',
          testEnvironment: 'production',
          workload: 'load-test',
          enabled: 'true',
          valid: 'true',
        };
        const benchmarks = [mockBenchmark];
        service.findAll.mockResolvedValue(benchmarks as any);

        // Act
        const result = await controller.findAll(mockUserContext, query);

        // Assert
        expect(result).toEqual(benchmarks);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
        expect(result).toHaveLength(1);
      });

      it('should return empty array when no benchmarks match filters', async () => {
        // Arrange
        const query = { testEnvironment: 'non-existent' };
        service.findAll.mockResolvedValue([] as any);

        // Act
        const result = await controller.findAll(mockUserContext, query);

        // Assert
        expect(result).toEqual([]);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
      });
    });

    describe('findOne', () => {
      it('should return a single benchmark by ID', async () => {
        // Arrange
        service.findOne.mockResolvedValue(mockBenchmark as any);

        // Act
        const result = await controller.findOne(mockUserContext, 'benchmark-uuid-1');

        // Assert
        expect(result).toEqual(mockBenchmark);
        expect(service.findOne).toHaveBeenCalledWith('benchmark-uuid-1', mockUserContext.userId, mockUserContext.roles);
        expect(service.findOne).toHaveBeenCalledTimes(1);
      });

      it('should throw 404 when benchmark not found', async () => {
        // Arrange
        service.findOne.mockResolvedValue(null as any);

        // Act & Assert
        await expect(controller.findOne(mockUserContext, 'non-existent-id')).rejects.toThrow(
          new HttpException('SLO not found', HttpStatus.NOT_FOUND),
        );
        expect(service.findOne).toHaveBeenCalledWith('non-existent-id', mockUserContext.userId, mockUserContext.roles);
      });

      it('should rethrow HttpException from service', async () => {
        // Arrange
        const httpException = new HttpException('SLO not found', HttpStatus.NOT_FOUND);
        service.findOne.mockRejectedValue(httpException);

        // Act & Assert
        await expect(controller.findOne(mockUserContext, 'benchmark-uuid-1')).rejects.toThrow(httpException);
      });
    });

    describe('getSystemConfigOptions', () => {
      it('should return available environments and workloads for a system', async () => {
        // Arrange
        service.getSystemEnvironmentsAndWorkloads.mockResolvedValue(mockSystemConfigOptions as any);

        // Act
        const result = await controller.getSystemConfigOptions(mockUserContext, 'system-uuid');

        // Assert
        expect(result).toEqual(mockSystemConfigOptions);
        expect(service.getSystemEnvironmentsAndWorkloads).toHaveBeenCalledWith('system-uuid', mockUserContext.userId, mockUserContext.roles);
        expect(service.getSystemEnvironmentsAndWorkloads).toHaveBeenCalledTimes(1);
        expect(result.environments).toHaveLength(3);
        expect(result.workloads).toHaveLength(3);
      });

      it('should return empty arrays when system has no benchmarks', async () => {
        // Arrange
        const emptyOptions = { environments: [], workloads: [] };
        service.getSystemEnvironmentsAndWorkloads.mockResolvedValue(emptyOptions as any);

        // Act
        const result = await controller.getSystemConfigOptions(mockUserContext, 'new-system-uuid');

        // Assert
        expect(result).toEqual(emptyOptions);
        expect(result.environments).toHaveLength(0);
        expect(result.workloads).toHaveLength(0);
      });
    });

    describe('getTagSyncStatus', () => {
      it('should return tag synchronization status for all benchmarks', async () => {
        // Arrange
        service.getBenchmarkTagSyncStatus.mockResolvedValue(mockTagSyncStatus as any);

        // Act
        const result = await controller.getTagSyncStatus(mockUserContext);

        // Assert
        expect(result).toEqual(mockTagSyncStatus);
        expect(service.getBenchmarkTagSyncStatus).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles);
        expect(service.getBenchmarkTagSyncStatus).toHaveBeenCalledTimes(1);
        expect(result).toHaveLength(2);
        expect(result[0]?.tags_match).toBe(false);
        expect(result[1]?.tags_match).toBe(true);
      });

      it('should return empty array when no benchmarks exist', async () => {
        // Arrange
        service.getBenchmarkTagSyncStatus.mockResolvedValue([] as any);

        // Act
        const result = await controller.getTagSyncStatus(mockUserContext);

        // Assert
        expect(result).toEqual([]);
        expect(service.getBenchmarkTagSyncStatus).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles);
        expect(service.getBenchmarkTagSyncStatus).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Happy Path - POST Endpoints', () => {
    describe('create', () => {
      it('should create a new benchmark with all required fields', async () => {
        // Arrange
        const createDto = {
          systemUnderTestId: 'system-uuid',
          testEnvironment: 'production',
          workload: 'load-test',
          source: 'grafana',
          grafanaInstance: 'grafana-prod',
          dashboardLabel: 'Response Time Dashboard',
          dashboardId: 1,
          dashboardUid: 'dashboard-uid-1',
          applicationDashboardId: 'app-dashboard-uuid',
          configTitle: 'Response Time P95',
          panelTitle: 'Response Time',
          evaluateType: 'mean',
          requirementOperator: '<',
          requirementValue: 100,
          description: 'Response time should be under 100ms',
          tags: ['performance', 'response-time'],
          configuration: {
            title: 'Response Time P95',
            type: 'grafana',
            evaluateType: 'mean',
            requirement: {
              operator: '<',
              value: 100,
            },
          },
        };
        service.create.mockResolvedValue(mockBenchmark as any);

        // Act
        const result = await controller.create(mockUserContext, createDto);

        // Assert
        expect(result).toEqual(mockBenchmark);
        expect(service.create).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, createDto);
        expect(service.create).toHaveBeenCalledTimes(1);
      });

      it('should create a benchmark with minimal required fields', async () => {
        // Arrange
        const minimalDto = {
          systemUnderTestId: 'system-uuid',
          testEnvironment: 'production',
          workload: 'load-test',
          source: 'grafana',
          configTitle: 'Simple Benchmark',
          panelTitle: 'Panel',
          evaluateType: 'mean',
          requirementOperator: '<',
          requirementValue: 100,
        };
        const minimalBenchmark = { ...mockBenchmark, description: undefined, tags: [] };
        service.create.mockResolvedValue(minimalBenchmark as any);

        // Act
        const result = await controller.create(mockUserContext, minimalDto);

        // Assert
        expect(result).toEqual(minimalBenchmark);
        expect(service.create).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, minimalDto);
      });

      it('should create a benchmark with optional fields', async () => {
        // Arrange
        const dtoWithOptionalFields = {
          systemUnderTestId: 'system-uuid',
          testEnvironment: 'production',
          workload: 'load-test',
          source: 'grafana',
          grafanaInstance: 'grafana-prod',
          dashboardLabel: 'Test Dashboard',
          dashboardId: 1,
          dashboardUid: 'dashboard-uid',
          applicationDashboardId: 'app-dashboard-uuid',
          configTitle: 'Test Benchmark',
          panelTitle: 'Test Panel',
          evaluateType: 'mean',
          requirementOperator: '<',
          requirementValue: 100,
          description: 'Test description',
          tags: ['tag1', 'tag2'],
          configuration: { custom: 'config' },
        };
        service.create.mockResolvedValue(mockBenchmark as any);

        // Act
        const result = await controller.create(mockUserContext, dtoWithOptionalFields);

        // Assert
        expect(result).toEqual(mockBenchmark);
        expect(service.create).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, dtoWithOptionalFields);
      });
    });

    describe('syncTags', () => {
      it('should synchronize benchmark tags with application dashboards successfully', async () => {
        // Arrange
        service.syncTagsWithApplicationDashboards.mockResolvedValue(undefined);

        // Act
        const result = await controller.syncTags(mockUserContext);

        // Assert
        expect(result).toEqual({
          message: 'Benchmark tags synchronized successfully with application_dashboard tags',
        });
        expect(service.syncTagsWithApplicationDashboards).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles);
        expect(service.syncTagsWithApplicationDashboards).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Happy Path - PUT Endpoints', () => {
    describe('update', () => {
      it('should update a benchmark with all fields', async () => {
        // Arrange
        const updateDto = {
          systemUnderTestId: 'updated-system-uuid',
          testEnvironment: 'staging',
          workload: 'stress-test',
          source: 'updated-source',
          grafanaInstance: 'grafana-staging',
          dashboardLabel: 'Updated Dashboard',
          dashboardId: 2,
          dashboardUid: 'updated-uid',
          configTitle: 'Updated Config',
          panelTitle: 'Updated Panel',
          evaluateType: 'max',
          requirementOperator: '>',
          requirementValue: 200,
          description: 'Updated description',
          tags: ['updated-tag'],
          configuration: { updated: 'config' },
          enabled: false,
          valid: false,
        };
        const updatedBenchmark = { ...mockBenchmark, ...updateDto };
        service.update.mockResolvedValue(updatedBenchmark as any);

        // Act
        const result = await controller.update('benchmark-uuid-1', mockUserContext, updateDto);

        // Assert
        expect(result).toEqual(updatedBenchmark);
        expect(service.update).toHaveBeenCalledWith('benchmark-uuid-1', mockUserContext.userId, mockUserContext.roles, updateDto);
        expect(service.update).toHaveBeenCalledTimes(1);
      });

      it('should update only enabled status', async () => {
        // Arrange
        const updateDto = { enabled: false };
        const updatedBenchmark = { ...mockBenchmark, enabled: false };
        service.update.mockResolvedValue(updatedBenchmark as any);

        // Act
        const result = await controller.update('benchmark-uuid-1', mockUserContext, updateDto);

        // Assert
        expect(result).toEqual(updatedBenchmark);
        expect(service.update).toHaveBeenCalledWith('benchmark-uuid-1', mockUserContext.userId, mockUserContext.roles, updateDto);
        expect((result as any).enabled).toBe(false);
      });

      it('should update only valid status', async () => {
        // Arrange
        const updateDto = { valid: false };
        const updatedBenchmark = { ...mockBenchmark, valid: false };
        service.update.mockResolvedValue(updatedBenchmark as any);

        // Act
        const result = await controller.update('benchmark-uuid-1', mockUserContext, updateDto);

        // Assert
        expect(result).toEqual(updatedBenchmark);
        expect(service.update).toHaveBeenCalledWith('benchmark-uuid-1', mockUserContext.userId, mockUserContext.roles, updateDto);
        expect((result as any).valid).toBe(false);
      });

      it('should update only tags', async () => {
        // Arrange
        const updateDto = { tags: ['new-tag', 'another-tag'] };
        const updatedBenchmark = { ...mockBenchmark, tags: ['new-tag', 'another-tag'] };
        service.update.mockResolvedValue(updatedBenchmark as any);

        // Act
        const result = await controller.update('benchmark-uuid-1', mockUserContext, updateDto);

        // Assert
        expect(result).toEqual(updatedBenchmark);
        expect(service.update).toHaveBeenCalledWith('benchmark-uuid-1', mockUserContext.userId, mockUserContext.roles, updateDto);
        expect((result as any).tags).toEqual(['new-tag', 'another-tag']);
      });

      it('should update only description', async () => {
        // Arrange
        const updateDto = { description: 'New description' };
        const updatedBenchmark = { ...mockBenchmark, description: 'New description' };
        service.update.mockResolvedValue(updatedBenchmark as any);

        // Act
        const result = await controller.update('benchmark-uuid-1', mockUserContext, updateDto);

        // Assert
        expect(result).toEqual(updatedBenchmark);
        expect(service.update).toHaveBeenCalledWith('benchmark-uuid-1', mockUserContext.userId, mockUserContext.roles, updateDto);
        expect((result as any).description).toBe('New description');
      });

      it('should update requirement value', async () => {
        // Arrange
        const updateDto = { requirementValue: 200 };
        const updatedBenchmark = { ...mockBenchmark, requirement_value: 200 };
        service.update.mockResolvedValue(updatedBenchmark as any);

        // Act
        const result = await controller.update('benchmark-uuid-1', mockUserContext, updateDto);

        // Assert
        expect(result).toEqual(updatedBenchmark);
        expect(service.update).toHaveBeenCalledWith('benchmark-uuid-1', mockUserContext.userId, mockUserContext.roles, updateDto);
      });

      it('should throw 404 when benchmark not found', async () => {
        // Arrange
        const updateDto = { enabled: false };
        service.update.mockResolvedValue(null as any);

        // Act & Assert
        await expect(controller.update('non-existent-id', mockUserContext, updateDto)).rejects.toThrow(
          new HttpException('SLO not found', HttpStatus.NOT_FOUND),
        );
        expect(service.update).toHaveBeenCalledWith('non-existent-id', mockUserContext.userId, mockUserContext.roles, updateDto);
      });
    });
  });

  describe('Happy Path - DELETE Endpoints', () => {
    describe('delete', () => {
      it('should delete a benchmark successfully', async () => {
        // Arrange
        service.findOne.mockResolvedValue(mockBenchmark as any);
        service.delete.mockResolvedValue(true);

        // Act
        const result = await controller.delete('benchmark-uuid-1', mockUserContext);

        // Assert
        expect(result).toBeUndefined();
        expect(service.findOne).toHaveBeenCalledWith('benchmark-uuid-1', mockUserContext.userId, mockUserContext.roles);
        expect(service.delete).toHaveBeenCalledWith('benchmark-uuid-1', mockUserContext.userId, mockUserContext.roles);
        expect(service.delete).toHaveBeenCalledTimes(1);
      });

      it('should throw 404 when benchmark not found for deletion', async () => {
        // Arrange
        service.findOne.mockResolvedValue(null as any);

        // Act & Assert
        await expect(controller.delete('non-existent-id', mockUserContext)).rejects.toThrow(
          new HttpException('SLO not found', HttpStatus.NOT_FOUND),
        );
        expect(service.findOne).toHaveBeenCalledWith('non-existent-id', mockUserContext.userId, mockUserContext.roles);
        expect(service.delete).not.toHaveBeenCalled();
      });
    });
  });

  describe('Error Scenarios - GET Endpoints', () => {
    describe('findAll', () => {
      it('should throw INTERNAL_SERVER_ERROR when service fails', async () => {
        // Arrange
        const error = new Error('Database connection failed');
        service.findAll.mockRejectedValue(error);

        // Act & Assert
        await expect(controller.findAll(mockUserContext, {})).rejects.toThrow(
          new HttpException('Failed to fetch benchmarks', HttpStatus.INTERNAL_SERVER_ERROR),
        );
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, {});
      });

      it('should throw INTERNAL_SERVER_ERROR when service throws generic error', async () => {
        // Arrange
        service.findAll.mockRejectedValue(new Error('Unknown error'));

        // Act & Assert
        await expect(controller.findAll(mockUserContext, { testEnvironment: 'production' })).rejects.toThrow(
          new HttpException('Failed to fetch benchmarks', HttpStatus.INTERNAL_SERVER_ERROR),
        );
      });
    });

    describe('findOne', () => {
      it('should throw INTERNAL_SERVER_ERROR when service fails', async () => {
        // Arrange
        const error = new Error('Database query failed');
        service.findOne.mockRejectedValue(error);

        // Act & Assert
        await expect(controller.findOne(mockUserContext, 'benchmark-uuid-1')).rejects.toThrow(
          new HttpException('Failed to fetch SLO', HttpStatus.INTERNAL_SERVER_ERROR),
        );
        expect(service.findOne).toHaveBeenCalledWith('benchmark-uuid-1', mockUserContext.userId, mockUserContext.roles);
      });

      it('should preserve HttpException status codes from service', async () => {
        // Arrange
        const httpException = new HttpException('Custom error', HttpStatus.BAD_REQUEST);
        service.findOne.mockRejectedValue(httpException);

        // Act & Assert
        await expect(controller.findOne(mockUserContext, 'benchmark-uuid-1')).rejects.toThrow(httpException);
      });
    });

    describe('getSystemConfigOptions', () => {
      it('should throw INTERNAL_SERVER_ERROR when service fails', async () => {
        // Arrange
        const error = new Error('Failed to query system configs');
        service.getSystemEnvironmentsAndWorkloads.mockRejectedValue(error);

        // Act & Assert
        await expect(controller.getSystemConfigOptions(mockUserContext, 'system-uuid')).rejects.toThrow(
          new HttpException('Failed to fetch system config options', HttpStatus.INTERNAL_SERVER_ERROR),
        );
        expect(service.getSystemEnvironmentsAndWorkloads).toHaveBeenCalledWith('system-uuid', mockUserContext.userId, mockUserContext.roles);
      });
    });

    describe('getTagSyncStatus', () => {
      it('should throw INTERNAL_SERVER_ERROR when service fails', async () => {
        // Arrange
        const error = new Error('Failed to fetch tag sync data');
        service.getBenchmarkTagSyncStatus.mockRejectedValue(error);

        // Act & Assert
        await expect(controller.getTagSyncStatus(mockUserContext)).rejects.toThrow(
          new HttpException('Failed to fetch tag sync status', HttpStatus.INTERNAL_SERVER_ERROR),
        );
        expect(service.getBenchmarkTagSyncStatus).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles);
      });
    });
  });

  describe('Error Scenarios - POST Endpoints', () => {
    describe('create', () => {
      it('should throw INTERNAL_SERVER_ERROR when service fails', async () => {
        // Arrange
        const createDto = {
          systemUnderTestId: 'system-uuid',
          testEnvironment: 'production',
          workload: 'load-test',
          source: 'grafana',
          configTitle: 'Test Benchmark',
          panelTitle: 'Test Panel',
          evaluateType: 'mean',
          requirementOperator: '<',
          requirementValue: 100,
        };
        const error = new Error('Database insert failed');
        service.create.mockRejectedValue(error);

        // Act & Assert
        await expect(controller.create(mockUserContext, createDto)).rejects.toThrow(
          new HttpException('Failed to create benchmark', HttpStatus.INTERNAL_SERVER_ERROR),
        );
        expect(service.create).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, createDto);
      });

      it('should throw INTERNAL_SERVER_ERROR for validation errors', async () => {
        // Arrange
        const invalidDto = {
          systemUnderTestId: '',
          testEnvironment: 'production',
          workload: 'load-test',
          source: 'grafana',
          configTitle: 'Test',
          panelTitle: 'Panel',
          evaluateType: 'mean',
          requirementOperator: '<',
          requirementValue: 100,
        };
        service.create.mockRejectedValue(new Error('Validation failed'));

        // Act & Assert
        await expect(controller.create(mockUserContext, invalidDto)).rejects.toThrow(
          new HttpException('Failed to create benchmark', HttpStatus.INTERNAL_SERVER_ERROR),
        );
      });
    });

    describe('syncTags', () => {
      it('should throw INTERNAL_SERVER_ERROR when service fails', async () => {
        // Arrange
        const error = new Error('Failed to sync tags');
        service.syncTagsWithApplicationDashboards.mockRejectedValue(error);

        // Act & Assert
        await expect(controller.syncTags(mockUserContext)).rejects.toThrow(
          new HttpException('Failed to synchronize benchmark tags', HttpStatus.INTERNAL_SERVER_ERROR),
        );
        expect(service.syncTagsWithApplicationDashboards).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles);
      });

      it('should throw INTERNAL_SERVER_ERROR when application dashboards not found', async () => {
        // Arrange
        service.syncTagsWithApplicationDashboards.mockRejectedValue(
          new Error('Application dashboards not found'),
        );

        // Act & Assert
        await expect(controller.syncTags(mockUserContext)).rejects.toThrow(
          new HttpException('Failed to synchronize benchmark tags', HttpStatus.INTERNAL_SERVER_ERROR),
        );
      });
    });
  });

  describe('Error Scenarios - PUT Endpoints', () => {
    describe('update', () => {
      it('should throw INTERNAL_SERVER_ERROR when service fails', async () => {
        // Arrange
        const updateDto = { enabled: false };
        const error = new Error('Database update failed');
        service.update.mockRejectedValue(error);

        // Act & Assert
        await expect(controller.update('benchmark-uuid-1', mockUserContext, updateDto)).rejects.toThrow(
          new HttpException('Failed to update SLO', HttpStatus.INTERNAL_SERVER_ERROR),
        );
        expect(service.update).toHaveBeenCalledWith('benchmark-uuid-1', mockUserContext.userId, mockUserContext.roles, updateDto);
      });

      it('should preserve HttpException from service', async () => {
        // Arrange
        const updateDto = { enabled: false };
        const httpException = new HttpException('Validation error', HttpStatus.BAD_REQUEST);
        service.update.mockRejectedValue(httpException);

        // Act & Assert
        await expect(controller.update('benchmark-uuid-1', mockUserContext, updateDto)).rejects.toThrow(httpException);
      });

      it('should throw 404 when update returns null', async () => {
        // Arrange
        const updateDto = { enabled: false };
        service.update.mockResolvedValue(null as any);

        // Act & Assert
        await expect(controller.update('non-existent-id', mockUserContext, updateDto)).rejects.toThrow(
          new HttpException('SLO not found', HttpStatus.NOT_FOUND),
        );
      });
    });
  });

  describe('Error Scenarios - DELETE Endpoints', () => {
    describe('delete', () => {
      it('should throw INTERNAL_SERVER_ERROR when service fails', async () => {
        // Arrange
        service.findOne.mockResolvedValue(mockBenchmark as any);
        const error = new Error('Database delete failed');
        service.delete.mockRejectedValue(error);

        // Act & Assert
        await expect(controller.delete('benchmark-uuid-1', mockUserContext)).rejects.toThrow(
          new HttpException('Failed to delete SLO', HttpStatus.INTERNAL_SERVER_ERROR),
        );
        expect(service.findOne).toHaveBeenCalledWith('benchmark-uuid-1', mockUserContext.userId, mockUserContext.roles);
        expect(service.delete).toHaveBeenCalledWith('benchmark-uuid-1', mockUserContext.userId, mockUserContext.roles);
      });

      it('should preserve HttpException from service', async () => {
        // Arrange
        service.findOne.mockResolvedValue(mockBenchmark as any);
        const httpException = new HttpException('Cannot delete', HttpStatus.CONFLICT);
        service.delete.mockRejectedValue(httpException);

        // Act & Assert
        await expect(controller.delete('benchmark-uuid-1', mockUserContext)).rejects.toThrow(httpException);
      });

      it('should throw 404 when benchmark does not exist', async () => {
        // Arrange
        service.findOne.mockResolvedValue(null as any);

        // Act & Assert
        await expect(controller.delete('non-existent-id', mockUserContext)).rejects.toThrow(
          new HttpException('SLO not found', HttpStatus.NOT_FOUND),
        );
        expect(service.findOne).toHaveBeenCalledWith('non-existent-id', mockUserContext.userId, mockUserContext.roles);
        expect(service.delete).not.toHaveBeenCalled();
      });

      it('should throw INTERNAL_SERVER_ERROR when findOne fails', async () => {
        // Arrange
        const error = new Error('Database query failed');
        service.findOne.mockRejectedValue(error);

        // Act & Assert
        await expect(controller.delete('benchmark-uuid-1', mockUserContext)).rejects.toThrow(
          new HttpException('Failed to delete SLO', HttpStatus.INTERNAL_SERVER_ERROR),
        );
        expect(service.findOne).toHaveBeenCalledWith('benchmark-uuid-1', mockUserContext.userId, mockUserContext.roles);
        expect(service.delete).not.toHaveBeenCalled();
      });
    });
  });

  describe('Edge Cases', () => {
    describe('findAll with edge case filters', () => {
      it('should handle empty string filters gracefully', async () => {
        // Arrange
        const query = { testEnvironment: '', workload: '' };
        service.findAll.mockResolvedValue([mockBenchmark, mockBenchmark2] as any);

        // Act
        const result = await controller.findAll(mockUserContext, query);

        // Assert
        expect(result).toEqual([mockBenchmark, mockBenchmark2]);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
      });

      it('should handle boolean string filters correctly', async () => {
        // Arrange
        const query = { enabled: 'true', valid: 'false' };
        service.findAll.mockResolvedValue([] as any);

        // Act
        const result = await controller.findAll(mockUserContext, query);

        // Assert
        expect(result).toEqual([]);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
      });

      it('should handle null query parameters', async () => {
        // Arrange
        const query = { systemUnderTestId: null, testEnvironment: null };
        service.findAll.mockResolvedValue([mockBenchmark] as any);

        // Act
        const result = await controller.findAll(mockUserContext, query);

        // Assert
        expect(result).toEqual([mockBenchmark]);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
      });

      it('should handle undefined query parameters', async () => {
        // Arrange
        const query = { systemUnderTestId: undefined };
        service.findAll.mockResolvedValue([mockBenchmark, mockBenchmark2] as any);

        // Act
        const result = await controller.findAll(mockUserContext, query);

        // Assert
        expect(result).toEqual([mockBenchmark, mockBenchmark2]);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
      });
    });

    describe('create with edge case data', () => {
      it('should handle very large requirement values', async () => {
        // Arrange
        const createDto = {
          systemUnderTestId: 'system-uuid',
          testEnvironment: 'production',
          workload: 'load-test',
          source: 'grafana',
          configTitle: 'High Value Benchmark',
          panelTitle: 'Panel',
          evaluateType: 'mean',
          requirementOperator: '<',
          requirementValue: 999999999,
        };
        const benchmark = { ...mockBenchmark, requirement_value: 999999999 };
        service.create.mockResolvedValue(benchmark as any);

        // Act
        const result = await controller.create(mockUserContext, createDto);

        // Assert
        expect(result).toEqual(benchmark);
        expect((result as any).requirement_value).toBe(999999999);
      });

      it('should handle negative requirement values', async () => {
        // Arrange
        const createDto = {
          systemUnderTestId: 'system-uuid',
          testEnvironment: 'production',
          workload: 'load-test',
          source: 'grafana',
          configTitle: 'Negative Value Benchmark',
          panelTitle: 'Panel',
          evaluateType: 'mean',
          requirementOperator: '>',
          requirementValue: -100,
        };
        const benchmark = { ...mockBenchmark, requirement_value: -100 };
        service.create.mockResolvedValue(benchmark as any);

        // Act
        const result = await controller.create(mockUserContext, createDto);

        // Assert
        expect(result).toEqual(benchmark);
        expect((result as any).requirement_value).toBe(-100);
      });

      it('should handle empty tags array', async () => {
        // Arrange
        const createDto = {
          systemUnderTestId: 'system-uuid',
          testEnvironment: 'production',
          workload: 'load-test',
          source: 'grafana',
          configTitle: 'No Tags Benchmark',
          panelTitle: 'Panel',
          evaluateType: 'mean',
          requirementOperator: '<',
          requirementValue: 100,
          tags: [],
        };
        const benchmark = { ...mockBenchmark, tags: [] };
        service.create.mockResolvedValue(benchmark as any);

        // Act
        const result = await controller.create(mockUserContext, createDto);

        // Assert
        expect(result).toEqual(benchmark);
        expect((result as any).tags).toEqual([]);
      });

      it('should handle very long description strings', async () => {
        // Arrange
        const longDescription = 'A'.repeat(1000);
        const createDto = {
          systemUnderTestId: 'system-uuid',
          testEnvironment: 'production',
          workload: 'load-test',
          source: 'grafana',
          configTitle: 'Long Description Benchmark',
          panelTitle: 'Panel',
          evaluateType: 'mean',
          requirementOperator: '<',
          requirementValue: 100,
          description: longDescription,
        };
        const benchmark = { ...mockBenchmark, description: longDescription };
        service.create.mockResolvedValue(benchmark as any);

        // Act
        const result = await controller.create(mockUserContext, createDto);

        // Assert
        expect(result).toEqual(benchmark);
        expect((result as any).description?.length).toBe(1000);
      });

      it('should handle complex nested configuration objects', async () => {
        // Arrange
        const complexConfig = {
          nested: {
            deep: {
              value: 'test',
              array: [1, 2, 3],
              object: { key: 'value' },
            },
          },
        };
        const createDto = {
          systemUnderTestId: 'system-uuid',
          testEnvironment: 'production',
          workload: 'load-test',
          source: 'grafana',
          configTitle: 'Complex Config Benchmark',
          panelTitle: 'Panel',
          evaluateType: 'mean',
          requirementOperator: '<',
          requirementValue: 100,
          configuration: complexConfig,
        };
        const benchmark = { ...mockBenchmark, configuration: complexConfig };
        service.create.mockResolvedValue(benchmark as any);

        // Act
        const result = await controller.create(mockUserContext, createDto);

        // Assert
        expect(result).toEqual(benchmark);
        expect(result.configuration).toEqual(complexConfig);
      });
    });

    describe('update with edge case data', () => {
      it('should handle empty update object', async () => {
        // Arrange
        const updateDto = {};
        service.update.mockResolvedValue(mockBenchmark as any);

        // Act
        const result = await controller.update('benchmark-uuid-1', mockUserContext, updateDto);

        // Assert
        expect(result).toEqual(mockBenchmark);
        expect(service.update).toHaveBeenCalledWith('benchmark-uuid-1', mockUserContext.userId, mockUserContext.roles, updateDto);
      });

      it('should handle update with only undefined values', async () => {
        // Arrange
        const updateDto = { enabled: undefined, valid: undefined, description: undefined };
        service.update.mockResolvedValue(mockBenchmark as any);

        // Act
        const result = await controller.update('benchmark-uuid-1', mockUserContext, updateDto);

        // Assert
        expect(result).toEqual(mockBenchmark);
        expect(service.update).toHaveBeenCalledWith('benchmark-uuid-1', mockUserContext.userId, mockUserContext.roles, updateDto);
      });

      it('should handle clearing description (empty string)', async () => {
        // Arrange
        const updateDto = { description: '' };
        const updatedBenchmark = { ...mockBenchmark, description: '' };
        service.update.mockResolvedValue(updatedBenchmark as any);

        // Act
        const result = await controller.update('benchmark-uuid-1', mockUserContext, updateDto);

        // Assert
        expect(result).toEqual(updatedBenchmark);
        expect((result as any).description).toBe('');
      });

      it('should handle clearing tags (empty array)', async () => {
        // Arrange
        const updateDto = { tags: [] };
        const updatedBenchmark = { ...mockBenchmark, tags: [] };
        service.update.mockResolvedValue(updatedBenchmark as any);

        // Act
        const result = await controller.update('benchmark-uuid-1', mockUserContext, updateDto);

        // Assert
        expect(result).toEqual(updatedBenchmark);
        expect((result as any).tags).toEqual([]);
      });
    });

    describe('getSystemConfigOptions with edge cases', () => {
      it('should handle system with only one environment', async () => {
        // Arrange
        const singleEnvOptions = {
          environments: ['production'],
          workloads: ['load-test', 'stress-test'],
        };
        service.getSystemEnvironmentsAndWorkloads.mockResolvedValue(singleEnvOptions as any);

        // Act
        const result = await controller.getSystemConfigOptions(mockUserContext, 'system-uuid');

        // Assert
        expect(result).toEqual(singleEnvOptions);
        expect(result.environments).toHaveLength(1);
      });

      it('should handle system with only one workload', async () => {
        // Arrange
        const singleWorkloadOptions = {
          environments: ['production', 'staging'],
          workloads: ['load-test'],
        };
        service.getSystemEnvironmentsAndWorkloads.mockResolvedValue(singleWorkloadOptions as any);

        // Act
        const result = await controller.getSystemConfigOptions(mockUserContext, 'system-uuid');

        // Assert
        expect(result).toEqual(singleWorkloadOptions);
        expect(result.workloads).toHaveLength(1);
      });

      it('should handle special characters in system ID', async () => {
        // Arrange
        const specialSystemId = 'system-with-special-chars-@#$%';
        service.getSystemEnvironmentsAndWorkloads.mockResolvedValue(mockSystemConfigOptions as any);

        // Act
        const result = await controller.getSystemConfigOptions(mockUserContext, specialSystemId);

        // Assert
        expect(result).toEqual(mockSystemConfigOptions);
        expect(service.getSystemEnvironmentsAndWorkloads).toHaveBeenCalledWith(specialSystemId, mockUserContext.userId, mockUserContext.roles);
      });
    });

    describe('delete with edge cases', () => {
      it('should handle deleting benchmark with special characters in ID', async () => {
        // Arrange
        const specialId = 'benchmark-with-special-chars-@#$%';
        const specialBenchmark = { ...mockBenchmark, id: specialId } as any as Benchmark;
        service.findOne.mockResolvedValue(specialBenchmark as any);
        service.delete.mockResolvedValue(true);

        // Act
        const result = await controller.delete(specialId, mockUserContext);

        // Assert
        expect(result).toBeUndefined();
        expect(service.findOne).toHaveBeenCalledWith(specialId, mockUserContext.userId, mockUserContext.roles);
        expect(service.delete).toHaveBeenCalledWith(specialId, mockUserContext.userId, mockUserContext.roles);
      });

      it('should handle deleting benchmark with very long ID', async () => {
        // Arrange
        const longId = 'benchmark-' + 'a'.repeat(100);
        const longIdBenchmark = { ...mockBenchmark, id: longId } as any as Benchmark;
        service.findOne.mockResolvedValue(longIdBenchmark as any);
        service.delete.mockResolvedValue(true);

        // Act
        const result = await controller.delete(longId, mockUserContext);

        // Assert
        expect(result).toBeUndefined();
        expect(service.findOne).toHaveBeenCalledWith(longId, mockUserContext.userId, mockUserContext.roles);
        expect(service.delete).toHaveBeenCalledWith(longId, mockUserContext.userId, mockUserContext.roles);
      });
    });
  });

  describe('Logger Verification', () => {
    it('should log error when findAll fails', async () => {
      // Arrange
      const loggerSpy = jest.spyOn(controller['logger'], 'error');
      const error = new Error('Database connection failed');
      service.findAll.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.findAll(mockUserContext, {})).rejects.toThrow(HttpException);
      expect(loggerSpy).toHaveBeenCalledWith('Failed to fetch benchmarks:', error);
    });

    it('should log error when findOne fails', async () => {
      // Arrange
      const loggerSpy = jest.spyOn(controller['logger'], 'error');
      const error = new Error('Database query failed');
      service.findOne.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.findOne(mockUserContext, 'benchmark-uuid-1')).rejects.toThrow(HttpException);
      expect(loggerSpy).toHaveBeenCalledWith('Failed to fetch SLO:', error);
    });

    it('should log error when create fails', async () => {
      // Arrange
      const loggerSpy = jest.spyOn(controller['logger'], 'error');
      const createDto = {
        systemUnderTestId: 'system-uuid',
        testEnvironment: 'production',
        workload: 'load-test',
        source: 'grafana',
        configTitle: 'Test',
        panelTitle: 'Panel',
        evaluateType: 'mean',
        requirementOperator: '<',
        requirementValue: 100,
      };
      const error = new Error('Database insert failed');
      service.create.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.create(mockUserContext, createDto)).rejects.toThrow(HttpException);
      expect(loggerSpy).toHaveBeenCalledWith('Failed to create benchmark:', error);
    });

    it('should log error when update fails', async () => {
      // Arrange
      const loggerSpy = jest.spyOn(controller['logger'], 'error');
      const updateDto = { enabled: false };
      const error = new Error('Database update failed');
      service.update.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.update('benchmark-uuid-1', mockUserContext, updateDto)).rejects.toThrow(HttpException);
      expect(loggerSpy).toHaveBeenCalledWith('Failed to update SLO:', error);
    });

    it('should log error when delete fails', async () => {
      // Arrange
      const loggerSpy = jest.spyOn(controller['logger'], 'error');
      service.findOne.mockResolvedValue(mockBenchmark as any);
      const error = new Error('Database delete failed');
      service.delete.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.delete('benchmark-uuid-1', mockUserContext)).rejects.toThrow(HttpException);
      expect(loggerSpy).toHaveBeenCalledWith('Failed to delete SLO:', error);
    });

    it('should log error when syncTags fails', async () => {
      // Arrange
      const loggerSpy = jest.spyOn(controller['logger'], 'error');
      const error = new Error('Failed to sync tags');
      service.syncTagsWithApplicationDashboards.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.syncTags(mockUserContext)).rejects.toThrow(HttpException);
      expect(loggerSpy).toHaveBeenCalledWith('Failed to sync benchmark tags:', error);
    });

    it('should log error when getTagSyncStatus fails', async () => {
      // Arrange
      const loggerSpy = jest.spyOn(controller['logger'], 'error');
      const error = new Error('Failed to fetch tag sync data');
      service.getBenchmarkTagSyncStatus.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.getTagSyncStatus(mockUserContext)).rejects.toThrow(HttpException);
      expect(loggerSpy).toHaveBeenCalledWith('Failed to fetch tag sync status:', error);
    });

    it('should log error when getSystemConfigOptions fails', async () => {
      // Arrange
      const loggerSpy = jest.spyOn(controller['logger'], 'error');
      const error = new Error('Failed to query system configs');
      service.getSystemEnvironmentsAndWorkloads.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.getSystemConfigOptions(mockUserContext, 'system-uuid')).rejects.toThrow(HttpException);
      expect(loggerSpy).toHaveBeenCalledWith('Failed to fetch system config options:', error);
    });
  });
});
