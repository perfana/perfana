import { Controller, Get, Param, Query, DefaultValuePipe, ParseBoolPipe, ParseIntPipe, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { UserCtx, UserContext } from '../../../common/decorators/user-context.decorator';
import { TestRunsService } from '../test-runs.service';
import { isRollupPending } from '../services/test-runs-performance-query.types';

/**
 * Transaction-level metrics and statistics endpoints.
 * Handles transaction stats, samples, timeseries, virtual users, throughput, and request names.
 */
@ApiTags('test-runs-metrics')
@ApiBearerAuth()
@Controller('test-runs')
export class TestRunsMetricsTransactionController {
  private readonly logger = new Logger(TestRunsMetricsTransactionController.name);

  constructor(private readonly testRunsService: TestRunsService) {}

  @Get(':testRunId/transactions')
  @ApiOperation({ summary: 'Get transaction performance statistics for a test run' })
  @ApiParam({ name: 'testRunId', description: 'Test run ID to get transactions for', type: String })
  @ApiQuery({
    name: 'excludeRampUp',
    required: false,
    description: 'Exclude data during ramp-up time period',
    type: Boolean,
    example: false
  })
  @ApiQuery({
    name: 'sinceMinutes',
    required: false,
    description: 'Restrict statistics to the last N minutes (useful for live view during a running test)',
    type: Number,
    example: 5,
  })
  @ApiResponse({
    status: 200,
    description: 'Transaction statistics retrieved successfully. Includes Apdex score (0.0-1.0) with configurable thresholds (transaction-level > test-level > system default)',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          transaction_name: { type: 'string', example: 'database_call' },
          avg_response_time: { type: 'number', example: 52.48 },
          p95_response_time: { type: 'number', example: 70 },
          p99_response_time: { type: 'number', example: 87.48 },
          passed_count: { type: 'number', example: 573 },
          failed_count: { type: 'number', example: 12 },
          total_count: { type: 'number', example: 585 },
          ranking: { type: 'number', example: 1, description: 'Rank by impact (avg×count), 1=highest impact' },
          apdex_score: { type: 'number', example: 0.956, description: 'Application Performance Index (0.0-1.0)' },
          active_threshold: { type: 'number', example: 500, description: 'Active Apdex threshold in milliseconds used for this transaction' }
        }
      }
    }
  })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async getTransactionStats(
    @Param('testRunId') testRunId: string,
    @Query('excludeRampUp', new DefaultValuePipe(false), ParseBoolPipe) excludeRampUp: boolean,
    @UserCtx() ctx: UserContext,
    @Query('sinceMinutes') sinceMinutesRaw?: string,
  ) {
    const sinceMinutes = sinceMinutesRaw != null ? parseInt(sinceMinutesRaw, 10) : undefined;
    this.logger.debug('Getting transaction stats', { testRunId, excludeRampUp, sinceMinutes });
    const result = await this.testRunsService.getTransactionStats(
      testRunId, ctx.userId, ctx.roles, excludeRampUp, sinceMinutes,
    );
    if (isRollupPending(result)) {
      throw new HttpException(result, HttpStatus.ACCEPTED);
    }
    return result;
  }

  @Get(':testRunId/transactions/:transactionName/samples')
  @ApiOperation({ summary: 'Get aggregated sampler statistics for a specific transaction' })
  @ApiParam({ name: 'testRunId', description: 'Test run ID', type: String })
  @ApiParam({ name: 'transactionName', description: 'Transaction name to get sampler statistics for', type: String })
  @ApiQuery({
    name: 'excludeRampUp',
    required: false,
    description: 'Exclude data during ramp-up time period',
    type: Boolean,
    example: false
  })
  @ApiResponse({
    status: 200,
    description: 'Aggregated sampler statistics retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sampler_name: { type: 'string', example: 'GET /api/users' },
          avg_response_time: { type: 'number', example: 45.23 },
          min_response_time: { type: 'number', example: 12 },
          max_response_time: { type: 'number', example: 245 },
          p95_response_time: { type: 'number', example: 78.45 },
          p99_response_time: { type: 'number', example: 123.67 },
          passed_count: { type: 'number', example: 573 },
          failed_count: { type: 'number', example: 12 },
          total_count: { type: 'number', example: 585 },
          avg_latency: { type: 'number', example: 42.15 },
          avg_connect_time: { type: 'number', example: 8.34 },
          total_request_size: { type: 'number', example: 512000 },
          total_response_size: { type: 'number', example: 2048000 },
          apdex_score: { type: 'number', example: 0.956, description: 'Application Performance Index (0.0-1.0)' },
          active_threshold: { type: 'number', example: 500, description: 'Active Apdex threshold in milliseconds' },
          url_hash: { type: 'string', nullable: true, example: 'a1b2c3d4', description: 'Hash of normalized URL' },
          url_pattern: { type: 'string', nullable: true, example: '/api/user/{id}', description: 'Normalized URL pattern with placeholders' }
        }
      }
    }
  })
  @ApiResponse({ status: 404, description: 'Test run or transaction not found' })
  async getTransactionSamples(
    @Param('testRunId') testRunId: string,
    @Param('transactionName') transactionName: string,
    @Query('excludeRampUp', new DefaultValuePipe(false), ParseBoolPipe) excludeRampUp: boolean,
    @UserCtx() ctx: UserContext,
    @Query('sinceMinutes') sinceMinutesRaw?: string,
  ) {
    const sinceMinutes = sinceMinutesRaw != null ? parseInt(sinceMinutesRaw, 10) : undefined;
    this.logger.debug('Getting transaction samples', { testRunId, transactionName, excludeRampUp, sinceMinutes });
    const result = await this.testRunsService.getTransactionSamples(
      testRunId, transactionName, ctx.userId, ctx.roles, excludeRampUp, sinceMinutes,
    );
    if (isRollupPending(result)) {
      throw new HttpException(result, HttpStatus.ACCEPTED);
    }
    return result;
  }

  @Get(':testRunId/transactions/:transactionName/timeseries')
  @ApiOperation({ summary: 'Get time-series data for a transaction with configurable aggregation' })
  @ApiParam({ name: 'testRunId', description: 'Test run ID', type: String })
  @ApiParam({ name: 'transactionName', description: 'Transaction name', type: String })
  @ApiQuery({
    name: 'aggregationSeconds',
    required: false,
    description: 'Time bucket aggregation in seconds — must be an integer >= 5 and a multiple of 5 (e.g. 5, 10, 15, 30, 60).',
    type: Number,
    example: 5
  })
  @ApiQuery({
    name: 'excludeRampUp',
    required: false,
    description: 'Exclude data during ramp-up time period',
    type: Boolean,
    example: false
  })
  @ApiResponse({
    status: 200,
    description: 'Time-series data retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        transaction_data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              time_bucket: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
              avg_response_time: { type: 'number', example: 125.45 },
              min_response_time: { type: 'number', example: 50 },
              max_response_time: { type: 'number', example: 350 },
              p95_response_time: { type: 'number', example: 280.50 },
              p99_response_time: { type: 'number', example: 320.75 },
              total_count: { type: 'number', example: 1523 },
              passed_count: { type: 'number', example: 1500 },
              failed_count: { type: 'number', example: 23 }
            }
          }
        },
        sampler_data: {
          type: 'object',
          additionalProperties: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                time_bucket: { type: 'string', format: 'date-time' },
                avg_response_time: { type: 'number' },
                min_response_time: { type: 'number' },
                max_response_time: { type: 'number' },
                p95_response_time: { type: 'number' },
                p99_response_time: { type: 'number' },
                total_count: { type: 'number' },
                passed_count: { type: 'number' },
                failed_count: { type: 'number' }
              }
            }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async getTransactionTimeSeries(
    @Param('testRunId') testRunId: string,
    @Param('transactionName') transactionName: string,
    @Query('aggregationSeconds', new DefaultValuePipe(5), ParseIntPipe) aggregationSeconds: number,
    @Query('excludeRampUp', new DefaultValuePipe(false), ParseBoolPipe) excludeRampUp: boolean,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug('Getting transaction timeseries', { testRunId, transactionName, aggregationSeconds, excludeRampUp });
    return this.testRunsService.getTransactionTimeSeries(testRunId, transactionName, ctx.userId, ctx.roles, aggregationSeconds, excludeRampUp);
  }

  @Get(':testRunId/transactions/:transactionName/samplers/:samplerName/timeseries')
  @ApiOperation({ summary: 'Get time-series data for a specific request/sampler with configurable aggregation' })
  @ApiParam({ name: 'testRunId', description: 'Test run ID', type: String })
  @ApiParam({ name: 'transactionName', description: 'Transaction name', type: String })
  @ApiParam({ name: 'samplerName', description: 'Sampler/request name', type: String })
  @ApiQuery({
    name: 'aggregationSeconds',
    required: false,
    description: 'Time bucket aggregation in seconds — must be an integer >= 5 and a multiple of 5 (e.g. 5, 10, 15, 30, 60).',
    type: Number,
    example: 5
  })
  @ApiQuery({
    name: 'excludeRampUp',
    required: false,
    description: 'Exclude data during ramp-up time period',
    type: Boolean,
    example: false
  })
  @ApiResponse({
    status: 200,
    description: 'Time-series data retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          time_bucket: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
          avg_response_time: { type: 'number', example: 125.45 },
          median_response_time: { type: 'number', example: 110.30 },
          min_response_time: { type: 'number', example: 50 },
          max_response_time: { type: 'number', example: 350 },
          p90_response_time: { type: 'number', example: 250.25 },
          p95_response_time: { type: 'number', example: 280.50 },
          p99_response_time: { type: 'number', example: 320.75 },
          total_count: { type: 'number', example: 1523 },
          passed_count: { type: 'number', example: 1500 },
          failed_count: { type: 'number', example: 23 }
        }
      }
    }
  })
  @ApiResponse({ status: 404, description: 'Test run or sampler not found' })
  async getSamplerTimeSeries(
    @Param('testRunId') testRunId: string,
    @Param('transactionName') transactionName: string,
    @Param('samplerName') samplerName: string,
    @Query('aggregationSeconds', new DefaultValuePipe(5), ParseIntPipe) aggregationSeconds: number,
    @Query('excludeRampUp', new DefaultValuePipe(false), ParseBoolPipe) excludeRampUp: boolean,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug('Getting sampler timeseries', { testRunId, transactionName, samplerName, aggregationSeconds, excludeRampUp });
    return this.testRunsService.getSamplerTimeSeries(testRunId, transactionName, samplerName, ctx.userId, ctx.roles, aggregationSeconds, excludeRampUp);
  }

  @Get(':testRunId/virtual-users')
  @ApiOperation({ summary: 'Get virtual user statistics for a test run' })
  @ApiParam({ name: 'testRunId', description: 'Test run ID', type: String })
  @ApiQuery({
    name: 'excludeRampUp',
    required: false,
    description: 'Exclude data during ramp-up time period',
    type: Boolean,
    example: false
  })
  @ApiResponse({
    status: 200,
    description: 'Virtual user statistics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        overall: {
          type: 'object',
          properties: {
            peak_active_threads: { type: 'number', example: 250 },
            avg_active_threads: { type: 'number', example: 180.5 },
            peak_started_threads: { type: 'number', example: 300 },
            avg_started_threads: { type: 'number', example: 220.3 },
            peak_finished_threads: { type: 'number', example: 295 },
            avg_finished_threads: { type: 'number', example: 215.7 },
            total_data_points: { type: 'number', example: 1523 }
          }
        },
        by_scenario: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              scenario_name: { type: 'string', example: 'Login Flow' },
              peak_active_threads: { type: 'number', example: 150 },
              avg_active_threads: { type: 'number', example: 95.2 },
              peak_started_threads: { type: 'number', example: 175 },
              avg_started_threads: { type: 'number', example: 110.5 },
              peak_finished_threads: { type: 'number', example: 170 },
              avg_finished_threads: { type: 'number', example: 108.3 },
              total_data_points: { type: 'number', example: 512 }
            }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async getVirtualUserStats(
    @Param('testRunId') testRunId: string,
    @Query('excludeRampUp', new DefaultValuePipe(false), ParseBoolPipe) excludeRampUp: boolean,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug('Getting virtual user stats', { testRunId, excludeRampUp });
    return this.testRunsService.getVirtualUserStats(testRunId, ctx.userId, ctx.roles, excludeRampUp);
  }

  @Get(':testRunId/throughput')
  @ApiOperation({ summary: 'Get peak throughput statistics for a test run' })
  @ApiParam({ name: 'testRunId', description: 'Test run ID', type: String })
  @ApiQuery({
    name: 'excludeRampUp',
    required: false,
    description: 'Exclude data during ramp-up time period',
    type: Boolean,
    example: false
  })
  @ApiResponse({
    status: 200,
    description: 'Throughput statistics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        overall: {
          type: 'object',
          properties: {
            peak_transactions_per_second: { type: 'number', example: 45 },
            peak_requests_per_second: { type: 'number', example: 892 },
          }
        },
        by_scenario: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              scenario_name: { type: 'string', example: 'Login Flow' },
              peak_transactions_per_second: { type: 'number', example: 25 },
              peak_requests_per_second: { type: 'number', example: 450 },
            }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async getThroughputStats(
    @Param('testRunId') testRunId: string,
    @Query('excludeRampUp', new DefaultValuePipe(false), ParseBoolPipe) excludeRampUp: boolean,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug('Getting throughput stats', { testRunId, excludeRampUp });
    return this.testRunsService.getThroughputStats(testRunId, ctx.userId, ctx.roles, excludeRampUp);
  }

  @Get(':testRunId/request-names')
  @ApiOperation({
    summary: 'Get unique request names for a test run',
    description:
      'Returns distinct request names. If panelDescription is provided, queries ds_panels/ds_metrics for metric names. ' +
      'Otherwise, queries requests_raw table for request names.',
  })
  @ApiParam({ name: 'testRunId', description: 'Test run ID', type: String })
  @ApiQuery({
    name: 'panelDescription',
    required: false,
    description: 'Panel description to filter metrics (e.g., "Request Duration")',
    example: 'Request Duration',
  })
  @ApiResponse({
    status: 200,
    description: 'Request names retrieved successfully',
    schema: {
      type: 'array',
      items: { type: 'string' },
      example: ['GET /api/users', 'POST /api/orders', 'GET /api/products'],
    },
  })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async getRequestNames(
    @Param('testRunId') testRunId: string,
    @Query('panelDescription') panelDescription: string | undefined,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug('Getting request names', { testRunId, panelDescription });
    return this.testRunsService.getRequestNames(testRunId, ctx.userId, ctx.roles, panelDescription);
  }
}
