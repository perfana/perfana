import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, FindManyOptions } from 'typeorm';
import {
  DsMetrics,
  DsMetricStatistics,
  DsControlGroups,
  DsChangePoints,
  DsAdaptResults,
  TestRun as TestRunEntity,
  ApplicationDashboard,
} from '../../entities';
import { AuthorizationService } from '../../common/services/authorization.service';

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
    const row = await this.applicationDashboardRepo.findOne({
      where: { metricsSourceId },
      select: ['id'],
    });
    return row?.id;
  }

  private async validateTestRunAccess(
    testRunId: string,
    userId: string,
    roles: string[],
  ): Promise<boolean> {
    if (this.authzService.isGlobalAdmin(roles)) return true;

    const organizationIds = await this.authzService.getAccessibleOrganizations(userId);

    const query = `
      SELECT 1
      FROM test_runs tr
      INNER JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
      WHERE tr.test_run_id = $1
        AND (sut.organization_id = ANY($2::uuid[]) OR sut.organization_id IS NULL)
      LIMIT 1
    `;
    const result = await this.testRunRepo.query(query, [testRunId, organizationIds]);
    return result && result.length > 0;
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
      const isAdmin = this.authzService.isGlobalAdmin(roles);

      // First, get test_run_ids that match the criteria from test_runs table
      const queryBuilder = this.testRunRepo
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

      // Add organization filtering for non-admin users
      if (!isAdmin) {
        const organizationIds = await this.authzService.getAccessibleOrganizations(userId);
        if (organizationIds.length === 0) {
          return [];
        }
        queryBuilder.andWhere('(sut.organization_id IN (:...orgIds) OR sut.organization_id IS NULL)', { orgIds: organizationIds });
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
            case 'count':
              value = record.count ?? null;
              break;
            case 'q50':
              value = record.median ?? null;
              break;
            case 'q90':
              value = record.percentiles?.p90 ?? null;
              break;
            case 'q95':
              value = record.percentiles?.p95 ?? null;
              break;
            case 'q99':
              value = record.percentiles?.p99 ?? null;
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
      const isAdmin = this.authzService.isGlobalAdmin(roles);

      // First, get test_run_ids that match the criteria from test_runs table
      const queryBuilder = this.testRunRepo
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

      // Add organization filtering for non-admin users
      if (!isAdmin) {
        const organizationIds = await this.authzService.getAccessibleOrganizations(userId);
        if (organizationIds.length === 0) {
          return [];
        }
        queryBuilder.andWhere('(sut.organization_id IN (:...orgIds) OR sut.organization_id IS NULL)', { orgIds: organizationIds });
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
          value = record.percentiles.p90 ?? null;
        } else if (evaluateType === 'q95' && record.percentiles) {
          value = record.percentiles.p95 ?? null;
        } else if (evaluateType === 'q99' && record.percentiles) {
          value = record.percentiles.p99 ?? null;
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
      const testRuns = await this.testRunRepo.find({
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
          const testValue = item.statistic?.test ? parseFloat(item.statistic.test) : 0;

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
          };
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
   * Get distinct metric names for a specific dashboard and panel
   */
  async getDistinctMetricNames(
    applicationDashboardId: string,
    panelId: number,
    metricsSourceId?: string,
  ): Promise<string[]> {
    try {
      const qb = this.metricsRepo
        .createQueryBuilder('dsMetrics')
        .select('DISTINCT dsMetrics.metric_name', 'metric_name')
        .where('dsMetrics.panel_id = :panelId', { panelId })
        .orderBy('dsMetrics.metric_name', 'ASC');

      // Prefer metricsSourceId over applicationDashboardId
      if (metricsSourceId) {
        qb.andWhere('dsMetrics.metrics_source_id = :metricsSourceId', { metricsSourceId });
      } else {
        qb.andWhere('dsMetrics.application_dashboard_id = :applicationDashboardId', { applicationDashboardId });
      }

      const result = await qb.getRawMany();

      return result.map((row: { metric_name: string }) => row.metric_name);
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
  async getAvailableDashboards(testRunId: string, userId: string, roles: string[]): Promise<any[]> {
    const hasAccess = await this.validateTestRunAccess(testRunId, userId, roles);
    if (!hasAccess) {
      return [];
    }

    const rows = await this.metricsRepo
      .createQueryBuilder('m')
      .select('m.dashboard_label', 'dashboard_label')
      .addSelect('m.panel_title', 'panel_title')
      .addSelect('m.panel_id', 'panel_id')
      .addSelect('m.unit', 'unit')
      .addSelect('COUNT(DISTINCT m.metric_name)', 'metric_count')
      .addSelect('ARRAY_AGG(DISTINCT m.metric_name ORDER BY m.metric_name)', 'metric_names')
      .where('m.test_run_id = :testRunId', { testRunId })
      .groupBy('m.dashboard_label')
      .addGroupBy('m.panel_title')
      .addGroupBy('m.panel_id')
      .addGroupBy('m.unit')
      .orderBy('m.dashboard_label')
      .addOrderBy('m.panel_title')
      .getRawMany();

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
