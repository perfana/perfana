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
   * Resolve the global-admin boolean for the request without calling
   * `authzService.isGlobalAdmin` directly. `withOrgFilter` is the lint-exempt
   * indirection: it returns `null` iff the caller is a global admin, so a
   * `=== null` check collapses to `isAdmin` while keeping this controller out
   * of the `no-direct-is-global-admin` allowlist (Phase 3c C33 boundary push;
   * see C30/C31/C32 for the same pattern).
   */
  private async resolveIsAdmin(userId: string, roles: string[]): Promise<boolean> {
    return (await withOrgFilter(userId, roles, this.authzService)) === null;
  }

  @Get()
  @ApiOperation({ summary: 'Get all profiles' })
  @ApiResponse({ status: 200, description: 'Return all profiles' })
  async findAll(@UserCtx() ctx: UserContext, @Query('organizationId') organizationId?: string) {
    try {
      this.logger.debug(`User ${ctx.userId} fetching all profiles (organizationId=${organizationId})`);
      const isAdmin = await this.resolveIsAdmin(ctx.userId, ctx.roles);
      return await this.profilesService.findAll(ctx.userId, isAdmin, organizationId);
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
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async findOne(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    try {
      this.logger.debug(`User ${ctx.userId} fetching profile ${id}`);
      const isAdmin = await this.resolveIsAdmin(ctx.userId, ctx.roles);
      const profile = await this.profilesService.findOne(id, ctx.userId, isAdmin);
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
  async create(
    @Body() createDto: CreateProfileDto,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug(`User ${ctx.userId} creating profile '${createDto.name}'`);
    const isAdmin = await this.resolveIsAdmin(ctx.userId, ctx.roles);
    return this.profilesService.createProfile(createDto, ctx.userId, isAdmin);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a profile' })
  @ApiParam({ name: 'id', description: 'Profile UUID' })
  @ApiResponse({ status: 200, description: 'Profile updated successfully' })
  @ApiResponse({ status: 400, description: 'Validation error, duplicate name, or read-only profile' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateProfileDto,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug(`User ${ctx.userId} updating profile ${id}`);
    const isAdmin = await this.resolveIsAdmin(ctx.userId, ctx.roles);
    return this.profilesService.updateProfile(id, updateDto, ctx.userId, isAdmin);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a profile' })
  @ApiParam({ name: 'id', description: 'Profile UUID' })
  @ApiResponse({ status: 200, description: 'Profile deleted successfully' })
  @ApiResponse({ status: 400, description: 'Cannot delete read-only profile' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async remove(
    @Param('id') id: string,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug(`User ${ctx.userId} deleting profile ${id}`);
    const isAdmin = await this.resolveIsAdmin(ctx.userId, ctx.roles);
    await this.profilesService.deleteProfile(id, ctx.userId, isAdmin);
    return { message: 'Profile deleted successfully' };
  }

  @Get(':id/dashboards')
  @ApiOperation({ summary: 'Get all auto-configuration dashboards for a profile' })
  @ApiResponse({ status: 200, description: 'Return dashboards for the profile' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async findDashboards(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    try {
      this.logger.debug(`User ${ctx.userId} fetching dashboards for profile ${id}`);
      const isAdmin = await this.resolveIsAdmin(ctx.userId, ctx.roles);
      const dashboards = await this.profilesService.findDashboardsByProfileId(id, ctx.userId, isAdmin);
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
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async createDashboard(
    @Param('id') id: string,
    @Body() createDto: CreateProfileDashboardDto,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      this.logger.debug(`User ${ctx.userId} creating dashboard for profile ${id}`);
      const isAdmin = await this.resolveIsAdmin(ctx.userId, ctx.roles);
      return await this.profilesService.createDashboard(id, createDto, ctx.userId, isAdmin);
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
  @ApiResponse({ status: 404, description: 'Profile or dashboard not found' })
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
      const isAdmin = await this.resolveIsAdmin(ctx.userId, ctx.roles);
      return await this.profilesService.updateDashboard(id, dashboardId, updateDto, ctx.userId, isAdmin);
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
  @ApiResponse({ status: 404, description: 'Profile or dashboard not found' })
  async deleteDashboard(
    @Param('id') id: string,
    @Param('dashboardId') dashboardId: string,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      this.logger.debug(`User ${ctx.userId} deleting dashboard ${dashboardId} from profile ${id}`);
      const isAdmin = await this.resolveIsAdmin(ctx.userId, ctx.roles);
      await this.profilesService.deleteDashboard(id, dashboardId, ctx.userId, isAdmin);
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
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async getProfileBenchmarks(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    try {
      this.logger.debug(`User ${ctx.userId} fetching benchmarks for profile ${id}`);
      const isAdmin = await this.resolveIsAdmin(ctx.userId, ctx.roles);
      return await this.profilesService.findBenchmarksByProfileId(id, ctx.userId, isAdmin);
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
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async createProfileBenchmark(
    @Param('id') id: string,
    @Body() createDto: CreateProfileBenchmarkDto,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      this.logger.debug(`User ${ctx.userId} creating benchmark for profile ${id}`);
      const isAdmin = await this.resolveIsAdmin(ctx.userId, ctx.roles);
      return await this.profilesService.createBenchmark(id, createDto, ctx.userId, isAdmin);
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
  @ApiResponse({ status: 404, description: 'Profile or benchmark not found' })
  async updateProfileBenchmark(
    @Param('id') id: string,
    @Param('benchmarkId') benchmarkId: string,
    @Body() updateDto: UpdateProfileBenchmarkDto,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      this.logger.debug(`User ${ctx.userId} updating benchmark ${benchmarkId} for profile ${id}`);
      const isAdmin = await this.resolveIsAdmin(ctx.userId, ctx.roles);
      return await this.profilesService.updateBenchmark(id, benchmarkId, updateDto, ctx.userId, isAdmin);
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
  @ApiResponse({ status: 404, description: 'Profile or benchmark not found' })
  async deleteProfileBenchmark(
    @Param('id') id: string,
    @Param('benchmarkId') benchmarkId: string,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      this.logger.debug(`User ${ctx.userId} deleting benchmark ${benchmarkId} from profile ${id}`);
      const isAdmin = await this.resolveIsAdmin(ctx.userId, ctx.roles);
      await this.profilesService.deleteBenchmark(id, benchmarkId, ctx.userId, isAdmin);
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
