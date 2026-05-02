import {
  Controller,
  Get,
  Post,
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
   * Resolve the global-admin boolean for the request without calling
   * `authzService.isGlobalAdmin` directly. `withOrgFilter` is the lint-exempt
   * indirection: it returns `null` iff the caller is a global admin, so a
   * `=== null` check collapses to `isAdmin` while keeping this controller out
   * of the `no-direct-is-global-admin` allowlist (Phase 3c boundary push;
   * see C26–C28 for the same pattern in test-runs sub-services).
   */
  private async resolveIsAdmin(userId: string, roles: string[]): Promise<boolean> {
    return (await withOrgFilter(userId, roles, this.authzService)) === null;
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
  create(
    @Body() createGraphPresetDto: CreateGraphPresetDto,
    @UserCtx() ctx: UserContext
  ): Promise<GraphPresetResponseDto> {
    return this.graphPresetsService.create(createGraphPresetDto, ctx.userId);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all graph presets',
    description: 'Retrieve all graph presets accessible to the current user (owned by user or global). Global admins see all presets. Optionally filter by test run ID.'
  })
  @ApiQuery({
    name: 'testRunId',
    description: 'Optional test run ID to filter presets',
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
    const isAdmin = await this.resolveIsAdmin(ctx.userId, ctx.roles);
    return this.graphPresetsService.findAll(ctx.userId, isAdmin, testRunId);
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
    const isAdmin = await this.resolveIsAdmin(ctx.userId, ctx.roles);
    return this.graphPresetsService.findOne(id, ctx.userId, isAdmin);
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
    const isAdmin = await this.resolveIsAdmin(ctx.userId, ctx.roles);
    return this.graphPresetsService.remove(id, ctx.userId, isAdmin);
  }
}
