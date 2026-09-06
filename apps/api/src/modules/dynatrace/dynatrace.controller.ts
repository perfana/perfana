import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';
import { DynatraceService } from './dynatrace.service';
import { TestRunsConfigService } from '../test-runs/services/test-runs-config.service';
import { CreateDynatraceConfigDto } from './dto/create-dynatrace-config.dto';
import { UpdateDynatraceConfigDto } from './dto/update-dynatrace-config.dto';
import { DynatraceConfigDto } from './dto/dynatrace-config.dto';
import { CreateDynatraceQueryDto } from './dto/create-dynatrace-query.dto';
import { UpdateDynatraceQueryDto } from './dto/update-dynatrace-query.dto';
import { DynatraceQueryDto } from './dto/dynatrace-query.dto';
import { CreateEntityMappingDto } from './dto/create-entity-mapping.dto';
import { TestConnectionDto } from './dto/test-connection.dto';
import { StoreHostPropertiesDto, HostPropertiesResponse, HostMetricsResponse, HostProblemResponse, HostOverviewRow } from './dto/host.dto';

@ApiTags('dynatrace')
@ApiBearerAuth()
@Controller('dynatrace')
export class DynatraceController {
  private readonly logger = new Logger(DynatraceController.name);

  constructor(
    private readonly dynatraceService: DynatraceService,
    @Inject(forwardRef(() => TestRunsConfigService))
    private readonly testRunsConfigService: TestRunsConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get all Dynatrace configurations' })
  @ApiResponse({
    status: 200,
    description: 'List of Dynatrace configurations',
    type: [DynatraceConfigDto],
  })
  async findAll(
    @Query('organizationId') organizationId: string | undefined,
    @UserCtx() ctx: UserContext,
  ) {
    return this.dynatraceService.findAll(ctx.userId, ctx.roles, organizationId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new Dynatrace configuration' })
  @ApiResponse({
    status: 201,
    description: 'The configuration has been created',
    type: DynatraceConfigDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid configuration or connection failed',
  })
  @ApiResponse({
    status: 409,
    description: 'Configuration already exists for this host',
  })
  async create(@Body() dto: CreateDynatraceConfigDto, @UserCtx() ctx: UserContext) {
    return this.dynatraceService.create(dto, ctx.userId, ctx.roles);
  }

  @Post('test-connection')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Test Dynatrace connection' })
  @ApiResponse({
    status: 200,
    description: 'Connection test successful',
  })
  @ApiResponse({
    status: 400,
    description: 'Connection test failed',
  })
  async testConnection(@Body() dto: TestConnectionDto, @UserCtx() _ctx: UserContext) {
    return this.dynatraceService.testConnection(dto.host, dto.apiToken);
  }

  @Get('hosts/overview')
  @ApiOperation({ summary: 'Per-host overview (avg CPU/mem + problem flag) for a test-run window' })
  @ApiResponse({
    status: 200,
    description: 'Host overview rows',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          hostId: { type: 'string' },
          displayName: { type: 'string' },
          dynatraceConfigId: { type: 'string' },
          cpuAvg: { type: 'number', nullable: true },
          memAvg: { type: 'number', nullable: true },
          problemCount: { type: 'number' },
          worstSeverity: { type: 'string', nullable: true },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid or missing query parameters' })
  async getHostsOverview(
    @Query('systemId') systemId: string,
    @Query('environment') environment: string,
    @Query('workload') workload: string,
    @Query('startTime') startTime: string,
    @Query('endTime') endTime: string,
    @UserCtx() ctx: UserContext,
    @Query('hostId') hostId?: string,
  ): Promise<HostOverviewRow[]> {
    if (!systemId || !environment || !workload) {
      throw new BadRequestException('systemId, environment and workload query parameters are required');
    }
    if (!startTime || !endTime) {
      throw new BadRequestException('startTime and endTime query parameters are required');
    }
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid date format for startTime or endTime');
    }
    return this.dynatraceService.fetchHostsOverview(systemId, environment, workload, start, end, ctx.userId, ctx.roles, hostId);
  }

  // Host Endpoints - Place before parameterized routes to avoid conflicts
  @Get('hosts/:hostId/properties')
  @ApiOperation({ summary: 'Fetch host properties from Dynatrace' })
  @ApiResponse({
    status: 200,
    description: 'Host properties fetched successfully',
    schema: {
      type: 'object',
      properties: {
        entityId: { type: 'string' },
        displayName: { type: 'string' },
        properties: {
          type: 'object',
          properties: {
            cpuCores: { type: 'number' },
            osType: { type: 'string' },
            osArchitecture: { type: 'string' },
            bitness: { type: 'string' },
            monitoringMode: { type: 'string' },
            hostName: { type: 'string' },
            ipAddresses: { type: 'array', items: { type: 'string' } },
            cloudType: { type: 'string' },
            memoryTotal: { type: 'number' },
          },
        },
        lastSeenTimestamp: { type: 'number' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Host entity not found',
  })
  async getHostProperties(
    @Param('hostId') hostId: string,
    @Query('dynatraceConfigId') dynatraceConfigId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<HostPropertiesResponse> {
    if (!dynatraceConfigId) {
      throw new BadRequestException('dynatraceConfigId query parameter is required');
    }
    return this.dynatraceService.fetchHostProperties(hostId, dynatraceConfigId, ctx.userId, ctx.roles);
  }

  @Get('hosts/:hostId/metrics')
  @ApiOperation({ summary: 'Fetch host performance metrics from Dynatrace' })
  @ApiResponse({
    status: 200,
    description: 'Host metrics fetched successfully',
    schema: {
      type: 'object',
      properties: {
        entityId: { type: 'string' },
        metrics: {
          type: 'object',
          properties: {
            cpu: { type: 'array', items: { type: 'object' } },
            memory: { type: 'array', items: { type: 'object' } },
            disk: { type: 'array', items: { type: 'object' } },
            network: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid parameters or failed to fetch metrics',
  })
  async getHostMetrics(
    @Param('hostId') hostId: string,
    @Query('startTime') startTime: string,
    @Query('endTime') endTime: string,
    @Query('dynatraceConfigId') dynatraceConfigId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<HostMetricsResponse> {
    if (!dynatraceConfigId) {
      throw new BadRequestException('dynatraceConfigId query parameter is required');
    }
    if (!startTime || !endTime) {
      throw new BadRequestException('startTime and endTime query parameters are required');
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid date format for startTime or endTime');
    }

    return this.dynatraceService.fetchHostMetrics(hostId, start, end, dynatraceConfigId, ctx.userId, ctx.roles);
  }

  @Get('hosts/:hostId/problems')
  @ApiOperation({ summary: 'Fetch host problems from Dynatrace' })
  @ApiResponse({
    status: 200,
    description: 'Host problems fetched successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          problemId: { type: 'string' },
          title: { type: 'string' },
          status: { type: 'string', enum: ['OPEN', 'RESOLVED'] },
          severityLevel: { type: 'string' },
          startTime: { type: 'string' },
          endTime: { type: 'string' },
          impactLevel: { type: 'string' },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid parameters or failed to fetch problems',
  })
  async getHostProblems(
    @Param('hostId') hostId: string,
    @Query('startTime') startTime: string,
    @Query('endTime') endTime: string,
    @Query('dynatraceConfigId') dynatraceConfigId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<HostProblemResponse[]> {
    if (!dynatraceConfigId) {
      throw new BadRequestException('dynatraceConfigId query parameter is required');
    }
    if (!startTime || !endTime) {
      throw new BadRequestException('startTime and endTime query parameters are required');
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid date format for startTime or endTime');
    }

    return this.dynatraceService.fetchHostProblems(hostId, start, end, dynatraceConfigId, ctx.userId, ctx.roles);
  }

  @Post('hosts/:hostId/store-properties')
  @ApiOperation({
    summary: 'Store host properties as test run configuration',
    description: 'Stores host properties in test_run_configs with tags ["dynatrace", hostDisplayName]'
  })
  @ApiResponse({
    status: 201,
    description: 'Host properties stored successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request data',
  })
  async storeHostProperties(
    @Param('hostId') hostId: string,
    @Body() dto: StoreHostPropertiesDto,
    @UserCtx() _ctx: UserContext,
  ) {
    this.logger.log(`Storing properties for host ${hostId}`, {
      testRunId: dto.testRunId,
      hostDisplayName: dto.hostDisplayName,
      propertiesCount: Object.keys(dto.properties).length,
    });

    // Convert properties object to config items array
    const configItems = Object.entries(dto.properties)
      .filter(([_, value]) => value !== undefined && value !== null)
      .map(([key, value]) => ({
        key: `host.${key}`,
        value: Array.isArray(value) ? value.join(', ') : String(value),
      }));

    if (configItems.length === 0) {
      this.logger.log(`No properties to store for host ${hostId}`);
      return {
        success: true,
        message: 'No properties to store',
        hostId,
        testRunId: dto.testRunId,
        storedCount: 0,
      };
    }

    // Store with tags ["dynatrace", hostDisplayName]
    const tags = ['dynatrace', dto.hostDisplayName];

    try {
      await this.testRunsConfigService.addTestRunConfigsByUuid(
        dto.testRunId,
        tags,
        configItems
      );

      this.logger.log(`Successfully stored ${configItems.length} properties for host ${dto.hostDisplayName}`);
      return {
        success: true,
        message: 'Host properties stored successfully',
        hostId,
        testRunId: dto.testRunId,
        storedCount: configItems.length,
      };
    } catch (error) {
      this.logger.error(`Failed to store host properties: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
      throw new BadRequestException('Failed to store host properties');
    }
  }

  // Query Endpoints - Place before parameterized routes to avoid conflicts
  @Get('queries')
  @ApiOperation({ summary: 'Get Dynatrace queries' })
  @ApiResponse({
    status: 200,
    description: 'List of Dynatrace queries',
    type: [DynatraceQueryDto],
  })
  async findAllQueries(
    @Query('systemId') systemId?: string,
    @Query('environment') environment?: string,
    @Query('workload') workload?: string,
    @UserCtx() ctx?: UserContext,
  ) {
    if (systemId && environment) {
      return this.dynatraceService.findQueryBySystemAndEnvironment(systemId, environment, workload, ctx?.userId ?? '', ctx?.roles ?? []);
    }
    return this.dynatraceService.findAllQuery(ctx?.userId ?? '', ctx?.roles ?? []);
  }

  @Get('queries/dashboards')
  @ApiOperation({ summary: 'Get distinct dashboard labels for SLO' })
  @ApiResponse({
    status: 200,
    description: 'List of distinct dashboard labels',
    type: [String],
  })
  async getDashboardsForSlo(
    @Query('systemId') systemId: string,
    @Query('environment') environment: string,
    @Query('workload') workload: string | undefined,
    @UserCtx() ctx: UserContext,
  ) {
    if (!systemId || !environment) {
      throw new BadRequestException(`Missing required parameters: systemId=${systemId}, environment=${environment}`);
    }
    const result = await this.dynatraceService.getDistinctDashboardLabels(systemId, environment, workload, ctx.userId, ctx.roles);
    this.logger.debug('GET /queries/dashboards response', { count: result.length, result });
    return result;
  }

  @Get('queries/metrics')
  @ApiOperation({ summary: 'Get panel titles for a specific dashboard for SLO' })
  @ApiResponse({
    status: 200,
    description: 'List of panel titles for the dashboard',
    type: [String],
  })
  async getMetricsForSlo(
    @Query('systemId') systemId: string,
    @Query('environment') environment: string,
    @Query('workload') workload: string | undefined,
    @Query('dashboardLabel') dashboardLabel: string,
    @UserCtx() ctx: UserContext,
  ) {
    const result = await this.dynatraceService.getPanelTitlesForDashboard(systemId, environment, workload, dashboardLabel, ctx.userId, ctx.roles);
    this.logger.debug('GET /queries/metrics response', {
      systemId,
      environment,
      workload,
      dashboardLabel,
      count: result.length,
      result
    });
    return result;
  }

  @Get('queries/:id')
  @ApiOperation({ summary: 'Get a specific Dynatrace query' })
  @ApiResponse({
    status: 200,
    description: 'Dynatrace query details',
    type: DynatraceQueryDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Dynatrace query not found',
  })
  async findQueryById(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    return this.dynatraceService.findQueryById(id, ctx.userId, ctx.roles);
  }

  @Post('queries')
  @ApiOperation({ summary: 'Create a new Dynatrace Dynatrace query (legacy - use query/smart for recommended approach)' })
  @ApiResponse({
    status: 201,
    description: 'Dynatrace query created successfully',
    type: DynatraceQueryDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid Dynatrace query data',
  })
  async createQuery(@Body() dto: CreateDynatraceQueryDto, @UserCtx() ctx: UserContext) {
    return this.dynatraceService.createQuery(dto, ctx.userId, ctx.roles);
  }

  @Post('query/smart')
  @ApiOperation({
    summary: 'Create a new Dynatrace Dynatrace query with smart UUID handling',
    description: 'Checks if dashboard_label already exists and reuses UUID, otherwise generates new one'
  })
  @ApiResponse({
    status: 201,
    description: 'Dynatrace query created successfully with smart UUID handling',
    type: DynatraceQueryDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid Dynatrace query data',
  })
  async createQuerySmart(@Body() dto: CreateDynatraceQueryDto, @UserCtx() ctx: UserContext) {
    return this.dynatraceService.createQuerySmart(dto, ctx.userId, ctx.roles);
  }

  @Post('query/bulk-import')
  @ApiOperation({
    summary: 'Bulk import Dynatrace queries',
    description: 'Import multiple DQL queries. By default generates one shared UUID for all metrics. Set generateSharedUuid=false for individual smart UUID handling.'
  })
  @ApiResponse({
    status: 201,
    description: 'DQL queries imported successfully',
    type: [DynatraceQueryDto],
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid bulk import data',
  })
  async bulkImportQueries(
    @Body() dtoList: CreateDynatraceQueryDto[],
    @UserCtx() ctx: UserContext,
    @Query('generateSharedUuid') generateSharedUuid?: string,
  ) {
    const shouldGenerateSharedUuid = generateSharedUuid === undefined || generateSharedUuid.toLowerCase() !== 'false';
    return this.dynatraceService.bulkImportQuery(dtoList, ctx.userId, ctx.roles, shouldGenerateSharedUuid);
  }

  @Patch('queries/:id')
  @ApiOperation({ summary: 'Update a Dynatrace Dynatrace query' })
  @ApiResponse({
    status: 200,
    description: 'Dynatrace query updated successfully',
    type: DynatraceQueryDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Dynatrace query not found',
  })
  async updateQuery(@Param('id') id: string, @Body() dto: UpdateDynatraceQueryDto, @UserCtx() ctx: UserContext) {
    return this.dynatraceService.updateQuery(id, dto, ctx.userId, ctx.roles);
  }

  @Delete('queries/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a Dynatrace Dynatrace query' })
  @ApiResponse({
    status: 204,
    description: 'Dynatrace query deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Dynatrace query not found',
  })
  async deleteQuery(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    await this.dynatraceService.deleteQuery(id, ctx.userId, ctx.roles);
  }

  @Get('entities')
  @ApiOperation({ summary: 'Fetch entities from Dynatrace Environment API v2' })
  @ApiResponse({
    status: 200,
    description: 'Entities fetched successfully from Dynatrace',
    schema: {
      type: 'object',
      properties: {
        entities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              entityId: { type: 'string' },
              displayName: { type: 'string' },
              type: { type: 'string' },
              tags: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    key: { type: 'string' },
                    value: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Failed to fetch entities from Dynatrace',
  })
  async fetchEntities(
    @Query('entityType') entityType?: string,
    @Query('entityName') entityName?: string,
    @Query('dynatraceConfigId') dynatraceConfigId?: string,
    @Query('tagKey') tagKey?: string,
    @Query('tagValue') tagValue?: string,
    @UserCtx() ctx?: UserContext,
  ) {
    return this.dynatraceService.fetchEntities(ctx?.userId ?? '', ctx?.roles ?? [], entityType, entityName, dynatraceConfigId, tagKey, tagValue);
  }

  @Get('entities/mappings')
  @ApiOperation({ summary: 'Get Dynatrace entity mappings' })
  @ApiResponse({
    status: 200,
    description: 'Entity mappings fetched successfully',
    type: Array,
  })
  async getEntityMappings(
    @Query('systemId') systemId?: string,
    @Query('environment') environment?: string,
    @Query('workload') workload?: string,
    @UserCtx() ctx?: UserContext,
  ) {
    return this.dynatraceService.getEntityMappings(ctx?.userId ?? '', ctx?.roles ?? [], systemId, environment, workload);
  }

  @Get('metric-names')
  @ApiOperation({ summary: 'Get distinct metric names from ds_panels for autocomplete' })
  @ApiResponse({
    status: 200,
    description: 'List of metric names for autocomplete',
    type: [String],
  })
  async getMetricNames(
    @Query('testRunId') testRunId?: string,
    @UserCtx() ctx?: UserContext,
  ) {
    const result = await this.dynatraceService.getMetricNames(ctx?.userId ?? '', ctx?.roles ?? [], testRunId);
    this.logger.debug('GET /metric-names response', { testRunId, count: result.length, sampleMetrics: result.slice(0, 5) });
    return result;
  }

  @Post('entities/mappings')
  @ApiOperation({ summary: 'Create a new Dynatrace entity mapping' })
  @ApiResponse({
    status: 201,
    description: 'Entity mapping created successfully',
  })
  async createEntityMapping(@Body() dto: CreateEntityMappingDto, @UserCtx() ctx: UserContext) {
    const mapping = await this.dynatraceService.createEntityMapping(dto, ctx.userId, ctx.roles);

    // Auto-create host metric queries if entity type is HOST
    if (dto.entityType === 'HOST') {
      this.logger.log(`Auto-creating metric queries for HOST entity: ${dto.entityDisplayName}`);

      // Require testEnvironment and workload for host entities
      if (!dto.testEnvironment || !dto.workload) {
        throw new BadRequestException('testEnvironment and workload are required for HOST entities');
      }

      try {
        this.logger.log(`Calling createHostMetricQueries with:`, {
          dynatraceConfigId: dto.dynatraceConfigId,
          systemUnderTestId: dto.systemUnderTestId,
          testEnvironment: dto.testEnvironment,
          workload: dto.workload,
          entityId: dto.entityId,
          entityDisplayName: dto.entityDisplayName,
        });
        await this.dynatraceService.createHostMetricQueries(
          dto.dynatraceConfigId,
          dto.systemUnderTestId,
          dto.testEnvironment,
          dto.workload,
          dto.entityId,
          dto.entityDisplayName,
          ctx.userId,
          ctx.roles
        );
        this.logger.log(`Successfully created host metric queries for ${dto.entityDisplayName}`);
      } catch (error) {
        const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
        const errorStack = error && typeof error === 'object' && 'stack' in error ? (error as Error).stack : '';
        this.logger.error(`Failed to auto-create host metric queries: ${errorMessage}`, errorStack);
        // Don't fail the entity mapping creation if query creation fails
        // but log the full error for debugging
      }
    }

    return mapping;
  }

  @Delete('entities/mappings/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a Dynatrace entity mapping' })
  @ApiResponse({
    status: 204,
    description: 'Entity mapping deleted successfully',
  })
  async deleteEntityMapping(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    await this.dynatraceService.deleteEntityMapping(id, ctx.userId, ctx.roles);
  }

  @Get(':host/request-attributes')
  @ApiOperation({ summary: 'Fetch request attributes from Dynatrace' })
  @ApiResponse({
    status: 200,
    description: 'Request attributes fetched successfully',
  })
  async fetchRequestAttributes(@Param('host') host: string, @UserCtx() ctx: UserContext) {
    return this.dynatraceService.fetchRequestAttributes(host, ctx.userId, ctx.roles);
  }

  @Get('configs/:id/request-attributes')
  @ApiOperation({ summary: 'Fetch request attributes for a configured Dynatrace instance' })
  @ApiResponse({
    status: 200,
    description: 'Request attributes fetched successfully',
  })
  async getRequestAttributesForConfig(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    return this.dynatraceService.getRequestAttributesForConfig(id, ctx.userId, ctx.roles);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a Dynatrace configuration' })
  @ApiResponse({
    status: 200,
    description: 'Configuration updated successfully',
    type: DynatraceConfigDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Configuration not found',
  })
  async update(@Param('id') id: string, @Body() dto: UpdateDynatraceConfigDto, @UserCtx() ctx: UserContext) {
    return this.dynatraceService.update(id, dto, ctx.userId, ctx.roles);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a Dynatrace configuration' })
  @ApiResponse({
    status: 204,
    description: 'Configuration deleted successfully',
  })
  async delete(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    await this.dynatraceService.delete(id, ctx.userId, ctx.roles);
  }

}