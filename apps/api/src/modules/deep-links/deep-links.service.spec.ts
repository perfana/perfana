/**
 * DeepLinksService Test Suite
 *
 * Comprehensive tests for deep links service including:
 * - CRUD operations (create, read, update, delete)
 * - Variable resolution (standard, time, configuration, reference variables)
 * - Generic deep links management
 * - Edge cases and error handling
 *
 * Uses mock repository factory for TypeORM repositories and a custom mock
 * for the DeepLinksRepository as it's a custom repository class.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { DeepLinksService } from './deep-links.service';
import { DeepLinksRepository } from './deep-links.repository';
import { DeepLink } from './entities/deep-link.entity';
import { CreateDeepLinkDto } from './dto/create-deep-link.dto';
import { UpdateDeepLinkDto } from './dto/update-deep-link.dto';
import { CopyDeepLinksDto } from './dto/copy-deep-links.dto';
import { TestRunConfiguration, TestRun as TestRunEntity, SystemUnderTest } from '../../entities';
import { ResourceNotFoundException } from '../../common/exceptions/business.exception';
import { AuthorizationService } from '../../common/services/authorization.service';
import { createAuthorizationServiceMock } from '../../../test/mocks/authorization-service.mock';
import {
  createMockRepository,
  MockRepository,
} from '../../../test/helpers/mock-repository.factory';

/**
 * Creates a mock DeepLinksRepository with all methods stubbed.
 * This is a custom repository mock since DeepLinksRepository is not a standard TypeORM Repository.
 *
 * @returns A fully mocked DeepLinksRepository
 */
function createMockDeepLinksRepository(): jest.Mocked<DeepLinksRepository> {
  return {
    findBySystemEnvWorkload: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findGenericByProfile: jest.fn(),
    createGeneric: jest.fn(),
  } as unknown as jest.Mocked<DeepLinksRepository>;
}

describe('DeepLinksService', () => {
  let service: DeepLinksService;
  let repository: jest.Mocked<DeepLinksRepository>;
  let testRunConfigRepo: MockRepository<TestRunConfiguration>;
  let testRunRepo: MockRepository<TestRunEntity>;
  let systemRepo: MockRepository<SystemUnderTest>;
  let authzService: ReturnType<typeof createAuthorizationServiceMock>;

  // Mock data factory for deep links
  const createMockDeepLink = (overrides?: Partial<DeepLink>): DeepLink => ({
    id: 'deep-link-uuid',
    systemUnderTestId: 'system-uuid',
    testEnvironment: 'test',
    workload: 'load',
    name: 'Test Deep Link',
    url: 'https://example.com/{perfana-test-run-id}',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  });

  // Mock data factory for test runs
  const createMockTestRun = (overrides?: Record<string, unknown>) => ({
    id: 'test-run-uuid',
    test_run_id: 'test-123',
    system_under_test_id: 'system-uuid',
    test_environment: 'test',
    workload: 'load',
    system_name: 'MySystem',
    ci_build_results_url: 'https://jenkins.example.com/build/123',
    start_time: '2024-01-15T10:00:00.000Z',
    end_time: '2024-01-15T11:00:00.000Z',
    systems_under_test: {
      name: 'MySystem',
    },
    ...overrides,
  });

  const mockDeepLink = createMockDeepLink();
  const mockTestRun = createMockTestRun();

  beforeEach(async () => {
    // Create mock DeepLinksRepository using custom factory
    const mockDeepLinksRepo = createMockDeepLinksRepository();

    // Create mock TypeORM repositories using factory
    const mockTestRunConfigRepository = createMockRepository<TestRunConfiguration>();
    const mockTestRunRepository = createMockRepository<TestRunEntity>();
    const mockSystemUnderTestRepository = createMockRepository<SystemUnderTest>();

    const mockAuthzService = createAuthorizationServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeepLinksService,
        {
          provide: DeepLinksRepository,
          useValue: mockDeepLinksRepo,
        },
        {
          provide: getRepositoryToken(TestRunConfiguration),
          useValue: mockTestRunConfigRepository,
        },
        {
          provide: getRepositoryToken(TestRunEntity),
          useValue: mockTestRunRepository,
        },
        {
          provide: getRepositoryToken(SystemUnderTest),
          useValue: mockSystemUnderTestRepository,
        },
        {
          provide: AuthorizationService,
          useValue: mockAuthzService,
        },
      ],
    }).compile();

    service = module.get<DeepLinksService>(DeepLinksService);
    repository = module.get(DeepLinksRepository);
    testRunConfigRepo = module.get(getRepositoryToken(TestRunConfiguration));
    testRunRepo = module.get(getRepositoryToken(TestRunEntity));
    systemRepo = module.get(getRepositoryToken(SystemUnderTest));
    authzService = mockAuthzService;
    // Default: validateSystemAccess loads a system. canAccessResource allows by default.
    systemRepo.findOne.mockResolvedValue({
      id: 'system-uuid',
      organization_id: 'org-uuid',
      created_by: 'creator',
    } as SystemUnderTest);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('CRUD Operations', () => {
    describe('findBySystemEnvWorkload', () => {
      it('should return deep links for given system, environment, and workload', async () => {
        // Arrange
        const deepLinks = [mockDeepLink];
        repository.findBySystemEnvWorkload.mockResolvedValue(deepLinks);

        // Act
        const result = await service.findBySystemEnvWorkload('system-uuid', 'test', 'load');

        // Assert
        expect(result).toEqual(deepLinks);
        expect(repository.findBySystemEnvWorkload).toHaveBeenCalledWith('system-uuid', 'test', 'load');
      });

      it('should return empty array when no deep links found', async () => {
        // Arrange
        repository.findBySystemEnvWorkload.mockResolvedValue([]);

        // Act
        const result = await service.findBySystemEnvWorkload('system-uuid', 'test', 'load');

        // Assert
        expect(result).toEqual([]);
      });

      it('should return multiple deep links when multiple exist for criteria', async () => {
        // Arrange
        const deepLinks = [
          mockDeepLink,
          { ...mockDeepLink, id: 'deep-link-uuid-2', name: 'Second Deep Link' },
          { ...mockDeepLink, id: 'deep-link-uuid-3', name: 'Third Deep Link' },
        ];
        repository.findBySystemEnvWorkload.mockResolvedValue(deepLinks);

        // Act
        const result = await service.findBySystemEnvWorkload('system-uuid', 'test', 'load');

        // Assert
        expect(result).toEqual(deepLinks);
        expect(result).toHaveLength(3);
      });
    });

    describe('findById', () => {
      it('should return deep link when found', async () => {
        // Arrange
        repository.findById.mockResolvedValue(mockDeepLink);

        // Act
        const result = await service.findById('deep-link-uuid');

        // Assert
        expect(result).toEqual(mockDeepLink);
        expect(repository.findById).toHaveBeenCalledWith('deep-link-uuid');
      });

      it('should throw NotFoundException when deep link not found', async () => {
        // Arrange
        repository.findById.mockResolvedValue(null);

        // Act & Assert
        await expect(service.findById('non-existent-id')).rejects.toThrow(
          new NotFoundException('Deep link with ID non-existent-id not found')
        );
      });
    });

    describe('create', () => {
      it('should create a new deep link', async () => {
        // Arrange
        const createDto: CreateDeepLinkDto = {
          systemUnderTestId: 'system-uuid',
          testEnvironment: 'test',
          workload: 'load',
          name: 'New Deep Link',
          url: 'https://example.com/{perfana-test-run-id}',
        };
        repository.create.mockResolvedValue(mockDeepLink);

        // Act
        const result = await service.create(createDto);

        // Assert
        expect(result).toEqual(mockDeepLink);
        expect(repository.create).toHaveBeenCalledWith(createDto);
      });

      it('should create deep link with optional templateDeepLinkId', async () => {
        // Arrange
        const createDto: CreateDeepLinkDto = {
          systemUnderTestId: 'system-uuid',
          testEnvironment: 'test',
          workload: 'load',
          name: 'New Deep Link',
          url: 'https://example.com/{perfana-test-run-id}',
          templateDeepLinkId: 'template-uuid',
        };
        const deepLinkWithTemplate = { ...mockDeepLink, templateDeepLinkId: 'template-uuid' };
        repository.create.mockResolvedValue(deepLinkWithTemplate);

        // Act
        const result = await service.create(createDto);

        // Assert
        expect(result).toEqual(deepLinkWithTemplate);
        expect(result.templateDeepLinkId).toBe('template-uuid');
        expect(repository.create).toHaveBeenCalledWith(createDto);
      });
    });

    describe('update', () => {
      it('should update an existing deep link', async () => {
        // Arrange
        const updateDto: UpdateDeepLinkDto = {
          name: 'Updated Deep Link',
          url: 'https://example.com/updated/{perfana-test-run-id}',
        };
        const updatedDeepLink = { ...mockDeepLink, ...updateDto };
        repository.findById.mockResolvedValue(mockDeepLink);
        repository.update.mockResolvedValue(updatedDeepLink);

        // Act
        const result = await service.update('deep-link-uuid', updateDto);

        // Assert
        expect(result).toEqual(updatedDeepLink);
        expect(repository.findById).toHaveBeenCalledWith('deep-link-uuid');
        expect(repository.update).toHaveBeenCalledWith('deep-link-uuid', updateDto);
      });

      it('should throw NotFoundException when updating non-existent deep link', async () => {
        // Arrange
        const updateDto: UpdateDeepLinkDto = { name: 'Updated' };
        repository.findById.mockResolvedValue(null);

        // Act & Assert
        await expect(service.update('non-existent-id', updateDto)).rejects.toThrow(NotFoundException);
      });
    });

    describe('delete', () => {
      it('should delete an existing deep link', async () => {
        // Arrange
        repository.findById.mockResolvedValue(mockDeepLink);
        repository.delete.mockResolvedValue(undefined);

        // Act
        await service.delete('deep-link-uuid');

        // Assert
        expect(repository.findById).toHaveBeenCalledWith('deep-link-uuid');
        expect(repository.delete).toHaveBeenCalledWith('deep-link-uuid');
      });

      it('should throw NotFoundException when deleting non-existent deep link', async () => {
        // Arrange
        repository.findById.mockResolvedValue(null);

        // Act & Assert
        await expect(service.delete('non-existent-id')).rejects.toThrow(NotFoundException);
      });
    });
  });

  describe('Variable Resolution', () => {
    describe('resolveVariables - Standard Variables', () => {
      it('should resolve perfana-system-under-test from system_name', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/{perfana-system-under-test}',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/MySystem');
        expect(result.isValid).toBe(true);
        expect(result.unresolvedVariables).toBeUndefined();
      });

      it('should resolve perfana-test-environment', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/{perfana-test-environment}',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/test');
        expect(result.isValid).toBe(true);
      });

      it('should resolve perfana-workload', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/{perfana-workload}',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/load');
        expect(result.isValid).toBe(true);
      });

      it('should resolve perfana-test-run-id', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/{perfana-test-run-id}',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/test-123');
        expect(result.isValid).toBe(true);
      });

      it('should resolve perfana-build-result-url', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/?build={perfana-build-result-url}',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/?build=https://jenkins.example.com/build/123');
        expect(result.isValid).toBe(true);
      });

      it('should resolve multiple standard variables', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/{perfana-system-under-test}/{perfana-test-environment}/{perfana-workload}/{perfana-test-run-id}',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/MySystem/test/load/test-123');
        expect(result.isValid).toBe(true);
      });
    });

    describe('resolveVariables - Time Variables', () => {
      it('should resolve perfana-start-epoch-milliseconds', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/?start={perfana-start-epoch-milliseconds}',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        const expectedEpoch = new Date('2024-01-15T10:00:00.000Z').getTime();
        expect(result.url).toBe(`https://example.com/?start=${expectedEpoch}`);
        expect(result.isValid).toBe(true);
      });

      it('should resolve perfana-start-epoch-seconds', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/?start={perfana-start-epoch-seconds}',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        const expectedEpoch = Math.round(new Date('2024-01-15T10:00:00.000Z').getTime() / 1000);
        expect(result.url).toBe(`https://example.com/?start=${expectedEpoch}`);
        expect(result.isValid).toBe(true);
      });

      it('should resolve perfana-end-epoch-milliseconds', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/?end={perfana-end-epoch-milliseconds}',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        const expectedEpoch = new Date('2024-01-15T11:00:00.000Z').getTime();
        expect(result.url).toBe(`https://example.com/?end=${expectedEpoch}`);
        expect(result.isValid).toBe(true);
      });

      it('should resolve perfana-start-dynatrace', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://dynatrace.example.com/?start={perfana-start-dynatrace}',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://dynatrace.example.com/?start=2024-01-15T10:00:00.000Z');
        expect(result.isValid).toBe(true);
      });

      it('should resolve perfana-start-elasticsearch', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://elasticsearch.example.com/?start={perfana-start-elasticsearch}',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://elasticsearch.example.com/?start=2024-01-15T10:00:00.000Z');
        expect(result.isValid).toBe(true);
      });

      it('should resolve all time variables', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/?start_ms={perfana-start-epoch-milliseconds}&end_ms={perfana-end-epoch-milliseconds}&start_s={perfana-start-epoch-seconds}&end_s={perfana-end-epoch-seconds}',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        const startMs = new Date('2024-01-15T10:00:00.000Z').getTime();
        const endMs = new Date('2024-01-15T11:00:00.000Z').getTime();
        const startS = Math.round(startMs / 1000);
        const endS = Math.round(endMs / 1000);
        expect(result.url).toBe(`https://example.com/?start_ms=${startMs}&end_ms=${endMs}&start_s=${startS}&end_s=${endS}`);
        expect(result.isValid).toBe(true);
      });

      it('should resolve perfana-end-dynatrace', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://dynatrace.example.com/?end={perfana-end-dynatrace}',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://dynatrace.example.com/?end=2024-01-15T11:00:00.000Z');
        expect(result.isValid).toBe(true);
      });

      it('should resolve perfana-end-elasticsearch', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://elasticsearch.example.com/?end={perfana-end-elasticsearch}',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://elasticsearch.example.com/?end=2024-01-15T11:00:00.000Z');
        expect(result.isValid).toBe(true);
      });

      it('should not replace time variables when start_time is missing', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/?start={perfana-start-epoch-milliseconds}',
        };
        const testRunNoStartTime = { ...mockTestRun, start_time: undefined };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, testRunNoStartTime);

        // Assert
        expect(result.url).toBe('https://example.com/?start={perfana-start-epoch-milliseconds}');
        expect(result.isValid).toBe(false);
      });

      it('should resolve end time to current time when end_time is missing and test is not completed', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/?end={perfana-end-epoch-seconds}',
        };
        const testRunNoEndTime = { ...mockTestRun, end_time: undefined, completed: false };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, testRunNoEndTime);

        // Assert — end time should be resolved to current time (a number), not left as template
        expect(result.url).not.toContain('{perfana-end-epoch-seconds}');
        expect(result.url).toMatch(/end=\d+/);
        expect(result.isValid).toBe(true);
      });

      it('should leave end time variables unresolved when end_time is missing and test is completed', async () => {
        // Arrange — completed test with no end_time results in null endDate (no substitution)
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/?end={perfana-end-epoch-seconds}',
        };
        const completedTestRunNoEndTime = {
          ...mockTestRun,
          end_time: undefined,
          completed: true,
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, completedTestRunNoEndTime);

        // Assert — endDate is null so the variable stays unresolved
        expect(result.url).toBe('https://example.com/?end={perfana-end-epoch-seconds}');
        expect(result.isValid).toBe(false);
        expect(result.unresolvedVariables).toContain('{perfana-end-epoch-seconds}');
      });
    });

    describe('resolveVariables - Configuration Variables', () => {
      it('should resolve configuration variables from test run config', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/?heap={jvm.heap.size}',
        };
        testRunConfigRepo.find.mockResolvedValue([
          { key: 'jvm.heap.size', value: '2048m' } as TestRunConfiguration,
        ]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/?heap=2048m');
        expect(result.isValid).toBe(true);
        expect(testRunConfigRepo.find).toHaveBeenCalledWith({
          where: { testRunId: 'test-run-uuid' },
          select: ['key', 'value'],
        });
      });

      it('should resolve multiple configuration variables', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/?heap={jvm.heap.size}&threads={thread.pool.size}',
        };
        testRunConfigRepo.find.mockResolvedValue([
          { key: 'jvm.heap.size', value: '2048m' } as TestRunConfiguration,
          { key: 'thread.pool.size', value: '100' } as TestRunConfiguration,
        ]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/?heap=2048m&threads=100');
        expect(result.isValid).toBe(true);
      });

      it('should handle configuration keys with special regex characters', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/?config={app.config[0].value}',
        };
        testRunConfigRepo.find.mockResolvedValue([
          { key: 'app.config[0].value', value: 'test-value' } as TestRunConfiguration,
        ]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/?config=test-value');
        expect(result.isValid).toBe(true);
      });

      it('should handle empty configuration value', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/?config={empty.config}',
        };
        testRunConfigRepo.find.mockResolvedValue([
          { key: 'empty.config', value: '' } as TestRunConfiguration,
        ]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/?config=');
        expect(result.isValid).toBe(true);
      });

      it('should continue when configuration retrieval fails', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/{perfana-test-run-id}',
        };
        testRunConfigRepo.find.mockRejectedValue(new Error('Database error'));

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/test-123');
        expect(result.isValid).toBe(true);
      });

      it('should handle null configuration value', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/?config={null.config}',
        };
        testRunConfigRepo.find.mockResolvedValue([
          { key: 'null.config', value: null } as any,
        ]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/?config=');
        expect(result.isValid).toBe(true);
      });

      it('should handle undefined configuration value', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/?config={undefined.config}',
        };
        testRunConfigRepo.find.mockResolvedValue([
          { key: 'undefined.config', value: undefined } as any,
        ]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/?config=');
        expect(result.isValid).toBe(true);
      });

      it('should not replace unreferenced configuration variables', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/{perfana-test-run-id}',
        };
        // Database returns configs, but URL doesn't reference them
        testRunConfigRepo.find.mockResolvedValue([
          { key: 'unused.config', value: 'unused-value' } as TestRunConfiguration,
        ]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/test-123');
        expect(result.isValid).toBe(true);
        expect(testRunConfigRepo.find).toHaveBeenCalledWith({
          where: { testRunId: 'test-run-uuid' },
          select: ['key', 'value'],
        });
      });
    });

    describe('resolveVariables - Reference Variables', () => {
      it('should resolve perfana-previous-test-run-id', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/?previous={perfana-previous-test-run-id}',
        };
        testRunConfigRepo.find.mockResolvedValue([]);
        testRunRepo.findOne.mockResolvedValue({
          testRunId: 'test-100',
        } as TestRunEntity);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/?previous=test-100');
        expect(result.isValid).toBe(true);
        expect(testRunRepo.findOne).toHaveBeenCalledWith({
          where: {
            systemUnderTestId: 'system-uuid',
            testEnvironment: 'test',
            workload: 'load',
            completed: true,
          },
          select: ['testRunId'],
          order: { startTime: 'DESC' },
        });
      });

      it('should not replace previous test run id when it is the same as current', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/?previous={perfana-previous-test-run-id}',
        };
        testRunConfigRepo.find.mockResolvedValue([]);
        testRunRepo.findOne.mockResolvedValue({
          testRunId: 'test-123', // Same as current test run
        } as TestRunEntity);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/?previous={perfana-previous-test-run-id}');
        expect(result.isValid).toBe(false);
        expect(result.unresolvedVariables).toContain('{perfana-previous-test-run-id}');
      });

      it('should leave reference variable unresolved when previous test run not found', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/?previous={perfana-previous-test-run-id}',
        };
        testRunConfigRepo.find.mockResolvedValue([]);
        testRunRepo.findOne.mockResolvedValue(null);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/?previous={perfana-previous-test-run-id}');
        expect(result.isValid).toBe(false);
        expect(result.unresolvedVariables).toContain('{perfana-previous-test-run-id}');
      });

      it('should continue when reference variable retrieval fails', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/{perfana-test-run-id}?previous={perfana-previous-test-run-id}',
        };
        testRunConfigRepo.find.mockResolvedValue([]);
        testRunRepo.findOne.mockRejectedValue(new Error('Database error'));

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/test-123?previous={perfana-previous-test-run-id}');
        expect(result.isValid).toBe(false);
      });

      it('should not resolve previous test run when variable is not present in URL', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/{perfana-test-run-id}',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/test-123');
        expect(result.isValid).toBe(true);
        // Should not call testRunRepo.findOne when variable not in URL
        expect(testRunRepo.findOne).not.toHaveBeenCalled();
      });

      it('should leave previous test run variable when testRunId is undefined', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/?previous={perfana-previous-test-run-id}',
        };
        testRunConfigRepo.find.mockResolvedValue([]);
        testRunRepo.findOne.mockResolvedValue({
          testRunId: undefined, // Missing testRunId
        } as any);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/?previous={perfana-previous-test-run-id}');
        expect(result.isValid).toBe(false);
      });
    });

    describe('resolveVariables - Edge Cases', () => {
      it('should identify unresolved variables', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/{unknown-variable}',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/{unknown-variable}');
        expect(result.isValid).toBe(false);
        expect(result.unresolvedVariables).toEqual(['{unknown-variable}']);
      });

      it('should identify multiple unresolved variables', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/{unknown1}/{unknown2}',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.isValid).toBe(false);
        expect(result.unresolvedVariables).toEqual(['{unknown1}', '{unknown2}']);
      });

      it('should handle URL with no variables', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/static/path',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/static/path');
        expect(result.isValid).toBe(true);
        expect(result.unresolvedVariables).toBeUndefined();
      });

      it('should handle missing test run properties gracefully', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/{perfana-build-result-url}',
        };
        const incompleteTestRun = {
          id: 'test-run-uuid',
          test_run_id: 'test-123',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, incompleteTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/{perfana-build-result-url}');
        expect(result.isValid).toBe(false);
      });

      it('should return error state when resolution throws exception', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/{perfana-test-run-id}',
        };
        testRunConfigRepo.find.mockRejectedValue(new Error('Critical error'));
        // Simulate error in standard variables by passing invalid test run
        const invalidTestRun = null as any;

        // Act
        const result = await service.resolveVariables(deepLink, invalidTestRun);

        // Assert
        expect(result.isValid).toBe(false);
        expect(result.unresolvedVariables).toEqual(['Error resolving variables']);
      });

      it('should handle system_under_test fallback when system_name not available', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/{perfana-system-under-test}',
        };
        const testRunWithoutSystemName = {
          ...mockTestRun,
          system_name: undefined,
          systems_under_test: undefined,
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, testRunWithoutSystemName);

        // Assert
        expect(result.url).toBe('https://example.com/system-uuid');
        expect(result.isValid).toBe(true);
      });

      it('should use systems_under_test.name fallback when system_name is not set', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/{perfana-system-under-test}',
        };
        const testRunWithSystemObject = {
          ...mockTestRun,
          system_name: undefined,
          systems_under_test: { name: 'SystemFromObject' },
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, testRunWithSystemObject);

        // Assert
        expect(result.url).toBe('https://example.com/SystemFromObject');
        expect(result.isValid).toBe(true);
      });

      it('should handle empty string values gracefully', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/{perfana-test-environment}/{perfana-workload}',
        };
        const testRunWithEmptyValues = {
          ...mockTestRun,
          test_environment: '',
          workload: '',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, testRunWithEmptyValues);

        // Assert
        expect(result.url).toBe('https://example.com//');
        expect(result.isValid).toBe(true);
      });

      it('should handle special characters in variable values', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/{perfana-test-environment}/{perfana-workload}',
        };
        const testRunWithSpecialChars = {
          ...mockTestRun,
          test_environment: 'test&env',
          workload: 'load-test#1',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, testRunWithSpecialChars);

        // Assert
        expect(result.url).toBe('https://example.com/test&env/load-test#1');
        expect(result.isValid).toBe(true);
      });

      it('should resolve complex real-world URL with multiple variable types', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://grafana.example.com/d/dashboard-uid/dashboard?var-system={perfana-system-under-test}&var-env={perfana-test-environment}&var-workload={perfana-workload}&from={perfana-start-epoch-milliseconds}&to={perfana-end-epoch-milliseconds}&var-heap={jvm.heap.size}',
        };
        testRunConfigRepo.find.mockResolvedValue([
          { key: 'jvm.heap.size', value: '4096m' } as TestRunConfiguration,
        ]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        const startMs = new Date('2024-01-15T10:00:00.000Z').getTime();
        const endMs = new Date('2024-01-15T11:00:00.000Z').getTime();
        expect(result.url).toBe(
          `https://grafana.example.com/d/dashboard-uid/dashboard?var-system=MySystem&var-env=test&var-workload=load&from=${startMs}&to=${endMs}&var-heap=4096m`
        );
        expect(result.isValid).toBe(true);
      });

      it('should resolve Dynatrace URL with all time formats and DQL query', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://dynatrace.example.com/#dashboard?gtf={perfana-start-dynatrace}/{perfana-end-dynatrace}&gf=all&serviceId={service.id}',
        };
        testRunConfigRepo.find.mockResolvedValue([
          { key: 'service.id', value: 'SERVICE-123' } as TestRunConfiguration,
        ]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe(
          'https://dynatrace.example.com/#dashboard?gtf=2024-01-15T10:00:00.000Z/2024-01-15T11:00:00.000Z&gf=all&serviceId=SERVICE-123'
        );
        expect(result.isValid).toBe(true);
      });

      it('should resolve Tempo trace URL with epoch seconds', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://tempo.example.com/explore?left={perfana-start-epoch-seconds}&right={perfana-end-epoch-seconds}&service={perfana-system-under-test}',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        const startS = Math.round(new Date('2024-01-15T10:00:00.000Z').getTime() / 1000);
        const endS = Math.round(new Date('2024-01-15T11:00:00.000Z').getTime() / 1000);
        expect(result.url).toBe(
          `https://tempo.example.com/explore?left=${startS}&right=${endS}&service=MySystem`
        );
        expect(result.isValid).toBe(true);
      });

      it('should resolve Jaeger URL with microseconds and service name', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://jaeger.example.com/search?service={perfana-system-under-test}&start={perfana-start-epoch-milliseconds}000&end={perfana-end-epoch-milliseconds}000',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        const startMs = new Date('2024-01-15T10:00:00.000Z').getTime();
        const endMs = new Date('2024-01-15T11:00:00.000Z').getTime();
        expect(result.url).toBe(
          `https://jaeger.example.com/search?service=MySystem&start=${startMs}000&end=${endMs}000`
        );
        expect(result.isValid).toBe(true);
      });

      it('should handle mixed resolved and unresolved variables', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/{perfana-test-run-id}/{unknown-var}/{perfana-workload}',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/test-123/{unknown-var}/load');
        expect(result.isValid).toBe(false);
        expect(result.unresolvedVariables).toEqual(['{unknown-var}']);
      });

      it('should preserve URL structure when all variables are resolved', async () => {
        // Arrange
        const deepLink: DeepLink = {
          ...mockDeepLink,
          url: 'https://example.com/path?param1={perfana-test-run-id}&param2={perfana-workload}#section',
        };
        testRunConfigRepo.find.mockResolvedValue([]);

        // Act
        const result = await service.resolveVariables(deepLink, mockTestRun);

        // Assert
        expect(result.url).toBe('https://example.com/path?param1=test-123&param2=load#section');
        expect(result.isValid).toBe(true);
        expect(result.unresolvedVariables).toBeUndefined();
      });
    });
  });

  describe('Generic Deep Links', () => {
    describe('findGenericByProfile', () => {
      it('should return generic deep links for given profile', async () => {
        // Arrange
        const genericDeepLinks = [
          { id: 'generic-1', profile: 'load-test', name: 'Generic Link 1', url: 'https://example.com/1' },
        ];
        repository.findGenericByProfile.mockResolvedValue(genericDeepLinks as any);

        // Act
        const result = await service.findGenericByProfile('load-test');

        // Assert
        expect(result).toEqual(genericDeepLinks);
        expect(repository.findGenericByProfile).toHaveBeenCalledWith('load-test');
      });

      it('should return empty array when no generic deep links found', async () => {
        // Arrange
        repository.findGenericByProfile.mockResolvedValue([]);

        // Act
        const result = await service.findGenericByProfile('non-existent-profile');

        // Assert
        expect(result).toEqual([]);
      });
    });

    describe('createGeneric', () => {
      it('should create a new generic deep link', async () => {
        // Arrange
        const createDto = {
          profile: 'load-test',
          name: 'Generic Link',
          url: 'https://example.com/{perfana-test-run-id}',
        };
        const genericDeepLink = { id: 'generic-uuid', ...createDto };
        repository.createGeneric.mockResolvedValue(genericDeepLink as any);

        // Act
        const result = await service.createGeneric(createDto as any);

        // Assert
        expect(result).toEqual(genericDeepLink);
        expect(repository.createGeneric).toHaveBeenCalledWith(createDto);
      });
    });
  });

  describe('Authorization and Organization Filtering', () => {
    describe('findBySystemEnvWorkload with userId/roles', () => {
      it('should bypass access check and return deep links when no userId or roles provided', async () => {
        // Arrange — no userId, no roles: the guard branch is skipped entirely
        repository.findBySystemEnvWorkload.mockResolvedValue([mockDeepLink]);

        // Act
        const result = await service.findBySystemEnvWorkload('system-uuid', 'test', 'load');

        // Assert
        expect(result).toEqual([mockDeepLink]);
        expect(authzService.canAccessResource).not.toHaveBeenCalled();
      });

      it('should return deep links when canAccessResource allows', async () => {
        repository.findBySystemEnvWorkload.mockResolvedValue([mockDeepLink]);

        const result = await service.findBySystemEnvWorkload(
          'system-uuid', 'test', 'load', 'user-uuid', ['user'],
        );

        expect(result).toEqual([mockDeepLink]);
        expect(authzService.canAccessResource).toHaveBeenCalled();
      });

      it('should return empty array when canAccessResource denies', async () => {
        authzService.canAccessResource.mockResolvedValue({ allowed: false, reason: 'denied' });

        const result = await service.findBySystemEnvWorkload(
          'system-uuid', 'test', 'load', 'user-uuid', ['user'],
        );

        expect(result).toEqual([]);
        expect(repository.findBySystemEnvWorkload).not.toHaveBeenCalled();
      });

      it('should return empty array when system does not exist', async () => {
        systemRepo.findOne.mockResolvedValue(null);

        const result = await service.findBySystemEnvWorkload(
          'system-uuid', 'test', 'load', 'user-uuid', ['user'],
        );

        expect(result).toEqual([]);
        expect(repository.findBySystemEnvWorkload).not.toHaveBeenCalled();
      });

      it('should enforce access check when only roles are provided (no userId)', async () => {
        repository.findBySystemEnvWorkload.mockResolvedValue([mockDeepLink]);

        const result = await service.findBySystemEnvWorkload(
          'system-uuid', 'test', 'load', '', ['user'],
        );

        expect(result).toEqual([mockDeepLink]);
        expect(authzService.canAccessResource).toHaveBeenCalled();
      });
    });

    describe('findById with userId/roles', () => {
      it('should return deep link when canAccessResource allows', async () => {
        repository.findById.mockResolvedValue(mockDeepLink);

        const result = await service.findById('deep-link-uuid', 'user-uuid', ['user']);

        expect(result).toEqual(mockDeepLink);
        expect(authzService.canAccessResource).toHaveBeenCalled();
      });

      it('should throw ResourceNotFoundException when canAccessResource denies', async () => {
        repository.findById.mockResolvedValue(mockDeepLink);
        authzService.canAccessResource.mockResolvedValue({ allowed: false, reason: 'denied' });

        await expect(
          service.findById('deep-link-uuid', 'user-uuid', ['user']),
        ).rejects.toThrow(ResourceNotFoundException);
      });
    });

    describe('create with userId/roles', () => {
      const createDto: CreateDeepLinkDto = {
        systemUnderTestId: 'system-uuid',
        testEnvironment: 'test',
        workload: 'load',
        name: 'New Deep Link',
        url: 'https://example.com/{perfana-test-run-id}',
      };

      it('should create deep link when canAccessResource allows', async () => {
        repository.create.mockResolvedValue(mockDeepLink);

        const result = await service.create(createDto, 'user-uuid', ['user']);

        expect(result).toEqual(mockDeepLink);
        expect(authzService.canAccessResource).toHaveBeenCalled();
      });

      it('should throw ResourceNotFoundException when canAccessResource denies', async () => {
        authzService.canAccessResource.mockResolvedValue({ allowed: false, reason: 'denied' });

        await expect(
          service.create(createDto, 'user-uuid', ['user']),
        ).rejects.toThrow(ResourceNotFoundException);

        expect(repository.create).not.toHaveBeenCalled();
      });
    });

    describe('update with userId/roles', () => {
      it('should update deep link when canAccessResource allows', async () => {
        const updateDto: UpdateDeepLinkDto = { name: 'Updated' };
        repository.findById.mockResolvedValue(mockDeepLink);
        repository.update.mockResolvedValue({ ...mockDeepLink, ...updateDto });

        const result = await service.update('deep-link-uuid', updateDto, 'user-uuid', ['user']);

        expect(result).toEqual({ ...mockDeepLink, ...updateDto });
      });

      it('should throw ResourceNotFoundException when canAccessResource denies during update', async () => {
        const updateDto: UpdateDeepLinkDto = { name: 'Updated' };
        repository.findById.mockResolvedValue(mockDeepLink);
        authzService.canAccessResource.mockResolvedValue({ allowed: false, reason: 'denied' });

        await expect(
          service.update('deep-link-uuid', updateDto, 'user-uuid', ['user']),
        ).rejects.toThrow(ResourceNotFoundException);

        expect(repository.update).not.toHaveBeenCalled();
      });
    });

    describe('delete with userId/roles', () => {
      it('should delete deep link when canAccessResource allows', async () => {
        repository.findById.mockResolvedValue(mockDeepLink);
        repository.delete.mockResolvedValue(undefined);

        await service.delete('deep-link-uuid', 'user-uuid', ['user']);

        expect(repository.delete).toHaveBeenCalledWith('deep-link-uuid');
      });

      it('should throw ResourceNotFoundException when canAccessResource denies during delete', async () => {
        repository.findById.mockResolvedValue(mockDeepLink);
        authzService.canAccessResource.mockResolvedValue({ allowed: false, reason: 'denied' });

        await expect(
          service.delete('deep-link-uuid', 'user-uuid', ['user']),
        ).rejects.toThrow(ResourceNotFoundException);

        expect(repository.delete).not.toHaveBeenCalled();
      });
    });
  });

  describe('copyToScope', () => {
    const buildCopyDto = (overrides?: Partial<CopyDeepLinksDto>): CopyDeepLinksDto => ({
      sourceSystemUnderTestId: 'source-system-uuid',
      sourceTestEnvironment: 'staging',
      sourceWorkload: 'load',
      targetSystemUnderTestId: 'target-system-uuid',
      targetTestEnvironment: 'production',
      targetWorkload: 'load',
      conflictStrategy: 'skip',
      ...overrides,
    });

    const sourceLink = {
      id: 'link-1',
      systemUnderTestId: 'source-system-uuid',
      testEnvironment: 'staging',
      workload: 'load',
      name: 'Grafana Dashboard',
      url: 'https://grafana.example.com/{perfana-test-run-id}',
      tags: ['grafana', 'monitoring'],
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    } as DeepLink;

    // Default systemRepo.findOne + canAccessResource mocks (set in top-level beforeEach)
    // ensure both source and target systems are accessible.

    it('should copy all source deep links to target scope when no conflicts', async () => {
      // Arrange
      const dto = buildCopyDto();
      repository.findBySystemEnvWorkload
        .mockResolvedValueOnce([sourceLink])   // source links
        .mockResolvedValueOnce([]);             // target links (empty)
      repository.create.mockResolvedValue({
        ...sourceLink,
        systemUnderTestId: dto.targetSystemUnderTestId,
        testEnvironment: dto.targetTestEnvironment,
      } as DeepLink);

      // Act
      const result = await service.copyToScope(dto, 'admin-uuid', ['perfana-admin']);

      // Assert
      expect(result).toEqual({ copied: 1, skipped: 0, total: 1 });
      expect(repository.create).toHaveBeenCalledWith({
        systemUnderTestId: 'target-system-uuid',
        testEnvironment: 'production',
        workload: 'load',
        name: 'Grafana Dashboard',
        url: sourceLink.url,
        tags: ['grafana', 'monitoring'],
      });
    });

    it('should skip conflicting deep links when conflictStrategy is skip', async () => {
      // Arrange
      const dto = buildCopyDto({ conflictStrategy: 'skip' });
      const existingTargetLink = { ...sourceLink, id: 'existing-link', systemUnderTestId: 'target-system-uuid' };
      repository.findBySystemEnvWorkload
        .mockResolvedValueOnce([sourceLink])
        .mockResolvedValueOnce([existingTargetLink]);

      // Act
      const result = await service.copyToScope(dto, 'admin-uuid', ['perfana-admin']);

      // Assert
      expect(result).toEqual({ copied: 0, skipped: 1, total: 1 });
      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('should overwrite conflicting deep links when conflictStrategy is overwrite', async () => {
      // Arrange
      const dto = buildCopyDto({ conflictStrategy: 'overwrite' });
      const existingTargetLink = {
        ...sourceLink,
        id: 'existing-link-id',
        systemUnderTestId: 'target-system-uuid',
        url: 'https://old.example.com',
      };
      repository.findBySystemEnvWorkload
        .mockResolvedValueOnce([sourceLink])
        .mockResolvedValueOnce([existingTargetLink]);
      repository.update.mockResolvedValue(existingTargetLink as DeepLink);

      // Act
      const result = await service.copyToScope(dto, 'admin-uuid', ['perfana-admin']);

      // Assert
      expect(result).toEqual({ copied: 1, skipped: 0, total: 1 });
      expect(repository.update).toHaveBeenCalledWith('existing-link-id', {
        url: sourceLink.url,
        tags: ['grafana', 'monitoring'],
      });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should copy only specified IDs when ids filter is provided', async () => {
      // Arrange
      const link2 = { ...sourceLink, id: 'link-2', name: 'Second Link' };
      const dto = buildCopyDto({ ids: ['link-1'] });
      repository.findBySystemEnvWorkload
        .mockResolvedValueOnce([sourceLink, link2])
        .mockResolvedValueOnce([]);
      repository.create.mockResolvedValue(sourceLink);

      // Act
      const result = await service.copyToScope(dto, 'admin-uuid', ['perfana-admin']);

      // Assert
      // Only link-1 was in ids filter; link-2 was excluded
      expect(result.total).toBe(1);
      expect(result.copied).toBe(1);
      expect(repository.create).toHaveBeenCalledTimes(1);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Grafana Dashboard' }),
      );
    });

    it('should return zero counts when source scope has no deep links', async () => {
      // Arrange
      const dto = buildCopyDto();
      repository.findBySystemEnvWorkload
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      // Act
      const result = await service.copyToScope(dto, 'admin-uuid', ['perfana-admin']);

      // Assert
      expect(result).toEqual({ copied: 0, skipped: 0, total: 0 });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should handle mixed skip and copy in a single operation', async () => {
      // Arrange
      const link2 = { ...sourceLink, id: 'link-2', name: 'New Link', tags: [] };
      const existingLink = { ...sourceLink, id: 'existing-id', systemUnderTestId: 'target-system-uuid' };
      const dto = buildCopyDto({ conflictStrategy: 'skip' });
      repository.findBySystemEnvWorkload
        .mockResolvedValueOnce([sourceLink, link2])
        .mockResolvedValueOnce([existingLink]); // sourceLink.name already exists in target
      repository.create.mockResolvedValue(link2 as DeepLink);

      // Act
      const result = await service.copyToScope(dto, 'admin-uuid', ['perfana-admin']);

      // Assert
      expect(result).toEqual({ copied: 1, skipped: 1, total: 2 });
    });

    it('should throw ResourceNotFoundException when user lacks access to source system', async () => {
      const dto = buildCopyDto();
      authzService.canAccessResource.mockResolvedValue({ allowed: false, reason: 'denied' });

      await expect(
        service.copyToScope(dto, 'user-uuid', ['user']),
      ).rejects.toThrow(ResourceNotFoundException);

      expect(repository.findBySystemEnvWorkload).not.toHaveBeenCalled();
    });

    it('should throw ResourceNotFoundException when user lacks access to target system', async () => {
      const dto = buildCopyDto();
      // First check (source) succeeds, second (target) denies.
      authzService.canAccessResource
        .mockResolvedValueOnce({ allowed: true, reason: 'ok' })
        .mockResolvedValueOnce({ allowed: false, reason: 'denied' });

      await expect(
        service.copyToScope(dto, 'user-uuid', ['user']),
      ).rejects.toThrow(ResourceNotFoundException);

      expect(repository.findBySystemEnvWorkload).not.toHaveBeenCalled();
    });

    it('should handle links with no tags array gracefully', async () => {
      // Arrange — link has tags cast through unknown (simulates DB entity without typed tags)
      const linkWithoutTags = { ...sourceLink } as unknown as DeepLink;
      delete (linkWithoutTags as any).tags; // remove tags property

      const dto = buildCopyDto();
      repository.findBySystemEnvWorkload
        .mockResolvedValueOnce([linkWithoutTags])
        .mockResolvedValueOnce([]);
      repository.create.mockResolvedValue(linkWithoutTags);

      // Act
      const result = await service.copyToScope(dto, 'admin-uuid', ['perfana-admin']);

      // Assert
      expect(result).toEqual({ copied: 1, skipped: 0, total: 1 });
      // Tags should default to empty array when missing from source
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ tags: [] }),
      );
    });

    it('should copy all links when ids filter is empty array (no filter applied)', async () => {
      // Arrange
      const link2 = { ...sourceLink, id: 'link-2', name: 'Second Link' };
      const dto = buildCopyDto({ ids: [] }); // empty ids means copy all
      repository.findBySystemEnvWorkload
        .mockResolvedValueOnce([sourceLink, link2])
        .mockResolvedValueOnce([]);
      repository.create.mockResolvedValue(sourceLink);

      // Act
      const result = await service.copyToScope(dto, 'admin-uuid', ['perfana-admin']);

      // Assert — empty ids array is falsy check passes, all 2 links copied
      expect(result.total).toBe(2);
      expect(result.copied).toBe(2);
    });
  });
});
