import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { TestRunsService } from '../test-runs.service';
import { UserCtx, UserContext } from '../../../common/decorators/user-context.decorator';

@ApiTags('test-runs-dashboard')
@ApiBearerAuth()
@Controller('test-runs')
export class TestRunsDashboardController {
  constructor(private readonly testRunsService: TestRunsService) {}

  @Get('dashboard/statistics')
  @ApiOperation({
    summary: 'Get dashboard statistics',
    description: 'Retrieves aggregated statistics for dashboard including total tests, pass/fail counts, active tests, SLO compliance rate, and most tested system. Supports both preset time periods and custom date ranges.'
  })
  @ApiQuery({ name: 'timePeriod', required: false, type: String, description: 'Time period for statistics', example: '7d', enum: ['24h', '7d', '30d', 'all', 'custom'] })
  @ApiQuery({ name: 'from', required: false, type: String, description: 'Start date for custom range (ISO 8601)', example: '2025-01-01T00:00:00Z' })
  @ApiQuery({ name: 'to', required: false, type: String, description: 'End date for custom range (ISO 8601)', example: '2025-01-31T23:59:59Z' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard statistics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        totalTests: { type: 'number', example: 150 },
        passedTests: { type: 'number', example: 120 },
        failedTests: { type: 'number', example: 25 },
        activeTests: { type: 'number', example: 5 },
        sloComplianceRate: { type: 'number', example: 85 },
        mostTestedSystem: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'PaymentService' },
            count: { type: 'number', example: 45 }
          }
        },
        timePeriod: { type: 'string', example: '7d' }
      }
    }
  })
  async getDashboardStatistics(
    @UserCtx() ctx: UserContext,
    @Query('timePeriod') timePeriod: '24h' | '7d' | '30d' | 'all' | 'custom' = '7d',
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.testRunsService.getDashboardStatistics(ctx.userId, ctx.roles, timePeriod, from, to, organizationId);
  }

  @Get('dashboard/recent-failures')
  @ApiOperation({
    summary: 'Get recent failed test runs',
    description: 'Retrieves the most recent failed test runs for dashboard display. Supports both preset time periods and custom date ranges.'
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Number of unreviewed failures to return', example: 5 })
  @ApiQuery({ name: 'timePeriod', required: false, type: String, description: 'Time period filter', example: '7d', enum: ['24h', '7d', '30d', 'all', 'custom'] })
  @ApiQuery({ name: 'from', required: false, type: String, description: 'Start date for custom range (ISO 8601)', example: '2025-01-01T00:00:00Z' })
  @ApiQuery({ name: 'to', required: false, type: String, description: 'End date for custom range (ISO 8601)', example: '2025-01-31T23:59:59Z' })
  @ApiResponse({
    status: 200,
    description: 'Recent failures retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '550e8400-e29b-41d4-a716-446655440000' },
          test_run_id: { type: 'string', example: 'PaymentService-production-loadTest-001' },
          system_name: { type: 'string', example: 'PaymentService' },
          test_environment: { type: 'string', example: 'production' },
          workload: { type: 'string', example: 'loadTest' },
          start_time: { type: 'string', example: '2025-01-15T10:00:00Z' },
          end_time: { type: 'string', example: '2025-01-15T11:00:00Z' },
          consolidated_result: { type: 'object' },
          created_at: { type: 'string', example: '2025-01-15T10:00:00Z' }
        }
      }
    }
  })
  async getRecentFailures(
    @UserCtx() ctx: UserContext,
    @Query('limit') limit: number = 5,
    @Query('timePeriod') timePeriod: '24h' | '7d' | '30d' | 'all' | 'custom' = '7d',
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.testRunsService.getRecentFailures(ctx.userId, ctx.roles, limit, timePeriod, from, to, organizationId);
  }

  @Get('dashboard/systems-summary')
  @ApiOperation({
    summary: 'Get systems summary for dashboard',
    description: 'Retrieves summary of all systems with test run counts, pass/fail ratios, and last test run timestamps.'
  })
  @ApiResponse({
    status: 200,
    description: 'Systems summary retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '550e8400-e29b-41d4-a716-446655440000' },
          name: { type: 'string', example: 'PaymentService' },
          testRunCount: { type: 'number', example: 45 },
          lastTestRun: { type: 'string', example: '2025-01-15T10:00:00Z' },
          passFailRatio: {
            type: 'object',
            properties: {
              passed: { type: 'number', example: 40 },
              failed: { type: 'number', example: 5 }
            }
          }
        }
      }
    }
  })
  async getDashboardSystemsSummary(
    @UserCtx() ctx: UserContext,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.testRunsService.getDashboardSystemsSummary(ctx.userId, ctx.roles, organizationId);
  }
}
