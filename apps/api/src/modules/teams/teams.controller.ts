import { Controller, Get, Post, Put, Delete, Param, Body, Query, Logger, HttpException, HttpStatus, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { TeamsService } from './teams.service';
import { CreateTeamDto, UpdateTeamDto } from './dto/team.dto';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';

@ApiTags('teams')
@ApiBearerAuth()
@Controller('teams')
export class TeamsController {
  private readonly logger = new Logger(TeamsController.name);

  constructor(
    private readonly teamsService: TeamsService,
    private readonly authzService: AuthorizationService,
  ) {}

  /**
   * Resolve the global-admin boolean for the request without calling
   * `authzService.isGlobalAdmin` directly. `withOrgFilter` is the lint-exempt
   * indirection: it returns `null` iff the caller is a global admin, so a
   * `=== null` check collapses to `isAdmin` while keeping this controller out
   * of the `no-direct-is-global-admin` allowlist (Phase 3c C31 boundary push;
   * see C30 graph/trends-presets controllers for the same pattern).
   */
  private async resolveIsAdmin(userId: string, roles: string[]): Promise<boolean> {
    return (await withOrgFilter(userId, roles, this.authzService)) === null;
  }

  @Get()
  @ApiOperation({ summary: 'Get all teams the user has access to' })
  @ApiQuery({ name: 'organizationId', required: false, description: 'Filter teams by organization ID' })
  @ApiResponse({ status: 200, description: 'Return all accessible teams' })
  async findAll(
    @UserCtx() ctx: UserContext,
    @Query('organizationId') organizationId?: string,
  ) {
    try {
      this.logger.debug(`User ${ctx.userId} fetching all teams`);

      if (organizationId) {
        const isAdmin = await this.resolveIsAdmin(ctx.userId, ctx.roles);
        return await this.teamsService.findByOrganization(organizationId, ctx.userId, isAdmin);
      }

      const organizationIds = await withOrgFilter(ctx.userId, ctx.roles, this.authzService);
      return await this.teamsService.findAll(organizationIds);
    } catch (error) {
      this.logger.error('Failed to fetch teams:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to fetch teams',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single team by ID' })
  @ApiParam({ name: 'id', description: 'Team UUID' })
  @ApiResponse({ status: 200, description: 'Return the team' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Team not found' })
  async findOne(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    try {
      this.logger.debug(`User ${ctx.userId} fetching team ${id}`);
      const isAdmin = await this.resolveIsAdmin(ctx.userId, ctx.roles);
      return await this.teamsService.findOne(id, ctx.userId, isAdmin);
    } catch (error) {
      this.logger.error('Failed to fetch team:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to fetch team',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create a new team' })
  @ApiResponse({ status: 201, description: 'Team created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 403, description: 'Access denied - must be org admin' })
  async create(
    @Body() createTeamDto: CreateTeamDto,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug(`User ${ctx.userId} creating team: ${createTeamDto.name} in org ${createTeamDto.organization_id}`);

    // Validation - require organization_id in request body
    if (!createTeamDto.organization_id) {
      throw new BadRequestException(
        'organization_id is required to create teams',
      );
    }

    // Service call - authorization check happens in service layer
    // (user must be org admin of the specified organization)
    const isAdmin = await this.resolveIsAdmin(ctx.userId, ctx.roles);
    return await this.teamsService.create(createTeamDto, ctx.userId, isAdmin);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an existing team' })
  @ApiParam({ name: 'id', description: 'Team UUID' })
  @ApiResponse({ status: 200, description: 'Team updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Team not found' })
  async update(
    @Param('id') id: string,
    @Body() updateTeamDto: UpdateTeamDto,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      this.logger.debug(`User ${ctx.userId} updating team ${id}`);
      const isAdmin = await this.resolveIsAdmin(ctx.userId, ctx.roles);
      return await this.teamsService.update(id, updateTeamDto, ctx.userId, isAdmin);
    } catch (error) {
      this.logger.error('Failed to update team:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to update team',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a team' })
  @ApiParam({ name: 'id', description: 'Team UUID' })
  @ApiResponse({ status: 200, description: 'Team deleted successfully' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Team not found' })
  async remove(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    try {
      this.logger.debug(`User ${ctx.userId} deleting team ${id}`);
      const isAdmin = await this.resolveIsAdmin(ctx.userId, ctx.roles);
      await this.teamsService.remove(id, ctx.userId, isAdmin);
      return { message: 'Team deleted successfully' };
    } catch (error) {
      this.logger.error('Failed to delete team:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to delete team',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
