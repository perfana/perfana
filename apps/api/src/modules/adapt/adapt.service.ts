import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import {
  DsAdaptTrackedResults,
  DsAdaptConclusion,
  DsAdaptResults,
  TestRun as TestRunEntity
} from '../../entities';
import {
  TrackedRegressionDto,
  TrackedRegressionsResponseDto,
  TrackedRegressionsCountDto,
  ResolveTrackedRegressionDto,
  TrackedRegressionStatus
} from './dto/tracked-regression.dto';
import { AuthorizationService } from '../../common/services/authorization.service';

interface DatabaseTrackedRegression {
  id: string;
  test_run_id: string;
  control_group_id: string;
  tracked_test_run_id: string;
  tracked_difference_id?: string;
  application_dashboard_id: string;
  metrics_source_id?: string;
  panel_id: string;
  metric_name: string;
  dashboard_uid?: string;
  dashboard_label?: string;
  panel_title?: string;
  unit?: string;
  benchmark_ids?: string[];
  test_run_start: string;
  updated_at: string;
  mean?: any;
  median?: any;
  min_value?: any;
  max_value?: any;
  std_dev?: any;
  q95?: any;
  compare_config?: any;
  metric_classification?: any;
  thresholds?: any;
  checks?: any;
  conclusion?: any;
  tracked_conclusion?: any;
}

@Injectable()
export class AdaptService {
  private readonly logger = new Logger(AdaptService.name);

  constructor(
    @InjectRepository(DsAdaptTrackedResults)
    private trackedResultsRepo: Repository<DsAdaptTrackedResults>,
    @InjectRepository(DsAdaptConclusion)
    private conclusionRepo: Repository<DsAdaptConclusion>,
    @InjectRepository(TestRunEntity)
    private testRunRepo: Repository<TestRunEntity>,
    @InjectRepository(DsAdaptResults)
    private adaptResultsRepo: Repository<DsAdaptResults>,
    private readonly authzService: AuthorizationService,
  ) {}

  /**
   * Check if a user has global admin role
   */
  private isGlobalAdmin(roles: string[]): boolean {
    return this.authzService.isGlobalAdmin(roles);
  }

  /**
   * Load accessible organizations for a user from the database via AuthorizationService.
   */
  private async loadAccessibleOrganizations(userId: string): Promise<string[]> {
    return this.authzService.getAccessibleOrganizations(userId);
  }

  /**
   * Validate that the user has access to a test run via organization membership.
   * Returns true if access is allowed, false otherwise.
   * For admin users, always returns true (bypass filtering).
   * For non-admin users with no organization memberships, returns false.
   */
  private async validateTestRunAccess(
    testRunId: string,
    isAdmin: boolean,
    organizationIds: string[],
  ): Promise<boolean> {
    // Admins bypass all filtering
    if (isAdmin) {
      return true;
    }

    // Non-admin users with no organization memberships have no access
    if (organizationIds.length === 0) {
      return false;
    }

    // Check if the test run belongs to one of the user's organizations
    // LEFT JOIN teams because team_id can be NULL (system not assigned to a team)
    const query = `
      SELECT 1
      FROM test_runs tr
      INNER JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
      LEFT JOIN teams team ON team.id = sut.team_id
      WHERE tr.test_run_id = $1
        AND sut.organization_id = ANY($2::uuid[])
      LIMIT 1
    `;

    const result = await this.testRunRepo.query(query, [testRunId, organizationIds]);
    return result && result.length > 0;
  }

  /**
   * Helper method to map TypeORM entity to legacy interface
   */
  private mapEntityToDatabase(entity: DsAdaptTrackedResults): DatabaseTrackedRegression {
    return {
      id: entity.id,
      test_run_id: entity.test_run_id,
      control_group_id: entity.control_group_id,
      tracked_test_run_id: entity.tracked_test_run_id,
      tracked_difference_id: entity.tracked_difference_id,
      application_dashboard_id: entity.application_dashboard_id,
      metrics_source_id: entity.metrics_source_id,
      panel_id: entity.panel_id.toString(),
      metric_name: entity.metric_name,
      dashboard_uid: entity.dashboard_uid,
      dashboard_label: entity.dashboard_label,
      panel_title: entity.panel_title,
      unit: entity.unit,
      benchmark_ids: entity.benchmark_ids,
      test_run_start: entity.test_run_start.toISOString(),
      updated_at: entity.updated_at.toISOString(),
      mean: entity.mean,
      median: entity.median,
      min_value: entity.min_value,
      max_value: entity.max_value,
      std_dev: entity.std_dev,
      q95: entity.q95,
      compare_config: entity.compare_config,
      metric_classification: entity.metric_classification,
      thresholds: entity.thresholds,
      checks: entity.checks,
      conclusion: entity.conclusion,
      tracked_conclusion: entity.tracked_conclusion
    };
  }

  private computeStatus(conclusion?: any, trackedConclusion?: any): TrackedRegressionStatus {
    if (!conclusion || !trackedConclusion) return TrackedRegressionStatus.UNRESOLVED;

    // Check if regression has been resolved (any resolution value)
    if (trackedConclusion?.resolved === true) {
      const resolution = trackedConclusion?.resolution?.toLowerCase();
      if (resolution === 'accepted') return TrackedRegressionStatus.ACCEPTED;
      if (resolution === 'denied') return TrackedRegressionStatus.DENIED;
      // Any other resolved state (e.g. 'regression') is treated as accepted
      return TrackedRegressionStatus.ACCEPTED;
    }

    return TrackedRegressionStatus.UNRESOLVED;
  }

  private computePercentageChange(mean?: any): number {
    if (!mean || typeof mean !== 'object') return 0;

    if (mean.pctDiff !== undefined) {
      return Math.abs(Number(mean.pctDiff) || 0);
    }

    if (mean.test && mean.control) {
      const test = Number(mean.test) || 0;
      const control = Number(mean.control) || 0;
      if (control !== 0) {
        return Math.abs(((test - control) / control) * 100);
      }
    }

    return 0;
  }

  private computeSeverity(percentageChange: number, conclusion?: any): string {
    const confidence = Number(conclusion?.confidence || 0);

    if (percentageChange >= 50 || confidence >= 0.95) return 'high';
    if (percentageChange >= 20 || confidence >= 0.8) return 'medium';
    return 'low';
  }

  private mapDatabaseToDto(dbResult: DatabaseTrackedRegression): TrackedRegressionDto {
    const percentageChange = this.computePercentageChange(dbResult.mean);
    const status = this.computeStatus(dbResult.conclusion, dbResult.tracked_conclusion);
    const severity = this.computeSeverity(percentageChange, dbResult.conclusion);

    return {
      id: dbResult.id,
      testRunId: dbResult.test_run_id,
      controlGroupId: dbResult.control_group_id,
      trackedTestRunId: dbResult.tracked_test_run_id,
      trackedDifferenceId: dbResult.tracked_difference_id,
      applicationDashboardId: dbResult.application_dashboard_id,
      metricsSourceId: dbResult.metrics_source_id,
      panelId: dbResult.panel_id,
      metricName: dbResult.metric_name,
      dashboardUid: dbResult.dashboard_uid,
      dashboardLabel: dbResult.dashboard_label,
      panelTitle: dbResult.panel_title,
      unit: dbResult.unit,
      benchmarkIds: dbResult.benchmark_ids,
      testRunStart: new Date(dbResult.test_run_start),
      updatedAt: new Date(dbResult.updated_at),
      mean: dbResult.mean,
      median: dbResult.median,
      minValue: dbResult.min_value,
      maxValue: dbResult.max_value,
      stdDev: dbResult.std_dev,
      q95: dbResult.q95,
      compareConfig: dbResult.compare_config,
      metricClassification: dbResult.metric_classification,
      thresholds: dbResult.thresholds,
      checks: dbResult.checks,
      conclusion: dbResult.conclusion,
      trackedConclusion: dbResult.tracked_conclusion,
      // Computed fields
      status,
      percentageChange,
      severity,
      testRunsAffected: 1, // Will be computed in future iterations
      trackedTestRuns: [dbResult.tracked_test_run_id] // Will be computed in future iterations
    };
  }

  async getTrackedRegressions(
    testRunId: string,
    system?: string,
    environment?: string,
    workload?: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<TrackedRegressionsResponseDto> {
    const isAdmin = this.isGlobalAdmin(roles);
    const organizationIds = isAdmin ? [] : await this.loadAccessibleOrganizations(userId);
    this.logger.log(`Getting tracked regressions for test run: ${testRunId}${isAdmin ? ' (admin)' : ` (orgs: ${organizationIds.length})`}`, { system, environment, workload });

    // Non-admin users with no organization memberships see empty results
    if (!isAdmin && organizationIds.length === 0) {
      return {
        regressions: [],
        unresolvedCount: 0,
        totalTracked: 0,
      };
    }

    // Validate organization access for non-admin users
    const hasAccess = await this.validateTestRunAccess(testRunId, isAdmin, organizationIds);
    if (!hasAccess) {
      return {
        regressions: [],
        unresolvedCount: 0,
        totalTracked: 0,
      };
    }

    // First get the conclusion to find which specific tracked regressions to show
    const conclusion = await this.getDsAdaptConclusionInternal(testRunId);

    if (!conclusion || !conclusion.tracked_regressions || conclusion.tracked_regressions.length === 0) {
      return {
        regressions: [],
        unresolvedCount: 0,
        totalTracked: 0,
      };
    }

    // Filter tracked regressions to only show those referenced in the conclusion
    const regressions = await this.trackedResultsRepo.find({
      where: {
        id: In(conclusion.tracked_regressions)
      },
      order: {
        test_run_start: 'DESC'
      }
    });

    // Fetch test run metadata for each tracked regression
    const trackedRegessions = await Promise.all(
      regressions.map(async (entity) => {
        const dbResult = this.mapEntityToDatabase(entity);
        const dto = this.mapDatabaseToDto(dbResult);

        // Try to fetch test run metadata
        try {
          const testRunData = await this.testRunRepo.findOne({
            where: { testRunId: dbResult.tracked_test_run_id }
          });

          // Add test run metadata if found
          if (testRunData) {
            // Handle annotations which may be an array
            const annotations = Array.isArray(testRunData.annotations)
              ? testRunData.annotations.join('\n')
              : testRunData.annotations;

            return {
              ...dto,
              // Use the actual test run start time instead of the tracked regression start time
              testRunStart: testRunData.startTime ? new Date(testRunData.startTime) : dto.testRunStart,
              version: testRunData.applicationRelease || undefined,
              annotations: annotations || undefined,
              systemUnderTest: testRunData.systemUnderTestId || undefined,
              environment: testRunData.testEnvironment || undefined,
              workload: testRunData.workload || undefined,
            };
          }
        } catch (error) {
          this.logger.error(`Error fetching test run metadata for ${dbResult.tracked_test_run_id}:`, error);
        }

        // Return dto with undefined metadata fields if test run not found
        return {
          ...dto,
          version: undefined,
          annotations: undefined,
          systemUnderTest: undefined,
          environment: undefined,
          workload: undefined,
        };
      })
    );
    const unresolvedCount = trackedRegessions.filter(r => r.status === TrackedRegressionStatus.UNRESOLVED).length;

    return {
      regressions: trackedRegessions,
      unresolvedCount,
      totalTracked: trackedRegessions.length,
    };
  }

  async getTrackedRegressionsCount(
    testRunId: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<TrackedRegressionsCountDto> {
    const isAdmin = this.isGlobalAdmin(roles);
    const organizationIds = isAdmin ? [] : await this.loadAccessibleOrganizations(userId);
    this.logger.log(`Getting tracked regressions count for test run: ${testRunId}${isAdmin ? ' (admin)' : ` (orgs: ${organizationIds.length})`}`);

    try {
      // Non-admin users with no organization memberships see zero count
      if (!isAdmin && organizationIds.length === 0) {
        return { count: 0 };
      }

      // Validate organization access for non-admin users
      const hasAccess = await this.validateTestRunAccess(testRunId, isAdmin, organizationIds);
      if (!hasAccess) {
        return { count: 0 };
      }

      const count = await this.trackedResultsRepo.count({
        where: { test_run_id: testRunId }
      });

      return { count };
    } catch (error) {
      this.logger.error(`Error getting tracked regressions count for ${testRunId}:`, error);
      return { count: 0 };
    }
  }

  async resolveTrackedRegressionsByTestRun(
    trackedTestRunId: string,
    resolution: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<{ success: boolean; message: string; resolvedCount: number }> {
    const isAdmin = this.isGlobalAdmin(roles);
    const organizationIds = isAdmin ? [] : await this.loadAccessibleOrganizations(userId);
    this.logger.log(`Resolving tracked regressions for test run: ${trackedTestRunId} as ${resolution}${isAdmin ? ' (admin)' : ` (orgs: ${organizationIds.length})`}`);

    try {
      // Non-admin users with no organization memberships cannot resolve regressions
      if (!isAdmin && organizationIds.length === 0) {
        return {
          success: false,
          message: `No tracked regressions found for test run ${trackedTestRunId}`,
          resolvedCount: 0,
        };
      }

      // Validate organization access for non-admin users
      const hasAccess = await this.validateTestRunAccess(trackedTestRunId, isAdmin, organizationIds);
      if (!hasAccess) {
        return {
          success: false,
          message: `No tracked regressions found for test run ${trackedTestRunId}`,
          resolvedCount: 0,
        };
      }

      // Get all tracked regressions for this tracked_test_run_id
      const trackedRegressions = await this.trackedResultsRepo.find({
        where: { tracked_test_run_id: trackedTestRunId }
      });

      if (!trackedRegressions || trackedRegressions.length === 0) {
        return {
          success: false,
          message: `No tracked regressions found for test run ${trackedTestRunId}`,
          resolvedCount: 0,
        };
      }

      let resolvedCount = 0;

      // Update all tracked regressions for this test run
      for (const regression of trackedRegressions) {
        const updatedTrackedConclusion = {
          ...regression.tracked_conclusion,
          resolved: true,
          resolution: resolution,
          resolvedAt: new Date().toISOString(),
          excludeFromBaseline: resolution === 'regression',
        };

        await this.trackedResultsRepo.update(
          { id: regression.id },
          {
            tracked_conclusion: updatedTrackedConclusion as any,
            updated_at: new Date()
          }
        );

        resolvedCount++;
      }

      return {
        success: true,
        message: `Successfully resolved ${resolvedCount} tracked regressions for test run ${trackedTestRunId} as ${resolution}`,
        resolvedCount,
      };
    } catch (error) {
      this.logger.error(`Error resolving tracked regressions by test run ${trackedTestRunId}:`, error);
      return {
        success: false,
        message: `Failed to resolve tracked regressions for test run ${trackedTestRunId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        resolvedCount: 0,
      };
    }
  }

  async resolveTrackedRegression(
    regressionId: string,
    resolution: ResolveTrackedRegressionDto,
    userId: string = '',
    roles: string[] = [],
  ): Promise<{ success: boolean; message: string }> {
    const isAdmin = this.isGlobalAdmin(roles);
    const organizationIds = isAdmin ? [] : await this.loadAccessibleOrganizations(userId);
    this.logger.log(`Resolving tracked regression: ${regressionId} as ${resolution.resolution}${isAdmin ? ' (admin)' : ` (orgs: ${organizationIds.length})`}`);

    try {
      // Non-admin users with no organization memberships cannot resolve regressions
      if (!isAdmin && organizationIds.length === 0) {
        return {
          success: false,
          message: `Regression ${regressionId} not found`,
        };
      }

      // First, get the current tracked regression to preserve existing data
      const regression = await this.trackedResultsRepo.findOne({
        where: { id: regressionId }
      });

      if (!regression) {
        return {
          success: false,
          message: `Regression ${regressionId} not found`,
        };
      }

      // Validate organization access based on the regression's test_run_id
      const hasAccess = await this.validateTestRunAccess(regression.test_run_id, isAdmin, organizationIds);
      if (!hasAccess) {
        return {
          success: false,
          message: `Regression ${regressionId} not found`,
        };
      }

      // Update the tracked_conclusion to mark as resolved
      const updatedTrackedConclusion = {
        ...regression.tracked_conclusion,
        resolved: true,
        resolution: resolution.resolution,
        resolvedAt: new Date().toISOString(),
        excludeFromBaseline: resolution.excludeFromBaseline,
        comment: resolution.comment
      };

      await this.trackedResultsRepo.update(
        { id: regressionId },
        {
          tracked_conclusion: updatedTrackedConclusion as any,
          updated_at: new Date()
        }
      );

      return {
        success: true,
        message: `Regression ${regressionId} marked as ${resolution.resolution}`,
      };
    } catch (error) {
      this.logger.error(`Error resolving tracked regression ${regressionId}:`, error);
      return {
        success: false,
        message: `Failed to resolve regression ${regressionId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  async getTrackedDifferencesChart(
    metricName: string,
    testRunId: string,
    limit: number = 50,
    userId: string = '',
    roles: string[] = [],
  ): Promise<any[]> {
    const isAdmin = this.isGlobalAdmin(roles);
    const organizationIds = isAdmin ? [] : await this.loadAccessibleOrganizations(userId);
    this.logger.log(`Getting tracked differences chart for metric: ${metricName}, testRunId: ${testRunId}, limit: ${limit}${isAdmin ? ' (admin)' : ` (orgs: ${organizationIds.length})`}`);

    try {
      // Non-admin users with no organization memberships see empty results
      if (!isAdmin && organizationIds.length === 0) {
        return [];
      }

      // Validate organization access for non-admin users
      const hasAccess = await this.validateTestRunAccess(testRunId, isAdmin, organizationIds);
      if (!hasAccess) {
        return [];
      }

      // Get tracked differences for the specific metric, including related test runs
      const trackedData = await this.trackedResultsRepo.find({
        where: { metric_name: metricName },
        order: { test_run_start: 'DESC' },
        take: limit
      });

      // Transform the data for chart consumption
      const chartData = trackedData.map((item) => {
        const meanValue = this.extractMeanValue(item.mean);
        const isRegression = item.conclusion?.label?.toLowerCase() === 'regression';
        const thresholds = item.thresholds || {};

        return {
          testRunId: item.test_run_id,
          date: item.test_run_start,
          value: meanValue,
          controlGroup: item.control_group_id === item.test_run_id, // Simplified logic
          selectedTestRun: item.test_run_id === testRunId,
          regression: isRegression,
          thresholds: {
            upper: thresholds.upper || meanValue * 1.1,
            lower: thresholds.lower || meanValue * 0.9,
          },
        };
      });

      return chartData;
    } catch (error) {
      this.logger.error(`Error getting tracked differences chart for metric ${metricName}:`, error);
      // Return empty array on error to prevent frontend crashes
      return [];
    }
  }

  private extractMeanValue(mean?: any): number {
    if (!mean) return 0;

    if (typeof mean === 'number') return mean;
    if (mean.test !== undefined) return Number(mean.test) || 0;
    if (mean.value !== undefined) return Number(mean.value) || 0;

    return 0;
  }

  async getCorrelatedRegressions(
    trackedRegressionId: string,
    sourceTestRunId: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<TrackedRegressionDto[]> {
    const isAdmin = this.isGlobalAdmin(roles);
    const organizationIds = isAdmin ? [] : await this.loadAccessibleOrganizations(userId);
    this.logger.log(`Getting correlated regressions for: ${trackedRegressionId} from test run: ${sourceTestRunId}${isAdmin ? ' (admin)' : ` (orgs: ${organizationIds.length})`}`);

    try {
      // Non-admin users with no organization memberships see empty results
      if (!isAdmin && organizationIds.length === 0) {
        return [];
      }

      // Validate organization access for non-admin users
      const hasAccess = await this.validateTestRunAccess(sourceTestRunId, isAdmin, organizationIds);
      if (!hasAccess) {
        return [];
      }

      // First get the main regression to understand the timeframe and context
      const regression = await this.trackedResultsRepo.findOne({
        where: { id: trackedRegressionId }
      });

      if (!regression) {
        return [];
      }

      // Calculate time window (7 days before and after)
      const startDate = new Date(new Date(regression.test_run_start).getTime() - 7 * 24 * 60 * 60 * 1000);
      const endDate = new Date(new Date(regression.test_run_start).getTime() + 7 * 24 * 60 * 60 * 1000);

      // Find correlated regressions: other regressions that occurred around the same time
      // or are related to the same control group/dashboard
      const correlatedData = await this.trackedResultsRepo
        .createQueryBuilder('tr')
        .where('tr.id != :regressionId', { regressionId: trackedRegressionId })
        .andWhere(
          '(tr.control_group_id = :controlGroupId OR tr.application_dashboard_id = :dashboardId)',
          {
            controlGroupId: regression.control_group_id,
            dashboardId: regression.application_dashboard_id
          }
        )
        .andWhere('tr.test_run_start >= :startDate', { startDate })
        .andWhere('tr.test_run_start <= :endDate', { endDate })
        .orderBy('tr.test_run_start', 'DESC')
        .take(10)
        .getMany();

      return correlatedData.map(entity => this.mapDatabaseToDto(this.mapEntityToDatabase(entity)));
    } catch (error) {
      this.logger.error(`Error getting correlated regressions for ${trackedRegressionId}:`, error);
      return [];
    }
  }

  /**
   * Internal method to get DsAdaptConclusion without organization filtering.
   * Used by other methods in this service after they've already validated access.
   */
  private async getDsAdaptConclusionInternal(testRunId: string): Promise<any> {
    try {
      const conclusion = await this.conclusionRepo.findOne({
        where: { test_run_id: testRunId }
      });

      if (!conclusion) {
        return null;
      }

      return conclusion;
    } catch (error) {
      this.logger.error(`Error fetching ds_adapt_conclusion for ${testRunId}:`, error);
      // Return null if not found or error occurs
      return null;
    }
  }

  /**
   * Public method to get DsAdaptConclusion with organization filtering.
   */
  async getDsAdaptConclusion(
    testRunId: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<any> {
    const isAdmin = this.isGlobalAdmin(roles);
    const organizationIds = isAdmin ? [] : await this.loadAccessibleOrganizations(userId);

    try {
      // Non-admin users with no organization memberships see null
      if (!isAdmin && organizationIds.length === 0) {
        return null;
      }

      // Validate organization access for non-admin users
      const hasAccess = await this.validateTestRunAccess(testRunId, isAdmin, organizationIds);
      if (!hasAccess) {
        return null;
      }

      return this.getDsAdaptConclusionInternal(testRunId);
    } catch (error) {
      this.logger.error(`Error fetching ds_adapt_conclusion for ${testRunId}:`, error);
      // Return null if not found or error occurs
      return null;
    }
  }

  /**
   * Get enriched adapt conclusion with resolved regression details.
   * Replaces raw UUID arrays with metric names, values, and change percentages.
   */
  async getEnrichedConclusion(
    testRunId: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<any> {
    const isAdmin = this.isGlobalAdmin(roles);
    const organizationIds = isAdmin ? [] : await this.loadAccessibleOrganizations(userId);

    try {
      if (!isAdmin && organizationIds.length === 0) {
        return null;
      }

      const hasAccess = await this.validateTestRunAccess(testRunId, isAdmin, organizationIds);
      if (!hasAccess) {
        return null;
      }

      const conclusion = await this.getDsAdaptConclusionInternal(testRunId);
      if (!conclusion) {
        return null;
      }

      // Resolve regression/improvement/difference UUIDs to enriched summaries
      const [regressions, improvements, differences] = await Promise.all([
        this.resolveAdaptResults(conclusion.regressions),
        this.resolveAdaptResults(conclusion.improvements),
        this.resolveAdaptResults(conclusion.differences),
      ]);

      return {
        test_run_id: conclusion.test_run_id,
        conclusion: conclusion.conclusion,
        control_group_id: conclusion.control_group_id,
        updated_at: conclusion.updated_at,
        regressions,
        improvements,
        differences,
      };
    } catch (error) {
      this.logger.error(`Error fetching enriched conclusion for ${testRunId}:`, error);
      return null;
    }
  }

  /**
   * Resolve an array of ds_adapt_results UUIDs into enriched summaries.
   */
  private async resolveAdaptResults(ids?: string[]): Promise<any[]> {
    if (!ids || ids.length === 0) {
      return [];
    }

    const results = await this.adaptResultsRepo.find({
      where: { id: In(ids) },
      select: [
        'id', 'metric_name', 'dashboard_label', 'panel_title',
        'unit', 'mean', 'statistic', 'conclusion',
      ],
    });

    return results.map((r) => ({
      metric_name: r.metric_name,
      dashboard: r.dashboard_label,
      panel: r.panel_title,
      unit: r.unit,
      current: r.mean?.test ?? null,
      baseline: r.mean?.control ?? null,
      change_pct: r.mean?.pctDiff != null
        ? Math.round(r.mean.pctDiff * 1000) / 10
        : null,
      absolute_change: r.mean?.absDiff ?? null,
      conclusion: r.conclusion?.label ?? null,
    }));
  }
}