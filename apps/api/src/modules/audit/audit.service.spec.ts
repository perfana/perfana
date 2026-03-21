/**
 * AuditService Test Suite
 *
 * Comprehensive tests for the audit logging service including:
 * - CRUD operation logging (CREATE, UPDATE, DELETE, ACCESS)
 * - Fire-and-forget pattern validation
 * - Query operations
 * - Edge cases and error handling
 *
 * Part of RBAC Phase 5: Row-Level Security, Audit Logging & Hardening
 * Subtask 6-3: Verify audit logging captures all CRUD operations
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { AuditService, CreateAuditLogDto } from './audit.service';
import { AuditLog, AuditAction } from '@perfana/shared/entities';

describe('AuditService', () => {
  let service: AuditService;
  let repository: jest.Mocked<Repository<AuditLog>>;

  // Mock data factory
  const createMockAuditLog = (overrides?: Partial<AuditLog>): AuditLog => ({
    id: '123e4567-e89b-12d3-a456-426614174000',
    timestamp: new Date('2025-01-01T12:00:00Z'),
    userId: 'user-123',
    userEmail: 'test@example.com',
    organizationId: 'org-123',
    action: AuditAction.ACCESS,
    resourceType: 'test-runs',
    resourceId: 'resource-123',
    resourceName: 'Test Resource',
    changes: undefined,
    metadata: { route: '/api/test-runs', method: 'GET' },
    success: true,
    errorMessage: undefined,
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0',
    ...overrides,
  });

  const createMockDto = (overrides?: Partial<CreateAuditLogDto>): CreateAuditLogDto => ({
    userId: 'user-123',
    action: AuditAction.ACCESS,
    resourceType: 'test-runs',
    success: true,
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        {
          provide: getRepositoryToken(AuditLog),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            count: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
    repository = module.get(getRepositoryToken(AuditLog));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('service initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });
  });

  describe('log', () => {
    it('should create and save an audit log entry', async () => {
      // Arrange
      const dto = createMockDto();
      const mockLog = createMockAuditLog();
      repository.create.mockReturnValue(mockLog);
      repository.save.mockResolvedValue(mockLog);

      // Act
      const result = await service.log(dto);

      // Assert
      expect(result).toEqual(mockLog);
      expect(repository.create).toHaveBeenCalledWith({
        userId: dto.userId,
        userEmail: dto.userEmail,
        organizationId: dto.organizationId,
        action: dto.action,
        resourceType: dto.resourceType,
        resourceId: dto.resourceId,
        resourceName: dto.resourceName,
        changes: dto.changes,
        metadata: dto.metadata,
        success: dto.success,
        errorMessage: dto.errorMessage,
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent,
      });
      expect(repository.save).toHaveBeenCalledWith(mockLog);
    });

    it('should log CREATE action correctly', async () => {
      // Arrange
      const dto = createMockDto({
        action: AuditAction.CREATE,
        resourceId: 'new-resource-123',
        resourceName: 'New Test Run',
        metadata: { route: '/api/test-runs', method: 'POST' },
      });
      const mockLog = createMockAuditLog({ action: AuditAction.CREATE });
      repository.create.mockReturnValue(mockLog);
      repository.save.mockResolvedValue(mockLog);

      // Act
      const result = await service.log(dto);

      // Assert
      expect(result?.action).toBe(AuditAction.CREATE);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.CREATE }),
      );
    });

    it('should log UPDATE action with changes correctly', async () => {
      // Arrange
      const changes = {
        before: { status: 'running' },
        after: { status: 'completed' },
        fields: ['status'],
      };
      const dto = createMockDto({
        action: AuditAction.UPDATE,
        changes,
      });
      const mockLog = createMockAuditLog({ action: AuditAction.UPDATE, changes });
      repository.create.mockReturnValue(mockLog);
      repository.save.mockResolvedValue(mockLog);

      // Act
      const result = await service.log(dto);

      // Assert
      expect(result?.action).toBe(AuditAction.UPDATE);
      expect(result?.changes).toEqual(changes);
    });

    it('should log DELETE action correctly', async () => {
      // Arrange
      const dto = createMockDto({
        action: AuditAction.DELETE,
        resourceId: 'deleted-resource-123',
      });
      const mockLog = createMockAuditLog({ action: AuditAction.DELETE });
      repository.create.mockReturnValue(mockLog);
      repository.save.mockResolvedValue(mockLog);

      // Act
      const result = await service.log(dto);

      // Assert
      expect(result?.action).toBe(AuditAction.DELETE);
    });

    it('should log ACCESS_DENIED action with error message', async () => {
      // Arrange
      const dto = createMockDto({
        action: AuditAction.ACCESS_DENIED,
        success: false,
        errorMessage: 'User not authorized to access this resource',
      });
      const mockLog = createMockAuditLog({
        action: AuditAction.ACCESS_DENIED,
        success: false,
        errorMessage: 'User not authorized to access this resource',
      });
      repository.create.mockReturnValue(mockLog);
      repository.save.mockResolvedValue(mockLog);

      // Act
      const result = await service.log(dto);

      // Assert
      expect(result?.action).toBe(AuditAction.ACCESS_DENIED);
      expect(result?.success).toBe(false);
      expect(result?.errorMessage).toBe('User not authorized to access this resource');
    });

    it('should capture metadata correctly', async () => {
      // Arrange
      const metadata = {
        route: '/api/test-runs/123',
        method: 'GET',
        duration_ms: 150,
        auth_type: 'keycloak-jwt',
        request_id: 'req-456',
      };
      const dto = createMockDto({ metadata });
      const mockLog = createMockAuditLog({ metadata });
      repository.create.mockReturnValue(mockLog);
      repository.save.mockResolvedValue(mockLog);

      // Act
      const result = await service.log(dto);

      // Assert
      expect(result?.metadata).toEqual(metadata);
    });

    it('should capture IP address and user agent', async () => {
      // Arrange
      const dto = createMockDto({
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      });
      const mockLog = createMockAuditLog({
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      });
      repository.create.mockReturnValue(mockLog);
      repository.save.mockResolvedValue(mockLog);

      // Act
      const result = await service.log(dto);

      // Assert
      expect(result?.ipAddress).toBe('192.168.1.100');
      expect(result?.userAgent).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    });

    it('should return undefined and not throw on database error (fire-and-forget)', async () => {
      // Arrange
      const dto = createMockDto();
      repository.create.mockReturnValue(createMockAuditLog());
      repository.save.mockRejectedValue(new Error('Database connection failed'));

      // Act
      const result = await service.log(dto);

      // Assert
      expect(result).toBeUndefined();
      // Should not throw - fire-and-forget pattern
    });
  });

  describe('logAccess', () => {
    it('should log ACCESS action', async () => {
      // Arrange
      const mockLog = createMockAuditLog({ action: AuditAction.ACCESS });
      repository.create.mockReturnValue(mockLog);
      repository.save.mockResolvedValue(mockLog);

      // Act
      await service.logAccess('user-123', 'test-runs', 'resource-456');

      // Assert
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          action: AuditAction.ACCESS,
          resourceType: 'test-runs',
          resourceId: 'resource-456',
          success: true,
        }),
      );
    });
  });

  describe('logAccessDenied', () => {
    it('should log ACCESS_DENIED action with reason', async () => {
      // Arrange
      const mockLog = createMockAuditLog({
        action: AuditAction.ACCESS_DENIED,
        success: false,
      });
      repository.create.mockReturnValue(mockLog);
      repository.save.mockResolvedValue(mockLog);

      // Act
      await service.logAccessDenied(
        'user-123',
        'test-runs',
        'resource-456',
        'Insufficient permissions',
      );

      // Assert
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          action: AuditAction.ACCESS_DENIED,
          resourceType: 'test-runs',
          resourceId: 'resource-456',
          success: false,
          errorMessage: 'Insufficient permissions',
        }),
      );
    });
  });

  describe('logCreate', () => {
    it('should log CREATE action', async () => {
      // Arrange
      const mockLog = createMockAuditLog({ action: AuditAction.CREATE });
      repository.create.mockReturnValue(mockLog);
      repository.save.mockResolvedValue(mockLog);

      // Act
      await service.logCreate(
        'user-123',
        'test@example.com',
        'test-runs',
        'new-resource-123',
        'New Test Run',
        'org-123',
      );

      // Assert
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          userEmail: 'test@example.com',
          action: AuditAction.CREATE,
          resourceType: 'test-runs',
          resourceId: 'new-resource-123',
          resourceName: 'New Test Run',
          organizationId: 'org-123',
          success: true,
        }),
      );
    });
  });

  describe('logUpdate', () => {
    it('should log UPDATE action with changes', async () => {
      // Arrange
      const changes = {
        before: { status: 'running' },
        after: { status: 'completed' },
        fields: ['status'],
      };
      const mockLog = createMockAuditLog({ action: AuditAction.UPDATE, changes });
      repository.create.mockReturnValue(mockLog);
      repository.save.mockResolvedValue(mockLog);

      // Act
      await service.logUpdate(
        'user-123',
        'test@example.com',
        'test-runs',
        'resource-123',
        changes,
        'Test Run',
        'org-123',
      );

      // Assert
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          action: AuditAction.UPDATE,
          changes,
          success: true,
        }),
      );
    });
  });

  describe('logDelete', () => {
    it('should log DELETE action', async () => {
      // Arrange
      const mockLog = createMockAuditLog({ action: AuditAction.DELETE });
      repository.create.mockReturnValue(mockLog);
      repository.save.mockResolvedValue(mockLog);

      // Act
      await service.logDelete(
        'user-123',
        'test@example.com',
        'test-runs',
        'deleted-resource-123',
        'Deleted Test Run',
        'org-123',
      );

      // Assert
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          action: AuditAction.DELETE,
          resourceId: 'deleted-resource-123',
          success: true,
        }),
      );
    });
  });

  describe('getResourceAuditLog', () => {
    it('should return audit logs for a specific resource', async () => {
      // Arrange
      const mockLogs = [
        createMockAuditLog({ action: AuditAction.CREATE }),
        createMockAuditLog({ action: AuditAction.UPDATE }),
        createMockAuditLog({ action: AuditAction.DELETE }),
      ];
      repository.find.mockResolvedValue(mockLogs);

      // Act
      const result = await service.getResourceAuditLog('test-runs', 'resource-123');

      // Assert
      expect(result).toHaveLength(3);
      expect(repository.find).toHaveBeenCalledWith({
        where: expect.objectContaining({
          resourceId: 'resource-123',
        }),
        order: { timestamp: 'DESC' },
        take: 100,
        skip: 0,
      });
    });

    it('should support pagination', async () => {
      // Arrange
      repository.find.mockResolvedValue([]);

      // Act
      await service.getResourceAuditLog('test-runs', 'resource-123', {
        limit: 10,
        offset: 20,
      });

      // Assert
      expect(repository.find).toHaveBeenCalledWith({
        where: expect.anything(),
        order: { timestamp: 'DESC' },
        take: 10,
        skip: 20,
      });
    });
  });

  describe('getUserAuditLog', () => {
    it('should return audit logs for a specific user', async () => {
      // Arrange
      const mockLogs = [createMockAuditLog(), createMockAuditLog()];
      repository.find.mockResolvedValue(mockLogs);

      // Act
      const result = await service.getUserAuditLog('user-123');

      // Assert
      expect(result).toHaveLength(2);
      expect(repository.find).toHaveBeenCalledWith({
        where: expect.objectContaining({
          userId: 'user-123',
        }),
        order: { timestamp: 'DESC' },
        take: 100,
        skip: 0,
      });
    });
  });

  describe('getOrganizationAuditLog', () => {
    it('should return audit logs for a specific organization', async () => {
      // Arrange
      const mockLogs = [createMockAuditLog()];
      repository.find.mockResolvedValue(mockLogs);

      // Act
      const result = await service.getOrganizationAuditLog('org-123');

      // Assert
      expect(result).toHaveLength(1);
      expect(repository.find).toHaveBeenCalledWith({
        where: expect.objectContaining({
          organizationId: 'org-123',
        }),
        order: { timestamp: 'DESC' },
        take: 100,
        skip: 0,
      });
    });
  });

  describe('getAccessDeniedEvents', () => {
    it('should return only ACCESS_DENIED events', async () => {
      // Arrange
      const mockLogs = [
        createMockAuditLog({ action: AuditAction.ACCESS_DENIED, success: false }),
        createMockAuditLog({ action: AuditAction.ACCESS_DENIED, success: false }),
      ];
      repository.find.mockResolvedValue(mockLogs);

      // Act
      const result = await service.getAccessDeniedEvents();

      // Assert
      expect(result).toHaveLength(2);
      result.forEach((log) => expect(log.action).toBe(AuditAction.ACCESS_DENIED));
    });
  });

  describe('getAuditStats', () => {
    it('should return audit statistics for a time period', async () => {
      // Arrange
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-31');
      const mockLogs = [
        createMockAuditLog({ action: AuditAction.CREATE, success: true }),
        createMockAuditLog({ action: AuditAction.CREATE, success: true }),
        createMockAuditLog({ action: AuditAction.UPDATE, success: true }),
        createMockAuditLog({ action: AuditAction.DELETE, success: false }),
        createMockAuditLog({ action: AuditAction.ACCESS, success: true }),
      ];
      repository.find.mockResolvedValue(mockLogs);

      // Act
      const result = await service.getAuditStats(startDate, endDate);

      // Assert
      expect(result.total).toBe(5);
      expect(result.byAction.CREATE).toBe(2);
      expect(result.byAction.UPDATE).toBe(1);
      expect(result.byAction.DELETE).toBe(1);
      expect(result.byAction.ACCESS).toBe(1);
      expect(result.successRate).toBe('80.00%');
    });

    it('should handle empty results', async () => {
      // Arrange
      repository.find.mockResolvedValue([]);

      // Act
      const result = await service.getAuditStats(new Date(), new Date());

      // Assert
      expect(result.total).toBe(0);
      expect(result.successRate).toBe('0.00%');
    });
  });

  describe('healthCheck', () => {
    it('should return true when database is accessible', async () => {
      // Arrange
      repository.count.mockResolvedValue(10);

      // Act
      const result = await service.healthCheck();

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when database is not accessible', async () => {
      // Arrange
      repository.count.mockRejectedValue(new Error('Connection failed'));

      // Act
      const result = await service.healthCheck();

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null optional fields', async () => {
      // Arrange
      const dto = createMockDto({
        userEmail: undefined,
        organizationId: undefined,
        resourceId: undefined,
        resourceName: undefined,
        changes: undefined,
        metadata: undefined,
        errorMessage: undefined,
        ipAddress: undefined,
        userAgent: undefined,
      });
      const mockLog = createMockAuditLog();
      repository.create.mockReturnValue(mockLog);
      repository.save.mockResolvedValue(mockLog);

      // Act
      const result = await service.log(dto);

      // Assert
      expect(result).toBeDefined();
    });

    it('should handle very long resource names', async () => {
      // Arrange
      const longName = 'A'.repeat(1000);
      const dto = createMockDto({ resourceName: longName });
      const mockLog = createMockAuditLog({ resourceName: longName });
      repository.create.mockReturnValue(mockLog);
      repository.save.mockResolvedValue(mockLog);

      // Act
      const result = await service.log(dto);

      // Assert
      expect(result?.resourceName).toBe(longName);
    });

    it('should handle special characters in metadata', async () => {
      // Arrange
      const metadata = {
        route: '/api/test<script>alert("xss")</script>',
        query: 'name=test&value=<>&"',
      };
      const dto = createMockDto({ metadata });
      const mockLog = createMockAuditLog({ metadata });
      repository.create.mockReturnValue(mockLog);
      repository.save.mockResolvedValue(mockLog);

      // Act
      const result = await service.log(dto);

      // Assert
      expect(result?.metadata).toEqual(metadata);
    });

    it('should handle concurrent log operations', async () => {
      // Arrange
      const mockLog = createMockAuditLog();
      repository.create.mockReturnValue(mockLog);
      repository.save.mockResolvedValue(mockLog);

      // Act
      const results = await Promise.all([
        service.log(createMockDto({ action: AuditAction.CREATE })),
        service.log(createMockDto({ action: AuditAction.UPDATE })),
        service.log(createMockDto({ action: AuditAction.DELETE })),
        service.log(createMockDto({ action: AuditAction.ACCESS })),
      ]);

      // Assert
      expect(results).toHaveLength(4);
      results.forEach((result) => expect(result).toBeDefined());
    });
  });
});
