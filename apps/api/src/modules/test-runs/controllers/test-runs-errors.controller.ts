import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';
import { UserCtx, UserContext } from '../../../common/decorators/user-context.decorator';
import { TestRunsService } from '../test-runs.service';
import { TestRunsErrorAnalysisService } from '../services/test-runs-error-analysis.service';

@ApiTags('test-runs-errors')
@Controller('test-runs')
export class TestRunsErrorsController {
  constructor(
    private readonly testRunsService: TestRunsService,
    private readonly errorAnalysisService: TestRunsErrorAnalysisService,
  ) {}

  @Get(':testRunId/errors')
  @ApiOperation({ summary: 'Get grouped error statistics for failed requests in a test run' })
  @ApiParam({ name: 'testRunId', description: 'Test run ID', type: String })
  @ApiQuery({ name: 'transactionName', required: false, description: 'Filter errors by transaction name', type: String })
  @ApiQuery({ name: 'samplerName', required: false, description: 'Filter errors by sampler name', type: String })
  @ApiResponse({
    status: 200,
    description: 'Grouped error statistics retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          error_type: { type: 'string', example: 'HTTP 500', description: 'Classified error type' },
          response_code: { type: 'string', example: '500' },
          response_message: { type: 'string', example: 'Internal Server Error' },
          sampler_name: { type: 'string', example: 'POST /api/process' },
          url: { type: 'string', example: 'https://api.example.com/process' },
          url_hash: { type: 'string', nullable: true, example: 'a1b2c3d4', description: 'Hash of normalized URL' },
          url_pattern: { type: 'string', nullable: true, example: '/api/user/{id}/profile', description: 'Normalized URL pattern with placeholders' },
          count: { type: 'number', example: 45, description: 'Number of failed requests' },
          first_occurrence: { type: 'string', format: 'date-time' },
          last_occurrence: { type: 'string', format: 'date-time' },
          sample_response_data: { type: 'string', description: 'Sample response body from latest occurrence' },
          total_requests: { type: 'number', example: 150, description: 'Total requests (passed + failed) for this sampler/URL' },
          apdex_score: { type: 'number', example: 0.875, description: 'Apdex score for this sampler/URL (0-1)' }
        }
      }
    }
  })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async getTransactionErrors(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
    @Query('transactionName') transactionName?: string,
    @Query('samplerName') samplerName?: string,
  ) {
    return this.testRunsService.getTransactionErrors(testRunId, ctx.userId, ctx.roles, transactionName, samplerName);
  }

  // Error Analysis Endpoints

  @Get(':testRunId/error-analysis/summary')
  @ApiOperation({
    summary: 'Get error summary statistics for a test run',
    description: 'Returns aggregated error statistics including total errors, unique error codes, affected transactions, and error rate'
  })
  @ApiParam({ name: 'testRunId', description: 'Test run ID', type: String })
  @ApiResponse({
    status: 200,
    description: 'Error summary retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        totalErrors: { type: 'number', example: 25 },
        uniqueResponseCodes: { type: 'number', example: 3 },
        transactionsWithErrors: { type: 'number', example: 5 },
        uniqueErrorUrls: { type: 'number', example: 8 },
        totalRequests: { type: 'number', example: 1000 },
        errorRate: { type: 'number', example: 2.5 }
      }
    }
  })
  async getErrorSummary(@Param('testRunId') testRunId: string, @UserCtx() ctx: UserContext) {
    await this.testRunsService.verifyTestRunAccess(testRunId, ctx.userId, ctx.roles);
    return this.errorAnalysisService.getErrorSummary(testRunId);
  }

  @Get(':testRunId/error-analysis/by-code')
  @ApiOperation({
    summary: 'Get errors grouped by response code',
    description: 'Returns error statistics grouped by HTTP response code'
  })
  @ApiParam({ name: 'testRunId', description: 'Test run ID', type: String })
  @ApiResponse({
    status: 200,
    description: 'Errors by code retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          responseCode: { type: 'string', example: '500' },
          errorCount: { type: 'number', example: 15 },
          avgResponseTime: { type: 'number', example: 234.5 },
          minResponseTime: { type: 'number', example: 120 },
          maxResponseTime: { type: 'number', example: 450 }
        }
      }
    }
  })
  async getErrorsByCode(@Param('testRunId') testRunId: string, @UserCtx() ctx: UserContext) {
    await this.testRunsService.verifyTestRunAccess(testRunId, ctx.userId, ctx.roles);
    return this.errorAnalysisService.getErrorsByCode(testRunId);
  }

  @Get(':testRunId/error-analysis/by-transaction')
  @ApiOperation({
    summary: 'Get errors grouped by transaction/sampler/url',
    description: 'Returns error statistics grouped by transaction name, sampler name, and URL'
  })
  @ApiParam({ name: 'testRunId', description: 'Test run ID', type: String })
  @ApiResponse({
    status: 200,
    description: 'Errors by transaction retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          transactionName: { type: 'string', example: 'T03_Search_Products' },
          samplerName: { type: 'string', example: 'search_external_api_call' },
          url: { type: 'string', example: 'http://api.example.com/search' },
          responseCode: { type: 'string', example: '500' },
          errorCount: { type: 'number', example: 10 },
          avgResponseTime: { type: 'number', example: 234.5 }
        }
      }
    }
  })
  async getErrorsByTransaction(@Param('testRunId') testRunId: string, @UserCtx() ctx: UserContext) {
    await this.testRunsService.verifyTestRunAccess(testRunId, ctx.userId, ctx.roles);
    return this.errorAnalysisService.getErrorsByTransaction(testRunId);
  }

  @Get(':testRunId/error-analysis/over-time')
  @ApiOperation({
    summary: 'Get errors over time (grouped by minute)',
    description: 'Returns time-series data of errors per minute'
  })
  @ApiParam({ name: 'testRunId', description: 'Test run ID', type: String })
  @ApiResponse({
    status: 200,
    description: 'Errors over time retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          timeBucket: { type: 'string', format: 'date-time', example: '2025-12-03T18:44:00.000Z' },
          errorsPerMinute: { type: 'number', example: 3 }
        }
      }
    }
  })
  async getErrorsOverTime(@Param('testRunId') testRunId: string, @UserCtx() ctx: UserContext) {
    await this.testRunsService.verifyTestRunAccess(testRunId, ctx.userId, ctx.roles);
    return this.errorAnalysisService.getErrorsOverTime(testRunId);
  }

  @Get(':testRunId/error-analysis/over-time-by-code')
  @ApiOperation({
    summary: 'Get errors over time grouped by response code',
    description: 'Returns time-series data of errors per minute grouped by response code for multi-line charts'
  })
  @ApiParam({ name: 'testRunId', description: 'Test run ID', type: String })
  @ApiResponse({
    status: 200,
    description: 'Errors over time by code retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          timeBucket: { type: 'string', format: 'date-time', example: '2025-12-03T18:44:00.000Z' },
          '404': { type: 'number', example: 5, description: 'Count of 404 errors' },
          '500': { type: 'number', example: 2, description: 'Count of 500 errors' }
        },
        additionalProperties: { type: 'number' }
      }
    }
  })
  async getErrorsOverTimeByCode(@Param('testRunId') testRunId: string, @UserCtx() ctx: UserContext) {
    await this.testRunsService.verifyTestRunAccess(testRunId, ctx.userId, ctx.roles);
    return this.errorAnalysisService.getErrorsOverTimeByCode(testRunId);
  }

  @Get(':testRunId/error-analysis/details')
  @ApiOperation({
    summary: 'Get detailed error information for specific transaction/sampler/url',
    description: 'Returns detailed error data including request/response headers, response data, and timestamps'
  })
  @ApiParam({ name: 'testRunId', description: 'Test run ID', type: String })
  @ApiQuery({ name: 'transaction', description: 'Transaction name', required: true, type: String })
  @ApiQuery({ name: 'sampler', description: 'Sampler name', required: true, type: String })
  @ApiQuery({ name: 'url', description: 'URL', required: true, type: String })
  @ApiResponse({
    status: 200,
    description: 'Error details retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          time: { type: 'string', format: 'date-time' },
          transactionName: { type: 'string' },
          samplerName: { type: 'string' },
          responseCode: { type: 'string' },
          responseTime: { type: 'number' },
          url: { type: 'string' },
          responseMessage: { type: 'string' },
          responseData: { type: 'string' },
          requestHeaders: { type: 'string' },
          responseHeaders: { type: 'string' }
        }
      }
    }
  })
  async getErrorDetails(
    @Param('testRunId') testRunId: string,
    @Query('transaction') transaction: string,
    @Query('sampler') sampler: string,
    @Query('url') url: string,
    @UserCtx() ctx: UserContext,
  ) {
    await this.testRunsService.verifyTestRunAccess(testRunId, ctx.userId, ctx.roles);
    return this.errorAnalysisService.getErrorDetails(testRunId, transaction, sampler, url);
  }
}
