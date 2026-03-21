import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { ApiKeyRepository } from './api-key.repository';
import { ApiKey } from '@perfana/shared/entities';
import { DatabaseException } from '../common/exceptions/business.exception';

describe('ApiKeyRepository', () => {
  let repository: ApiKeyRepository;
  let mockRepository: jest.Mocked<Partial<Repository<ApiKey>>>;
  let mockQueryBuilder: jest.Mocked<Partial<SelectQueryBuilder<ApiKey>>>;

  // Helper to create mock API key
  const createMockApiKey = (overrides?: Partial<ApiKey>): ApiKey => ({
    id: '123',
    apiKey: 'base64-encoded-description#uuid',
    description: 'Test API Key',
    roles: [],
    validUntil: undefined,
    lastUsed: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ApiKey);

  beforeEach(async () => {
    mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
      delete: jest.fn().mockReturnThis(),
      execute: jest.fn(),
    } as any;

    mockRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      countBy: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyRepository,
        {
          provide: getRepositoryToken(ApiKey),
          useValue: mockRepository,
        },
      ],
    }).compile();

    repository = module.get<ApiKeyRepository>(ApiKeyRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findByKey', () => {
    it('should find an API key by its key value', async () => {
      // Arrange
      const apiKeyValue = 'test-api-key';
      const mockApiKey = createMockApiKey({ apiKey: apiKeyValue });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockApiKey);

      // Act
      const result = await repository.findByKey(apiKeyValue);

      // Assert
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { apiKey: apiKeyValue },
      });
      expect(result).toEqual(mockApiKey);
    });

    it('should return null when API key not found', async () => {
      // Arrange
      (mockRepository.findOne as jest.Mock).mockResolvedValue(null);

      // Act
      const result = await repository.findByKey('non-existent-key');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findValidKey', () => {
    it('should find API key that has not expired (validUntil in future)', async () => {
      // Arrange
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);
      const mockApiKey = createMockApiKey({ validUntil: futureDate });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockApiKey);

      // Act
      const result = await repository.findValidKey('test-api-key');

      // Assert
      expect(mockRepository.findOne).toHaveBeenCalled();
      expect(result).toEqual(mockApiKey);
    });

    it('should find API key with null validUntil (never expires)', async () => {
      // Arrange
      const mockApiKey = createMockApiKey({ validUntil: undefined });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockApiKey);

      // Act
      const result = await repository.findValidKey('test-api-key');

      // Assert
      expect(result).toEqual(mockApiKey);
    });

    it('should not find expired API key', async () => {
      // Arrange
      (mockRepository.findOne as jest.Mock).mockResolvedValue(null);

      // Act
      const result = await repository.findValidKey('expired-key');

      // Assert
      expect(result).toBeNull();
    });

    it('should throw DatabaseException on query error', async () => {
      // Arrange
      (mockRepository.findOne as jest.Mock).mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(repository.findValidKey('test-key')).rejects.toThrow(DatabaseException);
      await expect(repository.findValidKey('test-key')).rejects.toThrow(
        'Failed to retrieve API key',
      );
    });
  });

  describe('findExpired', () => {
    it('should find all expired API keys', async () => {
      // Arrange
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 30);
      const mockExpiredKeys = [
        createMockApiKey({ id: '1', validUntil: pastDate }),
        createMockApiKey({ id: '2', validUntil: new Date(pastDate.getTime() - 86400000) }),
      ];
      (mockRepository.find as jest.Mock).mockResolvedValue(mockExpiredKeys);

      // Act
      const result = await repository.findExpired();

      // Assert
      expect(mockRepository.find).toHaveBeenCalledWith({
        where: {
          validUntil: expect.objectContaining({ _type: 'lessThan' }),
        },
        order: { validUntil: 'DESC' },
      });
      expect(result).toEqual(mockExpiredKeys);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no expired keys', async () => {
      // Arrange
      (mockRepository.find as jest.Mock).mockResolvedValue([]);

      // Act
      const result = await repository.findExpired();

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('findNeverExpiring', () => {
    it('should find API keys with null validUntil', async () => {
      // Arrange
      const mockNeverExpiringKeys = [
        createMockApiKey({ id: '1', validUntil: undefined }),
        createMockApiKey({ id: '2', validUntil: undefined }),
      ];
      (mockRepository.find as jest.Mock).mockResolvedValue(mockNeverExpiringKeys);

      // Act
      const result = await repository.findNeverExpiring();

      // Assert
      expect(mockRepository.find).toHaveBeenCalledWith({
        where: {
          validUntil: expect.objectContaining({ _type: 'isNull' }),
        },
        order: { createdAt: 'DESC' },
      });
      expect(result).toEqual(mockNeverExpiringKeys);
    });
  });

  describe('updateLastUsed', () => {
    it('should update last used timestamp for API key', async () => {
      // Arrange
      const apiKeyId = '123';
      (mockRepository.update as jest.Mock).mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      // Act
      await repository.updateLastUsed(apiKeyId);

      // Assert
      expect(mockRepository.update).toHaveBeenCalledWith(apiKeyId, {
        lastUsed: expect.any(Date),
      });
    });

    it('should throw DatabaseException on update error', async () => {
      // Arrange
      (mockRepository.update as jest.Mock).mockRejectedValue(new Error('Update failed'));

      // Act & Assert
      await expect(repository.updateLastUsed('123')).rejects.toThrow(DatabaseException);
      await expect(repository.updateLastUsed('123')).rejects.toThrow('Failed to update API key');
    });
  });

  describe('extendValidity', () => {
    it('should extend validity of API key by specified days', async () => {
      // Arrange
      const apiKeyId = '123';
      const currentExpiry = new Date('2024-12-31');
      const mockApiKey = createMockApiKey({ id: apiKeyId, validUntil: currentExpiry });
      const expectedExpiry = new Date(currentExpiry);
      expectedExpiry.setDate(expectedExpiry.getDate() + 30);

      // Mock findById from base repository
      jest.spyOn(repository, 'findById').mockResolvedValue(mockApiKey);
      jest.spyOn(repository, 'update').mockResolvedValue({
        ...mockApiKey,
        validUntil: expectedExpiry,
      });

      // Act
      const result = await repository.extendValidity(apiKeyId, 30);

      // Assert
      expect(repository.findById).toHaveBeenCalledWith(apiKeyId);
      expect(repository.update).toHaveBeenCalledWith(apiKeyId, {
        validUntil: expect.any(Date),
      });
      expect(result.validUntil?.getTime()).toBeGreaterThan(currentExpiry.getTime());
    });

    it('should use current date as base when validUntil is null', async () => {
      // Arrange
      const apiKeyId = '123';
      const mockApiKey = createMockApiKey({ id: apiKeyId, validUntil: undefined });

      jest.spyOn(repository, 'findById').mockResolvedValue(mockApiKey);
      jest.spyOn(repository, 'update').mockResolvedValue({
        ...mockApiKey,
        validUntil: new Date(),
      });

      // Act
      await repository.extendValidity(apiKeyId, 30);

      // Assert
      expect(repository.update).toHaveBeenCalledWith(apiKeyId, {
        validUntil: expect.any(Date),
      });
    });

    it('should throw DatabaseException on extension error', async () => {
      // Arrange
      jest.spyOn(repository, 'findById').mockRejectedValue(new Error('Not found'));

      // Act & Assert
      await expect(repository.extendValidity('123', 30)).rejects.toThrow(DatabaseException);
      await expect(repository.extendValidity('123', 30)).rejects.toThrow(
        'Failed to extend API key validity',
      );
    });
  });

  describe('setExpiration', () => {
    it('should set expiration date for API key', async () => {
      // Arrange
      const apiKeyId = '123';
      const expirationDate = new Date('2025-12-31');
      const mockApiKey = createMockApiKey({ id: apiKeyId, validUntil: expirationDate });

      jest.spyOn(repository, 'update').mockResolvedValue(mockApiKey);

      // Act
      const result = await repository.setExpiration(apiKeyId, expirationDate);

      // Assert
      expect(repository.update).toHaveBeenCalledWith(apiKeyId, {
        validUntil: expirationDate,
      });
      expect(result.validUntil).toEqual(expirationDate);
    });
  });

  describe('removeExpiration', () => {
    it('should remove expiration (set validUntil to null)', async () => {
      // Arrange
      const apiKeyId = '123';
      const mockApiKey = createMockApiKey({ id: apiKeyId, validUntil: undefined });

      jest.spyOn(repository, 'update').mockResolvedValue(mockApiKey);

      // Act
      const result = await repository.removeExpiration(apiKeyId);

      // Assert
      expect(repository.update).toHaveBeenCalledWith(apiKeyId, {
        validUntil: null,
      });
      expect(result.validUntil).toBeUndefined();
    });
  });

  describe('findExpiringSoon', () => {
    it('should find API keys expiring within specified days', async () => {
      // Arrange
      const daysAhead = 7;
      const expiringDate = new Date();
      expiringDate.setDate(expiringDate.getDate() + 5);

      const mockExpiringKeys = [
        createMockApiKey({ id: '1', validUntil: expiringDate }),
      ];
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockExpiringKeys);

      // Act
      const result = await repository.findExpiringSoon(daysAhead);

      // Assert
      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('ak');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('ak.validUntil IS NOT NULL');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('ak.validUntil', 'ASC');
      expect(result).toEqual(mockExpiringKeys);
    });

    it('should return empty array when no keys expiring soon', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      const result = await repository.findExpiringSoon(30);

      // Assert
      expect(result).toEqual([]);
    });

    it('should throw DatabaseException on query error', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockRejectedValue(new Error('Query failed'));

      // Act & Assert
      await expect(repository.findExpiringSoon(7)).rejects.toThrow(DatabaseException);
      await expect(repository.findExpiringSoon(7)).rejects.toThrow('Failed to retrieve API keys');
    });
  });

  describe('searchByDescription', () => {
    it('should search API keys by description using ILIKE', async () => {
      // Arrange
      const searchTerm = 'production';
      const mockKeys = [
        createMockApiKey({ id: '1', description: 'Production API Key' }),
        createMockApiKey({ id: '2', description: 'Production Service Key' }),
      ];
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockKeys);

      // Act
      const result = await repository.searchByDescription(searchTerm);

      // Assert
      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('ak');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('ak.description ILIKE :search', {
        search: `%${searchTerm}%`,
      });
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('ak.createdAt', 'DESC');
      expect(result).toEqual(mockKeys);
    });

    it('should handle case-insensitive search', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.searchByDescription('PRODUCTION');

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('ak.description ILIKE :search', {
        search: '%PRODUCTION%',
      });
    });

    it('should throw DatabaseException on search error', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockRejectedValue(new Error('Search failed'));

      // Act & Assert
      await expect(repository.searchByDescription('test')).rejects.toThrow(DatabaseException);
      await expect(repository.searchByDescription('test')).rejects.toThrow(
        'Failed to search API keys',
      );
    });
  });

  describe('getStatistics', () => {
    it('should calculate API key statistics correctly', async () => {
      // Arrange
      jest.spyOn(repository, 'count')
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(20)  // expired
        .mockResolvedValueOnce(30); // never expiring

      // Act
      const result = await repository.getStatistics();

      // Assert
      expect(result).toEqual({
        total: 100,
        valid: 80,
        expired: 20,
        neverExpiring: 30,
      });
    });

    it('should handle zero statistics', async () => {
      // Arrange
      jest.spyOn(repository, 'count')
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      // Act
      const result = await repository.getStatistics();

      // Assert
      expect(result).toEqual({
        total: 0,
        valid: 0,
        expired: 0,
        neverExpiring: 0,
      });
    });

    it('should throw DatabaseException on count error', async () => {
      // Arrange
      jest.spyOn(repository, 'count').mockRejectedValue(new Error('Count failed'));

      // Act & Assert
      await expect(repository.getStatistics()).rejects.toThrow(DatabaseException);
      await expect(repository.getStatistics()).rejects.toThrow(
        'Failed to retrieve API key statistics',
      );
    });
  });

  describe('deleteExpired', () => {
    it('should delete expired API keys', async () => {
      // Arrange
      (mockQueryBuilder.execute as jest.Mock).mockResolvedValue({ affected: 15, raw: [] });

      // Act
      const result = await repository.deleteExpired();

      // Assert
      expect(mockRepository.createQueryBuilder).toHaveBeenCalled();
      expect(mockQueryBuilder.delete).toHaveBeenCalled();
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('validUntil < :now', {
        now: expect.any(Date),
      });
      expect(result).toBe(15);
    });

    it('should return 0 when no expired keys deleted', async () => {
      // Arrange
      (mockQueryBuilder.execute as jest.Mock).mockResolvedValue({ affected: undefined, raw: [] });

      // Act
      const result = await repository.deleteExpired();

      // Assert
      expect(result).toBe(0);
    });

    it('should throw DatabaseException on deletion error', async () => {
      // Arrange
      (mockQueryBuilder.execute as jest.Mock).mockRejectedValue(new Error('Delete failed'));

      // Act & Assert
      await expect(repository.deleteExpired()).rejects.toThrow(DatabaseException);
      await expect(repository.deleteExpired()).rejects.toThrow('Failed to delete API keys');
    });
  });

  describe('findRecentlyCreated', () => {
    it('should find API keys created within specified days', async () => {
      // Arrange
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 3);
      const mockRecentKeys = [
        createMockApiKey({ id: '1', createdAt: recentDate }),
        createMockApiKey({ id: '2', createdAt: new Date() }),
      ];
      (mockRepository.find as jest.Mock).mockResolvedValue(mockRecentKeys);

      // Act
      const result = await repository.findRecentlyCreated(7);

      // Assert
      expect(mockRepository.find).toHaveBeenCalledWith({
        where: {
          createdAt: expect.objectContaining({ _type: 'moreThan' }),
        },
        order: { createdAt: 'DESC' },
      });
      expect(result).toEqual(mockRecentKeys);
    });

    it('should use default 7 days when not specified', async () => {
      // Arrange
      (mockRepository.find as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findRecentlyCreated();

      // Assert
      expect(mockRepository.find).toHaveBeenCalled();
    });

    it('should throw DatabaseException on query error', async () => {
      // Arrange
      (mockRepository.find as jest.Mock).mockRejectedValue(new Error('Query failed'));

      // Act & Assert
      await expect(repository.findRecentlyCreated(7)).rejects.toThrow(DatabaseException);
      await expect(repository.findRecentlyCreated(7)).rejects.toThrow(
        'Failed to retrieve API keys',
      );
    });
  });

  describe('findUnused', () => {
    it('should find API keys that have never been used', async () => {
      // Arrange
      const mockUnusedKeys = [
        createMockApiKey({ id: '1', lastUsed: undefined }),
        createMockApiKey({ id: '2', lastUsed: undefined }),
      ];
      (mockRepository.find as jest.Mock).mockResolvedValue(mockUnusedKeys);

      // Act
      const result = await repository.findUnused();

      // Assert
      expect(mockRepository.find).toHaveBeenCalledWith({
        where: {
          lastUsed: expect.objectContaining({ _type: 'isNull' }),
        },
        order: { createdAt: 'DESC' },
      });
      expect(result).toEqual(mockUnusedKeys);
    });
  });

  describe('findInactive', () => {
    it('should find API keys not used within specified days', async () => {
      // Arrange
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 60);
      const mockInactiveKeys = [
        createMockApiKey({ id: '1', lastUsed: oldDate }),
        createMockApiKey({ id: '2', lastUsed: undefined }),
      ];
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockInactiveKeys);

      // Act
      const result = await repository.findInactive(30);

      // Assert
      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('ak');
      expect(mockQueryBuilder.where).toHaveBeenCalled();
      expect(mockQueryBuilder.orWhere).toHaveBeenCalledWith('ak.lastUsed IS NULL');
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('ak.lastUsed', 'ASC', 'NULLS FIRST');
      expect(result).toEqual(mockInactiveKeys);
    });

    it('should use default 30 days when not specified', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findInactive();

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalled();
    });

    it('should throw DatabaseException on query error', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockRejectedValue(new Error('Query failed'));

      // Act & Assert
      await expect(repository.findInactive(30)).rejects.toThrow(DatabaseException);
      await expect(repository.findInactive(30)).rejects.toThrow('Failed to retrieve API keys');
    });
  });

  describe('isValid', () => {
    it('should return true for valid API key', async () => {
      // Arrange
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);
      const mockApiKey = createMockApiKey({ validUntil: futureDate });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockApiKey);

      // Act
      const result = await repository.isValid('test-api-key');

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for expired API key', async () => {
      // Arrange
      (mockRepository.findOne as jest.Mock).mockResolvedValue(null);

      // Act
      const result = await repository.isValid('expired-key');

      // Assert
      expect(result).toBe(false);
    });

    it('should return false for non-existent API key', async () => {
      // Arrange
      (mockRepository.findOne as jest.Mock).mockResolvedValue(null);

      // Act
      const result = await repository.isValid('non-existent-key');

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('Edge Cases and Complex Scenarios', () => {
    it('should handle API keys with special characters in description', async () => {
      // Arrange
      const specialChars = "Production Key <> & \"quotes\" 'apostrophe'";
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.searchByDescription(specialChars);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('ak.description ILIKE :search', {
        search: `%${specialChars}%`,
      });
    });

    it('should handle edge case of expiration date exactly at current time', async () => {
      // Arrange
      const now = new Date();
      const mockApiKey = createMockApiKey({ validUntil: now });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockApiKey);

      // Act
      await repository.findValidKey('test-key');

      // Assert - Key with exact current time should be considered expired
      expect(mockRepository.findOne).toHaveBeenCalled();
    });

    it('should handle large batch of expired keys', async () => {
      // Arrange
      (mockQueryBuilder.execute as jest.Mock).mockResolvedValue({ affected: 10000, raw: [] });

      // Act
      const result = await repository.deleteExpired();

      // Assert
      expect(result).toBe(10000);
    });

    it('should handle concurrent updates to lastUsed', async () => {
      // Arrange
      (mockRepository.update as jest.Mock).mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      // Act
      await Promise.all([
        repository.updateLastUsed('123'),
        repository.updateLastUsed('123'),
        repository.updateLastUsed('123'),
      ]);

      // Assert
      expect(mockRepository.update).toHaveBeenCalledTimes(3);
    });

    it('should handle empty string in search', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.searchByDescription('');

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('ak.description ILIKE :search', {
        search: '%%',
      });
    });

    it('should handle very long description in search', async () => {
      // Arrange
      const longDescription = 'a'.repeat(1000);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.searchByDescription(longDescription);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('ak.description ILIKE :search', {
        search: `%${longDescription}%`,
      });
    });

    it('should handle negative days for findExpiringSoon', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findExpiringSoon(-7);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalled();
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(2);
    });

    it('should handle zero days for findExpiringSoon', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findExpiringSoon(0);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalled();
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(2);
    });

    it('should handle negative days for extendValidity', async () => {
      // Arrange
      const apiKeyId = '123';
      const currentExpiry = new Date('2024-12-31');
      const mockApiKey = createMockApiKey({ id: apiKeyId, validUntil: currentExpiry });

      jest.spyOn(repository, 'findById').mockResolvedValue(mockApiKey);
      jest.spyOn(repository, 'update').mockResolvedValue({
        ...mockApiKey,
        validUntil: new Date('2024-12-24'), // 7 days earlier
      });

      // Act
      const result = await repository.extendValidity(apiKeyId, -7);

      // Assert
      expect(result.validUntil).toBeDefined();
      expect(repository.update).toHaveBeenCalled();
    });

    it('should handle findRecentlyCreated with zero days', async () => {
      // Arrange
      (mockRepository.find as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findRecentlyCreated(0);

      // Assert
      expect(mockRepository.find).toHaveBeenCalled();
    });

    it('should handle findInactive with very large days value', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findInactive(365 * 10); // 10 years

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalled();
    });

    it('should handle API key with null description', async () => {
      // Arrange
      const mockApiKey = createMockApiKey({ description: null as any });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockApiKey);

      // Act
      const result = await repository.findByKey('test-key');

      // Assert
      expect(result).toEqual(mockApiKey);
    });

    it('should handle API key with empty apiKey string', async () => {
      // Arrange
      (mockRepository.findOne as jest.Mock).mockResolvedValue(null);

      // Act
      const result = await repository.findByKey('');

      // Assert
      expect(result).toBeNull();
    });

    it('should handle findValidKey with millisecond precision', async () => {
      // Arrange
      const futureDate = new Date();
      futureDate.setMilliseconds(futureDate.getMilliseconds() + 100);
      const mockApiKey = createMockApiKey({ validUntil: futureDate });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockApiKey);

      // Act
      const result = await repository.findValidKey('test-key');

      // Assert
      expect(result).toEqual(mockApiKey);
    });

    it('should handle multiple API keys expiring at same time', async () => {
      // Arrange
      const expiryDate = new Date('2024-12-31T23:59:59Z');
      const mockKeys = [
        createMockApiKey({ id: '1', validUntil: expiryDate }),
        createMockApiKey({ id: '2', validUntil: expiryDate }),
        createMockApiKey({ id: '3', validUntil: expiryDate }),
      ];
      (mockRepository.find as jest.Mock).mockResolvedValue(mockKeys);

      // Act
      const result = await repository.findExpired();

      // Assert
      expect(result).toHaveLength(3);
    });

    it('should handle updateLastUsed with precise timestamp', async () => {
      // Arrange
      const beforeUpdate = Date.now();
      (mockRepository.update as jest.Mock).mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      // Act
      await repository.updateLastUsed('123');

      // Assert
      const afterUpdate = Date.now();
      const updateCall = (mockRepository.update as jest.Mock).mock.calls[0];
      const lastUsedTimestamp = (updateCall[1].lastUsed as Date).getTime();

      expect(lastUsedTimestamp).toBeGreaterThanOrEqual(beforeUpdate);
      expect(lastUsedTimestamp).toBeLessThanOrEqual(afterUpdate);
    });

    it('should handle setExpiration with past date', async () => {
      // Arrange
      const pastDate = new Date('2020-01-01');
      const mockApiKey = createMockApiKey({ validUntil: pastDate });
      jest.spyOn(repository, 'update').mockResolvedValue(mockApiKey);

      // Act
      const result = await repository.setExpiration('123', pastDate);

      // Assert
      expect(result.validUntil).toEqual(pastDate);
    });

    it('should handle setExpiration with far future date', async () => {
      // Arrange
      const futureDate = new Date('2099-12-31');
      const mockApiKey = createMockApiKey({ validUntil: futureDate });
      jest.spyOn(repository, 'update').mockResolvedValue(mockApiKey);

      // Act
      const result = await repository.setExpiration('123', futureDate);

      // Assert
      expect(result.validUntil).toEqual(futureDate);
    });

    it('should handle search with SQL injection attempt', async () => {
      // Arrange
      const maliciousInput = "'; DROP TABLE api_keys; --";
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.searchByDescription(maliciousInput);

      // Assert - Should be properly parameterized
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('ak.description ILIKE :search', {
        search: `%${maliciousInput}%`,
      });
    });

    it('should handle API key with all optional fields undefined', async () => {
      // Arrange
      const mockApiKey = createMockApiKey({
        validUntil: undefined,
        lastUsed: undefined,
      });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockApiKey);

      // Act
      const result = await repository.findByKey('test-key');

      // Assert
      expect(result?.validUntil).toBeUndefined();
      expect(result?.lastUsed).toBeUndefined();
    });
  });

  describe('Boundary Value Tests', () => {
    it('should handle findExpiringSoon with 1 day', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findExpiringSoon(1);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('ak.validUntil IS NOT NULL');
    });

    it('should handle findExpiringSoon with 365 days', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findExpiringSoon(365);

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(2);
    });

    it('should handle extendValidity by 1 day', async () => {
      // Arrange
      const mockApiKey = createMockApiKey({ validUntil: new Date('2024-12-31') });
      jest.spyOn(repository, 'findById').mockResolvedValue(mockApiKey);
      jest.spyOn(repository, 'update').mockResolvedValue(mockApiKey);

      // Act
      await repository.extendValidity('123', 1);

      // Assert
      expect(repository.update).toHaveBeenCalledWith('123', {
        validUntil: expect.any(Date),
      });
    });

    it('should handle findRecentlyCreated with 1 day', async () => {
      // Arrange
      (mockRepository.find as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findRecentlyCreated(1);

      // Assert
      expect(mockRepository.find).toHaveBeenCalled();
    });

    it('should handle findInactive with 1 day', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findInactive(1);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalled();
    });
  });

  describe('Database Error Handling', () => {
    it('should handle database connection error in findExpired', async () => {
      // Arrange
      (mockRepository.find as jest.Mock).mockRejectedValue(new Error('Connection timeout'));

      // Act & Assert
      await expect(repository.findExpired()).rejects.toThrow();
    });

    it('should handle database connection error in findNeverExpiring', async () => {
      // Arrange
      (mockRepository.find as jest.Mock).mockRejectedValue(new Error('Connection lost'));

      // Act & Assert
      await expect(repository.findNeverExpiring()).rejects.toThrow();
    });

    it('should handle database connection error in findUnused', async () => {
      // Arrange
      (mockRepository.find as jest.Mock).mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(repository.findUnused()).rejects.toThrow();
    });

    it('should handle query timeout in searchByDescription', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockRejectedValue(new Error('Query timeout'));

      // Act & Assert
      await expect(repository.searchByDescription('test')).rejects.toThrow(DatabaseException);
    });

    it('should handle transaction deadlock in deleteExpired', async () => {
      // Arrange
      (mockQueryBuilder.execute as jest.Mock).mockRejectedValue(
        new Error('Deadlock detected'),
      );

      // Act & Assert
      await expect(repository.deleteExpired()).rejects.toThrow(DatabaseException);
    });

    it('should handle constraint violation in updateLastUsed', async () => {
      // Arrange
      (mockRepository.update as jest.Mock).mockRejectedValue(
        new Error('Foreign key constraint violation'),
      );

      // Act & Assert
      await expect(repository.updateLastUsed('123')).rejects.toThrow(DatabaseException);
    });
  });

  describe('Data Consistency Tests', () => {
    it('should maintain statistics consistency when no keys exist', async () => {
      // Arrange
      jest.spyOn(repository, 'count').mockResolvedValue(0);

      // Act
      const result = await repository.getStatistics();

      // Assert
      expect(result.total).toBe(0);
      expect(result.valid).toBe(0);
      expect(result.expired).toBe(0);
    });

    it('should calculate correct valid keys when all are expired', async () => {
      // Arrange
      jest.spyOn(repository, 'count')
        .mockResolvedValueOnce(50)  // total
        .mockResolvedValueOnce(50)  // expired
        .mockResolvedValueOnce(0);  // never expiring

      // Act
      const result = await repository.getStatistics();

      // Assert
      expect(result.total).toBe(50);
      expect(result.valid).toBe(0);
      expect(result.expired).toBe(50);
    });

    it('should calculate correct valid keys when some never expire', async () => {
      // Arrange
      jest.spyOn(repository, 'count')
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(20)  // expired
        .mockResolvedValueOnce(30); // never expiring

      // Act
      const result = await repository.getStatistics();

      // Assert
      expect(result.total).toBe(100);
      expect(result.valid).toBe(80);
      expect(result.expired).toBe(20);
      expect(result.neverExpiring).toBe(30);
    });

    it('should handle race condition in isValid check', async () => {
      // Arrange
      const mockApiKey = createMockApiKey({ validUntil: new Date(Date.now() + 1000) });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockApiKey);

      // Act
      const result = await repository.isValid('test-key');

      // Assert
      expect(result).toBe(true);
    });

    it('should return consistent results for multiple calls to isValid', async () => {
      // Arrange
      const mockApiKey = createMockApiKey({ validUntil: new Date(Date.now() + 10000) });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockApiKey);

      // Act
      const [result1, result2, result3] = await Promise.all([
        repository.isValid('test-key'),
        repository.isValid('test-key'),
        repository.isValid('test-key'),
      ]);

      // Assert
      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(result3).toBe(true);
    });
  });

  describe('Query Builder Integration', () => {
    it('should properly chain QueryBuilder methods for findExpiringSoon', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findExpiringSoon(7);

      // Assert
      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('ak');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('ak.validUntil IS NOT NULL');
      expect(mockQueryBuilder.andWhere).toHaveBeenNthCalledWith(1, 'ak.validUntil > :now', expect.any(Object));
      expect(mockQueryBuilder.andWhere).toHaveBeenNthCalledWith(2, 'ak.validUntil <= :futureDate', expect.any(Object));
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('ak.validUntil', 'ASC');
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
    });

    it('should properly chain QueryBuilder methods for searchByDescription', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.searchByDescription('test');

      // Assert
      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('ak');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('ak.description ILIKE :search', {
        search: '%test%',
      });
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('ak.createdAt', 'DESC');
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
    });

    it('should properly chain QueryBuilder methods for findInactive', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findInactive(30);

      // Assert
      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('ak');
      expect(mockQueryBuilder.where).toHaveBeenCalled();
      expect(mockQueryBuilder.orWhere).toHaveBeenCalledWith('ak.lastUsed IS NULL');
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('ak.lastUsed', 'ASC', 'NULLS FIRST');
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
    });

    it('should properly chain QueryBuilder methods for deleteExpired', async () => {
      // Arrange
      (mockQueryBuilder.execute as jest.Mock).mockResolvedValue({ affected: 5, raw: [] });

      // Act
      await repository.deleteExpired();

      // Assert
      expect(mockRepository.createQueryBuilder).toHaveBeenCalled();
      expect(mockQueryBuilder.delete).toHaveBeenCalled();
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('validUntil < :now', {
        now: expect.any(Date),
      });
      expect(mockQueryBuilder.execute).toHaveBeenCalled();
    });
  });

  describe('API Key Format and Token Handling', () => {
    it('should handle base64 encoded API key format', async () => {
      // Arrange
      const base64Key = Buffer.from('description#uuid-123').toString('base64');
      const mockApiKey = createMockApiKey({ apiKey: base64Key });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockApiKey);

      // Act
      const result = await repository.findByKey(base64Key);

      // Assert
      expect(result).toEqual(mockApiKey);
    });

    it('should handle UUID format in API key', async () => {
      // Arrange
      const uuidKey = 'description#550e8400-e29b-41d4-a716-446655440000';
      const mockApiKey = createMockApiKey({ apiKey: uuidKey });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockApiKey);

      // Act
      const result = await repository.findByKey(uuidKey);

      // Assert
      expect(result).toEqual(mockApiKey);
    });

    it('should handle API key with multiple hash symbols', async () => {
      // Arrange
      const complexKey = 'description#with#hashes#uuid';
      const mockApiKey = createMockApiKey({ apiKey: complexKey });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockApiKey);

      // Act
      const result = await repository.findByKey(complexKey);

      // Assert
      expect(result).toEqual(mockApiKey);
    });

    it('should handle very long API key', async () => {
      // Arrange
      const longKey = 'a'.repeat(500);
      const mockApiKey = createMockApiKey({ apiKey: longKey });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockApiKey);

      // Act
      const result = await repository.findByKey(longKey);

      // Assert
      expect(result).toEqual(mockApiKey);
    });
  });

  describe('Roles Field Handling', () => {
    it('should handle API key with roles array', async () => {
      // Arrange
      const mockApiKey = createMockApiKey({
        apiKey: 'test-key',
        roles: ['admin', 'user']
      });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockApiKey);

      // Act
      const result = await repository.findByKey('test-key');

      // Assert
      expect(result?.roles).toEqual(['admin', 'user']);
    });

    it('should handle API key with empty roles array', async () => {
      // Arrange
      const mockApiKey = createMockApiKey({
        apiKey: 'test-key',
        roles: []
      });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockApiKey);

      // Act
      const result = await repository.findByKey('test-key');

      // Assert
      expect(result?.roles).toEqual([]);
    });

    it('should handle API key with single role', async () => {
      // Arrange
      const mockApiKey = createMockApiKey({
        apiKey: 'test-key',
        roles: ['admin']
      });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockApiKey);

      // Act
      const result = await repository.findByKey('test-key');

      // Assert
      expect(result?.roles).toEqual(['admin']);
    });
  });

  describe('Timestamp Precision Tests', () => {
    it('should handle createdAt with timezone', async () => {
      // Arrange
      const utcDate = new Date('2024-01-01T00:00:00Z');
      const mockApiKey = createMockApiKey({ createdAt: utcDate });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockApiKey);

      // Act
      const result = await repository.findByKey('test-key');

      // Assert
      expect(result?.createdAt).toEqual(utcDate);
    });

    it('should handle updatedAt with timezone', async () => {
      // Arrange
      const utcDate = new Date('2024-01-01T12:30:45Z');
      const mockApiKey = createMockApiKey({ updatedAt: utcDate });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockApiKey);

      // Act
      const result = await repository.findByKey('test-key');

      // Assert
      expect(result?.updatedAt).toEqual(utcDate);
    });

    it('should handle lastUsed with timezone', async () => {
      // Arrange
      const utcDate = new Date('2024-12-31T23:59:59.999Z');
      const mockApiKey = createMockApiKey({ lastUsed: utcDate });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockApiKey);

      // Act
      const result = await repository.findByKey('test-key');

      // Assert
      expect(result?.lastUsed).toEqual(utcDate);
    });
  });
});
