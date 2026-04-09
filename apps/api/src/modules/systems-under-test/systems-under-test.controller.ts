import { Controller, Get, Post, Delete, Param, Patch, Body, Query, NotFoundException, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SystemsUnderTestService } from './systems-under-test.service';
import { DeleteSystemUnderTestHandler } from './handlers/delete-system-under-test.handler';
import { CreateSystemUnderTestDto, UpdatePyroscopeConfigDto, UpdateSystemUnderTestDto } from './dto';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';

@ApiTags('systems-under-test')
@ApiBearerAuth()
@Controller('systems-under-test')
export class SystemsUnderTestController {
  private readonly logger = new Logger(SystemsUnderTestController.name);

  constructor(
    private readonly systemsUnderTestService: SystemsUnderTestService,
    private readonly deleteHandler: DeleteSystemUnderTestHandler,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a system under test with optional pre-seeded environments and workloads' })
  @ApiResponse({ status: 201, description: 'System under test created successfully' })
  @ApiResponse({ status: 409, description: 'System under test with this name already exists in the organization' })
  async create(@Body() createDto: CreateSystemUnderTestDto, @UserCtx() ctx: UserContext) {
    try {
      const result = await this.systemsUnderTestService.createSut(createDto, ctx.userId, ctx.roles);
      if (result.conflict) {
        const { conflict: _, ...sut } = result;
        throw new HttpException({ message: 'System under test already exists', sut }, HttpStatus.CONFLICT);
      }
      return result;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('Failed to create system under test:', error);
      throw new HttpException('Failed to create system under test', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get()
  @ApiOperation({ summary: 'Get all systems under test' })
  findAll(@UserCtx() ctx: UserContext, @Query('organizationId') organizationId?: string) {
    return this.systemsUnderTestService.findAll(ctx.userId, ctx.roles, organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific system under test by ID with environment and workload data' })
  @ApiParam({ name: 'id', description: 'System under test ID' })
  async findOne(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    const system = await this.systemsUnderTestService.findSystemSummary(id, ctx.userId, ctx.roles);
    if (!system) {
      throw new NotFoundException(`System under test with ID ${id} not found`);
    }
    return system;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update system under test properties (name, description, team assignment, tracing)' })
  @ApiParam({ name: 'id', description: 'System under test UUID' })
  @ApiResponse({
    status: 200,
    description: 'System under test updated successfully',
  })
  @ApiResponse({ status: 404, description: 'System under test not found' })
  @ApiResponse({ status: 400, description: 'Invalid update data' })
  async update(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
    @Body() updateDto: UpdateSystemUnderTestDto,
  ) {
    try {
      return await this.systemsUnderTestService.update(id, updateDto, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error(`Failed to update system ${id}:`, error);

      // Use safe error handling pattern
      if (error && typeof error === 'object' && 'message' in error) {
        const message = (error as Error).message;
        if (message.includes('not found')) {
          throw new HttpException(message, HttpStatus.NOT_FOUND);
        }
      }

      throw new HttpException(
        'Failed to update system under test',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch(':id/pyroscope')
  @ApiOperation({ summary: 'Update Pyroscope configuration for a system under test' })
  @ApiParam({ name: 'id', description: 'System under test UUID' })
  @ApiResponse({
    status: 200,
    description: 'Pyroscope configuration updated successfully',
  })
  @ApiResponse({ status: 404, description: 'System under test not found' })
  @ApiResponse({ status: 400, description: 'Invalid Pyroscope configuration' })
  async updatePyroscopeConfig(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
    @Body() updateDto: UpdatePyroscopeConfigDto,
  ) {
    try {
      return await this.systemsUnderTestService.updatePyroscopeConfig(id, updateDto, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error(`Failed to update Pyroscope config for system ${id}:`, error);

      // Use safe error handling pattern
      if (error && typeof error === 'object' && 'message' in error) {
        const message = (error as Error).message;
        if (message.includes('not found')) {
          throw new HttpException(message, HttpStatus.NOT_FOUND);
        }
        if (message.includes('At least one')) {
          throw new HttpException(message, HttpStatus.BAD_REQUEST);
        }
      }

      throw new HttpException(
        'Failed to update Pyroscope configuration',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id/delete-preview')
  @ApiOperation({ summary: 'Preview what will be deleted when removing a system under test' })
  @ApiParam({ name: 'id', description: 'System under test UUID' })
  @ApiResponse({ status: 200, description: 'Delete preview with resource counts' })
  @ApiResponse({ status: 404, description: 'System under test not found' })
  async getDeletePreview(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    // Verify access via existing findOne (throws 404 if unauthorized)
    await this.systemsUnderTestService.findOne(id, ctx.userId, ctx.roles);
    return this.deleteHandler.getDeletePreview(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a system under test and all related data' })
  @ApiParam({ name: 'id', description: 'System under test UUID' })
  @ApiResponse({ status: 200, description: 'System under test deleted successfully' })
  @ApiResponse({ status: 404, description: 'System under test not found' })
  async remove(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    // Verify access via existing findOne (throws 404 if unauthorized)
    await this.systemsUnderTestService.findOne(id, ctx.userId, ctx.roles);

    try {
      return await this.deleteHandler.execute(id);
    } catch (error) {
      this.logger.error(`Failed to delete system ${id}:`, error);

      if (error && typeof error === 'object' && 'message' in error) {
        const message = (error as Error).message;
        if (message.includes('not found')) {
          throw new HttpException(message, HttpStatus.NOT_FOUND);
        }
      }

      throw new HttpException(
        'Failed to delete system under test',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}