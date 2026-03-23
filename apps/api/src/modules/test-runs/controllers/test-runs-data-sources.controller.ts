import {
  Controller,
  Get,
  Param,
  Query,
  Logger,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';
import { UserCtx, UserContext } from '../../../common/decorators/user-context.decorator';
import {
  TestRunsDataSourcesService,
  ConnectedSourcesResult,
  TraceSearchResult,
  TraceDetailsResult,
  HotspotEntry,
  DashboardSnapshotResult,
  DynatraceProblem,
} from '../services/test-runs-data-sources.service';

@ApiTags('test-runs')
@Controller('test-runs')
export class TestRunsDataSourcesController {
  private readonly logger = new Logger(TestRunsDataSourcesController.name);

  constructor(private readonly dataSourcesService: TestRunsDataSourcesService) {}

  // ─── Data source discovery ──────────────────────────────────────────────────

  @Get(':testRunId/data-sources')
  @ApiParam({ name: 'testRunId', description: 'Test run UUID or testRunId string' })
  @ApiOperation({
    summary: 'Get connected data sources for a test run',
    description:
      'Returns all data sources (Grafana, Tempo/tracing, Pyroscope, Dynatrace) that are ' +
      'configured for the system under test associated with this test run.',
  })
  @ApiResponse({
    status: 200,
    description: 'Connected data sources',
    schema: {
      type: 'object',
      properties: {
        grafana: {
          type: 'object',
          properties: {
            available: { type: 'boolean' },
            instances: { type: 'array', items: { type: 'object' } },
            dashboardCount: { type: 'number' },
          },
        },
        tempo: {
          type: 'object',
          properties: {
            available: { type: 'boolean' },
            instances: { type: 'array', items: { type: 'object' } },
          },
        },
        pyroscope: {
          type: 'object',
          properties: {
            available: { type: 'boolean' },
            instance: { type: 'object', nullable: true },
            configurations: { type: 'array', items: { type: 'object' } },
          },
        },
        dynatrace: {
          type: 'object',
          properties: {
            available: { type: 'boolean' },
            configs: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async getConnectedSources(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<ConnectedSourcesResult> {
    this.logger.debug(`Getting connected sources for test run ${testRunId}`);
    return this.dataSourcesService.getConnectedSources(testRunId, ctx.userId, ctx.roles);
  }

  // ─── Traces ─────────────────────────────────────────────────────────────────

  @Get(':testRunId/traces/slow')
  @ApiParam({ name: 'testRunId', description: 'Test run UUID or testRunId string' })
  @ApiOperation({
    summary: 'Get slowest traces for a test run',
    description:
      'Searches Tempo for the slowest traces recorded during the test run time window. ' +
      'Results are sorted by duration descending.',
  })
  @ApiQuery({ name: 'service', required: false, type: String, description: 'Filter by service name (resource.service.name)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Maximum number of traces to return (default: 20, max: 100)' })
  @ApiResponse({
    status: 200,
    description: 'Slowest traces',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          traceId: { type: 'string' },
          durationMs: { type: 'number' },
          startTimeUnixNano: { type: 'string' },
          spanCount: { type: 'number' },
          rootServiceName: { type: 'string' },
          rootTraceName: { type: 'string' },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async getSlowTraces(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
    @Query('service') service?: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ): Promise<TraceSearchResult[]> {
    const safeLimit = Math.min(Math.max(1, limit), 100);
    this.logger.debug(`Getting slow traces for test run ${testRunId}, service=${service}, limit=${safeLimit}`);
    return this.dataSourcesService.getSlowTraces(testRunId, service, safeLimit, ctx.userId, ctx.roles);
  }

  @Get(':testRunId/traces/errors')
  @ApiParam({ name: 'testRunId', description: 'Test run UUID or testRunId string' })
  @ApiOperation({
    summary: 'Get error traces for a test run',
    description:
      'Searches Tempo for traces with error status recorded during the test run time window.',
  })
  @ApiQuery({ name: 'service', required: false, type: String, description: 'Filter by service name' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Maximum number of traces (default: 20, max: 100)' })
  @ApiResponse({
    status: 200,
    description: 'Error traces',
    schema: { type: 'array', items: { type: 'object' } },
  })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async getErrorTraces(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
    @Query('service') service?: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ): Promise<TraceSearchResult[]> {
    const safeLimit = Math.min(Math.max(1, limit), 100);
    this.logger.debug(`Getting error traces for test run ${testRunId}, service=${service}, limit=${safeLimit}`);
    return this.dataSourcesService.getErrorTraces(testRunId, service, safeLimit, ctx.userId, ctx.roles);
  }

  @Get(':testRunId/traces/:traceId')
  @ApiParam({ name: 'testRunId', description: 'Test run UUID or testRunId string' })
  @ApiParam({ name: 'traceId', description: 'Tempo trace ID' })
  @ApiOperation({
    summary: 'Get full trace detail for a specific trace',
    description: 'Fetches all spans for a specific trace ID from the Tempo instance connected to this test run.',
  })
  @ApiResponse({
    status: 200,
    description: 'Trace details with all spans',
    schema: {
      type: 'object',
      properties: {
        traceId: { type: 'string' },
        spans: { type: 'array', items: { type: 'object' } },
        durationMs: { type: 'number' },
        spanCount: { type: 'number' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Test run or tracing instance not found' })
  async getTraceDetail(
    @Param('testRunId') testRunId: string,
    @Param('traceId') traceId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<TraceDetailsResult> {
    this.logger.debug(`Getting trace detail for test run ${testRunId}, trace ${traceId}`);
    return this.dataSourcesService.getTraceDetail(testRunId, traceId, ctx.userId, ctx.roles);
  }

  // ─── Pyroscope ──────────────────────────────────────────────────────────────

  @Get(':testRunId/flamegraph')
  @ApiParam({ name: 'testRunId', description: 'Test run UUID or testRunId string' })
  @ApiOperation({
    summary: 'Get CPU flamegraph for a service during a test run',
    description:
      'Fetches profiling data from Pyroscope for the test run time window and returns it as ' +
      'collapsed-stack format (one line per function + sample count). The detailLevel parameter ' +
      "controls the number of stacks returned: 'summary' returns top 50, 'full' returns top 200.",
  })
  @ApiQuery({ name: 'service', required: true, type: String, description: 'Application/service name in Pyroscope (matches pyroscope_configurations.application)' })
  @ApiQuery({
    name: 'detailLevel',
    required: false,
    enum: ['summary', 'full'],
    description: "Detail level: 'summary' (top 50 stacks) or 'full' (top 200 stacks, default)",
  })
  @ApiResponse({
    status: 200,
    description: 'Collapsed-stack flamegraph text (newline-delimited)',
    content: { 'text/plain': { schema: { type: 'string' } } },
  })
  @ApiResponse({ status: 404, description: 'Test run or Pyroscope instance not found' })
  async getFlamegraph(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
    @Query('service') service: string,
    @Query('detailLevel') detailLevel = 'full',
  ): Promise<string> {
    this.logger.debug(`Getting flamegraph for test run ${testRunId}, service=${service}, detailLevel=${detailLevel}`);
    return this.dataSourcesService.getFlamegraph(testRunId, service, detailLevel, ctx.userId, ctx.roles);
  }

  @Get(':testRunId/hotspots')
  @ApiParam({ name: 'testRunId', description: 'Test run UUID or testRunId string' })
  @ApiOperation({
    summary: 'Get CPU hotspot functions for a service during a test run',
    description:
      'Fetches profiling data from Pyroscope and returns the top N CPU-consuming functions ' +
      'with their sample counts and percentage of total CPU time.',
  })
  @ApiQuery({ name: 'service', required: true, type: String, description: 'Application/service name in Pyroscope' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Number of top functions to return (default: 20, max: 100)' })
  @ApiResponse({
    status: 200,
    description: 'Top CPU hotspot functions',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          function: { type: 'string' },
          samples: { type: 'number' },
          percentage: { type: 'number', description: 'Percentage of total CPU samples' },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Test run or Pyroscope instance not found' })
  async getHotspots(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
    @Query('service') service: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ): Promise<HotspotEntry[]> {
    const safeLimit = Math.min(Math.max(1, limit), 100);
    this.logger.debug(`Getting hotspots for test run ${testRunId}, service=${service}, limit=${safeLimit}`);
    return this.dataSourcesService.getHotspots(testRunId, service, safeLimit, ctx.userId, ctx.roles);
  }

  // ─── Dashboard snapshot ──────────────────────────────────────────────────────

  @Get(':testRunId/dashboard-snapshot')
  @ApiParam({ name: 'testRunId', description: 'Test run UUID or testRunId string' })
  @ApiOperation({
    summary: 'Get aggregated metric statistics for a dashboard during a test run',
    description:
      'Returns pre-computed metric statistics (min, max, avg, last) for all panels of a ' +
      'named dashboard, sourced from the ds_metric_statistics table. The dashboard parameter ' +
      'can match by dashboardLabel, dashboardName, or dashboardUid.',
  })
  @ApiQuery({ name: 'dashboard', required: true, type: String, description: 'Dashboard label, name, or UID to retrieve statistics for' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard panel statistics',
    schema: {
      type: 'object',
      properties: {
        dashboardName: { type: 'string' },
        dashboardLabel: { type: 'string' },
        panels: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              panelId: { type: 'number' },
              title: { type: 'string' },
              metrics: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    min: { type: 'number', nullable: true },
                    max: { type: 'number', nullable: true },
                    avg: { type: 'number', nullable: true },
                    last: { type: 'number', nullable: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Test run or dashboard not found' })
  async getDashboardSnapshot(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
    @Query('dashboard') dashboard: string,
  ): Promise<DashboardSnapshotResult> {
    this.logger.debug(`Getting dashboard snapshot for test run ${testRunId}, dashboard=${dashboard}`);
    return this.dataSourcesService.getDashboardSnapshot(testRunId, dashboard, ctx.userId, ctx.roles);
  }

  // ─── Dynatrace ───────────────────────────────────────────────────────────────

  @Get(':testRunId/dynatrace/problems')
  @ApiParam({ name: 'testRunId', description: 'Test run UUID or testRunId string' })
  @ApiOperation({
    summary: 'Get Dynatrace problems for the test run time window',
    description:
      'Queries all Dynatrace configs connected to the system under test and returns any ' +
      'problems (incidents) recorded during the test run time window.',
  })
  @ApiResponse({
    status: 200,
    description: 'Dynatrace problems during the test run',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          problemId: { type: 'string' },
          title: { type: 'string' },
          status: { type: 'string' },
          severityLevel: { type: 'string' },
          startTime: { type: 'string', format: 'date-time' },
          endTime: { type: 'string', format: 'date-time', nullable: true },
          impactLevel: { type: 'string' },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async getDynatraceProblems(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<DynatraceProblem[]> {
    this.logger.debug(`Getting Dynatrace problems for test run ${testRunId}`);
    return this.dataSourcesService.getDynatraceProblems(testRunId, ctx.userId, ctx.roles);
  }
}
