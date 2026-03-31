import { Controller, Get, Delete, Put, Param, Query, Body, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam , ApiBearerAuth } from '@nestjs/swagger';
import { TestRunsService } from '../test-runs.service';
import { PaginationQueryDto, TestRunQueryDto } from '../../../common/dto';
import { ValidationException } from '../../../common/exceptions/business.exception';
import { UuidValidationPipe } from '../../../common/pipes';
import { UserCtx, UserContext } from '../../../common/decorators/user-context.decorator';

/**
 * Core CRUD operations for test runs.
 *
 * Additional endpoints are split into specialized controllers:
 * - TestRunsDashboardController: Dashboard statistics and summaries
 * - TestRunsMetricsTransactionController: Transaction stats, samples, timeseries, virtual users, throughput
 * - TestRunsMetricsApdexController: Apdex threshold management and baseline configuration
 * - TestRunsAnalysisController: Baseline, changepoint, anomaly detection, ADAPT
 * - TestRunsComparisonController: Config comparison, expected changes, check results
 * - TestRunsErrorsController: Error analysis and grouped error statistics
 * - TestController: Test run creation via /test endpoint
 * - ConfigController: Test configuration management
 * - InitController: Init endpoint for test run initialization
 */
@ApiTags('test-runs')
@ApiBearerAuth()
@Controller('test-runs')
export class TestRunsController {
  constructor(private readonly testRunsService: TestRunsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get all test runs (paginated)',
    description: 'Retrieves test runs with pagination support. Defaults to page 1, 50 items per page. Use pagination parameters for better performance with large datasets.'
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (1-indexed)', example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: 'Items per page (max 100)', example: 50 })
  @ApiQuery({ name: 'sortBy', required: false, type: String, description: 'Field to sort by', example: 'createdAt', enum: ['createdAt', 'testRunId', 'workload', 'testEnvironment', 'startTime', 'endTime'] })
  @ApiQuery({ name: 'sortOrder', required: false, type: String, description: 'Sort order', example: 'DESC', enum: ['ASC', 'DESC'] })
  @ApiResponse({
    status: 200,
    description: 'Returns paginated test runs with metadata',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { type: 'object' } },
        total: { type: 'number', example: 1000 },
        page: { type: 'number', example: 1 },
        pageSize: { type: 'number', example: 50 },
        totalPages: { type: 'number', example: 20 },
        hasNextPage: { type: 'boolean', example: true },
        hasPreviousPage: { type: 'boolean', example: false },
      }
    }
  })
  async findAll(
    @Query() paginationDto: PaginationQueryDto,
    @Query('organizationId') organizationId: string | undefined,
    @UserCtx() ctx: UserContext,
  ) {
    return this.testRunsService.findAllPaginated(ctx.userId, ctx.roles, paginationDto, organizationId);
  }

  @Get(':testRunId')
  @ApiOperation({ summary: 'Get a single test run by test_run_id and query parameters' })
  @ApiParam({ name: 'testRunId', description: 'Test run identifier (UUID or test_run_id)', example: 'PaymentService-production-loadTest-001' })
  @ApiResponse({ status: 200, description: 'Test run retrieved successfully' })
  @ApiResponse({ status: 400, description: 'Invalid test run ID format' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async findOne(
    @Param('testRunId', UuidValidationPipe) testRunId: string,
    @Query() query: TestRunQueryDto,
    @Query('organizationId') organizationId: string | undefined,
    @UserCtx() ctx: UserContext,
  ) {
    let result;

    // If query params are provided, use them to find the specific test run
    if (query.system && query.environment && query.workload) {
      result = await this.testRunsService.findByTestRunIdAndParams(
        testRunId,
        query.system,
        query.environment,
        query.workload,
        ctx.userId,
        ctx.roles,
        organizationId,
      );
    } else {
      // Fallback: try to find by test_run_id (most common case)
      result = await this.testRunsService.findByTestRunId(testRunId, ctx.userId, ctx.roles);
    }

    // Fire-and-forget: record that the user viewed this test run
    if (result?.id) {
      this.testRunsService.recordTestRunView(ctx.userId, result.id).catch(() => {});
    }

    return result;
  }

  @Put(':id/annotations')
  @ApiOperation({ summary: 'Update test run annotations' })
  @ApiResponse({ status: 200, description: 'Annotations updated successfully' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  async updateAnnotations(
    @Param('id') id: string,
    @Body() body: { annotations: string[] },
    @UserCtx() ctx: UserContext,
  ) {
    if (!body.annotations || !Array.isArray(body.annotations)) {
      throw new ValidationException('Annotations must be an array of strings');
    }

    return this.testRunsService.updateAnnotations(id, body.annotations, ctx.userId, ctx.roles);
  }

  @Put(':id/tags')
  @ApiOperation({ summary: 'Update test run tags' })
  @ApiResponse({ status: 200, description: 'Tags updated successfully' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  async updateTags(
    @Param('id') id: string,
    @Body() body: { tags: string[] },
    @UserCtx() ctx: UserContext,
  ) {
    if (!body.tags || !Array.isArray(body.tags)) {
      throw new ValidationException('Tags must be an array of strings');
    }

    return this.testRunsService.updateTags(id, body.tags, ctx.userId, ctx.roles);
  }

  @Put(':id/ramp-up')
  @ApiOperation({ summary: 'Update test run ramp-up period' })
  @ApiResponse({ status: 200, description: 'Ramp-up updated successfully' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  async updateRampUp(
    @Param('id') id: string,
    @Body() body: { rampUp: number },
    @UserCtx() ctx: UserContext,
  ) {
    if (body.rampUp === undefined || body.rampUp === null || typeof body.rampUp !== 'number' || body.rampUp < 0) {
      throw new ValidationException('rampUp must be a non-negative number (seconds)');
    }

    return this.testRunsService.updateRampUp(id, body.rampUp, ctx.userId, ctx.roles);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a test run by UUID' })
  @ApiParam({ name: 'id', description: 'Test run UUID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @ApiResponse({ status: 200, description: 'Test run deleted successfully' })
  @ApiResponse({ status: 400, description: 'Invalid UUID format' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async deleteTestRun(
    @Param('id', ParseUUIDPipe) id: string,
    @UserCtx() ctx: UserContext,
  ) {
    await this.testRunsService.deleteTestRun(id, ctx.userId, ctx.roles);

    return {
      message: 'Test run deleted successfully',
    };
  }
}
