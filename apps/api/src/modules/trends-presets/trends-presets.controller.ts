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
import { TrendsPresetsService } from './trends-presets.service';
import { CreateTrendsPresetDto } from './dto/create-trends-preset.dto';
import { TrendsPresetResponseDto } from './dto/trends-preset-response.dto';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';

@ApiTags('Trends Presets')
@ApiBearerAuth()
@Controller('trends-presets')
export class TrendsPresetsController {
  constructor(private readonly trendsPresetsService: TrendsPresetsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new trends filter preset',
    description: 'Save a trends filter configuration as a named preset that can be reused'
  })
  @ApiResponse({
    status: 201,
    description: 'Trends preset created successfully',
    type: TrendsPresetResponseDto
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
    @Body() createTrendsPresetDto: CreateTrendsPresetDto,
    @UserCtx() ctx: UserContext
  ): Promise<TrendsPresetResponseDto> {
    return this.trendsPresetsService.create(createTrendsPresetDto, ctx.userId, ctx.roles);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all trends filter presets',
    description: 'Retrieve all trends presets accessible to the current user. If testRunId is provided, specific presets are filtered to only show those for that test run. Global admins see all presets.'
  })
  @ApiQuery({
    name: 'testRunId',
    description: 'Optional test run ID to filter test run-specific presets',
    required: false,
    example: 'MyApp-prod-loadTest-00042'
  })
  @ApiQuery({
    name: 'metricsSourceId',
    description: 'Optional metrics source ID to filter presets',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Trends presets retrieved successfully',
    type: [TrendsPresetResponseDto]
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized'
  })
  findAll(
    @UserCtx() ctx: UserContext,
    @Query('testRunId') testRunId?: string,
    @Query('metricsSourceId') metricsSourceId?: string,
  ): Promise<TrendsPresetResponseDto[]> {
    return this.trendsPresetsService.findAll(ctx.userId, ctx.roles, testRunId, metricsSourceId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a specific trends filter preset',
    description: 'Retrieve a single trends preset by ID. User must own the preset, it must be global, or user must be a global admin.'
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the trends preset',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  @ApiResponse({
    status: 200,
    description: 'Trends preset retrieved successfully',
    type: TrendsPresetResponseDto
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - access denied to this preset'
  })
  @ApiResponse({
    status: 404,
    description: 'Trends preset not found'
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized'
  })
  findOne(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext
  ): Promise<TrendsPresetResponseDto> {
    return this.trendsPresetsService.findOne(id, ctx.userId, ctx.roles);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a trends filter preset',
    description: 'Delete an existing trends preset. Only owner or global admin can delete.'
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the trends preset',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  @ApiResponse({
    status: 204,
    description: 'Trends preset deleted successfully'
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - can only delete own presets (unless global admin)'
  })
  @ApiResponse({
    status: 404,
    description: 'Trends preset not found'
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized'
  })
  remove(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext
  ): Promise<void> {
    return this.trendsPresetsService.remove(id, ctx.userId, ctx.roles);
  }
}
