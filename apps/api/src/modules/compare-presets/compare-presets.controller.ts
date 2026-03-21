import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { ComparePresetsService } from './compare-presets.service';
import { CreateComparePresetDto } from './dto/create-compare-preset.dto';
import { UpdateComparePresetDto } from './dto/update-compare-preset.dto';
import { ComparePresetResponseDto } from './dto/compare-preset-response.dto';
import {
  UserCtx,
  UserContext,
} from '../../common/decorators/user-context.decorator';

@ApiTags('Compare Presets')
@ApiBearerAuth()
@Controller('compare-presets')
export class ComparePresetsController {
  constructor(private readonly comparePresetsService: ComparePresetsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new compare filter preset',
    description:
      'Save a compare filter configuration as a named preset that can be reused',
  })
  @ApiResponse({
    status: 201,
    description: 'Compare preset created successfully',
    type: ComparePresetResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  create(
    @Body() createComparePresetDto: CreateComparePresetDto,
    @UserCtx() ctx: UserContext,
  ): Promise<ComparePresetResponseDto> {
    return this.comparePresetsService.create(createComparePresetDto, ctx.userId, ctx.roles);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all compare filter presets',
    description:
      'Retrieve all compare presets accessible to the current user. If testRunId is provided, specific presets are filtered to only show those for that test run.',
  })
  @ApiQuery({
    name: 'testRunId',
    description: 'Optional test run ID to filter test run-specific presets',
    required: false,
    example: 'MyApp-prod-loadTest-00042',
  })
  @ApiResponse({
    status: 200,
    description: 'Compare presets retrieved successfully',
    type: [ComparePresetResponseDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  findAll(
    @UserCtx() ctx: UserContext,
    @Query('testRunId') testRunId?: string,
  ): Promise<ComparePresetResponseDto[]> {
    return this.comparePresetsService.findAll(ctx.userId, testRunId, ctx.roles);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a specific compare filter preset',
    description: 'Retrieve a single compare preset by ID',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the compare preset',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Compare preset retrieved successfully',
    type: ComparePresetResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Compare preset not found',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  findOne(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ): Promise<ComparePresetResponseDto> {
    return this.comparePresetsService.findOne(id, ctx.userId, ctx.roles);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a compare filter preset',
    description: 'Update an existing compare preset (only owner can update)',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the compare preset',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Compare preset updated successfully',
    type: ComparePresetResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - can only update own presets',
  })
  @ApiResponse({
    status: 404,
    description: 'Compare preset not found',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  update(
    @Param('id') id: string,
    @Body() updateComparePresetDto: UpdateComparePresetDto,
    @UserCtx() ctx: UserContext,
  ): Promise<ComparePresetResponseDto> {
    return this.comparePresetsService.update(
      id,
      updateComparePresetDto,
      ctx.userId,
      ctx.roles,
    );
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a compare filter preset',
    description: 'Delete an existing compare preset (only owner can delete)',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the compare preset',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 204,
    description: 'Compare preset deleted successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - can only delete own presets',
  })
  @ApiResponse({
    status: 404,
    description: 'Compare preset not found',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  remove(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ): Promise<void> {
    return this.comparePresetsService.remove(id, ctx.userId, ctx.roles);
  }
}
