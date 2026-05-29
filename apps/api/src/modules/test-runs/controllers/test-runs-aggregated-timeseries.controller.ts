import { Controller, Get, Param, Query, BadRequestException, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { UserCtx, UserContext } from '../../../common/decorators/user-context.decorator';
import { TestRunsService } from '../test-runs.service';

const ALLOWED_METRICS = ['transaction_response_time', 'request_response_time', 'error_percentage'] as const;
const ALLOWED_STATS = ['avg', 'p50', 'p90', 'p95', 'p99', 'max'] as const;

type AllowedMetric = typeof ALLOWED_METRICS[number];
type AllowedStat = typeof ALLOWED_STATS[number];

@ApiTags('test-runs-metrics')
@ApiBearerAuth()
@Controller('test-runs')
export class TestRunsAggregatedTimeseriesController {
  private readonly logger = new Logger(TestRunsAggregatedTimeseriesController.name);

  constructor(private readonly testRunsService: TestRunsService) {}

  @Get(':testRunId/aggregated-metric-timeseries')
  @ApiOperation({ summary: 'Get a metric as 60-second bucketed timeseries for aggregated SLO charts' })
  @ApiParam({ name: 'testRunId', description: 'Test run UUID or test_run_id string', type: String })
  @ApiQuery({
    name: 'metric',
    required: true,
    enum: ALLOWED_METRICS,
    description: 'Metric to aggregate over time',
  })
  @ApiQuery({
    name: 'stat',
    required: false,
    enum: ALLOWED_STATS,
    description: 'Aggregation statistic. Required for transaction_response_time and request_response_time; ignored for error_percentage.',
  })
  @ApiQuery({
    name: 'applyAnalysisWindow',
    required: false,
    type: Boolean,
    description: 'When true, clips the time range to the configured analysis window (default: false)',
  })
  @ApiResponse({
    status: 200,
    description: '60-second bucketed timeseries',
    schema: {
      type: 'object',
      properties: {
        bucketSizeSeconds: { type: 'number', example: 60 },
        buckets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              time: { type: 'string', format: 'date-time' },
              value: { type: 'number', example: 1823.4 },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid metric or stat parameter' })
  async getAggregatedMetricTimeseries(
    @Param('testRunId') testRunId: string,
    @Query('metric') metric: string,
    @Query('stat') stat: string,
    @Query('applyAnalysisWindow') applyAnalysisWindowRaw: string,
    @UserCtx() ctx: UserContext,
  ) {
    if (!(ALLOWED_METRICS as readonly string[]).includes(metric)) {
      throw new BadRequestException(`metric must be one of: ${ALLOWED_METRICS.join(', ')}`);
    }
    if (metric !== 'error_percentage' && !(ALLOWED_STATS as readonly string[]).includes(stat)) {
      throw new BadRequestException(`stat must be one of: ${ALLOWED_STATS.join(', ')} (required unless metric is error_percentage)`);
    }

    const applyAnalysisWindow = applyAnalysisWindowRaw === 'true';
    this.logger.debug('Getting aggregated metric timeseries', { testRunId, metric, stat, applyAnalysisWindow });

    return this.testRunsService.getAggregatedMetricTimeseries(
      testRunId,
      ctx.userId,
      ctx.roles,
      metric as AllowedMetric,
      (stat as AllowedStat) ?? 'avg',
      applyAnalysisWindow,
    );
  }
}
