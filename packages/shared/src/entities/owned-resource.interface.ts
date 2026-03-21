/**
 * Interface for entities with ownership tracking.
 * Required fields (organization_id, created_by) ensure proper multi-tenant
 * isolation and audit trail for all resources.
 *
 * Entities implementing this interface can be used with AuthorizedBaseService
 * for organization-based filtering and permission checks.
 *
 * @example
 * ```typescript
 * @Entity('my_entity')
 * export class MyEntity implements OwnedResource {
 *   @PrimaryGeneratedColumn('uuid')
 *   id!: string;
 *
 *   // ... entity-specific fields ...
 *
 *   @Column({ type: 'uuid' })
 *   organization_id!: string;
 *
 *   @Column({ type: 'uuid', nullable: true })
 *   team_id?: string;
 *
 *   @Column({ type: 'uuid' })
 *   created_by!: string;
 *
 *   @Column({ type: 'uuid', nullable: true })
 *   updated_by?: string;
 * }
 * ```
 */
export interface OwnedResource {
  /**
   * UUID of the organization this resource belongs to.
   * Required for multi-tenant isolation - all resources must belong to an organization.
   */
  organization_id: string;

  /**
   * UUID of the team this resource belongs to within the organization.
   * Optional - resources can belong to an organization without a specific team.
   */
  team_id?: string;

  /**
   * User ID (Keycloak sub or api-key:{id}) who created this resource.
   * Required for audit trail and ownership tracking.
   */
  created_by: string;

  /**
   * User ID (Keycloak sub or api-key:{id}) who last modified this resource.
   * Optional - only set when the resource has been updated after creation.
   */
  updated_by?: string;
}

/**
 * Check if a resource was created by a specific user.
 *
 * @param resource - The resource to check
 * @param userId - The user ID to compare against
 * @returns true if the resource was created by the specified user
 */
export function createdByUser(resource: OwnedResource, userId: string): boolean {
  return resource.created_by === userId;
}
