import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';
import { ApplySeriesGroupingDto } from './dto/apply-series-grouping.dto';
import { PreviewSeriesGroupingDto } from './dto/preview-series-grouping.dto';
import {
  SeriesGroupingApplyResultDto,
  SeriesGroupingPreviewResponseDto,
} from './dto/series-grouping-insights-response.dto';
import { SeriesGroupingInsightsService } from './series-grouping-insights.service';

/**
 * The run-aware routes beside the rules CRUD (`SeriesGroupingController`, same prefix). Nest
 * allows several controllers on one prefix; these are `POST`s on fixed segments, so they can
 * never be mistaken for `/:id`.
 */
@ApiTags('Series Grouping')
@ApiBearerAuth()
@Controller('series-grouping-rules')
export class SeriesGroupingInsightsController {
  constructor(
    private readonly insights: SeriesGroupingInsightsService,
    private readonly authzService: AuthorizationService,
  ) {}

  /**
   * The caller's accessible organizations, or `null` for a global admin, resolved once per request
   * and handed to the service as a required parameter (root CLAUDE.md #48).
   */
  private resolveOrgScope(ctx: UserContext): Promise<string[] | null> {
    return withOrgFilter(ctx.userId, ctx.roles, this.authzService);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Preview a series grouping rule against a run and its baseline',
    description:
      'Read-only. Returns the raw series names of the run and of its baseline runs per panel (the client ' +
      'computes the groups with `applySeriesGrouping`), the SLOs whose match pattern would judge nothing after ' +
      'grouping, raw baseline names that equal a group name, and the alignment of groups an earlier rule already ' +
      'formed. Without `testRunId` it uses the workload\'s most recent completed run.',
  })
  @ApiResponse({ status: 200, type: SeriesGroupingPreviewResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid or unsafe rule, a performance test dashboard, or no run named' })
  @ApiResponse({ status: 404, description: 'Run or dashboard not found (or not in the caller\'s organizations)' })
  async preview(
    @Body() dto: PreviewSeriesGroupingDto,
    @UserCtx() ctx: UserContext,
  ): Promise<SeriesGroupingPreviewResponseDto> {
    return this.insights.preview(dto, await this.resolveOrgScope(ctx));
  }

  @Post('apply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recalculate statistics so series grouping rules take effect on runs that already exist',
    description:
      'Re-evaluates the run plus its baseline runs (`baseline`) or the workload\'s most recent completed runs ' +
      '(`recent`, truncated at 100) with recalculated statistics. Runs that are still running or on another team ' +
      'or organization are skipped and reported. The batch is enqueued after the request commits, so `enqueued` ' +
      'says what was scheduled; a failed enqueue only shows in the API log.',
  })
  @ApiResponse({ status: 200, type: SeriesGroupingApplyResultDto })
  @ApiResponse({ status: 403, description: 'Missing test-run:update on the run' })
  @ApiResponse({ status: 404, description: 'Run not found (or not in the caller\'s organizations)' })
  async apply(@Body() dto: ApplySeriesGroupingDto, @UserCtx() ctx: UserContext): Promise<SeriesGroupingApplyResultDto> {
    return this.insights.apply(dto, ctx.userId, ctx.roles, await this.resolveOrgScope(ctx));
  }
}
