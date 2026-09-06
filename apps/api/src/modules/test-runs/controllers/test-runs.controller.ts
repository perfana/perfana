import { Controller, Get, Delete, Post, Put, Patch, Param, Query, Body, ParseUUIDPipe, HttpCode, HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { TestRunsService } from '../test-runs.service';
import { SummaryTimeseriesResponse } from '../services/test-runs-performance-query.service';
import { PaginationQueryDto, TestRunQueryDto } from '../../../common/dto';
import { ValidationException } from '../../../common/exceptions/business.exception';
import { UuidValidationPipe } from '../../../common/pipes';
import { UserCtx, UserContext } from '../../../common/decorators/user-context.decorator';
import { BulkDeleteTestRunsDto } from '../dto/bulk-delete-test-runs.dto';
import { TestRunDeletionProcessor } from '../processors/test-run-deletion.processor';

/** postgres `integer` upper bound — `test_runs.ramp_up` / `ramp_down` are int4. */
const INT4_MAX = 2147483647;

/**
 * Can `test_runs.ramp_up` / `ramp_down` actually store this value?
 *
 * `typeof x === 'number' && x >= 0` is not enough, and the gap is not theoretical:
 * `JSON.parse` yields `Infinity` for the literal `1e999`, floats pass unchanged, and
 * `999999999999` is a perfectly ordinary number. All three reach
 * `UPDATE test_runs SET ramp_up = $1` against an INTEGER column and die inside the
 * driver, so a malformed request is served as a 500 instead of the 400 it is.
 *
 * Shared by the PUT (body, already a number) and the scope preview (query string,
 * parsed to a number first) so the two routes cannot disagree about what is storable —
 * a preview that accepts what the write rejects is worse than no preview.
 */
function isStorableOffset(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= INT4_MAX;
}

const OFFSET_RANGE_MESSAGE =
  `must be non-negative whole numbers of seconds, no greater than ${INT4_MAX}`;

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
  @ApiQuery({ name: 'system', required: false, type: String, description: 'Selected system — constrains environment and workload options to existing combinations' })
  @ApiQuery({ name: 'environment', required: false, type: String, description: 'Selected environment — constrains system and workload options to existing combinations' })
  @ApiQuery({ name: 'workload', required: false, type: String, description: 'Selected workload — constrains system and environment options to existing combinations' })
  @ApiResponse({ status: 200, description: 'Filter options retrieved successfully' })
  async getFilterOptions(
    @Query('organizationId') organizationId: string | undefined,
    @Query('system') system: string | undefined,
    @Query('environment') environment: string | undefined,
    @Query('workload') workload: string | undefined,
    @UserCtx() ctx: UserContext,
  ) {
    // HTTP parameter pollution: ?system=a&system=b arrives as string[], ?system[a]=b
    // as an object (qs extended parser). Accept only plain strings; anything else is
    // dropped instead of surfacing a 500 from the query layer.
    const one = (v: string | string[] | undefined): string | undefined => {
      if (typeof v === 'string') return v;
      if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
      return undefined;
    };
    return this.testRunsService.getFilterOptions(ctx.userId, ctx.roles, one(organizationId), {
      system: one(system),
      environment: one(environment),
      workload: one(workload),
    });
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

  @Put(':id/application-release')
  @ApiOperation({ summary: "Update a test run's version (application release)" })
  @ApiResponse({ status: 200, description: 'Version updated successfully' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  async updateApplicationRelease(
    @Param('id') id: string,
    @Body() body: { applicationRelease: string },
    @UserCtx() ctx: UserContext,
  ) {
    if (typeof body.applicationRelease !== 'string') {
      throw new ValidationException('applicationRelease must be a string');
    }
    // A version is a label on a run, not a document — long enough for a git sha and a tag.
    if (body.applicationRelease.length > 255) {
      throw new ValidationException('applicationRelease must be 255 characters or fewer');
    }

    return this.testRunsService.updateApplicationRelease(id, body.applicationRelease, ctx.userId, ctx.roles);
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

  @Put(':id/analysis-start-offset')
  @ApiOperation({ summary: 'Update test run analysis start offset' })
  @ApiResponse({ status: 200, description: 'Analysis start offset updated successfully' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  async updateAnalysisStartOffset(
    @Param('id') id: string,
    @Body() body: { analysisStartOffset: number },
    @UserCtx() ctx: UserContext,
  ) {
    // Same int4 ceiling as the time-range PUT below — this route writes the same column.
    if (!isStorableOffset(body.analysisStartOffset)) {
      throw new ValidationException(`analysisStartOffset ${OFFSET_RANGE_MESSAGE}`);
    }

    return this.testRunsService.updateAnalysisStartOffset(id, body.analysisStartOffset, ctx.userId, ctx.roles);
  }

  @Get(':id/analysis-time-range/scope')
  @ApiOperation({
    summary: 'Preview which runs an "apply to all" analysis time range change would affect',
    description:
      'Read-only. Returns how many runs of this run\'s system/environment/workload would take the ' +
      'given offsets, and which would be left alone and why (still running, shorter than the ' +
      'offsets, or on another team). Lets a client state the blast radius before committing.',
  })
  @ApiResponse({ status: 200, description: 'Scope preview' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  // The swagger CLI plugin is not enabled in nest-cli.json, so @Query() params are never
  // inferred — every query parameter in this controller has to be declared by hand or it
  // is simply absent from /api/docs.
  @ApiQuery({ name: 'analysisStartOffset', required: true, type: Number, description: 'Proposed analysis start offset (ramp-up) in seconds' })
  @ApiQuery({ name: 'analysisEndOffset', required: true, type: Number, description: 'Proposed analysis end offset (ramp-down) in seconds' })
  async previewAnalysisTimeRangeScope(
    @Param('id', UuidValidationPipe) id: string,
    @Query('analysisStartOffset') analysisStartOffset: string,
    @Query('analysisEndOffset') analysisEndOffset: string,
    @UserCtx() ctx: UserContext,
  ) {
    // Query params arrive as strings, and Number() is too permissive to use alone here:
    // Number('') is 0, not NaN, so `?analysisStartOffset=` would pass a finite,
    // non-negative 0 and preview the NO-TRIM scope — a wrong count in the confirmation
    // dialog the user is about to act on. An OMITTED param is undefined -> NaN and is
    // caught, so only the explicitly-empty case needs the extra arm.
    //
    // The declared `string` type is a lie the framework does not enforce: HTTP parameter
    // pollution (`?analysisStartOffset=1&analysisStartOffset=2`) hands this a string[],
    // and `?analysisStartOffset[a]=b` an object (qs extended parser). `raw.trim()` on
    // either is a TypeError, which surfaces as a 500 and bypasses the very validation
    // this function exists to perform. Take the first element of an array — matching
    // `getFilterOptions` above — and treat anything that is still not a string as NaN so
    // it lands on the existing 400.
    const parse = (raw: unknown): number => {
      const first = Array.isArray(raw) ? raw[0] : raw;
      if (typeof first !== 'string') return Number.NaN;
      const trimmed = first.trim();
      return trimmed === '' ? Number.NaN : Number(trimmed);
    };

    const start = parse(analysisStartOffset);
    const end = parse(analysisEndOffset);
    if (!isStorableOffset(start) || !isStorableOffset(end)) {
      throw new ValidationException(
        `analysisStartOffset and analysisEndOffset ${OFFSET_RANGE_MESSAGE}`,
      );
    }
    return this.testRunsService.previewAnalysisTimeRangeScope(id, start, end, ctx.userId, ctx.roles);
  }

  @Put(':id/analysis-time-range')
  @ApiOperation({ summary: 'Update analysis time range (start and end offsets) for a test run' })
  @ApiResponse({ status: 200, description: 'Analysis time range updated successfully' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  async updateAnalysisTimeRange(
    @Param('id', UuidValidationPipe) id: string,
    @Body() body: { analysisStartOffset: number; analysisEndOffset: number; applyToAll?: boolean },
    @UserCtx() ctx: UserContext,
  ) {
    if (!isStorableOffset(body.analysisStartOffset) || !isStorableOffset(body.analysisEndOffset)) {
      throw new ValidationException(
        `analysisStartOffset and analysisEndOffset ${OFFSET_RANGE_MESSAGE}`,
      );
    }
    if (body.applyToAll !== undefined && typeof body.applyToAll !== 'boolean') {
      throw new ValidationException('applyToAll must be a boolean');
    }
    return this.testRunsService.updateAnalysisTimeRange(
      id,
      body.analysisStartOffset,
      body.analysisEndOffset,
      ctx.userId,
      ctx.roles,
      body.applyToAll === true,
    );
  }

  @Patch(':id/abort')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Abort a running test run', description: 'Sets abort=true and records who triggered it. Rejected if already completed or aborted.' })
  @ApiParam({ name: 'id', description: 'Test run UUID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @ApiResponse({ status: 200, description: 'Test run aborted successfully' })
  @ApiResponse({ status: 400, description: 'Test run already completed or already aborted' })
  @ApiResponse({ status: 403, description: 'Access denied to this test run' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async abortTestRun(
    @Param('id', ParseUUIDPipe) id: string,
    @UserCtx() ctx: UserContext,
  ) {
    await this.testRunsService.verifyTestRunAccess(id, ctx.userId, ctx.roles);
    const userIdentifier = ctx.email ?? ctx.userId;
    return this.testRunsService.abortTestRun(id, ctx.userId, ctx.roles, userIdentifier);
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

  @Get(':id/summary-timeseries')
  @ApiOperation({ summary: 'Get time-bucketed performance summary for the analysis time range dialog' })
  @ApiParam({ name: 'id', description: 'Test run UUID or test_run_id string', example: 'PerfanaWebshop-acc-loadTest-00012' })
  @ApiResponse({ status: 200, description: 'Time-bucketed performance data returned successfully' })
  @ApiResponse({ status: 404, description: 'No performance timeseries data found for the test run' })
  async getSummaryTimeseries(@Param('id', UuidValidationPipe) id: string): Promise<SummaryTimeseriesResponse> {
    const result = await this.testRunsService.getSummaryTimeseries(id);
    if (!result) {
      throw new NotFoundException(`No performance timeseries data found for test run ${id}`);
    }
    return result;
  }
}
