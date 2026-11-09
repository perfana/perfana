import { Controller, Get, Post, Put, Delete, Param, Body, Query, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { ProfilesService } from './profiles.service';
import { CreateProfileDto, UpdateProfileDto } from './dto/profile.dto';
import { CreateProfileDashboardDto, UpdateProfileDashboardDto } from './dto/profile-dashboard.dto';
import { CreateProfileBenchmarkDto, UpdateProfileBenchmarkDto } from './dto/profile-benchmark.dto';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';

@ApiTags('profiles')
@ApiBearerAuth()
@Controller('profiles')
export class ProfilesController {
  private readonly logger = new Logger(ProfilesController.name);

  constructor(
    private readonly profilesService: ProfilesService,
    private readonly authzService: AuthorizationService,
  ) {}

  /**
   * The caller's organizations, resolved once per request: `null` for a global admin, else
   * the (possibly empty) list of organizations they belong to. Every by-id service method
   * takes it as a REQUIRED parameter and scopes the profile to it, because there is no RLS
   * backstop on a default deploy. `withOrgFilter` is also the lint-exempt indirection that
   * keeps this controller out of the `no-direct-is-global-admin` allowlist (Phase 3c C33).
   */
  private resolveOrgScope(ctx: UserContext): Promise<string[] | null> {
    return withOrgFilter(ctx.userId, ctx.roles, this.authzService);
  }

  @Get()
  @ApiOperation({ summary: 'Get all profiles' })
  @ApiResponse({ status: 200, description: 'Return all profiles' })
  async findAll(@UserCtx() ctx: UserContext, @Query('organizationId') organizationId?: string) {
    try {
      this.logger.debug(`User ${ctx.userId} fetching all profiles (organizationId=${organizationId})`);
      const accessibleOrgIds = await this.resolveOrgScope(ctx);
      // An explicit ?organizationId= narrows the caller's own organizations, never widens
      // them: naming an organization the caller does not belong to lists nothing, rather than
      // that organization's profiles. A global admin may name any organization.
      let organizationIds = accessibleOrgIds;
      if (organizationId) {
        organizationIds = accessibleOrgIds === null || accessibleOrgIds.includes(organizationId)
          ? [organizationId]
          : [];
        if (organizationIds.length === 0) {
          this.logger.warn(
            `Profile list for organization ${organizationId.replace(/[\r\n]/g, '')} refused for user ${ctx.userId}: not a member`,
          );
        }
      }
      return await this.profilesService.findAll(organizationIds);
    } catch (error) {
      this.logger.error('Failed to fetch profiles:', error);
      throw new HttpException(
        'Failed to fetch profiles',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single profile by ID' })
  @ApiResponse({ status: 200, description: 'Return the profile' })
  @ApiResponse({ status: 404, description: 'Profile not found, or in an organization the caller does not belong to' })
  async findOne(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    try {
      this.logger.debug(`User ${ctx.userId} fetching profile ${id}`);
      const accessibleOrgIds = await this.resolveOrgScope(ctx);
      const profile = await this.profilesService.findOne(id, ctx.userId, accessibleOrgIds);
      if (!profile) {
        throw new HttpException('Profile not found', HttpStatus.NOT_FOUND);
      }
      return profile;
    } catch (error) {
      this.logger.error('Failed to fetch profile:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to fetch profile',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create a new profile' })
  @ApiResponse({ status: 201, description: 'Profile created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error or duplicate name' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: "Not an org-admin in any of the caller's organizations" })
  async create(
    @Body() createDto: CreateProfileDto,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug(`User ${ctx.userId} creating profile '${createDto.name}'`);
    const accessibleOrgIds = await this.resolveOrgScope(ctx);
    return this.profilesService.createProfile(createDto, ctx.userId, accessibleOrgIds);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a profile' })
  @ApiParam({ name: 'id', description: 'Profile UUID' })
  @ApiResponse({ status: 200, description: 'Profile updated successfully' })
  @ApiResponse({ status: 400, description: 'Validation error, duplicate name, or read-only profile' })
  @ApiResponse({ status: 404, description: 'Profile not found, or in an organization the caller does not belong to' })
  @ApiResponse({ status: 403, description: "Not an org-admin in the profile's organization" })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateProfileDto,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug(`User ${ctx.userId} updating profile ${id}`);
    const accessibleOrgIds = await this.resolveOrgScope(ctx);
    return this.profilesService.updateProfile(id, updateDto, ctx.userId, accessibleOrgIds);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a profile' })
  @ApiParam({ name: 'id', description: 'Profile UUID' })
  @ApiResponse({ status: 200, description: 'Profile deleted successfully' })
  @ApiResponse({ status: 400, description: 'Cannot delete read-only profile' })
  @ApiResponse({ status: 404, description: 'Profile not found, or in an organization the caller does not belong to' })
  @ApiResponse({ status: 403, description: "Not an org-admin in the profile's organization" })
  async remove(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug(`User ${ctx.userId} deleting profile ${id}`);
    const accessibleOrgIds = await this.resolveOrgScope(ctx);
    await this.profilesService.deleteProfile(id, ctx.userId, accessibleOrgIds);
    return { message: 'Profile deleted successfully' };
  }

  @Get(':id/dashboards')
  @ApiOperation({ summary: 'Get all auto-configuration dashboards for a profile' })
  @ApiResponse({ status: 200, description: 'Return dashboards for the profile' })
  @ApiResponse({ status: 404, description: 'Profile not found, or in an organization the caller does not belong to' })
  async findDashboards(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    try {
      this.logger.debug(`User ${ctx.userId} fetching dashboards for profile ${id}`);
      const accessibleOrgIds = await this.resolveOrgScope(ctx);
      const dashboards = await this.profilesService.findDashboardsByProfileId(id, ctx.userId, accessibleOrgIds);
      return dashboards;
    } catch (error) {
      this.logger.error('Failed to fetch profile dashboards:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to fetch profile dashboards',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':id/dashboards')
  @ApiOperation({ summary: 'Create a new dashboard association for a profile' })
  @ApiParam({ name: 'id', description: 'Profile UUID' })
  @ApiResponse({ status: 201, description: 'Dashboard association created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 404, description: 'Profile not found, or in an organization the caller does not belong to' })
  @ApiResponse({ status: 403, description: "Not an org-admin in the profile's organization" })
  async createDashboard(
    @Param('id') id: string,
    @Body() createDto: CreateProfileDashboardDto,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      this.logger.debug(`User ${ctx.userId} creating dashboard for profile ${id}`);
      const accessibleOrgIds = await this.resolveOrgScope(ctx);
      return await this.profilesService.createDashboard(id, createDto, ctx.userId, accessibleOrgIds);
    } catch (error) {
      this.logger.error('Failed to create profile dashboard:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to create profile dashboard',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Put(':id/dashboards/:dashboardId')
  @ApiOperation({ summary: 'Update a dashboard association for a profile' })
  @ApiParam({ name: 'id', description: 'Profile UUID' })
  @ApiParam({ name: 'dashboardId', description: 'Dashboard association UUID' })
  @ApiResponse({ status: 200, description: 'Dashboard association updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 404, description: 'Profile or dashboard not found, or in an organization the caller does not belong to' })
  @ApiResponse({ status: 403, description: "Not an org-admin in the profile's organization" })
  async updateDashboard(
    @Param('id') id: string,
    @Param('dashboardId') dashboardId: string,
    @Body() updateDto: UpdateProfileDashboardDto,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      this.logger.debug(`User ${ctx.userId} updating dashboard ${dashboardId} for profile ${id}`);
      this.logger.debug(`[Controller] Received updateDto: ${JSON.stringify(updateDto, null, 2)}`);
      this.logger.debug(`[Controller] setHardcodedValueForVariables type: ${Array.isArray(updateDto.setHardcodedValueForVariables) ? 'array' : typeof updateDto.setHardcodedValueForVariables}`);
      this.logger.debug(`[Controller] setHardcodedValueForVariables value: ${JSON.stringify(updateDto.setHardcodedValueForVariables)}`);
      const accessibleOrgIds = await this.resolveOrgScope(ctx);
      return await this.profilesService.updateDashboard(id, dashboardId, updateDto, ctx.userId, accessibleOrgIds);
    } catch (error) {
      this.logger.error('Failed to update profile dashboard:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to update profile dashboard',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(':id/dashboards/:dashboardId')
  @ApiOperation({ summary: 'Delete a dashboard association from a profile' })
  @ApiParam({ name: 'id', description: 'Profile UUID' })
  @ApiParam({ name: 'dashboardId', description: 'Dashboard association UUID' })
  @ApiResponse({ status: 200, description: 'Dashboard association deleted successfully' })
  @ApiResponse({ status: 404, description: 'Profile or dashboard not found, or in an organization the caller does not belong to' })
  @ApiResponse({ status: 403, description: "Not an org-admin in the profile's organization" })
  async deleteDashboard(
    @Param('id') id: string,
    @Param('dashboardId') dashboardId: string,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      this.logger.debug(`User ${ctx.userId} deleting dashboard ${dashboardId} from profile ${id}`);
      const accessibleOrgIds = await this.resolveOrgScope(ctx);
      await this.profilesService.deleteDashboard(id, dashboardId, ctx.userId, accessibleOrgIds);
      return { message: 'Dashboard association deleted successfully' };
    } catch (error) {
      this.logger.error('Failed to delete profile dashboard:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to delete profile dashboard',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id/benchmarks')
  @ApiOperation({ summary: 'Get all benchmarks for a profile' })
  @ApiParam({ name: 'id', description: 'Profile UUID' })
  @ApiResponse({ status: 200, description: 'Return benchmarks for the profile' })
  @ApiResponse({ status: 404, description: 'Profile not found, or in an organization the caller does not belong to' })
  async getProfileBenchmarks(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    try {
      this.logger.debug(`User ${ctx.userId} fetching benchmarks for profile ${id}`);
      const accessibleOrgIds = await this.resolveOrgScope(ctx);
      return await this.profilesService.findBenchmarksByProfileId(id, ctx.userId, accessibleOrgIds);
    } catch (error) {
      this.logger.error('Failed to fetch profile benchmarks:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to fetch profile benchmarks',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':id/benchmarks')
  @ApiOperation({ summary: 'Create a new benchmark for a profile' })
  @ApiParam({ name: 'id', description: 'Profile UUID' })
  @ApiResponse({ status: 201, description: 'Benchmark created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 404, description: 'Profile not found, or in an organization the caller does not belong to' })
  @ApiResponse({ status: 403, description: "Not an org-admin in the profile's organization" })
  async createProfileBenchmark(
    @Param('id') id: string,
    @Body() createDto: CreateProfileBenchmarkDto,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      this.logger.debug(`User ${ctx.userId} creating benchmark for profile ${id}`);
      const accessibleOrgIds = await this.resolveOrgScope(ctx);
      return await this.profilesService.createBenchmark(id, createDto, ctx.userId, accessibleOrgIds);
    } catch (error) {
      this.logger.error('Failed to create profile benchmark:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to create profile benchmark',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Put(':id/benchmarks/:benchmarkId')
  @ApiOperation({ summary: 'Update a profile benchmark' })
  @ApiParam({ name: 'id', description: 'Profile UUID' })
  @ApiParam({ name: 'benchmarkId', description: 'Benchmark UUID' })
  @ApiResponse({ status: 200, description: 'Benchmark updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 404, description: 'Profile or benchmark not found, or in an organization the caller does not belong to' })
  @ApiResponse({ status: 403, description: "Not an org-admin in the profile's organization" })
  async updateProfileBenchmark(
    @Param('id') id: string,
    @Param('benchmarkId') benchmarkId: string,
    @Body() updateDto: UpdateProfileBenchmarkDto,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      this.logger.debug(`User ${ctx.userId} updating benchmark ${benchmarkId} for profile ${id}`);
      const accessibleOrgIds = await this.resolveOrgScope(ctx);
      return await this.profilesService.updateBenchmark(id, benchmarkId, updateDto, ctx.userId, accessibleOrgIds);
    } catch (error) {
      this.logger.error('Failed to update profile benchmark:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to update profile benchmark',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(':id/benchmarks/:benchmarkId')
  @ApiOperation({ summary: 'Delete a profile benchmark' })
  @ApiParam({ name: 'id', description: 'Profile UUID' })
  @ApiParam({ name: 'benchmarkId', description: 'Benchmark UUID' })
  @ApiResponse({ status: 200, description: 'Benchmark deleted successfully' })
  @ApiResponse({ status: 404, description: 'Profile or benchmark not found, or in an organization the caller does not belong to' })
  @ApiResponse({ status: 403, description: "Not an org-admin in the profile's organization" })
  async deleteProfileBenchmark(
    @Param('id') id: string,
    @Param('benchmarkId') benchmarkId: string,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      this.logger.debug(`User ${ctx.userId} deleting benchmark ${benchmarkId} from profile ${id}`);
      const accessibleOrgIds = await this.resolveOrgScope(ctx);
      await this.profilesService.deleteBenchmark(id, benchmarkId, ctx.userId, accessibleOrgIds);
      return { message: 'Benchmark deleted successfully' };
    } catch (error) {
      this.logger.error('Failed to delete profile benchmark:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to delete profile benchmark',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
