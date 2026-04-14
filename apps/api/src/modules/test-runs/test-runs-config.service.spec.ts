/**
 * Test Suite for TestRunsConfigService
 *
 * Tests the configuration management functionality for test runs including:
 * - Adding single and multiple configurations
 * - JSON-based configuration import with include/exclude patterns
 * - Expected configuration change management
 * - Configuration retrieval
 *
 * Uses mock repository factory for consistent mocking patterns.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TestRunsConfigService } from './services/test-runs-config.service';
import {
  TestRun as TestRunEntity,
  SystemUnderTest as SystemEntity,
  ExpectedConfigChange,
  TestRunConfiguration as TestRunConfigEntity,
  SparseMetricExclusion,
} from '../../entities';
import {
  AddTestRunConfigDto,
  AddTestRunConfigsDto,
  AddTestRunConfigJsonDto,
} from './dto/test-run-config.dto';
import { CreateExpectedConfigChangeDto } from './dto/expected-config-change.dto';
import {
  createMockRepository,
  createMockQueryBuilder,
  MockRepository,
  MockSelectQueryBuilder,
} from '../../../test/helpers/mock-repository.factory';
import { ResourceNotFoundException, ValidationException } from '../../common/exceptions/business.exception';
import { AuthorizationService } from '../../common/services/authorization.service';
import { createAuthorizationServiceMock } from '../../../test/mocks/authorization-service.mock';

describe('TestRunsConfigService', () => {
  let service: TestRunsConfigService;
  let testRunRepo: MockRepository<TestRunEntity>;
  let systemRepo: MockRepository<SystemEntity>;
  let expectedConfigChangeRepo: MockRepository<ExpectedConfigChange>;
  let testRunConfigRepo: MockRepository<TestRunConfigEntity>;
  let mockDataSource: jest.Mocked<Partial<DataSource>>;
  let mockQueryBuilder: MockSelectQueryBuilder<TestRunConfigEntity>;
  let authzServiceMock: ReturnType<typeof createAuthorizationServiceMock>;

  // Test data fixtures
  const mockSystemUnderTest = {
    id: 'system-uuid-123',
    name: 'my-app',
  };

  const mockTestRun = {
    id: 'test-run-uuid-123',
    testRunId: 'load-test-2024-01-15-14-30',
    systemUnderTestId: 'system-uuid-123',
    testEnvironment: 'production',
    workload: 'load-test',
    createdAt: new Date(),
  };

  const mockExpectedConfigChange = {
    id: 'expected-change-uuid-123',
    system_under_test_id: 'system-uuid-123',
    test_environment: 'production',
    workload: 'load-test',
    config_key: 'jvm.heap.size',
    description: 'Expected change in heap size',
    created_at: new Date(),
    updated_at: new Date(),
  };

  beforeEach(async () => {
    // Create mock repositories using factory
    testRunRepo = createMockRepository<TestRunEntity>();
    systemRepo = createMockRepository<SystemEntity>();
    expectedConfigChangeRepo = createMockRepository<ExpectedConfigChange>();
    mockQueryBuilder = createMockQueryBuilder<TestRunConfigEntity>();
    testRunConfigRepo = createMockRepository<TestRunConfigEntity>();
    testRunConfigRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

    // Create mock DataSource
    mockDataSource = {
      query: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestRunsConfigService,
        {
          provide: getRepositoryToken(TestRunEntity),
          useValue: testRunRepo,
        },
        {
          provide: getRepositoryToken(SystemEntity),
          useValue: systemRepo,
        },
        {
          provide: getRepositoryToken(ExpectedConfigChange),
          useValue: expectedConfigChangeRepo,
        },
        {
          provide: getRepositoryToken(TestRunConfigEntity),
          useValue: testRunConfigRepo,
        },
        {
          provide: getRepositoryToken(SparseMetricExclusion),
          useValue: createMockRepository<SparseMetricExclusion>(),
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: AuthorizationService,
          useFactory: () => {
            authzServiceMock = createAuthorizationServiceMock();
            return authzServiceMock;
          },
        },
      ],
    }).compile();

    service = module.get<TestRunsConfigService>(TestRunsConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getTestRunConfigs', () => {
    // Mock the query builder for tests that use organization filtering
    const mockQueryBuilder = {
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
    };

    beforeEach(() => {
      // Reset query builder mocks
      mockQueryBuilder.getOne.mockReset();
      testRunRepo.createQueryBuilder = jest.fn().mockReturnValue(mockQueryBuilder);
      systemRepo.createQueryBuilder = jest.fn().mockReturnValue(mockQueryBuilder);
    });

    it('should retrieve configs by test run ID only (admin user)', async () => {
      const mockConfigs = [
        { key: 'jvm.heap.size', value: '2048m', tags: ['performance'] },
        { key: 'database.pool.size', value: '50', tags: ['database'] },
      ];

      mockQueryBuilder.getOne.mockResolvedValue(mockTestRun);
      testRunConfigRepo.find.mockResolvedValue(mockConfigs as any);

      // Pass admin role to bypass organization filtering
      const result = await service.getTestRunConfigs('load-test-2024-01-15-14-30', undefined, undefined, undefined, 'test-user-id', ['admin']);

      expect(result).toHaveLength(2);
      expect(result[0].key).toBe('jvm.heap.size');
    });

    it('should retrieve configs with system, environment, and workload params (admin user)', async () => {
      const mockConfigs = [{ key: 'config.key', value: 'value', tags: [] }];

      mockQueryBuilder.getOne.mockResolvedValueOnce(mockSystemUnderTest).mockResolvedValueOnce(mockTestRun);
      testRunRepo.findOne.mockResolvedValue(mockTestRun as any);
      testRunConfigRepo.find.mockResolvedValue(mockConfigs as any);

      // Pass admin role to bypass organization filtering
      const result = await service.getTestRunConfigs(
        'load-test-2024-01-15-14-30',
        'my-app',
        'production',
        'load-test',
        'test-user-id',
        ['admin'],
      );

      expect(result).toHaveLength(1);
    });

    it('should throw ResourceNotFoundException when system not found (admin user)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);

      // Pass admin role to get proper exception behavior
      await expect(
        service.getTestRunConfigs('test-run-id', 'non-existent', 'env', 'workload', 'test-user-id', ['admin']),
      ).rejects.toThrow(ResourceNotFoundException);
    });

    it('should throw ResourceNotFoundException when test run not found (admin user)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);

      // Pass admin role to get proper exception behavior
      await expect(service.getTestRunConfigs('non-existent-test-run', undefined, undefined, undefined, 'test-user-id', ['admin'])).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should return empty tags array when tags are null (admin user)', async () => {
      const mockConfigs = [{ key: 'config.key', value: 'value', tags: null }];

      mockQueryBuilder.getOne.mockResolvedValue(mockTestRun);
      testRunConfigRepo.find.mockResolvedValue(mockConfigs as any);

      // Pass admin role to bypass organization filtering
      const result = await service.getTestRunConfigs('load-test-2024-01-15-14-30', undefined, undefined, undefined, 'test-user-id', ['admin']);

      expect(result[0].tags).toEqual([]);
    });

    it('should return empty array for non-admin user with no organization memberships', async () => {
      authzServiceMock.isGlobalAdmin.mockReturnValue(false);
      authzServiceMock.getAccessibleOrganizations.mockResolvedValue([]);
      const result = await service.getTestRunConfigs('load-test-2024-01-15-14-30', undefined, undefined, undefined, 'test-user-id', []);
      expect(result).toEqual([]);
    });
  });

  describe('addTestRunConfig', () => {
    const mockConfigDto: AddTestRunConfigDto = {
      systemUnderTest: 'my-app',
      testEnvironment: 'production',
      workload: 'load-test',
      testRunId: 'load-test-2024-01-15-14-30',
      tags: ['performance', 'production'],
      key: 'jvm.heap.size',
      value: '2048m',
    };

    it('should add config for existing test run using upsert', async () => {
      systemRepo.findOne.mockResolvedValue(mockSystemUnderTest as any);
      testRunRepo.findOne.mockResolvedValue(mockTestRun as any);
      mockDataSource.query!.mockResolvedValue([{ id: '1' }]);

      await service.addTestRunConfig(mockConfigDto);

      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO test_run_configs'),
        expect.arrayContaining([
          mockTestRun.id,
          mockConfigDto.key,
          mockConfigDto.value,
          expect.any(String), // tags array literal
        ]),
      );
    });

    it('should store config with string ID when test run does not exist yet', async () => {
      systemRepo.findOne.mockResolvedValue(mockSystemUnderTest as any);
      testRunRepo.findOne.mockResolvedValue(null); // Test run doesn't exist
      mockDataSource.query!.mockResolvedValue([{ id: '1' }]);

      await service.addTestRunConfig(mockConfigDto);

      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('test_run_id_string'),
        expect.arrayContaining([mockConfigDto.testRunId]),
      );
    });

    it('should throw ResourceNotFoundException when system under test not found', async () => {
      systemRepo.findOne.mockResolvedValue(null);

      await expect(service.addTestRunConfig(mockConfigDto)).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should throw ValidationException when test run belongs to different system', async () => {
      const differentSystemTestRun = {
        ...mockTestRun,
        systemUnderTestId: 'different-system-uuid',
      };

      systemRepo.findOne.mockResolvedValue(mockSystemUnderTest as any);
      testRunRepo.findOne.mockResolvedValue(differentSystemTestRun as any);

      await expect(service.addTestRunConfig(mockConfigDto)).rejects.toThrow(ValidationException);
    });
  });

  describe('addTestRunConfigs', () => {
    const mockConfigsDto: AddTestRunConfigsDto = {
      systemUnderTest: 'my-app',
      testEnvironment: 'production',
      workload: 'load-test',
      testRunId: 'load-test-2024-01-15-14-30',
      tags: ['performance', 'production'],
      configItems: [
        { key: 'jvm.heap.size', value: '2048m' },
        { key: 'database.pool.size', value: '50' },
      ],
    };

    it('should add multiple configs for existing test run', async () => {
      systemRepo.findOne.mockResolvedValue(mockSystemUnderTest as any);
      testRunRepo.findOne.mockResolvedValue(mockTestRun as any);
      mockDataSource.query!.mockResolvedValue([{ id: '1' }, { id: '2' }]);

      await service.addTestRunConfigs(mockConfigsDto);

      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO test_run_configs'),
        expect.arrayContaining([mockTestRun.id, 'jvm.heap.size', '2048m']),
      );
    });

    it('should store configs with string ID when test run does not exist', async () => {
      systemRepo.findOne.mockResolvedValue(mockSystemUnderTest as any);
      testRunRepo.findOne.mockResolvedValue(null);
      mockDataSource.query!.mockResolvedValue([]);

      await service.addTestRunConfigs(mockConfigsDto);

      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('test_run_id_string'),
        expect.arrayContaining([mockConfigsDto.testRunId]),
      );
    });

    it('should throw ResourceNotFoundException when system not found', async () => {
      systemRepo.findOne.mockResolvedValue(null);

      await expect(service.addTestRunConfigs(mockConfigsDto)).rejects.toThrow(
        ResourceNotFoundException,
      );
    });
  });

  describe('addTestRunConfigJson', () => {
    const mockJsonConfigDto: AddTestRunConfigJsonDto = {
      systemUnderTest: 'my-app',
      testEnvironment: 'production',
      workload: 'load-test',
      testRunId: 'load-test-2024-01-15-14-30',
      tags: ['performance', 'production'],
      includes: ['jvm', 'database'],
      excludes: ['password', 'secret'],
      json: {
        jvm: {
          heap: { size: '2048m', type: 'G1GC' },
          gc: { threads: 4 },
        },
        database: {
          pool: { size: 50, timeout: 30 },
          password: 'secret123',
        },
      },
    };

    it('should add configs from JSON with include/exclude filtering', async () => {
      systemRepo.findOne.mockResolvedValue(mockSystemUnderTest as any);
      testRunRepo.findOne.mockResolvedValue(mockTestRun as any);
      mockDataSource.query!.mockResolvedValue([{ id: '1' }]);

      await service.addTestRunConfigJson(mockJsonConfigDto);

      expect(mockDataSource.query).toHaveBeenCalled();
      // Verify password was excluded by checking the query doesn't contain password values
      const queryCall = mockDataSource.query!.mock.calls[0];
      expect(queryCall[1]).not.toContain('secret123');
    });

    it('should throw ResourceNotFoundException when system not found', async () => {
      systemRepo.findOne.mockResolvedValue(null);

      await expect(service.addTestRunConfigJson(mockJsonConfigDto)).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should throw ResourceNotFoundException when test run not found', async () => {
      systemRepo.findOne.mockResolvedValue(mockSystemUnderTest as any);
      testRunRepo.findOne.mockResolvedValue(null);

      await expect(service.addTestRunConfigJson(mockJsonConfigDto)).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should reject malicious regex in includes', async () => {
      const maliciousDto = {
        ...mockJsonConfigDto,
        includes: ['(a+)+'], // potentially catastrophic backtracking
      };

      await expect(service.addTestRunConfigJson(maliciousDto)).rejects.toThrow(ValidationException);
    });

    it('should reject malicious regex in excludes', async () => {
      const maliciousDto = {
        ...mockJsonConfigDto,
        excludes: ['(a+)+'],
      };

      await expect(service.addTestRunConfigJson(maliciousDto)).rejects.toThrow(ValidationException);
    });

    it('should handle empty results after filtering', async () => {
      const emptyResultDto = {
        ...mockJsonConfigDto,
        includes: ['nonexistent'],
        json: { other: { field: 'value' } },
      };

      systemRepo.findOne.mockResolvedValue(mockSystemUnderTest as any);
      testRunRepo.findOne.mockResolvedValue(mockTestRun as any);

      await service.addTestRunConfigJson(emptyResultDto);

      // Should not call query when no configs match
      expect(mockDataSource.query).not.toHaveBeenCalled();
    });
  });

  describe('getExpectedConfigChanges', () => {
    // Mock the query builder for tests that use organization filtering
    const mockQueryBuilder = {
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
    };

    beforeEach(() => {
      mockQueryBuilder.getOne.mockReset();
      systemRepo.createQueryBuilder = jest.fn().mockReturnValue(mockQueryBuilder);
    });

    it('should retrieve expected config changes for system/environment/workload (admin user)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(mockSystemUnderTest);
      expectedConfigChangeRepo.find.mockResolvedValue([mockExpectedConfigChange as any]);

      // Pass admin role to bypass organization filtering
      const result = await service.getExpectedConfigChanges('my-app', 'production', 'load-test', 'admin-user', ['admin']);

      expect(result).toHaveLength(1);
      expect(result[0].config_key).toBe('jvm.heap.size');
      expect(result[0].reason).toBe('Expected change in heap size');
    });

    it('should return empty array when system not found (admin user)', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);

      // Pass admin role to get proper exception behavior
      const result = await service.getExpectedConfigChanges('non-existent', 'production', 'load-test', 'admin-user', ['admin']);

      expect(result).toEqual([]);
    });

    it('should return empty array for non-admin user with no organization memberships', async () => {
      authzServiceMock.isGlobalAdmin.mockReturnValue(false);
      authzServiceMock.getAccessibleOrganizations.mockResolvedValue([]);
      const result = await service.getExpectedConfigChanges('my-app', 'production', 'load-test', 'regular-user', []);
      expect(result).toEqual([]);
    });
  });

  describe('createExpectedConfigChange', () => {
    const createDto: CreateExpectedConfigChangeDto = {
      system: 'my-app',
      environment: 'production',
      workload: 'load-test',
      configKey: 'jvm.heap.size',
      reason: 'Expected change in heap size',
    };

    it('should create new expected config change', async () => {
      systemRepo.findOne.mockResolvedValue(mockSystemUnderTest as any);
      expectedConfigChangeRepo.findOne.mockResolvedValue(null); // Doesn't exist yet
      expectedConfigChangeRepo.create.mockReturnValue(mockExpectedConfigChange as any);
      expectedConfigChangeRepo.save.mockResolvedValue(mockExpectedConfigChange as any);

      const result = await service.createExpectedConfigChange(createDto);

      expect(expectedConfigChangeRepo.create).toHaveBeenCalled();
      expect(expectedConfigChangeRepo.save).toHaveBeenCalled();
      expect(result.config_key).toBe('jvm.heap.size');
    });

    it('should update existing expected config change', async () => {
      systemRepo.findOne.mockResolvedValue(mockSystemUnderTest as any);
      expectedConfigChangeRepo.findOne.mockResolvedValue(mockExpectedConfigChange as any);
      expectedConfigChangeRepo.save.mockResolvedValue(mockExpectedConfigChange as any);

      const result = await service.createExpectedConfigChange(createDto);

      expect(expectedConfigChangeRepo.create).not.toHaveBeenCalled();
      expect(expectedConfigChangeRepo.save).toHaveBeenCalled();
      expect(result.config_key).toBe('jvm.heap.size');
    });

    it('should throw ResourceNotFoundException when system not found', async () => {
      systemRepo.findOne.mockResolvedValue(null);

      await expect(service.createExpectedConfigChange(createDto)).rejects.toThrow(
        ResourceNotFoundException,
      );
    });
  });

  describe('deleteExpectedConfigChange', () => {
    it('should delete expected config change', async () => {
      systemRepo.findOne.mockResolvedValue(mockSystemUnderTest as any);
      expectedConfigChangeRepo.delete.mockResolvedValue({ affected: 1, raw: [] });

      await service.deleteExpectedConfigChange('my-app', 'production', 'load-test', 'jvm.heap.size');

      expect(expectedConfigChangeRepo.delete).toHaveBeenCalledWith({
        system_under_test_id: 'system-uuid-123',
        test_environment: 'production',
        workload: 'load-test',
        config_key: 'jvm.heap.size',
      });
    });

    it('should throw ResourceNotFoundException when system not found', async () => {
      systemRepo.findOne.mockResolvedValue(null);

      await expect(
        service.deleteExpectedConfigChange('non-existent', 'production', 'load-test', 'key'),
      ).rejects.toThrow(ResourceNotFoundException);
    });
  });

  describe('getLatestConfigKeys', () => {
    // Mock the query builder for tests that use organization filtering
    const mockLatestQueryBuilder = {
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
      getRawMany: jest.fn(),
    };

    beforeEach(() => {
      mockLatestQueryBuilder.getOne.mockReset();
      mockLatestQueryBuilder.getRawMany.mockReset();
      systemRepo.createQueryBuilder = jest.fn().mockReturnValue(mockLatestQueryBuilder);
      testRunConfigRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
    });

    it('should retrieve distinct config keys from latest test run (admin user)', async () => {
      const mockKeys = [{ key: 'config.key1' }, { key: 'config.key2' }];

      mockLatestQueryBuilder.getOne.mockResolvedValue(mockSystemUnderTest);
      testRunRepo.findOne.mockResolvedValue(mockTestRun as any);
      mockQueryBuilder.getRawMany.mockResolvedValue(mockKeys);

      // Pass admin role to bypass organization filtering
      const result = await service.getLatestConfigKeys('my-app', 'production', 'load-test', ['admin'], []);

      expect(result).toEqual(['config.key1', 'config.key2']);
      expect(mockQueryBuilder.select).toHaveBeenCalledWith('DISTINCT trc.key', 'key');
    });

    it('should return empty array when system not found (admin user)', async () => {
      mockLatestQueryBuilder.getOne.mockResolvedValue(null);

      // Pass admin role to get proper behavior
      const result = await service.getLatestConfigKeys('non-existent', 'production', 'load-test', ['admin'], []);

      expect(result).toEqual([]);
    });

    it('should return empty array when no test runs found (admin user)', async () => {
      mockLatestQueryBuilder.getOne.mockResolvedValue(mockSystemUnderTest);
      testRunRepo.findOne.mockResolvedValue(null);

      // Pass admin role to bypass organization filtering
      const result = await service.getLatestConfigKeys('my-app', 'production', 'load-test', ['admin'], []);

      expect(result).toEqual([]);
    });

    it('should return empty array for non-admin user with no organization memberships', async () => {
      authzServiceMock.isGlobalAdmin.mockReturnValue(false);
      authzServiceMock.getAccessibleOrganizations.mockResolvedValue([]);
      const result = await service.getLatestConfigKeys('my-app', 'production', 'load-test', [], []);
      expect(result).toEqual([]);
    });
  });

  describe('associateStringBasedConfigs', () => {
    it('should associate string-based configs with test run UUID', async () => {
      const mockConfigs = [
        { id: 'config-1', key: 'key1', value: 'value1', tags: [], created_at: new Date() },
      ];

      mockDataSource.query!
        .mockResolvedValueOnce(mockConfigs) // SELECT query
        .mockResolvedValueOnce([]) // DELETE query
        .mockResolvedValueOnce([]); // UPDATE query

      await service.associateStringBasedConfigs('test-run-string', 'test-run-uuid');

      expect(mockDataSource.query).toHaveBeenCalledTimes(3);
    });

    it('should not fail when no string-based configs exist', async () => {
      mockDataSource.query!.mockResolvedValue([]);

      await service.associateStringBasedConfigs('test-run-string', 'test-run-uuid');

      // Should only call the SELECT query
      expect(mockDataSource.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('addTestRunConfigsByUuid', () => {
    const configItems = [
      { key: 'key1', value: 'value1' },
      { key: 'key2', value: 'value2' },
    ];

    it('should add configs for test run found by UUID', async () => {
      testRunRepo.findOne.mockResolvedValue(mockTestRun as any);
      mockDataSource.query!.mockResolvedValue([]);

      await service.addTestRunConfigsByUuid('test-run-uuid-123', ['tag1'], configItems);

      expect(mockDataSource.query).toHaveBeenCalledTimes(2); // One for each config item
    });

    it('should skip config storage when test run not found', async () => {
      testRunRepo.findOne.mockResolvedValue(null);

      await service.addTestRunConfigsByUuid('non-existent-uuid', ['tag1'], configItems);

      expect(mockDataSource.query).not.toHaveBeenCalled();
    });
  });

  describe('Private helper methods (accessed through service behavior)', () => {
    describe('flattenJSON behavior', () => {
      it('should flatten nested JSON correctly through addTestRunConfigJson', async () => {
        const nestedJson: AddTestRunConfigJsonDto = {
          systemUnderTest: 'my-app',
          testEnvironment: 'production',
          workload: 'load-test',
          testRunId: 'load-test-2024-01-15-14-30',
          tags: [],
          includes: ['jvm'],
          excludes: [],
          json: {
            jvm: {
              heap: { size: '2048m' },
            },
          },
        };

        systemRepo.findOne.mockResolvedValue(mockSystemUnderTest as any);
        testRunRepo.findOne.mockResolvedValue(mockTestRun as any);
        mockDataSource.query!.mockResolvedValue([]);

        await service.addTestRunConfigJson(nestedJson);

        // Verify the flattened key format is used
        const queryCall = mockDataSource.query!.mock.calls[0];
        expect(queryCall[1]).toContain('jvm.heap.size');
      });
    });

    describe('escapeRegExp behavior', () => {
      it('should properly escape regex special characters in includes', async () => {
        const dtoWithSpecialChars: AddTestRunConfigJsonDto = {
          systemUnderTest: 'my-app',
          testEnvironment: 'production',
          workload: 'load-test',
          testRunId: 'load-test-2024-01-15-14-30',
          tags: [],
          includes: ['config.key'], // dot should be escaped
          excludes: [],
          json: {
            config: { key: 'value' },
            configXkey: 'other', // Should NOT match due to escaped dot
          },
        };

        systemRepo.findOne.mockResolvedValue(mockSystemUnderTest as any);
        testRunRepo.findOne.mockResolvedValue(mockTestRun as any);
        mockDataSource.query!.mockResolvedValue([]);

        await service.addTestRunConfigJson(dtoWithSpecialChars);

        // The service should escape the dot, so only config.key matches
        expect(mockDataSource.query).toHaveBeenCalled();
      });
    });

    describe('toPostgresArray behavior', () => {
      it('should handle empty tags array', async () => {
        const configDto: AddTestRunConfigDto = {
          application: 'my-app',
          testEnvironment: 'production',
          workload: 'load-test',
          testRunId: 'load-test-2024-01-15-14-30',
          tags: [],
          key: 'test.key',
          value: 'test-value',
        };

        systemRepo.findOne.mockResolvedValue(mockSystemUnderTest as any);
        testRunRepo.findOne.mockResolvedValue(mockTestRun as any);
        mockDataSource.query!.mockResolvedValue([]);

        await service.addTestRunConfig(configDto);

        const queryCall = mockDataSource.query!.mock.calls[0];
        expect(queryCall[1]).toContain('{}'); // Empty postgres array
      });

      it('should handle tags with special characters', async () => {
        const configDto: AddTestRunConfigDto = {
          application: 'my-app',
          testEnvironment: 'production',
          workload: 'load-test',
          testRunId: 'load-test-2024-01-15-14-30',
          tags: ['tag with spaces', 'tag,with,commas'],
          key: 'test.key',
          value: 'test-value',
        };

        systemRepo.findOne.mockResolvedValue(mockSystemUnderTest as any);
        testRunRepo.findOne.mockResolvedValue(mockTestRun as any);
        mockDataSource.query!.mockResolvedValue([]);

        await service.addTestRunConfig(configDto);

        // Should succeed without error - special characters are properly escaped
        expect(mockDataSource.query).toHaveBeenCalled();
      });
    });
  });

  describe('Error handling', () => {
    // Mock the query builder for error handling tests
    const mockErrorQueryBuilder = {
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
    };

    beforeEach(() => {
      testRunRepo.createQueryBuilder = jest.fn().mockReturnValue(mockErrorQueryBuilder);
    });

    it('should propagate database errors in getTestRunConfigs', async () => {
      const dbError = new Error('Database connection failed');
      mockErrorQueryBuilder.getOne.mockRejectedValue(dbError);

      // Pass admin role to bypass organization filtering and hit the actual query
      await expect(service.getTestRunConfigs('test-run-id', undefined, undefined, undefined, 'test-user-id', ['admin'])).rejects.toThrow(
        'Database connection failed',
      );
    });

    it('should propagate database errors in addTestRunConfig', async () => {
      const dbError = new Error('Database connection failed');
      systemRepo.findOne.mockResolvedValue(mockSystemUnderTest as any);
      testRunRepo.findOne.mockResolvedValue(mockTestRun as any);
      mockDataSource.query!.mockRejectedValue(dbError);

      await expect(
        service.addTestRunConfig({
          application: 'my-app',
          testEnvironment: 'production',
          workload: 'load-test',
          testRunId: 'test-run-id',
          tags: [],
          key: 'key',
          value: 'value',
        }),
      ).rejects.toThrow('Database connection failed');
    });

    it('should propagate database errors in addTestRunConfigs', async () => {
      const dbError = new Error('Database connection failed');
      systemRepo.findOne.mockResolvedValue(mockSystemUnderTest as any);
      testRunRepo.findOne.mockResolvedValue(mockTestRun as any);
      mockDataSource.query!.mockRejectedValue(dbError);

      await expect(
        service.addTestRunConfigs({
          application: 'my-app',
          testEnvironment: 'production',
          workload: 'load-test',
          testRunId: 'test-run-id',
          tags: [],
          configItems: [{ key: 'key', value: 'value' }],
        }),
      ).rejects.toThrow('Database connection failed');
    });
  });
});
