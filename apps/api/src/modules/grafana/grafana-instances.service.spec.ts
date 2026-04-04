/**
 * GrafanaInstancesService Test Suite
 *
 * Comprehensive tests for Grafana instance management service including:
 * - CRUD operations (create, read, update, delete)
 * - Query filtering (label, snapshotInstance)
 * - Connection testing
 * - Authentication methods (API key, username/password)
 * - URL handling (client_url, server_url)
 * - Snapshot instance management
 * - Error handling and edge cases
 * - Entity to DTO mapping
 */

import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { GrafanaInstancesService } from './grafana-instances.service';
import { GrafanaInstance as GrafanaInstanceEntity } from '../../entities';
import { createAuthorizationServiceMock } from '../../../test/mocks/authorization-service.mock';
import { AuthorizationService } from '../../common/services/authorization.service';

describe('GrafanaInstancesService', () => {
  let service: GrafanaInstancesService;
  let repository: jest.Mocked<Repository<GrafanaInstanceEntity>>;

  // Mock data factory
  const createMockEntity = (overrides?: Partial<GrafanaInstanceEntity>): GrafanaInstanceEntity => ({
    id: '123e4567-e89b-12d3-a456-426614174000',
    label: 'Test Grafana',
    client_url: 'https://grafana.example.com',
    server_url: 'https://grafana-internal.example.com',
    orgId: 'test-org-123',
    apiKey: 'encrypted-api-key-abc123',
    username: undefined,
    password: undefined,
    snapshotInstance: false,
    createdAt: new Date('2025-01-01T10:00:00Z'),
    updatedAt: new Date('2025-01-01T10:00:00Z'),
    applicationDashboards: [],
    ...overrides,
  } as GrafanaInstanceEntity);

  const mockUserId = 'test-user-id';
  const mockRoles = ['user'];

  // Mock QueryBuilder
  const createMockQueryBuilder = () => {
    const mockQueryBuilder: any = {
      orderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    };
    return mockQueryBuilder;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GrafanaInstancesService,
        {
          provide: getRepositoryToken(GrafanaInstanceEntity),
          useValue: {
            createQueryBuilder: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
          },
        },
        {
          provide: AuthorizationService,
          useValue: createAuthorizationServiceMock(),
        },
      ],
    }).compile();

    service = module.get<GrafanaInstancesService>(GrafanaInstancesService);
    repository = module.get(getRepositoryToken(GrafanaInstanceEntity));

    // Suppress logger output in tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all Grafana instances ordered by created_at DESC', async () => {
      // Arrange
      const mockEntities = [
        createMockEntity({ id: '1', label: 'Grafana 1' }),
        createMockEntity({ id: '2', label: 'Grafana 2' }),
      ];
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getMany.mockResolvedValue(mockEntities);
      repository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.findAll(mockUserId, mockRoles);

      // Assert
      expect(repository.createQueryBuilder).toHaveBeenCalledWith('gi');
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('gi.created_at', 'DESC');
      expect(result).toHaveLength(2);
      expect(result[0]?.id).toBe('1');
      expect(result[0]?.label).toBe('Grafana 1');
      expect(result[0]?.org_id).toBe('test-org-123');
      expect(result[0]?.snapshot_instance).toBe(false);
    });

    it('should filter by label with ILIKE query', async () => {
      // Arrange
      const mockEntities = [
        createMockEntity({ id: '1', label: 'Production Grafana' }),
      ];
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getMany.mockResolvedValue(mockEntities);
      repository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      // Act
      await service.findAll(mockUserId, mockRoles, { label: 'prod' });

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'gi.label ILIKE :label',
        { label: '%prod%' }
      );
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
    });

    it('should filter by snapshotInstance true', async () => {
      // Arrange
      const mockEntities = [
        createMockEntity({ id: '1', snapshotInstance: true }),
      ];
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getMany.mockResolvedValue(mockEntities);
      repository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      // Act
      await service.findAll(mockUserId, mockRoles, { snapshotInstance: true });

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'gi.snapshotInstance = :snapshotInstance',
        { snapshotInstance: true }
      );
    });

    it('should filter by snapshotInstance false', async () => {
      // Arrange
      const mockEntities = [
        createMockEntity({ id: '1', snapshotInstance: false }),
      ];
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getMany.mockResolvedValue(mockEntities);
      repository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      // Act
      await service.findAll(mockUserId, mockRoles, { snapshotInstance: false });

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'gi.snapshotInstance = :snapshotInstance',
        { snapshotInstance: false }
      );
    });

    it('should filter by both label and snapshotInstance', async () => {
      // Arrange
      const mockEntities = [
        createMockEntity({ id: '1', label: 'Snapshot Grafana', snapshotInstance: true }),
      ];
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getMany.mockResolvedValue(mockEntities);
      repository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      // Act
      await service.findAll(mockUserId, mockRoles, { label: 'snapshot', snapshotInstance: true });

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'gi.label ILIKE :label',
        { label: '%snapshot%' }
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'gi.snapshotInstance = :snapshotInstance',
        { snapshotInstance: true }
      );
    });

    it('should return empty array when no instances exist', async () => {
      // Arrange
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getMany.mockResolvedValue([]);
      repository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.findAll(mockUserId, mockRoles);

      // Assert
      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it('should map entity fields correctly to DTO format', async () => {
      // Arrange
      const mockEntity = createMockEntity({
        id: 'test-id',
        label: 'Test Label',
        client_url: 'https://client.test',
        server_url: 'https://server.test',
        orgId: 'org-123',
        apiKey: 'api-key-123',
        username: 'testuser',
        password: 'encrypted-pass',
        snapshotInstance: true,
        createdAt: new Date('2025-01-15T10:00:00Z'),
        updatedAt: new Date('2025-01-16T15:30:00Z'),
      });
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getMany.mockResolvedValue([mockEntity]);
      repository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.findAll(mockUserId, mockRoles);

      // Assert - credentials are masked for security
      expect(result[0]).toEqual({
        id: 'test-id',
        label: 'Test Label',
        client_url: 'https://client.test',
        server_url: 'https://server.test',
        org_id: 'org-123',
        api_key: '[MASKED]',
        username: 'testuser',
        password: '[MASKED]',
        snapshot_instance: true,
        created_at: '2025-01-15T10:00:00.000Z',
        updated_at: '2025-01-16T15:30:00.000Z',
      });
    });

    it('should handle null/undefined snapshotInstance as false in DTO', async () => {
      // Arrange
      const mockEntity = createMockEntity({ snapshotInstance: undefined });
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getMany.mockResolvedValue([mockEntity]);
      repository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.findAll(mockUserId, mockRoles);

      // Assert
      expect(result[0]?.snapshot_instance).toBe(false);
    });

    it('should throw and log error when database query fails', async () => {
      // Arrange
      const dbError = new Error('Database connection failed');
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getMany.mockRejectedValue(dbError);
      repository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      // Act & Assert
      await expect(service.findAll(mockUserId, mockRoles)).rejects.toThrow('Database connection failed');
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'Failed to fetch Grafana instances:',
        dbError
      );
    });
  });

  describe('findOne', () => {
    it('should return a Grafana instance by ID', async () => {
      // Arrange
      const mockEntity = createMockEntity({ id: 'test-id-123', label: 'Test Grafana' });
      repository.findOne.mockResolvedValue(mockEntity);

      // Act
      const result = await service.findOne('test-id-123', mockUserId, mockRoles);

      // Assert
      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: 'test-id-123' } });
      expect(result.id).toBe('test-id-123');
      expect(result.label).toBe('Test Grafana');
      expect(result.org_id).toBe('test-org-123');
    });

    it('should throw error when instance not found', async () => {
      // Arrange
      repository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.findOne('non-existent-id', mockUserId, mockRoles)).rejects.toThrow(
        'Grafana instance with id non-existent-id not found'
      );
      // NotFoundException is re-thrown without logging
      expect(Logger.prototype.error).not.toHaveBeenCalled();
    });

    it('should map entity with API key authentication', async () => {
      // Arrange
      const mockEntity = createMockEntity({
        apiKey: 'encrypted-api-key',
        username: undefined,
        password: undefined,
      });
      repository.findOne.mockResolvedValue(mockEntity);

      // Act
      const result = await service.findOne('test-id', mockUserId, mockRoles);

      // Assert - credentials are masked for security
      expect(result.api_key).toBe('[MASKED]');
      expect(result.username).toBeUndefined();
      expect(result.password).toBeUndefined();
    });

    it('should map entity with username/password authentication', async () => {
      // Arrange
      const mockEntity = createMockEntity({
        apiKey: undefined,
        username: 'grafana-user',
        password: 'encrypted-password',
      });
      repository.findOne.mockResolvedValue(mockEntity);

      // Act
      const result = await service.findOne('test-id', mockUserId, mockRoles);

      // Assert - credentials are masked for security
      expect(result.api_key).toBeUndefined();
      expect(result.username).toBe('grafana-user');
      expect(result.password).toBe('[MASKED]');
    });

    it('should handle server_url as optional field', async () => {
      // Arrange
      const mockEntity = createMockEntity({ server_url: undefined });
      repository.findOne.mockResolvedValue(mockEntity);

      // Act
      const result = await service.findOne('test-id', mockUserId, mockRoles);

      // Assert
      expect(result.server_url).toBeUndefined();
    });

    it('should throw and log error when database query fails', async () => {
      // Arrange
      const dbError = new Error('Database timeout');
      repository.findOne.mockRejectedValue(dbError);

      // Act & Assert
      await expect(service.findOne('test-id', mockUserId, mockRoles)).rejects.toThrow('Database timeout');
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'Failed to find Grafana instance:',
        dbError
      );
    });
  });

  describe('create', () => {
    it('should create a Grafana instance with all fields', async () => {
      // Arrange
      const createDto = {
        label: 'New Grafana',
        clientUrl: 'https://grafana.new.com',
        serverUrl: 'https://grafana-internal.new.com',
        orgId: 'org-456',
        apiKey: 'new-api-key',
        username: null,
        password: null,
        snapshotInstance: false,
      };
      const mockEntity = createMockEntity();
      const savedEntity = createMockEntity({
        id: 'new-id-789',
        label: 'New Grafana',
      });

      repository.create.mockReturnValue(mockEntity);
      repository.save.mockResolvedValue(savedEntity);

      // Act
      const result = await service.create(createDto, mockUserId, mockRoles);

      // Assert
      expect(repository.create).toHaveBeenCalledWith({
        label: 'New Grafana',
        client_url: 'https://grafana.new.com',
        server_url: 'https://grafana-internal.new.com',
        orgId: 'org-456',
        apiKey: 'new-api-key',
        username: undefined,
        password: undefined,
        snapshotInstance: false,
        createdBy: mockUserId,
        updatedBy: mockUserId,
        organizationId: undefined,
      });
      expect(repository.save).toHaveBeenCalledWith(mockEntity);
      expect(result.id).toBe('new-id-789');
      expect(Logger.prototype.log).toHaveBeenCalledWith('Grafana instance created: New Grafana by user test-user-id');
    });

    it('should create instance with API key authentication only', async () => {
      // Arrange
      const createDto = {
        label: 'API Key Grafana',
        clientUrl: 'https://grafana.apikey.com',
        orgId: 'org-789',
        apiKey: 'secure-api-key-xyz',
      };
      const mockEntity = createMockEntity();
      const savedEntity = createMockEntity();

      repository.create.mockReturnValue(mockEntity);
      repository.save.mockResolvedValue(savedEntity);

      // Act
      await service.create(createDto, mockUserId, mockRoles);

      // Assert
      expect(repository.create).toHaveBeenCalledWith({
        label: 'API Key Grafana',
        client_url: 'https://grafana.apikey.com',
        server_url: undefined,
        orgId: 'org-789',
        apiKey: 'secure-api-key-xyz',
        username: undefined,
        password: undefined,
        snapshotInstance: false,
        createdBy: mockUserId,
        updatedBy: mockUserId,
        organizationId: undefined,
      });
    });

    it('should create instance with username/password authentication', async () => {
      // Arrange
      const createDto = {
        label: 'Basic Auth Grafana',
        clientUrl: 'https://grafana.basicauth.com',
        orgId: 'org-101',
        username: 'admin',
        password: 'encrypted-pass',
      };
      const mockEntity = createMockEntity();
      const savedEntity = createMockEntity();

      repository.create.mockReturnValue(mockEntity);
      repository.save.mockResolvedValue(savedEntity);

      // Act
      await service.create(createDto, mockUserId, mockRoles);

      // Assert
      expect(repository.create).toHaveBeenCalledWith({
        label: 'Basic Auth Grafana',
        client_url: 'https://grafana.basicauth.com',
        server_url: undefined,
        orgId: 'org-101',
        apiKey: undefined,
        username: 'admin',
        password: 'encrypted-pass',
        snapshotInstance: false,
        createdBy: mockUserId,
        updatedBy: mockUserId,
        organizationId: undefined,
      });
    });

    it('should create snapshot instance when snapshotInstance is true', async () => {
      // Arrange
      const createDto = {
        label: 'Snapshot Grafana',
        clientUrl: 'https://snapshot.grafana.com',
        orgId: 'org-202',
        snapshotInstance: true,
      };
      const mockEntity = createMockEntity();
      const savedEntity = createMockEntity({ snapshotInstance: true });

      repository.create.mockReturnValue(mockEntity);
      repository.save.mockResolvedValue(savedEntity);

      // Act
      const result = await service.create(createDto, mockUserId, mockRoles);

      // Assert
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ snapshotInstance: true })
      );
      expect(result.snapshot_instance).toBe(true);
    });

    it('should default snapshotInstance to false when not provided', async () => {
      // Arrange
      const createDto = {
        label: 'Regular Grafana',
        clientUrl: 'https://regular.grafana.com',
        orgId: 'org-303',
      };
      const mockEntity = createMockEntity();
      const savedEntity = createMockEntity({ snapshotInstance: false });

      repository.create.mockReturnValue(mockEntity);
      repository.save.mockResolvedValue(savedEntity);

      // Act
      const result = await service.create(createDto, mockUserId, mockRoles);

      // Assert
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ snapshotInstance: false })
      );
      expect(result.snapshot_instance).toBe(false);
    });

    it('should default serverUrl to null when not provided', async () => {
      // Arrange
      const createDto = {
        label: 'No Server URL',
        clientUrl: 'https://client.only.com',
        orgId: 'org-404',
      };
      const mockEntity = createMockEntity();
      const savedEntity = createMockEntity();

      repository.create.mockReturnValue(mockEntity);
      repository.save.mockResolvedValue(savedEntity);

      // Act
      await service.create(createDto, mockUserId, mockRoles);

      // Assert
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ server_url: undefined })
      );
    });

    it('should throw and log error when save fails', async () => {
      // Arrange
      const createDto = {
        label: 'Failing Grafana',
        clientUrl: 'https://fail.grafana.com',
        orgId: 'org-500',
      };
      const mockEntity = createMockEntity();
      const dbError = new Error('Duplicate key violation');

      repository.create.mockReturnValue(mockEntity);
      repository.save.mockRejectedValue(dbError);

      // Act & Assert
      await expect(service.create(createDto, mockUserId, mockRoles)).rejects.toThrow('Duplicate key violation');
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'Failed to create Grafana instance:',
        dbError
      );
    });

    it('should handle empty optional fields', async () => {
      // Arrange
      const createDto = {
        label: 'Minimal Grafana',
        clientUrl: 'https://minimal.grafana.com',
        orgId: 'org-minimal',
        apiKey: '',
        username: '',
        password: '',
      };
      const mockEntity = createMockEntity();
      const savedEntity = createMockEntity();

      repository.create.mockReturnValue(mockEntity);
      repository.save.mockResolvedValue(savedEntity);

      // Act
      await service.create(createDto, mockUserId, mockRoles);

      // Assert
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: undefined,
          username: undefined,
          password: undefined,
        })
      );
    });
  });

  describe('update', () => {
    it('should update all fields of a Grafana instance', async () => {
      // Arrange
      const existingEntity = createMockEntity({ id: 'update-id' });
      const updateDto = {
        label: 'Updated Label',
        clientUrl: 'https://updated.grafana.com',
        serverUrl: 'https://updated-internal.grafana.com',
        orgId: 'updated-org',
        apiKey: 'updated-api-key',
        username: 'updated-user',
        password: 'updated-pass',
        snapshotInstance: true,
      };
      const updatedEntity = createMockEntity({
        ...existingEntity,
        label: 'Updated Label',
      });

      repository.findOne.mockResolvedValue(existingEntity);
      repository.save.mockResolvedValue(updatedEntity);

      // Act
      await service.update('update-id', updateDto, mockUserId, mockRoles);

      // Assert
      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: 'update-id' } });
      expect(existingEntity.label).toBe('Updated Label');
      expect(existingEntity.client_url).toBe('https://updated.grafana.com');
      expect(existingEntity.server_url).toBe('https://updated-internal.grafana.com');
      expect(existingEntity.orgId).toBe('updated-org');
      expect(existingEntity.apiKey).toBe('updated-api-key');
      expect(existingEntity.username).toBe('updated-user');
      expect(existingEntity.password).toBe('updated-pass');
      expect(existingEntity.snapshotInstance).toBe(true);
      expect(repository.save).toHaveBeenCalledWith(existingEntity);
      expect(Logger.prototype.log).toHaveBeenCalledWith('Grafana instance updated: update-id by user test-user-id');
    });

    it('should update only label field when only label is provided', async () => {
      // Arrange
      const existingEntity = createMockEntity({
        id: 'partial-id',
        label: 'Old Label',
        client_url: 'https://original.com',
      });
      const updateDto = { label: 'New Label' };
      const updatedEntity = createMockEntity({ ...existingEntity, label: 'New Label' });

      repository.findOne.mockResolvedValue(existingEntity);
      repository.save.mockResolvedValue(updatedEntity);

      // Act
      const result = await service.update('partial-id', updateDto, mockUserId, mockRoles);

      // Assert
      expect(existingEntity.label).toBe('New Label');
      expect(existingEntity.client_url).toBe('https://original.com'); // Unchanged
      expect(result.label).toBe('New Label');
    });

    it('should update only authentication fields', async () => {
      // Arrange
      const existingEntity = createMockEntity({
        apiKey: 'old-key',
        username: undefined,
        password: undefined,
      });
      const updateDto = {
        apiKey: '', // Empty string to clear the API key
        username: 'new-user',
        password: 'new-pass',
      };
      const updatedEntity = createMockEntity({ ...existingEntity });

      repository.findOne.mockResolvedValue(existingEntity);
      repository.save.mockResolvedValue(updatedEntity);

      // Act
      await service.update('auth-update-id', updateDto, mockUserId, mockRoles);

      // Assert
      expect(existingEntity.apiKey).toBe('');
      expect(existingEntity.username).toBe('new-user');
      expect(existingEntity.password).toBe('new-pass');
    });

    it('should update snapshotInstance from false to true', async () => {
      // Arrange
      const existingEntity = createMockEntity({ snapshotInstance: false });
      const updateDto = { snapshotInstance: true };
      const updatedEntity = createMockEntity({ ...existingEntity, snapshotInstance: true });

      repository.findOne.mockResolvedValue(existingEntity);
      repository.save.mockResolvedValue(updatedEntity);

      // Act
      const result = await service.update('snapshot-id', updateDto, mockUserId, mockRoles);

      // Assert
      expect(existingEntity.snapshotInstance).toBe(true);
      expect(result.snapshot_instance).toBe(true);
    });

    it('should not update fields when values are undefined', async () => {
      // Arrange
      const existingEntity = createMockEntity({
        label: 'Original Label',
        client_url: 'https://original.com',
      });
      const updateDto = { label: undefined, clientUrl: undefined };
      const updatedEntity = createMockEntity({ ...existingEntity });

      repository.findOne.mockResolvedValue(existingEntity);
      repository.save.mockResolvedValue(updatedEntity);

      // Act
      await service.update('no-change-id', updateDto, mockUserId, mockRoles);

      // Assert
      expect(existingEntity.label).toBe('Original Label');
      expect(existingEntity.client_url).toBe('https://original.com');
    });

    it('should throw error when instance not found', async () => {
      // Arrange
      repository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.update('non-existent', { label: 'Test' }, mockUserId, mockRoles)).rejects.toThrow(
        'Grafana instance with id non-existent not found'
      );
      // NotFoundException is re-thrown without logging
      expect(Logger.prototype.error).not.toHaveBeenCalled();
    });

    it('should throw and log error when save fails', async () => {
      // Arrange
      const existingEntity = createMockEntity();
      const updateDto = { label: 'Failing Update' };
      const dbError = new Error('Constraint violation');

      repository.findOne.mockResolvedValue(existingEntity);
      repository.save.mockRejectedValue(dbError);

      // Act & Assert
      await expect(service.update('fail-id', updateDto, mockUserId, mockRoles)).rejects.toThrow('Constraint violation');
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'Failed to update Grafana instance:',
        dbError
      );
    });

    it('should clear serverUrl by setting to empty string', async () => {
      // Arrange
      const existingEntity = createMockEntity({ server_url: 'https://old-server.com' });
      const updateDto = { serverUrl: '' };
      const updatedEntity = createMockEntity({ ...existingEntity, server_url: '' });

      repository.findOne.mockResolvedValue(existingEntity);
      repository.save.mockResolvedValue(updatedEntity);

      // Act
      await service.update('clear-server-id', updateDto, mockUserId, mockRoles);

      // Assert
      expect(existingEntity.server_url).toBe('');
    });

    it('should handle updating multiple fields simultaneously', async () => {
      // Arrange
      const existingEntity = createMockEntity();
      const updateDto = {
        label: 'Multi Update',
        clientUrl: 'https://multi.com',
        apiKey: 'multi-key',
        snapshotInstance: true,
      };
      const updatedEntity = createMockEntity({ ...existingEntity });

      repository.findOne.mockResolvedValue(existingEntity);
      repository.save.mockResolvedValue(updatedEntity);

      // Act
      await service.update('multi-id', updateDto, mockUserId, mockRoles);

      // Assert
      expect(existingEntity.label).toBe('Multi Update');
      expect(existingEntity.client_url).toBe('https://multi.com');
      expect(existingEntity.apiKey).toBe('multi-key');
      expect(existingEntity.snapshotInstance).toBe(true);
    });
  });

  describe('remove', () => {
    it('should delete a Grafana instance by ID', async () => {
      // Arrange
      const existingEntity = createMockEntity({ id: 'delete-id' });
      repository.findOne.mockResolvedValue(existingEntity);
      repository.remove.mockResolvedValue(existingEntity);

      // Act
      await service.remove('delete-id', mockUserId, mockRoles);

      // Assert
      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: 'delete-id' } });
      expect(repository.remove).toHaveBeenCalledWith(existingEntity);
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        'Grafana instance delete-id deleted successfully by user test-user-id'
      );
    });

    it('should throw error when instance not found', async () => {
      // Arrange
      repository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.remove('non-existent-id', mockUserId, mockRoles)).rejects.toThrow(
        'Grafana instance with id non-existent-id not found'
      );
      expect(repository.remove).not.toHaveBeenCalled();
      // NotFoundException is re-thrown without logging
      expect(Logger.prototype.error).not.toHaveBeenCalled();
    });

    it('should throw and log error when remove operation fails', async () => {
      // Arrange
      const existingEntity = createMockEntity({ id: 'fail-delete-id' });
      const dbError = new Error('Foreign key constraint violation');
      repository.findOne.mockResolvedValue(existingEntity);
      repository.remove.mockRejectedValue(dbError);

      // Act & Assert
      await expect(service.remove('fail-delete-id', mockUserId, mockRoles)).rejects.toThrow(
        'Foreign key constraint violation'
      );
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'Failed to delete Grafana instance:',
        dbError
      );
    });

    it('should successfully delete snapshot instance', async () => {
      // Arrange
      const snapshotEntity = createMockEntity({
        id: 'snapshot-delete-id',
        snapshotInstance: true,
      });
      repository.findOne.mockResolvedValue(snapshotEntity);
      repository.remove.mockResolvedValue(snapshotEntity);

      // Act
      await service.remove('snapshot-delete-id', mockUserId, mockRoles);

      // Assert
      expect(repository.remove).toHaveBeenCalledWith(snapshotEntity);
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        'Grafana instance snapshot-delete-id deleted successfully by user test-user-id'
      );
    });
  });

  describe('testConnection', () => {
    it('should return success when instance exists', async () => {
      // Arrange
      const mockEntity = createMockEntity({
        id: 'connection-test-id',
        label: 'Test Connection Grafana',
      });
      repository.findOne.mockResolvedValue(mockEntity);

      // Act
      const result = await service.testConnection('connection-test-id', mockUserId, mockRoles);

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toBe('Connection test for Test Connection Grafana successful');
    });

    it('should return failure when instance not found', async () => {
      // Arrange
      repository.findOne.mockResolvedValue(null);

      // Act
      const result = await service.testConnection('non-existent-id', mockUserId, mockRoles);

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toBe('Grafana instance with id non-existent-id not found');
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'Failed to test Grafana connection:',
        expect.any(Error)
      );
    });

    it('should handle database errors gracefully', async () => {
      // Arrange
      const dbError = new Error('Database connection timeout');
      repository.findOne.mockRejectedValue(dbError);

      // Act
      const result = await service.testConnection('error-id', mockUserId, mockRoles);

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toBe('Database connection timeout');
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'Failed to test Grafana connection:',
        dbError
      );
    });

    it('should handle non-Error exceptions safely', async () => {
      // Arrange
      repository.findOne.mockRejectedValue('String error');

      // Act
      const result = await service.testConnection('string-error-id', mockUserId, mockRoles);

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection test failed');
    });

    it('should handle null error message', async () => {
      // Arrange
      repository.findOne.mockRejectedValue({});

      // Act
      const result = await service.testConnection('null-error-id', mockUserId, mockRoles);

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection test failed');
    });

    it('should test connection for instance with API key auth', async () => {
      // Arrange
      const mockEntity = createMockEntity({
        label: 'API Key Instance',
        apiKey: 'test-api-key',
        username: undefined,
        password: undefined,
      });
      repository.findOne.mockResolvedValue(mockEntity);

      // Act
      const result = await service.testConnection('api-key-id', mockUserId, mockRoles);

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toContain('API Key Instance');
    });

    it('should test connection for instance with username/password auth', async () => {
      // Arrange
      const mockEntity = createMockEntity({
        label: 'Basic Auth Instance',
        apiKey: undefined,
        username: 'grafana-admin',
        password: 'encrypted-password',
      });
      repository.findOne.mockResolvedValue(mockEntity);

      // Act
      const result = await service.testConnection('basic-auth-id', mockUserId, mockRoles);

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toContain('Basic Auth Instance');
    });

    it('should test connection for snapshot instance', async () => {
      // Arrange
      const mockEntity = createMockEntity({
        label: 'Snapshot Instance',
        snapshotInstance: true,
      });
      repository.findOne.mockResolvedValue(mockEntity);

      // Act
      const result = await service.testConnection('snapshot-id', mockUserId, mockRoles);

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toContain('Snapshot Instance');
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    it('should handle very long label strings', async () => {
      // Arrange
      const longLabel = 'A'.repeat(255);
      const createDto = {
        label: longLabel,
        clientUrl: 'https://long-label.com',
        orgId: 'org-long',
      };
      const mockEntity = createMockEntity();
      const savedEntity = createMockEntity({ label: longLabel });

      repository.create.mockReturnValue(mockEntity);
      repository.save.mockResolvedValue(savedEntity);

      // Act
      const result = await service.create(createDto, mockUserId, mockRoles);

      // Assert
      expect(result.label).toBe(longLabel);
      expect(result.label.length).toBe(255);
    });

    it('should handle special characters in label', async () => {
      // Arrange
      const specialLabel = 'Grafana (Production) - 2025 [v2.0] #1';
      const mockEntities = [createMockEntity({ label: specialLabel })];
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getMany.mockResolvedValue(mockEntities);
      repository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      // Act
      await service.findAll(mockUserId, mockRoles, { label: 'Production' });

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'gi.label ILIKE :label',
        { label: '%Production%' }
      );
    });

    it('should handle URL with query parameters and fragments', async () => {
      // Arrange
      const createDto = {
        label: 'Complex URL Grafana',
        clientUrl: 'https://grafana.com:3000/path?param=value&flag=true#section',
        serverUrl: 'https://internal.grafana.com:3000/path?key=val',
        orgId: 'org-complex',
      };
      const mockEntity = createMockEntity();
      const savedEntity = createMockEntity();

      repository.create.mockReturnValue(mockEntity);
      repository.save.mockResolvedValue(savedEntity);

      // Act
      await service.create(createDto, mockUserId, mockRoles);

      // Assert
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          client_url: 'https://grafana.com:3000/path?param=value&flag=true#section',
          server_url: 'https://internal.grafana.com:3000/path?key=val',
        })
      );
    });

    it('should handle empty string values in update', async () => {
      // Arrange
      const existingEntity = createMockEntity({
        apiKey: 'existing-key',
        username: 'existing-user',
      });
      const updateDto = {
        apiKey: '',
        username: '',
      };
      const updatedEntity = createMockEntity({ ...existingEntity });

      repository.findOne.mockResolvedValue(existingEntity);
      repository.save.mockResolvedValue(updatedEntity);

      // Act
      await service.update('empty-string-id', updateDto, mockUserId, mockRoles);

      // Assert
      expect(existingEntity.apiKey).toBe('');
      expect(existingEntity.username).toBe('');
    });

    it('should handle orgId with special characters', async () => {
      // Arrange
      const createDto = {
        label: 'Special Org Grafana',
        clientUrl: 'https://special.grafana.com',
        orgId: 'org-123-abc_XYZ',
      };
      const mockEntity = createMockEntity();
      const savedEntity = createMockEntity({ orgId: 'org-123-abc_XYZ' });

      repository.create.mockReturnValue(mockEntity);
      repository.save.mockResolvedValue(savedEntity);

      // Act
      const result = await service.create(createDto, mockUserId, mockRoles);

      // Assert
      expect(result.org_id).toBe('org-123-abc_XYZ');
    });

    it('should handle concurrent filter queries', async () => {
      // Arrange
      const mockEntities = [
        createMockEntity({ id: '1', label: 'Test Snapshot', snapshotInstance: true }),
      ];
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getMany.mockResolvedValue(mockEntities);
      repository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.findAll(mockUserId, mockRoles, {
        label: 'Test',
        snapshotInstance: true,
      });

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(1);
      expect(result[0]?.snapshot_instance).toBe(true);
    });

    it('should handle Date objects in DTO mapping', async () => {
      // Arrange
      const specificDate = new Date('2025-11-13T14:30:45.123Z');
      const mockEntity = createMockEntity({
        createdAt: specificDate,
        updatedAt: specificDate,
      });
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getMany.mockResolvedValue([mockEntity]);
      repository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.findAll(mockUserId, mockRoles);

      // Assert
      expect(result[0]?.created_at).toBe('2025-11-13T14:30:45.123Z');
      expect(result[0]?.updated_at).toBe('2025-11-13T14:30:45.123Z');
    });
  });

  describe('Integration Scenarios', () => {
    it('should create, update, and delete an instance in sequence', async () => {
      // Arrange - Create
      const createDto = {
        label: 'Lifecycle Test',
        clientUrl: 'https://lifecycle.grafana.com',
        orgId: 'org-lifecycle',
      };
      const createdEntity = createMockEntity({ id: 'lifecycle-id', label: 'Lifecycle Test' });
      repository.create.mockReturnValue(createdEntity);
      repository.save.mockResolvedValue(createdEntity);

      // Act - Create
      const created = await service.create(createDto, mockUserId, mockRoles);

      // Assert - Create
      expect(created.id).toBe('lifecycle-id');
      expect(created.label).toBe('Lifecycle Test');

      // Arrange - Update
      const updateDto = { label: 'Updated Lifecycle' };
      const updatedEntity = createMockEntity({ id: 'lifecycle-id', label: 'Updated Lifecycle' });
      repository.findOne.mockResolvedValue(createdEntity);
      repository.save.mockResolvedValue(updatedEntity);

      // Act - Update
      const updated = await service.update('lifecycle-id', updateDto, mockUserId, mockRoles);

      // Assert - Update
      expect(updated.label).toBe('Updated Lifecycle');

      // Arrange - Delete
      repository.findOne.mockResolvedValue(updatedEntity);
      repository.remove.mockResolvedValue(updatedEntity);

      // Act - Delete
      await service.remove('lifecycle-id', mockUserId, mockRoles);

      // Assert - Delete
      expect(repository.remove).toHaveBeenCalledWith(updatedEntity);
    });

    it('should handle switching authentication methods via update', async () => {
      // Arrange - Initial API key auth
      const existingEntity = createMockEntity({
        id: 'auth-switch-id',
        apiKey: 'old-api-key',
        username: undefined,
        password: undefined,
      });
      repository.findOne.mockResolvedValue(existingEntity);

      // Act - Switch to username/password
      const updateDto = {
        apiKey: '', // Clear API key
        username: 'new-user',
        password: 'new-password',
      };
      const updatedEntity = createMockEntity({
        ...existingEntity,
        apiKey: '',
        username: 'new-user',
        password: 'new-password',
      });
      repository.save.mockResolvedValue(updatedEntity);

      await service.update('auth-switch-id', updateDto, mockUserId, mockRoles);

      // Assert
      expect(existingEntity.apiKey).toBe('');
      expect(existingEntity.username).toBe('new-user');
      expect(existingEntity.password).toBe('new-password');
    });

    it('should handle filtering snapshot instances and testing connection', async () => {
      // Arrange - Find snapshot instances
      const snapshotEntity = createMockEntity({
        id: 'snapshot-test-id',
        label: 'Snapshot for Testing',
        snapshotInstance: true,
      });
      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getMany.mockResolvedValue([snapshotEntity]);
      repository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      // Act - Find snapshots
      const snapshots = await service.findAll(mockUserId, mockRoles, { snapshotInstance: true });

      // Assert - Found snapshots
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]?.snapshot_instance).toBe(true);

      // Arrange - Test connection
      repository.findOne.mockResolvedValue(snapshotEntity);

      // Act - Test connection
      const connectionResult = await service.testConnection('snapshot-test-id', mockUserId, mockRoles);

      // Assert - Connection test
      expect(connectionResult.success).toBe(true);
      expect(connectionResult.message).toContain('Snapshot for Testing');
    });
  });
});
