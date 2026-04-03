import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import {
  TestRun as TestRunEntity,
  SystemUnderTest,
  DsChangePoints,
  DsControlGroups,
} from '../../../entities';
import { ResourceNotFoundException, DatabaseException } from '../../../common/exceptions/business.exception';
import { PaginationQueryDto, PaginatedResponseDto } from '../../../common/dto';
import { TestRunsMapperService } from './test-runs-mapper.service';
import { TestRun, RelatedTestRun, SystemsSummary } from '../types/test-run.types';
import { AuthorizationService } from '../../../common/services/authorization.service';

/**
 * Service responsible for basic CRUD query operations on test runs
 * Handles: findAll, findOne, findByTestRunId, pagination, and related queries
 *
 * Authorization:
 * - All query methods accept userId and roles parameters for authorization
 * - Currently TestRun entity does not have organization_id, so all data is treated as legacy
 * - When organization_id is added to TestRun (Phase 4), authorization filtering will be enabled
 * - Global admins bypass all authorization checks
 */
@Injectable()
export class TestRunsCrudQueryService {
  private readonly logger = new Logger(TestRunsCrudQueryService.name);

  constructor(
    @InjectRepository(TestRunEntity)
    private readonly testRunRepo: Repository<TestRunEntity>,
    @InjectRepository(SystemUnderTest)
    private readonly systemRepo: Repository<SystemUnderTest>,
    @InjectRepository(DsChangePoints)
    private readonly changePointsRepo: Repository<DsChangePoints>,
    @InjectRepository(DsControlGroups)
    private readonly controlGroupsRepo: Repository<DsControlGroups>,
    private readonly mapper: TestRunsMapperService,
    private readonly authzService: AuthorizationService,
  ) {}

  /**
   * Apply team-level access restriction to a query builder.
   * Ensures non-admin users can only see resources from teams they belong to
   * when the team has restrict_to_team_members enabled.
   */
  private async applyTeamRestriction(
    queryBuilder: SelectQueryBuilder<any>,
    sutAlias: string,
    userId: string,
  ): Promise<void> {
    const userTeamIds = await this.authzService.getAccessibleTeams(userId);

    queryBuilder.leftJoin('teams', 'team', `team.id = ${sutAlias}.team_id`);
    queryBuilder.andWhere(
      '(' +
        `${sutAlias}.team_id IS NULL` +
        ' OR team.restrict_to_team_members = false' +
        (userTeamIds.length > 0
          ? ` OR ${sutAlias}.team_id IN (:...userTeamIds)`
          : '') +
      ')',
      userTeamIds.length > 0 ? { userTeamIds } : {},
    );
  }

  /**
   * Check if a test run is marked as a changepoint
   */
  async isTestRunChangepoint(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    testRunId: string
  ): Promise<boolean> {
    try {
      const changepoint = await this.changePointsRepo.findOne({
        where: {
          system_under_test_id: systemUnderTestId,
          test_environment: testEnvironment,
          workload,
          test_run_id: testRunId
        },
        select: ['id']
      });

      return !!changepoint;
    } catch (error) {
      this.logger.error(`Failed to check if test run is changepoint: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Check if a test run is in a control group
   */
  async isTestRunInControlGroup(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    testRunId: string
  ): Promise<boolean> {
    try {
      const controlGroups = await this.controlGroupsRepo.find({
        where: {
          system_under_test_id: systemUnderTestId,
          test_environment: testEnvironment,
          workload
        }
      });

      if (controlGroups.length === 0) {
        return false;
      }

      const mostRecentTestRun = await this.testRunRepo.findOne({
        where: {
          systemUnderTestId,
          testEnvironment,
          workload,
          completed: true
        },
        order: { createdAt: 'DESC' }
      });

      if (!mostRecentTestRun) {
        return false;
      }

      for (const cg of controlGroups) {
        if (cg.control_group_id === mostRecentTestRun.testRunId) {
          if (cg.test_runs && Array.isArray(cg.test_runs) && cg.test_runs.includes(testRunId)) {
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      this.logger.error(`Failed to check if test run is in control group: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * OPTIMIZED: Paginated query with single database round-trip
   *
   * @param userId - The user ID for authorization checks
   * @param roles - The user's roles for authorization checks
   * @param paginationDto - Pagination options
   *
   * Note: TestRun entity does not have organization_id yet, so all data is accessible.
   * Authorization filtering will be enabled when Phase 4 adds organization_id column.
   */
  async findAllPaginated(userId: string, roles: string[], paginationDto?: PaginationQueryDto, organizationId?: string): Promise<PaginatedResponseDto<TestRun>> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.debug(`findAllPaginated: userId=${userId}, isGlobalAdmin=${isAdmin}, organizationId=${organizationId}`);

      const { page = 1, pageSize = 50, sortBy = 'createdAt', sortOrder = 'DESC', system, environment, workload } = paginationDto || {};
      const skip = (page - 1) * pageSize;

      const allowedSortFields = ['createdAt', 'testRunId', 'workload', 'testEnvironment', 'startTime', 'endTime'];
      const safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';

      const queryBuilder = this.testRunRepo
        .createQueryBuilder('tr')
        .leftJoinAndSelect('tr.systemUnderTest', 'sut')
        .where("(tr.deletionStatus IS NULL OR tr.deletionStatus = 'failed')")
        .orderBy(`tr.${safeSortBy}`, sortOrder)
        .skip(skip)
        .take(pageSize);

      // Apply server-side filters
      if (system) {
        queryBuilder.andWhere('sut.name = :system', { system });
      }
      if (environment) {
        queryBuilder.andWhere('tr.testEnvironment = :environment', { environment });
      }
      if (workload) {
        queryBuilder.andWhere('tr.workload = :workload', { workload });
      }

      // Apply organization-based filtering via systems_under_test
      if (organizationId) {
        // Explicit org selected — scope to that org
        queryBuilder.andWhere('sut.organization_id = :organizationId', { organizationId });
        // Apply team restriction for non-admin users
        if (!isAdmin) {
          await this.applyTeamRestriction(queryBuilder, 'sut', userId);
        }
      } else if (!isAdmin) {
        // Non-admin users can only see test runs from systems in their organizations
        const orgIds = await this.authzService.getAccessibleOrganizations(userId);

        if (orgIds.length === 0) {
          // User has no organization memberships - return empty result
          return new PaginatedResponseDto([], 0, page, pageSize);
        }

        // Get user's team memberships for team-restriction filtering
        const userTeamIds = await this.authzService.getAccessibleTeams(userId);

        // Join teams table for restriction check
        queryBuilder.leftJoin('teams', 'team', 'team.id = sut.team_id');

        // Filter: org access + team restriction
        queryBuilder.andWhere(
          '(' +
            'sut.organization_id IS NULL' +                                             // legacy data
            ' OR (sut.team_id IS NULL AND sut.organization_id IN (:...orgIds))' +       // no team, org access
            ' OR (team.restrict_to_team_members = false AND sut.organization_id IN (:...orgIds))' +  // unrestricted team
            (userTeamIds.length > 0
              ? ' OR (sut.team_id IN (:...userTeamIds))'                                // direct team member
              : '') +
          ')',
          { orgIds, ...(userTeamIds.length > 0 ? { userTeamIds } : {}) },
        );
      }
      // Admin without organizationId: no filter (backward compat)

      const [testRunEntities, total] = await queryBuilder.getManyAndCount();

      const testRunIds = testRunEntities.map(tr => tr.testRunId);
      const systemEnvWorkloadKeys = [...new Set(
        testRunEntities.map(tr => `${tr.systemUnderTestId}|${tr.testEnvironment}|${tr.workload}`)
      )];

      // Get changepoints for these specific test runs
      const changepoints = testRunIds.length > 0
        ? await this.changePointsRepo
            .createQueryBuilder('cp')
            .select(['cp.system_under_test_id', 'cp.test_environment', 'cp.workload', 'cp.test_run_id'])
            .where('cp.test_run_id IN (:...testRunIds)', { testRunIds })
            .getMany()
        : [];

      const changepointSet = new Set(
        changepoints.map(cp => `${cp.system_under_test_id}|${cp.test_environment}|${cp.workload}|${cp.test_run_id}`)
      );

      // Get control groups
      let controlGroups: DsControlGroups[] = [];
      if (testRunIds.length > 0) {
        const whereClause = systemEnvWorkloadKeys.length > 0
          ? systemEnvWorkloadKeys.map((_, index) =>
              `(cg.system_under_test_id || '|' || cg.test_environment || '|' || cg.workload) = :key${index}`
            ).join(' OR ')
          : '1=0';
        const whereParams = Object.fromEntries(
          systemEnvWorkloadKeys.map((key, index) => [`key${index}`, key])
        );
        controlGroups = await this.controlGroupsRepo
          .createQueryBuilder('cg')
          .select(['cg.control_group_id', 'cg.system_under_test_id', 'cg.test_environment', 'cg.workload', 'cg.test_runs'])
          .where(whereClause, whereParams)
          .getMany();
      }

      // Find most recent completed test runs
      const mostRecentTestRuns = new Map<string, string>();
      for (const testRun of testRunEntities) {
        if (!testRun.completed) continue;
        const key = `${testRun.systemUnderTestId}|${testRun.testEnvironment}|${testRun.workload}`;
        if (!mostRecentTestRuns.has(key)) {
          mostRecentTestRuns.set(key, testRun.testRunId);
        }
      }

      // Create control group lookup set
      const controlGroupTestRuns = new Set<string>();
      for (const cg of controlGroups) {
        const key = `${cg.system_under_test_id}|${cg.test_environment}|${cg.workload}`;
        const mostRecentTestRun = mostRecentTestRuns.get(key);

        if (mostRecentTestRun && cg.control_group_id === mostRecentTestRun) {
          if (cg.test_runs && Array.isArray(cg.test_runs)) {
            for (const testRunId of cg.test_runs) {
              controlGroupTestRuns.add(`${cg.system_under_test_id}|${cg.test_environment}|${cg.workload}|${testRunId}`);
            }
          }
        }
      }

      // Map entities with flags
      const testRuns = testRunEntities.map((entity) => {
        const changepointKey = `${entity.systemUnderTestId}|${entity.testEnvironment}|${entity.workload}|${entity.testRunId}`;
        const isChangepoint = changepointSet.has(changepointKey);

        return {
          ...this.mapper.mapEntityToTestRun(entity),
          is_changepoint: isChangepoint,
          is_control_group: controlGroupTestRuns.has(
            `${entity.systemUnderTestId}|${entity.testEnvironment}|${entity.workload}|${entity.testRunId}`
          )
        };
      });

      this.logger.log(`Retrieved page ${page}/${Math.ceil(total / pageSize)} (${testRuns.length} of ${total} test runs)`);

      return new PaginatedResponseDto(testRuns, total, page, pageSize);
    } catch (error) {
      this.logger.error('Error fetching paginated test runs:', error);
      throw new DatabaseException('Failed to fetch test runs', error);
    }
  }

  /**
   * Get distinct filter options (system names, environments, workloads) for the test runs
   * the user has access to. Used by the frontend to populate filter dropdowns.
   */
  async getFilterOptions(userId: string, roles: string[], organizationId?: string): Promise<{ systems: string[]; environments: string[]; workloads: string[] }> {
    try {
      const isAdmin = this.authzService.isGlobalAdmin(roles);

      // Pre-fetch team/org access data for non-admin users
      let orgIds: string[] = [];
      let userTeamIds: string[] = [];
      if (!isAdmin) {
        if (!organizationId) {
          orgIds = await this.authzService.getAccessibleOrganizations(userId);
          if (orgIds.length === 0) {
            return { systems: [], environments: [], workloads: [] };
          }
        }
        userTeamIds = await this.authzService.getAccessibleTeams(userId);
      }

      const buildBaseQuery = () => {
        const qb = this.testRunRepo
          .createQueryBuilder('tr')
          .leftJoin('tr.systemUnderTest', 'sut')
          .where("(tr.deletionStatus IS NULL OR tr.deletionStatus = 'failed')");

        if (organizationId) {
          qb.andWhere('sut.organization_id = :organizationId', { organizationId });
        }
        return qb;
      };

      const applyAccessFilter = (qb: SelectQueryBuilder<any>) => {
        if (organizationId && !isAdmin) {
          // Apply team restriction for non-admin users within an org
          qb.leftJoin('teams', 'team', 'team.id = sut.team_id');
          qb.andWhere(
            '(' +
              'sut.team_id IS NULL' +
              ' OR team.restrict_to_team_members = false' +
              (userTeamIds.length > 0
                ? ' OR sut.team_id IN (:...userTeamIds)'
                : '') +
            ')',
            userTeamIds.length > 0 ? { userTeamIds } : {},
          );
        } else if (!organizationId && !isAdmin && orgIds.length > 0) {
          qb.leftJoin('teams', 'team', 'team.id = sut.team_id');
          qb.andWhere(
            '(' +
              'sut.organization_id IS NULL' +
              ' OR (sut.team_id IS NULL AND sut.organization_id IN (:...orgIds))' +
              ' OR (team.restrict_to_team_members = false AND sut.organization_id IN (:...orgIds))' +
              (userTeamIds.length > 0
                ? ' OR (sut.team_id IN (:...userTeamIds))'
                : '') +
            ')',
            { orgIds, ...(userTeamIds.length > 0 ? { userTeamIds } : {}) },
          );
        }
      };

      const systemsQb = buildBaseQuery().select('DISTINCT sut.name', 'name').andWhere('sut.name IS NOT NULL');
      applyAccessFilter(systemsQb);

      const envsQb = buildBaseQuery().select('DISTINCT tr.testEnvironment', 'env').andWhere('tr.testEnvironment IS NOT NULL');
      applyAccessFilter(envsQb);

      const workloadsQb = buildBaseQuery().select('DISTINCT tr.workload', 'workload').andWhere('tr.workload IS NOT NULL');
      applyAccessFilter(workloadsQb);

      const [systemRows, envRows, workloadRows] = await Promise.all([
        systemsQb.orderBy('sut.name', 'ASC').getRawMany(),
        envsQb.orderBy('tr.testEnvironment', 'ASC').getRawMany(),
        workloadsQb.orderBy('tr.workload', 'ASC').getRawMany(),
      ]);

      return {
        systems: systemRows.map(r => r.name),
        environments: envRows.map(r => r.env),
        workloads: workloadRows.map(r => r.workload),
      };
    } catch (error) {
      this.logger.error('Error fetching filter options:', error);
      throw new DatabaseException('Failed to fetch filter options', error);
    }
  }

  /**
   * DEPRECATED: Use findAllPaginated() instead
   *
   * @param userId - The user ID for authorization checks
   * @param roles - The user's roles for authorization checks
   */
  async findAll(userId: string, roles: string[]): Promise<TestRun[]> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.debug(`findAll: userId=${userId}, isGlobalAdmin=${isAdmin}`);

      const queryBuilder = this.testRunRepo
        .createQueryBuilder('tr')
        .leftJoinAndSelect('tr.systemUnderTest', 'sut')
        .where("(tr.deletionStatus IS NULL OR tr.deletionStatus = 'failed')")
        .orderBy('tr.createdAt', 'DESC');

      // Apply organization-based filtering via systems_under_test
      if (!isAdmin) {
        const orgIds = await this.authzService.getAccessibleOrganizations(userId);

        if (orgIds.length === 0) {
          return [];
        }

        // Filter by organization_id through the systems_under_test relationship
        queryBuilder.andWhere('sut.organization_id IN (:...orgIds)', { orgIds });
      }

      const testRunEntities = await queryBuilder.getMany();

      const changepoints = await this.changePointsRepo
        .createQueryBuilder('cp')
        .select(['cp.system_under_test_id', 'cp.test_environment', 'cp.workload', 'cp.test_run_id'])
        .getMany();

      const changepointSet = new Set(
        changepoints.map(cp => `${cp.system_under_test_id}|${cp.test_environment}|${cp.workload}|${cp.test_run_id}`)
      );

      const controlGroups = await this.controlGroupsRepo
        .createQueryBuilder('cg')
        .select(['cg.control_group_id', 'cg.system_under_test_id', 'cg.test_environment', 'cg.workload', 'cg.test_runs'])
        .getMany();

      const mostRecentTestRuns = new Map<string, string>();
      for (const testRun of testRunEntities) {
        if (!testRun.completed) continue;
        const key = `${testRun.systemUnderTestId}|${testRun.testEnvironment}|${testRun.workload}`;
        if (!mostRecentTestRuns.has(key)) {
          mostRecentTestRuns.set(key, testRun.testRunId);
        }
      }

      const controlGroupTestRuns = new Set<string>();
      for (const cg of controlGroups) {
        const key = `${cg.system_under_test_id}|${cg.test_environment}|${cg.workload}`;
        const mostRecentTestRun = mostRecentTestRuns.get(key);

        if (mostRecentTestRun && cg.control_group_id === mostRecentTestRun) {
          if (cg.test_runs && Array.isArray(cg.test_runs)) {
            for (const testRunId of cg.test_runs) {
              controlGroupTestRuns.add(`${cg.system_under_test_id}|${cg.test_environment}|${cg.workload}|${testRunId}`);
            }
          }
        }
      }

      return testRunEntities.map(entity => ({
        ...this.mapper.mapEntityToTestRun(entity),
        is_changepoint: changepointSet.has(`${entity.systemUnderTestId}|${entity.testEnvironment}|${entity.workload}|${entity.testRunId}`),
        is_control_group: controlGroupTestRuns.has(`${entity.systemUnderTestId}|${entity.testEnvironment}|${entity.workload}|${entity.testRunId}`)
      }));
    } catch (error) {
      this.logger.error('Error fetching test runs:', error);
      throw new DatabaseException('Failed to fetch test runs', error);
    }
  }

  /**
   * Find a test run by its testRunId.
   *
   * @param testRunId - The test run identifier
   * @param userId - The user ID for authorization checks
   * @param roles - The user's roles for authorization checks
   */
  async findByTestRunId(testRunId: string, userId: string, roles: string[]): Promise<TestRun> {
    try {
      // Log authorization context for debugging
      this.logger.debug(`findByTestRunId: testRunId=${testRunId}, userId=${userId}, isGlobalAdmin=${this.authzService.isGlobalAdmin(roles)}`);

      const testRunEntity = await this.testRunRepo.findOne({
        where: { testRunId },
        relations: ['systemUnderTest', 'systemUnderTest.pyroscopeInstance']
      });

      if (!testRunEntity) {
        throw new ResourceNotFoundException('TestRun', testRunId);
      }

      // Check organization-based access via systems_under_test
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      if (!isAdmin && testRunEntity.systemUnderTest) {
        const systemOrgId = testRunEntity.systemUnderTest.organization_id;

        // Systems without organization_id only accessible to global admins
        if (!systemOrgId) {
          throw new ResourceNotFoundException('TestRun', testRunId);
        }

        // Check if user is a member of the system's organization
        const isMember = await this.authzService.isOrganizationMember(userId, systemOrgId);
        if (!isMember) {
          throw new ResourceNotFoundException('TestRun', testRunId);
        }

        // Check team-level restriction
        const sut = testRunEntity.systemUnderTest;
        if (sut.team_id) {
          const teamAccess = await this.authzService.canViewTeamResources(userId, sut.team_id);
          if (!teamAccess.allowed) {
            throw new ResourceNotFoundException('TestRun', testRunId);
          }
        }
      }

      const testRun = this.mapper.mapEntityToTestRun(testRunEntity);

      if (testRun.system_under_test_id && testRun.test_environment && testRun.workload) {
        testRun.is_changepoint = await this.isTestRunChangepoint(
          testRun.system_under_test_id,
          testRun.test_environment,
          testRun.workload,
          testRunId
        );
      }

      return testRun;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error('Failed to find test run:', error);
      throw new DatabaseException('Failed to retrieve test run', error);
    }
  }

  /**
   * Find a test run by its UUID.
   *
   * @param id - The test run UUID
   * @param userId - The user ID for authorization checks
   * @param roles - The user's roles for authorization checks
   */
  async findOne(id: string, userId: string, roles: string[]): Promise<TestRun> {
    try {
      this.logger.debug(`findOne: id=${id}, userId=${userId}, isGlobalAdmin=${this.authzService.isGlobalAdmin(roles)}`);

      const testRunEntity = await this.testRunRepo.findOne({
        where: { id },
        relations: ['systemUnderTest', 'systemUnderTest.pyroscopeInstance']
      });

      if (!testRunEntity) {
        throw new ResourceNotFoundException('TestRun', id);
      }

      // Check organization-based access via systems_under_test
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      if (!isAdmin && testRunEntity.systemUnderTest) {
        const systemOrgId = testRunEntity.systemUnderTest.organization_id;

        // Systems without organization_id only accessible to global admins
        if (!systemOrgId) {
          throw new ResourceNotFoundException('TestRun', id);
        }

        // Check if user is a member of the system's organization
        const isMember = await this.authzService.isOrganizationMember(userId, systemOrgId);
        if (!isMember) {
          throw new ResourceNotFoundException('TestRun', id);
        }

        // Check team-level restriction
        const sut = testRunEntity.systemUnderTest;
        if (sut.team_id) {
          const teamAccess = await this.authzService.canViewTeamResources(userId, sut.team_id);
          if (!teamAccess.allowed) {
            throw new ResourceNotFoundException('TestRun', id);
          }
        }
      }

      const testRun = this.mapper.mapEntityToTestRun(testRunEntity);

      if (testRun.system_under_test_id && testRun.test_environment && testRun.workload) {
        testRun.is_changepoint = await this.isTestRunChangepoint(
          testRun.system_under_test_id,
          testRun.test_environment,
          testRun.workload,
          testRun.test_run_id
        );
      }

      return testRun;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error('Failed to find test run:', error);
      throw new DatabaseException('Failed to retrieve test run', error);
    }
  }

  /**
   * Get a test run by its testRunId, returning null if not found.
   *
   * @param testRunId - The test run identifier
   * @param userId - The user ID for authorization checks
   * @param roles - The user's roles for authorization checks
   */
  async getTestRunByTestRunId(testRunId: string, userId: string, roles: string[]): Promise<TestRun | null> {
    try {
      this.logger.debug(`getTestRunByTestRunId: testRunId=${testRunId}, userId=${userId}`);

      const testRunEntity = await this.testRunRepo.findOne({
        where: { testRunId },
        relations: ['systemUnderTest', 'systemUnderTest.pyroscopeInstance']
      });

      if (!testRunEntity) {
        return null;
      }

      // Check organization-based access via systems_under_test
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      if (!isAdmin && testRunEntity.systemUnderTest) {
        const systemOrgId = testRunEntity.systemUnderTest.organization_id;

        // Systems without organization_id only accessible to global admins
        if (!systemOrgId) {
          return null;
        }

        // Check if user is a member of the system's organization
        const isMember = await this.authzService.isOrganizationMember(userId, systemOrgId);
        if (!isMember) {
          return null;
        }

        // Check team-level restriction
        const sut = testRunEntity.systemUnderTest;
        if (sut.team_id) {
          const teamAccess = await this.authzService.canViewTeamResources(userId, sut.team_id);
          if (!teamAccess.allowed) {
            return null;
          }
        }
      }

      const testRun = this.mapper.mapEntityToTestRun(testRunEntity);
      testRun.system_name = testRun.systems_under_test?.name;

      if (testRun.system_under_test_id && testRun.test_environment && testRun.workload) {
        testRun.is_changepoint = await this.isTestRunChangepoint(
          testRun.system_under_test_id,
          testRun.test_environment,
          testRun.workload,
          testRunId
        );
      }

      return testRun;
    } catch (error) {
      this.logger.error(`Failed to get test run by test_run_id ${testRunId}:`, error);
      return null;
    }
  }

  /**
   * Find a test run by its testRunId and additional parameters.
   * Uses a single query joining on system name to avoid ambiguity when
   * multiple organizations have systems with the same name.
   *
   * @param testRunId - The test run identifier
   * @param systemName - The system under test name
   * @param environment - The test environment
   * @param workload - The workload name
   * @param userId - The user ID for authorization checks
   * @param roles - The user's roles for authorization checks
   * @param organizationId - Optional organization ID to scope the lookup
   */
  async findByTestRunIdAndParams(
    testRunId: string,
    systemName: string,
    environment: string,
    workload: string,
    userId: string,
    roles: string[],
    organizationId?: string,
  ): Promise<TestRun> {
    try {
      this.logger.debug(`findByTestRunIdAndParams: testRunId=${testRunId}, userId=${userId}, organizationId=${organizationId}`);

      const isAdmin = this.authzService.isGlobalAdmin(roles);

      // Single query: join test_run with system_under_test by name
      const queryBuilder = this.testRunRepo
        .createQueryBuilder('tr')
        .leftJoinAndSelect('tr.systemUnderTest', 'sut')
        .leftJoinAndSelect('sut.pyroscopeInstance', 'pyro')
        .where('tr.testRunId = :testRunId', { testRunId })
        .andWhere('sut.name = :systemName', { systemName })
        .andWhere('tr.testEnvironment = :environment', { environment })
        .andWhere('tr.workload = :workload', { workload });

      // Apply organization scoping
      if (organizationId) {
        // Explicit org selected (admin or non-admin with org context)
        queryBuilder.andWhere('sut.organization_id = :organizationId', { organizationId });
      } else if (!isAdmin) {
        // Non-admin without explicit org: filter by accessible orgs
        const orgIds = await this.authzService.getAccessibleOrganizations(userId);
        if (orgIds.length === 0) {
          throw new ResourceNotFoundException('System under test', systemName);
        }
        queryBuilder.andWhere(
          '(sut.organization_id IN (:...orgIds) OR sut.organization_id IS NULL)',
          { orgIds }
        );
      }
      // Admin without organizationId: no org filter (backward compat for API key access)

      // Apply team restriction for non-admin users
      if (!isAdmin) {
        await this.applyTeamRestriction(queryBuilder, 'sut', userId);
      }

      const testRunEntity = await queryBuilder.getOne();

      if (!testRunEntity) {
        throw new ResourceNotFoundException(
          'Test run',
          `${testRunId} for system '${systemName}', environment '${environment}', workload '${workload}'`
        );
      }

      const testRun = this.mapper.mapEntityToTestRun(testRunEntity);

      testRun.is_changepoint = await this.isTestRunChangepoint(
        testRunEntity.systemUnderTestId,
        environment,
        workload,
        testRunId
      );

      return testRun;
    } catch (error) {
      this.logger.error('Failed to find test run by params:', error);
      throw error;
    }
  }

  /**
   * Get related test runs for a given test run.
   *
   * @param testRunId - The test run identifier
   * @param userId - The user ID for authorization checks
   * @param roles - The user's roles for authorization checks
   * @param system - Optional system name filter
   * @param environment - Optional environment filter
   * @param workload - Optional workload filter
   */
  async getRelatedTestRuns(
    testRunId: string,
    userId: string,
    roles: string[],
    system?: string,
    environment?: string,
    workload?: string
  ): Promise<RelatedTestRun[]> {
    try {
      this.logger.debug(`getRelatedTestRuns: testRunId=${testRunId}, userId=${userId}`);

      let currentTestRun: TestRun | undefined;
      if (system && environment && workload) {
        currentTestRun = await this.findByTestRunIdAndParams(testRunId, system, environment, workload, userId, roles);
      } else {
        const testRunEntity = await this.testRunRepo.findOne({
          where: { testRunId },
          relations: ['systemUnderTest', 'systemUnderTest.pyroscopeInstance']
        });

        if (testRunEntity) {
          currentTestRun = this.mapper.mapEntityToTestRun(testRunEntity);
        }
      }

      if (!currentTestRun) {
        throw new ResourceNotFoundException('Test run', testRunId);
      }

      // NOTE: Organization filtering will be added here when TestRun entity has organization_id

      const relatedTestRunEntities = await this.testRunRepo
        .createQueryBuilder('tr')
        .select([
          'tr.testRunId',
          'tr.createdAt',
          'tr.startTime',
          'tr.endTime',
          'tr.applicationRelease',
          'tr.annotations',
          'tr.completed'
        ])
        .where('tr.systemUnderTestId = :systemId', { systemId: currentTestRun.system_under_test_id })
        .andWhere('tr.testEnvironment = :environment', { environment: currentTestRun.test_environment })
        .andWhere('tr.workload = :workload', { workload: currentTestRun.workload })
        .andWhere('tr.testRunId != :testRunId', { testRunId })
        .orderBy('tr.createdAt', 'DESC')
        .limit(50)
        .getMany();

      const relatedTestRuns = relatedTestRunEntities.map(entity => ({
        test_run_id: entity.testRunId,
        created_at: entity.createdAt.toISOString(),
        start_time: entity.startTime?.toISOString(),
        end_time: entity.endTime?.toISOString(),
        application_release: entity.applicationRelease,
        annotations: entity.annotations,
        completed: entity.completed || false
      }));

      this.logger.log(`Found ${relatedTestRuns.length} related test runs for ${testRunId}`);
      return relatedTestRuns;

    } catch (error) {
      this.logger.error(`Failed to get related test runs for ${testRunId}:`, error);
      throw error;
    }
  }

  /**
   * Get a summary of all systems with their environments and workloads.
   *
   * @param userId - The user ID for authorization checks
   * @param roles - The user's roles for authorization checks
   */
  async getSystemsSummary(userId: string, roles: string[], organizationId?: string): Promise<SystemsSummary[]> {
    try {
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.log(`[getSystemsSummary] START - userId=${userId}, isGlobalAdmin=${isAdmin}, organizationId=${organizationId}`);

      let systems: SystemUnderTest[];
      if (organizationId) {
        // Explicit org selected — scope to that org
        const qb = this.systemRepo
          .createQueryBuilder('system')
          .where('system.organization_id = :organizationId', { organizationId })
          .orderBy('system.name', 'ASC');
        // Apply team restriction for non-admin users
        if (!isAdmin) {
          await this.applyTeamRestriction(qb, 'system', userId);
        }
        systems = await qb.getMany();
        this.logger.log(`[getSystemsSummary] ORG-SCOPED PATH - Returning ${systems.length} systems for org ${organizationId}`);
      } else if (isAdmin) {
        // Global admins see all systems
        systems = await this.systemRepo.find({
          order: { name: 'ASC' }
        });
        this.logger.log(`[getSystemsSummary] ADMIN PATH - Returning ${systems.length} systems (all systems)`);
      } else {
        // Get user's accessible organizations
        const orgIds = await this.authzService.getAccessibleOrganizations(userId);
        this.logger.log(`[getSystemsSummary] NON-ADMIN PATH - User ${userId} has access to organizations: ${orgIds.join(', ')}`);

        // If user has no organizations, return empty array
        if (orgIds.length === 0) {
          this.logger.log(`[getSystemsSummary] User has no organizations - returning empty array`);
          return [];
        }

        // Get user's team memberships for team-restriction filtering
        const userTeamIds = await this.authzService.getAccessibleTeams(userId);

        // Filter systems by organization + team restriction
        const qb = this.systemRepo
          .createQueryBuilder('system')
          .leftJoin('teams', 'team', 'team.id = system.team_id')
          .where(
            '(' +
              '(system.team_id IS NULL AND system.organization_id IN (:...orgIds))' +
              ' OR (system.team_id IS NOT NULL AND team.restrict_to_team_members = false AND system.organization_id IN (:...orgIds))' +
              (userTeamIds.length > 0
                ? ' OR (system.team_id IN (:...userTeamIds))'
                : '') +
            ')',
            { orgIds, ...(userTeamIds.length > 0 ? { userTeamIds } : {}) },
          )
          .orderBy('system.name', 'ASC');

        systems = await qb.getMany();

        this.logger.log(`[getSystemsSummary] FILTERED RESULT - Returning ${systems.length} systems from organizations: ${orgIds.join(', ')}`);
        systems.forEach(s => {
          this.logger.log(`  - System: ${s.name} (id: ${s.id}, org: ${s.organization_id})`);
        });
      }

      // Only get environment/workload data for accessible systems
      const systemIds = systems.map(s => s.id);
      let envWorkloadData: any[];

      if (systemIds.length === 0) {
        envWorkloadData = [];
      } else {
        envWorkloadData = await this.testRunRepo
          .createQueryBuilder('tr')
          .select([
            'tr.systemUnderTestId',
            'tr.testEnvironment',
            'tr.workload'
          ])
          .where('tr.systemUnderTestId IN (:...systemIds)', { systemIds })
          .distinct(true)
          .getMany();
      }

      const envWorkloadMap = new Map<string, Map<string, Set<string>>>();

      for (const item of envWorkloadData) {
        if (!envWorkloadMap.has(item.systemUnderTestId)) {
          envWorkloadMap.set(item.systemUnderTestId, new Map());
        }

        const envMap = envWorkloadMap.get(item.systemUnderTestId)!;
        if (!envMap.has(item.testEnvironment)) {
          envMap.set(item.testEnvironment, new Set());
        }

        envMap.get(item.testEnvironment)!.add(item.workload);
      }

      const systemsSummary = systems.map(system => {
        const envMap = envWorkloadMap.get(system.id) || new Map<string, Set<string>>();
        const environments = Array.from(envMap.entries()).map(([environment, workloadsSet]) => ({
          environment,
          workloads: Array.from(workloadsSet).sort((a, b) => a.localeCompare(b))
        }));

        return {
          id: system.id,
          name: system.name,
          environments,
          created_at: system.created_at.toISOString()
        };
      });

      this.logger.log(`Retrieved summary for ${systemsSummary.length} systems with ${envWorkloadData.length} unique environment/workload combinations`);
      return systemsSummary;
    } catch (error) {
      this.logger.error('Failed to get systems summary:', error);
      throw new DatabaseException('Failed to retrieve systems summary', error);
    }
  }

  /**
   * Get all unique tags from test runs.
   *
   * @param userId - The user ID for authorization checks
   * @param roles - The user's roles for authorization checks
   */
  async getAllTags(userId: string, roles: string[]): Promise<string[]> {
    try {
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.log(`[getAllTags] START - userId=${userId}, isGlobalAdmin=${isAdmin}`);

      const queryBuilder = this.testRunRepo
        .createQueryBuilder('tr')
        .select('DISTINCT unnest(tr.tags)', 'tag')
        .where('tr.tags IS NOT NULL')
        .andWhere('array_length(tr.tags, 1) > 0');

      // Apply organization filtering for non-admin users
      if (!isAdmin) {
        const orgIds = await this.authzService.getAccessibleOrganizations(userId);
        this.logger.log(`[getAllTags] NON-ADMIN PATH - User ${userId} has access to organizations: ${orgIds.join(', ')}`);

        if (orgIds.length === 0) {
          this.logger.log(`[getAllTags] User has no organizations - returning empty array`);
          return [];
        }

        // Filter via systems_under_test JOIN since test_runs doesn't have organization_id
        queryBuilder
          .leftJoin('systems_under_test', 'sut', 'sut.id = tr.systemUnderTestId')
          .andWhere('sut.organization_id IN (:...orgIds)', { orgIds });
      }

      const result = await queryBuilder.getRawMany();

      const tags = result.map(row => row.tag).filter(Boolean).sort((a, b) => a.localeCompare(b));
      this.logger.log(`[getAllTags] Retrieved ${tags.length} unique tags`);
      return tags;
    } catch (error) {
      this.logger.error('Failed to get all tags:', error);
      throw error;
    }
  }

  /**
   * Get all unique annotations from test runs.
   *
   * @param userId - The user ID for authorization checks
   * @param roles - The user's roles for authorization checks
   */
  async getAllAnnotations(userId: string, roles: string[]): Promise<string[]> {
    try {
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.log(`[getAllAnnotations] START - userId=${userId}, isGlobalAdmin=${isAdmin}`);

      const queryBuilder = this.testRunRepo
        .createQueryBuilder('tr')
        .select('DISTINCT unnest(tr.annotations)', 'annotation')
        .where('tr.annotations IS NOT NULL')
        .andWhere('array_length(tr.annotations, 1) > 0');

      // Apply organization filtering for non-admin users
      if (!isAdmin) {
        const orgIds = await this.authzService.getAccessibleOrganizations(userId);
        this.logger.log(`[getAllAnnotations] NON-ADMIN PATH - User ${userId} has access to organizations: ${orgIds.join(', ')}`);

        if (orgIds.length === 0) {
          this.logger.log(`[getAllAnnotations] User has no organizations - returning empty array`);
          return [];
        }

        // Filter via systems_under_test JOIN since test_runs doesn't have organization_id
        queryBuilder
          .leftJoin('systems_under_test', 'sut', 'sut.id = tr.systemUnderTestId')
          .andWhere('sut.organization_id IN (:...orgIds)', { orgIds });
      }

      const result = await queryBuilder.getRawMany();

      const annotations = result.map(row => row.annotation).filter(Boolean).sort((a, b) => a.localeCompare(b));
      this.logger.log(`[getAllAnnotations] Retrieved ${annotations.length} unique annotations`);
      return annotations;
    } catch (error) {
      this.logger.error('Failed to get all annotations:', error);
      throw error;
    }
  }

  /**
   * Get baseline candidates for comparison.
   *
   * @param systemUnderTestId - The system under test ID
   * @param testEnvironment - The test environment
   * @param workload - The workload name
   * @param userId - The user ID for authorization checks
   * @param roles - The user's roles for authorization checks
   * @param excludeTestRunId - Optional test run ID to exclude
   * @param limit - Maximum number of results
   */
  async getBaselineCandidates(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    userId: string,
    _roles: string[],
    excludeTestRunId?: string,
    limit: number = 50
  ): Promise<TestRun[]> {
    try {
      this.logger.debug(`getBaselineCandidates: systemUnderTestId=${systemUnderTestId}, userId=${userId}`);

      // NOTE: Organization filtering will be added here when TestRun entity has organization_id

      const queryBuilder = this.testRunRepo
        .createQueryBuilder('tr')
        .leftJoinAndSelect('tr.systemUnderTest', 'sut')
        .where('tr.systemUnderTestId = :systemUnderTestId', { systemUnderTestId })
        .andWhere('tr.testEnvironment = :testEnvironment', { testEnvironment })
        .andWhere('tr.workload = :workload', { workload })
        .andWhere('tr.completed = :completed', { completed: true });

      if (excludeTestRunId) {
        queryBuilder.andWhere('tr.testRunId != :excludeTestRunId', { excludeTestRunId });
      }

      const testRunEntities = await queryBuilder
        .orderBy('tr.createdAt', 'DESC')
        .limit(limit)
        .getMany();

      return testRunEntities.map(entity => this.mapper.mapEntityToTestRun(entity));
    } catch (error) {
      this.logger.error('Failed to get baseline candidates:', error);
      throw new DatabaseException('Failed to retrieve baseline candidates', error);
    }
  }

  /**
   * Get request names for a test run.
   *
   * @param testRunId - The test run identifier
   * @param userId - The user ID for authorization checks
   * @param roles - The user's roles for authorization checks
   * @param panelDescription - Optional panel description filter
   */
  async getRequestNames(testRunId: string, userId: string, roles: string[], panelDescription?: string): Promise<string[]> {
    try {
      this.logger.debug(`getRequestNames: testRunId=${testRunId}, userId=${userId}`);

      const testRun = await this.findByTestRunId(testRunId, userId, roles);

      if (panelDescription) {
        const query = `
          SELECT DISTINCT jsonb_object_keys(m.data) as metric_name
          FROM ds_panels p
          JOIN ds_metrics m ON m.panel_id = p.id
          WHERE p.test_run_id = $1
            AND p.panel_description ILIKE $2
          ORDER BY metric_name
        `;

        const result = await this.testRunRepo.query(query, [
          testRun.id,
          `%${panelDescription}%`,
        ]);

        return result.map((row: { metric_name: string }) => row.metric_name);
      } else {
        const query = `
          SELECT DISTINCT CONCAT_WS('|', scenario_name, transaction_name, sampler_name) as request_name
          FROM requests_raw
          WHERE test_run_id = $1
            AND sampler_name IS NOT NULL
          ORDER BY request_name
        `;

        const result = await this.testRunRepo.query(query, [testRun.test_run_id]);

        return result.map((row: { request_name: string }) => row.request_name);
      }
    } catch (error) {
      this.logger.error('Failed to get request names:', error);
      throw new DatabaseException('Failed to retrieve request names', error);
    }
  }
}
