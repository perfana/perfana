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
import { PyroscopeInstancesService, PyroscopeInstance } from './pyroscope-instances.service';
import { CreatePyroscopeInstanceDto, UpdatePyroscopeInstanceDto, PyroscopeInstanceQuery } from './dto/pyroscope-instance.dto';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';

@ApiTags('pyroscope-instances')
@Controller('pyroscope-instances')
@ApiBearerAuth()
export class PyroscopeInstancesController {
  private readonly logger = new Logger(PyroscopeInstancesController.name);

  constructor(private readonly pyroscopeInstancesService: PyroscopeInstancesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all Pyroscope instances' })
  @ApiQuery({ name: 'label', required: false, description: 'Filter by label' })
  @ApiQuery({ name: 'pyroscopeStandAlone', required: false, description: 'Filter by standalone flag' })
  @ApiResponse({ status: 200, description: 'Return all Pyroscope instances' })
  async findAll(
    @Query() query: PyroscopeInstanceQuery,
    @Query('organizationId') organizationId: string | undefined,
    @UserCtx() ctx: UserContext,
  ): Promise<PyroscopeInstance[]> {
    try {
      return await this.pyroscopeInstancesService.findAll(ctx.userId, ctx.roles, query, organizationId);
    } catch (error) {
      this.logger.error('Failed to fetch Pyroscope instances:', error);
      throw new HttpException(
        'Failed to fetch Pyroscope instances',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a Pyroscope instance by ID' })
  @ApiParam({ name: 'id', description: 'Pyroscope instance ID' })
  @ApiResponse({ status: 200, description: 'Return the Pyroscope instance' })
  @ApiResponse({ status: 404, description: 'Pyroscope instance not found' })
  async findOne(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ): Promise<PyroscopeInstance> {
    try {
      return await this.pyroscopeInstancesService.findOne(id, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error(`Failed to fetch Pyroscope instance ${id}:`, error);
      if (error && typeof error === 'object' && 'message' in error && (error as Error).message.includes('not found')) {
        throw new HttpException('Pyroscope instance not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to fetch Pyroscope instance',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('test-connection')
  @ApiOperation({ summary: 'Test Pyroscope connection with parameters' })
  @ApiResponse({ status: 200, description: 'Connection test result' })
  @ApiResponse({ status: 400, description: 'Connection test failed' })
  async testConnectionWithParams(
    @Body() testDto: { pyroscopeUrl: string },
    @UserCtx() ctx: UserContext,
  ): Promise<{ success: boolean; message: string }> {
    try {
      return await this.pyroscopeInstancesService.testConnectionWithParams(testDto, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error('Failed to test Pyroscope connection:', error);
      throw new HttpException(
        (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Failed to test connection',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post()

  @ApiOperation({ summary: 'Create a new Pyroscope instance' })
  @ApiResponse({ status: 201, description: 'The Pyroscope instance has been created' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 403, description: 'Organization admin privileges required' })
  async create(
    @Body() createDto: CreatePyroscopeInstanceDto,
    @UserCtx() ctx: UserContext,
  ): Promise<PyroscopeInstance> {
    try {
      return await this.pyroscopeInstancesService.create(createDto, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error('Failed to create Pyroscope instance:', error);
      throw new HttpException(
        (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Failed to create Pyroscope instance',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Patch(':id')
  
  @ApiOperation({ summary: 'Update a Pyroscope instance' })
  @ApiParam({ name: 'id', description: 'Pyroscope instance ID' })
  @ApiResponse({ status: 200, description: 'The Pyroscope instance has been updated' })
  @ApiResponse({ status: 403, description: 'Organization admin privileges required' })
  @ApiResponse({ status: 404, description: 'Pyroscope instance not found' })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdatePyroscopeInstanceDto,
    @UserCtx() ctx: UserContext,
  ): Promise<PyroscopeInstance> {
    try {
      return await this.pyroscopeInstancesService.update(id, updateDto, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error(`Failed to update Pyroscope instance ${id}:`, error);
      if (error && typeof error === 'object' && 'message' in error && (error as Error).message.includes('not found')) {
        throw new HttpException('Pyroscope instance not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Failed to update Pyroscope instance',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(':id')
  
  @ApiOperation({ summary: 'Delete a Pyroscope instance' })
  @ApiParam({ name: 'id', description: 'Pyroscope instance ID' })
  @ApiResponse({ status: 200, description: 'The Pyroscope instance has been deleted' })
  @ApiResponse({ status: 403, description: 'Organization admin privileges required' })
  @ApiResponse({ status: 404, description: 'Pyroscope instance not found' })
  async remove(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ): Promise<{ message: string }> {
    try {
      await this.pyroscopeInstancesService.remove(id, ctx.userId, ctx.roles);
      return { message: 'Pyroscope instance deleted successfully' };
    } catch (error) {
      this.logger.error(`Failed to delete Pyroscope instance ${id}:`, error);
      if (error && typeof error === 'object' && 'message' in error && (error as Error).message.includes('not found')) {
        throw new HttpException('Pyroscope instance not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to delete Pyroscope instance',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':id/test-connection')
  @ApiOperation({ summary: 'Test connection to a Pyroscope instance' })
  @ApiParam({ name: 'id', description: 'Pyroscope instance ID' })
  @ApiResponse({ status: 200, description: 'Connection test result' })
  @ApiResponse({ status: 404, description: 'Pyroscope instance not found' })
  async testConnection(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ): Promise<{ success: boolean; message: string }> {
    try {
      return await this.pyroscopeInstancesService.testConnection(id, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error(`Failed to test connection for Pyroscope instance ${id}:`, error);
      throw new HttpException(
        'Failed to test connection',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
