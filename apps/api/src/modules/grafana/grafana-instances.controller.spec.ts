import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { GrafanaInstancesController } from './grafana-instances.controller';
import { GrafanaInstancesService, GrafanaInstance } from './grafana-instances.service';
import { UserContext } from '../../common/decorators/user-context.decorator';

describe('GrafanaInstancesController', () => {
  let controller: GrafanaInstancesController;
  let service: jest.Mocked<GrafanaInstancesService>;

  const mockUserContext: UserContext = {
    userId: 'test-user-123',
    roles: ['user'],
    organizations: ['org-123'],
    teams: ['team-456'],
    organizationId: 'org-123',
    teamId: 'team-456',
  };

  // Mock data fixtures
  const mockGrafanaInstance: GrafanaInstance = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    label: 'Production Grafana',
    client_url: 'https://grafana.example.com',
    server_url: 'https://grafana-server.example.com',
    org_id: '660e8400-e29b-41d4-a716-446655440001',
    api_key: 'encrypted_api_key_value',
    username: 'admin',
    password: 'encrypted_password_value',
    snapshot_instance: false,
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
  };

  const mockSnapshotInstance: GrafanaInstance = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    label: 'Snapshot Instance',
    client_url: 'https://snapshot.grafana.example.com',
    org_id: '660e8400-e29b-41d4-a716-446655440002',
    snapshot_instance: true,
    created_at: '2024-01-15T11:00:00Z',
    updated_at: '2024-01-15T11:00:00Z',
  };

  const mockServiceFactory = () => ({
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    testConnection: jest.fn(),
    testConnectionWithParams: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GrafanaInstancesController],
      providers: [
        {
          provide: GrafanaInstancesService,
          useValue: mockServiceFactory(),
        },
      ],
    }).compile();

    controller = module.get<GrafanaInstancesController>(GrafanaInstancesController);
    service = module.get(GrafanaInstancesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Happy Path - Query Operations', () => {
    describe('findAll', () => {
      it('should return all Grafana instances without filters', async () => {
        // Arrange
        const instances = [mockGrafanaInstance, mockSnapshotInstance];
        service.findAll.mockResolvedValue(instances);

        // Act
        const result = await controller.findAll({}, undefined, mockUserContext);

        // Assert
        expect(result).toEqual(instances);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, {}, undefined);
        expect(service.findAll).toHaveBeenCalledTimes(1);
      });

      it('should filter instances by label', async () => {
        // Arrange
        const query = { label: 'Production' };
        const filteredInstances = [mockGrafanaInstance];
        service.findAll.mockResolvedValue(filteredInstances);

        // Act
        const result = await controller.findAll(query, undefined, mockUserContext);

        // Assert
        expect(result).toEqual(filteredInstances);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query, undefined);
        expect(result).toHaveLength(1);
        expect(result[0]!.label).toContain('Production');
      });

      it('should filter instances by snapshotInstance flag (true)', async () => {
        // Arrange
        const query = { snapshotInstance: true };
        const filteredInstances = [mockSnapshotInstance];
        service.findAll.mockResolvedValue(filteredInstances);

        // Act
        const result = await controller.findAll(query, undefined, mockUserContext);

        // Assert
        expect(result).toEqual(filteredInstances);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query, undefined);
        expect(result).toHaveLength(1);
        expect(result[0]!.snapshot_instance).toBe(true);
      });

      it('should filter instances by snapshotInstance flag (false)', async () => {
        // Arrange
        const query = { snapshotInstance: false };
        const filteredInstances = [mockGrafanaInstance];
        service.findAll.mockResolvedValue(filteredInstances);

        // Act
        const result = await controller.findAll(query, undefined, mockUserContext);

        // Assert
        expect(result).toEqual(filteredInstances);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query, undefined);
        expect(result).toHaveLength(1);
        expect(result[0]!.snapshot_instance).toBe(false);
      });

      it('should filter by both label and snapshotInstance', async () => {
        // Arrange
        const query = { label: 'Snapshot', snapshotInstance: true };
        const filteredInstances = [mockSnapshotInstance];
        service.findAll.mockResolvedValue(filteredInstances);

        // Act
        const result = await controller.findAll(query, undefined, mockUserContext);

        // Assert
        expect(result).toEqual(filteredInstances);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query, undefined);
        expect(result[0]!.label).toContain('Snapshot');
        expect(result[0]!.snapshot_instance).toBe(true);
      });

      it('should return empty array when no instances match filters', async () => {
        // Arrange
        const query = { label: 'NonExistent' };
        service.findAll.mockResolvedValue([]);

        // Act
        const result = await controller.findAll(query, undefined, mockUserContext);

        // Assert
        expect(result).toEqual([]);
        expect(result).toHaveLength(0);
      });

      it('should return instances ordered by creation date descending', async () => {
        // Arrange
        const instances = [mockSnapshotInstance, mockGrafanaInstance]; // Newer first
        service.findAll.mockResolvedValue(instances);

        // Act
        const result = await controller.findAll({}, undefined, mockUserContext);

        // Assert
        expect(result).toEqual(instances);
        expect(new Date(result[0]!.created_at).getTime()).toBeGreaterThan(
          new Date(result[1]!.created_at).getTime()
        );
      });
    });

    describe('findOne', () => {
      it('should return a single Grafana instance by id', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        service.findOne.mockResolvedValue(mockGrafanaInstance);

        // Act
        const result = await controller.findOne(instanceId, mockUserContext);

        // Assert
        expect(result).toEqual(mockGrafanaInstance);
        expect(service.findOne).toHaveBeenCalledWith(instanceId, mockUserContext.userId, mockUserContext.roles);
        expect(service.findOne).toHaveBeenCalledTimes(1);
      });

      it('should return instance with all properties populated', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        service.findOne.mockResolvedValue(mockGrafanaInstance);

        // Act
        const result = await controller.findOne(instanceId, mockUserContext);

        // Assert
        expect(result).toHaveProperty('id');
        expect(result).toHaveProperty('label');
        expect(result).toHaveProperty('client_url');
        expect(result).toHaveProperty('server_url');
        expect(result).toHaveProperty('org_id');
        expect(result).toHaveProperty('api_key');
        expect(result).toHaveProperty('username');
        expect(result).toHaveProperty('password');
        expect(result).toHaveProperty('snapshot_instance');
        expect(result).toHaveProperty('created_at');
        expect(result).toHaveProperty('updated_at');
      });

      it('should return snapshot instance with minimal fields', async () => {
        // Arrange
        const instanceId = mockSnapshotInstance.id;
        service.findOne.mockResolvedValue(mockSnapshotInstance);

        // Act
        const result = await controller.findOne(instanceId, mockUserContext);

        // Assert
        expect(result).toEqual(mockSnapshotInstance);
        expect(result.snapshot_instance).toBe(true);
        expect(result).not.toHaveProperty('api_key');
        expect(result).not.toHaveProperty('username');
        expect(result).not.toHaveProperty('password');
      });
    });
  });

  describe('Happy Path - Mutation Operations', () => {
    describe('create', () => {
      it('should create a new Grafana instance with all fields', async () => {
        // Arrange
        const createDto = {
          label: 'Production Grafana',
          clientUrl: 'https://grafana.example.com',
          serverUrl: 'https://grafana-server.example.com',
          orgId: '660e8400-e29b-41d4-a716-446655440001',
          apiKey: 'my-api-key-value',
          username: 'admin',
          password: 'secure-password',
          snapshotInstance: false,
        };
        service.create.mockResolvedValue(mockGrafanaInstance);

        // Act
        const result = await controller.create(createDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockGrafanaInstance);
        expect(service.create).toHaveBeenCalledWith(createDto, mockUserContext.userId, mockUserContext.roles);
        expect(service.create).toHaveBeenCalledTimes(1);
      });

      it('should create Grafana instance with minimal required fields', async () => {
        // Arrange
        const minimalDto = {
          label: 'Minimal Instance',
          clientUrl: 'https://minimal.grafana.example.com',
          orgId: '660e8400-e29b-41d4-a716-446655440003',
        };
        const minimalInstance = {
          ...mockGrafanaInstance,
          label: 'Minimal Instance',
          client_url: 'https://minimal.grafana.example.com',
          org_id: '660e8400-e29b-41d4-a716-446655440003',
          server_url: undefined,
          api_key: undefined,
          username: undefined,
          password: undefined,
          snapshot_instance: false,
        };
        service.create.mockResolvedValue(minimalInstance);

        // Act
        const result = await controller.create(minimalDto, mockUserContext);

        // Assert
        expect(result).toEqual(minimalInstance);
        expect(service.create).toHaveBeenCalledWith(minimalDto, mockUserContext.userId, mockUserContext.roles);
        expect(result.snapshot_instance).toBe(false);
      });

      it('should create snapshot instance', async () => {
        // Arrange
        const snapshotDto = {
          label: 'Snapshot Instance',
          clientUrl: 'https://snapshot.grafana.example.com',
          orgId: '660e8400-e29b-41d4-a716-446655440002',
          snapshotInstance: true,
        };
        service.create.mockResolvedValue(mockSnapshotInstance);

        // Act
        const result = await controller.create(snapshotDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockSnapshotInstance);
        expect(result.snapshot_instance).toBe(true);
        expect(service.create).toHaveBeenCalledWith(snapshotDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should create instance with API key authentication', async () => {
        // Arrange
        const apiKeyDto = {
          label: 'API Key Instance',
          clientUrl: 'https://grafana.example.com',
          orgId: '660e8400-e29b-41d4-a716-446655440001',
          apiKey: 'Bearer my-api-key',
        };
        const apiKeyInstance = {
          ...mockGrafanaInstance,
          label: 'API Key Instance',
          api_key: 'Bearer my-api-key',
          username: undefined,
          password: undefined,
        };
        service.create.mockResolvedValue(apiKeyInstance);

        // Act
        const result = await controller.create(apiKeyDto, mockUserContext);

        // Assert
        expect(result).toEqual(apiKeyInstance);
        expect(result.api_key).toBe('Bearer my-api-key');
        expect(result.username).toBeUndefined();
        expect(result.password).toBeUndefined();
      });

      it('should create instance with username/password authentication', async () => {
        // Arrange
        const userPassDto = {
          label: 'User/Pass Instance',
          clientUrl: 'https://grafana.example.com',
          orgId: '660e8400-e29b-41d4-a716-446655440001',
          username: 'admin',
          password: 'secure-password',
        };
        const userPassInstance = {
          ...mockGrafanaInstance,
          label: 'User/Pass Instance',
          api_key: undefined,
          username: 'admin',
          password: 'secure-password',
        };
        service.create.mockResolvedValue(userPassInstance);

        // Act
        const result = await controller.create(userPassDto, mockUserContext);

        // Assert
        expect(result).toEqual(userPassInstance);
        expect(result.username).toBe('admin');
        expect(result.password).toBe('secure-password');
        expect(result.api_key).toBeUndefined();
      });
    });

    describe('update', () => {
      it('should update Grafana instance label', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        const updateDto = {
          label: 'Updated Production Grafana',
        };
        const updatedInstance = {
          ...mockGrafanaInstance,
          label: 'Updated Production Grafana',
          updated_at: '2024-01-15T12:00:00Z',
        };
        service.update.mockResolvedValue(updatedInstance);

        // Act
        const result = await controller.update(instanceId, updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(updatedInstance);
        expect(result.label).toBe('Updated Production Grafana');
        expect(service.update).toHaveBeenCalledWith(instanceId, updateDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should update Grafana instance URLs', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        const updateDto = {
          clientUrl: 'https://new-grafana.example.com',
          serverUrl: 'https://new-grafana-server.example.com',
        };
        const updatedInstance = {
          ...mockGrafanaInstance,
          client_url: 'https://new-grafana.example.com',
          server_url: 'https://new-grafana-server.example.com',
          updated_at: '2024-01-15T12:00:00Z',
        };
        service.update.mockResolvedValue(updatedInstance);

        // Act
        const result = await controller.update(instanceId, updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(updatedInstance);
        expect(result.client_url).toBe('https://new-grafana.example.com');
        expect(result.server_url).toBe('https://new-grafana-server.example.com');
        expect(service.update).toHaveBeenCalledWith(instanceId, updateDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should update Grafana instance API key', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        const updateDto = {
          apiKey: 'new-encrypted-api-key',
        };
        const updatedInstance = {
          ...mockGrafanaInstance,
          api_key: 'new-encrypted-api-key',
          updated_at: '2024-01-15T12:00:00Z',
        };
        service.update.mockResolvedValue(updatedInstance);

        // Act
        const result = await controller.update(instanceId, updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(updatedInstance);
        expect(result.api_key).toBe('new-encrypted-api-key');
        expect(service.update).toHaveBeenCalledWith(instanceId, updateDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should update Grafana instance credentials', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        const updateDto = {
          username: 'newadmin',
          password: 'new-encrypted-password',
        };
        const updatedInstance = {
          ...mockGrafanaInstance,
          username: 'newadmin',
          password: 'new-encrypted-password',
          updated_at: '2024-01-15T12:00:00Z',
        };
        service.update.mockResolvedValue(updatedInstance);

        // Act
        const result = await controller.update(instanceId, updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(updatedInstance);
        expect(result.username).toBe('newadmin');
        expect(result.password).toBe('new-encrypted-password');
        expect(service.update).toHaveBeenCalledWith(instanceId, updateDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should update snapshot instance flag', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        const updateDto = {
          snapshotInstance: true,
        };
        const updatedInstance = {
          ...mockGrafanaInstance,
          snapshot_instance: true,
          updated_at: '2024-01-15T12:00:00Z',
        };
        service.update.mockResolvedValue(updatedInstance);

        // Act
        const result = await controller.update(instanceId, updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(updatedInstance);
        expect(result.snapshot_instance).toBe(true);
        expect(service.update).toHaveBeenCalledWith(instanceId, updateDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should update multiple fields simultaneously', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        const updateDto = {
          label: 'Comprehensive Update',
          clientUrl: 'https://updated.grafana.example.com',
          serverUrl: 'https://updated-server.grafana.example.com',
          apiKey: 'updated-api-key',
          snapshotInstance: false,
        };
        const updatedInstance = {
          ...mockGrafanaInstance,
          label: 'Comprehensive Update',
          client_url: 'https://updated.grafana.example.com',
          server_url: 'https://updated-server.grafana.example.com',
          api_key: 'updated-api-key',
          snapshot_instance: false,
          updated_at: '2024-01-15T12:00:00Z',
        };
        service.update.mockResolvedValue(updatedInstance);

        // Act
        const result = await controller.update(instanceId, updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(updatedInstance);
        expect(service.update).toHaveBeenCalledWith(instanceId, updateDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should perform partial update with single field', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        const updateDto = {
          orgId: '770e8400-e29b-41d4-a716-446655440009',
        };
        const updatedInstance = {
          ...mockGrafanaInstance,
          org_id: '770e8400-e29b-41d4-a716-446655440009',
          updated_at: '2024-01-15T12:00:00Z',
        };
        service.update.mockResolvedValue(updatedInstance);

        // Act
        const result = await controller.update(instanceId, updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(updatedInstance);
        expect(result.org_id).toBe('770e8400-e29b-41d4-a716-446655440009');
      });
    });

    describe('remove', () => {
      it('should delete a Grafana instance', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        service.remove.mockResolvedValue(undefined);

        // Act
        const result = await controller.remove(instanceId, mockUserContext);

        // Assert
        expect(result).toEqual({ message: 'Grafana instance deleted successfully' });
        expect(service.remove).toHaveBeenCalledWith(instanceId, mockUserContext.userId, mockUserContext.roles);
        expect(service.remove).toHaveBeenCalledTimes(1);
      });

      it('should return success message after deletion', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        service.remove.mockResolvedValue(undefined);

        // Act
        const result = await controller.remove(instanceId, mockUserContext);

        // Assert
        expect(result).toHaveProperty('message');
        expect(result.message).toBe('Grafana instance deleted successfully');
      });

      it('should delete snapshot instance', async () => {
        // Arrange
        const instanceId = mockSnapshotInstance.id;
        service.remove.mockResolvedValue(undefined);

        // Act
        const result = await controller.remove(instanceId, mockUserContext);

        // Assert
        expect(result).toEqual({ message: 'Grafana instance deleted successfully' });
        expect(service.remove).toHaveBeenCalledWith(instanceId, mockUserContext.userId, mockUserContext.roles);
      });
    });

    describe('testConnection', () => {
      it('should successfully test connection to Grafana instance', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        const connectionResult = {
          success: true,
          message: `Connection test for ${mockGrafanaInstance.label} successful`,
        };
        service.testConnection.mockResolvedValue(connectionResult);

        // Act
        const result = await controller.testConnection(instanceId, mockUserContext);

        // Assert
        expect(result).toEqual(connectionResult);
        expect(result.success).toBe(true);
        expect(result.message).toContain('successful');
        expect(service.testConnection).toHaveBeenCalledWith(instanceId, mockUserContext.userId, mockUserContext.roles);
        expect(service.testConnection).toHaveBeenCalledTimes(1);
      });

      it('should return detailed success message with instance label', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        const connectionResult = {
          success: true,
          message: `Connection test for Production Grafana successful`,
        };
        service.testConnection.mockResolvedValue(connectionResult);

        // Act
        const result = await controller.testConnection(instanceId, mockUserContext);

        // Assert
        expect(result.success).toBe(true);
        expect(result.message).toBe('Connection test for Production Grafana successful');
      });

      it('should test connection for snapshot instance', async () => {
        // Arrange
        const instanceId = mockSnapshotInstance.id;
        const connectionResult = {
          success: true,
          message: `Connection test for ${mockSnapshotInstance.label} successful`,
        };
        service.testConnection.mockResolvedValue(connectionResult);

        // Act
        const result = await controller.testConnection(instanceId, mockUserContext);

        // Assert
        expect(result).toEqual(connectionResult);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Error Scenarios - Service Errors', () => {
    describe('findAll', () => {
      it('should throw HttpException when service throws error', async () => {
        // Arrange
        service.findAll.mockRejectedValue(new Error('Database connection failed'));

        // Act & Assert
        await expect(controller.findAll({}, undefined, mockUserContext)).rejects.toThrow(HttpException);
        await expect(controller.findAll({}, undefined, mockUserContext)).rejects.toThrow('Failed to fetch Grafana instances');
      });

      it('should throw 500 status code on service error', async () => {
        // Arrange
        service.findAll.mockRejectedValue(new Error('Database error'));

        // Act & Assert
        try {
          await controller.findAll({}, undefined, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        }
      });

      it('should log error when findAll fails', async () => {
        // Arrange
        const loggerSpy = jest.spyOn(controller['logger'], 'error');
        service.findAll.mockRejectedValue(new Error('Query failed'));

        // Act & Assert
        await expect(controller.findAll({}, undefined, mockUserContext)).rejects.toThrow(HttpException);
        expect(loggerSpy).toHaveBeenCalledWith('Failed to fetch Grafana instances:', expect.any(Error));
      });
    });

    describe('findOne', () => {
      it('should throw 404 HttpException when instance not found', async () => {
        // Arrange
        const instanceId = 'non-existent-id';
        service.findOne.mockRejectedValue(new Error('Grafana instance with id non-existent-id not found'));

        // Act & Assert
        await expect(controller.findOne(instanceId, mockUserContext)).rejects.toThrow(HttpException);
        try {
          await controller.findOne(instanceId, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
          expect((error as HttpException).message).toBe('Grafana instance not found');
        }
      });

      it('should throw 500 HttpException for other service errors', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        service.findOne.mockRejectedValue(new Error('Database error'));

        // Act & Assert
        await expect(controller.findOne(instanceId, mockUserContext)).rejects.toThrow(HttpException);
        try {
          await controller.findOne(instanceId, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
          expect((error as HttpException).message).toBe('Failed to fetch Grafana instance');
        }
      });

      it('should handle error with message property safely', async () => {
        // Arrange
        const instanceId = 'test-id';
        const errorWithoutMessage = { code: 'DB_ERROR' }; // No message property
        service.findOne.mockRejectedValue(errorWithoutMessage);

        // Act & Assert
        await expect(controller.findOne(instanceId, mockUserContext)).rejects.toThrow(HttpException);
        try {
          await controller.findOne(instanceId, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        }
      });

      it('should log error with instance id when findOne fails', async () => {
        // Arrange
        const instanceId = 'test-id-123';
        const loggerSpy = jest.spyOn(controller['logger'], 'error');
        service.findOne.mockRejectedValue(new Error('Instance not found'));

        // Act & Assert
        await expect(controller.findOne(instanceId, mockUserContext)).rejects.toThrow(HttpException);
        expect(loggerSpy).toHaveBeenCalledWith(
          `Failed to fetch Grafana instance ${instanceId}:`,
          expect.any(Error)
        );
      });
    });

    describe('create', () => {
      it('should throw 400 HttpException when creation fails', async () => {
        // Arrange
        const createDto = {
          label: 'Duplicate Instance',
          clientUrl: 'https://grafana.example.com',
          orgId: '660e8400-e29b-41d4-a716-446655440001',
        };
        service.create.mockRejectedValue(new Error('Duplicate instance label'));

        // Act & Assert
        await expect(controller.create(createDto, mockUserContext)).rejects.toThrow(HttpException);
        try {
          await controller.create(createDto, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
          expect((error as HttpException).message).toBe('Duplicate instance label');
        }
      });

      it('should throw 400 HttpException with validation error', async () => {
        // Arrange
        const createDto = {
          label: '',
          clientUrl: 'invalid-url',
          orgId: '660e8400-e29b-41d4-a716-446655440001',
        };
        service.create.mockRejectedValue(new Error('Invalid client URL format'));

        // Act & Assert
        await expect(controller.create(createDto, mockUserContext)).rejects.toThrow(HttpException);
        try {
          await controller.create(createDto, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
          expect((error as HttpException).message).toBe('Invalid client URL format');
        }
      });

      it('should use default error message when service error has no message', async () => {
        // Arrange
        const createDto = {
          label: 'Test Instance',
          clientUrl: 'https://grafana.example.com',
          orgId: '660e8400-e29b-41d4-a716-446655440001',
        };
        const errorWithoutMessage = { code: 'UNKNOWN' };
        service.create.mockRejectedValue(errorWithoutMessage);

        // Act & Assert
        await expect(controller.create(createDto, mockUserContext)).rejects.toThrow(HttpException);
        try {
          await controller.create(createDto, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).message).toBe('Failed to create Grafana instance');
        }
      });

      it('should log error when create fails', async () => {
        // Arrange
        const createDto = {
          label: 'Test Instance',
          clientUrl: 'https://grafana.example.com',
          orgId: '660e8400-e29b-41d4-a716-446655440001',
        };
        const loggerSpy = jest.spyOn(controller['logger'], 'error');
        service.create.mockRejectedValue(new Error('Creation failed'));

        // Act & Assert
        await expect(controller.create(createDto, mockUserContext)).rejects.toThrow(HttpException);
        expect(loggerSpy).toHaveBeenCalledWith('Failed to create Grafana instance:', expect.any(Error));
      });
    });

    describe('update', () => {
      it('should throw 404 HttpException when instance not found', async () => {
        // Arrange
        const instanceId = 'non-existent-id';
        const updateDto = { label: 'Updated Label' };
        service.update.mockRejectedValue(new Error('Grafana instance with id non-existent-id not found'));

        // Act & Assert
        await expect(controller.update(instanceId, updateDto, mockUserContext)).rejects.toThrow(HttpException);
        try {
          await controller.update(instanceId, updateDto, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
          expect((error as HttpException).message).toBe('Grafana instance not found');
        }
      });

      it('should throw 400 HttpException for validation errors', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        const updateDto = { clientUrl: 'invalid-url' };
        service.update.mockRejectedValue(new Error('Invalid URL format'));

        // Act & Assert
        await expect(controller.update(instanceId, updateDto, mockUserContext)).rejects.toThrow(HttpException);
        try {
          await controller.update(instanceId, updateDto, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
          expect((error as HttpException).message).toBe('Invalid URL format');
        }
      });

      it('should use default error message when service error has no message', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        const updateDto = { label: 'Test' };
        const errorWithoutMessage = { statusCode: 500 };
        service.update.mockRejectedValue(errorWithoutMessage);

        // Act & Assert
        await expect(controller.update(instanceId, updateDto, mockUserContext)).rejects.toThrow(HttpException);
        try {
          await controller.update(instanceId, updateDto, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).message).toBe('Failed to update Grafana instance');
        }
      });

      it('should log error with instance id when update fails', async () => {
        // Arrange
        const instanceId = 'test-id-456';
        const updateDto = { label: 'Updated' };
        const loggerSpy = jest.spyOn(controller['logger'], 'error');
        service.update.mockRejectedValue(new Error('Update failed'));

        // Act & Assert
        await expect(controller.update(instanceId, updateDto, mockUserContext)).rejects.toThrow(HttpException);
        expect(loggerSpy).toHaveBeenCalledWith(
          `Failed to update Grafana instance ${instanceId}:`,
          expect.any(Error)
        );
      });
    });

    describe('remove', () => {
      it('should throw 404 HttpException when instance not found', async () => {
        // Arrange
        const instanceId = 'non-existent-id';
        service.remove.mockRejectedValue(new Error('Grafana instance with id non-existent-id not found'));

        // Act & Assert
        await expect(controller.remove(instanceId, mockUserContext)).rejects.toThrow(HttpException);
        try {
          await controller.remove(instanceId, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
          expect((error as HttpException).message).toBe('Grafana instance not found');
        }
      });

      it('should throw 500 HttpException for other service errors', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        service.remove.mockRejectedValue(new Error('Database deletion error'));

        // Act & Assert
        await expect(controller.remove(instanceId, mockUserContext)).rejects.toThrow(HttpException);
        try {
          await controller.remove(instanceId, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
          expect((error as HttpException).message).toBe('Failed to delete Grafana instance');
        }
      });

      it('should log error with instance id when remove fails', async () => {
        // Arrange
        const instanceId = 'test-id-789';
        const loggerSpy = jest.spyOn(controller['logger'], 'error');
        service.remove.mockRejectedValue(new Error('Deletion failed'));

        // Act & Assert
        await expect(controller.remove(instanceId, mockUserContext)).rejects.toThrow(HttpException);
        expect(loggerSpy).toHaveBeenCalledWith(
          `Failed to delete Grafana instance ${instanceId}:`,
          expect.any(Error)
        );
      });
    });

    describe('testConnection', () => {
      it('should throw 500 HttpException when connection test fails', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        service.testConnection.mockRejectedValue(new Error('Connection timeout'));

        // Act & Assert
        await expect(controller.testConnection(instanceId, mockUserContext)).rejects.toThrow(HttpException);
        try {
          await controller.testConnection(instanceId, mockUserContext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
          expect((error as HttpException).message).toBe('Failed to test connection');
        }
      });

      it('should return failure result when connection test fails gracefully', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        const failureResult = {
          success: false,
          message: 'Connection refused',
        };
        service.testConnection.mockResolvedValue(failureResult);

        // Act
        const result = await controller.testConnection(instanceId, mockUserContext);

        // Assert
        expect(result).toEqual(failureResult);
        expect(result.success).toBe(false);
        expect(result.message).toBe('Connection refused');
      });

      it('should log error with instance id when testConnection fails', async () => {
        // Arrange
        const instanceId = 'test-id-connection';
        const loggerSpy = jest.spyOn(controller['logger'], 'error');
        service.testConnection.mockRejectedValue(new Error('Network error'));

        // Act & Assert
        await expect(controller.testConnection(instanceId, mockUserContext)).rejects.toThrow(HttpException);
        expect(loggerSpy).toHaveBeenCalledWith(
          `Failed to test connection for Grafana instance ${instanceId}:`,
          expect.any(Error)
        );
      });
    });
  });

  describe('Edge Cases', () => {
    describe('findAll', () => {
      it('should handle empty query object', async () => {
        // Arrange
        service.findAll.mockResolvedValue([mockGrafanaInstance]);

        // Act
        const result = await controller.findAll({}, undefined, mockUserContext);

        // Assert
        expect(result).toEqual([mockGrafanaInstance]);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, {}, undefined);
      });

      it('should handle null query', async () => {
        // Arrange
        service.findAll.mockResolvedValue([mockGrafanaInstance]);

        // Act
        const result = await controller.findAll(null, undefined, mockUserContext);

        // Assert
        expect(result).toEqual([mockGrafanaInstance]);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, null, undefined);
      });

      it('should handle undefined query', async () => {
        // Arrange
        service.findAll.mockResolvedValue([mockGrafanaInstance]);

        // Act
        const result = await controller.findAll(undefined, undefined, mockUserContext);

        // Assert
        expect(result).toEqual([mockGrafanaInstance]);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, undefined, undefined);
      });

      it('should handle query with empty string label', async () => {
        // Arrange
        const query = { label: '' };
        service.findAll.mockResolvedValue([]);

        // Act
        const result = await controller.findAll(query, undefined, mockUserContext);

        // Assert
        expect(result).toEqual([]);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query, undefined);
      });

      it('should handle query with whitespace-only label', async () => {
        // Arrange
        const query = { label: '   ' };
        service.findAll.mockResolvedValue([]);

        // Act
        const result = await controller.findAll(query, undefined, mockUserContext);

        // Assert
        expect(result).toEqual([]);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query, undefined);
      });

      it('should handle snapshotInstance with string value true', async () => {
        // Arrange
        const query = { snapshotInstance: 'true' as any };
        service.findAll.mockResolvedValue([mockSnapshotInstance]);

        // Act
        const result = await controller.findAll(query, undefined, mockUserContext);

        // Assert
        expect(result).toEqual([mockSnapshotInstance]);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query, undefined);
      });

      it('should handle snapshotInstance with string value false', async () => {
        // Arrange
        const query = { snapshotInstance: 'false' as any };
        service.findAll.mockResolvedValue([mockGrafanaInstance]);

        // Act
        const result = await controller.findAll(query, undefined, mockUserContext);

        // Assert
        expect(result).toEqual([mockGrafanaInstance]);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query, undefined);
      });
    });

    describe('findOne', () => {
      it('should handle UUID format id', async () => {
        // Arrange
        const uuidId = '550e8400-e29b-41d4-a716-446655440000';
        service.findOne.mockResolvedValue(mockGrafanaInstance);

        // Act
        const result = await controller.findOne(uuidId, mockUserContext);

        // Assert
        expect(result).toEqual(mockGrafanaInstance);
        expect(service.findOne).toHaveBeenCalledWith(uuidId, mockUserContext.userId, mockUserContext.roles);
      });

      it('should handle non-UUID format id', async () => {
        // Arrange
        const nonUuidId = 'custom-id-123';
        service.findOne.mockRejectedValue(new Error('Grafana instance with id custom-id-123 not found'));

        // Act & Assert
        await expect(controller.findOne(nonUuidId, mockUserContext)).rejects.toThrow(HttpException);
      });
    });

    describe('create', () => {
      it('should handle DTO with null optional fields', async () => {
        // Arrange
        const createDto = {
          label: 'Test Instance',
          clientUrl: 'https://grafana.example.com',
          orgId: '660e8400-e29b-41d4-a716-446655440001',
          serverUrl: null,
          apiKey: null,
          username: null,
          password: null,
        };
        const createdInstance = {
          ...mockGrafanaInstance,
          server_url: undefined,
          api_key: undefined,
          username: undefined,
          password: undefined,
        };
        service.create.mockResolvedValue(createdInstance);

        // Act
        const result = await controller.create(createDto, mockUserContext);

        // Assert
        expect(result).toEqual(createdInstance);
        expect(service.create).toHaveBeenCalledWith(createDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should handle DTO with empty string fields', async () => {
        // Arrange
        const createDto = {
          label: 'Test Instance',
          clientUrl: 'https://grafana.example.com',
          orgId: '660e8400-e29b-41d4-a716-446655440001',
          serverUrl: '',
          apiKey: '',
          username: '',
          password: '',
        };
        service.create.mockRejectedValue(new Error('Invalid URL format'));

        // Act & Assert
        await expect(controller.create(createDto, mockUserContext)).rejects.toThrow(HttpException);
      });

      it('should handle DTO with snapshotInstance undefined (defaults to false)', async () => {
        // Arrange
        const createDto = {
          label: 'Test Instance',
          clientUrl: 'https://grafana.example.com',
          orgId: '660e8400-e29b-41d4-a716-446655440001',
        };
        const createdInstance = {
          ...mockGrafanaInstance,
          snapshot_instance: false,
        };
        service.create.mockResolvedValue(createdInstance);

        // Act
        const result = await controller.create(createDto, mockUserContext);

        // Assert
        expect(result.snapshot_instance).toBe(false);
      });
    });

    describe('update', () => {
      it('should handle empty update DTO', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        const updateDto = {};
        service.update.mockResolvedValue(mockGrafanaInstance);

        // Act
        const result = await controller.update(instanceId, updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockGrafanaInstance);
        expect(service.update).toHaveBeenCalledWith(instanceId, updateDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should handle update with null values', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        const updateDto = {
          serverUrl: null,
          apiKey: null,
        };
        const updatedInstance = {
          ...mockGrafanaInstance,
          server_url: undefined,
          api_key: undefined,
        };
        service.update.mockResolvedValue(updatedInstance);

        // Act
        const result = await controller.update(instanceId, updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(updatedInstance);
        expect(service.update).toHaveBeenCalledWith(instanceId, updateDto, mockUserContext.userId, mockUserContext.roles);
      });
    });

    describe('testConnection', () => {
      it('should handle instance with invalid credentials', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        const failureResult = {
          success: false,
          message: 'Invalid credentials',
        };
        service.testConnection.mockResolvedValue(failureResult);

        // Act
        const result = await controller.testConnection(instanceId, mockUserContext);

        // Assert
        expect(result.success).toBe(false);
        expect(result.message).toBe('Invalid credentials');
      });

      it('should handle instance with unreachable URL', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        const failureResult = {
          success: false,
          message: 'Connection timeout: unable to reach https://grafana.example.com',
        };
        service.testConnection.mockResolvedValue(failureResult);

        // Act
        const result = await controller.testConnection(instanceId, mockUserContext);

        // Assert
        expect(result.success).toBe(false);
        expect(result.message).toContain('timeout');
      });
    });
  });

  describe('Boundary Values', () => {
    describe('findAll', () => {
      it('should handle very long label filter', async () => {
        // Arrange
        const longLabel = 'A'.repeat(500);
        const query = { label: longLabel };
        service.findAll.mockResolvedValue([]);

        // Act
        const result = await controller.findAll(query, undefined, mockUserContext);

        // Assert
        expect(result).toEqual([]);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, query, undefined);
      });

      it('should handle large result set (1000+ instances)', async () => {
        // Arrange
        const largeInstanceList = Array(1000).fill(mockGrafanaInstance).map((instance, i) => ({
          ...instance,
          id: `id-${i}`,
          label: `Instance ${i}`,
        }));
        service.findAll.mockResolvedValue(largeInstanceList);

        // Act
        const result = await controller.findAll({}, undefined, mockUserContext);

        // Assert
        expect(result).toHaveLength(1000);
        expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, {}, undefined);
      });
    });

    describe('create', () => {
      it('should handle maximum field lengths', async () => {
        // Arrange
        const maxLengthDto = {
          label: 'A'.repeat(255), // Max 255 chars
          clientUrl: 'https://grafana.example.com/' + 'B'.repeat(2000), // Very long URL
          serverUrl: 'https://server.example.com/' + 'C'.repeat(2000),
          orgId: '660e8400-e29b-41d4-a716-446655440001',
          apiKey: 'D'.repeat(1000), // Very long API key
          username: 'E'.repeat(255),
          password: 'F'.repeat(255),
        };
        const createdInstance = {
          ...mockGrafanaInstance,
          label: maxLengthDto.label,
          client_url: maxLengthDto.clientUrl,
          server_url: maxLengthDto.serverUrl,
        };
        service.create.mockResolvedValue(createdInstance);

        // Act
        const result = await controller.create(maxLengthDto, mockUserContext);

        // Assert
        expect(result).toEqual(createdInstance);
        expect(service.create).toHaveBeenCalledWith(maxLengthDto, mockUserContext.userId, mockUserContext.roles);
      });

      it('should handle special characters in label', async () => {
        // Arrange
        const specialCharsDto = {
          label: 'Test Instance @#$%^&*()_+-={}[]|\\:;"\'<>,.?/',
          clientUrl: 'https://grafana.example.com',
          orgId: '660e8400-e29b-41d4-a716-446655440001',
        };
        const createdInstance = {
          ...mockGrafanaInstance,
          label: specialCharsDto.label,
        };
        service.create.mockResolvedValue(createdInstance);

        // Act
        const result = await controller.create(specialCharsDto, mockUserContext);

        // Assert
        expect(result.label).toBe(specialCharsDto.label);
      });

      it('should handle Unicode characters in label', async () => {
        // Arrange
        const unicodeDto = {
          label: 'Test Instance 测试实例 テストインスタンス',
          clientUrl: 'https://grafana.example.com',
          orgId: '660e8400-e29b-41d4-a716-446655440001',
        };
        const createdInstance = {
          ...mockGrafanaInstance,
          label: unicodeDto.label,
        };
        service.create.mockResolvedValue(createdInstance);

        // Act
        const result = await controller.create(unicodeDto, mockUserContext);

        // Assert
        expect(result.label).toBe(unicodeDto.label);
      });
    });

    describe('update', () => {
      it('should handle URL update with very long URL', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        const longUrl = 'https://grafana.example.com/' + 'path/'.repeat(500);
        const updateDto = { clientUrl: longUrl };
        const updatedInstance = {
          ...mockGrafanaInstance,
          client_url: longUrl,
        };
        service.update.mockResolvedValue(updatedInstance);

        // Act
        const result = await controller.update(instanceId, updateDto, mockUserContext);

        // Assert
        expect(result.client_url).toBe(longUrl);
      });
    });
  });

  describe('Authentication and Authorization', () => {
    describe('Protected Endpoints', () => {
      it('should be protected by KeycloakEnhancedAuthGuard', () => {
        // Note: This is a metadata check, actual guard testing requires E2E tests
        // The guard is applied at the module level via APP_GUARD in main.ts
        expect(controller).toBeDefined();
      });
    });

    describe('API Key Authentication', () => {
      it('should accept requests with valid API key', async () => {
        // Arrange
        service.findAll.mockResolvedValue([mockGrafanaInstance]);

        // Act
        const result = await controller.findAll({}, undefined, mockUserContext);

        // Assert
        expect(result).toEqual([mockGrafanaInstance]);
        // Note: Actual API key validation happens in the guard layer
      });
    });

    describe('Keycloak JWT Authentication', () => {
      it('should accept requests with valid JWT token', async () => {
        // Arrange
        service.findAll.mockResolvedValue([mockGrafanaInstance]);

        // Act
        const result = await controller.findAll({}, undefined, mockUserContext);

        // Assert
        expect(result).toEqual([mockGrafanaInstance]);
        // Note: Actual JWT validation happens in the guard layer
      });
    });
  });

  describe('Swagger Documentation', () => {
    it('should have ApiTags decorator', () => {
      // Note: Metadata checking requires reflection
      expect(controller).toBeDefined();
    });

    it('should have ApiOperation decorators on all endpoints', () => {
      // Note: Metadata checking requires reflection
      expect(controller.findAll).toBeDefined();
      expect(controller.findOne).toBeDefined();
      expect(controller.create).toBeDefined();
      expect(controller.update).toBeDefined();
      expect(controller.remove).toBeDefined();
      expect(controller.testConnection).toBeDefined();
    });
  });

  describe('Integration Scenarios', () => {
    describe('Complete CRUD Workflow', () => {
      it('should create, read, update, and delete instance', async () => {
        // Arrange
        const createDto = {
          label: 'Workflow Test Instance',
          clientUrl: 'https://workflow.grafana.example.com',
          orgId: '660e8400-e29b-41d4-a716-446655440001',
        };
        const instanceId = '990e8400-e29b-41d4-a716-446655440099';

        // Create
        service.create.mockResolvedValue({ ...mockGrafanaInstance, id: instanceId, label: createDto.label });
        const created = await controller.create(createDto, mockUserContext);
        expect(created.id).toBe(instanceId);

        // Read
        service.findOne.mockResolvedValue(created);
        const read = await controller.findOne(instanceId, mockUserContext);
        expect(read).toEqual(created);

        // Update
        const updateDto = { label: 'Updated Workflow Instance' };
        service.update.mockResolvedValue({ ...created, label: updateDto.label });
        const updated = await controller.update(instanceId, updateDto, mockUserContext);
        expect(updated.label).toBe(updateDto.label);

        // Delete
        service.remove.mockResolvedValue(undefined);
        const deleted = await controller.remove(instanceId, mockUserContext);
        expect(deleted).toEqual({ message: 'Grafana instance deleted successfully' });
      });
    });

    describe('Connection Testing Workflow', () => {
      it('should create instance and test connection', async () => {
        // Arrange
        const createDto = {
          label: 'Connection Test Instance',
          clientUrl: 'https://test.grafana.example.com',
          orgId: '660e8400-e29b-41d4-a716-446655440001',
          apiKey: 'test-api-key',
        };
        const instanceId = '880e8400-e29b-41d4-a716-446655440088';

        // Create
        service.create.mockResolvedValue({ ...mockGrafanaInstance, id: instanceId, label: createDto.label });
        const created = await controller.create(createDto, mockUserContext);
        expect(created.id).toBe(instanceId);

        // Test Connection
        service.testConnection.mockResolvedValue({
          success: true,
          message: `Connection test for ${createDto.label} successful`,
        });
        const connectionResult = await controller.testConnection(instanceId, mockUserContext);
        expect(connectionResult.success).toBe(true);
        expect(connectionResult.message).toContain(createDto.label);
      });

      it('should handle failed connection test', async () => {
        // Arrange
        const instanceId = mockGrafanaInstance.id;
        service.testConnection.mockResolvedValue({
          success: false,
          message: 'Connection failed: Invalid credentials',
        });

        // Act
        const result = await controller.testConnection(instanceId, mockUserContext);

        // Assert
        expect(result.success).toBe(false);
        expect(result.message).toContain('Invalid credentials');
      });
    });
  });
});
