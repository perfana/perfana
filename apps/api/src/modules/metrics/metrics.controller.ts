import { Controller, Get, Param, NotFoundException, Query, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MetricsService } from './metrics.service';
import { Benchmark } from '../../entities';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';

@ApiTags('metrics')
@Controller('metrics')
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor(
    private readonly metricsService: MetricsService,
    @InjectRepository(Benchmark)
    private benchmarkRepo: Repository<Benchmark>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get all metrics' })
  findAll(@UserCtx() _ctx: UserContext) {
    return this.metricsService.findAll();
  }

  @Get('ds-metrics/available/:testRunId')
  @ApiOperation({ summary: 'List available dashboards and panels for a test run' })
  async getAvailableDashboards(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
  ) {
    return this.metricsService.getAvailableDashboards(testRunId, ctx.userId, ctx.roles);
  }

  @Get('ds-metrics/time-series/:testRunId')
  @ApiOperation({ summary: 'Get time-series metric data filtered by dashboard label, panel title, and optional metric name' })
  async getMetricTimeSeries(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
    @Query('dashboardLabel') dashboardLabel: string,
    @Query('panelTitle') panelTitle: string,
    @Query('metricName') metricName?: string,
    @Query('excludeRampUp') excludeRampUp?: string,
  ) {
    if (!dashboardLabel || !panelTitle) {
      throw new Error('dashboardLabel and panelTitle are required');
    }

    return this.metricsService.getMetricTimeSeries(
      testRunId,
      dashboardLabel,
      panelTitle,
      metricName,
      excludeRampUp === 'true',
      ctx.userId,
      ctx.roles,
    );
  }

  @Get('ds-metrics/:testRunId/:panelId')
  @ApiOperation({ summary: 'Get DS metrics for a specific panel with optional application dashboard filtering' })
  @ApiQuery({ name: 'metricsSourceId', required: false, description: 'Metrics source UUID (preferred over applicationDashboardId)' })
  async getDSMetricsForPanel(
    @Param('testRunId') testRunId: string,
    @Param('panelId') panelId: string,
    @UserCtx() ctx: UserContext,
    @Query('benchmarkId') benchmarkId?: string,
    @Query('applicationDashboardId') applicationDashboardId?: string,
    @Query('metricsSourceId') metricsSourceId?: string,
  ) {
    const panelIdNumber = parseInt(panelId, 10);
    if (isNaN(panelIdNumber)) {
      throw new Error('Invalid panel ID');
    }

    let finalApplicationDashboardId: string | undefined = applicationDashboardId;

    // If applicationDashboardId not provided but benchmarkId is, get it from benchmarks table
    if (!finalApplicationDashboardId && benchmarkId) {
      try {
        // Query benchmarks table using id (UUID)
        const benchmark = await this.benchmarkRepo.findOne({
          where: { id: benchmarkId },
          select: ['application_dashboard_id']
        });

        if (!benchmark) {
          this.logger.warn('Could not find benchmark in benchmarks table');
          this.logger.warn('Benchmark ID searched:', benchmarkId);
        } else if (benchmark) {
          if (benchmark.application_dashboard_id) {
            finalApplicationDashboardId = benchmark.application_dashboard_id;
            this.logger.log(`Found application_dashboard_id: ${finalApplicationDashboardId} for benchmark: ${benchmarkId}`);
          } else {
            this.logger.log('Benchmark found but no application_dashboard_id, will use first available from ds_metrics');
          }
        }
      } catch (error) {
        this.logger.warn('Error fetching benchmark application dashboard ID:', error);
      }
    }

    const result = await this.metricsService.findDSMetricsForPanel(testRunId, panelIdNumber, finalApplicationDashboardId, undefined, ctx.userId, ctx.roles, metricsSourceId);

    if (result === null) {
      throw new NotFoundException(`DS metrics not found for test run ${testRunId} and panel ${panelIdNumber}`);
    }

    return result;
  }

  @Get('ds-metric-statistics')
  @ApiOperation({ summary: 'Get DS metric statistics for trends analysis with time range filtering. Supports multiple evaluate types.' })
  @ApiQuery({ name: 'metricsSourceId', required: false, description: 'Metrics source UUID (preferred over applicationDashboardId)' })
  async getDSMetricStatistics(
    @UserCtx() ctx: UserContext,
    @Query('applicationDashboardId') applicationDashboardId: string,
    @Query('panelId') panelId: string,
    @Query('evaluateType') evaluateType?: string,
    @Query('evaluateTypes') evaluateTypes?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('system') system?: string,
    @Query('environment') environment?: string,
    @Query('workload') workload?: string,
    @Query('metricsSourceId') metricsSourceId?: string,
  ) {
    if ((!applicationDashboardId && !metricsSourceId) || !panelId) {
      throw new Error('applicationDashboardId (or metricsSourceId) and panelId are required');
    }

    const panelIdNumber = parseInt(panelId, 10);
    if (isNaN(panelIdNumber)) {
      throw new Error('Invalid panel ID');
    }

    // Support both single evaluateType and multiple evaluateTypes
    if (evaluateTypes) {
      // Handle comma-separated evaluate types - use new multiple method
      const finalEvaluateTypes = evaluateTypes.split(',').map(t => t.trim());
      const result = await this.metricsService.findDSMetricStatisticsMultiple(
        applicationDashboardId,
        panelIdNumber,
        finalEvaluateTypes,
        from,
        to,
        system,
        environment,
        workload,
        ctx.userId,
        ctx.roles,
        metricsSourceId,
      );
      return result;
    } else if (evaluateType) {
      // Handle single evaluate type for backward compatibility - use old single method
      const result = await this.metricsService.findDSMetricStatistics(
        applicationDashboardId,
        panelIdNumber,
        evaluateType,
        from,
        to,
        system,
        environment,
        workload,
        ctx.userId,
        ctx.roles,
        metricsSourceId,
      );
      return result;
    } else {
      // Default to all evaluate types if none specified - use new multiple method
      const finalEvaluateTypes = ['avg', 'max', 'min', 'last', 'count', 'q50', 'q90', 'q95', 'q99'];
      const result = await this.metricsService.findDSMetricStatisticsMultiple(
        applicationDashboardId,
        panelIdNumber,
        finalEvaluateTypes,
        from,
        to,
        system,
        environment,
        workload,
        ctx.userId,
        ctx.roles,
        metricsSourceId,
      );
      return result;
    }
  }

  @Get('ds-metrics-comparison')
  @ApiOperation({ summary: 'Get raw DS metrics data for two test runs to compare in a graph' })
  @ApiQuery({ name: 'metricsSourceId', required: false, description: 'Metrics source UUID (preferred over applicationDashboardId)' })
  async getDSMetricsComparison(
    @UserCtx() ctx: UserContext,
    @Query('currentTestRunId') currentTestRunId: string,
    @Query('baselineTestRunId') baselineTestRunId: string,
    @Query('applicationDashboardId') applicationDashboardId: string,
    @Query('panelId') panelId: string,
    @Query('metricName') metricName?: string,
    @Query('metricsSourceId') metricsSourceId?: string,
  ) {
    if (!currentTestRunId || !baselineTestRunId || (!applicationDashboardId && !metricsSourceId) || !panelId) {
      throw new Error('currentTestRunId, baselineTestRunId, applicationDashboardId (or metricsSourceId), and panelId are required');
    }

    const panelIdNumber = parseInt(panelId, 10);
    if (isNaN(panelIdNumber)) {
      throw new Error('Invalid panel ID');
    }

    try {
      // Fetch metrics for both test runs - filter by metricName at database level for efficiency
      const [currentMetrics, baselineMetrics] = await Promise.all([
        this.metricsService.findDSMetricsForPanel(currentTestRunId, panelIdNumber, applicationDashboardId, metricName, ctx.userId, ctx.roles, metricsSourceId),
        this.metricsService.findDSMetricsForPanel(baselineTestRunId, panelIdNumber, applicationDashboardId, metricName, ctx.userId, ctx.roles, metricsSourceId)
      ]);

      return {
        currentMetrics: currentMetrics || [],
        baselineMetrics: baselineMetrics || [],
        currentTestRunId,
        baselineTestRunId,
        applicationDashboardId,
        metricsSourceId: metricsSourceId || null,
        panelId: panelIdNumber,
        metricName: metricName || null
      };
    } catch (error) {
      this.logger.error('Error fetching DS metrics comparison:', error);
      throw error;
    }
  }

  @Get('control-group-trends/:testRunId')
  @ApiOperation({ summary: 'Get control group trend data for anomaly detection with version and annotations enrichment' })
  @ApiQuery({ name: 'metricsSourceId', required: false, description: 'Metrics source UUID (preferred over applicationDashboardId)' })
  async getControlGroupTrends(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
    @Query('applicationDashboardId') applicationDashboardId: string,
    @Query('panelId') panelId: string,
    @Query('metricName') metricName: string,
    @Query('metricsSourceId') metricsSourceId?: string,
  ) {
    if ((!applicationDashboardId && !metricsSourceId) || !panelId || !metricName) {
      throw new Error('applicationDashboardId (or metricsSourceId), panelId, and metricName are required');
    }

    try {
      const trends = await this.metricsService.findControlGroupTrends(
        testRunId,
        applicationDashboardId,
        panelId,
        metricName,
        ctx.userId,
        ctx.roles,
        metricsSourceId,
      );

      return trends;
    } catch (error) {
      this.logger.error('Error fetching control group trends:', error);
      throw error;
    }
  }

  @Get('ds-metrics/distinct-names')
  @ApiOperation({ summary: 'Get distinct metric names for a dashboard/panel' })
  @ApiQuery({ name: 'metricsSourceId', required: false, description: 'Metrics source UUID (preferred over applicationDashboardId)' })
  async getDistinctMetricNames(
    @UserCtx() _ctx: UserContext,
    @Query('applicationDashboardId') applicationDashboardId: string,
    @Query('panelId') panelId: string,
    @Query('metricsSourceId') metricsSourceId?: string,
  ): Promise<string[]> {
    const panelIdNumber = parseInt(panelId, 10);
    if (isNaN(panelIdNumber)) {
      throw new Error('Invalid panel ID');
    }

    return this.metricsService.getDistinctMetricNames(
      applicationDashboardId,
      panelIdNumber,
      metricsSourceId,
    );
  }
}
