import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder, ObjectLiteral } from 'typeorm';
import { withRequestEm } from '../../../common/db/request-em';
import {
  TestRun as TestRunEntity,
  SystemUnderTest,
  TestRunView,
} from '../../../entities';
import { DatabaseException } from '../../../common/exceptions/business.exception';
import { TestRunsMapperService } from './test-runs-mapper.service';
import {
  TimePeriod,
  DashboardStatistics,
  RecentFailure,
  SystemSummary,
} from '../types/test-run.types';

/**
 * Service responsible for dashboard statistics and summary queries
 * Handles: getDashboardStatistics, getRecentFailures, getDashboardSystemsSummary
 */
@Injectable()
export class TestRunsDashboardQueryService {
  private readonly logger = new Logger(TestRunsDashboardQueryService.name);

  constructor(
    @InjectRepository(TestRunEntity)
    private readonly testRunRepo: Repository<TestRunEntity>,
    @InjectRepository(SystemUnderTest)
    private readonly systemRepo: Repository<SystemUnderTest>,
    @InjectRepository(TestRunView)
    private readonly testRunViewRepo: Repository<TestRunView>,
    private readonly mapper: TestRunsMapperService,
  ) {}

  /**
   * Apply organization filtering to a query builder
   * Filters by systemUnderTest.organization_id directly
   */
  private applyOrganizationFilter(
    queryBuilder: SelectQueryBuilder<ObjectLiteral>,
    organizationIds: string[],
  ): void {
    queryBuilder
      .leftJoin('tr.systemUnderTest', 'sut')
      .andWhere('sut.organization_id IN (:...orgIds)', { orgIds: organizationIds });
  }

  /**
   * Apply team-level access restriction to a query builder.
   * Ensures non-admin users can only see resources from teams they belong to
   * when the team has restrict_to_team_members enabled.
   * Must be called after the SUT alias is already joined.
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
   * Get dashboard statistics with optional time period filtering
   * Time periods: '24h', '7d', '30d', 'all', 'custom'
   *
   * @param timePeriod - Time period filter
   * @param from - Custom start date (for 'custom' period)
   * @param to - Custom end date (for 'custom' period)
   * @param isAdmin - Whether the caller has global admin privileges (resolved by the parent
   *   facade via `withOrgFilter`); admins skip the team-membership restriction and are not
   *   subject to the "no orgs → return zeros" early exit.
   * @param organizationIds - User's accessible organization IDs (or `[organizationId]` if explicit)
   */
  async getDashboardStatistics(
    timePeriod: TimePeriod = '7d',
    from?: string,
    to?: string,
    isAdmin: boolean = false,
    organizationIds: string[] = [],
    userTeamIds: string[] = [],
  ): Promise<DashboardStatistics> {
    try {
      const shouldFilter = organizationIds.length > 0;
      const shouldFilterTeams = !isAdmin;
      this.logger.log(`[getDashboardStatistics] START - timePeriod=${timePeriod}, isAdmin=${isAdmin}, organizationIds=${JSON.stringify(organizationIds)}, shouldFilter=${shouldFilter}`);

      // Non-admin users with no organization memberships see zeros
      if (!isAdmin && !shouldFilter) {
        this.logger.log('[getDashboardStatistics] User has no organization memberships, returning zero statistics');
        return {
          totalTests: 0,
          passedTests: 0,
          failedTests: 0,
          activeTests: 0,
          sloComplianceRate: 0,
          mostTestedSystem: null,
          timePeriod,
        };
      }

      const { dateThreshold, dateUpperBound } = this.mapper.calculateDateBounds(timePeriod, from, to);

      // Helper to apply org + team filters to a test_runs query builder
      const applyAccessFilters = (qb: SelectQueryBuilder<TestRunEntity>) => {
        if (shouldFilter) {
          this.applyOrganizationFilter(qb, organizationIds);
        }
        if (shouldFilterTeams) {
          this.applyTeamRestriction(qb, 'sut', userTeamIds);
        }
      };

      // Get total count
      const baseQuery = withRequestEm(this.testRunRepo).createQueryBuilder('tr');
      applyAccessFilters(baseQuery);
      this.mapper.applyDateFilters(baseQuery, dateThreshold, dateUpperBound);

      const totalTests = await baseQuery.getCount();

      // Get passed tests (where consolidated_result.overall === true)
      const passedQuery = withRequestEm(this.testRunRepo).createQueryBuilder('tr');
      applyAccessFilters(passedQuery);
      this.mapper.applyDateFilters(passedQuery, dateThreshold, dateUpperBound);
      passedQuery.andWhere("tr.consolidated_result->>'overall' = 'true'");
      const passedTests = await passedQuery.getCount();

      // Get failed tests (where consolidated_result.overall === false)
      const failedQuery = withRequestEm(this.testRunRepo).createQueryBuilder('tr');
      applyAccessFilters(failedQuery);
      this.mapper.applyDateFilters(failedQuery, dateThreshold, dateUpperBound);
      failedQuery.andWhere("tr.consolidated_result->>'overall' = 'false'");
      const failedTests = await failedQuery.getCount();

      // Get active tests (where completed === false)
      const activeQuery = withRequestEm(this.testRunRepo).createQueryBuilder('tr');
      applyAccessFilters(activeQuery);
      this.mapper.applyDateFilters(activeQuery, dateThreshold, dateUpperBound);
      activeQuery.andWhere('tr.completed = false');
      const activeTests = await activeQuery.getCount();

      // Get SLO compliance rate
      const sloQuery = withRequestEm(this.testRunRepo).createQueryBuilder('tr');
      applyAccessFilters(sloQuery);
      this.mapper.applyDateFilters(sloQuery, dateThreshold, dateUpperBound);
      sloQuery.andWhere("tr.consolidated_result->>'meetsRequirement' = 'true'");
      const sloCompliantTests = await sloQuery.getCount();
      const sloComplianceRate = totalTests > 0 ? Math.round((sloCompliantTests / totalTests) * 100) : 0;

      // Get most tested system
      const systemCountQuery = withRequestEm(this.testRunRepo)
        .createQueryBuilder('tr')
        .leftJoin('tr.systemUnderTest', 'sut')
        .select('sut.name', 'system_name')
        .addSelect('COUNT(*)', 'test_count')
        .groupBy('sut.name')
        .orderBy('test_count', 'DESC')
        .limit(1);

      if (shouldFilter) {
        systemCountQuery
          .andWhere('sut.organization_id IN (:...orgIds)', { orgIds: organizationIds });
      }
      if (shouldFilterTeams) {
        this.applyTeamRestriction(systemCountQuery, 'sut', userTeamIds);
      }
      this.mapper.applyDateFilters(systemCountQuery, dateThreshold, dateUpperBound);

      const mostTestedResult = await systemCountQuery.getRawOne();
      const mostTestedSystem = mostTestedResult
        ? { name: mostTestedResult.system_name, count: this.mapper.parseInt(mostTestedResult.test_count) }
        : null;

      this.logger.log(`Dashboard statistics calculated for period: ${timePeriod} - Total: ${totalTests}, Passed: ${passedTests}, Failed: ${failedTests}${shouldFilter ? ` (orgs: ${organizationIds.join(',')})` : ' (all orgs)'}`);

      return {
        totalTests,
        passedTests,
        failedTests,
        activeTests,
        sloComplianceRate,
        mostTestedSystem,
        timePeriod,
      };
    } catch (error) {
      this.logger.error('Failed to get dashboard statistics:', error);
      throw new DatabaseException('Failed to retrieve dashboard statistics', error);
    }
  }

  /**
   * Record that a user has viewed a specific test run.
   * Uses upsert to update viewed_at if the record already exists.
   */
  async recordView(userId: string, testRunId: string): Promise<void> {
    try {
      await withRequestEm(this.testRunViewRepo)
        .createQueryBuilder()
        .insert()
        .into(TestRunView)
        .values({ userId, testRunId, viewedAt: new Date() })
        .orUpdate(['viewed_at'], ['user_id', 'test_run_id'])
        .execute();
    } catch (error) {
      // Fire-and-forget: log but don't throw
      this.logger.warn(`Failed to record test run view for user=${userId} testRun=${testRunId}:`, error);
    }
  }

  /**
   * Get recent failed test runs for dashboard, excluding those the user has already viewed.
   *
   * @param limit - Maximum number of failures to return
   * @param timePeriod - Time period filter
   * @param from - Custom start date (for 'custom' period)
   * @param to - Custom end date (for 'custom' period)
   * @param isAdmin - Whether the caller has global admin privileges (see `getDashboardStatistics`)
   * @param organizationIds - User's accessible organization IDs from JWT token
   * @param userTeamIds - User's accessible team IDs
   * @param userId - Current user ID (for filtering out viewed failures)
   */
  async getRecentFailures(
    limit: number = 5,
    timePeriod: TimePeriod = '7d',
    from?: string,
    to?: string,
    isAdmin: boolean = false,
    organizationIds: string[] = [],
    userTeamIds: string[] = [],
    userId?: string,
  ): Promise<RecentFailure[]> {
    try {
      const shouldFilter = organizationIds.length > 0;
      const shouldFilterTeams = !isAdmin;

      // Non-admin users with no organization memberships see empty results
      if (!isAdmin && !shouldFilter) {
        this.logger.debug('User has no organization memberships, returning empty failures list');
        return [];
      }

      const { dateThreshold, dateUpperBound } = this.mapper.calculateDateBounds(timePeriod, from, to);

      const query = withRequestEm(this.testRunRepo)
        .createQueryBuilder('tr')
        .leftJoinAndSelect('tr.systemUnderTest', 'sut')
        .where("tr.consolidated_result->>'overall' = 'false'")
        .orderBy('tr.created_at', 'DESC')
        .limit(limit);

      // Exclude test runs the user has already viewed (anti-join pattern)
      if (userId) {
        query
          .leftJoin('test_run_views', 'trv', 'trv.test_run_id = tr.id AND trv.user_id = :viewUserId', { viewUserId: userId })
          .andWhere('trv.user_id IS NULL');
      }

      // Apply organization filter when org IDs are specified (explicit selection or non-admin's orgs)
      if (shouldFilter) {
        query
          .andWhere('sut.organization_id IN (:...orgIds)', { orgIds: organizationIds });
      }
      // Apply team restriction for non-admin users
      if (shouldFilterTeams) {
        this.applyTeamRestriction(query, 'sut', userTeamIds);
      }

      // Apply date filters
      if (dateThreshold) {
        query.andWhere('tr.created_at >= :dateThreshold', { dateThreshold });
      }
      if (dateUpperBound) {
        query.andWhere('tr.created_at <= :dateUpperBound', { dateUpperBound });
      }

      const failures = await query.getMany();

      const result = failures.map(tr => ({
        id: tr.id,
        test_run_id: tr.testRunId,
        system_name: tr.systemUnderTest?.name || 'Unknown',
        test_environment: tr.testEnvironment,
        workload: tr.workload,
        start_time: tr.startTime?.toISOString() || null,
        end_time: tr.endTime?.toISOString() || null,
        consolidated_result: tr.consolidatedResult || null,
        created_at: tr.createdAt.toISOString(),
      }));

      this.logger.log(`Retrieved ${result.length} recent failures for period: ${timePeriod}${shouldFilter ? ` (orgs: ${organizationIds.join(',')})` : ' (all orgs)'}`);
      return result;
    } catch (error) {
      this.logger.error('Failed to get recent failures:', error);
      throw new DatabaseException('Failed to retrieve recent failures', error);
    }
  }

  /**
   * Get systems summary for dashboard with test run counts
   *
   * @param isAdmin - Whether the caller has global admin privileges (see `getDashboardStatistics`)
   * @param organizationIds - User's accessible organization IDs from JWT token
   */
  async getDashboardSystemsSummary(
    isAdmin: boolean = false,
    organizationIds: string[] = [],
    userTeamIds: string[] = [],
  ): Promise<SystemSummary[]> {
    try {
      const shouldFilter = organizationIds.length > 0;
      const shouldFilterTeams = !isAdmin;

      // Non-admin users with no organization memberships see empty results
      if (!isAdmin && !shouldFilter) {
        this.logger.debug('User has no organization memberships, returning empty systems summary');
        return [];
      }

      // Query systems with organization + team filtering
      const systemsQuery = withRequestEm(this.systemRepo)
        .createQueryBuilder('sut')
        .orderBy('sut.name', 'ASC');

      if (shouldFilter) {
        systemsQuery.where('sut.organization_id IN (:...orgIds)', { orgIds: organizationIds });
      }
      if (shouldFilterTeams) {
        this.applyTeamRestriction(systemsQuery, 'sut', userTeamIds);
      }

      const systems = await systemsQuery.getMany();

      // Query test run stats with organization + team filtering
      const statsQuery = withRequestEm(this.testRunRepo)
        .createQueryBuilder('tr')
        .leftJoin('tr.systemUnderTest', 'sut')
        .select('tr.system_under_test_id', 'system_id')
        .addSelect('COUNT(*)', 'total_count')
        .addSelect(
          `SUM(CASE WHEN tr.consolidated_result->>'overall' = 'true' THEN 1 ELSE 0 END)`,
          'passed_count'
        )
        .addSelect(
          `SUM(CASE WHEN tr.consolidated_result->>'overall' = 'false' THEN 1 ELSE 0 END)`,
          'failed_count'
        )
        .addSelect('MAX(tr.created_at)', 'last_test_run')
        .groupBy('tr.system_under_test_id');

      if (shouldFilter) {
        statsQuery
          .andWhere('sut.organization_id IN (:...orgIds)', { orgIds: organizationIds });
      }
      if (shouldFilterTeams) {
        this.applyTeamRestriction(statsQuery, 'sut', userTeamIds);
      }

      const systemStats = await statsQuery.getRawMany();

      const statsMap = new Map(
        systemStats.map(stat => [
          stat.system_id,
          {
            totalCount: this.mapper.parseInt(stat.total_count),
            passedCount: this.mapper.parseInt(stat.passed_count),
            failedCount: this.mapper.parseInt(stat.failed_count),
            lastTestRun: stat.last_test_run,
          },
        ])
      );

      const result = systems.map(system => {
        const stats = statsMap.get(system.id);
        return {
          id: system.id,
          name: system.name,
          testRunCount: stats?.totalCount || 0,
          lastTestRun: stats?.lastTestRun || null,
          passFailRatio: {
            passed: stats?.passedCount || 0,
            failed: stats?.failedCount || 0,
          },
        };
      });

      this.logger.log(`Retrieved dashboard systems summary for ${result.length} systems${shouldFilter ? ` (orgs: ${organizationIds.join(',')})` : ' (all orgs)'}`);
      return result;
    } catch (error) {
      this.logger.error('Failed to get dashboard systems summary:', error);
      throw new DatabaseException('Failed to retrieve dashboard systems summary', error);
    }
  }
}
