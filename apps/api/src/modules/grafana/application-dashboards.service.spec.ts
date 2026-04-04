import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';
import { ApplicationDashboardsService } from './application-dashboards.service';
import { ApplicationDashboard as ApplicationDashboardEntity } from '../../entities';
import { CreateApplicationDashboardDto, UpdateApplicationDashboardDto } from './dto/application-dashboard.dto';
import { GrafanaClientService } from './grafana-client.service';
import { createAuthorizationServiceMock } from '../../../test/mocks/authorization-service.mock';
import { AuthorizationService } from '../../common/services/authorization.service';

describe('ApplicationDashboardsService', () => {
  let service: ApplicationDashboardsService;
  let appDashboardRepo: jest.Mocked<Repository<ApplicationDashboardEntity>>;

  const mockUserId = 'test-user-id';
  const mockRoles = ['user'];

  const mockDate = new Date('2024-01-15T10:00:00.000Z');

  const mockGrafanaInstance = {
    id: 'grafana-instance-uuid',
    label: 'Production Grafana',
    client_url: 'https://grafana.example.com',
    server_url: 'https://grafana-internal.example.com',
  };

  const mockSystemUnderTest = {
    id: 'system-uuid',
    name: 'Test System',
  };

  const mockGrafanaDashboard = {
    id: 'grafana-dashboard-uuid',
    grafanaJson: {
      dashboard: {
        templating: {
          list: [
            {
              name: 'system_under_test',
              type: 'query',
              query: 'SHOW TAG VALUES',
              includeAll: false,
              multi: false,
            },
            {
              name: 'workload',
              type: 'query',
              query: 'SHOW TAG VALUES',
              includeAll: true,
              multi: true,
              allValue: '.*',
            }
          ]
        }
      }
    }
  };

  const mockApplicationDashboardEntity: ApplicationDashboardEntity = {
    id: 'app-dashboard-uuid',
    systemUnderTestId: 'system-uuid',
    testEnvironment: 'production',
    grafanaInstanceId: 'grafana-instance-uuid',
    grafanaDashboardId: 'grafana-dashboard-uuid',
    dashboardName: 'JVM Memory Usage',
    dashboardId: 123,
    dashboardUid: 'jvm-memory-uid',
    dashboardLabel: 'JVM Memory - Production',
    tags: ['performance', 'jvm', 'memory'],
    templateDashboardUid: 'template-uid',
    variables: [
      { name: 'system_under_test', values: ['test-app'] },
      { name: 'workload', values: ['load-test'] }
    ],
    replacedTemplatingVariables: [
      { name: 'datasource', value: ['Prometheus'] }
    ],
    snapshotTimeout: 10,
    createdAt: mockDate,
    updatedAt: mockDate,
    grafanaInstance: mockGrafanaInstance as any,
    systemUnderTest: mockSystemUnderTest as any,
    grafanaDashboard: mockGrafanaDashboard as any,
  };

  // Helper to create a mock findAll query builder with all required methods
  const createMockFindAllQueryBuilder = (returnData: any[] = []) => ({
    createQueryBuilder: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getSql: jest.fn().mockReturnValue('SELECT ...'),
    getParameters: jest.fn().mockReturnValue({}),
    getMany: jest.fn().mockResolvedValue(returnData),
  });

  // Helper to create a mock findOne query builder with all required methods
  const createMockFindOneQueryBuilder = (returnData: any = null) => ({
    createQueryBuilder: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(returnData),
  });

  beforeEach(async () => {
    const mockAppDashboardRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
      manager: {
        createQueryBuilder: jest.fn(),
      },
    };

    const mockDataSource = {
      createQueryRunner: jest.fn(),
      manager: {
        createQueryBuilder: jest.fn(),
      },
      transaction: jest.fn().mockImplementation(async (callback: (em: any) => Promise<any>) => {
        const mockEntityManager = {
          createQueryBuilder: jest.fn().mockReturnValue({
            delete: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            execute: jest.fn().mockResolvedValue({ affected: 0 }),
          }),
          delete: jest.fn().mockResolvedValue({ affected: 1 }),
          update: jest.fn().mockResolvedValue({ affected: 1 }),
        };
        return callback(mockEntityManager);
      }),
    };

    const mockGrafanaClientService = {
      getDashboard: jest.fn(),
      createSnapshot: jest.fn(),
      updateDashboard: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApplicationDashboardsService,
        {
          provide: getRepositoryToken(ApplicationDashboardEntity),
          useValue: mockAppDashboardRepo,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: GrafanaClientService,
          useValue: mockGrafanaClientService,
        },
        {
          provide: AuthorizationService,
          useValue: createAuthorizationServiceMock(),
        },
      ],
    }).compile();

    service = module.get<ApplicationDashboardsService>(ApplicationDashboardsService);
    appDashboardRepo = module.get(getRepositoryToken(ApplicationDashboardEntity));

    // Suppress logger output in tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all application dashboards without filters', async () => {
      // Arrange
      const mockQueryBuilder = createMockFindAllQueryBuilder([mockApplicationDashboardEntity]);

      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      const result = await service.findAll(mockUserId, mockRoles, {});

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'app-dashboard-uuid',
        system_under_test_id: 'system-uuid',
        test_environment: 'production',
        grafana_instance_id: 'grafana-instance-uuid',
        dashboard_name: 'JVM Memory Usage',
        dashboard_uid: 'jvm-memory-uid',
        dashboard_label: 'JVM Memory - Production',
        tags: ['performance', 'jvm', 'memory'],
        snapshot_timeout: 10,
      });
      expect(result[0]?.grafana_instance).toEqual({
        id: 'grafana-instance-uuid',
        label: 'Production Grafana',
        client_url: 'https://grafana.example.com',
        server_url: 'https://grafana-internal.example.com',
      });
      expect(result[0]?.systems_under_test).toEqual({
        id: 'system-uuid',
        name: 'Test System',
      });
    });

    it('should handle dashboards without relations', async () => {
      // Arrange
      const dashboardWithoutRelations = {
        ...mockApplicationDashboardEntity,
        grafanaInstance: undefined,
        systemUnderTest: undefined,
      };
      const mockQueryBuilder = createMockFindAllQueryBuilder([dashboardWithoutRelations]);

      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      const result = await service.findAll(mockUserId, mockRoles, {});

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]?.grafana_instance).toBeUndefined();
      expect(result[0]?.systems_under_test).toBeUndefined();
    });

    it('should filter by systemId', async () => {
      // Arrange
      const mockQueryBuilder = createMockFindAllQueryBuilder([mockApplicationDashboardEntity]);

      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      await service.findAll(mockUserId, mockRoles, { systemId: 'system-uuid' });

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'ad.systemUnderTestId = :systemId',
        { systemId: 'system-uuid' }
      );
    });

    it('should filter by systemUnderTestId', async () => {
      // Arrange
      const mockQueryBuilder = createMockFindAllQueryBuilder([mockApplicationDashboardEntity]);

      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      await service.findAll(mockUserId, mockRoles, { systemUnderTestId: 'system-uuid' });

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'ad.systemUnderTestId = :systemId',
        { systemId: 'system-uuid' }
      );
    });

    it('should filter by environment', async () => {
      // Arrange
      const mockQueryBuilder = createMockFindAllQueryBuilder([mockApplicationDashboardEntity]);

      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      await service.findAll(mockUserId, mockRoles, { environment: 'production' });

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'ad.testEnvironment = :environment',
        { environment: 'production' }
      );
    });

    it('should filter by testEnvironment', async () => {
      // Arrange
      const mockQueryBuilder = createMockFindAllQueryBuilder([mockApplicationDashboardEntity]);

      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      await service.findAll(mockUserId, mockRoles, { testEnvironment: 'staging' });

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'ad.testEnvironment = :environment',
        { environment: 'staging' }
      );
    });

    it('should filter by grafanaInstanceId', async () => {
      // Arrange
      const mockQueryBuilder = createMockFindAllQueryBuilder([mockApplicationDashboardEntity]);

      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      await service.findAll(mockUserId, mockRoles, { grafanaInstanceId: 'grafana-instance-uuid' });

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'ad.grafanaInstanceId = :grafanaInstanceId',
        { grafanaInstanceId: 'grafana-instance-uuid' }
      );
    });

    it('should filter by dashboardLabel with ILIKE', async () => {
      // Arrange
      const mockQueryBuilder = createMockFindAllQueryBuilder([mockApplicationDashboardEntity]);

      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      await service.findAll(mockUserId, mockRoles, { dashboardLabel: 'JVM' });

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'ad.dashboardLabel ILIKE :dashboardLabel',
        { dashboardLabel: '%JVM%' }
      );
    });

    it('should filter by dashboardUid', async () => {
      // Arrange
      const mockQueryBuilder = createMockFindAllQueryBuilder([mockApplicationDashboardEntity]);

      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      await service.findAll(mockUserId, mockRoles, { dashboardUid: 'jvm-memory-uid' });

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'ad.dashboardUid = :dashboardUid',
        { dashboardUid: 'jvm-memory-uid' }
      );
    });

    it('should filter by tags using array overlap operator', async () => {
      // Arrange
      const mockQueryBuilder = createMockFindAllQueryBuilder([mockApplicationDashboardEntity]);

      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      await service.findAll(mockUserId, mockRoles, { tags: ['performance', 'jvm'] });

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'ad.tags && :tags',
        { tags: ['performance', 'jvm'] }
      );
    });

    it('should not filter by tags when empty array provided', async () => {
      // Arrange
      const mockQueryBuilder = createMockFindAllQueryBuilder([mockApplicationDashboardEntity]);

      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      await service.findAll(mockUserId, mockRoles, { tags: [] });

      // Assert
      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('tags'),
        expect.anything()
      );
    });

    it('should apply multiple filters simultaneously', async () => {
      // Arrange
      const mockQueryBuilder = createMockFindAllQueryBuilder([mockApplicationDashboardEntity]);

      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      await service.findAll(mockUserId, mockRoles, {
        systemUnderTestId: 'system-uuid',
        testEnvironment: 'production',
        grafanaInstanceId: 'grafana-instance-uuid',
        dashboardLabel: 'JVM',
        tags: ['performance']
      });

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(5);
    });

    it('should order results by dashboard name and label', async () => {
      // Arrange
      const mockQueryBuilder = createMockFindAllQueryBuilder([mockApplicationDashboardEntity]);

      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      await service.findAll(mockUserId, mockRoles, {});

      // Assert
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('ad.dashboardName', 'ASC');
      expect(mockQueryBuilder.addOrderBy).toHaveBeenCalledWith('ad.dashboardLabel', 'ASC');
    });

    it('should return empty array when no dashboards found', async () => {
      // Arrange
      const mockQueryBuilder = createMockFindAllQueryBuilder([]);

      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      const result = await service.findAll(mockUserId, mockRoles, {});

      // Assert
      expect(result).toEqual([]);
    });

    it('should handle database errors by throwing', async () => {
      // Arrange
      const mockQueryBuilder = {
        ...createMockFindAllQueryBuilder([]),
        getMany: jest.fn().mockRejectedValue(new Error('Database connection error')),
      };

      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act & Assert
      await expect(service.findAll(mockUserId, mockRoles, {})).rejects.toThrow('Database connection error');
    });

    it('should correctly map JSONB fields (variables and replacedTemplatingVariables)', async () => {
      // Arrange
      const mockQueryBuilder = createMockFindAllQueryBuilder([mockApplicationDashboardEntity]);

      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      const result = await service.findAll(mockUserId, mockRoles, {});

      // Assert - variables are enriched with template metadata from grafana dashboard
      expect(result[0]?.variables).toEqual([
        {
          name: 'system_under_test',
          values: ['test-app'],
          type: 'query',
          query: 'SHOW TAG VALUES',
          includeAll: false,
          multi: false,
          allValue: undefined,
        },
        {
          name: 'workload',
          values: ['load-test'],
          type: 'query',
          query: 'SHOW TAG VALUES',
          includeAll: true,
          multi: true,
          allValue: '.*',
        }
      ]);
      expect(result[0]?.replaced_templating_variables).toEqual([
        { name: 'datasource', value: ['Prometheus'] }
      ]);
    });
  });

  describe('findOne', () => {
    it('should return application dashboard by ID', async () => {
      // Arrange
      const mockQb = createMockFindOneQueryBuilder(mockApplicationDashboardEntity);
      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQb as any);

      // Act
      const result = await service.findOne('app-dashboard-uuid', mockUserId, mockRoles);

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBe('app-dashboard-uuid');
      expect(result.dashboard_label).toBe('JVM Memory - Production');
      expect(appDashboardRepo.createQueryBuilder).toHaveBeenCalledWith('ad');
      expect(mockQb.where).toHaveBeenCalledWith('ad.id = :id', { id: 'app-dashboard-uuid' });
    });

    it('should include grafana instance relation', async () => {
      // Arrange
      appDashboardRepo.createQueryBuilder.mockReturnValue(
        createMockFindOneQueryBuilder(mockApplicationDashboardEntity) as any
      );

      // Act
      const result = await service.findOne('app-dashboard-uuid', mockUserId, mockRoles);

      // Assert
      expect(result.grafana_instance).toEqual({
        id: 'grafana-instance-uuid',
        label: 'Production Grafana',
        client_url: 'https://grafana.example.com',
        server_url: 'https://grafana-internal.example.com',
      });
    });

    it('should include system under test relation', async () => {
      // Arrange
      appDashboardRepo.createQueryBuilder.mockReturnValue(
        createMockFindOneQueryBuilder(mockApplicationDashboardEntity) as any
      );

      // Act
      const result = await service.findOne('app-dashboard-uuid', mockUserId, mockRoles);

      // Assert
      expect(result.systems_under_test).toEqual({
        id: 'system-uuid',
        name: 'Test System',
      });
    });

    it('should throw error when dashboard not found', async () => {
      // Arrange
      appDashboardRepo.createQueryBuilder.mockReturnValue(
        createMockFindOneQueryBuilder(null) as any
      );

      // Act & Assert
      await expect(service.findOne('non-existent-id', mockUserId, mockRoles)).rejects.toThrow(
        'Application dashboard with ID non-existent-id not found'
      );
    });

    it('should handle database errors by throwing', async () => {
      // Arrange
      const mockQb = {
        ...createMockFindOneQueryBuilder(null),
        getOne: jest.fn().mockRejectedValue(new Error('Database error')),
      };
      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQb as any);

      // Act & Assert
      await expect(service.findOne('app-dashboard-uuid', mockUserId, mockRoles)).rejects.toThrow('Database error');
    });

    it('should correctly map all entity fields to response', async () => {
      // Arrange
      appDashboardRepo.createQueryBuilder.mockReturnValue(
        createMockFindOneQueryBuilder(mockApplicationDashboardEntity) as any
      );

      // Act
      const result = await service.findOne('app-dashboard-uuid', mockUserId, mockRoles);

      // Assert
      expect(result).toMatchObject({
        id: 'app-dashboard-uuid',
        system_under_test_id: 'system-uuid',
        test_environment: 'production',
        grafana_instance_id: 'grafana-instance-uuid',
        grafana_dashboard_id: 'grafana-dashboard-uuid',
        dashboard_name: 'JVM Memory Usage',
        dashboard_id: 123,
        dashboard_uid: 'jvm-memory-uid',
        dashboard_label: 'JVM Memory - Production',
        tags: ['performance', 'jvm', 'memory'],
        template_dashboard_uid: 'template-uid',
        snapshot_timeout: 10,
        created_at: '2024-01-15T10:00:00.000Z',
        updated_at: '2024-01-15T10:00:00.000Z',
      });
    });
  });

  describe('create', () => {
    const createDto: CreateApplicationDashboardDto = {
      systemUnderTestId: 'system-uuid',
      testEnvironment: 'production',
      grafanaInstanceId: 'grafana-instance-uuid',
      grafanaDashboardId: 'grafana-dashboard-uuid',
      dashboardName: 'JVM Memory Usage',
      dashboardId: 123,
      dashboardUid: 'jvm-memory-uid',
      dashboardLabel: 'JVM Memory - Production',
      tags: ['performance', 'jvm'],
      templateDashboardUid: 'template-uid',
      variables: [{ name: 'system_under_test', values: ['test-app'] }],
      replacedTemplatingVariables: [{ name: 'datasource', value: ['Prometheus'] }],
      snapshotTimeout: 10,
    };

    it('should create application dashboard with all fields', async () => {
      // Arrange
      appDashboardRepo.create.mockReturnValue(mockApplicationDashboardEntity);
      appDashboardRepo.save.mockResolvedValue(mockApplicationDashboardEntity);
      appDashboardRepo.findOne.mockResolvedValue(mockApplicationDashboardEntity);

      // Act
      const result = await service.create(createDto, mockUserId, mockRoles);

      // Assert
      expect(appDashboardRepo.create).toHaveBeenCalledWith({
        systemUnderTestId: 'system-uuid',
        testEnvironment: 'production',
        grafanaInstanceId: 'grafana-instance-uuid',
        grafanaDashboardId: 'grafana-dashboard-uuid',
        dashboardName: 'JVM Memory Usage',
        dashboardId: 123,
        dashboardUid: 'jvm-memory-uid',
        dashboardLabel: 'JVM Memory - Production',
        tags: ['performance', 'jvm'],
        templateDashboardUid: 'template-uid',
        variables: [{ name: 'system_under_test', values: ['test-app'] }],
        replacedTemplatingVariables: [{ name: 'datasource', value: ['Prometheus'] }],
        snapshotTimeout: 10,
      });
      expect(result.id).toBe('app-dashboard-uuid');
    });

    it('should use default empty array for tags when not provided', async () => {
      // Arrange
      const dtoWithoutTags = { ...createDto };
      delete dtoWithoutTags.tags;

      appDashboardRepo.create.mockReturnValue(mockApplicationDashboardEntity);
      appDashboardRepo.save.mockResolvedValue(mockApplicationDashboardEntity);
      appDashboardRepo.findOne.mockResolvedValue(mockApplicationDashboardEntity);

      // Act
      await service.create(dtoWithoutTags, mockUserId, mockRoles);

      // Assert
      expect(appDashboardRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: [],
        })
      );
    });

    it('should use default empty array for variables when not provided', async () => {
      // Arrange
      const dtoWithoutVariables = { ...createDto };
      delete dtoWithoutVariables.variables;

      appDashboardRepo.create.mockReturnValue(mockApplicationDashboardEntity);
      appDashboardRepo.save.mockResolvedValue(mockApplicationDashboardEntity);
      appDashboardRepo.findOne.mockResolvedValue(mockApplicationDashboardEntity);

      // Act
      await service.create(dtoWithoutVariables, mockUserId, mockRoles);

      // Assert
      expect(appDashboardRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: [],
        })
      );
    });

    it('should use default empty array for replacedTemplatingVariables when not provided', async () => {
      // Arrange
      const dtoWithoutReplacedVars = { ...createDto };
      delete dtoWithoutReplacedVars.replacedTemplatingVariables;

      appDashboardRepo.create.mockReturnValue(mockApplicationDashboardEntity);
      appDashboardRepo.save.mockResolvedValue(mockApplicationDashboardEntity);
      appDashboardRepo.findOne.mockResolvedValue(mockApplicationDashboardEntity);

      // Act
      await service.create(dtoWithoutReplacedVars, mockUserId, mockRoles);

      // Assert
      expect(appDashboardRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          replacedTemplatingVariables: [],
        })
      );
    });

    it('should use default snapshot timeout of 4 when not provided', async () => {
      // Arrange
      const dtoWithoutTimeout = { ...createDto };
      delete dtoWithoutTimeout.snapshotTimeout;

      appDashboardRepo.create.mockReturnValue(mockApplicationDashboardEntity);
      appDashboardRepo.save.mockResolvedValue(mockApplicationDashboardEntity);
      appDashboardRepo.findOne.mockResolvedValue(mockApplicationDashboardEntity);

      // Act
      await service.create(dtoWithoutTimeout, mockUserId, mockRoles);

      // Assert
      expect(appDashboardRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          snapshotTimeout: 4,
        })
      );
    });

    it('should fetch created dashboard with relations', async () => {
      // Arrange
      appDashboardRepo.create.mockReturnValue(mockApplicationDashboardEntity);
      appDashboardRepo.save.mockResolvedValue(mockApplicationDashboardEntity);
      appDashboardRepo.findOne.mockResolvedValue(mockApplicationDashboardEntity);

      // Act
      await service.create(createDto, mockUserId, mockRoles);

      // Assert
      expect(appDashboardRepo.findOne).toHaveBeenCalledWith({
        where: { id: mockApplicationDashboardEntity.id },
        relations: ['grafanaInstance', 'systemUnderTest']
      });
    });

    it('should throw error when failed to fetch created dashboard', async () => {
      // Arrange
      appDashboardRepo.create.mockReturnValue(mockApplicationDashboardEntity);
      appDashboardRepo.save.mockResolvedValue(mockApplicationDashboardEntity);
      appDashboardRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.create(createDto, mockUserId, mockRoles)).rejects.toThrow(
        'Failed to fetch created application dashboard'
      );
    });

    it('should handle save errors by throwing', async () => {
      // Arrange
      appDashboardRepo.create.mockReturnValue(mockApplicationDashboardEntity);
      appDashboardRepo.save.mockRejectedValue(new Error('Database constraint violation'));

      // Act & Assert
      await expect(service.create(createDto, mockUserId, mockRoles)).rejects.toThrow('Database constraint violation');
    });

    it('should return complete dashboard with all relations', async () => {
      // Arrange
      appDashboardRepo.create.mockReturnValue(mockApplicationDashboardEntity);
      appDashboardRepo.save.mockResolvedValue(mockApplicationDashboardEntity);
      appDashboardRepo.findOne.mockResolvedValue(mockApplicationDashboardEntity);

      // Act
      const result = await service.create(createDto, mockUserId, mockRoles);

      // Assert
      expect(result).toMatchObject({
        id: 'app-dashboard-uuid',
        system_under_test_id: 'system-uuid',
        grafana_instance_id: 'grafana-instance-uuid',
        dashboard_label: 'JVM Memory - Production',
      });
      expect(result.grafana_instance).toBeDefined();
      expect(result.systems_under_test).toBeDefined();
    });

    it('should handle creation with minimal required fields', async () => {
      // Arrange
      const minimalDto: CreateApplicationDashboardDto = {
        systemUnderTestId: 'system-uuid',
        testEnvironment: 'production',
        grafanaInstanceId: 'grafana-instance-uuid',
        grafanaDashboardId: 'grafana-dashboard-uuid',
        dashboardName: 'Test Dashboard',
        dashboardLabel: 'Test Label',
      };

      const minimalEntity = {
        ...mockApplicationDashboardEntity,
        tags: [],
        variables: [],
        replacedTemplatingVariables: [],
        snapshotTimeout: 4,
      };

      appDashboardRepo.create.mockReturnValue(minimalEntity);
      appDashboardRepo.save.mockResolvedValue(minimalEntity);
      appDashboardRepo.findOne.mockResolvedValue(minimalEntity);

      // Act
      const result = await service.create(minimalDto, mockUserId, mockRoles);

      // Assert
      expect(result).toBeDefined();
      expect(result.tags).toEqual([]);
      expect(result.variables).toEqual([]);
      expect(result.snapshot_timeout).toBe(4);
    });
  });

  describe('update', () => {
    const updateDto: UpdateApplicationDashboardDto = {
      dashboardLabel: 'Updated JVM Memory - Production',
      tags: ['performance', 'jvm', 'updated'],
      snapshotTimeout: 15,
    };

    it('should update application dashboard', async () => {
      // Arrange
      appDashboardRepo.findOne.mockResolvedValueOnce(mockApplicationDashboardEntity); // Existence check
      const updatedEntity = {
        ...mockApplicationDashboardEntity,
        dashboardLabel: 'Updated JVM Memory - Production',
        tags: ['performance', 'jvm', 'updated'],
        snapshotTimeout: 15,
      };
      appDashboardRepo.createQueryBuilder.mockReturnValue(
        createMockFindOneQueryBuilder(updatedEntity) as any
      ); // Internal this.findOne() call

      appDashboardRepo.update.mockResolvedValue({} as any);

      // Act
      const result = await service.update('app-dashboard-uuid', updateDto, mockUserId, mockRoles);

      // Assert
      expect(appDashboardRepo.update).toHaveBeenCalledWith(
        'app-dashboard-uuid',
        expect.objectContaining({
          dashboardLabel: 'Updated JVM Memory - Production',
          tags: ['performance', 'jvm', 'updated'],
          snapshotTimeout: 15,
        })
      );
      expect(result.dashboard_label).toBe('Updated JVM Memory - Production');
    });

    it('should throw error when dashboard not found', async () => {
      // Arrange
      appDashboardRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.update('non-existent-id', updateDto, mockUserId, mockRoles)).rejects.toThrow(
        'Application dashboard with id non-existent-id not found'
      );
    });

    it('should only update provided fields', async () => {
      // Arrange
      const partialUpdate: UpdateApplicationDashboardDto = {
        dashboardLabel: 'New Label Only',
      };

      appDashboardRepo.findOne.mockResolvedValueOnce(mockApplicationDashboardEntity); // Existence check
      appDashboardRepo.createQueryBuilder.mockReturnValue(
        createMockFindOneQueryBuilder({
          ...mockApplicationDashboardEntity,
          dashboardLabel: 'New Label Only',
        }) as any
      );

      appDashboardRepo.update.mockResolvedValue({} as any);

      // Act
      await service.update('app-dashboard-uuid', partialUpdate, mockUserId, mockRoles);

      // Assert
      expect(appDashboardRepo.update).toHaveBeenCalledWith(
        'app-dashboard-uuid',
        expect.objectContaining({
          dashboardLabel: 'New Label Only',
        })
      );
      // Should not include fields that weren't in the update DTO
      const updateCall = (appDashboardRepo.update as jest.Mock).mock.calls[0][1];
      expect(updateCall).not.toHaveProperty('testEnvironment');
      expect(updateCall).not.toHaveProperty('grafanaInstanceId');
    });

    it('should update systemUnderTestId when provided', async () => {
      // Arrange
      const updateWithSystem: UpdateApplicationDashboardDto = {
        systemUnderTestId: 'new-system-uuid',
      };

      appDashboardRepo.findOne.mockResolvedValueOnce(mockApplicationDashboardEntity);
      appDashboardRepo.createQueryBuilder.mockReturnValue(
        createMockFindOneQueryBuilder(mockApplicationDashboardEntity) as any
      );

      appDashboardRepo.update.mockResolvedValue({} as any);

      // Act
      await service.update('app-dashboard-uuid', updateWithSystem, mockUserId, mockRoles);

      // Assert
      expect(appDashboardRepo.update).toHaveBeenCalledWith(
        'app-dashboard-uuid',
        expect.objectContaining({
          systemUnderTestId: 'new-system-uuid',
        })
      );
    });

    it('should update testEnvironment when provided', async () => {
      // Arrange
      const updateWithEnv: UpdateApplicationDashboardDto = {
        testEnvironment: 'staging',
      };

      appDashboardRepo.findOne.mockResolvedValueOnce(mockApplicationDashboardEntity);
      appDashboardRepo.createQueryBuilder.mockReturnValue(
        createMockFindOneQueryBuilder(mockApplicationDashboardEntity) as any
      );

      appDashboardRepo.update.mockResolvedValue({} as any);

      // Act
      await service.update('app-dashboard-uuid', updateWithEnv, mockUserId, mockRoles);

      // Assert
      expect(appDashboardRepo.update).toHaveBeenCalledWith(
        'app-dashboard-uuid',
        expect.objectContaining({
          testEnvironment: 'staging',
        })
      );
    });

    it('should update grafanaInstanceId when provided', async () => {
      // Arrange
      const updateWithInstance: UpdateApplicationDashboardDto = {
        grafanaInstanceId: 'new-grafana-uuid',
      };

      appDashboardRepo.findOne.mockResolvedValueOnce(mockApplicationDashboardEntity);
      appDashboardRepo.createQueryBuilder.mockReturnValue(
        createMockFindOneQueryBuilder(mockApplicationDashboardEntity) as any
      );

      appDashboardRepo.update.mockResolvedValue({} as any);

      // Act
      await service.update('app-dashboard-uuid', updateWithInstance, mockUserId, mockRoles);

      // Assert
      expect(appDashboardRepo.update).toHaveBeenCalledWith(
        'app-dashboard-uuid',
        expect.objectContaining({
          grafanaInstanceId: 'new-grafana-uuid',
        })
      );
    });

    it('should update variables when provided', async () => {
      // Arrange
      const updateWithVariables: UpdateApplicationDashboardDto = {
        variables: [
          { name: 'new_var', values: ['value1', 'value2'] }
        ],
      };

      appDashboardRepo.findOne.mockResolvedValueOnce(mockApplicationDashboardEntity);
      appDashboardRepo.createQueryBuilder.mockReturnValue(
        createMockFindOneQueryBuilder(mockApplicationDashboardEntity) as any
      );

      appDashboardRepo.update.mockResolvedValue({} as any);

      // Act
      await service.update('app-dashboard-uuid', updateWithVariables, mockUserId, mockRoles);

      // Assert
      expect(appDashboardRepo.update).toHaveBeenCalledWith(
        'app-dashboard-uuid',
        expect.objectContaining({
          variables: [{ name: 'new_var', values: ['value1', 'value2'] }],
        })
      );
    });

    it('should update replacedTemplatingVariables when provided', async () => {
      // Arrange
      const updateWithReplacedVars: UpdateApplicationDashboardDto = {
        replacedTemplatingVariables: [
          { name: 'replaced_var', value: ['new_value'] }
        ],
      };

      appDashboardRepo.findOne.mockResolvedValueOnce(mockApplicationDashboardEntity);
      appDashboardRepo.createQueryBuilder.mockReturnValue(
        createMockFindOneQueryBuilder(mockApplicationDashboardEntity) as any
      );

      appDashboardRepo.update.mockResolvedValue({} as any);

      // Act
      await service.update('app-dashboard-uuid', updateWithReplacedVars, mockUserId, mockRoles);

      // Assert
      expect(appDashboardRepo.update).toHaveBeenCalledWith(
        'app-dashboard-uuid',
        expect.objectContaining({
          replacedTemplatingVariables: [{ name: 'replaced_var', value: ['new_value'] }],
        })
      );
    });

    it('should update all optional fields when provided', async () => {
      // Arrange
      const fullUpdate: UpdateApplicationDashboardDto = {
        systemUnderTestId: 'new-system-uuid',
        testEnvironment: 'staging',
        grafanaInstanceId: 'new-grafana-uuid',
        grafanaDashboardId: 'new-dashboard-uuid',
        dashboardName: 'New Dashboard Name',
        dashboardId: 456,
        dashboardUid: 'new-uid',
        dashboardLabel: 'New Label',
        tags: ['new-tag'],
        templateDashboardUid: 'new-template-uid',
        variables: [{ name: 'var1', values: ['val1'] }],
        replacedTemplatingVariables: [{ name: 'rvar1', value: ['rval1'] }],
        snapshotTimeout: 20,
      };

      appDashboardRepo.findOne.mockResolvedValueOnce(mockApplicationDashboardEntity);
      appDashboardRepo.createQueryBuilder.mockReturnValue(
        createMockFindOneQueryBuilder(mockApplicationDashboardEntity) as any
      );

      appDashboardRepo.update.mockResolvedValue({} as any);

      // Act
      await service.update('app-dashboard-uuid', fullUpdate, mockUserId, mockRoles);

      // Assert
      expect(appDashboardRepo.update).toHaveBeenCalledWith(
        'app-dashboard-uuid',
        expect.objectContaining({
          systemUnderTestId: 'new-system-uuid',
          testEnvironment: 'staging',
          grafanaInstanceId: 'new-grafana-uuid',
          grafanaDashboardId: 'new-dashboard-uuid',
          dashboardName: 'New Dashboard Name',
          dashboardId: 456,
          dashboardUid: 'new-uid',
          dashboardLabel: 'New Label',
          tags: ['new-tag'],
          templateDashboardUid: 'new-template-uid',
          variables: [{ name: 'var1', values: ['val1'] }],
          replacedTemplatingVariables: [{ name: 'rvar1', value: ['rval1'] }],
          snapshotTimeout: 20,
        })
      );
    });

    it('should handle update errors by throwing', async () => {
      // Arrange
      appDashboardRepo.findOne.mockResolvedValue(mockApplicationDashboardEntity);
      appDashboardRepo.update.mockRejectedValue(new Error('Database update error'));

      // Act & Assert
      await expect(service.update('app-dashboard-uuid', updateDto, mockUserId, mockRoles)).rejects.toThrow(
        'Database update error'
      );
    });

    it('should call findOne after update to return updated entity', async () => {
      // Arrange
      appDashboardRepo.findOne.mockResolvedValueOnce(mockApplicationDashboardEntity); // Existence check
      appDashboardRepo.createQueryBuilder.mockReturnValue(
        createMockFindOneQueryBuilder(mockApplicationDashboardEntity) as any
      ); // Internal this.findOne() call

      appDashboardRepo.update.mockResolvedValue({} as any);

      // Act
      await service.update('app-dashboard-uuid', updateDto, mockUserId, mockRoles);

      // Assert
      expect(appDashboardRepo.findOne).toHaveBeenCalledTimes(1); // Once for existence check
      expect(appDashboardRepo.createQueryBuilder).toHaveBeenCalledWith('ad'); // findOne uses query builder
    });
  });

  describe('delete', () => {
    it('should delete application dashboard and cascade delete related benchmarks', async () => {
      // Arrange
      appDashboardRepo.findOne.mockResolvedValue(mockApplicationDashboardEntity);

      // The delete method uses dataSource.transaction internally
      // The default mock transaction already handles cascade delete of benchmarks
      // and deletion of the application dashboard

      // Act
      const result = await service.delete('app-dashboard-uuid', false, mockUserId, mockRoles);

      // Assert
      expect(appDashboardRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'app-dashboard-uuid' },
        relations: ['grafanaDashboard', 'grafanaInstance', 'systemUnderTest'],
      });
      // Delete should complete successfully via the transaction
      expect(result).toBeDefined();
    });

    it('should throw error when dashboard not found', async () => {
      // Arrange
      appDashboardRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.delete('non-existent-id', false, mockUserId, mockRoles)).rejects.toThrow(
        'Application dashboard with id non-existent-id not found'
      );
    });

    it('should handle case when no benchmarks are deleted', async () => {
      // Arrange
      appDashboardRepo.findOne.mockResolvedValue(mockApplicationDashboardEntity);

      // Act - delete uses transaction internally
      const result = await service.delete('app-dashboard-uuid', false, mockUserId, mockRoles);

      // Assert - verify findOne was called to check dashboard exists
      expect(appDashboardRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'app-dashboard-uuid' },
        relations: ['grafanaDashboard', 'grafanaInstance', 'systemUnderTest'],
      });
      // Delete should complete successfully via the transaction
      expect(result).toBeDefined();
    });

    it('should handle benchmark cascade delete errors gracefully', async () => {
      // Arrange
      appDashboardRepo.findOne.mockResolvedValue(mockApplicationDashboardEntity);

      // Mock transaction to throw an error during cascade delete
      const mockDataSource = service['dataSource'] as any;
      mockDataSource.transaction.mockImplementationOnce(async (callback: any) => {
        const mockEntityManager = {
          createQueryBuilder: jest.fn().mockReturnValue({
            delete: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            execute: jest.fn().mockRejectedValue(new Error('Cascade delete error')),
          }),
        };
        return callback(mockEntityManager);
      });

      // Act & Assert
      await expect(service.delete('app-dashboard-uuid', false, mockUserId, mockRoles)).rejects.toThrow('Cascade delete error');
    });

    it('should handle delete errors by throwing', async () => {
      // Arrange
      appDashboardRepo.findOne.mockResolvedValue(mockApplicationDashboardEntity);

      // Mock transaction to throw an error during delete
      const mockDataSource = service['dataSource'] as any;
      mockDataSource.transaction.mockImplementationOnce(async (callback: any) => {
        const mockEntityManager = {
          createQueryBuilder: jest.fn().mockReturnValue({
            delete: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            execute: jest.fn().mockResolvedValue({ affected: 0 }),
          }),
          delete: jest.fn().mockRejectedValue(new Error('Database delete error')),
        };
        return callback(mockEntityManager);
      });

      // Act & Assert
      await expect(service.delete('app-dashboard-uuid', false, mockUserId, mockRoles)).rejects.toThrow('Database delete error');
    });

    it('should verify dashboard exists before attempting deletion', async () => {
      // Arrange
      appDashboardRepo.findOne.mockResolvedValue(mockApplicationDashboardEntity);

      // Act - delete uses transaction internally
      await service.delete('app-dashboard-uuid', false, mockUserId, mockRoles);

      // Assert - verify findOne was called with relations to check dashboard exists
      expect(appDashboardRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'app-dashboard-uuid' },
        relations: ['grafanaDashboard', 'grafanaInstance', 'systemUnderTest'],
      });
    });

    it('should handle deletion with null benchmark affected count', async () => {
      // Arrange
      appDashboardRepo.findOne.mockResolvedValue(mockApplicationDashboardEntity);

      // Mock transaction with null affected count
      const mockDataSource = service['dataSource'] as any;
      mockDataSource.transaction.mockImplementationOnce(async (callback: any) => {
        const mockEntityManager = {
          createQueryBuilder: jest.fn().mockReturnValue({
            delete: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            execute: jest.fn().mockResolvedValue({ affected: null }),
          }),
          delete: jest.fn().mockResolvedValue({ affected: 1 }),
          update: jest.fn().mockResolvedValue({ affected: 1 }),
        };
        return callback(mockEntityManager);
      });

      // Act - should complete without errors
      const result = await service.delete('app-dashboard-uuid', false, mockUserId, mockRoles);

      // Assert - delete should succeed even with null affected count for benchmarks
      expect(appDashboardRepo.findOne).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle both systemId and systemUnderTestId when both provided (systemId takes precedence)', async () => {
      // Arrange
      const mockQueryBuilder = createMockFindAllQueryBuilder([mockApplicationDashboardEntity]);

      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      await service.findAll(mockUserId, mockRoles, { systemId: 'system-1', systemUnderTestId: 'system-2' });

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'ad.systemUnderTestId = :systemId',
        { systemId: 'system-1' } // systemId takes precedence
      );
    });

    it('should handle both environment and testEnvironment when both provided (environment takes precedence)', async () => {
      // Arrange
      const mockQueryBuilder = createMockFindAllQueryBuilder([mockApplicationDashboardEntity]);

      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      await service.findAll(mockUserId, mockRoles, { environment: 'prod', testEnvironment: 'staging' });

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'ad.testEnvironment = :environment',
        { environment: 'prod' } // environment takes precedence
      );
    });

    it('should handle null tags gracefully in findAll', async () => {
      // Arrange
      const entityWithNullTags = {
        ...mockApplicationDashboardEntity,
        tags: null,
      };
      const mockQueryBuilder = createMockFindAllQueryBuilder([entityWithNullTags]);

      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      const result = await service.findAll(mockUserId, mockRoles, {});

      // Assert
      expect(result[0]?.tags).toBeNull();
    });

    it('should handle null variables gracefully in findOne', async () => {
      // Arrange
      const entityWithNullVariables = {
        ...mockApplicationDashboardEntity,
        variables: null,
      };
      appDashboardRepo.createQueryBuilder.mockReturnValue(
        createMockFindOneQueryBuilder(entityWithNullVariables) as any
      );

      // Act
      const result = await service.findOne('app-dashboard-uuid', mockUserId, mockRoles);

      // Assert
      expect(result.variables).toEqual([]);
    });

    it('should handle null replacedTemplatingVariables in create', async () => {
      // Arrange
      const createDto: CreateApplicationDashboardDto = {
        systemUnderTestId: 'system-uuid',
        testEnvironment: 'production',
        grafanaInstanceId: 'grafana-instance-uuid',
        grafanaDashboardId: 'grafana-dashboard-uuid',
        dashboardName: 'Test',
        dashboardLabel: 'Test Label',
        replacedTemplatingVariables: undefined,
      };

      appDashboardRepo.create.mockReturnValue(mockApplicationDashboardEntity);
      appDashboardRepo.save.mockResolvedValue(mockApplicationDashboardEntity);
      appDashboardRepo.findOne.mockResolvedValue(mockApplicationDashboardEntity);

      // Act
      await service.create(createDto, mockUserId, mockRoles);

      // Assert
      expect(appDashboardRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          replacedTemplatingVariables: [],
        })
      );
    });

    it('should not filter when empty string dashboard label is provided', async () => {
      // Arrange
      const mockQueryBuilder = createMockFindAllQueryBuilder([]);

      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      await service.findAll(mockUserId, mockRoles, { dashboardLabel: '' });

      // Assert
      // Empty string is falsy, so the filter should not be applied
      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalledWith(
        'ad.dashboardLabel ILIKE :dashboardLabel',
        expect.anything()
      );
    });

    it('should properly convert Date fields to ISO strings', async () => {
      // Arrange
      appDashboardRepo.createQueryBuilder.mockReturnValue(
        createMockFindOneQueryBuilder(mockApplicationDashboardEntity) as any
      );

      // Act
      const result = await service.findOne('app-dashboard-uuid', mockUserId, mockRoles);

      // Assert
      expect(result.created_at).toBe('2024-01-15T10:00:00.000Z');
      expect(result.updated_at).toBe('2024-01-15T10:00:00.000Z');
      expect(typeof result.created_at).toBe('string');
      expect(typeof result.updated_at).toBe('string');
    });

    it('should enrich variables with template metadata from grafanaDashboard', async () => {
      // Arrange
      const mockQueryBuilder = createMockFindAllQueryBuilder([mockApplicationDashboardEntity]);

      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      const result = await service.findAll(mockUserId, mockRoles, {});

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].variables).toHaveLength(2);

      // Check that system_under_test variable has enriched metadata
      const systemVar = result[0].variables.find((v: any) => v.name === 'system_under_test');
      expect(systemVar).toBeDefined();
      expect(systemVar.includeAll).toBe(false);
      expect(systemVar.multi).toBe(false);
      expect(systemVar.type).toBe('query');

      // Check that workload variable has enriched metadata
      const workloadVar = result[0].variables.find((v: any) => v.name === 'workload');
      expect(workloadVar).toBeDefined();
      expect(workloadVar.includeAll).toBe(true);
      expect(workloadVar.multi).toBe(true);
      expect(workloadVar.allValue).toBe('.*');
    });

    it('should handle missing grafanaDashboard relation gracefully', async () => {
      // Arrange
      const entityWithoutDashboard = {
        ...mockApplicationDashboardEntity,
        grafanaDashboard: undefined,
      };

      const mockQueryBuilder = createMockFindAllQueryBuilder([entityWithoutDashboard]);

      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      const result = await service.findAll(mockUserId, mockRoles, {});

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].variables).toHaveLength(2);
      // Variables should still be present, just not enriched
      expect(result[0].variables[0]).toEqual({ name: 'system_under_test', values: ['test-app'] });
    });

    it('should join with grafanaDashboard relation', async () => {
      // Arrange
      const mockQueryBuilder = createMockFindAllQueryBuilder([mockApplicationDashboardEntity]);

      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      await service.findAll(mockUserId, mockRoles, {});

      // Assert
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('ad.grafanaInstance', 'gi');
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('ad.systemUnderTest', 'sut');
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('ad.grafanaDashboard', 'gd');
    });
  });

  describe('Authorization filtering', () => {
    it('should apply no org filter when user is global admin', async () => {
      // Arrange
      const authzService = service['authzService'] as ReturnType<typeof createAuthorizationServiceMock>;
      authzService.isGlobalAdmin.mockReturnValue(true);

      const mockQueryBuilder = createMockFindAllQueryBuilder([mockApplicationDashboardEntity]);
      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      await service.findAll(mockUserId, ['perfana-admin'], {});

      // Assert
      expect(authzService.getAccessibleOrganizations).not.toHaveBeenCalled();
      // andWhere should not have been called with org-related conditions
      const andWhereCalls = (mockQueryBuilder.andWhere as jest.Mock).mock.calls.map((c: unknown[]) => c[0]);
      expect(andWhereCalls.some((c: unknown) => typeof c === 'string' && c.includes('organizationId'))).toBe(false);
    });

    it('should filter to NULL org only when non-admin has no accessible organizations', async () => {
      // Arrange
      const authzService = service['authzService'] as ReturnType<typeof createAuthorizationServiceMock>;
      authzService.isGlobalAdmin.mockReturnValue(false);
      authzService.getAccessibleOrganizations.mockResolvedValue([]);

      const mockQueryBuilder = createMockFindAllQueryBuilder([]);
      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      await service.findAll(mockUserId, ['user'], {});

      // Assert
      expect(authzService.getAccessibleOrganizations).toHaveBeenCalledWith(mockUserId);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('ad.organizationId IS NULL');
    });

    it('should filter to org IDs or NULL when non-admin has accessible organizations', async () => {
      // Arrange
      const authzService = service['authzService'] as ReturnType<typeof createAuthorizationServiceMock>;
      authzService.isGlobalAdmin.mockReturnValue(false);
      authzService.getAccessibleOrganizations.mockResolvedValue(['org-1', 'org-2']);

      const mockQueryBuilder = createMockFindAllQueryBuilder([]);
      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      await service.findAll(mockUserId, ['user'], {});

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(ad.organizationId IN (:...orgIds) OR ad.organizationId IS NULL)',
        { orgIds: ['org-1', 'org-2'] }
      );
    });

    it('should apply NULL org filter in findOne for non-admin with no orgs', async () => {
      // Arrange
      const authzService = service['authzService'] as ReturnType<typeof createAuthorizationServiceMock>;
      authzService.isGlobalAdmin.mockReturnValue(false);
      authzService.getAccessibleOrganizations.mockResolvedValue([]);

      const mockQb = createMockFindOneQueryBuilder(mockApplicationDashboardEntity);
      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQb as any);

      // Act
      await service.findOne('app-dashboard-uuid', mockUserId, ['user']);

      // Assert
      expect(mockQb.andWhere).toHaveBeenCalledWith('ad.organizationId IS NULL');
    });

    it('should apply org ID or NULL filter in findOne for non-admin with accessible orgs', async () => {
      // Arrange
      const authzService = service['authzService'] as ReturnType<typeof createAuthorizationServiceMock>;
      authzService.isGlobalAdmin.mockReturnValue(false);
      authzService.getAccessibleOrganizations.mockResolvedValue(['org-1']);

      const mockQb = createMockFindOneQueryBuilder(mockApplicationDashboardEntity);
      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQb as any);

      // Act
      await service.findOne('app-dashboard-uuid', mockUserId, ['user']);

      // Assert
      expect(mockQb.andWhere).toHaveBeenCalledWith(
        '(ad.organizationId IN (:...orgIds) OR ad.organizationId IS NULL)',
        { orgIds: ['org-1'] }
      );
    });

    it('should skip org filter in findOne when user is global admin', async () => {
      // Arrange
      const authzService = service['authzService'] as ReturnType<typeof createAuthorizationServiceMock>;
      authzService.isGlobalAdmin.mockReturnValue(true);

      const mockQb = createMockFindOneQueryBuilder(mockApplicationDashboardEntity);
      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQb as any);

      // Act
      await service.findOne('app-dashboard-uuid', mockUserId, ['perfana-admin']);

      // Assert
      expect(authzService.getAccessibleOrganizations).not.toHaveBeenCalled();
      const andWhereCalls = (mockQb.andWhere as jest.Mock).mock.calls.map((c: unknown[]) => c[0]);
      expect(andWhereCalls.some((c: unknown) => typeof c === 'string' && c.includes('organizationId'))).toBe(false);
    });
  });

  describe('getDeleteInfo', () => {
    it('should return canDeleteFromGrafana true when dashboard has no other SUTs', async () => {
      // Arrange
      const appDashboardWithOneSut = {
        ...mockApplicationDashboardEntity,
        grafanaDashboard: {
          ...mockGrafanaDashboard,
          name: 'JVM Memory Dashboard',
          uid: 'jvm-memory-uid',
          usedBySut: ['Test System'],
        },
        systemUnderTest: { id: 'system-uuid', name: 'Test System' },
      };
      appDashboardRepo.findOne.mockResolvedValue(appDashboardWithOneSut as any);

      // Act
      const result = await service.getDeleteInfo('app-dashboard-uuid', mockUserId, mockRoles);

      // Assert
      expect(result.canDeleteFromGrafana).toBe(true);
      expect(result.grafanaDashboardName).toBe('JVM Memory Dashboard');
      expect(result.grafanaDashboardUid).toBe('jvm-memory-uid');
      expect(result.otherSuts).toEqual([]);
    });

    it('should return canDeleteFromGrafana false when dashboard is shared by other SUTs', async () => {
      // Arrange
      const appDashboardWithMultipleSuts = {
        ...mockApplicationDashboardEntity,
        grafanaDashboard: {
          ...mockGrafanaDashboard,
          name: 'Shared Dashboard',
          uid: 'shared-uid',
          usedBySut: ['Test System', 'Other System', 'Another System'],
        },
        systemUnderTest: { id: 'system-uuid', name: 'Test System' },
      };
      appDashboardRepo.findOne.mockResolvedValue(appDashboardWithMultipleSuts as any);

      // Act
      const result = await service.getDeleteInfo('app-dashboard-uuid', mockUserId, mockRoles);

      // Assert
      expect(result.canDeleteFromGrafana).toBe(false);
      expect(result.otherSuts).toEqual(['Other System', 'Another System']);
    });

    it('should return canDeleteFromGrafana false when no grafana dashboard linked', async () => {
      // Arrange
      const appDashboardWithoutGrafanaDash = {
        ...mockApplicationDashboardEntity,
        grafanaDashboard: null,
        dashboardName: 'Standalone Dashboard',
        dashboardUid: 'standalone-uid',
      };
      appDashboardRepo.findOne.mockResolvedValue(appDashboardWithoutGrafanaDash as any);

      // Act
      const result = await service.getDeleteInfo('app-dashboard-uuid', mockUserId, mockRoles);

      // Assert
      expect(result.canDeleteFromGrafana).toBe(false);
      expect(result.grafanaDashboardName).toBe('Standalone Dashboard');
      expect(result.grafanaDashboardUid).toBe('standalone-uid');
      expect(result.otherSuts).toEqual([]);
    });

    it('should throw NotFoundException when dashboard not found', async () => {
      // Arrange
      appDashboardRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.getDeleteInfo('non-existent-id', mockUserId, mockRoles)).rejects.toThrow(
        'Application dashboard with id non-existent-id not found'
      );
    });

    it('should load dashboard with grafanaDashboard and systemUnderTest relations', async () => {
      // Arrange
      const appDashboardWithOneSut = {
        ...mockApplicationDashboardEntity,
        grafanaDashboard: {
          ...mockGrafanaDashboard,
          name: 'Test Dashboard',
          uid: 'test-uid',
          usedBySut: ['Test System'],
        },
        systemUnderTest: { id: 'system-uuid', name: 'Test System' },
      };
      appDashboardRepo.findOne.mockResolvedValue(appDashboardWithOneSut as any);

      // Act
      await service.getDeleteInfo('app-dashboard-uuid', mockUserId, mockRoles);

      // Assert
      expect(appDashboardRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'app-dashboard-uuid' },
        relations: ['grafanaDashboard', 'systemUnderTest'],
      });
    });

    it('should handle empty string dashboardUid when no grafana dashboard linked', async () => {
      // Arrange
      const appDashboardWithoutUid = {
        ...mockApplicationDashboardEntity,
        grafanaDashboard: null,
        dashboardUid: undefined,
        dashboardName: 'No UID Dashboard',
      };
      appDashboardRepo.findOne.mockResolvedValue(appDashboardWithoutUid as any);

      // Act
      const result = await service.getDeleteInfo('app-dashboard-uuid', mockUserId, mockRoles);

      // Assert
      expect(result.grafanaDashboardUid).toBe('');
    });

    it('should handle dashboard with no systemUnderTest relation', async () => {
      // Arrange
      const appDashboardWithNoSut = {
        ...mockApplicationDashboardEntity,
        grafanaDashboard: {
          ...mockGrafanaDashboard,
          name: 'Orphan Dashboard',
          uid: 'orphan-uid',
          usedBySut: [],
        },
        systemUnderTest: null,
      };
      appDashboardRepo.findOne.mockResolvedValue(appDashboardWithNoSut as any);

      // Act
      const result = await service.getDeleteInfo('app-dashboard-uuid', mockUserId, mockRoles);

      // Assert
      expect(result.canDeleteFromGrafana).toBe(true);
      expect(result.otherSuts).toEqual([]);
    });

    it('should handle grafanaDashboard with empty usedBySut array', async () => {
      // Arrange
      const appDashboardWithEmptyUsedBySut = {
        ...mockApplicationDashboardEntity,
        grafanaDashboard: {
          ...mockGrafanaDashboard,
          name: 'Empty SUT Dashboard',
          uid: 'empty-sut-uid',
          usedBySut: [],
        },
        systemUnderTest: { id: 'system-uuid', name: 'Test System' },
      };
      appDashboardRepo.findOne.mockResolvedValue(appDashboardWithEmptyUsedBySut as any);

      // Act
      const result = await service.getDeleteInfo('app-dashboard-uuid', mockUserId, mockRoles);

      // Assert
      expect(result.canDeleteFromGrafana).toBe(true);
      expect(result.otherSuts).toEqual([]);
    });
  });

  describe('getBatchDeleteInfo', () => {
    it('should return orphaned dashboards that can be deleted from Grafana', async () => {
      // Arrange
      const orphanDashboard = {
        ...mockApplicationDashboardEntity,
        id: 'orphan-id',
        grafanaDashboard: {
          ...mockGrafanaDashboard,
          name: 'Orphan Dashboard',
          uid: 'orphan-uid',
          usedBySut: ['Test System'],
        },
        systemUnderTest: { id: 'system-uuid', name: 'Test System' },
      };

      const sharedDashboard = {
        ...mockApplicationDashboardEntity,
        id: 'shared-id',
        grafanaDashboard: {
          ...mockGrafanaDashboard,
          name: 'Shared Dashboard',
          uid: 'shared-uid',
          usedBySut: ['Test System', 'Other System'],
        },
        systemUnderTest: { id: 'system-uuid', name: 'Test System' },
      };

      // Each getDeleteInfo call hits findOne
      appDashboardRepo.findOne
        .mockResolvedValueOnce(orphanDashboard as any)
        .mockResolvedValueOnce(sharedDashboard as any);

      // Act
      const result = await service.getBatchDeleteInfo(['orphan-id', 'shared-id'], mockUserId, mockRoles);

      // Assert
      expect(result.orphanedDashboards).toHaveLength(1);
      expect(result.orphanedDashboards[0]).toMatchObject({
        applicationDashboardId: 'orphan-id',
        grafanaDashboardName: 'Orphan Dashboard',
        grafanaDashboardUid: 'orphan-uid',
      });
      expect(result.nonOrphanedCount).toBe(1);
    });

    it('should return empty orphanedDashboards when all dashboards are shared', async () => {
      // Arrange
      const sharedDashboard = {
        ...mockApplicationDashboardEntity,
        id: 'shared-id',
        grafanaDashboard: {
          ...mockGrafanaDashboard,
          name: 'Shared Dashboard',
          uid: 'shared-uid',
          usedBySut: ['Test System', 'Other System'],
        },
        systemUnderTest: { id: 'system-uuid', name: 'Test System' },
      };

      appDashboardRepo.findOne.mockResolvedValue(sharedDashboard as any);

      // Act
      const result = await service.getBatchDeleteInfo(['shared-id'], mockUserId, mockRoles);

      // Assert
      expect(result.orphanedDashboards).toHaveLength(0);
      expect(result.nonOrphanedCount).toBe(1);
    });

    it('should return empty result for empty IDs array', async () => {
      // Act
      const result = await service.getBatchDeleteInfo([], mockUserId, mockRoles);

      // Assert
      expect(result.orphanedDashboards).toHaveLength(0);
      expect(result.nonOrphanedCount).toBe(0);
    });

    it('should not include dashboard in orphaned list when grafanaDashboardUid is empty', async () => {
      // Arrange - dashboard with no grafana dashboard linked (uid will be '')
      const appDashboardWithNoGrafanaDash = {
        ...mockApplicationDashboardEntity,
        id: 'no-grafana-id',
        grafanaDashboard: null,
        dashboardUid: undefined,
      };

      appDashboardRepo.findOne.mockResolvedValue(appDashboardWithNoGrafanaDash as any);

      // Act
      const result = await service.getBatchDeleteInfo(['no-grafana-id'], mockUserId, mockRoles);

      // Assert
      // canDeleteFromGrafana is false when grafanaDashboard is null, so nonOrphanedCount increments
      expect(result.orphanedDashboards).toHaveLength(0);
      expect(result.nonOrphanedCount).toBe(1);
    });

    it('should propagate errors from getDeleteInfo', async () => {
      // Arrange
      appDashboardRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.getBatchDeleteInfo(['non-existent-id'], mockUserId, mockRoles)).rejects.toThrow(
        'Application dashboard with id non-existent-id not found'
      );
    });

    it('should count all dashboards accurately across a mixed batch', async () => {
      // Arrange - 3 dashboards: 2 orphaned, 1 non-orphaned
      const makeOrphan = (id: string, uid: string) => ({
        ...mockApplicationDashboardEntity,
        id,
        grafanaDashboard: {
          ...mockGrafanaDashboard,
          name: `Dashboard ${uid}`,
          uid,
          usedBySut: ['Test System'],
        },
        systemUnderTest: { id: 'system-uuid', name: 'Test System' },
      });

      const sharedDash = {
        ...mockApplicationDashboardEntity,
        id: 'shared-id',
        grafanaDashboard: {
          ...mockGrafanaDashboard,
          name: 'Shared',
          uid: 'shared-uid',
          usedBySut: ['Test System', 'Other System'],
        },
        systemUnderTest: { id: 'system-uuid', name: 'Test System' },
      };

      appDashboardRepo.findOne
        .mockResolvedValueOnce(makeOrphan('id-1', 'uid-1') as any)
        .mockResolvedValueOnce(makeOrphan('id-2', 'uid-2') as any)
        .mockResolvedValueOnce(sharedDash as any);

      // Act
      const result = await service.getBatchDeleteInfo(['id-1', 'id-2', 'shared-id'], mockUserId, mockRoles);

      // Assert
      expect(result.orphanedDashboards).toHaveLength(2);
      expect(result.nonOrphanedCount).toBe(1);
    });
  });

  describe('delete with deleteFromGrafana', () => {
    it('should delete from Grafana when dashboard is orphaned and deleteFromGrafana is true', async () => {
      // Arrange
      const orphanEntity = {
        ...mockApplicationDashboardEntity,
        grafanaDashboard: {
          id: 'grafana-dashboard-uuid',
          uid: 'jvm-memory-uid',
          name: 'JVM Dashboard',
          usedBySut: ['Test System'],
        },
        grafanaInstance: { id: 'grafana-instance-uuid', label: 'Prod Grafana' },
        systemUnderTest: { id: 'system-uuid', name: 'Test System' },
      };
      appDashboardRepo.findOne.mockResolvedValue(orphanEntity as any);

      const mockGrafanaInstanceData = { id: 'grafana-instance-uuid', client_url: 'https://grafana.example.com' };
      const grafanaClientService = service['grafanaClientService'] as any;
      grafanaClientService.getGrafanaInstance = jest.fn().mockResolvedValue(mockGrafanaInstanceData);
      grafanaClientService.deleteDashboard = jest.fn().mockResolvedValue(undefined);

      // Override transaction to also call Grafana deletion
      const mockDataSource = service['dataSource'] as any;
      mockDataSource.transaction.mockImplementationOnce(async (callback: any) => {
        const mockEntityManager = {
          createQueryBuilder: jest.fn().mockReturnValue({
            delete: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            execute: jest.fn().mockResolvedValue({ affected: 0 }),
          }),
          delete: jest.fn().mockResolvedValue({ affected: 1 }),
          update: jest.fn().mockResolvedValue({ affected: 1 }),
        };
        return callback(mockEntityManager);
      });

      // Act
      const result = await service.delete('app-dashboard-uuid', true, mockUserId, mockRoles);

      // Assert
      expect(result.deletedFromGrafana).toBe(true);
      expect(result.grafanaDashboardUid).toBe('jvm-memory-uid');
      expect(grafanaClientService.getGrafanaInstance).toHaveBeenCalledWith('grafana-instance-uuid');
      expect(grafanaClientService.deleteDashboard).toHaveBeenCalledWith(mockGrafanaInstanceData, 'jvm-memory-uid');
    });

    it('should not delete from Grafana when dashboard is shared with other SUTs', async () => {
      // Arrange
      const sharedEntity = {
        ...mockApplicationDashboardEntity,
        grafanaDashboard: {
          id: 'grafana-dashboard-uuid',
          uid: 'shared-uid',
          name: 'Shared Dashboard',
          usedBySut: ['Test System', 'Other System'],
        },
        grafanaInstance: { id: 'grafana-instance-uuid', label: 'Prod Grafana' },
        systemUnderTest: { id: 'system-uuid', name: 'Test System' },
      };
      appDashboardRepo.findOne.mockResolvedValue(sharedEntity as any);

      const grafanaClientService = service['grafanaClientService'] as any;
      grafanaClientService.deleteDashboard = jest.fn();

      // Act
      const result = await service.delete('app-dashboard-uuid', true, mockUserId, mockRoles);

      // Assert
      expect(result.deletedFromGrafana).toBe(false);
      expect(result.grafanaDashboardUid).toBeUndefined();
      expect(grafanaClientService.deleteDashboard).not.toHaveBeenCalled();
    });

    it('should not delete from Grafana when deleteFromGrafana is false even if orphaned', async () => {
      // Arrange
      const orphanEntity = {
        ...mockApplicationDashboardEntity,
        grafanaDashboard: {
          id: 'grafana-dashboard-uuid',
          uid: 'orphan-uid',
          name: 'Orphan Dashboard',
          usedBySut: ['Test System'],
        },
        grafanaInstance: { id: 'grafana-instance-uuid', label: 'Prod Grafana' },
        systemUnderTest: { id: 'system-uuid', name: 'Test System' },
      };
      appDashboardRepo.findOne.mockResolvedValue(orphanEntity as any);

      const grafanaClientService = service['grafanaClientService'] as any;
      grafanaClientService.deleteDashboard = jest.fn();

      // Act
      const result = await service.delete('app-dashboard-uuid', false, mockUserId, mockRoles);

      // Assert
      expect(result.deletedFromGrafana).toBe(false);
      expect(grafanaClientService.deleteDashboard).not.toHaveBeenCalled();
    });

    it('should not delete from Grafana when grafanaDashboard relation is missing', async () => {
      // Arrange
      const noDashEntity = {
        ...mockApplicationDashboardEntity,
        grafanaDashboard: null,
        grafanaInstance: { id: 'grafana-instance-uuid', label: 'Prod Grafana' },
        systemUnderTest: { id: 'system-uuid', name: 'Test System' },
      };
      appDashboardRepo.findOne.mockResolvedValue(noDashEntity as any);

      const grafanaClientService = service['grafanaClientService'] as any;
      grafanaClientService.deleteDashboard = jest.fn();

      // Act
      const result = await service.delete('app-dashboard-uuid', true, mockUserId, mockRoles);

      // Assert
      expect(result.deletedFromGrafana).toBe(false);
      expect(grafanaClientService.deleteDashboard).not.toHaveBeenCalled();
    });

    it('should not delete from Grafana when grafanaInstance relation is missing', async () => {
      // Arrange
      const noInstanceEntity = {
        ...mockApplicationDashboardEntity,
        grafanaDashboard: {
          id: 'grafana-dashboard-uuid',
          uid: 'some-uid',
          name: 'Dashboard',
          usedBySut: ['Test System'],
        },
        grafanaInstance: null,
        systemUnderTest: { id: 'system-uuid', name: 'Test System' },
      };
      appDashboardRepo.findOne.mockResolvedValue(noInstanceEntity as any);

      const grafanaClientService = service['grafanaClientService'] as any;
      grafanaClientService.deleteDashboard = jest.fn();

      // Act
      const result = await service.delete('app-dashboard-uuid', true, mockUserId, mockRoles);

      // Assert
      expect(result.deletedFromGrafana).toBe(false);
      expect(grafanaClientService.deleteDashboard).not.toHaveBeenCalled();
    });

    it('should rollback transaction when Grafana API deletion fails', async () => {
      // Arrange
      const orphanEntity = {
        ...mockApplicationDashboardEntity,
        grafanaDashboard: {
          id: 'grafana-dashboard-uuid',
          uid: 'jvm-memory-uid',
          name: 'JVM Dashboard',
          usedBySut: ['Test System'],
        },
        grafanaInstance: { id: 'grafana-instance-uuid', label: 'Prod Grafana' },
        systemUnderTest: { id: 'system-uuid', name: 'Test System' },
      };
      appDashboardRepo.findOne.mockResolvedValue(orphanEntity as any);

      const grafanaClientService = service['grafanaClientService'] as any;
      grafanaClientService.getGrafanaInstance = jest.fn().mockResolvedValue({ id: 'grafana-instance-uuid' });
      grafanaClientService.deleteDashboard = jest.fn().mockRejectedValue(new Error('Grafana API error'));

      const mockDataSource = service['dataSource'] as any;
      mockDataSource.transaction.mockImplementationOnce(async (callback: any) => {
        const mockEntityManager = {
          createQueryBuilder: jest.fn().mockReturnValue({
            delete: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            execute: jest.fn().mockResolvedValue({ affected: 0 }),
          }),
          delete: jest.fn().mockResolvedValue({ affected: 1 }),
          update: jest.fn().mockResolvedValue({ affected: 1 }),
        };
        return callback(mockEntityManager);
      });

      // Act & Assert
      await expect(service.delete('app-dashboard-uuid', true, mockUserId, mockRoles)).rejects.toThrow('Grafana API error');
    });
  });

  describe('copyToScope', () => {
    const sourceDashboards = [
      {
        id: 'source-dash-1',
        system_under_test_id: 'source-system-uuid',
        test_environment: 'staging',
        grafana_instance_id: 'grafana-instance-uuid',
        grafana_dashboard_id: 'grafana-dashboard-uuid',
        dashboard_name: 'JVM Memory',
        dashboard_id: 123,
        dashboard_uid: 'jvm-uid',
        dashboard_label: 'JVM Memory - Staging',
        tags: ['jvm', 'performance'],
        template_dashboard_uid: 'template-uid',
        variables: [{ name: 'system_under_test', values: ['test-app'] }],
        replaced_templating_variables: [{ name: 'datasource', value: ['Prometheus'] }],
        snapshot_timeout: 10,
        created_at: '2024-01-15T10:00:00.000Z',
        updated_at: '2024-01-15T10:00:00.000Z',
      },
      {
        id: 'source-dash-2',
        system_under_test_id: 'source-system-uuid',
        test_environment: 'staging',
        grafana_instance_id: 'grafana-instance-uuid',
        grafana_dashboard_id: 'grafana-dashboard-uuid-2',
        dashboard_name: 'HTTP Metrics',
        dashboard_id: 456,
        dashboard_uid: 'http-uid',
        dashboard_label: 'HTTP Metrics - Staging',
        tags: ['http'],
        template_dashboard_uid: undefined,
        variables: [],
        replaced_templating_variables: [],
        snapshot_timeout: 4,
        created_at: '2024-01-15T10:00:00.000Z',
        updated_at: '2024-01-15T10:00:00.000Z',
      },
    ];

    const copyDto = {
      sourceSystemUnderTestId: 'source-system-uuid',
      sourceTestEnvironment: 'staging',
      targetSystemUnderTestId: 'target-system-uuid',
      targetTestEnvironment: 'production',
      conflictStrategy: 'skip' as const,
    };

    it('should copy all dashboards when target scope is empty', async () => {
      // Arrange
      const mockQb = createMockFindAllQueryBuilder([]);
      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQb as any);

      // findAll called twice: once for source, once for target (both return via QB)
      // The source findAll call returns sourceDashboards, target returns []
      mockQb.getMany
        .mockResolvedValueOnce([mockApplicationDashboardEntity, { ...mockApplicationDashboardEntity, id: 'source-dash-2', dashboardUid: 'http-uid', dashboardLabel: 'HTTP Metrics - Staging', grafanaDashboard: undefined }])
        .mockResolvedValueOnce([]);

      // create will be called twice
      appDashboardRepo.create.mockReturnValue(mockApplicationDashboardEntity);
      appDashboardRepo.save.mockResolvedValue(mockApplicationDashboardEntity);
      appDashboardRepo.findOne.mockResolvedValue(mockApplicationDashboardEntity);

      // Act
      const result = await service.copyToScope(copyDto, mockUserId, mockRoles);

      // Assert
      expect(result.total).toBe(2);
      expect(result.copied).toBe(2);
      expect(result.skipped).toBe(0);
    });

    it('should skip dashboards with skip conflict strategy when they already exist in target', async () => {
      // Arrange
      const targetDashboardEntity = {
        ...mockApplicationDashboardEntity,
        id: 'target-dash-1',
        systemUnderTestId: 'target-system-uuid',
        testEnvironment: 'production',
        grafanaDashboard: undefined,
      };

      const mockQb = createMockFindAllQueryBuilder([]);
      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQb as any);

      // Source returns 1 dashboard, target returns same dashboard (same unique key)
      mockQb.getMany
        .mockResolvedValueOnce([mockApplicationDashboardEntity])  // source
        .mockResolvedValueOnce([targetDashboardEntity]);          // target - same uid/label/instance

      // Act
      const result = await service.copyToScope(copyDto, mockUserId, mockRoles);

      // Assert
      expect(result.total).toBe(1);
      expect(result.copied).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('should overwrite existing dashboards with overwrite conflict strategy', async () => {
      // Arrange
      const overwriteDto = { ...copyDto, conflictStrategy: 'overwrite' as const };

      const targetDashboardEntity = {
        ...mockApplicationDashboardEntity,
        id: 'target-dash-1',
        systemUnderTestId: 'target-system-uuid',
        testEnvironment: 'production',
        grafanaDashboard: undefined,
      };

      // The service calls createQueryBuilder multiple times:
      //   1st & 2nd: findAll (source + target) — use getMany
      //   3rd:       findOne inside update — uses getOne with where()
      const findAllQb = createMockFindAllQueryBuilder([]);
      const findOneQb = createMockFindOneQueryBuilder(targetDashboardEntity);

      appDashboardRepo.createQueryBuilder
        .mockReturnValueOnce(findAllQb as any)  // source findAll
        .mockReturnValueOnce(findAllQb as any)  // target findAll
        .mockReturnValue(findOneQb as any);     // findOne after update

      findAllQb.getMany
        .mockResolvedValueOnce([mockApplicationDashboardEntity])  // source
        .mockResolvedValueOnce([targetDashboardEntity]);          // target — same unique key

      // findOne (existence check) and update repo methods
      appDashboardRepo.findOne.mockResolvedValue(targetDashboardEntity as any);
      appDashboardRepo.update.mockResolvedValue({} as any);

      // Act
      const result = await service.copyToScope(overwriteDto, mockUserId, mockRoles);

      // Assert
      expect(result.total).toBe(1);
      expect(result.copied).toBe(1);
      expect(result.skipped).toBe(0);
      expect(appDashboardRepo.update).toHaveBeenCalled();
    });

    it('should filter source dashboards by provided IDs when ids is specified', async () => {
      // Arrange
      const dtoWithIds = {
        ...copyDto,
        ids: ['app-dashboard-uuid'], // only copy first source dashboard
      };

      const secondDash = { ...mockApplicationDashboardEntity, id: 'second-dash-uuid', dashboardUid: 'http-uid', dashboardLabel: 'HTTP - Staging', grafanaDashboard: undefined };

      const mockQb = createMockFindAllQueryBuilder([]);
      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQb as any);

      mockQb.getMany
        .mockResolvedValueOnce([mockApplicationDashboardEntity, secondDash])  // source - 2 dashboards
        .mockResolvedValueOnce([]);                                            // target - empty

      // create called once (only for app-dashboard-uuid, not second-dash-uuid)
      appDashboardRepo.create.mockReturnValue(mockApplicationDashboardEntity);
      appDashboardRepo.save.mockResolvedValue(mockApplicationDashboardEntity);
      appDashboardRepo.findOne.mockResolvedValue(mockApplicationDashboardEntity);

      // Act
      const result = await service.copyToScope(dtoWithIds, mockUserId, mockRoles);

      // Assert
      expect(result.total).toBe(1); // only 1 after filtering by IDs
      expect(result.copied).toBe(1);
      expect(appDashboardRepo.create).toHaveBeenCalledTimes(1);
    });

    it('should return zero counts when source scope has no dashboards', async () => {
      // Arrange
      const mockQb = createMockFindAllQueryBuilder([]);
      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQb as any);

      mockQb.getMany
        .mockResolvedValueOnce([])   // source - empty
        .mockResolvedValueOnce([]);  // target - empty

      // Act
      const result = await service.copyToScope(copyDto, mockUserId, mockRoles);

      // Assert
      expect(result.total).toBe(0);
      expect(result.copied).toBe(0);
      expect(result.skipped).toBe(0);
    });
  });

  describe('variable enrichment edge cases', () => {
    it('should return original variables when grafanaDashboard has no grafanaJson', async () => {
      // Arrange
      const entityWithNoJson = {
        ...mockApplicationDashboardEntity,
        grafanaDashboard: { id: 'gd-uuid', grafanaJson: null },
      };

      const mockQueryBuilder = createMockFindAllQueryBuilder([entityWithNoJson]);
      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      const result = await service.findAll(mockUserId, mockRoles, {});

      // Assert - variables returned unchanged since no template data available
      expect(result[0].variables).toEqual([
        { name: 'system_under_test', values: ['test-app'] },
        { name: 'workload', values: ['load-test'] },
      ]);
    });

    it('should return original variables when grafanaJson has no templating section', async () => {
      // Arrange
      const entityWithNoTemplating = {
        ...mockApplicationDashboardEntity,
        grafanaDashboard: {
          id: 'gd-uuid',
          grafanaJson: { dashboard: {} }, // no templating section
        },
      };

      const mockQueryBuilder = createMockFindAllQueryBuilder([entityWithNoTemplating]);
      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      const result = await service.findAll(mockUserId, mockRoles, {});

      // Assert - variables returned unchanged
      expect(result[0].variables).toEqual([
        { name: 'system_under_test', values: ['test-app'] },
        { name: 'workload', values: ['load-test'] },
      ]);
    });

    it('should not enrich variables that have no matching template variable by name', async () => {
      // Arrange - grafana dashboard has a template var "unknown_var", not matching our variables
      const entityWithMismatch = {
        ...mockApplicationDashboardEntity,
        grafanaDashboard: {
          id: 'gd-uuid',
          grafanaJson: {
            dashboard: {
              templating: {
                list: [
                  { name: 'unknown_var', type: 'query', includeAll: true, multi: true },
                ],
              },
            },
          },
        },
      };

      const mockQueryBuilder = createMockFindAllQueryBuilder([entityWithMismatch]);
      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      const result = await service.findAll(mockUserId, mockRoles, {});

      // Assert - variables not enriched (no matching template entry)
      expect(result[0].variables).toEqual([
        { name: 'system_under_test', values: ['test-app'] },
        { name: 'workload', values: ['load-test'] },
      ]);
    });

    it('should partially enrich when only some variables have template matches', async () => {
      // Arrange - template has entry for workload but not system_under_test
      const entityWithPartialTemplates = {
        ...mockApplicationDashboardEntity,
        grafanaDashboard: {
          id: 'gd-uuid',
          grafanaJson: {
            dashboard: {
              templating: {
                list: [
                  { name: 'workload', type: 'textbox', includeAll: false, multi: false, allValue: null },
                ],
              },
            },
          },
        },
      };

      const mockQueryBuilder = createMockFindAllQueryBuilder([entityWithPartialTemplates]);
      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      const result = await service.findAll(mockUserId, mockRoles, {});

      // Assert - only workload enriched
      expect(result[0].variables[0]).toEqual({ name: 'system_under_test', values: ['test-app'] }); // not enriched
      expect(result[0].variables[1]).toMatchObject({ name: 'workload', type: 'textbox', includeAll: false, multi: false }); // enriched
    });

    it('should return empty array when variables is empty even with valid grafanaDashboard', async () => {
      // Arrange
      const entityWithEmptyVars = {
        ...mockApplicationDashboardEntity,
        variables: [],
        grafanaDashboard: mockGrafanaDashboard,
      };

      const mockQueryBuilder = createMockFindAllQueryBuilder([entityWithEmptyVars]);
      appDashboardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      const result = await service.findAll(mockUserId, mockRoles, {});

      // Assert
      expect(result[0].variables).toEqual([]);
    });

    it('should filter out invalid variables in create (non-object or array entries)', async () => {
      // Arrange
      const createDtoWithInvalidVars = {
        systemUnderTestId: 'system-uuid',
        testEnvironment: 'production',
        grafanaInstanceId: 'grafana-instance-uuid',
        grafanaDashboardId: 'grafana-dashboard-uuid',
        dashboardName: 'Test',
        dashboardLabel: 'Test Label',
        variables: [
          { name: 'valid_var', values: ['val1'] },
          ['invalid', 'array'] as any, // array entry should be filtered
          null as any,                  // null should be filtered
          { values: ['no-name'] } as any, // missing name should be filtered
        ],
      };

      appDashboardRepo.create.mockReturnValue(mockApplicationDashboardEntity);
      appDashboardRepo.save.mockResolvedValue(mockApplicationDashboardEntity);
      appDashboardRepo.findOne.mockResolvedValue(mockApplicationDashboardEntity);

      // Act
      await service.create(createDtoWithInvalidVars, mockUserId, mockRoles);

      // Assert - only the valid variable with a string name passes the filter
      expect(appDashboardRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: [{ name: 'valid_var', values: ['val1'] }],
        })
      );
    });

    it('should filter out invalid variables in update (array entries)', async () => {
      // Arrange
      const updateDtoWithInvalidVars = {
        variables: [
          { name: 'valid_var', values: ['val1'] },
          ['invalid', 'array'] as any,
        ],
      };

      appDashboardRepo.findOne.mockResolvedValueOnce(mockApplicationDashboardEntity);
      appDashboardRepo.createQueryBuilder.mockReturnValue(
        createMockFindOneQueryBuilder(mockApplicationDashboardEntity) as any
      );
      appDashboardRepo.update.mockResolvedValue({} as any);

      // Act
      await service.update('app-dashboard-uuid', updateDtoWithInvalidVars, mockUserId, mockRoles);

      // Assert
      expect(appDashboardRepo.update).toHaveBeenCalledWith(
        'app-dashboard-uuid',
        expect.objectContaining({
          variables: [{ name: 'valid_var', values: ['val1'] }],
        })
      );
    });
  });
});
