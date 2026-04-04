import { Controller, Get, Post, Put, Param, Query, Body, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';
import { AuthorizationService } from '../../common/services/authorization.service';
import { ScalingSessionsService } from './scaling-sessions.service';
import { CreateScalingSessionDto } from './dto/create-scaling-session.dto';
import { UpdateScalingSessionDto } from './dto/update-scaling-session.dto';

@ApiTags('scaling-sessions')
@ApiBearerAuth()
@Controller('scaling-sessions')
export class ScalingSessionsController {
  constructor(
    private readonly service: ScalingSessionsService,
    private readonly authzService: AuthorizationService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a scaling session' })
  @ApiResponse({ status: 201, description: 'Session created' })
  async create(
    @Body() dto: CreateScalingSessionDto,
    @UserCtx() ctx: UserContext,
  ) {
    let organizationId: string = ctx.organizationId || '';
    if (!organizationId) {
      const userOrgs = await this.authzService.getAccessibleOrganizations(ctx.userId);
      if (userOrgs.length === 0) {
        throw new BadRequestException('User must belong to an organization');
      }
      organizationId = userOrgs[0]!;
    }
    return this.service.create(dto, ctx.userId, organizationId);
  }

  @Get()
  @ApiOperation({ summary: 'List scaling sessions' })
  @ApiQuery({ name: 'systemUnderTestId', required: false })
  @ApiQuery({ name: 'testEnvironment', required: false })
  @ApiQuery({ name: 'workload', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'completed', 'abandoned'] })
  async findAll(
    @UserCtx() ctx: UserContext,
    @Query('systemUnderTestId') systemUnderTestId?: string,
    @Query('testEnvironment') testEnvironment?: string,
    @Query('workload') workload?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findAll(ctx.userId, ctx.roles, {
      systemUnderTestId, testEnvironment, workload, status,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a scaling session' })
  async findOne(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ) {
    return this.service.findOne(id, ctx.userId, ctx.roles);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a scaling session' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateScalingSessionDto,
    @UserCtx() ctx: UserContext,
  ) {
    return this.service.update(id, dto, ctx.userId, ctx.roles);
  }

  @Get(':id/progression')
  @ApiOperation({ summary: 'Get metrics progression across all runs in a scaling session' })
  async getProgression(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ) {
    return this.service.getProgression(id, ctx.userId, ctx.roles);
  }

  @Put(':id/runs/:testRunId')
  @ApiOperation({ summary: 'Add a test run to a scaling session' })
  @ApiResponse({ status: 200, description: 'Test run added to session' })
  async addTestRun(
    @Param('id') id: string,
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
  ) {
    return this.service.addTestRun(id, testRunId, ctx.userId, ctx.roles);
  }
}
