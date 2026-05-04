import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('generic_deep_links')
export class GenericDeepLink {
  // Phase 5a — generic deep links are profile-scoped templates rendered into
  // every test run; user-curated config that's worth a row when changed.
  // Per-test-run `DeepLink` writes are intentionally NOT audited (high churn,
  // bucket-2 ingestion noise) — see PR16 burndown.
  static auditableFields = ['profile', 'name', 'url'] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  profile!: string;

  @Column({ type: 'varchar', length: 500 })
  name!: string;

  @Column({ type: 'text' })
  url!: string;

  // Ownership tracking (RBAC Phase 2)
  @Column({ type: 'uuid', name: 'organization_id' })
  organizationId!: string;

  @Column({ type: 'uuid', nullable: true, name: 'team_id' })
  teamId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'created_by' })
  createdBy?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'updated_by' })
  updatedBy?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
