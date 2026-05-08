import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { OwnedResource } from '@perfana/shared';
import { PaginationQueryDto, PaginatedResponseDto } from '../../../common/dto';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { withOrgFilter } from '../../../common/utils/with-org-filter';
import { withTeamFilter } from '../../../common/utils/with-team-filter';

// Import sub-services
import { TestRunsCrudQueryService } from './test-runs-crud-query.service';
import { TestRunsDashboardQueryService } from './test-runs-dashboard-query.service';
import { TestRunsPerformanceQueryService } from './test-runs-performance-query.service';
import { TestRunsTimeSeriesQueryService } from './test-runs-timeseries-query.service';

// Re-export types for backwards compatibility
export {
  TestRun,
  TimePeriod,
  DateBounds,
  DashboardStatistics,
  RecentFailure,
  SystemSummary,
  TransactionStats,
  SamplerStats,
  ErrorStats,
  TimeSeriesDataPoint,
  TransactionTimeSeriesData,
  VirtualUserStats,
  ThroughputStats,
  RelatedTestRun,
  SystemsSummary,
} from '../types/test-run.types';

import {
  TestRun,
  TimePeriod,
  DashboardStatistics,
  RecentFailure,
  SystemSummary,
  TransactionStats,
  SamplerStats,
  ErrorStats,
  TimeSeriesDataPoint,
  TransactionTimeSeriesData,
  VirtualUserStats,
  ThroughputStats,
  RelatedTestRun,
  SystemsSummary,
} from '../types/test-run.types';

/**
 * Facade service that delegates to specialized query services.
 * Maintains backwards compatibility while allowing the internal implementation
 * to be split into smaller, focused services.
 *
 * Authorization:
 * - All query methods accept userId and roles parameters for authorization
 * - Parameters are passed through to sub-services for filtering
 * - Global admins bypass all authorization checks
 *
 * Sub-services:
 * - TestRunsMapperService: Entity-to-DTO mapping utilities
 * - TestRunsCrudQueryService: Basic CRUD and lookup operations
 * - TestRunsDashboardQueryService: Dashboard statistics and summaries
 * - TestRunsPerformanceQueryService: Transaction, sampler, and error analysis
 * - TestRunsTimeSeriesQueryService: Time series data queries
 */
@Injectable()
export class TestRunsQueryService {
  constructor(
    private readonly crudService: TestRunsCrudQueryService,
    private readonly dashboardService: TestRunsDashboardQueryService,
    private readonly performanceService: TestRunsPerformanceQueryService,
    private readonly timeSeriesService: TestRunsTimeSeriesQueryService,
    private readonly authzService: AuthorizationService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * Lightweight access check for test-run-scoped endpoints.
   * Verifies the user can access the test run without loading the full record.
   * Throws ForbiddenException if the test run belongs to an org the user cannot access.
   *
   * Returns silently when the test run is missing — the downstream service handles 404.
   * `canAccessResource` already short-circuits on global admin and on legacy null-org rows.
   */
  async verifyTestRunAccess(testRunId: string, userId: string, roles: string[]): Promise<void> {
    const result = await this.dataSource.query(
      `SELECT organization_id, created_by FROM test_runs WHERE id::text = $1 OR test_run_id = $1 LIMIT 1`,
      [testRunId],
    );
    if (result.length === 0) return; // Let downstream service handle 404

    const accessResult = await this.authzService.canAccessResource(userId, roles, {
      organization_id: result[0].organization_id,
      created_by: result[0].created_by ?? '',
    } as OwnedResource);

    if (!accessResult.allowed) {
      throw new ForbiddenException('Access denied to this test run');
    }
  }

  /**
   * Find test runs by UUIDs. Returns minimal data for bulk operations.
   * No authorization — caller is responsible for permission checks.
   */
  async findByIds(ids: string[]): Promise<Array<{ id: string; deletionStatus?: string | null }>> {
    if (ids.length === 0) return [];
    const rows = await this.dataSource.query(
      `SELECT id, deletion_status FROM test_runs WHERE id = ANY($1)`,
      [ids],
    );
    return rows.map((r: { id: string; deletion_status: string | null }) => ({
      id: r.id,
      deletionStatus: r.deletion_status,
    }));
  }

  // ============================================================================
  // CRUD Operations (delegated to TestRunsCrudQueryService)
  // ============================================================================

  async findAllPaginated(userId: string, roles: string[], paginationDto?: PaginationQueryDto, organizationId?: string): Promise<PaginatedResponseDto<TestRun>> {
    const { orgIds, isAdmin } = await this.resolveOrganizationIds(userId, roles, organizationId);
    const userTeamIds = await this.resolveTeamIds(userId, roles);
    return this.crudService.findAllPaginated(isAdmin, orgIds, userTeamIds, paginationDto, organizationId);
  }

  async getFilterOptions(userId: string, roles: string[], organizationId?: string): Promise<{ systems: string[]; environments: string[]; workloads: string[] }> {
    const { orgIds, isAdmin } = await this.resolveOrganizationIds(userId, roles, organizationId);
    const userTeamIds = await this.resolveTeamIds(userId, roles);
    return this.crudService.getFilterOptions(isAdmin, orgIds, userTeamIds, organizationId);
  }

  async findAll(userId: string, roles: string[]): Promise<TestRun[]> {
    const { orgIds, isAdmin } = await this.resolveOrganizationIds(userId, roles);
    return this.crudService.findAll(isAdmin, orgIds);
  }

  async findByTestRunId(testRunId: string, userId: string, roles: string[]): Promise<TestRun> {
    const isAdmin = await this.resolveIsAdmin(userId, roles);
    return this.crudService.findByTestRunId(testRunId, userId, isAdmin);
  }

  async findOne(id: string, userId: string, roles: string[]): Promise<TestRun> {
    const isAdmin = await this.resolveIsAdmin(userId, roles);
    return this.crudService.findOne(id, userId, isAdmin);
  }

  async getTestRunByTestRunId(testRunId: string, userId: string, roles: string[]): Promise<TestRun | null> {
    const isAdmin = await this.resolveIsAdmin(userId, roles);
    return this.crudService.getTestRunByTestRunId(testRunId, userId, isAdmin);
  }

  async findByTestRunIdAndParams(
    testRunId: string,
    systemName: string,
    environment: string,
    workload: string,
    userId: string,
    roles: string[],
    organizationId?: string,
  ): Promise<TestRun> {
    const { orgIds, isAdmin } = await this.resolveOrganizationIds(userId, roles, organizationId);
    const userTeamIds = await this.resolveTeamIds(userId, roles);
    return this.crudService.findByTestRunIdAndParams(testRunId, systemName, environment, workload, isAdmin, orgIds, userTeamIds, organizationId);
  }

  async getRelatedTestRuns(
    testRunId: string,
    userId: string,
    roles: string[],
    system?: string,
    environment?: string,
    workload?: string
  ): Promise<RelatedTestRun[]> {
    const { orgIds, isAdmin } = await this.resolveOrganizationIds(userId, roles);
    const userTeamIds = await this.resolveTeamIds(userId, roles);
    return this.crudService.getRelatedTestRuns(testRunId, isAdmin, orgIds, userTeamIds, system, environment, workload);
  }

  async getSystemsSummary(userId: string, roles: string[], organizationId?: string): Promise<SystemsSummary[]> {
    const { orgIds, isAdmin } = await this.resolveOrganizationIds(userId, roles, organizationId);
    const userTeamIds = await this.resolveTeamIds(userId, roles);
    return this.crudService.getSystemsSummary(isAdmin, orgIds, userTeamIds, organizationId);
  }

  async getAllTags(userId: string, roles: string[]): Promise<string[]> {
    const { orgIds, isAdmin } = await this.resolveOrganizationIds(userId, roles);
    return this.crudService.getAllTags(isAdmin, orgIds);
  }

  async getAllAnnotations(userId: string, roles: string[]): Promise<string[]> {
    const { orgIds, isAdmin } = await this.resolveOrganizationIds(userId, roles);
    return this.crudService.getAllAnnotations(isAdmin, orgIds);
  }

  async isTestRunChangepoint(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    testRunId: string
  ): Promise<boolean> {
    return this.crudService.isTestRunChangepoint(systemUnderTestId, testEnvironment, workload, testRunId);
  }

  async isTestRunInControlGroup(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    testRunId: string
  ): Promise<boolean> {
    return this.crudService.isTestRunInControlGroup(systemUnderTestId, testEnvironment, workload, testRunId);
  }

  async getBaselineCandidates(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    _userId: string,
    _roles: string[],
    excludeTestRunId?: string,
    limit?: number
  ): Promise<TestRun[]> {
    return this.crudService.getBaselineCandidates(systemUnderTestId, testEnvironment, workload, excludeTestRunId, limit);
  }

  async getRequestNames(testRunId: string, userId: string, roles: string[], panelDescription?: string): Promise<string[]> {
    const isAdmin = await this.resolveIsAdmin(userId, roles);
    return this.crudService.getRequestNames(testRunId, userId, isAdmin, panelDescription);
  }

  // ============================================================================
  // Dashboard Operations (delegated to TestRunsDashboardQueryService)
  // ============================================================================

  async getDashboardStatistics(
    userId: string,
    roles: string[],
    timePeriod?: TimePeriod,
    from?: string,
    to?: string,
    organizationId?: string,
  ): Promise<DashboardStatistics> {
    const { orgIds, isAdmin } = await this.resolveOrganizationIds(userId, roles, organizationId);
    const userTeamIds = await this.resolveTeamIds(userId, roles);
    return this.dashboardService.getDashboardStatistics(timePeriod, from, to, isAdmin, orgIds, userTeamIds);
  }

  async getRecentFailures(
    userId: string,
    roles: string[],
    limit?: number,
    timePeriod?: TimePeriod,
    from?: string,
    to?: string,
    organizationId?: string,
  ): Promise<RecentFailure[]> {
    const { orgIds, isAdmin } = await this.resolveOrganizationIds(userId, roles, organizationId);
    const userTeamIds = await this.resolveTeamIds(userId, roles);
    return this.dashboardService.getRecentFailures(limit, timePeriod, from, to, isAdmin, orgIds, userTeamIds, userId);
  }

  async recordTestRunView(userId: string, testRunId: string): Promise<void> {
    return this.dashboardService.recordView(userId, testRunId);
  }

  async getDashboardSystemsSummary(userId: string, roles: string[], organizationId?: string): Promise<SystemSummary[]> {
    const { orgIds, isAdmin } = await this.resolveOrganizationIds(userId, roles, organizationId);
    const userTeamIds = await this.resolveTeamIds(userId, roles);
    return this.dashboardService.getDashboardSystemsSummary(isAdmin, orgIds, userTeamIds);
  }

  /**
   * Resolve organization IDs for filtering and surface the admin flag together:
   * - Explicit org selected → [organizationId] (always filter, even for admins)
   * - Non-admin without explicit org → load accessible orgs from authz service
   * - Admin without explicit org → [] (empty = no filter, see all)
   *
   * `withOrgFilter` returns `null` for global admins; the sub-services use `isAdmin`
   * for early-exit (non-admin with empty orgs returns zero/empty) and team-filter
   * gating (admins skip the team-membership restriction). Returning the flag here
   * means callers don't have to call `withOrgFilter` a second time just to learn it.
   */
  private async resolveOrganizationIds(
    userId: string,
    roles: string[],
    organizationId?: string,
  ): Promise<{ orgIds: string[]; isAdmin: boolean }> {
    const accessible = await withOrgFilter(userId, roles, this.authzService);
    const isAdmin = accessible === null;
    if (organizationId) {
      return { orgIds: [organizationId], isAdmin };
    }
    return { orgIds: accessible ?? [], isAdmin };
  }

  /**
   * Resolve team IDs for team-restriction filtering:
   * - Admin → [] (empty = no team restriction)
   * - Non-admin → load user's accessible teams
   *
   * Same null-collapse as `resolveOrganizationIds`: `withTeamFilter` returns `null` for
   * global admins, sub-services expect `[]` to mean "no team restriction".
   */
  private async resolveTeamIds(userId: string, roles: string[]): Promise<string[]> {
    const teamIds = await withTeamFilter(userId, roles, this.authzService);
    return teamIds ?? [];
  }

  /**
   * Resolve admin state for per-resource methods that don't need org/team lists.
   * `withOrgFilter` returns `null` iff the user is a global admin; we collapse that
   * to a boolean and forward it. This is the canonical indirection for the
   * `no-direct-is-global-admin` lint rule.
   */
  private async resolveIsAdmin(userId: string, roles: string[]): Promise<boolean> {
    return (await withOrgFilter(userId, roles, this.authzService)) === null;
  }

  // ============================================================================
  // Performance Analysis (delegated to TestRunsPerformanceQueryService)
  // ============================================================================

  async getTransactionStats(
    testRunId: string,
    userId: string,
    roles: string[],
    excludeRampUp?: boolean,
    sinceMinutes?: number,
  ): Promise<TransactionStats[]> {
    const { orgIds, isAdmin } = await this.resolveOrganizationIds(userId, roles);
    return this.performanceService.getTransactionStats(testRunId, excludeRampUp, isAdmin, orgIds, sinceMinutes);
  }

  async getTransactionSamples(
    testRunId: string,
    transactionName: string,
    userId: string,
    roles: string[],
    excludeRampUp?: boolean,
    sinceMinutes?: number,
  ): Promise<SamplerStats[]> {
    const { orgIds, isAdmin } = await this.resolveOrganizationIds(userId, roles);
    return this.performanceService.getTransactionSamples(testRunId, transactionName, excludeRampUp, isAdmin, orgIds, sinceMinutes);
  }

  async getTransactionErrors(
    testRunId: string,
    userId: string,
    roles: string[],
    transactionName?: string,
    samplerName?: string,
    excludeRampUp?: boolean,
  ): Promise<ErrorStats[]> {
    const { orgIds, isAdmin } = await this.resolveOrganizationIds(userId, roles);
    return this.performanceService.getTransactionErrors(testRunId, transactionName, samplerName, isAdmin, orgIds, excludeRampUp);
  }

  async getVirtualUserStats(
    testRunId: string,
    userId: string,
    roles: string[],
    excludeRampUp?: boolean
  ): Promise<VirtualUserStats> {
    const { orgIds, isAdmin } = await this.resolveOrganizationIds(userId, roles);
    return this.performanceService.getVirtualUserStats(testRunId, excludeRampUp, isAdmin, orgIds);
  }

  async getThroughputStats(
    testRunId: string,
    userId: string,
    roles: string[],
    excludeRampUp?: boolean
  ): Promise<ThroughputStats> {
    const { orgIds, isAdmin } = await this.resolveOrganizationIds(userId, roles);
    return this.performanceService.getThroughputStats(testRunId, excludeRampUp, isAdmin, orgIds);
  }

  // ============================================================================
  // Time Series Data (delegated to TestRunsTimeSeriesQueryService)
  // ============================================================================

  async getTransactionTimeSeries(
    testRunId: string,
    transactionName: string,
    userId: string,
    roles: string[],
    aggregationSeconds?: number,
    excludeRampUp?: boolean
  ): Promise<TransactionTimeSeriesData> {
    return this.timeSeriesService.getTransactionTimeSeries(testRunId, transactionName, userId, roles, aggregationSeconds, excludeRampUp);
  }

  async getSamplerTimeSeries(
    testRunId: string,
    transactionName: string,
    samplerName: string,
    userId: string,
    roles: string[],
    aggregationSeconds?: number,
    excludeRampUp?: boolean
  ): Promise<TimeSeriesDataPoint[]> {
    return this.timeSeriesService.getSamplerTimeSeries(testRunId, transactionName, samplerName, userId, roles, aggregationSeconds, excludeRampUp);
  }
}
