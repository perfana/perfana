import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';
import { SeriesGroupingService } from './series-grouping.service';
import { CreateSeriesGroupingRuleDto } from './dto/create-series-grouping-rule.dto';
import { UpdateSeriesGroupingRuleDto } from './dto/update-series-grouping-rule.dto';
import {
  SeriesGroupingCreateResultDto,
  SeriesGroupingRuleResponseDto,
} from './dto/series-grouping-rule-response.dto';

/**
 * Series grouping rules: CRUD. Preview, suggestions, apply and status live beside it
 * (series-grouping-insights.controller.ts, series-grouping-test-run.controller.ts).
 *
 * No try/catch here on purpose: the service throws HttpExceptions, and a catch that wrapped
 * everything would turn its 409 into a 500 (apps/api/CODING_RULES.md, "Turning a constraint
 * violation into a 409").
 */
@ApiTags('Series Grouping')
@ApiBearerAuth()
@Controller('series-grouping-rules')
export class SeriesGroupingController {
  constructor(
    private readonly service: SeriesGroupingService,
    private readonly authzService: AuthorizationService,
  ) {}

  /** The caller's accessible organizations, or `null` for a global admin; resolved once per request. */
  private orgScope(ctx: UserContext): Promise<string[] | null> {
    return withOrgFilter(ctx.userId, ctx.roles, this.authzService);
  }

  @Get()
  @ApiOperation({
    summary: 'List series grouping rules',
    description: "Rules of a system under test, optionally narrowed to an environment, workload and application dashboard. Scoped to the caller's organizations.",
  })
  @ApiQuery({ name: 'systemId', required: true })
  @ApiQuery({ name: 'environment', required: false })
  @ApiQuery({ name: 'workload', required: false })
  @ApiQuery({ name: 'applicationDashboardId', required: false })
  @ApiResponse({ status: 200, type: [SeriesGroupingRuleResponseDto] })
  async findAll(
    @Query('systemId', ParseUUIDPipe) systemId: string,
    @UserCtx() ctx: UserContext,
    @Query('environment') environment?: string,
    @Query('workload') workload?: string,
    @Query('applicationDashboardId', new ParseUUIDPipe({ optional: true })) applicationDashboardId?: string,
  ): Promise<SeriesGroupingRuleResponseDto[]> {
    return this.service.findAll({ systemId, environment, workload, applicationDashboardId }, await this.orgScope(ctx));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one series grouping rule' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: SeriesGroupingRuleResponseDto })
  @ApiResponse({ status: 404, description: 'Not found, or outside your organizations' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @UserCtx() ctx: UserContext): Promise<SeriesGroupingRuleResponseDto> {
    return this.service.findOne(id, await this.orgScope(ctx));
  }

  @Post()
  @ApiOperation({
    summary: 'Create a series grouping rule',
    description:
      'Creates the rule for one panel (or, with no panelId, every panel) of an application dashboard in a workload, and optionally the same rule for other workloads of the system (`copyTo`). The rule takes effect on the next statistics recalculation; see POST /series-grouping-rules/apply.',
  })
  @ApiResponse({ status: 201, type: SeriesGroupingCreateResultDto })
  @ApiResponse({ status: 400, description: 'Invalid or unsafe pattern, or a performance-test dashboard' })
  @ApiResponse({ status: 403, description: 'Missing benchmark:manage in the dashboard\'s organization' })
  @ApiResponse({ status: 404, description: 'Application dashboard not found in that system and environment, or outside your organizations' })
  @ApiResponse({
    status: 409,
    description: 'A rule already exists for this slot. A constraint violation the user has to act on, with no resource body: edit or delete the existing rule.',
  })
  async create(@Body() dto: CreateSeriesGroupingRuleDto, @UserCtx() ctx: UserContext): Promise<SeriesGroupingCreateResultDto> {
    return this.service.create(dto, ctx.userId, ctx.roles, await this.orgScope(ctx));
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a series grouping rule',
    description: 'Changes the pattern, aggregation, member-count tracking or enabled flag. The slot (system, environment, workload, dashboard, panel) cannot be changed.',
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: SeriesGroupingRuleResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid or unsafe pattern' })
  @ApiResponse({ status: 403, description: 'Missing benchmark:manage in the rule\'s organization' })
  @ApiResponse({ status: 404, description: 'Not found, or outside your organizations' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSeriesGroupingRuleDto,
    @UserCtx() ctx: UserContext,
  ): Promise<SeriesGroupingRuleResponseDto> {
    return this.service.update(id, dto, ctx.userId, ctx.roles, await this.orgScope(ctx));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a series grouping rule',
    description: "Runs analysed under the rule keep their grouped statistics until they are recalculated; their membership rows lose the rule reference, which the status endpoint reports as stale.",
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 403, description: 'Missing benchmark:manage in the rule\'s organization' })
  @ApiResponse({ status: 404, description: 'Not found, or outside your organizations' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @UserCtx() ctx: UserContext): Promise<void> {
    await this.service.remove(id, ctx.userId, ctx.roles, await this.orgScope(ctx));
  }
}
