import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TracingInstance as TracingInstanceEntity } from '@perfana/shared';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';
import {
  CreateTracingInstanceDto,
  UpdateTracingInstanceDto,
  TracingInstanceResponseDto,
  TracingInstanceQuery,
  TestConnectionDto,
} from './dto/tracing-instance.dto';

/**
 * Service responsible for managing Tracing instances.
 *
 * Authorization:
 * - Implements organization-based access control (RBAC Phase 3)
 * - Users see only instances from their accessible organizations
 * - Legacy instances (null organization_id) are accessible to all for backward compatibility
 * - Global admins bypass all authorization checks
 * - Requires org-admin privileges for create/update/delete operations
 */
@Injectable()
export class TracingInstancesService {
  private readonly logger = new Logger(TracingInstancesService.name);

  constructor(
    @InjectRepository(TracingInstanceEntity)
    private tracingInstanceRepo: Repository<TracingInstanceEntity>,
    private readonly authzService: AuthorizationService,
  ) {}

  /**
   * Check if user is org-admin in any of their organizations
   * @throws Error if user is not an org-admin
   */
  private async requireOrgAdmin(userId: string, roles: string[]): Promise<void> {
    // Global admins always have access
    if (this.authzService.isGlobalAdmin(roles)) {
      return;
    }

    // Check if user is org-admin in any organization
    const isOrgAdmin = await this.authzService.isOrgAdminInAnyOrganization(userId);
    if (!isOrgAdmin) {
      throw new ForbiddenException('Organization admin privileges required to manage tracing instances');
    }
  }

  private mapEntityToDto(entity: TracingInstanceEntity): TracingInstanceResponseDto {
    return {
      id: entity.id,
      label: entity.label,
      tracing_url: entity.tracingUrl,
      tracing_api_url: entity.tracingApiUrl,
      tracing_ui: entity.tracingUi,
      tracing_iframe_allowed: entity.tracingIframeAllowed,
      created_at: entity.createdAt.toISOString(),
      updated_at: entity.updatedAt.toISOString(),
    };
  }

  /**
   * Find all Tracing instances
   *
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   * @param query - Optional query filters
   *
   * Filters instances by user's accessible organizations.
   * Global admins see all instances. Legacy instances (null organization_id) are accessible to all.
   */
  async findAll(userId: string, roles: string[], query?: TracingInstanceQuery, organizationId?: string): Promise<TracingInstanceResponseDto[]> {
    try {
      // Resolve accessible org IDs: null means global admin (no filter needed)
      const orgIds = await withOrgFilter(userId, roles, this.authzService);
      this.logger.debug(`findAll: userId=${userId}, isGlobalAdmin=${orgIds === null}, organizationId=${organizationId}`);

      const queryBuilder = this.tracingInstanceRepo
        .createQueryBuilder('ti')
        .orderBy('ti.created_at', 'DESC');

      // Organization filtering
      if (organizationId) {
        // Non-admin must have access to the requested org; admin always allowed
        if (orgIds !== null && !orgIds.includes(organizationId)) {
          return [];
        }
        queryBuilder.andWhere('ti.organization_id = :organizationId', { organizationId });
      } else if (orgIds !== null) {
        // Non-admin: filter to accessible orgs OR legacy instances (null organization_id)
        queryBuilder.andWhere(
          '(ti.organization_id IN (:...orgIds) OR ti.organization_id IS NULL)',
          {
            orgIds: orgIds.length > 0
              ? orgIds
              : ['00000000-0000-0000-0000-000000000000'] // Dummy UUID when user has no orgs
          }
        );
      }

      if (query?.label) {
        queryBuilder.andWhere('ti.label ILIKE :label', { label: `%${query.label}%` });
      }
      if (query?.tracingUi) {
        queryBuilder.andWhere('ti.tracing_ui = :tracingUi', {
          tracingUi: query.tracingUi
        });
      }

      const entities = await queryBuilder.getMany();
      return entities.map(e => this.mapEntityToDto(e));
    } catch (error) {
      this.logger.error('Failed to fetch tracing instances:', error);
      throw error;
    }
  }

  /**
   * Find a single Tracing instance by ID
   *
   * @param id - The Tracing instance ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Checks if user has access to the instance based on organization membership.
   * Global admins and legacy instances (null organization_id) bypass checks.
   */
  async findOne(id: string, userId: string, roles: string[]): Promise<TracingInstanceResponseDto> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.debug(`findOne: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      const entity = await this.tracingInstanceRepo.findOne({
        where: { id }
      });

      if (!entity) {
        throw new NotFoundException(`Tracing instance with id ${id} not found`);
      }

      // Check access permission based on organization
      if (!isAdmin && entity.organizationId) {
        const accessibleOrganizations = await this.authzService.getAccessibleOrganizations(userId);
        if (!accessibleOrganizations.includes(entity.organizationId)) {
          throw new NotFoundException(`Tracing instance with id ${id} not found`);
        }
      }

      return this.mapEntityToDto(entity);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to find tracing instance:', error);
      throw error;
    }
  }

  /**
   * Create a new Tracing instance
   *
   * @param createDto - The create DTO
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   *
   * Sets ownership tracking (created_by, updated_by) on the new instance.
   * Requires org-admin privileges.
   */
  async create(createDto: CreateTracingInstanceDto, userId: string, roles: string[]): Promise<TracingInstanceResponseDto> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.debug(`create: userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // Check if user is org-admin in any organization
      await this.requireOrgAdmin(userId, roles);

      const entity = this.tracingInstanceRepo.create({
        label: createDto.label,
        tracingUrl: createDto.tracingUrl,
        tracingApiUrl: createDto.tracingApiUrl || undefined,
        tracingUi: createDto.tracingUi,
        tracingIframeAllowed: createDto.tracingIframeAllowed || false,
        createdBy: userId,
        updatedBy: userId,
        organizationId: createDto.organizationId || undefined,
      });

      const savedEntity = await this.tracingInstanceRepo.save(entity);

      this.logger.log(`Tracing instance created: ${createDto.label}`);
      return this.mapEntityToDto(savedEntity);
    } catch (error) {
      this.logger.error('Failed to create tracing instance:', error);
      throw error;
    }
  }

  /**
   * Update an existing Tracing instance
   *
   * @param id - The Tracing instance ID
   * @param updateDto - The update DTO
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   *
   * Validates user has permission to modify the instance.
   * Sets updated_by to track who made the change.
   */
  async update(id: string, updateDto: UpdateTracingInstanceDto, userId: string, roles: string[]): Promise<TracingInstanceResponseDto> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.debug(`update: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // Check if user is org-admin in any organization
      await this.requireOrgAdmin(userId, roles);

      const entity = await this.tracingInstanceRepo.findOne({ where: { id } });

      if (!entity) {
        throw new NotFoundException(`Tracing instance with id ${id} not found`);
      }

      // Check modification permission based on organization
      if (!isAdmin && entity.organizationId) {
        const accessibleOrganizations = await this.authzService.getAccessibleOrganizations(userId);
        if (!accessibleOrganizations.includes(entity.organizationId)) {
          throw new NotFoundException(`Tracing instance with id ${id} not found`);
        }
      }

      // Update only provided fields
      if (updateDto.label !== undefined) entity.label = updateDto.label;
      if (updateDto.tracingUrl !== undefined) entity.tracingUrl = updateDto.tracingUrl;
      if (updateDto.tracingApiUrl !== undefined) entity.tracingApiUrl = updateDto.tracingApiUrl || undefined;
      if (updateDto.tracingUi !== undefined) entity.tracingUi = updateDto.tracingUi;
      if (updateDto.tracingIframeAllowed !== undefined) entity.tracingIframeAllowed = updateDto.tracingIframeAllowed;

      // Track who updated the instance
      entity.updatedBy = userId;

      const updatedEntity = await this.tracingInstanceRepo.save(entity);

      this.logger.log(`Tracing instance updated: ${id}`);
      return this.mapEntityToDto(updatedEntity);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to update tracing instance:', error);
      throw error;
    }
  }

  /**
   * Delete a Tracing instance
   *
   * @param id - The Tracing instance ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Validates user has permission to delete the instance based on organization membership.
   */
  async remove(id: string, userId: string, roles: string[]): Promise<void> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.debug(`remove: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // Check if user is org-admin in any organization
      await this.requireOrgAdmin(userId, roles);

      const entity = await this.tracingInstanceRepo.findOne({ where: { id } });

      if (!entity) {
        throw new NotFoundException(`Tracing instance with id ${id} not found`);
      }

      // Check deletion permission based on organization
      if (!isAdmin && entity.organizationId) {
        const accessibleOrganizations = await this.authzService.getAccessibleOrganizations(userId);
        if (!accessibleOrganizations.includes(entity.organizationId)) {
          throw new NotFoundException(`Tracing instance with id ${id} not found`);
        }
      }

      await this.tracingInstanceRepo.remove(entity);

      this.logger.log(`Tracing instance ${id} deleted successfully`);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to delete tracing instance:', error);
      throw error;
    }
  }

  /**
   * Test connection to a Tracing instance
   *
   * @param id - The Tracing instance ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: TracingInstance entity does not have organization_id yet, so access checks are not applied.
   * Full access permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async testConnection(id: string, userId: string, roles: string[]): Promise<{ success: boolean; message: string }> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.debug(`testConnection: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      const instance = await this.findOne(id, userId, roles);

      // TODO: Implement actual tracing instance connection test based on UI type
      // For now, return success if instance exists
      return {
        success: true,
        message: `Connection test for ${instance.label} successful`
      };
    } catch (error) {
      this.logger.error('Failed to test tracing connection:', error);
      return {
        success: false,
        message: (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Connection test failed'
      };
    }
  }

  /**
   * Test Tracing connection with provided parameters (without saving)
   *
   * @param params - Connection parameters
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: This method validates connection parameters without accessing stored data,
   * so no resource-level authorization is needed. Basic authentication is still required.
   */
  async testConnectionWithParams(
    params: TestConnectionDto,
    userId: string,
    roles: string[],
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.debug(`testConnectionWithParams: userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // Validate required fields
      if (!params.tracingUrl) {
        throw new Error('Tracing URL is required');
      }
      if (!params.tracingUi) {
        throw new Error('Tracing UI type is required');
      }

      // TODO: Implement actual tracing instance connection test with provided parameters
      // For now, just validate that required fields are present
      return {
        success: true,
        message: 'Connection test successful'
      };
    } catch (error) {
      this.logger.error('Failed to test tracing connection with params:', error);
      return {
        success: false,
        message: (error && typeof error === 'object' && 'message' in error ? (error as Error).message : null) || 'Connection test failed'
      };
    }
  }
}
