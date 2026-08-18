import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder, ObjectLiteral } from 'typeorm';
import { withRequestEm } from '../../../common/db/request-em';
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
 * - List-filter methods accept pre-resolved `isAdmin`, `organizationIds`, and
 *   `userTeamIds` from the parent facade (TestRunsQueryService) so they don't
 *   call `authzService.isGlobalAdmin` / `getAccessibleOrganizations` /
 *   `getAccessibleTeams` themselves. The parent uses `withOrgFilter` /
 *   `withTeamFilter` to compute these once.
 * - Per-resource methods (`findByTestRunId`, `findOne`, `getTestRunByTestRunId`)
 *   delegate to the private `denialReason()` helper, which calls
 *   `isOrganizationMember` / `canViewTeamResources` — those are individual-resource
 *   lookups, not list filters, so they cannot use the list-filter helpers above.
 * - TestRun entity does not have organization_id; access is checked via the
 *   joined SystemUnderTest's `organization_id` / `team_id`.
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
   * Apply team-level access restriction to a query builder using a pre-resolved
   * `userTeamIds` array (computed by the parent via `withTeamFilter`).
   * Ensures non-admin users can only see resources from teams they belong to
   * when the team has restrict_to_team_members enabled.
   */
  private applyTeamRestriction(
    queryBuilder: SelectQueryBuilder<ObjectLiteral>,
    sutAlias: string,
    userTeamIds: string[],
  ): void {
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

      const mostRecentTestRun = await withRequestEm(this.testRunRepo).findOne({
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
   * @param isAdmin - Whether the caller has global admin privileges (resolved by the parent
   *   facade via `withOrgFilter`)
   * @param organizationIds - User's accessible organization IDs (resolved by the parent via
   *   `withOrgFilter`); used only when `organizationId` is not explicitly set
   * @param userTeamIds - User's accessible team IDs (resolved by the parent via `withTeamFilter`);
   *   admins receive `[]`
   * @param paginationDto - Pagination options
   * @param organizationId - Optional explicit organization scope
   */
  async findAllPaginated(
    isAdmin: boolean,
    organizationIds: string[],
    userTeamIds: string[],
    paginationDto?: PaginationQueryDto,
    organizationId?: string,
  ): Promise<PaginatedResponseDto<TestRun>> {
    try {
      this.logger.debug(`findAllPaginated: isAdmin=${isAdmin}, organizationId=${organizationId}`);

      const { page = 1, pageSize = 50, sortBy = 'createdAt', sortOrder = 'DESC', system, environment, workload } = paginationDto || {};
      const skip = (page - 1) * pageSize;

      const allowedSortFields = ['createdAt', 'testRunId', 'workload', 'testEnvironment', 'startTime', 'endTime'];
      const safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';

      const queryBuilder = withRequestEm(this.testRunRepo)
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
          this.applyTeamRestriction(queryBuilder, 'sut', userTeamIds);
        }
      } else if (!isAdmin) {
        // Non-admin users can only see test runs from systems in their organizations
        if (organizationIds.length === 0) {
          // User has no organization memberships - return empty result
          return new PaginatedResponseDto([], 0, page, pageSize);
        }

        // Join teams table for restriction check
        queryBuilder.leftJoin('teams', 'team', 'team.id = sut.team_id');

        // Filter: org access + team restriction
        queryBuilder.andWhere(
          '(' +
            '(sut.team_id IS NULL AND sut.organization_id IN (:...orgIds))' +       // no team, org access
            ' OR (team.restrict_to_team_members = false AND sut.organization_id IN (:...orgIds))' +  // unrestricted team
            (userTeamIds.length > 0
              ? ' OR (sut.team_id IN (:...userTeamIds))'                                // direct team member
              : '') +
          ')',
          { orgIds: organizationIds, ...(userTeamIds.length > 0 ? { userTeamIds } : {}) },
        );
      }
      // Admin without organizationId: no filter

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
   *
   * @param isAdmin - Whether the caller has global admin privileges (resolved by the parent)
   * @param organizationIds - User's accessible organization IDs (resolved by the parent)
   * @param userTeamIds - User's accessible team IDs (resolved by the parent); admins receive `[]`
   * @param organizationId - Optional explicit organization scope
   * @param selected - Currently selected filter values; each list is constrained by the
   *   OTHER two selections (cascading dropdowns) so only existing combinations are offered
   */
  async getFilterOptions(
    isAdmin: boolean,
    organizationIds: string[],
    userTeamIds: string[],
    organizationId?: string,
    selected?: { system?: string; environment?: string; workload?: string },
  ): Promise<{ systems: string[]; environments: string[]; workloads: string[] }> {
    try {
      // Non-admin without explicit org and no accessible orgs → nothing to show
      if (!isAdmin && !organizationId && organizationIds.length === 0) {
        return { systems: [], environments: [], workloads: [] };
      }

      const buildBaseQuery = () => {
        const qb = withRequestEm(this.testRunRepo)
          .createQueryBuilder('tr')
          .leftJoin('tr.systemUnderTest', 'sut')
          .where("(tr.deletionStatus IS NULL OR tr.deletionStatus = 'failed')");

        if (organizationId) {
          qb.andWhere('sut.organization_id = :organizationId', { organizationId });
        }
        return qb;
      };

      const applyAccessFilter = (qb: SelectQueryBuilder<ObjectLiteral>) => {
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
        } else if (!organizationId && !isAdmin && organizationIds.length > 0) {
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
            { orgIds: organizationIds, ...(userTeamIds.length > 0 ? { userTeamIds } : {}) },
          );
        }
      };

      // Constrain a list by the selected values of the OTHER dropdowns, so each
      // dropdown only offers values that exist in combination with the rest —
      // while still listing alternatives for its own current selection.
      const applySelected = (
        qb: SelectQueryBuilder<ObjectLiteral>,
        constrain: Array<'system' | 'environment' | 'workload'>,
      ) => {
        if (constrain.includes('system') && selected?.system) {
          qb.andWhere('sut.name = :selSystem', { selSystem: selected.system });
        }
        if (constrain.includes('environment') && selected?.environment) {
          qb.andWhere('tr.testEnvironment = :selEnvironment', { selEnvironment: selected.environment });
        }
        if (constrain.includes('workload') && selected?.workload) {
          qb.andWhere('tr.workload = :selWorkload', { selWorkload: selected.workload });
        }
      };

      const systemsQb = buildBaseQuery().select('DISTINCT sut.name', 'name').andWhere('sut.name IS NOT NULL');
      applyAccessFilter(systemsQb);
      applySelected(systemsQb, ['environment', 'workload']);

      const envsQb = buildBaseQuery().select('DISTINCT tr.testEnvironment', 'env').andWhere('tr.testEnvironment IS NOT NULL');
      applyAccessFilter(envsQb);
      applySelected(envsQb, ['system', 'workload']);

      const workloadsQb = buildBaseQuery().select('DISTINCT tr.workload', 'workload').andWhere('tr.workload IS NOT NULL');
      applyAccessFilter(workloadsQb);
      applySelected(workloadsQb, ['system', 'environment']);

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
   * @param isAdmin - Whether the caller has global admin privileges (resolved by the parent)
   * @param organizationIds - User's accessible organization IDs (resolved by the parent)
   */
  async findAll(isAdmin: boolean, organizationIds: string[]): Promise<TestRun[]> {
    try {
      this.logger.debug(`findAll: isAdmin=${isAdmin}`);

      const queryBuilder = withRequestEm(this.testRunRepo)
        .createQueryBuilder('tr')
        .leftJoinAndSelect('tr.systemUnderTest', 'sut')
        .where("(tr.deletionStatus IS NULL OR tr.deletionStatus = 'failed')")
        .orderBy('tr.createdAt', 'DESC');

      // Apply organization-based filtering via systems_under_test
      if (!isAdmin) {
        if (organizationIds.length === 0) {
          return [];
        }

        // Filter by organization_id through the systems_under_test relationship
        queryBuilder.andWhere('sut.organization_id IN (:...orgIds)', { orgIds: organizationIds });
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
   * Strip CR/LF from a caller-supplied id before it reaches a log line.
   *
   * testRunId is a raw path parameter and Express percent-decodes path
   * segments, so an unsanitized `%0A` would let an authenticated caller forge
   * extra lines in the denial stream — the one stream that is supposed to be
   * the trustworthy record of why access was refused.
   */
  private forLog(value: string): string {
    return value.replace(/[\r\n]/g, '');
  }

  /**
   * Resolve why a caller may not read a test run, or null if they may.
   *
   * All five denials (invisible row, invisible system, org-less system,
   * non-member, team restriction)
   * surface to the caller as an indistinguishable refusal by design — a 404 from
   * findByTestRunId/findOne, `null` from getTestRunByTestRunId — because a caller
   * must not learn a run exists. That makes the log the only place the causes are
   * distinguishable, so callers MUST log the returned reason before refusing.
   */
  private async denialReason(
    entity: TestRunEntity,
    userId: string,
    isAdmin: boolean
  ): Promise<string | null> {
    if (isAdmin) {
      return null;
    }

    // Fail closed when the relation is missing. system_under_test_id is NOT
    // NULL, so a null here never means "this run has no system" — it means the
    // LEFT JOIN produced nothing, which under RLS is a legitimate denial
    // (systems_under_test has its own can_access_resource policy and can be
    // filtered out for a run the caller *can* see, e.g. one visible via its own
    // created_by). Treating that as "allowed" would skip every org and team
    // check below.
    if (!entity.systemUnderTest) {
      return 'system under test not visible (RLS-filtered or dangling FK)';
    }

    const sut = entity.systemUnderTest;

    if (!sut.organization_id) {
      return `system under test '${this.forLog(sut.name)}' (${sut.id}) has no organization_id`;
    }

    const isMember = await this.authzService.isOrganizationMember(userId, sut.organization_id);
    if (!isMember) {
      return `user is not a member of organization ${sut.organization_id}`;
    }

    if (sut.team_id) {
      const teamAccess = await this.authzService.canViewTeamResources(userId, sut.team_id);
      if (!teamAccess.allowed) {
        return `user lacks access to team ${sut.team_id}: ${teamAccess.reason}`;
      }
    }

    return null;
  }

  /**
   * Find a test run by its testRunId.
   *
   * @param testRunId - The test run identifier
   * @param userId - The user ID (used for per-resource membership/team-access checks)
   * @param isAdmin - Whether the caller has global admin privileges (resolved by the parent)
   */
  async findByTestRunId(testRunId: string, userId: string, isAdmin: boolean): Promise<TestRun> {
    try {
      this.logger.debug(`findByTestRunId: testRunId=${testRunId}, userId=${userId}, isAdmin=${isAdmin}`);

      const testRunEntity = await withRequestEm(this.testRunRepo).findOne({
        where: { testRunId },
        relations: ['systemUnderTest', 'systemUnderTest.pyroscopeInstance']
      });

      if (!testRunEntity) {
        this.logger.debug(`Test run ${this.forLog(testRunId)} not returned for user ${this.forLog(userId)}: no visible row (RLS-filtered or nonexistent)`);
        throw new ResourceNotFoundException('TestRun', testRunId);
      }

      const denial = await this.denialReason(testRunEntity, userId, isAdmin);
      if (denial) {
        this.logger.warn(`Test run ${this.forLog(testRunId)} denied for user ${this.forLog(userId)}: ${denial}`);
        throw new ResourceNotFoundException('TestRun', testRunId);
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
   * @param userId - The user ID (used for per-resource membership/team-access checks)
   * @param isAdmin - Whether the caller has global admin privileges (resolved by the parent)
   */
  async findOne(id: string, userId: string, isAdmin: boolean): Promise<TestRun> {
    try {
      this.logger.debug(`findOne: id=${id}, userId=${userId}, isAdmin=${isAdmin}`);

      const testRunEntity = await withRequestEm(this.testRunRepo).findOne({
        where: { id },
        relations: ['systemUnderTest', 'systemUnderTest.pyroscopeInstance']
      });

      if (!testRunEntity) {
        this.logger.debug(`Test run ${this.forLog(id)} not returned for user ${this.forLog(userId)}: no visible row (RLS-filtered or nonexistent)`);
        throw new ResourceNotFoundException('TestRun', id);
      }

      const denial = await this.denialReason(testRunEntity, userId, isAdmin);
      if (denial) {
        this.logger.warn(`Test run ${this.forLog(id)} denied for user ${this.forLog(userId)}: ${denial}`);
        throw new ResourceNotFoundException('TestRun', id);
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
   * @param userId - The user ID (used for per-resource membership/team-access checks)
   * @param isAdmin - Whether the caller has global admin privileges (resolved by the parent)
   */
  async getTestRunByTestRunId(testRunId: string, userId: string, isAdmin: boolean): Promise<TestRun | null> {
    try {
      this.logger.debug(`getTestRunByTestRunId: testRunId=${testRunId}, userId=${userId}, isAdmin=${isAdmin}`);

      const testRunEntity = await withRequestEm(this.testRunRepo).findOne({
        where: { testRunId },
        relations: ['systemUnderTest', 'systemUnderTest.pyroscopeInstance']
      });

      if (!testRunEntity) {
        this.logger.debug(`Test run ${this.forLog(testRunId)} not returned for user ${this.forLog(userId)}: no visible row (RLS-filtered or nonexistent)`);
        return null;
      }

      const denial = await this.denialReason(testRunEntity, userId, isAdmin);
      if (denial) {
        this.logger.warn(`Test run ${this.forLog(testRunId)} denied for user ${this.forLog(userId)}: ${denial}`);
        return null;
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
   * @param isAdmin - Whether the caller has global admin privileges (resolved by the parent)
   * @param organizationIds - User's accessible organization IDs (resolved by the parent)
   * @param userTeamIds - User's accessible team IDs (resolved by the parent); admins receive `[]`
   * @param organizationId - Optional organization ID to scope the lookup
   */
  async findByTestRunIdAndParams(
    testRunId: string,
    systemName: string,
    environment: string,
    workload: string,
    isAdmin: boolean,
    organizationIds: string[],
    userTeamIds: string[],
    organizationId?: string,
  ): Promise<TestRun> {
    try {
      this.logger.debug(`findByTestRunIdAndParams: testRunId=${testRunId}, isAdmin=${isAdmin}, organizationId=${organizationId}`);

      // Single query: join test_run with system_under_test by name
      const queryBuilder = withRequestEm(this.testRunRepo)
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
        if (organizationIds.length === 0) {
          throw new ResourceNotFoundException('System under test', systemName);
        }
        queryBuilder.andWhere(
          '(sut.organization_id IN (:...orgIds) OR sut.organization_id IS NULL)',
          { orgIds: organizationIds }
        );
      }
      // Admin without organizationId: no org filter (backward compat for API key access)

      // Apply team restriction for non-admin users
      if (!isAdmin) {
        this.applyTeamRestriction(queryBuilder, 'sut', userTeamIds);
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
   * @param isAdmin - Whether the caller has global admin privileges (resolved by the parent)
   * @param organizationIds - User's accessible organization IDs (resolved by the parent)
   * @param userTeamIds - User's accessible team IDs (resolved by the parent); admins receive `[]`
   * @param system - Optional system name filter
   * @param environment - Optional environment filter
   * @param workload - Optional workload filter
   */
  async getRelatedTestRuns(
    testRunId: string,
    userId: string,
    isAdmin: boolean,
    organizationIds: string[],
    userTeamIds: string[],
    system?: string,
    environment?: string,
    workload?: string,
  ): Promise<RelatedTestRun[]> {
    try {
      this.logger.debug(`getRelatedTestRuns: testRunId=${testRunId}, isAdmin=${isAdmin}`);

      let currentTestRun: TestRun | undefined;
      if (system && environment && workload) {
        currentTestRun = await this.findByTestRunIdAndParams(
          testRunId,
          system,
          environment,
          workload,
          isAdmin,
          organizationIds,
          userTeamIds,
        );
      } else {
        const testRunEntity = await withRequestEm(this.testRunRepo).findOne({
          where: { testRunId },
          relations: ['systemUnderTest', 'systemUnderTest.pyroscopeInstance']
        });

        if (!testRunEntity) {
          this.logger.debug(`Test run ${this.forLog(testRunId)} not returned for user ${this.forLog(userId)}: no visible row (RLS-filtered or nonexistent)`);
          throw new ResourceNotFoundException('Test run', testRunId);
        }

        // This branch resolves the run by id alone, so it must run the same
        // per-resource guard the other lookups do. Without it, omitting the
        // system/environment/workload query parameters skipped every
        // organization and team check and returned the run's siblings.
        const denial = await this.denialReason(testRunEntity, userId, isAdmin);
        if (denial) {
          this.logger.warn(`Test run ${this.forLog(testRunId)} denied for user ${this.forLog(userId)}: ${denial}`);
          throw new ResourceNotFoundException('Test run', testRunId);
        }

        currentTestRun = this.mapper.mapEntityToTestRun(testRunEntity);
      }

      if (!currentTestRun) {
        throw new ResourceNotFoundException('Test run', testRunId);
      }

      const relatedTestRunEntities = await withRequestEm(this.testRunRepo)
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
   * @param isAdmin - Whether the caller has global admin privileges (resolved by the parent)
   * @param organizationIds - User's accessible organization IDs (resolved by the parent)
   * @param userTeamIds - User's accessible team IDs (resolved by the parent); admins receive `[]`
   * @param organizationId - Optional explicit organization scope
   */
  async getSystemsSummary(
    isAdmin: boolean,
    organizationIds: string[],
    userTeamIds: string[],
    organizationId?: string,
  ): Promise<SystemsSummary[]> {
    try {
      this.logger.log(`[getSystemsSummary] START - isAdmin=${isAdmin}, organizationId=${organizationId}`);

      let systems: SystemUnderTest[];
      if (organizationId) {
        // Explicit org selected — scope to that org
        const qb = withRequestEm(this.systemRepo)
          .createQueryBuilder('system')
          .where('system.organization_id = :organizationId', { organizationId })
          .orderBy('system.name', 'ASC');
        // Apply team restriction for non-admin users
        if (!isAdmin) {
          this.applyTeamRestriction(qb, 'system', userTeamIds);
        }
        systems = await qb.getMany();
        this.logger.log(`[getSystemsSummary] ORG-SCOPED PATH - Returning ${systems.length} systems for org ${organizationId}`);
      } else if (isAdmin) {
        // Global admins see all systems
        systems = await withRequestEm(this.systemRepo).find({
          order: { name: 'ASC' }
        });
        this.logger.log(`[getSystemsSummary] ADMIN PATH - Returning ${systems.length} systems (all systems)`);
      } else {
        this.logger.log(`[getSystemsSummary] NON-ADMIN PATH - accessible organizations: ${organizationIds.join(', ')}`);

        // If user has no organizations, return empty array
        if (organizationIds.length === 0) {
          this.logger.log(`[getSystemsSummary] User has no organizations - returning empty array`);
          return [];
        }

        // Filter systems by organization + team restriction
        const qb = withRequestEm(this.systemRepo)
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
            { orgIds: organizationIds, ...(userTeamIds.length > 0 ? { userTeamIds } : {}) },
          )
          .orderBy('system.name', 'ASC');

        systems = await qb.getMany();

        this.logger.log(`[getSystemsSummary] FILTERED RESULT - Returning ${systems.length} systems from organizations: ${organizationIds.join(', ')}`);
        systems.forEach(s => {
          this.logger.log(`  - System: ${s.name} (id: ${s.id}, org: ${s.organization_id})`);
        });
      }

      // Only get environment/workload data for accessible systems
      const systemIds = systems.map(s => s.id);
      let envWorkloadData: TestRunEntity[];

      if (systemIds.length === 0) {
        envWorkloadData = [];
      } else {
        envWorkloadData = await withRequestEm(this.testRunRepo)
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
   * @param isAdmin - Whether the caller has global admin privileges (resolved by the parent)
   * @param organizationIds - User's accessible organization IDs (resolved by the parent)
   */
  async getAllTags(isAdmin: boolean, organizationIds: string[]): Promise<string[]> {
    try {
      this.logger.log(`[getAllTags] START - isAdmin=${isAdmin}`);

      const queryBuilder = withRequestEm(this.testRunRepo)
        .createQueryBuilder('tr')
        .select('DISTINCT unnest(tr.tags)', 'tag')
        .where('tr.tags IS NOT NULL')
        .andWhere('array_length(tr.tags, 1) > 0');

      // Apply organization filtering for non-admin users
      if (!isAdmin) {
        this.logger.log(`[getAllTags] NON-ADMIN PATH - accessible organizations: ${organizationIds.join(', ')}`);

        if (organizationIds.length === 0) {
          this.logger.log(`[getAllTags] User has no organizations - returning empty array`);
          return [];
        }

        // Filter via systems_under_test JOIN since test_runs doesn't have organization_id
        queryBuilder
          .leftJoin('systems_under_test', 'sut', 'sut.id = tr.systemUnderTestId')
          .andWhere('sut.organization_id IN (:...orgIds)', { orgIds: organizationIds });
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
   * @param isAdmin - Whether the caller has global admin privileges (resolved by the parent)
   * @param organizationIds - User's accessible organization IDs (resolved by the parent)
   */
  async getAllAnnotations(isAdmin: boolean, organizationIds: string[]): Promise<string[]> {
    try {
      this.logger.log(`[getAllAnnotations] START - isAdmin=${isAdmin}`);

      const queryBuilder = withRequestEm(this.testRunRepo)
        .createQueryBuilder('tr')
        .select('DISTINCT unnest(tr.annotations)', 'annotation')
        .where('tr.annotations IS NOT NULL')
        .andWhere('array_length(tr.annotations, 1) > 0');

      // Apply organization filtering for non-admin users
      if (!isAdmin) {
        this.logger.log(`[getAllAnnotations] NON-ADMIN PATH - accessible organizations: ${organizationIds.join(', ')}`);

        if (organizationIds.length === 0) {
          this.logger.log(`[getAllAnnotations] User has no organizations - returning empty array`);
          return [];
        }

        // Filter via systems_under_test JOIN since test_runs doesn't have organization_id
        queryBuilder
          .leftJoin('systems_under_test', 'sut', 'sut.id = tr.systemUnderTestId')
          .andWhere('sut.organization_id IN (:...orgIds)', { orgIds: organizationIds });
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
   * @param excludeTestRunId - Optional test run ID to exclude
   * @param limit - Maximum number of results
   */
  async getBaselineCandidates(
    systemUnderTestId: string,
    testEnvironment?: string,
    workload?: string,
    excludeTestRunId?: string,
    limit: number = 50
  ): Promise<TestRun[]> {
    try {
      this.logger.debug(`getBaselineCandidates: systemUnderTestId=${systemUnderTestId}`);

      // NOTE: Organization filtering will be added here when TestRun entity has organization_id

      const queryBuilder = withRequestEm(this.testRunRepo)
        .createQueryBuilder('tr')
        .leftJoinAndSelect('tr.systemUnderTest', 'sut')
        .where('tr.systemUnderTestId = :systemUnderTestId', { systemUnderTestId })
        .andWhere('tr.completed = :completed', { completed: true });

      if (testEnvironment) {
        queryBuilder.andWhere('tr.testEnvironment = :testEnvironment', { testEnvironment });
      }
      if (workload) {
        queryBuilder.andWhere('tr.workload = :workload', { workload });
      }
      if (excludeTestRunId) {
        // Callers pass either the human-readable test_run_id or the row UUID
        // (the report dialog passes the UUID) — exclude on both, and cast the
        // uuid column to text so a non-uuid string can't blow up the query.
        queryBuilder.andWhere(
          'tr.testRunId != :excludeTestRunId AND CAST(tr.id AS text) != :excludeTestRunId',
          { excludeTestRunId },
        );
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
   * @param userId - The user ID (forwarded to per-resource access checks)
   * @param isAdmin - Whether the caller has global admin privileges (resolved by the parent)
   * @param panelDescription - Optional panel description filter
   */
  async getRequestNames(testRunId: string, userId: string, isAdmin: boolean, panelDescription?: string): Promise<string[]> {
    try {
      this.logger.debug(`getRequestNames: testRunId=${testRunId}, userId=${userId}, isAdmin=${isAdmin}`);

      const testRun = await this.findByTestRunId(testRunId, userId, isAdmin);

      if (panelDescription) {
        const query = `
          SELECT DISTINCT jsonb_object_keys(m.data) as metric_name
          FROM ds_panels p
          JOIN ds_metrics m ON m.panel_id = p.id
          WHERE p.test_run_id = $1
            AND p.panel_description ILIKE $2
          ORDER BY metric_name
        `;

        const result = await withRequestEm(this.testRunRepo).query(query, [
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

        const result = await withRequestEm(this.testRunRepo).query(query, [testRun.test_run_id]);

        return result.map((row: { request_name: string }) => row.request_name);
      }
    } catch (error) {
      this.logger.error('Failed to get request names:', error);
      throw new DatabaseException('Failed to retrieve request names', error);
    }
  }
}
