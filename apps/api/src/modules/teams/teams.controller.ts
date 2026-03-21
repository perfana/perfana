import { Controller, Get, Post, Put, Delete, Param, Body, Query, Logger, HttpException, HttpStatus, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { TeamsService, CreateTeamDto, UpdateTeamDto } from './teams.service';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';

@ApiTags('teams')
@Controller('teams')
export class TeamsController {
  private readonly logger = new Logger(TeamsController.name);

  constructor(private readonly teamsService: TeamsService) {}

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
        return await this.teamsService.findByOrganization(organizationId, ctx.userId, ctx.roles);
      }

      return await this.teamsService.findAll(ctx.userId, ctx.roles);
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
      return await this.teamsService.findOne(id, ctx.userId, ctx.roles);
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
    return await this.teamsService.create(createTeamDto, ctx.userId, ctx.roles);
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
      return await this.teamsService.update(id, updateTeamDto, ctx.userId, ctx.roles);
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
      await this.teamsService.remove(id, ctx.userId, ctx.roles);
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
