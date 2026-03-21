import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { TestRunRepository, TestRunFilters } from './test-run.repository';
import { TestRun } from '@perfana/shared/entities';
import { TestRunStatus } from '@perfana/shared/types';
import { ValidationException, DatabaseException } from '../common/exceptions/business.exception';

describe('TestRunRepository', () => {
  let repository: TestRunRepository;
  let mockRepository: jest.Mocked<Partial<Repository<TestRun>>>;
  let mockQueryBuilder: jest.Mocked<Partial<SelectQueryBuilder<TestRun>>>;

  beforeEach(async () => {
    // Create mock query builder with chainable methods
    mockQueryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      whereInIds: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      distinctOn: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
      getOne: jest.fn(),
      getRawMany: jest.fn(),
      execute: jest.fn(),
      getQuery: jest.fn(),
      getParameters: jest.fn(),
    };

    mockRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      findBy: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      countBy: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestRunRepository,
        {
          provide: getRepositoryToken(TestRun),
          useValue: mockRepository,
        },
      ],
    }).compile();

    repository = module.get<TestRunRepository>(TestRunRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAllWithSystem', () => {
    const mockTestRuns: TestRun[] = [
      {
        id: '123',
        testRunId: 'PaymentService-production-loadTest-001',
        systemUnderTestId: 'system-1',
        testEnvironment: 'production',
        workload: 'loadTest',
        completed: true,
        valid: true,
        tags: ['important'],
        createdAt: new Date(),
        updatedAt: new Date(),
        configurations: [],
      } as TestRun,
    ];

    it('should find all test runs with system when no filters provided', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTestRuns);

      // Act
      const result = await repository.findAllWithSystem();

      // Assert
      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('tr');
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('tr.systemUnderTest', 'system');
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('tr.createdAt', 'DESC');
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
      expect(result).toEqual(mockTestRuns);
    });

    it('should filter by systemUnderTestId', async () => {
      // Arrange
      const filters: TestRunFilters = { systemUnderTestId: 'system-1' };
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTestRuns);

      // Act
      await repository.findAllWithSystem(filters);

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('tr.systemUnderTestId = :systemId', {
        systemId: 'system-1',
      });
    });

    it('should filter by testEnvironment', async () => {
      // Arrange
      const filters: TestRunFilters = { testEnvironment: 'production' };
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTestRuns);

      // Act
      await repository.findAllWithSystem(filters);

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('tr.testEnvironment = :env', {
        env: 'production',
      });
    });

    it('should filter by workload', async () => {
      // Arrange
      const filters: TestRunFilters = { workload: 'loadTest' };
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTestRuns);

      // Act
      await repository.findAllWithSystem(filters);

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('tr.workload = :workload', {
        workload: 'loadTest',
      });
    });

    it('should filter by completed status', async () => {
      // Arrange
      const filters: TestRunFilters = { completed: true };
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTestRuns);

      // Act
      await repository.findAllWithSystem(filters);

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('tr.completed = :completed', {
        completed: true,
      });
    });

    it('should filter by valid status', async () => {
      // Arrange
      const filters: TestRunFilters = { valid: false };
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTestRuns);

      // Act
      await repository.findAllWithSystem(filters);

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('tr.valid = :valid', {
        valid: false,
      });
    });

    it('should filter by tags using array overlap operator', async () => {
      // Arrange
      const filters: TestRunFilters = { tags: ['important', 'regression'] };
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTestRuns);

      // Act
      await repository.findAllWithSystem(filters);

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('tr.tags IS NOT NULL AND tr.tags && ARRAY[:...tags]::varchar[]', {
        tags: ['important', 'regression'],
      });
    });

    it('should not filter by tags when empty array provided', async () => {
      // Arrange
      const filters: TestRunFilters = { tags: [] };
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTestRuns);

      // Act
      await repository.findAllWithSystem(filters);

      // Assert
      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('tags'),
        expect.anything(),
      );
    });

    it('should filter by date range', async () => {
      // Arrange
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');
      const filters: TestRunFilters = { startDateFrom: startDate, startDateTo: endDate };
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTestRuns);

      // Act
      await repository.findAllWithSystem(filters);

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('tr.startTime >= :startFrom', {
        startFrom: startDate,
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('tr.startTime <= :startTo', {
        startTo: endDate,
      });
    });

    it('should apply pagination with limit and offset', async () => {
      // Arrange
      const filters: TestRunFilters = { limit: 50, offset: 100 };
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTestRuns);

      // Act
      await repository.findAllWithSystem(filters);

      // Assert
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(50);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(100);
    });

    it('should apply multiple filters simultaneously', async () => {
      // Arrange
      const filters: TestRunFilters = {
        systemUnderTestId: 'system-1',
        testEnvironment: 'production',
        workload: 'loadTest',
        completed: true,
        valid: true,
        tags: ['important'],
        limit: 10,
      };
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTestRuns);

      // Act
      await repository.findAllWithSystem(filters);

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(6);
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
    });

    it('should throw DatabaseException on query error', async () => {
      // Arrange
      const error = new Error('Database connection failed');
      (mockQueryBuilder.getMany as jest.Mock).mockRejectedValue(error);

      // Act & Assert
      await expect(repository.findAllWithSystem()).rejects.toThrow(DatabaseException);
      await expect(repository.findAllWithSystem()).rejects.toThrow('Failed to retrieve test runs');
    });
  });

  describe('findByTestRunId', () => {
    it('should find test run by testRunId with relations', async () => {
      // Arrange
      const testRunId = 'PaymentService-production-loadTest-001';
      const mockTestRun = { id: '123', testRunId } as TestRun;
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockTestRun);

      // Act
      const result = await repository.findByTestRunId(testRunId);

      // Assert
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { testRunId },
        relations: ['systemUnderTest', 'configurations'],
      });
      expect(result).toEqual(mockTestRun);
    });

    it('should return null when test run not found', async () => {
      // Arrange
      (mockRepository.findOne as jest.Mock).mockResolvedValue(null);

      // Act
      const result = await repository.findByTestRunId('non-existent');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findByContext', () => {
    it('should find test runs by system, environment, and workload', async () => {
      // Arrange
      const systemId = 'system-1';
      const environment = 'production';
      const workload = 'loadTest';
      const mockTestRuns = [{ id: '123' } as TestRun];
      (mockRepository.findBy as jest.Mock).mockResolvedValue(mockTestRuns);

      // Act
      const result = await repository.findByContext(systemId, environment, workload);

      // Assert
      expect(mockRepository.findBy).toHaveBeenCalledWith({
        systemUnderTestId: systemId,
        testEnvironment: environment,
        workload: workload,
      });
      expect(result).toEqual(mockTestRuns);
    });
  });

  describe('findRunning', () => {
    it('should find all running (not completed) test runs', async () => {
      // Arrange
      const mockTestRuns = [
        { id: '1', completed: false } as TestRun,
        { id: '2', completed: false } as TestRun,
      ];
      (mockRepository.find as jest.Mock).mockResolvedValue(mockTestRuns);

      // Act
      const result = await repository.findRunning();

      // Assert
      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { completed: false },
        relations: ['systemUnderTest'],
        order: { createdAt: 'DESC' },
      });
      expect(result).toEqual(mockTestRuns);
    });
  });

  describe('findByDateRange', () => {
    it('should find test runs within date range', async () => {
      // Arrange
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');
      const mockTestRuns = [{ id: '123' } as TestRun];
      (mockRepository.find as jest.Mock).mockResolvedValue(mockTestRuns);

      // Act
      const result = await repository.findByDateRange(startDate, endDate);

      // Assert
      expect(mockRepository.find).toHaveBeenCalledWith({
        where: {
          startTime: expect.objectContaining({
            _type: 'between',
            _value: [startDate, endDate],
            _useParameter: true,
            _multipleParameters: true,
          }),
        },
        relations: ['systemUnderTest'],
        order: { startTime: 'ASC' },
      });
      expect(result).toEqual(mockTestRuns);
    });
  });

  describe('findByTags', () => {
    it('should find test runs by tags using query builder', async () => {
      // Arrange
      const tags = ['important', 'regression'];
      const mockTestRuns = [{ id: '123' } as TestRun];
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTestRuns);

      // Act
      const result = await repository.findByTags(tags);

      // Assert
      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('tr');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('tr.tags IS NOT NULL AND tr.tags && ARRAY[:...tags]::varchar[]', {
        tags,
      });
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('tr.systemUnderTest', 'system');
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('tr.createdAt', 'DESC');
      expect(result).toEqual(mockTestRuns);
    });

    it('should return empty array for empty tags without calling query builder', async () => {
      // Act
      const result = await repository.findByTags([]);

      // Assert
      expect(result).toEqual([]);
      expect(mockRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should throw DatabaseException on query error', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockRejectedValue(new Error('Query failed'));

      // Act & Assert
      await expect(repository.findByTags(['tag1'])).rejects.toThrow(DatabaseException);
    });
  });

  describe('findExpired', () => {
    it('should find expired test runs', async () => {
      // Arrange
      const mockTestRuns = [
        { id: '1', expired: true, expires: new Date() } as TestRun,
      ];
      (mockRepository.find as jest.Mock).mockResolvedValue(mockTestRuns);

      // Act
      const result = await repository.findExpired();

      // Assert
      expect(mockRepository.find).toHaveBeenCalledWith({
        where: {
          expires: expect.objectContaining({ _type: 'not', _value: expect.anything() }),
          expired: true,
        },
        order: { expires: 'DESC' },
      });
      expect(result).toEqual(mockTestRuns);
    });
  });

  describe('getStatsBySystem', () => {
    it('should calculate statistics by system', async () => {
      // Arrange
      const mockStats = [
        {
          systemId: 'system-1',
          totalRuns: '100',
          completedRuns: '90',
          avgDuration: '3600',
          p95Duration: '4200',
        },
      ];
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockStats);

      // Act
      const result = await repository.getStatsBySystem();

      // Assert
      expect(mockQueryBuilder.select).toHaveBeenCalledWith('tr.systemUnderTestId', 'systemId');
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith('COUNT(tr.id)::int', 'totalRuns');
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        'COUNT(CASE WHEN tr.completed = true THEN 1 END)::int',
        'completedRuns',
      );
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith('AVG(tr.duration)::float', 'avgDuration');
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        'PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY tr.duration)::float',
        'p95Duration',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('tr.duration IS NOT NULL');
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith('tr.systemUnderTestId');
      expect(result).toEqual(mockStats);
    });

    it('should filter stats by specific system IDs', async () => {
      // Arrange
      const systemIds = ['system-1', 'system-2'];
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.getStatsBySystem(systemIds);

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'tr.systemUnderTestId IN (:...systemIds)',
        { systemIds },
      );
    });

    it('should throw DatabaseException on query error', async () => {
      // Arrange
      (mockQueryBuilder.getRawMany as jest.Mock).mockRejectedValue(new Error('Stats query failed'));

      // Act & Assert
      await expect(repository.getStatsBySystem()).rejects.toThrow(DatabaseException);
      await expect(repository.getStatsBySystem()).rejects.toThrow(
        'Failed to retrieve test run statistics',
      );
    });
  });

  describe('getLatestPerSystem', () => {
    it('should get latest test run per system', async () => {
      // Arrange
      const mockTestRuns = [{ id: '1', systemUnderTestId: 'system-1' } as TestRun];
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTestRuns);

      // Act
      const result = await repository.getLatestPerSystem();

      // Assert
      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('tr');
      expect(mockQueryBuilder.distinctOn).toHaveBeenCalledWith(['tr.systemUnderTestId']);
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('tr.systemUnderTest', 'system');
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('tr.systemUnderTestId', 'ASC');
      expect(mockQueryBuilder.addOrderBy).toHaveBeenCalledWith('tr.createdAt', 'DESC');
      expect(result).toEqual(mockTestRuns);
    });

    it('should filter by specific system IDs', async () => {
      // Arrange
      const systemIds = ['system-1', 'system-2'];
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.getLatestPerSystem(systemIds);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'tr.systemUnderTestId IN (:...systemIds)',
        { systemIds },
      );
    });

    it('should throw DatabaseException on error', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockRejectedValue(
        new Error('Query failed'),
      );

      // Act & Assert
      await expect(repository.getLatestPerSystem()).rejects.toThrow(DatabaseException);
      await expect(repository.getLatestPerSystem()).rejects.toThrow(
        'Failed to retrieve latest test runs',
      );
    });
  });

  describe('search', () => {
    it('should search test runs by keyword', async () => {
      // Arrange
      const searchTerm = 'payment';
      const mockTestRuns = [{ id: '123', testRunId: 'PaymentService' } as TestRun];
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTestRuns);

      // Act
      const result = await repository.search(searchTerm);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        '(tr.testRunId ILIKE :search OR system.name ILIKE :search OR tr.testEnvironment ILIKE :search OR tr.workload ILIKE :search)',
        { search: `%${searchTerm}%` },
      );
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(50);
      expect(result).toEqual(mockTestRuns);
    });

    it('should apply custom limit', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.search('test', 100);

      // Assert
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(100);
    });

    it('should throw DatabaseException on error', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockRejectedValue(new Error('Search failed'));

      // Act & Assert
      await expect(repository.search('test')).rejects.toThrow(DatabaseException);
    });
  });

  describe('markCompleted', () => {
    it('should mark test run as completed', async () => {
      // Arrange
      const testRunId = '123';
      const endTime = new Date();
      const duration = 3600;
      const updatedTestRun = { id: testRunId, completed: true, endTime, duration } as TestRun;

      (mockRepository.update as jest.Mock).mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(updatedTestRun);

      // Act
      const result = await repository.markCompleted(testRunId, endTime, duration);

      // Assert
      expect(mockRepository.update).toHaveBeenCalledWith(testRunId, {
        completed: true,
        endTime,
        duration,
      });
      expect(result).toEqual(updatedTestRun);
    });
  });

  describe('markAborted', () => {
    it('should mark test run as aborted', async () => {
      // Arrange
      const testRunId = '123';
      const updatedTestRun = { id: testRunId, abort: true, completed: true } as TestRun;

      (mockRepository.update as jest.Mock).mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(updatedTestRun);

      // Act
      const result = await repository.markAborted(testRunId);

      // Assert
      expect(mockRepository.update).toHaveBeenCalledWith(testRunId, {
        abort: true,
        completed: true,
        endTime: expect.any(Date),
      });
      expect(result).toEqual(updatedTestRun);
    });
  });

  describe('updateStatus', () => {
    it('should update test run status', async () => {
      // Arrange
      const testRunId = '123';
      const status: TestRunStatus = { evaluatingAdapt: 'COMPLETED' };
      const updatedTestRun = { id: testRunId, status } as TestRun;

      (mockRepository.update as jest.Mock).mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(updatedTestRun);

      // Act
      const result = await repository.updateStatus(testRunId, status);

      // Assert
      expect(mockRepository.update).toHaveBeenCalledWith(testRunId, { status });
      expect(result).toEqual(updatedTestRun);
    });
  });

  describe('groupByEnvironment', () => {
    it('should group test runs by environment', async () => {
      // Arrange
      const mockGroups = [
        { environment: 'production', count: '10', avgDuration: '3600' },
        { environment: 'staging', count: '5', avgDuration: '3000' },
      ];
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockGroups);

      // Act
      const result = await repository.groupByEnvironment();

      // Assert
      expect(mockQueryBuilder.select).toHaveBeenCalledWith('tr.testEnvironment', 'environment');
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith('COUNT(tr.id)::int', 'count');
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith('AVG(tr.duration)::float', 'avgDuration');
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith('tr.testEnvironment');
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('count', 'DESC');
      expect(result).toEqual(mockGroups);
    });

    it('should filter by system ID', async () => {
      // Arrange
      const systemId = 'system-1';
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.groupByEnvironment(systemId);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('tr.systemUnderTestId = :systemId', {
        systemId,
      });
    });

    it('should throw DatabaseException on error', async () => {
      // Arrange
      (mockQueryBuilder.getRawMany as jest.Mock).mockRejectedValue(new Error('Grouping failed'));

      // Act & Assert
      await expect(repository.groupByEnvironment()).rejects.toThrow(DatabaseException);
    });
  });

  describe('deleteOlderThan', () => {
    it('should delete test runs older than specified date', async () => {
      // Arrange
      const cutoffDate = new Date('2024-01-01');
      (mockQueryBuilder.execute as jest.Mock).mockResolvedValue({ affected: 42, raw: [] });

      // Act
      const result = await repository.deleteOlderThan(cutoffDate);

      // Assert
      expect(mockRepository.createQueryBuilder).toHaveBeenCalled();
      expect(mockQueryBuilder.delete).toHaveBeenCalled();
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('createdAt < :date', { date: cutoffDate });
      expect(result).toBe(42);
    });

    it('should return 0 when no test runs deleted', async () => {
      // Arrange
      (mockQueryBuilder.execute as jest.Mock).mockResolvedValue({ affected: undefined, raw: [] });

      // Act
      const result = await repository.deleteOlderThan(new Date());

      // Assert
      expect(result).toBe(0);
    });

    it('should throw DatabaseException on error', async () => {
      // Arrange
      (mockQueryBuilder.execute as jest.Mock).mockRejectedValue(new Error('Delete failed'));

      // Act & Assert
      await expect(repository.deleteOlderThan(new Date())).rejects.toThrow(DatabaseException);
    });
  });

  describe('findByStatusField - SQL Injection Prevention', () => {
    it('should allow valid field name "evaluatingAdapt"', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findByStatusField('evaluatingAdapt', 'COMPLETED');

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "tr.status->>'evaluatingAdapt' = :value",
        { value: 'COMPLETED' },
      );
    });

    it('should reject SQL injection attempt with DROP TABLE', async () => {
      // Arrange
      const maliciousInput = "'; DROP TABLE test_runs; --";

      // Act & Assert
      await expect(repository.findByStatusField(maliciousInput, 'any')).rejects.toThrow(
        ValidationException,
      );
      await expect(repository.findByStatusField(maliciousInput, 'any')).rejects.toThrow(
        `Invalid status field: '${maliciousInput}'. Allowed fields: evaluatingAdapt`,
      );
    });

    it('should reject SQL injection attempt with UNION SELECT', async () => {
      // Arrange
      const maliciousInput = "' UNION SELECT * FROM users WHERE '1'='1";

      // Act & Assert
      await expect(repository.findByStatusField(maliciousInput, 'any')).rejects.toThrow(
        ValidationException,
      );
    });

    it('should reject non-whitelisted valid-looking field names', async () => {
      // Arrange
      const invalidField = 'someOtherField';

      // Act & Assert
      await expect(repository.findByStatusField(invalidField, 'value')).rejects.toThrow(
        ValidationException,
      );
    });

    it('should handle null and special characters in field value safely', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act & Assert
      await expect(
        repository.findByStatusField('evaluatingAdapt', null),
      ).resolves.not.toThrow();

      await expect(
        repository.findByStatusField('evaluatingAdapt', "'; DROP TABLE test_runs; --"),
      ).resolves.not.toThrow();
    });

    it('should handle empty string field name', async () => {
      // Act & Assert
      await expect(repository.findByStatusField('', 'value')).rejects.toThrow(ValidationException);
    });

    it('should handle various SQL injection patterns', async () => {
      // Arrange
      const sqlInjectionPatterns = [
        "1' OR '1'='1",
        "1; DROP TABLE test_runs--",
        "1' AND 1=1--",
        "' OR 1=1--",
        "admin'--",
        "' OR 'x'='x",
      ];

      // Act & Assert
      for (const pattern of sqlInjectionPatterns) {
        await expect(repository.findByStatusField(pattern, 'value')).rejects.toThrow(
          ValidationException,
        );
      }
    });

    it('should throw DatabaseException on query error after validation', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(repository.findByStatusField('evaluatingAdapt', 'COMPLETED')).rejects.toThrow(
        DatabaseException,
      );
    });
  });

  describe('countByWorkload', () => {
    it('should count test runs by workload', async () => {
      // Arrange
      const systemId = 'system-1';
      const environment = 'production';
      const mockResults = [
        { workload: 'loadTest', count: '10' },
        { workload: 'stressTest', count: '5' },
      ];
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockResults);

      // Act
      const result = await repository.countByWorkload(systemId, environment);

      // Assert
      expect(mockQueryBuilder.select).toHaveBeenCalledWith('tr.workload', 'workload');
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith('COUNT(tr.id)::int', 'count');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('tr.systemUnderTestId = :systemId', {
        systemId,
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('tr.testEnvironment = :environment', {
        environment,
      });
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith('tr.workload');

      expect(result).toBeInstanceOf(Map);
      expect(result.get('loadTest')).toBe(10);
      expect(result.get('stressTest')).toBe(5);
    });

    it('should return empty map when no workloads found', async () => {
      // Arrange
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue([]);

      // Act
      const result = await repository.countByWorkload('system-1', 'production');

      // Assert
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it('should throw DatabaseException on error', async () => {
      // Arrange
      (mockQueryBuilder.getRawMany as jest.Mock).mockRejectedValue(new Error('Count failed'));

      // Act & Assert
      await expect(repository.countByWorkload('system-1', 'production')).rejects.toThrow(
        DatabaseException,
      );
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle undefined filters gracefully', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findAllWithSystem(undefined);

      // Assert
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
    });

    it('should handle empty result sets', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      const result = await repository.search('nonexistent');

      // Assert
      expect(result).toEqual([]);
    });

    it('should handle null query builder results', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(null as any);

      // Act
      const result = await repository.findByTags(['tag']);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findAllWithSystem - Additional Edge Cases', () => {
    it('should handle completed=false filter correctly', async () => {
      // Arrange
      const filters: TestRunFilters = { completed: false };
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findAllWithSystem(filters);

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('tr.completed = :completed', {
        completed: false,
      });
    });

    it('should handle valid=false filter correctly', async () => {
      // Arrange
      const filters: TestRunFilters = { valid: false };
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findAllWithSystem(filters);

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('tr.valid = :valid', {
        valid: false,
      });
    });

    it('should apply only startDateFrom filter without startDateTo', async () => {
      // Arrange
      const startDate = new Date('2024-01-01');
      const filters: TestRunFilters = { startDateFrom: startDate };
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findAllWithSystem(filters);

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('tr.startTime >= :startFrom', {
        startFrom: startDate,
      });
      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalledWith(
        'tr.startTime <= :startTo',
        expect.anything(),
      );
    });

    it('should apply only startDateTo filter without startDateFrom', async () => {
      // Arrange
      const endDate = new Date('2024-12-31');
      const filters: TestRunFilters = { startDateTo: endDate };
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findAllWithSystem(filters);

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('tr.startTime <= :startTo', {
        startTo: endDate,
      });
      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalledWith(
        'tr.startTime >= :startFrom',
        expect.anything(),
      );
    });

    it('should apply only limit without offset', async () => {
      // Arrange
      const filters: TestRunFilters = { limit: 25 };
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findAllWithSystem(filters);

      // Assert
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(25);
      expect(mockQueryBuilder.offset).not.toHaveBeenCalled();
    });

    it('should apply only offset without limit', async () => {
      // Arrange
      const filters: TestRunFilters = { offset: 50 };
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findAllWithSystem(filters);

      // Assert
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(50);
      expect(mockQueryBuilder.limit).not.toHaveBeenCalled();
    });

    it('should handle database timeout errors', async () => {
      // Arrange
      const timeoutError = new Error('Query timeout exceeded');
      (mockQueryBuilder.getMany as jest.Mock).mockRejectedValue(timeoutError);

      // Act & Assert
      await expect(repository.findAllWithSystem()).rejects.toThrow(DatabaseException);
      await expect(repository.findAllWithSystem()).rejects.toThrow('Failed to retrieve test runs');
    });

    it('should handle single tag in array', async () => {
      // Arrange
      const filters: TestRunFilters = { tags: ['single-tag'] };
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findAllWithSystem(filters);

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('tr.tags IS NOT NULL AND tr.tags && ARRAY[:...tags]::varchar[]', {
        tags: ['single-tag'],
      });
    });
  });

  describe('getStatsBySystem - Additional Edge Cases', () => {
    it('should handle empty systemIds array', async () => {
      // Arrange
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.getStatsBySystem([]);

      // Assert
      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalledWith(
        'tr.systemUnderTestId IN (:...systemIds)',
        expect.anything(),
      );
    });

    it('should handle single system ID', async () => {
      // Arrange
      const systemIds = ['system-1'];
      const mockStats = [
        {
          systemId: 'system-1',
          totalRuns: '50',
          completedRuns: '45',
          avgDuration: '2500',
          p95Duration: '3000',
        },
      ];
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockStats);

      // Act
      const result = await repository.getStatsBySystem(systemIds);

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'tr.systemUnderTestId IN (:...systemIds)',
        { systemIds },
      );
      expect(result).toEqual(mockStats);
    });

    it('should handle stats with zero completed runs', async () => {
      // Arrange
      const mockStats = [
        {
          systemId: 'system-1',
          totalRuns: '10',
          completedRuns: '0',
          avgDuration: null as any,
          p95Duration: null as any,
        },
      ];
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockStats);

      // Act
      const result = await repository.getStatsBySystem();

      // Assert
      expect(result).toEqual(mockStats);
    });
  });

  describe('getLatestPerSystem - Additional Edge Cases', () => {
    it('should handle empty systemIds array', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.getLatestPerSystem([]);

      // Assert - with empty array, where should not be called
      expect(mockQueryBuilder.where).not.toHaveBeenCalled();
      expect(mockQueryBuilder.distinctOn).toHaveBeenCalledWith(['tr.systemUnderTestId']);
    });

    it('should filter by systemIds when provided', async () => {
      // Arrange
      const systemIds = ['system-1'];
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.getLatestPerSystem(systemIds);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'tr.systemUnderTestId IN (:...systemIds)',
        { systemIds },
      );
    });

    it('should handle multiple systems with same latest date', async () => {
      // Arrange
      const mockTestRuns = [
        { id: '1', systemUnderTestId: 'system-1', createdAt: new Date() } as TestRun,
        { id: '2', systemUnderTestId: 'system-2', createdAt: new Date() } as TestRun,
      ];
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTestRuns);

      // Act
      const result = await repository.getLatestPerSystem();

      // Assert
      expect(result).toEqual(mockTestRuns);
      expect(result.length).toBe(2);
      expect(mockQueryBuilder.distinctOn).toHaveBeenCalledWith(['tr.systemUnderTestId']);
    });
  });

  describe('search - Additional Edge Cases', () => {
    it('should handle special characters in search term', async () => {
      // Arrange
      const searchTerm = "test'run%_special";
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.search(searchTerm);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        expect.stringContaining('ILIKE'),
        { search: `%${searchTerm}%` },
      );
    });

    it('should handle empty search term', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      const result = await repository.search('');

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        expect.any(String),
        { search: '%%' },
      );
      expect(result).toEqual([]);
    });

    it('should handle limit of 0', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.search('test', 0);

      // Assert
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(0);
    });

    it('should search across multiple fields', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.search('production');

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        expect.stringContaining('tr.testRunId ILIKE :search'),
        expect.anything(),
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        expect.stringContaining('system.name ILIKE :search'),
        expect.anything(),
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        expect.stringContaining('tr.testEnvironment ILIKE :search'),
        expect.anything(),
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        expect.stringContaining('tr.workload ILIKE :search'),
        expect.anything(),
      );
    });
  });

  describe('markCompleted - Additional Edge Cases', () => {
    it('should handle zero duration', async () => {
      // Arrange
      const testRunId = '123';
      const endTime = new Date();
      const duration = 0;
      const updatedTestRun = { id: testRunId, completed: true, endTime, duration } as TestRun;

      (mockRepository.update as jest.Mock).mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(updatedTestRun);

      // Act
      const result = await repository.markCompleted(testRunId, endTime, duration);

      // Assert
      expect(mockRepository.update).toHaveBeenCalledWith(testRunId, {
        completed: true,
        endTime,
        duration: 0,
      });
      expect(result).toEqual(updatedTestRun);
    });

    it('should handle negative duration (edge case)', async () => {
      // Arrange
      const testRunId = '123';
      const endTime = new Date();
      const duration = -100;
      const updatedTestRun = { id: testRunId, completed: true, endTime, duration } as TestRun;

      (mockRepository.update as jest.Mock).mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(updatedTestRun);

      // Act
      const result = await repository.markCompleted(testRunId, endTime, duration);

      // Assert
      expect(result.duration).toBe(duration);
    });

    it('should handle future endTime', async () => {
      // Arrange
      const testRunId = '123';
      const futureEndTime = new Date(Date.now() + 86400000); // Tomorrow
      const duration = 3600;
      const updatedTestRun = { id: testRunId, completed: true, endTime: futureEndTime, duration } as TestRun;

      (mockRepository.update as jest.Mock).mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(updatedTestRun);

      // Act
      const result = await repository.markCompleted(testRunId, futureEndTime, duration);

      // Assert
      expect(result.endTime).toEqual(futureEndTime);
    });
  });

  describe('markAborted - Additional Edge Cases', () => {
    it('should set endTime to current time when marking aborted', async () => {
      // Arrange
      const testRunId = '123';
      const beforeCall = new Date();
      const updatedTestRun = {
        id: testRunId,
        abort: true,
        completed: true,
        endTime: new Date()
      } as TestRun;

      (mockRepository.update as jest.Mock).mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(updatedTestRun);

      // Act
      await repository.markAborted(testRunId);
      const afterCall = new Date();

      // Assert
      const updateCall = (mockRepository.update as jest.Mock).mock.calls[0];
      const updateData = updateCall[1];
      expect(updateData.endTime).toBeInstanceOf(Date);
      expect(updateData.endTime.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
      expect(updateData.endTime.getTime()).toBeLessThanOrEqual(afterCall.getTime());
    });

    it('should mark both abort and completed as true', async () => {
      // Arrange
      const testRunId = '123';
      const updatedTestRun = { id: testRunId, abort: true, completed: true } as TestRun;

      (mockRepository.update as jest.Mock).mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(updatedTestRun);

      // Act
      await repository.markAborted(testRunId);

      // Assert
      const updateCall = (mockRepository.update as jest.Mock).mock.calls[0];
      const updateData = updateCall[1];
      expect(updateData.abort).toBe(true);
      expect(updateData.completed).toBe(true);
    });
  });

  describe('updateStatus - Additional Edge Cases', () => {
    it('should handle complex status object', async () => {
      // Arrange
      const testRunId = '123';
      const status: TestRunStatus = {
        evaluatingAdapt: 'EVALUATING',
      };
      const updatedTestRun = { id: testRunId, status } as TestRun;

      (mockRepository.update as jest.Mock).mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(updatedTestRun);

      // Act
      const result = await repository.updateStatus(testRunId, status);

      // Assert
      expect(result.status).toEqual(status);
    });

    it('should handle empty status object', async () => {
      // Arrange
      const testRunId = '123';
      const status: TestRunStatus = {};
      const updatedTestRun = { id: testRunId, status } as TestRun;

      (mockRepository.update as jest.Mock).mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      (mockRepository.findOne as jest.Mock).mockResolvedValue(updatedTestRun);

      // Act
      const result = await repository.updateStatus(testRunId, status);

      // Assert
      expect(result.status).toEqual({});
    });
  });

  describe('groupByEnvironment - Additional Edge Cases', () => {
    it('should handle null avgDuration values', async () => {
      // Arrange
      const mockGroups = [
        { environment: 'production', count: '10', avgDuration: null },
        { environment: 'staging', count: '5', avgDuration: '2500' },
      ];
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockGroups);

      // Act
      const result = await repository.groupByEnvironment();

      // Assert
      expect(result).toEqual(mockGroups);
      expect(result[0]?.avgDuration).toBeNull();
    });

    it('should order by count descending', async () => {
      // Arrange
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.groupByEnvironment();

      // Assert
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('count', 'DESC');
    });

    it('should not filter by systemId when undefined', async () => {
      // Arrange
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.groupByEnvironment(undefined);

      // Assert
      expect(mockQueryBuilder.where).not.toHaveBeenCalled();
    });
  });

  describe('deleteOlderThan - Additional Edge Cases', () => {
    it('should handle deletion with affected = 0', async () => {
      // Arrange
      const cutoffDate = new Date('2024-01-01');
      (mockQueryBuilder.execute as jest.Mock).mockResolvedValue({ affected: 0, raw: [] });

      // Act
      const result = await repository.deleteOlderThan(cutoffDate);

      // Assert
      expect(result).toBe(0);
    });

    it('should handle deletion with large affected count', async () => {
      // Arrange
      const cutoffDate = new Date('2024-01-01');
      (mockQueryBuilder.execute as jest.Mock).mockResolvedValue({ affected: 10000, raw: [] });

      // Act
      const result = await repository.deleteOlderThan(cutoffDate);

      // Assert
      expect(result).toBe(10000);
    });

    it('should handle constraint violation error', async () => {
      // Arrange
      const constraintError = new Error('Foreign key constraint violation');
      (mockQueryBuilder.execute as jest.Mock).mockRejectedValue(constraintError);

      // Act & Assert
      await expect(repository.deleteOlderThan(new Date())).rejects.toThrow(DatabaseException);
      await expect(repository.deleteOlderThan(new Date())).rejects.toThrow('Failed to delete test runs');
    });

    it('should handle very old dates', async () => {
      // Arrange
      const veryOldDate = new Date('1970-01-01');
      (mockQueryBuilder.execute as jest.Mock).mockResolvedValue({ affected: 100, raw: [] });

      // Act
      const result = await repository.deleteOlderThan(veryOldDate);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('createdAt < :date', { date: veryOldDate });
      expect(result).toBe(100);
    });
  });

  describe('findByStatusField - Additional Edge Cases', () => {
    it('should handle boolean field values', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findByStatusField('evaluatingAdapt', true);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "tr.status->>'evaluatingAdapt' = :value",
        { value: 'true' },
      );
    });

    it('should handle numeric field values', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findByStatusField('evaluatingAdapt', 42);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "tr.status->>'evaluatingAdapt' = :value",
        { value: '42' },
      );
    });

    it('should convert all values to strings', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findByStatusField('evaluatingAdapt', false);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "tr.status->>'evaluatingAdapt' = :value",
        { value: 'false' },
      );
    });

    it('should handle case-sensitive field name validation', async () => {
      // Arrange & Act & Assert
      await expect(repository.findByStatusField('EvaluatingAdapt', 'value')).rejects.toThrow(
        ValidationException,
      );
    });

    it('should include system relation in results', async () => {
      // Arrange
      const mockTestRuns = [
        { id: '1', status: { evaluatingAdapt: 'COMPLETED' }, systemUnderTest: {} } as TestRun,
      ];
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(mockTestRuns);

      // Act
      await repository.findByStatusField('evaluatingAdapt', 'COMPLETED');

      // Assert
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('tr.systemUnderTest', 'system');
    });
  });

  describe('countByWorkload - Additional Edge Cases', () => {
    it('should handle workloads with zero counts', async () => {
      // Arrange
      const mockResults = [
        { workload: 'loadTest', count: '0' },
      ];
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockResults);

      // Act
      const result = await repository.countByWorkload('system-1', 'production');

      // Assert
      expect(result.get('loadTest')).toBe(0);
    });

    it('should parse string counts to integers', async () => {
      // Arrange
      const mockResults = [
        { workload: 'loadTest', count: '123' },
        { workload: 'stressTest', count: '456' },
      ];
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockResults);

      // Act
      const result = await repository.countByWorkload('system-1', 'production');

      // Assert
      expect(result.get('loadTest')).toBe(123);
      expect(result.get('stressTest')).toBe(456);
      expect(typeof result.get('loadTest')).toBe('number');
    });

    it('should handle workloads with special characters in names', async () => {
      // Arrange
      const mockResults = [
        { workload: 'load-test_v2.0', count: '10' },
      ];
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockResults);

      // Act
      const result = await repository.countByWorkload('system-1', 'production');

      // Assert
      expect(result.get('load-test_v2.0')).toBe(10);
    });

    it('should group by workload correctly', async () => {
      // Arrange
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.countByWorkload('system-1', 'production');

      // Assert
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith('tr.workload');
    });

    it('should filter by both systemId and environment', async () => {
      // Arrange
      const systemId = 'test-system';
      const environment = 'staging';
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.countByWorkload(systemId, environment);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('tr.systemUnderTestId = :systemId', {
        systemId,
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('tr.testEnvironment = :environment', {
        environment,
      });
    });
  });

  describe('findByContext - Edge Cases', () => {
    it('should handle empty result set', async () => {
      // Arrange
      (mockRepository.findBy as jest.Mock).mockResolvedValue([]);

      // Act
      const result = await repository.findByContext('system-1', 'production', 'loadTest');

      // Assert
      expect(result).toEqual([]);
    });

    it('should handle special characters in parameters', async () => {
      // Arrange
      const systemId = 'system-with-dashes-123';
      const environment = 'pre-production_v2';
      const workload = 'stress-test.v1';
      (mockRepository.findBy as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findByContext(systemId, environment, workload);

      // Assert
      expect(mockRepository.findBy).toHaveBeenCalledWith({
        systemUnderTestId: systemId,
        testEnvironment: environment,
        workload: workload,
      });
    });
  });

  describe('findRunning - Edge Cases', () => {
    it('should return empty array when no running tests', async () => {
      // Arrange
      (mockRepository.find as jest.Mock).mockResolvedValue([]);

      // Act
      const result = await repository.findRunning();

      // Assert
      expect(result).toEqual([]);
    });

    it('should order by createdAt DESC', async () => {
      // Arrange
      (mockRepository.find as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findRunning();

      // Assert
      expect(mockRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { createdAt: 'DESC' },
        }),
      );
    });
  });

  describe('findByDateRange - Edge Cases', () => {
    it('should handle same start and end date', async () => {
      // Arrange
      const sameDate = new Date('2024-06-15');
      (mockRepository.find as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findByDateRange(sameDate, sameDate);

      // Assert
      expect(mockRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            startTime: expect.objectContaining({
              _type: 'between',
              _value: [sameDate, sameDate],
            }),
          },
        }),
      );
    });

    it('should order by startTime ASC', async () => {
      // Arrange
      (mockRepository.find as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findByDateRange(new Date('2024-01-01'), new Date('2024-12-31'));

      // Assert
      expect(mockRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { startTime: 'ASC' },
        }),
      );
    });

    it('should handle reversed date range (end before start)', async () => {
      // Arrange
      const startDate = new Date('2024-12-31');
      const endDate = new Date('2024-01-01');
      (mockRepository.find as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findByDateRange(startDate, endDate);

      // Assert - Repository doesn't validate date order, passes through
      expect(mockRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            startTime: expect.objectContaining({
              _value: [startDate, endDate],
            }),
          },
        }),
      );
    });
  });

  describe('findExpired - Edge Cases', () => {
    it('should find only expired runs with non-null expires date', async () => {
      // Arrange
      (mockRepository.find as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findExpired();

      // Assert
      expect(mockRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            expires: expect.objectContaining({ _type: 'not' }),
            expired: true,
          },
        }),
      );
    });

    it('should order by expires DESC', async () => {
      // Arrange
      (mockRepository.find as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findExpired();

      // Assert
      expect(mockRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { expires: 'DESC' },
        }),
      );
    });
  });

  describe('Database Connection and Error Scenarios', () => {
    it('should handle database connection loss in findAllWithSystem', async () => {
      // Arrange
      const connectionError = new Error('Connection lost to database');
      (mockQueryBuilder.getMany as jest.Mock).mockRejectedValue(connectionError);

      // Act & Assert
      await expect(repository.findAllWithSystem()).rejects.toThrow(DatabaseException);
    });

    it('should handle database connection loss in search', async () => {
      // Arrange
      const connectionError = new Error('ECONNREFUSED');
      (mockQueryBuilder.getMany as jest.Mock).mockRejectedValue(connectionError);

      // Act & Assert
      await expect(repository.search('test')).rejects.toThrow(DatabaseException);
    });

    it('should handle database connection loss in groupByEnvironment', async () => {
      // Arrange
      const connectionError = new Error('Database server is not available');
      (mockQueryBuilder.getRawMany as jest.Mock).mockRejectedValue(connectionError);

      // Act & Assert
      await expect(repository.groupByEnvironment()).rejects.toThrow(DatabaseException);
    });

    it('should handle database connection loss in countByWorkload', async () => {
      // Arrange
      const connectionError = new Error('Connection timeout');
      (mockQueryBuilder.getRawMany as jest.Mock).mockRejectedValue(connectionError);

      // Act & Assert
      await expect(repository.countByWorkload('system-1', 'prod')).rejects.toThrow(DatabaseException);
    });
  });

  describe('Query Builder Chain Verification', () => {
    it('should chain query builder methods in findAllWithSystem', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.findAllWithSystem();

      // Assert - Verify method chaining
      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('tr');
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveReturnedWith(mockQueryBuilder);
      expect(mockQueryBuilder.orderBy).toHaveReturnedWith(mockQueryBuilder);
    });

    it('should chain query builder methods in search', async () => {
      // Arrange
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.search('test');

      // Assert
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveReturnedWith(mockQueryBuilder);
      expect(mockQueryBuilder.where).toHaveReturnedWith(mockQueryBuilder);
      expect(mockQueryBuilder.orderBy).toHaveReturnedWith(mockQueryBuilder);
      expect(mockQueryBuilder.limit).toHaveReturnedWith(mockQueryBuilder);
    });

    it('should chain query builder methods in getStatsBySystem', async () => {
      // Arrange
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue([]);

      // Act
      await repository.getStatsBySystem();

      // Assert
      expect(mockQueryBuilder.select).toHaveReturnedWith(mockQueryBuilder);
      expect(mockQueryBuilder.addSelect).toHaveReturnedWith(mockQueryBuilder);
      expect(mockQueryBuilder.where).toHaveReturnedWith(mockQueryBuilder);
      expect(mockQueryBuilder.groupBy).toHaveReturnedWith(mockQueryBuilder);
    });
  });
});
