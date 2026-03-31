import { Controller, Get, Put, Delete, Post, Param, Query, Body, BadRequestException, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { UserCtx, UserContext } from '../../../common/decorators/user-context.decorator';
import { TestRunsService } from '../test-runs.service';
import { TestRunsBaselineApdexService } from '../services/test-runs-baseline-apdex.service';
import { SetApdexThresholdDto, WorkloadApdexThresholdDto, WorkloadTransactionApdexThresholdDto } from '../dto/apdex-threshold.dto';
import {
  BaselineApdexPreviewDto,
  BaselineApdexApplyDto,
  BaselinePreviewResponseDto,
  BaselineApplyResponseDto,
} from '../dto/baseline-apdex.dto';

/**
 * Apdex threshold management and baseline configuration endpoints.
 * Handles workload-level and transaction-level Apdex thresholds, preview calculations, and baseline applications.
 */
@ApiTags('test-runs-metrics')
@ApiBearerAuth()
@Controller('test-runs')
export class TestRunsMetricsApdexController {
  private readonly logger = new Logger(TestRunsMetricsApdexController.name);

  constructor(
    private readonly testRunsService: TestRunsService,
    private readonly baselineApdexService: TestRunsBaselineApdexService,
  ) {}

  // ==================== Apdex Threshold Endpoints ====================

  @Get(':testRunId/apdex-threshold')
  @ApiOperation({ summary: 'Get workload-level Apdex threshold' })
  @ApiParam({ name: 'testRunId', description: 'Test run ID', type: String })
  @ApiResponse({
    status: 200,
    description: 'Workload-level Apdex threshold retrieved successfully',
    type: WorkloadApdexThresholdDto,
  })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async getTestApdexThreshold(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<WorkloadApdexThresholdDto> {
    this.logger.debug('Getting test Apdex threshold', { testRunId });
    return this.testRunsService.getTestApdexThreshold(testRunId, ctx.userId, ctx.roles);
  }

  @Put(':testRunId/apdex-threshold')
  @ApiOperation({ summary: 'Set workload-level Apdex threshold' })
  @ApiParam({ name: 'testRunId', description: 'Test run ID', type: String })
  @ApiResponse({
    status: 200,
    description: 'Workload-level Apdex threshold updated successfully',
    type: WorkloadApdexThresholdDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid threshold value (must be 1-60000ms)' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async setTestApdexThreshold(
    @Param('testRunId') testRunId: string,
    @Body() dto: SetApdexThresholdDto,
    @UserCtx() ctx: UserContext,
  ): Promise<WorkloadApdexThresholdDto> {
    this.logger.debug('Setting test Apdex threshold', { testRunId, threshold: dto.apdex_threshold });
    return this.testRunsService.setTestApdexThreshold(testRunId, dto, ctx.userId, ctx.roles);
  }

  @Get(':testRunId/transactions/apdex-thresholds')
  @ApiOperation({ summary: 'Get all transaction-level Apdex thresholds for a workload' })
  @ApiParam({ name: 'testRunId', description: 'Test run ID', type: String })
  @ApiResponse({
    status: 200,
    description: 'Transaction-level Apdex thresholds retrieved successfully',
    type: [WorkloadTransactionApdexThresholdDto],
  })
  async getTransactionApdexThresholds(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<WorkloadTransactionApdexThresholdDto[]> {
    this.logger.debug('Getting transaction Apdex thresholds', { testRunId });
    return this.testRunsService.getTransactionApdexThresholds(testRunId, ctx.userId, ctx.roles);
  }

  @Put(':testRunId/transactions/:transactionName/apdex-threshold')
  @ApiOperation({ summary: 'Set transaction-level Apdex threshold (creates or updates)' })
  @ApiParam({ name: 'testRunId', description: 'Test run ID', type: String })
  @ApiParam({ name: 'transactionName', description: 'Transaction name', type: String })
  @ApiResponse({
    status: 200,
    description: 'Transaction-level Apdex threshold set successfully',
    type: WorkloadTransactionApdexThresholdDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid threshold value (must be 1-60000ms)' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async setTransactionApdexThreshold(
    @Param('testRunId') testRunId: string,
    @Param('transactionName') transactionName: string,
    @Body() dto: SetApdexThresholdDto,
    @UserCtx() ctx: UserContext,
  ): Promise<WorkloadTransactionApdexThresholdDto> {
    this.logger.debug('Setting transaction Apdex threshold', { testRunId, transactionName, threshold: dto.apdex_threshold });
    return this.testRunsService.setTransactionApdexThreshold(testRunId, transactionName, dto, ctx.userId, ctx.roles);
  }

  @Delete(':testRunId/transactions/:transactionName/apdex-threshold')
  @ApiOperation({ summary: 'Delete transaction-level Apdex threshold (reverts to workload-level default)' })
  @ApiParam({ name: 'testRunId', description: 'Test run ID', type: String })
  @ApiParam({ name: 'transactionName', description: 'Transaction name', type: String })
  @ApiResponse({
    status: 200,
    description: 'Transaction-level Apdex threshold deleted successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Threshold for transaction database_call reset to workload default' }
      }
    }
  })
  @ApiResponse({ status: 404, description: 'Transaction threshold not found' })
  async deleteTransactionApdexThreshold(
    @Param('testRunId') testRunId: string,
    @Param('transactionName') transactionName: string,
    @UserCtx() ctx: UserContext,
  ): Promise<{ message: string }> {
    this.logger.debug('Deleting transaction Apdex threshold', { testRunId, transactionName });
    return this.testRunsService.deleteTransactionApdexThreshold(testRunId, transactionName, ctx.userId, ctx.roles);
  }

  @Get(':testRunId/transactions/:transactionName/apdex-preview')
  @ApiOperation({
    summary: 'Preview Apdex score for a transaction with a different threshold',
    description: 'Calculate what the Apdex score would be for a transaction if a different threshold were applied. Uses actual response time data from the test run.'
  })
  @ApiParam({ name: 'testRunId', description: 'Test run ID', type: String })
  @ApiParam({ name: 'transactionName', description: 'Transaction name', type: String })
  @ApiQuery({ name: 'threshold', description: 'Threshold in milliseconds to preview', type: Number, required: true })
  @ApiResponse({
    status: 200,
    description: 'Apdex preview calculated successfully',
    schema: {
      type: 'object',
      properties: {
        transaction_name: { type: 'string', example: 'database_call' },
        threshold: { type: 'number', example: 500 },
        apdex_score: { type: 'number', example: 0.95 },
        sample_count: { type: 'number', example: 1000 },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid threshold value' })
  @ApiResponse({ status: 404, description: 'Test run or transaction not found' })
  async previewTransactionApdex(
    @Param('testRunId') testRunId: string,
    @Param('transactionName') transactionName: string,
    @Query('threshold') threshold: string,
    @UserCtx() ctx: UserContext,
  ): Promise<{ transaction_name: string; threshold: number; apdex_score: number; sample_count: number }> {
    const thresholdMs = parseInt(threshold, 10);
    if (isNaN(thresholdMs) || thresholdMs < 1 || thresholdMs > 60000) {
      throw new BadRequestException('Threshold must be a number between 1 and 60000 milliseconds');
    }
    this.logger.debug('Previewing transaction Apdex', { testRunId, transactionName, thresholdMs });
    return this.baselineApdexService.previewTransactionApdex(testRunId, transactionName, thresholdMs, ctx.userId, ctx.roles);
  }

  // ==================== Baseline Apdex Endpoints ====================

  @Post(':testRunId/baseline-apdex/preview')
  @ApiOperation({
    summary: 'Preview baseline Apdex threshold calculation',
    description: 'Calculate optimal Apdex thresholds to achieve target score without applying changes. Uses binary search algorithm to find thresholds that meet the target Apdex score.'
  })
  @ApiParam({ name: 'testRunId', description: 'Test run ID', type: String })
  @ApiResponse({
    status: 200,
    description: 'Baseline Apdex preview calculated successfully',
    type: BaselinePreviewResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request data or target Apdex out of range' })
  @ApiResponse({ status: 404, description: 'Test run not found or no transaction data available' })
  async previewBaselineApdex(
    @Param('testRunId') testRunId: string,
    @Body() dto: BaselineApdexPreviewDto,
    @UserCtx() ctx: UserContext,
  ): Promise<BaselinePreviewResponseDto> {
    this.logger.debug('Previewing baseline Apdex', { testRunId, dto });
    return this.baselineApdexService.previewBaselineApdex(testRunId, dto, ctx.userId, ctx.roles);
  }

  @Post(':testRunId/baseline-apdex/apply')
  @ApiOperation({
    summary: 'Apply baseline Apdex thresholds',
    description: 'Calculate and apply optimal Apdex thresholds to achieve target score. Thresholds are persisted to workload_apdex_thresholds or workload_transaction_apdex_thresholds based on scope.'
  })
  @ApiParam({ name: 'testRunId', description: 'Test run ID', type: String })
  @ApiResponse({
    status: 200,
    description: 'Baseline Apdex thresholds applied successfully',
    type: BaselineApplyResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request data or target Apdex out of range' })
  @ApiResponse({ status: 404, description: 'Test run not found or no transaction data available' })
  async applyBaselineApdex(
    @Param('testRunId') testRunId: string,
    @Body() dto: BaselineApdexApplyDto,
    @UserCtx() ctx: UserContext,
  ): Promise<BaselineApplyResponseDto> {
    this.logger.debug('Applying baseline Apdex', { testRunId, dto });
    return this.baselineApdexService.applyBaselineApdex(testRunId, dto, ctx.userId, ctx.roles);
  }
}
