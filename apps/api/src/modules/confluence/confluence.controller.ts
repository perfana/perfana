import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';
import { ConfluenceService } from './confluence.service';
import {
  CreateConfluenceConfigDto,
  PublishReportToConfluenceDto,
  TestConfluenceConnectionDto,
  UpdateConfluenceConfigDto,
} from './dto/confluence.dto';

@ApiTags('confluence')
@ApiBearerAuth()
@Controller('confluence')
export class ConfluenceController {
  constructor(private readonly confluence: ConfluenceService) {}

  @Get('configs')
  @ApiOperation({ summary: 'List Confluence connections in your organizations (token masked)' })
  @ApiQuery({ name: 'organizationId', required: false, description: 'Only connections of this organization (a report can only use its own)' })
  listConfigs(@UserCtx() ctx: UserContext, @Query('organizationId') organizationId?: string) {
    return this.confluence.listConfigs(ctx.userId, ctx.roles, organizationId || undefined);
  }

  @Post('configs')
  @ApiOperation({ summary: 'Create a Confluence connection' })
  @ApiResponse({ status: 403, description: 'Missing integration:confluence:create in the target organization' })
  createConfig(@Body() dto: CreateConfluenceConfigDto, @UserCtx() ctx: UserContext) {
    return this.confluence.createConfig(dto, ctx.userId, ctx.roles);
  }

  @Post('configs/test-connection')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Test unsaved Confluence settings (looks up the space)' })
  testConnection(@Body() dto: TestConfluenceConnectionDto, @UserCtx() ctx: UserContext) {
    return this.confluence.testConnection(dto, ctx.userId, ctx.roles);
  }

  @Get('configs/:id')
  getConfig(@Param('id', ParseUUIDPipe) id: string, @UserCtx() ctx: UserContext) {
    return this.confluence.getConfig(id, ctx.userId, ctx.roles);
  }

  @Patch('configs/:id')
  @ApiOperation({ summary: 'Update a Confluence connection. A token sent back as [MASKED] is left unchanged.' })
  updateConfig(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateConfluenceConfigDto, @UserCtx() ctx: UserContext) {
    return this.confluence.updateConfig(id, dto, ctx.userId, ctx.roles);
  }

  @Delete('configs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a Confluence connection. Pages already published stay in Confluence.' })
  deleteConfig(@Param('id', ParseUUIDPipe) id: string, @UserCtx() ctx: UserContext) {
    return this.confluence.deleteConfig(id, ctx.userId, ctx.roles);
  }

  @Post('configs/:id/test-connection')
  @HttpCode(HttpStatus.OK)
  testSavedConnection(@Param('id', ParseUUIDPipe) id: string, @UserCtx() ctx: UserContext) {
    return this.confluence.testSavedConnection(id, ctx.userId, ctx.roles);
  }

  @Post('reports/:reportId/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Publish a generated report to Confluence',
    description: 'Creates a page in the connection\'s space, or updates the page this report was published to before. Charts are attached as PNG images.',
  })
  @ApiResponse({ status: 400, description: 'Confluence refused the page (the reason is in the message), or the connection belongs to another organization' })
  @ApiResponse({ status: 403, description: 'Caller may not change sharing for this report (needs test-run:update)' })
  @ApiResponse({ status: 409, description: 'The report has no HTML yet' })
  @ApiResponse({ status: 503, description: 'perfana-report did not render the charts' })
  publish(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Body() dto: PublishReportToConfluenceDto,
    @UserCtx() ctx: UserContext,
  ) {
    return this.confluence.publishReport(reportId, dto, ctx.userId, ctx.roles, process.env.APP_URL || 'http://localhost:4000');
  }
}
