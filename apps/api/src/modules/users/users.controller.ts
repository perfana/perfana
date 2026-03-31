import { Controller, Get, Query, Logger, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { KeycloakAdminService, KeycloakUserInfo } from '../auth/keycloak-admin.service';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';
import { AuthorizationService } from '../../common/services/authorization.service';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@ApiTags('users')
@Controller('users')
@ApiBearerAuth()
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(
    private readonly keycloakAdminService: KeycloakAdminService,
    private readonly authorizationService: AuthorizationService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Get('search')
  @ApiOperation({
    summary: 'Search for users in Keycloak',
    description: 'Search for users by email, username, or name. Returns user information for adding to organizations/teams.',
  })
  @ApiQuery({ name: 'q', required: false, description: 'Search query (searches username, email, first/last name)' })
  @ApiQuery({ name: 'email', required: false, description: 'Exact email match' })
  @ApiQuery({ name: 'username', required: false, description: 'Exact username match' })
  @ApiQuery({ name: 'limit', required: false, description: 'Maximum number of results (default 20, max 100)' })
  @ApiResponse({
    status: 200,
    description: 'Returns list of users matching search criteria',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Keycloak user ID (sub claim)' },
          username: { type: 'string' },
          email: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          displayName: { type: 'string', description: 'Full name or email if no name available' },
          enabled: { type: 'boolean' },
          emailVerified: { type: 'boolean' },
        },
      },
    },
  })
  async searchUsers(
    @UserCtx() ctx: UserContext,
    @Query('q') search?: string,
    @Query('email') email?: string,
    @Query('username') username?: string,
    @Query('limit') limit?: string,
  ): Promise<(KeycloakUserInfo & { displayName: string })[]> {
    // Restrict to global admins or org admins (used for adding members to orgs/teams)
    if (!this.authorizationService.isGlobalAdmin(ctx.roles)) {
      const isOrgAdmin = await this.authorizationService.isOrgAdminInAnyOrganization(ctx.userId);
      if (!isOrgAdmin) {
        throw new ForbiddenException('User search requires organization admin or global admin privileges');
      }
    }

    this.logger.debug(`Searching users: search="${search}", email="${email}", username="${username}"`);

    const maxResults = Math.min(parseInt(limit || '20', 10), 100);

    const users = await this.keycloakAdminService.searchUsers({
      search,
      email,
      username,
      first: 0,
      max: maxResults,
    });

    // Add displayName for human-readable UI display
    return users.map((user) => ({
      ...user,
      displayName: this.getDisplayName(user),
    }));
  }

  @Get('me/context')
  @ApiOperation({
    summary: 'Get current user context',
    description: 'Returns the current user\'s context including organization and team memberships. Used for organization switcher UI.',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns current user context',
    schema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID (Keycloak sub)' },
        email: { type: 'string', description: 'User email' },
        currentOrganizationId: { type: 'string', description: 'Currently selected organization ID', nullable: true },
        currentTeamId: { type: 'string', description: 'Currently selected team ID', nullable: true },
        organizations: {
          type: 'array',
          description: 'Organizations the user is a member of',
          items: {
            type: 'object',
            properties: {
              organizationId: { type: 'string' },
              name: { type: 'string' },
              roles: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        teams: {
          type: 'array',
          description: 'Teams the user is a member of',
          items: {
            type: 'object',
            properties: {
              teamId: { type: 'string' },
              name: { type: 'string' },
              roles: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        requiresOrganizationSelection: {
          type: 'boolean',
          description: 'True if user belongs to multiple organizations and should be prompted to select one'
        },
      },
    },
  })
  async getCurrentUserContext(@UserCtx() ctx: UserContext): Promise<any> {
    try {
      // Get detailed organization memberships with names and roles
      const orgMemberships = await this.dataSource.query(
        `SELECT om.organization_id, om.roles, o.name
         FROM organization_members om
         JOIN organizations o ON om.organization_id = o.id
         WHERE om.user_id = $1
         ORDER BY om.joined_at DESC`,
        [ctx.userId]
      );

      // Get detailed team memberships with names and roles
      const teamMemberships = await this.dataSource.query(
        `SELECT tm.team_id, tm.roles, t.name
         FROM team_members tm
         JOIN teams t ON tm.team_id = t.id
         WHERE tm.user_id = $1
         ORDER BY tm.joined_at DESC`,
        [ctx.userId]
      );

      return {
        userId: ctx.userId,
        email: ctx.email,
        currentOrganizationId: ctx.organizationId,
        currentTeamId: ctx.teamId,
        organizations: orgMemberships.map((om: any) => ({
          organizationId: om.organization_id,
          name: om.name,
          roles: om.roles || [],
        })),
        teams: teamMemberships.map((tm: any) => ({
          teamId: tm.team_id,
          name: tm.name,
          roles: tm.roles || [],
        })),
        requiresOrganizationSelection: orgMemberships.length > 1 && !ctx.organizationId,
      };
    } catch (error) {
      this.logger.error('Failed to get user context:', error);
      throw error;
    }
  }

  /**
   * Get a human-readable display name for a user
   */
  private getDisplayName(user: KeycloakUserInfo): string {
    if (user.firstName && user.lastName) {
      return `${user.firstName} ${user.lastName}`;
    }
    if (user.firstName) {
      return user.firstName;
    }
    if (user.lastName) {
      return user.lastName;
    }
    if (user.email) {
      return user.email;
    }
    return user.username;
  }
}
