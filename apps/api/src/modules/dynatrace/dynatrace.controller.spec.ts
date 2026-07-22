import { Test, TestingModule } from '@nestjs/testing';
import { DynatraceController } from './dynatrace.controller';
import { DynatraceService } from './dynatrace.service';
import { TestRunsConfigService } from '../test-runs/services/test-runs-config.service';
import { CreateDynatraceConfigDto } from './dto/create-dynatrace-config.dto';
import { UpdateDynatraceConfigDto } from './dto/update-dynatrace-config.dto';
import { CreateDynatraceQueryDto } from './dto/create-dynatrace-query.dto';
import { UpdateDynatraceQueryDto } from './dto/update-dynatrace-query.dto';
import { CreateEntityMappingDto } from './dto/create-entity-mapping.dto';
import { TestConnectionDto } from './dto/test-connection.dto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { UserContext } from '../../common/decorators/user-context.decorator';

describe('DynatraceController', () => {
  let controller: DynatraceController;
  let service: jest.Mocked<DynatraceService>;

  const mockUserContext: UserContext = {
    userId: 'test-user-123',
    roles: ['user'],
    organizations: ['org-123'],
    teams: ['team-456'],
    organizationId: 'org-123',
    teamId: 'team-456',
  };

  const mockDynatraceConfig = {
    id: 'config-123',
    host: 'https://example.live.dynatrace.com',
    apiToken: 'dt0c01.test.token',
    dynatraceType: 'saas' as const,
    label: 'Production Dynatrace',
    platformApiToken: 'platform-token',
    perfanaTestRunIdAttribute: 'perfana-test-run-id',
    perfanaRequestNameAttribute: 'perfana-request-name',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockDynatraceQuery = {
    id: 'query-123',
    dynatraceConfigId: 'config-123',
    systemUnderTestId: 'sys-123',
    testEnvironment: 'production',
    workload: 'load-test',
    dashboardLabel: 'Performance Dashboard',
    panelId: 1,
    panelTitle: 'Response Time',
    query: 'timeseries response_time = avg(dt.service.response_time)',
    metricUnit: 'ms',
    matchMetricPattern: undefined,
    omitGroupByVariableFromMetricName: [],
    templateVariables: {},
    applicationDashboardId: 'dash-123',
    createdAt: new Date(),
    updatedAt: new Date(),
    dynatraceConfig: undefined,
  };

  const mockServiceFactory = () => ({
    findAll: jest.fn(),
    findByHost: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    testConnection: jest.fn(),
    fetchEntities: jest.fn(),
    fetchRequestAttributes: jest.fn(),
    getRequestAttributesForConfig: jest.fn(),
    findAllQuery: jest.fn(),
    findQueryBySystemAndEnvironment: jest.fn(),
    findQueryById: jest.fn(),
    createQuery: jest.fn(),
    createQuerySmart: jest.fn(),
    bulkImportQuery: jest.fn(),
    updateQuery: jest.fn(),
    deleteQuery: jest.fn(),
    getDistinctDashboardLabels: jest.fn(),
    getPanelTitlesForDashboard: jest.fn(),
    getEntityMappings: jest.fn(),
    createEntityMapping: jest.fn(),
    deleteEntityMapping: jest.fn(),
    getMetricNames: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DynatraceController],
      providers: [
        {
          provide: DynatraceService,
          useValue: mockServiceFactory(),
        },
        {
          provide: TestRunsConfigService,
          useValue: {
            storeDynatraceHostPropertiesConfig: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<DynatraceController>(DynatraceController);
    service = module.get(DynatraceService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Configuration Endpoints', () => {
    describe('findAll', () => {
      it('should return all Dynatrace configurations', async () => {
        const mockConfigs = [mockDynatraceConfig];
        service.findAll.mockResolvedValue(mockConfigs);

        const result = await controller.findAll(undefined, mockUserContext);

        expect(result).toEqual(mockConfigs);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, undefined);
      });

      it('should return empty array when no configurations exist', async () => {
        service.findAll.mockResolvedValue([]);

        const result = await controller.findAll(undefined, mockUserContext);

        expect(result).toEqual([]);
      });
    });

    describe('create', () => {
      const createDto: CreateDynatraceConfigDto = {
        host: 'https://example.live.dynatrace.com',
        apiToken: 'dt0c01.test.token',
        dynatraceType: 'saas',
        label: 'Test Dynatrace',
        platformApiToken: 'platform-token',
      };

      it('should create new configuration', async () => {
        service.create.mockResolvedValue(mockDynatraceConfig);

        const result = await controller.create(createDto, mockUserContext);

        expect(result).toEqual(mockDynatraceConfig);
        expect(service.create).toHaveBeenCalledWith(createDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should handle ConflictException for duplicate host', async () => {
        service.create.mockRejectedValue(
          new ConflictException('Configuration already exists for this host')
        );

        await expect(controller.create(createDto, mockUserContext)).rejects.toThrow(ConflictException);
      });

      it('should handle BadRequestException for invalid data', async () => {
        service.create.mockRejectedValue(new BadRequestException('Invalid configuration'));

        await expect(controller.create(createDto, mockUserContext)).rejects.toThrow(BadRequestException);
      });

    });

    describe('testConnection', () => {
      const testConnectionDto: TestConnectionDto = {
        host: 'https://example.live.dynatrace.com',
        apiToken: 'dt0c01.test.token',
      };

      it('should test connection successfully', async () => {
        const mockResult = { success: true, version: 'Entities API v2 (100 entities available)' };
        service.testConnection.mockResolvedValue(mockResult);

        const result = await controller.testConnection(testConnectionDto, mockUserContext);

        expect(result).toEqual(mockResult);
        expect(service.testConnection).toHaveBeenCalledWith(
          testConnectionDto.host,
          testConnectionDto.apiToken
        );
      });

      it('should handle connection test failure', async () => {
        service.testConnection.mockRejectedValue(new BadRequestException('Invalid API token'));

        await expect(controller.testConnection(testConnectionDto, mockUserContext)).rejects.toThrow(
          BadRequestException
        );
      });
    });

    describe('update', () => {
      const updateDto: UpdateDynatraceConfigDto = {
        perfanaTestRunIdAttribute: 'new-test-run-id',
        perfanaRequestNameAttribute: 'new-request-name',
        label: 'Updated Label',
      };

      it('should update configuration successfully', async () => {
        const updatedConfig = { ...mockDynatraceConfig, ...updateDto };
        service.update.mockResolvedValue(updatedConfig);

        const result = await controller.update('config-123', updateDto, mockUserContext);

        expect(result).toEqual(updatedConfig);
        expect(service.update).toHaveBeenCalledWith('config-123', updateDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should handle NotFoundException for nonexistent config', async () => {
        service.update.mockRejectedValue(new NotFoundException('Configuration not found'));

        await expect(controller.update('nonexistent', updateDto, mockUserContext)).rejects.toThrow(
          NotFoundException
        );
      });
    });

    describe('delete', () => {
      it('should delete configuration successfully', async () => {
        service.delete.mockResolvedValue(undefined);

        await controller.delete('config-123', mockUserContext);

        expect(service.delete).toHaveBeenCalledWith('config-123', mockUserContext.userId, mockUserContext.roles);
      });
    });
  });

  describe('Query Endpoints', () => {
    describe('findAllQueries', () => {
      it('should return all queries when no filters provided', async () => {
        const mockQueries = [mockDynatraceQuery];
        service.findAllQuery.mockResolvedValue(mockQueries);

        const result = await controller.findAllQueries(undefined, undefined, undefined, mockUserContext);

        expect(result).toEqual(mockQueries);
        expect(service.findAllQuery).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles);
      });

      it('should return filtered queries by system, environment, and workload', async () => {
        const mockQueries = [mockDynatraceQuery];
        service.findQueryBySystemAndEnvironment.mockResolvedValue(mockQueries);

        const result = await controller.findAllQueries('sys-123', 'production', 'load-test', mockUserContext);

        expect(result).toEqual(mockQueries);
        expect(service.findQueryBySystemAndEnvironment).toHaveBeenCalledWith(
          'sys-123',
          'production',
          'load-test',
          mockUserContext.userId,
          mockUserContext.roles
        );
        expect(service.findAllQuery).not.toHaveBeenCalled();
      });

      it('should return all queries when only partial filters provided', async () => {
        const mockQueries = [mockDynatraceQuery];
        service.findAllQuery.mockResolvedValue(mockQueries);

        const result = await controller.findAllQueries('sys-123', undefined, undefined, mockUserContext);

        expect(result).toEqual(mockQueries);
        expect(service.findAllQuery).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles);
        expect(service.findQueryBySystemAndEnvironment).not.toHaveBeenCalled();
      });
    });

    describe('getDashboardsForSlo', () => {
      it('should return distinct dashboard labels', async () => {
        const mockDashboards = [
          { dashboardLabel: 'Performance Dashboard' },
          { dashboardLabel: 'System Dashboard' },
        ];
        service.getDistinctDashboardLabels.mockResolvedValue(mockDashboards);

        const result = await controller.getDashboardsForSlo('sys-123', 'production', 'load-test', mockUserContext);

        expect(result).toEqual(mockDashboards);
        expect(service.getDistinctDashboardLabels).toHaveBeenCalledWith(
          'sys-123',
          'production',
          'load-test',
          mockUserContext.userId,
          mockUserContext.roles
        );
      });

      it('should throw BadRequestException when systemId or environment missing', async () => {
        await expect(
          controller.getDashboardsForSlo('', 'production', 'load-test', mockUserContext)
        ).rejects.toThrow(BadRequestException);

        await expect(
          controller.getDashboardsForSlo('sys-123', '', 'load-test', mockUserContext)
        ).rejects.toThrow(BadRequestException);
      });

      it('should accept a missing workload (SLO pickers are workload-agnostic)', async () => {
        service.getDistinctDashboardLabels.mockResolvedValue([]);

        await expect(
          controller.getDashboardsForSlo('sys-123', 'production', '', mockUserContext)
        ).resolves.toEqual([]);
      });
    });

    describe('getMetricsForSlo', () => {
      it('should return panel titles for dashboard', async () => {
        const mockMetrics = [
          {
            panelTitle: 'Response Time',
            panelId: 1,
            applicationDashboardId: 'dash-123',
            metricUnit: 'ms',
          },
        ];
        service.getPanelTitlesForDashboard.mockResolvedValue(mockMetrics);

        const result = await controller.getMetricsForSlo(
          'sys-123',
          'production',
          'load-test',
          'Performance Dashboard',
          mockUserContext
        );

        expect(result).toEqual(mockMetrics);
        expect(service.getPanelTitlesForDashboard).toHaveBeenCalledWith(
          'sys-123',
          'production',
          'load-test',
          'Performance Dashboard',
          mockUserContext.userId,
          mockUserContext.roles
        );
      });
    });

    describe('findQueryById', () => {
      it('should return query by ID', async () => {
        service.findQueryById.mockResolvedValue(mockDynatraceQuery);

        const result = await controller.findQueryById('query-123', mockUserContext);

        expect(result).toEqual(mockDynatraceQuery);
        expect(service.findQueryById).toHaveBeenCalledWith('query-123', mockUserContext.userId, mockUserContext.roles);
      });

      it('should handle NotFoundException for nonexistent query', async () => {
        service.findQueryById.mockRejectedValue(new NotFoundException('Query not found'));

        await expect(controller.findQueryById('nonexistent', mockUserContext)).rejects.toThrow(NotFoundException);
      });
    });

    describe('createQuery', () => {
      const createQueryDto: CreateDynatraceQueryDto = {
        dynatraceConfigId: 'config-123',
        systemUnderTestId: 'sys-123',
        testEnvironment: 'production',
        workload: 'load-test',
        dashboardLabel: 'Performance Dashboard',
        panelId: 1,
        panelTitle: 'Response Time',
        metricUnit: 'ms',
        query: 'timeseries avg(dt.service.response_time)',
        applicationDashboardId: 'dash-123',
      };

      it('should create new query', async () => {
        service.createQuery.mockResolvedValue(mockDynatraceQuery);

        const result = await controller.createQuery(createQueryDto, mockUserContext);

        expect(result).toEqual(mockDynatraceQuery);
        expect(service.createQuery).toHaveBeenCalledWith(createQueryDto, mockUserContext.userId, mockUserContext.roles);
      });

    });

    describe('createQuerySmart', () => {
      const createQueryDto: CreateDynatraceQueryDto = {
        dynatraceConfigId: 'config-123',
        systemUnderTestId: 'sys-123',
        testEnvironment: 'production',
        workload: 'load-test',
        dashboardLabel: 'Performance Dashboard',
        panelId: 1,
        panelTitle: 'Response Time',
        metricUnit: 'ms',
        query: 'timeseries avg(dt.service.response_time)',
        applicationDashboardId: 'dash-123',
      };

      it('should create query with smart UUID handling', async () => {
        service.createQuerySmart.mockResolvedValue(mockDynatraceQuery);

        const result = await controller.createQuerySmart(createQueryDto, mockUserContext);

        expect(result).toEqual(mockDynatraceQuery);
        expect(service.createQuerySmart).toHaveBeenCalledWith(createQueryDto, mockUserContext.userId, mockUserContext.roles);
      });

    });

    describe('bulkImportQueries', () => {
      const dtoList: CreateDynatraceQueryDto[] = [
        {
          dynatraceConfigId: 'config-123',
          systemUnderTestId: 'sys-123',
          testEnvironment: 'production',
          workload: 'load-test',
          dashboardLabel: 'Performance Dashboard',
          panelId: 1,
          panelTitle: 'Response Time',
          metricUnit: 'ms',
          query: 'timeseries avg(dt.service.response_time)',
          applicationDashboardId: 'dash-123',
        },
      ];

      it('should bulk import queries with shared UUID by default', async () => {
        service.bulkImportQuery.mockResolvedValue([mockDynatraceQuery]);

        const result = await controller.bulkImportQueries(dtoList, mockUserContext, undefined);

        expect(result).toEqual([mockDynatraceQuery]);
        expect(service.bulkImportQuery).toHaveBeenCalledWith(dtoList, mockUserContext.userId, mockUserContext.roles, true);
      });

      it('should bulk import queries without shared UUID when specified', async () => {
        service.bulkImportQuery.mockResolvedValue([mockDynatraceQuery]);

        const result = await controller.bulkImportQueries(dtoList, mockUserContext, 'false');

        expect(result).toEqual([mockDynatraceQuery]);
        expect(service.bulkImportQuery).toHaveBeenCalledWith(dtoList, mockUserContext.userId, mockUserContext.roles, false);
      });

      it('should use shared UUID when generateSharedUuid is not false', async () => {
        service.bulkImportQuery.mockResolvedValue([mockDynatraceQuery]);

        await controller.bulkImportQueries(dtoList, mockUserContext, 'true');
        expect(service.bulkImportQuery).toHaveBeenCalledWith(dtoList, mockUserContext.userId, mockUserContext.roles, true);

        await controller.bulkImportQueries(dtoList, mockUserContext, 'anything');
        expect(service.bulkImportQuery).toHaveBeenCalledWith(dtoList, mockUserContext.userId, mockUserContext.roles, true);
      });

    });

    describe('updateQuery', () => {
      const updateQueryDto: UpdateDynatraceQueryDto = {
        query: 'timeseries updated = avg(dt.service.response_time)',
        metricUnit: 'seconds',
      };

      it('should update query successfully', async () => {
        const updatedQuery = { ...mockDynatraceQuery, ...updateQueryDto };
        service.updateQuery.mockResolvedValue(updatedQuery);

        const result = await controller.updateQuery('query-123', updateQueryDto, mockUserContext);

        expect(result).toEqual(updatedQuery);
        expect(service.updateQuery).toHaveBeenCalledWith('query-123', updateQueryDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should handle NotFoundException for nonexistent query', async () => {
        service.updateQuery.mockRejectedValue(new NotFoundException('Query not found'));

        await expect(controller.updateQuery('nonexistent', updateQueryDto, mockUserContext)).rejects.toThrow(
          NotFoundException
        );
      });
    });

    describe('deleteQuery', () => {
      it('should delete query successfully', async () => {
        service.deleteQuery.mockResolvedValue(undefined);

        await controller.deleteQuery('query-123', mockUserContext);

        expect(service.deleteQuery).toHaveBeenCalledWith('query-123', mockUserContext.userId, mockUserContext.roles);
      });

      it('should handle NotFoundException for nonexistent query', async () => {
        service.deleteQuery.mockRejectedValue(new NotFoundException('Query not found'));

        await expect(controller.deleteQuery('nonexistent', mockUserContext)).rejects.toThrow(NotFoundException);
      });
    });
  });

  describe('Entity Endpoints', () => {
    describe('fetchEntities', () => {
      it('should fetch all entities without filters', async () => {
        const mockEntities = {
          entities: [{ entityId: 'entity-1', displayName: 'Service 1', type: 'SERVICE' }],
          totalCount: 1,
          pageSize: 500,
          nextPageKey: null,
        };
        service.fetchEntities.mockResolvedValue(mockEntities);

        const result = await controller.fetchEntities(undefined, undefined, undefined, undefined, undefined, mockUserContext);

        expect(result).toEqual(mockEntities);
        expect(service.fetchEntities).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, undefined, undefined, undefined, undefined, undefined);
      });

      it('should fetch entities with entityType filter', async () => {
        const mockEntities = {
          entities: [],
          totalCount: 0,
          pageSize: 500,
          nextPageKey: null,
        };
        service.fetchEntities.mockResolvedValue(mockEntities);

        await controller.fetchEntities('SERVICE', undefined, undefined, undefined, undefined, mockUserContext);

        expect(service.fetchEntities).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, 'SERVICE', undefined, undefined, undefined, undefined);
      });

      it('should fetch entities with entityName filter', async () => {
        const mockEntities = {
          entities: [],
          totalCount: 0,
          pageSize: 500,
          nextPageKey: null,
        };
        service.fetchEntities.mockResolvedValue(mockEntities);

        await controller.fetchEntities(undefined, 'payment-service', undefined, undefined, undefined, mockUserContext);

        expect(service.fetchEntities).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, undefined, 'payment-service', undefined, undefined, undefined);
      });

      it('should fetch entities with dynatraceConfigId', async () => {
        const mockEntities = {
          entities: [],
          totalCount: 0,
          pageSize: 500,
          nextPageKey: null,
        };
        service.fetchEntities.mockResolvedValue(mockEntities);

        await controller.fetchEntities(undefined, undefined, 'config-123', undefined, undefined, mockUserContext);

        expect(service.fetchEntities).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, undefined, undefined, 'config-123', undefined, undefined);
      });

      it('should forward tagKey and tagValue for server-side tag filtering', async () => {
        const mockEntities = { entities: [], totalCount: 0, pageSize: 500, nextPageKey: null };
        service.fetchEntities.mockResolvedValue(mockEntities);

        await controller.fetchEntities('HOST', undefined, 'config-123', 'environment', 'prod', mockUserContext);

        expect(service.fetchEntities).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, 'HOST', undefined, 'config-123', 'environment', 'prod');
      });

      it('should handle BadRequestException for API errors', async () => {
        service.fetchEntities.mockRejectedValue(
          new BadRequestException('Failed to fetch entities')
        );

        await expect(controller.fetchEntities(undefined, undefined, undefined, undefined, undefined, mockUserContext)).rejects.toThrow(BadRequestException);
      });
    });

    describe('getEntityMappings', () => {
      it('should return all entity mappings without filters', async () => {
        const mockMappings = [
          {
            id: 'mapping-1',
            dynatraceConfigId: 'config-123',
            dynatraceLabel: 'Production Dynatrace',
            systemUnderTestId: 'sys-123',
            testEnvironment: 'production',
            workload: 'load-test',
            entityId: 'entity-123',
            entityDisplayName: 'Test Entity',
            entityType: 'SERVICE',
            level: 'application',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        service.getEntityMappings.mockResolvedValue(mockMappings);

        const result = await controller.getEntityMappings(undefined, undefined, undefined, mockUserContext);

        expect(result).toEqual(mockMappings);
        expect(service.getEntityMappings).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, undefined, undefined, undefined);
      });

      it('should return filtered entity mappings', async () => {
        const mockMappings: any[] = [];
        service.getEntityMappings.mockResolvedValue(mockMappings);

        await controller.getEntityMappings('sys-123', 'production', 'load-test', mockUserContext);

        expect(service.getEntityMappings).toHaveBeenCalledWith(
          mockUserContext.userId,
          mockUserContext.roles,
          'sys-123',
          'production',
          'load-test'
        );
      });
    });

    describe('createEntityMapping', () => {
      const createMappingDto: CreateEntityMappingDto = {
        dynatraceConfigId: 'config-123',
        systemUnderTestId: 'sys-123',
        testEnvironment: 'production',
        workload: 'load-test',
        entityId: 'entity-123',
        entityDisplayName: 'Test Entity',
        entityType: 'SERVICE',
        level: 'sut_testenv_workload',
      };

      it('should create entity mapping successfully', async () => {
        const mockMapping = {
          id: 'mapping-1',
          dynatraceConfigId: 'config-123',
          dynatraceLabel: 'Production Dynatrace',
          systemUnderTestId: 'sys-123',
          testEnvironment: 'production',
          workload: 'load-test',
          entityId: 'entity-123',
          entityDisplayName: 'Test Entity',
          entityType: 'SERVICE',
          level: 'sut_testenv_workload' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        service.createEntityMapping.mockResolvedValue(mockMapping);

        const result = await controller.createEntityMapping(createMappingDto, mockUserContext);

        expect(result).toEqual(mockMapping);
        expect(service.createEntityMapping).toHaveBeenCalledWith(createMappingDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should handle ConflictException for duplicate mapping', async () => {
        service.createEntityMapping.mockRejectedValue(
          new ConflictException('Entity already mapped')
        );

        await expect(controller.createEntityMapping(createMappingDto, mockUserContext)).rejects.toThrow(
          ConflictException
        );
      });

    });

    describe('deleteEntityMapping', () => {
      it('should delete entity mapping successfully', async () => {
        service.deleteEntityMapping.mockResolvedValue(undefined);

        await controller.deleteEntityMapping('mapping-1', mockUserContext);

        expect(service.deleteEntityMapping).toHaveBeenCalledWith('mapping-1', mockUserContext.userId, mockUserContext.roles);
      });

      it('should handle NotFoundException for nonexistent mapping', async () => {
        service.deleteEntityMapping.mockRejectedValue(new NotFoundException('Mapping not found'));

        await expect(controller.deleteEntityMapping('nonexistent', mockUserContext)).rejects.toThrow(
          NotFoundException
        );
      });
    });
  });

  describe('Request Attributes Endpoints', () => {
    describe('fetchRequestAttributes', () => {
      it('should fetch request attributes by host', async () => {
        const mockAttributes = {
          all: [
            { name: 'perfana-test-run-id', id: 'attr-1' },
            { name: 'other-attribute', id: 'attr-2' },
          ],
          perfanaAttributes: [{ name: 'perfana-test-run-id', id: 'attr-1' }],
        };
        service.fetchRequestAttributes.mockResolvedValue(mockAttributes);

        const result = await controller.fetchRequestAttributes('https://example.com', mockUserContext);

        expect(result).toEqual(mockAttributes);
        expect(service.fetchRequestAttributes).toHaveBeenCalledWith('https://example.com', mockUserContext.userId, mockUserContext.roles);
      });

      it('should handle NotFoundException for nonexistent host', async () => {
        service.fetchRequestAttributes.mockRejectedValue(
          new NotFoundException('Configuration not found')
        );

        await expect(controller.fetchRequestAttributes('https://nonexistent.com', mockUserContext)).rejects.toThrow(
          NotFoundException
        );
      });
    });

    describe('getRequestAttributesForConfig', () => {
      it('should fetch request attributes by config ID', async () => {
        const mockAttributes = {
          all: [],
          perfanaAttributes: [],
        };
        service.getRequestAttributesForConfig.mockResolvedValue(mockAttributes);

        const result = await controller.getRequestAttributesForConfig('config-123', mockUserContext);

        expect(result).toEqual(mockAttributes);
        expect(service.getRequestAttributesForConfig).toHaveBeenCalledWith('config-123', mockUserContext.userId, mockUserContext.roles);
      });

      it('should handle NotFoundException for nonexistent config', async () => {
        service.getRequestAttributesForConfig.mockRejectedValue(
          new NotFoundException('Configuration not found')
        );

        await expect(controller.getRequestAttributesForConfig('nonexistent', mockUserContext)).rejects.toThrow(
          NotFoundException
        );
      });
    });
  });

  describe('Metric Names Endpoint', () => {
    describe('getMetricNames', () => {
      it('should return metric names without test run filter', async () => {
        const mockMetricNames = ['response_time', 'error_rate', 'throughput'];
        service.getMetricNames.mockResolvedValue(mockMetricNames);

        const result = await controller.getMetricNames(undefined, mockUserContext);

        expect(result).toEqual(mockMetricNames);
        expect(service.getMetricNames).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, undefined);
      });

      it('should return metric names filtered by test run', async () => {
        const mockMetricNames = ['response_time'];
        service.getMetricNames.mockResolvedValue(mockMetricNames);

        const result = await controller.getMetricNames('test-run-123', mockUserContext);

        expect(result).toEqual(mockMetricNames);
        expect(service.getMetricNames).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, 'test-run-123');
      });
    });
  });

  describe('Error Scenarios', () => {
    it('should propagate service errors to controller', async () => {
      service.findAll.mockRejectedValue(new Error('Database connection failed'));

      await expect(controller.findAll(undefined, mockUserContext)).rejects.toThrow('Database connection failed');
    });

    it('should handle validation errors from DTOs', async () => {
      const invalidDto = {} as CreateDynatraceConfigDto;
      service.create.mockRejectedValue(new BadRequestException('Validation failed'));

      await expect(controller.create(invalidDto, mockUserContext)).rejects.toThrow(BadRequestException);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty query results', async () => {
      service.findAllQuery.mockResolvedValue([]);

      const result = await controller.findAllQueries(undefined, undefined, undefined, mockUserContext);

      expect(result).toEqual([]);
    });

    it('should handle empty entity results', async () => {
      const emptyResult = {
        entities: [],
        totalCount: 0,
        pageSize: 500,
        nextPageKey: null,
      };
      service.fetchEntities.mockResolvedValue(emptyResult);

      const result = await controller.fetchEntities(undefined, undefined, undefined, undefined, undefined, mockUserContext);

      expect(result.entities).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });

    it('should handle bulk import with empty array', async () => {
      service.bulkImportQuery.mockResolvedValue([]);

      const result = await controller.bulkImportQueries([], mockUserContext, undefined);

      expect(result).toEqual([]);
    });
  });
});
