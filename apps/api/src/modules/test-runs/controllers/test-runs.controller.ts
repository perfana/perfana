import { Controller, Get, Delete, Post, Put, Param, Query, Body, ParseUUIDPipe, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { TestRunsService } from '../test-runs.service';
import { PaginationQueryDto, TestRunQueryDto } from '../../../common/dto';
import { ValidationException } from '../../../common/exceptions/business.exception';
import { UuidValidationPipe } from '../../../common/pipes';
import { UserCtx, UserContext } from '../../../common/decorators/user-context.decorator';
import { BulkDeleteTestRunsDto } from '../dto/bulk-delete-test-runs.dto';
import { TestRunDeletionProcessor } from '../processors/test-run-deletion.processor';

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
  private readonly logger = new Logger(TestRunsController.name);

  constructor(
    private readonly testRunsService: TestRunsService,
    private readonly testRunDeletionProcessor: TestRunDeletionProcessor,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get all test runs (paginated)',
    description: 'Retrieves test runs with pagination support. Defaults to page 1, 50 items per page. Use pagination parameters for better performance with large datasets.'
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (1-indexed)', example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: 'Items per page (max 100)', example: 50 })
  @ApiQuery({ name: 'sortBy', required: false, type: String, description: 'Field to sort by', example: 'createdAt', enum: ['createdAt', 'testRunId', 'workload', 'testEnvironment', 'startTime', 'endTime'] })
  @ApiQuery({ name: 'sortOrder', required: false, type: String, description: 'Sort order', example: 'DESC', enum: ['ASC', 'DESC'] })
  @ApiQuery({ name: 'system', required: false, type: String, description: 'Filter by system under test name' })
  @ApiQuery({ name: 'environment', required: false, type: String, description: 'Filter by test environment' })
  @ApiQuery({ name: 'workload', required: false, type: String, description: 'Filter by workload' })
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

  @Get('filter-options')
  @ApiOperation({
    summary: 'Get distinct filter options for test runs',
    description: 'Returns distinct system names, environments, and workloads for populating filter dropdowns.',
  })
  @ApiQuery({ name: 'organizationId', required: false, type: String, description: 'Filter by organization' })
  @ApiResponse({ status: 200, description: 'Filter options retrieved successfully' })
  async getFilterOptions(
    @Query('organizationId') organizationId: string | undefined,
    @UserCtx() ctx: UserContext,
  ) {
    return this.testRunsService.getFilterOptions(ctx.userId, ctx.roles, organizationId);
  }

  @Post('bulk-delete')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Queue multiple test runs for deletion',
    description: 'Queues the specified test runs for asynchronous deletion via a background job queue. Returns immediately with 202 Accepted. Deletions are processed sequentially to prevent database deadlocks.',
  })
  @ApiBody({ type: BulkDeleteTestRunsDto })
  @ApiResponse({ status: 202, description: 'Test runs queued for deletion' })
  @ApiResponse({ status: 400, description: 'Invalid request or some IDs already queued for deletion' })
  async bulkDelete(
    @Body() dto: BulkDeleteTestRunsDto,
    @UserCtx() ctx: UserContext,
  ) {
    // Check which IDs are already queued for deletion
    const existing = await this.testRunsService.findByIds(dto.ids);
    const existingIds = new Set(existing.map(tr => tr.id));
    const notFound = dto.ids.filter(id => !existingIds.has(id));

    if (notFound.length > 0) {
      throw new ValidationException(`Test runs not found: ${notFound.join(', ')}`);
    }

    const alreadyQueued = existing
      .filter(tr => tr.deletionStatus !== null && tr.deletionStatus !== undefined)
      .map(tr => tr.id);

    // Filter out already-queued IDs
    const idsToQueue = dto.ids.filter(id => !alreadyQueued.includes(id));

    if (idsToQueue.length === 0) {
      return {
        message: 'All specified test runs are already queued for deletion',
        queued: 0,
        skipped: alreadyQueued,
      };
    }

    // Mark as queued in the database
    await this.testRunDeletionProcessor.markQueued(idsToQueue);

    if (this.testRunDeletionProcessor.isAvailable()) {
      // Queue via BullMQ for sequential processing
      await this.testRunDeletionProcessor.addBulkJobs(idsToQueue, {
        userId: ctx.userId,
        roles: ctx.roles,
        organizationId: ctx.organizationId,
        teamId: ctx.teamId,
      });

      this.logger.log(`Queued ${idsToQueue.length} test runs for async deletion by user ${ctx.userId}`);
    } else {
      // Redis unavailable — process synchronously one at a time
      this.logger.warn('Redis unavailable, processing deletions synchronously');
      for (const id of idsToQueue) {
        await this.testRunDeletionProcessor.processSync(id, {
          userId: ctx.userId,
          organizationId: ctx.organizationId,
          teamId: ctx.teamId,
        });
      }
    }

    return {
      message: `Queued ${idsToQueue.length} test run(s) for deletion`,
      queued: idsToQueue.length,
      ids: idsToQueue,
      ...(alreadyQueued.length > 0 ? { skipped: alreadyQueued } : {}),
    };
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
      this.testRunsService.recordTestRunView(ctx.userId, result.id).catch(() => { /* fire-and-forget */ });
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
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Delete a test run by UUID',
    description: 'Queues the test run for asynchronous deletion. Falls back to synchronous deletion if Redis is unavailable.',
  })
  @ApiParam({ name: 'id', description: 'Test run UUID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @ApiResponse({ status: 202, description: 'Test run deletion queued' })
  @ApiResponse({ status: 400, description: 'Invalid UUID format' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async deleteTestRun(
    @Param('id', ParseUUIDPipe) id: string,
    @UserCtx() ctx: UserContext,
  ) {
    // Check if already queued for deletion (same guard as bulk-delete)
    const existing = await this.testRunsService.findByIds([id]);
    if (existing.length === 0) {
      throw new ValidationException(`Test run not found: ${id}`);
    }
    const testRun = existing[0];
    if (testRun && testRun.deletionStatus) {
      return { message: 'Test run is already queued for deletion', status: testRun.deletionStatus };
    }

    // Mark as queued
    await this.testRunDeletionProcessor.markQueued([id]);

    if (this.testRunDeletionProcessor.isAvailable()) {
      await this.testRunDeletionProcessor.addJob(id, {
        userId: ctx.userId,
        roles: ctx.roles,
        organizationId: ctx.organizationId,
        teamId: ctx.teamId,
      });

      return {
        message: 'Test run deletion queued',
        status: 'queued',
      };
    }

    // Fallback: synchronous deletion when Redis is unavailable
    this.logger.warn(`Redis unavailable, deleting test run ${id} synchronously`);
    await this.testRunDeletionProcessor.processSync(id, {
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      teamId: ctx.teamId,
    });

    return {
      message: 'Test run deleted successfully',
    };
  }
}
