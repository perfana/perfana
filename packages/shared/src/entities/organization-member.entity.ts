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
