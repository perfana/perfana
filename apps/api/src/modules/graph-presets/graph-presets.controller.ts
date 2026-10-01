import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery
} from '@nestjs/swagger';
import { GraphPresetsService } from './graph-presets.service';
import { CreateGraphPresetDto } from './dto/create-graph-preset.dto';
import { UpdateGraphPresetDto } from './dto/update-graph-preset.dto';
import { GraphPresetResponseDto } from './dto/graph-preset-response.dto';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';

@ApiTags('Graph Presets')
@ApiBearerAuth()
@Controller('graph-presets')
export class GraphPresetsController {
  constructor(
    private readonly graphPresetsService: GraphPresetsService,
    private readonly authzService: AuthorizationService,
  ) {}

  /**
   * The caller's accessible organizations, or `null` for a global admin. Every route
   * passes this to the service: the by-id routes use it as a tenant boundary, and
   * `create` uses it to authorize the run whose organization the preset inherits.
   */
  private resolveOrgScope(userId: string, roles: string[]): Promise<string[] | null> {
    return withOrgFilter(userId, roles, this.authzService);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new graph preset',
    description: 'Save a custom graph configuration with multiple data series from various dashboards'
  })
  @ApiResponse({
    status: 201,
    description: 'Graph preset created successfully',
    type: GraphPresetResponseDto
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data'
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized'
  })
  async create(
    @Body() createGraphPresetDto: CreateGraphPresetDto,
    @UserCtx() ctx: UserContext
  ): Promise<GraphPresetResponseDto> {
    const orgIds = await this.resolveOrgScope(ctx.userId, ctx.roles);
    return this.graphPresetsService.create(createGraphPresetDto, ctx.userId, orgIds);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all graph presets',
    description:
      'Graph presets visible to the caller, always scoped to their organizations. With `testRunId`, results are scoped to that run\'s system under test: a run-specific preset must match the run exactly, and a global preset is matched through its first series\' application dashboard (same system AND environment) — so a preset whose dashboard was deleted drops off this list while remaining reachable via GET /:id. Global admins skip the ownership and organization predicates but keep the system scoping.'
  })
  @ApiQuery({
    name: 'testRunId',
    description:
      'Test run to scope results to. This is the scope key, not a filter: omit it and you get every preset in your organizations, unscoped by system.',
    required: false,
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  @ApiResponse({
    status: 200,
    description: 'Graph presets retrieved successfully',
    type: [GraphPresetResponseDto]
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized'
  })
  async findAll(
    @UserCtx() ctx: UserContext,
    @Query('testRunId') testRunId?: string
  ): Promise<GraphPresetResponseDto[]> {
    // One call does both jobs: `null` means global admin, anything else is the
    // caller's accessible organizations. findAll needs the list, not just the flag —
    // without it the no-testRunId form returned every global preset in the database,
    // across every tenant.
    const orgIds = await this.resolveOrgScope(ctx.userId, ctx.roles);
    return this.graphPresetsService.findAll(ctx.userId, orgIds === null, testRunId, orgIds);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a specific graph preset',
    description: 'Retrieve a single graph preset by ID. User must own the preset, it must be global, or user must be a global admin.'
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the graph preset',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  @ApiResponse({
    status: 200,
    description: 'Graph preset retrieved successfully',
    type: GraphPresetResponseDto
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - access denied to this preset'
  })
  @ApiResponse({
    status: 404,
    description: 'Graph preset not found'
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized'
  })
  async findOne(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext
  ): Promise<GraphPresetResponseDto> {
    const orgIds = await this.resolveOrgScope(ctx.userId, ctx.roles);
    return this.graphPresetsService.findOne(id, ctx.userId, orgIds === null, orgIds);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a graph preset',
    description:
      'Update an existing graph preset. Only owner or global admin can update. `testRunId` is not updatable: a preset belongs to the system under test it was saved from.'
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the graph preset',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  @ApiResponse({
    status: 200,
    description: 'Graph preset updated successfully',
    type: GraphPresetResponseDto
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request body'
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - can only update own presets (unless global admin)'
  })
  @ApiResponse({
    status: 404,
    description: 'Graph preset not found'
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized'
  })
  async update(
    @Param('id') id: string,
    @Body() updateGraphPresetDto: UpdateGraphPresetDto,
    @UserCtx() ctx: UserContext
  ): Promise<GraphPresetResponseDto> {
    const orgIds = await this.resolveOrgScope(ctx.userId, ctx.roles);
    return this.graphPresetsService.update(id, updateGraphPresetDto, ctx.userId, orgIds === null, orgIds);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a graph preset',
    description: 'Delete an existing graph preset. Only owner or global admin can delete.'
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the graph preset',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  @ApiResponse({
    status: 204,
    description: 'Graph preset deleted successfully'
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - can only delete own presets (unless global admin)'
  })
  @ApiResponse({
    status: 404,
    description: 'Graph preset not found'
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized'
  })
  async remove(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext
  ): Promise<void> {
    const orgIds = await this.resolveOrgScope(ctx.userId, ctx.roles);
    return this.graphPresetsService.remove(id, ctx.userId, orgIds === null, orgIds);
  }
}
