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

  @Get(':testRunId/aggregated-metric-statistic')
  @ApiOperation({
    summary: 'Get the run-wide aggregate of a metric as a single value per test run (for Trends/Compare "All aggregated")',
    description:
      'Served from the pre-computed rollups, so every stat costs one pass. Computed over the analysis window ' +
      '(ramp-up excluded) when the run has analysis-window rows, otherwise over the full run. Percentiles are ' +
      'tdigest approximations, the same sketches the per-transaction rows report. Note this differs from the ' +
      'sibling aggregated-metric-timeseries endpoint, whose applyAnalysisWindow defaults to false.',
  })
  @ApiParam({ name: 'testRunId', description: 'Anchor test run UUID or test_run_id string (org-access scope)', type: String })
  @ApiQuery({ name: 'metric', required: true, enum: ALLOWED_METRICS })
  @ApiQuery({ name: 'stat', required: false, enum: ALLOWED_STATS, description: 'Required for response-time metrics; ignored for error_percentage.' })
  @ApiQuery({ name: 'testRunIds', required: false, type: String, description: 'Comma-separated test_run_id list to aggregate (defaults to the path run).' })
  @ApiResponse({
    status: 200,
    description:
      'One aggregate per requested run. `value` is the requested stat (for error_percentage, always the percentage — ' +
      '`stat` is ignored). `values` carries avg/p50/p90/p95/p99/max for the response-time metrics, and `avg` alone ' +
      'for error_percentage. `value` is null and `values` is `{}` when a run has no data or is out of scope.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          testRunId: { type: 'string' },
          value: { type: 'number', nullable: true },
          values: { type: 'object', additionalProperties: { type: 'number', nullable: true } },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid metric or stat parameter' })
  async getAggregatedMetricStatistic(
    @Param('testRunId') testRunId: string,
    @Query('metric') metric: string,
    @Query('stat') stat: string,
    @Query('testRunIds') testRunIdsRaw: string,
    @UserCtx() ctx: UserContext,
  ) {
    if (!(ALLOWED_METRICS as readonly string[]).includes(metric)) {
      throw new BadRequestException(`metric must be one of: ${ALLOWED_METRICS.join(', ')}`);
    }
    if (metric !== 'error_percentage' && !(ALLOWED_STATS as readonly string[]).includes(stat)) {
      throw new BadRequestException(`stat must be one of: ${ALLOWED_STATS.join(', ')} (required unless metric is error_percentage)`);
    }

    const testRunIds = (testRunIdsRaw ?? '')
      .split(',')
      .map(id => id.trim())
      .filter(id => id.length > 0);
    const ids = testRunIds.length > 0 ? testRunIds : [testRunId];

    return this.testRunsService.getAggregatedMetricStatistics(
      ids,
      ctx.userId,
      ctx.roles,
      metric as AllowedMetric,
      (stat as AllowedStat) ?? 'avg',
    );
  }
}
