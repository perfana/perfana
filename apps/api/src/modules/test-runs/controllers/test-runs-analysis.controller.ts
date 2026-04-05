import { Controller, Get, Delete, Post, Put, Param, Query, Body, Logger, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { TestRunsService } from '../test-runs.service';
import { CreateMetricClassificationDto, MetricClassificationDto } from '../dto/metric-classification.dto';
import { CreateDsCompareConfigDto, UpdateDsCompareConfigDto, DsCompareConfigDto } from '../dto/ds-compare-config.dto';
import { UpdateAdaptConfigDto } from '../dto/update-adapt-config.dto';
import { MarkChangepointDto } from '../dto/mark-changepoint.dto';
import { DeleteAnomalyDto } from '../dto/delete-anomaly.dto';
import { ValidationException } from '../../../common/exceptions/business.exception';
import { UserCtx, UserContext } from '../../../common/decorators/user-context.decorator';

@ApiTags('test-runs-analysis')
@ApiBearerAuth()
@Controller('test-runs')
export class TestRunsAnalysisController {
  private readonly logger = new Logger(TestRunsAnalysisController.name);

  constructor(private readonly testRunsService: TestRunsService) {}

  // ==================== Baseline Endpoints ====================

  @Get('baseline-candidates')
  @ApiOperation({
    summary: 'Get baseline candidate test runs for comparison',
    description: 'Retrieves test runs suitable for baseline comparison with the same system/environment/workload. Useful for Pyroscope profiling comparisons.'
  })
  @ApiQuery({ name: 'systemUnderTestId', required: true, type: String, description: 'System under test UUID' })
  @ApiQuery({ name: 'testEnvironment', required: true, type: String, description: 'Test environment name' })
  @ApiQuery({ name: 'workload', required: true, type: String, description: 'Workload name' })
  @ApiQuery({ name: 'excludeTestRunId', required: false, type: String, description: 'Test run ID to exclude from results (typically the current test run)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Maximum number of results (default: 50, max: 100)' })
  @ApiResponse({
    status: 200,
    description: 'Baseline candidates retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '550e8400-e29b-41d4-a716-446655440000' },
          test_run_id: { type: 'string', example: 'PaymentService-production-loadTest-001' },
          system_under_test_id: { type: 'string', example: '550e8400-e29b-41d4-a716-446655440000' },
          test_environment: { type: 'string', example: 'production' },
          workload: { type: 'string', example: 'loadTest' },
          start_time: { type: 'string', example: '2025-01-15T10:00:00Z' },
          end_time: { type: 'string', example: '2025-01-15T11:00:00Z' },
          completed: { type: 'boolean', example: true },
          created_at: { type: 'string', example: '2025-01-15T10:00:00Z' }
        }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Missing required query parameters' })
  async getBaselineCandidates(
    @Query('systemUnderTestId') systemUnderTestId: string,
    @Query('testEnvironment') testEnvironment: string,
    @Query('workload') workload: string,
    @UserCtx() ctx: UserContext,
    @Query('excludeTestRunId') excludeTestRunId?: string,
    @Query('limit') limit?: number,
  ) {
    this.logger.debug('Getting baseline candidates', { systemUnderTestId, testEnvironment, workload });

    if (!systemUnderTestId || !testEnvironment || !workload) {
      throw new ValidationException('systemUnderTestId, testEnvironment, and workload are required');
    }

    // Limit the maximum number of results to prevent excessive data transfer
    const safeLimit = limit ? Math.min(Math.max(1, limit), 100) : 50;

    return this.testRunsService.getBaselineCandidates(
      systemUnderTestId,
      testEnvironment,
      workload,
      ctx.userId,
      ctx.roles,
      excludeTestRunId,
      safeLimit,
    );
  }

  // ==================== Changepoint Endpoints ====================

  @Get('test-runs-after-changepoint')
  @ApiOperation({ summary: 'Get test runs after the most recent changepoint' })
  @ApiResponse({ status: 200, description: 'Test runs retrieved successfully' })
  @ApiResponse({ status: 400, description: 'Invalid parameters' })
  async getTestRunsAfterChangepoint(
    @Query('systemUnderTestId') systemUnderTestId: string,
    @Query('testEnvironment') testEnvironment: string,
    @Query('workload') workload: string,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug('Getting test runs after changepoint', { systemUnderTestId, testEnvironment, workload });

    if (!systemUnderTestId || !testEnvironment || !workload) {
      throw new ValidationException('systemUnderTestId, testEnvironment, and workload are required');
    }

    return this.testRunsService.getTestRunsAfterMostRecentChangepoint(
      systemUnderTestId,
      testEnvironment,
      workload,
      ctx.userId,
      ctx.roles,
    );
  }

  @Get('test-runs-more-recent-than')
  @ApiOperation({ summary: 'Get test runs more recent than a specific test run' })
  @ApiQuery({ name: 'systemUnderTestId', required: true, type: String, description: 'System under test ID' })
  @ApiQuery({ name: 'testEnvironment', required: true, type: String, description: 'Test environment' })
  @ApiQuery({ name: 'workload', required: true, type: String, description: 'Workload type' })
  @ApiQuery({ name: 'baseTestRunId', required: true, type: String, description: 'Base test run ID to compare against' })
  @ApiResponse({ status: 200, description: 'Test runs retrieved successfully' })
  @ApiResponse({ status: 400, description: 'Invalid parameters' })
  async getTestRunsMoreRecentThan(
    @Query('systemUnderTestId') systemUnderTestId: string,
    @Query('testEnvironment') testEnvironment: string,
    @Query('workload') workload: string,
    @Query('baseTestRunId') baseTestRunId: string,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug('Getting test runs more recent than', { systemUnderTestId, testEnvironment, workload, baseTestRunId });

    if (!systemUnderTestId || !testEnvironment || !workload || !baseTestRunId) {
      throw new ValidationException('systemUnderTestId, testEnvironment, workload, and baseTestRunId are required');
    }

    return this.testRunsService.getTestRunsMoreRecentThan(
      systemUnderTestId,
      testEnvironment,
      workload,
      baseTestRunId,
      ctx.userId,
      ctx.roles,
    );
  }

  @Post('mark-changepoint')
  @ApiOperation({ summary: 'Mark a test run as a changepoint' })
  @ApiResponse({ status: 201, description: 'Test run marked as changepoint successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async markAsChangepoint(
    @Body() markChangepointDto: MarkChangepointDto,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug('Marking test run as changepoint', { markChangepointDto });

    await this.testRunsService.verifyTestRunAccess(markChangepointDto.testRunId, ctx.userId, ctx.roles);
    return this.testRunsService.markAsChangepoint(
      markChangepointDto.systemUnderTestId,
      markChangepointDto.testEnvironment,
      markChangepointDto.workload,
      markChangepointDto.testRunId,
    );
  }

  @Delete('remove-changepoint')
  @ApiOperation({ summary: 'Remove a test run as a changepoint' })
  @ApiResponse({ status: 200, description: 'Test run changepoint removed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async removeChangepoint(
    @Body() markChangepointDto: MarkChangepointDto,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug('Removing test run changepoint', { markChangepointDto });

    await this.testRunsService.verifyTestRunAccess(markChangepointDto.testRunId, ctx.userId, ctx.roles);
    return this.testRunsService.removeChangepoint(
      markChangepointDto.systemUnderTestId,
      markChangepointDto.testEnvironment,
      markChangepointDto.workload,
      markChangepointDto.testRunId,
    );
  }

  // ==================== DS Compare Config Endpoints ====================

  @Post('ds-compare-config')
  @ApiOperation({ summary: 'Create or update ds-compare configuration for a metric or panel' })
  @ApiResponse({ status: 201, description: 'DS compare configuration created successfully', type: DsCompareConfigDto })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  async createOrUpdateDsCompareConfig(
    @Body() createDto: CreateDsCompareConfigDto,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug('Creating/updating DS compare config', { createDto });

    return this.testRunsService.createOrUpdateDsCompareConfig(createDto, ctx.userId, ctx.roles);
  }

  @Get('ds-compare-config')
  @ApiOperation({ summary: 'Get ds-compare configuration for a metric or panel' })
  @ApiResponse({ status: 200, description: 'DS compare configuration retrieved successfully', type: DsCompareConfigDto })
  @ApiResponse({ status: 404, description: 'Configuration not found' })
  async getDsCompareConfig(
    @Query('systemUnderTestId') systemUnderTestId: string,
    @Query('testEnvironment') testEnvironment: string,
    @Query('workload') workload: string,
    @Query('applicationDashboardId') applicationDashboardId: string,
    @Query('panelId') panelId: string,
    @UserCtx() ctx: UserContext,
    @Query('metricName') metricName?: string,
  ) {
    this.logger.debug('Getting DS compare config', { systemUnderTestId, testEnvironment, workload, applicationDashboardId, panelId });

    if (!systemUnderTestId || !testEnvironment || !workload || !applicationDashboardId || !panelId) {
      throw new ValidationException('systemUnderTestId, testEnvironment, workload, applicationDashboardId, and panelId are required');
    }

    return this.testRunsService.getDsCompareConfig(
      systemUnderTestId,
      testEnvironment,
      workload,
      applicationDashboardId,
      panelId,
      metricName,
      ctx.userId,
      ctx.roles,
    );
  }

  @Put('ds-compare-config/:id')
  @ApiOperation({ summary: 'Update ds-compare configuration' })
  @ApiResponse({ status: 200, description: 'DS compare configuration updated successfully', type: DsCompareConfigDto })
  @ApiResponse({ status: 404, description: 'Configuration not found' })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  async updateDsCompareConfig(
    @Param('id') id: string,
    @Body() updateDto: UpdateDsCompareConfigDto,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug('Updating DS compare config', { id, updateDto });

    return this.testRunsService.updateDsCompareConfig(id, updateDto, ctx.userId, ctx.roles);
  }

  @Delete('ds-compare-config/:id')
  @ApiOperation({ summary: 'Delete ds-compare configuration' })
  @ApiResponse({ status: 200, description: 'DS compare configuration deleted successfully' })
  @ApiResponse({ status: 404, description: 'Configuration not found' })
  async deleteDsCompareConfig(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug('Deleting DS compare config', { id });

    await this.testRunsService.deleteDsCompareConfig(id, ctx.userId, ctx.roles);

    return {
      message: 'DS compare configuration deleted successfully',
    };
  }

  // ==================== Anomaly Detection Endpoints ====================

  @Get(':testRunId/anomaly-detection')
  @ApiOperation({ summary: 'Get anomaly detection results for a test run' })
  @ApiResponse({ status: 200, description: 'Anomaly detection results retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async getAnomalyDetectionResults(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
    @Query('system') system?: string,
    @Query('environment') environment?: string,
    @Query('workload') workload?: string,
  ) {
    this.logger.debug('Getting anomaly detection results', { testRunId, system, environment, workload });

    await this.testRunsService.verifyTestRunAccess(testRunId, ctx.userId, ctx.roles);
    return this.testRunsService.getAnomalyDetectionResults(
      testRunId,
      system,
      environment,
      workload,
    );
  }

  @Delete(':testRunId/anomaly-data')
  @ApiOperation({
    summary: 'Delete anomaly data',
    description: 'Delete anomaly detection data with configurable scope (metric/panel) and range (current test run/all test runs)'
  })
  @ApiResponse({ status: 200, description: 'Anomaly data deleted successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async deleteAnomalyData(
    @Param('testRunId') testRunId: string,
    @Body() deleteDto: DeleteAnomalyDto,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug('Deleting anomaly data', { testRunId, deleteDto });

    await this.testRunsService.verifyTestRunAccess(testRunId, ctx.userId, ctx.roles);
    const result = await this.testRunsService.deleteAnomalyData(testRunId, deleteDto);

    return {
      message: 'Anomaly data deleted successfully',
      deletedCount: result.deletedCount,
      scope: deleteDto.scope,
      range: deleteDto.range,
    };
  }

  // ==================== ADAPT/Analysis Endpoints ====================

  @Get(':testRunId/ds-adapt-result')
  @ApiOperation({ summary: 'Get detailed ds_adapt_result data for a specific metric' })
  @ApiResponse({ status: 200, description: 'DS adapt result retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Result not found' })
  async getDsAdaptResult(
    @Param('testRunId') testRunId: string,
    @Query('applicationDashboardId') applicationDashboardId: string,
    @Query('panelId') panelId: string,
    @Query('metricName') metricName: string,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug('Getting DS adapt result', { testRunId, applicationDashboardId, panelId, metricName });

    if (!applicationDashboardId || !panelId || !metricName) {
      throw new ValidationException('applicationDashboardId, panelId, and metricName are required');
    }

    await this.testRunsService.verifyTestRunAccess(testRunId, ctx.userId, ctx.roles);
    return this.testRunsService.getDsAdaptResult(
      testRunId,
      applicationDashboardId,
      panelId,
      metricName,
    );
  }

  @Put(':testRunId/adapt-config')
  @ApiOperation({ summary: 'Update adapt configuration differences accepted status' })
  @ApiResponse({ status: 200, description: 'Adapt config updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async updateAdaptConfig(
    @Param('testRunId') testRunId: string,
    @Body() updateDto: UpdateAdaptConfigDto,
    @UserCtx() ctx: UserContext,
    @Query('systemUnderTestId') systemUnderTestId?: string,
    @Query('environment') environment?: string,
    @Query('workload') workload?: string,
  ) {
    this.logger.debug('Updating adapt config', { testRunId, updateDto, systemUnderTestId, environment, workload });

    return this.testRunsService.updateAdaptConfig(
      testRunId,
      updateDto.differencesAccepted,
      ctx.userId,
      ctx.roles,
      systemUnderTestId,
      environment,
      workload,
      updateDto.mode,
    );
  }

  @Post(':testRunId/classify-metric')
  @ApiOperation({ summary: 'Classify a metric for performance analysis' })
  @ApiResponse({ status: 201, description: 'Metric classification created successfully', type: MetricClassificationDto })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async classifyMetric(
    @Param('testRunId') testRunId: string,
    @Body() createDto: CreateMetricClassificationDto,
    @UserCtx() ctx: UserContext,
    @Query('system') system?: string,
    @Query('environment') environment?: string,
    @Query('workload') workload?: string,
  ) {
    this.logger.debug('Classifying metric', { testRunId, createDto, system, environment, workload });

    return this.testRunsService.classifyMetric(
      testRunId,
      createDto,
      system,
      environment,
      workload,
      ctx.userId,
      ctx.roles,
    );
  }

  // ==================== Workload ADAPT Settings ====================

  @Get('workload-adapt-settings')
  @ApiOperation({ summary: 'Get ADAPT mode settings for a workload' })
  @ApiQuery({ name: 'systemUnderTestId', required: true, type: String })
  @ApiQuery({ name: 'testEnvironment', required: true, type: String })
  @ApiQuery({ name: 'workload', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Workload ADAPT settings' })
  async getWorkloadAdaptSettings(
    @Query('systemUnderTestId') systemUnderTestId: string,
    @Query('testEnvironment') testEnvironment: string,
    @Query('workload') workload: string,
  ) {
    if (!systemUnderTestId || !testEnvironment || !workload) {
      throw new BadRequestException('systemUnderTestId, testEnvironment, and workload are required');
    }

    const config = await this.testRunsService.getWorkloadAdaptSettings(systemUnderTestId, testEnvironment, workload);
    return {
      adaptMode: config?.adaptMode || 'DEFAULT',
    };
  }

  @Put('workload-adapt-settings')
  @ApiOperation({ summary: 'Set ADAPT mode for a workload (applies to all new test runs)' })
  @ApiResponse({ status: 200, description: 'Settings updated' })
  async updateWorkloadAdaptSettings(
    @Body() body: { systemUnderTestId: string; testEnvironment: string; workload: string; adaptMode: string },
  ) {
    const { systemUnderTestId, testEnvironment, workload, adaptMode } = body;

    if (!systemUnderTestId || !testEnvironment || !workload || !adaptMode) {
      throw new BadRequestException('systemUnderTestId, testEnvironment, workload, and adaptMode are required');
    }

    if (!['DEFAULT', 'BASELINE'].includes(adaptMode)) {
      throw new BadRequestException('adaptMode must be DEFAULT or BASELINE');
    }

    await this.testRunsService.updateWorkloadAdaptSettings(systemUnderTestId, testEnvironment, workload, adaptMode);
    return { success: true, adaptMode };
  }
}
