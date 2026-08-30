import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus, ConflictException, NotFoundException } from '@nestjs/common';
import { GrafanaDashboardsController } from './grafana-dashboards.controller';
import { GrafanaDashboardsService, GrafanaDashboard } from './grafana-dashboards.service';
import {
  CreateGrafanaDashboardDto,
  UpdateGrafanaDashboardDto,
  GrafanaDashboardQuery,
  DashboardPanelDto,
  TemplatingVariableDto,
} from './dto/grafana-dashboard.dto';
import { UserContext } from '../../common/decorators/user-context.decorator';

describe('GrafanaDashboardsController', () => {
  let controller: GrafanaDashboardsController;
  let service: jest.Mocked<GrafanaDashboardsService>;

  const mockUserContext: UserContext = {
    userId: 'test-user-123',
    roles: ['user'],
    organizations: ['org-123'],
    teams: ['team-456'],
    organizationId: 'org-123',
    teamId: 'team-456',
  };

  // Mock data fixtures
  const mockDashboardPanel: DashboardPanelDto = {
    id: 1,
    title: 'Response Time',
    type: 'graph',
    datasourceId: 123,
    datasourceType: 'influxdb',
    datasourceDatabase: 'perfana',
    minTimeInterval: '1m',
    yAxesFormat: 'ms',
    description: 'Shows response time metrics',
    targets: [
      {
        query: 'SELECT mean("value") FROM "response_time"',
        measurement: 'response_time',
        field: 'value',
      },
    ],
  };

  const mockTemplatingVariable: TemplatingVariableDto = {
    name: 'system_under_test',
    type: 'query',
    query: 'SHOW TAG VALUES WITH KEY = "system"',
    datasource: { uid: 'influxdb-uid', type: 'influxdb' },
    regex: '',
  };

  const mockDashboard: GrafanaDashboard = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    grafana_instance_id: '660e8400-e29b-41d4-a716-446655440001',
    grafana_id: 12345,
    datasource_type: 'influxdb',
    uid: 'dashboard-uid-123',
    slug: 'gatling-overview',
    name: 'Gatling Overview',
    uri: 'db/gatling-overview',
    templating_variables: [mockTemplatingVariable],
    panels: [mockDashboardPanel],
    variables: [{ name: 'system_under_test' }],
    tags: ['performance', 'gatling'],
    used_by_sut: ['PaymentService', 'OrderService'],
    updated: '2024-01-15T10:00:00Z',
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
  };

  const mockServiceFactory = () => ({
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    getVariableValues: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GrafanaDashboardsController],
      providers: [
        {
          provide: GrafanaDashboardsService,
          useValue: mockServiceFactory(),
        },
      ],
    }).compile();

    controller = module.get<GrafanaDashboardsController>(GrafanaDashboardsController);
    service = module.get(GrafanaDashboardsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Happy Path - Query Operations', () => {
    describe('findAll', () => {
      it('should return all dashboards without filters', async () => {
        // Arrange
        const dashboards = [mockDashboard];
        service.findAll.mockResolvedValue(dashboards);

        // Act
        const result = await controller.findAll({}, mockUserContext);

        // Assert
        expect(result).toEqual(dashboards);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, {});
        expect(service.findAll).toHaveBeenCalledTimes(1);
      });

      it('should filter dashboards by grafanaInstanceId', async () => {
        // Arrange
        const query: GrafanaDashboardQuery = {
          grafanaInstanceId: '660e8400-e29b-41d4-a716-446655440001',
        };
        const filteredDashboards = [mockDashboard];
        service.findAll.mockResolvedValue(filteredDashboards);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual(filteredDashboards);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
      });

      it('should filter dashboards by name', async () => {
        // Arrange
        const query: GrafanaDashboardQuery = {
          name: 'Gatling',
        };
        const filteredDashboards = [mockDashboard];
        service.findAll.mockResolvedValue(filteredDashboards);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual(filteredDashboards);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
      });

      it('should filter dashboards by uid', async () => {
        // Arrange
        const query: GrafanaDashboardQuery = {
          uid: 'dashboard-uid-123',
        };
        const filteredDashboards = [mockDashboard];
        service.findAll.mockResolvedValue(filteredDashboards);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual(filteredDashboards);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
      });

      it('should parse comma-separated tags and filter dashboards', async () => {
        // Arrange
        const query: GrafanaDashboardQuery = {
          tags: 'performance,gatling,loadtest' as any, // Simulating query string input
        };
        const expectedParsedQuery = {
          tags: ['performance', 'gatling', 'loadtest'],
        };
        const filteredDashboards = [mockDashboard];
        service.findAll.mockResolvedValue(filteredDashboards);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual(filteredDashboards);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, expectedParsedQuery);
      });

      it('should handle tags as array input', async () => {
        // Arrange
        const query: GrafanaDashboardQuery = {
          tags: ['performance', 'gatling'],
        };
        const filteredDashboards = [mockDashboard];
        service.findAll.mockResolvedValue(filteredDashboards);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual(filteredDashboards);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
      });

      it('should filter by usedBySut', async () => {
        // Arrange
        const query: GrafanaDashboardQuery = {
          usedBySut: 'PaymentService',
        };
        const filteredDashboards = [mockDashboard];
        service.findAll.mockResolvedValue(filteredDashboards);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual(filteredDashboards);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
      });

      it('should handle multiple filters simultaneously', async () => {
        // Arrange
        const query: GrafanaDashboardQuery = {
          grafanaInstanceId: '660e8400-e29b-41d4-a716-446655440001',
          name: 'Gatling',
          tags: ['performance'],
          usedBySut: 'PaymentService',
        };
        const filteredDashboards = [mockDashboard];
        service.findAll.mockResolvedValue(filteredDashboards);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual(filteredDashboards);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
      });

      it('should return empty array when no dashboards match filters', async () => {
        // Arrange
        const query: GrafanaDashboardQuery = {
          name: 'NonExistentDashboard',
        };
        service.findAll.mockResolvedValue([]);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual([]);
        expect(result).toHaveLength(0);
      });

      it('should trim and filter empty tags from comma-separated string', async () => {
        // Arrange
        const query: GrafanaDashboardQuery = {
          tags: 'performance, , gatling,  ,loadtest' as any,
        };
        const expectedParsedQuery = {
          tags: ['performance', 'gatling', 'loadtest'],
        };
        const filteredDashboards = [mockDashboard];
        service.findAll.mockResolvedValue(filteredDashboards);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual(filteredDashboards);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, expectedParsedQuery);
      });
    });

    describe('findOne', () => {
      it('should return a single dashboard by id', async () => {
        // Arrange
        const dashboardId = mockDashboard.id;
        service.findOne.mockResolvedValue(mockDashboard);

        // Act
        const result = await controller.findOne(dashboardId, mockUserContext);

        // Assert
        expect(result).toEqual(mockDashboard);
        expect(service.findOne).toHaveBeenCalledWith(dashboardId, mockUserContext.userId, mockUserContext.roles);
        expect(service.findOne).toHaveBeenCalledTimes(1);
      });

      it('should return dashboard with all properties populated', async () => {
        // Arrange
        const dashboardId = mockDashboard.id;
        service.findOne.mockResolvedValue(mockDashboard);

        // Act
        const result = await controller.findOne(dashboardId, mockUserContext);

        // Assert
        expect(result).toHaveProperty('id');
        expect(result).toHaveProperty('grafana_instance_id');
        expect(result).toHaveProperty('grafana_id');
        expect(result).toHaveProperty('datasource_type');
        expect(result).toHaveProperty('uid');
        expect(result).toHaveProperty('name');
        expect(result).toHaveProperty('panels');
        expect(result).toHaveProperty('templating_variables');
        expect(result).toHaveProperty('tags');
        expect(result).toHaveProperty('used_by_sut');
      });
    });
  });

  describe('Happy Path - Mutation Operations', () => {
    describe('create', () => {
      it('should create a new dashboard', async () => {
        // Arrange
        const createDto: CreateGrafanaDashboardDto = {
          grafanaInstanceId: '660e8400-e29b-41d4-a716-446655440001',
          grafanaId: 12345,
          datasourceType: 'influxdb',
          uid: 'dashboard-uid-123',
          slug: 'gatling-overview',
          name: 'Gatling Overview',
          uri: 'db/gatling-overview',
          templatingVariables: [mockTemplatingVariable],
          panels: [mockDashboardPanel],
          variables: [{ name: 'system_under_test' }],
          tags: ['performance', 'gatling'],
          usedBySut: ['PaymentService'],
        };
        service.create.mockResolvedValue(mockDashboard);

        // Act
        const result = await controller.create(createDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockDashboard);
        expect(service.create).toHaveBeenCalledWith(createDto, mockUserContext.userId, mockUserContext.roles);
        expect(service.create).toHaveBeenCalledTimes(1);
      });

      it('should create dashboard with minimal required fields', async () => {
        // Arrange
        const minimalDto: CreateGrafanaDashboardDto = {
          grafanaInstanceId: '660e8400-e29b-41d4-a716-446655440001',
          grafanaId: 12345,
          uid: 'dashboard-uid-minimal',
          name: 'Minimal Dashboard',
          panels: [],
        };
        const minimalDashboard = {
          ...mockDashboard,
          uid: 'dashboard-uid-minimal',
          name: 'Minimal Dashboard',
          panels: [],
          tags: [],
          usedBySut: [],
        };
        service.create.mockResolvedValue(minimalDashboard);

        // Act
        const result = await controller.create(minimalDto, mockUserContext);

        // Assert
        expect(result).toEqual(minimalDashboard);
        expect(service.create).toHaveBeenCalledWith(minimalDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should create dashboard with multiple panels and variables', async () => {
        // Arrange
        const complexDto: CreateGrafanaDashboardDto = {
          grafanaInstanceId: '660e8400-e29b-41d4-a716-446655440001',
          grafanaId: 12345,
          uid: 'complex-dashboard',
          name: 'Complex Dashboard',
          panels: [
            mockDashboardPanel,
            { ...mockDashboardPanel, id: 2, title: 'Error Rate' },
            { ...mockDashboardPanel, id: 3, title: 'Throughput' },
          ],
          templatingVariables: [
            mockTemplatingVariable,
            { ...mockTemplatingVariable, name: 'environment' },
            { ...mockTemplatingVariable, name: 'workload' },
          ],
          tags: ['performance', 'monitoring', 'production'],
        };
        const complexDashboard = {
          ...mockDashboard,
          panels: complexDto.panels,
          templating_variables: complexDto.templatingVariables,
        };
        service.create.mockResolvedValue(complexDashboard);

        // Act
        const result = await controller.create(complexDto, mockUserContext);

        // Assert
        expect(result).toEqual(complexDashboard);
        expect(result.panels).toHaveLength(3);
        expect(result.templating_variables).toHaveLength(3);
      });
    });

    describe('update', () => {
      it('should update dashboard name', async () => {
        // Arrange
        const dashboardId = mockDashboard.id;
        const updateDto: UpdateGrafanaDashboardDto = {
          name: 'Updated Dashboard Name',
        };
        const updatedDashboard = {
          ...mockDashboard,
          name: 'Updated Dashboard Name',
        };
        service.update.mockResolvedValue(updatedDashboard);

        // Act
        const result = await controller.update(dashboardId, updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(updatedDashboard);
        expect(result.name).toBe('Updated Dashboard Name');
        expect(service.update).toHaveBeenCalledWith(dashboardId, updateDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should update dashboard tags', async () => {
        // Arrange
        const dashboardId = mockDashboard.id;
        const updateDto: UpdateGrafanaDashboardDto = {
          tags: ['updated', 'tags', 'new'],
        };
        const updatedDashboard = {
          ...mockDashboard,
          tags: ['updated', 'tags', 'new'],
        };
        service.update.mockResolvedValue(updatedDashboard);

        // Act
        const result = await controller.update(dashboardId, updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(updatedDashboard);
        expect(result.tags).toEqual(['updated', 'tags', 'new']);
        expect(service.update).toHaveBeenCalledWith(dashboardId, updateDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should update dashboard usedBySut', async () => {
        // Arrange
        const dashboardId = mockDashboard.id;
        const updateDto: UpdateGrafanaDashboardDto = {
          usedBySut: ['NewService', 'AnotherService'],
        };
        const updatedDashboard = {
          ...mockDashboard,
          used_by_sut: ['NewService', 'AnotherService'],
        };
        service.update.mockResolvedValue(updatedDashboard);

        // Act
        const result = await controller.update(dashboardId, updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(updatedDashboard);
        expect(result.used_by_sut).toEqual(['NewService', 'AnotherService']);
        expect(service.update).toHaveBeenCalledWith(dashboardId, updateDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should update multiple dashboard fields simultaneously', async () => {
        // Arrange
        const dashboardId = mockDashboard.id;
        const updateDto: UpdateGrafanaDashboardDto = {
          name: 'Comprehensive Update',
          datasourceType: 'prometheus',
          tags: ['updated', 'comprehensive'],
          usedBySut: ['UpdatedService'],
        };
        const updatedDashboard = {
          ...mockDashboard,
          name: 'Comprehensive Update',
          datasource_type: 'prometheus',
          tags: ['updated', 'comprehensive'],
          used_by_sut: ['UpdatedService'],
        };
        service.update.mockResolvedValue(updatedDashboard);

        // Act
        const result = await controller.update(dashboardId, updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(updatedDashboard);
        expect(service.update).toHaveBeenCalledWith(dashboardId, updateDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should update dashboard panels and variables', async () => {
        // Arrange
        const dashboardId = mockDashboard.id;
        const newPanel: DashboardPanelDto = {
          ...mockDashboardPanel,
          id: 99,
          title: 'New Panel',
        };
        const updateDto: UpdateGrafanaDashboardDto = {
          panels: [newPanel],
          variables: [{ name: 'new_variable' }],
        };
        const updatedDashboard = {
          ...mockDashboard,
          panels: [newPanel],
          variables: [{ name: 'new_variable' }],
        };
        service.update.mockResolvedValue(updatedDashboard);

        // Act
        const result = await controller.update(dashboardId, updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(updatedDashboard);
        expect(result.panels).toHaveLength(1);
        expect(result.panels![0].title).toBe('New Panel');
        expect(service.update).toHaveBeenCalledWith(dashboardId, updateDto, mockUserContext.userId, mockUserContext.roles);
      });
    });

    describe('remove', () => {
      it('should delete a dashboard', async () => {
        // Arrange
        const dashboardId = mockDashboard.id;
        service.remove.mockResolvedValue(undefined);

        // Act
        const result = await controller.remove(dashboardId, mockUserContext);

        // Assert
        expect(result).toEqual({ message: 'Grafana dashboard deleted successfully' });
        expect(service.remove).toHaveBeenCalledWith(dashboardId, mockUserContext.userId, mockUserContext.roles);
        expect(service.remove).toHaveBeenCalledTimes(1);
      });

      it('should return success message after deletion', async () => {
        // Arrange
        const dashboardId = mockDashboard.id;
        service.remove.mockResolvedValue(undefined);

        // Act
        const result = await controller.remove(dashboardId, mockUserContext);

        // Assert
        expect(result).toHaveProperty('message');
        expect(result.message).toBe('Grafana dashboard deleted successfully');
      });
    });
  });

  describe('Happy Path - Variable Values', () => {
    describe('getVariableValues', () => {
      it('should return variable values from datasource', async () => {
        // Arrange
        const requestBody = {
          grafanaDashboardId: mockDashboard.id,
          variableName: 'system_under_test',
          system: 'PaymentService',
          environment: 'production',
          existingVariables: {},
        };
        const mockValues = [
          { label: 'PaymentService', value: 'PaymentService' },
          { label: 'OrderService', value: 'OrderService' },
        ];
        service.getVariableValues.mockResolvedValue(mockValues);

        // Act
        const result = await controller.getVariableValues(requestBody, mockUserContext);

        // Assert
        expect(result).toEqual(mockValues);
        expect(service.getVariableValues).toHaveBeenCalledWith(
          requestBody.grafanaDashboardId,
          requestBody.variableName,
          requestBody.system,
          requestBody.environment,
          {},
          mockUserContext.userId,
          mockUserContext.roles,
        );
      });

      it('should pass existing variables to service', async () => {
        // Arrange
        const requestBody = {
          grafanaDashboardId: mockDashboard.id,
          variableName: 'workload',
          system: 'PaymentService',
          environment: 'production',
          existingVariables: {
            system_under_test: ['PaymentService'],
            test_environment: ['production'],
          },
        };
        const mockValues = [
          { label: 'loadTest', value: 'loadTest' },
          { label: 'stressTest', value: 'stressTest' },
        ];
        service.getVariableValues.mockResolvedValue(mockValues);

        // Act
        const result = await controller.getVariableValues(requestBody, mockUserContext);

        // Assert
        expect(result).toEqual(mockValues);
        expect(service.getVariableValues).toHaveBeenCalledWith(
          requestBody.grafanaDashboardId,
          requestBody.variableName,
          requestBody.system,
          requestBody.environment,
          requestBody.existingVariables,
          mockUserContext.userId,
          mockUserContext.roles,
        );
      });

      it('should default to empty object when existingVariables is undefined', async () => {
        // Arrange
        const requestBody = {
          grafanaDashboardId: mockDashboard.id,
          variableName: 'system_under_test',
          system: 'PaymentService',
          environment: 'production',
        };
        const mockValues = [{ label: 'PaymentService', value: 'PaymentService' }];
        service.getVariableValues.mockResolvedValue(mockValues);

        // Act
        const result = await controller.getVariableValues(requestBody, mockUserContext);

        // Assert
        expect(result).toEqual(mockValues);
        expect(service.getVariableValues).toHaveBeenCalledWith(
          requestBody.grafanaDashboardId,
          requestBody.variableName,
          requestBody.system,
          requestBody.environment,
          {},
          mockUserContext.userId,
          mockUserContext.roles,
        );
      });

      it('should return empty array when no values found', async () => {
        // Arrange
        const requestBody = {
          grafanaDashboardId: mockDashboard.id,
          variableName: 'nonexistent_variable',
          system: 'PaymentService',
          environment: 'production',
        };
        service.getVariableValues.mockResolvedValue([]);

        // Act
        const result = await controller.getVariableValues(requestBody, mockUserContext);

        // Assert
        expect(result).toEqual([]);
        expect(result).toHaveLength(0);
      });
    });
  });

  describe('Error Scenarios - Service Errors', () => {
    describe('findAll', () => {
      it('should throw HttpException when service throws error', async () => {
        // Arrange
        service.findAll.mockRejectedValue(new Error('Database connection failed'));

        // Act & Assert
        await expect(controller.findAll({}, mockUserContext)).rejects.toThrow(HttpException);
        await expect(controller.findAll({}, mockUserContext)).rejects.toThrow('Failed to fetch Grafana dashboards');
      });

      it('should throw 500 status code on service error', async () => {
        // Arrange
        service.findAll.mockRejectedValue(new Error('Database error'));

        // Act & Assert
        try {
          await controller.findAll({}, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        }
      });
    });

    describe('findOne', () => {
      it('should throw 404 HttpException when dashboard not found', async () => {
        // Arrange
        const dashboardId = 'non-existent-id';
        service.findOne.mockRejectedValue(new Error('Dashboard with ID non-existent-id not found'));

        // Act & Assert
        await expect(controller.findOne(dashboardId, mockUserContext)).rejects.toThrow(HttpException);
        try {
          await controller.findOne(dashboardId, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
          expect((error as HttpException).message).toBe('Grafana dashboard not found');
        }
      });

      it('should throw 500 HttpException for other service errors', async () => {
        // Arrange
        const dashboardId = mockDashboard.id;
        service.findOne.mockRejectedValue(new Error('Database error'));

        // Act & Assert
        await expect(controller.findOne(dashboardId, mockUserContext)).rejects.toThrow(HttpException);
        try {
          await controller.findOne(dashboardId, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
          expect((error as HttpException).message).toBe('Failed to fetch Grafana dashboard');
        }
      });

      it('should handle error with message property safely', async () => {
        // Arrange
        const dashboardId = 'test-id';
        const errorWithoutMessage = { code: 'DB_ERROR' }; // No message property
        service.findOne.mockRejectedValue(errorWithoutMessage);

        // Act & Assert
        await expect(controller.findOne(dashboardId, mockUserContext)).rejects.toThrow(HttpException);
        try {
          await controller.findOne(dashboardId, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        }
      });
    });

    describe('create', () => {
      it('should throw 400 HttpException when creation fails', async () => {
        // Arrange
        const createDto: CreateGrafanaDashboardDto = {
          grafanaInstanceId: '660e8400-e29b-41d4-a716-446655440001',
          grafanaId: 12345,
          uid: 'duplicate-uid',
          name: 'Duplicate Dashboard',
          panels: [],
        };
        service.create.mockRejectedValue(new Error('Duplicate dashboard UID'));

        // Act & Assert
        await expect(controller.create(createDto, mockUserContext)).rejects.toThrow(HttpException);
        try {
          await controller.create(createDto, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
          expect((error as HttpException).message).toBe('Duplicate dashboard UID');
        }
      });

      it('should use default error message when service error has no message', async () => {
        // Arrange
        const createDto: CreateGrafanaDashboardDto = {
          grafanaInstanceId: '660e8400-e29b-41d4-a716-446655440001',
          grafanaId: 12345,
          uid: 'test-uid',
          name: 'Test Dashboard',
          panels: [],
        };
        const errorWithoutMessage = { code: 'UNKNOWN' };
        service.create.mockRejectedValue(errorWithoutMessage);

        // Act & Assert
        await expect(controller.create(createDto, mockUserContext)).rejects.toThrow(HttpException);
        try {
          await controller.create(createDto, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).message).toBe('Failed to create Grafana dashboard');
        }
      });
    });

    describe('update', () => {
      it('should throw 404 HttpException when dashboard not found', async () => {
        // Arrange
        const dashboardId = 'non-existent-id';
        const updateDto: UpdateGrafanaDashboardDto = { name: 'Updated Name' };
        service.update.mockRejectedValue(new Error('Dashboard with ID non-existent-id not found'));

        // Act & Assert
        await expect(controller.update(dashboardId, updateDto, mockUserContext)).rejects.toThrow(HttpException);
        try {
          await controller.update(dashboardId, updateDto, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
          expect((error as HttpException).message).toBe('Grafana dashboard not found');
        }
      });

      it('should throw 400 HttpException for validation errors', async () => {
        // Arrange
        const dashboardId = mockDashboard.id;
        const updateDto: UpdateGrafanaDashboardDto = { name: '' };
        service.update.mockRejectedValue(new Error('Dashboard name cannot be empty'));

        // Act & Assert
        await expect(controller.update(dashboardId, updateDto, mockUserContext)).rejects.toThrow(HttpException);
        try {
          await controller.update(dashboardId, updateDto, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
          expect((error as HttpException).message).toBe('Dashboard name cannot be empty');
        }
      });

      it('should use default error message when service error has no message', async () => {
        // Arrange
        const dashboardId = mockDashboard.id;
        const updateDto: UpdateGrafanaDashboardDto = { name: 'Test' };
        const errorWithoutMessage = { statusCode: 500 };
        service.update.mockRejectedValue(errorWithoutMessage);

        // Act & Assert
        await expect(controller.update(dashboardId, updateDto, mockUserContext)).rejects.toThrow(HttpException);
        try {
          await controller.update(dashboardId, updateDto, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).message).toBe('Failed to update Grafana dashboard');
        }
      });
    });

    describe('remove', () => {
      // Regression: the catch block flattened every non-"not found" error into a
      // 500, so the "still in use" conflict reached the user as an opaque server
      // error with no indication of what to do about it.
      it('should preserve a 409 ConflictException instead of returning 500', async () => {
        // Arrange
        const dashboardId = mockDashboard.id;
        service.remove.mockRejectedValue(
          new ConflictException('Grafana dashboard "X" is still used by 3 application dashboard(s). Remove those first.'),
        );

        // Act & Assert
        await expect(controller.remove(dashboardId, mockUserContext)).rejects.toMatchObject({
          status: HttpStatus.CONFLICT,
        });
      });

      // The service throws NotFoundException, which is an HttpException and so takes
      // the rethrow path rather than the string-matching branch. Same 404 either way,
      // but this pins the arm the service actually exercises.
      it('should return 404 for a NotFoundException from the service', async () => {
        // Arrange
        service.remove.mockRejectedValue(
          new NotFoundException(`Grafana dashboard with ID ${mockDashboard.id} not found`),
        );

        // Act & Assert
        await expect(controller.remove(mockDashboard.id, mockUserContext)).rejects.toMatchObject({
          status: HttpStatus.NOT_FOUND,
        });
      });

      it('should throw 404 HttpException when dashboard not found', async () => {
        // Arrange
        const dashboardId = 'non-existent-id';
        service.remove.mockRejectedValue(new Error('Dashboard with ID non-existent-id not found'));

        // Act & Assert
        await expect(controller.remove(dashboardId, mockUserContext)).rejects.toThrow(HttpException);
        try {
          await controller.remove(dashboardId, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
          expect((error as HttpException).message).toBe('Grafana dashboard not found');
        }
      });

      it('should throw 500 HttpException for other service errors', async () => {
        // Arrange
        const dashboardId = mockDashboard.id;
        service.remove.mockRejectedValue(new Error('Database deletion error'));

        // Act & Assert
        await expect(controller.remove(dashboardId, mockUserContext)).rejects.toThrow(HttpException);
        try {
          await controller.remove(dashboardId, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
          expect((error as HttpException).message).toBe('Failed to delete Grafana dashboard');
        }
      });
    });

    describe('getVariableValues', () => {
      it('should throw 400 HttpException when service fails', async () => {
        // Arrange
        const requestBody = {
          grafanaDashboardId: mockDashboard.id,
          variableName: 'system_under_test',
          system: 'PaymentService',
          environment: 'production',
        };
        service.getVariableValues.mockRejectedValue(new Error('Datasource not found'));

        // Act & Assert
        await expect(controller.getVariableValues(requestBody, mockUserContext)).rejects.toThrow(HttpException);
        try {
          await controller.getVariableValues(requestBody, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
          expect((error as HttpException).message).toBe('Datasource not found');
        }
      });

      it('should use default error message when service error has no message', async () => {
        // Arrange
        const requestBody = {
          grafanaDashboardId: mockDashboard.id,
          variableName: 'test_var',
          system: 'TestSystem',
          environment: 'test',
        };
        const errorWithoutMessage = { error: 'UNKNOWN' };
        service.getVariableValues.mockRejectedValue(errorWithoutMessage);

        // Act & Assert
        await expect(controller.getVariableValues(requestBody, mockUserContext)).rejects.toThrow(HttpException);
        try {
          await controller.getVariableValues(requestBody, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).message).toBe('Failed to fetch variable values');
        }
      });
    });
  });

  describe('Edge Cases', () => {
    describe('findAll with tags parsing', () => {
      it('should handle empty tags string', async () => {
        // Arrange
        const query: GrafanaDashboardQuery = {
          tags: '' as any,
        };
        // Empty string is falsy, so it's not parsed and passed as-is to service
        service.findAll.mockResolvedValue([]);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual([]);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
      });

      it('should handle tags with only whitespace', async () => {
        // Arrange
        const query: GrafanaDashboardQuery = {
          tags: '   ,   ,   ' as any,
        };
        const expectedParsedQuery = {
          tags: [],
        };
        service.findAll.mockResolvedValue([]);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual([]);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, expectedParsedQuery);
      });

      it('should handle single tag without commas', async () => {
        // Arrange
        const query: GrafanaDashboardQuery = {
          tags: 'performance' as any,
        };
        const expectedParsedQuery = {
          tags: ['performance'],
        };
        service.findAll.mockResolvedValue([mockDashboard]);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual([mockDashboard]);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, expectedParsedQuery);
      });

      it('should not parse tags when already an array', async () => {
        // Arrange
        const query: GrafanaDashboardQuery = {
          tags: ['performance', 'gatling'],
        };
        service.findAll.mockResolvedValue([mockDashboard]);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual([mockDashboard]);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
      });
    });

    describe('findOne', () => {
      it('should handle UUID format id', async () => {
        // Arrange
        const uuidId = '550e8400-e29b-41d4-a716-446655440000';
        service.findOne.mockResolvedValue(mockDashboard);

        // Act
        const result = await controller.findOne(uuidId, mockUserContext);

        // Assert
        expect(result).toEqual(mockDashboard);
        expect(service.findOne).toHaveBeenCalledWith(uuidId, mockUserContext.userId, mockUserContext.roles);
      });
    });

    describe('create', () => {
      it('should handle dashboard with empty arrays', async () => {
        // Arrange
        const createDto: CreateGrafanaDashboardDto = {
          grafanaInstanceId: '660e8400-e29b-41d4-a716-446655440001',
          grafanaId: 12345,
          uid: 'empty-arrays',
          name: 'Empty Arrays Dashboard',
          panels: [],
          templatingVariables: [],
          variables: [],
          tags: [],
          usedBySut: [],
        };
        const createdDashboard = {
          ...mockDashboard,
          panels: [],
          templating_variables: [],
          variables: [],
          tags: [],
          used_by_sut: [],
        };
        service.create.mockResolvedValue(createdDashboard);

        // Act
        const result = await controller.create(createDto, mockUserContext);

        // Assert
        expect(result).toEqual(createdDashboard);
        expect(result.panels).toHaveLength(0);
        expect(result.tags).toHaveLength(0);
      });
    });

    describe('update', () => {
      it('should handle partial update with single field', async () => {
        // Arrange
        const dashboardId = mockDashboard.id;
        const updateDto: UpdateGrafanaDashboardDto = {
          datasourceType: 'prometheus',
        };
        const updatedDashboard = {
          ...mockDashboard,
          datasource_type: 'prometheus',
        };
        service.update.mockResolvedValue(updatedDashboard);

        // Act
        const result = await controller.update(dashboardId, updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(updatedDashboard);
        expect(result.datasource_type).toBe('prometheus');
      });

      it('should handle update with empty tags array', async () => {
        // Arrange
        const dashboardId = mockDashboard.id;
        const updateDto: UpdateGrafanaDashboardDto = {
          tags: [],
        };
        const updatedDashboard = {
          ...mockDashboard,
          tags: [],
        };
        service.update.mockResolvedValue(updatedDashboard);

        // Act
        const result = await controller.update(dashboardId, updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(updatedDashboard);
        expect(result.tags).toHaveLength(0);
      });
    });

    describe('getVariableValues', () => {
      it('should handle request with all optional fields populated', async () => {
        // Arrange
        const requestBody = {
          grafanaDashboardId: mockDashboard.id,
          variableName: 'workload',
          system: 'PaymentService',
          environment: 'production',
          existingVariables: {
            system_under_test: ['PaymentService'],
            test_environment: ['production'],
            service: ['payment-api'],
          },
        };
        const mockValues = [{ label: 'loadTest', value: 'loadTest' }];
        service.getVariableValues.mockResolvedValue(mockValues);

        // Act
        const result = await controller.getVariableValues(requestBody, mockUserContext);

        // Assert
        expect(result).toEqual(mockValues);
        expect(service.getVariableValues).toHaveBeenCalledWith(
          requestBody.grafanaDashboardId,
          requestBody.variableName,
          requestBody.system,
          requestBody.environment,
          requestBody.existingVariables,
          mockUserContext.userId,
          mockUserContext.roles,
        );
      });
    });
  });

  describe('Boundary Values', () => {
    describe('findAll', () => {
      it('should handle query with very long dashboard name', async () => {
        // Arrange
        const longName = 'A'.repeat(500); // Very long name
        const query: GrafanaDashboardQuery = {
          name: longName,
        };
        service.findAll.mockResolvedValue([]);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual([]);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
      });

      it('should handle query with many tags', async () => {
        // Arrange
        const manyTags = Array(50).fill('tag').map((t, i) => `${t}-${i}`);
        const query: GrafanaDashboardQuery = {
          tags: manyTags,
        };
        service.findAll.mockResolvedValue([]);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual([]);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
      });

      it('should handle large result set', async () => {
        // Arrange
        const largeDashboardList = Array(1000).fill(mockDashboard).map((d, i) => ({
          ...d,
          id: `id-${i}`,
          name: `Dashboard ${i}`,
        }));
        service.findAll.mockResolvedValue(largeDashboardList);

        // Act
        const result = await controller.findAll({}, mockUserContext);

        // Assert
        expect(result).toHaveLength(1000);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, {});
      });
    });

    describe('create', () => {
      it('should handle dashboard with maximum field lengths', async () => {
        // Arrange
        const maxLengthDto: CreateGrafanaDashboardDto = {
          grafanaInstanceId: '660e8400-e29b-41d4-a716-446655440001',
          grafanaId: 999999999,
          datasourceType: 'A'.repeat(100), // Max 100 chars
          uid: 'B'.repeat(100), // Max 100 chars
          slug: 'C'.repeat(255), // Max 255 chars
          name: 'D'.repeat(255), // Max 255 chars
          uri: 'E'.repeat(500),
          panels: [],
        };
        const createdDashboard = {
          ...mockDashboard,
          ...maxLengthDto,
          datasource_type: maxLengthDto.datasourceType,
        };
        service.create.mockResolvedValue(createdDashboard);

        // Act
        const result = await controller.create(maxLengthDto, mockUserContext);

        // Assert
        expect(result).toEqual(createdDashboard);
        expect(service.create).toHaveBeenCalledWith(maxLengthDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should handle dashboard with many panels', async () => {
        // Arrange
        const manyPanels = Array(100).fill(mockDashboardPanel).map((p, i) => ({
          ...p,
          id: i + 1,
          title: `Panel ${i + 1}`,
        }));
        const createDto: CreateGrafanaDashboardDto = {
          grafanaInstanceId: '660e8400-e29b-41d4-a716-446655440001',
          grafanaId: 12345,
          uid: 'many-panels',
          name: 'Many Panels Dashboard',
          panels: manyPanels,
        };
        const createdDashboard = {
          ...mockDashboard,
          panels: manyPanels,
        };
        service.create.mockResolvedValue(createdDashboard);

        // Act
        const result = await controller.create(createDto, mockUserContext);

        // Assert
        expect(result).toEqual(createdDashboard);
        expect(result.panels).toHaveLength(100);
      });
    });
  });
});
