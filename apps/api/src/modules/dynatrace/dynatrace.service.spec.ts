import { Test, TestingModule } from '@nestjs/testing';
import { DynatraceService } from './dynatrace.service';
import { DynatraceRepository } from './dynatrace.repository';
import { CreateDynatraceConfigDto } from './dto/create-dynatrace-config.dto';
import { UpdateDynatraceConfigDto } from './dto/update-dynatrace-config.dto';
import { CreateDynatraceQueryDto } from './dto/create-dynatrace-query.dto';
import { UpdateDynatraceQueryDto } from './dto/update-dynatrace-query.dto';
import { CreateEntityMappingDto } from './dto/create-entity-mapping.dto';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { createAuthorizationServiceMock } from '../../../test/mocks/authorization-service.mock';
import { AuthorizationService } from '../../common/services/authorization.service';
import { Capability } from '../../constants/capabilities.constants';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('DynatraceService', () => {
  let service: DynatraceService;
  let repository: jest.Mocked<DynatraceRepository>;

  const mockUserId = 'test-user-id';
  const mockRoles = ['user'];

  const mockDynatraceConfig = {
    id: 'config-123',
    host: 'https://example.live.dynatrace.com',
    apiToken: 'dt0c01.test.token',
    dynatraceType: 'saas' as const,
    label: 'Production Dynatrace',
    platformApiToken: 'platform-token',
    perfanaTestRunIdAttribute: 'perfana-test-run-id',
    perfanaRequestNameAttribute: 'perfana-request-name',
    organizationId: 'org-123',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockDynatraceConfigMasked = {
    ...mockDynatraceConfig,
    apiToken: '[MASKED]',
    platformApiToken: '[MASKED]',
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
    organizationId: 'org-123',
    createdAt: new Date(),
    updatedAt: new Date(),
    dynatraceConfig: undefined,
  };

  const mockRepositoryFactory = () => ({
    findAll: jest.fn(),
    findByHost: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findAllQuery: jest.fn(),
    findQueryBySystemAndEnvironment: jest.fn(),
    findQueryById: jest.fn(),
    createQuery: jest.fn(),
    createQueryWithSharedUuid: jest.fn(),
    bulkCreateQueryWithSharedUuid: jest.fn(),
    updateQuery: jest.fn(),
    deleteQuery: jest.fn(),
    findDashboardByLabel: jest.fn(),
    getDistinctDashboardLabels: jest.fn(),
    getPanelTitlesForDashboard: jest.fn(),
    getEntityMappings: jest.fn(),
    getEntityMappingById: jest.fn(),
    createEntityMapping: jest.fn(),
    deleteEntityMapping: jest.fn(),
    getMetricNames: jest.fn(),
    ensureArtificialDashboardExists: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DynatraceService,
        {
          provide: DynatraceRepository,
          useValue: mockRepositoryFactory(),
        },
        {
          provide: AuthorizationService,
          useValue: createAuthorizationServiceMock(),
        },
      ],
    }).compile();

    service = module.get<DynatraceService>(DynatraceService);
    repository = module.get(DynatraceRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Configuration Management', () => {
    describe('findAll', () => {
      it('should return all Dynatrace configurations', async () => {
        const mockConfigs = [mockDynatraceConfig];
        repository.findAll.mockResolvedValue(mockConfigs);

        const result = await service.findAll(mockUserId, mockRoles);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(expect.objectContaining(mockDynatraceConfigMasked));
        expect(result[0]).toHaveProperty('_permissions');
        expect(repository.findAll).toHaveBeenCalledTimes(1);
      });

      it('should return empty array when no configurations exist', async () => {
        repository.findAll.mockResolvedValue([]);

        const result = await service.findAll(mockUserId, mockRoles);

        expect(result).toEqual([]);
      });
    });

    describe('findByHost', () => {
      it('should return configuration by host', async () => {
        repository.findByHost.mockResolvedValue(mockDynatraceConfig);

        const result = await service.findByHost('https://example.live.dynatrace.com', mockUserId, mockRoles);

        expect(result).toEqual(expect.objectContaining(mockDynatraceConfigMasked));
        expect(result).toHaveProperty('_permissions');
        expect(repository.findByHost).toHaveBeenCalledWith('https://example.live.dynatrace.com');
      });

      it('should throw NotFoundException when host not found', async () => {
        repository.findByHost.mockResolvedValue(null);

        await expect(service.findByHost('https://nonexistent.com', mockUserId, mockRoles)).rejects.toThrow(NotFoundException);
        await expect(service.findByHost('https://nonexistent.com', mockUserId, mockRoles)).rejects.toThrow(
          'Dynatrace configuration for host https://nonexistent.com not found'
        );
      });
    });

    describe('create', () => {
      const createDto: CreateDynatraceConfigDto = {
        host: 'https://example.live.dynatrace.com/',
        apiToken: 'dt0c01.test.token',
        dynatraceType: 'saas',
        label: 'Test Dynatrace',
        platformApiToken: 'platform-token',
      };

      it('should create new configuration with normalized URL', async () => {
        repository.findByHost.mockResolvedValue(null);
        repository.create.mockResolvedValue(mockDynatraceConfig);
        mockedAxios.get.mockResolvedValue({
          data: { totalCount: 100 },
        });

        const result = await service.create(createDto, mockUserId, mockRoles);

        expect(result).toEqual(mockDynatraceConfigMasked);
        expect(repository.findByHost).toHaveBeenCalledWith('https://example.live.dynatrace.com');
        expect(repository.create).toHaveBeenCalledWith({
          host: 'https://example.live.dynatrace.com',
          api_token: createDto.apiToken,
          dynatrace_type: createDto.dynatraceType,
          label: createDto.label,
          platform_api_token: createDto.platformApiToken,
          created_by: mockUserId,
          updated_by: mockUserId,
          organization_id: undefined,
        });
      });

      it('should normalize URL by removing trailing slashes', async () => {
        const dtoWithSlashes = { ...createDto, host: 'https://example.com///' };
        repository.findByHost.mockResolvedValue(null);
        repository.create.mockResolvedValue(mockDynatraceConfig);
        mockedAxios.get.mockResolvedValue({ data: { totalCount: 100 } });

        await service.create(dtoWithSlashes, mockUserId, mockRoles);

        expect(repository.findByHost).toHaveBeenCalledWith('https://example.com');
        expect(repository.create).toHaveBeenCalledWith(
          expect.objectContaining({
            host: 'https://example.com',
          })
        );
      });

      it('should throw ConflictException when configuration already exists', async () => {
        repository.findByHost.mockResolvedValue(mockDynatraceConfig);

        await expect(service.create(createDto, mockUserId, mockRoles)).rejects.toThrow(ConflictException);
        await expect(service.create(createDto, mockUserId, mockRoles)).rejects.toThrow(
          'Configuration for host https://example.live.dynatrace.com already exists'
        );
      });

      it('should save configuration even when connection test fails', async () => {
        repository.findByHost.mockResolvedValue(null);
        repository.create.mockResolvedValue(mockDynatraceConfig);
        mockedAxios.get.mockRejectedValue(new Error('Connection failed'));

        const result = await service.create(createDto, mockUserId, mockRoles);

        expect(result).toEqual(mockDynatraceConfigMasked);
        expect(repository.create).toHaveBeenCalled();
      });

      it('should use default dynatraceType when not provided', async () => {
        const dtoWithoutType = { ...createDto };
        delete (dtoWithoutType as any).dynatraceType;

        repository.findByHost.mockResolvedValue(null);
        repository.create.mockResolvedValue(mockDynatraceConfig);
        mockedAxios.get.mockResolvedValue({ data: { totalCount: 100 } });

        await service.create(dtoWithoutType, mockUserId, mockRoles);

        expect(repository.create).toHaveBeenCalledWith(
          expect.objectContaining({
            dynatrace_type: 'saas',
          })
        );
      });
    });

    describe('update', () => {
      const updateDto: UpdateDynatraceConfigDto = {
        perfanaTestRunIdAttribute: 'new-test-run-id',
        perfanaRequestNameAttribute: 'new-request-name',
        label: 'Updated Label',
        platformApiToken: 'new-platform-token',
      };

      it('should update configuration successfully', async () => {
        repository.findById.mockResolvedValue(mockDynatraceConfig);
        const updatedConfig = { ...mockDynatraceConfig, ...updateDto };
        repository.update.mockResolvedValue(updatedConfig);

        const result = await service.update('config-123', updateDto, mockUserId, mockRoles);

        expect(result).toEqual({ ...updatedConfig, apiToken: '[MASKED]', platformApiToken: '[MASKED]' });
        expect(repository.findById).toHaveBeenCalledWith('config-123');
        expect(repository.update).toHaveBeenCalledWith('config-123', {
          perfana_test_run_id_attribute: updateDto.perfanaTestRunIdAttribute,
          perfana_request_name_attribute: updateDto.perfanaRequestNameAttribute,
          label: updateDto.label,
          platform_api_token: updateDto.platformApiToken,
          updated_by: mockUserId,
        });
      });

      it('should throw NotFoundException when configuration not found', async () => {
        repository.findById.mockResolvedValue(null);

        await expect(service.update('nonexistent', updateDto, mockUserId, mockRoles)).rejects.toThrow(NotFoundException);
        await expect(service.update('nonexistent', updateDto, mockUserId, mockRoles)).rejects.toThrow(
          'Dynatrace configuration with ID nonexistent not found'
        );
      });
    });

    describe('delete', () => {
      it('should delete configuration successfully', async () => {
        repository.findById.mockResolvedValue(mockDynatraceConfig);
        repository.delete.mockResolvedValue(undefined);

        await service.delete('config-123', mockUserId, mockRoles);

        expect(repository.findById).toHaveBeenCalledWith('config-123');
        expect(repository.delete).toHaveBeenCalledWith('config-123');
      });
    });
  });

  describe('Connection Testing', () => {
    describe('testConnection', () => {
      it('should successfully test connection', async () => {
        mockedAxios.get.mockResolvedValue({
          data: { totalCount: 150 },
        });

        const result = await service.testConnection('https://example.com', 'test-token');

        expect(result).toEqual({
          success: true,
          version: 'Entities API v2 (150 entities available)',
        });
        expect(mockedAxios.get).toHaveBeenCalledWith(
          'https://example.com/api/v2/entities',
          expect.objectContaining({
            headers: {
              Authorization: 'Api-Token test-token',
              'Content-Type': 'application/json',
            },
            params: {
              entitySelector: 'type("SERVICE")',
              pageSize: 1,
            },
            timeout: 10000,
          })
        );
      });

      it('should handle 401 unauthorized error', async () => {
        mockedAxios.get.mockRejectedValue({
          isAxiosError: true,
          response: { status: 401 },
        });
        mockedAxios.isAxiosError.mockReturnValue(true);

        await expect(service.testConnection('https://example.com', 'invalid-token')).rejects.toThrow(
          BadRequestException
        );
        await expect(service.testConnection('https://example.com', 'invalid-token')).rejects.toThrow(
          'Invalid API token'
        );
      });

      it('should handle 403 forbidden error', async () => {
        mockedAxios.get.mockRejectedValue({
          isAxiosError: true,
          response: { status: 403 },
        });
        mockedAxios.isAxiosError.mockReturnValue(true);

        await expect(service.testConnection('https://example.com', 'test-token')).rejects.toThrow(
          'API token lacks required permissions'
        );
      });

      it('should handle 404 not found error', async () => {
        mockedAxios.get.mockRejectedValue({
          isAxiosError: true,
          response: { status: 404 },
        });
        mockedAxios.isAxiosError.mockReturnValue(true);

        await expect(service.testConnection('https://example.com', 'test-token')).rejects.toThrow(
          'Dynatrace API endpoint not found'
        );
      });

      it('should handle connection refused error', async () => {
        mockedAxios.get.mockRejectedValue({
          isAxiosError: true,
          code: 'ECONNREFUSED',
        });
        mockedAxios.isAxiosError.mockReturnValue(true);

        await expect(service.testConnection('https://example.com', 'test-token')).rejects.toThrow(
          'Cannot connect to Dynatrace server'
        );
      });

      it('should handle invalid response', async () => {
        mockedAxios.get.mockResolvedValue({ data: null });

        await expect(service.testConnection('https://example.com', 'test-token')).rejects.toThrow(
          'Invalid response from Dynatrace API'
        );
      });

      it('should normalize URL before testing connection', async () => {
        mockedAxios.get.mockResolvedValue({
          data: { totalCount: 100 },
        });

        await service.testConnection('https://example.com///', 'test-token');

        expect(mockedAxios.get).toHaveBeenCalledWith(
          'https://example.com/api/v2/entities',
          expect.any(Object)
        );
      });
    });
  });

  describe('Entity Management', () => {
    describe('fetchEntities', () => {
      it('should fetch entities with specific config ID', async () => {
        repository.findById.mockResolvedValue(mockDynatraceConfig);
        mockedAxios.get.mockResolvedValue({
          data: {
            entities: [{ entityId: 'entity-1', displayName: 'Service 1', type: 'SERVICE' }],
            totalCount: 1,
            pageSize: 500,
          },
        });

        const result = await service.fetchEntities(mockUserId, mockRoles, undefined, undefined, 'config-123');

        expect(result).toEqual({
          entities: [{ entityId: 'entity-1', displayName: 'Service 1', type: 'SERVICE' }],
          totalCount: 1,
          pageSize: 500,
          nextPageKey: null,
        });
        expect(repository.findById).toHaveBeenCalledWith('config-123');
      });

      it('should fetch entities with filters', async () => {
        repository.findAll.mockResolvedValue([mockDynatraceConfig]);
        mockedAxios.get.mockResolvedValue({
          data: {
            entities: [],
            totalCount: 0,
            pageSize: 500,
          },
        });

        await service.fetchEntities(mockUserId, mockRoles, 'SERVICE', 'payment-service');

        expect(mockedAxios.get).toHaveBeenCalledWith(
          expect.stringContaining('/api/v2/entities'),
          expect.objectContaining({
            params: expect.objectContaining({
              entitySelector: 'type("SERVICE"),entityName.contains("payment-service")',
            }),
          })
        );
      });

      it('should throw NotFoundException when config not found', async () => {
        repository.findById.mockResolvedValue(null);

        await expect(service.fetchEntities(mockUserId, mockRoles, undefined, undefined, 'nonexistent')).rejects.toThrow(
          NotFoundException
        );
      });

      it('should throw BadRequestException when no config exists for fallback', async () => {
        repository.findAll.mockResolvedValue([]);

        await expect(service.fetchEntities(mockUserId, mockRoles)).rejects.toThrow(BadRequestException);
        await expect(service.fetchEntities(mockUserId, mockRoles)).rejects.toThrow(
          'No Dynatrace instance configured'
        );
      });

      it('should handle 401 error from Dynatrace API', async () => {
        repository.findAll.mockResolvedValue([mockDynatraceConfig]);
        mockedAxios.get.mockRejectedValue({
          isAxiosError: true,
          response: { status: 401 },
        });
        mockedAxios.isAxiosError.mockReturnValue(true);

        await expect(service.fetchEntities(mockUserId, mockRoles)).rejects.toThrow(
          'Invalid API token for Dynatrace entities API'
        );
      });

      it('should handle 404 error with suggested URL', async () => {
        repository.findAll.mockResolvedValue([mockDynatraceConfig]);
        mockedAxios.get.mockRejectedValue({
          isAxiosError: true,
          response: {
            status: 404,
            data: {
              error: {
                message: "go to 'https://correct-url.dynatrace.com'",
              },
            },
          },
          config: { url: 'https://wrong-url.dynatrace.com/api/v2/entities' },
        });
        mockedAxios.isAxiosError.mockReturnValue(true);

        await expect(service.fetchEntities(mockUserId, mockRoles)).rejects.toThrow(
          'Dynatrace suggests using: https://correct-url.dynatrace.com'
        );
      });

      it('should sanitize entity name to prevent injection', async () => {
        repository.findAll.mockResolvedValue([mockDynatraceConfig]);
        mockedAxios.get.mockResolvedValue({
          data: { entities: [], totalCount: 0, pageSize: 500 },
        });

        await service.fetchEntities(mockUserId, mockRoles, 'SERVICE', 'test"injection\\attack');

        expect(mockedAxios.get).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            params: expect.objectContaining({
              entitySelector: expect.stringContaining('test\\"injection\\\\attack'),
            }),
          })
        );
      });
    });

    describe('fetchRequestAttributes', () => {
      it('should fetch request attributes successfully', async () => {
        repository.findByHost.mockResolvedValue(mockDynatraceConfig);
        mockedAxios.get.mockResolvedValue({
          data: {
            values: [
              { name: 'perfana-test-run-id', id: 'attr-1' },
              { name: 'perfana-request-name', id: 'attr-2' },
              { name: 'other-attribute', id: 'attr-3' },
            ],
          },
        });

        const result = await service.fetchRequestAttributes('https://example.com', mockUserId, mockRoles);

        expect(result).toEqual({
          all: expect.arrayContaining([
            { name: 'perfana-test-run-id', id: 'attr-1' },
          ]),
          perfanaAttributes: expect.arrayContaining([
            { name: 'perfana-test-run-id', id: 'attr-1' },
            { name: 'perfana-request-name', id: 'attr-2' },
          ]),
        });
        expect(repository.findByHost).toHaveBeenCalledWith('https://example.com');
      });

      it('should return empty array when no attributes found', async () => {
        repository.findByHost.mockResolvedValue(mockDynatraceConfig);
        mockedAxios.get.mockResolvedValue({ data: {} });

        const result = await service.fetchRequestAttributes('https://example.com', mockUserId, mockRoles);

        expect(result).toEqual([]);
      });

      it('should throw NotFoundException when host not found', async () => {
        repository.findByHost.mockResolvedValue(null);

        await expect(service.fetchRequestAttributes('https://nonexistent.com', mockUserId, mockRoles)).rejects.toThrow(
          NotFoundException
        );
      });

      it('should handle axios errors', async () => {
        repository.findByHost.mockResolvedValue(mockDynatraceConfig);
        mockedAxios.get.mockRejectedValue({
          isAxiosError: true,
          message: 'Network error',
        });
        mockedAxios.isAxiosError.mockReturnValue(true);

        await expect(service.fetchRequestAttributes('https://example.com', mockUserId, mockRoles)).rejects.toThrow(
          BadRequestException
        );
      });
    });

    describe('getRequestAttributesForConfig', () => {
      it('should get request attributes for config ID', async () => {
        repository.findById.mockResolvedValue(mockDynatraceConfig);
        repository.findByHost.mockResolvedValue(mockDynatraceConfig);
        mockedAxios.get.mockResolvedValue({
          data: { values: [] },
        });

        await service.getRequestAttributesForConfig('config-123', mockUserId, mockRoles);

        expect(repository.findById).toHaveBeenCalledWith('config-123');
      });

      it('should throw NotFoundException when config not found', async () => {
        repository.findById.mockResolvedValue(null);

        await expect(service.getRequestAttributesForConfig('nonexistent', mockUserId, mockRoles)).rejects.toThrow(
          NotFoundException
        );
      });
    });
  });

  describe('DQL Query Management', () => {
    describe('findAllQuery', () => {
      it('should return all DQL queries', async () => {
        const mockQueries = [mockDynatraceQuery];
        repository.findAllQuery.mockResolvedValue(mockQueries);

        const result = await service.findAllQuery(mockUserId, mockRoles);

        expect(result).toEqual(mockQueries);
        expect(repository.findAllQuery).toHaveBeenCalledTimes(1);
      });
    });

    describe('findQueryBySystemAndEnvironment', () => {
      it('should find queries by system, environment, and workload', async () => {
        const mockQueries = [mockDynatraceQuery];
        repository.findQueryBySystemAndEnvironment.mockResolvedValue(mockQueries);

        const result = await service.findQueryBySystemAndEnvironment('sys-123', 'production', 'load-test', mockUserId, mockRoles);

        expect(result).toEqual(mockQueries);
        expect(repository.findQueryBySystemAndEnvironment).toHaveBeenCalledWith(
          'sys-123',
          'production',
          'load-test'
        );
      });
    });

    describe('findQueryById', () => {
      it('should find query by ID', async () => {
        repository.findQueryById.mockResolvedValue(mockDynatraceQuery);

        const result = await service.findQueryById('query-123', mockUserId, mockRoles);

        expect(result).toEqual(mockDynatraceQuery);
      });

      it('should throw NotFoundException when query not found', async () => {
        repository.findQueryById.mockResolvedValue(null);

        await expect(service.findQueryById('nonexistent', mockUserId, mockRoles)).rejects.toThrow(NotFoundException);
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
        repository.findById.mockResolvedValue(mockDynatraceConfig);
        repository.createQuery.mockResolvedValue(mockDynatraceQuery);

        const result = await service.createQuery(createQueryDto, mockUserId, mockRoles);

        expect(result).toEqual(mockDynatraceQuery);
        expect(repository.createQuery).toHaveBeenCalledWith(
          createQueryDto,
          expect.objectContaining({
            organizationId: 'org-123',
            createdBy: mockUserId,
            updatedBy: mockUserId,
          }),
        );
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

      it('should reuse existing UUID when dashboard label exists', async () => {
        const existingUuid = 'existing-uuid-123';
        repository.findById.mockResolvedValue(mockDynatraceConfig);
        repository.findDashboardByLabel.mockResolvedValue(existingUuid);
        repository.createQueryWithSharedUuid.mockResolvedValue(mockDynatraceQuery);

        const result = await service.createQuerySmart(createQueryDto, mockUserId, mockRoles);

        expect(result).toEqual(mockDynatraceQuery);
        expect(repository.findDashboardByLabel).toHaveBeenCalledWith('Performance Dashboard');
        expect(repository.createQueryWithSharedUuid).toHaveBeenCalledWith(
          createQueryDto,
          existingUuid,
          expect.objectContaining({
            organizationId: 'org-123',
            createdBy: mockUserId,
            updatedBy: mockUserId,
          }),
        );
      });

      it('should generate new UUID when dashboard label does not exist', async () => {
        repository.findById.mockResolvedValue(mockDynatraceConfig);
        repository.findDashboardByLabel.mockResolvedValue(null);
        repository.createQueryWithSharedUuid.mockResolvedValue(mockDynatraceQuery);

        const result = await service.createQuerySmart(createQueryDto, mockUserId, mockRoles);

        expect(result).toEqual(mockDynatraceQuery);
        expect(repository.createQueryWithSharedUuid).toHaveBeenCalledWith(
          createQueryDto,
          expect.any(String),
          expect.objectContaining({
            organizationId: 'org-123',
            createdBy: mockUserId,
            updatedBy: mockUserId,
          }),
        );
      });
    });

    describe('bulkImportQuery', () => {
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

      it('should return empty array for empty input', async () => {
        const result = await service.bulkImportQuery([], mockUserId, mockRoles);

        expect(result).toEqual([]);
      });

      it('should generate shared UUID for all metrics by default', async () => {
        repository.findById.mockResolvedValue(mockDynatraceConfig);
        repository.bulkCreateQueryWithSharedUuid.mockResolvedValue([mockDynatraceQuery]);

        const result = await service.bulkImportQuery(dtoList, mockUserId, mockRoles, true);

        expect(result).toEqual([mockDynatraceQuery]);
        expect(repository.bulkCreateQueryWithSharedUuid).toHaveBeenCalledWith(
          dtoList,
          expect.any(String),
          expect.objectContaining({
            organizationId: 'org-123',
            createdBy: mockUserId,
            updatedBy: mockUserId,
          }),
        );
      });

      it('should use smart logic for individual entries when generateSharedUuid is false', async () => {
        repository.findById.mockResolvedValue(mockDynatraceConfig);
        repository.findDashboardByLabel.mockResolvedValue(null);
        repository.createQueryWithSharedUuid.mockResolvedValue(mockDynatraceQuery);

        const result = await service.bulkImportQuery(dtoList, mockUserId, mockRoles, false);

        expect(result).toEqual([mockDynatraceQuery]);
        expect(repository.findDashboardByLabel).toHaveBeenCalled();
      });
    });

    describe('updateQuery', () => {
      const updateQueryDto: UpdateDynatraceQueryDto = {
        query: 'timeseries updated_query = avg(dt.service.response_time)',
        metricUnit: 'seconds',
      };

      it('should update query successfully', async () => {
        repository.findQueryById.mockResolvedValue(mockDynatraceQuery);
        const updatedQuery = { ...mockDynatraceQuery, ...updateQueryDto };
        repository.updateQuery.mockResolvedValue(updatedQuery);

        const result = await service.updateQuery('query-123', updateQueryDto, mockUserId, mockRoles);

        expect(result).toEqual(updatedQuery);
        expect(repository.updateQuery).toHaveBeenCalledWith(
          'query-123',
          updateQueryDto,
          expect.objectContaining({ updatedBy: mockUserId }),
        );
      });

      it('should throw NotFoundException when query not found', async () => {
        repository.findQueryById.mockResolvedValue(null);

        await expect(service.updateQuery('nonexistent', updateQueryDto, mockUserId, mockRoles)).rejects.toThrow(
          NotFoundException
        );
      });

      it('should throw ForbiddenException when caller lacks IntegrationDynatraceUpdate cap in the query org', async () => {
        // Regression: org-non-admins were able to PATCH /api/dynatrace/queries/:id
        // because updateQuery had a Phase-4 TODO instead of a real auth check.
        repository.findQueryById.mockResolvedValue(mockDynatraceQuery);
        const authz = service['authzService'] as unknown as {
          isGlobalAdmin: jest.Mock;
          getCapabilities: jest.Mock;
        };
        authz.isGlobalAdmin.mockReturnValueOnce(false);
        authz.getCapabilities.mockResolvedValueOnce([]); // member with no integration caps

        await expect(
          service.updateQuery('query-123', updateQueryDto, mockUserId, mockRoles),
        ).rejects.toThrow(ForbiddenException);
        expect(repository.updateQuery).not.toHaveBeenCalled();
      });

      it('should throw ForbiddenException when row has null organizationId for non-admins', async () => {
        // Pre-backfill rows are explicitly denied — only the backfill migration
        // (1777600000000) should re-open them by setting organizationId.
        // Post-C35: enforcement is via `getCapabilities(userId, roles, null)` which
        // returns [] for non-admins in production (CapabilitiesService.compute on
        // null org + non-admin systemRoles yields no caps from any source).
        repository.findQueryById.mockResolvedValue({ ...mockDynatraceQuery, organizationId: undefined });
        const authz = service['authzService'] as unknown as {
          isGlobalAdmin: jest.Mock;
          getCapabilities: jest.Mock;
        };
        authz.isGlobalAdmin.mockReturnValueOnce(false);
        authz.getCapabilities.mockResolvedValueOnce([]);

        await expect(
          service.updateQuery('query-123', updateQueryDto, mockUserId, mockRoles),
        ).rejects.toThrow(ForbiddenException);
      });
    });

    describe('deleteQuery', () => {
      it('should delete query successfully', async () => {
        repository.findQueryById.mockResolvedValue(mockDynatraceQuery);
        repository.deleteQuery.mockResolvedValue(undefined);

        await service.deleteQuery('query-123', mockUserId, mockRoles);

        expect(repository.deleteQuery).toHaveBeenCalledWith('query-123');
      });

      it('should throw NotFoundException when query not found', async () => {
        repository.findQueryById.mockResolvedValue(null);

        await expect(service.deleteQuery('nonexistent', mockUserId, mockRoles)).rejects.toThrow(NotFoundException);
      });

      it('should throw ForbiddenException when caller lacks IntegrationDynatraceDelete cap in the query org', async () => {
        // Regression: the original investigation log showed user 41f76071
        // (org-member) successfully deleting a DQL query because deleteQuery
        // skipped the auth check entirely.
        repository.findQueryById.mockResolvedValue(mockDynatraceQuery);
        const authz = service['authzService'] as unknown as {
          isGlobalAdmin: jest.Mock;
          getCapabilities: jest.Mock;
        };
        authz.isGlobalAdmin.mockReturnValueOnce(false);
        authz.getCapabilities.mockResolvedValueOnce([]);

        await expect(
          service.deleteQuery('query-123', mockUserId, mockRoles),
        ).rejects.toThrow(ForbiddenException);
        expect(repository.deleteQuery).not.toHaveBeenCalled();
      });
    });
  });

  describe('SLO Support Methods', () => {
    describe('getDistinctDashboardLabels', () => {
      it('should return distinct dashboard labels', async () => {
        const mockDashboards = [
          { dashboardLabel: 'Performance Dashboard' },
          { dashboardLabel: 'System Dashboard' },
        ];
        repository.getDistinctDashboardLabels.mockResolvedValue(mockDashboards);

        const result = await service.getDistinctDashboardLabels('sys-123', 'production', 'load-test', mockUserId, mockRoles);

        expect(result).toEqual(mockDashboards);
        expect(repository.getDistinctDashboardLabels).toHaveBeenCalledWith(
          'sys-123',
          'production',
          'load-test'
        );
      });
    });

    describe('getPanelTitlesForDashboard', () => {
      it('should return panel titles for dashboard', async () => {
        const mockMetrics = [
          {
            panelTitle: 'Response Time',
            panelId: 1,
            applicationDashboardId: 'dash-123',
            metricUnit: 'ms',
          },
        ];
        repository.getPanelTitlesForDashboard.mockResolvedValue(mockMetrics as any);

        const result = await service.getPanelTitlesForDashboard(
          'sys-123',
          'production',
          'load-test',
          'Performance Dashboard',
          mockUserId,
          mockRoles
        );

        expect(result).toEqual(mockMetrics);
      });
    });
  });

  describe('Entity Mapping Methods', () => {
    describe('getEntityMappings', () => {
      it('should return entity mappings', async () => {
        const mockMappings = [
          {
            id: 'mapping-1',
            dynatraceConfigId: 'config-123',
            systemUnderTestId: 'sys-123',
            testEnvironment: 'production',
            workload: 'load-test',
            entityId: 'entity-123',
            entityDisplayName: 'Service 1',
            entityType: 'SERVICE',
            level: 'sut_testenv_workload' as const,
            dynatraceLabel: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        repository.getEntityMappings.mockResolvedValue(mockMappings as any);

        const result = await service.getEntityMappings(mockUserId, mockRoles, 'sys-123', 'production', 'load-test');

        expect(result).toEqual(mockMappings);
      });

      it('should return all mappings when no filters provided', async () => {
        const mockMappings: any[] = [];
        repository.getEntityMappings.mockResolvedValue(mockMappings);

        const result = await service.getEntityMappings(mockUserId, mockRoles);

        expect(result).toEqual(mockMappings);
        expect(repository.getEntityMappings).toHaveBeenCalledWith(undefined, undefined, undefined);
      });
    });

    describe('createEntityMapping', () => {
      const createMappingDto: CreateEntityMappingDto = {
        dynatraceConfigId: 'config-123',
        systemUnderTestId: 'sys-123',
        testEnvironment: 'production',
        workload: 'load-test',
        entityId: 'entity-123',
        entityDisplayName: 'Service 1',
        entityType: 'SERVICE',
        level: 'sut_testenv_workload' as const,
      };

      it('should create entity mapping successfully', async () => {
        const mockMapping = {
          id: 'mapping-1',
          ...createMappingDto,
          dynatraceLabel: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        repository.findById.mockResolvedValue(mockDynatraceConfig);
        repository.createEntityMapping.mockResolvedValue(mockMapping as any);

        const result = await service.createEntityMapping(createMappingDto, mockUserId, mockRoles);

        expect(result).toEqual(mockMapping);
        expect(repository.createEntityMapping).toHaveBeenCalledWith(
          createMappingDto,
          expect.objectContaining({
            organizationId: 'org-123',
            createdBy: mockUserId,
            updatedBy: mockUserId,
          }),
        );
      });

      it('should throw ConflictException for duplicate mapping', async () => {
        repository.findById.mockResolvedValue(mockDynatraceConfig);
        repository.createEntityMapping.mockRejectedValue(
          new Error('Entity already mapped to this system/environment/workload')
        );

        await expect(service.createEntityMapping(createMappingDto, mockUserId, mockRoles)).rejects.toThrow(
          ConflictException
        );
      });
    });

    describe('deleteEntityMapping', () => {
      it('should delete entity mapping successfully', async () => {
        const mockMapping = {
          id: 'mapping-1',
          dynatraceConfigId: 'config-123',
          systemUnderTestId: 'sys-123',
          testEnvironment: 'production',
          workload: 'load-test',
          entityId: 'entity-123',
          entityDisplayName: 'Service 1',
          entityType: 'SERVICE',
          level: 'sut' as const,
          dynatraceLabel: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        repository.getEntityMappingById.mockResolvedValue(mockMapping as any);
        repository.deleteEntityMapping.mockResolvedValue(undefined);

        await service.deleteEntityMapping('mapping-1', mockUserId, mockRoles);

        expect(repository.deleteEntityMapping).toHaveBeenCalledWith('mapping-1');
      });

      it('should throw NotFoundException when mapping not found', async () => {
        repository.getEntityMappingById.mockResolvedValue(null);

        await expect(service.deleteEntityMapping('nonexistent', mockUserId, mockRoles)).rejects.toThrow(
          NotFoundException
        );
      });
    });
  });

  describe('Metric Names', () => {
    describe('getMetricNames', () => {
      it('should return metric names for test run', async () => {
        const mockMetricNames = ['response_time', 'error_rate', 'throughput'];
        repository.getMetricNames.mockResolvedValue(mockMetricNames);

        const result = await service.getMetricNames(mockUserId, mockRoles, 'test-run-123');

        expect(result).toEqual(mockMetricNames);
        expect(repository.getMetricNames).toHaveBeenCalledWith('test-run-123');
      });

      it('should return all metric names when no test run specified', async () => {
        const mockMetricNames = ['metric1', 'metric2'];
        repository.getMetricNames.mockResolvedValue(mockMetricNames);

        const result = await service.getMetricNames(mockUserId, mockRoles);

        expect(result).toEqual(mockMetricNames);
        expect(repository.getMetricNames).toHaveBeenCalledWith(undefined);
      });
    });
  });

  describe('returns _permissions per config', () => {
    const orgId = 'org-abc';

    const configWithOrg = {
      ...mockDynatraceConfig,
      organizationId: orgId,
    };

    const configNullOrg = {
      ...mockDynatraceConfig,
      id: 'config-legacy',
      organizationId: null,
    };

    let authzService: ReturnType<typeof createAuthorizationServiceMock>;

    beforeEach(async () => {
      // Re-create module so we can grab the authzService reference with getCapabilities mock
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DynatraceService,
          {
            provide: DynatraceRepository,
            useValue: mockRepositoryFactory(),
          },
          {
            provide: AuthorizationService,
            useValue: createAuthorizationServiceMock(),
          },
        ],
      }).compile();

      service = module.get<DynatraceService>(DynatraceService);
      repository = module.get(DynatraceRepository);
      authzService = module.get(AuthorizationService) as any;
    });

    describe('findAll', () => {
      it('org-admin: every config gets update=true and delete=true', async () => {
        authzService.isGlobalAdmin.mockReturnValue(false);
        authzService.getAccessibleOrganizations.mockResolvedValue([orgId]);
        authzService.getCapabilities.mockResolvedValue([
          Capability.IntegrationDynatraceUpdate,
          Capability.IntegrationDynatraceDelete,
        ]);
        repository.findAll.mockResolvedValue([configWithOrg]);

        const result = await service.findAll(mockUserId, mockRoles);

        expect(result).toHaveLength(1);
        expect(result[0]._permissions).toEqual({ update: true, delete: true });
      });

      it('org-member: configs in their org get update=false and delete=false', async () => {
        authzService.isGlobalAdmin.mockReturnValue(false);
        authzService.getAccessibleOrganizations.mockResolvedValue([orgId]);
        // org-member has no integration mutation capabilities
        authzService.getCapabilities.mockResolvedValue([]);
        repository.findAll.mockResolvedValue([configWithOrg]);

        const result = await service.findAll(mockUserId, mockRoles);

        expect(result).toHaveLength(1);
        expect(result[0]._permissions).toEqual({ update: false, delete: false });
      });

      it('global admin: every config gets update=true and delete=true', async () => {
        authzService.isGlobalAdmin.mockReturnValue(true);
        // getCapabilities should not be called for global admin — test the result shape
        repository.findAll.mockResolvedValue([configWithOrg]);

        const result = await service.findAll(mockUserId, ['perfana-admin']);

        expect(result).toHaveLength(1);
        expect(result[0]._permissions).toEqual({ update: true, delete: true });
      });

    });

    describe('findByHost', () => {
      it('returns a config with _permissions shape', async () => {
        authzService.isGlobalAdmin.mockReturnValue(false);
        authzService.isOrganizationMember.mockResolvedValue(true);
        authzService.getCapabilities.mockResolvedValue([
          Capability.IntegrationDynatraceUpdate,
          Capability.IntegrationDynatraceDelete,
        ]);
        repository.findByHost.mockResolvedValue(configWithOrg);

        const result = await service.findByHost(configWithOrg.host, mockUserId, mockRoles);

        expect(result._permissions).toEqual({ update: true, delete: true });
      });

    });
  });
});
