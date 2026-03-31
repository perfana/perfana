import { Injectable, Logger, NotFoundException, ForbiddenException, forwardRef, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Team } from '../../entities';
import { AuthorizationService } from '../../common/services/authorization.service';
import { TeamMembersService } from './team-members.service';
import { CreateTeamDto, UpdateTeamDto } from './dto/team.dto';

/**
 * Service responsible for managing teams.
 *
 * Authorization:
 * - All methods accept userId and roles parameters for authorization
 * - AuthorizationService is injected for role-based authorization checks
 * - Global admins can see and manage all teams
 * - Regular users can only see teams belonging to organizations they are members of
 * - Team creation requires org-admin role for new teams
 * - Team updates/deletes require org-admin OR team-admin privileges
 *
 * Note: Teams belong to organizations. Access to teams is determined by:
 * 1. Organization membership (can view)
 * 2. Organization admin role (can create/update/delete)
 * 3. Team admin role (can update/delete their team)
 */
@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  constructor(
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    private readonly authzService: AuthorizationService,
    @Inject(forwardRef(() => TeamMembersService))
    private readonly membersService: TeamMembersService,
  ) {}

  /**
   * Find all teams the user has access to.
   *
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Authorization:
   * - Global admins see all teams
   * - Regular users see only teams in organizations they are members of
   */
  async findAll(
    userId: string = '',
    roles: string[] = [],
  ): Promise<Team[]> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.debug(`findAll: userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // Global admins see all teams
      if (isAdmin) {
        return await this.teamRepository.find({
          relations: ['organization'],
          order: {
            created_at: 'DESC',
          },
        });
      }

      // Regular users see only teams in their organizations
      const accessibleOrgIds = await this.authzService.getAccessibleOrganizations(userId);

      if (accessibleOrgIds.length === 0) {
        this.logger.debug(`User ${userId} has no accessible organizations`);
        return [];
      }

      return await this.teamRepository.find({
        where: { organization_id: In(accessibleOrgIds) },
        relations: ['organization'],
        order: {
          created_at: 'DESC',
        },
      });
    } catch (error) {
      this.logger.error('Failed to fetch teams', error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  /**
   * Find a single team by ID.
   *
   * @param id - The team ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Authorization:
   * - Global admins can access any team
   * - Regular users can only access teams in organizations they are members of
   */
  async findOne(
    id: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<Team> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.debug(`findOne: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      const team = await this.teamRepository.findOne({
        where: { id },
        relations: ['organization'],
      });

      if (!team) {
        throw new NotFoundException(`Team with ID ${id} not found`);
      }

      // Check authorization (global admins can access any team)
      if (!isAdmin) {
        const isMember = await this.authzService.isOrganizationMember(userId, team.organization_id);
        if (!isMember) {
          // Also check team membership as a fallback
          const isTeamMember = await this.authzService.isTeamMember(userId, id);
          if (!isTeamMember) {
            this.logger.warn(`Access denied: User ${userId} is not a member of team ${id} or its organization`);
            throw new ForbiddenException(`You do not have access to team ${id}`);
          }
        }
      }

      return team;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(`Failed to fetch team ${id}`, error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  /**
   * Find all teams for a specific organization.
   *
   * @param organizationId - The organization ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Authorization:
   * - Global admins can access teams in any organization
   * - Regular users can only access teams if they are members of the organization
   */
  async findByOrganization(
    organizationId: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<Team[]> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.debug(`findByOrganization: orgId=${organizationId}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // Check authorization (global admins can access any org's teams)
      if (!isAdmin) {
        const isMember = await this.authzService.isOrganizationMember(userId, organizationId);
        if (!isMember) {
          this.logger.warn(`Access denied: User ${userId} is not a member of organization ${organizationId}`);
          throw new ForbiddenException(`You do not have access to organization ${organizationId}`);
        }
      }

      return await this.teamRepository.find({
        where: { organization_id: organizationId },
        relations: ['organization'],
        order: {
          created_at: 'DESC',
        },
      });
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(`Failed to fetch teams for organization ${organizationId}`, error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  /**
   * Create a new team in an organization.
   *
   * @param createDto - The team creation data
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   *
   * Authorization:
   * - Global admins can create teams in any organization
   * - Regular users must be org admins (org-admin) to create teams
   */
  async create(
    createDto: CreateTeamDto,
    userId: string = '',
    roles: string[] = [],
  ): Promise<Team> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.debug(`create: orgId=${createDto.organization_id}, name=${createDto.name}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // Check authorization - must be global admin or org admin to create teams
      if (!isAdmin) {
        const isOrgAdmin = await this.authzService.isOrganizationAdmin(userId, createDto.organization_id);
        if (!isOrgAdmin) {
          this.logger.warn(`Create denied: User ${userId} is not an admin of organization ${createDto.organization_id}`);
          throw new ForbiddenException(`You do not have permission to create teams in organization ${createDto.organization_id}`);
        }
      }

      const team = this.teamRepository.create(createDto);
      const savedTeam = await this.teamRepository.save(team);

      this.logger.log(`Created team: ${savedTeam.name} (${savedTeam.id}) in org ${createDto.organization_id} by user ${userId}`);

      // Automatically add the creator as team-admin
      if (userId) {
        await this.membersService.addMember({
          teamId: savedTeam.id,
          userId,
          roles: ['team-admin'],
        });
        this.logger.log(`Added user ${userId} as team-admin of team ${savedTeam.id}`);
      }

      return await this.findOne(savedTeam.id, userId, roles);
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Failed to create team', error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  /**
   * Update an existing team.
   *
   * @param id - The team ID
   * @param updateDto - The update data
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Authorization:
   * - Global admins can update any team
   * - Org admins can update teams in their organization
   * - Team admins can update their team
   */
  async update(
    id: string,
    updateDto: UpdateTeamDto,
    userId: string = '',
    roles: string[] = [],
  ): Promise<Team> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.debug(`update: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // First verify the team exists
      const team = await this.teamRepository.findOne({
        where: { id },
        relations: ['organization'],
      });

      if (!team) {
        throw new NotFoundException(`Team with ID ${id} not found`);
      }

      // Check authorization - must be global admin, org admin, or team admin
      if (!isAdmin) {
        const isOrgAdmin = await this.authzService.isOrganizationAdmin(userId, team.organization_id);
        const isTeamAdmin = await this.authzService.isTeamAdmin(userId, id);

        if (!isOrgAdmin && !isTeamAdmin) {
          this.logger.warn(`Update denied: User ${userId} is not an admin of team ${id} or its organization`);
          throw new ForbiddenException(`You do not have permission to update team ${id}`);
        }
      }

      // If organization_id is being changed, verify user has admin access to new org
      if (updateDto.organization_id && updateDto.organization_id !== team.organization_id) {
        if (!isAdmin) {
          const isNewOrgAdmin = await this.authzService.isOrganizationAdmin(userId, updateDto.organization_id);
          if (!isNewOrgAdmin) {
            this.logger.warn(`Update denied: User ${userId} cannot move team to organization ${updateDto.organization_id}`);
            throw new ForbiddenException(`You do not have permission to move team to organization ${updateDto.organization_id}`);
          }
        }
      }

      Object.assign(team, updateDto);
      await this.teamRepository.save(team);

      this.logger.log(`Updated team: ${team.name} (${id}) by user ${userId}`);

      return await this.findOne(id, userId, roles);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(`Failed to update team ${id}`, error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  /**
   * Delete a team.
   *
   * @param id - The team ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Authorization:
   * - Global admins can delete any team
   * - Org admins can delete teams in their organization
   * - Team admins can delete their team
   */
  async remove(
    id: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<void> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.debug(`remove: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // First verify the team exists
      const team = await this.teamRepository.findOne({
        where: { id },
      });

      if (!team) {
        throw new NotFoundException(`Team with ID ${id} not found`);
      }

      // Check authorization - must be global admin, org admin, or team admin
      if (!isAdmin) {
        const isOrgAdmin = await this.authzService.isOrganizationAdmin(userId, team.organization_id);
        const isTeamAdmin = await this.authzService.isTeamAdmin(userId, id);

        if (!isOrgAdmin && !isTeamAdmin) {
          this.logger.warn(`Delete denied: User ${userId} is not an admin of team ${id} or its organization`);
          throw new ForbiddenException(`You do not have permission to delete team ${id}`);
        }
      }

      await this.teamRepository.remove(team);

      this.logger.log(`Deleted team: ${team.name} (${id}) by user ${userId}`);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(`Failed to delete team ${id}`, error instanceof Error ? error.stack : error);
      throw error;
    }
  }
}
