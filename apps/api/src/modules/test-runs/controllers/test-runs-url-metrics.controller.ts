import { Controller, Get, Param, Query, BadRequestException, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { UserCtx, UserContext } from '../../../common/decorators/user-context.decorator';
import { TestRunsService } from '../test-runs.service';

const ALLOWED_URL_METRICS = ['response_time', 'error_percentage', 'throughput', 'latency', 'connect_time'] as const;
type UrlMetric = typeof ALLOWED_URL_METRICS[number];

@ApiTags('test-runs-metrics')
@ApiBearerAuth()
@Controller('test-runs')
export class TestRunsUrlMetricsController {
  private readonly logger = new Logger(TestRunsUrlMetricsController.name);

  constructor(private readonly testRunsService: TestRunsService) {}

  @Get(':testRunId/url-distinct-names')
  @ApiOperation({ summary: 'Distinct normalized URLs in a run (for the Compare card URL dimension)' })
  @ApiParam({ name: 'testRunId', description: 'Anchor test_run_id string', type: String })
  @ApiResponse({ status: 200, description: 'Sorted list of normalized URLs', schema: { type: 'array', items: { type: 'string' } } })
  async getUrlDistinctNames(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<string[]> {
    return this.testRunsService.getUrlDistinctNames(testRunId, ctx.userId, ctx.roles);
  }

  @Get(':testRunId/sampler-url-map')
  @ApiOperation({ summary: 'Map of sampler/request name to normalized URL (Compare card Request RT dimension)' })
  @ApiParam({ name: 'testRunId', description: 'Anchor test_run_id string', type: String })
  @ApiResponse({ status: 200, description: 'Object keyed by sampler name with the normalized URL as value', schema: { type: 'object', additionalProperties: { type: 'string' } } })
  async getSamplerUrlMap(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<Record<string, string>> {
    return this.testRunsService.getSamplerUrlMap(testRunId, ctx.userId, ctx.roles);
  }

  @Get(':testRunId/url-metric-statistics')
  @ApiOperation({ summary: 'Per-normalized-URL statistics across runs (Compare card URL dimension)' })
  @ApiParam({ name: 'testRunId', description: 'Anchor test_run_id string (org-access scope)', type: String })
  @ApiQuery({ name: 'metric', required: true, enum: ALLOWED_URL_METRICS })
  @ApiQuery({ name: 'testRunIds', required: false, type: String, description: 'Comma-separated test_run_id list (defaults to the path run).' })
  @ApiResponse({ status: 200, description: 'One MetricStatistic row per normalized URL per run' })
  @ApiResponse({ status: 400, description: 'Invalid metric parameter' })
  async getUrlMetricStatistics(
    @Param('testRunId') testRunId: string,
    @Query('metric') metric: string,
    @Query('testRunIds') testRunIdsRaw: string,
    @UserCtx() ctx: UserContext,
  ) {
    if (!(ALLOWED_URL_METRICS as readonly string[]).includes(metric)) {
      throw new BadRequestException(`metric must be one of: ${ALLOWED_URL_METRICS.join(', ')}`);
    }
    const testRunIds = (testRunIdsRaw ?? '')
      .split(',')
      .map(id => id.trim())
      .filter(id => id.length > 0);
    const ids = testRunIds.length > 0 ? testRunIds : [testRunId];
    this.logger.debug('Getting URL metric statistics', { testRunId, metric, testRunIds: ids });

    return this.testRunsService.getUrlMetricStatistics(ids, ctx.userId, ctx.roles, metric as UrlMetric);
  }
}
