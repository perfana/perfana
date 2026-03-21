import { Controller, Get, Post, Put, Delete, Query, Param, Body, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { BenchmarksService } from './benchmarks.service';
import { CopyBenchmarksDto } from './dto/copy-benchmarks.dto';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';

@ApiTags('benchmarks')
@Controller('benchmarks')
export class BenchmarksController {
  private readonly logger = new Logger(BenchmarksController.name);

  constructor(private readonly benchmarksService: BenchmarksService) {}

  @Get()
  @ApiOperation({ summary: 'Get all benchmarks with optional filtering' })
  @ApiQuery({ name: 'systemUnderTestId', required: false, description: 'Filter by system under test ID' })
  @ApiQuery({ name: 'testEnvironment', required: false, description: 'Filter by test environment' })
  @ApiQuery({ name: 'workload', required: false, description: 'Filter by workload' })
  @ApiQuery({ name: 'enabled', required: false, description: 'Filter by enabled status' })
  @ApiQuery({ name: 'valid', required: false, description: 'Filter by valid status' })
  @ApiQuery({ name: 'benchmarkType', required: false, enum: ['metric', 'apdex'], description: 'Filter by benchmark type' })
  @ApiResponse({ status: 200, description: 'Return all benchmarks' })
  async findAll(@UserCtx() ctx: UserContext, @Query() query: any) {
    try {
      return await this.benchmarksService.findAll(ctx.userId, ctx.roles, query);
    } catch (error) {
      this.logger.error('Failed to fetch benchmarks:', error);
      throw new HttpException(
        'Failed to fetch benchmarks',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('system/:systemId/config-options')
  @ApiOperation({ summary: 'Get available environments and workloads for a system' })
  @ApiResponse({
    status: 200,
    description: 'Return available environments and workloads',
    schema: {
      type: 'object',
      properties: {
        environments: {
          type: 'array',
          items: { type: 'string' }
        },
        workloads: {
          type: 'array',
          items: { type: 'string' }
        }
      }
    }
  })
  async getSystemConfigOptions(@UserCtx() ctx: UserContext, @Param('systemId') systemId: string) {
    try {
      return await this.benchmarksService.getSystemEnvironmentsAndWorkloads(systemId, ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error('Failed to fetch system config options:', error);
      throw new HttpException(
        'Failed to fetch system config options',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('copy')
  @ApiOperation({ summary: 'Copy SLOs/benchmarks from one scope to another' })
  @ApiResponse({ status: 201, description: 'Benchmarks copied successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async copyBenchmarks(
    @UserCtx() ctx: UserContext,
    @Body() dto: CopyBenchmarksDto,
  ): Promise<{ copied: number; skipped: number; total: number }> {
    try {
      return await this.benchmarksService.copyToScope(ctx.userId, ctx.roles, dto);
    } catch (error) {
      this.logger.error('Failed to copy benchmarks:', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException('Failed to copy benchmarks', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create a new SLO/benchmark' })
  @ApiResponse({ status: 201, description: 'SLO created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async create(
    @UserCtx() ctx: UserContext,
    @Body() createBenchmarkDto: {
    systemUnderTestId: string;
    testEnvironment: string;
    workload: string;
    source: string;
    grafanaInstance?: string;
    dashboardLabel?: string;
    dashboardId?: number;
    dashboardUid?: string;
    applicationDashboardId?: string;
    configTitle: string;
    panelTitle: string;
    evaluateType: string;
    requirementOperator: string;
    requirementValue: number;
    description?: string;
    tags?: string[];
    configuration?: any;
  }) {
    try {
      return await this.benchmarksService.create(ctx.userId, ctx.roles, createBenchmarkDto);
    } catch (error) {
      this.logger.error('Failed to create benchmark:', error);
      throw new HttpException(
        'Failed to create benchmark',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('sync-tags')
  @ApiOperation({ summary: 'Synchronize benchmark tags with application_dashboard tags' })
  @ApiResponse({ status: 200, description: 'Tags synchronized successfully' })
  @ApiResponse({ status: 500, description: 'Failed to synchronize tags' })
  async syncTags(@UserCtx() ctx: UserContext) {
    try {
      await this.benchmarksService.syncTagsWithApplicationDashboards(ctx.userId, ctx.roles);
      return { message: 'Benchmark tags synchronized successfully with application_dashboard tags' };
    } catch (error) {
      this.logger.error('Failed to sync benchmark tags:', error);
      throw new HttpException(
        'Failed to synchronize benchmark tags',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('tag-sync-status')
  @ApiOperation({ summary: 'Get benchmark tag synchronization status' })
  @ApiResponse({ status: 200, description: 'Return tag synchronization status for all benchmarks' })
  async getTagSyncStatus(@UserCtx() ctx: UserContext) {
    try {
      return await this.benchmarksService.getBenchmarkTagSyncStatus(ctx.userId, ctx.roles);
    } catch (error) {
      this.logger.error('Failed to fetch tag sync status:', error);
      throw new HttpException(
        'Failed to fetch tag sync status',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single SLO/benchmark by ID' })
  @ApiResponse({ status: 200, description: 'Return the SLO' })
  @ApiResponse({ status: 404, description: 'SLO not found' })
  async findOne(@UserCtx() ctx: UserContext, @Param('id') id: string) {
    try {
      const benchmark = await this.benchmarksService.findOne(id, ctx.userId, ctx.roles);
      if (!benchmark) {
        throw new HttpException('SLO not found', HttpStatus.NOT_FOUND);
      }
      return benchmark;
    } catch (error) {
      this.logger.error('Failed to fetch SLO:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to fetch SLO',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an existing SLO/benchmark' })
  @ApiResponse({ status: 200, description: 'SLO updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 404, description: 'SLO not found' })
  async update(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
    @Body() updateBenchmarkDto: {
    systemUnderTestId?: string;
    testEnvironment?: string;
    workload?: string;
    source?: string;
    grafanaInstance?: string;
    dashboardLabel?: string;
    dashboardId?: number;
    dashboardUid?: string;
    configTitle?: string;
    panelTitle?: string;
    evaluateType?: string;
    requirementOperator?: string;
    requirementValue?: number;
    description?: string;
    tags?: string[];
    configuration?: any;
    enabled?: boolean;
    valid?: boolean;
  }) {
    try {
      const benchmark = await this.benchmarksService.update(id, ctx.userId, ctx.roles, updateBenchmarkDto);
      if (!benchmark) {
        throw new HttpException('SLO not found', HttpStatus.NOT_FOUND);
      }
      return benchmark;
    } catch (error) {
      this.logger.error('Failed to update SLO:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to update SLO',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an SLO/benchmark' })
  @ApiResponse({ status: 204, description: 'SLO deleted successfully' })
  @ApiResponse({ status: 404, description: 'SLO not found' })
  async delete(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    try {
      // Find the benchmark first to ensure it exists
      const benchmark = await this.benchmarksService.findOne(id, ctx.userId, ctx.roles);
      if (!benchmark) {
        throw new HttpException('SLO not found', HttpStatus.NOT_FOUND);
      }

      await this.benchmarksService.delete(id, ctx.userId, ctx.roles);

      // Return 204 No Content on successful deletion
      return;
    } catch (error) {
      this.logger.error('Failed to delete SLO:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to delete SLO',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==================== Apdex SLO Endpoints ====================

  @Post('apdex')
  @ApiOperation({ summary: 'Create a new Apdex SLO' })
  @ApiResponse({ status: 201, description: 'Apdex SLO created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async createApdexSlo(
    @UserCtx() ctx: UserContext,
    @Body() createDto: {
    systemUnderTestId: string;
    testEnvironment: string;
    workload: string;
    transactionName?: string;
    minApdexScore: number;
    apdexThresholdMs?: number;
    includeFailedRequests?: boolean;
    excludeRampUpTime?: boolean;
    description?: string;
    tags?: string[];
  }) {
    try {
      return await this.benchmarksService.createApdexSlo(ctx.userId, ctx.roles, createDto);
    } catch (error) {
      this.logger.error('Failed to create Apdex SLO:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      if (error instanceof Error && error.message.includes('minApdexScore')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        'Failed to create Apdex SLO',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put('apdex/:id')
  @ApiOperation({ summary: 'Update an existing Apdex SLO' })
  @ApiResponse({ status: 200, description: 'Apdex SLO updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 404, description: 'Apdex SLO not found' })
  async updateApdexSlo(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
    @Body() updateDto: {
    transactionName?: string;
    minApdexScore?: number;
    apdexThresholdMs?: number | null;
    includeFailedRequests?: boolean;
    excludeRampUpTime?: boolean;
    enabled?: boolean;
    description?: string;
    tags?: string[];
  }) {
    try {
      const result = await this.benchmarksService.updateApdexSlo(id, ctx.userId, ctx.roles, updateDto);
      if (!result) {
        throw new HttpException('Apdex SLO not found', HttpStatus.NOT_FOUND);
      }
      return result;
    } catch (error) {
      this.logger.error('Failed to update Apdex SLO:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      if (error instanceof Error) {
        if (error.message.includes('minApdexScore') || error.message.includes('non-Apdex')) {
          throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
        }
      }
      throw new HttpException(
        'Failed to update Apdex SLO',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('apdex/transactions/:testRunId')
  @ApiOperation({ summary: 'Get available transactions for a test run (for Apdex SLO configuration)' })
  @ApiResponse({
    status: 200,
    description: 'Return list of transaction names',
    schema: {
      type: 'array',
      items: { type: 'string' }
    }
  })
  async getAvailableTransactions(@UserCtx() _ctx: UserContext, @Param('testRunId') testRunId: string) {
    try {
      return await this.benchmarksService.getAvailableTransactions(testRunId);
    } catch (error) {
      this.logger.error('Failed to fetch available transactions:', error);
      throw new HttpException(
        'Failed to fetch available transactions',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('apdex/preview')
  @ApiOperation({ summary: 'Preview Apdex calculation for a test run' })
  @ApiResponse({
    status: 200,
    description: 'Return Apdex preview result',
    schema: {
      type: 'object',
      properties: {
        transaction_name: { type: 'string', nullable: true },
        satisfied_count: { type: 'number' },
        tolerating_count: { type: 'number' },
        frustrated_count: { type: 'number' },
        total_count: { type: 'number' },
        apdex_score: { type: 'number', nullable: true },
        threshold_ms: { type: 'number' },
      }
    }
  })
  async previewApdex(
    @UserCtx() _ctx: UserContext,
    @Body() params: {
      testRunId: string;
      transactionName?: string;
      thresholdMs: number;
      includeFailedRequests?: boolean;
      excludeRampUp?: boolean;
    },
  ) {
    try {
      return await this.benchmarksService.previewApdex(params);
    } catch (error) {
      this.logger.error('Failed to preview Apdex:', error);
      if (error instanceof Error && error.message.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to preview Apdex',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('apdex/threshold')
  @ApiOperation({ summary: 'Get configured Apdex threshold for a transaction/workload' })
  @ApiQuery({ name: 'systemUnderTestId', required: true })
  @ApiQuery({ name: 'testEnvironment', required: true })
  @ApiQuery({ name: 'workload', required: true })
  @ApiQuery({ name: 'transactionName', required: false })
  @ApiResponse({
    status: 200,
    description: 'Return Apdex threshold with source',
    schema: {
      type: 'object',
      properties: {
        threshold_ms: { type: 'number' },
        source: { type: 'string', enum: ['transaction', 'workload', 'default'] },
      }
    }
  })
  async getApdexThreshold(@UserCtx() _ctx: UserContext, @Query() query: {
    systemUnderTestId: string;
    testEnvironment: string;
    workload: string;
    transactionName?: string;
  }) {
    try {
      return await this.benchmarksService.getApdexThreshold(query);
    } catch (error) {
      this.logger.error('Failed to get Apdex threshold:', error);
      throw new HttpException(
        'Failed to get Apdex threshold',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
