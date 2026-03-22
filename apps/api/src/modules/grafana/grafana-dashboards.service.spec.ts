import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { GrafanaDashboardsService } from './grafana-dashboards.service';
import { GrafanaClientService } from './grafana-client.service';
import { GrafanaDashboard as GrafanaDashboardEntity } from '../../entities';
import {
  CreateGrafanaDashboardDto,
  UpdateGrafanaDashboardDto,
  GrafanaDashboardQuery
} from './dto/grafana-dashboard.dto';
import {
  createMockRepository,
  createMockQueryBuilder,
  MockRepository,
  MockSelectQueryBuilder,
} from '../../../test/helpers/mock-repository.factory';
import { createAuthorizationServiceMock } from '../../../test/mocks/authorization-service.mock';
import { AuthorizationService } from '../../common/services/authorization.service';

describe('GrafanaDashboardsService', () => {
  let service: GrafanaDashboardsService;
  let repository: MockRepository<GrafanaDashboardEntity>;
  let grafanaClientService: jest.Mocked<GrafanaClientService>;
  let queryBuilder: MockSelectQueryBuilder<GrafanaDashboardEntity>;

  const mockUserId = 'test-user-id';
  const mockRoles = ['user'];

  const mockDashboardEntity: GrafanaDashboardEntity = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    grafanaInstanceId: '123e4567-e89b-12d3-a456-426614174001',
    grafanaId: 1,
    datasourceType: 'influxdb',
    uid: 'dashboard-uid-123',
    slug: 'test-dashboard',
    name: 'Test Dashboard',
    uri: '/d/dashboard-uid-123/test-dashboard',
    templatingVariables: [
      {
        name: 'system_under_test',
        type: 'custom',
        query: 'system1,system2'
      }
    ],
    panels: [
      {
        id: 1,
        title: 'Test Panel',
        type: 'graph'
      }
    ],
    variables: [],
    tags: ['load-testing', 'performance'],
    usedBySut: ['system1'],
    updated: new Date('2025-01-01T00:00:00Z'),
    createdAt: new Date('2025-01-01T00:00:00Z')
  };

  const mockGrafanaInstance = {
    id: '123e4567-e89b-12d3-a456-426614174001',
    label: 'Test Grafana',
    client_url: 'http://grafana.example.com',
    server_url: 'http://grafana.example.com',
    org_id: 'org-123',
    api_key: 'test-api-key'
  };

  const mockDatasource = {
    id: 1,
    name: 'TestDB',
    type: 'influxdb',
    uid: 'datasource-uid-123',
    database: 'testdb',
    url: 'http://influx.example.com'
  };

  beforeEach(async () => {
    // Create mock query builder using factory
    queryBuilder = createMockQueryBuilder<GrafanaDashboardEntity>();

    // Create mock repository using factory
    const mockRepository = createMockRepository<GrafanaDashboardEntity>();
    mockRepository.createQueryBuilder.mockReturnValue(queryBuilder);

    const mockGrafanaClient = {
      getGrafanaInstance: jest.fn(),
      grafanaCall: jest.fn(),
      getDatasource: jest.fn(),
      getInfluxVariableValues: jest.fn(),
      getPrometheusVariableValues: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GrafanaDashboardsService,
        {
          provide: getRepositoryToken(GrafanaDashboardEntity),
          useValue: mockRepository
        },
        {
          provide: GrafanaClientService,
          useValue: mockGrafanaClient
        },
        {
          provide: AuthorizationService,
          useValue: createAuthorizationServiceMock(),
        }
      ]
    }).compile();

    service = module.get<GrafanaDashboardsService>(GrafanaDashboardsService);
    repository = module.get(getRepositoryToken(GrafanaDashboardEntity));
    grafanaClientService = module.get(GrafanaClientService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    describe('Happy Path Scenarios', () => {
      it('should return all dashboards when no filters are provided', async () => {
        // Arrange
        queryBuilder.getMany.mockResolvedValue([mockDashboardEntity]);

        // Act
        const result = await service.findAll(mockUserId, mockRoles);

        // Assert
        expect(repository.createQueryBuilder).toHaveBeenCalledWith('gd');
        expect(queryBuilder.orderBy).toHaveBeenCalledWith('gd.name', 'ASC');
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          id: mockDashboardEntity.id,
          grafana_instance_id: mockDashboardEntity.grafanaInstanceId,
          grafana_id: mockDashboardEntity.grafanaId,
          datasource_type: mockDashboardEntity.datasourceType,
          uid: mockDashboardEntity.uid,
          slug: mockDashboardEntity.slug,
          name: mockDashboardEntity.name,
          uri: mockDashboardEntity.uri,
          templating_variables: mockDashboardEntity.templatingVariables,
          panels: mockDashboardEntity.panels,
          variables: mockDashboardEntity.variables,
          tags: mockDashboardEntity.tags,
          used_by_sut: mockDashboardEntity.usedBySut,
          updated: mockDashboardEntity.updated?.toISOString(),
          created_at: mockDashboardEntity.createdAt.toISOString(),
          updated_at: mockDashboardEntity.createdAt.toISOString()
        });
      });

      it('should filter dashboards by grafanaInstanceId', async () => {
        // Arrange
        const query: GrafanaDashboardQuery = {
          grafanaInstanceId: '123e4567-e89b-12d3-a456-426614174001'
        };
        queryBuilder.getMany.mockResolvedValue([mockDashboardEntity]);

        // Act
        await service.findAll(mockUserId, mockRoles, query);

        // Assert
        expect(queryBuilder.andWhere).toHaveBeenCalledWith(
          'gd.grafanaInstanceId = :grafanaInstanceId',
          { grafanaInstanceId: query.grafanaInstanceId }
        );
      });

      it('should filter dashboards by name using case-insensitive search', async () => {
        // Arrange
        const query: GrafanaDashboardQuery = { name: 'test' };
        queryBuilder.getMany.mockResolvedValue([mockDashboardEntity]);

        // Act
        await service.findAll(mockUserId, mockRoles, query);

        // Assert
        expect(queryBuilder.andWhere).toHaveBeenCalledWith(
          'gd.name ILIKE :name',
          { name: '%test%' }
        );
      });

      it('should filter dashboards by uid', async () => {
        // Arrange
        const query: GrafanaDashboardQuery = { uid: 'dashboard-uid-123' };
        queryBuilder.getMany.mockResolvedValue([mockDashboardEntity]);

        // Act
        await service.findAll(mockUserId, mockRoles, query);

        // Assert
        expect(queryBuilder.andWhere).toHaveBeenCalledWith(
          'gd.uid = :uid',
          { uid: query.uid }
        );
      });

      it('should filter dashboards by tags', async () => {
        // Arrange
        const query: GrafanaDashboardQuery = { tags: ['load-testing'] };
        queryBuilder.getMany.mockResolvedValue([mockDashboardEntity]);

        // Act
        await service.findAll(mockUserId, mockRoles, query);

        // Assert
        expect(queryBuilder.andWhere).toHaveBeenCalledWith(
          'gd.tags && :tags',
          { tags: query.tags }
        );
      });

      it('should filter dashboards by usedBySut', async () => {
        // Arrange
        const query: GrafanaDashboardQuery = { usedBySut: 'system1' };
        queryBuilder.getMany.mockResolvedValue([mockDashboardEntity]);

        // Act
        await service.findAll(mockUserId, mockRoles, query);

        // Assert
        expect(queryBuilder.andWhere).toHaveBeenCalledWith(
          ':usedBySut = ANY(gd.usedBySut)',
          { usedBySut: query.usedBySut }
        );
      });

      it('should apply multiple filters simultaneously', async () => {
        // Arrange
        const query: GrafanaDashboardQuery = {
          grafanaInstanceId: '123e4567-e89b-12d3-a456-426614174001',
          name: 'test',
          tags: ['load-testing']
        };
        queryBuilder.getMany.mockResolvedValue([mockDashboardEntity]);

        // Act
        await service.findAll(mockUserId, mockRoles, query);

        // Assert
        // 3 user filters + 1 NOT EXISTS filter for synthetic dashboards
        expect(queryBuilder.andWhere).toHaveBeenCalledTimes(4);
        expect(queryBuilder.orderBy).toHaveBeenCalledWith('gd.name', 'ASC');
      });
    });

    describe('Edge Cases', () => {
      it('should return empty array when no dashboards exist', async () => {
        // Arrange
        queryBuilder.getMany.mockResolvedValue([]);

        // Act
        const result = await service.findAll(mockUserId, mockRoles);

        // Assert
        expect(result).toEqual([]);
      });

      it('should handle dashboards with null optional fields', async () => {
        // Arrange
        const minimalDashboard = {
          ...mockDashboardEntity,
          datasourceType: undefined,
          slug: undefined,
          uri: undefined,
          variables: undefined,
          tags: undefined,
          usedBySut: undefined,
          updated: undefined
        };
        queryBuilder.getMany.mockResolvedValue([minimalDashboard]);

        // Act
        const result = await service.findAll(mockUserId, mockRoles);

        // Assert
        expect(result[0]?.datasource_type).toBeUndefined();
        expect(result[0]?.slug).toBeUndefined();
        expect(result[0]?.updated).toBeUndefined();
      });

      it('should handle empty tags array in query', async () => {
        // Arrange
        const query: GrafanaDashboardQuery = { tags: [] };
        queryBuilder.getMany.mockResolvedValue([]);

        // Act
        await service.findAll(mockUserId, mockRoles, query);

        // Assert
        expect(queryBuilder.andWhere).not.toHaveBeenCalledWith(
          expect.stringContaining('tags'),
          expect.anything()
        );
      });
    });

    describe('Error Scenarios', () => {
      it('should throw error when database query fails', async () => {
        // Arrange
        const dbError = new Error('Database connection failed');
        queryBuilder.getMany.mockRejectedValue(dbError);

        // Act & Assert
        await expect(service.findAll()).rejects.toThrow('Database connection failed');
      });
    });
  });

  describe('findOne', () => {
    describe('Happy Path Scenarios', () => {
      it('should return a dashboard by ID', async () => {
        // Arrange
        repository.findOne.mockResolvedValue(mockDashboardEntity);

        // Act
        const result = await service.findOne(mockDashboardEntity.id, mockUserId, mockRoles);

        // Assert
        expect(repository.findOne).toHaveBeenCalledWith({ where: { id: mockDashboardEntity.id } });
        expect(result).toEqual({
          id: mockDashboardEntity.id,
          grafana_instance_id: mockDashboardEntity.grafanaInstanceId,
          grafana_id: mockDashboardEntity.grafanaId,
          datasource_type: mockDashboardEntity.datasourceType,
          uid: mockDashboardEntity.uid,
          slug: mockDashboardEntity.slug,
          name: mockDashboardEntity.name,
          uri: mockDashboardEntity.uri,
          templating_variables: mockDashboardEntity.templatingVariables,
          panels: mockDashboardEntity.panels,
          variables: mockDashboardEntity.variables,
          tags: mockDashboardEntity.tags,
          used_by_sut: mockDashboardEntity.usedBySut,
          updated: mockDashboardEntity.updated?.toISOString(),
          created_at: mockDashboardEntity.createdAt.toISOString(),
          updated_at: mockDashboardEntity.createdAt.toISOString()
        });
      });
    });

    describe('Error Scenarios', () => {
      it('should throw NotFoundException when dashboard does not exist', async () => {
        // Arrange
        const dashboardId = 'non-existent-id';
        repository.findOne.mockResolvedValue(null);

        // Act & Assert
        await expect(service.findOne(dashboardId, mockUserId, mockRoles)).rejects.toThrow(NotFoundException);
        await expect(service.findOne(dashboardId, mockUserId, mockRoles)).rejects.toThrow(
          `Grafana dashboard with ID ${dashboardId} not found`
        );
      });

      it('should handle database errors gracefully with safe error pattern', async () => {
        // Arrange
        const dashboardId = 'test-id';
        const dbError = new Error('Connection timeout');
        repository.findOne.mockRejectedValue(dbError);

        // Act & Assert
        await expect(service.findOne(dashboardId, mockUserId, mockRoles)).rejects.toThrow(
          'Failed to fetch Grafana dashboard: Connection timeout'
        );
      });

      it('should handle non-Error objects with safe error pattern', async () => {
        // Arrange
        const dashboardId = 'test-id';
        repository.findOne.mockRejectedValue('String error');

        // Act & Assert
        await expect(service.findOne(dashboardId, mockUserId, mockRoles)).rejects.toThrow(
          'Failed to fetch Grafana dashboard: Unknown error'
        );
      });
    });
  });

  describe('create', () => {
    describe('Happy Path Scenarios', () => {
      it('should create a new dashboard with all fields', async () => {
        // Arrange
        const createDto: CreateGrafanaDashboardDto = {
          grafanaInstanceId: mockDashboardEntity.grafanaInstanceId,
          grafanaId: mockDashboardEntity.grafanaId,
          datasourceType: 'influxdb',
          uid: mockDashboardEntity.uid,
          slug: mockDashboardEntity.slug,
          name: mockDashboardEntity.name,
          uri: mockDashboardEntity.uri,
          templatingVariables: mockDashboardEntity.templatingVariables,
          panels: mockDashboardEntity.panels!,
          variables: mockDashboardEntity.variables,
          tags: mockDashboardEntity.tags,
          usedBySut: mockDashboardEntity.usedBySut
        };

        repository.create.mockReturnValue(mockDashboardEntity as any);
        repository.save.mockResolvedValue(mockDashboardEntity);

        // Act
        const result = await service.create(createDto, mockUserId, mockRoles);

        // Assert
        expect(repository.create).toHaveBeenCalledWith({
          grafanaInstanceId: createDto.grafanaInstanceId,
          grafanaId: createDto.grafanaId,
          datasourceType: createDto.datasourceType,
          uid: createDto.uid,
          slug: createDto.slug,
          name: createDto.name,
          uri: createDto.uri,
          templatingVariables: createDto.templatingVariables || [],
          panels: createDto.panels || [],
          variables: createDto.variables || [],
          tags: createDto.tags || [],
          usedBySut: createDto.usedBySut || [],
          updated: expect.any(Date)
        });
        expect(repository.save).toHaveBeenCalledWith(mockDashboardEntity);
        expect(result.id).toBe(mockDashboardEntity.id);
        expect(result.name).toBe(createDto.name);
      });

      it('should create dashboard with default empty arrays for optional fields', async () => {
        // Arrange
        const minimalDto: CreateGrafanaDashboardDto = {
          grafanaInstanceId: mockDashboardEntity.grafanaInstanceId,
          grafanaId: mockDashboardEntity.grafanaId,
          uid: mockDashboardEntity.uid,
          name: 'Minimal Dashboard',
          panels: []
        };

        const minimalEntity = {
          ...mockDashboardEntity,
          name: 'Minimal Dashboard',
          templatingVariables: [],
          panels: [],
          variables: [],
          tags: [],
          usedBySut: []
        };

        repository.create.mockReturnValue(minimalEntity as any);
        repository.save.mockResolvedValue(minimalEntity);

        // Act
        const result = await service.create(minimalDto, mockUserId, mockRoles);

        // Assert
        expect(repository.create).toHaveBeenCalledWith(
          expect.objectContaining({
            templatingVariables: [],
            panels: [],
            variables: [],
            tags: [],
            usedBySut: []
          })
        );
        expect(result.templating_variables).toEqual([]);
      });
    });

    describe('Error Scenarios', () => {
      it('should throw error when database save fails', async () => {
        // Arrange
        const createDto: CreateGrafanaDashboardDto = {
          grafanaInstanceId: mockDashboardEntity.grafanaInstanceId,
          grafanaId: mockDashboardEntity.grafanaId,
          uid: mockDashboardEntity.uid,
          name: 'Test Dashboard',
          panels: []
        };

        const dbError = new Error('Unique constraint violation');
        repository.create.mockReturnValue(mockDashboardEntity as any);
        repository.save.mockRejectedValue(dbError);

        // Act & Assert
        await expect(service.create(createDto, mockUserId, mockRoles)).rejects.toThrow('Unique constraint violation');
      });
    });
  });

  describe('update', () => {
    describe('Happy Path Scenarios', () => {
      it('should update dashboard with provided fields', async () => {
        // Arrange
        const updateDto: UpdateGrafanaDashboardDto = {
          name: 'Updated Dashboard Name',
          tags: ['updated-tag']
        };

        const updatedEntity = {
          ...mockDashboardEntity,
          name: 'Updated Dashboard Name',
          tags: ['updated-tag']
        };

        repository.findOne
          .mockResolvedValueOnce(mockDashboardEntity) // First call in findOne check
          .mockResolvedValueOnce(updatedEntity); // Second call after update
        repository.update.mockResolvedValue({ affected: 1 } as any);

        // Act
        const result = await service.update(mockDashboardEntity.id, updateDto, mockUserId, mockRoles);

        // Assert
        expect(repository.update).toHaveBeenCalledWith(
          mockDashboardEntity.id,
          expect.objectContaining({
            name: updateDto.name,
            tags: updateDto.tags,
            updated: expect.any(Date)
          })
        );
        expect(result.name).toBe('Updated Dashboard Name');
        expect(result.tags).toEqual(['updated-tag']);
      });

      it('should only update provided fields and leave others unchanged', async () => {
        // Arrange
        const updateDto: UpdateGrafanaDashboardDto = {
          name: 'New Name'
        };

        repository.findOne
          .mockResolvedValueOnce(mockDashboardEntity)
          .mockResolvedValueOnce(mockDashboardEntity);
        repository.update.mockResolvedValue({ affected: 1 } as any);

        // Act
        await service.update(mockDashboardEntity.id, updateDto, mockUserId, mockRoles);

        // Assert
        expect(repository.update).toHaveBeenCalledWith(
          mockDashboardEntity.id,
          expect.objectContaining({
            name: 'New Name',
            updated: expect.any(Date)
          })
        );
        // Should not include fields that weren't in updateDto
        const updateCall = repository.update.mock.calls[0]?.[1];
        expect(updateCall).not.toHaveProperty('grafanaId');
        expect(updateCall).not.toHaveProperty('uid');
      });

      it('should update all optional fields when provided', async () => {
        // Arrange
        const updateDto: UpdateGrafanaDashboardDto = {
          grafanaInstanceId: 'new-instance-id',
          grafanaId: 999,
          datasourceType: 'prometheus',
          uid: 'new-uid',
          slug: 'new-slug',
          name: 'New Name',
          uri: '/new-uri',
          templatingVariables: [{ name: 'new_var', type: 'custom' }],
          panels: [{ id: 1, title: 'New Panel', type: 'graph' }],
          variables: [{ name: 'var1' }],
          tags: ['new-tag'],
          usedBySut: ['new-system']
        };

        repository.findOne
          .mockResolvedValueOnce(mockDashboardEntity)
          .mockResolvedValueOnce(mockDashboardEntity);
        repository.update.mockResolvedValue({ affected: 1 } as any);

        // Act
        await service.update(mockDashboardEntity.id, updateDto, mockUserId, mockRoles);

        // Assert
        expect(repository.update).toHaveBeenCalledWith(
          mockDashboardEntity.id,
          expect.objectContaining({
            grafanaInstanceId: updateDto.grafanaInstanceId,
            grafanaId: updateDto.grafanaId,
            datasourceType: updateDto.datasourceType,
            uid: updateDto.uid,
            slug: updateDto.slug,
            name: updateDto.name,
            uri: updateDto.uri,
            templatingVariables: updateDto.templatingVariables,
            panels: updateDto.panels,
            variables: updateDto.variables,
            tags: updateDto.tags,
            usedBySut: updateDto.usedBySut,
            updated: expect.any(Date)
          })
        );
      });
    });

    describe('Error Scenarios', () => {
      it('should throw NotFoundException when dashboard does not exist', async () => {
        // Arrange
        const dashboardId = 'non-existent-id';
        const updateDto: UpdateGrafanaDashboardDto = { name: 'New Name' };
        repository.findOne.mockResolvedValue(null);

        // Act & Assert
        await expect(service.update(dashboardId, updateDto, mockUserId, mockRoles)).rejects.toThrow(NotFoundException);
      });

      it('should throw error when update fails', async () => {
        // Arrange
        const updateDto: UpdateGrafanaDashboardDto = { name: 'New Name' };
        const dbError = new Error('Update failed');

        repository.findOne.mockResolvedValue(mockDashboardEntity);
        repository.update.mockRejectedValue(dbError);

        // Act & Assert
        await expect(service.update(mockDashboardEntity.id, updateDto, mockUserId, mockRoles)).rejects.toThrow('Update failed');
      });

      it('should throw error when fetching updated dashboard fails', async () => {
        // Arrange
        const updateDto: UpdateGrafanaDashboardDto = { name: 'New Name' };

        repository.findOne
          .mockResolvedValueOnce(mockDashboardEntity) // First call succeeds
          .mockResolvedValueOnce(null); // Second call returns null
        repository.update.mockResolvedValue({ affected: 1 } as any);

        // Act & Assert
        await expect(service.update(mockDashboardEntity.id, updateDto, mockUserId, mockRoles)).rejects.toThrow(
          'Failed to fetch updated Grafana dashboard'
        );
      });
    });
  });

  describe('remove', () => {
    describe('Happy Path Scenarios', () => {
      it('should delete a dashboard by ID', async () => {
        // Arrange
        repository.findOne.mockResolvedValue(mockDashboardEntity);
        repository.delete.mockResolvedValue({ affected: 1 } as any);

        // Act
        await service.remove(mockDashboardEntity.id, mockUserId, mockRoles);

        // Assert
        expect(repository.findOne).toHaveBeenCalledWith({ where: { id: mockDashboardEntity.id } });
        expect(repository.delete).toHaveBeenCalledWith(mockDashboardEntity.id);
      });
    });

    describe('Error Scenarios', () => {
      it('should throw NotFoundException when dashboard does not exist', async () => {
        // Arrange
        const dashboardId = 'non-existent-id';
        repository.findOne.mockResolvedValue(null);

        // Act & Assert
        await expect(service.remove(dashboardId, mockUserId, mockRoles)).rejects.toThrow(NotFoundException);
      });

      it('should throw error when delete operation fails', async () => {
        // Arrange
        const dbError = new Error('Foreign key constraint violation');
        repository.findOne.mockResolvedValue(mockDashboardEntity);
        repository.delete.mockRejectedValue(dbError);

        // Act & Assert
        await expect(service.remove(mockDashboardEntity.id, mockUserId, mockRoles)).rejects.toThrow(
          'Foreign key constraint violation'
        );
      });
    });
  });

  describe('getVariableValues', () => {
    describe('Happy Path Scenarios - Custom Variables', () => {
      it('should return custom variable values from comma-separated string', async () => {
        // Arrange
        const dashboardWithCustomVar = {
          ...mockDashboardEntity,
          templating_variables: [
            {
              name: 'environment',
              type: 'custom',
              query: 'acc,test,prod'
            }
          ]
        };

        repository.findOne.mockResolvedValue(mockDashboardEntity);
        jest.spyOn(service, 'findOne').mockResolvedValue(dashboardWithCustomVar as any);

        // Act
        const result = await service.getVariableValues(
          mockDashboardEntity.id,
          'environment',
          'system1',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(result).toEqual([
          { label: 'acc', value: 'acc' },
          { label: 'test', value: 'test' },
          { label: 'prod', value: 'prod' }
        ]);
      });

      it('should handle custom variable with spaces in options', async () => {
        // Arrange
        const dashboardWithCustomVar = {
          ...mockDashboardEntity,
          templating_variables: [
            {
              name: 'service',
              type: 'custom',
              query: 'frontend , backend , database'
            }
          ]
        };

        jest.spyOn(service, 'findOne').mockResolvedValue(dashboardWithCustomVar as any);

        // Act
        const result = await service.getVariableValues(
          mockDashboardEntity.id,
          'service',
          'system1',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(result).toEqual([
          { label: 'frontend', value: 'frontend' },
          { label: 'backend', value: 'backend' },
          { label: 'database', value: 'database' }
        ]);
      });
    });

    describe('Happy Path Scenarios - Interval and Constant Variables', () => {
      it('should return interval variable values from options', async () => {
        // Arrange
        const dashboardWithIntervalVar = {
          ...mockDashboardEntity,
          templating_variables: [
            {
              name: 'interval',
              type: 'interval',
              options: [
                { text: '1m', value: '1m' },
                { text: '5m', value: '5m' },
                { text: '1h', value: '1h' }
              ]
            }
          ]
        };

        jest.spyOn(service, 'findOne').mockResolvedValue(dashboardWithIntervalVar as any);

        // Act
        const result = await service.getVariableValues(
          mockDashboardEntity.id,
          'interval',
          'system1',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(result).toEqual([
          { label: '1m', value: '1m' },
          { label: '5m', value: '5m' },
          { label: '1h', value: '1h' }
        ]);
      });

      it('should use value as label when text is not provided', async () => {
        // Arrange
        const dashboardWithConstVar = {
          ...mockDashboardEntity,
          templating_variables: [
            {
              name: 'constant',
              type: 'constant',
              options: [
                { value: 'constant-value' }
              ]
            }
          ]
        };

        jest.spyOn(service, 'findOne').mockResolvedValue(dashboardWithConstVar as any);

        // Act
        const result = await service.getVariableValues(
          mockDashboardEntity.id,
          'constant',
          'system1',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(result).toEqual([
          { label: 'constant-value', value: 'constant-value' }
        ]);
      });
    });

    describe('Happy Path Scenarios - Query Variables (InfluxDB)', () => {
      it('should query InfluxDB datasource for variable values', async () => {
        // Arrange
        const dashboardWithQueryVar = {
          ...mockDashboardEntity,
          grafana_instance_id: mockDashboardEntity.grafanaInstanceId,
          templating_variables: [
            {
              name: 'application',
              type: 'query',
              datasource: 'datasource-uid-123',
              query: 'SHOW TAG VALUES WITH KEY = "application"'
            }
          ]
        };

        jest.spyOn(service, 'findOne').mockResolvedValue(dashboardWithQueryVar as any);
        grafanaClientService.getGrafanaInstance.mockResolvedValue(mockGrafanaInstance as any);
        grafanaClientService.getDatasource.mockResolvedValue(mockDatasource);
        grafanaClientService.getInfluxVariableValues.mockResolvedValue([
          'app1',
          'app2',
          'app3'
        ]);

        // Act
        const result = await service.getVariableValues(
          mockDashboardEntity.id,
          'application',
          'system1',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(grafanaClientService.getGrafanaInstance).toHaveBeenCalledWith(
          dashboardWithQueryVar.grafana_instance_id
        );
        expect(grafanaClientService.getDatasource).toHaveBeenCalledWith(
          mockGrafanaInstance,
          'datasource-uid-123'
        );
        expect(grafanaClientService.getInfluxVariableValues).toHaveBeenCalledWith(
          mockGrafanaInstance,
          mockDatasource,
          'SHOW TAG VALUES WITH KEY = "application"',
          undefined
        );
        expect(result).toEqual([
          { label: 'app1', value: 'app1' },
          { label: 'app2', value: 'app2' },
          { label: 'app3', value: 'app3' }
        ]);
      });

      it('should apply regex filter to InfluxDB query results', async () => {
        // Arrange
        const dashboardWithQueryVar = {
          ...mockDashboardEntity,
          templating_variables: [
            {
              name: 'application',
              type: 'query',
              datasource: 'datasource-uid-123',
              query: 'SHOW TAG VALUES WITH KEY = "application"',
              regex: '/^app-(.+)$/'
            }
          ]
        };

        jest.spyOn(service, 'findOne').mockResolvedValue(dashboardWithQueryVar as any);
        grafanaClientService.getGrafanaInstance.mockResolvedValue(mockGrafanaInstance as any);
        grafanaClientService.getDatasource.mockResolvedValue(mockDatasource);
        grafanaClientService.getInfluxVariableValues.mockResolvedValue([
          'filtered1',
          'filtered2'
        ]);

        // Act
        const result = await service.getVariableValues(
          mockDashboardEntity.id,
          'application',
          'system1',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(grafanaClientService.getInfluxVariableValues).toHaveBeenCalledWith(
          mockGrafanaInstance,
          mockDatasource,
          'SHOW TAG VALUES WITH KEY = "application"',
          '/^app-(.+)$/'
        );
        expect(result).toHaveLength(2);
      });

      it('should replace system and environment placeholders in query', async () => {
        // Arrange
        const dashboardWithQueryVar = {
          ...mockDashboardEntity,
          templating_variables: [
            {
              name: 'workload',
              type: 'query',
              datasource: 'datasource-uid-123',
              query: 'SHOW TAG VALUES WITH KEY = "workload" WHERE system = \'$system_under_test\' AND env = \'$test_environment\''
            }
          ]
        };

        jest.spyOn(service, 'findOne').mockResolvedValue(dashboardWithQueryVar as any);
        grafanaClientService.getGrafanaInstance.mockResolvedValue(mockGrafanaInstance as any);
        grafanaClientService.getDatasource.mockResolvedValue(mockDatasource);
        grafanaClientService.getInfluxVariableValues.mockResolvedValue(['workload1']);

        // Act
        await service.getVariableValues(
          mockDashboardEntity.id,
          'workload',
          'mySystem',
          'production',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(grafanaClientService.getInfluxVariableValues).toHaveBeenCalledWith(
          mockGrafanaInstance,
          mockDatasource,
          "SHOW TAG VALUES WITH KEY = \"workload\" WHERE system = 'mySystem' AND env = 'production'",
          undefined
        );
      });

      it('should replace other variable placeholders in query', async () => {
        // Arrange
        const dashboardWithQueryVar = {
          ...mockDashboardEntity,
          templating_variables: [
            {
              name: 'service',
              type: 'query',
              datasource: 'datasource-uid-123',
              query: 'SHOW TAG VALUES WITH KEY = "service" WHERE application = \'$application\''
            }
          ]
        };

        jest.spyOn(service, 'findOne').mockResolvedValue(dashboardWithQueryVar as any);
        grafanaClientService.getGrafanaInstance.mockResolvedValue(mockGrafanaInstance as any);
        grafanaClientService.getDatasource.mockResolvedValue(mockDatasource);
        grafanaClientService.getInfluxVariableValues.mockResolvedValue(['service1']);

        // Act
        await service.getVariableValues(
          mockDashboardEntity.id,
          'service',
          'system1',
          'acc',
          { application: ['app1', 'app2'] },
          mockUserId,
          mockRoles
        );

        // Assert
        expect(grafanaClientService.getInfluxVariableValues).toHaveBeenCalledWith(
          mockGrafanaInstance,
          mockDatasource,
          "SHOW TAG VALUES WITH KEY = \"service\" WHERE application = 'app1|app2'",
          undefined
        );
      });

      it('should handle datasource as object with uid property', async () => {
        // Arrange
        const dashboardWithQueryVar = {
          ...mockDashboardEntity,
          templating_variables: [
            {
              name: 'application',
              type: 'query',
              datasource: { uid: 'datasource-uid-123', type: 'influxdb' },
              query: 'SHOW TAG VALUES'
            }
          ]
        };

        jest.spyOn(service, 'findOne').mockResolvedValue(dashboardWithQueryVar as any);
        grafanaClientService.getGrafanaInstance.mockResolvedValue(mockGrafanaInstance as any);
        grafanaClientService.getDatasource.mockResolvedValue(mockDatasource);
        grafanaClientService.getInfluxVariableValues.mockResolvedValue(['app1']);

        // Act
        await service.getVariableValues(
          mockDashboardEntity.id,
          'application',
          'system1',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(grafanaClientService.getDatasource).toHaveBeenCalledWith(
          mockGrafanaInstance,
          'datasource-uid-123'
        );
      });

      it('should remove duplicate values from query results', async () => {
        // Arrange
        const dashboardWithQueryVar = {
          ...mockDashboardEntity,
          templating_variables: [
            {
              name: 'application',
              type: 'query',
              datasource: 'datasource-uid-123',
              query: 'SHOW TAG VALUES'
            }
          ]
        };

        jest.spyOn(service, 'findOne').mockResolvedValue(dashboardWithQueryVar as any);
        grafanaClientService.getGrafanaInstance.mockResolvedValue(mockGrafanaInstance as any);
        grafanaClientService.getDatasource.mockResolvedValue(mockDatasource);
        grafanaClientService.getInfluxVariableValues.mockResolvedValue([
          'app1',
          'app2',
          'app1',
          'app3',
          'app2'
        ]);

        // Act
        const result = await service.getVariableValues(
          mockDashboardEntity.id,
          'application',
          'system1',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(result).toEqual([
          { label: 'app1', value: 'app1' },
          { label: 'app2', value: 'app2' },
          { label: 'app3', value: 'app3' }
        ]);
      });
    });

    describe('Happy Path Scenarios - Query Variables (Prometheus)', () => {
      it('should query Prometheus datasource for variable values', async () => {
        // Arrange
        const promDatasource = { ...mockDatasource, type: 'prometheus' };
        const dashboardWithQueryVar = {
          ...mockDashboardEntity,
          templating_variables: [
            {
              name: 'job',
              type: 'query',
              datasource: 'prom-datasource-uid',
              query: 'label_values(up, job)'
            }
          ]
        };

        jest.spyOn(service, 'findOne').mockResolvedValue(dashboardWithQueryVar as any);
        grafanaClientService.getGrafanaInstance.mockResolvedValue(mockGrafanaInstance as any);
        grafanaClientService.getDatasource.mockResolvedValue(promDatasource);
        grafanaClientService.getPrometheusVariableValues.mockResolvedValue([
          'job1',
          'job2'
        ]);

        // Act
        const result = await service.getVariableValues(
          mockDashboardEntity.id,
          'job',
          'system1',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(grafanaClientService.getPrometheusVariableValues).toHaveBeenCalledWith(
          mockGrafanaInstance,
          promDatasource,
          'label_values(up, job)',
          undefined
        );
        expect(result).toEqual([
          { label: 'job1', value: 'job1' },
          { label: 'job2', value: 'job2' }
        ]);
      });
    });

    describe('Edge Cases', () => {
      it('should return empty array when dashboard has no templating variables', async () => {
        // Arrange
        const dashboardWithoutVars = {
          ...mockDashboardEntity,
          templating_variables: undefined
        };

        jest.spyOn(service, 'findOne').mockResolvedValue(dashboardWithoutVars as any);

        // Act
        const result = await service.getVariableValues(
          mockDashboardEntity.id,
          'any_variable',
          'system1',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(result).toEqual([]);
      });

      it('should return empty array when variable is not found', async () => {
        // Arrange
        jest.spyOn(service, 'findOne').mockResolvedValue(mockDashboardEntity as any);

        // Act
        const result = await service.getVariableValues(
          mockDashboardEntity.id,
          'non_existent_variable',
          'system1',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(result).toEqual([]);
      });

      it('should return empty array for custom variable with empty query', async () => {
        // Arrange
        const dashboardWithEmptyQuery = {
          ...mockDashboardEntity,
          templating_variables: [
            {
              name: 'empty_var',
              type: 'custom',
              query: ''
            }
          ]
        };

        jest.spyOn(service, 'findOne').mockResolvedValue(dashboardWithEmptyQuery as any);

        // Act
        const result = await service.getVariableValues(
          mockDashboardEntity.id,
          'empty_var',
          'system1',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(result).toEqual([]);
      });

      it('should return empty array for interval variable without options', async () => {
        // Arrange
        const dashboardWithNoOptions = {
          ...mockDashboardEntity,
          templating_variables: [
            {
              name: 'interval',
              type: 'interval'
            }
          ]
        };

        jest.spyOn(service, 'findOne').mockResolvedValue(dashboardWithNoOptions as any);

        // Act
        const result = await service.getVariableValues(
          mockDashboardEntity.id,
          'interval',
          'system1',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(result).toEqual([]);
      });

      it('should return empty array for unsupported variable type', async () => {
        // Arrange
        const dashboardWithUnsupportedType = {
          ...mockDashboardEntity,
          templating_variables: [
            {
              name: 'unsupported',
              type: 'adhoc'
            }
          ]
        };

        jest.spyOn(service, 'findOne').mockResolvedValue(dashboardWithUnsupportedType as any);

        // Act
        const result = await service.getVariableValues(
          mockDashboardEntity.id,
          'unsupported',
          'system1',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(result).toEqual([]);
      });

      it('should handle query as object with nested query property', async () => {
        // Arrange
        const dashboardWithObjectQuery = {
          ...mockDashboardEntity,
          templating_variables: [
            {
              name: 'workload',
              type: 'query',
              datasource: 'datasource-uid-123',
              query: { query: 'SHOW TAG VALUES', refId: 'A' }
            }
          ]
        };

        jest.spyOn(service, 'findOne').mockResolvedValue(dashboardWithObjectQuery as any);
        grafanaClientService.getGrafanaInstance.mockResolvedValue(mockGrafanaInstance as any);
        grafanaClientService.getDatasource.mockResolvedValue(mockDatasource);
        grafanaClientService.getInfluxVariableValues.mockResolvedValue(['workload1']);

        // Act
        await service.getVariableValues(
          mockDashboardEntity.id,
          'workload',
          'system1',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(grafanaClientService.getInfluxVariableValues).toHaveBeenCalledWith(
          mockGrafanaInstance,
          mockDatasource,
          'SHOW TAG VALUES',
          undefined
        );
      });
    });

    describe('Error Scenarios', () => {
      it('should return empty array when dashboard does not exist', async () => {
        // Arrange
        jest.spyOn(service, 'findOne').mockRejectedValue(new NotFoundException('Not found'));

        // Act
        const result = await service.getVariableValues(
          'non-existent-id',
          'variable',
          'system1',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(result).toEqual([]);
      });

      it('should return empty array when variable has no datasource defined', async () => {
        // Arrange
        const dashboardWithNoDatasource = {
          ...mockDashboardEntity,
          templating_variables: [
            {
              name: 'var',
              type: 'query',
              query: 'SHOW TAG VALUES'
            }
          ]
        };

        jest.spyOn(service, 'findOne').mockResolvedValue(dashboardWithNoDatasource as any);

        // Act
        const result = await service.getVariableValues(
          mockDashboardEntity.id,
          'var',
          'system1',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(result).toEqual([]);
      });

      it('should return empty array when datasource has no UID', async () => {
        // Arrange
        const dashboardWithNoDatasourceUid = {
          ...mockDashboardEntity,
          templating_variables: [
            {
              name: 'var',
              type: 'query',
              datasource: { type: 'influxdb' },
              query: 'SHOW TAG VALUES'
            }
          ]
        };

        jest.spyOn(service, 'findOne').mockResolvedValue(dashboardWithNoDatasourceUid as any);

        // Act
        const result = await service.getVariableValues(
          mockDashboardEntity.id,
          'var',
          'system1',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(result).toEqual([]);
      });

      it('should return fallback values when datasource query fails', async () => {
        // Arrange
        const dashboardWithQueryVar = {
          ...mockDashboardEntity,
          templating_variables: [
            {
              name: 'system_under_test',
              type: 'query',
              datasource: 'datasource-uid-123',
              query: 'SHOW TAG VALUES'
            }
          ]
        };

        jest.spyOn(service, 'findOne').mockResolvedValue(dashboardWithQueryVar as any);
        grafanaClientService.getGrafanaInstance.mockResolvedValue(mockGrafanaInstance as any);
        grafanaClientService.getDatasource.mockRejectedValue(new Error('Connection timeout'));

        // Act
        const result = await service.getVariableValues(
          mockDashboardEntity.id,
          'system_under_test',
          'TestSystem',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(result).toContainEqual({ label: 'MyAfterburner', value: 'MyAfterburner' });
        expect(result).toContainEqual({ label: 'TestSystem', value: 'TestSystem' });
      });

      it('should return fallback values for environment variable on datasource error', async () => {
        // Arrange
        const dashboardWithEnvVar = {
          ...mockDashboardEntity,
          templating_variables: [
            {
              name: 'test_environment',
              type: 'query',
              datasource: 'datasource-uid-123',
              query: 'SHOW TAG VALUES'
            }
          ]
        };

        jest.spyOn(service, 'findOne').mockResolvedValue(dashboardWithEnvVar as any);
        grafanaClientService.getGrafanaInstance.mockResolvedValue(mockGrafanaInstance as any);
        grafanaClientService.getDatasource.mockRejectedValue(new Error('Query failed'));

        // Act
        const result = await service.getVariableValues(
          mockDashboardEntity.id,
          'test_environment',
          'system1',
          'production',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(result).toContainEqual({ label: 'acc', value: 'acc' });
        expect(result).toContainEqual({ label: 'prod', value: 'prod' });
        expect(result).toContainEqual({ label: 'production', value: 'production' });
      });

      it('should return fallback values for service variable on datasource error', async () => {
        // Arrange
        const dashboardWithServiceVar = {
          ...mockDashboardEntity,
          templating_variables: [
            {
              name: 'service',
              type: 'query',
              datasource: 'datasource-uid-123',
              query: 'SHOW TAG VALUES'
            }
          ]
        };

        jest.spyOn(service, 'findOne').mockResolvedValue(dashboardWithServiceVar as any);
        grafanaClientService.getGrafanaInstance.mockResolvedValue(mockGrafanaInstance as any);
        grafanaClientService.getDatasource.mockRejectedValue(new Error('Query failed'));

        // Act
        const result = await service.getVariableValues(
          mockDashboardEntity.id,
          'service',
          'system1',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(result).toContainEqual({ label: 'afterburner-fe', value: 'afterburner-fe' });
        expect(result).toContainEqual({ label: 'afterburner-be', value: 'afterburner-be' });
      });

      it('should return generic fallback values for unknown variable on datasource error', async () => {
        // Arrange
        const dashboardWithUnknownVar = {
          ...mockDashboardEntity,
          templating_variables: [
            {
              name: 'custom_metric',
              type: 'query',
              datasource: 'datasource-uid-123',
              query: 'SHOW TAG VALUES'
            }
          ]
        };

        jest.spyOn(service, 'findOne').mockResolvedValue(dashboardWithUnknownVar as any);
        grafanaClientService.getGrafanaInstance.mockResolvedValue(mockGrafanaInstance as any);
        grafanaClientService.getDatasource.mockRejectedValue(new Error('Query failed'));

        // Act
        const result = await service.getVariableValues(
          mockDashboardEntity.id,
          'custom_metric',
          'system1',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(result).toContainEqual({ label: 'custom_metric-1', value: 'custom_metric-1' });
        expect(result).toContainEqual({ label: 'custom_metric-2', value: 'custom_metric-2' });
      });

      it('should return empty array for unsupported datasource type', async () => {
        // Arrange
        const unsupportedDatasource = { ...mockDatasource, type: 'elasticsearch' };
        const dashboardWithQueryVar = {
          ...mockDashboardEntity,
          templating_variables: [
            {
              name: 'field',
              type: 'query',
              datasource: 'datasource-uid-123',
              query: 'some query'
            }
          ]
        };

        jest.spyOn(service, 'findOne').mockResolvedValue(dashboardWithQueryVar as any);
        grafanaClientService.getGrafanaInstance.mockResolvedValue(mockGrafanaInstance as any);
        grafanaClientService.getDatasource.mockResolvedValue(unsupportedDatasource);

        // Act
        const result = await service.getVariableValues(
          mockDashboardEntity.id,
          'field',
          'system1',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(result).toEqual([]);
      });

      it('should return empty array when general error occurs', async () => {
        // Arrange
        jest.spyOn(service, 'findOne').mockRejectedValue(new Error('Unexpected error'));

        // Act
        const result = await service.getVariableValues(
          mockDashboardEntity.id,
          'variable',
          'system1',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert
        expect(result).toEqual([]);
      });

      it('should deduplicate fallback values correctly', async () => {
        // Arrange
        const dashboardWithSystemVar = {
          ...mockDashboardEntity,
          templating_variables: [
            {
              name: 'application',
              type: 'query',
              datasource: 'datasource-uid-123',
              query: 'SHOW TAG VALUES'
            }
          ]
        };

        jest.spyOn(service, 'findOne').mockResolvedValue(dashboardWithSystemVar as any);
        grafanaClientService.getGrafanaInstance.mockResolvedValue(mockGrafanaInstance as any);
        grafanaClientService.getDatasource.mockRejectedValue(new Error('Query failed'));

        // Act - Pass 'MyAfterburner' as system which matches a default fallback
        const result = await service.getVariableValues(
          mockDashboardEntity.id,
          'application',
          'MyAfterburner',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert - Should only contain one 'MyAfterburner' entry
        const afterburnerEntries = result.filter(r => r.value === 'MyAfterburner');
        expect(afterburnerEntries).toHaveLength(1);
      });
    });
  });
});
