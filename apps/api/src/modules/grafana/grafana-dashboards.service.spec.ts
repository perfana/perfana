import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GrafanaDashboardsService } from './grafana-dashboards.service';
import { GrafanaClientService } from './grafana-client.service';
import { GrafanaDashboard as GrafanaDashboardEntity, GrafanaInstance as GrafanaInstanceEntity } from '../../entities';
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
import { AuditService } from '../audit/audit.service';

describe('GrafanaDashboardsService', () => {
  let service: GrafanaDashboardsService;
  let repository: MockRepository<GrafanaDashboardEntity>;
  let grafanaClientService: jest.Mocked<GrafanaClientService>;
  let queryBuilder: MockSelectQueryBuilder<GrafanaDashboardEntity>;
  let auditService: jest.Mocked<AuditService>;

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
          provide: getRepositoryToken(GrafanaInstanceEntity),
          useValue: {
            findOne: jest.fn().mockResolvedValue({
              id: 'gi-mock',
              organizationId: 'org-mock',
              teamId: undefined,
            }),
          },
        },
        {
          provide: GrafanaClientService,
          useValue: mockGrafanaClient
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
        }
      ]
    }).compile();

    service = module.get<GrafanaDashboardsService>(GrafanaDashboardsService);
    repository = module.get(getRepositoryToken(GrafanaDashboardEntity));
    grafanaClientService = module.get(GrafanaClientService);
    auditService = module.get(AuditService);
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
          updated: expect.any(Date),
          organizationId: 'org-mock',
          teamId: undefined,
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

      it('should return empty array when datasource query fails', async () => {
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

        // Assert - no longer returns demo fallback values
        expect(result).toEqual([]);
      });

      it('should return empty array for environment variable on datasource error', async () => {
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

        // Assert - no longer returns demo fallback values
        expect(result).toEqual([]);
      });

      it('should return empty array for service variable on datasource error', async () => {
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

        // Assert - no longer returns demo fallback values
        expect(result).toEqual([]);
      });

      it('should return empty array for unknown variable on datasource error', async () => {
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

        // Assert - no longer returns demo fallback values
        expect(result).toEqual([]);
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

      it('should return empty array on datasource error (no demo fallback)', async () => {
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

        // Act
        const result = await service.getVariableValues(
          mockDashboardEntity.id,
          'application',
          'MyAfterburner',
          'acc',
          {},
          mockUserId,
          mockRoles
        );

        // Assert - no longer returns demo fallback values
        expect(result).toEqual([]);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Authorization / org filtering (lines 57-63 and 83-93)
  // ---------------------------------------------------------------------------

  describe('Authorization and organization filtering', () => {
    let authzService: ReturnType<typeof createAuthorizationServiceMock>;

    beforeEach(async () => {
      // Rebuild module with a non-admin authz mock so we can test org filters
      queryBuilder = createMockQueryBuilder<GrafanaDashboardEntity>();
      const mockRepository = createMockRepository<GrafanaDashboardEntity>();
      mockRepository.createQueryBuilder.mockReturnValue(queryBuilder);

      authzService = createAuthorizationServiceMock();
      // Override: user is NOT a global admin
      authzService.isGlobalAdmin.mockReturnValue(false);

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
            provide: getRepositoryToken(GrafanaInstanceEntity),
            useValue: {
              findOne: jest.fn().mockResolvedValue({
                id: 'gi-mock',
                organizationId: 'org-mock',
                teamId: undefined,
              }),
            },
          },
          {
            provide: GrafanaClientService,
            useValue: mockGrafanaClient
          },
          {
            provide: AuthorizationService,
            useValue: authzService,
          },
          {
            provide: AuditService,
            useValue: {
              logCreate: jest.fn(),
              logUpdate: jest.fn(),
              logDelete: jest.fn(),
            },
          }
        ]
      }).compile();

      service = module.get<GrafanaDashboardsService>(GrafanaDashboardsService);
      repository = module.get(getRepositoryToken(GrafanaDashboardEntity));
    });

    describe('findAll org filtering for non-admin users', () => {
      it('should apply org-membership filter when user belongs to organizations', async () => {
        // Arrange
        const orgIds = ['org-aaa', 'org-bbb'];
        authzService.getAccessibleOrganizations.mockResolvedValue(orgIds);
        queryBuilder.getMany.mockResolvedValue([]);

        // Act
        await service.findAll(mockUserId, mockRoles);

        // Assert
        expect(authzService.getAccessibleOrganizations).toHaveBeenCalledWith(mockUserId);
        expect(queryBuilder.andWhere).toHaveBeenCalledWith(
          'gd.organizationId IN (:...orgIds)',
          { orgIds }
        );
      });

      it('should show nothing when user has no org memberships', async () => {
        // Arrange — getAccessibleOrganizations returns empty array
        authzService.getAccessibleOrganizations.mockResolvedValue([]);
        queryBuilder.getMany.mockResolvedValue([]);

        // Act
        await service.findAll(mockUserId, mockRoles);

        // Assert
        expect(queryBuilder.andWhere).toHaveBeenCalledWith('1 = 0');
      });

      it('should skip org filtering entirely for global admins', async () => {
        // Arrange — override back to admin for this single test
        authzService.isGlobalAdmin.mockReturnValue(true);
        queryBuilder.getMany.mockResolvedValue([]);

        // Act
        await service.findAll(mockUserId, ['admin']);

        // Assert — getAccessibleOrganizations must NOT be called for admins
        expect(authzService.getAccessibleOrganizations).not.toHaveBeenCalled();
        // No org-based andWhere should have been applied
        const orgWhereCall = (queryBuilder.andWhere as jest.Mock).mock.calls.find(
          (args: unknown[]) => typeof args[0] === 'string' && args[0].includes('organizationId')
        );
        expect(orgWhereCall).toBeUndefined();
      });
    });

    describe('verifyOrgAccess via findOne', () => {
      it('should allow access when dashboard has no organizationId (legacy/shared)', async () => {
        // Arrange — dashboard with null organizationId, non-admin user
        const sharedDashboard: GrafanaDashboardEntity = {
          ...mockDashboardEntity,
          organizationId: undefined,
        };
        repository.findOne.mockResolvedValue(sharedDashboard);

        // Act — should not throw
        await expect(service.findOne(sharedDashboard.id, mockUserId, mockRoles)).resolves.toBeDefined();
        // verifyOrgAccess short-circuits, so getAccessibleOrganizations is NOT called
        expect(authzService.getAccessibleOrganizations).not.toHaveBeenCalled();
      });

      it('should allow access when user is a member of the dashboard organization', async () => {
        // Arrange
        const orgId = 'org-owned';
        const ownedDashboard: GrafanaDashboardEntity = {
          ...mockDashboardEntity,
          organizationId: orgId,
        };
        repository.findOne.mockResolvedValue(ownedDashboard);
        authzService.getAccessibleOrganizations.mockResolvedValue([orgId, 'org-other']);

        // Act — should not throw
        await expect(service.findOne(ownedDashboard.id, mockUserId, mockRoles)).resolves.toBeDefined();
      });

      it('should throw an error wrapping ForbiddenException when user is not a member of the dashboard organization', async () => {
        // Arrange
        const orgId = 'org-restricted';
        const restrictedDashboard: GrafanaDashboardEntity = {
          ...mockDashboardEntity,
          organizationId: orgId,
        };
        repository.findOne.mockResolvedValue(restrictedDashboard);
        // canAccessResource (post-C16) returns the deny verdict directly
        authzService.canAccessResource.mockResolvedValue({
          allowed: false,
          reason: `User ${mockUserId} does not have access to this resource`,
        });

        // Note: findOne's catch block only re-throws NotFoundException directly.
        // ForbiddenException is caught and re-wrapped as a plain Error containing its message.
        await expect(
          service.findOne(restrictedDashboard.id, mockUserId, mockRoles)
        ).rejects.toThrow(`Failed to fetch Grafana dashboard: Access denied to dashboard ${restrictedDashboard.id}`);
      });

      it('should allow access for global admins regardless of organizationId', async () => {
        // Arrange — admin bypasses org check
        authzService.isGlobalAdmin.mockReturnValue(true);
        const restrictedDashboard: GrafanaDashboardEntity = {
          ...mockDashboardEntity,
          organizationId: 'org-restricted',
        };
        repository.findOne.mockResolvedValue(restrictedDashboard);

        // Act — should not throw even though user has no accessible orgs
        authzService.getAccessibleOrganizations.mockResolvedValue([]);
        await expect(service.findOne(restrictedDashboard.id, mockUserId, ['admin'])).resolves.toBeDefined();
        // verifyOrgAccess returns immediately for admins
        expect(authzService.getAccessibleOrganizations).not.toHaveBeenCalled();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Panel extraction from grafanaJson (lines 151-152, 218-219)
  // ---------------------------------------------------------------------------

  describe('Panel extraction from grafanaJson', () => {
    describe('findAll panel extraction', () => {
      it('should prefer grafanaJson.dashboard.panels over simplified panels', async () => {
        // Arrange — entity has both grafanaJson panels and simplified panels
        const fullPanel = { id: 10, title: 'Full Panel', type: 'timeseries', fieldConfig: {} };
        const simplifiedPanel = { id: 1, title: 'Simplified Panel', type: 'graph' };
        const entityWithGrafanaJson: GrafanaDashboardEntity = {
          ...mockDashboardEntity,
          grafanaJson: {
            dashboard: {
              panels: [fullPanel]
            }
          },
          panels: [simplifiedPanel]
        };
        queryBuilder.getMany.mockResolvedValue([entityWithGrafanaJson]);

        // Act
        const result = await service.findAll(mockUserId, mockRoles);

        // Assert — grafanaJson panels win
        expect(result[0]?.panels).toEqual([fullPanel]);
        expect(result[0]?.panels).not.toEqual([simplifiedPanel]);
      });

      it('should fall back to simplified panels when grafanaJson is absent', async () => {
        // Arrange
        const simplifiedPanel = { id: 1, title: 'Simplified Panel', type: 'graph' };
        const entityWithoutJson: GrafanaDashboardEntity = {
          ...mockDashboardEntity,
          grafanaJson: undefined,
          panels: [simplifiedPanel]
        };
        queryBuilder.getMany.mockResolvedValue([entityWithoutJson]);

        // Act
        const result = await service.findAll(mockUserId, mockRoles);

        // Assert — simplified panels used and yAxesFormat transform applied
        expect(result[0]?.panels).toEqual([
          { ...simplifiedPanel, yAxesFormat: undefined }
        ]);
      });

      it('should transform y_axes_format to yAxesFormat on simplified panels', async () => {
        // Arrange
        const simplifiedPanel = { id: 1, title: 'Graph', type: 'graph', y_axes_format: 'bytes' };
        const entityWithYAxes: GrafanaDashboardEntity = {
          ...mockDashboardEntity,
          grafanaJson: undefined,
          panels: [simplifiedPanel]
        };
        queryBuilder.getMany.mockResolvedValue([entityWithYAxes]);

        // Act
        const result = await service.findAll(mockUserId, mockRoles);

        // Assert — yAxesFormat is set from y_axes_format
        expect(result[0]?.panels?.[0]).toEqual(
          expect.objectContaining({
            y_axes_format: 'bytes',
            yAxesFormat: 'bytes',
          })
        );
      });

      it('should log first panel keys when grafanaJson has panels (covers debug log path)', async () => {
        // Arrange — entity with grafanaJson panels that have multiple keys
        const fullPanel = { id: 10, title: 'Panel A', type: 'timeseries', datasource: 'influxdb' };
        const entityWithGrafanaJson: GrafanaDashboardEntity = {
          ...mockDashboardEntity,
          grafanaJson: {
            dashboard: {
              panels: [fullPanel]
            }
          }
        };
        queryBuilder.getMany.mockResolvedValue([entityWithGrafanaJson]);

        // Act — the logger.log at line 151-152 is triggered; no assertion on log content,
        // but we verify the returned panels to confirm the branch executed
        const result = await service.findAll(mockUserId, mockRoles);

        // Assert
        expect(result[0]?.panels).toEqual([fullPanel]);
      });

      it('should handle grafanaJson with empty panels array', async () => {
        // Arrange
        const entityWithEmptyJson: GrafanaDashboardEntity = {
          ...mockDashboardEntity,
          grafanaJson: {
            dashboard: {
              panels: []
            }
          },
          panels: [{ id: 1, title: 'Fallback Panel', type: 'graph' }]
        };
        queryBuilder.getMany.mockResolvedValue([entityWithEmptyJson]);

        // Act
        const result = await service.findAll(mockUserId, mockRoles);

        // Assert — empty array from grafanaJson wins over simplified panels
        // (falsy-coercion: empty array is truthy, so grafanaJson.dashboard.panels is used)
        expect(result[0]?.panels).toEqual([]);
      });

      it('should handle grafanaJson without a dashboard property', async () => {
        // Arrange
        const entityWithoutDashboard: GrafanaDashboardEntity = {
          ...mockDashboardEntity,
          grafanaJson: { meta: { slug: 'test' } },
          panels: [{ id: 1, title: 'Simplified', type: 'graph' }]
        };
        queryBuilder.getMany.mockResolvedValue([entityWithoutDashboard]);

        // Act
        const result = await service.findAll(mockUserId, mockRoles);

        // Assert — falls back to simplified panels with transform
        expect(result[0]?.panels?.[0]).toEqual(
          expect.objectContaining({ id: 1, title: 'Simplified', type: 'graph' })
        );
      });
    });

    describe('findOne panel extraction', () => {
      it('should prefer grafanaJson.dashboard.panels over simplified panels', async () => {
        // Arrange
        const fullPanel = { id: 99, title: 'Full JSON Panel', type: 'timeseries', targets: [] };
        const entityWithGrafanaJson: GrafanaDashboardEntity = {
          ...mockDashboardEntity,
          grafanaJson: {
            dashboard: {
              panels: [fullPanel]
            }
          },
          panels: [{ id: 1, title: 'Simplified', type: 'graph' }]
        };
        repository.findOne.mockResolvedValue(entityWithGrafanaJson);

        // Act
        const result = await service.findOne(entityWithGrafanaJson.id, mockUserId, mockRoles);

        // Assert
        expect(result.panels).toEqual([fullPanel]);
      });

      it('should fall back to simplified panels when grafanaJson has no dashboard', async () => {
        // Arrange
        const simplifiedPanel = { id: 1, title: 'Simple', type: 'graph' };
        const entityWithoutDashboard: GrafanaDashboardEntity = {
          ...mockDashboardEntity,
          grafanaJson: undefined,
          panels: [simplifiedPanel]
        };
        repository.findOne.mockResolvedValue(entityWithoutDashboard);

        // Act
        const result = await service.findOne(entityWithoutDashboard.id, mockUserId, mockRoles);

        // Assert
        expect(result.panels).toEqual([simplifiedPanel]);
      });

      it('should log first panel structure when grafanaJson has panels (covers debug log path)', async () => {
        // Arrange — entity with grafanaJson and panels, triggering lines 218-219
        const fullPanel = { id: 5, title: 'JSON Panel', type: 'timeseries', fieldConfig: { defaults: {} } };
        const entityWithPanels: GrafanaDashboardEntity = {
          ...mockDashboardEntity,
          grafanaJson: {
            dashboard: {
              panels: [fullPanel]
            }
          }
        };
        repository.findOne.mockResolvedValue(entityWithPanels);

        // Act — the logger.log at line 218-219 fires; verify the returned data is correct
        const result = await service.findOne(entityWithPanels.id, mockUserId, mockRoles);

        // Assert
        expect(result.panels).toEqual([fullPanel]);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // create / update with grafanaJson panels (branch coverage for panel resolution)
  // ---------------------------------------------------------------------------

  describe('create with grafanaJson panels', () => {
    it('should use grafanaJson.dashboard.panels in the created result when entity has grafanaJson', async () => {
      // Arrange
      const fullPanel = { id: 1, title: 'Stored Panel', type: 'timeseries' };
      const createDto: CreateGrafanaDashboardDto = {
        grafanaInstanceId: mockDashboardEntity.grafanaInstanceId,
        grafanaId: mockDashboardEntity.grafanaId,
        uid: mockDashboardEntity.uid,
        name: 'Dashboard With Json',
        panels: []
      };

      const savedEntity: GrafanaDashboardEntity = {
        ...mockDashboardEntity,
        name: 'Dashboard With Json',
        grafanaJson: { dashboard: { panels: [fullPanel] } },
        panels: []
      };

      repository.create.mockReturnValue(savedEntity as unknown as GrafanaDashboardEntity);
      repository.save.mockResolvedValue(savedEntity);

      // Act
      const result = await service.create(createDto, mockUserId, mockRoles);

      // Assert — panels come from grafanaJson
      expect(result.panels).toEqual([fullPanel]);
    });
  });

  describe('update with grafanaJson panels', () => {
    it('should use grafanaJson.dashboard.panels in the updated result when entity has grafanaJson', async () => {
      // Arrange
      const fullPanel = { id: 2, title: 'Updated JSON Panel', type: 'timeseries' };
      const updateDto: UpdateGrafanaDashboardDto = { name: 'Updated' };

      const entityWithGrafanaJson: GrafanaDashboardEntity = {
        ...mockDashboardEntity,
        name: 'Updated',
        grafanaJson: { dashboard: { panels: [fullPanel] } },
        panels: []
      };

      repository.findOne
        .mockResolvedValueOnce(mockDashboardEntity)    // findOne in update's pre-check
        .mockResolvedValueOnce(entityWithGrafanaJson); // findOne after update
      repository.update.mockResolvedValue({ affected: 1 } as never);

      // Act
      const result = await service.update(mockDashboardEntity.id, updateDto, mockUserId, mockRoles);

      // Assert
      expect(result.panels).toEqual([fullPanel]);
    });
  });

  describe('audit logging (Phase 5a, PR10)', () => {
    const mockOrgId = 'org-grafana-1';

    it('create logs CREATE with organizationIdOverride from the persisted dashboard', async () => {
      const created = { ...mockDashboardEntity, organizationId: mockOrgId } as never as GrafanaDashboardEntity;
      repository.create.mockReturnValue(created);
      repository.save.mockResolvedValue(created);

      await service.create(
        {
          grafanaInstanceId: created.grafanaInstanceId,
          grafanaId: created.grafanaId,
          uid: created.uid,
          name: created.name,
        } as never,
        mockUserId,
        mockRoles,
      );

      expect(auditService.logCreate).toHaveBeenCalledTimes(1);
      expect(auditService.logCreate).toHaveBeenCalledWith(
        created,
        { organizationIdOverride: mockOrgId },
      );
    });

    it('update logs UPDATE with before/after snapshots and organizationIdOverride', async () => {
      const before = { ...mockDashboardEntity, organizationId: mockOrgId } as never as GrafanaDashboardEntity;
      const after = { ...mockDashboardEntity, organizationId: mockOrgId, name: 'Renamed' } as never as GrafanaDashboardEntity;
      repository.findOne
        .mockResolvedValueOnce(before)  // pre-update snapshot
        .mockResolvedValueOnce(after);  // post-update result
      repository.update.mockResolvedValue({ affected: 1 } as never);

      await service.update(mockDashboardEntity.id, { name: 'Renamed' } as never, mockUserId, mockRoles);

      expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
      const [beforeArg, afterArg, opts] = (auditService.logUpdate as jest.Mock).mock.calls[0];
      expect(beforeArg).toEqual(expect.objectContaining({ id: mockDashboardEntity.id, name: mockDashboardEntity.name }));
      expect(afterArg).toEqual(expect.objectContaining({ id: mockDashboardEntity.id, name: 'Renamed' }));
      expect(opts).toEqual({ organizationIdOverride: mockOrgId });
    });

    it('remove logs DELETE before repository.delete', async () => {
      const entity = { ...mockDashboardEntity, organizationId: mockOrgId } as never as GrafanaDashboardEntity;
      repository.findOne.mockResolvedValue(entity);
      repository.delete.mockResolvedValue({ affected: 1 } as never);

      await service.remove(mockDashboardEntity.id, mockUserId, mockRoles);

      expect(auditService.logDelete).toHaveBeenCalledTimes(1);
      expect(auditService.logDelete).toHaveBeenCalledWith(
        entity,
        { organizationIdOverride: mockOrgId },
      );
      expect(
        (auditService.logDelete as jest.Mock).mock.invocationCallOrder[0],
      ).toBeLessThan(
        (repository.delete as jest.Mock).mock.invocationCallOrder[0],
      );
    });
  });
});
