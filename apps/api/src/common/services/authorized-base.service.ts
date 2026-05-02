import { BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { OwnedResource } from '@perfana/shared/entities';
import { AuthorizationService } from './authorization.service';

/**
 * AuthorizedBaseService - Abstract base class for services with organization-based authorization
 *
 * This abstract class provides common authorization helpers for services that manage
 * resources implementing the OwnedResource interface. It encapsulates organization-based
 * filtering and permission checking patterns to ensure consistent authorization enforcement.
 *
 * Key Features:
 * - Organization-based query filtering (applyOrgFilter)
 * - Permission checks for read, modify, and delete operations
 * - Automatic ownership assignment on resource creation
 * - Global admin bypass for all authorization checks
 *
 * Usage:
 * ```typescript
 * @Injectable()
 * export class TestRunsService extends AuthorizedBaseService<TestRun> {
 *   constructor(
 *     @InjectRepository(TestRun)
 *     private readonly testRunRepository: Repository<TestRun>,
 *     authzService: AuthorizationService,
 *   ) {
 *     super(testRunRepository, authzService);
 *   }
 *
 *   async findAll(userId: string, roles: string[]): Promise<TestRun[]> {
 *     const qb = this.repository.createQueryBuilder('test_run');
 *     await this.applyOrgFilter(qb, userId, roles);
 *     return qb.getMany();
 *   }
 * }
 * ```
 *
 * @typeParam T - Entity type that extends OwnedResource
 */
export abstract class AuthorizedBaseService<T extends OwnedResource> {
  protected readonly logger: Logger;

  constructor(
    protected readonly repository: Repository<T>,
    protected readonly authzService: AuthorizationService,
  ) {
    // Create logger with the name of the implementing class
    this.logger = new Logger(this.constructor.name);
  }

  // ============================================
  // Query Filtering
  // ============================================

  /**
   * Apply organization filter to a query builder.
   *
   * This method filters query results to only include resources that belong to
   * organizations the user is a member of. Uses the query builder's alias
   * dynamically to support different entity aliases.
   *
   * Behavior:
   * - Global admins see everything (no filter applied)
   * - Users with no organizations see nothing (WHERE 1 = 0)
   *
   * @param queryBuilder - The TypeORM query builder to apply filter to
   * @param userId - The user ID to check organization membership for
   * @param roles - The user's global roles from JWT or API key
   * @returns The query builder with organization filter applied
   *
   * @example
   * ```typescript
   * const qb = this.repository.createQueryBuilder('test_run');
   * await this.applyOrgFilter(qb, userId, roles);
   * return qb.getMany();
   * ```
   */
  protected async applyOrgFilter(
    queryBuilder: SelectQueryBuilder<T>,
    userId: string,
    roles: string[],
  ): Promise<SelectQueryBuilder<T>> {
    // Global admin sees everything - no filter applied
    if (this.authzService.isGlobalAdmin(roles)) {
      this.logger.debug(`Global admin bypass for org filter (user: ${userId})`);
      return queryBuilder;
    }

    // Get the list of organizations this user has access to
    const orgIds = await this.authzService.getAccessibleOrganizations(userId);

    // Get the actual alias used by the query builder for proper column reference
    const alias = queryBuilder.alias;

    if (orgIds.length === 0) {
      // User has no organizations - return empty result set
      this.logger.debug(`User ${userId} has no accessible organizations`);
      queryBuilder.andWhere('1 = 0');
    } else {
      this.logger.debug(
        `Applying org filter for user ${userId}: ${orgIds.length} organizations`,
      );
      queryBuilder.andWhere(
        `${alias}.organization_id IN (:...orgIds)`,
        { orgIds },
      );
    }

    return queryBuilder;
  }

  /**
   * Apply organization filter to a FindOptions-style where clause.
   *
   * This is an alternative to applyOrgFilter for simple queries that don't
   * use query builders. It returns an array of organization IDs that can
   * be used in TypeORM's In() operator.
   *
   *
   * @param userId - The user ID to check organization membership for
   * @param roles - The user's global roles from JWT or API key
   * @returns Array of accessible organization IDs, or undefined for global admins
   *
   * @example
   * ```typescript
   * const orgIds = await this.getAccessibleOrgIds(userId, roles);
   * if (orgIds === undefined) {
   *   // Global admin - no filter needed
   *   return this.repository.find();
   * }
   * return this.repository.find({
   *   where: { organization_id: In(orgIds) }
   * });
   * ```
   */
  protected async getAccessibleOrgIds(
    userId: string,
    roles: string[],
  ): Promise<string[] | undefined> {
    // Global admin sees everything
    if (this.authzService.isGlobalAdmin(roles)) {
      return undefined;
    }

    return this.authzService.getAccessibleOrganizations(userId);
  }

  // ============================================
  // Permission Checks
  // ============================================

  /**
   * Check if user has permission to access (read) a resource.
   *
   * Throws ForbiddenException if permission is denied. Access is granted if:
   * 1. User has global admin role
   * 2. User is a member of the resource's organization
   * 3. User is a member of the resource's team
   *
   * @param userId - The user ID to check
   * @param roles - The user's global roles from JWT or API key
   * @param resource - The resource to check access for
   * @throws ForbiddenException if user lacks access permission
   *
   * @example
   * ```typescript
   * const resource = await this.repository.findOne({ where: { id } });
   * if (!resource) throw new NotFoundException();
   * await this.checkAccessPermission(userId, roles, resource);
   * return resource;
   * ```
   */
  protected async checkAccessPermission(
    userId: string,
    roles: string[],
    resource: T,
  ): Promise<void> {
    const result = await this.authzService.canAccessResource(
      userId,
      roles,
      resource,
    );

    if (!result.allowed) {
      this.logger.warn(
        `Access denied for user ${userId}: ${result.reason}`,
      );
      throw new ForbiddenException(result.reason);
    }
  }

  /**
   * Check if user has permission to modify (update) a resource.
   *
   * Throws ForbiddenException if permission is denied. Modification is granted if:
   * 1. User has global admin role
   * 2. User is the resource creator (createdBy matches userId)
   * 3. User is an organization admin (org-admin)
   * 4. User is a team admin (team-admin) for the resource's team
   *
   * @param userId - The user ID to check
   * @param roles - The user's global roles from JWT or API key
   * @param resource - The resource to check modification permission for
   * @throws ForbiddenException if user lacks modification permission
   *
   * @example
   * ```typescript
   * const resource = await this.repository.findOne({ where: { id } });
   * if (!resource) throw new NotFoundException();
   * await this.checkModifyPermission(userId, roles, resource);
   * Object.assign(resource, updateDto);
   * return this.repository.save(resource);
   * ```
   */
  protected async checkModifyPermission(
    userId: string,
    roles: string[],
    resource: T,
  ): Promise<void> {
    const result = await this.authzService.canModifyResource(
      userId,
      roles,
      resource,
    );

    if (!result.allowed) {
      this.logger.warn(
        `Modify permission denied for user ${userId}: ${result.reason}`,
      );
      throw new ForbiddenException(result.reason);
    }
  }

  /**
   * Check if user has permission to delete a resource.
   *
   * Uses the same authorization rules as modify permission. Throws ForbiddenException
   * if permission is denied.
   *
   * @param userId - The user ID to check
   * @param roles - The user's global roles from JWT or API key
   * @param resource - The resource to check deletion permission for
   * @throws ForbiddenException if user lacks deletion permission
   *
   * @example
   * ```typescript
   * const resource = await this.repository.findOne({ where: { id } });
   * if (!resource) throw new NotFoundException();
   * await this.checkDeletePermission(userId, roles, resource);
   * return this.repository.remove(resource);
   * ```
   */
  protected async checkDeletePermission(
    userId: string,
    roles: string[],
    resource: T,
  ): Promise<void> {
    // Delete permission uses the same authorization rules as modify
    const result = await this.authzService.canModifyResource(
      userId,
      roles,
      resource,
    );

    if (!result.allowed) {
      this.logger.warn(
        `Delete permission denied for user ${userId}: ${result.reason}`,
      );
      throw new ForbiddenException(result.reason);
    }
  }

  // ============================================
  // Ownership Management
  // ============================================

  /**
   * Assign ownership metadata to an entity before creation.
   *
   * Sets created_by, updated_by, organization_id, and optionally team_id on the entity.
   * This should be called before saving a new entity to ensure proper ownership tracking.
   *
   * **IMPORTANT**: This method validates that organizationId is provided and not empty.
   * All resources must belong to an organization for RBAC enforcement.
   *
   * @param entity - The entity (partial) to assign ownership to
   * @param userId - The user ID creating the resource
   * @param organizationId - The organization ID to assign (required, cannot be empty)
   * @param teamId - Optional team ID to assign
   * @returns The entity with ownership fields populated
   * @throws BadRequestException if organizationId is null, undefined, or empty string
   *
   * @example
   * ```typescript
   * const newEntity = this.assignOwnership(
   *   createDto,
   *   userId,
   *   organizationId,
   *   teamId
   * );
   * return this.repository.save(newEntity);
   * ```
   */
  protected assignOwnership(
    entity: Partial<T>,
    userId: string,
    organizationId: string,
    teamId?: string,
  ): Partial<T> {
    // Validate organizationId is provided and not empty
    if (!organizationId || organizationId.trim() === '') {
      this.logger.error(
        `Failed to assign ownership: organizationId is required but was ${organizationId === '' ? 'empty string' : 'null/undefined'}`,
      );
      throw new BadRequestException(
        'Organization ID is required for resource creation. User must belong to at least one organization.',
      );
    }

    return {
      ...entity,
      created_by: userId,
      updated_by: userId,
      organization_id: organizationId,
      team_id: teamId,
    } as Partial<T>;
  }

  /**
   * Mark an entity as updated by a user.
   *
   * Updates the updated_by field to track who last modified the resource.
   * This should be called before saving an updated entity.
   *
   * @param entity - The entity to mark as updated
   * @param userId - The user ID updating the resource
   * @returns The entity with updated_by field set
   *
   * @example
   * ```typescript
   * const updatedEntity = this.markUpdated(existingEntity, userId);
   * Object.assign(updatedEntity, updateDto);
   * return this.repository.save(updatedEntity);
   * ```
   */
  protected markUpdated(entity: T, userId: string): T {
    // Use type assertion to set the updated_by field
    (entity as OwnedResource).updated_by = userId;
    return entity;
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Get the user's default organization ID.
   *
   * Returns the first organization the user is a member of. This is useful
   * for create operations when no organization is explicitly specified.
   *
   * @param userId - The user ID to get default organization for
   * @returns The first organization ID, or undefined if user has no organizations
   *
   * @example
   * ```typescript
   * const defaultOrgId = await this.getDefaultOrganization(userId);
   * if (!defaultOrgId) {
   *   throw new BadRequestException('User must belong to an organization');
   * }
   * ```
   */
  protected async getDefaultOrganization(
    userId: string,
  ): Promise<string | undefined> {
    const orgIds = await this.authzService.getAccessibleOrganizations(userId);
    return orgIds.length > 0 ? orgIds[0] : undefined;
  }

  /**
   * Check if a user is a global admin.
   *
   * Convenience method that delegates to AuthorizationService.isGlobalAdmin().
   *
   * @param roles - The user's global roles from JWT or API key
   * @returns true if user has global admin privileges
   */
  protected isGlobalAdmin(roles: string[]): boolean {
    return this.authzService.isGlobalAdmin(roles);
  }

  /**
   * Verify user has access to a specific organization.
   *
   * Checks if the user is either a global admin or a member of the specified organization.
   * Throws ForbiddenException if the user doesn't have access.
   *
   * @param userId - The user ID to check
   * @param roles - The user's global roles from JWT or API key
   * @param organizationId - The organization ID to verify access for
   * @throws ForbiddenException if user doesn't have access to the organization
   *
   * @example
   * ```typescript
   * // Verify user can access resources in the requested organization
   * await this.verifyOrganizationAccess(userId, roles, requestedOrgId);
   * ```
   */
  protected async verifyOrganizationAccess(
    userId: string,
    roles: string[],
    organizationId: string,
  ): Promise<void> {
    // Global admins have access to all organizations
    if (this.authzService.isGlobalAdmin(roles)) {
      return;
    }

    const hasAccess = await this.authzService.isOrganizationMember(
      userId,
      organizationId,
    );

    if (!hasAccess) {
      this.logger.warn(
        `Organization access denied for user ${userId} to org ${organizationId}`,
      );
      throw new ForbiddenException(
        `User does not have access to organization ${organizationId}`,
      );
    }
  }
}
