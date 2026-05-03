import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BenchmarksService } from './benchmarks.service';
import {
  BenchmarkQueryService,
  BenchmarkMutationService,
  BenchmarkCalculatorService,
  BenchmarkTagHelper,
} from './services';
import { Benchmark as BenchmarkEntity, SystemUnderTest } from '../../entities';
import { ApplicationDashboard as ApplicationDashboardEntity } from '../../entities';
import {
  createMockRepository,
  createMockQueryBuilder,
  MockRepository,
  MockSelectQueryBuilder,
} from '../../../test/helpers/mock-repository.factory';
import { createAuthorizationServiceMock } from '../../../test/mocks/authorization-service.mock';
import { AuthorizationService } from '../../common/services/authorization.service';
import { AuditService } from '../audit/audit.service';

// Mock the tag-filter utils
jest.mock('../../common/tag-filter.utils', () => ({
  mergeAndFilterTags: jest.fn((dashboardTags: string[], providedTags: string[]) => {
    // Simple mock implementation: merge and filter system tags
    const merged = [...new Set([...dashboardTags, ...providedTags])];
    return merged.filter(tag => !tag.startsWith('perfana') && !tag.startsWith('$'));
  }),
}));

import { mergeAndFilterTags } from '../../common/tag-filter.utils';

describe('BenchmarksService', () => {
  let service: BenchmarksService;
  let queryService: BenchmarkQueryService;
  let mutationService: BenchmarkMutationService;
  let benchmarkRepo: MockRepository<BenchmarkEntity>;
  let appDashboardRepo: MockRepository<ApplicationDashboardEntity>;
  let systemRepo: MockRepository<SystemUnderTest>;
  let dataSource: jest.Mocked<DataSource>;
  let benchmarkQueryBuilder: MockSelectQueryBuilder<BenchmarkEntity>;

  const mockUserId = 'test-user-id';
  const mockRoles = ['user'];
  const mockDate = new Date('2024-01-15T10:00:00.000Z');

  const mockBenchmark = {
    id: 'benchmark-uuid',
    system_under_test_id: 'system-uuid',
    test_environment: 'production',
    workload: 'load-test',
    source: 'grafana',
    grafana_instance: 'grafana-prod',
    dashboard_label: 'Test Dashboard',
    dashboard_id: 1,
    dashboard_uid: 'dashboard-uid',
    application_dashboard_id: 'dashboard-uuid',
    generic_check_id: null,
    configuration: {
      title: 'Response Time Benchmark',
      id: 'benchmark-config-id',
      type: 'grafana',
      evaluateType: 'mean',
      requirement: {
        operator: '<',
        value: 100,
      },
      yAxesFormat: 'ms',
    },
    config_title: 'Response Time Benchmark',
    config_id: 'benchmark-config-id',
    panel_title: 'Response Time',
    metric_unit: 'ms',
    evaluate_type: 'mean',
    requirement_operator: '<',
    requirement_value: 100,
    enabled: true,
    valid: true,
    tags: ['performance', 'response-time'],
    created_at: mockDate,
    updated_at: mockDate,
    description: 'Test benchmark',
    exclude_ramp_up_time: true,
    average_all: false,
    validate_with_default_if_no_data: false,
    metadata: {},
    system_under_test: {
      id: 'system-uuid',
      name: 'Test System',
    } as any,
  } as any as BenchmarkEntity;

  const mockApplicationDashboard: ApplicationDashboardEntity = {
    id: 'dashboard-uuid',
    dashboardLabel: 'Test Dashboard',
    tags: ['dashboard-tag-1', 'dashboard-tag-2', 'perfana-system-tag'],
  } as ApplicationDashboardEntity;

  beforeEach(async () => {
    // Create query builder using factory
    benchmarkQueryBuilder = createMockQueryBuilder<BenchmarkEntity>();

    // Create repositories using factory
    const mockBenchmarkRepo = createMockRepository<BenchmarkEntity>();
    const mockAppDashboardRepo = createMockRepository<ApplicationDashboardEntity>();

    // Configure query builder
    mockBenchmarkRepo.createQueryBuilder.mockReturnValue(benchmarkQueryBuilder as any);

    const mockDataSource = {
      query: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BenchmarksService,
        BenchmarkQueryService,
        BenchmarkMutationService,
        BenchmarkCalculatorService,
        BenchmarkTagHelper,
        {
          provide: getRepositoryToken(BenchmarkEntity),
          useValue: mockBenchmarkRepo,
        },
        {
          provide: getRepositoryToken(ApplicationDashboardEntity),
          useValue: mockAppDashboardRepo,
        },
        {
          provide: getRepositoryToken(SystemUnderTest),
          useValue: createMockRepository<SystemUnderTest>(),
        },
        {
          provide: getDataSourceToken(),
          useValue: mockDataSource,
        },
        {
          provide: AuthorizationService,
          useValue: createAuthorizationServiceMock(),
        },
        {
          provide: AuditService,
          useValue: {
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logDelete: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<BenchmarksService>(BenchmarksService);
    queryService = module.get<BenchmarkQueryService>(BenchmarkQueryService);
    mutationService = module.get<BenchmarkMutationService>(BenchmarkMutationService);
    benchmarkRepo = module.get(getRepositoryToken(BenchmarkEntity));
    appDashboardRepo = module.get(getRepositoryToken(ApplicationDashboardEntity));
    systemRepo = module.get(getRepositoryToken(SystemUnderTest));
    dataSource = module.get(getDataSourceToken());

    jest.clearAllMocks();
    // Default: validateSystemAccess finds the system. canAccessResource mock allows by default.
    systemRepo.findOne.mockResolvedValue({ id: 'system-uuid', organization_id: 'org-1', created_by: 'creator' } as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all benchmarks without filters', async () => {
      // Arrange
      benchmarkQueryBuilder.getMany.mockResolvedValue([mockBenchmark]);

      // Act
      const result = await service.findAll(mockUserId, mockRoles, {});

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('benchmark-uuid');
      expect(result[0]?.system_under_test_id).toBe('system-uuid');
      expect(result[0]?.systems_under_test).toEqual({
        id: 'system-uuid',
        name: 'Test System',
      });
    });

    it('should handle benchmarks without system_under_test relation', async () => {
      // Arrange
      const benchmarkWithoutSystem = { ...mockBenchmark, system_under_test: null };
      benchmarkQueryBuilder.getMany.mockResolvedValue([benchmarkWithoutSystem]);

      // Act
      const result = await service.findAll(mockUserId, mockRoles, {});

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]?.systems_under_test).toBeUndefined();
    });

    it('should handle query errors by throwing', async () => {
      // Arrange
      benchmarkQueryBuilder.getMany.mockRejectedValue(new Error('Database connection error'));

      // Act & Assert
      await expect(service.findAll(mockUserId, mockRoles, {})).rejects.toThrow('Database connection error');
    });

    it('should filter by system under test ID', async () => {
      // Arrange
      benchmarkQueryBuilder.getMany.mockResolvedValue([mockBenchmark]);

      // Act
      await service.findAll(mockUserId, mockRoles, { systemUnderTestId: 'system-uuid' });

      // Assert
      expect(benchmarkQueryBuilder.andWhere).toHaveBeenCalledWith(
        'b.system_under_test_id = :systemId',
        { systemId: 'system-uuid' }
      );
    });

    it('should filter by test environment', async () => {
      // Arrange
      benchmarkQueryBuilder.getMany.mockResolvedValue([mockBenchmark]);

      // Act
      await service.findAll(mockUserId, mockRoles, { testEnvironment: 'production' });

      // Assert
      expect(benchmarkQueryBuilder.andWhere).toHaveBeenCalledWith(
        'b.test_environment = :environment',
        { environment: 'production' }
      );
    });

    it('should filter by workload', async () => {
      // Arrange
      benchmarkQueryBuilder.getMany.mockResolvedValue([mockBenchmark]);

      // Act
      await service.findAll(mockUserId, mockRoles, { workload: 'load-test' });

      // Assert
      expect(benchmarkQueryBuilder.andWhere).toHaveBeenCalledWith(
        'b.workload = :workload',
        { workload: 'load-test' }
      );
    });

    it('should filter by enabled status true', async () => {
      // Arrange
      benchmarkQueryBuilder.getMany.mockResolvedValue([mockBenchmark]);

      // Act
      await service.findAll(mockUserId, mockRoles, { enabled: 'true' });

      // Assert
      expect(benchmarkQueryBuilder.andWhere).toHaveBeenCalledWith('b.enabled = :enabled', { enabled: true });
    });

    it('should filter by enabled status false', async () => {
      // Arrange
      benchmarkQueryBuilder.getMany.mockResolvedValue([mockBenchmark]);

      // Act
      await service.findAll(mockUserId, mockRoles, { enabled: 'false' });

      // Assert
      expect(benchmarkQueryBuilder.andWhere).toHaveBeenCalledWith('b.enabled = :enabled', { enabled: false });
    });

    it('should filter by valid status true', async () => {
      // Arrange
      benchmarkQueryBuilder.getMany.mockResolvedValue([mockBenchmark]);

      // Act
      await service.findAll(mockUserId, mockRoles, { valid: 'true' });

      // Assert
      expect(benchmarkQueryBuilder.andWhere).toHaveBeenCalledWith('b.valid = :valid', { valid: true });
    });

    it('should filter by valid status false', async () => {
      // Arrange
      benchmarkQueryBuilder.getMany.mockResolvedValue([mockBenchmark]);

      // Act
      await service.findAll(mockUserId, mockRoles, { valid: 'false' });

      // Assert
      expect(benchmarkQueryBuilder.andWhere).toHaveBeenCalledWith('b.valid = :valid', { valid: false });
    });

    it('should apply multiple filters', async () => {
      // Arrange
      benchmarkQueryBuilder.getMany.mockResolvedValue([mockBenchmark]);

      // Act
      await service.findAll(mockUserId, mockRoles, {
        systemUnderTestId: 'system-uuid',
        testEnvironment: 'production',
        workload: 'load-test',
        enabled: 'true',
        valid: 'true'
      });

      // Assert
      expect(benchmarkQueryBuilder.andWhere).toHaveBeenCalledTimes(5);
    });
  });

  describe('findOne', () => {
    it('should return benchmark by ID', async () => {
      // Arrange
      benchmarkRepo.findOne.mockResolvedValue(mockBenchmark);

      // Act
      const result = await service.findOne('benchmark-uuid', mockUserId, mockRoles);

      // Assert
      expect(result).toBeDefined();
      expect(result!.id).toBe('benchmark-uuid');
      expect(benchmarkRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'benchmark-uuid' },
        relations: ['system_under_test'],
      });
    });

    it('should return null when benchmark not found', async () => {
      // Arrange
      benchmarkRepo.findOne.mockResolvedValue(null);

      // Act
      const result = await service.findOne('non-existent-id', mockUserId, mockRoles);

      // Assert
      expect(result).toBeNull();
    });

    it('should handle repository errors gracefully and return null', async () => {
      // Arrange
      benchmarkRepo.findOne.mockRejectedValue(new Error('Database error'));

      // Act
      const result = await service.findOne('benchmark-uuid', mockUserId, mockRoles);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('Tag Inheritance Logic', () => {
    describe('create', () => {
      it('should inherit tags from application dashboard', async () => {
        // Arrange
        const createDto = {
          systemUnderTestId: 'system-uuid',
          testEnvironment: 'production',
          workload: 'load-test',
          source: 'grafana',
          applicationDashboardId: 'dashboard-uuid',
          configTitle: 'Test Benchmark',
          panelTitle: 'Response Time',
          evaluateType: 'mean',
          requirementOperator: '<',
          requirementValue: 100,
          tags: ['user-tag'],
        };

        appDashboardRepo.findOne.mockResolvedValue(mockApplicationDashboard);
        benchmarkRepo.create.mockReturnValue(mockBenchmark);
        benchmarkRepo.save.mockResolvedValue(mockBenchmark);

        // Act
        await service.create(mockUserId, mockRoles, createDto);

        // Assert
        expect(appDashboardRepo.findOne).toHaveBeenCalledWith({
          where: { id: 'dashboard-uuid' },
          select: ['id', 'tags'],
        });
        expect(mergeAndFilterTags).toHaveBeenCalledWith(
          mockApplicationDashboard.tags,
          ['user-tag']
        );
      });

      it('should use provided tags when no application dashboard', async () => {
        // Arrange
        const createDto = {
          systemUnderTestId: 'system-uuid',
          testEnvironment: 'production',
          workload: 'load-test',
          source: 'grafana',
          configTitle: 'Test Benchmark',
          panelTitle: 'Response Time',
          evaluateType: 'mean',
          requirementOperator: '<',
          requirementValue: 100,
          tags: ['user-tag-1', 'user-tag-2'],
        };

        benchmarkRepo.create.mockReturnValue(mockBenchmark);
        benchmarkRepo.save.mockResolvedValue(mockBenchmark);

        // Act
        await service.create(mockUserId, mockRoles, createDto);

        // Assert
        expect(benchmarkRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            tags: ['user-tag-1', 'user-tag-2'],
          })
        );
      });

      it('should handle dashboard without tags', async () => {
        // Arrange
        const createDto = {
          systemUnderTestId: 'system-uuid',
          testEnvironment: 'production',
          workload: 'load-test',
          source: 'grafana',
          applicationDashboardId: 'dashboard-uuid',
          configTitle: 'Test Benchmark',
          panelTitle: 'Response Time',
          evaluateType: 'mean',
          requirementOperator: '<',
          requirementValue: 100,
          tags: ['user-tag'],
        };

        appDashboardRepo.findOne.mockResolvedValue({
          ...mockApplicationDashboard,
          tags: [],
        });
        benchmarkRepo.create.mockReturnValue(mockBenchmark);
        benchmarkRepo.save.mockResolvedValue(mockBenchmark);

        // Act
        await service.create(mockUserId, mockRoles, createDto);

        // Assert
        expect(benchmarkRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            tags: ['user-tag'],
          })
        );
      });

      it('should handle dashboard fetch failure gracefully', async () => {
        // Arrange
        const createDto = {
          systemUnderTestId: 'system-uuid',
          testEnvironment: 'production',
          workload: 'load-test',
          source: 'grafana',
          applicationDashboardId: 'dashboard-uuid',
          configTitle: 'Test Benchmark',
          panelTitle: 'Response Time',
          evaluateType: 'mean',
          requirementOperator: '<',
          requirementValue: 100,
          tags: ['user-tag'],
        };

        appDashboardRepo.findOne.mockRejectedValue(new Error('Database error'));
        benchmarkRepo.create.mockReturnValue(mockBenchmark);
        benchmarkRepo.save.mockResolvedValue(mockBenchmark);

        // Act
        await service.create(mockUserId, mockRoles, createDto);

        // Assert
        expect(benchmarkRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            tags: ['user-tag'],
          })
        );
      });

      it('should extract metric unit from yAxesFormat', async () => {
        // Arrange
        const createDto = {
          systemUnderTestId: 'system-uuid',
          testEnvironment: 'production',
          workload: 'load-test',
          source: 'grafana',
          configTitle: 'Test Benchmark',
          panelTitle: 'Response Time',
          evaluateType: 'mean',
          requirementOperator: '<',
          requirementValue: 100,
          configuration: {
            yAxesFormat: 'milliseconds',
          },
        };

        benchmarkRepo.create.mockReturnValue(mockBenchmark);
        benchmarkRepo.save.mockResolvedValue(mockBenchmark);

        // Act
        await service.create(mockUserId, mockRoles, createDto);

        // Assert
        expect(benchmarkRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            metric_unit: 'milliseconds',
          })
        );
      });

      it('should create benchmark with all fields properly mapped', async () => {
        // Arrange
        const createDto = {
          systemUnderTestId: 'system-uuid',
          testEnvironment: 'production',
          workload: 'load-test',
          source: 'grafana',
          grafanaInstance: 'grafana-prod',
          dashboardLabel: 'Test Dashboard',
          dashboardId: 123,
          dashboardUid: 'test-uid',
          configTitle: 'Test Benchmark',
          panelTitle: 'Response Time',
          evaluateType: 'mean',
          requirementOperator: '<',
          requirementValue: 100,
          description: 'Test description',
          tags: ['tag1', 'tag2'],
        };

        benchmarkRepo.create.mockReturnValue(mockBenchmark);
        benchmarkRepo.save.mockResolvedValue(mockBenchmark);

        // Act
        const result = await service.create(mockUserId, mockRoles, createDto);

        // Assert
        expect(benchmarkRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            system_under_test_id: 'system-uuid',
            test_environment: 'production',
            workload: 'load-test',
            source: 'grafana',
            grafana_instance: 'grafana-prod',
            dashboard_label: 'Test Dashboard',
            dashboard_id: 123,
            dashboard_uid: 'test-uid',
            panel_title: 'Response Time',
            enabled: true,
            valid: true,
            description: 'Test description',
            tags: ['tag1', 'tag2'],
            configuration: expect.objectContaining({
              title: 'Test Benchmark',
              evaluateType: 'mean',
              requirement: {
                operator: '<',
                value: 100
              }
            }),
          })
        );
        expect(result).toBeDefined();
        expect(result.id).toBe('benchmark-uuid');
      });

      it('should handle create errors by throwing', async () => {
        // Arrange
        const createDto = {
          systemUnderTestId: 'system-uuid',
          testEnvironment: 'production',
          workload: 'load-test',
          source: 'grafana',
          configTitle: 'Test Benchmark',
          panelTitle: 'Response Time',
          evaluateType: 'mean',
          requirementOperator: '<',
          requirementValue: 100,
        };

        benchmarkRepo.create.mockReturnValue(mockBenchmark);
        benchmarkRepo.save.mockRejectedValue(new Error('Database constraint violation'));

        // Act & Assert
        await expect(service.create(mockUserId, mockRoles, createDto)).rejects.toThrow('Database constraint violation');
      });
    });

    describe('update', () => {
      it('should inherit tags from application dashboard on update', async () => {
        // Arrange
        const updateDto = {
          dashboardUid: 'dashboard-uid',
          systemUnderTestId: 'system-uuid',
          testEnvironment: 'production',
          tags: ['new-user-tag'],
        };

        benchmarkRepo.findOne
          .mockResolvedValueOnce(mockBenchmark) // First call in findOne
          .mockResolvedValueOnce(mockBenchmark); // Second call after update

        appDashboardRepo.findOne.mockResolvedValue(mockApplicationDashboard);
        benchmarkRepo.update.mockResolvedValue({} as any);

        // Act
        await service.update('benchmark-uuid', mockUserId, mockRoles, updateDto);

        // Assert
        expect(appDashboardRepo.findOne).toHaveBeenCalledWith({
          where: {
            systemUnderTestId: 'system-uuid',
            testEnvironment: 'production',
            dashboardUid: 'dashboard-uid',
          },
          select: ['id', 'tags'],
        });
        expect(mergeAndFilterTags).toHaveBeenCalled();
      });

      it('should use existing tags when dashboard not found', async () => {
        // Arrange
        const updateDto = {
          configTitle: 'Updated Benchmark',
        };

        benchmarkRepo.findOne
          .mockResolvedValueOnce(mockBenchmark)
          .mockResolvedValueOnce({ ...mockBenchmark, config_title: 'Updated Benchmark' });

        benchmarkRepo.update.mockResolvedValue({} as any);

        // Act
        const result = await service.update('benchmark-uuid', mockUserId, mockRoles, updateDto);

        // Assert
        expect(result!.tags).toEqual(mockBenchmark.tags);
      });

      it('should handle dashboard lookup failure during tag inheritance', async () => {
        // Arrange
        const updateDto = {
          dashboardUid: 'dashboard-uid',
          systemUnderTestId: 'system-uuid',
          testEnvironment: 'production',
          tags: ['new-tag'],
        };

        benchmarkRepo.findOne
          .mockResolvedValueOnce(mockBenchmark)
          .mockResolvedValueOnce(mockBenchmark);

        appDashboardRepo.findOne.mockRejectedValue(new Error('Dashboard query error'));
        benchmarkRepo.update.mockResolvedValue({} as any);

        // Act
        const result = await service.update('benchmark-uuid', mockUserId, mockRoles, updateDto);

        // Assert
        expect(result).toBeDefined();
        expect(benchmarkRepo.update).toHaveBeenCalled();
      });

      it('should update metric unit from configuration yAxesFormat', async () => {
        // Arrange
        const updateDto = {
          configuration: {
            yAxesFormat: 'seconds',
          },
        };

        benchmarkRepo.findOne
          .mockResolvedValueOnce(mockBenchmark)
          .mockResolvedValueOnce(mockBenchmark);

        benchmarkRepo.update.mockResolvedValue({} as any);

        // Act
        await service.update('benchmark-uuid', mockUserId, mockRoles, updateDto);

        // Assert
        expect(benchmarkRepo.update).toHaveBeenCalledWith(
          'benchmark-uuid',
          expect.objectContaining({
            metric_unit: 'seconds',
          })
        );
      });

      it('should merge configuration updates', async () => {
        // Arrange
        const updateDto = {
          configuration: {
            newField: 'new value',
          },
          requirementOperator: '>',
          requirementValue: 200,
        };

        benchmarkRepo.findOne
          .mockResolvedValueOnce(mockBenchmark)
          .mockResolvedValueOnce(mockBenchmark);

        benchmarkRepo.update.mockResolvedValue({} as any);

        // Act
        await service.update('benchmark-uuid', mockUserId, mockRoles, updateDto);

        // Assert
        expect(benchmarkRepo.update).toHaveBeenCalledWith(
          'benchmark-uuid',
          expect.objectContaining({
            configuration: expect.objectContaining({
              title: 'Response Time Benchmark',
              newField: 'new value',
              requirement: {
                operator: '>',
                value: 200,
              },
            }),
          })
        );
      });

      it('should return null when benchmark not found', async () => {
        // Arrange
        benchmarkRepo.findOne.mockResolvedValue(null);

        // Act
        const result = await service.update('non-existent-id', mockUserId, mockRoles, {});

        // Assert
        expect(result).toBeNull();
      });

      it('should update all optional fields', async () => {
        // Arrange
        const updateDto = {
          systemUnderTestId: 'new-system-uuid',
          testEnvironment: 'staging',
          workload: 'stress-test',
          source: 'dynatrace',
          grafanaInstance: 'grafana-staging',
          dashboardLabel: 'New Dashboard',
          dashboardId: 456,
          dashboardUid: 'new-uid',
          panelTitle: 'New Panel',
          description: 'Updated description',
          enabled: false,
          valid: false,
        };

        benchmarkRepo.findOne
          .mockResolvedValueOnce(mockBenchmark)
          .mockResolvedValueOnce({ ...mockBenchmark, ...updateDto });

        benchmarkRepo.update.mockResolvedValue({} as any);

        // Act
        await service.update('benchmark-uuid', mockUserId, mockRoles, updateDto);

        // Assert
        expect(benchmarkRepo.update).toHaveBeenCalledWith(
          'benchmark-uuid',
          expect.objectContaining({
            system_under_test_id: 'new-system-uuid',
            test_environment: 'staging',
            workload: 'stress-test',
            source: 'dynatrace',
            grafana_instance: 'grafana-staging',
            dashboard_label: 'New Dashboard',
            dashboard_id: 456,
            dashboard_uid: 'new-uid',
            panel_title: 'New Panel',
            description: 'Updated description',
            enabled: false,
            valid: false,
          })
        );
      });

      it('should update configuration title when configTitle provided', async () => {
        // Arrange
        const updateDto = {
          configTitle: 'New Config Title',
          configuration: {
            newField: 'value',
          },
        };

        benchmarkRepo.findOne
          .mockResolvedValueOnce(mockBenchmark)
          .mockResolvedValueOnce(mockBenchmark);

        benchmarkRepo.update.mockResolvedValue({} as any);

        // Act
        await service.update('benchmark-uuid', mockUserId, mockRoles, updateDto);

        // Assert
        expect(benchmarkRepo.update).toHaveBeenCalledWith(
          'benchmark-uuid',
          expect.objectContaining({
            configuration: expect.objectContaining({
              title: 'New Config Title',
              newField: 'value',
            }),
          })
        );
      });

      it('should update evaluateType in configuration', async () => {
        // Arrange
        const updateDto = {
          evaluateType: 'median',
          configuration: {},
        };

        benchmarkRepo.findOne
          .mockResolvedValueOnce(mockBenchmark)
          .mockResolvedValueOnce(mockBenchmark);

        benchmarkRepo.update.mockResolvedValue({} as any);

        // Act
        await service.update('benchmark-uuid', mockUserId, mockRoles, updateDto);

        // Assert
        expect(benchmarkRepo.update).toHaveBeenCalledWith(
          'benchmark-uuid',
          expect.objectContaining({
            configuration: expect.objectContaining({
              evaluateType: 'median',
            }),
          })
        );
      });

      it('should update requirement with only operator changed', async () => {
        // Arrange
        const updateDto = {
          requirementOperator: '>=',
          configuration: {},
        };

        benchmarkRepo.findOne
          .mockResolvedValueOnce(mockBenchmark)
          .mockResolvedValueOnce(mockBenchmark);

        benchmarkRepo.update.mockResolvedValue({} as any);

        // Act
        await service.update('benchmark-uuid', mockUserId, mockRoles, updateDto);

        // Assert
        expect(benchmarkRepo.update).toHaveBeenCalledWith(
          'benchmark-uuid',
          expect.objectContaining({
            configuration: expect.objectContaining({
              requirement: {
                operator: '>=',
                value: 100, // From existing benchmark
              },
            }),
          })
        );
      });

      it('should update requirement with only value changed', async () => {
        // Arrange
        const updateDto = {
          requirementValue: 200,
          configuration: {},
        };

        benchmarkRepo.findOne
          .mockResolvedValueOnce(mockBenchmark)
          .mockResolvedValueOnce(mockBenchmark);

        benchmarkRepo.update.mockResolvedValue({} as any);

        // Act
        await service.update('benchmark-uuid', mockUserId, mockRoles, updateDto);

        // Assert
        expect(benchmarkRepo.update).toHaveBeenCalledWith(
          'benchmark-uuid',
          expect.objectContaining({
            configuration: expect.objectContaining({
              requirement: {
                operator: '<', // From existing benchmark
                value: 200,
              },
            }),
          })
        );
      });

      it('should throw error when benchmark fetch fails after update', async () => {
        // Arrange
        const updateDto = {
          configTitle: 'Updated Title',
        };

        benchmarkRepo.findOne
          .mockResolvedValueOnce(mockBenchmark)
          .mockResolvedValueOnce(null);

        benchmarkRepo.update.mockResolvedValue({} as any);

        // Act & Assert
        await expect(service.update('benchmark-uuid', mockUserId, mockRoles, updateDto)).rejects.toThrow(
          'Failed to fetch updated benchmark benchmark-uuid'
        );
      });

      it('should handle update errors by throwing', async () => {
        // Arrange
        const updateDto = {
          configTitle: 'Updated Title',
        };

        benchmarkRepo.findOne.mockResolvedValueOnce(mockBenchmark);
        benchmarkRepo.update.mockRejectedValue(new Error('Database update error'));

        // Act & Assert
        await expect(service.update('benchmark-uuid', mockUserId, mockRoles, updateDto)).rejects.toThrow('Database update error');
      });
    });
  });

  describe('delete', () => {
    it('should delete benchmark', async () => {
      // Arrange - findOne is called internally for access check (needs full entity for BenchmarkMapper)
      benchmarkRepo.findOne.mockResolvedValue({
        id: 'benchmark-uuid',
        system_under_test: { id: 'system-uuid', name: 'Test System', organization_id: 'org-1' },
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      } as any);
      benchmarkRepo.delete.mockResolvedValue({ affected: 1 } as any);

      // Act
      const result = await service.delete('benchmark-uuid', mockUserId, mockRoles);

      // Assert
      expect(result).toBe(true);
      expect(benchmarkRepo.delete).toHaveBeenCalledWith('benchmark-uuid');
    });

    it('should return false when benchmark not found', async () => {
      // Arrange - findOne returns null so delete returns false
      benchmarkRepo.findOne.mockResolvedValue(null);

      // Act
      const result = await service.delete('non-existent-id', mockUserId, mockRoles);

      // Assert
      expect(result).toBe(false);
    });

    it('should handle delete errors by throwing', async () => {
      // Arrange - findOne is called internally for access check (needs full entity for BenchmarkMapper)
      benchmarkRepo.findOne.mockResolvedValue({
        id: 'benchmark-uuid',
        system_under_test: { id: 'system-uuid', name: 'Test System', organization_id: 'org-1' },
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      } as any);
      benchmarkRepo.delete.mockRejectedValue(new Error('Database delete error'));

      // Act & Assert
      await expect(service.delete('benchmark-uuid', mockUserId, mockRoles)).rejects.toThrow('Database delete error');
    });
  });

  describe('getSystemEnvironmentsAndWorkloads', () => {
    it('should return unique environments and workloads', async () => {
      // Arrange
      const benchmarks = [
        { test_environment: 'production', workload: 'load-test' },
        { test_environment: 'production', workload: 'stress-test' },
        { test_environment: 'staging', workload: 'load-test' },
      ];
      benchmarkQueryBuilder.getMany.mockResolvedValue(benchmarks as BenchmarkEntity[]);

      // Act
      const result = await service.getSystemEnvironmentsAndWorkloads('system-uuid', mockUserId, mockRoles);

      // Assert
      expect(result.environments).toEqual(['production', 'staging']);
      expect(result.workloads).toEqual(['load-test', 'stress-test']);
      expect(benchmarkRepo.createQueryBuilder).toHaveBeenCalledWith('b');
    });

    it('should return empty arrays when no benchmarks found', async () => {
      // Arrange
      benchmarkQueryBuilder.getMany.mockResolvedValue([]);

      // Act
      const result = await service.getSystemEnvironmentsAndWorkloads('system-uuid', mockUserId, mockRoles);

      // Assert
      expect(result.environments).toEqual([]);
      expect(result.workloads).toEqual([]);
    });

    it('should handle duplicate environments and workloads', async () => {
      // Arrange
      const benchmarks = [
        { test_environment: 'production', workload: 'load-test' },
        { test_environment: 'production', workload: 'load-test' },
        { test_environment: 'production', workload: 'load-test' },
      ];
      benchmarkQueryBuilder.getMany.mockResolvedValue(benchmarks as BenchmarkEntity[]);

      // Act
      const result = await service.getSystemEnvironmentsAndWorkloads('system-uuid', mockUserId, mockRoles);

      // Assert
      expect(result.environments).toEqual(['production']);
      expect(result.workloads).toEqual(['load-test']);
    });

    it('should handle errors by throwing', async () => {
      // Arrange
      benchmarkQueryBuilder.getMany.mockRejectedValue(new Error('Database query error'));

      // Act & Assert
      await expect(service.getSystemEnvironmentsAndWorkloads('system-uuid', mockUserId, mockRoles)).rejects.toThrow('Database query error');
    });
  });

  describe('syncTagsWithApplicationDashboards', () => {
    it('should call stored procedure to sync tags', async () => {
      // Arrange
      dataSource.query.mockResolvedValue([]);

      // Act
      await service.syncTagsWithApplicationDashboards(mockUserId, mockRoles);

      // Assert
      expect(dataSource.query).toHaveBeenCalledWith(
        'SELECT sync_benchmark_tags_with_application_dashboards()'
      );
    });

    it('should throw error when sync fails', async () => {
      // Arrange
      dataSource.query.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(service.syncTagsWithApplicationDashboards(mockUserId, mockRoles)).rejects.toThrow('Database error');
    });
  });

  describe('getBenchmarkTagSyncStatus', () => {
    it('should return tag sync status', async () => {
      // Arrange
      const syncStatus = [
        {
          benchmark_id: 'benchmark-uuid',
          system_name: 'Test System',
          dashboard_label: 'Test Dashboard',
          config_title: 'Response Time Benchmark',
          benchmark_tags: ['performance'],
          dashboard_tags: ['performance', 'latency'],
          tags_match: false,
        },
      ];
      dataSource.query.mockResolvedValue(syncStatus);

      // Act
      const result = await service.getBenchmarkTagSyncStatus(mockUserId, mockRoles);

      // Assert
      expect(result).toEqual(syncStatus);
      expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('FROM benchmark_tag_sync_status'));
    });

    it('should throw error when query fails', async () => {
      // Arrange
      dataSource.query.mockRejectedValue(new Error('Query error'));

      // Act & Assert
      await expect(service.getBenchmarkTagSyncStatus(mockUserId, mockRoles)).rejects.toThrow('Query error');
    });
  });
});
