import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { LokiMatcher } from '@perfana/shared/services/loki/client';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';
import { LokiService } from './loki.service';
import {
  CopyLokiStreamMappingsDto,
  CreateLokiConfigDto,
  CreateLokiQueryDto,
  CreateLokiStreamMappingDto,
  PreviewLokiQueryDto,
  StarterLokiQueriesDto,
  TestLokiConnectionDto,
  UpdateLokiConfigDto,
  UpdateLokiQueryDto,
} from './dto/loki.dto';

/** Look-back hours, clamped: part of the per-process cache key. */
const clampHours = (hours?: string): number => {
  const h = Math.floor(Number(hours));
  return Number.isFinite(h) && h > 0 ? Math.min(h, 720) : 24;
};

@ApiTags('loki')
@ApiBearerAuth()
@Controller('loki')
export class LokiController {
  constructor(private readonly loki: LokiService) {}

  // --- connections -----------------------------------------------------------

  @Get('configs')
  @ApiOperation({ summary: 'List Loki connections (a Loki datasource on a Grafana instance) in your organizations' })
  listConfigs(@UserCtx() ctx: UserContext) {
    return this.loki.listConfigs(ctx.userId, ctx.roles);
  }

  @Get('datasources')
  @ApiOperation({ summary: 'Loki datasources on a Grafana instance (read through the instance\'s own credentials)' })
  listDatasources(@Query('grafanaInstanceId', ParseUUIDPipe) grafanaInstanceId: string, @UserCtx() ctx: UserContext) {
    return this.loki.listDatasources(grafanaInstanceId, ctx.userId, ctx.roles);
  }

  @Post('configs')
  @ApiOperation({ summary: 'Create a Loki connection' })
  @ApiResponse({ status: 403, description: 'Missing integration:loki:create in the Grafana instance\'s organization' })
  @ApiResponse({ status: 409, description: 'That datasource is already connected for the instance (nothing returned)' })
  createConfig(@Body() dto: CreateLokiConfigDto, @UserCtx() ctx: UserContext) {
    return this.loki.createConfig(dto, ctx.userId, ctx.roles);
  }

  @Post('configs/test-connection')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Test an unsaved connection: list Loki labels for the last hour through the datasource' })
  testConnection(@Body() dto: TestLokiConnectionDto, @UserCtx() ctx: UserContext) {
    return this.loki.testConnection(dto, ctx.userId, ctx.roles);
  }

  @Get('configs/:id')
  getConfig(@Param('id', ParseUUIDPipe) id: string, @UserCtx() ctx: UserContext) {
    return this.loki.getConfig(id, ctx.userId, ctx.roles);
  }

  @Patch('configs/:id')
  updateConfig(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLokiConfigDto, @UserCtx() ctx: UserContext) {
    return this.loki.updateConfig(id, dto, ctx.userId, ctx.roles);
  }

  @Delete('configs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a Loki connection and every mapping and panel that uses it' })
  deleteConfig(@Param('id', ParseUUIDPipe) id: string, @UserCtx() ctx: UserContext) {
    return this.loki.deleteConfig(id, ctx.userId, ctx.roles);
  }

  @Post('configs/:id/test-connection')
  @HttpCode(HttpStatus.OK)
  testSavedConnection(@Param('id', ParseUUIDPipe) id: string, @UserCtx() ctx: UserContext) {
    return this.loki.testSavedConnection(id, ctx.userId, ctx.roles);
  }

  @Get('configs/:id/labels')
  @ApiOperation({ summary: 'Loki label names seen in the look-back window (cached 10 min)' })
  @ApiQuery({ name: 'hours', required: false, description: 'Look-back window, default 24' })
  @ApiQuery({ name: 'refresh', required: false, type: Boolean })
  listLabels(@Param('id', ParseUUIDPipe) id: string, @UserCtx() ctx: UserContext, @Query('hours') hours?: string, @Query('refresh') refresh?: string) {
    return this.loki.listLabels(id, ctx.userId, ctx.roles, clampHours(hours), refresh === 'true');
  }

  @Get('configs/:id/labels/:label/values')
  @ApiOperation({ summary: 'Values of a Loki label, optionally narrowed by matchers already chosen (cached 10 min)' })
  @ApiQuery({ name: 'matchers', required: false, description: 'JSON array of {label, op, value}' })
  listLabelValues(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('label') label: string,
    @UserCtx() ctx: UserContext,
    @Query('hours') hours?: string,
    @Query('matchers') matchers?: string,
  ) {
    // A label name, like every other label input: anything else (`..`, `/`) would reach another
    // resource path on the datasource.
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(label)) throw new BadRequestException('label must be a Loki label name');
    let parsed: LokiMatcher[] | undefined;
    if (matchers) {
      try {
        parsed = JSON.parse(matchers) as LokiMatcher[];
      } catch {
        throw new BadRequestException('matchers must be a JSON array');
      }
      if (!Array.isArray(parsed)) throw new BadRequestException('matchers must be a JSON array');
    }
    return this.loki.listLabelValues(id, label, ctx.userId, ctx.roles, clampHours(hours), parsed);
  }

  // --- stream mappings -------------------------------------------------------

  @Get('streams/mappings')
  @ApiOperation({ summary: 'Mappings for a system; with environment (+ workload), exactly those a run in that scope uses' })
  listMappings(
    @Query('systemId', ParseUUIDPipe) systemId: string,
    @UserCtx() ctx: UserContext,
    @Query('environment') environment?: string,
    @Query('workload') workload?: string,
  ) {
    return this.loki.listMappings(systemId, ctx.userId, ctx.roles, environment || undefined, workload || undefined);
  }

  @Post('streams/mappings')
  @ApiResponse({ status: 409, description: 'These streams are already mapped at that level (nothing returned)' })
  createMapping(@Body() dto: CreateLokiStreamMappingDto, @UserCtx() ctx: UserContext) {
    return this.loki.createMapping(dto, ctx.userId, ctx.roles);
  }

  @Post('streams/mappings/copy')
  @HttpCode(HttpStatus.OK)
  copyMappings(@Body() dto: CopyLokiStreamMappingsDto, @UserCtx() ctx: UserContext) {
    return this.loki.copyMappings(dto, ctx.userId, ctx.roles);
  }

  @Delete('streams/mappings/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteMapping(@Param('id', ParseUUIDPipe) id: string, @UserCtx() ctx: UserContext) {
    return this.loki.deleteMapping(id, ctx.userId, ctx.roles);
  }

  // --- test run --------------------------------------------------------------

  @Get('runs/:testRunId/panel-links')
  @ApiOperation({ summary: "Each Loki panel's Grafana Explore link narrowed to one application (the card's application tab)" })
  @ApiQuery({ name: 'service', required: true, description: "A value of the connection's service label, or '(none)' for the lines without it" })
  runPanelLinks(@Param('testRunId') testRunId: string, @Query('service') service: string, @UserCtx() ctx: UserContext) {
    if (typeof service !== 'string' || service.length === 0 || service.length > 255) throw new BadRequestException('service must be 1-255 characters');
    return this.loki.runPanelLinks(testRunId, service, ctx.userId, ctx.roles);
  }

  @Get('runs/:testRunId/summary')
  @ApiOperation({ summary: 'What the test run page Loki card shows: streams, panel totals, error rate vs baseline, top patterns and error lines' })
  @ApiQuery({
    name: 'baseline', required: false,
    description: "What to compare with: 'control-group', or a test run id of the same workload. Absent: the control group, else the 5 previous completed runs.",
  })
  runSummary(@Param('testRunId') testRunId: string, @UserCtx() ctx: UserContext, @Query('baseline') baseline?: string) {
    if (baseline !== undefined && (baseline.length === 0 || baseline.length > 255)) throw new BadRequestException('baseline must be 1-255 characters');
    return this.loki.runSummary(testRunId, ctx.userId, ctx.roles, baseline);
  }

  // --- panels ----------------------------------------------------------------

  // Declared before any `queries/:id` route so the literal segment wins.
  @Get('queries/panel-titles')
  @ApiOperation({ summary: 'Distinct Loki panel titles in your organizations, plus the starter panels — what a profile SLO on every Loki dashboard can target' })
  listPanelTitles(@UserCtx() ctx: UserContext) {
    return this.loki.listPanelTitles(ctx.userId, ctx.roles);
  }

  @Get('queries')
  listQueries(
    @Query('systemId', ParseUUIDPipe) systemUnderTestId: string,
    @Query('environment') testEnvironment: string,
    @Query('workload') workload: string,
    @UserCtx() ctx: UserContext,
  ) {
    return this.loki.listQueries({ systemUnderTestId, testEnvironment, workload }, ctx.userId, ctx.roles);
  }

  @Post('queries')
  @ApiResponse({ status: 409, description: 'The panel id is taken on that dashboard for this workload (nothing returned)' })
  createQuery(@Body() dto: CreateLokiQueryDto, @UserCtx() ctx: UserContext) {
    return this.loki.createQuery(dto, ctx.userId, ctx.roles);
  }

  @Post('queries/starter')
  @ApiOperation({ summary: 'Create the starter panels (lines by level, error lines by service, log volume by service) for a scope' })
  createStarterQueries(@Body() body: StarterLokiQueriesDto, @UserCtx() ctx: UserContext) {
    return this.loki.createStarterQueries(body, ctx.userId, ctx.roles);
  }

  @Post('queries/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run an unsaved panel over the last N minutes: series, totals, the LogQL sent and the label names' })
  previewQuery(@Body() dto: PreviewLokiQueryDto, @UserCtx() ctx: UserContext) {
    return this.loki.previewQuery(dto, ctx.userId, ctx.roles);
  }

  @Patch('queries/:id')
  @ApiResponse({ status: 409, description: 'The panel id is taken on that dashboard for this workload (nothing returned)' })
  updateQuery(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLokiQueryDto, @UserCtx() ctx: UserContext) {
    return this.loki.updateQuery(id, dto, ctx.userId, ctx.roles);
  }

  @Delete('queries/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteQuery(@Param('id', ParseUUIDPipe) id: string, @UserCtx() ctx: UserContext) {
    return this.loki.deleteQuery(id, ctx.userId, ctx.roles);
  }
}
