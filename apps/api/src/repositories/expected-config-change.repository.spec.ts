import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { ExpectedConfigChangeRepository } from './expected-config-change.repository';
import { ExpectedConfigChange } from '@perfana/shared/entities';
import { DatabaseException } from '../common/exceptions/business.exception';

describe('ExpectedConfigChangeRepository', () => {
  let repository: ExpectedConfigChangeRepository;
  let mockRepository: jest.Mocked<Partial<Repository<ExpectedConfigChange>>>;
  let mockQueryBuilder: jest.Mocked<Partial<SelectQueryBuilder<ExpectedConfigChange>>>;

  beforeEach(async () => {
    // Create mock query builder with chainable methods
    mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
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
        ExpectedConfigChangeRepository,
        {
          provide: getRepositoryToken(ExpectedConfigChange),
          useValue: mockRepository,
        },
      ],
    }).compile();

    repository = module.get<ExpectedConfigChangeRepository>(ExpectedConfigChangeRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findByContext', () => {
    it('should find expected config changes by system, environment, and workload', async () => {
      // Arrange
      const systemId = 'system-1';
      const environment = 'production';
      const workload = 'loadTest';
      const mockChanges: ExpectedConfigChange[] = [
        {
          id: '1',
          system_under_test_id: systemId,
          test_environment: environment,
          workload: workload,
          config_key: 'database.host',
          expected_value: 'prod-db.example.com',
          created_at: new Date(),
          updated_at: new Date(),
        } as ExpectedConfigChange,
        {
          id: '2',
          system_under_test_id: systemId,
          test_environment: environment,
          workload: workload,
          config_key: 'database.port',
          expected_value: '5432',
          created_at: new Date(),
          updated_at: new Date(),
        } as ExpectedConfigChange,
      ];
      (mockRepository.find as jest.Mock).mockResolvedValue(mockChanges);

      // Act
      const result = await repository.findByContext(systemId, environment, workload);

      // Assert
      expect(mockRepository.find).toHaveBeenCalledWith({
        where: {
          system_under_test_id: systemId,
          test_environment: environment,
          workload: workload,
        },
        order: { config_key: 'ASC' },
      });
      expect(result).toEqual(mockChanges);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no changes found for context', async () => {
      // Arrange
      (mockRepository.find as jest.Mock).mockResolvedValue([]);

      // Act
      const result = await repository.findByContext('system-1', 'staging', 'stressTest');

      // Assert
      expect(result).toEqual([]);
    });

    it('should throw DatabaseException on query error', async () => {
      // Arrange
      (mockRepository.find as jest.Mock).mockRejectedValue(new Error('Database connection failed'));

      // Act & Assert
      await expect(
        repository.findByContext('system-1', 'production', 'loadTest'),
      ).rejects.toThrow(DatabaseException);
      await expect(
        repository.findByContext('system-1', 'production', 'loadTest'),
      ).rejects.toThrow('Failed to retrieve expected config changes');
    });
  });

  describe('findByConfigKey', () => {
    it('should find expected config change by specific key in context', async () => {
      // Arrange
      const systemId = 'system-1';
      const environment = 'production';
      const workload = 'loadTest';
      const configKey = 'database.host';
      const mockChange: ExpectedConfigChange = {
        id: '1',
        system_under_test_id: systemId,
        test_environment: environment,
        workload: workload,
        config_key: configKey,
        expected_value: 'prod-db.example.com',
        created_at: new Date(),
        updated_at: new Date(),
      } as ExpectedConfigChange;
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockChange);

      // Act
      const result = await repository.findByConfigKey(systemId, environment, workload, configKey);

      // Assert
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: {
          system_under_test_id: systemId,
          test_environment: environment,
          workload: workload,
          config_key: configKey,
        },
      });
      expect(result).toEqual(mockChange);
    });

    it('should return null when config key not found', async () => {
      // Arrange
      (mockRepository.findOne as jest.Mock).mockResolvedValue(null);

      // Act
      const result = await repository.findByConfigKey(
        'system-1',
        'production',
        'loadTest',
        'non-existent-key',
      );

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findBySystemId', () => {
    it('should find all expected changes for a system with relations', async () => {
      // Arrange
      const systemId = 'system-1';
      const mockChanges: ExpectedConfigChange[] = [
        {
          id: '1',
          system_under_test_id: systemId,
          test_environment: 'production',
          workload: 'loadTest',
          config_key: 'config1',
          created_at: new Date(),
          updated_at: new Date(),
        } as ExpectedConfigChange,
        {
          id: '2',
          system_under_test_id: systemId,
          test_environment: 'staging',
          workload: 'stressTest',
          config_key: 'config2',
          created_at: new Date(),
          updated_at: new Date(),
        } as ExpectedConfigChange,
      ];
      (mockRepository.find as jest.Mock).mockResolvedValue(mockChanges);

      // Act
      const result = await repository.findBySystemId(systemId);

      // Assert
      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { system_under_test_id: systemId },
        relations: ['system_under_test'],
        order: { test_environment: 'ASC', workload: 'ASC', config_key: 'ASC' },
      });
      expect(result).toEqual(mockChanges);
    });

    it('should return empty array when no changes for system', async () => {
      // Arrange
      (mockRepository.find as jest.Mock).mockResolvedValue([]);

      // Act
      const result = await repository.findBySystemId('non-existent-system');

      // Assert
      expect(result).toEqual([]);
    });

    it('should throw DatabaseException on query error', async () => {
      // Arrange
      (mockRepository.find as jest.Mock).mockRejectedValue(new Error('Query failed'));

      // Act & Assert
      await expect(repository.findBySystemId('system-1')).rejects.toThrow(DatabaseException);
      await expect(repository.findBySystemId('system-1')).rejects.toThrow(
        'Failed to retrieve expected config changes',
      );
    });
  });

  describe('findByEnvironment', () => {
    it('should find expected changes for specific environment across all systems', async () => {
      // Arrange
      const environment = 'production';
      const mockChanges: ExpectedConfigChange[] = [
        {
          id: '1',
          system_under_test_id: 'system-1',
          test_environment: environment,
          workload: 'loadTest',
          config_key: 'config1',
          created_at: new Date(),
          updated_at: new Date(),
        } as ExpectedConfigChange,
        {
          id: '2',
          system_under_test_id: 'system-2',
          test_environment: environment,
          workload: 'stressTest',
          config_key: 'config2',
          created_at: new Date(),
          updated_at: new Date(),
        } as ExpectedConfigChange,
      ];
      (mockRepository.find as jest.Mock).mockResolvedValue(mockChanges);

      // Act
      const result = await repository.findByEnvironment(environment);

      // Assert
      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { test_environment: environment },
        relations: ['system_under_test'],
        order: { system_under_test_id: 'ASC', workload: 'ASC', config_key: 'ASC' },
      });
      expect(result).toEqual(mockChanges);
      expect(result).toHaveLength(2);
    });

    it('should handle different environments', async () => {
      // Arrange
      const environments = ['production', 'staging', 'development'];
      (mockRepository.find as jest.Mock).mockResolvedValue([]);

      // Act & Assert
      for (const env of environments) {
        await repository.findByEnvironment(env);
        expect(mockRepository.find).toHaveBeenCalledWith({
          where: { test_environment: env },
          relations: ['system_under_test'],
          order: { system_under_test_id: 'ASC', workload: 'ASC', config_key: 'ASC' },
        });
      }
    });

    it('should throw DatabaseException on query error', async () => {
      // Arrange
      (mockRepository.find as jest.Mock).mockRejectedValue(new Error('Environment query failed'));

      // Act & Assert
      await expect(repository.findByEnvironment('production')).rejects.toThrow(DatabaseException);
    });
  });

  describe('createMany', () => {
    it('should bulk create expected config changes', async () => {
      // Arrange
      const changesToCreate: Partial<ExpectedConfigChange>[] = [
        {
          system_under_test_id: 'system-1',
          test_environment: 'production',
          workload: 'loadTest',
          config_key: 'database.host',
          expected_value: 'prod-db.example.com',
        },
        {
          system_under_test_id: 'system-1',
          test_environment: 'production',
          workload: 'loadTest',
          config_key: 'database.port',
          expected_value: '5432',
        },
      ];

      const createdChanges = changesToCreate.map((c, i) => ({
        id: `${i + 1}`,
        ...c,
        created_at: new Date(),
        updated_at: new Date(),
      })) as unknown as ExpectedConfigChange[];

      (mockRepository.create as jest.Mock).mockReturnValue(createdChanges);
      (mockRepository.save as jest.Mock).mockResolvedValue(createdChanges);

      // Act
      const result = await repository.createMany(changesToCreate);

      // Assert
      expect(mockRepository.create).toHaveBeenCalledWith(changesToCreate);
      expect(mockRepository.save).toHaveBeenCalledWith(createdChanges);
      expect(result).toEqual(createdChanges);
      expect(result).toHaveLength(2);
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
      const changes = [
        {
          system_under_test_id: 'system-1',
          test_environment: 'production',
          workload: 'loadTest',
          config_key: 'config1',
        },
      ];
      (mockRepository.create as jest.Mock).mockReturnValue(changes as any);
      (mockRepository.save as jest.Mock).mockRejectedValue(new Error('Unique constraint violation'));

      // Act & Assert
      await expect(repository.createMany(changes)).rejects.toThrow(DatabaseException);
      await expect(repository.createMany(changes)).rejects.toThrow(
        'Failed to create expected config changes',
      );
    });
  });

  describe('deleteBySystemId', () => {
    it('should delete all expected changes for a system', async () => {
      // Arrange
      const systemId = 'system-1';
      (mockQueryBuilder.execute as jest.Mock).mockResolvedValue({ affected: 10, raw: [] });

      // Act
      const result = await repository.deleteBySystemId(systemId);

      // Assert
      expect(mockRepository.createQueryBuilder).toHaveBeenCalled();
      expect(mockQueryBuilder.delete).toHaveBeenCalled();
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('system_under_test_id = :systemId', {
        systemId,
      });
      expect(result).toBe(10);
    });

    it('should return 0 when no changes deleted', async () => {
      // Arrange
      (mockQueryBuilder.execute as jest.Mock).mockResolvedValue({ affected: undefined, raw: [] });

      // Act
      const result = await repository.deleteBySystemId('non-existent');

      // Assert
      expect(result).toBe(0);
    });

    it('should throw DatabaseException on deletion error', async () => {
      // Arrange
      (mockQueryBuilder.execute as jest.Mock).mockRejectedValue(new Error('Delete failed'));

      // Act & Assert
      await expect(repository.deleteBySystemId('system-1')).rejects.toThrow(DatabaseException);
      await expect(repository.deleteBySystemId('system-1')).rejects.toThrow(
        'Failed to delete expected config changes',
      );
    });
  });

  describe('deleteByContext', () => {
    it('should delete expected changes by specific context', async () => {
      // Arrange
      const systemId = 'system-1';
      const environment = 'production';
      const workload = 'loadTest';
      (mockQueryBuilder.execute as jest.Mock).mockResolvedValue({ affected: 5, raw: [] });

      // Act
      const result = await repository.deleteByContext(systemId, environment, workload);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('system_under_test_id = :systemId', {
        systemId,
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('test_environment = :environment', {
        environment,
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('workload = :workload', {
        workload,
      });
      expect(result).toBe(5);
    });

    it('should return 0 when no changes match context', async () => {
      // Arrange
      (mockQueryBuilder.execute as jest.Mock).mockResolvedValue({ affected: 0, raw: [] });

      // Act
      const result = await repository.deleteByContext('system-1', 'staging', 'unknown');

      // Assert
      expect(result).toBe(0);
    });

    it('should throw DatabaseException on deletion error', async () => {
      // Arrange
      (mockQueryBuilder.execute as jest.Mock).mockRejectedValue(new Error('Context delete failed'));

      // Act & Assert
      await expect(
        repository.deleteByContext('system-1', 'production', 'loadTest'),
      ).rejects.toThrow(DatabaseException);
      await expect(
        repository.deleteByContext('system-1', 'production', 'loadTest'),
      ).rejects.toThrow('Failed to delete expected config changes');
    });
  });

  describe('getUniqueEnvironments', () => {
    it('should get all unique environments ordered alphabetically', async () => {
      // Arrange
      const mockRawResults = [
        { environment: 'development' },
        { environment: 'production' },
        { environment: 'staging' },
      ];
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockRawResults);

      // Act
      const result = await repository.getUniqueEnvironments();

      // Assert
      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('ecc');
      expect(mockQueryBuilder.select).toHaveBeenCalledWith('DISTINCT ecc.test_environment', 'environment');
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('ecc.test_environment', 'ASC');
      expect(result).toEqual(['development', 'production', 'staging']);
    });

    it('should return empty array when no environments exist', async () => {
      // Arrange
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue([]);

      // Act
      const result = await repository.getUniqueEnvironments();

      // Assert
      expect(result).toEqual([]);
    });

    it('should throw DatabaseException on query error', async () => {
      // Arrange
      (mockQueryBuilder.getRawMany as jest.Mock).mockRejectedValue(new Error('Query failed'));

      // Act & Assert
      await expect(repository.getUniqueEnvironments()).rejects.toThrow(DatabaseException);
      await expect(repository.getUniqueEnvironments()).rejects.toThrow(
        'Failed to retrieve unique environments',
      );
    });
  });

  describe('getUniqueWorkloads', () => {
    it('should get unique workloads for system and environment', async () => {
      // Arrange
      const systemId = 'system-1';
      const environment = 'production';
      const mockRawResults = [
        { workload: 'loadTest' },
        { workload: 'stressTest' },
        { workload: 'soakTest' },
      ];
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockRawResults);

      // Act
      const result = await repository.getUniqueWorkloads(systemId, environment);

      // Assert
      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('ecc');
      expect(mockQueryBuilder.select).toHaveBeenCalledWith('DISTINCT ecc.workload', 'workload');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('ecc.system_under_test_id = :systemId', {
        systemId,
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('ecc.test_environment = :environment', {
        environment,
      });
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('ecc.workload', 'ASC');
      expect(result).toEqual(['loadTest', 'stressTest', 'soakTest']);
    });

    it('should return empty array when no workloads found', async () => {
      // Arrange
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue([]);

      // Act
      const result = await repository.getUniqueWorkloads('system-1', 'production');

      // Assert
      expect(result).toEqual([]);
    });

    it('should throw DatabaseException on query error', async () => {
      // Arrange
      (mockQueryBuilder.getRawMany as jest.Mock).mockRejectedValue(new Error('Workload query failed'));

      // Act & Assert
      await expect(repository.getUniqueWorkloads('system-1', 'production')).rejects.toThrow(
        DatabaseException,
      );
      await expect(repository.getUniqueWorkloads('system-1', 'production')).rejects.toThrow(
        'Failed to retrieve unique workloads',
      );
    });
  });

  describe('Integration Scenarios', () => {
    it('should support typical workflow: create, find, and delete by context', async () => {
      // Arrange
      const systemId = 'system-1';
      const environment = 'production';
      const workload = 'loadTest';
      const changesToCreate = [
        {
          system_under_test_id: systemId,
          test_environment: environment,
          workload: workload,
          config_key: 'config1',
          expected_value: 'value1',
        },
      ];
      const createdChanges = changesToCreate.map((c) => ({
        id: '1',
        ...c,
        created_at: new Date(),
        updated_at: new Date(),
      })) as unknown as ExpectedConfigChange[];

      (mockRepository.create as jest.Mock).mockReturnValue(createdChanges);
      (mockRepository.save as jest.Mock).mockResolvedValue(createdChanges);
      (mockRepository.find as jest.Mock).mockResolvedValue(createdChanges);
      (mockQueryBuilder.execute as jest.Mock).mockResolvedValue({ affected: 1, raw: [] });

      // Act - Create
      const created = await repository.createMany(changesToCreate);
      expect(created).toHaveLength(1);

      // Act - Find
      const found = await repository.findByContext(systemId, environment, workload);
      expect(found).toEqual(createdChanges);

      // Act - Delete
      const deleteCount = await repository.deleteByContext(systemId, environment, workload);
      expect(deleteCount).toBe(1);
    });

    it('should support finding by config key after creation', async () => {
      // Arrange
      const systemId = 'system-1';
      const environment = 'production';
      const workload = 'loadTest';
      const configKey = 'database.host';
      const change = {
        id: '1',
        system_under_test_id: systemId,
        test_environment: environment,
        workload: workload,
        config_key: configKey,
        expected_value: 'prod-db.example.com',
      } as ExpectedConfigChange;

      (mockRepository.create as jest.Mock).mockReturnValue([change]);
      (mockRepository.save as jest.Mock).mockResolvedValue([change]);
      (mockRepository.findOne as jest.Mock).mockResolvedValue(change);

      // Act
      await repository.createMany([change]);
      const found = await repository.findByConfigKey(systemId, environment, workload, configKey);

      // Assert
      expect(found).toEqual(change);
    });

    it('should handle multiple systems with same environment', async () => {
      // Arrange
      const environment = 'production';
      const changes: ExpectedConfigChange[] = [
        {
          id: '1',
          system_under_test_id: 'system-1',
          test_environment: environment,
          workload: 'loadTest',
          config_key: 'config1',
        } as ExpectedConfigChange,
        {
          id: '2',
          system_under_test_id: 'system-2',
          test_environment: environment,
          workload: 'loadTest',
          config_key: 'config1',
        } as ExpectedConfigChange,
      ];
      (mockRepository.find as jest.Mock).mockResolvedValue(changes);

      // Act
      const result = await repository.findByEnvironment(environment);

      // Assert
      expect(result).toHaveLength(2);
      expect(result.map(c => c.system_under_test_id)).toEqual(['system-1', 'system-2']);
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in config values', async () => {
      // Arrange
      const changes = [
        {
          system_under_test_id: 'system-1',
          test_environment: 'production',
          workload: 'loadTest',
          config_key: 'sql.query',
          expected_value: "SELECT * FROM users WHERE name = 'test'",
        },
      ];
      const created = changes.map((c, i) => ({ id: `${i}`, ...c })) as unknown as ExpectedConfigChange[];
      (mockRepository.create as jest.Mock).mockReturnValue(created);
      (mockRepository.save as jest.Mock).mockResolvedValue(created);

      // Act
      const result = await repository.createMany(changes);

      // Assert
      expect(result).toEqual(created);
    });

    it('should handle null expected values', async () => {
      // Arrange
      const changes = [
        {
          system_under_test_id: 'system-1',
          test_environment: 'production',
          workload: 'loadTest',
          config_key: 'optional.config',
          expected_value: undefined,
        },
      ];
      const created = changes.map((c, i) => ({ id: `${i}`, ...c })) as unknown as ExpectedConfigChange[];
      (mockRepository.create as jest.Mock).mockReturnValue(created);
      (mockRepository.save as jest.Mock).mockResolvedValue(created);

      // Act
      const result = await repository.createMany(changes);

      // Assert
      expect(result).toEqual(created);
    });

    it('should handle very long config keys', async () => {
      // Arrange
      const longKey = 'a'.repeat(500);
      const systemId = 'system-1';
      (mockRepository.findOne as jest.Mock).mockResolvedValue(null);

      // Act
      const result = await repository.findByConfigKey(
        systemId,
        'production',
        'loadTest',
        longKey,
      );

      // Assert
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: {
          system_under_test_id: systemId,
          test_environment: 'production',
          workload: 'loadTest',
          config_key: longKey,
        },
      });
      expect(result).toBeNull();
    });
  });
});
