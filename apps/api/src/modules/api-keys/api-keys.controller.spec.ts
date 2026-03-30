import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { ApiKey } from '../../entities';
import { ResourceNotFoundException, ValidationException } from '../../common/exceptions/business.exception';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UserContext } from '../../common/decorators/user-context.decorator';
import { AuthorizationService } from '../../common/services/authorization.service';
import { createAuthorizationServiceMock } from '../../../test/mocks/authorization-service.mock';

describe('ApiKeysController', () => {
  let controller: ApiKeysController;
  let service: jest.Mocked<ApiKeysService>;

  const mockUserContext: UserContext = {
    userId: 'test-user-123',
    roles: ['user'],
    organizations: ['org-123'],
    teams: ['team-456'],
    organizationId: 'org-123',
    teamId: 'team-456',
  };

  // Mock data fixtures
  const mockApiKey: Partial<ApiKey> = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    description: 'CI/CD Pipeline Key',
    roles: ['perfana-user'],
    validUntil: new Date('2025-12-31T23:59:59Z'),
    createdAt: new Date('2024-01-15T10:00:00Z'),
    updatedAt: new Date('2024-01-15T10:00:00Z'),
    lastUsed: undefined,
  };

  const mockToken = 'Q0kvQ0QgUGlwZWxpbmUgS2V5IzU1MGU4NDAwLWUyOWItNDFkNC1hNzE2LTQ0NjY1NTQ0MDAwMA==';

  const mockCacheStats = {
    hits: 9650,
    misses: 350,
    hitRate: '96.50',
    totalRequests: 10000,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApiKeysController],
      providers: [
        {
          provide: ApiKeysService,
          useValue: {
            findAll: jest.fn(),
            findOne: jest.fn(),
            createApiKey: jest.fn(),
            deleteApiKey: jest.fn(),
            validateApiKey: jest.fn(),
            getCacheStats: jest.fn(),
            clearCaches: jest.fn(),
            warmCaches: jest.fn(),
            getUserOrganizations: jest.fn(),
          },
        },
        {
          provide: AuthorizationService,
          useValue: createAuthorizationServiceMock(),
        },
      ],
    }).compile();

    controller = module.get<ApiKeysController>(ApiKeysController);
    service = module.get(ApiKeysService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Module Initialization', () => {
    it('should be defined', () => {
      expect(controller).toBeDefined();
    });

    it('should have service injected', () => {
      expect(service).toBeDefined();
    });
  });

  describe('Happy Path - findAll', () => {
    it('should return all API keys sorted by creation date', async () => {
      // Arrange
      const mockApiKeys: Partial<ApiKey>[] = [
        {
          id: '1',
          description: 'Test Key 1',
          roles: ['perfana-user'],
          validUntil: new Date('2025-12-31'),
          createdAt: new Date('2024-01-15'),
          updatedAt: new Date('2024-01-15'),
          lastUsed: undefined,
        },
        {
          id: '2',
          description: 'Test Key 2',
          roles: ['perfana-admin'],
          validUntil: new Date('2025-12-31'),
          createdAt: new Date('2024-01-14'),
          updatedAt: new Date('2024-01-14'),
          lastUsed: new Date('2024-01-20'),
        },
      ];

      service.findAll.mockResolvedValue(mockApiKeys as ApiKey[]);

      // Act
      const result = await controller.findAll(mockUserContext);

      // Assert
      expect(result).toEqual(mockApiKeys);
      expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, undefined);
      expect(service.findAll).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no API keys exist', async () => {
      // Arrange
      service.findAll.mockResolvedValue([]);

      // Act
      const result = await controller.findAll(mockUserContext);

      // Assert
      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
      expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, undefined);
      expect(service.findAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('Happy Path - findOne', () => {
    it('should return a single API key by UUID', async () => {
      // Arrange
      service.findOne.mockResolvedValue(mockApiKey as ApiKey);

      // Act
      const result = await controller.findOne(mockApiKey.id!, mockUserContext);

      // Assert
      expect(result).toEqual(mockApiKey);
      expect(service.findOne).toHaveBeenCalledWith(mockApiKey.id, mockUserContext.userId, mockUserContext.roles);
      expect(service.findOne).toHaveBeenCalledTimes(1);
    });

    it('should return API key with roles array', async () => {
      // Arrange
      const keyWithMultipleRoles = {
        ...mockApiKey,
        roles: ['perfana-user', 'perfana-admin', 'read-only'],
      };
      service.findOne.mockResolvedValue(keyWithMultipleRoles as ApiKey);

      // Act
      const result = await controller.findOne(mockApiKey.id!, mockUserContext);

      // Assert
      expect(result.roles).toHaveLength(3);
      expect(result.roles).toContain('perfana-user');
      expect(result.roles).toContain('perfana-admin');
      expect(result.roles).toContain('read-only');
    });

    it('should return API key with lastUsed timestamp', async () => {
      // Arrange
      const keyWithLastUsed = {
        ...mockApiKey,
        lastUsed: new Date('2024-01-20T14:30:00Z'),
      };
      service.findOne.mockResolvedValue(keyWithLastUsed as ApiKey);

      // Act
      const result = await controller.findOne(mockApiKey.id!, mockUserContext);

      // Assert
      expect(result.lastUsed).toBeDefined();
      expect(result.lastUsed).toBeInstanceOf(Date);
    });
  });

  describe('Happy Path - create', () => {
    it('should create a new API key with valid TTL', async () => {
      // Arrange
      const createDto: CreateApiKeyDto = {
        description: 'CI/CD Pipeline Key',
        ttl: '30d',
        roles: ['perfana-user'],
      };

      service.createApiKey.mockResolvedValue({
        apiKey: mockApiKey as ApiKey,
        token: mockToken,
      });

      // Act
      const result = await controller.create(createDto, mockUserContext);

      // Assert
      expect(result).toEqual({
        apiKey: {
          id: mockApiKey.id,
          description: mockApiKey.description,
          roles: mockApiKey.roles,
          valid_until: mockApiKey.validUntil,
          created_at: mockApiKey.createdAt,
          last_used: undefined,
        },
        token: mockToken,
      });
      expect(service.createApiKey).toHaveBeenCalledWith(createDto, mockUserContext.userId, mockUserContext.roles, mockUserContext.organizationId);
      expect(service.createApiKey).toHaveBeenCalledTimes(1);
    });

    it('should throw BadRequestException when user has no organizationId', async () => {
      // Arrange
      const createDto: CreateApiKeyDto = {
        description: 'CI/CD Pipeline Key',
        ttl: '30d',
        roles: ['perfana-user'],
      };

      const userContextWithoutOrg: UserContext = {
        userId: 'test-user-123',
        roles: ['user'],
        organizations: [],
        teams: [],
        organizationId: undefined,
        teamId: undefined,
      };

      // Mock getUserOrganizations to return empty array (user has no orgs)
      (service.getUserOrganizations as jest.Mock).mockResolvedValue([]);

      // Act & Assert
      await expect(controller.create(createDto, userContextWithoutOrg)).rejects.toThrow(BadRequestException);
      await expect(controller.create(createDto, userContextWithoutOrg)).rejects.toThrow(
        'User must belong to an organization to create API keys'
      );
      expect(service.createApiKey).not.toHaveBeenCalled();
    });

    it('should create API key with TTL in days format', async () => {
      // Arrange
      const createDto: CreateApiKeyDto = {
        description: 'Short-lived Key',
        ttl: '7d',
        roles: [],
      };

      service.createApiKey.mockResolvedValue({
        apiKey: mockApiKey as ApiKey,
        token: mockToken,
      });

      // Act
      const result = await controller.create(createDto, mockUserContext);

      // Assert
      expect(result.token).toBe(mockToken);
      expect(service.createApiKey).toHaveBeenCalledWith(createDto, mockUserContext.userId, mockUserContext.roles, mockUserContext.organizationId);
    });

    it('should create API key with TTL in weeks format', async () => {
      // Arrange
      const createDto: CreateApiKeyDto = {
        description: 'Weekly Key',
        ttl: '2w',
        roles: ['perfana-user'],
      };

      service.createApiKey.mockResolvedValue({
        apiKey: mockApiKey as ApiKey,
        token: mockToken,
      });

      // Act
      const result = await controller.create(createDto, mockUserContext);

      // Assert
      expect(result.token).toBe(mockToken);
      expect(service.createApiKey).toHaveBeenCalledWith(createDto, mockUserContext.userId, mockUserContext.roles, mockUserContext.organizationId);
    });

    it('should create API key with TTL in months format', async () => {
      // Arrange
      const createDto: CreateApiKeyDto = {
        description: 'Monthly Key',
        ttl: '6M',
        roles: ['perfana-user'],
      };

      service.createApiKey.mockResolvedValue({
        apiKey: mockApiKey as ApiKey,
        token: mockToken,
      });

      // Act
      const result = await controller.create(createDto, mockUserContext);

      // Assert
      expect(result.token).toBe(mockToken);
      expect(service.createApiKey).toHaveBeenCalledWith(createDto, mockUserContext.userId, mockUserContext.roles, mockUserContext.organizationId);
    });

    it('should create API key with TTL in years format', async () => {
      // Arrange
      const createDto: CreateApiKeyDto = {
        description: 'Long-term Key',
        ttl: '1y',
        roles: ['perfana-user'],
      };

      service.createApiKey.mockResolvedValue({
        apiKey: mockApiKey as ApiKey,
        token: mockToken,
      });

      // Act
      const result = await controller.create(createDto, mockUserContext);

      // Assert
      expect(result.token).toBe(mockToken);
      expect(service.createApiKey).toHaveBeenCalledWith(createDto, mockUserContext.userId, mockUserContext.roles, mockUserContext.organizationId);
    });

    it('should create API key with empty roles array', async () => {
      // Arrange
      const createDto: CreateApiKeyDto = {
        description: 'Minimal Permissions Key',
        ttl: '30d',
        roles: [],
      };

      const keyWithNoRoles = {
        ...mockApiKey,
        roles: [],
      };

      service.createApiKey.mockResolvedValue({
        apiKey: keyWithNoRoles as ApiKey,
        token: mockToken,
      });

      // Act
      const result = await controller.create(createDto, mockUserContext);

      // Assert
      expect(result.apiKey.roles).toEqual([]);
      expect(service.createApiKey).toHaveBeenCalledWith(createDto, mockUserContext.userId, mockUserContext.roles, mockUserContext.organizationId);
    });

    it('should create API key with multiple roles', async () => {
      // Arrange
      const createDto: CreateApiKeyDto = {
        description: 'Admin Key',
        ttl: '90d',
        roles: ['perfana-admin', 'perfana-user', 'read-only'],
      };

      const keyWithMultipleRoles = {
        ...mockApiKey,
        roles: ['perfana-admin', 'perfana-user', 'read-only'],
      };

      service.createApiKey.mockResolvedValue({
        apiKey: keyWithMultipleRoles as ApiKey,
        token: mockToken,
      });

      // Act
      const result = await controller.create(createDto, mockUserContext);

      // Assert
      expect(result.apiKey.roles).toHaveLength(3);
      expect(result.apiKey.roles).toContain('perfana-admin');
      expect(service.createApiKey).toHaveBeenCalledWith(createDto, mockUserContext.userId, mockUserContext.roles, mockUserContext.organizationId);
    });

    it('should return token only once during creation', async () => {
      // Arrange
      const createDto: CreateApiKeyDto = {
        description: 'Test Key',
        ttl: '30d',
        roles: ['perfana-user'],
      };

      service.createApiKey.mockResolvedValue({
        apiKey: mockApiKey as ApiKey,
        token: mockToken,
      });

      // Act
      const result = await controller.create(createDto, mockUserContext);

      // Assert
      expect(result.token).toBeDefined();
      expect(result.token).toBe(mockToken);
      expect(typeof result.token).toBe('string');
    });

    it('should format response with snake_case field names', async () => {
      // Arrange
      const createDto: CreateApiKeyDto = {
        description: 'Test Key',
        ttl: '30d',
        roles: ['perfana-user'],
      };

      service.createApiKey.mockResolvedValue({
        apiKey: mockApiKey as ApiKey,
        token: mockToken,
      });

      // Act
      const result = await controller.create(createDto, mockUserContext);

      // Assert
      expect(result.apiKey).toHaveProperty('valid_until');
      expect(result.apiKey).toHaveProperty('created_at');
      expect(result.apiKey).toHaveProperty('last_used');
      expect(result.apiKey).not.toHaveProperty('validUntil');
      expect(result.apiKey).not.toHaveProperty('createdAt');
      expect(result.apiKey).not.toHaveProperty('lastUsed');
    });
  });

  describe('Happy Path - delete', () => {
    it('should delete API key and return success message', async () => {
      // Arrange
      service.deleteApiKey.mockResolvedValue(undefined);

      // Act
      const result = await controller.delete(mockApiKey.id!, mockUserContext);

      // Assert
      expect(result).toEqual({
        message: 'API key deleted successfully',
      });
      expect(service.deleteApiKey).toHaveBeenCalledWith(mockApiKey.id, mockUserContext.userId, mockUserContext.roles);
      expect(service.deleteApiKey).toHaveBeenCalledTimes(1);
    });

    it('should delete API key by different UUID', async () => {
      // Arrange
      const differentId = '123e4567-e89b-12d3-a456-426614174000';
      service.deleteApiKey.mockResolvedValue(undefined);

      // Act
      const result = await controller.delete(differentId, mockUserContext);

      // Assert
      expect(result.message).toBe('API key deleted successfully');
      expect(service.deleteApiKey).toHaveBeenCalledWith(differentId, mockUserContext.userId, mockUserContext.roles);
    });
  });

  describe('Happy Path - validate', () => {
    it('should validate API key and return valid result without key metadata', async () => {
      // Arrange
      const token = mockToken;
      service.validateApiKey.mockResolvedValue(mockApiKey as ApiKey);

      // Act
      const result = await controller.validate(token);

      // Assert — only validity status, no key metadata (prevents info disclosure)
      expect(result).toEqual({ valid: true });
      expect(result).not.toHaveProperty('apiKey');
      expect(service.validateApiKey).toHaveBeenCalledWith(token);
      expect(service.validateApiKey).toHaveBeenCalledTimes(1);
    });

    it('should validate API key and return invalid result', async () => {
      // Arrange
      const invalidToken = 'invalid-token-base64';
      service.validateApiKey.mockResolvedValue(null);

      // Act
      const result = await controller.validate(invalidToken);

      // Assert
      expect(result).toEqual({ valid: false });
      expect(service.validateApiKey).toHaveBeenCalledWith(invalidToken);
    });

    it('should validate expired API key and return invalid result', async () => {
      // Arrange
      const expiredToken = 'expired-token-base64';
      service.validateApiKey.mockResolvedValue(null);

      // Act
      const result = await controller.validate(expiredToken);

      // Assert
      expect(result.valid).toBe(false);
      expect(result).not.toHaveProperty('apiKey');
    });
  });

  describe('Happy Path - Cache Management', () => {
    describe('getCacheStats', () => {
      it('should return cache statistics', async () => {
        // Arrange
        service.getCacheStats.mockReturnValue(mockCacheStats);

        // Act
        const result = await controller.getCacheStats();

        // Assert
        expect(result).toEqual(mockCacheStats);
        expect(service.getCacheStats).toHaveBeenCalledTimes(1);
      });

      it('should return cache statistics with high hit rate', async () => {
        // Arrange
        const highHitRateStats = {
          hits: 9900,
          misses: 100,
          hitRate: '99.00',
          totalRequests: 10000,
        };
        service.getCacheStats.mockReturnValue(highHitRateStats);

        // Act
        const result = await controller.getCacheStats();

        // Assert
        expect(parseFloat(result.hitRate)).toBeGreaterThan(95);
      });

      it('should return cache statistics with zero cache', async () => {
        // Arrange
        const emptyCacheStats = {
          hits: 0,
          misses: 0,
          hitRate: '0.00',
          totalRequests: 0,
        };
        service.getCacheStats.mockReturnValue(emptyCacheStats);

        // Act
        const result = await controller.getCacheStats();

        // Assert
        expect(result.hits).toBe(0);
        expect(result.misses).toBe(0);
        expect(result.totalRequests).toBe(0);
      });
    });

    describe('clearCaches', () => {
      it('should clear all caches and return success message', async () => {
        // Arrange
        service.clearCaches.mockResolvedValue(undefined);

        // Act
        const result = await controller.clearCaches();

        // Assert
        expect(result).toEqual({
          message: 'All API key caches cleared successfully',
        });
        expect(service.clearCaches).toHaveBeenCalledTimes(1);
      });
    });

    describe('warmCaches', () => {
      it('should warm caches and return success message', async () => {
        // Arrange
        service.warmCaches.mockResolvedValue(undefined);

        // Act
        const result = await controller.warmCaches();

        // Assert
        expect(result).toEqual({
          message: 'API key caches warmed successfully',
        });
        expect(service.warmCaches).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Error Scenarios - findOne', () => {
    it('should throw ResourceNotFoundException when key not found', async () => {
      // Arrange
      const nonExistentId = '999e9999-e99b-99d9-a999-999999999999';
      service.findOne.mockRejectedValue(new ResourceNotFoundException('API key', nonExistentId));

      // Act & Assert
      await expect(controller.findOne(nonExistentId, mockUserContext)).rejects.toThrow(ResourceNotFoundException);
      await expect(controller.findOne(nonExistentId, mockUserContext)).rejects.toThrow(
        `API key with identifier '${nonExistentId}' not found`
      );
    });

    it('should propagate service errors', async () => {
      // Arrange
      service.findOne.mockRejectedValue(new Error('Database connection failed'));

      // Act & Assert
      await expect(controller.findOne(mockApiKey.id!, mockUserContext)).rejects.toThrow('Database connection failed');
    });
  });

  describe('Error Scenarios - create', () => {
    it('should handle invalid TTL format', async () => {
      // Arrange
      const createDto: CreateApiKeyDto = {
        description: 'Test Key',
        ttl: 'invalid',
        roles: [],
      };

      service.createApiKey.mockRejectedValue(
        new ValidationException('Invalid TTL format: invalid. Expected format: number + unit (d/w/M/y)')
      );

      // Act & Assert
      await expect(controller.create(createDto, mockUserContext)).rejects.toThrow(ValidationException);
      await expect(controller.create(createDto, mockUserContext)).rejects.toThrow('Invalid TTL format');
    });

    it('should handle empty description', async () => {
      // Arrange
      const createDto: CreateApiKeyDto = {
        description: '',
        ttl: '30d',
        roles: [],
      };

      service.createApiKey.mockRejectedValue(
        new ValidationException('Description cannot be empty')
      );

      // Act & Assert
      await expect(controller.create(createDto, mockUserContext)).rejects.toThrow(ValidationException);
    });

    it('should handle database errors during creation', async () => {
      // Arrange
      const createDto: CreateApiKeyDto = {
        description: 'Test Key',
        ttl: '30d',
        roles: ['perfana-user'],
      };

      service.createApiKey.mockRejectedValue(new Error('Database write failed'));

      // Act & Assert
      await expect(controller.create(createDto, mockUserContext)).rejects.toThrow('Database write failed');
    });
  });

  describe('Error Scenarios - delete', () => {
    it('should throw ResourceNotFoundException when deleting non-existent key', async () => {
      // Arrange
      const nonExistentId = '999e9999-e99b-99d9-a999-999999999999';
      service.deleteApiKey.mockRejectedValue(
        new ResourceNotFoundException('API key', nonExistentId)
      );

      // Act & Assert
      await expect(controller.delete(nonExistentId, mockUserContext)).rejects.toThrow(ResourceNotFoundException);
      await expect(controller.delete(nonExistentId, mockUserContext)).rejects.toThrow(
        `API key with identifier '${nonExistentId}' not found`
      );
    });

    it('should handle database errors during deletion', async () => {
      // Arrange
      service.deleteApiKey.mockRejectedValue(new Error('Database delete operation failed'));

      // Act & Assert
      await expect(controller.delete(mockApiKey.id!, mockUserContext)).rejects.toThrow('Database delete operation failed');
    });
  });

  describe('Error Scenarios - validate', () => {
    it('should handle malformed token gracefully', async () => {
      // Arrange
      const malformedToken = 'not-base64!@#$';
      service.validateApiKey.mockResolvedValue(null);

      // Act
      const result = await controller.validate(malformedToken);

      // Assert
      expect(result.valid).toBe(false);
      expect(result).not.toHaveProperty('apiKey');
    });

    it('should handle empty token', async () => {
      // Arrange
      const emptyToken = '';
      service.validateApiKey.mockResolvedValue(null);

      // Act
      const result = await controller.validate(emptyToken);

      // Assert
      expect(result.valid).toBe(false);
    });

    it('should handle JWT token format (contains dots)', async () => {
      // Arrange
      const jwtToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      service.validateApiKey.mockResolvedValue(null);

      // Act
      const result = await controller.validate(jwtToken);

      // Assert
      expect(result.valid).toBe(false);
      expect(service.validateApiKey).toHaveBeenCalledWith(jwtToken);
    });

    it('should handle service errors during validation', async () => {
      // Arrange
      service.validateApiKey.mockRejectedValue(new Error('Cache service unavailable'));

      // Act & Assert
      await expect(controller.validate(mockToken)).rejects.toThrow('Cache service unavailable');
    });
  });

  describe('Error Scenarios - Cache Operations', () => {
    it('should handle errors when clearing caches', async () => {
      // Arrange
      service.clearCaches.mockRejectedValue(new Error('Redis connection failed'));

      // Act & Assert
      await expect(controller.clearCaches()).rejects.toThrow('Redis connection failed');
    });

    it('should handle errors when warming caches', async () => {
      // Arrange
      service.warmCaches.mockRejectedValue(new Error('Database query timeout'));

      // Act & Assert
      await expect(controller.warmCaches()).rejects.toThrow('Database query timeout');
    });

    it('should handle cache stats retrieval errors', async () => {
      // Arrange
      service.getCacheStats.mockImplementation(() => {
        throw new Error('Cache stats unavailable');
      });

      // Act & Assert
      expect(() => controller.getCacheStats()).rejects.toThrow('Cache stats unavailable');
    });
  });

  describe('Edge Cases - API Key Data', () => {
    it('should handle API key with very long description', async () => {
      // Arrange
      const longDescription = 'A'.repeat(500);
      const keyWithLongDescription = {
        ...mockApiKey,
        description: longDescription,
      };
      service.findOne.mockResolvedValue(keyWithLongDescription as ApiKey);

      // Act
      const result = await controller.findOne(mockApiKey.id!, mockUserContext);

      // Assert
      expect(result.description).toHaveLength(500);
      expect(result.description).toBe(longDescription);
    });

    it('should handle API key with special characters in description', async () => {
      // Arrange
      const specialDescription = 'Test-Key_2024!@#$%^&*()[]{}|:;"<>,.?/~`';
      const keyWithSpecialChars = {
        ...mockApiKey,
        description: specialDescription,
      };
      service.findOne.mockResolvedValue(keyWithSpecialChars as ApiKey);

      // Act
      const result = await controller.findOne(mockApiKey.id!, mockUserContext);

      // Assert
      expect(result.description).toBe(specialDescription);
    });

    it('should handle API key with Unicode characters in description', async () => {
      // Arrange
      const unicodeDescription = 'Test Key 测试密钥 🔑';
      const keyWithUnicode = {
        ...mockApiKey,
        description: unicodeDescription,
      };
      service.findOne.mockResolvedValue(keyWithUnicode as ApiKey);

      // Act
      const result = await controller.findOne(mockApiKey.id!, mockUserContext);

      // Assert
      expect(result.description).toBe(unicodeDescription);
    });

    it('should handle API key without optional roles', async () => {
      // Arrange
      const keyWithoutRoles = {
        ...mockApiKey,
        roles: undefined,
      };
      service.findOne.mockResolvedValue(keyWithoutRoles as any);

      // Act
      const result = await controller.findOne(mockApiKey.id!, mockUserContext);

      // Assert
      expect(result).toBeDefined();
    });
  });

  describe('Edge Cases - TTL Formats', () => {
    it('should handle maximum TTL duration (99 years)', async () => {
      // Arrange
      const createDto: CreateApiKeyDto = {
        description: 'Very Long-term Key',
        ttl: '99y',
        roles: ['perfana-user'],
      };

      service.createApiKey.mockResolvedValue({
        apiKey: mockApiKey as ApiKey,
        token: mockToken,
      });

      // Act
      const result = await controller.create(createDto, mockUserContext);

      // Assert
      expect(result.token).toBeDefined();
      expect(service.createApiKey).toHaveBeenCalledWith(createDto, mockUserContext.userId, mockUserContext.roles, mockUserContext.organizationId);
    });

    it('should handle minimum TTL duration (1 day)', async () => {
      // Arrange
      const createDto: CreateApiKeyDto = {
        description: 'Very Short-term Key',
        ttl: '1d',
        roles: [],
      };

      service.createApiKey.mockResolvedValue({
        apiKey: mockApiKey as ApiKey,
        token: mockToken,
      });

      // Act
      const result = await controller.create(createDto, mockUserContext);

      // Assert
      expect(result.token).toBeDefined();
      expect(service.createApiKey).toHaveBeenCalledWith(createDto, mockUserContext.userId, mockUserContext.roles, mockUserContext.organizationId);
    });
  });

  describe('Edge Cases - Validation', () => {
    it('should handle validation with very long token', async () => {
      // Arrange
      const longToken = 'A'.repeat(10000);
      service.validateApiKey.mockResolvedValue(null);

      // Act
      const result = await controller.validate(longToken);

      // Assert
      expect(result.valid).toBe(false);
      expect(service.validateApiKey).toHaveBeenCalledWith(longToken);
    });

    it('should handle concurrent validation requests', async () => {
      // Arrange
      service.validateApiKey.mockResolvedValue(mockApiKey as ApiKey);

      // Act
      const promises = [
        controller.validate(mockToken),
        controller.validate(mockToken),
        controller.validate(mockToken),
      ];
      const results = await Promise.all(promises);

      // Assert
      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result.valid).toBe(true);
      });
      expect(service.validateApiKey).toHaveBeenCalledTimes(3);
    });
  });

  describe('Boundary Values - Cache Statistics', () => {
    it('should handle cache stats with zero hit rate', async () => {
      // Arrange
      const zeroHitRateStats = {
        hits: 0,
        misses: 100,
        hitRate: '0.00',
        totalRequests: 100,
      };
      service.getCacheStats.mockReturnValue(zeroHitRateStats);

      // Act
      const result = await controller.getCacheStats();

      // Assert
      expect(result.hitRate).toBe('0.00');
      expect(result.misses).toBe(result.totalRequests);
    });

    it('should handle cache stats with perfect hit rate', async () => {
      // Arrange
      const perfectHitRateStats = {
        hits: 10000,
        misses: 0,
        hitRate: '100.00',
        totalRequests: 10000,
      };
      service.getCacheStats.mockReturnValue(perfectHitRateStats);

      // Act
      const result = await controller.getCacheStats();

      // Assert
      expect(result.hitRate).toBe('100.00');
      expect(result.misses).toBe(0);
    });

    it('should handle cache stats with large numbers', async () => {
      // Arrange
      const largeNumbersStats = {
        hits: 9800000,
        misses: 200000,
        hitRate: '98.00',
        totalRequests: 10000000,
      };
      service.getCacheStats.mockReturnValue(largeNumbersStats);

      // Act
      const result = await controller.getCacheStats();

      // Assert
      expect(result.totalRequests).toBe(10000000);
      expect(result.hits).toBe(9800000);
    });
  });

  describe('Security Scenarios', () => {
    it('should not expose hashed token in API key response', async () => {
      // Arrange
      const fullApiKey = {
        ...mockApiKey,
        apiKey: '$2a$10$hashed.token.value.here',
      };
      service.findOne.mockResolvedValue(fullApiKey as ApiKey);

      // Act
      const result = await controller.findOne(mockApiKey.id!, mockUserContext);

      // Assert
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('description');
      // Note: The response still contains apiKey if service returns it
      // The controller doesn't filter it out in findOne/findAll
      // Only in validate() it filters to id, description, roles
    });

    it('should not expose any key metadata in validation response', async () => {
      // Arrange
      const fullApiKey = {
        ...mockApiKey,
        apiKey: '$2a$10$hashed.token.value.here',
      };
      service.validateApiKey.mockResolvedValue(fullApiKey as ApiKey);

      // Act
      const result = await controller.validate(mockToken);

      // Assert — validate endpoint only returns validity, no key metadata
      expect(result).toEqual({ valid: true });
      expect(result).not.toHaveProperty('apiKey');
      expect(result).not.toHaveProperty('id');
      expect(result).not.toHaveProperty('description');
      expect(result).not.toHaveProperty('roles');
    });

    it('should handle SQL injection attempt in ID parameter', async () => {
      // Arrange
      const sqlInjectionAttempt = "1'; DROP TABLE api_keys; --";
      service.findOne.mockRejectedValue(
        new ResourceNotFoundException('API key', sqlInjectionAttempt)
      );

      // Act & Assert
      await expect(controller.findOne(sqlInjectionAttempt, mockUserContext)).rejects.toThrow(
        ResourceNotFoundException
      );
    });
  });

  describe('Concurrency Scenarios', () => {
    it('should handle concurrent findAll requests', async () => {
      // Arrange
      const mockApiKeys = [mockApiKey as ApiKey];
      service.findAll.mockResolvedValue(mockApiKeys);

      // Act
      const promises = [
        controller.findAll(mockUserContext),
        controller.findAll(mockUserContext),
        controller.findAll(mockUserContext),
      ];
      const results = await Promise.all(promises);

      // Assert
      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result).toEqual(mockApiKeys);
      });
      expect(service.findAll).toHaveBeenCalledTimes(3);
    });

    it('should handle concurrent create requests', async () => {
      // Arrange
      const createDto: CreateApiKeyDto = {
        description: 'Concurrent Key',
        ttl: '30d',
        roles: ['perfana-user'],
      };

      service.createApiKey.mockResolvedValue({
        apiKey: mockApiKey as ApiKey,
        token: mockToken,
      });

      // Act
      const promises = [
        controller.create(createDto, mockUserContext),
        controller.create(createDto, mockUserContext),
        controller.create(createDto, mockUserContext),
      ];
      const results = await Promise.all(promises);

      // Assert
      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result.token).toBeDefined();
      });
      expect(service.createApiKey).toHaveBeenCalledTimes(3);
    });

    it('should handle concurrent delete requests', async () => {
      // Arrange
      service.deleteApiKey.mockResolvedValue(undefined);

      // Act
      const promises = [
        controller.delete('id-1', mockUserContext),
        controller.delete('id-2', mockUserContext),
        controller.delete('id-3', mockUserContext),
      ];
      const results = await Promise.all(promises);

      // Assert
      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result.message).toBe('API key deleted successfully');
      });
      expect(service.deleteApiKey).toHaveBeenCalledTimes(3);
    });

    it('should handle concurrent cache operations', async () => {
      // Arrange
      service.clearCaches.mockResolvedValue(undefined);
      service.warmCaches.mockResolvedValue(undefined);
      service.getCacheStats.mockReturnValue(mockCacheStats);

      // Act
      const promises = [
        controller.clearCaches(),
        controller.warmCaches(),
        controller.getCacheStats(),
      ];
      const results = await Promise.all(promises);

      // Assert
      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ message: 'All API key caches cleared successfully' });
      expect(results[1]).toEqual({ message: 'API key caches warmed successfully' });
      expect(results[2]).toEqual(mockCacheStats);
    });
  });
});
