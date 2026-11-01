import { Controller, Get, Param, NotFoundException, BadRequestException, Query, Logger, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MetricsService, MetricTimeRange } from './metrics.service';
import { Benchmark } from '../../entities';
import { withRequestEm } from '../../common/db/request-em';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';

/**
 * Validate a chart zoom window. Both bounds or neither; anything else is a 400.
 *
 * Exported for `metric-time-range.spec.ts` rather than duplicated — keep this the one
 * implementation the controller runs.
 */
export function parseMetricTimeRange(from?: string, to?: string): MetricTimeRange | undefined {
  if (!from && !to) return undefined;
  if (!from || !to) {
    throw new BadRequestException('from and to must be supplied together');
  }
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (isNaN(fromMs) || isNaN(toMs)) {
    throw new BadRequestException('from and to must be ISO-8601 timestamps');
  }
  if (fromMs > toMs) {
    throw new BadRequestException('from must not be after to');
  }
  return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() };
}

/**
 * Shared by the four routes that can answer a series GROUP (v0.2.97+): a group is a set of
 * series whose names differ only by a generated segment such as a Kubernetes pod name, and
 * the statistics are stored under its name. `ds_metrics` only holds the raw series.
 */
const SERIES_MEMBERS_DESCRIPTION =
  'Set to `true` to skip series grouping and get the raw per-pod series: a group name is then answered by its members, unaggregated. Default: group names, each combined from its members.';

@ApiTags('metrics')
@ApiBearerAuth()
@Controller('metrics')
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor(
    private readonly metricsService: MetricsService,
    @InjectRepository(Benchmark)
    private benchmarkRepo: Repository<Benchmark>,
  ) {}

  @Get('ds-metrics/available/:testRunId')
  @ApiOperation({ summary: 'List available dashboards and panels for a test run' })
  @ApiQuery({ name: 'members', required: false, description: SERIES_MEMBERS_DESCRIPTION })
  async getAvailableDashboards(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
    @Query('members') members?: string,
  ) {
    return this.metricsService.getAvailableDashboards(testRunId, ctx.userId, ctx.roles, members === 'true');
  }

  @Get('ds-metrics/time-series/:testRunId')
  @ApiOperation({ summary: 'Get time-series metric data filtered by dashboard label, panel title, and optional metric name' })
  @ApiQuery({ name: 'members', required: false, description: SERIES_MEMBERS_DESCRIPTION })
  async getMetricTimeSeries(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
    @Query('dashboardLabel') dashboardLabel: string,
    @Query('panelTitle') panelTitle: string,
    @Query('metricName') metricName?: string,
    @Query('excludeRampUp') excludeRampUp?: string,
    @Query('members') members?: string,
  ) {
    if (!dashboardLabel || !panelTitle) {
      throw new BadRequestException('dashboardLabel and panelTitle are required');
    }

    return this.metricsService.getMetricTimeSeries(
      testRunId,
      dashboardLabel,
      panelTitle,
      metricName,
      excludeRampUp === 'true',
      ctx.userId,
      ctx.roles,
      members === 'true',
    );
  }

  @Get('ds-metrics/:testRunId/:panelId')
  @ApiOperation({ summary: 'Get DS metrics for a specific panel with optional application dashboard filtering' })
  @ApiQuery({ name: 'metricsSourceId', required: false, description: 'Metrics source UUID (preferred over applicationDashboardId)' })
  @ApiQuery({ name: 'from', required: false, description: 'ISO-8601 start of the window to return. With `to`, the downsample budget is spent on this window instead of the whole run — what a chart zoom uses.' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO-8601 end of the window. Both or neither; one alone is a 400.' })
  @ApiQuery({ name: 'members', required: false, description: SERIES_MEMBERS_DESCRIPTION })
  async getDSMetricsForPanel(
    @Param('testRunId') testRunId: string,
    @Param('panelId') panelId: string,
    @UserCtx() ctx: UserContext,
    @Query('benchmarkId') benchmarkId?: string,
    @Query('applicationDashboardId') applicationDashboardId?: string,
    @Query('metricsSourceId') metricsSourceId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('members') members?: string,
  ) {
    const panelIdNumber = parseInt(panelId, 10);
    if (isNaN(panelIdNumber)) {
      throw new BadRequestException('Invalid panel ID');
    }

    // Both or neither: one bound alone would silently return the whole run on one side,
    // which reads as the zoom having been ignored rather than as a bad request.
    const range = parseMetricTimeRange(from, to);

    let finalApplicationDashboardId: string | undefined = applicationDashboardId;

    // If applicationDashboardId not provided but benchmarkId is, get it from benchmarks table
    if (!finalApplicationDashboardId && benchmarkId) {
      try {
        // Query benchmarks table using id (UUID)
        const benchmark = await withRequestEm(this.benchmarkRepo).findOne({
          where: { id: benchmarkId },
          select: ['application_dashboard_id']
        });

        if (!benchmark) {
          this.logger.warn('Could not find benchmark in benchmarks table');
          this.logger.warn('Benchmark ID searched:', benchmarkId);
        } else {
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

    const result = await this.metricsService.findDSMetricsForPanel(testRunId, panelIdNumber, finalApplicationDashboardId, undefined, ctx.userId, ctx.roles, metricsSourceId, range, members === 'true');

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
      throw new BadRequestException('applicationDashboardId (or metricsSourceId) and panelId are required');
    }

    const panelIdNumber = parseInt(panelId, 10);
    if (isNaN(panelIdNumber)) {
      throw new BadRequestException('Invalid panel ID');
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
      throw new BadRequestException('currentTestRunId, baselineTestRunId, applicationDashboardId (or metricsSourceId), and panelId are required');
    }

    const panelIdNumber = parseInt(panelId, 10);
    if (isNaN(panelIdNumber)) {
      throw new BadRequestException('Invalid panel ID');
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
      throw new BadRequestException('applicationDashboardId (or metricsSourceId), panelId, and metricName are required');
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

  @Get('ds-metrics/panels-by-dashboard')
  @ApiOperation({ summary: 'Get distinct panels for an application dashboard (from ds_metric_statistics)' })
  @ApiQuery({ name: 'applicationDashboardId', required: true, description: 'Application dashboard UUID' })
  async getPanelsByDashboard(
    @UserCtx() ctx: UserContext,
    @Query('applicationDashboardId', new ParseUUIDPipe()) applicationDashboardId: string,
  ) {
    if (!applicationDashboardId) {
      throw new BadRequestException('applicationDashboardId is required');
    }
    return this.metricsService.getPanelsByApplicationDashboard(
      applicationDashboardId,
      ctx.userId,
      ctx.roles,
    );
  }

  @Get('ds-metrics/distinct-names')
  @ApiOperation({ summary: 'Get distinct metric names for a dashboard/panel' })
  @ApiQuery({ name: 'metricsSourceId', required: false, description: 'Metrics source UUID (preferred over applicationDashboardId)' })
  @ApiQuery({ name: 'testRunId', required: false, description: 'Limit to the series this run recorded. Without it the answer spans every run the panel ever had, including series whose names are no longer produced.' })
  @ApiQuery({ name: 'members', required: false, description: SERIES_MEMBERS_DESCRIPTION })
  async getDistinctMetricNames(
    @UserCtx() ctx: UserContext,
    @Query('applicationDashboardId', new ParseUUIDPipe({ optional: true })) applicationDashboardId: string,
    @Query('panelId') panelId: string,
    @Query('metricsSourceId', new ParseUUIDPipe({ optional: true })) metricsSourceId?: string,
    @Query('testRunId') testRunId?: string,
    @Query('members') members?: string,
  ): Promise<string[]> {
    const panelIdNumber = parseInt(panelId, 10);
    if (isNaN(panelIdNumber)) {
      throw new BadRequestException('Invalid panel ID');
    }
    if (!applicationDashboardId && !metricsSourceId) {
      throw new BadRequestException('applicationDashboardId or metricsSourceId is required');
    }

    return this.metricsService.getDistinctMetricNames(
      applicationDashboardId,
      panelIdNumber,
      ctx.userId,
      ctx.roles,
      metricsSourceId,
      testRunId,
      members === 'true',
    );
  }
}
