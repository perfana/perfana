/**
 * ApiKeysService Test Suite
 *
 * Comprehensive tests for API key management service including:
 * - CRUD operations
 * - TTL parsing and validation
 * - Token generation and validation
 * - Cache integration
 * - Edge cases and security scenarios
 */

import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ApiKeysService } from './api-keys.service';
import { ApiKeyRepository } from '../../repositories/api-key.repository';
import { ApiKeyCacheService } from './api-key-cache.service';
import { ApiKeyLastUsedFlusherService } from './api-key-last-used-flusher.service';
import { ApiKey } from '../../entities';
import {
  ResourceNotFoundException,
  ValidationException,
  DatabaseException,
} from '../../common/exceptions/business.exception';
import { ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createAuthorizationServiceMock } from '../../../test/mocks/authorization-service.mock';
import { AuthorizationService } from '../../common/services/authorization.service';
import { AuditService } from '../audit/audit.service';

jest.mock('bcryptjs');

describe('ApiKeysService', () => {
  let service: ApiKeysService;
  let repository: jest.Mocked<ApiKeyRepository>;
  let cacheService: jest.Mocked<ApiKeyCacheService>;
  let auditService: jest.Mocked<AuditService>;
  let lastUsedFlusher: jest.Mocked<ApiKeyLastUsedFlusherService>;

  // Mock data factory
  const createMockApiKey = (overrides?: Partial<ApiKey>): ApiKey => ({
    id: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Test API Key',
    apiKey: 'hashed-token',
    validUntil: new Date('2099-12-31'),
    roles: [],
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    lastUsed: null,
    ...overrides,
  } as ApiKey);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        {
          provide: ApiKeyRepository,
          useValue: {
            findAll: jest.fn(),
            findById: jest.fn(),
            create: jest.fn(),
            delete: jest.fn(),
            updateLastUsed: jest.fn(),
            searchByDescription: jest.fn(),
            findByOrganizationAndDescription: jest.fn().mockResolvedValue(null),
            findRecentlyCreated: jest.fn(),
          },
        },
        {
          provide: ApiKeyCacheService,
          useValue: {
            getCachedKey: jest.fn(),
            cacheKey: jest.fn(),
            getCachedValidationResult: jest.fn(),
            cacheValidationResult: jest.fn(),
            invalidateKey: jest.fn(),
            invalidateAllValidationResults: jest.fn(),
            clearAllCaches: jest.fn(),
            warmCache: jest.fn(),
            getCacheStats: jest.fn(),
          },
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
        },
        {
          provide: ApiKeyLastUsedFlusherService,
          useValue: { record: jest.fn() },
        },
        {
          provide: DataSource,
          useValue: {
            createQueryRunner: jest.fn(),
            query: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ApiKeysService>(ApiKeysService);
    repository = module.get(ApiKeyRepository);
    cacheService = module.get(ApiKeyCacheService);
    auditService = module.get(AuditService);
    lastUsedFlusher = module.get(ApiKeyLastUsedFlusherService);

    // Default mock behaviors
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-token');
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all API keys sorted by creation date', async () => {
      // Arrange
      const mockApiKeys = [
        createMockApiKey({ id: '1', description: 'Test Key 1' }),
        createMockApiKey({ id: '2', description: 'Test Key 2' }),
      ];
      repository.findAll.mockResolvedValue(mockApiKeys);

      // Act
      const result = await service.findAll();

      // Assert
      expect(result).toEqual(mockApiKeys);
      expect(repository.findAll).toHaveBeenCalledWith({
        order: { createdAt: 'DESC' },
      });
    });

    it('should return empty array when no API keys exist', async () => {
      // Arrange
      repository.findAll.mockResolvedValue([]);

      // Act
      const result = await service.findAll();

      // Assert
      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });
  });

  describe('findOne', () => {
    it('should find API key by ID', async () => {
      // Arrange
      const mockApiKey = createMockApiKey();
      repository.findById.mockResolvedValue(mockApiKey);

      // Act
      const result = await service.findOne(mockApiKey.id);

      // Assert
      expect(result).toEqual(mockApiKey);
      expect(repository.findById).toHaveBeenCalledWith(mockApiKey.id);
    });

    it('should throw ResourceNotFoundException when API key not found', async () => {
      // Arrange
      const nonExistentId = 'non-existent-id';
      repository.findById.mockResolvedValue(null as any);

      // Act & Assert
      await expect(service.findOne(nonExistentId)).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should throw DatabaseException on database error', async () => {
      // Arrange
      repository.findById.mockRejectedValue(new Error('Database connection failed'));

      // Act & Assert
      await expect(service.findOne('some-id')).rejects.toThrow(DatabaseException);
    });
  });

  describe('createApiKey', () => {
    it('should create a new API key with valid TTL', async () => {
      // Arrange
      const createDto = {
        description: 'CI/CD Pipeline Key',
        ttl: '30d',
        roles: ['ci-cd'],
      };
      const mockCreatedKey = createMockApiKey({
        description: createDto.description,
        roles: createDto.roles,
      });

      repository.create.mockResolvedValue(mockCreatedKey);
      cacheService.cacheKey.mockResolvedValue(undefined);

      // Act
      const result = await service.createApiKey(createDto);

      // Assert
      expect(result.apiKey).toEqual(mockCreatedKey);
      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe('string');
      expect(repository.create).toHaveBeenCalled();
      expect(bcrypt.hash).toHaveBeenCalled();
      expect(cacheService.cacheKey).toHaveBeenCalledWith(mockCreatedKey);
    });

    it('should generate token in base64 format description#uuid', async () => {
      // Arrange
      const createDto = {
        description: 'Test Key',
        ttl: '1y',
      };
      const mockCreatedKey = createMockApiKey();
      repository.create.mockResolvedValue(mockCreatedKey);
      cacheService.cacheKey.mockResolvedValue(undefined);

      // Act
      const result = await service.createApiKey(createDto);

      // Assert
      expect(result.token).toBeDefined();
      // Decode token to verify format
      const decoded = Buffer.from(result.token, 'base64').toString('utf-8');
      expect(decoded).toMatch(/^Test Key#[a-f0-9-]{36}$/);
    });

    it('should default to empty roles when not provided', async () => {
      // Arrange
      const createDto = {
        description: 'No Roles Key',
        ttl: '30d',
      };
      const mockCreatedKey = createMockApiKey({ roles: [] });
      repository.create.mockResolvedValue(mockCreatedKey);
      cacheService.cacheKey.mockResolvedValue(undefined);

      // Act
      const result = await service.createApiKey(createDto);

      // Assert
      expect(result.apiKey.roles).toEqual([]);
    });

    it('should parse TTL correctly for days', async () => {
      // Arrange
      const createDto = { description: 'Test', ttl: '30d' };
      repository.create.mockResolvedValue(createMockApiKey());
      cacheService.cacheKey.mockResolvedValue(undefined);

      // Act
      await service.createApiKey(createDto);

      // Assert
      const createCall = repository.create.mock.calls[0]?.[0];
      expect(createCall).toBeDefined();
      expect(createCall?.validUntil).toBeInstanceOf(Date);
      if (createCall?.validUntil) {
        const daysAdded = Math.floor(
          ((createCall.validUntil as Date).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
        );
        expect(daysAdded).toBeGreaterThanOrEqual(29); // Allow for timing variance
        expect(daysAdded).toBeLessThanOrEqual(31);
      }
    });

    it('should parse TTL correctly for weeks', async () => {
      // Arrange
      const createDto = { description: 'Test', ttl: '4w' };
      repository.create.mockResolvedValue(createMockApiKey());
      cacheService.cacheKey.mockResolvedValue(undefined);

      // Act
      await service.createApiKey(createDto);

      // Assert
      const createCall = repository.create.mock.calls[0]?.[0];
      expect(createCall).toBeDefined();
      expect(createCall?.validUntil).toBeInstanceOf(Date);
      if (createCall?.validUntil) {
        const daysAdded = Math.floor(
          ((createCall.validUntil as Date).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
        );
        expect(daysAdded).toBeGreaterThanOrEqual(27); // 4 weeks = 28 days
        expect(daysAdded).toBeLessThanOrEqual(29);
      }
    });

    it('should parse TTL correctly for months', async () => {
      // Arrange
      const now = new Date();
      const createDto = { description: 'Test', ttl: '6M' };
      repository.create.mockResolvedValue(createMockApiKey());
      cacheService.cacheKey.mockResolvedValue(undefined);

      // Act
      await service.createApiKey(createDto);

      // Assert — use a captured `now` to avoid month-boundary drift between service and assertion
      const createCall = repository.create.mock.calls[0]?.[0];
      expect(createCall).toBeDefined();
      expect(createCall?.validUntil).toBeInstanceOf(Date);
      if (createCall?.validUntil) {
        const validUntil = createCall.validUntil as Date;
        const diffMs = validUntil.getTime() - now.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        // 6 months is roughly 180-184 days; allow a generous range
        expect(diffDays).toBeGreaterThanOrEqual(178);
        expect(diffDays).toBeLessThanOrEqual(186);
      }
    });

    it('should parse TTL correctly for years', async () => {
      // Arrange
      const createDto = { description: 'Test', ttl: '1y' };
      repository.create.mockResolvedValue(createMockApiKey());
      cacheService.cacheKey.mockResolvedValue(undefined);

      // Act
      await service.createApiKey(createDto);

      // Assert
      const createCall = repository.create.mock.calls[0]?.[0];
      expect(createCall).toBeDefined();
      expect(createCall?.validUntil).toBeInstanceOf(Date);
      if (createCall?.validUntil) {
        const yearsAdded =
          (createCall.validUntil as Date).getFullYear() - new Date().getFullYear();
        expect(yearsAdded).toBe(1);
      }
    });

    it('should throw ValidationException for invalid TTL format', async () => {
      // Arrange
      const createDto = { description: 'Test', ttl: 'invalid' };

      // Act & Assert
      await expect(service.createApiKey(createDto)).rejects.toThrow(ValidationException);
      await expect(service.createApiKey(createDto)).rejects.toThrow(
        'Invalid TTL format',
      );
    });

    it('should throw ValidationException for TTL with invalid unit', async () => {
      // Arrange
      const createDto = { description: 'Test', ttl: '30x' };

      // Act & Assert
      await expect(service.createApiKey(createDto)).rejects.toThrow(ValidationException);
    });

    it('should throw ValidationException for TTL without number', async () => {
      // Arrange
      const createDto = { description: 'Test', ttl: 'd' };

      // Act & Assert
      await expect(service.createApiKey(createDto)).rejects.toThrow(ValidationException);
    });

    it('should handle database creation failure', async () => {
      // Arrange
      const createDto = { description: 'Test', ttl: '30d' };
      repository.create.mockResolvedValue(null as any);

      // Act & Assert
      await expect(service.createApiKey(createDto)).rejects.toThrow(DatabaseException);
    });

    it('should throw ConflictException when description already exists in the same organization', async () => {
      // Arrange — issue #117: a duplicate description in the same org used to
      // surface as a 500 from the global UNIQUE(description) constraint.
      const createDto = { description: 'CI', ttl: '30d' };
      const existing = createMockApiKey({ description: 'CI' });
      repository.findByOrganizationAndDescription.mockResolvedValue(existing);

      // Act & Assert
      await expect(service.createApiKey(createDto)).rejects.toThrow(ConflictException);
      await expect(service.createApiKey(createDto)).rejects.toThrow(
        /already exists in this organization/,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should translate a 23505 unique-violation race into a ConflictException', async () => {
      // Arrange — pre-check passes (returns null), but a concurrent request
      // wins the INSERT race and the DB raises the unique-violation.
      const createDto = { description: 'CI', ttl: '30d' };
      repository.findByOrganizationAndDescription.mockResolvedValue(null);
      const dbError = Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'api_keys_organization_id_description_key',
      });
      repository.create.mockRejectedValue(dbError);

      // Act & Assert
      await expect(service.createApiKey(createDto)).rejects.toThrow(ConflictException);
    });

    it('should translate a 23505 race even when wrapped as TypeORM driverError', async () => {
      // Arrange — TypeORM's QueryFailedError can hoist the pg fields, but on
      // some driver/version combos `code`/`constraint` only live on
      // `driverError`. The translator must check both shapes so it never
      // silently falls through to a 500.
      const createDto = { description: 'CI', ttl: '30d' };
      repository.findByOrganizationAndDescription.mockResolvedValue(null);
      const wrapped = Object.assign(new Error('QueryFailedError: duplicate key'), {
        driverError: {
          code: '23505',
          constraint: 'api_keys_organization_id_description_key',
        },
      });
      repository.create.mockRejectedValue(wrapped);

      // Act & Assert
      await expect(service.createApiKey(createDto)).rejects.toThrow(ConflictException);
    });
  });

  describe('deleteApiKey', () => {
    it('should delete API key successfully', async () => {
      // Arrange
      const mockApiKey = createMockApiKey();
      repository.findById.mockResolvedValue(mockApiKey);
      repository.delete.mockResolvedValue(undefined);
      cacheService.invalidateKey.mockResolvedValue(undefined);
      cacheService.invalidateAllValidationResults.mockResolvedValue(undefined);

      // Act
      await service.deleteApiKey(mockApiKey.id);

      // Assert
      expect(repository.findById).toHaveBeenCalledWith(mockApiKey.id);
      expect(repository.delete).toHaveBeenCalledWith(mockApiKey.id);
      expect(cacheService.invalidateKey).toHaveBeenCalledWith(mockApiKey.description);
      expect(cacheService.invalidateAllValidationResults).toHaveBeenCalled();
    });

    it('should throw ResourceNotFoundException when API key not found', async () => {
      // Arrange
      const nonExistentId = 'non-existent';
      repository.findById.mockResolvedValue(null as any);

      // Act & Assert
      await expect(service.deleteApiKey(nonExistentId)).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should invalidate cache before deletion', async () => {
      // Arrange
      const mockApiKey = createMockApiKey();
      repository.findById.mockResolvedValue(mockApiKey);
      repository.delete.mockResolvedValue(undefined);
      cacheService.invalidateKey.mockResolvedValue(undefined);
      cacheService.invalidateAllValidationResults.mockResolvedValue(undefined);

      // Act
      await service.deleteApiKey(mockApiKey.id);

      // Assert
      // Verify invalidateKey was called
      expect(cacheService.invalidateKey).toHaveBeenCalledWith(mockApiKey.description);
      expect(repository.delete).toHaveBeenCalledWith(mockApiKey.id);
    });
  });

  describe('validateApiKey', () => {
    it('should return null for JWT-like tokens (contains dots)', async () => {
      // Arrange
      const jwtToken =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

      // Act
      const result = await service.validateApiKey(jwtToken);

      // Assert
      expect(result).toBe(null);
      expect(repository.searchByDescription).not.toHaveBeenCalled();
    });

    it('should return null for short tokens', async () => {
      // Arrange
      const shortToken = 'short';

      // Act
      const result = await service.validateApiKey(shortToken);

      // Assert
      expect(result).toBe(null);
    });

    it('should validate correct API key with cache miss', async () => {
      // Arrange
      const token = Buffer.from('Test Key#uuid-123').toString('base64');
      const mockApiKey = createMockApiKey({ description: 'Test Key' });

      cacheService.getCachedValidationResult.mockResolvedValue(null);
      cacheService.getCachedKey.mockResolvedValue(null);
      repository.searchByDescription.mockResolvedValue([mockApiKey]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      cacheService.cacheKey.mockResolvedValue(undefined);
      cacheService.cacheValidationResult.mockResolvedValue(undefined);

      // Act
      const result = await service.validateApiKey(token);

      // Assert
      expect(result).toBe(mockApiKey);
      expect(cacheService.cacheKey).toHaveBeenCalledWith(mockApiKey);
      expect(cacheService.cacheValidationResult).toHaveBeenCalledWith(token, true);
      expect(lastUsedFlusher.record).toHaveBeenCalledWith(mockApiKey.id);
    });

    it('should validate API key using cache hit', async () => {
      // Arrange
      const token = Buffer.from('Cached Key#uuid-456').toString('base64');
      const mockApiKey = createMockApiKey({ description: 'Cached Key' });

      cacheService.getCachedValidationResult.mockResolvedValue(null);
      cacheService.getCachedKey.mockResolvedValue(mockApiKey);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      repository.updateLastUsed.mockResolvedValue(undefined);
      cacheService.cacheValidationResult.mockResolvedValue(undefined);

      // Act
      const result = await service.validateApiKey(token);

      // Assert
      expect(result).toBe(mockApiKey);
      expect(repository.searchByDescription).not.toHaveBeenCalled(); // Cache hit
      expect(cacheService.cacheValidationResult).toHaveBeenCalledWith(token, true);
    });

    it('should use cached validation result when available', async () => {
      // Arrange
      const token = Buffer.from('Test Key#uuid').toString('base64');

      cacheService.getCachedValidationResult.mockResolvedValue(false);

      // Act
      const result = await service.validateApiKey(token);

      // Assert
      expect(result).toBe(null);
      expect(cacheService.getCachedKey).not.toHaveBeenCalled();
      expect(repository.searchByDescription).not.toHaveBeenCalled();
    });

    it('should return null for invalid API key', async () => {
      // Arrange
      const token = Buffer.from('Test Key#uuid-123').toString('base64');
      const mockApiKey = createMockApiKey({ description: 'Test Key' });

      cacheService.getCachedValidationResult.mockResolvedValue(null);
      cacheService.getCachedKey.mockResolvedValue(null);
      repository.searchByDescription.mockResolvedValue([mockApiKey]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      cacheService.cacheValidationResult.mockResolvedValue(undefined);

      // Act
      const result = await service.validateApiKey(token);

      // Assert
      expect(result).toBe(null);
      expect(cacheService.cacheValidationResult).toHaveBeenCalledWith(
        token,
        false,
        300,
      );
    });

    it('should return null for expired API key', async () => {
      // Arrange
      const token = Buffer.from('Expired Key#uuid-123').toString('base64');
      const expiredDate = new Date('2020-01-01'); // Past date
      const mockApiKey = createMockApiKey({
        description: 'Expired Key',
        validUntil: expiredDate,
      });

      cacheService.getCachedValidationResult.mockResolvedValue(null);
      cacheService.getCachedKey.mockResolvedValue(null);
      repository.searchByDescription.mockResolvedValue([mockApiKey]);
      cacheService.cacheValidationResult.mockResolvedValue(undefined);

      // Act
      const result = await service.validateApiKey(token);

      // Assert
      expect(result).toBe(null);
      expect(bcrypt.compare).not.toHaveBeenCalled(); // Expiration checked before bcrypt
      expect(cacheService.cacheValidationResult).toHaveBeenCalledWith(
        token,
        false,
        300,
      );
    });

    it('should return null when API key not found in database', async () => {
      // Arrange
      const token = Buffer.from('Unknown Key#uuid-123').toString('base64');

      cacheService.getCachedValidationResult.mockResolvedValue(null);
      cacheService.getCachedKey.mockResolvedValue(null);
      repository.searchByDescription.mockResolvedValue([]);
      cacheService.cacheValidationResult.mockResolvedValue(undefined);

      // Act
      const result = await service.validateApiKey(token);

      // Assert
      expect(result).toBe(null);
      expect(cacheService.cacheValidationResult).toHaveBeenCalledWith(
        token,
        false,
        300,
      );
    });

    it('should return null for malformed base64 tokens', async () => {
      // Arrange
      const malformedToken = 'not-valid-base64!@#$';

      // Act
      const result = await service.validateApiKey(malformedToken);

      // Assert
      expect(result).toBe(null);
    });

    it('should return null for tokens with invalid description characters', async () => {
      // Arrange
      const invalidToken = Buffer.from('\x00\x01\x02#uuid').toString('base64');

      // Act
      const result = await service.validateApiKey(invalidToken);

      // Assert
      expect(result).toBe(null);
    });

    it('should return null for tokens with too short description', async () => {
      // Arrange
      const invalidToken = Buffer.from('AB#uuid').toString('base64');

      // Act
      const result = await service.validateApiKey(invalidToken);

      // Assert
      expect(result).toBe(null);
    });

    it('should handle validation errors gracefully', async () => {
      // Arrange
      const token = Buffer.from('Test Key#uuid').toString('base64');

      cacheService.getCachedValidationResult.mockRejectedValue(
        new Error('Redis error'),
      );

      // Act
      const result = await service.validateApiKey(token);

      // Assert
      expect(result).toBe(null);
    });

    it('should record lastUsed via flusher on successful validation', async () => {
      // Arrange
      const token = Buffer.from('Test Key#uuid').toString('base64');
      const mockApiKey = createMockApiKey({ description: 'Test Key' });

      cacheService.getCachedValidationResult.mockResolvedValue(null);
      cacheService.getCachedKey.mockResolvedValue(mockApiKey);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      cacheService.cacheValidationResult.mockResolvedValue(undefined);

      // Act
      await service.validateApiKey(token);

      // Assert - flusher.record is synchronous, no async gap needed
      expect(lastUsedFlusher.record).toHaveBeenCalledWith(mockApiKey.id);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', () => {
      // Arrange
      const mockStats = {
        hits: 100,
        misses: 20,
        hitRate: '83.33%',
        totalRequests: 120,
      };
      cacheService.getCacheStats.mockReturnValue(mockStats);

      // Act
      const result = service.getCacheStats();

      // Assert
      expect(result).toEqual(mockStats);
      expect(cacheService.getCacheStats).toHaveBeenCalled();
    });
  });

  describe('clearCaches', () => {
    it('should clear all caches', async () => {
      // Arrange
      cacheService.clearAllCaches.mockResolvedValue(undefined);

      // Act
      await service.clearCaches();

      // Assert
      expect(cacheService.clearAllCaches).toHaveBeenCalled();
    });
  });

  describe('warmCaches', () => {
    it('should warm caches with recently used API keys', async () => {
      // Arrange
      const recentKeys = [
        createMockApiKey({ id: '1', description: 'Recent 1' }),
        createMockApiKey({ id: '2', description: 'Recent 2' }),
      ];
      repository.findRecentlyCreated.mockResolvedValue(recentKeys);
      cacheService.warmCache.mockResolvedValue(undefined);

      // Act
      await service.warmCaches();

      // Assert
      expect(repository.findRecentlyCreated).toHaveBeenCalledWith(30);
      expect(cacheService.warmCache).toHaveBeenCalledWith(recentKeys);
    });

    it('should handle no recent keys gracefully', async () => {
      // Arrange
      repository.findRecentlyCreated.mockResolvedValue([]);

      // Act
      await service.warmCaches();

      // Assert
      expect(cacheService.warmCache).not.toHaveBeenCalled();
    });

    it('should handle warm cache errors gracefully', async () => {
      // Arrange
      repository.findRecentlyCreated.mockRejectedValue(new Error('DB error'));

      // Act
      await service.warmCaches();

      // Assert - Should not throw
      expect(cacheService.warmCache).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle concurrent validations of the same token', async () => {
      // Arrange
      const token = Buffer.from('Test Key#uuid').toString('base64');
      const mockApiKey = createMockApiKey({ description: 'Test Key' });

      cacheService.getCachedValidationResult.mockResolvedValue(null);
      cacheService.getCachedKey.mockResolvedValue(mockApiKey);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      repository.updateLastUsed.mockResolvedValue(undefined);
      cacheService.cacheValidationResult.mockResolvedValue(undefined);

      // Act
      const results = await Promise.all([
        service.validateApiKey(token),
        service.validateApiKey(token),
        service.validateApiKey(token),
      ]);

      // Assert
      expect(results).toHaveLength(3);
      results.forEach((result) => expect(result).toEqual(mockApiKey));
    });

    it('should handle null API key description gracefully', async () => {
      // Arrange
      const token = Buffer.from('#uuid-only').toString('base64');

      // Act
      const result = await service.validateApiKey(token);

      // Assert
      expect(result).toBe(null);
    });

    it('should handle updateLastUsed errors without affecting validation', async () => {
      // Arrange
      const token = Buffer.from('Test Key#uuid').toString('base64');
      const mockApiKey = createMockApiKey({ description: 'Test Key' });

      cacheService.getCachedValidationResult.mockResolvedValue(null);
      cacheService.getCachedKey.mockResolvedValue(mockApiKey);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      repository.updateLastUsed.mockRejectedValue(new Error('Update failed'));
      cacheService.cacheValidationResult.mockResolvedValue(undefined);

      // Act
      const result = await service.validateApiKey(token);

      // Assert - Should still return valid key despite update failure
      expect(result).toEqual(mockApiKey);
    });

    it('should log warning when updateLastUsed fails with non-Error object', async () => {
      // Arrange
      const token = Buffer.from('Test Key#uuid').toString('base64');
      const mockApiKey = createMockApiKey({ description: 'Test Key' });

      cacheService.getCachedValidationResult.mockResolvedValue(null);
      cacheService.getCachedKey.mockResolvedValue(mockApiKey);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      // Mock updateLastUsed to reject with non-Error object
      repository.updateLastUsed.mockRejectedValue('String error');
      cacheService.cacheValidationResult.mockResolvedValue(undefined);

      // Act
      const result = await service.validateApiKey(token);

      // Assert - Should still return valid key and handle unknown error type
      await new Promise((resolve) => setTimeout(resolve, 20)); // Allow async to complete
      expect(result).toEqual(mockApiKey);
    });
  });

  describe('Security and Validation Edge Cases', () => {
    it('should handle extremely long description strings', async () => {
      // Arrange
      const longDescription = 'A'.repeat(1000);
      const createDto = { description: longDescription, ttl: '30d' };
      const mockCreatedKey = createMockApiKey({ description: longDescription });
      repository.create.mockResolvedValue(mockCreatedKey);
      cacheService.cacheKey.mockResolvedValue(undefined);

      // Act
      const result = await service.createApiKey(createDto);

      // Assert
      expect(result.apiKey.description).toBe(longDescription);
      expect(result.token).toBeDefined();
    });

    it('should handle special characters in description', async () => {
      // Arrange
      const specialDescription = "Test <>&\"'#@!$%^&*()";
      const createDto = { description: specialDescription, ttl: '1y' };
      const mockCreatedKey = createMockApiKey({ description: specialDescription });
      repository.create.mockResolvedValue(mockCreatedKey);
      cacheService.cacheKey.mockResolvedValue(undefined);

      // Act
      const result = await service.createApiKey(createDto);

      // Assert
      expect(result.apiKey.description).toBe(specialDescription);
    });

    it('should validate token with exact expiration time boundary (expired)', async () => {
      // Arrange
      const now = new Date();
      const token = Buffer.from('Boundary Key#uuid').toString('base64');
      const mockApiKey = createMockApiKey({
        description: 'Boundary Key',
        validUntil: now, // Exactly at boundary
      });

      cacheService.getCachedValidationResult.mockResolvedValue(null);
      cacheService.getCachedKey.mockResolvedValue(mockApiKey);
      // After issue #117 fix, an expired cached key triggers a DB fallback
      // scan. The DB returns the same expired row, which is also skipped, so
      // no candidate matches and the negative result is cached.
      repository.searchByDescription.mockResolvedValue([mockApiKey]);
      cacheService.cacheValidationResult.mockResolvedValue(undefined);

      // Act
      const result = await service.validateApiKey(token);

      // Assert
      expect(result).toBe(null);
      expect(cacheService.cacheValidationResult).toHaveBeenCalledWith(token, false, 300);
    });

    it('should validate token with expiration in near future (valid)', async () => {
      // Arrange - Use 10 seconds in future to avoid race condition
      const futureDate = new Date(Date.now() + 10000);
      const token = Buffer.from('Future Key#uuid').toString('base64');
      const mockApiKey = createMockApiKey({
        description: 'Future Key',
        validUntil: futureDate,
      });

      cacheService.getCachedValidationResult.mockResolvedValue(null);
      cacheService.getCachedKey.mockResolvedValue(mockApiKey);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      repository.updateLastUsed.mockResolvedValue(undefined);
      cacheService.cacheValidationResult.mockResolvedValue(undefined);

      // Act
      const result = await service.validateApiKey(token);

      // Assert
      expect(result).toBe(mockApiKey);
    });

    it('should handle tokens with unicode characters in description', async () => {
      // Arrange
      const unicodeDescription = 'Test 你好 мир 🔑 émojis';
      const token = Buffer.from(`${unicodeDescription}#uuid-123`).toString('base64');
      const mockApiKey = createMockApiKey({ description: unicodeDescription });

      cacheService.getCachedValidationResult.mockResolvedValue(null);
      cacheService.getCachedKey.mockResolvedValue(null);
      repository.searchByDescription.mockResolvedValue([mockApiKey]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      repository.updateLastUsed.mockResolvedValue(undefined);
      cacheService.cacheKey.mockResolvedValue(undefined);
      cacheService.cacheValidationResult.mockResolvedValue(undefined);

      // Act
      const result = await service.validateApiKey(token);

      // Assert
      expect(result).toBe(mockApiKey);
    });

    it('should handle empty string description (should be rejected)', async () => {
      // Arrange
      const token = Buffer.from('#uuid-only').toString('base64');

      // Act
      const result = await service.validateApiKey(token);

      // Assert
      expect(result).toBe(null);
    });

    it('should handle whitespace-only description', async () => {
      // Arrange
      const token = Buffer.from('   #uuid').toString('base64');

      // Act
      const result = await service.validateApiKey(token);

      // Assert
      expect(result).toBe(null);
    });

    it('should handle tab character in description', async () => {
      // Arrange
      const tabDescription = 'Test\tKey';
      const token = Buffer.from(`${tabDescription}#uuid`).toString('base64');
      const mockApiKey = createMockApiKey({ description: tabDescription });

      cacheService.getCachedValidationResult.mockResolvedValue(null);
      cacheService.getCachedKey.mockResolvedValue(null);
      repository.searchByDescription.mockResolvedValue([mockApiKey]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      repository.updateLastUsed.mockResolvedValue(undefined);
      cacheService.cacheKey.mockResolvedValue(undefined);
      cacheService.cacheValidationResult.mockResolvedValue(undefined);

      // Act
      const result = await service.validateApiKey(token);

      // Assert
      expect(result).toBe(mockApiKey);
    });

    it('should handle newline character in description', async () => {
      // Arrange
      const newlineDescription = 'Test\nKey';
      const token = Buffer.from(`${newlineDescription}#uuid`).toString('base64');
      const mockApiKey = createMockApiKey({ description: newlineDescription });

      cacheService.getCachedValidationResult.mockResolvedValue(null);
      cacheService.getCachedKey.mockResolvedValue(null);
      repository.searchByDescription.mockResolvedValue([mockApiKey]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      repository.updateLastUsed.mockResolvedValue(undefined);
      cacheService.cacheKey.mockResolvedValue(undefined);
      cacheService.cacheValidationResult.mockResolvedValue(undefined);

      // Act
      const result = await service.validateApiKey(token);

      // Assert
      expect(result).toBe(mockApiKey);
    });
  });

  describe('TTL Parsing Edge Cases', () => {
    it('should handle TTL with zero days (invalid)', async () => {
      // Arrange
      const createDto = { description: 'Test', ttl: '0d' };

      // Act & Assert - Should succeed but expiration will be immediate
      repository.create.mockResolvedValue(createMockApiKey());
      cacheService.cacheKey.mockResolvedValue(undefined);
      await service.createApiKey(createDto);

      const createCall = repository.create.mock.calls[0]?.[0];
      expect(createCall?.validUntil).toBeInstanceOf(Date);
    });

    it('should handle TTL with large numbers (999 years)', async () => {
      // Arrange
      const createDto = { description: 'Test', ttl: '999y' };
      repository.create.mockResolvedValue(createMockApiKey());
      cacheService.cacheKey.mockResolvedValue(undefined);

      // Act
      await service.createApiKey(createDto);

      // Assert
      const createCall = repository.create.mock.calls[0]?.[0];
      expect(createCall?.validUntil).toBeInstanceOf(Date);
      if (createCall?.validUntil) {
        const yearsAdded =
          (createCall.validUntil as Date).getFullYear() - new Date().getFullYear();
        expect(yearsAdded).toBe(999);
      }
    });

    it('should reject TTL with lowercase month unit (m instead of M)', async () => {
      // Arrange
      const createDto = { description: 'Test', ttl: '6m' };

      // Act & Assert
      await expect(service.createApiKey(createDto)).rejects.toThrow(ValidationException);
    });

    it('should reject TTL with multiple units', async () => {
      // Arrange
      const createDto = { description: 'Test', ttl: '1y6M' };

      // Act & Assert
      await expect(service.createApiKey(createDto)).rejects.toThrow(ValidationException);
    });

    it('should reject TTL with spaces', async () => {
      // Arrange
      const createDto = { description: 'Test', ttl: '30 d' };

      // Act & Assert
      await expect(service.createApiKey(createDto)).rejects.toThrow(ValidationException);
    });

    it('should reject TTL with negative numbers', async () => {
      // Arrange
      const createDto = { description: 'Test', ttl: '-30d' };

      // Act & Assert
      await expect(service.createApiKey(createDto)).rejects.toThrow(ValidationException);
    });
  });

  describe('Cache Integration Scenarios', () => {
    it('should cache validation result on successful validation', async () => {
      // Arrange
      const token = Buffer.from('Test Key#uuid').toString('base64');
      const mockApiKey = createMockApiKey({ description: 'Test Key' });

      cacheService.getCachedValidationResult.mockResolvedValue(null);
      cacheService.getCachedKey.mockResolvedValue(mockApiKey);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      repository.updateLastUsed.mockResolvedValue(undefined);
      cacheService.cacheValidationResult.mockResolvedValue(undefined);

      // Act
      await service.validateApiKey(token);

      // Assert
      expect(cacheService.cacheValidationResult).toHaveBeenCalledWith(token, true);
    });

    it('should cache negative validation result for invalid token', async () => {
      // Arrange
      const token = Buffer.from('Test Key#uuid-123').toString('base64');
      const mockApiKey = createMockApiKey({ description: 'Test Key' });

      cacheService.getCachedValidationResult.mockResolvedValue(null);
      cacheService.getCachedKey.mockResolvedValue(mockApiKey);
      // After issue #117 fix, a cache hit with bcrypt mismatch falls through
      // to a DB scan over every same-description candidate. The DB returns
      // the same row, bcrypt fails again, no candidate matches → cache false.
      repository.searchByDescription.mockResolvedValue([mockApiKey]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      cacheService.cacheValidationResult.mockResolvedValue(undefined);

      // Act
      await service.validateApiKey(token);

      // Assert
      expect(cacheService.cacheValidationResult).toHaveBeenCalledWith(token, false, 300);
    });

    it('should cache API key from database on cache miss', async () => {
      // Arrange
      const token = Buffer.from('Test Key#uuid').toString('base64');
      const mockApiKey = createMockApiKey({ description: 'Test Key' });

      cacheService.getCachedValidationResult.mockResolvedValue(null);
      cacheService.getCachedKey.mockResolvedValue(null); // Cache miss
      repository.searchByDescription.mockResolvedValue([mockApiKey]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      repository.updateLastUsed.mockResolvedValue(undefined);
      cacheService.cacheKey.mockResolvedValue(undefined);
      cacheService.cacheValidationResult.mockResolvedValue(undefined);

      // Act
      await service.validateApiKey(token);

      // Assert
      expect(cacheService.cacheKey).toHaveBeenCalledWith(mockApiKey);
    });

    it('should handle cache service errors gracefully during validation', async () => {
      // Arrange
      const token = Buffer.from('Test Key#uuid').toString('base64');

      cacheService.getCachedValidationResult.mockRejectedValue(new Error('Cache error'));

      // Act
      const result = await service.validateApiKey(token);

      // Assert
      expect(result).toBe(null);
    });

    it('should invalidate both key and validation caches on delete', async () => {
      // Arrange
      const mockApiKey = createMockApiKey({ description: 'Test Key' });
      repository.findById.mockResolvedValue(mockApiKey);
      repository.delete.mockResolvedValue(undefined);
      cacheService.invalidateKey.mockResolvedValue(undefined);
      cacheService.invalidateAllValidationResults.mockResolvedValue(undefined);

      // Act
      await service.deleteApiKey(mockApiKey.id);

      // Assert
      expect(cacheService.invalidateKey).toHaveBeenCalledWith(mockApiKey.description);
      expect(cacheService.invalidateAllValidationResults).toHaveBeenCalled();
    });
  });

  describe('Database Error Handling', () => {
    it('should handle repository errors during creation', async () => {
      // Arrange
      const createDto = { description: 'Test', ttl: '30d' };
      repository.create.mockRejectedValue(new Error('Database constraint violation'));

      // Act & Assert
      await expect(service.createApiKey(createDto)).rejects.toThrow('Database constraint violation');
    });

    it('should handle repository errors during deletion', async () => {
      // Arrange
      const mockApiKey = createMockApiKey();
      repository.findById.mockResolvedValue(mockApiKey);
      repository.delete.mockRejectedValue(new Error('Foreign key constraint'));
      cacheService.invalidateKey.mockResolvedValue(undefined);
      cacheService.invalidateAllValidationResults.mockResolvedValue(undefined);

      // Act & Assert
      await expect(service.deleteApiKey(mockApiKey.id)).rejects.toThrow('Foreign key constraint');
    });

    it('should rethrow ResourceNotFoundException from findById in findOne', async () => {
      // Arrange
      repository.findById.mockRejectedValue(new ResourceNotFoundException('API key', 'id'));

      // Act & Assert
      await expect(service.findOne('id')).rejects.toThrow(ResourceNotFoundException);
    });
  });

  describe('Role Handling', () => {
    it('should create API key with multiple roles', async () => {
      // Arrange
      const createDto = {
        description: 'Admin Key',
        ttl: '1y',
        roles: ['admin', 'user', 'ci-cd'],
      };
      const mockCreatedKey = createMockApiKey({ roles: createDto.roles });
      repository.create.mockResolvedValue(mockCreatedKey);
      cacheService.cacheKey.mockResolvedValue(undefined);

      // Act
      const result = await service.createApiKey(createDto);

      // Assert
      expect(result.apiKey.roles).toEqual(['admin', 'user', 'ci-cd']);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ roles: createDto.roles }),
      );
    });

    it('should create API key with empty roles array when roles is empty', async () => {
      // Arrange
      const createDto = {
        description: 'No Roles',
        ttl: '30d',
        roles: [],
      };
      const mockCreatedKey = createMockApiKey({ roles: [] });
      repository.create.mockResolvedValue(mockCreatedKey);
      cacheService.cacheKey.mockResolvedValue(undefined);

      // Act
      const result = await service.createApiKey(createDto);

      // Assert
      expect(result.apiKey.roles).toEqual([]);
    });
  });

  describe('audit logging (Phase 5a)', () => {
    it('logs CREATE after a successful createApiKey', async () => {
      // Arrange
      const createDto = { description: 'Audit Test Key', ttl: '30d', roles: ['ci-cd'] };
      const mockCreatedKey = createMockApiKey({
        description: createDto.description,
        roles: createDto.roles,
      });
      repository.create.mockResolvedValue(mockCreatedKey);
      cacheService.cacheKey.mockResolvedValue(undefined);

      // Act
      await service.createApiKey(createDto);

      // Assert — log fires with the persisted entity (post-save shape)
      expect(auditService.logCreate).toHaveBeenCalledTimes(1);
      expect(auditService.logCreate).toHaveBeenCalledWith(mockCreatedKey);
      expect(auditService.logDelete).not.toHaveBeenCalled();
    });

    it('does NOT log CREATE if the create path throws before persisting', async () => {
      // Arrange — duplicate-description pre-check trips a ConflictException
      // before repo.create is called, so no audit row should be emitted.
      const createDto = { description: 'CI', ttl: '30d' };
      repository.findByOrganizationAndDescription.mockResolvedValue(
        createMockApiKey({ description: 'CI' }),
      );

      // Act
      await expect(service.createApiKey(createDto)).rejects.toThrow(ConflictException);

      // Assert
      expect(auditService.logCreate).not.toHaveBeenCalled();
    });

    it('logs DELETE before the row is removed', async () => {
      // Arrange
      const mockApiKey = createMockApiKey();
      repository.findById.mockResolvedValue(mockApiKey);
      repository.delete.mockResolvedValue(undefined);
      cacheService.invalidateKey.mockResolvedValue(undefined);
      cacheService.invalidateAllValidationResults.mockResolvedValue(undefined);

      // Act
      await service.deleteApiKey(mockApiKey.id);

      // Assert — logDelete must run BEFORE repo.delete so the entity is still
      // available for the audit envelope.
      expect(auditService.logDelete).toHaveBeenCalledTimes(1);
      expect(auditService.logDelete).toHaveBeenCalledWith(mockApiKey);

      const logDeleteOrder = (auditService.logDelete as jest.Mock).mock.invocationCallOrder[0];
      const repoDeleteOrder = (repository.delete as jest.Mock).mock.invocationCallOrder[0];
      expect(logDeleteOrder).toBeLessThan(repoDeleteOrder);
      expect(auditService.logCreate).not.toHaveBeenCalled();
    });

    it('does NOT log DELETE when the key is not found', async () => {
      // Arrange
      repository.findById.mockResolvedValue(null as any);

      // Act
      await expect(service.deleteApiKey('missing-id')).rejects.toThrow(
        ResourceNotFoundException,
      );

      // Assert
      expect(auditService.logDelete).not.toHaveBeenCalled();
    });
  });

  describe('searchByDescription in validateApiKey', () => {
    it('should find matching API key when multiple keys exist', async () => {
      // Arrange
      const token = Buffer.from('Production Key#uuid-123').toString('base64');
      const mockApiKey1 = createMockApiKey({ id: '1', description: 'Production Key' });
      const mockApiKey2 = createMockApiKey({ id: '2', description: 'Production Key 2' });

      cacheService.getCachedValidationResult.mockResolvedValue(null);
      cacheService.getCachedKey.mockResolvedValue(null);
      repository.searchByDescription.mockResolvedValue([mockApiKey1, mockApiKey2]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      repository.updateLastUsed.mockResolvedValue(undefined);
      cacheService.cacheKey.mockResolvedValue(undefined);
      cacheService.cacheValidationResult.mockResolvedValue(undefined);

      // Act
      const result = await service.validateApiKey(token);

      // Assert
      expect(result).toBe(mockApiKey1);
      expect(repository.searchByDescription).toHaveBeenCalledWith('Production Key');
    });

    it('should pick the right key when two organizations share a description (issue #117 regression)', async () => {
      // Arrange — descriptions are now unique per ORG, not globally. Two orgs
      // can both have an API key called "CI". validateApiKey decodes only the
      // description from the token, so it must scan ALL candidates and bcrypt-
      // compare each, not just take the first row from the DB.
      const token = Buffer.from('CI Pipeline#uuid-orgB').toString('base64');
      const orgAKey = createMockApiKey({
        id: 'orgA-key',
        description: 'CI Pipeline',
        apiKey: 'hash-for-orgA-token',
        organization_id: 'org-A',
      } as Partial<ApiKey>);
      const orgBKey = createMockApiKey({
        id: 'orgB-key',
        description: 'CI Pipeline',
        apiKey: 'hash-for-orgB-token',
        organization_id: 'org-B',
      } as Partial<ApiKey>);

      cacheService.getCachedValidationResult.mockResolvedValue(null);
      cacheService.getCachedKey.mockResolvedValue(null);
      // DB returns Org A's key first — would be silently picked by the old
      // .find() implementation, causing a bcrypt mismatch and false rejection.
      repository.searchByDescription.mockResolvedValue([orgAKey, orgBKey]);
      // bcrypt only matches against Org B's hash
      (bcrypt.compare as jest.Mock).mockImplementation(async (_token, hash) =>
        hash === 'hash-for-orgB-token',
      );
      repository.updateLastUsed.mockResolvedValue(undefined);
      cacheService.cacheKey.mockResolvedValue(undefined);
      cacheService.cacheValidationResult.mockResolvedValue(undefined);

      // Act
      const result = await service.validateApiKey(token);

      // Assert — Org B's key is returned even though Org A's was returned first
      expect(result).toBe(orgBKey);
      expect(cacheService.cacheKey).toHaveBeenCalledWith(orgBKey);
    });

    it('should fall through to DB scan when cached key belongs to a different org with the same description', async () => {
      // Arrange — Org A's "CI" key is cached. A user from Org B presents their
      // (different) "CI" token. The cache hit must NOT reject the request: the
      // service should fall through to a DB scan and find Org B's key.
      const token = Buffer.from('CI Pipeline#uuid-orgB').toString('base64');
      const orgAKey = createMockApiKey({
        id: 'orgA-key',
        description: 'CI Pipeline',
        apiKey: 'hash-for-orgA-token',
        organization_id: 'org-A',
      } as Partial<ApiKey>);
      const orgBKey = createMockApiKey({
        id: 'orgB-key',
        description: 'CI Pipeline',
        apiKey: 'hash-for-orgB-token',
        organization_id: 'org-B',
      } as Partial<ApiKey>);

      cacheService.getCachedValidationResult.mockResolvedValue(null);
      cacheService.getCachedKey.mockResolvedValue(orgAKey); // wrong org cached
      repository.searchByDescription.mockResolvedValue([orgAKey, orgBKey]);
      (bcrypt.compare as jest.Mock).mockImplementation(async (_token, hash) =>
        hash === 'hash-for-orgB-token',
      );
      repository.updateLastUsed.mockResolvedValue(undefined);
      cacheService.cacheKey.mockResolvedValue(undefined);
      cacheService.cacheValidationResult.mockResolvedValue(undefined);

      // Act
      const result = await service.validateApiKey(token);

      // Assert — Org B's key is found via DB fallback even though Org A's was cached
      expect(result).toBe(orgBKey);
    });

    it('should handle empty result from searchByDescription', async () => {
      // Arrange
      const token = Buffer.from('Nonexistent Key#uuid').toString('base64');

      cacheService.getCachedValidationResult.mockResolvedValue(null);
      cacheService.getCachedKey.mockResolvedValue(null);
      repository.searchByDescription.mockResolvedValue([]);
      cacheService.cacheValidationResult.mockResolvedValue(undefined);

      // Act
      const result = await service.validateApiKey(token);

      // Assert
      expect(result).toBe(null);
      expect(cacheService.cacheValidationResult).toHaveBeenCalledWith(token, false, 300);
    });
  });
});
