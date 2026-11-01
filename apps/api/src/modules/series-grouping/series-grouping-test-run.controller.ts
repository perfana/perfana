import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';
import {
  SeriesGroupingStatusDto,
  SeriesGroupingSuggestionDto,
} from './dto/series-grouping-insights-response.dto';
import { SeriesGroupingInsightsService } from './series-grouping-insights.service';

/** Series grouping, as seen from a test run. Nest allows several controllers on the `test-runs` prefix. */
@ApiTags('Series Grouping')
@ApiBearerAuth()
@Controller('test-runs')
export class SeriesGroupingTestRunController {
  constructor(
    private readonly insights: SeriesGroupingInsightsService,
    private readonly authzService: AuthorizationService,
  ) {}

  private resolveOrgScope(ctx: UserContext): Promise<string[] | null> {
    return withOrgFilter(ctx.userId, ctx.roles, this.authzService);
  }

  @Get(':id/series-grouping-suggestions')
  @ApiOperation({
    summary: 'Panels where a series grouping preset would turn incomparable results into comparisons',
    description:
      'Panels with at least two non-ignored `incomparable` ADAPT results, no enabled rule covering them, and a ' +
      'built-in preset that makes the run\'s names line up with its baseline. Computed on request from small ' +
      'tables; every served suggestion is logged so the thresholds can be tuned.',
  })
  @ApiParam({ name: 'id', description: 'The run\'s `test_run_id` (or its entity UUID)' })
  @ApiResponse({ status: 200, type: [SeriesGroupingSuggestionDto] })
  @ApiResponse({ status: 404, description: 'Test run not found (or not in the caller\'s organizations)' })
  async suggestions(@Param('id') id: string, @UserCtx() ctx: UserContext): Promise<SeriesGroupingSuggestionDto[]> {
    return this.insights.suggestions(id, await this.resolveOrgScope(ctx));
  }

  @Get(':id/series-grouping-status')
  @ApiOperation({
    summary: 'Is the run\'s series grouping in step with the rules that cover it?',
    description:
      '`stale` lists panels whose membership disagrees with the enabled rules (`not-applied`, `rule-changed`, ' +
      '`rule-removed`); `misaligned` lists groups whose members share almost no timestamps. A run that is still ' +
      'running reports nothing.',
  })
  @ApiParam({ name: 'id', description: 'The run\'s `test_run_id` (or its entity UUID)' })
  @ApiResponse({ status: 200, type: SeriesGroupingStatusDto })
  @ApiResponse({ status: 404, description: 'Test run not found (or not in the caller\'s organizations)' })
  async status(@Param('id') id: string, @UserCtx() ctx: UserContext): Promise<SeriesGroupingStatusDto> {
    return this.insights.status(id, await this.resolveOrgScope(ctx));
  }
}
