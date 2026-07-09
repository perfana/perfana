/**
 * Test Suite for TestRunsCrudQueryService
 *
 * Tests all public methods:
 * - isTestRunChangepoint
 * - isTestRunInControlGroup
 * - findAllPaginated
 * - getFilterOptions
 * - findAll
 * - findByTestRunId
 * - findOne
 * - getTestRunByTestRunId
 * - findByTestRunIdAndParams
 * - getRelatedTestRuns
 * - getSystemsSummary
 * - getAllTags
 * - getAllAnnotations
 * - getBaselineCandidates
 * - getRequestNames
 *
 * Authorization model: list-filter methods take pre-resolved `isAdmin`,
 * `organizationIds`, and `userTeamIds` (computed by the parent
 * TestRunsQueryService via `withOrgFilter`/`withTeamFilter`). Per-resource
 * methods take `isAdmin` and still call `isOrganizationMember` /
 * `canViewTeamResources` directly for individual-resource access checks.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TestRunsCrudQueryService } from './test-runs-crud-query.service';
import { TestRunsMapperService } from './test-runs-mapper.service';
import { AuthorizationService } from '../../../common/services/authorization.service';
import {
  TestRun as TestRunEntity,
  SystemUnderTest,
  DsChangePoints,
  DsControlGroups,
} from '../../../entities';
import { DatabaseException, ResourceNotFoundException } from '../../../common/exceptions/business.exception';
import { PaginationQueryDto, PaginatedResponseDto } from '../../../common/dto';
import {
  createMockRepository,
  createMockQueryBuilder,
  MockRepository,
  MockSelectQueryBuilder,
} from '../../../../test/helpers/mock-repository.factory';
import {
  createAuthorizationServiceMock,
} from '../../../../test/mocks/authorization-service.mock';

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

const NOW = new Date('2024-01-15T10:00:00.000Z');

function createMockTestRunEntity(overrides?: Partial<TestRunEntity>): TestRunEntity {
  return {
    id: 'test-run-uuid-123',
    testRunId: 'PaymentService-production-loadTest-001',
    systemUnderTestId: 'system-uuid-123',
    testEnvironment: 'production',
    workload: 'loadTest',
    startTime: NOW,
    endTime: new Date(NOW.getTime() + 3_600_000),
    duration: 3600,
    plannedDuration: 3600,
    analysisStartOffset: 300,
    analysisEndOffset: 120,
    completed: true,
    abort: false,
    status: { evaluatingAdapt: 'COMPLETED' } as any,
    consolidatedResult: { requirementResultsValid: true, adaptResultValid: true } as any,
    annotations: ['baseline test'],
    tags: ['performance'],
    applicationRelease: '1.2.3',
    ciBuildResultsUrl: 'https://ci.example.com',
    expires: undefined,
    expired: false,
    valid: true,
    reasonsNotValid: [],
    adaptConfig: { mode: 'DEFAULT', differencesAccepted: 'TBD' } as any,
    variables: [],
    deepLinks: [],
    createdAt: NOW,
    updatedAt: NOW,
    systemUnderTest: {
      id: 'system-uuid-123',
      name: 'PaymentService',
      organization_id: 'org-uuid-123',
      team_id: 'team-uuid-123',
      created_at: NOW,
    } as unknown as SystemUnderTest,
    ...overrides,
  } as TestRunEntity;
}

function createMockMappedTestRun(entity: TestRunEntity) {
  return {
    id: entity.id,
    test_run_id: entity.testRunId,
    system_under_test_id: entity.systemUnderTestId,
    test_environment: entity.testEnvironment,
    workload: entity.workload,
    start_time: entity.startTime?.toISOString(),
    end_time: entity.endTime?.toISOString(),
    duration: entity.duration,
    planned_duration: entity.plannedDuration,
    analysis_start_offset: entity.analysisStartOffset,
    analysis_end_offset: entity.analysisEndOffset,
    completed: entity.completed || false,
    abort: entity.abort,
    status: entity.status,
    consolidated_result: entity.consolidatedResult,
    annotations: entity.annotations,
    tags: entity.tags,
    application_release: entity.applicationRelease,
    ci_build_results_url: entity.ciBuildResultsUrl,
    adapt_config: entity.adaptConfig,
    variables: entity.variables,
    deep_links: entity.deepLinks,
    created_at: entity.createdAt.toISOString(),
    updated_at: entity.updatedAt.toISOString(),
    systems_under_test: entity.systemUnderTest
      ? { name: entity.systemUnderTest.name }
      : undefined,
    is_changepoint: false,
    is_control_group: false,
  };
}

function createMockChangePoint(overrides?: Partial<DsChangePoints>): DsChangePoints {
  return {
    id: 1,
    system_under_test_id: 'system-uuid-123',
    test_environment: 'production',
    workload: 'loadTest',
    test_run_id: 'PaymentService-production-loadTest-001',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  } as DsChangePoints;
}

function createMockControlGroup(overrides?: Partial<DsControlGroups>): DsControlGroups {
  return {
    id: 1,
    control_group_id: 'PaymentService-production-loadTest-001',
    system_under_test_id: 'system-uuid-123',
    test_environment: 'production',
    workload: 'loadTest',
    n_test_runs: 1,
    test_runs: ['PaymentService-production-loadTest-001'],
    metric_filters: {},
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  } as DsControlGroups;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('TestRunsCrudQueryService', () => {
  let service: TestRunsCrudQueryService;
  let testRunRepo: MockRepository<TestRunEntity>;
  let systemRepo: MockRepository<SystemUnderTest>;
  let changePointsRepo: MockRepository<DsChangePoints>;
  let controlGroupsRepo: MockRepository<DsControlGroups>;
  let mapper: jest.Mocked<TestRunsMapperService>;
  let authzService: ReturnType<typeof createAuthorizationServiceMock>;

  // Shared query builder mocks - reset per test
  let testRunQb: MockSelectQueryBuilder<TestRunEntity>;
  let changePointsQb: MockSelectQueryBuilder<DsChangePoints>;
  let controlGroupsQb: MockSelectQueryBuilder<DsControlGroups>;
  let systemQb: MockSelectQueryBuilder<SystemUnderTest>;

  const userId = 'user-uuid-456';

  beforeEach(async () => {
    testRunQb = createMockQueryBuilder<TestRunEntity>();
    changePointsQb = createMockQueryBuilder<DsChangePoints>();
    controlGroupsQb = createMockQueryBuilder<DsControlGroups>();
    systemQb = createMockQueryBuilder<SystemUnderTest>();

    testRunRepo = createMockRepository<TestRunEntity>();
    systemRepo = createMockRepository<SystemUnderTest>();
    changePointsRepo = createMockRepository<DsChangePoints>();
    controlGroupsRepo = createMockRepository<DsControlGroups>();

    // Wire up repositories to return their dedicated query builders
    testRunRepo.createQueryBuilder.mockReturnValue(testRunQb);
    systemRepo.createQueryBuilder.mockReturnValue(systemQb);
    changePointsRepo.createQueryBuilder.mockReturnValue(changePointsQb);
    controlGroupsRepo.createQueryBuilder.mockReturnValue(controlGroupsQb);

    mapper = {
      mapEntityToTestRun: jest.fn(),
      calculateCompletionPercentage: jest.fn(),
      getDateBoundsFromTimePeriod: jest.fn(),
    } as unknown as jest.Mocked<TestRunsMapperService>;

    authzService = createAuthorizationServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestRunsCrudQueryService,
        {
          provide: getRepositoryToken(TestRunEntity),
          useValue: testRunRepo,
        },
        {
          provide: getRepositoryToken(SystemUnderTest),
          useValue: systemRepo,
        },
        {
          provide: getRepositoryToken(DsChangePoints),
          useValue: changePointsRepo,
        },
        {
          provide: getRepositoryToken(DsControlGroups),
          useValue: controlGroupsRepo,
        },
        {
          provide: TestRunsMapperService,
          useValue: mapper,
        },
        {
          provide: AuthorizationService,
          useValue: authzService,
        },
      ],
    }).compile();

    service = module.get<TestRunsCrudQueryService>(TestRunsCrudQueryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // isTestRunChangepoint
  // =========================================================================

  describe('isTestRunChangepoint', () => {
    it('should return true when a matching change point exists', async () => {
      const cp = createMockChangePoint();
      changePointsRepo.findOne.mockResolvedValue(cp);

      const result = await service.isTestRunChangepoint(
        'system-uuid-123',
        'production',
        'loadTest',
        'PaymentService-production-loadTest-001',
      );

      expect(result).toBe(true);
      expect(changePointsRepo.findOne).toHaveBeenCalledWith({
        where: {
          system_under_test_id: 'system-uuid-123',
          test_environment: 'production',
          workload: 'loadTest',
          test_run_id: 'PaymentService-production-loadTest-001',
        },
        select: ['id'],
      });
    });

    it('should return false when no matching change point exists', async () => {
      changePointsRepo.findOne.mockResolvedValue(null);

      const result = await service.isTestRunChangepoint(
        'system-uuid-123',
        'production',
        'loadTest',
        'non-existent-run',
      );

      expect(result).toBe(false);
    });

    it('should return false and not throw on database error', async () => {
      changePointsRepo.findOne.mockRejectedValue(new Error('DB connection failed'));

      const result = await service.isTestRunChangepoint(
        'system-uuid-123',
        'production',
        'loadTest',
        'PaymentService-production-loadTest-001',
      );

      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // isTestRunInControlGroup
  // =========================================================================

  describe('isTestRunInControlGroup', () => {
    it('should return false when there are no control groups', async () => {
      controlGroupsRepo.find.mockResolvedValue([]);

      const result = await service.isTestRunInControlGroup(
        'system-uuid-123',
        'production',
        'loadTest',
        'some-test-run-id',
      );

      expect(result).toBe(false);
    });

    it('should return false when the most recent test run does not exist', async () => {
      const cg = createMockControlGroup();
      controlGroupsRepo.find.mockResolvedValue([cg]);
      testRunRepo.findOne.mockResolvedValue(null);

      const result = await service.isTestRunInControlGroup(
        'system-uuid-123',
        'production',
        'loadTest',
        'some-test-run-id',
      );

      expect(result).toBe(false);
    });

    it('should return true when test run is in the most recent control group', async () => {
      const entity = createMockTestRunEntity();
      const cg = createMockControlGroup({
        control_group_id: entity.testRunId,
        test_runs: [entity.testRunId],
      });
      controlGroupsRepo.find.mockResolvedValue([cg]);
      testRunRepo.findOne.mockResolvedValue(entity);

      const result = await service.isTestRunInControlGroup(
        'system-uuid-123',
        'production',
        'loadTest',
        entity.testRunId,
      );

      expect(result).toBe(true);
    });

    it('should return false when test run is not listed in the control group runs', async () => {
      const entity = createMockTestRunEntity();
      const cg = createMockControlGroup({
        control_group_id: entity.testRunId,
        test_runs: ['different-run-id'],
      });
      controlGroupsRepo.find.mockResolvedValue([cg]);
      testRunRepo.findOne.mockResolvedValue(entity);

      const result = await service.isTestRunInControlGroup(
        'system-uuid-123',
        'production',
        'loadTest',
        'completely-different-run',
      );

      expect(result).toBe(false);
    });

    it('should return false when control_group_id does not match most recent test run', async () => {
      const entity = createMockTestRunEntity();
      const cg = createMockControlGroup({
        control_group_id: 'different-control-group-id',
        test_runs: [entity.testRunId],
      });
      controlGroupsRepo.find.mockResolvedValue([cg]);
      testRunRepo.findOne.mockResolvedValue(entity);

      const result = await service.isTestRunInControlGroup(
        'system-uuid-123',
        'production',
        'loadTest',
        entity.testRunId,
      );

      expect(result).toBe(false);
    });

    it('should return false and not throw on database error', async () => {
      controlGroupsRepo.find.mockRejectedValue(new Error('DB error'));

      const result = await service.isTestRunInControlGroup(
        'system-uuid-123',
        'production',
        'loadTest',
        'test-run-id',
      );

      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // findAllPaginated
  // =========================================================================

  describe('findAllPaginated', () => {
    it('should return paginated results for admin users with no filters', async () => {
      const entity = createMockTestRunEntity();
      const mapped = createMockMappedTestRun(entity);
      mapper.mapEntityToTestRun.mockReturnValue(mapped as any);

      testRunQb.getManyAndCount.mockResolvedValue([[entity], 1]);
      changePointsQb.getMany.mockResolvedValue([]);
      controlGroupsQb.getMany.mockResolvedValue([]);

      const result = await service.findAllPaginated(true, [], []);

      expect(result).toBeInstanceOf(PaginatedResponseDto);
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(testRunQb.getManyAndCount).toHaveBeenCalled();
    });

    it('should apply system filter when provided', async () => {
      testRunQb.getManyAndCount.mockResolvedValue([[], 0]);
      changePointsQb.getMany.mockResolvedValue([]);

      const pagination: PaginationQueryDto = { page: 1, pageSize: 10, system: 'PaymentService' };
      await service.findAllPaginated(true, [], [], pagination);

      expect(testRunQb.andWhere).toHaveBeenCalledWith('sut.name = :system', { system: 'PaymentService' });
    });

    it('should apply environment filter when provided', async () => {
      testRunQb.getManyAndCount.mockResolvedValue([[], 0]);
      changePointsQb.getMany.mockResolvedValue([]);

      const pagination: PaginationQueryDto = { page: 1, pageSize: 10, environment: 'staging' };
      await service.findAllPaginated(true, [], [], pagination);

      expect(testRunQb.andWhere).toHaveBeenCalledWith(
        'tr.testEnvironment = :environment',
        { environment: 'staging' },
      );
    });

    it('should apply workload filter when provided', async () => {
      testRunQb.getManyAndCount.mockResolvedValue([[], 0]);
      changePointsQb.getMany.mockResolvedValue([]);

      const pagination: PaginationQueryDto = { page: 1, pageSize: 10, workload: 'soak' };
      await service.findAllPaginated(true, [], [], pagination);

      expect(testRunQb.andWhere).toHaveBeenCalledWith('tr.workload = :workload', { workload: 'soak' });
    });

    it('should apply organization scoping when organizationId is provided', async () => {
      testRunQb.getManyAndCount.mockResolvedValue([[], 0]);
      changePointsQb.getMany.mockResolvedValue([]);

      await service.findAllPaginated(true, [], [], undefined, 'org-uuid-123');

      expect(testRunQb.andWhere).toHaveBeenCalledWith(
        'sut.organization_id = :organizationId',
        { organizationId: 'org-uuid-123' },
      );
    });

    it('should return empty result for non-admin with no organization memberships', async () => {
      const result = await service.findAllPaginated(false, [], []);

      expect(result).toBeInstanceOf(PaginatedResponseDto);
      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(testRunQb.getManyAndCount).not.toHaveBeenCalled();
    });

    it('should apply org + team access filtering for non-admin users', async () => {
      testRunQb.getManyAndCount.mockResolvedValue([[], 0]);
      changePointsQb.getMany.mockResolvedValue([]);

      await service.findAllPaginated(false, ['org-1', 'org-2'], ['team-1']);

      // Should join teams table and apply complex where clause
      expect(testRunQb.leftJoin).toHaveBeenCalledWith('teams', 'team', 'team.id = sut.team_id');
      expect(testRunQb.andWhere).toHaveBeenCalled();
    });

    it('should correctly mark test runs as changepoints', async () => {
      const entity = createMockTestRunEntity();
      const mapped = createMockMappedTestRun(entity);
      mapper.mapEntityToTestRun.mockReturnValue(mapped as any);

      const changePoint = createMockChangePoint({
        system_under_test_id: entity.systemUnderTestId,
        test_environment: entity.testEnvironment,
        workload: entity.workload,
        test_run_id: entity.testRunId,
      });

      testRunQb.getManyAndCount.mockResolvedValue([[entity], 1]);
      changePointsQb.getMany.mockResolvedValue([changePoint]);
      controlGroupsQb.getMany.mockResolvedValue([]);

      const result = await service.findAllPaginated(true, [], []);

      expect(result.data[0].is_changepoint).toBe(true);
    });

    it('should correctly mark test runs as control group members', async () => {
      const entity = createMockTestRunEntity({ completed: true });
      const mapped = createMockMappedTestRun(entity);
      mapper.mapEntityToTestRun.mockReturnValue(mapped as any);

      const controlGroup = createMockControlGroup({
        control_group_id: entity.testRunId,
        system_under_test_id: entity.systemUnderTestId,
        test_environment: entity.testEnvironment,
        workload: entity.workload,
        test_runs: [entity.testRunId],
      });

      testRunQb.getManyAndCount.mockResolvedValue([[entity], 1]);
      changePointsQb.getMany.mockResolvedValue([]);
      controlGroupsQb.getMany.mockResolvedValue([controlGroup]);

      const result = await service.findAllPaginated(true, [], []);

      expect(result.data[0].is_control_group).toBe(true);
    });

    it('should use correct default sort field (createdAt) and DESC order', async () => {
      testRunQb.getManyAndCount.mockResolvedValue([[], 0]);
      changePointsQb.getMany.mockResolvedValue([]);

      await service.findAllPaginated(true, [], [], { page: 1, pageSize: 10 });

      expect(testRunQb.orderBy).toHaveBeenCalledWith('tr.createdAt', 'DESC');
    });

    it('should reject unsupported sort fields and fall back to createdAt', async () => {
      testRunQb.getManyAndCount.mockResolvedValue([[], 0]);
      changePointsQb.getMany.mockResolvedValue([]);

      await service.findAllPaginated(true, [], [], {
        page: 1,
        pageSize: 10,
        sortBy: 'injectedField; DROP TABLE test_runs;--',
        sortOrder: 'ASC',
      } as PaginationQueryDto);

      expect(testRunQb.orderBy).toHaveBeenCalledWith('tr.createdAt', 'ASC');
    });

    it('should apply correct pagination skip/take', async () => {
      testRunQb.getManyAndCount.mockResolvedValue([[], 0]);
      changePointsQb.getMany.mockResolvedValue([]);

      await service.findAllPaginated(true, [], [], { page: 3, pageSize: 20 });

      expect(testRunQb.skip).toHaveBeenCalledWith(40); // (3-1)*20
      expect(testRunQb.take).toHaveBeenCalledWith(20);
    });

    it('should throw DatabaseException on unexpected error', async () => {
      testRunQb.getManyAndCount.mockRejectedValue(new Error('Unexpected DB error'));

      await expect(service.findAllPaginated(true, [], [])).rejects.toThrow(DatabaseException);
    });

    it('should not query changepoints when test run list is empty', async () => {
      testRunQb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAllPaginated(true, [], []);

      // changePointsRepo.createQueryBuilder should not have been called for getMany
      expect(changePointsQb.getMany).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getFilterOptions
  // =========================================================================

  describe('getFilterOptions', () => {
    beforeEach(() => {
      // Three separate query builders needed for systems / envs / workloads
      let callCount = 0;
      const qbs = [
        createMockQueryBuilder<TestRunEntity>(),
        createMockQueryBuilder<TestRunEntity>(),
        createMockQueryBuilder<TestRunEntity>(),
        createMockQueryBuilder<TestRunEntity>(),
        createMockQueryBuilder<TestRunEntity>(),
        createMockQueryBuilder<TestRunEntity>(),
      ];

      qbs.forEach(qb => {
        qb.getRawMany.mockResolvedValue([]);
        qb.orderBy.mockReturnThis();
        qb.andWhere.mockReturnThis();
        qb.select.mockReturnThis();
        qb.leftJoin.mockReturnThis();
        qb.where.mockReturnThis();
      });

      testRunRepo.createQueryBuilder.mockImplementation(() => {
        return qbs[callCount++ % qbs.length];
      });
    });

    it('should return distinct systems, environments, and workloads for admin', async () => {
      let callCount = 0;
      const results = [
        [{ name: 'PaymentService' }, { name: 'OrderService' }],
        [{ env: 'production' }, { env: 'staging' }],
        [{ workload: 'loadTest' }, { workload: 'soak' }],
      ];

      testRunRepo.createQueryBuilder.mockImplementation(() => {
        const qb = createMockQueryBuilder<TestRunEntity>();
        qb.getRawMany.mockResolvedValue(results[callCount++ % results.length]);
        qb.orderBy.mockReturnThis();
        qb.andWhere.mockReturnThis();
        qb.select.mockReturnThis();
        qb.leftJoin.mockReturnThis();
        qb.where.mockReturnThis();
        return qb;
      });

      const result = await service.getFilterOptions(true, [], []);

      expect(result.systems).toEqual(['PaymentService', 'OrderService']);
      expect(result.environments).toEqual(['production', 'staging']);
      expect(result.workloads).toEqual(['loadTest', 'soak']);
    });

    it('should return empty arrays for non-admin with no organization memberships', async () => {
      const result = await service.getFilterOptions(false, [], []);

      expect(result).toEqual({ systems: [], environments: [], workloads: [] });
    });

    it('should scope by organizationId when provided', async () => {
      let qbIndex = 0;
      const qbs = Array.from({ length: 6 }, () => {
        const qb = createMockQueryBuilder<TestRunEntity>();
        qb.getRawMany.mockResolvedValue([]);
        qb.orderBy.mockReturnThis();
        qb.andWhere.mockReturnThis();
        qb.select.mockReturnThis();
        qb.leftJoin.mockReturnThis();
        qb.where.mockReturnThis();
        return qb;
      });
      testRunRepo.createQueryBuilder.mockImplementation(() => qbs[qbIndex++ % qbs.length]);

      await service.getFilterOptions(true, [], [], 'org-uuid-123');

      // Each query builder should have the org filter applied
      const orgWhereCall = qbs[0].andWhere.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('organization_id'),
      );
      expect(orgWhereCall).toBeDefined();
    });

    it('should throw DatabaseException on unexpected error', async () => {
      testRunRepo.createQueryBuilder.mockImplementation(() => {
        throw new Error('DB failure');
      });

      await expect(service.getFilterOptions(true, [], [])).rejects.toThrow(DatabaseException);
    });
  });

  // =========================================================================
  // findAll
  // =========================================================================

  describe('findAll', () => {
    it('should return all test runs for admin users', async () => {
      const entity = createMockTestRunEntity();
      const mapped = createMockMappedTestRun(entity);
      mapper.mapEntityToTestRun.mockReturnValue(mapped as any);

      testRunQb.getMany.mockResolvedValue([entity]);
      changePointsQb.getMany.mockResolvedValue([]);
      controlGroupsQb.getMany.mockResolvedValue([]);

      const result = await service.findAll(true, []);

      expect(result).toHaveLength(1);
      expect(result[0].test_run_id).toBe(entity.testRunId);
    });

    it('should return empty array for non-admin with no organizations', async () => {
      const result = await service.findAll(false, []);

      expect(result).toEqual([]);
      expect(testRunQb.getMany).not.toHaveBeenCalled();
    });

    it('should filter by organization_id for non-admin users', async () => {
      testRunQb.getMany.mockResolvedValue([]);
      changePointsQb.getMany.mockResolvedValue([]);
      controlGroupsQb.getMany.mockResolvedValue([]);

      await service.findAll(false, ['org-1']);

      expect(testRunQb.andWhere).toHaveBeenCalledWith(
        'sut.organization_id IN (:...orgIds)',
        { orgIds: ['org-1'] },
      );
    });

    it('should correctly annotate changepoints in the result', async () => {
      const entity = createMockTestRunEntity();
      const mapped = createMockMappedTestRun(entity);
      mapper.mapEntityToTestRun.mockReturnValue(mapped as any);

      const cp = createMockChangePoint({
        system_under_test_id: entity.systemUnderTestId,
        workload: entity.workload,
        test_environment: entity.testEnvironment,
        test_run_id: entity.testRunId,
      });

      testRunQb.getMany.mockResolvedValue([entity]);
      changePointsQb.getMany.mockResolvedValue([cp]);
      controlGroupsQb.getMany.mockResolvedValue([]);

      const result = await service.findAll(true, []);

      expect(result[0].is_changepoint).toBe(true);
    });

    it('should correctly annotate control group members in the result', async () => {
      const entity = createMockTestRunEntity({ completed: true });
      const mapped = createMockMappedTestRun(entity);
      mapper.mapEntityToTestRun.mockReturnValue(mapped as any);

      const cg = createMockControlGroup({
        control_group_id: entity.testRunId,
        system_under_test_id: entity.systemUnderTestId,
        test_environment: entity.testEnvironment,
        workload: entity.workload,
        test_runs: [entity.testRunId],
      });

      testRunQb.getMany.mockResolvedValue([entity]);
      changePointsQb.getMany.mockResolvedValue([]);
      controlGroupsQb.getMany.mockResolvedValue([cg]);

      const result = await service.findAll(true, []);

      expect(result[0].is_control_group).toBe(true);
    });

    it('should throw DatabaseException on unexpected error', async () => {
      testRunQb.getMany.mockRejectedValue(new Error('DB error'));

      await expect(service.findAll(true, [])).rejects.toThrow(DatabaseException);
    });
  });

  // =========================================================================
  // findByTestRunId
  // =========================================================================

  describe('findByTestRunId', () => {
    it('should return a test run for admin by testRunId', async () => {
      const entity = createMockTestRunEntity();
      const mapped = createMockMappedTestRun(entity);
      mapper.mapEntityToTestRun.mockReturnValue(mapped as any);
      testRunRepo.findOne.mockResolvedValue(entity);
      changePointsRepo.findOne.mockResolvedValue(null);

      const result = await service.findByTestRunId(entity.testRunId, userId, true);

      expect(result.test_run_id).toBe(entity.testRunId);
      expect(testRunRepo.findOne).toHaveBeenCalledWith({
        where: { testRunId: entity.testRunId },
        relations: ['systemUnderTest', 'systemUnderTest.pyroscopeInstance'],
      });
    });

    it('should throw ResourceNotFoundException when test run not found', async () => {
      testRunRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findByTestRunId('non-existent', userId, true),
      ).rejects.toThrow(ResourceNotFoundException);
    });

    it('should throw ResourceNotFoundException for non-admin accessing system without org', async () => {
      const entity = createMockTestRunEntity({
        systemUnderTest: {
          id: 'system-uuid-123',
          name: 'PaymentService',
          organization_id: undefined, // no org
          created_at: NOW,
        } as unknown as SystemUnderTest,
      });

      testRunRepo.findOne.mockResolvedValue(entity);

      await expect(
        service.findByTestRunId(entity.testRunId, userId, false),
      ).rejects.toThrow(ResourceNotFoundException);
    });

    it('should throw ResourceNotFoundException for non-admin not in org', async () => {
      authzService.isOrganizationMember.mockResolvedValue(false);

      const entity = createMockTestRunEntity();
      testRunRepo.findOne.mockResolvedValue(entity);

      await expect(
        service.findByTestRunId(entity.testRunId, userId, false),
      ).rejects.toThrow(ResourceNotFoundException);
    });

    it('should throw ResourceNotFoundException for non-admin blocked by team restriction', async () => {
      authzService.isOrganizationMember.mockResolvedValue(true);
      authzService.canViewTeamResources.mockResolvedValue({ allowed: false, reason: 'restricted' });

      const entity = createMockTestRunEntity();
      testRunRepo.findOne.mockResolvedValue(entity);

      await expect(
        service.findByTestRunId(entity.testRunId, userId, false),
      ).rejects.toThrow(ResourceNotFoundException);
    });

    it('should set is_changepoint=true when test run is a changepoint', async () => {
      const entity = createMockTestRunEntity();
      const mapped = createMockMappedTestRun(entity);
      mapper.mapEntityToTestRun.mockReturnValue(mapped as any);
      testRunRepo.findOne.mockResolvedValue(entity);
      changePointsRepo.findOne.mockResolvedValue(createMockChangePoint());

      const result = await service.findByTestRunId(entity.testRunId, userId, true);

      expect(result.is_changepoint).toBe(true);
    });

    it('should throw DatabaseException on unexpected error', async () => {
      testRunRepo.findOne.mockRejectedValue(new Error('Network error'));

      await expect(
        service.findByTestRunId('some-id', userId, true),
      ).rejects.toThrow(DatabaseException);
    });
  });

  // =========================================================================
  // findOne
  // =========================================================================

  describe('findOne', () => {
    it('should return a test run by UUID for admin', async () => {
      const entity = createMockTestRunEntity();
      const mapped = createMockMappedTestRun(entity);
      mapper.mapEntityToTestRun.mockReturnValue(mapped as any);
      testRunRepo.findOne.mockResolvedValue(entity);
      changePointsRepo.findOne.mockResolvedValue(null);

      const result = await service.findOne(entity.id, userId, true);

      expect(result.id).toBe(entity.id);
      expect(testRunRepo.findOne).toHaveBeenCalledWith({
        where: { id: entity.id },
        relations: ['systemUnderTest', 'systemUnderTest.pyroscopeInstance'],
      });
    });

    it('should throw ResourceNotFoundException when UUID not found', async () => {
      testRunRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing-uuid', userId, true)).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should throw ResourceNotFoundException for non-admin accessing system without org', async () => {
      const entity = createMockTestRunEntity({
        systemUnderTest: {
          id: 'system-uuid-123',
          name: 'PaymentService',
          organization_id: undefined,
          created_at: NOW,
        } as unknown as SystemUnderTest,
      });

      testRunRepo.findOne.mockResolvedValue(entity);

      await expect(service.findOne(entity.id, userId, false)).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should throw ResourceNotFoundException for non-admin not in org', async () => {
      authzService.isOrganizationMember.mockResolvedValue(false);

      const entity = createMockTestRunEntity();
      testRunRepo.findOne.mockResolvedValue(entity);

      await expect(service.findOne(entity.id, userId, false)).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should throw ResourceNotFoundException for non-admin blocked by team restriction', async () => {
      authzService.isOrganizationMember.mockResolvedValue(true);
      authzService.canViewTeamResources.mockResolvedValue({ allowed: false, reason: 'restricted' });

      const entity = createMockTestRunEntity();
      testRunRepo.findOne.mockResolvedValue(entity);

      await expect(service.findOne(entity.id, userId, false)).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should set is_changepoint=true when test run is a changepoint', async () => {
      const entity = createMockTestRunEntity();
      const mapped = createMockMappedTestRun(entity);
      mapper.mapEntityToTestRun.mockReturnValue(mapped as any);
      testRunRepo.findOne.mockResolvedValue(entity);
      changePointsRepo.findOne.mockResolvedValue(createMockChangePoint());

      const result = await service.findOne(entity.id, userId, true);

      expect(result.is_changepoint).toBe(true);
    });

    it('should throw DatabaseException on unexpected error', async () => {
      testRunRepo.findOne.mockRejectedValue(new Error('DB error'));

      await expect(service.findOne('some-id', userId, true)).rejects.toThrow(DatabaseException);
    });
  });

  // =========================================================================
  // getTestRunByTestRunId
  // =========================================================================

  describe('getTestRunByTestRunId', () => {
    it('should return a test run when found and accessible', async () => {
      const entity = createMockTestRunEntity();
      const mapped = createMockMappedTestRun(entity);
      mapper.mapEntityToTestRun.mockReturnValue(mapped as any);
      testRunRepo.findOne.mockResolvedValue(entity);
      changePointsRepo.findOne.mockResolvedValue(null);

      const result = await service.getTestRunByTestRunId(entity.testRunId, userId, true);

      expect(result).not.toBeNull();
      expect(result?.test_run_id).toBe(entity.testRunId);
    });

    it('should return null when test run not found', async () => {
      testRunRepo.findOne.mockResolvedValue(null);

      const result = await service.getTestRunByTestRunId('missing-id', userId, true);

      expect(result).toBeNull();
    });

    it('should return null for non-admin when system has no org', async () => {
      const entity = createMockTestRunEntity({
        systemUnderTest: {
          id: 'system-uuid-123',
          name: 'PaymentService',
          organization_id: undefined,
          created_at: NOW,
        } as unknown as SystemUnderTest,
      });

      testRunRepo.findOne.mockResolvedValue(entity);

      const result = await service.getTestRunByTestRunId(entity.testRunId, userId, false);

      expect(result).toBeNull();
    });

    it('should return null for non-admin not in org', async () => {
      authzService.isOrganizationMember.mockResolvedValue(false);

      const entity = createMockTestRunEntity();
      testRunRepo.findOne.mockResolvedValue(entity);

      const result = await service.getTestRunByTestRunId(entity.testRunId, userId, false);

      expect(result).toBeNull();
    });

    it('should return null for non-admin blocked by team restriction', async () => {
      authzService.isOrganizationMember.mockResolvedValue(true);
      authzService.canViewTeamResources.mockResolvedValue({ allowed: false, reason: 'restricted' });

      const entity = createMockTestRunEntity();
      testRunRepo.findOne.mockResolvedValue(entity);

      const result = await service.getTestRunByTestRunId(entity.testRunId, userId, false);

      expect(result).toBeNull();
    });

    it('should populate system_name from systems_under_test', async () => {
      const entity = createMockTestRunEntity();
      const mapped = createMockMappedTestRun(entity);
      mapper.mapEntityToTestRun.mockReturnValue(mapped as any);
      testRunRepo.findOne.mockResolvedValue(entity);
      changePointsRepo.findOne.mockResolvedValue(null);

      const result = await service.getTestRunByTestRunId(entity.testRunId, userId, true);

      expect(result?.system_name).toBe('PaymentService');
    });

    it('should return null and not throw on database error', async () => {
      testRunRepo.findOne.mockRejectedValue(new Error('Connection reset'));

      const result = await service.getTestRunByTestRunId('some-id', userId, true);

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // findByTestRunIdAndParams
  // =========================================================================

  describe('findByTestRunIdAndParams', () => {
    it('should return a test run matching all params for admin', async () => {
      const entity = createMockTestRunEntity();
      const mapped = createMockMappedTestRun(entity);
      mapper.mapEntityToTestRun.mockReturnValue(mapped as any);

      testRunQb.getOne.mockResolvedValue(entity);
      changePointsRepo.findOne.mockResolvedValue(null);

      const result = await service.findByTestRunIdAndParams(
        entity.testRunId,
        'PaymentService',
        'production',
        'loadTest',
        true,
        [],
        [],
      );

      expect(result.test_run_id).toBe(entity.testRunId);
      expect(testRunQb.where).toHaveBeenCalledWith('tr.testRunId = :testRunId', {
        testRunId: entity.testRunId,
      });
      expect(testRunQb.andWhere).toHaveBeenCalledWith('sut.name = :systemName', {
        systemName: 'PaymentService',
      });
      expect(testRunQb.andWhere).toHaveBeenCalledWith('tr.testEnvironment = :environment', {
        environment: 'production',
      });
      expect(testRunQb.andWhere).toHaveBeenCalledWith('tr.workload = :workload', {
        workload: 'loadTest',
      });
    });

    it('should apply explicit organizationId filter', async () => {
      const entity = createMockTestRunEntity();
      const mapped = createMockMappedTestRun(entity);
      mapper.mapEntityToTestRun.mockReturnValue(mapped as any);

      testRunQb.getOne.mockResolvedValue(entity);
      changePointsRepo.findOne.mockResolvedValue(null);

      await service.findByTestRunIdAndParams(
        entity.testRunId,
        'PaymentService',
        'production',
        'loadTest',
        true,
        [],
        [],
        'org-uuid-123',
      );

      expect(testRunQb.andWhere).toHaveBeenCalledWith(
        'sut.organization_id = :organizationId',
        { organizationId: 'org-uuid-123' },
      );
    });

    it('should throw ResourceNotFoundException when test run not found', async () => {
      testRunQb.getOne.mockResolvedValue(null);

      await expect(
        service.findByTestRunIdAndParams(
          'missing',
          'SomeSystem',
          'env',
          'workload',
          true,
          [],
          [],
        ),
      ).rejects.toThrow(ResourceNotFoundException);
    });

    it('should throw ResourceNotFoundException for non-admin with no org memberships', async () => {
      await expect(
        service.findByTestRunIdAndParams(
          'test-run-id',
          'SomeSystem',
          'env',
          'workload',
          false,
          [],
          [],
        ),
      ).rejects.toThrow(ResourceNotFoundException);
    });

    it('should apply org-based filter for non-admin without explicit orgId', async () => {
      const entity = createMockTestRunEntity();
      const mapped = createMockMappedTestRun(entity);
      mapper.mapEntityToTestRun.mockReturnValue(mapped as any);

      testRunQb.getOne.mockResolvedValue(entity);
      changePointsRepo.findOne.mockResolvedValue(null);

      await service.findByTestRunIdAndParams(
        entity.testRunId,
        'PaymentService',
        'production',
        'loadTest',
        false,
        ['org-1', 'org-2'],
        [],
      );

      expect(testRunQb.andWhere).toHaveBeenCalledWith(
        '(sut.organization_id IN (:...orgIds) OR sut.organization_id IS NULL)',
        { orgIds: ['org-1', 'org-2'] },
      );
    });

    it('should mark test run as changepoint in result', async () => {
      const entity = createMockTestRunEntity();
      const mapped = createMockMappedTestRun(entity);
      mapper.mapEntityToTestRun.mockReturnValue(mapped as any);

      testRunQb.getOne.mockResolvedValue(entity);
      changePointsRepo.findOne.mockResolvedValue(createMockChangePoint());

      const result = await service.findByTestRunIdAndParams(
        entity.testRunId,
        'PaymentService',
        'production',
        'loadTest',
        true,
        [],
        [],
      );

      expect(result.is_changepoint).toBe(true);
    });
  });

  // =========================================================================
  // getRelatedTestRuns
  // =========================================================================

  describe('getRelatedTestRuns', () => {
    it('should return related test runs using system/env/workload params when provided', async () => {
      const entity = createMockTestRunEntity();
      const mapped = createMockMappedTestRun(entity);
      mapper.mapEntityToTestRun.mockReturnValue(mapped as any);

      // findByTestRunIdAndParams → testRunQb.getOne
      testRunQb.getOne.mockResolvedValueOnce(entity);
      changePointsRepo.findOne.mockResolvedValue(null);

      // getRelatedTestRuns query
      const relatedEntity = createMockTestRunEntity({
        id: 'related-uuid',
        testRunId: 'related-run-id',
      });
      testRunQb.getMany.mockResolvedValueOnce([relatedEntity]);

      const result = await service.getRelatedTestRuns(
        entity.testRunId,
        true,
        [],
        [],
        'PaymentService',
        'production',
        'loadTest',
      );

      expect(result).toHaveLength(1);
      expect(result[0].test_run_id).toBe('related-run-id');
    });

    it('should look up current test run by testRunId when no system/env/workload params given', async () => {
      const entity = createMockTestRunEntity();
      const mapped = createMockMappedTestRun(entity);
      mapper.mapEntityToTestRun.mockReturnValue(mapped as any);

      testRunRepo.findOne.mockResolvedValue(entity);
      testRunQb.getMany.mockResolvedValue([]);

      const result = await service.getRelatedTestRuns(entity.testRunId, true, [], []);

      expect(result).toEqual([]);
      expect(testRunRepo.findOne).toHaveBeenCalledWith({
        where: { testRunId: entity.testRunId },
        relations: ['systemUnderTest', 'systemUnderTest.pyroscopeInstance'],
      });
    });

    it('should throw ResourceNotFoundException when test run not found', async () => {
      testRunRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getRelatedTestRuns('missing', true, [], []),
      ).rejects.toThrow(ResourceNotFoundException);
    });

    it('should map related entities to RelatedTestRun format', async () => {
      const entity = createMockTestRunEntity();
      const mapped = createMockMappedTestRun(entity);
      mapper.mapEntityToTestRun.mockReturnValue(mapped as any);

      testRunRepo.findOne.mockResolvedValue(entity);

      const relatedEntity = createMockTestRunEntity({
        id: 'related-uuid',
        testRunId: 'related-run-id',
        applicationRelease: '2.0.0',
        annotations: ['release candidate'],
        completed: true,
      });
      testRunQb.getMany.mockResolvedValue([relatedEntity]);

      const result = await service.getRelatedTestRuns(entity.testRunId, true, [], []);

      expect(result[0]).toMatchObject({
        test_run_id: 'related-run-id',
        application_release: '2.0.0',
        annotations: ['release candidate'],
        completed: true,
      });
    });
  });

  // =========================================================================
  // getSystemsSummary
  // =========================================================================

  describe('getSystemsSummary', () => {
    it('should return all systems for admin users', async () => {
      const system: Partial<SystemUnderTest> = {
        id: 'system-uuid-123',
        name: 'PaymentService',
        created_at: NOW,
      };
      systemRepo.find.mockResolvedValue([system as SystemUnderTest]);
      testRunQb.getMany.mockResolvedValue([]);

      const result = await service.getSystemsSummary(true, [], []);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('PaymentService');
      expect(systemRepo.find).toHaveBeenCalledWith({ order: { name: 'ASC' } });
    });

    it('should return empty array for non-admin with no org memberships', async () => {
      const result = await service.getSystemsSummary(false, [], []);

      expect(result).toEqual([]);
    });

    it('should scope to organizationId when provided for admin', async () => {
      const system: Partial<SystemUnderTest> = {
        id: 'system-uuid-123',
        name: 'PaymentService',
        created_at: NOW,
      };
      systemQb.getMany.mockResolvedValue([system as SystemUnderTest]);
      testRunQb.getMany.mockResolvedValue([]);

      const result = await service.getSystemsSummary(true, [], [], 'org-uuid-123');

      expect(result).toHaveLength(1);
      expect(systemQb.where).toHaveBeenCalledWith(
        'system.organization_id = :organizationId',
        { organizationId: 'org-uuid-123' },
      );
    });

    it('should build environment/workload summary from test runs', async () => {
      const system: Partial<SystemUnderTest> = {
        id: 'system-uuid-123',
        name: 'PaymentService',
        created_at: NOW,
      };
      systemRepo.find.mockResolvedValue([system as SystemUnderTest]);

      const testRun1 = createMockTestRunEntity({ testEnvironment: 'production', workload: 'loadTest' });
      const testRun2 = createMockTestRunEntity({ testEnvironment: 'staging', workload: 'soak' });
      testRunQb.getMany.mockResolvedValue([testRun1, testRun2]);

      const result = await service.getSystemsSummary(true, [], []);

      expect(result[0].environments).toContainEqual({ environment: 'production', workloads: ['loadTest'] });
      expect(result[0].environments).toContainEqual({ environment: 'staging', workloads: ['soak'] });
    });

    it('should return empty environments when no test runs exist for a system', async () => {
      const system: Partial<SystemUnderTest> = {
        id: 'no-runs-system',
        name: 'EmptySystem',
        created_at: NOW,
      };
      systemRepo.find.mockResolvedValue([system as SystemUnderTest]);
      testRunQb.getMany.mockResolvedValue([]);

      const result = await service.getSystemsSummary(true, [], []);

      expect(result[0].environments).toEqual([]);
    });

    it('should apply org + team filtering for non-admin users', async () => {
      systemQb.getMany.mockResolvedValue([]);
      testRunQb.getMany.mockResolvedValue([]);

      await service.getSystemsSummary(false, ['org-1'], ['team-1']);

      expect(systemQb.leftJoin).toHaveBeenCalledWith('teams', 'team', 'team.id = system.team_id');
    });

    it('should throw DatabaseException on unexpected error', async () => {
      systemRepo.find.mockRejectedValue(new Error('DB error'));

      await expect(service.getSystemsSummary(true, [], [])).rejects.toThrow(DatabaseException);
    });
  });

  // =========================================================================
  // getAllTags
  // =========================================================================

  describe('getAllTags', () => {
    it('should return sorted list of unique tags for admin', async () => {
      testRunQb.getRawMany.mockResolvedValue([
        { tag: 'performance' },
        { tag: 'baseline' },
        { tag: 'regression' },
      ]);

      const result = await service.getAllTags(true, []);

      expect(result).toEqual(['baseline', 'performance', 'regression']);
    });

    it('should return empty array for non-admin with no org memberships', async () => {
      const result = await service.getAllTags(false, []);

      expect(result).toEqual([]);
      expect(testRunQb.getRawMany).not.toHaveBeenCalled();
    });

    it('should apply org filter for non-admin with org memberships', async () => {
      testRunQb.getRawMany.mockResolvedValue([]);

      await service.getAllTags(false, ['org-1']);

      expect(testRunQb.leftJoin).toHaveBeenCalledWith(
        'systems_under_test',
        'sut',
        'sut.id = tr.systemUnderTestId',
      );
      expect(testRunQb.andWhere).toHaveBeenCalledWith(
        'sut.organization_id IN (:...orgIds)',
        { orgIds: ['org-1'] },
      );
    });

    it('should filter out null/undefined tag values', async () => {
      testRunQb.getRawMany.mockResolvedValue([
        { tag: 'performance' },
        { tag: null },
        { tag: undefined },
        { tag: 'baseline' },
      ]);

      const result = await service.getAllTags(true, []);

      expect(result).toEqual(['baseline', 'performance']);
    });

    it('should re-throw errors from query', async () => {
      testRunQb.getRawMany.mockRejectedValue(new Error('Query error'));

      await expect(service.getAllTags(true, [])).rejects.toThrow('Query error');
    });
  });

  // =========================================================================
  // getAllAnnotations
  // =========================================================================

  describe('getAllAnnotations', () => {
    it('should return sorted list of unique annotations for admin', async () => {
      testRunQb.getRawMany.mockResolvedValue([
        { annotation: 'release candidate' },
        { annotation: 'baseline' },
      ]);

      const result = await service.getAllAnnotations(true, []);

      expect(result).toEqual(['baseline', 'release candidate']);
    });

    it('should return empty array for non-admin with no org memberships', async () => {
      const result = await service.getAllAnnotations(false, []);

      expect(result).toEqual([]);
    });

    it('should apply org filter for non-admin with org memberships', async () => {
      testRunQb.getRawMany.mockResolvedValue([]);

      await service.getAllAnnotations(false, ['org-1']);

      expect(testRunQb.leftJoin).toHaveBeenCalledWith(
        'systems_under_test',
        'sut',
        'sut.id = tr.systemUnderTestId',
      );
      expect(testRunQb.andWhere).toHaveBeenCalledWith(
        'sut.organization_id IN (:...orgIds)',
        { orgIds: ['org-1'] },
      );
    });

    it('should filter out null annotation values', async () => {
      testRunQb.getRawMany.mockResolvedValue([
        { annotation: 'baseline' },
        { annotation: null },
      ]);

      const result = await service.getAllAnnotations(true, []);

      expect(result).toEqual(['baseline']);
    });

    it('should re-throw errors from query', async () => {
      testRunQb.getRawMany.mockRejectedValue(new Error('DB timeout'));

      await expect(service.getAllAnnotations(true, [])).rejects.toThrow('DB timeout');
    });
  });

  // =========================================================================
  // getBaselineCandidates
  // =========================================================================

  describe('getBaselineCandidates', () => {
    it('should return completed test runs for the given system/env/workload', async () => {
      const entity = createMockTestRunEntity({ completed: true });
      const mapped = createMockMappedTestRun(entity);
      mapper.mapEntityToTestRun.mockReturnValue(mapped as any);

      testRunQb.getMany.mockResolvedValue([entity]);

      const result = await service.getBaselineCandidates(
        'system-uuid-123',
        'production',
        'loadTest',
      );

      expect(result).toHaveLength(1);
      expect(testRunQb.where).toHaveBeenCalledWith(
        'tr.systemUnderTestId = :systemUnderTestId',
        { systemUnderTestId: 'system-uuid-123' },
      );
      expect(testRunQb.andWhere).toHaveBeenCalledWith(
        'tr.testEnvironment = :testEnvironment',
        { testEnvironment: 'production' },
      );
      expect(testRunQb.andWhere).toHaveBeenCalledWith(
        'tr.workload = :workload',
        { workload: 'loadTest' },
      );
      expect(testRunQb.andWhere).toHaveBeenCalledWith(
        'tr.completed = :completed',
        { completed: true },
      );
    });

    it('should apply excludeTestRunId filter when provided', async () => {
      testRunQb.getMany.mockResolvedValue([]);

      await service.getBaselineCandidates(
        'system-uuid-123',
        'production',
        'loadTest',
        'excluded-run-id',
      );

      // Excludes on BOTH identifiers: callers pass either the human-readable
      // test_run_id or the row UUID (the report dialog passes the UUID).
      expect(testRunQb.andWhere).toHaveBeenCalledWith(
        'tr.testRunId != :excludeTestRunId AND CAST(tr.id AS text) != :excludeTestRunId',
        { excludeTestRunId: 'excluded-run-id' },
      );
    });

    it('should not apply excludeTestRunId filter when not provided', async () => {
      testRunQb.getMany.mockResolvedValue([]);

      await service.getBaselineCandidates(
        'system-uuid-123',
        'production',
        'loadTest',
      );

      const excludeCalls = testRunQb.andWhere.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === 'string' && (call[0] as string).includes('excludeTestRunId'),
      );
      expect(excludeCalls).toHaveLength(0);
    });

    it('should use default limit of 50', async () => {
      testRunQb.getMany.mockResolvedValue([]);

      await service.getBaselineCandidates(
        'system-uuid-123',
        'production',
        'loadTest',
      );

      expect(testRunQb.limit).toHaveBeenCalledWith(50);
    });

    it('should use provided limit', async () => {
      testRunQb.getMany.mockResolvedValue([]);

      await service.getBaselineCandidates(
        'system-uuid-123',
        'production',
        'loadTest',
        undefined,
        10,
      );

      expect(testRunQb.limit).toHaveBeenCalledWith(10);
    });

    it('should return empty array when no candidates found', async () => {
      testRunQb.getMany.mockResolvedValue([]);

      const result = await service.getBaselineCandidates(
        'system-uuid-123',
        'production',
        'loadTest',
      );

      expect(result).toEqual([]);
    });

    it('should throw DatabaseException on unexpected error', async () => {
      testRunQb.getMany.mockRejectedValue(new Error('Query failed'));

      await expect(
        service.getBaselineCandidates('system-uuid-123', 'production', 'loadTest'),
      ).rejects.toThrow(DatabaseException);
    });
  });

  // =========================================================================
  // getBaselineCandidates scope
  // =========================================================================

  describe('getBaselineCandidates scope', () => {
    it('omits env/workload filters when not provided', async () => {
      const qb: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      jest.spyOn(service['testRunRepo'], 'createQueryBuilder' as any).mockReturnValue(qb);
      await service.getBaselineCandidates('sut-1', undefined, undefined, 'exclude-me');
      const clauses = qb.andWhere.mock.calls.map((c: any[]) => c[0]);
      expect(clauses).not.toContain('tr.testEnvironment = :testEnvironment');
      expect(clauses).not.toContain('tr.workload = :workload');
      expect(clauses).toContain('tr.completed = :completed');
    });
  });

  // =========================================================================
  // getRequestNames
  // =========================================================================

  describe('getRequestNames', () => {
    const testRunId = 'PaymentService-production-loadTest-001';

    beforeEach(() => {
      // getRequestNames calls findByTestRunId first
      const entity = createMockTestRunEntity();
      const mapped = createMockMappedTestRun(entity);
      mapper.mapEntityToTestRun.mockReturnValue(mapped as any);
      testRunRepo.findOne.mockResolvedValue(entity);
      changePointsRepo.findOne.mockResolvedValue(null);
    });

    it('should return request names from requests_raw when no panelDescription', async () => {
      testRunRepo.query.mockResolvedValue([
        { request_name: 'scenario1|transaction1|sampler1' },
        { request_name: 'scenario2|transaction2|sampler2' },
      ]);

      const result = await service.getRequestNames(testRunId, userId, true);

      expect(result).toEqual([
        'scenario1|transaction1|sampler1',
        'scenario2|transaction2|sampler2',
      ]);
      expect(testRunRepo.query).toHaveBeenCalledWith(
        expect.stringContaining('requests_raw'),
        [testRunId],
      );
    });

    it('should query ds_panels/ds_metrics when panelDescription is provided', async () => {
      testRunRepo.query.mockResolvedValue([{ metric_name: 'http_request_duration_p95' }]);

      const result = await service.getRequestNames(testRunId, userId, true, 'Response Time');

      expect(result).toEqual(['http_request_duration_p95']);
      // It should use the entity's id (UUID), not testRunId
      expect(testRunRepo.query).toHaveBeenCalledWith(
        expect.stringContaining('ds_panels'),
        [
          'test-run-uuid-123',   // entity.id (UUID)
          '%Response Time%',
        ],
      );
    });

    it('should return empty array when no request names found', async () => {
      testRunRepo.query.mockResolvedValue([]);

      const result = await service.getRequestNames(testRunId, userId, true);

      expect(result).toEqual([]);
    });

    it('should throw DatabaseException when query fails', async () => {
      testRunRepo.query.mockRejectedValue(new Error('Query timeout'));

      await expect(service.getRequestNames(testRunId, userId, true)).rejects.toThrow(
        DatabaseException,
      );
    });

    it('should throw DatabaseException when underlying test run lookup fails', async () => {
      // getRequestNames wraps all thrown errors (including ResourceNotFoundException from
      // findByTestRunId) in a DatabaseException via its own catch block.
      testRunRepo.findOne.mockResolvedValue(null);

      await expect(service.getRequestNames('missing-run', userId, true)).rejects.toThrow(
        DatabaseException,
      );
    });
  });

  // =========================================================================
  // applyTeamRestriction (indirectly via findByTestRunIdAndParams)
  // =========================================================================

  describe('applyTeamRestriction (via findByTestRunIdAndParams)', () => {
    it('should join teams table and add team restriction WHERE clause', async () => {
      const entity = createMockTestRunEntity();
      const mapped = createMockMappedTestRun(entity);
      mapper.mapEntityToTestRun.mockReturnValue(mapped as any);

      testRunQb.getOne.mockResolvedValue(entity);
      changePointsRepo.findOne.mockResolvedValue(null);

      await service.findByTestRunIdAndParams(
        entity.testRunId,
        'PaymentService',
        'production',
        'loadTest',
        false,
        ['org-1'],
        ['team-1'],
      );

      expect(testRunQb.leftJoin).toHaveBeenCalledWith('teams', 'team', 'team.id = sut.team_id');
      // The team restriction WHERE clause should include userTeamIds
      const teamWhereCall = testRunQb.andWhere.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' &&
          (call[0] as string).includes('sut.team_id IN (:...userTeamIds)'),
      );
      expect(teamWhereCall).toBeDefined();
    });

    it('should not include userTeamIds clause when user has no team memberships', async () => {
      const entity = createMockTestRunEntity();
      const mapped = createMockMappedTestRun(entity);
      mapper.mapEntityToTestRun.mockReturnValue(mapped as any);

      testRunQb.getOne.mockResolvedValue(entity);
      changePointsRepo.findOne.mockResolvedValue(null);

      await service.findByTestRunIdAndParams(
        entity.testRunId,
        'PaymentService',
        'production',
        'loadTest',
        false,
        ['org-1'],
        [], // no teams
      );

      expect(testRunQb.leftJoin).toHaveBeenCalledWith('teams', 'team', 'team.id = sut.team_id');
      // No userTeamIds in the params
      const teamWhereCall = testRunQb.andWhere.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' &&
          (call[0] as string).includes('sut.team_id IN (:...userTeamIds)'),
      );
      expect(teamWhereCall).toBeUndefined();
    });
  });
});
