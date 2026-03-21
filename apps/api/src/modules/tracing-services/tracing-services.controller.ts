import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { TracingServicesService } from './tracing-services.service';
import {
  CreateTracingServiceDto,
  UpdateTracingServiceDto,
} from './dto/create-tracing-service.dto';
import { FindTracingServiceDto } from './dto/find-tracing-service.dto';
import { TracingServiceResponseDto } from './dto/tracing-service-response.dto';
import {
  UserCtx,
  UserContext,
} from '../../common/decorators/user-context.decorator';

@ApiTags('tracing-services')
@Controller('tracing-services')
export class TracingServicesController {
  constructor(
    private readonly tracingServicesService: TracingServicesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get resolved tracing service with hierarchy',
    description:
      'Finds tracing service using hierarchical resolution: ' +
      '1. Most specific (system + environment + workload), ' +
      '2. Environment level (system + environment), ' +
      '3. System level (system only). ' +
      'Returns an array with a single service or empty array if not found.',
  })
  @ApiQuery({
    name: 'systemId',
    description: 'System under test ID',
    required: true,
  })
  @ApiQuery({
    name: 'environment',
    description: 'Test environment (optional for hierarchy)',
    required: false,
  })
  @ApiQuery({
    name: 'workload',
    description: 'Workload (optional for hierarchy)',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Tracing service found (array with single item or empty)',
    type: [TracingServiceResponseDto],
  })
  async findOne(
    @Query() query: FindTracingServiceDto,
    @UserCtx() ctx: UserContext,
  ) {
    const service = await this.tracingServicesService.findTracingService(
      query.systemId,
      ctx.userId,
      ctx.roles,
      query.environment,
      query.workload,
    );

    // Return as array for frontend consistency
    return service ? [service] : [];
  }

  @Get('all')
  @ApiOperation({
    summary: 'Get all tracing services for a system',
    description:
      'Returns all tracing service configurations for a system (for configuration UI)',
  })
  @ApiQuery({
    name: 'systemId',
    description: 'System under test ID',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Tracing services retrieved successfully',
    type: [TracingServiceResponseDto],
  })
  async findAll(
    @Query('systemId') systemId: string,
    @UserCtx() ctx: UserContext,
  ) {
    return await this.tracingServicesService.findAllBySystem(
      systemId,
      ctx.userId,
      ctx.roles,
    );
  }

  @Post()
  @ApiOperation({
    summary: 'Create or update a tracing service',
    description:
      'Creates a new tracing service or updates existing if same system/environment/workload exists',
  })
  @ApiResponse({
    status: 201,
    description: 'Tracing service created or updated successfully',
    type: TracingServiceResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({
    status: 409,
    description:
      'Tracing service with this system/environment/workload combination already exists',
  })
  async create(
    @Body() createDto: CreateTracingServiceDto,
    @UserCtx() ctx: UserContext,
  ) {
    return await this.tracingServicesService.createOrUpdate(
      createDto,
      ctx.userId,
      ctx.roles,
    );
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a specific tracing service',
    description: 'Updates an existing tracing service by ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Tracing service updated successfully',
    type: TracingServiceResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Tracing service not found' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateTracingServiceDto,
    @UserCtx() ctx: UserContext,
  ) {
    return await this.tracingServicesService.update(
      id,
      updateDto,
      ctx.userId,
      ctx.roles,
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a tracing service' })
  @ApiResponse({
    status: 200,
    description: 'Tracing service deleted successfully',
  })
  @ApiResponse({ status: 404, description: 'Tracing service not found' })
  async delete(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    await this.tracingServicesService.delete(id, ctx.userId, ctx.roles);

    return {
      message: 'Tracing service deleted successfully',
    };
  }
}
