import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PaginationQueryDto, PaginatedResponseDto } from '../../../common/dto';
import { AuthorizationService } from '../../../common/services/authorization.service';

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
   */
  async verifyTestRunAccess(testRunId: string, userId: string, roles: string[]): Promise<void> {
    if (this.authzService.isGlobalAdmin(roles)) return;

    const organizationIds = await this.authzService.getAccessibleOrganizations(userId);

    const result = await this.dataSource.query(
      `SELECT organization_id FROM test_runs WHERE id::text = $1 OR test_run_id = $1 LIMIT 1`,
      [testRunId],
    );
    if (result.length === 0) return; // Let downstream service handle 404

    const orgId = result[0].organization_id;
    // Legacy test runs (null org) are accessible to all authenticated users
    if (orgId && !organizationIds.includes(orgId)) {
      throw new ForbiddenException('Access denied to this test run');
    }
  }

  // ============================================================================
  // CRUD Operations (delegated to TestRunsCrudQueryService)
  // ============================================================================

  async findAllPaginated(userId: string, roles: string[], paginationDto?: PaginationQueryDto, organizationId?: string): Promise<PaginatedResponseDto<TestRun>> {
    return this.crudService.findAllPaginated(userId, roles, paginationDto, organizationId);
  }

  async getFilterOptions(userId: string, roles: string[], organizationId?: string): Promise<{ systems: string[]; environments: string[]; workloads: string[] }> {
    return this.crudService.getFilterOptions(userId, roles, organizationId);
  }

  async findAll(userId: string, roles: string[]): Promise<TestRun[]> {
    return this.crudService.findAll(userId, roles);
  }

  async findByTestRunId(testRunId: string, userId: string, roles: string[]): Promise<TestRun> {
    return this.crudService.findByTestRunId(testRunId, userId, roles);
  }

  async findOne(id: string, userId: string, roles: string[]): Promise<TestRun> {
    return this.crudService.findOne(id, userId, roles);
  }

  async getTestRunByTestRunId(testRunId: string, userId: string, roles: string[]): Promise<TestRun | null> {
    return this.crudService.getTestRunByTestRunId(testRunId, userId, roles);
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
    return this.crudService.findByTestRunIdAndParams(testRunId, systemName, environment, workload, userId, roles, organizationId);
  }

  async getRelatedTestRuns(
    testRunId: string,
    userId: string,
    roles: string[],
    system?: string,
    environment?: string,
    workload?: string
  ): Promise<RelatedTestRun[]> {
    return this.crudService.getRelatedTestRuns(testRunId, userId, roles, system, environment, workload);
  }

  async getSystemsSummary(userId: string, roles: string[], organizationId?: string): Promise<SystemsSummary[]> {
    return this.crudService.getSystemsSummary(userId, roles, organizationId);
  }

  async getAllTags(userId: string, roles: string[]): Promise<string[]> {
    return this.crudService.getAllTags(userId, roles);
  }

  async getAllAnnotations(userId: string, roles: string[]): Promise<string[]> {
    return this.crudService.getAllAnnotations(userId, roles);
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
    userId: string,
    roles: string[],
    excludeTestRunId?: string,
    limit?: number
  ): Promise<TestRun[]> {
    return this.crudService.getBaselineCandidates(systemUnderTestId, testEnvironment, workload, userId, roles, excludeTestRunId, limit);
  }

  async getRequestNames(testRunId: string, userId: string, roles: string[], panelDescription?: string): Promise<string[]> {
    return this.crudService.getRequestNames(testRunId, userId, roles, panelDescription);
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
    const organizationIds = await this.resolveOrganizationIds(userId, roles, organizationId);
    const userTeamIds = await this.resolveTeamIds(userId, roles);
    return this.dashboardService.getDashboardStatistics(timePeriod, from, to, roles, organizationIds, userTeamIds);
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
    const organizationIds = await this.resolveOrganizationIds(userId, roles, organizationId);
    const userTeamIds = await this.resolveTeamIds(userId, roles);
    return this.dashboardService.getRecentFailures(limit, timePeriod, from, to, roles, organizationIds, userTeamIds, userId);
  }

  async recordTestRunView(userId: string, testRunId: string): Promise<void> {
    return this.dashboardService.recordView(userId, testRunId);
  }

  async getDashboardSystemsSummary(userId: string, roles: string[], organizationId?: string): Promise<SystemSummary[]> {
    const organizationIds = await this.resolveOrganizationIds(userId, roles, organizationId);
    const userTeamIds = await this.resolveTeamIds(userId, roles);
    return this.dashboardService.getDashboardSystemsSummary(roles, organizationIds, userTeamIds);
  }

  /**
   * Resolve organization IDs for filtering:
   * - Explicit org selected → [organizationId] (always filter, even for admins)
   * - Non-admin without explicit org → load accessible orgs from authz service
   * - Admin without explicit org → [] (empty = no filter, see all)
   */
  private async resolveOrganizationIds(userId: string, roles: string[], organizationId?: string): Promise<string[]> {
    if (organizationId) {
      return [organizationId];
    }
    if (this.authzService.isGlobalAdmin(roles)) {
      return [];
    }
    return this.authzService.getAccessibleOrganizations(userId);
  }

  /**
   * Resolve team IDs for team-restriction filtering:
   * - Admin → [] (empty = no team restriction)
   * - Non-admin → load user's accessible teams
   */
  private async resolveTeamIds(userId: string, roles: string[]): Promise<string[]> {
    if (this.authzService.isGlobalAdmin(roles)) {
      return [];
    }
    return this.authzService.getAccessibleTeams(userId);
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
    const organizationIds = await this.authzService.getAccessibleOrganizations(userId);
    return this.performanceService.getTransactionStats(testRunId, excludeRampUp, roles, organizationIds, sinceMinutes);
  }

  async getTransactionSamples(
    testRunId: string,
    transactionName: string,
    userId: string,
    roles: string[],
    excludeRampUp?: boolean,
    sinceMinutes?: number,
  ): Promise<SamplerStats[]> {
    const organizationIds = await this.authzService.getAccessibleOrganizations(userId);
    return this.performanceService.getTransactionSamples(testRunId, transactionName, excludeRampUp, roles, organizationIds, sinceMinutes);
  }

  async getTransactionErrors(
    testRunId: string,
    userId: string,
    roles: string[],
    transactionName?: string,
    samplerName?: string
  ): Promise<ErrorStats[]> {
    const organizationIds = await this.authzService.getAccessibleOrganizations(userId);
    return this.performanceService.getTransactionErrors(testRunId, transactionName, samplerName, roles, organizationIds);
  }

  async getVirtualUserStats(
    testRunId: string,
    userId: string,
    roles: string[],
    excludeRampUp?: boolean
  ): Promise<VirtualUserStats> {
    const organizationIds = await this.authzService.getAccessibleOrganizations(userId);
    return this.performanceService.getVirtualUserStats(testRunId, excludeRampUp, roles, organizationIds);
  }

  async getThroughputStats(
    testRunId: string,
    userId: string,
    roles: string[],
    excludeRampUp?: boolean
  ): Promise<ThroughputStats> {
    const organizationIds = await this.authzService.getAccessibleOrganizations(userId);
    return this.performanceService.getThroughputStats(testRunId, excludeRampUp, roles, organizationIds);
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
    const organizationIds = await this.authzService.getAccessibleOrganizations(userId);
    return this.timeSeriesService.getTransactionTimeSeries(testRunId, transactionName, aggregationSeconds, excludeRampUp, roles, organizationIds);
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
    const organizationIds = await this.authzService.getAccessibleOrganizations(userId);
    return this.timeSeriesService.getSamplerTimeSeries(testRunId, transactionName, samplerName, aggregationSeconds, excludeRampUp, roles, organizationIds);
  }
}
