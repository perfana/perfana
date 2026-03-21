import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Logger,
  HttpException,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { GrafanaDashboardsService, GrafanaDashboard } from './grafana-dashboards.service';
import {
  CreateGrafanaDashboardDto,
  UpdateGrafanaDashboardDto,
  GrafanaDashboardQuery
} from './dto/grafana-dashboard.dto';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';

@ApiTags('grafana/dashboards')
@Controller('grafana/dashboards')
export class GrafanaDashboardsController {
  private readonly logger = new Logger(GrafanaDashboardsController.name);

  constructor(private readonly grafanaDashboardsService: GrafanaDashboardsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all Grafana dashboards' })
  @ApiQuery({ name: 'grafanaInstanceId', required: false, description: 'Filter by Grafana instance ID' })
  @ApiQuery({ name: 'name', required: false, description: 'Filter by dashboard name' })
  @ApiQuery({ name: 'uid', required: false, description: 'Filter by dashboard UID' })
  @ApiQuery({ name: 'tags', required: false, description: 'Filter by tags (comma-separated)' })
  @ApiQuery({ name: 'usedBySut', required: false, description: 'Filter by system under test' })
  @ApiResponse({ status: 200, description: 'Return all Grafana dashboards' })
  async findAll(
    @Query() query: GrafanaDashboardQuery,
    @UserCtx() ctx: UserContext,
  ): Promise<GrafanaDashboard[]> {
    try {
      // Parse tags if provided as comma-separated string
      if (query.tags && typeof query.tags === 'string') {
        query.tags = (query.tags as string).split(',').map((tag: string) => tag.trim()).filter((tag: string) => tag.length > 0);
      }

      return await this.grafanaDashboardsService.findAll(ctx.userId, ctx.roles, query);
    } catch (error) {
      this.logger.error('Failed to fetch Grafana dashboards:', error);
      throw new HttpException(
        'Failed to fetch Grafana dashboards',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a Grafana dashboard by ID' })
  @ApiParam({ name: 'id', description: 'Grafana dashboard ID' })
  @ApiResponse({ status: 200, description: 'Return the Grafana dashboard' })
  @ApiResponse({ status: 404, description: 'Grafana dashboard not found' })
  async findOne(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ): Promise<GrafanaDashboard> {
    try {
      return await this.grafanaDashboardsService.findOne(id, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error(`Failed to fetch Grafana dashboard ${id}:`, error);
      if (error && typeof error === 'object' && 'message' in error && (error as Error).message.includes('not found')) {
        throw new HttpException('Grafana dashboard not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to fetch Grafana dashboard',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create a new Grafana dashboard' })
  @ApiResponse({ status: 201, description: 'The Grafana dashboard has been created' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async create(
    @Body() createDto: CreateGrafanaDashboardDto,
    @UserCtx() ctx: UserContext,
  ): Promise<GrafanaDashboard> {
    if (!ctx.organizationId) {
      throw new BadRequestException(
        'User must belong to an organization to create Grafana dashboards',
      );
    }

    try {
      return await this.grafanaDashboardsService.create(createDto, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error('Failed to create Grafana dashboard:', error);
      throw new HttpException(
        (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Failed to create Grafana dashboard',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a Grafana dashboard' })
  @ApiParam({ name: 'id', description: 'Grafana dashboard ID' })
  @ApiResponse({ status: 200, description: 'The Grafana dashboard has been updated' })
  @ApiResponse({ status: 404, description: 'Grafana dashboard not found' })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateGrafanaDashboardDto,
    @UserCtx() ctx: UserContext,
  ): Promise<GrafanaDashboard> {
    try {
      return await this.grafanaDashboardsService.update(id, updateDto, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error(`Failed to update Grafana dashboard ${id}:`, error);
      if (error && typeof error === 'object' && 'message' in error && (error as Error).message.includes('not found')) {
        throw new HttpException('Grafana dashboard not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Failed to update Grafana dashboard',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a Grafana dashboard' })
  @ApiParam({ name: 'id', description: 'Grafana dashboard ID' })
  @ApiResponse({ status: 200, description: 'The Grafana dashboard has been deleted' })
  @ApiResponse({ status: 404, description: 'Grafana dashboard not found' })
  async remove(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ): Promise<{ message: string }> {
    try {
      await this.grafanaDashboardsService.remove(id, ctx.userId, ctx.roles);
      return { message: 'Grafana dashboard deleted successfully' };
    } catch (error) {
      this.logger.error(`Failed to delete Grafana dashboard ${id}:`, error);
      if (error && typeof error === 'object' && 'message' in error && (error as Error).message.includes('not found')) {
        throw new HttpException('Grafana dashboard not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to delete Grafana dashboard',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('variable-values')
  @ApiOperation({ summary: 'Get variable values from Grafana datasource' })
  @ApiResponse({ status: 200, description: 'Return variable values' })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  async getVariableValues(
    @Body() requestBody: {
      grafanaDashboardId: string;
      variableName: string;
      system: string;
      environment: string;
      existingVariables?: Record<string, string[]>;
    },
    @UserCtx() ctx: UserContext,
  ): Promise<Array<{ label: string; value: string }>> {
    try {
      return await this.grafanaDashboardsService.getVariableValues(
        requestBody.grafanaDashboardId,
        requestBody.variableName,
        requestBody.system,
        requestBody.environment,
        requestBody.existingVariables || {},
        ctx.userId,
        ctx.roles,
      );
    } catch (error) {
      this.logger.error('Failed to fetch variable values:', error);
      throw new HttpException(
        (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Failed to fetch variable values',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}