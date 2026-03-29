import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Organization, OrganizationMember } from '../../entities';
import { OrganizationRole } from '../../constants/roles.constants';
import { KeycloakAdminService } from '../auth/keycloak-admin.service';

export interface AddOrganizationMemberDto {
  organizationId: string;
  userId: string;
  roles: string[];
}

export interface UpdateOrganizationMemberRolesDto {
  roles: string[];
}

export interface EnrichedOrganizationMember extends OrganizationMember {
  userInfo?: {
    username: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    displayName: string;
    enabled: boolean;
    emailVerified: boolean;
  };
}

@Injectable()
export class OrganizationMembersService {
  private readonly logger = new Logger(OrganizationMembersService.name);

  constructor(
    @InjectRepository(OrganizationMember)
    private readonly memberRepository: Repository<OrganizationMember>,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    private readonly keycloakAdminService: KeycloakAdminService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * Revoke API keys created by a user for a specific organization.
   * Called when a user is removed from an organization to prevent orphaned keys.
   */
  private async revokeApiKeysForUser(userId: string, organizationId: string): Promise<void> {
    try {
      const result = await this.dataSource.query(
        `DELETE FROM api_keys WHERE created_by = $1 AND organization_id = $2`,
        [userId, organizationId],
      );
      const deletedCount = result?.[1] ?? 0;
      if (deletedCount > 0) {
        this.logger.log(`Revoked ${deletedCount} API key(s) for user ${userId} in organization ${organizationId}`);
      }
    } catch (error) {
      // Log but don't fail the membership removal
      this.logger.error(
        `Failed to revoke API keys for user ${userId} in organization ${organizationId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Find all members of an organization
   */
  async findByOrganization(organizationId: string): Promise<OrganizationMember[]> {
    try {
      return await this.memberRepository.find({
        where: { organization_id: organizationId },
        relations: ['organization'],
        order: {
          created_at: 'DESC',
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to fetch members for organization ${organizationId}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Find all members of an organization with enriched user info from Keycloak
   */
  async findByOrganizationWithUserInfo(organizationId: string): Promise<EnrichedOrganizationMember[]> {
    try {
      const members = await this.findByOrganization(organizationId);
      return await this.enrichMembersWithUserInfo(members);
    } catch (error) {
      this.logger.error(
        `Failed to fetch enriched members for organization ${organizationId}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Enrich organization members with user information from Keycloak
   */
  private async enrichMembersWithUserInfo(
    members: OrganizationMember[],
  ): Promise<EnrichedOrganizationMember[]> {
    // Get unique user IDs
    const userIds = [...new Set(members.map(m => m.user_id))];

    // Fetch user info from Keycloak for all user IDs
    const userInfoMap = new Map<string, any>();

    await Promise.all(
      userIds.map(async (userId) => {
        try {
          // Skip API keys (they start with 'api-key:')
          if (userId.startsWith('api-key:')) {
            userInfoMap.set(userId, {
              username: userId,
              displayName: 'API Key',
              enabled: true,
              emailVerified: false,
            });
            return;
          }

          const user = await this.keycloakAdminService.getUserById(userId);

          if (user) {
            userInfoMap.set(userId, {
              username: user.username,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
              displayName: this.getDisplayName(user),
              enabled: user.enabled,
              emailVerified: user.emailVerified,
            });
          } else {
            // User not found in Keycloak (might have been deleted)
            userInfoMap.set(userId, {
              username: userId,
              displayName: userId,
              enabled: false,
              emailVerified: false,
            });
          }
        } catch (error) {
          this.logger.warn(`Failed to fetch user info for ${userId}:`, error);
          // Fallback to just showing the user ID
          userInfoMap.set(userId, {
            username: userId,
            displayName: userId,
            enabled: false,
            emailVerified: false,
          });
        }
      })
    );

    // Enrich members with user info
    return members.map(member => ({
      ...member,
      userInfo: userInfoMap.get(member.user_id),
    }));
  }

  /**
   * Get a human-readable display name for a user
   */
  private getDisplayName(user: {
    firstName?: string;
    lastName?: string;
    email?: string;
    username: string;
  }): string {
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

  /**
   * Find all organizations a user belongs to
   */
  async findByUser(userId: string): Promise<OrganizationMember[]> {
    try {
      return await this.memberRepository.find({
        where: { user_id: userId },
        relations: ['organization'],
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
  async findOne(id: string): Promise<OrganizationMember> {
    try {
      const member = await this.memberRepository.findOne({
        where: { id },
        relations: ['organization'],
      });

      if (!member) {
        throw new NotFoundException(`Organization membership with ID ${id} not found`);
      }

      return member;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to fetch organization membership ${id}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Find membership by organization and user
   */
  async findByOrganizationAndUser(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMember | null> {
    try {
      return await this.memberRepository.findOne({
        where: {
          organization_id: organizationId,
          user_id: userId,
        },
        relations: ['organization'],
      });
    } catch (error) {
      this.logger.error(
        `Failed to fetch membership for user ${userId} in organization ${organizationId}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Add a user as a member of an organization
   */
  async addMember(dto: AddOrganizationMemberDto): Promise<OrganizationMember> {
    try {
      // Verify the organization exists
      const organization = await this.organizationRepository.findOne({
        where: { id: dto.organizationId },
      });

      if (!organization) {
        throw new NotFoundException(
          `Organization with ID ${dto.organizationId} not found`,
        );
      }

      // Check if membership already exists
      const existingMember = await this.findByOrganizationAndUser(
        dto.organizationId,
        dto.userId,
      );

      if (existingMember) {
        throw new ConflictException(
          `User ${dto.userId} is already a member of organization ${dto.organizationId}`,
        );
      }

      // Create the membership
      const member = this.memberRepository.create({
        organization_id: dto.organizationId,
        user_id: dto.userId,
        roles: dto.roles,
      });

      const savedMember = await this.memberRepository.save(member);

      this.logger.log(
        `Added user ${dto.userId} to organization ${organization.name} (${dto.organizationId}) with roles: ${dto.roles.join(', ')}`,
      );

      return await this.findOne(savedMember.id);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
      }
      this.logger.error(
        'Failed to add organization member',
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
    dto: UpdateOrganizationMemberRolesDto,
  ): Promise<OrganizationMember> {
    try {
      const member = await this.findOne(id);

      member.roles = dto.roles;
      await this.memberRepository.save(member);

      this.logger.log(
        `Updated roles for user ${member.user_id} in organization ${member.organization_id}: ${dto.roles.join(', ')}`,
      );

      return await this.findOne(id);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to update organization member roles ${id}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Remove a member from an organization
   */
  async removeMember(id: string): Promise<void> {
    try {
      const member = await this.findOne(id);
      await this.memberRepository.remove(member);

      // Revoke API keys created by this user for this organization
      await this.revokeApiKeysForUser(member.user_id, member.organization_id);

      this.logger.log(
        `Removed user ${member.user_id} from organization ${member.organization_id}`,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to remove organization member ${id}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Remove a member by organization and user ID
   */
  async removeMemberByOrganizationAndUser(
    organizationId: string,
    userId: string,
  ): Promise<void> {
    try {
      const member = await this.findByOrganizationAndUser(organizationId, userId);

      if (!member) {
        throw new NotFoundException(
          `User ${userId} is not a member of organization ${organizationId}`,
        );
      }

      await this.memberRepository.remove(member);

      // Revoke API keys created by this user for this organization
      await this.revokeApiKeysForUser(userId, organizationId);

      this.logger.log(
        `Removed user ${userId} from organization ${organizationId}`,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to remove user ${userId} from organization ${organizationId}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Check if a user is a member of an organization
   */
  async isMember(organizationId: string, userId: string): Promise<boolean> {
    try {
      const count = await this.memberRepository.count({
        where: {
          organization_id: organizationId,
          user_id: userId,
        },
      });
      return count > 0;
    } catch (error) {
      this.logger.error(
        `Failed to check membership for user ${userId} in organization ${organizationId}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Check if a user has a specific role in an organization
   */
  async hasRole(
    organizationId: string,
    userId: string,
    role: OrganizationRole | string,
  ): Promise<boolean> {
    try {
      const member = await this.findByOrganizationAndUser(organizationId, userId);
      if (!member) {
        return false;
      }
      return member.roles.includes(role);
    } catch (error) {
      this.logger.error(
        `Failed to check role ${role} for user ${userId} in organization ${organizationId}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Check if a user is an admin in an organization
   */
  async isOrgAdmin(organizationId: string, userId: string): Promise<boolean> {
    try {
      const member = await this.findByOrganizationAndUser(organizationId, userId);
      if (!member) {
        return false;
      }
      return member.roles.includes(OrganizationRole.ADMIN);
    } catch (error) {
      this.logger.error(
        `Failed to check admin status for user ${userId} in organization ${organizationId}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Get all roles a user has in an organization
   */
  async getUserRoles(organizationId: string, userId: string): Promise<string[]> {
    try {
      const member = await this.findByOrganizationAndUser(organizationId, userId);
      return member?.roles ?? [];
    } catch (error) {
      this.logger.error(
        `Failed to get roles for user ${userId} in organization ${organizationId}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Count members in an organization
   */
  async countMembers(organizationId: string): Promise<number> {
    try {
      return await this.memberRepository.count({
        where: { organization_id: organizationId },
      });
    } catch (error) {
      this.logger.error(
        `Failed to count members in organization ${organizationId}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }
}
