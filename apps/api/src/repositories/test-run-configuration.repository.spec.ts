import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { TestRunConfigurationRepository } from './test-run-configuration.repository';
import { TestRunConfiguration } from '@perfana/shared/entities';
import { DatabaseException } from '../common/exceptions/business.exception';

describe('TestRunConfigurationRepository', () => {
  let repository: TestRunConfigurationRepository;
  let mockRepository: jest.Mocked<Partial<Repository<TestRunConfiguration>>>;
  let mockQueryBuilder: jest.Mocked<Partial<SelectQueryBuilder<TestRunConfiguration>>>;

  beforeEach(async () => {
    // Create mock query builder with chainable methods
    mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
      getRawMany: jest.fn(),
      execute: jest.fn(),
    };

    mockRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestRunConfigurationRepository,
        {
          provide: getRepositoryToken(TestRunConfiguration),
          useValue: mockRepository,
        },
      ],
    }).compile();

    repository = module.get<TestRunConfigurationRepository>(TestRunConfigurationRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findByTestRunId', () => {
    it('should find all configurations for a test run ordered by key', async () => {
      // Arrange
      const testRunId = 'test-run-123';
      const mockConfigs: TestRunConfiguration[] = [
        {
          id: '1',
          testRunId,
          key: 'database.host',
          value: 'localhost',
          created_at: new Date(),
          updated_at: new Date(),
        } as unknown as TestRunConfiguration,
        {
          id: '2',
          testRunId,
          key: 'database.port',
          value: '5432',
          created_at: new Date(),
          updated_at: new Date(),
        } as unknown as TestRunConfiguration,
      ];
      (mockRepository.find as jest.Mock).mockResolvedValue(mockConfigs);

      // Act
      const result = await repository.findByTestRunId(testRunId);

      // Assert
      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { testRunId },
        order: { key: 'ASC' },
      });
      expect(result).toEqual(mockConfigs);
    });

    it('should return empty array when no configurations found', async () => {
      // Arrange
      (mockRepository.find as jest.Mock).mockResolvedValue([]);

      // Act
      const result = await repository.findByTestRunId('non-existent');

      // Assert
      expect(result).toEqual([]);
    });

    it('should throw DatabaseException on query error', async () => {
      // Arrange
      (mockRepository.find as jest.Mock).mockRejectedValue(new Error('Database connection failed'));

      // Act & Assert
      await expect(repository.findByTestRunId('test-run-123')).rejects.toThrow(DatabaseException);
      await expect(repository.findByTestRunId('test-run-123')).rejects.toThrow(
        'Failed to retrieve test run configurations',
      );
    });
  });

  describe('findByTestRunIdString', () => {
    it('should find configurations by test_run_id string', async () => {
      // Arrange
      const testRunIdString = 'PaymentService-production-loadTest-001';
      const mockConfigs: TestRunConfiguration[] = [
        {
          id: '1',
          testRunIdString,
          key: 'app.version',
          value: '1.0.0',
          created_at: new Date(),
          updated_at: new Date(),
        } as unknown as TestRunConfiguration,
      ];
      (mockRepository.find as jest.Mock).mockResolvedValue(mockConfigs);

      // Act
      const result = await repository.findByTestRunIdString(testRunIdString);

      // Assert
      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { testRunIdString },
        order: { key: 'ASC' },
      });
      expect(result).toEqual(mockConfigs);
    });

    it('should throw DatabaseException on query error', async () => {
      // Arrange
      (mockRepository.find as jest.Mock).mockRejectedValue(new Error('Query failed'));

      // Act & Assert
      await expect(repository.findByTestRunIdString('test-run-string')).rejects.toThrow(
        DatabaseException,
      );
    });
  });

  describe('findByKey', () => {
    it('should find configuration by test run ID and key', async () => {
      // Arrange
      const testRunId = 'test-run-123';
      const key = 'database.host';
      const mockConfig = {
        id: '1',
        testRunId,
        key,
        value: 'localhost',
      } as TestRunConfiguration;
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockConfig);

      // Act
      const result = await repository.findByKey(testRunId, key);

      // Assert
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { testRunId, key },
      });
      expect(result).toEqual(mockConfig);
    });

    it('should return null when configuration not found', async () => {
      // Arrange
      (mockRepository.findOne as jest.Mock).mockResolvedValue(null);

      // Act
      const result = await repository.findByKey('test-run-123', 'non-existent.key');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findByTags', () => {
    it('should find configurations by tags using array overlap operator', async () => {
      // Arrange
      const tags = ['important', 'production'];
      const mockConfigs: TestRunConfiguration[] = [
        {
          id: '1',
          key: 'config1',
          value: 'value1',
          tags,
          created_at: new Date(),
          updated_at: new Date(),
        } as unknown as TestRunConfiguration,
      ];
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockConfigs);

      // Act
      const result = await repository.findByTags(tags);

      // Assert
      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('config');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('config.tags && ARRAY[:...tags]::varchar[]', {
        tags,
      });
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('config.createdAt', 'DESC');
      expect(result).toEqual(mockConfigs);
    });

    it('should handle empty tags array', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      const result = await repository.findByTags([]);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('config.tags && ARRAY[:...tags]::varchar[]', {
        tags: [],
      });
      expect(result).toEqual([]);
    });

    it('should handle single tag', async () => {
      // Arrange
      const tags = ['important'];
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findByTags(tags);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('config.tags && ARRAY[:...tags]::varchar[]', {
        tags,
      });
    });

    it('should throw DatabaseException on query error', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockRejectedValue(new Error('Tags query failed'));

      // Act & Assert
      await expect(repository.findByTags(['tag1'])).rejects.toThrow(DatabaseException);
      await expect(repository.findByTags(['tag1'])).rejects.toThrow(
        'Failed to retrieve test run configurations',
      );
    });
  });

  describe('createMany', () => {
    it('should bulk create multiple configurations', async () => {
      // Arrange
      const configsToCreate: Partial<TestRunConfiguration>[] = [
        { testRunId: 'test-run-123', key: 'config1', value: 'value1' },
        { testRunId: 'test-run-123', key: 'config2', value: 'value2' },
        { testRunId: 'test-run-123', key: 'config3', value: 'value3' },
      ];

      const createdConfigs = configsToCreate.map((c, i) => ({
        id: `${i + 1}`,
        ...c,
        createdAt: new Date(),
        updatedAt: new Date(),
      })) as TestRunConfiguration[];

      (mockRepository.create as jest.Mock).mockReturnValue(createdConfigs);
      (mockRepository.save as jest.Mock).mockResolvedValue(createdConfigs);

      // Act
      const result = await repository.createMany(configsToCreate);

      // Assert
      expect(mockRepository.create).toHaveBeenCalledWith(configsToCreate);
      expect(mockRepository.save).toHaveBeenCalledWith(createdConfigs);
      expect(result).toEqual(createdConfigs);
      expect(result).toHaveLength(3);
    });

    it('should handle empty array', async () => {
      // Arrange
      (mockRepository.create as jest.Mock).mockReturnValue([]);
      (mockRepository.save as jest.Mock).mockResolvedValue([]);

      // Act
      const result = await repository.createMany([]);

      // Assert
      expect(result).toEqual([]);
    });

    it('should throw DatabaseException on creation error', async () => {
      // Arrange
      const configs = [{ testRunId: 'test-run-123', key: 'config1', value: 'value1' }];
      (mockRepository.create as jest.Mock).mockReturnValue(configs as any);
      (mockRepository.save as jest.Mock).mockRejectedValue(new Error('Unique constraint violation'));

      // Act & Assert
      await expect(repository.createMany(configs)).rejects.toThrow(DatabaseException);
      await expect(repository.createMany(configs)).rejects.toThrow(
        'Failed to create test run configurations',
      );
    });
  });

  describe('deleteByTestRunId', () => {
    it('should delete all configurations for a test run', async () => {
      // Arrange
      const testRunId = 'test-run-123';
      (mockQueryBuilder.execute as jest.Mock).mockResolvedValue({ affected: 5, raw: [] });

      // Act
      const result = await repository.deleteByTestRunId(testRunId);

      // Assert
      expect(mockRepository.createQueryBuilder).toHaveBeenCalled();
      expect(mockQueryBuilder.delete).toHaveBeenCalled();
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('testRunId = :testRunId', { testRunId });
      expect(mockQueryBuilder.execute).toHaveBeenCalled();
      expect(result).toBe(5);
    });

    it('should return 0 when no configurations deleted', async () => {
      // Arrange
      (mockQueryBuilder.execute as jest.Mock).mockResolvedValue({ affected: undefined, raw: [] });

      // Act
      const result = await repository.deleteByTestRunId('non-existent');

      // Assert
      expect(result).toBe(0);
    });

    it('should return 0 when affected is null', async () => {
      // Arrange
      (mockQueryBuilder.execute as jest.Mock).mockResolvedValue({ affected: null, raw: [] } as any);

      // Act
      const result = await repository.deleteByTestRunId('test-run-123');

      // Assert
      expect(result).toBe(0);
    });

    it('should throw DatabaseException on deletion error', async () => {
      // Arrange
      (mockQueryBuilder.execute as jest.Mock).mockRejectedValue(new Error('Foreign key constraint violation'));

      // Act & Assert
      await expect(repository.deleteByTestRunId('test-run-123')).rejects.toThrow(DatabaseException);
      await expect(repository.deleteByTestRunId('test-run-123')).rejects.toThrow(
        'Failed to delete test run configurations',
      );
    });
  });

  describe('searchByKeyPattern', () => {
    it('should search configurations by key pattern using ILIKE', async () => {
      // Arrange
      const pattern = 'database';
      const mockConfigs: TestRunConfiguration[] = [
        {
          id: '1',
          key: 'database.host',
          value: 'localhost',
          created_at: new Date(),
          updated_at: new Date(),
        } as unknown as TestRunConfiguration,
        {
          id: '2',
          key: 'database.port',
          value: '5432',
          created_at: new Date(),
          updated_at: new Date(),
        } as unknown as TestRunConfiguration,
      ];
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockConfigs);

      // Act
      const result = await repository.searchByKeyPattern(pattern);

      // Assert
      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('config');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('config.key ILIKE :pattern', {
        pattern: `%${pattern}%`,
      });
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('config.createdAt', 'DESC');
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(50);
      expect(result).toEqual(mockConfigs);
    });

    it('should apply custom limit', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.searchByKeyPattern('test', 100);

      // Assert
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(100);
    });

    it('should use default limit when not specified', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.searchByKeyPattern('test');

      // Assert
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(50);
    });

    it('should handle case-insensitive search', async () => {
      // Arrange
      const pattern = 'DATABASE';
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.searchByKeyPattern(pattern);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('config.key ILIKE :pattern', {
        pattern: `%${pattern}%`,
      });
    });

    it('should throw DatabaseException on search error', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockRejectedValue(new Error('Search query failed'));

      // Act & Assert
      await expect(repository.searchByKeyPattern('test')).rejects.toThrow(DatabaseException);
      await expect(repository.searchByKeyPattern('test')).rejects.toThrow(
        'Failed to search test run configurations',
      );
    });
  });

  describe('getUniqueKeys', () => {
    it('should get all unique configuration keys ordered alphabetically', async () => {
      // Arrange
      const mockRawResults = [
        { key: 'app.version' },
        { key: 'database.host' },
        { key: 'database.port' },
        { key: 'redis.host' },
      ];
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockRawResults);

      // Act
      const result = await repository.getUniqueKeys();

      // Assert
      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('config');
      expect(mockQueryBuilder.select).toHaveBeenCalledWith('DISTINCT config.key', 'key');
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('config.key', 'ASC');
      expect(result).toEqual(['app.version', 'database.host', 'database.port', 'redis.host']);
      expect(result).toHaveLength(4);
    });

    it('should return empty array when no configurations exist', async () => {
      // Arrange
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue([]);

      // Act
      const result = await repository.getUniqueKeys();

      // Assert
      expect(result).toEqual([]);
    });

    it('should handle single unique key', async () => {
      // Arrange
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue([{ key: 'single.key' }]);

      // Act
      const result = await repository.getUniqueKeys();

      // Assert
      expect(result).toEqual(['single.key']);
    });

    it('should throw DatabaseException on query error', async () => {
      // Arrange
      (mockQueryBuilder.getRawMany as jest.Mock).mockRejectedValue(new Error('Query execution failed'));

      // Act & Assert
      await expect(repository.getUniqueKeys()).rejects.toThrow(DatabaseException);
      await expect(repository.getUniqueKeys()).rejects.toThrow(
        'Failed to retrieve unique configuration keys',
      );
    });
  });

  describe('Edge Cases and Complex Scenarios', () => {
    it('should handle configurations with nested JSON keys', async () => {
      // Arrange
      const mockConfigs: TestRunConfiguration[] = [
        {
          id: '1',
          key: 'server.database.connection.pool.max',
          value: '100',
          created_at: new Date(),
          updated_at: new Date(),
        } as unknown as TestRunConfiguration,
      ];
      (mockRepository.find as jest.Mock).mockResolvedValue(mockConfigs);

      // Act
      const result = await repository.findByTestRunId('test-run-123');

      // Assert
      expect(result).toEqual(mockConfigs);
    });

    it('should handle configurations with special characters in values', async () => {
      // Arrange
      const configsToCreate: Partial<TestRunConfiguration>[] = [
        { testRunId: 'test-run-123', key: 'sql.query', value: "SELECT * FROM users WHERE id = '123'" },
        { testRunId: 'test-run-123', key: 'regex.pattern', value: '^[a-zA-Z0-9]+$' },
      ];
      const createdConfigs = configsToCreate.map((c, i) => ({
        id: `${i + 1}`,
        ...c,
      })) as TestRunConfiguration[];

      (mockRepository.create as jest.Mock).mockReturnValue(createdConfigs);
      (mockRepository.save as jest.Mock).mockResolvedValue(createdConfigs);

      // Act
      const result = await repository.createMany(configsToCreate);

      // Assert
      expect(result).toEqual(createdConfigs);
    });

    it('should handle null and undefined values gracefully', async () => {
      // Arrange
      (mockRepository.findOne as jest.Mock).mockResolvedValue(null);

      // Act
      const result = await repository.findByKey('test-run-123', 'non-existent');

      // Assert
      expect(result).toBeNull();
    });

    it('should handle large number of configurations', async () => {
      // Arrange
      const largeConfigSet = Array.from({ length: 1000 }, (_, i) => ({
        id: `${i}`,
        testRunId: 'test-run-123',
        key: `config.${i}`,
        value: `value-${i}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      })) as unknown as TestRunConfiguration[];

      (mockRepository.find as jest.Mock).mockResolvedValue(largeConfigSet);

      // Act
      const result = await repository.findByTestRunId('test-run-123');

      // Assert
      expect(result).toHaveLength(1000);
    });

    it('should handle empty string key search pattern', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      const result = await repository.searchByKeyPattern('');

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('config.key ILIKE :pattern', {
        pattern: '%%',
      });
      expect(result).toEqual([]);
    });

    it('should handle special SQL characters in search pattern', async () => {
      // Arrange
      const pattern = "database%_[test]'";
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.searchByKeyPattern(pattern);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('config.key ILIKE :pattern', {
        pattern: `%${pattern}%`,
      });
    });
  });

  describe('Integration Scenarios', () => {
    it('should support typical workflow: create, find, and delete', async () => {
      // Arrange
      const testRunId = 'test-run-123';
      const configsToCreate = [
        { testRunId, key: 'config1', value: 'value1' },
        { testRunId, key: 'config2', value: 'value2' },
      ];
      const createdConfigs = configsToCreate.map((c, i) => ({
        id: `${i + 1}`,
        ...c,
      })) as TestRunConfiguration[];

      (mockRepository.create as jest.Mock).mockReturnValue(createdConfigs);
      (mockRepository.save as jest.Mock).mockResolvedValue(createdConfigs);
      (mockRepository.find as jest.Mock).mockResolvedValue(createdConfigs);
      (mockQueryBuilder.execute as jest.Mock).mockResolvedValue({ affected: 2, raw: [] });

      // Act - Create
      const created = await repository.createMany(configsToCreate);
      expect(created).toHaveLength(2);

      // Act - Find
      const found = await repository.findByTestRunId(testRunId);
      expect(found).toEqual(createdConfigs);

      // Act - Delete
      const deleteCount = await repository.deleteByTestRunId(testRunId);
      expect(deleteCount).toBe(2);
    });

    it('should handle finding by key after bulk creation', async () => {
      // Arrange
      const testRunId = 'test-run-123';
      const specificKey = 'database.host';
      const configs = [
        { testRunId, key: specificKey, value: 'localhost' },
        { testRunId, key: 'database.port', value: '5432' },
      ];
      const createdConfigs = configs.map((c, i) => ({ id: `${i + 1}`, ...c })) as TestRunConfiguration[];

      (mockRepository.create as jest.Mock).mockReturnValue(createdConfigs);
      (mockRepository.save as jest.Mock).mockResolvedValue(createdConfigs);
      (mockRepository.findOne as jest.Mock).mockResolvedValue(createdConfigs[0]);

      // Act
      await repository.createMany(configs);
      const found = await repository.findByKey(testRunId, specificKey);

      // Assert
      expect(found).toEqual(createdConfigs[0]);
      expect(found?.key).toBe(specificKey);
    });
  });
});
