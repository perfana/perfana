import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { Organization } from './organization.entity';

@Entity('organization_members')
@Unique(['organization_id', 'user_id'])
@Index(['user_id'])
@Index(['organization_id', 'user_id'])
export class OrganizationMember {
  // Phase 5a audit logging — membership rows record who was added/removed
  // (`user_id`) and which roles they hold (`roles`). `organization_id` is
  // intentionally included so a stripped diff still pins the org for joins.
  static auditableFields = ['user_id', 'roles', 'organization_id'] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  organization_id!: string;

  @Column('varchar', { length: 255, comment: 'Keycloak user sub or api-key:{id}' })
  user_id!: string;

  @Column('jsonb', {
    default: '[]',
    comment: 'Organization-level roles: org-admin, org-member, org-viewer',
  })
  roles!: string[];

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at!: Date;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: Organization;
}
