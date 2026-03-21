import { Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * Base class for entities that support ownership tracking and multi-tenant organization scoping.
 *
 * Provides:
 * - Organization scoping (organization_id)
 * - Team scoping (team_id, optional)
 * - Ownership tracking (created_by, updated_by)
 * - Timestamps (created_at, updated_at)
 *
 * Used by RBAC Phase 2+ for resource-level authorization.
 */
export abstract class OwnedEntity {
  /**
   * User ID (Keycloak sub) or API key identifier who created this resource.
   * Format: Keycloak user ID or 'api-key:{id}'
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  created_by?: string;

  /**
   * User ID (Keycloak sub) or API key identifier who last modified this resource.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  updated_by?: string;

  /**
   * Organization this resource belongs to.
   * Nullable for backward compatibility with existing data.
   * Will be made required in future migration after data migration.
   */
  @Column({ type: 'uuid', nullable: true })
  organization_id?: string;

  /**
   * Team this resource belongs to (optional, for finer-grained scoping).
   */
  @Column({ type: 'uuid', nullable: true })
  team_id?: string;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
