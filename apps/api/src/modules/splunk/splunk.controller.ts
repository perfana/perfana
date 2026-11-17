import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';
import { SplunkService } from './splunk.service';
import {
  CopySplunkEntityMappingsDto,
  CreateSplunkConfigDto,
  CreateSplunkEntityMappingDto,
  CreateSplunkQueryDto,
  PreviewSplunkQueryDto,
  StarterSplunkQueriesDto,
  TestSplunkConnectionDto,
  UpdateSplunkConfigDto,
  UpdateSplunkQueryDto,
} from './dto/splunk.dto';

@ApiTags('splunk')
@ApiBearerAuth()
@Controller('splunk')
export class SplunkController {
  constructor(private readonly splunk: SplunkService) {}

  // --- connections -----------------------------------------------------------

  @Get('configs')
  @ApiOperation({ summary: 'List Splunk connections in your organizations (credentials masked)' })
  listConfigs(@UserCtx() ctx: UserContext) {
    return this.splunk.listConfigs(ctx.userId, ctx.roles);
  }

  @Post('configs')
  @ApiOperation({ summary: 'Create a Splunk connection' })
  @ApiResponse({ status: 403, description: 'Missing integration:splunk:create in the target organization' })
  createConfig(@Body() dto: CreateSplunkConfigDto, @UserCtx() ctx: UserContext) {
    return this.splunk.createConfig(dto, ctx.userId, ctx.roles);
  }

  @Post('configs/test-connection')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Test unsaved Splunk connection settings (GET /services/server/info)' })
  testConnection(@Body() dto: TestSplunkConnectionDto, @UserCtx() ctx: UserContext) {
    return this.splunk.testConnection(dto, ctx.userId, ctx.roles);
  }

  @Get('configs/:id')
  getConfig(@Param('id', ParseUUIDPipe) id: string, @UserCtx() ctx: UserContext) {
    return this.splunk.getConfig(id, ctx.userId, ctx.roles);
  }

  @Patch('configs/:id')
  @ApiOperation({ summary: 'Update a Splunk connection. A credential sent back as [MASKED] is left unchanged.' })
  updateConfig(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSplunkConfigDto, @UserCtx() ctx: UserContext) {
    return this.splunk.updateConfig(id, dto, ctx.userId, ctx.roles);
  }

  @Delete('configs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a Splunk connection and every mapping and query that uses it' })
  deleteConfig(@Param('id', ParseUUIDPipe) id: string, @UserCtx() ctx: UserContext) {
    return this.splunk.deleteConfig(id, ctx.userId, ctx.roles);
  }

  @Post('configs/:id/test-connection')
  @HttpCode(HttpStatus.OK)
  testSavedConnection(@Param('id', ParseUUIDPipe) id: string, @UserCtx() ctx: UserContext) {
    return this.splunk.testSavedConnection(id, ctx.userId, ctx.roles);
  }

  @Get('configs/:id/sources')
  @ApiOperation({ summary: 'Discover index / sourcetype / host with event counts (one tstats search, cached 10 min)' })
  @ApiQuery({ name: 'hours', required: false, description: 'Look-back window, default 24' })
  @ApiQuery({ name: 'refresh', required: false, type: Boolean })
  discoverSources(
    @Param('id', ParseUUIDPipe) id: string,
    @UserCtx() ctx: UserContext,
    @Query('hours') hours?: string,
    @Query('refresh') refresh?: string,
  ) {
    const h = Number(hours);
    return this.splunk.discoverSources(id, ctx.userId, ctx.roles, Number.isFinite(h) && h > 0 ? h : 24, refresh === 'true');
  }

  // --- entity mappings -------------------------------------------------------

  @Get('entities/mappings')
  @ApiOperation({ summary: 'Mappings for a system; with environment (+ workload), exactly those a run in that scope uses' })
  listMappings(
    @Query('systemId', ParseUUIDPipe) systemId: string,
    @UserCtx() ctx: UserContext,
    @Query('environment') environment?: string,
    @Query('workload') workload?: string,
  ) {
    return this.splunk.listMappings(systemId, ctx.userId, ctx.roles, environment || undefined, workload || undefined);
  }

  @Post('entities/mappings')
  @ApiResponse({ status: 409, description: 'This source is already mapped at that level (nothing returned)' })
  createMapping(@Body() dto: CreateSplunkEntityMappingDto, @UserCtx() ctx: UserContext) {
    return this.splunk.createMapping(dto, ctx.userId, ctx.roles);
  }

  @Post('entities/mappings/copy')
  @HttpCode(HttpStatus.OK)
  copyMappings(@Body() dto: CopySplunkEntityMappingsDto, @UserCtx() ctx: UserContext) {
    return this.splunk.copyMappings(dto, ctx.userId, ctx.roles);
  }

  @Delete('entities/mappings/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteMapping(@Param('id', ParseUUIDPipe) id: string, @UserCtx() ctx: UserContext) {
    return this.splunk.deleteMapping(id, ctx.userId, ctx.roles);
  }

  @Get('entities/filter')
  @ApiOperation({ summary: 'The SPL that $entities expands to for a scope (for "Open in Splunk")' })
  entitiesFilter(
    @Query('systemId', ParseUUIDPipe) systemUnderTestId: string,
    @Query('environment') testEnvironment: string,
    @Query('workload') workload: string,
    @UserCtx() ctx: UserContext,
  ) {
    return this.splunk.entitiesFilter({ systemUnderTestId, testEnvironment, workload }, ctx.userId, ctx.roles);
  }

  // --- test run --------------------------------------------------------------

  @Get('runs/:testRunId/summary')
  @ApiOperation({ summary: 'What the test run page Splunk card shows: sources, per-panel totals and Open in Splunk links' })
  runSummary(@Param('testRunId') testRunId: string, @UserCtx() ctx: UserContext) {
    return this.splunk.runSummary(testRunId, ctx.userId, ctx.roles);
  }

  // --- queries ---------------------------------------------------------------

  @Get('queries')
  listQueries(
    @Query('systemId', ParseUUIDPipe) systemUnderTestId: string,
    @Query('environment') testEnvironment: string,
    @Query('workload') workload: string,
    @UserCtx() ctx: UserContext,
  ) {
    return this.splunk.listQueries({ systemUnderTestId, testEnvironment, workload }, ctx.userId, ctx.roles);
  }

  @Post('queries')
  @ApiResponse({ status: 409, description: 'The panel id is taken on that dashboard for this workload (nothing returned)' })
  createQuery(@Body() dto: CreateSplunkQueryDto, @UserCtx() ctx: UserContext) {
    return this.splunk.createQuery(dto, ctx.userId, ctx.roles);
  }

  @Post('queries/starter')
  @ApiOperation({ summary: 'Create the starter panels (events by level, errors by host, exceptions by type) for a scope' })
  createStarterQueries(
    @Body() body: StarterSplunkQueriesDto,
    @UserCtx() ctx: UserContext,
  ) {
    return this.splunk.createStarterQueries(body, ctx.userId, ctx.roles);
  }

  @Post('queries/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run an unsaved query over the last N minutes: series, totals and candidate split fields' })
  previewQuery(@Body() dto: PreviewSplunkQueryDto, @UserCtx() ctx: UserContext) {
    return this.splunk.previewQuery(dto, ctx.userId, ctx.roles);
  }

  @Patch('queries/:id')
  updateQuery(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSplunkQueryDto, @UserCtx() ctx: UserContext) {
    return this.splunk.updateQuery(id, dto, ctx.userId, ctx.roles);
  }

  @Delete('queries/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteQuery(@Param('id', ParseUUIDPipe) id: string, @UserCtx() ctx: UserContext) {
    return this.splunk.deleteQuery(id, ctx.userId, ctx.roles);
  }
}
