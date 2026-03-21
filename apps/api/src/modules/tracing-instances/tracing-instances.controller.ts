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
import { TracingInstancesService } from './tracing-instances.service';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';
import {
  CreateTracingInstanceDto,
  UpdateTracingInstanceDto,
  TracingInstanceResponseDto,
  TracingInstanceQuery,
  TestConnectionDto,
} from './dto/tracing-instance.dto';

@ApiTags('tracing-instances')
@Controller('tracing-instances')
@ApiBearerAuth()
export class TracingInstancesController {
  private readonly logger = new Logger(TracingInstancesController.name);

  constructor(private readonly tracingInstancesService: TracingInstancesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all tracing instances' })
  @ApiQuery({ name: 'label', required: false, description: 'Filter by label' })
  @ApiQuery({
    name: 'tracingUi',
    required: false,
    description: 'Filter by tracing UI type',
    enum: ['tempo', 'jaeger', 'elastic']
  })
  @ApiResponse({ status: 200, description: 'Return all tracing instances', type: [TracingInstanceResponseDto] })
  async findAll(
    @Query() query: TracingInstanceQuery,
    @Query('organizationId') organizationId: string | undefined,
    @UserCtx() ctx: UserContext,
  ): Promise<TracingInstanceResponseDto[]> {
    try {
      return await this.tracingInstancesService.findAll(ctx.userId, ctx.roles, query, organizationId);
    } catch (error) {
      this.logger.error('Failed to fetch tracing instances:', error);
      throw new HttpException(
        'Failed to fetch tracing instances',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a tracing instance by ID' })
  @ApiParam({ name: 'id', description: 'Tracing instance ID' })
  @ApiResponse({ status: 200, description: 'Return the tracing instance', type: TracingInstanceResponseDto })
  @ApiResponse({ status: 404, description: 'Tracing instance not found' })
  async findOne(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ): Promise<TracingInstanceResponseDto> {
    try {
      return await this.tracingInstancesService.findOne(id, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error(`Failed to fetch tracing instance ${id}:`, error);
      if (error && typeof error === 'object' && 'message' in error && (error as Error).message.includes('not found')) {
        throw new HttpException('Tracing instance not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to fetch tracing instance',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('test-connection')
  @ApiOperation({ summary: 'Test tracing connection with parameters' })
  @ApiResponse({ status: 200, description: 'Connection test result' })
  @ApiResponse({ status: 400, description: 'Connection test failed' })
  async testConnectionWithParams(
    @Body() testDto: TestConnectionDto,
    @UserCtx() ctx: UserContext,
  ): Promise<{ success: boolean; message: string }> {
    try {
      return await this.tracingInstancesService.testConnectionWithParams(testDto, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error('Failed to test tracing connection:', error);
      throw new HttpException(
        (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Failed to test connection',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post()
  
  @ApiOperation({ summary: 'Create a new tracing instance' })
  @ApiResponse({ status: 201, description: 'The tracing instance has been created', type: TracingInstanceResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 403, description: 'Organization admin privileges required' })
  async create(
    @Body() createDto: CreateTracingInstanceDto,
    @UserCtx() ctx: UserContext,
  ): Promise<TracingInstanceResponseDto> {
    try {
      return await this.tracingInstancesService.create(createDto, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error('Failed to create tracing instance:', error);
      throw new HttpException(
        (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Failed to create tracing instance',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Patch(':id')
  
  @ApiOperation({ summary: 'Update a tracing instance' })
  @ApiParam({ name: 'id', description: 'Tracing instance ID' })
  @ApiResponse({ status: 200, description: 'The tracing instance has been updated', type: TracingInstanceResponseDto })
  @ApiResponse({ status: 403, description: 'Organization admin privileges required' })
  @ApiResponse({ status: 404, description: 'Tracing instance not found' })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateTracingInstanceDto,
    @UserCtx() ctx: UserContext,
  ): Promise<TracingInstanceResponseDto> {
    try {
      return await this.tracingInstancesService.update(id, updateDto, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error(`Failed to update tracing instance ${id}:`, error);
      if (error && typeof error === 'object' && 'message' in error && (error as Error).message.includes('not found')) {
        throw new HttpException('Tracing instance not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Failed to update tracing instance',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(':id')
  
  @ApiOperation({ summary: 'Delete a tracing instance' })
  @ApiParam({ name: 'id', description: 'Tracing instance ID' })
  @ApiResponse({ status: 200, description: 'The tracing instance has been deleted' })
  @ApiResponse({ status: 403, description: 'Organization admin privileges required' })
  @ApiResponse({ status: 404, description: 'Tracing instance not found' })
  async remove(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ): Promise<{ message: string }> {
    try {
      await this.tracingInstancesService.remove(id, ctx.userId, ctx.roles);
      return { message: 'Tracing instance deleted successfully' };
    } catch (error) {
      this.logger.error(`Failed to delete tracing instance ${id}:`, error);
      if (error && typeof error === 'object' && 'message' in error && (error as Error).message.includes('not found')) {
        throw new HttpException('Tracing instance not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to delete tracing instance',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':id/test-connection')
  @ApiOperation({ summary: 'Test connection to a tracing instance' })
  @ApiParam({ name: 'id', description: 'Tracing instance ID' })
  @ApiResponse({ status: 200, description: 'Connection test result' })
  @ApiResponse({ status: 404, description: 'Tracing instance not found' })
  async testConnection(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ): Promise<{ success: boolean; message: string }> {
    try {
      return await this.tracingInstancesService.testConnection(id, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error(`Failed to test connection for tracing instance ${id}:`, error);
      throw new HttpException(
        'Failed to test connection',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
