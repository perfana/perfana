import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { Team } from './team.entity';

@Entity('organizations')
export class Organization {
  // Phase 5a audit logging — Organization itself has no `organization_id`
  // column (it IS the organization), so the audit row's organization scope
  // is set via `organizationIdOverride` at the call site.
  static auditableFields = ['name', 'description'] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @OneToMany(() => Team, team => team.organization)
  teams!: Team[];
}