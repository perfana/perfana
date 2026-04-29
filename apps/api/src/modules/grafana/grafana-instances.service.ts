import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GrafanaInstance as GrafanaInstanceEntity } from '../../entities';
import { CreateGrafanaInstanceDto, UpdateGrafanaInstanceDto } from './dto/grafana-instance.dto';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';

export interface GrafanaInstance {
  id: string;
  label: string;
  client_url: string;
  server_url?: string;
  org_id: string;
  api_key?: string; // encrypted
  username?: string;
  password?: string; // encrypted
  snapshot_instance: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Service responsible for managing Grafana instances.
 *
 * Authorization:
 * - All methods accept userId and roles parameters for authorization
 * - Currently GrafanaInstance entity does not have organization_id, so all data is treated as legacy
 * - When organization_id is added to GrafanaInstance (Phase 4), authorization checks will be enabled
 * - Global admins bypass all authorization checks
 */
@Injectable()
export class GrafanaInstancesService {
  private readonly logger = new Logger(GrafanaInstancesService.name);

  constructor(
    @InjectRepository(GrafanaInstanceEntity)
    private grafanaInstanceRepo: Repository<GrafanaInstanceEntity>,
    private readonly authzService: AuthorizationService,
  ) {}

  /**
   * Check if user is org-admin in any of their organizations
   * @throws ForbiddenException if user is not an org-admin
   */
  private async requireOrgAdmin(userId: string, roles: string[]): Promise<void> {
    // Global admins always have access
    if (this.authzService.isGlobalAdmin(roles)) {
      return;
    }

    // Check if user is org-admin in any organization
    const isOrgAdmin = await this.authzService.isOrgAdminInAnyOrganization(userId);
    if (!isOrgAdmin) {
      throw new ForbiddenException('Organization admin privileges required to manage Grafana instances');
    }
  }

  /**
   * Mask a credential value for safe API responses
   * Returns '[MASKED]' if value exists, undefined otherwise
   */
  private maskCredential(value: string | null | undefined): string | undefined {
    return value ? '[MASKED]' : undefined;
  }

  private mapEntityToDto(entity: GrafanaInstanceEntity): GrafanaInstance {
    return {
      id: entity.id,
      label: entity.label,
      client_url: entity.client_url,
      server_url: entity.server_url,
      org_id: entity.orgId,
      api_key: this.maskCredential(entity.apiKey),
      username: entity.username,
      password: this.maskCredential(entity.password),
      snapshot_instance: entity.snapshotInstance || false,
      created_at: entity.createdAt.toISOString(),
      updated_at: entity.updatedAt.toISOString(),
    };
  }

  /**
   * Find all Grafana instances
   *
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   * @param query - Optional query filters
   *
   * Filters results to only show instances that belong to organizations the user is a member of.
   * Global admins see all instances. Legacy instances with null organization_id are accessible to all users.
   */
  async findAll(userId: string, roles: string[], query?: { label?: string; snapshotInstance?: boolean }, organizationId?: string): Promise<GrafanaInstance[]> {
    try {
      // Resolve accessible org IDs: null means global admin (no filter needed)
      const orgIds = await withOrgFilter(userId, roles, this.authzService);
      this.logger.debug(`findAll: userId=${userId}, isGlobalAdmin=${orgIds === null}, organizationId=${organizationId}`);

      const queryBuilder = this.grafanaInstanceRepo
        .createQueryBuilder('gi')
        .orderBy('gi.created_at', 'DESC');

      // Apply organization filtering
      if (organizationId) {
        // Explicit org selected — scope to that org only
        queryBuilder.andWhere('gi.organization_id = :organizationId', { organizationId });
      } else if (orgIds !== null) {
        // Non-admin: filter to accessible organizations OR legacy instances (null organization_id)
        this.logger.debug(`User ${userId} has access to ${orgIds.length} organizations`);
        queryBuilder.andWhere(
          '(gi.organization_id IN (:...orgIds) OR gi.organization_id IS NULL)',
          { orgIds: orgIds.length > 0 ? orgIds : ['00000000-0000-0000-0000-000000000000'] }
        );
      }

      if (query?.label) {
        queryBuilder.andWhere('gi.label ILIKE :label', { label: `%${query.label}%` });
      }
      if (query?.snapshotInstance !== undefined) {
        queryBuilder.andWhere('gi.snapshotInstance = :snapshotInstance', {
          snapshotInstance: query.snapshotInstance
        });
      }

      const entities = await queryBuilder.getMany();
      this.logger.debug(`Returning ${entities.length} Grafana instances for user ${userId}`);
      return entities.map(e => this.mapEntityToDto(e));
    } catch (error) {
      this.logger.error('Failed to fetch Grafana instances:', error);
      throw error;
    }
  }

  /**
   * Find a single Grafana instance by ID
   *
   * @param id - The Grafana instance ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Validates that the user has access to the instance based on organization membership.
   * @throws NotFoundException if instance doesn't exist or user doesn't have access
   */
  async findOne(id: string, userId: string, roles: string[]): Promise<GrafanaInstance> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.debug(`findOne: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      const entity = await this.grafanaInstanceRepo.findOne({
        where: { id }
      });

      if (!entity) {
        throw new NotFoundException(`Grafana instance with id ${id} not found`);
      }

      // Check access permissions (unless global admin)
      if (!isAdmin) {
        // Legacy data (null organization_id) is accessible to all users
        if (entity.organizationId) {
          const hasAccess = await this.authzService.isOrganizationMember(userId, entity.organizationId);
          if (!hasAccess) {
            throw new NotFoundException(`Grafana instance with id ${id} not found`);
          }
        }
      }

      return this.mapEntityToDto(entity);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to find Grafana instance:', error);
      throw error;
    }
  }

  /**
   * Create a new Grafana instance
   *
   * @param createDto - The create DTO
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   *
   * Sets ownership tracking (created_by, updated_by).
   * TODO: Set organization_id from user's primary/selected organization when UI supports org selection
   */
  async create(createDto: CreateGrafanaInstanceDto, userId: string, roles: string[]): Promise<GrafanaInstance> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.log(`[create] START - userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // Check if user is org-admin in any organization
      await this.requireOrgAdmin(userId, roles);

      const entity = this.grafanaInstanceRepo.create({
        label: createDto.label,
        client_url: createDto.clientUrl,
        server_url: createDto.serverUrl || undefined,
        orgId: createDto.orgId,
        apiKey: createDto.apiKey || undefined,
        username: createDto.username || undefined,
        password: createDto.password || undefined,
        snapshotInstance: createDto.snapshotInstance || false,
        createdBy: userId,
        updatedBy: userId,
        organizationId: createDto.organizationId || undefined,
      });

      const savedEntity = await this.grafanaInstanceRepo.save(entity);

      this.logger.log(`Grafana instance created: ${createDto.label} by user ${userId}`);
      return this.mapEntityToDto(savedEntity);
    } catch (error) {
      this.logger.error('Failed to create Grafana instance:', error);
      throw error;
    }
  }

  /**
   * Update an existing Grafana instance
   *
   * @param id - The Grafana instance ID
   * @param updateDto - The update DTO
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   *
   * Validates that the user has permission to modify the instance based on organization membership.
   */
  async update(id: string, updateDto: UpdateGrafanaInstanceDto, userId: string, roles: string[]): Promise<GrafanaInstance> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.log(`[update] START - id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // Check if user is org-admin in any organization
      await this.requireOrgAdmin(userId, roles);

      const entity = await this.grafanaInstanceRepo.findOne({ where: { id } });

      if (!entity) {
        throw new NotFoundException(`Grafana instance with id ${id} not found`);
      }

      // Check modification permissions (unless global admin)
      if (!isAdmin && entity.organizationId) {
        const canModify = await this.authzService.isOrganizationAdmin(userId, entity.organizationId);
        if (!canModify) {
          throw new ForbiddenException('You do not have permission to modify this Grafana instance');
        }
      }

      // Update only provided fields
      if (updateDto.label !== undefined) entity.label = updateDto.label;
      if (updateDto.clientUrl !== undefined) entity.client_url = updateDto.clientUrl;
      if (updateDto.serverUrl !== undefined) entity.server_url = updateDto.serverUrl;
      if (updateDto.orgId !== undefined) entity.orgId = updateDto.orgId;
      if (updateDto.apiKey !== undefined) entity.apiKey = updateDto.apiKey;
      if (updateDto.username !== undefined) entity.username = updateDto.username;
      if (updateDto.password !== undefined) entity.password = updateDto.password;
      if (updateDto.snapshotInstance !== undefined) entity.snapshotInstance = updateDto.snapshotInstance;

      // Update ownership tracking
      entity.updatedBy = userId;

      const updatedEntity = await this.grafanaInstanceRepo.save(entity);

      this.logger.log(`Grafana instance updated: ${id} by user ${userId}`);
      return this.mapEntityToDto(updatedEntity);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to update Grafana instance:', error);
      throw error;
    }
  }

  /**
   * Delete a Grafana instance
   *
   * @param id - The Grafana instance ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Validates that the user has permission to delete the instance based on organization membership.
   */
  async remove(id: string, userId: string, roles: string[]): Promise<void> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.log(`[remove] START - id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // Check if user is org-admin in any organization
      await this.requireOrgAdmin(userId, roles);

      const entity = await this.grafanaInstanceRepo.findOne({ where: { id } });

      if (!entity) {
        throw new NotFoundException(`Grafana instance with id ${id} not found`);
      }

      // Check modification permissions (unless global admin)
      if (!isAdmin && entity.organizationId) {
        const canModify = await this.authzService.isOrganizationAdmin(userId, entity.organizationId);
        if (!canModify) {
          throw new ForbiddenException('You do not have permission to delete this Grafana instance');
        }
      }

      await this.grafanaInstanceRepo.remove(entity);

      this.logger.log(`Grafana instance ${id} deleted successfully by user ${userId}`);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to delete Grafana instance:', error);
      throw error;
    }
  }

  /**
   * Test connection to a Grafana instance
   *
   * @param id - The Grafana instance ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: GrafanaInstance entity does not have organization_id yet, so access checks are not applied.
   * Full access permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async testConnection(id: string, userId: string, roles: string[]): Promise<{ success: boolean; message: string }> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.debug(`testConnection: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      const instance = await this.findOne(id, userId, roles);

      // TODO: Implement actual Grafana connection test
      // For now, return success if instance exists
      return {
        success: true,
        message: `Connection test for ${instance.label} successful`
      };
    } catch (error) {
      this.logger.error('Failed to test Grafana connection:', error);
      return {
        success: false,
        message: (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Connection test failed'
      };
    }
  }

  /**
   * Test Grafana connection with provided parameters (without saving)
   *
   * @param params - Connection parameters
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: This method validates connection parameters without accessing stored data,
   * so no resource-level authorization is needed. Basic authentication is still required.
   */
  async testConnectionWithParams(
    params: {
      clientUrl: string;
      serverUrl?: string;
      orgId: string;
      apiKey?: string;
      username?: string;
      password?: string;
    },
    userId: string,
    roles: string[],
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.debug(`testConnectionWithParams: userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // TODO: Implement actual Grafana connection test with provided parameters
      // For now, just validate that required fields are present
      if (!params.clientUrl || !params.orgId) {
        throw new Error('Client URL and Organization ID are required');
      }

      if (!params.apiKey && (!params.username || !params.password)) {
        throw new Error('Either API Key or Username/Password must be provided');
      }

      // Return success for now
      return {
        success: true,
        message: 'Connection test successful'
      };
    } catch (error) {
      this.logger.error('Failed to test Grafana connection with params:', error);
      return {
        success: false,
        message: (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Connection test failed'
      };
    }
  }
}
