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

@ApiTags('Graph Presets')
@ApiBearerAuth()
@Controller('graph-presets')
export class GraphPresetsController {
  constructor(private readonly graphPresetsService: GraphPresetsService) {}

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
    return this.graphPresetsService.create(createGraphPresetDto, ctx.userId, ctx.roles);
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
  findAll(
    @UserCtx() ctx: UserContext,
    @Query('testRunId') testRunId?: string
  ): Promise<GraphPresetResponseDto[]> {
    return this.graphPresetsService.findAll(ctx.userId, ctx.roles, testRunId);
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
  findOne(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext
  ): Promise<GraphPresetResponseDto> {
    return this.graphPresetsService.findOne(id, ctx.userId, ctx.roles);
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
  remove(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext
  ): Promise<void> {
    return this.graphPresetsService.remove(id, ctx.userId, ctx.roles);
  }
}
