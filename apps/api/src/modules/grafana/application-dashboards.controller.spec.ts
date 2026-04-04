import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { ApplicationDashboardsController } from './application-dashboards.controller';
import { ApplicationDashboardsService, ApplicationDashboard } from './application-dashboards.service';
import { CreateApplicationDashboardDto, UpdateApplicationDashboardDto } from './dto/application-dashboard.dto';
import { UserContext } from '../../common/decorators/user-context.decorator';

describe('ApplicationDashboardsController', () => {
  // Mock user context for authorization
  const mockUserContext: UserContext = {
    userId: 'test-user-123',
    roles: ['user'],
    organizations: ['org-123'],
    teams: ['team-456'],
    organizationId: 'org-123',
    teamId: 'team-456',
  };
  let controller: ApplicationDashboardsController;
  let service: jest.Mocked<ApplicationDashboardsService>;

  // Mock data fixtures
  const mockApplicationDashboard: ApplicationDashboard = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    system_under_test_id: '660e8400-e29b-41d4-a716-446655440000',
    test_environment: 'production',
    grafana_instance_id: '770e8400-e29b-41d4-a716-446655440000',
    grafana_dashboard_id: '880e8400-e29b-41d4-a716-446655440000',
    dashboard_name: 'System Performance',
    dashboard_id: 123,
    dashboard_uid: 'sys-perf-001',
    dashboard_label: 'Production System Dashboard',
    tags: ['performance', 'production'],
    template_dashboard_uid: 'template-001',
    variables: [
      { name: 'environment', values: ['production'] },
      { name: 'instance', values: ['server-1', 'server-2'] },
    ],
    replaced_templating_variables: [
      { name: 'workload', value: ['loadTest'] },
    ],
    snapshot_timeout: 30,
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
    grafana_instance: {
      id: '770e8400-e29b-41d4-a716-446655440000',
      label: 'Production Grafana',
      client_url: 'https://grafana.example.com',
      server_url: 'http://grafana.internal:3000',
    },
    systems_under_test: {
      id: '660e8400-e29b-41d4-a716-446655440000',
      name: 'PaymentService',
    },
  };

  const mockServiceFactory = () => ({
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    getDeleteInfo: jest.fn(),
    getBatchDeleteInfo: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApplicationDashboardsController],
      providers: [
        {
          provide: ApplicationDashboardsService,
          useValue: mockServiceFactory(),
        },
      ],
    }).compile();

    controller = module.get<ApplicationDashboardsController>(ApplicationDashboardsController);
    service = module.get(ApplicationDashboardsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Happy Path - Query Operations', () => {
    describe('findAll', () => {
      it('should return all application dashboards without filters', async () => {
        // Arrange
        const mockDashboards = [mockApplicationDashboard];
        service.findAll.mockResolvedValue(mockDashboards);

        // Act
        const result = await controller.findAll({}, mockUserContext);

        // Assert
        expect(result).toEqual(mockDashboards);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, {});
        expect(service.findAll).toHaveBeenCalledTimes(1);
      });

      it('should return application dashboards filtered by systemId', async () => {
        // Arrange
        const query = { systemId: '660e8400-e29b-41d4-a716-446655440000' };
        const mockDashboards = [mockApplicationDashboard];
        service.findAll.mockResolvedValue(mockDashboards);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual(mockDashboards);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
      });

      it('should return application dashboards filtered by systemUnderTestId (alias)', async () => {
        // Arrange
        const query = { systemUnderTestId: '660e8400-e29b-41d4-a716-446655440000' };
        const mockDashboards = [mockApplicationDashboard];
        service.findAll.mockResolvedValue(mockDashboards);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual(mockDashboards);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
      });

      it('should return application dashboards filtered by environment', async () => {
        // Arrange
        const query = { environment: 'production' };
        const mockDashboards = [mockApplicationDashboard];
        service.findAll.mockResolvedValue(mockDashboards);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual(mockDashboards);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
      });

      it('should return application dashboards filtered by testEnvironment (alias)', async () => {
        // Arrange
        const query = { testEnvironment: 'production' };
        const mockDashboards = [mockApplicationDashboard];
        service.findAll.mockResolvedValue(mockDashboards);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual(mockDashboards);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
      });

      it('should return application dashboards filtered by grafanaInstanceId', async () => {
        // Arrange
        const query = { grafanaInstanceId: '770e8400-e29b-41d4-a716-446655440000' };
        const mockDashboards = [mockApplicationDashboard];
        service.findAll.mockResolvedValue(mockDashboards);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual(mockDashboards);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
      });

      it('should return application dashboards filtered by dashboardLabel (partial match)', async () => {
        // Arrange
        const query = { dashboardLabel: 'System' };
        const mockDashboards = [mockApplicationDashboard];
        service.findAll.mockResolvedValue(mockDashboards);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual(mockDashboards);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
      });

      it('should return application dashboards filtered by dashboardUid', async () => {
        // Arrange
        const query = { dashboardUid: 'sys-perf-001' };
        const mockDashboards = [mockApplicationDashboard];
        service.findAll.mockResolvedValue(mockDashboards);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual(mockDashboards);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
      });

      it('should parse comma-separated tags string into array', async () => {
        // Arrange
        const query = { tags: 'performance,production,critical' };
        const expectedQuery = { tags: ['performance', 'production', 'critical'] };
        const mockDashboards = [mockApplicationDashboard];
        service.findAll.mockResolvedValue(mockDashboards);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual(mockDashboards);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, expectedQuery);
      });

      it('should trim whitespace from parsed tags', async () => {
        // Arrange
        const query = { tags: ' performance , production , critical ' };
        const expectedQuery = { tags: ['performance', 'production', 'critical'] };
        const mockDashboards = [mockApplicationDashboard];
        service.findAll.mockResolvedValue(mockDashboards);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual(mockDashboards);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, expectedQuery);
      });

      it('should filter out empty tags after splitting', async () => {
        // Arrange
        const query = { tags: 'performance,,production,  ,critical' };
        const expectedQuery = { tags: ['performance', 'production', 'critical'] };
        const mockDashboards = [mockApplicationDashboard];
        service.findAll.mockResolvedValue(mockDashboards);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual(mockDashboards);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, expectedQuery);
      });

      it('should return application dashboards with multiple filters', async () => {
        // Arrange
        const query = {
          systemUnderTestId: '660e8400-e29b-41d4-a716-446655440000',
          testEnvironment: 'production',
          grafanaInstanceId: '770e8400-e29b-41d4-a716-446655440000',
          tags: 'performance,production',
        };
        const expectedQuery = {
          ...query,
          tags: ['performance', 'production'],
        };
        const mockDashboards = [mockApplicationDashboard];
        service.findAll.mockResolvedValue(mockDashboards);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual(mockDashboards);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, expectedQuery);
      });

      it('should handle empty results', async () => {
        // Arrange
        service.findAll.mockResolvedValue([]);

        // Act
        const result = await controller.findAll({}, mockUserContext);

        // Assert
        expect(result).toEqual([]);
        expect(result).toHaveLength(0);
      });

      it('should handle tags already provided as array', async () => {
        // Arrange
        const query = { tags: ['performance', 'production'] };
        const mockDashboards = [mockApplicationDashboard];
        service.findAll.mockResolvedValue(mockDashboards);

        // Act
        const result = await controller.findAll(query, mockUserContext);

        // Assert
        expect(result).toEqual(mockDashboards);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
      });
    });

    describe('findOne', () => {
      it('should return an application dashboard by ID', async () => {
        // Arrange
        const id = mockApplicationDashboard.id;
        service.findOne.mockResolvedValue(mockApplicationDashboard);

        // Act
        const result = await controller.findOne(id, mockUserContext);

        // Assert
        expect(result).toEqual(mockApplicationDashboard);
        expect(service.findOne).toHaveBeenCalledWith(id, mockUserContext.userId, mockUserContext.roles);
        expect(service.findOne).toHaveBeenCalledTimes(1);
      });

      it('should return dashboard with all related data', async () => {
        // Arrange
        const id = mockApplicationDashboard.id;
        service.findOne.mockResolvedValue(mockApplicationDashboard);

        // Act
        const result = await controller.findOne(id, mockUserContext);

        // Assert
        expect(result).toHaveProperty('grafana_instance');
        expect(result).toHaveProperty('systems_under_test');
        expect(result.grafana_instance).toEqual({
          id: '770e8400-e29b-41d4-a716-446655440000',
          label: 'Production Grafana',
          client_url: 'https://grafana.example.com',
          server_url: 'http://grafana.internal:3000',
        });
        expect(result.systems_under_test).toEqual({
          id: '660e8400-e29b-41d4-a716-446655440000',
          name: 'PaymentService',
        });
      });
    });
  });

  describe('Happy Path - Create Operation', () => {
    describe('create', () => {
      it('should create a new application dashboard', async () => {
        // Arrange
        const createDto: CreateApplicationDashboardDto = {
          systemUnderTestId: '660e8400-e29b-41d4-a716-446655440000',
          testEnvironment: 'production',
          grafanaInstanceId: '770e8400-e29b-41d4-a716-446655440000',
          grafanaDashboardId: '880e8400-e29b-41d4-a716-446655440000',
          dashboardName: 'System Performance',
          dashboardId: 123,
          dashboardUid: 'sys-perf-001',
          dashboardLabel: 'Production System Dashboard',
          tags: ['performance', 'production'],
          templateDashboardUid: 'template-001',
          variables: [
            { name: 'environment', values: ['production'] },
            { name: 'instance', values: ['server-1', 'server-2'] },
          ],
          replacedTemplatingVariables: [
            { name: 'workload', value: ['loadTest'] },
          ],
          snapshotTimeout: 30,
        };
        service.create.mockResolvedValue(mockApplicationDashboard);

        // Act
        const result = await controller.create(createDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockApplicationDashboard);
        expect(service.create).toHaveBeenCalledWith(createDto, mockUserContext.userId, mockUserContext.roles);
        expect(service.create).toHaveBeenCalledTimes(1);
      });

      it('should create application dashboard with minimal required fields', async () => {
        // Arrange
        const createDto: CreateApplicationDashboardDto = {
          systemUnderTestId: '660e8400-e29b-41d4-a716-446655440000',
          testEnvironment: 'production',
          grafanaInstanceId: '770e8400-e29b-41d4-a716-446655440000',
          grafanaDashboardId: '880e8400-e29b-41d4-a716-446655440000',
          dashboardName: 'System Performance',
          dashboardLabel: 'Production System Dashboard',
        };
        const minimalDashboard = {
          ...mockApplicationDashboard,
          dashboard_id: undefined,
          dashboard_uid: undefined,
          tags: [],
          template_dashboard_uid: undefined,
          variables: [],
          replaced_templating_variables: [],
          snapshot_timeout: 4, // default value
        };
        service.create.mockResolvedValue(minimalDashboard);

        // Act
        const result = await controller.create(createDto, mockUserContext);

        // Assert
        expect(result).toEqual(minimalDashboard);
        expect(service.create).toHaveBeenCalledWith(createDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should create application dashboard with custom snapshot timeout', async () => {
        // Arrange
        const createDto: CreateApplicationDashboardDto = {
          systemUnderTestId: '660e8400-e29b-41d4-a716-446655440000',
          testEnvironment: 'production',
          grafanaInstanceId: '770e8400-e29b-41d4-a716-446655440000',
          grafanaDashboardId: '880e8400-e29b-41d4-a716-446655440000',
          dashboardName: 'System Performance',
          dashboardLabel: 'Production System Dashboard',
          snapshotTimeout: 120,
        };
        const dashboardWithCustomTimeout = {
          ...mockApplicationDashboard,
          snapshot_timeout: 120,
        };
        service.create.mockResolvedValue(dashboardWithCustomTimeout);

        // Act
        const result = await controller.create(createDto, mockUserContext);

        // Assert
        expect(result.snapshot_timeout).toBe(120);
        expect(service.create).toHaveBeenCalledWith(createDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should create application dashboard with multiple tags', async () => {
        // Arrange
        const createDto: CreateApplicationDashboardDto = {
          systemUnderTestId: '660e8400-e29b-41d4-a716-446655440000',
          testEnvironment: 'production',
          grafanaInstanceId: '770e8400-e29b-41d4-a716-446655440000',
          grafanaDashboardId: '880e8400-e29b-41d4-a716-446655440000',
          dashboardName: 'System Performance',
          dashboardLabel: 'Production System Dashboard',
          tags: ['performance', 'production', 'critical', 'sla'],
        };
        const dashboardWithTags = {
          ...mockApplicationDashboard,
          tags: ['performance', 'production', 'critical', 'sla'],
        };
        service.create.mockResolvedValue(dashboardWithTags);

        // Act
        const result = await controller.create(createDto, mockUserContext);

        // Assert
        expect(result.tags).toHaveLength(4);
        expect(result.tags).toEqual(['performance', 'production', 'critical', 'sla']);
      });

      it('should create application dashboard with complex variables', async () => {
        // Arrange
        const createDto: CreateApplicationDashboardDto = {
          systemUnderTestId: '660e8400-e29b-41d4-a716-446655440000',
          testEnvironment: 'production',
          grafanaInstanceId: '770e8400-e29b-41d4-a716-446655440000',
          grafanaDashboardId: '880e8400-e29b-41d4-a716-446655440000',
          dashboardName: 'System Performance',
          dashboardLabel: 'Production System Dashboard',
          variables: [
            { name: 'environment', values: ['production', 'staging'] },
            { name: 'instance', values: ['server-1', 'server-2', 'server-3'] },
            { name: 'region', values: ['us-east-1', 'eu-west-1'] },
          ],
        };
        const dashboardWithVars = {
          ...mockApplicationDashboard,
          variables: createDto.variables,
        };
        service.create.mockResolvedValue(dashboardWithVars);

        // Act
        const result = await controller.create(createDto, mockUserContext);

        // Assert
        expect(result.variables).toHaveLength(3);
        expect(result.variables).toEqual(createDto.variables);
      });
    });
  });

  describe('Happy Path - Update Operation', () => {
    describe('update', () => {
      it('should update an application dashboard', async () => {
        // Arrange
        const id = mockApplicationDashboard.id;
        const updateDto: UpdateApplicationDashboardDto = {
          dashboardLabel: 'Updated Dashboard Label',
          tags: ['updated', 'tags'],
        };
        const updatedDashboard = {
          ...mockApplicationDashboard,
          dashboard_label: 'Updated Dashboard Label',
          tags: ['updated', 'tags'],
          updated_at: '2024-01-15T11:00:00Z',
        };
        service.update.mockResolvedValue(updatedDashboard);

        // Act
        const result = await controller.update(id, updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(updatedDashboard);
        expect(service.update).toHaveBeenCalledWith(id, updateDto, mockUserContext.userId, mockUserContext.roles);
        expect(service.update).toHaveBeenCalledTimes(1);
      });

      it('should update snapshot timeout', async () => {
        // Arrange
        const id = mockApplicationDashboard.id;
        const updateDto: UpdateApplicationDashboardDto = {
          snapshotTimeout: 60,
        };
        const updatedDashboard = {
          ...mockApplicationDashboard,
          snapshot_timeout: 60,
          updated_at: '2024-01-15T11:00:00Z',
        };
        service.update.mockResolvedValue(updatedDashboard);

        // Act
        const result = await controller.update(id, updateDto, mockUserContext);

        // Assert
        expect(result.snapshot_timeout).toBe(60);
        expect(service.update).toHaveBeenCalledWith(id, updateDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should update test environment', async () => {
        // Arrange
        const id = mockApplicationDashboard.id;
        const updateDto: UpdateApplicationDashboardDto = {
          testEnvironment: 'staging',
        };
        const updatedDashboard = {
          ...mockApplicationDashboard,
          test_environment: 'staging',
          updated_at: '2024-01-15T11:00:00Z',
        };
        service.update.mockResolvedValue(updatedDashboard);

        // Act
        const result = await controller.update(id, updateDto, mockUserContext);

        // Assert
        expect(result.test_environment).toBe('staging');
        expect(service.update).toHaveBeenCalledWith(id, updateDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should update dashboard variables', async () => {
        // Arrange
        const id = mockApplicationDashboard.id;
        const updateDto: UpdateApplicationDashboardDto = {
          variables: [
            { name: 'environment', values: ['production', 'staging', 'dev'] },
          ],
        };
        const updatedDashboard = {
          ...mockApplicationDashboard,
          variables: updateDto.variables,
          updated_at: '2024-01-15T11:00:00Z',
        };
        service.update.mockResolvedValue(updatedDashboard);

        // Act
        const result = await controller.update(id, updateDto, mockUserContext);

        // Assert
        expect(result.variables).toEqual(updateDto.variables);
        expect(service.update).toHaveBeenCalledWith(id, updateDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should update multiple fields at once', async () => {
        // Arrange
        const id = mockApplicationDashboard.id;
        const updateDto: UpdateApplicationDashboardDto = {
          dashboardLabel: 'Completely Updated',
          tags: ['new', 'tags', 'here'],
          snapshotTimeout: 90,
          templateDashboardUid: 'new-template-uid',
        };
        const updatedDashboard = {
          ...mockApplicationDashboard,
          dashboard_label: 'Completely Updated',
          tags: ['new', 'tags', 'here'],
          snapshot_timeout: 90,
          template_dashboard_uid: 'new-template-uid',
          updated_at: '2024-01-15T11:00:00Z',
        };
        service.update.mockResolvedValue(updatedDashboard);

        // Act
        const result = await controller.update(id, updateDto, mockUserContext);

        // Assert
        expect(result.dashboard_label).toBe('Completely Updated');
        expect(result.tags).toEqual(['new', 'tags', 'here']);
        expect(result.snapshot_timeout).toBe(90);
        expect(result.template_dashboard_uid).toBe('new-template-uid');
      });

      it('should update with empty tags array', async () => {
        // Arrange
        const id = mockApplicationDashboard.id;
        const updateDto: UpdateApplicationDashboardDto = {
          tags: [],
        };
        const updatedDashboard = {
          ...mockApplicationDashboard,
          tags: [],
          updated_at: '2024-01-15T11:00:00Z',
        };
        service.update.mockResolvedValue(updatedDashboard);

        // Act
        const result = await controller.update(id, updateDto, mockUserContext);

        // Assert
        expect(result.tags).toEqual([]);
        expect(service.update).toHaveBeenCalledWith(id, updateDto, mockUserContext.userId, mockUserContext.roles);
      });
    });
  });

  describe('Happy Path - Delete Operation', () => {
    describe('delete', () => {
      it('should delete an application dashboard', async () => {
        // Arrange
        const id = mockApplicationDashboard.id;
        service.delete.mockResolvedValue(undefined);

        // Act
        await controller.delete(id, undefined, mockUserContext);

        // Assert - delete now takes an optional second parameter (deleteGrafanaDashboard, defaults to false)
        expect(service.delete).toHaveBeenCalledWith(id, false, mockUserContext.userId, mockUserContext.roles);
        expect(service.delete).toHaveBeenCalledTimes(1);
      });

      it('should return void on successful deletion', async () => {
        // Arrange
        const id = mockApplicationDashboard.id;
        service.delete.mockResolvedValue(undefined);

        // Act
        const result = await controller.delete(id, undefined, mockUserContext);

        // Assert
        expect(result).toBeUndefined();
      });
    });
  });

  describe('Error Scenarios - findAll', () => {
    it('should throw INTERNAL_SERVER_ERROR when service throws unexpected error', async () => {
      // Arrange
      const unexpectedError = new Error('Database connection failed');
      service.findAll.mockRejectedValue(unexpectedError);

      // Act & Assert
      await expect(controller.findAll({}, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.findAll({}, mockUserContext)).rejects.toThrow(
        new HttpException('Failed to fetch application dashboards', HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });

    it('should throw INTERNAL_SERVER_ERROR when service throws non-Error object', async () => {
      // Arrange
      service.findAll.mockRejectedValue('String error');

      // Act & Assert
      await expect(controller.findAll({}, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.findAll({}, mockUserContext)).rejects.toThrow(
        new HttpException('Failed to fetch application dashboards', HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });

    it('should throw INTERNAL_SERVER_ERROR when service throws null', async () => {
      // Arrange
      service.findAll.mockRejectedValue(null);

      // Act & Assert
      await expect(controller.findAll({}, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.findAll({}, mockUserContext)).rejects.toThrow(
        new HttpException('Failed to fetch application dashboards', HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });
  });

  describe('Error Scenarios - findOne', () => {
    it('should throw NOT_FOUND when dashboard does not exist', async () => {
      // Arrange
      const id = '999e8400-e29b-41d4-a716-446655440000';
      const notFoundError = new NotFoundException('Application dashboard with ID 999e8400-e29b-41d4-a716-446655440000 not found');
      service.findOne.mockRejectedValue(notFoundError);

      // Act & Assert
      await expect(controller.findOne(id, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.findOne(id, mockUserContext)).rejects.toThrow(
        new HttpException('Application dashboard not found', HttpStatus.NOT_FOUND),
      );
    });

    it('should throw INTERNAL_SERVER_ERROR when service throws unexpected error', async () => {
      // Arrange
      const id = mockApplicationDashboard.id;
      const unexpectedError = new Error('Database connection lost');
      service.findOne.mockRejectedValue(unexpectedError);

      // Act & Assert
      await expect(controller.findOne(id, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.findOne(id, mockUserContext)).rejects.toThrow(
        new HttpException('Failed to fetch application dashboard', HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });

    it('should throw NOT_FOUND when NotFoundException is thrown', async () => {
      // Arrange
      const id = '999e8400-e29b-41d4-a716-446655440000';
      const notFoundError = new NotFoundException('Dashboard not found in database');
      service.findOne.mockRejectedValue(notFoundError);

      // Act & Assert
      await expect(controller.findOne(id, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.findOne(id, mockUserContext)).rejects.toThrow(
        new HttpException('Application dashboard not found', HttpStatus.NOT_FOUND),
      );
    });

    it('should throw INTERNAL_SERVER_ERROR for plain Error objects', async () => {
      // Arrange
      const id = mockApplicationDashboard.id;
      const errorObject = new Error('Custom error');
      service.findOne.mockRejectedValue(errorObject);

      // Act & Assert
      await expect(controller.findOne(id, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.findOne(id, mockUserContext)).rejects.toThrow(
        new HttpException('Failed to fetch application dashboard', HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });

    it('should throw INTERNAL_SERVER_ERROR for non-Error object without message', async () => {
      // Arrange
      const id = mockApplicationDashboard.id;
      service.findOne.mockRejectedValue('String error');

      // Act & Assert
      await expect(controller.findOne(id, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.findOne(id, mockUserContext)).rejects.toThrow(
        new HttpException('Failed to fetch application dashboard', HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });
  });

  describe('Error Scenarios - create', () => {
    it('should throw BAD_REQUEST when service throws validation error', async () => {
      // Arrange
      const createDto: CreateApplicationDashboardDto = {
        systemUnderTestId: 'invalid-uuid',
        testEnvironment: 'production',
        grafanaInstanceId: '770e8400-e29b-41d4-a716-446655440000',
        grafanaDashboardId: '880e8400-e29b-41d4-a716-446655440000',
        dashboardName: 'System Performance',
        dashboardLabel: 'Production System Dashboard',
      };
      const validationError = new Error('Invalid UUID format for systemUnderTestId');
      service.create.mockRejectedValue(validationError);

      // Act & Assert
      await expect(controller.create(createDto, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.create(createDto, mockUserContext)).rejects.toThrow(
        new HttpException('Invalid UUID format for systemUnderTestId', HttpStatus.BAD_REQUEST),
      );
    });

    it('should throw BAD_REQUEST when Grafana instance does not exist', async () => {
      // Arrange
      const createDto: CreateApplicationDashboardDto = {
        systemUnderTestId: '660e8400-e29b-41d4-a716-446655440000',
        testEnvironment: 'production',
        grafanaInstanceId: '999e8400-e29b-41d4-a716-446655440000',
        grafanaDashboardId: '880e8400-e29b-41d4-a716-446655440000',
        dashboardName: 'System Performance',
        dashboardLabel: 'Production System Dashboard',
      };
      const foreignKeyError = new Error('Grafana instance does not exist');
      service.create.mockRejectedValue(foreignKeyError);

      // Act & Assert
      await expect(controller.create(createDto, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.create(createDto, mockUserContext)).rejects.toThrow(
        new HttpException('Grafana instance does not exist', HttpStatus.BAD_REQUEST),
      );
    });

    it('should throw BAD_REQUEST when system under test does not exist', async () => {
      // Arrange
      const createDto: CreateApplicationDashboardDto = {
        systemUnderTestId: '999e8400-e29b-41d4-a716-446655440000',
        testEnvironment: 'production',
        grafanaInstanceId: '770e8400-e29b-41d4-a716-446655440000',
        grafanaDashboardId: '880e8400-e29b-41d4-a716-446655440000',
        dashboardName: 'System Performance',
        dashboardLabel: 'Production System Dashboard',
      };
      const foreignKeyError = new Error('System under test does not exist');
      service.create.mockRejectedValue(foreignKeyError);

      // Act & Assert
      await expect(controller.create(createDto, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.create(createDto, mockUserContext)).rejects.toThrow(
        new HttpException('System under test does not exist', HttpStatus.BAD_REQUEST),
      );
    });

    it('should throw BAD_REQUEST with default message when error has no message', async () => {
      // Arrange
      const createDto: CreateApplicationDashboardDto = {
        systemUnderTestId: '660e8400-e29b-41d4-a716-446655440000',
        testEnvironment: 'production',
        grafanaInstanceId: '770e8400-e29b-41d4-a716-446655440000',
        grafanaDashboardId: '880e8400-e29b-41d4-a716-446655440000',
        dashboardName: 'System Performance',
        dashboardLabel: 'Production System Dashboard',
      };
      service.create.mockRejectedValue(null);

      // Act & Assert
      await expect(controller.create(createDto, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.create(createDto, mockUserContext)).rejects.toThrow(
        new HttpException('Failed to create application dashboard', HttpStatus.BAD_REQUEST),
      );
    });

    it('should use safe error checking pattern', async () => {
      // Arrange
      const createDto: CreateApplicationDashboardDto = {
        systemUnderTestId: '660e8400-e29b-41d4-a716-446655440000',
        testEnvironment: 'production',
        grafanaInstanceId: '770e8400-e29b-41d4-a716-446655440000',
        grafanaDashboardId: '880e8400-e29b-41d4-a716-446655440000',
        dashboardName: 'System Performance',
        dashboardLabel: 'Production System Dashboard',
      };
      const errorObject = { message: 'Duplicate dashboard label' };
      service.create.mockRejectedValue(errorObject);

      // Act & Assert
      await expect(controller.create(createDto, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.create(createDto, mockUserContext)).rejects.toThrow(
        new HttpException('Duplicate dashboard label', HttpStatus.BAD_REQUEST),
      );
    });
  });

  describe('Error Scenarios - update', () => {
    it('should throw NOT_FOUND when dashboard does not exist', async () => {
      // Arrange
      const id = '999e8400-e29b-41d4-a716-446655440000';
      const updateDto: UpdateApplicationDashboardDto = {
        dashboardLabel: 'Updated Label',
      };
      const notFoundError = new NotFoundException('Application dashboard with id 999e8400-e29b-41d4-a716-446655440000 not found');
      service.update.mockRejectedValue(notFoundError);

      // Act & Assert
      await expect(controller.update(id, updateDto, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.update(id, updateDto, mockUserContext)).rejects.toThrow(
        new HttpException('Application dashboard not found', HttpStatus.NOT_FOUND),
      );
    });

    it('should throw BAD_REQUEST when validation fails', async () => {
      // Arrange
      const id = mockApplicationDashboard.id;
      const updateDto: UpdateApplicationDashboardDto = {
        snapshotTimeout: -1, // Invalid timeout
      };
      const validationError = new Error('Snapshot timeout must be between 1 and 300');
      service.update.mockRejectedValue(validationError);

      // Act & Assert
      await expect(controller.update(id, updateDto, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.update(id, updateDto, mockUserContext)).rejects.toThrow(
        new HttpException('Snapshot timeout must be between 1 and 300', HttpStatus.BAD_REQUEST),
      );
    });

    it('should throw NOT_FOUND when NotFoundException is thrown', async () => {
      // Arrange
      const id = '999e8400-e29b-41d4-a716-446655440000';
      const updateDto: UpdateApplicationDashboardDto = {
        dashboardLabel: 'Updated Label',
      };
      const notFoundError = new NotFoundException('Dashboard not found');
      service.update.mockRejectedValue(notFoundError);

      // Act & Assert
      await expect(controller.update(id, updateDto, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.update(id, updateDto, mockUserContext)).rejects.toThrow(
        new HttpException('Application dashboard not found', HttpStatus.NOT_FOUND),
      );
    });

    it('should throw BAD_REQUEST with default message when error has no message', async () => {
      // Arrange
      const id = mockApplicationDashboard.id;
      const updateDto: UpdateApplicationDashboardDto = {
        dashboardLabel: 'Updated Label',
      };
      service.update.mockRejectedValue(null);

      // Act & Assert
      await expect(controller.update(id, updateDto, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.update(id, updateDto, mockUserContext)).rejects.toThrow(
        new HttpException('Failed to update application dashboard', HttpStatus.BAD_REQUEST),
      );
    });

    it('should use safe error checking pattern for update', async () => {
      // Arrange
      const id = mockApplicationDashboard.id;
      const updateDto: UpdateApplicationDashboardDto = {
        dashboardLabel: 'Updated Label',
      };
      const errorObject = { message: 'Invalid grafana instance ID' };
      service.update.mockRejectedValue(errorObject);

      // Act & Assert
      await expect(controller.update(id, updateDto, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.update(id, updateDto, mockUserContext)).rejects.toThrow(
        new HttpException('Invalid grafana instance ID', HttpStatus.BAD_REQUEST),
      );
    });

    it('should throw BAD_REQUEST when foreign key constraint fails', async () => {
      // Arrange
      const id = mockApplicationDashboard.id;
      const updateDto: UpdateApplicationDashboardDto = {
        grafanaInstanceId: '999e8400-e29b-41d4-a716-446655440000',
      };
      const foreignKeyError = new Error('Referenced Grafana instance does not exist');
      service.update.mockRejectedValue(foreignKeyError);

      // Act & Assert
      await expect(controller.update(id, updateDto, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.update(id, updateDto, mockUserContext)).rejects.toThrow(
        new HttpException('Referenced Grafana instance does not exist', HttpStatus.BAD_REQUEST),
      );
    });
  });

  describe('Error Scenarios - delete', () => {
    it('should throw NOT_FOUND when dashboard does not exist', async () => {
      // Arrange
      const id = '999e8400-e29b-41d4-a716-446655440000';
      const notFoundError = new NotFoundException('Application dashboard with id 999e8400-e29b-41d4-a716-446655440000 not found');
      service.delete.mockRejectedValue(notFoundError);

      // Act & Assert
      await expect(controller.delete(id, undefined, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.delete(id, undefined, mockUserContext)).rejects.toThrow(
        new HttpException('Application dashboard not found', HttpStatus.NOT_FOUND),
      );
    });

    it('should throw INTERNAL_SERVER_ERROR when service throws unexpected error', async () => {
      // Arrange
      const id = mockApplicationDashboard.id;
      const unexpectedError = new Error('Database transaction failed');
      service.delete.mockRejectedValue(unexpectedError);

      // Act & Assert
      await expect(controller.delete(id, undefined, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.delete(id, undefined, mockUserContext)).rejects.toThrow(
        new HttpException('Database transaction failed', HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });

    it('should throw NOT_FOUND when NotFoundException is thrown', async () => {
      // Arrange
      const id = '999e8400-e29b-41d4-a716-446655440000';
      const notFoundError = new NotFoundException('Dashboard not found');
      service.delete.mockRejectedValue(notFoundError);

      // Act & Assert
      await expect(controller.delete(id, undefined, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.delete(id, undefined, mockUserContext)).rejects.toThrow(
        new HttpException('Application dashboard not found', HttpStatus.NOT_FOUND),
      );
    });

    it('should throw INTERNAL_SERVER_ERROR with default message when error has no message', async () => {
      // Arrange
      const id = mockApplicationDashboard.id;
      service.delete.mockRejectedValue(null);

      // Act & Assert
      await expect(controller.delete(id, undefined, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.delete(id, undefined, mockUserContext)).rejects.toThrow(
        new HttpException('Failed to delete application dashboard', HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });

    it('should use NotFoundException for not found errors in delete', async () => {
      // Arrange
      const id = mockApplicationDashboard.id;
      const notFoundError = new NotFoundException('Record not found');
      service.delete.mockRejectedValue(notFoundError);

      // Act & Assert
      await expect(controller.delete(id, undefined, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.delete(id, undefined, mockUserContext)).rejects.toThrow(
        new HttpException('Application dashboard not found', HttpStatus.NOT_FOUND),
      );
    });

    it('should throw INTERNAL_SERVER_ERROR for string error', async () => {
      // Arrange
      const id = mockApplicationDashboard.id;
      service.delete.mockRejectedValue('Deletion failed');

      // Act & Assert
      await expect(controller.delete(id, undefined, mockUserContext)).rejects.toThrow(HttpException);
      await expect(controller.delete(id, undefined, mockUserContext)).rejects.toThrow(
        new HttpException('Failed to delete application dashboard', HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });
  });

  describe('Edge Cases - Tags Parsing', () => {
    it('should handle empty string tags', async () => {
      // Arrange
      const query = { tags: '' };
      // Empty string is split and filtered, resulting in empty array
      const expectedQuery = { tags: [] as string[] };
      service.findAll.mockResolvedValue([]);

      // Act
      await controller.findAll(query, mockUserContext);

      // Assert
      expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, expectedQuery);
    });

    it('should handle tags with only commas', async () => {
      // Arrange
      const query = { tags: ',,,,' };
      const expectedQuery = { tags: [] };
      service.findAll.mockResolvedValue([]);

      // Act
      await controller.findAll(query, mockUserContext);

      // Assert
      expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, expectedQuery);
    });

    it('should handle tags with only whitespace', async () => {
      // Arrange
      const query = { tags: '   ,   ,   ' };
      const expectedQuery = { tags: [] };
      service.findAll.mockResolvedValue([]);

      // Act
      await controller.findAll(query, mockUserContext);

      // Assert
      expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, expectedQuery);
    });

    it('should handle single tag without commas', async () => {
      // Arrange
      const query = { tags: 'performance' };
      const expectedQuery = { tags: ['performance'] };
      service.findAll.mockResolvedValue([]);

      // Act
      await controller.findAll(query, mockUserContext);

      // Assert
      expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, expectedQuery);
    });

    it('should handle tags with special characters', async () => {
      // Arrange
      const query = { tags: 'perf-test,load_test,stress.test' };
      const expectedQuery = { tags: ['perf-test', 'load_test', 'stress.test'] };
      service.findAll.mockResolvedValue([]);

      // Act
      await controller.findAll(query, mockUserContext);

      // Assert
      expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, expectedQuery);
    });
  });

  describe('Edge Cases - Query Parameters', () => {
    it('should handle all query parameters at once', async () => {
      // Arrange
      const query = {
        systemId: '660e8400-e29b-41d4-a716-446655440000',
        systemUnderTestId: '660e8400-e29b-41d4-a716-446655440000',
        environment: 'production',
        testEnvironment: 'production',
        grafanaInstanceId: '770e8400-e29b-41d4-a716-446655440000',
        dashboardLabel: 'System',
        dashboardUid: 'sys-perf-001',
        tags: 'performance,production',
      };
      const expectedQuery = {
        ...query,
        tags: ['performance', 'production'],
      };
      service.findAll.mockResolvedValue([]);

      // Act
      await controller.findAll(query, mockUserContext);

      // Assert
      expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, expectedQuery);
    });

    it('should handle undefined query parameters', async () => {
      // Arrange
      const query = {
        systemId: undefined,
        environment: undefined,
        tags: undefined,
      };
      service.findAll.mockResolvedValue([]);

      // Act
      await controller.findAll(query, mockUserContext);

      // Assert
      expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
    });

    it('should handle null query parameters', async () => {
      // Arrange
      const query = {
        systemId: null,
        environment: null,
        tags: null,
      };
      service.findAll.mockResolvedValue([]);

      // Act
      await controller.findAll(query, mockUserContext);

      // Assert
      expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
    });
  });

  describe('Boundary Values - Snapshot Timeout', () => {
    it('should create dashboard with minimum snapshot timeout (1 second)', async () => {
      // Arrange
      const createDto: CreateApplicationDashboardDto = {
        systemUnderTestId: '660e8400-e29b-41d4-a716-446655440000',
        testEnvironment: 'production',
        grafanaInstanceId: '770e8400-e29b-41d4-a716-446655440000',
        grafanaDashboardId: '880e8400-e29b-41d4-a716-446655440000',
        dashboardName: 'System Performance',
        dashboardLabel: 'Production System Dashboard',
        snapshotTimeout: 1,
      };
      const dashboard = {
        ...mockApplicationDashboard,
        snapshot_timeout: 1,
      };
      service.create.mockResolvedValue(dashboard);

      // Act
      const result = await controller.create(createDto, mockUserContext);

      // Assert
      expect(result.snapshot_timeout).toBe(1);
    });

    it('should create dashboard with maximum snapshot timeout (300 seconds)', async () => {
      // Arrange
      const createDto: CreateApplicationDashboardDto = {
        systemUnderTestId: '660e8400-e29b-41d4-a716-446655440000',
        testEnvironment: 'production',
        grafanaInstanceId: '770e8400-e29b-41d4-a716-446655440000',
        grafanaDashboardId: '880e8400-e29b-41d4-a716-446655440000',
        dashboardName: 'System Performance',
        dashboardLabel: 'Production System Dashboard',
        snapshotTimeout: 300,
      };
      const dashboard = {
        ...mockApplicationDashboard,
        snapshot_timeout: 300,
      };
      service.create.mockResolvedValue(dashboard);

      // Act
      const result = await controller.create(createDto, mockUserContext);

      // Assert
      expect(result.snapshot_timeout).toBe(300);
    });

    it('should update dashboard with default snapshot timeout (4 seconds)', async () => {
      // Arrange
      const id = mockApplicationDashboard.id;
      const updateDto: UpdateApplicationDashboardDto = {
        snapshotTimeout: 4,
      };
      const updatedDashboard = {
        ...mockApplicationDashboard,
        snapshot_timeout: 4,
      };
      service.update.mockResolvedValue(updatedDashboard);

      // Act
      const result = await controller.update(id, updateDto, mockUserContext);

      // Assert
      expect(result.snapshot_timeout).toBe(4);
    });
  });

  describe('Boundary Values - String Lengths', () => {
    it('should create dashboard with maximum label length (255 chars)', async () => {
      // Arrange
      const longLabel = 'A'.repeat(255);
      const createDto: CreateApplicationDashboardDto = {
        systemUnderTestId: '660e8400-e29b-41d4-a716-446655440000',
        testEnvironment: 'production',
        grafanaInstanceId: '770e8400-e29b-41d4-a716-446655440000',
        grafanaDashboardId: '880e8400-e29b-41d4-a716-446655440000',
        dashboardName: 'System Performance',
        dashboardLabel: longLabel,
      };
      const dashboard = {
        ...mockApplicationDashboard,
        dashboard_label: longLabel,
      };
      service.create.mockResolvedValue(dashboard);

      // Act
      const result = await controller.create(createDto, mockUserContext);

      // Assert
      expect(result.dashboard_label).toBe(longLabel);
      expect(result.dashboard_label.length).toBe(255);
    });

    it('should create dashboard with maximum dashboard UID length (100 chars)', async () => {
      // Arrange
      const longUid = 'uid-' + 'x'.repeat(96);
      const createDto: CreateApplicationDashboardDto = {
        systemUnderTestId: '660e8400-e29b-41d4-a716-446655440000',
        testEnvironment: 'production',
        grafanaInstanceId: '770e8400-e29b-41d4-a716-446655440000',
        grafanaDashboardId: '880e8400-e29b-41d4-a716-446655440000',
        dashboardName: 'System Performance',
        dashboardLabel: 'Production System Dashboard',
        dashboardUid: longUid,
      };
      const dashboard = {
        ...mockApplicationDashboard,
        dashboard_uid: longUid,
      };
      service.create.mockResolvedValue(dashboard);

      // Act
      const result = await controller.create(createDto, mockUserContext);

      // Assert
      expect(result.dashboard_uid).toBe(longUid);
      expect(result.dashboard_uid?.length).toBe(100);
    });

    it('should update dashboard with empty dashboard label', async () => {
      // Arrange - Note: This tests the controller layer, validation should be handled by DTOs
      const id = mockApplicationDashboard.id;
      const updateDto: UpdateApplicationDashboardDto = {
        dashboardLabel: '',
      };
      const updatedDashboard = {
        ...mockApplicationDashboard,
        dashboard_label: '',
      };
      service.update.mockResolvedValue(updatedDashboard);

      // Act
      const result = await controller.update(id, updateDto, mockUserContext);

      // Assert
      expect(result.dashboard_label).toBe('');
    });
  });

  describe('Service Delegation - All Methods', () => {
    it('should properly delegate findAll with complex query', async () => {
      // Arrange
      const query = {
        systemUnderTestId: '660e8400-e29b-41d4-a716-446655440000',
        testEnvironment: 'production',
        grafanaInstanceId: '770e8400-e29b-41d4-a716-446655440000',
        dashboardLabel: 'Performance',
        dashboardUid: 'sys-perf-001',
        tags: ['performance', 'production'],
      };
      service.findAll.mockResolvedValue([mockApplicationDashboard]);

      // Act
      await controller.findAll(query, mockUserContext);

      // Assert
      expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query);
      expect(service.findAll).toHaveBeenCalledTimes(1);
    });

    it('should properly delegate findOne', async () => {
      // Arrange
      const id = mockApplicationDashboard.id;
      service.findOne.mockResolvedValue(mockApplicationDashboard);

      // Act
      await controller.findOne(id, mockUserContext);

      // Assert
      expect(service.findOne).toHaveBeenCalledWith(id, mockUserContext.userId, mockUserContext.roles);
      expect(service.findOne).toHaveBeenCalledTimes(1);
    });

    it('should properly delegate create', async () => {
      // Arrange
      const createDto: CreateApplicationDashboardDto = {
        systemUnderTestId: '660e8400-e29b-41d4-a716-446655440000',
        testEnvironment: 'production',
        grafanaInstanceId: '770e8400-e29b-41d4-a716-446655440000',
        grafanaDashboardId: '880e8400-e29b-41d4-a716-446655440000',
        dashboardName: 'System Performance',
        dashboardLabel: 'Production System Dashboard',
      };
      service.create.mockResolvedValue(mockApplicationDashboard);

      // Act
      await controller.create(createDto, mockUserContext);

      // Assert
      expect(service.create).toHaveBeenCalledWith(createDto, mockUserContext.userId, mockUserContext.roles);
      expect(service.create).toHaveBeenCalledTimes(1);
    });

    it('should properly delegate update', async () => {
      // Arrange
      const id = mockApplicationDashboard.id;
      const updateDto: UpdateApplicationDashboardDto = {
        dashboardLabel: 'Updated Label',
      };
      service.update.mockResolvedValue(mockApplicationDashboard);

      // Act
      await controller.update(id, updateDto, mockUserContext);

      // Assert
      expect(service.update).toHaveBeenCalledWith(id, updateDto, mockUserContext.userId, mockUserContext.roles);
      expect(service.update).toHaveBeenCalledTimes(1);
    });

    it('should properly delegate delete', async () => {
      // Arrange
      const id = mockApplicationDashboard.id;
      service.delete.mockResolvedValue(undefined);

      // Act
      await controller.delete(id, undefined, mockUserContext);

      // Assert - delete now takes an optional second parameter (deleteGrafanaDashboard, defaults to false)
      expect(service.delete).toHaveBeenCalledWith(id, false, mockUserContext.userId, mockUserContext.roles);
      expect(service.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle dashboard with all optional fields populated', async () => {
      // Arrange
      const complexDashboard: ApplicationDashboard = {
        ...mockApplicationDashboard,
        dashboard_id: 456,
        dashboard_uid: 'complex-uid-123',
        tags: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5'],
        template_dashboard_uid: 'template-complex-001',
        variables: [
          { name: 'var1', values: ['val1', 'val2'] },
          { name: 'var2', values: ['val3'] },
          { name: 'var3', values: ['val4', 'val5', 'val6'] },
        ],
        replaced_templating_variables: [
          { name: 'replaced1', value: ['r1', 'r2'] },
          { name: 'replaced2', value: ['r3'] },
        ],
        snapshot_timeout: 180,
      };
      service.findOne.mockResolvedValue(complexDashboard);

      // Act
      const result = await controller.findOne(complexDashboard.id, mockUserContext);

      // Assert
      expect(result).toEqual(complexDashboard);
      expect(result.variables).toHaveLength(3);
      expect(result.replaced_templating_variables).toHaveLength(2);
      expect(result.tags).toHaveLength(5);
    });

    it('should handle dashboard with no optional fields', async () => {
      // Arrange
      const minimalDashboard: ApplicationDashboard = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        system_under_test_id: '660e8400-e29b-41d4-a716-446655440000',
        test_environment: 'production',
        grafana_instance_id: '770e8400-e29b-41d4-a716-446655440000',
        grafana_dashboard_id: '880e8400-e29b-41d4-a716-446655440000',
        dashboard_name: 'Minimal Dashboard',
        dashboard_label: 'Minimal',
        snapshot_timeout: 4,
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
      };
      service.findOne.mockResolvedValue(minimalDashboard);

      // Act
      const result = await controller.findOne(minimalDashboard.id, mockUserContext);

      // Assert
      expect(result).toEqual(minimalDashboard);
      expect(result.dashboard_id).toBeUndefined();
      expect(result.dashboard_uid).toBeUndefined();
      expect(result.tags).toBeUndefined();
      expect(result.variables).toBeUndefined();
      expect(result.grafana_instance).toBeUndefined();
      expect(result.systems_under_test).toBeUndefined();
    });

    it('should handle multiple dashboards with different configurations', async () => {
      // Arrange
      const dashboard1 = { ...mockApplicationDashboard, id: 'id-1', dashboard_label: 'Dashboard 1' };
      const dashboard2 = { ...mockApplicationDashboard, id: 'id-2', dashboard_label: 'Dashboard 2', tags: ['different'] };
      const dashboard3 = { ...mockApplicationDashboard, id: 'id-3', dashboard_label: 'Dashboard 3', snapshot_timeout: 60 };
      service.findAll.mockResolvedValue([dashboard1, dashboard2, dashboard3]);

      // Act
      const result = await controller.findAll({}, mockUserContext);

      // Assert
      expect(result).toHaveLength(3);
      expect(result[0]?.dashboard_label).toBe('Dashboard 1');
      expect(result[1]?.tags).toEqual(['different']);
      expect(result[2]?.snapshot_timeout).toBe(60);
    });
  });

  describe('Logger Integration', () => {
    it('should log error on findAll failure', async () => {
      // Arrange
      const error = new Error('Database error');
      service.findAll.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.findAll({}, mockUserContext)).rejects.toThrow();
      // Logger calls are internal, we just verify the exception is thrown
    });

    it('should log error on findOne failure', async () => {
      // Arrange
      const id = mockApplicationDashboard.id;
      const error = new Error('Not found');
      service.findOne.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.findOne(id, mockUserContext)).rejects.toThrow();
      // Logger calls are internal
    });

    it('should log error on create failure', async () => {
      // Arrange
      const createDto: CreateApplicationDashboardDto = {
        systemUnderTestId: '660e8400-e29b-41d4-a716-446655440000',
        testEnvironment: 'production',
        grafanaInstanceId: '770e8400-e29b-41d4-a716-446655440000',
        grafanaDashboardId: '880e8400-e29b-41d4-a716-446655440000',
        dashboardName: 'System Performance',
        dashboardLabel: 'Production System Dashboard',
      };
      const error = new Error('Creation failed');
      service.create.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.create(createDto, mockUserContext)).rejects.toThrow();
      // Logger calls are internal
    });

    it('should log error on update failure', async () => {
      // Arrange
      const id = mockApplicationDashboard.id;
      const updateDto: UpdateApplicationDashboardDto = { dashboardLabel: 'Updated' };
      const error = new Error('Update failed');
      service.update.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.update(id, updateDto, mockUserContext)).rejects.toThrow();
      // Logger calls are internal
    });

    it('should log error on delete failure', async () => {
      // Arrange
      const id = mockApplicationDashboard.id;
      const error = new Error('Deletion failed');
      service.delete.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.delete(id, undefined, mockUserContext)).rejects.toThrow();
      // Logger calls are internal
    });
  });
});
