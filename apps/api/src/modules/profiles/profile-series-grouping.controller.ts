import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';
import {
  CreateProfileSeriesGroupingRuleDto,
  ProfileSeriesGroupingRuleResponseDto,
  UpdateProfileSeriesGroupingRuleDto,
} from './dto/profile-series-grouping-rule.dto';
import { ProfileSeriesGroupingService } from './profile-series-grouping.service';

const NOT_FOUND = 'Profile, profile dashboard or rule not found, or in an organization the caller does not belong to';
const FORBIDDEN = "Not an org-admin in the profile's organization";

@ApiTags('profiles')
@ApiBearerAuth()
@Controller('profiles/:id/dashboards/:dashboardId/grouping-rules')
export class ProfileSeriesGroupingController {
  constructor(
    private readonly service: ProfileSeriesGroupingService,
    private readonly authzService: AuthorizationService,
  ) {}

  private scope(ctx: UserContext): Promise<string[] | null> {
    return withOrgFilter(ctx.userId, ctx.roles, this.authzService);
  }

  @Get()
  @ApiOperation({ summary: "List a profile dashboard's series grouping rules" })
  @ApiParam({ name: 'id', description: 'Profile UUID' })
  @ApiParam({ name: 'dashboardId', description: 'Profile dashboard UUID' })
  @ApiResponse({ status: 200, type: [ProfileSeriesGroupingRuleResponseDto] })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async findAll(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dashboardId', ParseUUIDPipe) dashboardId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<ProfileSeriesGroupingRuleResponseDto[]> {
    return this.service.findAll(id, dashboardId, ctx.userId, await this.scope(ctx));
  }

  @Post()
  @ApiOperation({
    summary: 'Add a series grouping rule to a profile dashboard',
    description:
      'grafana-sync provisions it as a workload rule on every application dashboard built from this profile dashboard, ' +
      'in the workload of each run the profile matches.',
  })
  @ApiResponse({ status: 201, type: ProfileSeriesGroupingRuleResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid rule (unknown preset, unsafe custom pattern, no aggregation)' })
  @ApiResponse({ status: 403, description: FORBIDDEN })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 409, description: 'The panel already has a rule on this profile dashboard; nothing is returned' })
  async create(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dashboardId', ParseUUIDPipe) dashboardId: string,
    @Body() dto: CreateProfileSeriesGroupingRuleDto,
    @UserCtx() ctx: UserContext,
  ): Promise<ProfileSeriesGroupingRuleResponseDto> {
    return this.service.create(id, dashboardId, dto, ctx.userId, await this.scope(ctx));
  }

  @Put(':ruleId')
  @ApiOperation({
    summary: 'Edit a profile series grouping rule',
    description: 'The edit is carried to every provisioned workload rule nobody has edited since.',
  })
  @ApiResponse({ status: 200, type: ProfileSeriesGroupingRuleResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid rule' })
  @ApiResponse({ status: 403, description: FORBIDDEN })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dashboardId', ParseUUIDPipe) dashboardId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body() dto: UpdateProfileSeriesGroupingRuleDto,
    @UserCtx() ctx: UserContext,
  ): Promise<ProfileSeriesGroupingRuleResponseDto> {
    return this.service.update(id, dashboardId, ruleId, dto, ctx.userId, await this.scope(ctx));
  }

  @Delete(':ruleId')
  @ApiOperation({
    summary: 'Delete a profile series grouping rule',
    description: 'Also deletes the provisioned workload rules nobody has edited; edited ones are kept.',
  })
  @ApiResponse({ status: 200, description: 'Deleted' })
  @ApiResponse({ status: 403, description: FORBIDDEN })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dashboardId', ParseUUIDPipe) dashboardId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<{ message: string }> {
    await this.service.remove(id, dashboardId, ruleId, ctx.userId, await this.scope(ctx));
    return { message: 'Series grouping rule deleted' };
  }
}
