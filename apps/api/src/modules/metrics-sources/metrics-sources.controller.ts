import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Query,
  Param,
  Body,
  Logger,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { MetricsSourcesService, MetricsSourceResponse } from './metrics-sources.service';
import { CreateMetricsSourceDto } from './dto/create-metrics-source.dto';
import { UpdateMetricsSourceDto } from './dto/update-metrics-source.dto';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';

@ApiTags('metrics-sources')
@Controller('metrics-sources')
@ApiBearerAuth()
export class MetricsSourcesController {
  private readonly logger = new Logger(MetricsSourcesController.name);

  constructor(private readonly metricsSourcesService: MetricsSourcesService) {}

  @Get()
  @ApiOperation({ summary: 'List metrics sources with optional filters' })
  @ApiQuery({ name: 'systemId', required: false, description: 'Filter by system under test ID' })
  @ApiQuery({ name: 'systemUnderTestId', required: false, description: 'Filter by system under test ID (alias)' })
  @ApiQuery({ name: 'environment', required: false, description: 'Filter by test environment' })
  @ApiQuery({ name: 'testEnvironment', required: false, description: 'Filter by test environment (alias)' })
  @ApiQuery({ name: 'sourceType', required: false, description: 'Filter by source type' })
  @ApiQuery({ name: 'displayName', required: false, description: 'Filter by display name (partial match)' })
  @ApiQuery({ name: 'tags', required: false, description: 'Filter by tags (comma-separated)' })
  @ApiResponse({ status: 200, description: 'Return all matching metrics sources' })
  async findAll(
    @Query() query: any,
    @UserCtx() ctx: UserContext,
  ): Promise<MetricsSourceResponse[]> {
    try {
      if (query.tags && typeof query.tags === 'string') {
        query.tags = query.tags.split(',').map((tag: string) => tag.trim()).filter((tag: string) => tag.length > 0);
      }
      return await this.metricsSourcesService.findAll(ctx.userId, ctx.roles, query);
    } catch (error) {
      this.logger.error('Failed to fetch metrics sources:', error);
      throw new HttpException('Failed to fetch metrics sources', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('by-application-dashboard/:id')
  @ApiOperation({ summary: 'Find MetricsSource for an ApplicationDashboard (bridge endpoint)' })
  @ApiParam({ name: 'id', description: 'Application dashboard ID' })
  @ApiResponse({ status: 200, description: 'Return the matching metrics source or null' })
  async findByApplicationDashboard(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ): Promise<MetricsSourceResponse | null> {
    try {
      return await this.metricsSourcesService.findByApplicationDashboardId(id, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error(`Failed to find metrics source for application dashboard ${id}:`, error);
      throw new HttpException('Failed to find metrics source', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a metrics source by ID' })
  @ApiParam({ name: 'id', description: 'Metrics source ID' })
  @ApiResponse({ status: 200, description: 'Return the metrics source' })
  @ApiResponse({ status: 404, description: 'Metrics source not found' })
  async findOne(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ): Promise<MetricsSourceResponse> {
    try {
      return await this.metricsSourcesService.findOne(id, ctx.userId, ctx.roles);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new HttpException('Metrics source not found', HttpStatus.NOT_FOUND);
      }
      this.logger.error(`Failed to fetch metrics source ${id}:`, error);
      throw new HttpException('Failed to fetch metrics source', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create a new metrics source' })
  @ApiResponse({ status: 201, description: 'The metrics source has been created' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async create(
    @Body() createDto: CreateMetricsSourceDto,
    @UserCtx() ctx: UserContext,
  ): Promise<MetricsSourceResponse> {
    try {
      return await this.metricsSourcesService.create(createDto, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error('Failed to create metrics source:', error);
      throw new HttpException(
        (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Failed to create metrics source',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a metrics source' })
  @ApiParam({ name: 'id', description: 'Metrics source ID' })
  @ApiResponse({ status: 200, description: 'The metrics source has been updated' })
  @ApiResponse({ status: 404, description: 'Metrics source not found' })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateMetricsSourceDto,
    @UserCtx() ctx: UserContext,
  ): Promise<MetricsSourceResponse> {
    try {
      return await this.metricsSourcesService.update(id, updateDto, ctx.userId, ctx.roles);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new HttpException('Metrics source not found', HttpStatus.NOT_FOUND);
      }
      this.logger.error(`Failed to update metrics source ${id}:`, error);
      throw new HttpException(
        (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Failed to update metrics source',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a metrics source' })
  @ApiParam({ name: 'id', description: 'Metrics source ID' })
  @ApiResponse({ status: 200, description: 'Metrics source deleted successfully' })
  @ApiResponse({ status: 404, description: 'Metrics source not found' })
  async delete(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ): Promise<{ deleted: boolean }> {
    try {
      await this.metricsSourcesService.delete(id, ctx.userId, ctx.roles);
      return { deleted: true };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new HttpException('Metrics source not found', HttpStatus.NOT_FOUND);
      }
      this.logger.error(`Failed to delete metrics source ${id}:`, error);
      throw new HttpException(
        (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Failed to delete metrics source',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
