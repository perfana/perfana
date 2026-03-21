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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { GrafanaInstancesService, GrafanaInstance } from './grafana-instances.service';
import { CreateGrafanaInstanceDto, UpdateGrafanaInstanceDto, GrafanaInstanceQuery } from './dto/grafana-instance.dto';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';

@ApiTags('grafana-instances')
@Controller('grafana-instances')
@ApiBearerAuth()
export class GrafanaInstancesController {
  private readonly logger = new Logger(GrafanaInstancesController.name);

  constructor(private readonly grafanaInstancesService: GrafanaInstancesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all Grafana instances' })
  @ApiQuery({ name: 'label', required: false, description: 'Filter by label' })
  @ApiQuery({ name: 'snapshotInstance', required: false, description: 'Filter by snapshot instance flag' })
  @ApiResponse({ status: 200, description: 'Return all Grafana instances' })
  async findAll(
    @Query() query: GrafanaInstanceQuery,
    @Query('organizationId') organizationId: string | undefined,
    @UserCtx() ctx: UserContext,
  ): Promise<GrafanaInstance[]> {
    try {
      return await this.grafanaInstancesService.findAll(ctx.userId, ctx.roles, query, organizationId);
    } catch (error) {
      this.logger.error('Failed to fetch Grafana instances:', error);
      throw new HttpException(
        'Failed to fetch Grafana instances',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a Grafana instance by ID' })
  @ApiParam({ name: 'id', description: 'Grafana instance ID' })
  @ApiResponse({ status: 200, description: 'Return the Grafana instance' })
  @ApiResponse({ status: 404, description: 'Grafana instance not found' })
  async findOne(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ): Promise<GrafanaInstance> {
    try {
      return await this.grafanaInstancesService.findOne(id, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error(`Failed to fetch Grafana instance ${id}:`, error);
      if (error && typeof error === 'object' && 'message' in error && (error as Error).message.includes('not found')) {
        throw new HttpException('Grafana instance not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to fetch Grafana instance',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('test-connection')
  @ApiOperation({ summary: 'Test Grafana connection with parameters' })
  @ApiResponse({ status: 200, description: 'Connection test result' })
  @ApiResponse({ status: 400, description: 'Connection test failed' })
  async testConnectionWithParams(
    @Body() testDto: any,
    @UserCtx() ctx: UserContext,
  ): Promise<{ success: boolean; message: string }> {
    try {
      return await this.grafanaInstancesService.testConnectionWithParams(testDto, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error('Failed to test Grafana connection:', error);
      throw new HttpException(
        (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Failed to test connection',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create a new Grafana instance' })
  @ApiResponse({ status: 201, description: 'The Grafana instance has been created' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 403, description: 'Organization admin privileges required' })
  async create(
    @Body() createDto: CreateGrafanaInstanceDto,
    @UserCtx() ctx: UserContext,
  ): Promise<GrafanaInstance> {
    try {
      return await this.grafanaInstancesService.create(createDto, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error('Failed to create Grafana instance:', error);
      throw new HttpException(
        (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Failed to create Grafana instance',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a Grafana instance' })
  @ApiParam({ name: 'id', description: 'Grafana instance ID' })
  @ApiResponse({ status: 200, description: 'The Grafana instance has been updated' })
  @ApiResponse({ status: 403, description: 'Organization admin privileges required' })
  @ApiResponse({ status: 404, description: 'Grafana instance not found' })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateGrafanaInstanceDto,
    @UserCtx() ctx: UserContext,
  ): Promise<GrafanaInstance> {
    try {
      return await this.grafanaInstancesService.update(id, updateDto, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error(`Failed to update Grafana instance ${id}:`, error);
      if (error && typeof error === 'object' && 'message' in error && (error as Error).message.includes('not found')) {
        throw new HttpException('Grafana instance not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Failed to update Grafana instance',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a Grafana instance' })
  @ApiParam({ name: 'id', description: 'Grafana instance ID' })
  @ApiResponse({ status: 200, description: 'The Grafana instance has been deleted' })
  @ApiResponse({ status: 403, description: 'Organization admin privileges required' })
  @ApiResponse({ status: 404, description: 'Grafana instance not found' })
  async remove(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ): Promise<{ message: string }> {
    try {
      await this.grafanaInstancesService.remove(id, ctx.userId, ctx.roles);
      return { message: 'Grafana instance deleted successfully' };
    } catch (error) {
      this.logger.error(`Failed to delete Grafana instance ${id}:`, error);
      if (error && typeof error === 'object' && 'message' in error && (error as Error).message.includes('not found')) {
        throw new HttpException('Grafana instance not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to delete Grafana instance',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':id/test-connection')
  @ApiOperation({ summary: 'Test connection to a Grafana instance' })
  @ApiParam({ name: 'id', description: 'Grafana instance ID' })
  @ApiResponse({ status: 200, description: 'Connection test result' })
  @ApiResponse({ status: 404, description: 'Grafana instance not found' })
  async testConnection(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ): Promise<{ success: boolean; message: string }> {
    try {
      return await this.grafanaInstancesService.testConnection(id, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error(`Failed to test connection for Grafana instance ${id}:`, error);
      throw new HttpException(
        'Failed to test connection',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}