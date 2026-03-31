import { Injectable, Logger, NotFoundException, ForbiddenException, forwardRef, Inject } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, In, DataSource } from 'typeorm';
import { Organization } from '../../entities';
import { AuthorizationService } from '../../common/services/authorization.service';
import { OrganizationMembersService } from './organization-members.service';
import { CreateOrganizationDto, UpdateOrganizationDto } from './dto/organization.dto';

/**
 * Service responsible for managing organizations.
 *
 * Authorization:
 * - All methods accept userId and roles parameters for authorization
 * - AuthorizationService is injected for role-based authorization checks
 * - Global admins can see and manage all organizations
 * - Regular users can only see organizations they are members of
 * - Only org admins can update/delete organizations
 *
 * Note: Organizations are the root of the access control hierarchy.
 * Unlike other resources that belong to organizations, organizations
 * themselves are filtered by membership.
 */
@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    private readonly authzService: AuthorizationService,
    @Inject(forwardRef(() => OrganizationMembersService))
    private readonly membersService: OrganizationMembersService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Find all organizations the user has access to.
   *
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Authorization:
   * - Global admins see all organizations
   * - Regular users see only organizations they are members of
   */
  async findAll(
    userId: string = '',
    roles: string[] = [],
  ): Promise<Organization[]> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.debug(`findAll: userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // Global admins see all organizations
      if (isAdmin) {
        return await this.organizationRepository.find({
          relations: ['teams'],
          order: {
            created_at: 'DESC',
          },
        });
      }

      // Regular users see only their organizations
      const accessibleOrgIds = await this.authzService.getAccessibleOrganizations(userId);

      if (accessibleOrgIds.length === 0) {
        this.logger.debug(`User ${userId} has no accessible organizations`);
        return [];
      }

      return await this.organizationRepository.find({
        where: { id: In(accessibleOrgIds) },
        relations: ['teams'],
        order: {
          created_at: 'DESC',
        },
      });
    } catch (error) {
      this.logger.error('Failed to fetch organizations', error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  /**
   * Find a single organization by ID.
   *
   * @param id - The organization ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Authorization:
   * - Global admins can access any organization
   * - Regular users can only access organizations they are members of
   */
  async findOne(
    id: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<Organization> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.debug(`findOne: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      const organization = await this.organizationRepository.findOne({
        where: { id },
        relations: ['teams'],
      });

      if (!organization) {
        throw new NotFoundException(`Organization with ID ${id} not found`);
      }

      // Check authorization (global admins can access any org)
      if (!isAdmin) {
        const isMember = await this.authzService.isOrganizationMember(userId, id);
        if (!isMember) {
          this.logger.warn(`Access denied: User ${userId} is not a member of organization ${id}`);
          throw new ForbiddenException(`You do not have access to organization ${id}`);
        }
      }

      return organization;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(`Failed to fetch organization ${id}`, error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  /**
   * Find an organization by name.
   *
   * @param name - The organization name
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Authorization:
   * - Global admins can find any organization by name
   * - Regular users can only find organizations they are members of
   */
  async findByName(
    name: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<Organization | null> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.debug(`findByName: name=${name}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      const organization = await this.organizationRepository.findOne({
        where: { name },
        relations: ['teams'],
      });

      if (!organization) {
        return null;
      }

      // Check authorization (global admins can access any org)
      if (!isAdmin) {
        const isMember = await this.authzService.isOrganizationMember(userId, organization.id);
        if (!isMember) {
          this.logger.warn(`Access denied: User ${userId} is not a member of organization ${name}`);
          return null; // Return null rather than throwing to maintain backward compatibility
        }
      }

      return organization;
    } catch (error) {
      this.logger.error(`Failed to fetch organization by name ${name}`, error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  /**
   * Create a new organization.
   *
   * @param createDto - The organization creation data
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   *
   * Authorization:
   * - Currently all authenticated users can create organizations
   * - In the future, this may be restricted to global admins only
   *
   * Note: The creator is automatically added as org-admin.
   */
  async create(
    createDto: CreateOrganizationDto,
    userId: string = '',
    roles: string[] = [],
  ): Promise<Organization> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.debug(`create: name=${createDto.name}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      const organization = this.organizationRepository.create(createDto);
      const savedOrg = await this.organizationRepository.save(organization);

      this.logger.log(`Created organization: ${savedOrg.name} (${savedOrg.id}) by user ${userId}`);

      // Automatically add the creator as org-admin
      if (userId) {
        await this.membersService.addMember({
          organizationId: savedOrg.id,
          userId,
          roles: ['org-admin'],
        });
        this.logger.log(`Added user ${userId} as org-admin of organization ${savedOrg.id}`);
      }

      return await this.findOne(savedOrg.id, userId, roles);
    } catch (error) {
      this.logger.error('Failed to create organization', error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  /**
   * Update an existing organization.
   *
   * @param id - The organization ID
   * @param updateDto - The update data
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Authorization:
   * - Global admins can update any organization
   * - Only org admins can update their organization
   */
  async update(
    id: string,
    updateDto: UpdateOrganizationDto,
    userId: string = '',
    roles: string[] = [],
  ): Promise<Organization> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.debug(`update: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // First verify the organization exists
      const organization = await this.organizationRepository.findOne({
        where: { id },
        relations: ['teams'],
      });

      if (!organization) {
        throw new NotFoundException(`Organization with ID ${id} not found`);
      }

      // Check authorization - must be global admin or org admin
      if (!isAdmin) {
        const isOrgAdmin = await this.authzService.isOrganizationAdmin(userId, id);
        if (!isOrgAdmin) {
          this.logger.warn(`Update denied: User ${userId} is not an admin of organization ${id}`);
          throw new ForbiddenException(`You do not have permission to update organization ${id}`);
        }
      }

      Object.assign(organization, updateDto);
      await this.organizationRepository.save(organization);

      this.logger.log(`Updated organization: ${organization.name} (${id}) by user ${userId}`);

      return await this.findOne(id, userId, roles);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(`Failed to update organization ${id}`, error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  /**
   * Delete an organization.
   *
   * @param id - The organization ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Authorization:
   * - Global admins can delete any organization
   * - Only org admins can delete their organization
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

      // First verify the organization exists and load relations
      const organization = await this.organizationRepository.findOne({
        where: { id },
        relations: ['teams'],
      });

      if (!organization) {
        throw new NotFoundException(`Organization with ID ${id} not found`);
      }

      // Check authorization - must be global admin or org admin
      if (!isAdmin) {
        const isOrgAdmin = await this.authzService.isOrganizationAdmin(userId, id);
        if (!isOrgAdmin) {
          this.logger.warn(`Delete denied: User ${userId} is not an admin of organization ${id}`);
          throw new ForbiddenException(`You do not have permission to delete organization ${id}`);
        }
      }

      // Delete all associated data in a transaction (prevents partial deletes on failure)
      this.logger.warn(`Cascading delete for organization ${id} - this will delete ALL associated data including test runs!`);

      await this.dataSource.transaction(async (manager) => {
        // For each team, delete all dependent data
        if (organization.teams && organization.teams.length > 0) {
          this.logger.debug(`Deleting data for ${organization.teams.length} teams`);
          for (const team of organization.teams) {
            // Get all systems_under_test for this team
            const systems = await manager.query(
              'SELECT id FROM systems_under_test WHERE team_id = $1',
              [team.id]
            );

            // For each system, delete all test runs and related data
            for (const system of systems) {
              await manager.query('DELETE FROM test_runs WHERE system_under_test_id = $1', [system.id]);
            }

            // Now delete systems_under_test
            await manager.query('DELETE FROM systems_under_test WHERE team_id = $1', [team.id]);

            // Delete team members
            await manager.query('DELETE FROM team_members WHERE team_id = $1', [team.id]);

            // Now safe to delete the team
            await manager.query('DELETE FROM teams WHERE id = $1', [team.id]);
          }
        }

        // Delete organization members
        await manager.query('DELETE FROM organization_members WHERE organization_id = $1', [id]);

        // Now safe to delete the organization
        await manager.getRepository(Organization).remove(organization);
      });

      this.logger.log(`Deleted organization: ${organization.name} (${id}) with all associated data by user ${userId}`);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(`Failed to delete organization ${id}`, error instanceof Error ? error.stack : error);
      throw error;
    }
  }
}
