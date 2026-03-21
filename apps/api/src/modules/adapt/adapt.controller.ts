import { Controller, Get, Post, Param, Query, Body, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { AdaptService } from './adapt.service';
import {
  TrackedRegressionsResponseDto,
  TrackedRegressionsCountDto,
  ResolveTrackedRegressionDto,
  TrackedRegressionDto,
} from './dto/tracked-regression.dto';
import { ValidationException } from '../../common/exceptions/business.exception';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';

@ApiTags('adapt')
@Controller('adapt')
export class AdaptController {
  constructor(private readonly adaptService: AdaptService) {}

  @Get('tracked-regressions')
  @ApiOperation({ summary: 'Get tracked regressions for a test run' })
  @ApiResponse({
    status: 200,
    description: 'Tracked regressions retrieved successfully',
    type: TrackedRegressionsResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid parameters' })
  @ApiQuery({ name: 'testRunId', description: 'Test run ID', required: true })
  @ApiQuery({ name: 'system', description: 'System under test', required: false })
  @ApiQuery({ name: 'environment', description: 'Test environment', required: false })
  @ApiQuery({ name: 'workload', description: 'Workload type', required: false })
  async getTrackedRegressions(
    @UserCtx() ctx: UserContext,
    @Query('testRunId') testRunId: string,
    @Query('system') system?: string,
    @Query('environment') environment?: string,
    @Query('workload') workload?: string,
  ): Promise<TrackedRegressionsResponseDto> {
    if (!testRunId) {
      throw new ValidationException('testRunId is required');
    }

    return this.adaptService.getTrackedRegressions(testRunId, system, environment, workload, ctx.roles, ctx.organizations);
  }

  @Get('tracked-regressions/count')
  @ApiOperation({ summary: 'Get count of unresolved tracked regressions' })
  @ApiResponse({
    status: 200,
    description: 'Tracked regressions count retrieved successfully',
    type: TrackedRegressionsCountDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid parameters' })
  @ApiQuery({ name: 'testRunId', description: 'Test run ID', required: true })
  async getTrackedRegressionsCount(
    @UserCtx() ctx: UserContext,
    @Query('testRunId') testRunId: string,
  ): Promise<TrackedRegressionsCountDto> {
    if (!testRunId) {
      throw new ValidationException('testRunId is required');
    }

    return this.adaptService.getTrackedRegressionsCount(testRunId, ctx.roles, ctx.organizations);
  }

  @Get('conclusion/:testRunId')
  @ApiOperation({ summary: 'Get ds_adapt_conclusion data for a test run' })
  @ApiResponse({
    status: 200,
    description: 'DS Adapt conclusion retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        test_run_id: { type: 'string' },
        control_group_id: { type: 'string' },
        regressions: { type: 'array', items: { type: 'string' } },
        improvements: { type: 'array', items: { type: 'string' } },
        differences: { type: 'array', items: { type: 'string' } },
        tracked_regressions: { type: 'array', items: { type: 'string' } },
        conclusion: { type: 'string' },
        details: { type: 'object' },
        updated_at: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Conclusion not found' })
  async getDsAdaptConclusion(@Param('testRunId') testRunId: string, @UserCtx() ctx: UserContext) {
    if (!testRunId) {
      throw new ValidationException('testRunId is required');
    }

    return this.adaptService.getDsAdaptConclusion(testRunId, ctx.roles, ctx.organizations);
  }

  @Get('conclusion/:testRunId/enriched')
  @ApiOperation({ summary: 'Get enriched adapt conclusion with resolved metric details' })
  @ApiResponse({ status: 200, description: 'Enriched conclusion with regression/improvement details' })
  @ApiResponse({ status: 404, description: 'Conclusion not found' })
  async getEnrichedConclusion(@Param('testRunId') testRunId: string, @UserCtx() ctx: UserContext) {
    if (!testRunId) {
      throw new ValidationException('testRunId is required');
    }

    return this.adaptService.getEnrichedConclusion(testRunId, ctx.roles, ctx.organizations);
  }

  @Post('tracked-regressions/resolve')
  @ApiOperation({ summary: 'Resolve all tracked regressions for a tracked test run' })
  @ApiResponse({
    status: 200,
    description: 'Tracked regressions resolved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        resolvedCount: { type: 'number' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 404, description: 'Tracked regressions not found' })
  async resolveTrackedRegressions(
    @Body() body: { trackedTestRunId: string; resolution: string },
    @UserCtx() ctx: UserContext,
  ): Promise<{ success: boolean; message: string; resolvedCount: number }> {
    if (!body.trackedTestRunId) {
      throw new ValidationException('trackedTestRunId is required');
    }

    if (!body.resolution) {
      throw new ValidationException('resolution is required');
    }

    return this.adaptService.resolveTrackedRegressionsByTestRun(body.trackedTestRunId, body.resolution, ctx.roles, ctx.organizations);
  }

  @Post('tracked-regressions/resolve-individual')
  @ApiOperation({ summary: 'Resolve a single tracked regression' })
  @ApiResponse({
    status: 200,
    description: 'Regression resolved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 404, description: 'Regression not found' })
  async resolveTrackedRegression(
    @Body() body: { regressionId: string } & ResolveTrackedRegressionDto,
    @UserCtx() ctx: UserContext,
  ): Promise<{ success: boolean; message: string }> {
    if (!body.regressionId) {
      throw new ValidationException('regressionId is required');
    }

    const { regressionId, ...resolutionData } = body;

    return this.adaptService.resolveTrackedRegression(regressionId, resolutionData, ctx.roles, ctx.organizations);
  }

  @Get('tracked-differences/:metricName')
  @ApiOperation({ summary: 'Get tracked differences chart data for a metric' })
  @ApiResponse({
    status: 200,
    description: 'Chart data retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              testRunId: { type: 'string' },
              date: { type: 'string' },
              value: { type: 'number' },
              controlGroup: { type: 'boolean' },
              selectedTestRun: { type: 'boolean' },
              regression: { type: 'boolean' },
              thresholds: {
                type: 'object',
                properties: {
                  upper: { type: 'number' },
                  lower: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid parameters' })
  @ApiQuery({ name: 'testRunId', description: 'Test run ID', required: true })
  @ApiQuery({ name: 'limit', description: 'Maximum number of data points', required: false })
  async getTrackedDifferencesChart(
    @Param('metricName') metricName: string,
    @UserCtx() ctx: UserContext,
    @Query('testRunId') testRunId: string,
    @Query('limit') limit?: string,
  ): Promise<{ data: any[] }> {
    if (!metricName || !testRunId) {
      throw new ValidationException('metricName and testRunId are required');
    }

    const limitNum = limit ? parseInt(limit, 10) : 50;

    if (isNaN(limitNum) || limitNum <= 0) {
      throw new BadRequestException('limit must be a positive number');
    }

    const data = await this.adaptService.getTrackedDifferencesChart(metricName, testRunId, limitNum, ctx.roles, ctx.organizations);

    return { data };
  }

  @Get('correlated-regressions')
  @ApiOperation({ summary: 'Get regressions that occurred with a tracked regression' })
  @ApiResponse({
    status: 200,
    description: 'Correlated regressions retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        regressions: {
          type: 'array',
          items: { $ref: '#/components/schemas/TrackedRegressionDto' },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid parameters' })
  @ApiQuery({ name: 'trackedRegressionId', description: 'Tracked regression ID', required: true })
  @ApiQuery({ name: 'sourceTestRun', description: 'Source test run ID', required: true })
  async getCorrelatedRegressions(
    @UserCtx() ctx: UserContext,
    @Query('trackedRegressionId') trackedRegressionId: string,
    @Query('sourceTestRun') sourceTestRun: string,
  ): Promise<{ regressions: TrackedRegressionDto[] }> {
    if (!trackedRegressionId || !sourceTestRun) {
      throw new ValidationException('trackedRegressionId and sourceTestRun are required');
    }

    const regressions = await this.adaptService.getCorrelatedRegressions(
      trackedRegressionId,
      sourceTestRun,
      ctx.roles,
      ctx.organizations,
    );

    return { regressions };
  }

  @Get('tracked-regression-chart')
  @ApiOperation({ summary: 'Get chart data for a specific tracked regression' })
  @ApiResponse({
    status: 200,
    description: 'Chart data retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        testRuns: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              testRunId: { type: 'string' },
              date: { type: 'string' },
              value: { type: 'number' },
              isControlGroup: { type: 'boolean' },
              isSourceTestRun: { type: 'boolean' },
              hasRegression: { type: 'boolean' },
              percentageChange: { type: 'number' },
              thresholds: {
                type: 'object',
                properties: {
                  upper: { type: 'number' },
                  lower: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid parameters' })
  @ApiQuery({ name: 'trackedRegressionId', description: 'Tracked regression ID', required: true })
  @ApiQuery({ name: 'metricName', description: 'Metric name', required: true })
  async getTrackedRegressionChart(
    @UserCtx() ctx: UserContext,
    @Query('trackedRegressionId') trackedRegressionId: string,
    @Query('metricName') metricName: string,
  ): Promise<{ testRuns: any[] }> {
    if (!trackedRegressionId || !metricName) {
      throw new ValidationException('trackedRegressionId and metricName are required');
    }

    // This would be implemented to get detailed chart data for a specific regression
    // For now, return a basic structure
    const testRuns = await this.adaptService.getTrackedDifferencesChart(metricName, trackedRegressionId, 50, ctx.roles, ctx.organizations);

    return {
      testRuns: testRuns.map(run => ({
        ...run,
        isControlGroup: run.controlGroup,
        isSourceTestRun: run.selectedTestRun,
        hasRegression: run.regression,
        percentageChange: 0, // Would be calculated
      })),
    };
  }
}