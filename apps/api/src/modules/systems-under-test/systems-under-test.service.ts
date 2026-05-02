import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SystemUnderTest as SystemUnderTestEntity,
  SystemUnderTestTestEnvironment,
  SystemUnderTestWorkload,
  PyroscopeInstance,
} from '../../entities';
// SystemUnderTestTestEnvironment and SystemUnderTestWorkload are used in transaction manager.create()
import { CreateSystemUnderTestDto, UpdatePyroscopeConfigDto } from './dto';
import { AuthorizationService } from '../../common/services/authorization.service';

export interface SystemSummary {
  id: string;
  name: string;
  description?: string;
  team_id?: string | null;
  team?: {
    id: string;
    name: string;
  };
  environments: Array<{
    environment: string;
    workloads: string[];
  }>;
  pyroscope_instance_id?: string;
  pyroscope_configurations?: Array<{ application: string; profiler: string }>;
  created_at: string;
}

export interface LegacyCreateSystemUnderTestDto {
  name: string;
  description?: string;
  team_id?: string;
  tracing_service?: string;
}

export interface UpdateSystemUnderTestDto {
  name?: string;
  description?: string;
  team_id?: string | null;
  tracing_service?: string;
}

/**
 * Service responsible for managing systems under test.
 *
 * Authorization:
 * - Methods accept userId and a pre-resolved isAdmin boolean (resolved at the
 *   controller boundary via `withOrgFilter`). The service no longer calls
 *   `authzService.isGlobalAdmin` directly — Phase 3c C32 boundary push.
 * - Global admins bypass all authorization checks.
 */
@Injectable()
export class SystemsUnderTestService {
  private readonly logger = new Logger(SystemsUnderTestService.name);

  constructor(
    @InjectRepository(SystemUnderTestEntity)
    private readonly systemRepo: Repository<SystemUnderTestEntity>,
    @InjectRepository(PyroscopeInstance)
    private readonly pyroscopeInstanceRepo: Repository<PyroscopeInstance>,
    private readonly authzService: AuthorizationService,
  ) {}

  /**
   * Create a new system under test with optional pre-seeded environments and workloads.
   *
   * Idempotent: if a SUT with the same name + organizationId already exists, returns it
   * together with a `conflict: true` flag so callers can distinguish upsert from create.
   */
  async createSut(
    dto: CreateSystemUnderTestDto,
    userId: string,
    isAdmin: boolean,
  ): Promise<SystemUnderTestEntity & { conflict?: boolean }> {
    try {
      // Verify org membership before doing any DB work (non-admins only)
      if (!isAdmin) {
        const isMember = await this.authzService.isOrganizationMember(userId, dto.organizationId);
        if (!isMember) {
          throw new NotFoundException(`Organization ${dto.organizationId} not found or access denied`);
        }
      }

      // Idempotency check
      const existing = await this.systemRepo.findOne({
        where: { name: dto.name, organization_id: dto.organizationId },
        relations: ['team'],
      });

      if (existing) {
        this.logger.log(`createSut: SUT '${dto.name}' already exists in org ${dto.organizationId} — returning existing`);
        const verified = await this.findOne(existing.id, userId, isAdmin);
        return Object.assign(verified, { conflict: true });
      }

      // Create SUT + environments + workloads in a single transaction
      let createdId: string;
      await this.systemRepo.manager.transaction(async (manager) => {
        const system = manager.create(SystemUnderTestEntity, {
          name: dto.name,
          description: dto.description ?? '',
          organization_id: dto.organizationId,
          team_id: dto.teamId,
          created_by: userId,
          updated_by: userId,
        });
        const savedSystem = await manager.save(system);
        createdId = savedSystem.id;
        this.logger.log(`createSut: Created SUT '${savedSystem.name}' (${savedSystem.id})`);

        if (dto.environments && dto.environments.length > 0) {
          for (const envDto of dto.environments) {
            const env = manager.create(SystemUnderTestTestEnvironment, {
              system_under_test_id: savedSystem.id,
              name: envDto.name,
            });
            const savedEnv = await manager.save(env);

            if (envDto.workloads && envDto.workloads.length > 0) {
              for (const workloadDto of envDto.workloads) {
                const workload = manager.create(SystemUnderTestWorkload, {
                  system_under_test_test_environment_id: savedEnv.id,
                  name: workloadDto.name,
                });
                await manager.save(workload);
              }
            }
          }
        }
      });

      return await this.findOne(createdId!, userId, isAdmin);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to create system under test', error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  /**
   * Find all systems under test with organization filtering.
   *
   * @param organizationIds - Pre-resolved by the controller. `null` = global admin
   *   without an explicit org filter (return all). Empty array = non-admin with no
   *   accessible orgs (return nothing). Non-empty array = filter `organization_id IN (...)`.
   *   The controller collapses the explicit-`?organizationId=` query param into a
   *   single-element array so this method does not branch on it.
   * @param userId - Used for the team-restriction filter (separate from org filter).
   *
   * Returns systems filtered by `organizationIds`. Global admins (when `organizationIds === null`)
   * see all systems including those without organization_id; regular users only see systems
   * in their organizations.
   */
  async findAll(organizationIds: string[] | null, userId: string): Promise<SystemUnderTestEntity[]> {
    try {
      this.logger.log(`[findAll] START - userId=${userId}, organizationIds=${organizationIds === null ? 'null (admin)' : `[${organizationIds.join(',')}]`}`);

      if (organizationIds !== null && organizationIds.length === 0) {
        this.logger.log(`[findAll] User has no organizations - returning empty array`);
        return [];
      }

      const orgIds = organizationIds;

      if (orgIds === null) {
        // No filtering - admin without explicit org
        const systems = await this.systemRepo.find({
          relations: ['team'],
          order: { created_at: 'DESC' },
        });
        this.logger.log(`[findAll] UNFILTERED - Returning ${systems.length} systems`);
        return systems;
      }

      // Get user's team memberships for team-restriction filtering
      const userTeamIds = await this.authzService.getAccessibleTeams(userId);

      // Build query with organization filter + team restriction
      const queryBuilder = this.systemRepo
        .createQueryBuilder('system')
        .leftJoinAndSelect('system.team', 'team')
        .where(
          '(' +
            // SUTs without a team: org-level access
            '(system.team_id IS NULL AND system.organization_id IN (:...orgIds))' +
            ' OR ' +
            // SUTs with unrestricted team: org-level access
            '(system.team_id IS NOT NULL AND team.restrict_to_team_members = false AND system.organization_id IN (:...orgIds))' +
            (userTeamIds.length > 0
              ? ' OR ' +
                // SUTs with any team the user is a direct member of (restricted or not)
                '(system.team_id IN (:...userTeamIds))'
              : '') +
          ')',
          { orgIds, ...(userTeamIds.length > 0 ? { userTeamIds } : {}) },
        )
        .orderBy('system.created_at', 'DESC');

      const systems = await queryBuilder.getMany();
      this.logger.log(`[findAll] FILTERED - Returning ${systems.length} systems for orgs: ${orgIds.join(', ')}`);

      return systems;
    } catch (error) {
      this.logger.error('[findAll] ERROR', error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  /**
   * Find a single system under test by ID with access control
   *
   * @param id - The system under test ID
   * @param userId - The user ID for authorization
   * @param isAdmin - Whether the caller is a global admin (resolved at controller boundary)
   *
   * Returns the system if user has access via organization membership.
   * Global admins can access all systems (including those without organization_id).
   * Regular users can only access systems in their organizations (systems without organization_id are denied).
   */
  async findOne(id: string, userId: string, isAdmin: boolean): Promise<SystemUnderTestEntity> {
    try {
      this.logger.debug(`findOne: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      const system = await this.systemRepo.findOne({
        where: { id },
        relations: ['team'],
      });

      if (!system) {
        throw new NotFoundException(`System under test with ID ${id} not found`);
      }

      // Global admins can access everything
      if (isAdmin) {
        return system;
      }

      // Check organization access
      const isMember = await this.authzService.isOrganizationMember(
        userId,
        system.organization_id,
      );

      if (!isMember) {
        throw new NotFoundException(`System under test with ID ${id} not found`);
      }

      // Check team-level restriction if system belongs to a team
      if (system.team_id) {
        const teamAccess = await this.authzService.canViewTeamResources(userId, system.team_id);
        if (!teamAccess.allowed) {
          throw new NotFoundException(`System under test with ID ${id} not found`);
        }
      }

      return system;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to fetch system under test ${id}`, error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  /**
   * Find system summary with environments and workloads
   *
   * @param id - The system under test ID
   * @param userId - The user ID for authorization
   * @param isAdmin - Whether the caller is a global admin (resolved at controller boundary)
   */
  async findSystemSummary(id: string, userId: string, isAdmin: boolean): Promise<SystemSummary | null> {
    try {
      this.logger.debug(`findSystemSummary: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // Use TypeORM to get system with its test runs and team
      const system = await this.systemRepo.findOne({
        where: { id },
        relations: ['testRuns', 'team'],
      });

      if (!system) {
        return null;
      }

      // Check organization-based access
      if (!isAdmin) {
        // Check if user is a member of the system's organization
        const isMember = await this.authzService.isOrganizationMember(userId, system.organization_id);
        if (!isMember) {
          this.logger.warn(`Access denied: user ${userId} attempted to access system ${id} in organization ${system.organization_id}`);
          return null;
        }

        // Check team-level restriction if system belongs to a team
        if (system.team_id) {
          const teamAccess = await this.authzService.canViewTeamResources(userId, system.team_id);
          if (!teamAccess.allowed) {
            this.logger.warn(`Access denied: user ${userId} cannot view team-restricted system ${id}`);
            return null;
          }
        }
      }

      // Transform the data to group environments and workloads
      const environmentsMap = new Map<string, Set<string>>();

      // Process test runs to extract environments and workloads
      system.testRuns?.forEach((testRun) => {
        if (!environmentsMap.has(testRun.testEnvironment)) {
          environmentsMap.set(testRun.testEnvironment, new Set<string>());
        }

        environmentsMap.get(testRun.testEnvironment)?.add(testRun.workload);
      });

      // Convert to the desired structure
      const environments = Array.from(environmentsMap.entries())
        .map(([environment, workloadsSet]) => ({
          environment,
          workloads: Array.from(workloadsSet).sort(),
        }))
        .sort((a, b) => a.environment.localeCompare(b.environment));

      return {
        id: system.id,
        name: system.name,
        description: system.description,
        environments,
        pyroscope_instance_id: system.pyroscope_instance_id,
        pyroscope_configurations: system.pyroscope_configurations,
        created_at: system.created_at.toISOString(),
      };
    } catch (error) {
      this.logger.error(`Failed to fetch system summary for ${id}`, error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  /**
   * Find a system under test by name
   *
   * @param name - The system name
   * @param userId - The user ID for authorization
   * @param isAdmin - Whether the caller is a global admin (resolved at controller boundary)
   */
  async findByName(name: string, userId: string, isAdmin: boolean): Promise<SystemUnderTestEntity | null> {
    try {
      this.logger.debug(`findByName: name=${name}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      const system = await this.systemRepo.findOne({
        where: { name },
        relations: ['team'],
      });

      if (!system) {
        return null;
      }

      // Check organization-based access
      if (!isAdmin) {
        // Check if user is a member of the system's organization
        const isMember = await this.authzService.isOrganizationMember(userId, system.organization_id);
        if (!isMember) {
          this.logger.warn(`Access denied: user ${userId} attempted to access system '${name}' in organization ${system.organization_id}`);
          return null;
        }

        // Check team-level restriction if system belongs to a team
        if (system.team_id) {
          const teamAccess = await this.authzService.canViewTeamResources(userId, system.team_id);
          if (!teamAccess.allowed) {
            this.logger.warn(`Access denied: user ${userId} cannot view team-restricted system '${name}'`);
            return null;
          }
        }
      }

      return system;
    } catch (error) {
      this.logger.error(`Failed to fetch system by name ${name}`, error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  /**
   * Create a new system under test with ownership tracking
   *
   * @param createDto - The create DTO
   * @param userId - The user ID for authorization and ownership tracking
   * @param isAdmin - Whether the caller is a global admin (resolved at controller boundary)
   * @param organizationId - The organization this system belongs to
   *
   * Assigns ownership (created_by, updated_by) and organization_id on creation.
   */
  async create(
    createDto: LegacyCreateSystemUnderTestDto,
    userId: string,
    isAdmin: boolean,
    organizationId?: string,
  ): Promise<SystemUnderTestEntity> {
    try {
      this.logger.debug(`create: userId=${userId}, isGlobalAdmin=${isAdmin}, organizationId=${organizationId}`);

      // Create system with ownership tracking
      const system = this.systemRepo.create({
        ...createDto,
        created_by: userId,
        updated_by: userId,
        organization_id: organizationId,
      });

      const savedSystem = await this.systemRepo.save(system);

      this.logger.log(
        `Created system under test: ${savedSystem.name} (${savedSystem.id}) in org ${organizationId}`,
      );

      return await this.findOne(savedSystem.id, userId, isAdmin);
    } catch (error) {
      this.logger.error('Failed to create system under test', error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  /**
   * Update an existing system under test with permission checks
   *
   * @param id - The system under test ID
   * @param updateDto - The update DTO
   * @param userId - The user ID for authorization and ownership tracking
   * @param isAdmin - Whether the caller is a global admin (resolved at controller boundary)
   *
   * Requires user to have access to the system's organization.
   * Updates the updated_by field with the current user.
   */
  async update(id: string, updateDto: UpdateSystemUnderTestDto, userId: string, isAdmin: boolean): Promise<SystemUnderTestEntity> {
    try {
      this.logger.debug(`update: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // First verify the system exists and user has access
      const system = await this.findOne(id, userId, isAdmin);

      // Check modify permission
      // Global admins can modify anything
      // Regular users need organization membership
      if (!isAdmin) {
        const isMember = await this.authzService.isOrganizationMember(
          userId,
          system.organization_id,
        );

        if (!isMember) {
          throw new NotFoundException(`System under test with ID ${id} not found`);
        }
      }

      // Build update object, handling null values explicitly for TypeORM
      const updateData: Record<string, string | null | undefined> = {};
      if (updateDto.name !== undefined) updateData.name = updateDto.name;
      if (updateDto.description !== undefined) updateData.description = updateDto.description;
      if (updateDto.tracing_service !== undefined) updateData.tracing_service = updateDto.tracing_service;
      if (updateDto.team_id !== undefined) {
        // Explicitly handle null to set column to NULL
        updateData.team_id = updateDto.team_id;
      }

      // Always update the updated_by field
      updateData.updated_by = userId;

      // Use TypeORM's update method for direct column updates
      await this.systemRepo.update(id, updateData);

      this.logger.log(`Updated system under test: ${id} with data: ${JSON.stringify(updateData)}`);

      return await this.findOne(id, userId, isAdmin);
    } catch (error) {
      this.logger.error(`Failed to update system under test ${id}`, error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  /**
   * Delete a system under test with permission checks
   *
   * @param id - The system under test ID
   * @param userId - The user ID for authorization
   * @param isAdmin - Whether the caller is a global admin (resolved at controller boundary)
   *
   * Requires user to have admin access to the system's organization.
   */
  async remove(id: string, userId: string, isAdmin: boolean): Promise<void> {
    try {
      this.logger.debug(`remove: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      const system = await this.findOne(id, userId, isAdmin);

      // Check delete permission
      // Global admins can delete anything
      // Regular users need organization membership
      if (!isAdmin) {
        const isMember = await this.authzService.isOrganizationMember(
          userId,
          system.organization_id,
        );

        if (!isMember) {
          throw new NotFoundException(`System under test with ID ${id} not found`);
        }
      }

      await this.systemRepo.remove(system);

      this.logger.log(`Deleted system under test: ${system.name} (${id})`);
    } catch (error) {
      this.logger.error(`Failed to delete system under test ${id}`, error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  /**
   * Update Pyroscope profiling configuration for a system under test
   *
   * @param id - System under test UUID
   * @param updateDto - Pyroscope configuration update data
   * @param userId - The user ID for authorization and ownership tracking
   * @param isAdmin - Whether the caller is a global admin (resolved at controller boundary)
   * @returns Updated system under test entity
   * @throws NotFoundException if system not found
   * @throws BadRequestException if Pyroscope instance not found or validation fails
   */
  async updatePyroscopeConfig(
    id: string,
    updateDto: UpdatePyroscopeConfigDto,
    userId: string,
    isAdmin: boolean,
  ): Promise<SystemUnderTestEntity> {
    try {
      this.logger.debug(`updatePyroscopeConfig: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // 1. Find the system
      const system = await this.findOne(id, userId, isAdmin);

      // NOTE: Permission check will be added here when SystemUnderTest entity has organization_id
      // For now, all systems are modifiable (treated as legacy data)

      // 2. Validate pyroscope_instance_id exists if provided
      if (updateDto.pyroscope_instance_id) {
        const instance = await this.pyroscopeInstanceRepo.findOne({
          where: { id: updateDto.pyroscope_instance_id },
        });

        if (!instance) {
          throw new BadRequestException(
            `Pyroscope instance with ID ${updateDto.pyroscope_instance_id} not found`,
          );
        }
      }

      // 3. Validation: If instance is set, require at least one configuration
      if (updateDto.pyroscope_instance_id) {
        const configs = updateDto.pyroscope_configurations ?? system.pyroscope_configurations ?? [];

        if (configs.length === 0) {
          throw new BadRequestException(
            'At least one application+profiler combination must be specified when Pyroscope instance is configured',
          );
        }
      }

      // 4. Update fields - handle explicit null to clear the instance
      if ('pyroscope_instance_id' in updateDto) {
        system.pyroscope_instance_id = updateDto.pyroscope_instance_id ?? undefined;
      }
      if (updateDto.pyroscope_configurations !== undefined) {
        system.pyroscope_configurations = updateDto.pyroscope_configurations;
      }

      // 5. Save and return with relations
      // NOTE: updated_by will be set when Phase 4 adds that column
      await this.systemRepo.save(system);

      this.logger.log(`Updated Pyroscope config for system: ${system.name} (${id})`);

      return await this.findOne(id, userId, isAdmin);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `Failed to update Pyroscope config for system ${id}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }
}
