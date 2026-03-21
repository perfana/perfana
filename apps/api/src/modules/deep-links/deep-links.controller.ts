import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { DeepLinksService } from './deep-links.service';
import { TestRunsService } from '../test-runs/test-runs.service';
import { AuthorizationService } from '../../common/services/authorization.service';
import { DeepLink, GenericDeepLink } from '@perfana/shared/entities';
import { ResolvedDeepLink } from './entities/deep-link.entity';
import { CreateDeepLinkDto } from './dto/create-deep-link.dto';
import { UpdateDeepLinkDto } from './dto/update-deep-link.dto';
import { CreateGenericDeepLinkDto } from './dto/create-generic-deep-link.dto';
import { CopyDeepLinksDto } from './dto/copy-deep-links.dto';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';

@ApiTags('Deep Links')
@ApiBearerAuth()
@Controller('deep-links')
export class DeepLinksController {
  constructor(
    private readonly deepLinksService: DeepLinksService,
    private readonly testRunsService: TestRunsService,
    private readonly authzService: AuthorizationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get deep links by system, environment, and workload' })
  @ApiQuery({ name: 'systemUnderTestId', description: 'System under test ID' })
  @ApiQuery({ name: 'testEnvironment', description: 'Test environment name' })
  @ApiQuery({ name: 'workload', description: 'Workload name' })
  @ApiResponse({ status: 200, description: 'Deep links retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getDeepLinks(
    @Query('systemUnderTestId') systemUnderTestId: string,
    @Query('testEnvironment') testEnvironment: string,
    @Query('workload') workload: string,
    @UserCtx() ctx: UserContext,
  ): Promise<DeepLink[]> {
    const organizationIds = await this.authzService.getAccessibleOrganizations(ctx.userId);
    return this.deepLinksService.findBySystemEnvWorkload(
      systemUnderTestId,
      testEnvironment,
      workload,
      ctx.roles,
      organizationIds,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get deep link by ID' })
  @ApiResponse({ status: 200, description: 'Deep link retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Deep link not found' })
  async getDeepLink(
    @Param('id', ParseUUIDPipe) id: string,
    @UserCtx() ctx: UserContext,
  ): Promise<DeepLink> {
    const organizationIds = await this.authzService.getAccessibleOrganizations(ctx.userId);
    return this.deepLinksService.findById(id, ctx.roles, organizationIds);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new deep link' })
  @ApiResponse({ status: 201, description: 'Deep link created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createDeepLink(
    @Body() createDto: CreateDeepLinkDto,
    @UserCtx() ctx: UserContext,
  ): Promise<DeepLink> {
    const isAdmin = this.authzService.isGlobalAdmin(ctx.roles);
    const organizationIds = isAdmin ? [] : await this.authzService.getAccessibleOrganizations(ctx.userId);
    if (!isAdmin && organizationIds.length === 0) {
      throw new BadRequestException(
        'User must belong to an organization to create deep links',
      );
    }

    return this.deepLinksService.create(createDto, ctx.roles, organizationIds);
  }

  @Post('copy')
  @ApiOperation({ summary: 'Copy deep links from one scope to another' })
  @ApiResponse({ status: 201, description: 'Deep links copied successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async copyDeepLinks(
    @Body() dto: CopyDeepLinksDto,
    @UserCtx() ctx: UserContext,
  ): Promise<{ copied: number; skipped: number; total: number }> {
    const isAdmin = this.authzService.isGlobalAdmin(ctx.roles);
    const organizationIds = isAdmin ? [] : await this.authzService.getAccessibleOrganizations(ctx.userId);
    if (!isAdmin && organizationIds.length === 0) {
      throw new BadRequestException('User must belong to an organization to copy deep links');
    }

    return this.deepLinksService.copyToScope(dto, ctx.roles, organizationIds);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update deep link' })
  @ApiResponse({ status: 200, description: 'Deep link updated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Deep link not found' })
  async updateDeepLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateDeepLinkDto,
    @UserCtx() ctx: UserContext,
  ): Promise<DeepLink> {
    const organizationIds = await this.authzService.getAccessibleOrganizations(ctx.userId);
    return this.deepLinksService.update(id, updateDto, ctx.roles, organizationIds);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete deep link' })
  @ApiResponse({ status: 204, description: 'Deep link deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Deep link not found' })
  async deleteDeepLink(
    @Param('id', ParseUUIDPipe) id: string,
    @UserCtx() ctx: UserContext,
  ): Promise<void> {
    const organizationIds = await this.authzService.getAccessibleOrganizations(ctx.userId);
    return this.deepLinksService.delete(id, ctx.roles, organizationIds);
  }

  @Get(':id/resolve')
  @ApiOperation({ summary: 'Resolve deep link variables for a specific test run' })
  @ApiQuery({ name: 'testRunId', description: 'Test run ID for variable resolution' })
  @ApiResponse({ status: 200, description: 'Deep link variables resolved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Deep link or test run not found' })
  async resolveDeepLinkVariables(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<ResolvedDeepLink> {
    const organizationIds = await this.authzService.getAccessibleOrganizations(ctx.userId);
    const deepLink = await this.deepLinksService.findById(id, ctx.roles, organizationIds);

    // Get the test run directly from the database
    const testRun = await this.testRunsService.getTestRunByTestRunId(testRunId, ctx.userId, ctx.roles);
    if (!testRun) {
      throw new NotFoundException(`Test run with ID ${testRunId} not found`);
    }

    return this.deepLinksService.resolveVariables(deepLink, testRun);
  }

  // Generic Deep Links endpoints
  @Get('generic/profile/:profile')
  @ApiOperation({ summary: 'Get generic deep links by profile' })
  @ApiResponse({ status: 200, description: 'Generic deep links retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getGenericDeepLinks(
    @Param('profile') profile: string,
  ): Promise<GenericDeepLink[]> {
    return this.deepLinksService.findGenericByProfile(profile);
  }

  @Post('generic')
  @ApiOperation({ summary: 'Create a new generic deep link template' })
  @ApiResponse({ status: 201, description: 'Generic deep link created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createGenericDeepLink(
    @Body() createDto: CreateGenericDeepLinkDto,
    @UserCtx() ctx: UserContext,
  ): Promise<GenericDeepLink> {
    const isAdmin = this.authzService.isGlobalAdmin(ctx.roles);
    if (!isAdmin) {
      const organizationIds = await this.authzService.getAccessibleOrganizations(ctx.userId);
      if (organizationIds.length === 0) {
        throw new BadRequestException(
          'User must belong to an organization to create generic deep links',
        );
      }
    }

    return this.deepLinksService.createGeneric(createDto);
  }
}