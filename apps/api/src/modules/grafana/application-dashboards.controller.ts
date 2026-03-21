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
import {
  ApplicationDashboardsService,
  ApplicationDashboard,
  DeleteInfo,
  BatchDeleteInfo,
  DeleteResult,
} from './application-dashboards.service';
import { CreateApplicationDashboardDto, UpdateApplicationDashboardDto } from './dto/application-dashboard.dto';
import { CopyApplicationDashboardsDto } from './dto/copy-application-dashboards.dto';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';

class BatchDeleteInfoDto {
  ids!: string[];
}

@ApiTags('grafana/application-dashboards')
@Controller('grafana/application-dashboards')
@ApiBearerAuth()
export class ApplicationDashboardsController {
  private readonly logger = new Logger(ApplicationDashboardsController.name);

  constructor(private readonly applicationDashboardsService: ApplicationDashboardsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all application dashboards' })
  @ApiQuery({ name: 'systemId', required: false, description: 'Filter by system under test ID' })
  @ApiQuery({ name: 'systemUnderTestId', required: false, description: 'Filter by system under test ID (alias)' })
  @ApiQuery({ name: 'environment', required: false, description: 'Filter by test environment' })
  @ApiQuery({ name: 'testEnvironment', required: false, description: 'Filter by test environment (alias)' })
  @ApiQuery({ name: 'grafanaInstanceId', required: false, description: 'Filter by Grafana instance ID' })
  @ApiQuery({ name: 'dashboardLabel', required: false, description: 'Filter by dashboard label (partial match)' })
  @ApiQuery({ name: 'dashboardUid', required: false, description: 'Filter by dashboard UID' })
  @ApiQuery({ name: 'tags', required: false, description: 'Filter by tags (comma-separated)' })
  @ApiResponse({ status: 200, description: 'Return all application dashboards' })
  async findAll(
    @Query() query: any,
    @UserCtx() ctx: UserContext,
  ): Promise<ApplicationDashboard[]> {
    try {
      // Parse tags if provided as comma-separated string
      if (query.tags && typeof query.tags === 'string') {
        query.tags = query.tags.split(',').map((tag: string) => tag.trim()).filter((tag: string) => tag.length > 0);
      }

      return await this.applicationDashboardsService.findAll(ctx.userId, ctx.roles, query);
    } catch (error) {
      this.logger.error('Failed to fetch application dashboards:', error);
      throw new HttpException(
        'Failed to fetch application dashboards',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('batch-delete-info')
  @ApiOperation({ summary: 'Get delete info for multiple application dashboards' })
  @ApiResponse({ status: 200, description: 'Returns info about orphaned dashboards that can be deleted from Grafana' })
  async getBatchDeleteInfo(
    @Body() body: BatchDeleteInfoDto,
    @UserCtx() ctx: UserContext,
  ): Promise<BatchDeleteInfo> {
    try {
      return await this.applicationDashboardsService.getBatchDeleteInfo(body.ids, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error('Failed to get batch delete info:', error);
      throw new HttpException(
        'Failed to get batch delete info',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id/delete-info')
  @ApiOperation({ summary: 'Get delete info for an application dashboard' })
  @ApiParam({ name: 'id', description: 'Application dashboard ID' })
  @ApiResponse({ status: 200, description: 'Returns info about whether dashboard can be deleted from Grafana' })
  @ApiResponse({ status: 404, description: 'Application dashboard not found' })
  async getDeleteInfo(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ): Promise<DeleteInfo> {
    try {
      return await this.applicationDashboardsService.getDeleteInfo(id, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error(`Failed to get delete info for application dashboard ${id}:`, error);
      if (error instanceof NotFoundException) {
        throw new HttpException('Application dashboard not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to get delete info',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an application dashboard by ID' })
  @ApiParam({ name: 'id', description: 'Application dashboard ID' })
  @ApiResponse({ status: 200, description: 'Return the application dashboard' })
  @ApiResponse({ status: 404, description: 'Application dashboard not found' })
  async findOne(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ): Promise<ApplicationDashboard> {
    try {
      return await this.applicationDashboardsService.findOne(id, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error(`Failed to fetch application dashboard ${id}:`, error);
      if (error instanceof NotFoundException) {
        throw new HttpException('Application dashboard not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to fetch application dashboard',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('copy')
  @ApiOperation({ summary: 'Copy application dashboards from one scope to another' })
  @ApiResponse({ status: 201, description: 'Application dashboards copied successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async copyDashboards(
    @Body() dto: CopyApplicationDashboardsDto,
    @UserCtx() ctx: UserContext,
  ): Promise<{ copied: number; skipped: number; total: number }> {
    try {
      return await this.applicationDashboardsService.copyToScope(dto, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error('Failed to copy application dashboards:', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException('Failed to copy application dashboards', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create a new application dashboard' })
  @ApiResponse({ status: 201, description: 'The application dashboard has been created' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async create(
    @Body() createDto: CreateApplicationDashboardDto,
    @UserCtx() ctx: UserContext,
  ): Promise<ApplicationDashboard> {
    try {
      return await this.applicationDashboardsService.create(createDto, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error('Failed to create application dashboard:', error);
      throw new HttpException(
        (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Failed to create application dashboard',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an application dashboard' })
  @ApiParam({ name: 'id', description: 'Application dashboard ID' })
  @ApiResponse({ status: 200, description: 'The application dashboard has been updated' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 404, description: 'Application dashboard not found' })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateApplicationDashboardDto,
    @UserCtx() ctx: UserContext,
  ): Promise<ApplicationDashboard> {
    try {
      return await this.applicationDashboardsService.update(id, updateDto, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error(`Failed to update application dashboard ${id}:`, error);
      if (error instanceof NotFoundException) {
        throw new HttpException('Application dashboard not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Failed to update application dashboard',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an application dashboard' })
  @ApiParam({ name: 'id', description: 'Application dashboard ID' })
  @ApiQuery({
    name: 'deleteFromGrafana',
    required: false,
    type: Boolean,
    description: 'If true and dashboard is orphaned, also delete from Grafana',
  })
  @ApiResponse({ status: 200, description: 'Application dashboard deleted successfully' })
  @ApiResponse({ status: 404, description: 'Application dashboard not found' })
  async delete(
    @Param('id') id: string,
    @Query('deleteFromGrafana') deleteFromGrafana: string | undefined,
    @UserCtx() ctx: UserContext,
  ): Promise<DeleteResult> {
    try {
      const shouldDeleteFromGrafana = deleteFromGrafana === 'true';
      return await this.applicationDashboardsService.delete(id, shouldDeleteFromGrafana, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error(`Failed to delete application dashboard ${id}:`, error);
      if (error instanceof NotFoundException) {
        throw new HttpException('Application dashboard not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Failed to delete application dashboard',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}