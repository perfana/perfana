import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Team, TeamMember, OwnedResource } from '../../entities';
import { TeamRole } from '../../constants/roles.constants';
import { KeycloakAdminService } from '../auth/keycloak-admin.service';
import { AuthorizationService } from '../../common/services/authorization.service';
import { AuditService } from '../audit/audit.service';
import { fetchUserInfoMap, UserInfo } from '../../common/utils/user-enrichment';

export interface AddTeamMemberDto {
  teamId: string;
  userId: string;
  roles: string[];
}

export interface UpdateTeamMemberRolesDto {
  roles: string[];
}

export interface EnrichedTeamMember extends TeamMember {
  userInfo?: UserInfo;
}

@Injectable()
export class TeamMembersService {
  private readonly logger = new Logger(TeamMembersService.name);

  constructor(
    @InjectRepository(TeamMember)
    private readonly memberRepository: Repository<TeamMember>,
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    private readonly keycloakAdminService: KeycloakAdminService,
    private readonly authorizationService: AuthorizationService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Find all members of a team
   */
  async findByTeam(teamId: string): Promise<TeamMember[]> {
    try {
      return await this.memberRepository.find({
        where: { team_id: teamId },
        relations: ['team'],
        order: {
          created_at: 'DESC',
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to fetch members for team ${teamId}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Find all members of a team with enriched user info from Keycloak
   */
  async findByTeamWithUserInfo(teamId: string): Promise<EnrichedTeamMember[]> {
    try {
      const members = await this.findByTeam(teamId);
      return await this.enrichMembersWithUserInfo(members);
    } catch (error) {
      this.logger.error(
        `Failed to fetch enriched members for team ${teamId}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Enrich team members with user information from Keycloak
   */
  private async enrichMembersWithUserInfo(
    members: TeamMember[],
  ): Promise<EnrichedTeamMember[]> {
    const userIds = [...new Set(members.map(m => m.user_id))];
    const userInfoMap = await fetchUserInfoMap(userIds, this.keycloakAdminService, this.logger);

    return members.map(member => ({
      ...member,
      userInfo: userInfoMap.get(member.user_id),
    }));
  }

  /**
   * Find all teams a user belongs to
   */
  async findByUser(userId: string): Promise<TeamMember[]> {
    try {
      return await this.memberRepository.find({
        where: { user_id: userId },
        relations: ['team'],
        order: {
          created_at: 'DESC',
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to fetch memberships for user ${userId}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Find a specific membership by ID
   */
  async findOne(id: string): Promise<TeamMember> {
    try {
      const member = await this.memberRepository.findOne({
        where: { id },
        relations: ['team'],
      });

      if (!member) {
        throw new NotFoundException(`Team membership with ID ${id} not found`);
      }

      return member;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to fetch team membership ${id}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Find membership by team and user
   */
  async findByTeamAndUser(
    teamId: string,
    userId: string,
  ): Promise<TeamMember | null> {
    try {
      return await this.memberRepository.findOne({
        where: {
          team_id: teamId,
          user_id: userId,
        },
        relations: ['team'],
      });
    } catch (error) {
      this.logger.error(
        `Failed to fetch membership for user ${userId} in team ${teamId}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Add a user as a member of a team
   */
  async addMember(dto: AddTeamMemberDto): Promise<TeamMember> {
    try {
      // Verify the team exists
      const team = await this.teamRepository.findOne({
        where: { id: dto.teamId },
      });

      if (!team) {
        throw new NotFoundException(
          `Team with ID ${dto.teamId} not found`,
        );
      }

      // Check if membership already exists
      const existingMember = await this.findByTeamAndUser(
        dto.teamId,
        dto.userId,
      );

      if (existingMember) {
        throw new ConflictException(
          `User ${dto.userId} is already a member of team ${dto.teamId}`,
        );
      }

      // Create the membership
      const member = this.memberRepository.create({
        team_id: dto.teamId,
        user_id: dto.userId,
        roles: dto.roles,
      });

      const savedMember = await this.memberRepository.save(member);

      // TeamMember has no `organization_id` column itself — pin the audit row
      // to the parent team's org so org-admin scoped queries see this event.
      this.auditService.logCreate(savedMember as unknown as OwnedResource, {
        organizationIdOverride: team.organization_id,
      });

      this.logger.log(
        `Added user ${dto.userId} to team ${team.name} (${dto.teamId}) with roles: ${dto.roles.join(', ')}`,
      );

      return await this.findOne(savedMember.id);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
      }
      this.logger.error(
        'Failed to add team member',
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Update the roles of an existing member
   */
  async updateMemberRoles(
    id: string,
    dto: UpdateTeamMemberRolesDto,
  ): Promise<TeamMember> {
    try {
      const member = await this.findOne(id);

      // Snapshot pre-mutation roles for the audit diff (clone the array so the
      // post-mutation `member.roles = dto.roles` doesn't alias `before.roles`).
      const before = { ...member, roles: [...member.roles] } as TeamMember;
      member.roles = dto.roles;
      const after = await this.memberRepository.save(member);

      this.auditService.logUpdate(
        before as unknown as OwnedResource,
        after as unknown as OwnedResource,
        { organizationIdOverride: member.team?.organization_id },
      );

      // Invalidate authorization cache for the affected user and team
      await this.authorizationService.invalidateUserCache(member.user_id);
      await this.authorizationService.invalidateTeamCache(member.team_id);

      this.logger.log(
        `Updated roles for user ${member.user_id} in team ${member.team_id}: ${dto.roles.join(', ')}`,
      );

      return await this.findOne(id);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to update team member roles ${id}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Remove a member from a team
   */
  async removeMember(id: string): Promise<void> {
    try {
      const member = await this.findOne(id);

      this.auditService.logDelete(member as unknown as OwnedResource, {
        organizationIdOverride: member.team?.organization_id,
      });
      await this.memberRepository.remove(member);

      // Invalidate authorization cache for the removed user and team
      await this.authorizationService.invalidateUserCache(member.user_id);
      await this.authorizationService.invalidateTeamCache(member.team_id);

      this.logger.log(
        `Removed user ${member.user_id} from team ${member.team_id}`,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to remove team member ${id}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Remove a member by team and user ID
   */
  async removeMemberByTeamAndUser(
    teamId: string,
    userId: string,
  ): Promise<void> {
    try {
      const member = await this.findByTeamAndUser(teamId, userId);

      if (!member) {
        throw new NotFoundException(
          `User ${userId} is not a member of team ${teamId}`,
        );
      }

      this.auditService.logDelete(member as unknown as OwnedResource, {
        organizationIdOverride: member.team?.organization_id,
      });
      await this.memberRepository.remove(member);

      // Invalidate authorization cache for the removed user and team
      await this.authorizationService.invalidateUserCache(userId);
      await this.authorizationService.invalidateTeamCache(teamId);

      this.logger.log(
        `Removed user ${userId} from team ${teamId}`,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to remove user ${userId} from team ${teamId}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Check if a user is a member of a team
   */
  async isMember(teamId: string, userId: string): Promise<boolean> {
    try {
      const count = await this.memberRepository.count({
        where: {
          team_id: teamId,
          user_id: userId,
        },
      });
      return count > 0;
    } catch (error) {
      this.logger.error(
        `Failed to check membership for user ${userId} in team ${teamId}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Check if a user has a specific role in a team
   */
  async hasRole(
    teamId: string,
    userId: string,
    role: TeamRole | string,
  ): Promise<boolean> {
    try {
      const member = await this.findByTeamAndUser(teamId, userId);
      if (!member) {
        return false;
      }
      return member.roles.includes(role);
    } catch (error) {
      this.logger.error(
        `Failed to check role ${role} for user ${userId} in team ${teamId}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Check if a user is an admin in a team
   */
  async isTeamAdmin(teamId: string, userId: string): Promise<boolean> {
    try {
      const member = await this.findByTeamAndUser(teamId, userId);
      if (!member) {
        return false;
      }
      return member.roles.includes(TeamRole.ADMIN);
    } catch (error) {
      this.logger.error(
        `Failed to check admin status for user ${userId} in team ${teamId}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Get all roles a user has in a team
   */
  async getUserRoles(teamId: string, userId: string): Promise<string[]> {
    try {
      const member = await this.findByTeamAndUser(teamId, userId);
      return member?.roles ?? [];
    } catch (error) {
      this.logger.error(
        `Failed to get roles for user ${userId} in team ${teamId}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Count members in a team
   */
  async countMembers(teamId: string): Promise<number> {
    try {
      return await this.memberRepository.count({
        where: { team_id: teamId },
      });
    } catch (error) {
      this.logger.error(
        `Failed to count members in team ${teamId}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }
}
