import { Controller, Get, Delete, Post, Param, Query, Body, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TestRunsService } from '../test-runs.service';
import { CreateExpectedConfigChangeDto, ExpectedConfigChangeDto } from '../dto/expected-config-change.dto';
import { CreateSparseMetricExclusionDto, SparseMetricExclusionDto } from '../dto/sparse-metric-exclusion.dto';
import { RequiredTestRunQueryDto } from '../../../common/dto';
import { ValidationException } from '../../../common/exceptions/business.exception';
import { UserCtx, UserContext } from '../../../common/decorators/user-context.decorator';

@ApiTags('test-runs-comparison')
@ApiBearerAuth()
@Controller('test-runs')
export class TestRunsComparisonController {
  private readonly logger = new Logger(TestRunsComparisonController.name);

  constructor(private readonly testRunsService: TestRunsService) {}

  // ==================== Expected Config Changes Endpoints ====================

  @Get('expected-config-changes')
  @ApiOperation({ summary: 'Get expected configuration changes for a system/environment/workload' })
  @ApiResponse({ status: 200, description: 'Expected config changes retrieved successfully', type: [ExpectedConfigChangeDto] })
  @ApiResponse({ status: 400, description: 'Invalid parameters' })
  async getExpectedConfigChanges(
    @Query() query: RequiredTestRunQueryDto,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug('Getting expected config changes', { query });
    return this.testRunsService.getExpectedConfigChanges(query.system, query.environment, query.workload, ctx.userId, ctx.roles);
  }

  @Post('expected-config-changes')
  @ApiOperation({ summary: 'Create a new expected configuration change' })
  @ApiResponse({ status: 201, description: 'Expected config change created successfully', type: ExpectedConfigChangeDto })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 409, description: 'Expected config change already exists' })
  async createExpectedConfigChange(
    @Body() createDto: CreateExpectedConfigChangeDto,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug('Creating expected config change', { createDto });
    return this.testRunsService.createExpectedConfigChange(createDto, ctx.userId, ctx.roles);
  }

  @Delete('expected-config-changes')
  @ApiOperation({ summary: 'Delete an expected configuration change' })
  @ApiResponse({ status: 200, description: 'Expected config change deleted successfully' })
  @ApiResponse({ status: 400, description: 'Invalid parameters' })
  @ApiResponse({ status: 404, description: 'Expected config change not found' })
  async deleteExpectedConfigChange(
    @Query('system') system: string,
    @Query('environment') environment: string,
    @Query('workload') workload: string,
    @Query('configKey') configKey: string,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug('Deleting expected config change', { system, environment, workload, configKey });

    if (!system || !environment || !workload || !configKey) {
      throw new ValidationException('System, environment, workload, and configKey are required');
    }

    await this.testRunsService.deleteExpectedConfigChange(system, environment, workload, configKey, ctx.userId, ctx.roles);

    return {
      message: 'Expected config change deleted successfully',
    };
  }

  // ==================== Sparse Metric Exclusions Endpoints ====================

  @Get('sparse-metric-exclusions')
  @ApiOperation({ summary: 'Get sparse metric exclusions for a system/environment/workload' })
  @ApiResponse({ status: 200, description: 'Sparse metric exclusions retrieved successfully', type: [SparseMetricExclusionDto] })
  @ApiResponse({ status: 400, description: 'Invalid parameters' })
  async getSparseMetricExclusions(
    @Query() query: RequiredTestRunQueryDto,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug('Getting sparse metric exclusions', { query });
    return this.testRunsService.getSparseMetricExclusions(query.system, query.environment, query.workload, ctx.userId, ctx.roles);
  }

  @Post('sparse-metric-exclusions')
  @ApiOperation({ summary: 'Create a sparse metric exclusion' })
  @ApiResponse({ status: 201, description: 'Sparse metric exclusion created successfully', type: SparseMetricExclusionDto })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  async createSparseMetricExclusion(
    @Body() createDto: CreateSparseMetricExclusionDto,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug('Creating sparse metric exclusion', { createDto });
    return this.testRunsService.createSparseMetricExclusion(createDto, ctx.userId, ctx.roles);
  }

  @Delete('sparse-metric-exclusions')
  @ApiOperation({ summary: 'Delete a sparse metric exclusion' })
  @ApiResponse({ status: 200, description: 'Sparse metric exclusion deleted successfully' })
  @ApiResponse({ status: 400, description: 'Invalid parameters' })
  @ApiResponse({ status: 404, description: 'Sparse metric exclusion not found' })
  async deleteSparseMetricExclusion(
    @Query('system') system: string,
    @Query('environment') environment: string,
    @Query('workload') workload: string,
    @Query('dashboardLabel') dashboardLabel: string,
    @Query('metricName') metricName: string,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug('Deleting sparse metric exclusion', { system, environment, workload, dashboardLabel, metricName });

    if (!system || !environment || !workload || !dashboardLabel || !metricName) {
      throw new ValidationException('System, environment, workload, dashboardLabel, and metricName are required');
    }

    await this.testRunsService.deleteSparseMetricExclusion(system, environment, workload, dashboardLabel, metricName, ctx.userId, ctx.roles);

    return {
      message: 'Sparse metric exclusion deleted successfully',
    };
  }

  // ==================== Config Keys Endpoints ====================

  @Get('config-keys/latest')
  @ApiOperation({ summary: 'Get distinct configuration keys from the latest test run' })
  @ApiResponse({ status: 200, description: 'Configuration keys retrieved successfully' })
  @ApiResponse({ status: 400, description: 'Invalid parameters' })
  async getLatestConfigKeys(
    @Query('system') system: string,
    @Query('environment') environment: string,
    @Query('workload') workload: string,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug('Getting latest config keys', { system, environment, workload });

    if (!system || !environment || !workload) {
      throw new ValidationException('System, environment, and workload are required');
    }

    return this.testRunsService.getLatestConfigKeys(system, environment, workload, ctx.userId, ctx.roles);
  }

  // ==================== Test Run Configs Endpoints ====================

  @Get(':testRunId/configs')
  @ApiOperation({ summary: 'Get test run configuration items' })
  @ApiResponse({ status: 200, description: 'Test run configuration items retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async getTestRunConfigs(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
    @Query('system') system?: string,
    @Query('environment') environment?: string,
    @Query('workload') workload?: string,
  ) {
    this.logger.debug('Getting test run configs', { testRunId, system, environment, workload, userId: ctx.userId, organizationId: ctx.organizationId });
    return this.testRunsService.getTestRunConfigs(
      testRunId,
      system,
      environment,
      workload,
      ctx.userId,
      ctx.roles,
      ctx.organizationId,
    );
  }

  // ==================== Related Test Runs Endpoints ====================

  @Get(':testRunId/related')
  @ApiOperation({ summary: 'Get related test runs with same system, environment, and workload' })
  @ApiResponse({ status: 200, description: 'Related test runs retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async getRelatedTestRuns(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
    @Query('system') system?: string,
    @Query('environment') environment?: string,
    @Query('workload') workload?: string,
  ) {
    this.logger.debug('Getting related test runs', { testRunId, system, environment, workload });
    return this.testRunsService.getRelatedTestRuns(
      testRunId,
      ctx.userId,
      ctx.roles,
      system,
      environment,
      workload,
    );
  }

  // ==================== Check Results (SLO Comparison) Endpoints ====================

  @Get(':testRunId/check-results')
  @ApiOperation({ summary: 'Get check results (Service Level Objectives) for a test run' })
  @ApiResponse({ status: 200, description: 'Check results retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async getTestRunCheckResults(
    @Param('testRunId') testRunId: string,
    @UserCtx() _ctx: UserContext,
    @Query('system') system?: string,
    @Query('environment') environment?: string,
    @Query('workload') workload?: string,
  ) {
    this.logger.debug('Getting test run check results', { testRunId, system, environment, workload });
    return this.testRunsService.getTestRunCheckResults(
      testRunId,
      system,
      environment,
      workload,
    );
  }
}
