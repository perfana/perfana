import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiBody } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BullMQClientService } from '../services/bullmq-client.service';
import { BatchRefreshDto, BatchReevaluateDto, AvailableSourcesRequestDto } from '../dto/batch-processing.dto';
import { JobProgressService } from '../services/job-progress.service';
import type { JobProgress } from '@perfana/shared/types';
import { JobProgressGateway } from '../gateways/job-progress.gateway';
import { UserCtx, UserContext } from '../../../common/decorators/user-context.decorator';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { AdminOnly } from '../../../decorators/admin-only.decorator';
import type { OwnedResource } from '@perfana/shared';

@ApiTags('data-science')
@ApiBearerAuth()
@Controller('data')
export class DataScienceController {
  private readonly logger = new Logger(DataScienceController.name);

  constructor(
    private readonly bullmqClient: BullMQClientService,
    private readonly jobProgressService: JobProgressService,
    private readonly jobProgressGateway: JobProgressGateway,
    private readonly authzService: AuthorizationService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Verify the user can access the given test run(s).
   *
   * Accepts either the UUID `id` or the `test_run_id`, and returns the canonical
   * `test_run_id`. Callers that pass the value on to a pipeline must use the return
   * value: every pipeline filters on `test_run_id`, so forwarding a UUID yields a
   * job that matches zero rows and reports success.
   */
  private async verifyTestRunAccess(testRunId: string, userId: string, roles: string[]): Promise<string> {
    const result = await this.dataSource.query(
      `SELECT test_run_id, organization_id, created_by FROM test_runs WHERE id::text = $1 OR test_run_id = $1 LIMIT 1`,
      [testRunId],
    );
    if (result.length === 0) {
      throw new NotFoundException(`Test run ${testRunId} not found`);
    }

    const accessResult = await this.authzService.canAccessResource(userId, roles, {
      organization_id: result[0].organization_id,
      created_by: result[0].created_by ?? '',
    } as OwnedResource);

    if (!accessResult.allowed) {
      throw new ForbiddenException('Access denied to this test run');
    }

    return result[0].test_run_id;
  }

  @Post('analyzeTest/:testRunId')
  @ApiOperation({
    summary: 'Analyze single test run with complete pipeline',
    description: 'Initiates complete 7-stage pipeline analysis for a single test run including data collection, statistics calculation, and optional ADAPT analysis'
  })
  @ApiQuery({
    name: 'adapt',
    required: false,
    type: 'boolean',
    description: 'Whether to include ADAPT analysis in the pipeline (default: false)',
    example: true
  })
  @ApiQuery({
    name: 'benchmarksOnly',
    required: false,
    type: 'boolean',
    description: 'Whether to process only benchmark-related stages (default: false)',
    example: false
  })
  @ApiResponse({
    status: 200,
    description: 'Analysis pipeline initiated successfully',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'initiated' },
        data: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            jobId: { type: 'string' },
            testRunId: { type: 'string' },
            message: { type: 'string' },
            estimatedDuration: { type: 'string' },
            stages: { type: 'number' },
            trackingUrl: { type: 'string' }
          }
        },
        links: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            results: { type: 'string' },
            cancel: { type: 'string' }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Invalid test run ID' })
  @ApiResponse({ status: 409, description: 'Job blocked - another job is already processing this scope' })
  @ApiResponse({ status: 500, description: 'Failed to initiate analysis' })
  async analyzeTest(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
    @Query('adapt') adapt?: string,
    @Query('benchmarksOnly') benchmarksOnly?: string
  ) {
    try {
      if (!testRunId || testRunId.trim().length === 0) {
        throw new BadRequestException('Test run ID is required');
      }

      await this.verifyTestRunAccess(testRunId, ctx.userId, ctx.roles);
      this.logger.log(`Initiating analysis for test run: ${testRunId}`);

      // Get test run details to check for locks
      const testRunData = await this.getTestRunScope(testRunId);
      if (!testRunData) {
        throw new NotFoundException(`Test run ${testRunId} not found`);
      }

      // Check if another job is already processing this scope
      const blockInfo = await this.jobProgressService.isJobBlocked(
        testRunData.systemUnderTestId,
        testRunData.testEnvironment,
        testRunData.workload
      );

      if (blockInfo.blocked) {
        this.logger.warn(`Job blocked for ${testRunId}: ${blockInfo.reason}`);

        // Emit blocked event via WebSocket
        this.jobProgressGateway.emitJobBlocked(blockInfo, testRunId, 'analyze');

        throw new ConflictException({
          message: blockInfo.reason,
          blocked: true,
          existingJobId: blockInfo.existingJobId,
          existingJobProgress: blockInfo.existingJobProgress,
          scopeKey: blockInfo.scopeKey,
        });
      }

      // Convert string query parameters to boolean
      const adaptBoolean = adapt === 'true';
      const benchmarksOnlyBoolean = benchmarksOnly === 'true';

      this.logger.log(`Query parameters - adapt: ${adapt} (${adaptBoolean}), benchmarksOnly: ${benchmarksOnly} (${benchmarksOnlyBoolean})`);

      const result = await this.bullmqClient.analyzeTest(testRunId.trim(), {
        adapt: adaptBoolean,
        benchmarksOnly: benchmarksOnlyBoolean
      });

      return {
        status: 'initiated',
        data: result,
        links: {
          status: `/api/data-science/jobs/${result.jobId}/status`,
          results: `/api/test-runs/${testRunId}/results`,
          cancel: `/api/data-science/jobs/${result.jobId}/cancel`
        }
      };

    } catch (error) {
      // Re-throw known HTTP exceptions as-is
      if (error instanceof ConflictException || error instanceof ForbiddenException) {
        throw error;
      }
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Failed to analyze test ${testRunId}: ${errorMessage}`);
      throw new BadRequestException(`Failed to initiate analysis: ${errorMessage}`);
    }
  }

  @Post('recalculate-statistics/:testRunId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recompute metric statistics for a test run',
    description:
      'Enqueues statistics-calculation for this run. It recomputes ds_metric_statistics from ds_metrics ' +
      'already in the database — no datasource fetch — which also rebuilds the pct_agg sketches an older ' +
      'baseline may be missing. Use it on a baseline run when ADAPT reports that the control-group ' +
      'aggregation failed.',
  })
  @ApiResponse({ status: 200, description: 'Statistics recalculation enqueued' })
  @ApiResponse({ status: 400, description: 'Invalid test run ID' })
  @ApiResponse({ status: 403, description: 'Access denied to this test run' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async recalculateStatistics(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
  ) {
    if (!testRunId || testRunId.trim().length === 0) {
      throw new BadRequestException('Test run ID is required');
    }

    const resolvedTestRunId = await this.verifyTestRunAccess(testRunId, ctx.userId, ctx.roles);

    try {
      const jobId = await this.bullmqClient.enqueueStatisticsCalculation(resolvedTestRunId);
      return { status: 'initiated', jobId, testRunId: resolvedTestRunId };
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Failed to enqueue statistics recalculation for ${testRunId}: ${errorMessage}`);
      throw new BadRequestException(`Failed to enqueue statistics recalculation: ${errorMessage}`);
    }
  }

  @Post('refresh/available-sources')
  @ApiOperation({
    summary: 'Check which data sources are configured for given scopes',
    description: 'Returns which data sources (Grafana, Dynatrace) have configurations for the provided system/environment/workload combinations. Used to conditionally show source checkboxes in the refresh dialog.',
  })
  @ApiResponse({
    status: 200,
    description: 'Available sources for the given scopes',
    schema: {
      type: 'object',
      properties: {
        grafana: { type: 'boolean', description: 'Whether any scope has application_dashboards configured' },
        dynatrace: { type: 'boolean', description: 'Whether any scope has dynatrace_queries configured' },
      },
    },
  })
  async getAvailableSources(@Body() dto: AvailableSourcesRequestDto) {
    try {
      if (!dto.scopes || dto.scopes.length === 0) {
        return { grafana: false, dynatrace: false };
      }

      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      // Deduplicate and filter out scopes with missing/invalid fields
      const seen = new Set<string>();
      const uniqueScopes = dto.scopes.filter(s => {
        if (!s.systemUnderTestId || !s.testEnvironment || !UUID_RE.test(s.systemUnderTestId)) {
          return false;
        }
        const key = `${s.systemUnderTestId}:${s.testEnvironment}:${s.workload}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      if (uniqueScopes.length === 0) {
        return { grafana: false, dynatrace: false };
      }

      // Build WHERE clause for Grafana (application_dashboards uses SUT + env)
      const grafanaConditions = uniqueScopes.map((_, i) => {
        const base = i * 2;
        return `(system_under_test_id = $${base + 1}::uuid AND test_environment = $${base + 2})`;
      });
      const grafanaParams = uniqueScopes.flatMap(s => [s.systemUnderTestId, s.testEnvironment]);

      // Build WHERE clause for Dynatrace (dynatrace_queries uses SUT + env + workload)
      // Only include scopes that have a non-empty workload
      const dtScopes = uniqueScopes.filter(s => !!s.workload);
      let dynatraceHasRows = false;

      if (dtScopes.length > 0) {
        const dtConditions = dtScopes.map((_, i) => {
          const base = i * 3;
          return `(system_under_test_id = $${base + 1}::uuid AND test_environment = $${base + 2} AND workload = $${base + 3})`;
        });
        const dtParams = dtScopes.flatMap(s => [s.systemUnderTestId, s.testEnvironment, s.workload]);

        const dtResult = await this.dataSource.query(
          `SELECT EXISTS(SELECT 1 FROM dynatrace_queries WHERE ${dtConditions.join(' OR ')}) AS has_rows`,
          dtParams,
        );
        dynatraceHasRows = dtResult[0]?.has_rows === true;
      }

      // Exclude synthetic dashboards that are not real Grafana dashboards:
      // - performance-test-metrics-*  created by the worker pipeline
      // - dynatrace-*                 created by the Dynatrace integration
      const grafanaResult = await this.dataSource.query(
        `SELECT EXISTS(SELECT 1 FROM application_dashboards WHERE (${grafanaConditions.join(' OR ')}) AND dashboard_uid NOT LIKE 'performance-test-metrics-%' AND dashboard_uid NOT LIKE 'dynatrace-%') AS has_rows`,
        grafanaParams,
      );

      return {
        grafana: grafanaResult[0]?.has_rows === true,
        dynatrace: dynatraceHasRows,
      };
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Failed to check available sources: ${errorMessage}`);
      // Graceful degradation: return all true so dialog shows all options
      return { grafana: true, dynatrace: true };
    }
  }

  @Post('refresh/batch')
  @ApiOperation({
    summary: 'Refresh missing data and re-evaluate',
    description: 'Analyzes metric collection for gaps, fetches only missing data ranges, recalculates statistics, and re-evaluates benchmark checks and optional ADAPT analysis'
  })
  @ApiBody({
    type: BatchRefreshDto,
    description: 'Refresh missing data request payload',
    examples: {
      'basic-refresh': {
        summary: 'Refresh missing data for test runs',
        description: 'Detect and fill metric collection gaps, then re-evaluate',
        value: {
          testRunIds: ['MyApp-prod-loadTest-001', 'MyApp-prod-loadTest-002', 'MyApp-prod-loadTest-003'],
          adapt: true
        }
      },
      'with-source-filter': {
        summary: 'Refresh only Grafana sources',
        description: 'Only check Grafana for gaps, skip Dynatrace and performance test metrics',
        value: {
          testRunIds: ['MyApp-prod-loadTest-001'],
          adapt: true,
          sources: { grafana: true, dynatrace: false, performanceMetrics: false }
        }
      },
      'without-adapt': {
        summary: 'Refresh without ADAPT analysis',
        description: 'Fill missing data and re-evaluate checks only',
        value: {
          testRunIds: ['MyApp-prod-loadTest-001'],
          adapt: false
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Batch processing initiated successfully',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'initiated' },
        data: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            batchId: { type: 'string' },
            totalTestRuns: { type: 'number' },
            batchesCreated: { type: 'number' },
            estimatedDuration: { type: 'string' },
            trackingUrl: { type: 'string' },
            individualJobs: { type: 'array', items: { type: 'string' } }
          }
        },
        links: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            progress: { type: 'string' },
            cancel: { type: 'string' }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 409, description: 'One or more jobs blocked by active jobs' })
  @ApiResponse({ status: 500, description: 'Failed to initiate batch processing' })
  async refreshBatch(@Body() dto: BatchRefreshDto, @UserCtx() ctx: UserContext) {
    try {
      if (!dto.testRunIds || dto.testRunIds.length === 0) {
        throw new BadRequestException('testRunIds must be a non-empty array');
      }

      // Verify access to all test runs
      for (const testRunId of dto.testRunIds) {
        await this.verifyTestRunAccess(testRunId, ctx.userId, ctx.roles);
      }

      // Deduplicate and limit to reasonable size
      const uniqueTestRunIds = [...new Set(dto.testRunIds)].slice(0, 100);

      if (uniqueTestRunIds.length !== dto.testRunIds.length) {
        this.logger.warn(`Deduplicated test runs: ${dto.testRunIds.length} → ${uniqueTestRunIds.length}`);
      }

      // Check for blocked jobs across all test runs
      const blockedJobs = await this.checkBatchForBlockedJobs(uniqueTestRunIds);

      if (blockedJobs.length > 0) {
        this.logger.warn(`${blockedJobs.length} jobs blocked in batch refresh`);
        throw new ConflictException({
          message: `${blockedJobs.length} of ${uniqueTestRunIds.length} jobs are blocked by active jobs`,
          blockedCount: blockedJobs.length,
          totalCount: uniqueTestRunIds.length,
          blockedJobs: blockedJobs
        });
      }

      this.logger.log(`Starting batch processing of ${uniqueTestRunIds.length} test runs`);

      const result = await this.bullmqClient.refreshBatch(uniqueTestRunIds, {
        adapt: dto.adapt,
        sources: dto.sources,
        forceRefetch: dto.forceRefetch,
      });

      return {
        status: 'initiated',
        data: result,
        links: {
          status: `/api/data-science/batches/${result.batchId}/status`,
          progress: `/api/data-science/batches/${result.batchId}/progress`,
          cancel: `/api/data-science/batches/${result.batchId}/cancel`
        }
      };

    } catch (error) {
      if (error instanceof ConflictException || error instanceof ForbiddenException) {
        throw error;
      }
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Failed to process batch: ${errorMessage}`);
      throw new BadRequestException(`Failed to initiate batch processing: ${errorMessage}`);
    }
  }

  @Post('reevaluate/batch')
  @ApiOperation({
    summary: 'Batch re-evaluation without raw data collection',
    description: 'Re-evaluates existing test runs with updated benchmarks and thresholds, skipping data collection stages for faster processing. Supports specific metric targeting for efficient stale result updates.'
  })
  @ApiBody({
    type: BatchReevaluateDto,
    description: 'Batch re-evaluation request payload',
    examples: {
      'basic-reevaluation': {
        summary: 'Basic re-evaluation of test runs',
        description: 'Re-evaluate multiple test runs with default settings',
        value: {
          testRunIds: ['MyApp-prod-loadTest-001', 'MyApp-prod-loadTest-002'],
          checks: true,
          adapt: true
        }
      },
      'specific-metric-targeting': {
        summary: 'Targeted metric re-analysis',
        description: 'Re-evaluate a specific metric for stale result updates',
        value: {
          testRunIds: ['MyApp-prod-loadTest-001'],
          checks: true,
          adapt: true,
          applicationDashboardId: '550e8400-e29b-41d4-a716-446655440001',
          metricsSourceId: '550e8400-e29b-41d4-a716-446655440002',
          panelId: 42,
          metricName: 'response_time_p90'
        }
      },
      'checks-only': {
        summary: 'Re-evaluate checks only (skip ADAPT)',
        description: 'Fast re-evaluation focusing only on benchmark checks',
        value: {
          testRunIds: ['MyApp-prod-loadTest-001', 'MyApp-prod-loadTest-002'],
          checks: true,
          adapt: false
        }
      },
      'anomaly-detection-only': {
        summary: 'ADAPT analysis only (skip checks)',
        description: 'Re-evaluation for anomaly detection focusing only on ADAPT analysis, typically used from stale result indicators',
        value: {
          testRunIds: ['MyApp-prod-loadTest-001'],
          checks: false,
          adapt: true,
          applicationDashboardId: '550e8400-e29b-41d4-a716-446655440001',
          metricsSourceId: '550e8400-e29b-41d4-a716-446655440002',
          panelId: 42,
          metricName: 'response_time_p90'
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Batch re-evaluation initiated successfully',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'initiated' },
        data: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            reevaluationId: { type: 'string' },
            jobId: { type: 'string' },
            testRunsProcessed: { type: 'number' },
            skippedStages: { type: 'array', items: { type: 'string' } },
            estimatedDuration: { type: 'string' },
            trackingUrl: { type: 'string' }
          }
        },
        optimizations: {
          type: 'object',
          properties: {
            stagesSkipped: { type: 'number' },
            estimatedSpeedup: { type: 'string' },
            dataReuseEnabled: { type: 'boolean' }
          }
        },
        links: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            results: { type: 'string' }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 409, description: 'One or more jobs blocked by active jobs' })
  @ApiResponse({ status: 500, description: 'Failed to initiate re-evaluation' })
  async reevaluateBatch(@Body() dto: BatchReevaluateDto, @UserCtx() ctx: UserContext) {
    try {
      if (!dto.testRunIds || dto.testRunIds.length === 0) {
        throw new BadRequestException('testRunIds must be a non-empty array');
      }

      // Verify access to all test runs
      for (const testRunId of dto.testRunIds) {
        await this.verifyTestRunAccess(testRunId, ctx.userId, ctx.roles);
      }

      // Deduplicate and limit
      const uniqueTestRunIds = [...new Set(dto.testRunIds)].slice(0, 100);

      // Check for blocked jobs across all test runs
      const blockedJobs = await this.checkBatchForBlockedJobs(uniqueTestRunIds);

      if (blockedJobs.length > 0) {
        this.logger.warn(`${blockedJobs.length} jobs blocked in batch re-evaluation`);
        throw new ConflictException({
          message: `${blockedJobs.length} of ${uniqueTestRunIds.length} jobs are blocked by active jobs`,
          blockedCount: blockedJobs.length,
          totalCount: uniqueTestRunIds.length,
          blockedJobs: blockedJobs
        });
      }

      this.logger.log(`Starting batch re-evaluation of ${uniqueTestRunIds.length} test runs`);
      this.logger.log(`Options - checks: ${dto.checks !== false}, adapt: ${dto.adapt !== false}`);

      const result = await this.bullmqClient.reevaluateBatch(uniqueTestRunIds, {
        checks: dto.checks,
        adapt: dto.adapt,
        applicationDashboardId: dto.applicationDashboardId,
        metricsSourceId: dto.metricsSourceId,
        panelId: dto.panelId,
        metricName: dto.metricName
      });

      return result;

    } catch (error) {
      if (error instanceof ConflictException || error instanceof ForbiddenException) {
        throw error;
      }
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Failed to reevaluate batch: ${errorMessage}`);
      throw new BadRequestException(`Failed to initiate re-evaluation: ${errorMessage}`);
    }
  }

  @Get('jobs/:jobId/status')
  @ApiOperation({
    summary: 'Get job status and progress',
    description: 'Retrieves detailed status information for any job type including pipeline progress, logs, and completion status'
  })
  @ApiResponse({
    status: 200,
    description: 'Job status retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        testRunId: { type: 'string' },
        type: { type: 'string' },
        status: { type: 'string' },
        progress: { type: 'object' },
        created: { type: 'string', format: 'date-time' },
        started: { type: 'string', format: 'date-time' },
        finished: { type: 'string', format: 'date-time' },
        duration: { type: 'number' },
        attempts: { type: 'number' },
        maxAttempts: { type: 'number' },
        queue: { type: 'string' },
        failedReason: { type: 'string' }
      }
    }
  })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async getJobStatus(@Param('jobId') jobId: string) {
    try {
      this.logger.log(`Retrieving status for job: ${jobId}`);
      const status = await this.bullmqClient.getJobStatus(jobId);
      return status;
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Failed to get job status for ${jobId}: ${errorMessage}`);
      if (errorMessage.includes('not found')) {
        throw new NotFoundException(`Job ${jobId} not found`);
      }
      throw new BadRequestException(`Failed to retrieve job status: ${errorMessage}`);
    }
  }

  @Get('test-runs/:testRunId/jobs')
  @ApiOperation({
    summary: 'Get all jobs for a test run',
    description: 'Retrieves all jobs associated with a specific test run, including their current status and progress'
  })
  @ApiResponse({
    status: 200,
    description: 'Test run jobs retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        testRunId: { type: 'string' },
        totalJobs: { type: 'number' },
        jobs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              jobId: { type: 'string' },
              type: { type: 'string' },
              status: { type: 'string' },
              created: { type: 'string', format: 'date-time' },
              progress: { type: 'object' }
            }
          }
        }
      }
    }
  })
  async getTestRunJobs(@Param('testRunId') _testRunId: string) {
    throw new BadRequestException('Test run jobs endpoint not yet implemented');
  }

  @Get('health')
  @ApiOperation({
    summary: 'Health check for data science services',
    description: 'Checks the health of BullMQ connections and queue system'
  })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  async healthCheck() {
    try {
      // Basic health check - could be expanded to check Redis connectivity
      const jobProgressHealth = this.jobProgressService.getHealthStatus();
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          bullmq: 'connected',
          redis: 'connected',
          jobProgress: jobProgressHealth
        }
      };
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Health check failed: ${errorMessage}`);
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: errorMessage
      };
    }
  }

  @Get('jobs/active')
  @ApiOperation({
    summary: 'Get all active jobs',
    description: 'Returns all jobs currently in progress across all scopes'
  })
  @ApiResponse({
    status: 200,
    description: 'List of active jobs retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        totalActive: { type: 'number' },
        jobs: { type: 'array', items: { type: 'object' } }
      }
    }
  })
  async getActiveJobs() {
    try {
      const activeJobs = await this.jobProgressService.getAllActiveJobs();
      return {
        totalActive: activeJobs.length,
        jobs: activeJobs
      };
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Failed to get active jobs: ${errorMessage}`);
      throw new BadRequestException(`Failed to retrieve active jobs: ${errorMessage}`);
    }
  }

  @Get('jobs/active/:systemId/:env/:workload')
  @ApiOperation({
    summary: 'Get active job for specific scope',
    description: 'Returns the currently running job for a specific system/environment/workload combination'
  })
  @ApiResponse({
    status: 200,
    description: 'Active job for scope retrieved (may be null if no job is running)',
    schema: {
      type: 'object',
      properties: {
        scope: { type: 'object' },
        activeJob: { type: 'object', nullable: true }
      }
    }
  })
  async getActiveJobForScope(
    @Param('systemId') systemId: string,
    @Param('env') env: string,
    @Param('workload') workload: string
  ) {
    try {
      const activeJob = await this.jobProgressService.getActiveJobForScope(
        systemId,
        env,
        workload
      );
      return {
        scope: {
          systemUnderTestId: systemId,
          testEnvironment: env,
          workload: workload
        },
        activeJob: activeJob || null
      };
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Failed to get active job for scope: ${errorMessage}`);
      throw new BadRequestException(`Failed to retrieve active job for scope: ${errorMessage}`);
    }
  }

  @Get('jobs/:jobId/progress')
  @ApiOperation({
    summary: 'Get progress for specific job',
    description: 'Returns detailed progress information for a specific job ID'
  })
  @ApiResponse({
    status: 200,
    description: 'Job progress retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        progress: { type: 'object', nullable: true }
      }
    }
  })
  @ApiResponse({ status: 404, description: 'Job not found or no progress available' })
  async getJobProgress(@Param('jobId') jobId: string) {
    try {
      const progress = await this.jobProgressService.getJobProgress(jobId);

      if (!progress) {
        throw new NotFoundException(`No progress information found for job ${jobId}`);
      }

      return {
        jobId,
        progress
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Failed to get job progress for ${jobId}: ${errorMessage}`);
      throw new BadRequestException(`Failed to retrieve job progress: ${errorMessage}`);
    }
  }

  @Get('locks/:systemId/:env/:workload')
  @ApiOperation({
    summary: 'Get lock information for a scope',
    description: 'Returns detailed lock information for a specific system/environment/workload scope, including TTL and current job progress'
  })
  @ApiResponse({
    status: 200,
    description: 'Lock information retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        scope: {
          type: 'object',
          properties: {
            systemUnderTestId: { type: 'string' },
            testEnvironment: { type: 'string' },
            workload: { type: 'string' }
          }
        },
        lock: {
          type: 'object',
          properties: {
            locked: { type: 'boolean' },
            jobId: { type: 'string' },
            testRunId: { type: 'string' },
            jobType: { type: 'string' },
            acquiredAt: { type: 'string', format: 'date-time' },
            expiresAt: { type: 'string', format: 'date-time' },
            progress: { type: 'object' }
          }
        }
      }
    }
  })
  async getLockInfo(
    @Param('systemId') systemId: string,
    @Param('env') env: string,
    @Param('workload') workload: string
  ) {
    try {
      const lockInfo = await this.jobProgressService.getLockInfo(
        systemId,
        env,
        workload
      );

      return {
        scope: {
          systemUnderTestId: systemId,
          testEnvironment: env,
          workload: workload
        },
        lock: lockInfo
      };
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Failed to get lock info: ${errorMessage}`);
      throw new BadRequestException(`Failed to retrieve lock information: ${errorMessage}`);
    }
  }

  @Delete('locks/:systemId/:env/:workload')
  @AdminOnly()
  @ApiOperation({
    summary: 'Manually release a lock for a scope',
    description: 'Force-releases a lock for a stuck job. Use with caution - only when a job is truly stuck and blocking other operations.'
  })
  @ApiResponse({
    status: 200,
    description: 'Lock released successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        scope: {
          type: 'object',
          properties: {
            systemUnderTestId: { type: 'string' },
            testEnvironment: { type: 'string' },
            workload: { type: 'string' }
          }
        },
        previousLock: {
          type: 'object',
          properties: {
            jobId: { type: 'string' },
            testRunId: { type: 'string' },
            jobType: { type: 'string' },
            acquiredAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 404, description: 'No lock found for this scope' })
  async releaseLock(
    @Param('systemId') systemId: string,
    @Param('env') env: string,
    @Param('workload') workload: string,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      this.logger.warn(
        `Manual lock release requested for scope: ${systemId}:${env}:${workload} by user ${ctx.userId}`
      );

      const result = await this.jobProgressService.releaseLock(
        systemId,
        env,
        workload
      );

      if (!result.released && !result.previousLock) {
        throw new NotFoundException(`No lock found for scope ${systemId}:${env}:${workload}`);
      }

      return {
        success: result.released,
        message: result.released
          ? 'Lock released successfully. You can now retry your operation.'
          : 'No lock was held for this scope.',
        scope: {
          systemUnderTestId: systemId,
          testEnvironment: env,
          workload: workload
        },
        previousLock: result.previousLock
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Failed to release lock: ${errorMessage}`);
      throw new BadRequestException(`Failed to release lock: ${errorMessage}`);
    }
  }

  /**
   * Helper method to get test run scope information
   */
  private async getTestRunScope(testRunId: string): Promise<{
    systemUnderTestId: string;
    testEnvironment: string;
    workload: string;
  } | null> {
    try {
      const result = await this.dataSource.query(
        `SELECT system_under_test_id, test_environment, workload
         FROM test_runs
         WHERE test_run_id = $1`,
        [testRunId]
      );

      if (result.length === 0) {
        return null;
      }

      const row = result[0];
      return {
        systemUnderTestId: row.system_under_test_id,
        testEnvironment: row.test_environment,
        workload: row.workload
      };
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Failed to get test run scope for ${testRunId}: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Helper method to check for blocked jobs in a batch
   * Returns array of blocked job info for each test run that's blocked
   */
  private async checkBatchForBlockedJobs(testRunIds: string[]): Promise<Array<{
    testRunId: string;
    blockInfo: { reason?: string; existingJobId?: string; existingJobProgress?: JobProgress | null; scopeKey?: string };
  }>> {
    const blockedJobs: Array<{ testRunId: string; blockInfo: { reason?: string; existingJobId?: string; existingJobProgress?: JobProgress | null; scopeKey?: string } }> = [];

    for (const testRunId of testRunIds) {
      const scopeData = await this.getTestRunScope(testRunId);

      if (!scopeData) {
        this.logger.warn(`Test run ${testRunId} not found, skipping lock check`);
        continue;
      }

      const blockInfo = await this.jobProgressService.isJobBlocked(
        scopeData.systemUnderTestId,
        scopeData.testEnvironment,
        scopeData.workload
      );

      if (blockInfo.blocked) {
        blockedJobs.push({
          testRunId,
          blockInfo: {
            reason: blockInfo.reason,
            existingJobId: blockInfo.existingJobId,
            existingJobProgress: blockInfo.existingJobProgress,
            scopeKey: blockInfo.scopeKey
          }
        });
      }
    }

    return blockedJobs;
  }
}