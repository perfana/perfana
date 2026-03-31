import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Logger,
  HttpException,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiProperty,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsArray, IsIn, ArrayNotEmpty } from 'class-validator';
import {
  TeamMembersService,
  AddTeamMemberDto,
} from './team-members.service';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';
import { hasGlobalAdminRole, TeamRole } from '../../constants/roles.constants';

const VALID_TEAM_ROLES = Object.values(TeamRole);

/**
 * DTO for adding a member to a team via the API
 */
class AddMemberRequestDto {
  @ApiProperty({ description: 'User ID (Keycloak sub)', example: 'bd76d483-513b-4276-abed-66d5fca00958' })
  @IsNotEmpty()
  @IsString()
  userId!: string;

  @ApiProperty({ description: 'Roles to assign to the member', example: ['team-member'], enum: VALID_TEAM_ROLES })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsIn(VALID_TEAM_ROLES, { each: true })
  roles!: string[];
}

/**
 * DTO for updating team member roles via the API
 */
class UpdateTeamMemberRolesDto {
  @ApiProperty({ description: 'New roles to assign', example: ['team-admin'], enum: VALID_TEAM_ROLES })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsIn(VALID_TEAM_ROLES, { each: true })
  roles!: string[];
}

@ApiTags('team-members')
@ApiBearerAuth()
@Controller()
export class TeamMembersController {
  private readonly logger = new Logger(TeamMembersController.name);

  constructor(
    private readonly teamMembersService: TeamMembersService,
  ) {}

  /**
   * Check if the current user has admin access to the team
   */
  private async checkTeamAdminAccess(
    teamId: string,
    ctx: UserContext,
  ): Promise<void> {
    // Global admins can access all teams
    if (hasGlobalAdminRole(ctx.roles)) {
      return;
    }

    // Check if user is a team admin
    const isAdmin = await this.teamMembersService.isTeamAdmin(
      teamId,
      ctx.userId,
    );
    if (!isAdmin) {
      throw new ForbiddenException(
        'You do not have admin access to this team',
      );
    }
  }

  /**
   * Check if the current user has member access to the team
   */
  private async checkTeamMemberAccess(
    teamId: string,
    ctx: UserContext,
  ): Promise<void> {
    // Global admins can access all teams
    if (hasGlobalAdminRole(ctx.roles)) {
      return;
    }

    // Check if user is a member
    const isMember = await this.teamMembersService.isMember(
      teamId,
      ctx.userId,
    );
    if (!isMember) {
      throw new ForbiddenException(
        'You do not have access to this team',
      );
    }
  }

  @Get('teams/:teamId/members')
  @ApiOperation({ summary: 'Get all members of a team with user information' })
  @ApiParam({ name: 'teamId', description: 'Team UUID' })
  @ApiResponse({ status: 200, description: 'Return all team members with enriched user data from Keycloak' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Team not found' })
  async findByTeam(
    @Param('teamId') teamId: string,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      this.logger.debug(
        `User ${ctx.userId} fetching members for team ${teamId}`,
      );

      // Check if user has access to this team
      await this.checkTeamMemberAccess(teamId, ctx);

      return await this.teamMembersService.findByTeamWithUserInfo(teamId);
    } catch (error) {
      this.logger.error('Failed to fetch team members:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to fetch team members',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('users/me/teams')
  @ApiOperation({ summary: 'Get all teams the current user belongs to' })
  @ApiResponse({ status: 200, description: 'Return all memberships for the current user' })
  async findMyTeams(@UserCtx() ctx: UserContext) {
    try {
      this.logger.debug(`User ${ctx.userId} fetching their team memberships`);
      return await this.teamMembersService.findByUser(ctx.userId);
    } catch (error) {
      this.logger.error('Failed to fetch user team memberships:', error);
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to fetch team memberships',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('teams/:teamId/members')
  @ApiOperation({ summary: 'Add a member to a team' })
  @ApiParam({ name: 'teamId', description: 'Team UUID' })
  @ApiBody({ type: AddMemberRequestDto })
  @ApiResponse({ status: 201, description: 'Member added successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Team not found' })
  @ApiResponse({ status: 409, description: 'Member already exists' })
  async addMember(
    @Param('teamId') teamId: string,
    @Body() body: AddMemberRequestDto,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      this.logger.debug(
        `User ${ctx.userId} adding member ${body.userId} to team ${teamId}`,
      );

      // Only team admins can add members
      await this.checkTeamAdminAccess(teamId, ctx);

      const dto: AddTeamMemberDto = {
        teamId,
        userId: body.userId,
        roles: body.roles,
      };
      return await this.teamMembersService.addMember(dto);
    } catch (error) {
      this.logger.error('Failed to add team member:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to add team member',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('team-members/:id')
  @ApiOperation({ summary: 'Get a single team membership by ID' })
  @ApiParam({ name: 'id', description: 'Team membership UUID' })
  @ApiResponse({ status: 200, description: 'Return the membership' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Membership not found' })
  async findOne(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    try {
      this.logger.debug(
        `User ${ctx.userId} fetching team membership ${id}`,
      );

      const member = await this.teamMembersService.findOne(id);

      // Check if user has access to this team
      await this.checkTeamMemberAccess(member.team_id, ctx);

      return member;
    } catch (error) {
      this.logger.error('Failed to fetch team membership:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to fetch team membership',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put('team-members/:id/roles')
  @ApiOperation({ summary: 'Update the roles of a team member' })
  @ApiParam({ name: 'id', description: 'Team membership UUID' })
  @ApiResponse({ status: 200, description: 'Roles updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Membership not found' })
  async updateRoles(
    @Param('id') id: string,
    @Body() dto: UpdateTeamMemberRolesDto,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      this.logger.debug(
        `User ${ctx.userId} updating roles for team membership ${id}`,
      );

      // Get the membership first to check team access
      const existingMember = await this.teamMembersService.findOne(id);

      // Only team admins can update member roles
      await this.checkTeamAdminAccess(existingMember.team_id, ctx);

      return await this.teamMembersService.updateMemberRoles(id, dto);
    } catch (error) {
      this.logger.error('Failed to update team member roles:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to update team member roles',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete('team-members/:id')
  @ApiOperation({ summary: 'Remove a member from a team by membership ID' })
  @ApiParam({ name: 'id', description: 'Team membership UUID' })
  @ApiResponse({ status: 200, description: 'Member removed successfully' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Membership not found' })
  async removeMember(@Param('id') id: string, @UserCtx() ctx: UserContext) {
    try {
      this.logger.debug(
        `User ${ctx.userId} removing team membership ${id}`,
      );

      // Get the membership first to check team access
      const existingMember = await this.teamMembersService.findOne(id);

      // Only team admins can remove members
      await this.checkTeamAdminAccess(existingMember.team_id, ctx);

      await this.teamMembersService.removeMember(id);
      return { message: 'Member removed successfully' };
    } catch (error) {
      this.logger.error('Failed to remove team member:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to remove team member',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete('teams/:teamId/members/:userId')
  @ApiOperation({ summary: 'Remove a member from a team by user ID' })
  @ApiParam({ name: 'teamId', description: 'Team UUID' })
  @ApiParam({ name: 'userId', description: 'User ID (Keycloak sub or api-key:{id})' })
  @ApiResponse({ status: 200, description: 'Member removed successfully' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Membership not found' })
  async removeMemberByUser(
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
    @UserCtx() ctx: UserContext,
  ) {
    try {
      this.logger.debug(
        `User ${ctx.userId} removing user ${userId} from team ${teamId}`,
      );

      // Only team admins can remove members
      await this.checkTeamAdminAccess(teamId, ctx);

      await this.teamMembersService.removeMemberByTeamAndUser(
        teamId,
        userId,
      );
      return { message: 'Member removed successfully' };
    } catch (error) {
      this.logger.error('Failed to remove team member:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to remove team member',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
