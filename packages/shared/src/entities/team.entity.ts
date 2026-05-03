import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Organization } from './organization.entity';

@Entity('teams')
export class Team {
  // Phase 5a audit logging — `organization_id` is included so a stripped diff
  // pins the parent org. `restrict_to_team_members` is intentionally excluded:
  // it's a team-level visibility flag with no diff value once the team is
  // already scoped by `organization_id`.
  static auditableFields = ['name', 'description', 'organization_id'] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  organization_id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'boolean', default: false, name: 'restrict_to_team_members' })
  restrict_to_team_members!: boolean;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @ManyToOne(() => Organization, organization => organization.teams)
  @JoinColumn({ name: 'organization_id' })
  organization!: Organization;
}