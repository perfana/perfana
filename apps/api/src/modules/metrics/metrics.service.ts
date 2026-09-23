import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, FindManyOptions, EntityManager } from 'typeorm';
import {
  DsMetrics,
  DsMetricStatistics,
  DsControlGroups,
  DsChangePoints,
  DsAdaptResults,
  TestRun as TestRunEntity,
  ApplicationDashboard,
} from '../../entities';
import { withRequestEm } from '../../common/db/request-em';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';
import type { OwnedResource } from '@perfana/shared';

export interface MetricDataPoint {
  time: Date;
  metric_name?: string;
  value?: number;
  timestep?: number;
  ramp_up?: boolean;
}

export interface MetricStatisticResult {
  test_run_id: string;
  panel_title: string;
  metric_name: string;
  value?: number | null;
  created_at: Date | string;
  version: string | null;
  annotations: string | null;
  is_changepoint: boolean;
  consolidated_result: unknown | null;
  metrics_source_id?: string | null;
  statistics?: Record<string, number | null>;
}

export interface ControlGroupTrendResult {
  test_run_id: string;
  test_run_start: Date | string;
  dashboard_label: string;
  panel_title: string;
  metric_name: string;
  unit: string;
  mean: number;
  value: number;
  thresholds: {
    lower: { overall: number | null };
    upper: { overall: number | null };
  };
  conclusion_label: string;
  version: string | null;
  annotations: string | null;
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  constructor(
    @InjectRepository(DsMetrics)
    private metricsRepo: Repository<DsMetrics>,
    @InjectRepository(DsMetricStatistics)
    private metricStatisticsRepo: Repository<DsMetricStatistics>,
    @InjectRepository(DsControlGroups)
    private controlGroupsRepo: Repository<DsControlGroups>,
    @InjectRepository(DsChangePoints)
    private changePointsRepo: Repository<DsChangePoints>,
    @InjectRepository(DsAdaptResults)
    private adaptResultsRepo: Repository<DsAdaptResults>,
    @InjectRepository(TestRunEntity)
    private testRunRepo: Repository<TestRunEntity>,
    @InjectRepository(ApplicationDashboard)
    private applicationDashboardRepo: Repository<ApplicationDashboard>,
    private readonly authzService: AuthorizationService,
  ) {}

  /**
   * Resolve an applicationDashboardId from a metricsSourceId by looking up the
   * application_dashboards table.  Returns undefined when no match is found.
   */
  private async resolveApplicationDashboardId(metricsSourceId: string): Promise<string | undefined> {
    const row = await withRequestEm(this.applicationDashboardRepo).findOne({
      where: { metricsSourceId },
      select: ['id'],
    });
    return row?.id;
  }

  /**
   * Access check for a resource identified by an application dashboard rather than a run.
   * The dashboard is the owned resource here — `ds_metrics` and `ds_metric_statistics`
   * carry no RLS policy, so this is the only control on that data.
   */
  private async validateDashboardAccess(
    applicationDashboardId: string,
    userId: string,
    roles: string[],
  ): Promise<boolean> {
    if (!applicationDashboardId) return false;
    const row = await withRequestEm(this.applicationDashboardRepo).findOne({
      where: { id: applicationDashboardId },
      select: ['id', 'organizationId', 'teamId', 'createdBy'],
    });
    // Fail closed: an unknown id is a refusal, not a skip.
    if (!row) return false;

    const accessResult = await this.authzService.canAccessResource(userId, roles, {
      organization_id: row.organizationId,
      team_id: row.teamId,
      created_by: row.createdBy ?? '',
    } as OwnedResource);
    return accessResult.allowed;
  }

  private async validateTestRunAccess(
    testRunId: string,
    userId: string,
    roles: string[],
  ): Promise<boolean> {
    const result = await withRequestEm(this.testRunRepo).query(
      `SELECT sut.organization_id, sut.created_by
       FROM test_runs tr
       INNER JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
       WHERE tr.test_run_id = $1 LIMIT 1`,
      [testRunId],
    );
    if (!result || result.length === 0) return false;

    const accessResult = await this.authzService.canAccessResource(userId, roles, {
      organization_id: result[0].organization_id,
      created_by: result[0].created_by ?? '',
    } as OwnedResource);
    return accessResult.allowed;
  }

  async findDSMetricsForPanel(testRunId: string, panelId: number, applicationDashboardId?: string, metricName?: string, userId: string = '', roles: string[] = [], metricsSourceId?: string): Promise<MetricDataPoint[] | null> {
    try {
      // Validate test run access
      const hasAccess = await this.validateTestRunAccess(testRunId, userId, roles);
      if (!hasAccess) {
        return null;
      }

      // If metricsSourceId is provided, we can filter directly on ds_metrics.metrics_source_id
      // But we still need an applicationDashboardId for the fallback path
      let finalApplicationDashboardId = applicationDashboardId;
      if (!finalApplicationDashboardId && metricsSourceId) {
        finalApplicationDashboardId = await this.resolveApplicationDashboardId(metricsSourceId);
      }

      if (!finalApplicationDashboardId) {
        const firstDashboard = await this.metricsRepo.findOne({
          where: {
            test_run_id: testRunId,
            panel_id: panelId
          },
          select: ['application_dashboard_id']
        });

        if (firstDashboard) {
          finalApplicationDashboardId = firstDashboard.application_dashboard_id;
        }
      }

      // Check if downsampling is needed using an efficient existence check
      // that stops scanning after maxDataPoints+1 rows instead of counting millions
      const maxDataPoints = 4000;

      const conditions = [`test_run_id = $1`, `panel_id = $2`];
      const countParams: (string | number)[] = [testRunId, panelId];
      let countParamIdx = 3;

      // Prefer metricsSourceId over applicationDashboardId for filtering ds_metrics
      if (metricsSourceId) {
        conditions.push(`metrics_source_id = $${countParamIdx}`);
        countParams.push(metricsSourceId);
        countParamIdx++;
      } else if (finalApplicationDashboardId) {
        conditions.push(`application_dashboard_id = $${countParamIdx}`);
        countParams.push(finalApplicationDashboardId);
        countParamIdx++;
      }
      if (metricName) {
        conditions.push(`metric_name = $${countParamIdx}`);
        countParams.push(metricName);
      }

      const whereClause = conditions.join(' AND ');
      const [{ needs_downsampling }] = await this.metricsRepo.query(
        `SELECT EXISTS (
          SELECT 1 FROM (
            SELECT 1 FROM ds_metrics WHERE ${whereClause} LIMIT ${maxDataPoints + 1} OFFSET ${maxDataPoints}
          ) sub
        ) as needs_downsampling`,
        countParams,
      );

      // If data points exceed threshold, use LTTB downsampling via TimescaleDB toolkit
      if (needs_downsampling) {
        const downsampledResults = await this.executeLTTBQuery(
          testRunId, panelId, finalApplicationDashboardId, metricName, maxDataPoints, metricsSourceId,
        );

        if (!downsampledResults || downsampledResults.length === 0) {
          return null;
        }

        return downsampledResults;
      } else {
        // Use regular query for smaller datasets
        return this.executeRegularQuery(testRunId, panelId, finalApplicationDashboardId, metricName, metricsSourceId);
      }

    } catch (error) {
      this.logger.error('Error fetching ds_metrics from TimescaleDB:', error);
      return null;
    }
  }

  private async executeRegularQuery(testRunId: string, panelId: number, applicationDashboardId?: string, metricName?: string, metricsSourceId?: string): Promise<MetricDataPoint[] | null> {
    try {
      const where: Record<string, string | number> = {
        test_run_id: testRunId,
        panel_id: panelId,
      };

      // Prefer metricsSourceId over applicationDashboardId
      if (metricsSourceId) {
        where.metrics_source_id = metricsSourceId;
      } else if (applicationDashboardId) {
        where.application_dashboard_id = applicationDashboardId;
      }

      if (metricName) {
        where.metric_name = metricName;
      }

      const options: FindManyOptions<DsMetrics> = {
        where,
        order: { timestep: 'ASC' },
        select: ['time', 'metric_name', 'value', 'timestep', 'ramp_up'],
      };

      const data = await this.metricsRepo.find(options);

      if (data && data.length > 0) {
        return data.map(m => ({
          time: m.time,
          metric_name: m.metric_name,
          value: m.value,
          timestep: m.timestep,
          ramp_up: m.ramp_up
        }));
      }

      return null;
    } catch (error) {
      this.logger.error('Regular query error:', error);
      throw error;
    }
  }

  /**
   * Downsample metrics using TimescaleDB toolkit's LTTB (Largest Triangle Three Buckets)
   * algorithm, which preserves visual peaks and valleys better than simple nth-point sampling.
   */
  private async executeLTTBQuery(
    testRunId: string,
    panelId: number,
    applicationDashboardId?: string,
    metricName?: string,
    maxDataPoints = 4000,
    metricsSourceId?: string,
  ): Promise<MetricDataPoint[] | null> {
    try {
      // First count distinct metrics to distribute the resolution budget
      const metricCountConditions = [
        `test_run_id = $1`,
        `panel_id = $2`,
      ];
      const params: (string | number)[] = [testRunId, panelId];
      let paramIdx = 3;

      // Prefer metricsSourceId over applicationDashboardId
      if (metricsSourceId) {
        metricCountConditions.push(`metrics_source_id = $${paramIdx}`);
        params.push(metricsSourceId);
        paramIdx++;
      } else if (applicationDashboardId) {
        metricCountConditions.push(`application_dashboard_id = $${paramIdx}`);
        params.push(applicationDashboardId);
        paramIdx++;
      }
      if (metricName) {
        metricCountConditions.push(`metric_name = $${paramIdx}`);
        params.push(metricName);
        paramIdx++;
      }

      const whereClause = metricCountConditions.join(' AND ');

      const [{ count: metricCount }] = await this.metricsRepo.query(
        `SELECT COUNT(DISTINCT metric_name)::int AS count FROM ds_metrics WHERE ${whereClause}`,
        params,
      );

      const resolutionPerMetric = Math.max(
        10,
        Math.floor(maxDataPoints / Math.max(1, metricCount)),
      );

      // Use lttb() to downsample each metric independently via GROUP BY
      const lttbQuery = `
        SELECT
          sub.metric_name,
          (sub.dp).time AS time,
          (sub.dp).value AS value
        FROM (
          SELECT
            metric_name,
            unnest(lttb("time", value, ${resolutionPerMetric})) AS dp
          FROM ds_metrics
          WHERE ${whereClause}
          GROUP BY metric_name
        ) sub
        ORDER BY sub.metric_name, (sub.dp).time
      `;

      const rows: { metric_name: string; time: Date; value: number }[] =
        await this.metricsRepo.query(lttbQuery, params);

      if (!rows || rows.length === 0) {
        return null;
      }

      return rows.map((row) => ({
        time: row.time,
        metric_name: row.metric_name,
        value: row.value,
      }));
    } catch (error) {
      this.logger.warn(
        `LTTB query failed, falling back to regular query: ${(error as Error).message}`,
      );
      // Fallback to regular query if lttb() is unavailable
      return this.executeRegularQuery(
        testRunId, panelId, applicationDashboardId, metricName, metricsSourceId,
      );
    }
  }

  async findDSMetricStatisticsMultiple(
    applicationDashboardId: string,
    panelId: number,
    evaluateTypes: string[],
    from?: string,
    to?: string,
    system?: string,
    environment?: string,
    workload?: string,
    userId: string = '',
    roles: string[] = [],
    metricsSourceId?: string,
  ): Promise<MetricStatisticResult[]> {
    try {
      const orgIds = await withOrgFilter(userId, roles, this.authzService);

      // First, get test_run_ids that match the criteria from test_runs table
      const queryBuilder = withRequestEm(this.testRunRepo)
        .createQueryBuilder('testRun')
        .leftJoinAndSelect('testRun.systemUnderTest', 'sut')
        .select([
          'testRun.id',
          'testRun.testRunId',
          'testRun.systemUnderTestId',
          'testRun.testEnvironment',
          'testRun.workload',
          'testRun.startTime',
          'testRun.applicationRelease',
          'testRun.annotations',
          'testRun.consolidatedResult',
          'sut.name'
        ]);

      // Add organization filtering for non-admin users (orgIds === null means admin)
      if (orgIds !== null) {
        if (orgIds.length === 0) {
          return [];
        }
        queryBuilder.andWhere('sut.organization_id IN (:...orgIds)', { orgIds });
      }

      // Add system/environment/workload filtering
      if (system) {
        queryBuilder.andWhere('sut.name = :system', { system });
      }
      if (environment) {
        queryBuilder.andWhere('testRun.testEnvironment = :environment', { environment });
      }
      if (workload) {
        queryBuilder.andWhere('testRun.workload = :workload', { workload });
      }

      // Add time range filtering if provided
      if (from) {
        queryBuilder.andWhere('testRun.startTime >= :from', { from });
      }
      if (to) {
        queryBuilder.andWhere('testRun.startTime <= :to', { to });
      }

      const testRuns = await queryBuilder
        .orderBy('testRun.startTime', 'ASC')
        .getMany();

      if (!testRuns || testRuns.length === 0) {
        return [];
      }

      // Extract test run IDs (string identifiers, not UUIDs) for the statistics query
      const testRunIds = testRuns.map(tr => tr.testRunId);

      // Query ds_metric_statistics for all requested evaluate types
      // Prefer metricsSourceId over applicationDashboardId for filtering
      const statisticsWhere: Record<string, unknown> = {
        panel_id: panelId,
        test_run_id: In(testRunIds),
      };
      if (metricsSourceId) {
        statisticsWhere.metrics_source_id = metricsSourceId;
      } else {
        statisticsWhere.application_dashboard_id = applicationDashboardId;
      }

      const statistics = await this.metricStatisticsRepo.find({
        where: statisticsWhere,
        select: [
          'test_run_id',
          'panel_id',
          'metric_name',
          'mean',
          'max_value',
          'min_value',
          'last_value',
          'trend_pct_per_hour',
          'count',
          'median',
          'percentiles',
          'metrics_source_id',
          'updated_at'
        ]
      });


      // Create a map of test_run_id (string) to test run data for easy lookup
      const testRunMap = new Map();
      testRuns.forEach(tr => {
        testRunMap.set(tr.testRunId, tr);
      });

      // Batch check changepoints for all test runs in a single query
      const changepointMap = await this.batchCheckChangepoints(testRunIds);

      // Transform the data to include all requested statistics for each metric
      const result: MetricStatisticResult[] = [];

      (statistics || []).forEach((record) => {
        const testRun = testRunMap.get(record.test_run_id);

        // Create one record per metric with all statistics
        const baseRecord: MetricStatisticResult = {
          test_run_id: record.test_run_id,
          panel_title: `Panel ${panelId}`,
          metric_name: record.metric_name || 'Unknown Metric',
          created_at: testRun?.startTime || record.updated_at,
          version: testRun?.applicationRelease || null,
          annotations: Array.isArray(testRun?.annotations)
            ? testRun.annotations.join(', ')
            : testRun?.annotations || null,
          is_changepoint: changepointMap.get(record.test_run_id) || false,
          consolidated_result: testRun?.consolidatedResult || null,
          metrics_source_id: record.metrics_source_id || null,
          statistics: {} as Record<string, number | null>
        };

        // Add all requested statistics
        evaluateTypes.forEach(evaluateType => {
          let value: number | null = null;

          switch (evaluateType) {
            case 'avg':
              value = record.mean ?? null;
              break;
            case 'max':
              value = record.max_value ?? null;
              break;
            case 'min':
              value = record.min_value ?? null;
              break;
            case 'last':
              value = record.last_value ?? null;
              break;
            case 'trend':
              value = record.trend_pct_per_hour ?? null;
              break;
            case 'count':
              value = record.count ?? null;
              break;
            case 'q50':
              value = record.median ?? null;
              break;
            case 'q90':
              value = (record.percentiles?.p90 as number | undefined) ?? null;
              break;
            case 'q95':
              value = (record.percentiles?.p95 as number | undefined) ?? null;
              break;
            case 'q99':
              value = (record.percentiles?.p99 as number | undefined) ?? null;
              break;
            default:
              value = null;
          }

          if (baseRecord.statistics) {
            baseRecord.statistics[evaluateType] = value;
          }
        });

        result.push(baseRecord);
      });

      return result;

    } catch (error) {
      this.logger.error('Error fetching ds_metric_statistics:', error);
      throw error;
    }
  }

  async findDSMetricStatistics(
    applicationDashboardId: string,
    panelId: number,
    evaluateType: string,
    from?: string,
    to?: string,
    system?: string,
    environment?: string,
    workload?: string,
    userId: string = '',
    roles: string[] = [],
    metricsSourceId?: string,
  ): Promise<MetricStatisticResult[]> {
    try {
      const orgIds = await withOrgFilter(userId, roles, this.authzService);

      // First, get test_run_ids that match the criteria from test_runs table
      const queryBuilder = withRequestEm(this.testRunRepo)
        .createQueryBuilder('testRun')
        .leftJoinAndSelect('testRun.systemUnderTest', 'sut')
        .select([
          'testRun.id',
          'testRun.testRunId',
          'testRun.systemUnderTestId',
          'testRun.testEnvironment',
          'testRun.workload',
          'testRun.startTime',
          'testRun.applicationRelease',
          'testRun.annotations',
          'testRun.consolidatedResult',
          'sut.name'
        ]);

      // Add organization filtering for non-admin users (orgIds === null means admin)
      if (orgIds !== null) {
        if (orgIds.length === 0) {
          return [];
        }
        queryBuilder.andWhere('sut.organization_id IN (:...orgIds)', { orgIds });
      }

      // Add system/environment/workload filtering
      if (system) {
        queryBuilder.andWhere('sut.name = :system', { system });
      }
      if (environment) {
        queryBuilder.andWhere('testRun.testEnvironment = :environment', { environment });
      }
      if (workload) {
        queryBuilder.andWhere('testRun.workload = :workload', { workload });
      }

      // Add time range filtering if provided
      if (from) {
        queryBuilder.andWhere('testRun.startTime >= :from', { from });
      }
      if (to) {
        queryBuilder.andWhere('testRun.startTime <= :to', { to });
      }

      const testRuns = await queryBuilder
        .orderBy('testRun.startTime', 'ASC')
        .getMany();

      if (!testRuns || testRuns.length === 0) {
        return [];
      }


      // Extract test run IDs (string identifiers, not UUIDs) for the statistics query
      const testRunIds = testRuns.map(tr => tr.testRunId);

      // Now query ds_metric_statistics using the test_run_ids
      const statisticColumn = this.getStatisticColumn(evaluateType);

      // For percentiles, we need to select the entire percentiles JSONB field
      // Otherwise, select the specific column
      const isPercentile = ['q90', 'q95', 'q99'].includes(evaluateType);
      const selectFields: (keyof DsMetricStatistics)[] = isPercentile
        ? ['test_run_id', 'panel_id', 'metric_name', 'percentiles', 'metrics_source_id', 'updated_at']
        : ['test_run_id', 'panel_id', 'metric_name', statisticColumn as keyof DsMetricStatistics, 'metrics_source_id', 'updated_at'];

      // Prefer metricsSourceId over applicationDashboardId for filtering
      const statisticsWhere: Record<string, unknown> = {
        panel_id: panelId,
        test_run_id: In(testRunIds),
      };
      if (metricsSourceId) {
        statisticsWhere.metrics_source_id = metricsSourceId;
      } else {
        statisticsWhere.application_dashboard_id = applicationDashboardId;
      }

      const statistics = await this.metricStatisticsRepo.find({
        where: statisticsWhere,
        select: selectFields
      } as FindManyOptions<DsMetricStatistics>);


      // Create a map of test_run_id (string) to test run data for easy lookup
      const testRunMap = new Map();
      testRuns.forEach(tr => {
        testRunMap.set(tr.testRunId, tr);
      });

      // Batch check changepoints for all test runs in a single query
      const changepointMap = await this.batchCheckChangepoints(testRunIds);

      // Transform the data for the frontend, using the actual metric_name from the database
      const transformedData: MetricStatisticResult[] = (statistics || []).map((record) => {
        const testRun = testRunMap.get(record.test_run_id);

        // Extract the value based on the evaluate type
        let value: number | null = null;
        if (evaluateType === 'q90' && record.percentiles) {
          value = (record.percentiles['p90'] as number | null) ?? null;
        } else if (evaluateType === 'q95' && record.percentiles) {
          value = (record.percentiles['p95'] as number | null) ?? null;
        } else if (evaluateType === 'q99' && record.percentiles) {
          value = (record.percentiles['p99'] as number | null) ?? null;
        } else {
          // For non-percentile columns, use the direct column value
          const recordData = record as unknown as Record<string, number | undefined | null>;
          value = recordData[statisticColumn] ?? null;
        }

        return {
          test_run_id: record.test_run_id,
          panel_title: `Panel ${panelId}`,
          metric_name: record.metric_name || 'Unknown Metric',  // Use metric_name from database
          value: value,
          created_at: testRun?.startTime || record.updated_at,
          version: testRun?.applicationRelease || null,
          annotations: Array.isArray(testRun?.annotations)
            ? testRun.annotations.join(', ')
            : testRun?.annotations || null,
          is_changepoint: changepointMap.get(record.test_run_id) || false,
          consolidated_result: testRun?.consolidatedResult || null,
          metrics_source_id: record.metrics_source_id || null,
        };
      });

      return transformedData;

    } catch (error) {
      this.logger.error('Error fetching ds_metric_statistics:', error);
      throw error;
    }
  }

  private getStatisticColumn(evaluateType: string): string {
    const statisticMapping: Record<string, string> = {
      'avg': 'mean',
      'max': 'max_value',
      'min': 'min_value',
      'last': 'last_value',
      'trend': 'trend_pct_per_hour',
      'count': 'count',
      'q50': 'median',
      // Note: q90, q95, q99 are handled separately in the query logic
      'q90': 'percentiles',
      'q95': 'percentiles',
      'q99': 'percentiles'
    };

    return statisticMapping[evaluateType] || 'mean';
  }

  async findControlGroupTrends(
    testRunId: string,
    applicationDashboardId: string,
    panelId: string,
    metricName: string,
    userId: string = '',
    roles: string[] = [],
    metricsSourceId?: string,
  ): Promise<ControlGroupTrendResult[]> {
    try {
      // Validate test run access
      const hasAccess = await this.validateTestRunAccess(testRunId, userId, roles);
      if (!hasAccess) {
        return [];
      }

      // Step 1: Get the control group test run IDs for the given test run
      const controlGroup = await this.controlGroupsRepo.findOne({
        where: { control_group_id: testRunId },
        select: ['test_runs']
      });

      if (!controlGroup || !controlGroup.test_runs) {
        this.logger.log(`No control group found for test run: ${testRunId}`);
        return [];
      }

      const controlGroupTestRuns = controlGroup.test_runs;

      if (controlGroupTestRuns.length === 0) {
        this.logger.log(`Empty control group for test run: ${testRunId}`);
        return [];
      }

      // Step 2: Get test run details for version and annotations enrichment (control group + current test run)
      const allTestRunIds = [...controlGroupTestRuns, testRunId];
      const testRuns = await withRequestEm(this.testRunRepo).find({
        where: {
          testRunId: In(allTestRunIds)
        },
        select: ['id', 'testRunId', 'startTime', 'applicationRelease', 'annotations']
      });

      // Create a map of test_run_id to test run data for enrichment
      const testRunMap = new Map();
      if (testRuns) {
        testRuns.forEach(tr => {
          testRunMap.set(tr.testRunId, tr);
        });
      }

      // Step 3: Query ds_adapt_results for control group test runs
      // Prefer metricsSourceId over applicationDashboardId for filtering
      const adaptWhere: Record<string, unknown> = {
        panel_id: parseInt(panelId),
        metric_name: metricName,
        test_run_id: In(controlGroupTestRuns),
      };
      if (metricsSourceId) {
        adaptWhere.metrics_source_id = metricsSourceId;
      } else {
        adaptWhere.application_dashboard_id = applicationDashboardId;
      }

      const adaptResults = await this.adaptResultsRepo.find({
        where: adaptWhere,
        select: [
          'test_run_id',
          'test_run_start',
          'dashboard_label',
          'panel_title',
          'metric_name',
          'unit',
          'statistic',
          'thresholds',
          'conclusion'
        ],
        order: { test_run_start: 'ASC' }
      });

      // Step 4: Also fetch the current test run data to add to the trends
      const currentAdaptWhere: Record<string, unknown> = {
        panel_id: parseInt(panelId),
        metric_name: metricName,
        test_run_id: testRunId,
      };
      if (metricsSourceId) {
        currentAdaptWhere.metrics_source_id = metricsSourceId;
      } else {
        currentAdaptWhere.application_dashboard_id = applicationDashboardId;
      }

      const currentTestRunResult = await this.adaptResultsRepo.findOne({
        where: currentAdaptWhere,
        select: [
          'test_run_id',
          'test_run_start',
          'dashboard_label',
          'panel_title',
          'metric_name',
          'unit',
          'statistic',
          'thresholds',
          'conclusion'
        ]
      });

      // Combine control group results with current test run
      const allResults = [...(adaptResults || [])];
      if (currentTestRunResult && !controlGroupTestRuns.includes(testRunId)) {
        allResults.push(currentTestRunResult);
      }

      if (allResults.length === 0) {
        this.logger.log(`No adapt results found for control group test runs: ${controlGroupTestRuns.join(', ')} or current test run: ${testRunId}`);
        return [];
      }

      // Step 6: Handle missing ds_adapt_results with fallback to ds_metric_statistics
      const missingTestRuns = allTestRunIds.filter(id =>
        !allResults.some(result => result.test_run_id === id)
      );

      let fallbackResults: Partial<DsAdaptResults>[] = [];
      if (missingTestRuns.length > 0) {
        this.logger.log(`Missing ds_adapt_results for test runs: ${missingTestRuns.join(', ')}, falling back to ds_metric_statistics`);

        const fallbackWhere: Record<string, unknown> = {
          panel_id: parseInt(panelId),
          metric_name: metricName,
          test_run_id: In(missingTestRuns),
        };
        if (metricsSourceId) {
          fallbackWhere.metrics_source_id = metricsSourceId;
        } else {
          fallbackWhere.application_dashboard_id = applicationDashboardId;
        }

        const fallbackData = await this.metricStatisticsRepo.find({
          where: fallbackWhere,
          select: [
            'test_run_id',
            'test_run_start',
            'dashboard_label',
            'panel_title',
            'metric_name',
            'unit',
            'mean'
          ],
          order: { test_run_start: 'ASC' }
        });

        if (fallbackData) {
          fallbackResults = fallbackData as unknown as Partial<DsAdaptResults>[];
        }
      }

      // Step 7: Create threshold map for fallback data (use thresholds from next available test run)
      const thresholdMap = new Map();
      const sortedAdaptResults = allResults.sort((a, b) =>
        new Date(a.test_run_start).getTime() - new Date(b.test_run_start).getTime()
      );

      // For each missing test run, find the next available test run's thresholds
      fallbackResults.forEach(fallbackItem => {
        if (!fallbackItem.test_run_start) return;

        const fallbackDate = new Date(fallbackItem.test_run_start);
        const nextTestRun = sortedAdaptResults.find(adaptItem =>
          new Date(adaptItem.test_run_start).getTime() > fallbackDate.getTime() &&
          adaptItem.thresholds
        );

        if (nextTestRun?.thresholds) {
          thresholdMap.set(fallbackItem.test_run_id, nextTestRun.thresholds);
        }
      });

      // Step 8: Combine all results and transform
      const combinedResults = [
        ...allResults,
        ...fallbackResults.map(item => ({
          ...item,
          statistic: { test: item.mean }, // Use mean from ds_metric_statistics
          thresholds: thresholdMap.get(item.test_run_id) || { lower: { overall: null }, upper: { overall: null } },
          conclusion: { label: 'no difference' } // Default conclusion for fallback data
        }))
      ];

      return combinedResults
        .filter(item =>
          item.test_run_id &&
          item.test_run_start &&
          item.dashboard_label &&
          item.panel_title &&
          item.metric_name &&
          item.unit !== undefined  // Allow null or empty string units
        )
        .map(item => {
          const testRun = testRunMap.get(item.test_run_id!);

          // Parse the statistic.test value - it could be a string or number
          const testValue = item.statistic?.test ? parseFloat(String(item.statistic.test)) : 0;

          return {
            test_run_id: item.test_run_id!,
            test_run_start: item.test_run_start!,
            dashboard_label: item.dashboard_label!,
            panel_title: item.panel_title!,
            metric_name: item.metric_name!,
            unit: item.unit!,
            // Use statistic.test as the main value
            mean: testValue,
            value: testValue,
            // Include thresholds for ribbon visualization
            thresholds: item.thresholds || { lower: { overall: null }, upper: { overall: null } },
            // Include conclusion for color coding
            conclusion_label: item.conclusion?.label || 'no difference',
            // Add version and annotations for richer hover templates
            version: testRun?.applicationRelease || null,
            annotations: Array.isArray(testRun?.annotations)
              ? testRun.annotations.join(', ')
              : testRun?.annotations || null
          } as unknown as ControlGroupTrendResult;
        });

    } catch (error) {
      this.logger.error('Error in findControlGroupTrends:', error);
      return [];
    }
  }

  /**
   * Batch check which test runs are changepoints.
   * Replaces N+1 individual queries with a single IN query.
   */
  private async batchCheckChangepoints(
    testRunIds: string[],
  ): Promise<Map<string, boolean>> {
    const map = new Map<string, boolean>();
    if (testRunIds.length === 0) return map;

    try {
      const result = await this.changePointsRepo
        .createQueryBuilder('cp')
        .select('DISTINCT cp.test_run_id', 'test_run_id')
        .where('cp.test_run_id IN (:...ids)', { ids: testRunIds })
        .getRawMany();

      const changepointSet = new Set(result.map((r: { test_run_id: string }) => r.test_run_id));
      for (const id of testRunIds) {
        map.set(id, changepointSet.has(id));
      }
    } catch (error) {
      this.logger.error(`Failed to batch check changepoints: ${(error as Error).message}`);
      for (const id of testRunIds) {
        map.set(id, false);
      }
    }

    return map;
  }

  /**
   * Get distinct panels for an application dashboard from ds_metric_statistics.
   * Used by SLO dialogs for performance-test dashboards that aren't in Grafana.
   */
  async getPanelsByApplicationDashboard(
    applicationDashboardId: string,
    userId: string,
    roles: string[],
  ): Promise<Array<{ panel_id: number; panel_title: string; unit?: string }>> {
    try {
      // Same reason as getDistinctMetricNames below: the dashboard id comes straight off
      // the query string and nothing downstream re-checks it.
      if (!(await this.validateDashboardAccess(applicationDashboardId, userId, roles))) {
        return [];
      }

      const rows = await this.metricStatisticsRepo
        .createQueryBuilder('s')
        .select('s.panel_id', 'panel_id')
        .addSelect('MIN(s.panel_title)', 'panel_title')
        .addSelect('MIN(s.unit)', 'unit')
        .where('s.application_dashboard_id = :applicationDashboardId', { applicationDashboardId })
        .groupBy('s.panel_id')
        .orderBy('MIN(s.panel_title)')
        .getRawMany();

      return rows;
    } catch (error) {
      this.logger.error(`Failed to get panels for dashboard ${applicationDashboardId}: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Per-statement timeout for the unscoped metric-name fallback.
   *
   * That scan has no usable index prefix, so it is bounded by how much of `ds_metrics`
   * it has to walk rather than by how much it returns — 54 s on production. Without a
   * timeout it holds one of the pool's connections for that whole time; with one,
   * Postgres aborts it and releases the connection. 10 s matches
   * `TestRunsPerformanceQueryService.LIVE_QUERY_STATEMENT_TIMEOUT_MS`, which guards the
   * comparable live-aggregation reads.
   */
  private static readonly UNSCOPED_NAMES_STATEMENT_TIMEOUT_MS = 10_000;

  /**
   * Run `fn` with a per-statement timeout so a runaway query cannot pin a pooled
   * connection. `SET LOCAL` needs a transaction to be local to, hence the wrapper.
   */
  private async withStatementTimeout<T>(fn: (em: EntityManager) => Promise<T>): Promise<T> {
    return withRequestEm(this.metricsRepo).manager.transaction(async (txEm) => {
      await txEm.query(
        `SET LOCAL statement_timeout = '${MetricsService.UNSCOPED_NAMES_STATEMENT_TIMEOUT_MS}ms'`,
      );
      return fn(txEm);
    });
  }

  /**
   * The most recent run that could have written to this dashboard.
   *
   * Resolved through the dashboard's (system_under_test_id, test_environment) rather than
   * from `ds_metrics`, which is the whole point: asking `ds_metrics` "which run touched
   * this dashboard last" is the same unindexed scan we are trying to avoid. This walks
   * `idx_test_runs_system_env_workload_start` from the dashboard's primary key instead —
   * `workload` is unconstrained so the rows still need sorting, but a (sut, env) pair holds
   * runs in the hundreds, which sorts in microseconds.
   *
   * Returns null when the dashboard is unknown or its system has no runs; the caller then
   * takes the bounded unscoped path.
   */
  private async resolveLatestRunForDashboard(applicationDashboardId: string): Promise<string | null> {
    if (!applicationDashboardId) return null;

    const rows: Array<{ test_run_id: string }> = await withRequestEm(this.metricsRepo).query(
      `SELECT tr.test_run_id
         FROM application_dashboards ad
         JOIN test_runs tr
           ON tr.system_under_test_id = ad.system_under_test_id
          AND tr.test_environment = ad.test_environment
        WHERE ad.id = $1
        ORDER BY tr.start_time DESC
        LIMIT 1`,
      [applicationDashboardId],
    );
    return rows[0]?.test_run_id ?? null;
  }

  /**
   * The distinct-name query itself, shared by the scoped and unscoped paths so the two
   * cannot drift in what they filter on. `em` lets the caller run it inside the
   * statement-timeout transaction.
   */
  private async queryDistinctMetricNames(
    panelId: number,
    applicationDashboardId: string,
    metricsSourceId: string | undefined,
    testRunId: string | undefined,
    em?: EntityManager,
  ): Promise<string[]> {
    const conditions = ['panel_id = $1'];
    const params: unknown[] = [panelId];

    if (testRunId) {
      params.push(testRunId);
      conditions.push(`test_run_id = $${params.length}`);
    }
    // Prefer metricsSourceId over applicationDashboardId, as the caller does.
    if (metricsSourceId) {
      params.push(metricsSourceId);
      conditions.push(`metrics_source_id = $${params.length}`);
    } else {
      params.push(applicationDashboardId);
      conditions.push(`application_dashboard_id = $${params.length}`);
    }

    // ds_metrics carries no RLS policy (see the note in getDistinctMetricNames), so the
    // plain manager is correct here; `em` is the statement-timeout transaction when the
    // caller is on the unscoped fallback.
    const runner = em ?? this.metricsRepo.manager;
    const rows: Array<{ metric_name: string }> = await runner.query(
      `SELECT DISTINCT metric_name FROM ds_metrics
        WHERE ${conditions.join(' AND ')}
        ORDER BY metric_name ASC`,
      params,
    );
    return rows.map((r) => r.metric_name);
  }

  /**
   * Get distinct metric names for a specific dashboard and panel
   */
  async getDistinctMetricNames(
    applicationDashboardId: string,
    panelId: number,
    userId: string,
    roles: string[],
    metricsSourceId?: string,
    testRunId?: string,
  ): Promise<string[]> {
    try {
      // Neither ds_metrics nor ds_metric_statistics has an RLS policy, so nothing below
      // this line constrains which organization's rows come back — the ids are raw query
      // parameters. One check is enough rather than two: the query always filters on the
      // run AND the dashboard/source, so a row can only be returned when both belong to
      // the same organization, and proving access to either one rules out a cross-tenant
      // read. Prefer the run when it is supplied; it is the more direct check.
      const permitted = testRunId
        ? await this.validateTestRunAccess(testRunId, userId, roles)
        : await this.validateDashboardAccess(
            metricsSourceId
              ? ((await this.resolveApplicationDashboardId(metricsSourceId)) ?? '')
              : applicationDashboardId,
            userId,
            roles,
          );
      if (!permitted) {
        return [];
      }

      // Without a run this answers "every series this panel has EVER recorded" — including
      // series from runs whose naming has since changed. The compare card then offered
      // e.g. `category_page_load` from a 2024 run next to today's
      // `T02_Browse_Category.category_page_load`: no values in either compared run, and no
      // URL, because nothing matches it.
      //
      // It is also pathologically slow, because no index leads with
      // (application_dashboard_id, panel_id). Measured on production 2026-09-23:
      // 7 unscoped calls at a 54,077 ms mean and 25 GB read, against 827 scoped calls at
      // 10.1 ms. One probed pair was 6,720 ms / 583,333 buffers unscoped against
      // 13.9 ms / 34 buffers scoped.
      //
      // So when the caller has no run, resolve one: the dashboard's most recent run gives
      // the series the panel produces TODAY, which is what a report-template author is
      // choosing between. Correctness and speed happen to want the same thing here.
      const scopedRunId = testRunId ?? (await this.resolveLatestRunForDashboard(
        metricsSourceId
          ? ((await this.resolveApplicationDashboardId(metricsSourceId)) ?? '')
          : applicationDashboardId,
      ));

      const scopedNames = scopedRunId
        ? await this.queryDistinctMetricNames(panelId, applicationDashboardId, metricsSourceId, scopedRunId)
        : [];

      // An explicit run is the caller's choice and is returned as-is, empty or not.
      if (testRunId || scopedNames.length > 0) {
        return scopedNames;
      }

      // The resolved run had nothing for this panel — a dashboard added after that run,
      // or a run whose collection for it failed. Falling back to the unscoped scan keeps
      // the picker populated rather than silently empty, and the statement timeout is what
      // stops that costing another 54 seconds: Postgres aborts it and releases the
      // connection instead of holding one of the pool's 50 for a minute. Same guard the
      // live-aggregation paths in test-runs-performance-query.service.ts already use.
      this.logger.warn(
        `Distinct metric names: run ${scopedRunId ?? '(none resolved)'} had no rows for panel ${panelId}` +
          ` on dashboard ${applicationDashboardId}; falling back to the unscoped scan`,
      );
      return this.withStatementTimeout((em) =>
        this.queryDistinctMetricNames(panelId, applicationDashboardId, metricsSourceId, undefined, em),
      );
    } catch (error) {
      this.logger.error(
        `Failed to get distinct metric names for dashboard ${applicationDashboardId} panel ${panelId}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * List available dashboards and panels for a test run.
   */
  async getAvailableDashboards(testRunId: string, userId: string, roles: string[]): Promise<Record<string, unknown>[]> {
    const hasAccess = await this.validateTestRunAccess(testRunId, userId, roles);
    if (!hasAccess) {
      return [];
    }

    // Reduce to distinct (panel, metric) tuples BEFORE aggregating. The obvious form —
    // COUNT(DISTINCT metric_name) and ARRAY_AGG(DISTINCT metric_name) grouped by the four
    // panel columns — makes both aggregates walk every data point the run recorded, and
    // ds_metrics holds one row per point: measured 2035 ms on a 12.8M-row run against
    // 927 ms for this form, returning the same 381 rows (verified with EXCEPT both ways).
    // The inner DISTINCT is index-only over idx_ds_metrics_panel_lookup, which carries
    // exactly these columns after test_run_id.
    //
    // Deliberately NOT sourced from ds_metric_statistics, which would be faster still
    // (59 ms) and wrong: that table has two writers on different schedules — during a live
    // run only PerformanceTestMetricsPipeline has written to it, so the answer would omit
    // every Grafana and Dynatrace dashboard — and it only ever holds rows with
    // ramp_up = false AND value IS NOT NULL on org-scoped dashboards, so metrics that
    // report solely during ramp-up would silently vanish from the picker while the chart
    // endpoint still plots them.
    const rows = await this.metricsRepo.query(
      `SELECT dashboard_label, panel_title, panel_id, unit,
              COUNT(*) AS metric_count,
              ARRAY_AGG(metric_name ORDER BY metric_name) AS metric_names
         FROM (
           SELECT DISTINCT dashboard_label, panel_title, panel_id, unit, metric_name
             FROM ds_metrics
            WHERE test_run_id = $1
         ) d
        GROUP BY dashboard_label, panel_title, panel_id, unit
        ORDER BY dashboard_label, panel_title`,
      [testRunId],
    );

    return rows;
  }

  /**
   * Get time-series metric data filtered by dashboard label and panel title.
   */
  async getMetricTimeSeries(
    testRunId: string,
    dashboardLabel: string,
    panelTitle: string,
    metricName?: string,
    excludeRampUp: boolean = false,
    userId: string = '',
    roles: string[] = [],
  ): Promise<MetricDataPoint[]> {
    const hasAccess = await this.validateTestRunAccess(testRunId, userId, roles);
    if (!hasAccess) {
      return [];
    }

    const qb = this.metricsRepo
      .createQueryBuilder('m')
      .select(['m.time', 'm.metric_name', 'm.value', 'm.timestep', 'm.ramp_up', 'm.unit'])
      .where('m.test_run_id = :testRunId', { testRunId })
      .andWhere('m.dashboard_label = :dashboardLabel', { dashboardLabel })
      .andWhere('m.panel_title = :panelTitle', { panelTitle })
      .orderBy('m.metric_name')
      .addOrderBy('m.time');

    if (metricName) {
      qb.andWhere('m.metric_name = :metricName', { metricName });
    }

    if (excludeRampUp) {
      qb.andWhere('m.ramp_up = false');
    }

    return qb.getMany();
  }
}
